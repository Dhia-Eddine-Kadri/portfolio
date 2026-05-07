// Netlify Edge Function — /api/ai/stream
// Streams OpenAI responses as Server-Sent Events.
// Runs on Deno V8 — uses fetch API, no Node.js require().

export default async function handler(request, context) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return new Response('Missing token', { status: 401, headers: corsHeaders() });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
  const AI_MODEL = Deno.env.get('AI_MODEL') || 'gpt-4o';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !OPENAI_API_KEY) {
    return new Response('Server misconfigured', { status: 500, headers: corsHeaders() });
  }

  // Verify token via Supabase /auth/v1/user
  const authRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { Authorization: 'Bearer ' + token, apikey: SUPABASE_SERVICE_KEY }
  });
  if (!authRes.ok) return new Response('Invalid token', { status: 401, headers: corsHeaders() });
  const userObj = await authRes.json();
  const userId = userObj.id;
  if (!userId) return new Response('Invalid token', { status: 401, headers: corsHeaders() });

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try { body = await request.json(); } catch (e) { return new Response('Invalid JSON', { status: 400, headers: corsHeaders() }); }
  const { courseId, question, mode, documentId, activeFileName, openFileContext } = body;
  if (!courseId || !question) return new Response('courseId and question required', { status: 400, headers: corsHeaders() });
  const activeDocId = (typeof documentId === 'string' && documentId) ? documentId : null;
  const openFileName = (typeof activeFileName === 'string' && activeFileName) ? activeFileName : null;
  const openCtx = (typeof openFileContext === 'string' && openFileContext.trim()) ? openFileContext.trim() : null;
  if (question.length > 2000) return new Response('Question too long', { status: 400, headers: corsHeaders() });

  const ragMode = mode === 'general' ? 'general' : 'strict';

  // ── Build SSE stream ──────────────────────────────────────────────────────
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  function send(obj) {
    try { writer.write(enc.encode('data: ' + JSON.stringify(obj) + '\n\n')); } catch (e) {}
  }

  // Run async pipeline — don't await, let it run while we return the stream
  (async () => {
    try {
      // 1. Parallel: HyDE + classify + base embedding
      const [hydeResult, qType, baseEmbed] = await Promise.all([
        generateHydeAndQueries(question, OPENAI_API_KEY),
        classifyQuestion(question, OPENAI_API_KEY),
        embedBatch([question], OPENAI_API_KEY)
      ]);

      // 2. Build all texts to embed (HyDE passage + query variants)
      const textsToEmbed = [question];
      if (hydeResult.hypothetical) textsToEmbed.push(hydeResult.hypothetical);
      hydeResult.queries.forEach(q => { if (q) textsToEmbed.push(q); });

      let allEmbeddings;
      try {
        allEmbeddings = textsToEmbed.length > 1
          ? await embedBatch(textsToEmbed, OPENAI_API_KEY)
          : baseEmbed;
      } catch (e) { allEmbeddings = baseEmbed; }

      // 3. Retrieve for each embedding in parallel
      const allChunks = await Promise.all(
        allEmbeddings.map((emb, i) =>
          retrieveChunks(userId, courseId, emb, textsToEmbed[i] || question, SUPABASE_URL, SUPABASE_SERVICE_KEY, activeDocId)
        )
      );
      const rawChunks = mergeChunks(allChunks);

      if (!rawChunks.length) {
        // No chunks — call OpenAI with a general knowledge fallback instead of refusing
        const fallbackSys = 'You are StudySphere AI — a knowledgeable academic study assistant. No uploaded course documents matched this question. You MUST still give a complete, helpful answer. NEVER refuse or say the question is incomplete. Start with: "⚠️ *No matching course material found — answering from general knowledge.*" Math: plain ASCII only.';
        const fallbackRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: AI_MODEL, max_tokens: 1500, temperature: 0.1, stream: true,
            messages: [{ role: 'system', content: fallbackSys }, { role: 'user', content: question }] })
        });
        if (fallbackRes.ok) {
          const fbReader = fallbackRes.body.getReader();
          const fbDecoder = new TextDecoder();
          let fbBuf = '';
          while (true) {
            const { done, value } = await fbReader.read();
            if (done) break;
            fbBuf += fbDecoder.decode(value, { stream: true });
            const lines = fbBuf.split('\n'); fbBuf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const d = line.slice(6).trim();
              if (d === '[DONE]') continue;
              try { const tok = JSON.parse(d).choices?.[0]?.delta?.content; if (tok) send({ t: tok }); } catch (e) {}
            }
          }
        }
        send({ done: true, sources: [], confidence: 'low', unsupported: true });
        await writer.close();
        return;
      }

      // 4. Fetch doc names first so we can resolve the open file's document ID for boosting
      const allDocIds = [...new Set(rawChunks.map(c => c.document_id))];
      const docNames = await fetchDocNames(allDocIds, SUPABASE_URL, SUPABASE_SERVICE_KEY);
      // Find the document ID that corresponds to the file the student has open
      const openDocId = openFileName
        ? Object.entries(docNames).find(([, name]) => name === openFileName || name.toLowerCase() === openFileName.toLowerCase())?.[0] || null
        : null;

      // 4b. If the open file is indexed, retrieve focused chunks from it using the question
      //     embedding — more reliable than browser-extracted text and works for scanned PDFs.
      let effectiveOpenCtx = openCtx;
      if (openDocId) {
        const indexedCtx = await fetchOpenDocChunks(userId, courseId, openDocId, allEmbeddings[0], question, SUPABASE_URL, SUPABASE_SERVICE_KEY);
        if (indexedCtx) effectiveOpenCtx = indexedCtx;
      }

      // 5. Rank with open-file boost + deduplicate
      const ranked = deduplicate(rank(rawChunks, qType, openDocId));

      // 6. Build context (open file excerpt prepended, then RAG chunks)
      const { text: contextText } = buildContext(ranked, docNames, effectiveOpenCtx, openFileName);
      const lang = detectLang(ranked);

      // 7. Build prompt (includes which file is open)
      const tokenBudget = { exercise: 3000, derivation: 3000, concept: 2000, definition: 1500, formula: 1800, other: 2000 };
      const tempMap = { exercise: 0.1, derivation: 0.1, formula: 0.1, definition: 0.1, concept: 0.15, other: 0.1 };
      const systemPrompt = buildPrompt(ragMode, lang, qType, openFileName);

      // 8. Stream OpenAI
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: AI_MODEL,
          max_tokens: tokenBudget[qType] || 2000,
          temperature: tempMap[qType] !== undefined ? tempMap[qType] : 0.1,
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'COURSE CONTEXT:\n\n' + contextText + '\n\n---\n\nSTUDENT QUESTION:\n' + question }
          ]
        })
      });

      if (!openaiRes.ok) {
        send({ error: 'AI service error: ' + openaiRes.status });
        await writer.close();
        return;
      }

      // Read SSE stream from OpenAI
      const reader = openaiRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const p = JSON.parse(data);
            const tok = p.choices?.[0]?.delta?.content;
            if (tok) { fullText += tok; send({ t: tok }); }
          } catch (e) {}
        }
      }

      // 8. Parse META block
      let sources = [];
      let confidence = 'medium';
      const metaMatch = fullText.match(/<!--META-->([\s\S]*?)<!--\/META-->/);
      if (metaMatch) {
        try {
          const meta = JSON.parse(metaMatch[1]);
          sources = Array.isArray(meta.sources) ? meta.sources : [];
          confidence = meta.confidence || 'medium';
        } catch (e) {}
      }

      // Validate sources
      const knownFiles = new Set(Object.values(docNames));
      sources = sources.filter(s => !s.file_name || knownFiles.has(s.file_name));

      send({ done: true, sources, confidence, question_type: qType });
    } catch (e) {
      send({ error: e.message || 'Stream error' });
    } finally {
      try { await writer.close(); } catch (e) {}
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      ...corsHeaders()
    }
  });
}

