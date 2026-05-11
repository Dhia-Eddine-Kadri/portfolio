// POST /api/ai/evaluate
// Runs one or all test questions for a course through the RAG pipeline
// and records whether each evaluation passed.
//
// Request body:
//   { courseId, evaluationId? }
//   evaluationId: run a single test; omit to run all tests for courseId
//
// Response:
//   { ran, passed, failed, results: [{ id, test_question, passed, failure_reason }] }

const { requireEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchEvaluations(serviceKey, courseId, evaluationId) {
  let path = 'ai_evaluations?course_id=eq.' + encodeURIComponent(courseId);
  if (evaluationId) path += '&id=eq.' + encodeURIComponent(evaluationId);
  path += '&select=id,test_question,expected_behavior,expected_sources&order=created_at.asc';
  const result = await supaRequest('GET', path, null, serviceKey);
  return Array.isArray(result.body) ? result.body : [];
}

async function callAskEndpoint(token, courseId, question) {
  const SITE_URL = requireEnv('URL'); // Netlify injects this automatically
  const response = await fetch(SITE_URL + '/api/ai/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ courseId, question, mode: 'strict' })
  });
  return response.json();
}

function evaluateResult(ev, answer) {
  const behavior = ev.expected_behavior || 'grounded';
  const isRefused =
    answer.unsupported === true ||
    (answer.answer || '').toLowerCase().includes('could not find') ||
    (answer.answer || '').toLowerCase().includes('not in your uploaded');

  if (behavior === 'refuse') {
    return isRefused
      ? { passed: true, failure_reason: null }
      : { passed: false, failure_reason: 'Expected refusal but got a grounded answer.' };
  }

  if (behavior === 'general') {
    return answer.answer && answer.answer.length > 20
      ? { passed: true, failure_reason: null }
      : { passed: false, failure_reason: 'Answer was empty or too short.' };
  }

  // grounded (default)
  if (isRefused) {
    return {
      passed: false,
      failure_reason: 'Answer was refused but a grounded answer was expected.'
    };
  }

  const sources = Array.isArray(answer.sources) ? answer.sources : [];
  const expectedSources = Array.isArray(ev.expected_sources) ? ev.expected_sources : [];

  if (expectedSources.length > 0) {
    const citedFiles = sources.map(function (s) {
      return (s.file_name || '').toLowerCase();
    });
    const anyMatched = expectedSources.some(function (exp) {
      return citedFiles.some(function (cited) {
        return cited.includes(exp.toLowerCase());
      });
    });
    if (!anyMatched) {
      return {
        passed: false,
        failure_reason:
          'Expected sources not cited. Expected one of: [' +
          expectedSources.join(', ') +
          ']. Got: [' +
          (citedFiles.join(', ') || 'none') +
          ']'
      };
    }
  }

  if (answer.confidence === 'low' && sources.length === 0) {
    return { passed: false, failure_reason: 'Low confidence with no sources cited.' };
  }

  return { passed: true, failure_reason: null };
}

async function saveResult(serviceKey, ev, answer, verdict) {
  return supaRequest(
    'PATCH',
    'ai_evaluations?id=eq.' + ev.id,
    {
      actual_answer: answer.answer || '',
      actual_sources: answer.sources || [],
      actual_confidence: answer.confidence || null,
      passed: verdict.passed,
      failure_reason: verdict.failure_reason || null,
      run_at: new Date().toISOString()
    },
    serviceKey
  ).catch(function (e) { console.error('[ai-evaluate] store result error:', e.message); });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Missing authorization token');

  const user = await verifySupabaseToken(token);
  if (!user) return fail(401, 'Invalid or expired token');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return fail(400, 'Invalid JSON');
  }

  const { courseId, evaluationId } = body;
  if (!courseId || typeof courseId !== 'string') return fail(400, 'courseId is required');

  const evaluations = await fetchEvaluations(serviceKey, courseId, evaluationId || null);
  if (!evaluations.length) {
    return jsonResponse(200, { ran: 0, passed: 0, failed: 0, results: [] });
  }

  const results = [];
  for (var i = 0; i < evaluations.length; i++) {
    var ev = evaluations[i];
    var answer;
    try {
      answer = await callAskEndpoint(token, courseId, ev.test_question);
    } catch (e) {
      answer = { answer: '', sources: [], confidence: 'low', unsupported: true };
    }
    var verdict = evaluateResult(ev, answer);
    await saveResult(serviceKey, ev, answer, verdict);
    results.push({
      id: ev.id,
      test_question: ev.test_question,
      expected_behavior: ev.expected_behavior,
      passed: verdict.passed,
      failure_reason: verdict.failure_reason,
      confidence: answer.confidence,
      sources_count: Array.isArray(answer.sources) ? answer.sources.length : 0
    });
  }

  const passed = results.filter(function (r) {
    return r.passed;
  }).length;
  return jsonResponse(200, {
    ran: results.length,
    passed: passed,
    failed: results.length - passed,
    results: results
  });
};
