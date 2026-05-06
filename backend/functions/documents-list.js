// GET /api/documents/list?courseId=xxx
// Returns all documents for the authenticated user in a given course,
// with their processing status (so the frontend can show progress).

const { requireEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'GET') return fail(405, 'Method not allowed');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Missing authorization token');

  const user = await verifySupabaseToken(token);
  if (!user) return fail(401, 'Invalid or expired token');

  const courseId = (event.queryStringParameters || {}).courseId;
  if (!courseId) return fail(400, 'courseId query parameter is required');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const result = await supaRequest(
    'GET',
    'documents?user_id=eq.' +
      user.id +
      '&course_id=eq.' +
      encodeURIComponent(courseId) +
      '&select=id,file_name,file_type,source_type,processing_status,processing_error,page_count,created_at,updated_at' +
      '&order=created_at.desc',
    null,
    serviceKey
  );

  if (!Array.isArray(result.body)) return fail(500, 'Failed to fetch documents');

  return jsonResponse(200, { documents: result.body });
};