export const config = { path: '/api/ai/stream' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

async function embedBatch(texts, apiKey) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts, dimensions: 1536 })
  });
  const data = await res.json();
  if (!data.data) throw new Error('Embed failed');
  return data.data.slice().sort((a, b) => a.index - b.index).map(e => e.embedding);
}

async function callFast(sys, user, maxTokens, apiKey) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini', max_tokens: maxTokens || 300, temperature: 0.2,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
    })
  });
  const d = await res.json();
  return d.choices?.[0]?.message?.content || '';
}

async function generateHydeAndQueries(question, apiKey) {
  try {
    const raw = await callFast(
      'Given a student question, output JSON: {"hypothetical":"2-3 sentence academic passage answering this","queries":["alt phrasing 1","alt phrasing 2"]}. ONLY JSON.',
      question, 350, apiKey
    );
    const p = JSON.parse(raw);
    return { hypothetical: (p.hypothetical || '').trim(), queries: Array.isArray(p.queries) ? p.queries.slice(0, 2) : [] };
  } catch (e) { return { hypothetical: '', queries: [] }; }
}

async function classifyQuestion(question, apiKey) {
  try {
    const r = (await callFast('Classify: exercise, definition, derivation, concept, formula, other. ONE WORD.', question, 10, apiKey)).trim().toLowerCase();
    return ['exercise', 'definition', 'derivation', 'concept', 'formula', 'other'].includes(r) ? r : 'other';
  } catch (e) { return 'other'; }
}

