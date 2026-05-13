// POST /api/ai/generate — thin proxy to Python /generate-{quiz,flashcards,notes}.
// All quiz/flashcards/summary logic now lives in python-ai.
//
// Request:  { courseId, tool, topic?, count?, difficulty?, documentIds? }
// Response: { tool, items, sources, error? }
//   (summary returns { tool, items: [], text, sources, error? })

const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { pythonAiConfigured, forwardToPython } = require('../lib/python-ai-proxy');

const _LETTERS = ['A', 'B', 'C', 'D'];

function _normaliseQuizQuestions(questions) {
  return (questions || []).map(function (q) {
    if ((q.type || 'mcq') !== 'mcq') return q;
    const opts = q.options || {};
    const arr = _LETTERS.map(function (L) {
      return typeof opts[L] === 'string' ? opts[L] : '';
    });
    let ansIdx = -1;
    if (typeof q.answer === 'string') {
      const m = q.answer.trim().toUpperCase().match(/^([A-D])/);
      if (m) ansIdx = _LETTERS.indexOf(m[1]);
    } else if (typeof q.answer === 'number') {
      ansIdx = q.answer;
    }
    return Object.assign({}, q, { options: arr, answer: ansIdx });
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

  const { courseId, tool, topic, count, difficulty } = body;
  const rawDocumentIds = body.documentIds || body.docIds;
  if (!courseId || typeof courseId !== 'string') return fail(400, 'courseId is required');
  if (!['flashcards', 'quiz', 'summary'].includes(tool)) {
    return fail(400, 'tool must be flashcards, quiz, or summary');
  }

  const docIds = Array.isArray(rawDocumentIds) && rawDocumentIds.length ? rawDocumentIds : null;
  const requestedCount = parseInt(count, 10) || (tool === 'flashcards' ? 10 : 8);

  let endpoint, pyPayload;
  if (tool === 'quiz') {
    endpoint = 'generate-quiz';
    pyPayload = {
      userId: user.id, courseId, documentIds: docIds,
      requestedCount, difficulty: difficulty || 'medium', save: false
    };
  } else if (tool === 'flashcards') {
    endpoint = 'generate-flashcards';
    pyPayload = { userId: user.id, courseId, documentIds: docIds, requestedCount, save: false };
  } else {
    endpoint = 'generate-notes';
    pyPayload = {
      userId: user.id, courseId, documentIds: docIds,
      topic: topic || null, save: false
    };
  }

  const upstream = await forwardToPython(endpoint, pyPayload);
  if (!upstream.ok) {
    return jsonResponse(200, {
      tool, items: [], text: '', sources: [],
      error: 'AI generation is temporarily unavailable: ' +
        ((upstream.body && upstream.body.error) || 'upstream ' + upstream.status)
    });
  }

  const py = upstream.body || {};
  let mapped;
  if (tool === 'summary') {
    mapped = { tool, items: [], text: py.text || '', sources: py.groundedSources || [] };
  } else if (tool === 'quiz') {
    mapped = { tool, items: _normaliseQuizQuestions(py.questions), sources: [] };
  } else {
    mapped = { tool, items: py.cards || [], sources: [] };
  }
  if (py.warning) mapped.error = py.warning;
  return jsonResponse(200, mapped);
};
