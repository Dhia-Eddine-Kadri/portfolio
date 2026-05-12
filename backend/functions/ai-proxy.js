// Netlify → Python AI service proxy.
//
// The browser hits /api/ai-proxy/<endpoint> with a Bearer Supabase JWT.
// This function:
//   1. Verifies the JWT (same path as every other auth-protected handler).
//   2. Pulls the trusted user_id from the verified user.
//   3. Forwards the JSON body to $AI_SERVICE_URL/<endpoint>, injecting
//      userId so the Python service never trusts a client-supplied id.
//   4. Signs the upstream request with X-Internal-Token so the Python
//      service rejects anything that didn't come through this proxy.
//   5. Streams the response (status + body) back to the caller verbatim.
//
// The endpoint is feature-gated: it only runs when AI_SERVICE_URL is set.
// If it's missing, we return 503 so the existing JS pipeline can be the
// fallback (the upload flow flips between them with USE_PYTHON_AI).

const https = require('https');
const { URL } = require('url');

const { requireEnv, optionalEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');
const { extractBearerToken, verifySupabaseToken } = require('../lib/supabase-auth');

// Endpoints the proxy is willing to forward. Anything not on this list
// returns 404 so we don't accidentally expose internal Python routes.
const ALLOWED_ENDPOINTS = new Set([
  'index-document',
  'document-index-status',
  // Phase 3+ will extend this list (ask, retrieve-context, generate-quiz, …).
]);

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (!['POST', 'GET'].includes(event.httpMethod)) return fail(405, 'Method not allowed');

  // ── 1. Auth ───────────────────────────────────────────────────────────
  const token = extractBearerToken(event.headers);
  if (!token) return fail(401, 'Missing authorization token');
  const user = await verifySupabaseToken(token);
  if (!user) return fail(401, 'Invalid or expired token');

  // ── 2. Resolve the upstream endpoint from the request path ────────────
  // Netlify path lands as either /.netlify/functions/ai-proxy/<endpoint>
  // or /api/ai-proxy/<endpoint> depending on the redirect setup.
  const rawPath = event.path || '';
  const match = rawPath.match(/(?:ai-proxy)\/([\w-]+)\/?$/);
  const endpoint = match ? match[1] : '';
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return fail(404, 'Unknown AI endpoint');
  }

  // ── 3. Build the upstream payload ─────────────────────────────────────
  const serviceUrl = optionalEnv('AI_SERVICE_URL', '');
  const internalToken = optionalEnv('AI_SERVICE_INTERNAL_TOKEN', '');
  if (!serviceUrl || !internalToken) {
    return fail(503, 'AI service not configured');
  }

  let upstreamBody = null;
  let upstreamQuery = '';

  if (event.httpMethod === 'POST') {
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (e) {
      return fail(400, 'Invalid JSON body');
    }
    // The trusted user_id is the verified one from the JWT — never trust
    // whatever the client put on the wire.
    body.userId = user.id;
    upstreamBody = JSON.stringify(body);
  } else {
    // GET: pass query string verbatim plus an authoritative userId override.
    const params = new URLSearchParams(event.queryStringParameters || {});
    params.set('userId', user.id);
    upstreamQuery = '?' + params.toString();
  }

  // ── 4. Forward ────────────────────────────────────────────────────────
  const target = new URL(serviceUrl.replace(/\/$/, '') + '/' + endpoint + upstreamQuery);
  const headers = {
    'X-Internal-Token': internalToken,
    Accept: 'application/json',
  };
  if (upstreamBody) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(upstreamBody);
  }

  const upstream = await new Promise((resolve) => {
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: event.httpMethod,
        headers,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode || 502, body: buf }));
      }
    );
    req.setTimeout(28000, () => req.destroy(new Error('upstream timed out')));
    req.on('error', (err) => resolve({ status: 502, body: JSON.stringify({ error: String(err && err.message) || 'upstream error' }) }));
    if (upstreamBody) req.write(upstreamBody);
    req.end();
  });

  // ── 5. Mirror the response back ───────────────────────────────────────
  try {
    return jsonResponse(upstream.status, JSON.parse(upstream.body));
  } catch (e) {
    return jsonResponse(upstream.status, { raw: upstream.body });
  }
};
