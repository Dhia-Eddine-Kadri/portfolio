// POST /api/notes/generate — thin proxy to Python /notes-generate.
// All notes/summary logic (modes: analyze | section | merge | generate,
// scopes: page | section | range | document) lives in python-ai.

const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { pythonAiConfigured, forwardToPython } = require('../lib/python-ai-proxy');

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

  if (!body.courseId) return fail(400, 'courseId is required');
  if (!['notes', 'summary'].includes(body.tool)) return fail(400, 'tool must be notes or summary');

  const upstream = await forwardToPython('notes-generate', {
    userId:         user.id,
    courseId:       body.courseId,
    documentId:     body.documentId || null,
    tool:           body.tool,
    mode:           body.mode || 'generate',
    scope:          body.scope || 'document',
    fileName:       body.fileName || null,
    pdfText:        body.pdfText || null,
    language:       body.language || 'same_as_source',
    detailLevel:    body.detailLevel || 'balanced',
    currentPage:    body.currentPage != null ? Number(body.currentPage) : null,
    pageRange:      body.pageRange || null,
    topicTitle:     body.topicTitle || null,
    sections:       body.sections || null,
    effectivePages: body.effectivePages != null ? Number(body.effectivePages) : null,
    title:          body.title || null
  });
  return jsonResponse(upstream.status, upstream.body);
};
