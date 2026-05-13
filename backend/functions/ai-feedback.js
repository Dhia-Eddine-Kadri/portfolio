// POST /api/ai/feedback — thin proxy to Python /feedback.
// Writes a row to ai_feedback. All persistence logic lives in python-ai.

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
  catch (e) { return fail(400, 'Invalid JSON body'); }

  const upstream = await forwardToPython('feedback', {
    userId:        user.id,
    courseId:      body.courseId,
    question:      body.question,
    rating:        body.rating,
    answerCacheId: body.answerCacheId || null,
    feedbackText:  body.feedbackText || null,
    reason:        body.reason || null
  });
  return jsonResponse(upstream.status === 200 ? 201 : upstream.status, upstream.body);
};
