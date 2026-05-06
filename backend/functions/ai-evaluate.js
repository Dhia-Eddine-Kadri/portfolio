// POST /api/ai/evaluate
// Runs a stored evaluation test case against the live RAG pipeline and records the result.
// Also supports GET to list evaluation results for a course.
//
// POST body: { courseId, testQuestion, expectedBehavior, expectedSourceKeywords? }
// GET query: ?courseId=xxx

const { requireEnv, optionalEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');
const https = require('https');

const VALID_BEHAVIORS = new Set([
  'answer_found', // should find and cite from docs
  'answer_not_found', // should refuse (no relevant chunks)
  'cite_specific_file', // answer must cite a specific file
  'no_hallucination' // answer must not include content outside retrieved chunks
]);

// Re-use the ai-ask logic inline by calling the live endpoint
function callAskEndpoint(token, courseId, question) {
  return new Promise(function (resolve, reject) {
    const baseUrl = optionalEnv('PROCESS_FUNCTION_URL', '');
    const host = baseUrl ? new URL(baseUrl).hostname : 'localhost';
    const isLocalhost = host === 'localhost' || host === '127.0.0.1';

    const body = JSON.stringify({ courseId, question, mode: 'strict' });
    const options = {
      hostname: host,
      path: isLocalhost ? '/.netlify/functions/ai-ask' : '/api/ai/ask',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    if (!isLocalhost) options.port = 443;

    const req = (isLocalhost ? require('http') : https).request(options, function (res) {
      let d = '';
      res.on('data', function (c) {
        d += c;
      });
      res.on('end', function () {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function evaluateResult(answer, sources, expectedBehavior, expectedSourceKeywords) {
  const notes = [];
  let passed = false;

  if (expectedBehavior === 'answer_found') {
    passed = !answer.unsupported && sources.length > 0;
    if (!passed)
      notes.push(
        'Expected a grounded answer with sources but got unsupported=' +
          answer.unsupported +
          ', sources=' +
          sources.length
      );
  } else if (expectedBehavior === 'answer_not_found') {
    passed = !!answer.unsupported || sources.length === 0;
    if (!passed) notes.push('Expected refusal but AI returned an answer with sources');
  } else if (expectedBehavior === 'cite_specific_file') {
    const keywords = (expectedSourceKeywords || []).map(function (k) {
      return k.toLowerCase();
    });
    const citedFiles = sources.map(function (s) {
      return (s.file_name || '').toLowerCase();
    });
    passed = keywords.every(function (k) {
      return citedFiles.some(function (f) {
        return f.includes(k);
      });
    });
    if (!passed)
      notes.push(
        'Expected citation of ' + keywords.join(', ') + ' but got: ' + citedFiles.join(', ')
      );
  } else if (expectedBehavior === 'no_hallucination') {
    // Pass if confidence is high or medium and not unsupported
    passed = answer.confidence !== 'low' && !answer.unsupported;
    if (!passed) notes.push('Low confidence or unsupported answer detected');
  }

  return { passed, notes: notes.join('; ') };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Missing authorization token');

  const user = await verifySupabaseToken(token);
  if (!user) return fail(401, 'Invalid or expired token');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  // GET — list evaluation results
  if (event.httpMethod === 'GET') {
    const courseId = (event.queryStringParameters || {}).courseId;
    if (!courseId) return fail(400, 'courseId is required');

    const result = await supaRequest(
      'GET',
      'ai_evaluations?course_id=eq.' +
        encodeURIComponent(courseId) +
        '&user_id=eq.' +
        user.id +
        '&order=created_at.desc&limit=50',
      null,
      serviceKey
    );
    return jsonResponse(200, { evaluations: Array.isArray(result.body) ? result.body : [] });
  }

  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return fail(400, 'Invalid JSON');
  }

  const { courseId, testQuestion, expectedBehavior, expectedSourceKeywords } = body;
  if (!courseId || typeof courseId !== 'string') return fail(400, 'courseId is required');
  if (!testQuestion || typeof testQuestion !== 'string')
    return fail(400, 'testQuestion is required');
  if (!expectedBehavior || !VALID_BEHAVIORS.has(expectedBehavior)) {
    return fail(400, 'expectedBehavior must be one of: ' + [...VALID_BEHAVIORS].join(', '));
  }

  // Run the question through the live RAG pipeline
  let ragResponse;
  try {
    ragResponse = await callAskEndpoint(token, courseId, testQuestion);
  } catch (e) {
    return fail(502, 'RAG pipeline unavailable: ' + e.message);
  }

  const sources = ragResponse.sources || [];
  const { passed, notes } = evaluateResult(
    ragResponse,
    sources,
    expectedBehavior,
    expectedSourceKeywords || []
  );

  // Store result
  const row = {
    user_id: user.id,
    course_id: courseId,
    test_question: testQuestion,
    expected_behavior: expectedBehavior,
    expected_sources: expectedSourceKeywords ? JSON.stringify(expectedSourceKeywords) : null,
    actual_answer: ragResponse.answer ? ragResponse.answer.slice(0, 2000) : '',
    actual_sources: JSON.stringify(sources),
    confidence: ragResponse.confidence || null,
    passed,
    notes: notes || null
  };

  await supaRequest('POST', 'ai_evaluations', row, serviceKey, { Prefer: 'return=minimal' });

  return jsonResponse(200, {
    passed,
    notes,
    answer: ragResponse.answer,
    sources,
    confidence: ragResponse.confidence,
    unsupported: ragResponse.unsupported
  });
};
