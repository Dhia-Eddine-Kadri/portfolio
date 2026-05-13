// POST /api/documents/index-existing
// Indexes a file that is already in the course-uploads Storage bucket.
// The browser sends only metadata (no file bytes) — the backend fetches the
// file directly from Supabase Storage and processes it server-side.
//
// Request body: { courseId, storageName, fileName, sourceType }

const { requireEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');
const { pythonAiConfigured, forwardToPython } = require('../lib/python-ai-proxy');

// Forward an indexing job to the Python service. No JS fallback — the
// legacy JS PDF pipeline has been removed; if Python is unreachable, the
// document stays in `processing_status: 'uploaded'` and the next
// re-index request retries it.
async function _kickIndex(documentId, userId, courseId, storagePath) {
  if (!pythonAiConfigured()) {
    console.warn('[documents-index-existing] AI service not configured — document stays unprocessed');
    return;
  }
  const r = await forwardToPython('index-document', {
    userId: userId,
    courseId: courseId,
    documentId: documentId,
    storagePath: storagePath
  });
  if (!r.ok) {
    console.warn('[documents-index-existing] Python upstream failed:', r.status, r.body && r.body.error);
  }
}

const SOURCE_BUCKET = 'course-uploads';

function _ufKey(courseId) {
  return courseId.replace(/[^a-zA-Z0-9_-]/g, '_');
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

  const {
    courseId,
    storageName,
    fileName,
    sourceType,
    folder,
    professorName,
    lectureNumber,
    exerciseNumber,
    language,
    isOfficialProfMaterial,
    forceReindex
  } = body;
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

  // Check if this exact storage object is already indexed for this course.
  // File names are not unique across folders, so storage_path is the canonical key.
  const folderSegment = folder ? _sanitizeFolder(folder) + '/' : '';
  const sourcePath = user.id + '/' + courseKey + '/' + folderSegment + storageName;
  const docStoragePath = SOURCE_BUCKET + ':' + sourcePath;

  const existing = await supaRequest(
    'GET',
    'documents?user_id=eq.' +
      user.id +
      '&course_id=eq.' +
      encodeURIComponent(courseId) +
      '&storage_path=eq.' +
      encodeURIComponent(docStoragePath) +
      '&select=id,processing_status,storage_path&limit=1',
    null,
    serviceKey
  );
  if (Array.isArray(existing.body) && existing.body[0]) {
    const doc = existing.body[0];
    // Without forceReindex, a doc that's already ready and at the same storage
    // path is a no-op. With forceReindex=true (new), we always reset and re-process
    // — this lets users re-index after PDF-extraction improvements.
    if (!forceReindex && doc.processing_status === 'ready' && doc.storage_path === docStoragePath) {
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
    await _kickIndex(doc.id, user.id, courseId, docStoragePath);
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
    processing_status: 'uploaded',
    professor_name: professorName || null,
    lecture_number: Number.isFinite(lectureNumber) ? lectureNumber : null,
    exercise_number: Number.isFinite(exerciseNumber) ? exerciseNumber : null,
    language: language || 'en',
    is_official_prof_material: isOfficialProfMaterial === true
  };

  const insertResult = await supaRequest('POST', 'documents', docRow, serviceKey, {
    Prefer: 'return=representation'
  });
  if (insertResult.status !== 201) {
    return fail(500, 'Failed to record document: ' + JSON.stringify(insertResult.body));
  }

  const document = Array.isArray(insertResult.body) ? insertResult.body[0] : insertResult.body;
  await _kickIndex(document.id, user.id, courseId, docStoragePath);

  return jsonResponse(201, {
    documentId: document.id,
    processingStatus: document.processing_status
  });
};
