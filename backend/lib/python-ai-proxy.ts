// Shared helper: forward a request to the Python AI service.
//
// Python is now the only AI implementation — the legacy JS pipelines have
// been removed. Every AI/document handler is a thin auth+forward shell
// over this helper. Auth happens in the Netlify function (Supabase JWT);
// this helper just signs the upstream request with INTERNAL_SECRET so the
// Python service knows the call came through Netlify.

import https from 'https';
import { optionalEnv } from './env';
import type { PythonProxyResult } from './types';

const _UPSTREAM_TIMEOUT_MS = parseInt(optionalEnv('AI_UPSTREAM_TIMEOUT_MS', '26000'), 10);

function _config(): { serviceUrl: string; internalToken: string } {
  return {
    serviceUrl: optionalEnv('AI_SERVICE_URL', ''),
    internalToken: optionalEnv('INTERNAL_SECRET', '')
  };
}

/** True if the Python service is wired up. If false, the handler should
 *  surface a 503 — there is no JS fallback anymore. */
export function pythonAiConfigured(): boolean {
  const { serviceUrl, internalToken } = _config();
  return Boolean(serviceUrl && internalToken);
}

/** Forwards `payload` to `<AI_SERVICE_URL>/<endpoint>`. `body` is the
 *  parsed JSON response when available, else `{ raw }`. `ok` is true only on 2xx. */
export function forwardToPython<T = unknown>(
  endpoint: string,
  payload: unknown
): Promise<PythonProxyResult<T>> {
  return new Promise<PythonProxyResult<T>>(function (resolve) {
    const { serviceUrl, internalToken } = _config();
    if (!serviceUrl || !internalToken) {
      return resolve({ ok: false, status: 503, body: { error: 'AI service not configured' } });
    }
    let target: URL;
    try {
      target = new URL(serviceUrl.replace(/\/$/, '') + '/' + endpoint);
    } catch {
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
          'Content-Length': String(Buffer.byteLength(body)),
          Accept: 'application/json'
        }
      },
      function (res) {
        let buf = '';
        res.on('data', function (c) { buf += c; });
        res.on('end', function () {
          let parsed: T | { raw: string };
          try { parsed = JSON.parse(buf) as T; } catch { parsed = { raw: buf }; }
          const status = res.statusCode ?? 502;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: parsed
          });
        });
      }
    );
    req.setTimeout(_UPSTREAM_TIMEOUT_MS, function () {
      req.destroy(new Error('Python AI service timed out'));
    });
    req.on('error', function () {
      resolve({ ok: false, status: 502, body: { error: 'Upstream AI service error' } });
    });
    req.write(body);
    req.end();
  });
}