async function retrieveChunks(userId, courseId, embedding, query, supaUrl, serviceKey, documentId) {
  try {
    const params = {
      p_user_id: userId, p_course_id: courseId,
      p_embedding: '[' + embedding.join(',') + ']',
      p_query: query || '', p_match_count: 12, p_threshold: 0.12
    };
    if (documentId) params.p_document_id = documentId;
    const res = await fetch(supaUrl + '/rest/v1/rpc/match_chunks_hybrid', {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}

function mergeChunks(arrays) {
  const map = {};
  arrays.forEach(arr => arr.forEach(c => { if (!map[c.id] || c.similarity > map[c.id].similarity) map[c.id] = c; }));
  return Object.values(map);
}

const SOURCE_BOOST = { solution: 0.08, exercise: 0.08, lecture: 0.1, exam: 0.06, notes: 0.02, summary: -0.03, other: 0.0 };

function rank(chunks, qType, openDocId) {
  return chunks.map(c => {
    const sb = SOURCE_BOOST[c.source_type] || 0;
    const ob = c.is_official ? 0.05 : 0;
    const eb = qType === 'exercise' ? (c.source_type === 'solution' ? 0.18 : c.source_type === 'exercise' ? 0.12 : 0) : 0;
    // Small boost for the open file so the problem statement stays in context alongside solutions
    const openBoost = (openDocId && c.document_id === openDocId) ? 0.06 : 0;
    return { ...c, final_score: c.similarity + sb + ob + eb + openBoost };
  }).sort((a, b) => b.final_score - a.final_score);
}

function deduplicate(chunks) {
  const selected = [];
  for (const c of chunks) {
    if (!selected.some(s => s.document_id === c.document_id &&
      Math.max(s.page_start, c.page_start) <= Math.min(s.page_end, c.page_end)))
      selected.push(c);
    if (selected.length >= 12) break;
  }
  return selected;
}

async function fetchOpenDocChunks(userId, courseId, docId, embedding, question, supaUrl, serviceKey) {
  try {
    const res = await fetch(supaUrl + '/rest/v1/rpc/match_chunks_hybrid', {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_user_id: userId, p_course_id: courseId,
        p_embedding: '[' + embedding.join(',') + ']',
        p_query: question || '', p_match_count: 5, p_threshold: 0.05,
        p_document_id: docId
      })
    });
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    const texts = data.slice(0, 5).map(c => c.chunk_text || '').filter(Boolean);
    return texts.length ? texts.join('\n\n') : null;
  } catch (e) { return null; }
}

async function fetchDocNames(docIds, supaUrl, serviceKey) {
  if (!docIds.length) return {};
  const ids = docIds.map(id => '"' + id + '"').join(',');
  const res = await fetch(supaUrl + '/rest/v1/documents?id=in.(' + ids + ')&select=id,file_name', {
    headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey }
  });
  const data = await res.json();
  const map = {};
  if (Array.isArray(data)) data.forEach(d => { map[d.id] = d.file_name; });
  return map;
}

function buildContext(chunks, docNames, openCtx, openFileName) {
  let total = 0;
  const blocks = [];
  // Prepend the open file's text excerpt first — this is the problem statement
  // the student is looking at. The AI must read this to understand the question.
  if (openCtx && openFileName) {
    const header = '=== OPEN FILE (student is currently reading this — contains the problem) ===\nFILE: ' + openFileName + '\nTEXT:\n' + openCtx;
    blocks.push(header);
    total += Math.ceil(header.length / 4);
  }
  for (const [i, c] of chunks.entries()) {
    const fn = docNames[c.document_id] || 'Unknown';
    const pg = c.page_start === c.page_end ? 'p.' + c.page_start : 'pp.' + c.page_start + '-' + c.page_end;
    const lines = ['=== SOURCE ' + (i + 1) + ' ===', 'FILE: ' + fn, 'PAGES: ' + pg,
      'TYPE: ' + (c.source_type || 'document'),
      c.section_title ? 'SECTION_ID: ' + c.section_title : null, 'TEXT:', c.chunk_text].filter(Boolean);
    const block = lines.join('\n');
    const tokens = Math.ceil(block.length / 4);
    if (total + tokens > 14000) break;
    blocks.push(block);
    total += tokens;
  }
  return { text: blocks.join('\n\n') };
}

