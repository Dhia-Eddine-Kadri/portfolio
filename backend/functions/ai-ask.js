// POST /api/ai/ask — thin proxy to the Python /ask endpoint.
// All RAG logic (retrieval, ranking, grounded answer, caching) lives in
// python-ai. The browser hits the streaming endpoint directly for
// real-time replies; this non-streaming handler stays for clients that
// don't support SSE and for evaluation jobs.

const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { pythonAiConfigured, forwardToPython } = require('../lib/python-ai-proxy');

function _mapSources(groundedSources) {
  return (groundedSources || []).map(function (s) {
    var ps = s && s.pageStart;
    var pe = s && s.pageEnd;
    var pages = null;
    if (ps && pe) pages = ps === pe ? String(ps) : ps + '-' + pe;
    else if (ps) pages = String(ps);
    return { file_name: (s && s.fileName) || 'Unknown', pages: pages, section: s && s.sectionTitle };
  });
}

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

  const courseId = body.courseId;
  const question = body.question;
  if (!courseId || typeof courseId !== 'string') return fail(400, 'courseId is required');
  if (!question || typeof question !== 'string') return fail(400, 'question is required');

  const documentIds = Array.isArray(body.documentIds) ? body.documentIds
    : (body.documentId ? [body.documentId] : null);

  const upstream = await forwardToPython('ask', {
    userId: user.id,
    courseId: courseId,
    documentIds: documentIds,
    question: question,
    bypassCache: !!body.bypassCache
  });

  if (!upstream.ok) return jsonResponse(upstream.status, upstream.body);

  const py = upstream.body || {};
  return jsonResponse(200, {
    answer: py.answer || '',
    retrievalMode: py.retrievalMode || 'strong',
    confidence: py.retrievalMode === 'strong' ? 'high' : 'low',
    unsupported: py.retrievalMode !== 'strong',
    sources: _mapSources(py.groundedSources),
    cacheHit: !!py.cacheHit,
    model: py.model || null
  });
};
