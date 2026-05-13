// POST /api/ai/evaluate — thin proxy to Python /evaluate-retrieval.

const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { pythonAiConfigured, forwardToPython } = require('../lib/python-ai-proxy');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Missing authorization token');
  const user = await verifySupabaseToken(token);
  if (!user) return fail(401, 'Invalid or expired token');

  if (!pythonAiConfigured()) return fail(503, 'AI service not configured');

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return fail(400, 'Invalid JSON'); }

  if (!body.courseId || typeof body.courseId !== 'string') return fail(400, 'courseId is required');

  const upstream = await forwardToPython('evaluate-retrieval', {
    userId:       user.id,
    courseId:     body.courseId,
    evaluationId: body.evaluationId || null
  });
  return jsonResponse(upstream.status, upstream.body);
};
