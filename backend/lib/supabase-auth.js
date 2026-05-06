// Verifies a Supabase user JWT against the Supabase Auth API.
// Returns the user object on success, or null on failure.

const https = require('https');
const { requireEnv } = require('./env');

function verifySupabaseToken(token) {
  return new Promise(function (resolve) {
    const supaUrl = requireEnv('SUPABASE_URL');
    const anonKey = requireEnv('SUPABASE_ANON_KEY');
    const req = https.request(
      {
        hostname: new URL(supaUrl).hostname,
        path: '/auth/v1/user',
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
          apikey: anonKey
        }
      },
      function (res) {
        let data = '';
        res.on('data', function (c) {
          data += c;
        });
        res.on('end', function () {
          try {
            const user = JSON.parse(data);
            resolve(res.statusCode === 200 && user && user.id ? user : null);
          } catch (e) {
            resolve(null);
          }
        });
      }
    );
    req.on('error', function () {
      resolve(null);
    });
    req.end();
  });
}

// Extract Bearer token from Authorization header. Returns null if missing.
function extractBearerToken(headers) {
  const authHeader = (headers && (headers['authorization'] || headers['Authorization'])) || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

module.exports = { verifySupabaseToken, extractBearerToken };
