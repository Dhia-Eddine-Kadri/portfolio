const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { stripePost } = require('../lib/stripe');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { supaRequest } = require('../lib/supabase-admin');
const { requireEnv } = require('../lib/env');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method Not Allowed');

  requireEnv('STRIPE_SECRET_KEY');
  const allowedOrigin = requireEnv('ALLOWED_ORIGIN');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Unauthorized');

  const user = await verifySupabaseToken(token);
  if (!user || !user.id) return fail(401, 'Invalid or expired session');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const profileRes = await supaRequest(
    'GET',
    'profiles?id=eq.' + encodeURIComponent(user.id) + '&select=stripe_customer_id',
    null,
    serviceKey,
    { Accept: 'application/json' }
  );
  const profile = Array.isArray(profileRes.body) ? profileRes.body[0] : null;
  const customerId = profile && profile.stripe_customer_id;
  if (!customerId) return fail(400, 'No Stripe account found for this user');

  try {
    const params = new URLSearchParams();
    params.append('customer', customerId);
    params.append('return_url', allowedOrigin + '?section=subscription');

    const result = await stripePost('/v1/billing_portal/sessions', params);
    if (result.status !== 200)
      return fail(result.status, result.body.error?.message || 'Stripe error');
    return jsonResponse(200, { url: result.body.url });
  } catch (e) {
    return fail(500, e.message);
  }
};
