// DELETE /api/documents/delete
// Deletes a RAG document: removes all chunks, pages, cache entries, storage file, and the document row.
//
// Request body: { documentId }

const { requireEnv, optionalEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');
const https = require('https');

function storageDelete(serviceKey, bucket, storagePath) {
  return new Promise(function (resolve) {
    const supaUrl = requireEnv('SUPABASE_URL');
    const body = JSON.stringify({ prefixes: [storagePath] });
    const req = https.request(
      {
        hostname: new URL(supaUrl).hostname,
        path: '/storage/v1/object/bulk/' + encodeURIComponent(bucket),
        method: 'DELETE',
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      function (res) {
        let d = '';
        res.on('data', function (c) {
          d += c;
        });
        res.on('end', function () {
          resolve(res.statusCode);
        });
      }
    );
    req.on('error', function () {
      resolve(500);
    });
    req.write(body);
    req.end();
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'DELETE' && event.httpMethod !== 'POST')
    return fail(405, 'Method not allowed');

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

  const { documentId } = body;
  if (!documentId || typeof documentId !== 'string') return fail(400, 'documentId is required');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  // Fetch the document to verify ownership and get storage_path
  const docResult = await supaRequest(
    'GET',
    'documents?id=eq.' +
      encodeURIComponent(documentId) +
      '&user_id=eq.' +
      user.id +
      '&select=id,storage_path,course_id&limit=1',
    null,
    serviceKey
  );

  if (!Array.isArray(docResult.body) || !docResult.body[0]) {
    return fail(404, 'Document not found or access denied');
  }

  const doc = docResult.body[0];

  // Delete in order: chunks → pages → cache entries → storage → document row
  await supaRequest(
    'DELETE',
    'document_chunks?document_id=eq.' + documentId + '&user_id=eq.' + user.id,
    null,
    serviceKey
  );
  await supaRequest(
    'DELETE',
    'document_pages?document_id=eq.' + documentId + '&user_id=eq.' + user.id,
    null,
    serviceKey
  );

  // Invalidate any retrieval cache for this course (stale after deletion)
  await supaRequest(
    'DELETE',
    'retrieval_cache?user_id=eq.' + user.id + '&course_id=eq.' + encodeURIComponent(doc.course_id),
    null,
    serviceKey
  ).catch(function (e) { console.error('[documents-delete] cache purge error:', e.message); });

  // Delete from storage
  if (doc.storage_path) {
    let bucket = optionalEnv('RAG_STORAGE_BUCKET', 'course-documents');
    let storagePath = doc.storage_path;
    const colon = storagePath.indexOf(':');
    if (colon > 0 && storagePath.indexOf('/') > colon) {
      bucket = storagePath.substring(0, colon);
      storagePath = storagePath.substring(colon + 1);
    }
    await storageDelete(serviceKey, bucket, storagePath);
  }

  // Delete document row
  const delResult = await supaRequest(
    'DELETE',
    'documents?id=eq.' + documentId + '&user_id=eq.' + user.id,
    null,
    serviceKey
  );

  return jsonResponse(200, { ok: true });
};
