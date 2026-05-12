// Shared helper: forward a request to the Python AI service.
//
// Used by ai-ask.js, ai-generate.js, notes-generate.js so each handler can
// flag-gate at the top:
//
//   if (shouldUsePythonAI()) {
//     const r = await forwardToPython('ask', { userId, courseId, ... });
//     if (r.ok) return jsonResponse(r.status, r.body);
//     // r.ok=false → fall through to existing JS implementation
//   }
//
// The browser → Netlify → Python chain always has Netlify verify the
// Supabase JWT first; this helper just signs the upstream request with
// INTERNAL_SECRET so the Python service knows it came from us.

const https = require('https');
const { URL } = require('url');

const { optionalEnv } = require('./env');

const _UPSTREAM_TIMEOUT_MS = 26000;

function shouldUsePythonAI() {
  const flag = (optionalEnv('USE_PYTHON_AI', 'false') || '').toLowerCase();
  if (flag !== 'true' && flag !== '1' && flag !== 'yes') return false;
  if (!optionalEnv('AI_SERVICE_URL', '')) return false;
  if (!optionalEnv('INTERNAL_SECRET', '')) return false;
  return true;
}

// Returns { ok, status, body } where body is a parsed JS value if upstream
// returned JSON, otherwise { raw: <string> }. `ok` is true only on 2xx.
function forwardToPython(endpoint, payload) {
  return new Promise(function (resolve) {
    const serviceUrl = optionalEnv('AI_SERVICE_URL', '');
    const internalToken = optionalEnv('INTERNAL_SECRET', '');
    if (!serviceUrl || !internalToken) {
      return resolve({ ok: false, status: 503, body: { error: 'AI service not configured' } });
    }
    let target;
    try {
      target = new URL(serviceUrl.replace(/\/$/, '') + '/' + endpoint);
    } catch (e) {
      return resolve({ ok: false, status: 500, body: { error: 'Invalid AI_SERVICE_URL' } });
    }
    const body = JSON.stringify(payload || {});
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
          'X-Internal-Token': internalToken,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'application/json'
        }
      },
      function (res) {
        let buf = '';
        res.on('data', function (c) { buf += c; });
        res.on('end', function () {
          let parsed;
          try { parsed = JSON.parse(buf); } catch (e) { parsed = { raw: buf }; }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode || 502,
            body: parsed
          });
        });
      }
    );
    req.setTimeout(_UPSTREAM_TIMEOUT_MS, function () {
      req.destroy(new Error('Python AI service timed out'));
    });
    req.on('error', function (err) {
      resolve({
        ok: false,
        status: 502,
        body: { error: 'Upstream error: ' + (err && err.message ? err.message : String(err)) }
      });
    });
    req.write(body);
    req.end();
  });
}

module.exports = { shouldUsePythonAI, forwardToPython };
