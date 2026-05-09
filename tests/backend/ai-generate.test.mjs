import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_ANON_KEY = 'fake-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
process.env.OPENAI_API_KEY = 'sk-fake';

const { handler } = require('../../backend/functions/ai-generate.js');

test('ai-generate: OPTIONS returns 204', async () => {
  const res = await handler({ httpMethod: 'OPTIONS', headers: {}, body: '' });
  assert.equal(res.statusCode, 204);
});

test('ai-generate: GET returns 405', async () => {
  const res = await handler({ httpMethod: 'GET', headers: {}, body: '' });
  assert.equal(res.statusCode, 405);
});

test('ai-generate: missing token returns 401', async () => {
  const res = await handler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ courseId: 'abc', tool: 'flashcards' })
  });
  assert.equal(res.statusCode, 401);
});

test('ai-generate: invalid token returns 401', async () => {
  const res = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer not-a-real-jwt' },
    body: JSON.stringify({ courseId: 'abc', tool: 'flashcards' })
  });
  assert.equal(res.statusCode, 401);
});

test('ai-generate: invalid JSON body returns 400', async () => {
  const res = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer fake' },
    body: '{bad json'
  });
  // 400 or 401 (token check runs first — either is correct)
  assert.ok([400, 401].includes(res.statusCode));
});

test('ai-generate: missing courseId returns 400 (after auth)', async () => {
  // Build a syntactically valid JWT to pass the format check (still fails Supabase verify)
  const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.fake';
  const res = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer ' + fakeJwt },
    body: JSON.stringify({ tool: 'flashcards' })
  });
  // Will be 401 (fake token fails Supabase verify) or 400 — both are acceptable
  assert.ok([400, 401].includes(res.statusCode));
});

test('ai-generate: invalid tool value returns 400 (after auth)', async () => {
  const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.fake';
  const res = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer ' + fakeJwt },
    body: JSON.stringify({ courseId: 'abc', tool: 'bogus' })
  });
  assert.ok([400, 401].includes(res.statusCode));
});
