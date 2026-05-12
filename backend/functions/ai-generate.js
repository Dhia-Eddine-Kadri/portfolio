// POST /api/ai/generate
// Thin HTTP handler — all generation logic lives in backend/lib/study-pipeline.js
//
// Request body:
//   { courseId, tool, topic?, count?, difficulty?, documentIds? }
//   tool: "flashcards" | "quiz" | "summary"
//
// Response:
//   { tool, items, sources, error? }

const { requireEnv }  = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { runPipeline } = require('../lib/study-pipeline');
const { shouldUsePythonAI, forwardToPython } = require('../lib/python-ai-proxy');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST')    return fail(405, 'Method not allowed');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Missing authorization token');

  const user = await verifySupabaseToken(token);
  if (!user)  return fail(401, 'Invalid or expired token');

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return fail(400, 'Invalid JSON'); }

  const { courseId, tool, topic, count, difficulty, seenItems } = body;
  // Accept both documentIds (preferred) and docIds (legacy) for backward compat
  const rawDocumentIds = body.documentIds || body.docIds;
  if (!courseId || typeof courseId !== 'string') return fail(400, 'courseId is required');
  if (!['flashcards', 'quiz', 'summary'].includes(tool))
    return fail(400, 'tool must be flashcards, quiz, or summary');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const docIds     = Array.isArray(rawDocumentIds) && rawDocumentIds.length ? rawDocumentIds : null;
  const seen       = Array.isArray(seenItems) ? seenItems : [];

  // ── Flag-gated Python AI handoff ───────────────────────────────────────────
  // When USE_PYTHON_AI=true, forward quiz/flashcards/summary to the Python
  // service. The Python responses are remapped onto the JS contract that the
  // frontend already understands: { tool, items, sources, error? }.
  if (shouldUsePythonAI()) {
    const requestedCount = parseInt(count, 10) || (tool === 'flashcards' ? 10 : 8);
    let endpoint = null;
    let pyPayload = null;

    if (tool === 'quiz') {
      endpoint = 'generate-quiz';
      pyPayload = {
        userId: user.id,
        courseId,
        documentIds: docIds,
        requestedCount,
        difficulty: difficulty || 'medium',
        save: false
      };
    } else if (tool === 'flashcards') {
      endpoint = 'generate-flashcards';
      pyPayload = {
        userId: user.id,
        courseId,
        documentIds: docIds,
        requestedCount,
        save: false
      };
    } else if (tool === 'summary') {
      endpoint = 'generate-notes';
      pyPayload = {
        userId: user.id,
        courseId,
        documentIds: docIds,
        topic: topic || null,
        save: false
      };
    }

    if (endpoint) {
      const upstream = await forwardToPython(endpoint, pyPayload);
      if (upstream.ok) {
        const py = upstream.body || {};
        let mapped;
        if (tool === 'summary') {
          mapped = { tool, items: [], text: py.text || '', sources: py.groundedSources || [] };
          if (py.warning) mapped.error = py.warning;
        } else {
          const items = tool === 'quiz' ? (py.questions || []) : (py.cards || []);
          mapped = { tool, items, sources: [] };
          if (py.warning) mapped.error = py.warning;
        }
        mapped._viaPython = true;
        return jsonResponse(200, mapped);
      }
      console.warn('[ai-generate] Python ' + endpoint + ' failed (status ' + upstream.status + '), falling back to JS');
    }
  }

  let result;
  try {
    result = await runPipeline({ serviceKey, userId: user.id, courseId, tool, topic, count, difficulty, docIds, seenItems: seen });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error('ai-generate pipeline error:', msg);
    return jsonResponse(200, { tool, items: [], text: '', sources: [], error: 'AI generation is temporarily unavailable: ' + msg });
  }

  return jsonResponse(200, Object.assign({ tool }, result));
};
