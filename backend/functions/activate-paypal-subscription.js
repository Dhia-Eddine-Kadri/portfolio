const https = require('https');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { supaRequest } = require('../lib/supabase-admin');
const { verifySupabaseToken, extractBearerToken } = require('../lib/supabase-auth');
const { logSecurityEvent } = require('../lib/logger');
const { requireEnv } = require('../lib/env');

const { optionalEnv } = require('../lib/env');
const PAYPAL_API_BASE = optionalEnv('PAYPAL_API_BASE', 'https://api-m.paypal.com');
const PAYPAL_PLAN_ID = optionalEnv('PAYPAL_PLAN_ID', '');

function paypalRequest(method, urlString, headers, body) {
  return new Promise(function (resolve, reject) {
    const url = new URL(urlString);
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: Object.assign(
          {},
          headers || {},
          bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}
        )
      },
      function (res) {
        let data = '';
        res.on('data', function (chunk) {
          data += chunk;
        });
        res.on('end', function () {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getPaypalToken() {
  const clientId = requireEnv('PAYPAL_CLIENT_ID');
  const secret = requireEnv('PAYPAL_CLIENT_SECRET');
  const res = await paypalRequest(
    'POST',
    PAYPAL_API_BASE + '/v1/oauth2/token',
    {
      Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    'grant_type=client_credentials'
  );
  if (res.status < 200 || res.status >= 300 || !res.body || !res.body.access_token) {
    throw new Error('Could not verify PayPal credentials');
  }
  return res.body.access_token;
}

async function getPaypalSubscription(subscriptionId, accessToken) {
  const res = await paypalRequest(
    'GET',
    PAYPAL_API_BASE + '/v1/billing/subscriptions/' + encodeURIComponent(subscriptionId),
    {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    }
  );
  if (res.status < 200 || res.status >= 300 || !res.body || res.body.id !== subscriptionId) {
    throw new Error('PayPal subscription could not be verified');
  }
  return res.body;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') return fail(405, 'Method Not Allowed');

  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Unauthorized');

  let body;
  try {
    body = JSON.parse(event.body || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Invalid body');
  } catch (e) {
    return fail(400, 'Invalid body');
  }

  const subscriptionId = body.subscriptionID || body.subscriptionId;
  if (!subscriptionId || typeof subscriptionId !== 'string')
    return fail(400, 'Missing PayPal subscription ID');

  try {
    const user = await verifySupabaseToken(token);
    if (!user) return fail(401, 'Unauthorized');

    const paypalToken = await getPaypalToken();
    const subscription = await getPaypalSubscription(subscriptionId, paypalToken);
    const status = String(subscription.status || '').toUpperCase();

    if (PAYPAL_PLAN_ID && subscription.plan_id && subscription.plan_id !== PAYPAL_PLAN_ID) {
      await logSecurityEvent(serviceKey, user.id, 'paypal_subscription_plan_mismatch', {
        subscription_id: subscriptionId,
        plan_id: subscription.plan_id
      });
      return fail(403, 'Subscription plan mismatch');
    }

    if (subscription.custom_id && subscription.custom_id !== user.id) {
      await logSecurityEvent(serviceKey, user.id, 'paypal_subscription_user_mismatch', {
        subscription_id: subscriptionId,
        custom_id: subscription.custom_id
      });
      return fail(403, 'Subscription does not belong to this user');
    }

    if (!['ACTIVE', 'APPROVAL_PENDING'].includes(status))
      return fail(400, 'Subscription is not active');

    const expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    const writeRes = await supaRequest(
      'POST',
      'subscriptions?on_conflict=user_id',
      {
        id: user.id,
        user_id: user.id,
        plan: 'pro',
        status: 'active',
        paypal_subscription_id: subscriptionId,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      },
      serviceKey,
      { Prefer: 'resolution=merge-duplicates,return=minimal' }
    );

    if (writeRes.status < 200 || writeRes.status >= 300)
      throw new Error('Could not activate subscription');

    await logSecurityEvent(serviceKey, user.id, 'paypal_subscription_activated', {
      subscription_id: subscriptionId,
      paypal_status: status
    });

    return jsonResponse(200, { ok: true, plan: 'pro', status: 'active' });
  } catch (e) {
    return fail(500, e.message);
  }
};
