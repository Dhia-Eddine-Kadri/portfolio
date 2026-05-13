// Shared helper: forward a request to the Python AI service.
//
// Python is now the only AI implementation — the legacy JS pipelines have
// been removed. Every AI/document handler is a thin auth+forward shell
// over this helper. Auth happens in the Netlify function (Supabase JWT);
// this helper just signs the upstream request with INTERNAL_SECRET so the
// Python service knows the call came through Netlify.

const https = require('https');
const { URL } = require('url');

const { optionalEnv } = require('./env');

const _UPSTREAM_TIMEOUT_MS = 26000;

function _config() {
  return {
    serviceUrl: optionalEnv('AI_SERVICE_URL', ''),
    internalToken: optionalEnv('INTERNAL_SECRET', '')
  };
}

// True if the Python service is wired up. If false, the handler should
// surface a 503 — there is no JS fallback anymore.
function pythonAiConfigured() {
  const { serviceUrl, internalToken } = _config();
  return Boolean(serviceUrl && internalToken);
}

// Returns { ok, status, body } where body is a parsed JS value if upstream
// returned JSON, otherwise { raw: <string> }. `ok` is true only on 2xx.
function forwardToPython(endpoint, payload) {
  return new Promise(function (resolve) {
    const { serviceUrl, internalToken } = _config();
    if (!serviceUrl || !internalToken) {
      return resolve({
        ok: false,
        status: 503,
        body: { error: 'AI service not configured' }
      });
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

module.exports = { pythonAiConfigured, forwardToPython };