function detectLang(chunks) {
  const sample = chunks.slice(0, 4).map(c => c.chunk_text || '').join(' ').toLowerCase();
  const de = ['der', 'die', 'das', 'und', 'ist', 'mit', 'für', 'eine', 'wird', 'sind', 'auf', 'von', 'den', 'bei', 'als', 'auch', 'sich', 'nicht', 'nach'];
  const words = sample.split(/\s+/);
  const total = Math.min(words.length, 200);
  const count = words.slice(0, total).filter(w => de.includes(w)).length;
  return total > 0 && count / total > 0.04 ? 'de' : 'en';
}

const TYPE_INSTRUCTIONS = {
  exercise: '\n\n## Exercise rules\nThe COURSE CONTEXT contains the full solution. Read every source block carefully — the answer IS there.\n1. State what is given and what is asked.\n2. Write out the complete solution step by step, numbered.\n3. At each step state the formula or principle used, in the professor\'s exact notation.\n4. Show every algebraic manipulation. Do NOT skip steps.\n5. **Bold the final answer** with units.\n6. If the solution PDF is a source, follow it exactly — reproduce its steps, not a generic approach.\nNEVER say the solution "is not explicitly provided" if sources from the document are retrieved — that means the content IS there; read it more carefully.',
  definition: '\n\nQuote the exact definition from the material first. Then explain it in plain language. Then give one example.',
  derivation: '\n\nShow every algebraic step numbered. State the rule applied at each step. Use the professor\'s notation.',
  concept: '\n\nExplain what it is, why it matters, how it works. Use a concrete example from the course material.',
  formula: '\n\nState the formula clearly. Define every variable. Give units. Show a brief worked example.',
  other: ''
};

function buildPrompt(mode, lang, qType, openFileName) {
  const strict = mode !== 'general';
  const langLine = lang === 'de' ? 'Respond in **German** — the course materials are in German.' : 'Respond in **English**.';
  const openFileLine = openFileName
    ? 'The student is currently reading **' + openFileName + '**. The OPEN FILE block contains the problem/exercise text from that file. Use it to understand exactly what is being asked. Look in ALL other course documents (lectures, solution sheets) for the explanation and full solution.'
    : '';
  return [
    'You are StudySphere AI — a precise, expert-level academic study assistant.', langLine,
    openFileLine ? openFileLine : '',
    '',
    '1. Read ALL source blocks in COURSE CONTEXT before writing anything. The answer is in the sources.',
    '2. Ground every claim in the COURSE CONTEXT. Use the professor\'s exact notation and terminology.',
    '3. Structure your answer clearly in markdown. Start with a direct 1-2 sentence answer.',
    '4. Math: use KaTeX. Inline: $...$  Display: $$...$$ — NEVER use \\( or \\[. No Unicode math letters (𝑎𝑣𝑥 etc.).',
    '5. After each major claim, add inline citation: *(filename, p.X)* or *(filename, p.X, SECTION_ID)*.',
    strict ? '6. Strict mode: ALWAYS write a COMPLETE, DETAILED answer — never refuse, never truncate. Use COURSE CONTEXT first. Only label something "(not explicitly in uploaded materials)" when it is genuinely absent from ALL sources. If sources are cited, their content IS available — use it fully.'
           : '6. General mode: use COURSE CONTEXT first, then supplement with outside knowledge. Label outside knowledge clearly.',
    '7. Confidence: set "high" when COURSE CONTEXT directly supports the answer (even if one minor detail needed a general-knowledge label). Set "medium" ONLY when substantial portions rely on general knowledge. Set "low" when mostly general knowledge.',
    '8. CRITICAL: Do NOT include confidence, sources, or any metadata in your markdown answer text. Only put them in the META block at the very end.',
    TYPE_INSTRUCTIONS[qType] || '',
    '',
    'After your full markdown answer, on a new line output ONLY this (fill in real values, no placeholders):',
    '<!--META-->{"sources":[{"file_name":"exact FILE value","pages":"exact PAGES value","section":"SECTION_ID or empty"}],"confidence":"high|medium|low"}<!--/META-->'
  ].join('\n');
}
