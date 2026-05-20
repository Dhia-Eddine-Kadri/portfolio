import https from 'https';
import { requireEnv, optionalEnv } from './env';

const PAYPAL_API_BASE = optionalEnv('PAYPAL_API_BASE', 'https://api-m.paypal.com');

interface OauthTokenResponse {
  access_token?: string;
}

export function paypalRequest<T>(
  method: string,
  path: string,
  accessToken: string,
  body?: string | object
): Promise<{ status: number; body: T | null }> {
  return new Promise((resolve, reject) => {
    const url = new URL(PAYPAL_API_BASE + path);
    const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': String(Buffer.byteLength(bodyStr)) } : {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: data ? (JSON.parse(data) as T) : null });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data as unknown as T });
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export function paypalOauthToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const clientId = requireEnv('PAYPAL_CLIENT_ID');
    const secret = requireEnv('PAYPAL_CLIENT_SECRET');
    const bodyStr = 'grant_type=client_credentials';
    const url = new URL(PAYPAL_API_BASE + '/v1/oauth2/token');
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(Buffer.byteLength(bodyStr))
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const parsed = data ? (JSON.parse(data) as OauthTokenResponse) : {};
            if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300 && parsed.access_token) {
              resolve(parsed.access_token);
              return;
            }
          } catch { /* handled below */ }
          reject(new Error('paypal oauth failed'));
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

