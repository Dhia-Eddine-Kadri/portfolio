// POST /api/documents/index-existing
// Indexes a file that is already in the course-uploads Storage bucket.
// The browser sends only metadata (no file bytes) — the backend fetches the
// file directly from Supabase Storage and processes it server-side.
//
// Request body: { courseId, storageName, fileName, sourceType }

const https = require('https');
const { requireEnv, optionalEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');

const SOURCE_BUCKET = 'course-uploads';

function _ufKey(courseId) {
  return courseId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Wait for the request to be fully sent (not the response) before returning,
// otherwise Netlify kills the socket when the function exits.
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
      ); // resolve when response starts arriving
      req.on('error', function () {
        resolve();
      });
      req.write(body);
      req.end();
      // Safety timeout — don't wait more than 5s for the trigger
      setTimeout(resolve, 5000);
    } catch (e) {
      resolve();
    }
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Missing authorization token');

  const user = await verifySupabaseToken(token);
  if (!user) return fail(401, 'Invalid or expired token');

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return fail(400, 'Invalid JSON');
  }

  const { courseId, storageName, fileName, sourceType, folder } = body;
  if (!courseId || typeof courseId !== 'string') return fail(400, 'courseId is required');
  if (!storageName || typeof storageName !== 'string') return fail(400, 'storageName is required');
  if (!fileName || typeof fileName !== 'string') return fail(400, 'fileName is required');

  function _sanitizeFolder(f) {
    return String(f)
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/[^a-zA-Z0-9._\-() ]/g, '_')
      .replace(/ +/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+(?=\.[^.]+$)/g, '');
  }

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const courseKey = _ufKey(courseId);

  // Check if already indexed for this course to avoid duplicate work
  // Compute the canonical storage path for this file
  const folderSegment = folder ? _sanitizeFolder(folder) + '/' : '';
  const sourcePath = user.id + '/' + courseKey + '/' + folderSegment + storageName;
  const docStoragePath = SOURCE_BUCKET + ':' + sourcePath;

  const existing = await supaRequest(
    'GET',
    'documents?user_id=eq.' +
      user.id +
      '&course_id=eq.' +
      encodeURIComponent(courseId) +
      '&file_name=eq.' +
      encodeURIComponent(fileName) +
      '&select=id,processing_status,storage_path&limit=1',
    null,
    serviceKey
  );
  if (Array.isArray(existing.body) && existing.body[0]) {
    const doc = existing.body[0];
    if (doc.processing_status === 'ready' && doc.storage_path === docStoragePath) {
      return jsonResponse(200, {
        alreadyIndexed: true,
        documentId: doc.id,
        processingStatus: 'ready'
      });
    }
    // Failed, stuck, or stale storage_path — reset and re-trigger
    await supaRequest(
      'PATCH',
      'documents?id=eq.' + doc.id,
      {
        processing_status: 'uploaded',
        storage_path: docStoragePath
      },
      serviceKey
    );
    // Clear any old chunks/pages from previous failed run
    await supaRequest('DELETE', 'document_chunks?document_id=eq.' + doc.id, null, serviceKey).catch(
      function () {}
    );
    await supaRequest('DELETE', 'document_pages?document_id=eq.' + doc.id, null, serviceKey).catch(
      function () {}
    );
    await triggerProcessing(doc.id, user.id);
    return jsonResponse(200, {
      alreadyIndexed: false,
      documentId: doc.id,
      processingStatus: 'uploaded'
    });
  }

  // Insert document row
  const docRow = {
    user_id: user.id,
    course_id: courseId,
    file_name: fileName,
    file_type: 'pdf',
    source_type: sourceType || 'lecture',
    storage_path: docStoragePath,
    processing_status: 'uploaded'
  };

  const insertResult = await supaRequest('POST', 'documents', docRow, serviceKey, {
    Prefer: 'return=representation'
  });
  if (insertResult.status !== 201) {
    return fail(500, 'Failed to record document: ' + JSON.stringify(insertResult.body));
  }

  const document = Array.isArray(insertResult.body) ? insertResult.body[0] : insertResult.body;
  await triggerProcessing(document.id, user.id);

  return jsonResponse(201, {
    documentId: document.id,
    processingStatus: document.processing_status
  });
};
