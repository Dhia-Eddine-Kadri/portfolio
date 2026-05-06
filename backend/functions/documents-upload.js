// POST /api/documents/upload
// Accepts a base64-encoded PDF, stores it in Supabase Storage,
// inserts a row in `documents`, then triggers async processing.

const crypto = require('crypto');
const https = require('https');
const { requireEnv, optionalEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');

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

function triggerProcessing(documentId, userId) {
  const processUrl = optionalEnv('PROCESS_FUNCTION_URL', '');
  if (!processUrl) return Promise.resolve();
  const body = JSON.stringify({ documentId, userId });
  return new Promise(function (resolve) {
    try {
      const url = new URL(processUrl);
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'x-internal-secret': optionalEnv('INTERNAL_SECRET', '')
          }
        },
        function () {
          resolve();
        }
      );
      req.on('error', function () {
        resolve();
      });
      req.write(body);
      req.end();
      setTimeout(resolve, 5000);
    } catch (e) {
      resolve();
    }
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

  await triggerProcessing(document.id, user.id);

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
