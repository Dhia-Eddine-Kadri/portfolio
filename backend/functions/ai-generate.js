// POST /api/ai/generate
// Generate study tools (flashcards, quiz, summary) from a course's uploaded documents.
//
// Request body:
//   { courseId, tool, topic?, count?, difficulty? }
//   tool: "flashcards" | "quiz" | "summary"
//   topic: optional focus topic / question (used as retrieval query)
//   count: number of items to generate (default: 8 for flashcards/quiz, ignored for summary)
//   difficulty: "easy" | "medium" | "hard" (quiz only, default: "medium")
//
// Response:
//   flashcards: { tool, items: [{ front, back, source }], sources }
//   quiz:       { tool, items: [{ question, options, answer, explanation, source }], sources }
//   summary:    { tool, text, sources }

const https = require('https');
const { requireEnv, optionalEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMENSIONS = 1536;
const OPENAI_CHAT_MODEL = optionalEnv('OPENAI_GENERATE_MODEL', 'gpt-4o-mini');
const MIN_SIMILARITY = 0.12;
const MAX_CHUNKS = 8;


const SOURCE_BOOST = {
  solution: 0.08,
  exercise: 0.08,
  lecture: 0.1,
  exam: 0.06,
  notes: 0.02,
  summary: -0.03,
  other: 0.0
};

// ─── OpenAI helpers ───────────────────────────────────────────────────────────

function embedText(text) {
  return new Promise(function (resolve, reject) {
    const apiKey = requireEnv('OPENAI_API_KEY');
    const body = JSON.stringify({ model: EMBED_MODEL, input: text, dimensions: EMBED_DIMENSIONS });
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: '/v1/embeddings',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      function (res) {
        let d = '';
        res.on('data', function (c) {
          d += c;
        });
        res.on('end', function () {
          try {
            const p = JSON.parse(d);
            if (res.statusCode < 200 || res.statusCode >= 300)
              return reject(new Error('Embedding failed (' + res.statusCode + '): ' + d));
            if (!p.data || !p.data[0]) return reject(new Error('Embedding failed: ' + d));
            resolve(p.data[0].embedding);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.setTimeout(5000, function () {
      req.destroy(new Error('Embedding request timed out'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function callOpenAI(systemPrompt, userMessage) {
  return new Promise(function (resolve, reject) {
    const apiKey = requireEnv('OPENAI_API_KEY');
    const body = JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    });
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      function (res) {
        let d = '';
        res.on('data', function (c) {
          d += c;
        });
        res.on('end', function () {
          try {
            const p = JSON.parse(d);
            if (res.statusCode < 200 || res.statusCode >= 300)
              return reject(new Error('OpenAI failed (' + res.statusCode + '): ' + d));
            const text =
              p.choices && p.choices[0] && p.choices[0].message && p.choices[0].message.content;
            if (!text) return reject(new Error('Empty OpenAI response: ' + d));
            resolve(parseJsonObject(text));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.setTimeout(20000, function () {
      req.destroy(new Error('OpenAI request timed out'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseJsonObject(text) {
  const stripped = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch (e) {}
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('OpenAI response was not JSON');
  return JSON.parse(match[0]);
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

function _rpcChunks(serviceKey, supaUrl, payload) {
  return new Promise(function (resolve) {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: new URL(supaUrl).hostname,
        path: '/rest/v1/rpc/match_chunks_hybrid',
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      function (res) {
        let d = '';
        res.on('data', function (c) { d += c; });
        res.on('end', function () {
          try {
            const parsed = JSON.parse(d);
            // Supabase returns an error object when the parameter is unrecognised
            resolve(Array.isArray(parsed) ? parsed : []);
          } catch (e) { resolve([]); }
        });
      }
    );
    req.on('error', function () { resolve([]); });
    req.write(body);
    req.end();
  });
}

function retrieveChunks(serviceKey, userId, courseId, embedding, query, docIds) {
  const supaUrl = requireEnv('SUPABASE_URL');
  const basePayload = {
    p_user_id: userId,
    p_course_id: courseId,
    p_embedding: '[' + embedding.join(',') + ']',
    p_query: query || '',
    p_match_count: docIds && docIds.length ? MAX_CHUNKS * 3 : MAX_CHUNKS,
    p_threshold: MIN_SIMILARITY
  };

  if (!docIds || !docIds.length) {
    return _rpcChunks(serviceKey, supaUrl, basePayload);
  }

  // Try with p_document_ids (migration 010). If the function doesn't know that
  // parameter yet, Supabase returns an error object instead of an array — fall
  // back to fetching all chunks and filtering in JS.
  const filteredPayload = Object.assign({}, basePayload, { p_document_ids: docIds });
  return _rpcChunks(serviceKey, supaUrl, filteredPayload).then(function (chunks) {
    if (chunks.length) return chunks;
    // Fallback: retrieve without filter then keep only the selected documents
    return _rpcChunks(serviceKey, supaUrl, basePayload).then(function (all) {
      const idSet = new Set(docIds.map(String));
      return all.filter(function (c) { return idSet.has(String(c.document_id)); });
    });
  });
}

function rankChunks(chunks) {
  return chunks
    .map(function (c) {
      return Object.assign({}, c, {
        final_score: c.similarity + (SOURCE_BOOST[c.source_type] || 0) + (c.is_official ? 0.05 : 0)
      });
    })
    .sort(function (a, b) {
      return b.final_score - a.final_score;
    });
}

function deduplicateChunks(chunks) {
  const selected = [];
  for (var i = 0; i < chunks.length; i++) {
    var c = chunks[i];
    if (
      !selected.some(function (s) {
        return (
          s.document_id === c.document_id &&
          Math.max(s.page_start, c.page_start) <= Math.min(s.page_end, c.page_end)
        );
      })
    )
      selected.push(c);
    if (selected.length >= MAX_CHUNKS) break;
  }
  return selected;
}

function fetchDocNames(serviceKey, docIds) {
  if (!docIds.length) return Promise.resolve({});
  const ids = docIds
    .map(function (id) {
      return '"' + id + '"';
    })
    .join(',');
  return supaRequest(
    'GET',
    'documents?id=in.(' + ids + ')&select=id,file_name',
    null,
    serviceKey
  ).then(function (r) {
    const map = {};
    if (Array.isArray(r.body))
      r.body.forEach(function (d) {
        map[d.id] = d.file_name;
      });
    return map;
  });
}

function buildContext(chunks, docNames) {
  return chunks
    .map(function (c, i) {
      const file = docNames[c.document_id] || 'Unknown file';
      const pages =
        c.page_start === c.page_end ? 'p.' + c.page_start : 'pp.' + c.page_start + '-' + c.page_end;
      const lines = ['[Source ' + (i + 1) + '] ' + file + ', ' + pages];
      if (c.section_title) lines.push('Section: ' + c.section_title);
      lines.push(c.chunk_text);
      return lines.join('\n');
    })
    .join('\n\n---\n\n');
}

// ─── System prompts ───────────────────────────────────────────────────────────

function flashcardsPrompt(count) {
  return [
    'You are StudySphere AI generating flashcards from course materials.',
    'Create exactly ' + count + ' flashcards from the provided COURSE CONTEXT.',
    'Rules:',
    '1. Every card must be based on content in the context — no invented facts.',
    '2. Front: concise question or term (under 15 words).',
    "3. Back: clear answer (1-3 sentences). Use the professor's notation.",
    '4. Write math as plain ASCII: x^2, x_0, not Unicode math letters.',
    '5. source: file name and page where the concept appears.',
    '',
    'Respond ONLY in this JSON:',
    '{"items":[{"front":"...","back":"...","source":"filename, p.X"}]}'
  ].join('\n');
}

function quizPrompt(count, difficulty) {
  const diffMap = {
    easy: 'straightforward recall questions — definitions and basic facts',
    medium: 'application questions — using concepts to solve simple problems',
    hard: 'analysis questions — multi-step reasoning and edge cases'
  };
  return [
    'You are StudySphere AI generating a multiple-choice quiz from course materials.',
    'Create exactly ' +
      count +
      ' ' +
      difficulty +
      ' questions (' +
      (diffMap[difficulty] || diffMap.medium) +
      ').',
    'Rules:',
    '1. Every question must come from the provided COURSE CONTEXT.',
    '2. Each question has exactly 4 options (A-D). Only one is correct.',
    '3. answer: the letter of the correct option (A, B, C, or D).',
    '4. explanation: 1-2 sentences referencing the source.',
    '5. Write math as plain ASCII.',
    '',
    'Respond ONLY in this JSON:',
    '{"items":[{"question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A","explanation":"...","source":"filename, p.X"}]}'
  ].join('\n');
}

function summaryPrompt() {
  return [
    'You are StudySphere AI summarising course materials.',
    'Write a structured summary of the provided COURSE CONTEXT.',
    'Rules:',
    '1. Use headings (##) for main topics found in the context.',
    '2. Use bullet points for key facts, definitions, and formulas.',
    '3. Write math as plain ASCII: x^2, x_0.',
    '4. End with a "Key Takeaways" section (3-5 bullets).',
    '5. Only include content from the context — no invented facts.',
    '6. Cite (filename, p.X) inline for important claims.',
    '',
    'Respond ONLY in this JSON:',
    '{"text":"## Topic\\n- point\\n..."}'
  ].join('\n');
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

  const { courseId, tool, topic, count, difficulty, documentIds } = body;
  if (!courseId || typeof courseId !== 'string') return fail(400, 'courseId is required');
  if (!['flashcards', 'quiz', 'summary'].includes(tool))
    return fail(400, 'tool must be flashcards, quiz, or summary');
  const docIds = Array.isArray(documentIds) && documentIds.length ? documentIds : null;

  const itemCount = Math.min(Math.max(parseInt(count) || 6, 3), 10);
  const diff = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
  const query =
    topic ||
    (tool === 'flashcards'
      ? 'key concepts definitions terms'
      : tool === 'quiz'
        ? 'important concepts problems exercises'
        : 'main topics overview');

  // Embed the retrieval query
  let embedding;
  try {
    embedding = await embedText(query);
  } catch (e) {
    console.error('ai-generate embedding error:', e && e.message ? e.message : e);
    return jsonResponse(200, {
      tool,
      items: [],
      text: '',
      sources: [],
      error: 'AI generation is temporarily unavailable. Please try again in a moment.'
    });
  }

  // Retrieve and rank chunks
  const rawChunks = await retrieveChunks(serviceKey, user.id, courseId, embedding, query, docIds);
  if (!rawChunks.length) {
    return jsonResponse(200, {
      tool,
      items: [],
      text: '',
      sources: [],
      error: 'No indexed course documents found. Upload and index your course files first.'
    });
  }

  const chunks = deduplicateChunks(rankChunks(rawChunks));
  const docNames = await fetchDocNames(serviceKey, [
    ...new Set(
      chunks.map(function (c) {
        return c.document_id;
      })
    )
  ]);
  const context = buildContext(chunks, docNames);

  // Pick system prompt
  const sysPrompt =
    tool === 'flashcards'
      ? flashcardsPrompt(itemCount)
      : tool === 'quiz'
        ? quizPrompt(itemCount, diff)
        : summaryPrompt();

  const userMessage =
    'COURSE CONTEXT:\n\n' + context + (topic ? '\n\n---\n\nFocus on: ' + topic : '');

  let result;
  try {
    result = await callOpenAI(sysPrompt, userMessage);
  } catch (e) {
    console.error('ai-generate OpenAI error:', e && e.message ? e.message : e);
    return jsonResponse(200, {
      tool,
      items: [],
      text: '',
      sources: [],
      error: 'AI generation is temporarily unavailable. Please try again in a moment.'
    });
  }

  // Build deduplicated sources list
  const seenFiles = new Set();
  const sources = chunks
    .map(function (c) {
      return {
        file_name: docNames[c.document_id] || 'Unknown',
        pages: c.page_start === c.page_end ? String(c.page_start) : c.page_start + '-' + c.page_end,
        section: c.section_title || null
      };
    })
    .filter(function (s) {
      if (seenFiles.has(s.file_name)) return false;
      seenFiles.add(s.file_name);
      return true;
    });

  return jsonResponse(200, {
    tool,
    items: result.items || [],
    text: result.text || '',
    sources
  });
};
