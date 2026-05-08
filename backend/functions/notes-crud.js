// /api/notes  — list, update, delete
//   GET    /api/notes?courseId=&documentId=  → list notes
//   PATCH  /api/notes?id=  body: { title?, content_markdown? }  → update
//   DELETE /api/notes?id=  → delete

'use strict';

const { requireEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Missing authorization token');

  const user = await verifySupabaseToken(token);
  if (!user) return fail(401, 'Invalid or expired token');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supaUrl = requireEnv('SUPABASE_URL').replace(/\/$/, '');
  const params = event.queryStringParameters || {};

  // ── GET — list notes ──────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    let url = supaUrl + '/rest/v1/notes' +
      '?select=id,title,type,course_id,document_id,source_page_start,source_page_end,created_at,updated_at' +
      '&user_id=eq.' + encodeURIComponent(user.id) +
      '&order=created_at.desc&limit=100';
    if (params.courseId)    url += '&course_id=eq.'    + encodeURIComponent(params.courseId);
    if (params.documentId)  url += '&document_id=eq.'  + encodeURIComponent(params.documentId);
    if (params.id)          url += '&id=eq.'           + encodeURIComponent(params.id);

    const rows = await supaRequest(serviceKey, 'GET', url, null).catch(function () { return []; });

    // If fetching a single note by id, also return content_markdown
    if (params.id) {
      const full = await supaRequest(serviceKey, 'GET',
        supaUrl + '/rest/v1/notes?select=*&id=eq.' + encodeURIComponent(params.id) +
        '&user_id=eq.' + encodeURIComponent(user.id),
        null
      ).catch(function () { return []; });
      return jsonResponse(200, { note: full && full[0] || null });
    }

    return jsonResponse(200, { notes: Array.isArray(rows) ? rows : [] });
  }

  // ── PATCH — update note ───────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    const id = params.id;
    if (!id) return fail(400, 'id is required');

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return fail(400, 'Invalid JSON'); }

    const patch = {};
    if (typeof body.title === 'string')             patch.title = body.title;
    if (typeof body.content_markdown === 'string')  patch.content_markdown = body.content_markdown;
    if (!Object.keys(patch).length) return fail(400, 'Nothing to update');
    patch.updated_at = new Date().toISOString();

    await supaRequest(serviceKey, 'PATCH',
      supaUrl + '/rest/v1/notes?id=eq.' + encodeURIComponent(id) +
      '&user_id=eq.' + encodeURIComponent(user.id),
      patch,
      { 'Prefer': 'return=minimal' }
    );
    return jsonResponse(200, { ok: true });
  }

  // ── DELETE — delete note ──────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const id = params.id;
    if (!id) return fail(400, 'id is required');

    await supaRequest(serviceKey, 'DELETE',
      supaUrl + '/rest/v1/notes?id=eq.' + encodeURIComponent(id) +
      '&user_id=eq.' + encodeURIComponent(user.id),
      null,
      { 'Prefer': 'return=minimal' }
    );
    return jsonResponse(200, { ok: true });
  }

  return fail(405, 'Method not allowed');
};
