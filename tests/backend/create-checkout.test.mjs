import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_ANON_KEY = 'fake-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_PRICE_ID = 'price_fake';
process.env.ALLOWED_ORIGIN = 'https://example.com';

const { handler } = require('../../backend/functions/create-checkout.js');

test('create-checkout: OPTIONS returns 200', async () => {
  const res = await handler({ httpMethod: 'OPTIONS', headers: {}, body: '' });
  assert.equal(res.statusCode, 204);
});

test('create-checkout: rejects non-POST with 405', async () => {
  const res = await handler({ httpMethod: 'GET', headers: {}, body: '' });
  assert.equal(res.statusCode, 405);
});

test('create-checkout: rejects missing token with 401', async () => {
  const res = await handler({ httpMethod: 'POST', headers: {}, body: '{}' });
  assert.equal(res.statusCode, 401);
});

test('create-checkout: rejects bad token with 401', async () => {
  const res = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer not-a-real-token' },
    body: '{}'
  });
  assert.equal(res.statusCode, 401);
});
