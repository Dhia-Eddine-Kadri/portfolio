const { requireEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { supaRequest } = require('../lib/supabase-admin');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { isUuid, cleanText, requireOneOf } = require('../lib/validation');
const { logSecurityEvent } = require('../lib/logger');

const ALLOWED_REASONS = ['spam', 'harassment', 'hate', 'impersonation', 'nsfw', 'other'];

function dmUsers(roomId) {
  const match = String(roomId || '').match(/^dm_([0-9a-f-]{36})_([0-9a-f-]{36})$/i);
  return match ? [match[1], match[2]] : null;
}

function isPublicAppRoom(roomId) {
  const value = String(roomId || '');
  return (
    value === 'general' ||
    (!value.startsWith('custom_') && !value.startsWith('dm_') && !isUuid(value))
  );
}

async function canAccessRoom(userId, roomId, serviceKey) {
  if (!roomId) return false;
  if (isPublicAppRoom(roomId)) return true;

  const dm = dmUsers(roomId);
  if (dm) return dm.includes(userId);

  const membershipRoomId = String(roomId).startsWith('custom_')
    ? String(roomId).slice(7)
    : String(roomId);
  if (!isUuid(membershipRoomId)) return false;

  const res = await supaRequest(
    'GET',
    'room_members?room_id=eq.' +
      encodeURIComponent(membershipRoomId) +
      '&user_id=eq.' +
      encodeURIComponent(userId) +
      '&select=id&limit=1',
    null,
    serviceKey
  );
  return Array.isArray(res.body) && res.body.length > 0;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method Not Allowed');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Unauthorized');

  const user = await verifySupabaseToken(token);
  if (!user || !user.id) return fail(401, 'Invalid or expired session');

  let body;
  try {
    body = JSON.parse(event.body || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Invalid body');
  } catch (e) {
    return fail(400, 'Invalid body');
  }

  try {
    const reason = requireOneOf(
      String(body.reason || '')
        .trim()
        .toLowerCase(),
      ALLOWED_REASONS,
      'Reason'
    );
    const details = body.details ? cleanText(body.details, 1000) : '';
    const messageId = body.messageId && isUuid(body.messageId) ? body.messageId : null;
    let roomId = body.roomId ? cleanText(body.roomId, 128) : '';
    let reportedUserId =
      body.reportedUserId && isUuid(body.reportedUserId) ? body.reportedUserId : null;

    if (!messageId && !roomId && !reportedUserId) {
      return fail(400, 'A message, room, or reported user is required');
    }

    if (messageId) {
      const msgRes = await supaRequest(
        'GET',
        'messages?id=eq.' + encodeURIComponent(messageId) + '&select=id,user_id,room_id&limit=1',
        null,
        serviceKey
      );
      const msg = Array.isArray(msgRes.body) ? msgRes.body[0] : null;
      if (!msg || !msg.id) return fail(404, 'Message not found');
      roomId = msg.room_id || roomId;
      reportedUserId = msg.user_id || reportedUserId;
    }

    if (reportedUserId === user.id) return fail(400, 'You cannot report yourself');

    if (roomId) {
      const allowed = await canAccessRoom(user.id, roomId, serviceKey);
      if (!allowed) return fail(403, 'Not allowed in this room');
    }

    const insertRes = await supaRequest(
      'POST',
      'chat_reports',
      {
        reporter_id: user.id,
        reported_user_id: reportedUserId,
        message_id: messageId,
        room_id: roomId || null,
        reason,
        details: details || null,
        status: 'open',
        created_at: new Date().toISOString()
      },
      serviceKey,
      { Prefer: 'return=minimal' }
    );
    if (insertRes.status < 200 || insertRes.status >= 300)
      return fail(500, 'Could not submit report');

    await logSecurityEvent(serviceKey, user.id, 'chat_report_submitted', {
      reason,
      message_id: messageId,
      room_id: roomId || null,
      reported_user_id: reportedUserId || null
    });

    return jsonResponse(200, { ok: true });
  } catch (e) {
    return fail(400, e.message);
  }
};
