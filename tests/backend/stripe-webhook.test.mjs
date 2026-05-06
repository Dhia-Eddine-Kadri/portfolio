import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);

function setEnv() {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'fake-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
}

setEnv();
const { handler } = require('../../backend/functions/stripe-webhook.js');

test('stripe-webhook: rejects non-POST with 405', async () => {
  const res = await handler({ httpMethod: 'GET', headers: {}, body: '' });
  assert.equal(res.statusCode, 405);
});

test('stripe-webhook: rejects missing signature with 400', async () => {
  setEnv();
  const res = await handler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ type: 'test' })
  });
  assert.equal(res.statusCode, 400);
});

test('stripe-webhook: rejects invalid signature with 400', async () => {
  setEnv();
  const res = await handler({
    httpMethod: 'POST',
    headers: { 'stripe-signature': 't=123,v1=badsig' },
    body: JSON.stringify({ type: 'test' })
  });
  assert.equal(res.statusCode, 400);
});

test('stripe-webhook: accepts valid HMAC signature', async () => {
  setEnv();
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ type: 'payment_intent.created', data: { object: {} } });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signed = timestamp + '.' + payload;
  const sig = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  const sigHeader = `t=${timestamp},v1=${sig}`;

  const res = await handler({
    httpMethod: 'POST',
    headers: { 'stripe-signature': sigHeader },
    body: payload
  });
  // Not 400 (signature accepted); may be 200 or other depending on event type handling
  assert.notEqual(res.statusCode, 400);
});
