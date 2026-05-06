const { requireEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { stripeGet } = require('../lib/stripe');
const { supaRequest } = require('../lib/supabase-admin');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method Not Allowed');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Unauthorized');

  const callerUser = await verifySupabaseToken(token);
  if (!callerUser || !callerUser.id) return fail(401, 'Unauthorized');

  let sessionId;
  try {
    sessionId = JSON.parse(event.body || '{}').sessionId;
  } catch (e) {
    return fail(400, 'Invalid body');
  }
  if (!sessionId) return fail(400, 'Missing sessionId');

  try {
    const result = await stripeGet('/v1/checkout/sessions/' + sessionId);
    const session = result.body;

    if (session.error) return fail(400, session.error.message);

    const metaUserId = session.metadata && session.metadata.user_id;
    if (!metaUserId || metaUserId !== callerUser.id)
      return fail(403, 'Session does not belong to this user');

    const validStatuses = ['complete', 'paid'];
    const paymentOk =
      validStatuses.includes(session.status) ||
      session.payment_status === 'paid' ||
      session.payment_status === 'no_payment_required';
    if (!paymentOk) return fail(400, 'Payment not completed');

    const userId = callerUser.id;
    const expires = new Date(Date.now() + 37 * 24 * 60 * 60 * 1000).toISOString();
    await supaRequest(
      'POST',
      'subscriptions?on_conflict=user_id',
      {
        id: userId,
        user_id: userId,
        plan: 'pro',
        status: 'active',
        stripe_subscription_id: session.subscription || null,
        stripe_customer_id: session.customer || null,
        expires_at: expires,
        had_trial: true,
        updated_at: new Date().toISOString()
      },
      serviceKey,
      { Prefer: 'resolution=merge-duplicates,return=minimal' }
    );

    return jsonResponse(200, { ok: true });
  } catch (e) {
    return fail(500, e.message);
  }
};
