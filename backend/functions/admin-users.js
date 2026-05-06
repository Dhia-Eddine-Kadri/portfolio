const { requireEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { supaRequest, supaAuthAdminRequest } = require('../lib/supabase-admin');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { logSecurityEvent } = require('../lib/logger');
const { isUuid } = require('../lib/validation');

async function checkAdmin(user, serviceKey) {
  const adminRes = await supaRequest(
    'GET',
    'admins?user_id=eq.' + encodeURIComponent(user.id) + '&select=user_id&limit=1',
    null,
    serviceKey
  );
  const rows = Array.isArray(adminRes.body) ? adminRes.body : [];
  if (rows[0] && rows[0].user_id === user.id) return { ok: true, method: 'admins_table' };
  return { ok: false, method: 'none' };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method Not Allowed');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  let action, query, userId, plan, reportId, status, resolutionNote;
  try {
    const b = JSON.parse(event.body || '{}');
    if (!b || typeof b !== 'object' || Array.isArray(b)) return fail(400, 'Invalid body');
    action = b.action;
    query = String(b.query || '').trim();
    userId = b.userId;
    plan = b.plan;
    reportId = b.reportId;
    status = b.status;
    resolutionNote = typeof b.resolutionNote === 'string' ? b.resolutionNote.trim() : '';
  } catch (e) {
    return fail(400, 'Invalid body');
  }

  const callerToken = extractBearerToken(event.headers);
  if (!callerToken) return fail(401, 'Unauthorized');

  const callerUser = await verifySupabaseToken(callerToken);
  if (!callerUser || !callerUser.id) return fail(401, 'Invalid or expired session');

  if (action === 'deleteself') {
    const delRes = await supaAuthAdminRequest('DELETE', 'users/' + callerUser.id, serviceKey);
    await logSecurityEvent(serviceKey, callerUser.id, 'account_deleted_self', {
      status: delRes.status
    });
    if (delRes.status >= 200 && delRes.status < 300) return jsonResponse(200, { ok: true });
    return fail(500, 'Delete failed');
  }

  if (!['status', 'search', 'setplan', 'reports', 'resolvereport'].includes(action)) {
    return fail(400, 'Unknown action');
  }

  const adminCheck = await checkAdmin(callerUser, serviceKey);
  if (!adminCheck.ok) {
    await logSecurityEvent(serviceKey, callerUser.id, 'admin_access_denied', {
      action: action || null
    });
    return fail(403, 'Unauthorized');
  }

  if (action === 'status') {
    return jsonResponse(200, { ok: true, isAdmin: true, method: adminCheck.method });
  }

  if (action === 'search') {
    if (query.length < 2) return fail(400, 'Search query must be at least 2 characters');

    const searchRes = await supaAuthAdminRequest('GET', 'users?per_page=50&page=1', serviceKey);
    if (searchRes.status < 200 || searchRes.status >= 300) return fail(500, 'User search failed');

    const lowerQuery = query.toLowerCase();
    const allUsers = (searchRes.body.users || []).filter(function (u) {
      return u.email && u.email.toLowerCase().includes(lowerQuery);
    });

    const results = [];
    for (const u of allUsers.slice(0, 10)) {
      const subRes = await supaRequest(
        'GET',
        'subscriptions?user_id=eq.' + encodeURIComponent(u.id) + '&select=plan,status',
        null,
        serviceKey
      );
      const sub =
        Array.isArray(subRes.body) && subRes.body[0]
          ? subRes.body[0]
          : { plan: 'free', status: 'none' };
      results.push({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        plan: sub.plan,
        status: sub.status
      });
    }

    await logSecurityEvent(serviceKey, callerUser.id, 'admin_user_search', {
      query_length: query.length,
      result_count: results.length,
      auth_method: adminCheck.method
    });

    return jsonResponse(200, results);
  }

  if (action === 'setplan') {
    const allowedPlans = ['free', 'pro'];
    if (!allowedPlans.includes(plan)) return fail(400, 'Invalid plan');
    if (!isUuid(userId)) return fail(400, 'Invalid userId');

    const beforeRes = await supaRequest(
      'GET',
      'subscriptions?user_id=eq.' + encodeURIComponent(userId) + '&select=plan,status&limit=1',
      null,
      serviceKey
    );
    const before = Array.isArray(beforeRes.body) && beforeRes.body[0] ? beforeRes.body[0] : null;
    const newStatus = plan === 'pro' ? 'active' : 'cancelled';

    const upsertRes = await supaRequest(
      'POST',
      'subscriptions?on_conflict=user_id',
      {
        id: userId,
        user_id: userId,
        plan,
        status: newStatus,
        updated_at: new Date().toISOString()
      },
      serviceKey,
      { Prefer: 'resolution=merge-duplicates,return=minimal' }
    );

    if (upsertRes.status < 200 || upsertRes.status >= 300) return fail(500, 'Plan update failed');

    await logSecurityEvent(serviceKey, callerUser.id, 'admin_set_subscription_plan', {
      target_user_id: userId,
      old_plan: before ? before.plan : null,
      old_status: before ? before.status : null,
      new_plan: plan,
      new_status: newStatus,
      auth_method: adminCheck.method
    });

    return jsonResponse(200, { ok: true });
  }

  if (action === 'reports') {
    const allowedStatuses = ['open', 'reviewed', 'dismissed', 'resolved'];
    const reportStatus = status && allowedStatuses.includes(status) ? status : 'open';
    const reportRes = await supaRequest(
      'GET',
      'chat_reports?status=eq.' +
        encodeURIComponent(reportStatus) +
        '&select=id,reporter_id,reported_user_id,message_id,room_id,reason,details,status,created_at,reviewed_by,reviewed_at,resolution_note&order=created_at.desc&limit=50',
      null,
      serviceKey
    );
    if (reportRes.status < 200 || reportRes.status >= 300)
      return fail(500, 'Could not load reports');

    await logSecurityEvent(serviceKey, callerUser.id, 'admin_reports_view', {
      status: reportStatus,
      auth_method: adminCheck.method
    });

    return jsonResponse(200, { reports: Array.isArray(reportRes.body) ? reportRes.body : [] });
  }

  if (action === 'resolvereport') {
    const allowedStatuses = ['reviewed', 'dismissed', 'resolved'];
    if (!isUuid(reportId)) return fail(400, 'Invalid reportId');
    if (!allowedStatuses.includes(status)) return fail(400, 'Invalid report status');
    if (resolutionNote.length > 1000) return fail(400, 'Resolution note is too long');

    const patchRes = await supaRequest(
      'PATCH',
      'chat_reports?id=eq.' + encodeURIComponent(reportId),
      {
        status,
        reviewed_by: callerUser.id,
        reviewed_at: new Date().toISOString(),
        resolution_note: resolutionNote || null
      },
      serviceKey,
      { Prefer: 'return=minimal' }
    );
    if (patchRes.status < 200 || patchRes.status >= 300)
      return fail(500, 'Could not update report');

    await logSecurityEvent(serviceKey, callerUser.id, 'admin_report_resolved', {
      report_id: reportId,
      status,
      auth_method: adminCheck.method
    });

    return jsonResponse(200, { ok: true });
  }
};
