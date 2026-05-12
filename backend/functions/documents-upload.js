// POST /api/documents/upload
// Accepts a base64-encoded PDF, stores it in Supabase Storage,
// inserts a row in `documents`, then triggers async processing.

const crypto = require('crypto');
const https = require('https');
const { requireEnv, optionalEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');
const { triggerProcessing } = require('../lib/trigger-processing');

// Flag-gated handoff to the Python AI service. When USE_PYTHON_AI=true and
// AI_SERVICE_URL is configured, we call the Python indexer instead of the
// JS background processor. Anything else falls back to the existing flow
// so production behaviour is unchanged until the flag is flipped.
function triggerPythonIndexing(documentId, userId, courseId, storagePath) {
  return new Promise(function (resolve) {
    const serviceUrl = optionalEnv('AI_SERVICE_URL', '');
    const internalToken = optionalEnv('INTERNAL_SECRET', '');
    if (!serviceUrl || !internalToken) {
      return resolve({ ok: false, reason: 'AI service not configured' });
    }
    const target = new URL(serviceUrl.replace(/\/$/, '') + '/index-document');
    const payload = JSON.stringify({
      userId: userId,
      courseId: courseId,
      documentId: documentId,
      storagePath: storagePath
    });
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname,
        method: 'POST',
        headers: {
          'X-Internal-Token': internalToken,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Accept: 'application/json'
        }
      },
      function (res) {
        // The Python endpoint returns 200 once the background task is queued;
        // we don't need to wait for indexing to finish here.
        res.on('data', function () {});
        res.on('end', function () { resolve({ ok: res.statusCode < 400 }); });
      }
    );
    req.setTimeout(8000, function () { req.destroy(new Error('ai service timeout')); });
    req.on('error', function (err) { resolve({ ok: false, reason: String(err && err.message) }); });
    req.write(payload);
    req.end();
  });
}

const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_TYPES = { 'application/pdf': 'pdf' };
const STORAGE_BUCKET = optionalEnv('RAG_STORAGE_BUCKET', 'course-documents');

// ─── helpers ──────────────────────────────────────────────────────────────────

function uploadToStorage(serviceKey, storagePath, fileBuffer, mimeType) {
  return new Promise(function (resolve, reject) {
    const supaUrl = requireEnv('SUPABASE_URL');
    const hostname = new URL(supaUrl).hostname;
    const path = '/storage/v1/object/' + STORAGE_BUCKET + '/' + storagePath;
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey,
          'Content-Type': mimeType,
          'Content-Length': fileBuffer.length
        }
      },
      function (res) {
        let data = '';
        res.on('data', function (c) {
          data += c;
        });
        res.on('end', function () {
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve(storagePath);
          } else {
            reject(new Error('Storage upload failed: ' + res.statusCode + ' ' + data));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

function insertDocument(serviceKey, row) {
  return supaRequest('POST', 'documents', row, serviceKey, {
    Prefer: 'return=representation'
  });
}

// ─── handler ──────────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Missing authorization token');

  const user = await verifySupabaseToken(token);
  if (!user) return fail(401, 'Invalid or expired token');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (Buffer.byteLength(event.body || '', 'utf8') > Math.ceil(MAX_BODY_BYTES * 1.45)) {
    return fail(413, 'Request too large (max 20 MB file)');
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return fail(400, 'Invalid JSON body');
  }

  const { fileName, mimeType, fileBase64, courseId, semesterId, professorName, sourceType } = body;

  if (!fileName || typeof fileName !== 'string') return fail(400, 'fileName is required');
  if (!mimeType || !ALLOWED_TYPES[mimeType]) return fail(400, 'Only PDF files are supported');
  if (!fileBase64 || typeof fileBase64 !== 'string') return fail(400, 'fileBase64 is required');
  if (!courseId || typeof courseId !== 'string') return fail(400, 'courseId is required');

  const fileBuffer = Buffer.from(fileBase64, 'base64');
  if (fileBuffer.length > MAX_BODY_BYTES) return fail(413, 'File too large (max 20 MB)');

  const fileExt = ALLOWED_TYPES[mimeType];
  const documentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const storagePath = user.id + '/' + courseId + '/' + documentHash + '.' + fileExt;

  // Upload file to Supabase Storage
  try {
    await uploadToStorage(serviceKey, storagePath, fileBuffer, mimeType);
  } catch (e) {
    return fail(500, 'File storage failed: ' + e.message);
  }

  // Insert document row
  const docRow = {
    user_id: user.id,
    course_id: courseId,
    semester_id: semesterId || null,
    professor_name: professorName || null,
    file_name: fileName,
    file_type: fileExt,
    source_type: sourceType || 'lecture',
    storage_path: storagePath,
    processing_status: 'uploaded',
    document_hash: documentHash
  };

  const insertResult = await insertDocument(serviceKey, docRow);
  if (insertResult.status !== 201) {
    return fail(500, 'Failed to record document');
  }

  const document = Array.isArray(insertResult.body) ? insertResult.body[0] : insertResult.body;

  // Route indexing to whichever pipeline is enabled. Default = the existing
  // JS one; flip USE_PYTHON_AI=true once the Python service is healthy.
  const usePythonAi = (optionalEnv('USE_PYTHON_AI', 'false') || '').toLowerCase() === 'true';
  if (usePythonAi) {
    const py = await triggerPythonIndexing(document.id, user.id, courseId, storagePath);
    // Always fall back to the JS background processor if Python is unreachable
    // — better to over-index than to leave a document in `uploaded` forever.
    if (!py.ok) await triggerProcessing(document.id, user.id);
  } else {
    await triggerProcessing(document.id, user.id);
  }

  return jsonResponse(201, {
    document: {
      id: document.id,
      fileName: document.file_name,
      courseId: document.course_id,
      sourceType: document.source_type,
      processingStatus: document.processing_status,
      storagePath: document.storage_path
    }
  });
};
