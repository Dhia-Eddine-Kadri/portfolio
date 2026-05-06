// POST /api/ai/feedback
// Stores student feedback on an AI answer.
//
// Request body:
//   { courseId, question, answerCacheId?, rating, feedbackText?, reason? }
//
// rating values: helpful | not_helpful | wrong_answer | not_in_lecture |
//                missing_citation | wrong_formula | too_vague | wrong_language

const { requireEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');

const VALID_RATINGS = new Set([
  'helpful', 'not_helpful', 'wrong_answer', 'not_in_lecture',
  'missing_citation', 'wrong_formula', 'too_vague', 'wrong_language'
]);

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
    return fail(400, 'Invalid JSON body');
  }

  const { courseId, question, answerCacheId, rating, feedbackText, reason } = body;

  if (!courseId || typeof courseId !== 'string') return fail(400, 'courseId is required');
  if (!question || typeof question !== 'string') return fail(400, 'question is required');
  if (!rating || !VALID_RATINGS.has(rating)) {
    return fail(400, 'rating must be one of: ' + [...VALID_RATINGS].join(', '));
  }

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const row = {
    user_id: user.id,
    course_id: courseId,
    question: question.slice(0, 2000),
    answer_cache_id: answerCacheId || null,
    rating,
    feedback_text: feedbackText ? String(feedbackText).slice(0, 1000) : null,
    reason: reason ? String(reason).slice(0, 200) : null
  };

  const result = await supaRequest('POST', 'ai_feedback', row, serviceKey, {
    Prefer: 'return=minimal'
  });

  if (result.status !== 201) return fail(500, 'Failed to save feedback');

  return jsonResponse(201, { ok: true });
};
