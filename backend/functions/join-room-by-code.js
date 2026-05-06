const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { supaRequest } = require('../lib/supabase-admin');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { requireEnv } = require('../lib/env');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method Not Allowed');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Unauthorized');

  const user = await verifySupabaseToken(token);
  if (!user) return fail(401, 'Invalid or expired session');

  let inviteCode;
  try {
    inviteCode = String(JSON.parse(event.body || '{}').code || '').trim();
  } catch (e) {
    return fail(400, 'Invalid body');
  }
  if (!inviteCode || inviteCode.length > 128) return fail(400, 'Invalid invite code');

  try {
    const roomRes = await supaRequest(
      'GET',
      'custom_rooms?invite_code=eq.' +
        encodeURIComponent(inviteCode) +
        '&select=id,name,visibility&limit=1',
      null,
      serviceKey
    );
    if (roomRes.status < 200 || roomRes.status >= 300)
      return fail(500, 'Could not look up invite code');

    const room = Array.isArray(roomRes.body) ? roomRes.body[0] : null;
    if (!room || !room.id) return fail(404, 'Invalid invite code');

    const memberPath =
      'room_members?room_id=eq.' +
      encodeURIComponent(room.id) +
      '&user_id=eq.' +
      encodeURIComponent(user.id) +
      '&select=id&limit=1';
    const existingRes = await supaRequest('GET', memberPath, null, serviceKey);

    if (!Array.isArray(existingRes.body) || !existingRes.body[0]) {
      const insertRes = await supaRequest(
        'POST',
        'room_members',
        {
          room_id: room.id,
          user_id: user.id
        },
        serviceKey
      );
      if (insertRes.status < 200 || insertRes.status >= 300)
        return fail(500, 'Could not join room');
    }

    return jsonResponse(200, {
      ok: true,
      room: { id: room.id, name: room.name || 'Room', visibility: room.visibility || null }
    });
  } catch (e) {
    return fail(500, e.message);
  }
};
