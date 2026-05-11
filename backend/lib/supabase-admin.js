// Supabase REST API helper using the service-role key.
// Reads SUPABASE_URL from env at call time so this module is safe to require at load time.

const https = require('https');
const { requireEnv } = require('./env');

function supaRequest(method, path, body, serviceKey, extraHeaders) {
  return new Promise(function (resolve, reject) {
    const supaUrl = requireEnv('SUPABASE_URL');
    const bodyStr = body ? JSON.stringify(body) : '';
    const url = new URL(supaUrl);
    const req = https.request(
      {
        hostname: url.hostname,
        path: '/rest/v1/' + path,
        method,
        headers: Object.assign(
          {
            apikey: serviceKey,
            Authorization: 'Bearer ' + serviceKey,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          extraHeaders || {},
          bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}
        )
      },
      function (res) {
        let data = '';
        res.on('data', function (c) {
          data += c;
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
    req.setTimeout(12000, function () { req.destroy(new Error('Supabase REST request timed out')); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Supabase Auth Admin API (e.g. /auth/v1/admin/users)
function supaAuthAdminRequest(method, path, serviceKey) {
  return new Promise(function (resolve, reject) {
    const supaUrl = requireEnv('SUPABASE_URL');
    const req = https.request(
      {
        hostname: new URL(supaUrl).hostname,
        path: '/auth/v1/admin/' + path,
        method,
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey
        }
      },
      function (res) {
        let data = '';
        res.on('data', function (c) {
          data += c;
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
    req.setTimeout(12000, function () { req.destroy(new Error('Supabase Auth request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Fetches the user's subscription and returns it only if it is genuinely active
 * (status = 'active' AND expires_at is either null or in the future).
 * Returns null if the user has no subscription or if it has expired.
 */
async function getActiveSubscription(serviceKey, userId) {
  const result = await supaRequest(
    'GET',
    'subscriptions?user_id=eq.' + encodeURIComponent(userId) +
    '&select=plan,status,expires_at&limit=1',
    null,
    serviceKey
  );
  const sub = Array.isArray(result.body) && result.body[0];
  if (!sub) return null;
  if (sub.status !== 'active') return null;
  if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
    // Subscription has expired — mark it cancelled so future reads are consistent
    supaRequest(
      'PATCH',
      'subscriptions?user_id=eq.' + encodeURIComponent(userId),
      { status: 'expired', updated_at: new Date().toISOString() },
      serviceKey,
      { Prefer: 'return=minimal' }
    ).catch(function (e) { console.error('[supabase-admin] subscription expiry patch error:', e.message); });
    return null;
  }
  return sub;
}

module.exports = { supaRequest, supaAuthAdminRequest, getActiveSubscription };
