import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_ANON_KEY = 'fake-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
process.env.OPENAI_API_KEY = 'sk-fake';

const { handler } = require('../../backend/functions/ai.js');

test('ai: OPTIONS returns 200', async () => {
  const res = await handler({ httpMethod: 'OPTIONS', headers: {}, body: '' });
  assert.equal(res.statusCode, 204);
});

test('ai: rejects non-POST with 405', async () => {
  const res = await handler({ httpMethod: 'GET', headers: {}, body: '' });
  assert.equal(res.statusCode, 405);
});

test('ai: rejects missing token with 401', async () => {
  const res = await handler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })
  });
  assert.equal(res.statusCode, 401);
});

test('ai: rejects oversized body with 413', async () => {
  const bigBody = 'x'.repeat(2 * 1024 * 1024 + 1);
  const res = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer fake-token' },
    body: bigBody
  });
  assert.equal(res.statusCode, 413);
});

test('ai: rejects invalid token with 401', async () => {
  const res = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer not-a-real-jwt' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })
  });
  assert.equal(res.statusCode, 401);
});
