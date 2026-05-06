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
    req.on('error', reject);
    req.end();
  });
}

module.exports = { supaRequest, supaAuthAdminRequest };
