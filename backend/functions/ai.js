// POST /api/ai — thin proxy to the Python /chat endpoint.
// All chatbot/vision logic now lives in python-ai. This shell only
// verifies the Supabase JWT and forwards the (Anthropic-shaped) body.

const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { pythonAiConfigured, forwardToPython } = require('../lib/python-ai-proxy');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method Not Allowed');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Unauthorized');

  const user = await verifySupabaseToken(token);
  if (!user) return fail(401, 'Invalid or expired session');

  if (!pythonAiConfigured()) return fail(503, 'AI service not configured');

  let incoming;
  try {
    incoming = JSON.parse(event.body || '{}');
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return fail(400, 'Invalid JSON body');
    }
  } catch (e) {
    return fail(400, 'Invalid JSON body');
  }

  const upstream = await forwardToPython('chat', {
    userId: user.id,
    system: incoming.system,
    messages: incoming.messages,
    max_tokens: incoming.max_tokens,
    model: incoming.model
  });
  return jsonResponse(upstream.status, upstream.body);
};
