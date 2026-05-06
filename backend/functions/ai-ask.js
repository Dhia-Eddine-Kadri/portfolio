// POST /api/ai/ask
// RAG endpoint: embeds the question, retrieves relevant chunks from the student's
// course documents, then calls Claude with only those chunks as context.
//
// Request body:
//   { courseId, question, mode? }
//   mode: "strict" (default) | "general"
//
// Response:
//   { answer, sources, confidence, unsupported }

const https = require('https');
const crypto = require('crypto');
const { requireEnv, optionalEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');
const { countRecentEvents, rateLimitResponse } = require('../lib/rate-limit');

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMENSIONS = 1536;
const OPENAI_CHAT_MODEL = optionalEnv('AI_MODEL', 'gpt-4o-mini');
const MAX_CHUNKS = 10;
const MIN_SIMILARITY = 0.15;
const STRONG_SIMILARITY_THRESHOLD = 0.35; // below this, warn even if chunks exist
const MAX_COMPLETION_TOKENS = 2048;

const AI_RATE_LIMIT_MAX = Number(optionalEnv('AI_RATE_LIMIT_MAX', '20'));
const AI_RATE_LIMIT_WINDOW_MS = Number(optionalEnv('AI_RATE_LIMIT_WINDOW_MS', '3600000'));

// Source type priority boost for ranking (added to cosine similarity)
const SOURCE_BOOST = {
  solution:  0.08,
  exercise:  0.08,
  lecture:   0.10,
  exam:      0.06,
  notes:     0.02,
  summary:  -0.03,
  other:     0.00
};

// ─── OpenAI embeddings ────────────────────────────────────────────────────────

function embedQuestion(question) {
  return new Promise(function (resolve, reject) {
    const apiKey = requireEnv('OPENAI_API_KEY');
    const body = JSON.stringify({
      model: EMBED_MODEL,
      input: question,
      dimensions: EMBED_DIMENSIONS
    });
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
        let data = '';
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.data || !parsed.data[0]) return reject(new Error('Embedding failed: ' + data));
            resolve(parsed.data[0].embedding);
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

function retrieveChunks(serviceKey, userId, courseId, embedding) {
  // Call the match_chunks SQL function via Supabase RPC.
  // pgvector via PostgREST RPC requires the embedding as a string "[v1,v2,...]"
  // — passing a raw JS array gets serialized as a JSON array which pgvector
  // can't cast to vector at the RPC boundary, silently returning 0 rows.
  return new Promise(function (resolve, reject) {
    const supaUrl = requireEnv('SUPABASE_URL');
    const embeddingStr = '[' + embedding.join(',') + ']';
    const body = JSON.stringify({
      p_user_id: userId,
      p_course_id: courseId,
      p_embedding: embeddingStr,
      p_match_count: MAX_CHUNKS,
      p_threshold: MIN_SIMILARITY
    });
    const req = https.request(
      {
        hostname: new URL(supaUrl).hostname,
        path: '/rest/v1/rpc/match_chunks',
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      function (res) {
        let data = '';
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
          try {
            const parsed = JSON.parse(data);
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

// Apply source priority boost and re-sort
function rankChunks(chunks) {
  return chunks
    .map(function (c) {
      const boost = SOURCE_BOOST[c.source_type] || 0;
      return Object.assign({}, c, { final_score: c.similarity + boost });
    })
    .sort(function (a, b) { return b.final_score - a.final_score; });
}

// Fetch file_name for each unique document_id so we can cite properly
function fetchDocumentNames(serviceKey, documentIds) {
  if (!documentIds.length) return Promise.resolve({});
  const ids = documentIds.map(function (id) { return '"' + id + '"'; }).join(',');
  return supaRequest(
    'GET',
    'documents?id=in.(' + ids + ')&select=id,file_name',
    null,
    serviceKey
  ).then(function (result) {
    const map = {};
    if (Array.isArray(result.body)) {
      result.body.forEach(function (d) { map[d.id] = d.file_name; });
    }
    return map;
  });
}

// ─── Claude call ──────────────────────────────────────────────────────────────

function buildSystemPrompt(mode) {
  const base = [
    'You are StudySphere AI, a course-specific study assistant.',
    '',
    'You will receive COURSE CONTEXT containing excerpts from the student\'s uploaded lecture files, exercises, notes, and solutions.',
    '',
    'Rules:',
    '1. Use the course context as your primary source — adopt the professor\'s notation, terminology, and method.',
    '2. Always give a complete, helpful answer. If the context is only partially relevant, use what is there and fill gaps with standard knowledge for the subject.',
    '3. Never refuse to answer or say you cannot find something. If context is sparse, still solve the problem step by step.',
    '4. Set "unsupported": false unless the context is completely unrelated to the question.',
    '5. Cite the source file and page when you directly use content from it.',
    '6. Set "confidence" to "high" if the context directly answers the question, "medium" if partially, "low" if you relied mostly on general knowledge.',
    '',
    'Always respond in this JSON format:',
    '{',
    '  "answer": "...",',
    '  "sources": [{ "file_name": "...", "pages": "...", "quote": "..." }],',
    '  "confidence": "high|medium|low",',
    '  "unsupported": false',
    '}'
  ].join('\n');

  if (mode === 'general') {
    return base + '\n\n7. If the student explicitly asks for an outside explanation, you may use general knowledge but MUST label it clearly with: "Outside explanation, not from your uploaded course materials:"';
  }
  return base;
}

function buildFallbackSystemPrompt() {
  return [
    'You are StudySphere AI, a study assistant.',
    '',
    'No course materials were found for this question. Answer using your general knowledge.',
    'Be clear, concise, and helpful.',
    '',
    'IMPORTANT: Start your answer with: "This answer is based on general knowledge, not your uploaded course materials."',
    '',
    'Always respond in this JSON format:',
    '{',
    '  "answer": "...",',
    '  "sources": [],',
    '  "confidence": "medium",',
    '  "unsupported": true',
    '}'
  ].join('\n');
}

function buildContextBlock(rankedChunks, docNames) {
  if (!rankedChunks.length) return 'No relevant course material found.';
  return rankedChunks.map(function (c, i) {
    const fileName = docNames[c.document_id] || 'Unknown file';
    const pages = c.page_start === c.page_end
      ? 'page ' + c.page_start
      : 'pages ' + c.page_start + '-' + c.page_end;
    return [
      '[Source ' + (i + 1) + ']',
      'File: ' + fileName,
      'Pages: ' + pages,
      'Type: ' + c.source_type,
      'Text:',
      c.chunk_text
    ].join('\n');
  }).join('\n\n---\n\n');
}

function callOpenAI(systemPrompt, contextBlock, question) {
  return new Promise(function (resolve, reject) {
    const apiKey = requireEnv('OPENAI_API_KEY');
    const userMessage = 'COURSE CONTEXT:\n\n' + contextBlock + '\n\n---\n\nSTUDENT QUESTION:\n' + question;
    const body = JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      max_tokens: MAX_COMPLETION_TOKENS,
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
        let data = '';
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
            if (!text) return reject(new Error('Empty OpenAI response'));
            resolve(text);
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseOpenAIResponse(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {}
  return { answer: text, sources: [], confidence: 'low', unsupported: false };
}

// ─── Caching helpers ──────────────────────────────────────────────────────────

function normalizeQuestion(q) {
  return q.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hashQuestion(userId, courseId, normalizedQ, docVersionHash) {
  return crypto.createHash('sha256')
    .update('v2|' + userId + '|' + courseId + '|' + normalizedQ + '|' + docVersionHash)
    .digest('hex');
}

// Compute a hash over all document IDs + updated_at for the user's course
async function getDocumentVersionHash(serviceKey, userId, courseId) {
  const result = await supaRequest(
    'GET',
    'documents?user_id=eq.' + userId + '&course_id=eq.' + encodeURIComponent(courseId) +
    '&processing_status=eq.ready&select=id,updated_at&order=id.asc',
    null,
    serviceKey
  );
  if (!Array.isArray(result.body) || !result.body.length) return 'empty';
  const str = result.body.map(function (d) { return d.id + ':' + d.updated_at; }).join('|');
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Look up exact answer cache
async function getExactCache(serviceKey, userId, courseId, questionHash, docVersionHash) {
  const result = await supaRequest(
    'GET',
    'ai_answer_cache?user_id=eq.' + userId +
    '&course_id=eq.' + encodeURIComponent(courseId) +
    '&question_hash=eq.' + questionHash +
    '&document_version_hash=eq.' + docVersionHash +
    '&select=id,answer_json&limit=1',
    null,
    serviceKey
  );
  if (Array.isArray(result.body) && result.body[0]) return result.body[0];
  return null;
}

// Touch last_used_at and increment usage_count on a cache hit
function touchAnswerCache(serviceKey, cacheId) {
  return supaRequest(
    'PATCH',
    'ai_answer_cache?id=eq.' + cacheId,
    { last_used_at: new Date().toISOString(), usage_count: null }, // usage_count incremented via DB
    serviceKey
  ).catch(function () {});
}

// Look up semantic cache via match_cached_questions RPC
async function getSemanticCache(serviceKey, userId, courseId, embedding, docVersionHash) {
  const body = JSON.stringify({
    p_user_id: userId,
    p_course_id: courseId,
    p_embedding: '[' + embedding.join(',') + ']',
    p_document_version_hash: docVersionHash,
    p_threshold: 0.92,
    p_limit: 1
  });
  return new Promise(function (resolve) {
    const supaUrl = requireEnv('SUPABASE_URL');
    const req = https.request(
      {
        hostname: new URL(supaUrl).hostname,
        path: '/rest/v1/rpc/match_cached_questions',
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      function (res) {
        let data = '';
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
          try {
            const parsed = JSON.parse(data);
            resolve(Array.isArray(parsed) && parsed[0] ? parsed[0] : null);
          } catch (e) { resolve(null); }
        });
      }
    );
    req.on('error', function () { resolve(null); });
    req.write(body);
    req.end();
  });
}

// Fetch a cached answer by its ID
async function getAnswerById(serviceKey, answerId) {
  const result = await supaRequest(
    'GET',
    'ai_answer_cache?id=eq.' + answerId + '&select=id,answer_json&limit=1',
    null,
    serviceKey
  );
  if (Array.isArray(result.body) && result.body[0]) return result.body[0];
  return null;
}

// Store a new answer in the cache
async function storeAnswerCache(serviceKey, userId, courseId, questionHash, normalizedQ, docVersionHash, answerJson) {
  const result = await supaRequest(
    'POST',
    'ai_answer_cache',
    {
      user_id: userId,
      course_id: courseId,
      question_hash: questionHash,
      normalized_question: normalizedQ,
      document_version_hash: docVersionHash,
      answer_json: answerJson
    },
    serviceKey,
    { Prefer: 'return=representation' }
  );
  if (Array.isArray(result.body) && result.body[0]) return result.body[0].id;
  return null;
}

// Store question embedding for future semantic cache lookups
function storeQuestionCache(serviceKey, userId, courseId, question, embedding, answerId, docVersionHash) {
  return supaRequest(
    'POST',
    'ai_question_cache',
    {
      user_id: userId,
      course_id: courseId,
      question: question,
      question_embedding: JSON.stringify(embedding),
      answer_cache_id: answerId,
      document_version_hash: docVersionHash
    },
    serviceKey,
    { Prefer: 'return=minimal' }
  ).catch(function () {});
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

  // Rate limit
  const recentCount = await countRecentEvents(serviceKey, user.id, 'ai_ask', AI_RATE_LIMIT_WINDOW_MS);
  if (recentCount >= AI_RATE_LIMIT_MAX) {
    return rateLimitResponse();
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return fail(400, 'Invalid JSON body');
  }

  const { courseId, question, mode } = body;
  if (!courseId || typeof courseId !== 'string') return fail(400, 'courseId is required');
  if (!question || typeof question !== 'string') return fail(400, 'question is required');
  if (question.length > 2000) return fail(400, 'Question too long (max 2000 characters)');

  const strictMode = mode !== 'general';
  const normalizedQ = normalizeQuestion(question);

  // 1. Embed the question
  let embedding;
  try {
    embedding = await embedQuestion(question);
  } catch (e) {
    return fail(502, 'Embedding service unavailable');
  }

  // 2. Get document version hash (used for cache invalidation)
  const docVersionHash = await getDocumentVersionHash(serviceKey, user.id, courseId);
  const questionHash = hashQuestion(user.id, courseId, normalizedQ, docVersionHash);

  // 3. Check exact answer cache
  const exactHit = await getExactCache(serviceKey, user.id, courseId, questionHash, docVersionHash);
  if (exactHit) {
    touchAnswerCache(serviceKey, exactHit.id);
    return jsonResponse(200, Object.assign({}, exactHit.answer_json, { cached: true }));
  }

  // 4. Check semantic question cache
  const semanticHit = await getSemanticCache(serviceKey, user.id, courseId, embedding, docVersionHash);
  if (semanticHit && semanticHit.answer_cache_id) {
    const cachedAnswer = await getAnswerById(serviceKey, semanticHit.answer_cache_id);
    if (cachedAnswer) {
      touchAnswerCache(serviceKey, cachedAnswer.id);
      return jsonResponse(200, Object.assign({}, cachedAnswer.answer_json, { cached: true }));
    }
  }

  // 5. Retrieve relevant chunks via vector search
  const rawChunks = await retrieveChunks(serviceKey, user.id, courseId, embedding);

  // 6. No chunks found — fall back to general knowledge answer
  if (!rawChunks.length) {
    let fallbackResponse;
    try {
      fallbackResponse = await callOpenAI(buildFallbackSystemPrompt(), '', question);
    } catch (e) {
      return jsonResponse(200, {
        answer: 'I could not find this in your uploaded course materials. Please make sure you have uploaded the relevant lecture or exercise files for this course.',
        sources: [], confidence: 'low', unsupported: true, cached: false
      });
    }
    const fallbackResult = parseOpenAIResponse(fallbackResponse);
    const fallbackJson = { answer: fallbackResult.answer || '', sources: [], confidence: 'low', unsupported: true, cached: false };
    storeAnswerCache(serviceKey, user.id, courseId, questionHash, normalizedQ, docVersionHash, fallbackJson).catch(function () {});
    return jsonResponse(200, fallbackJson);
  }

  // 7. Rank by similarity + source type boost
  const rankedChunks = rankChunks(rawChunks);

  // Guardrail: best chunk is below strong threshold — still answer but flag low confidence
  const topScore = rankedChunks[0] ? rankedChunks[0].final_score : 0;
  const weakRetrieval = topScore < STRONG_SIMILARITY_THRESHOLD;

  // 8. Fetch document file names for citations
  const uniqueDocIds = [...new Set(rankedChunks.map(function (c) { return c.document_id; }))];
  const docNames = await fetchDocumentNames(serviceKey, uniqueDocIds);
  const knownFileNames = new Set(Object.values(docNames));

  // 9. Build context and call OpenAI
  const systemPrompt = buildSystemPrompt(strictMode ? 'strict' : 'general');
  const contextBlock = buildContextBlock(rankedChunks, docNames);

  let rawResponse;
  try {
    rawResponse = await callOpenAI(systemPrompt, contextBlock, question);
  } catch (e) {
    return fail(502, 'AI service unavailable');
  }

  // 10. Parse response
  const result = parseOpenAIResponse(rawResponse);

  // Citation validation: remove sources the AI hallucinated that aren't in retrieved chunks
  const validatedSources = (Array.isArray(result.sources) ? result.sources : []).filter(function (s) {
    return !s.file_name || knownFileNames.has(s.file_name);
  });

  const answerJson = {
    answer: result.answer || '',
    sources: validatedSources,
    confidence: result.confidence || (weakRetrieval ? 'medium' : 'high'),
    unsupported: false,
    weak_retrieval: false
  };

  // 11. Store in cache (fire-and-forget)
  storeAnswerCache(serviceKey, user.id, courseId, questionHash, normalizedQ, docVersionHash, answerJson)
    .then(function (newCacheId) {
      if (newCacheId) {
        storeQuestionCache(serviceKey, user.id, courseId, question, embedding, newCacheId, docVersionHash);
      }
    })
    .catch(function () {});

  return jsonResponse(200, Object.assign({}, answerJson, { cached: false }));
};
