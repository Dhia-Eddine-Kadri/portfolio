// POST /api/notes/generate
// Generates structured AI notes or a summary from an indexed PDF.
//
// Body: { courseId, documentId, tool: 'notes'|'summary', pdfText?, fileName? }
// Response: { note: { id, title, type, content_markdown, sources } }

'use strict';

const https = require('https');
const { requireEnv, optionalEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');

const OPENAI_MODEL = optionalEnv('OPENAI_GENERATE_MODEL_STRONG', 'gpt-4o');
const MAX_CONTEXT_CHARS = 24000; // ~6k tokens of context

// ── Prompts ───────────────────────────────────────────────────────────────────

function notesPrompt() {
  return `You are generating structured study notes for a student from a PDF.

Use ONLY the provided PDF excerpts. Do not invent facts, definitions, formulas, or examples.
If something is unclear in the source, write: *(Not clearly stated in the PDF.)*

Create structured, editable Markdown notes.

Include:
1. A clear **title** (H1) matching the topic
2. **Main ideas** — what this section is about
3. **Important definitions** — term: explanation
4. **Important formulas** — use KaTeX: inline math as $...$, display math as $$...$$
5. **Explanation of formula variables** (e.g. "where $n$ is the sample size")
6. **Step-by-step methods** if present in the source
7. **Key examples** from the PDF with solutions
8. **Common mistakes or warnings** if the PDF mentions them
9. **Exam-focused key points** — what to remember
10. **Source page references** in brackets, e.g. *(p. 3–5)*

Formatting rules:
- Use # for title, ## for sections, ### for subsections
- Use bullet points and numbered lists
- Use \`code\` for variable names and symbols
- Use tables only when comparing multiple items
- Write inline math with $...$ and display math with $$...$$
- Do NOT include generic filler sentences
- Do NOT use outside knowledge — only what is in the excerpts

Respond with Markdown only. No JSON. No preamble.`;
}

function summaryPrompt() {
  return `You are generating a concise study summary from a PDF.

Use ONLY the provided PDF excerpts. Do not invent missing information.

Create a concise but exam-useful summary.

Include:
1. **What this section is about** (1–2 sentences)
2. **The most important concepts** as bullet points
3. **Important formulas** using KaTeX: inline $...$, display $$...$$
4. **What to remember for the exam** — the 3–5 most important things
5. **Source page references** in brackets, e.g. *(p. 2–4)*

Keep it shorter than full notes — aim for quick review, not full explanation.
Use Markdown and KaTeX math. No JSON. No preamble.`;
}

// ── OpenAI (Markdown mode — no JSON response_format) ─────────────────────────

function callOpenAIMarkdown(systemPrompt, userMessage) {
  return new Promise(function (resolve, reject) {
    const apiKey = requireEnv('OPENAI_API_KEY');
    const body = JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 3600,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage }
      ]
    });
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, function (res) {
      let d = '';
      res.on('data', function (c) { d += c; });
      res.on('end', function () {
        try {
          const p = JSON.parse(d);
          if (res.statusCode >= 300) return reject(new Error('OpenAI ' + res.statusCode + ': ' + d.slice(0, 200)));
          const text = p.choices && p.choices[0] && p.choices[0].message && p.choices[0].message.content;
          if (!text) return reject(new Error('Empty OpenAI response'));
          resolve(text.trim());
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(55000, function () { req.destroy(new Error('OpenAI timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Chunk retrieval ───────────────────────────────────────────────────────────

async function fetchChunksForDocument(serviceKey, userId, courseId, documentId, pageStart, pageEnd) {
  const supaUrl = requireEnv('SUPABASE_URL').replace(/\/$/, '');
  let url = supaUrl + '/rest/v1/document_chunks' +
    '?select=chunk_text,page_start,page_end,section_title,source_type' +
    '&user_id=eq.' + encodeURIComponent(userId) +
    '&course_id=eq.' + encodeURIComponent(courseId) +
    '&document_id=eq.' + encodeURIComponent(documentId) +
    '&order=page_start.asc,id.asc' +
    '&limit=120';
  if (pageStart != null) url += '&page_start=gte.' + pageStart;
  if (pageEnd   != null) url += '&page_end=lte.' + pageEnd;

  const result = await supaRequest(serviceKey, 'GET', url, null);
  return Array.isArray(result) ? result : [];
}

// ── Context builder ───────────────────────────────────────────────────────────

function buildContext(chunks, fileName) {
  if (!chunks.length) return null;
  let ctx = 'SOURCE: ' + (fileName || 'PDF') + '\n\n';
  let chars = 0;
  const sources = [];
  for (const c of chunks) {
    const pageRef = c.page_start != null
      ? '[p. ' + c.page_start + (c.page_end && c.page_end !== c.page_start ? '–' + c.page_end : '') + ']'
      : '';
    const section = c.section_title ? '[' + c.section_title + '] ' : '';
    const line = section + pageRef + '\n' + c.chunk_text + '\n\n';
    if (chars + line.length > MAX_CONTEXT_CHARS) break;
    ctx += line;
    chars += line.length;
    sources.push({ page_start: c.page_start, page_end: c.page_end });
  }
  return { context: ctx, sources };
}

// ── Save to DB ────────────────────────────────────────────────────────────────

async function saveNote(serviceKey, { userId, courseId, documentId, title, type, markdown, sources }) {
  const supaUrl = requireEnv('SUPABASE_URL').replace(/\/$/, '');

  // Insert note
  const noteRows = await supaRequest(serviceKey, 'POST',
    supaUrl + '/rest/v1/notes?select=id',
    {
      user_id: userId,
      course_id: courseId,
      document_id: documentId || null,
      title,
      type,
      content_markdown: markdown
    },
    { 'Prefer': 'return=representation' }
  );
  const noteId = noteRows && noteRows[0] && noteRows[0].id;
  if (!noteId) return null;

  // Insert sources (best-effort)
  if (sources && sources.length && documentId) {
    const sourceRows = sources
      .filter(function (s) { return s.page_start != null; })
      .map(function (s) {
        return { note_id: noteId, document_id: documentId, page_start: s.page_start, page_end: s.page_end };
      });
    if (sourceRows.length) {
      await supaRequest(serviceKey, 'POST', supaUrl + '/rest/v1/note_sources', sourceRows, { 'Prefer': 'return=minimal' })
        .catch(function () {});
    }
  }

  return noteId;
}

// ── Extract title from markdown ───────────────────────────────────────────────

function extractTitle(markdown, fallback) {
  const m = markdown.match(/^#\s+(.+)/m);
  return m ? m[1].replace(/[*_`]/g, '').trim() : (fallback || 'AI Notes');
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method not allowed');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Missing authorization token');

  const user = await verifySupabaseToken(token);
  if (!user) return fail(401, 'Invalid or expired token');

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return fail(400, 'Invalid JSON'); }

  const { courseId, documentId, tool, pdfText, fileName, pageStart, pageEnd } = body;
  if (!courseId) return fail(400, 'courseId is required');
  if (!['notes', 'summary'].includes(tool)) return fail(400, 'tool must be notes or summary');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  // ── Retrieve indexed chunks ───────────────────────────────────────────────
  let context = null;
  let sources = [];

  if (documentId) {
    const chunks = await fetchChunksForDocument(serviceKey, user.id, courseId, documentId, pageStart, pageEnd);
    if (chunks.length) {
      const built = buildContext(chunks, fileName);
      context = built.context;
      sources = built.sources;
    }
  }

  // ── Fallback to pdfText if not indexed ───────────────────────────────────
  if (!context) {
    if (pdfText && pdfText.trim().length > 100) {
      const text = pdfText.slice(0, MAX_CONTEXT_CHARS);
      context = 'SOURCE: ' + (fileName || 'PDF') + '\n\n' + text;
    } else {
      return jsonResponse(200, {
        error: documentId
          ? 'This PDF has not been indexed yet. Please wait for indexing to complete or re-upload the file.'
          : 'No content available. Open a PDF and try again.'
      });
    }
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  const systemPrompt = tool === 'summary' ? summaryPrompt() : notesPrompt();
  const userMessage = 'PDF CONTENT:\n\n' + context + '\n\nGenerate ' + tool + ' from the above.';

  let markdown;
  try {
    markdown = await callOpenAIMarkdown(systemPrompt, userMessage);
  } catch (e) {
    console.error('notes-generate OpenAI error:', e.message);
    return jsonResponse(200, { error: 'AI generation failed: ' + e.message });
  }

  // ── Save & return ─────────────────────────────────────────────────────────
  const title = extractTitle(markdown, (fileName ? fileName.replace(/\.pdf$/i, '') : 'Notes') + ' — ' + (tool === 'summary' ? 'Summary' : 'Notes'));

  let noteId = null;
  try {
    noteId = await saveNote(serviceKey, { userId: user.id, courseId, documentId, title, type: tool, markdown, sources });
  } catch (e) {
    console.error('notes-generate save error:', e.message);
  }

  return jsonResponse(200, {
    note: { id: noteId, title, type: tool, content_markdown: markdown, sources }
  });
};
