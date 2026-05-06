const crypto = require('crypto');
const { requireEnv } = require('../lib/env');
const { supaRequest } = require('../lib/supabase-admin');

function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = sigHeader.split(',').reduce(function (acc, p) {
    const [k, v] = p.split('=');
    acc[k] = v;
    return acc;
  }, {});
  const signed = parts.t + '.' + payload;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(parts.v1 || ''), Buffer.from(expected));
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const sig = event.headers['stripe-signature'];
  try {
    if (!verifyStripeSignature(event.body, sig, webhookSecret))
      return { statusCode: 400, body: 'Invalid signature' };
  } catch (e) {
    return { statusCode: 400, body: 'Signature error' };
  }

  let evt;
  try {
    evt = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Bad JSON' };
  }

  const prefer = { Prefer: 'resolution=merge-duplicates,return=minimal' };

  if (evt.type === 'checkout.session.completed') {
    const session = evt.data.object;
    const userId = session.metadata?.user_id;
    if (userId) {
      await supaRequest(
        'POST',
        'subscriptions?on_conflict=user_id',
        {
          user_id: userId,
          plan: 'pro',
          status: 'active',
          stripe_subscription_id: session.subscription || null,
          stripe_customer_id: session.customer || null,
          expires_at: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        },
        serviceKey,
        prefer
      );
    }
  }

  if (evt.type === 'customer.subscription.deleted') {
    const cusId = evt.data.object.customer;
    if (cusId) {
      await supaRequest(
        'PATCH',
        'subscriptions?stripe_customer_id=eq.' + encodeURIComponent(cusId),
        {
          status: 'cancelled',
          updated_at: new Date().toISOString()
        },
        serviceKey,
        prefer
      );
    }
  }

  if (evt.type === 'customer.subscription.updated') {
    const sub = evt.data.object;
    const cusId = sub.customer;
    if (cusId) {
      const isActive = sub.status === 'active' || sub.status === 'trialing';
      const patch = {
        status: isActive ? 'active' : sub.status,
        stripe_subscription_id: sub.id || null,
        updated_at: new Date().toISOString()
      };
      if (sub.current_period_end)
        patch.expires_at = new Date(sub.current_period_end * 1000).toISOString();
      await supaRequest(
        'PATCH',
        'subscriptions?stripe_customer_id=eq.' + encodeURIComponent(cusId),
        patch,
        serviceKey,
        prefer
      );
    }
  }

  if (evt.type === 'invoice.payment_failed') {
    const cusId = evt.data.object.customer;
    if (cusId) {
      await supaRequest(
        'PATCH',
        'subscriptions?stripe_customer_id=eq.' + encodeURIComponent(cusId),
        {
          status: 'past_due',
          updated_at: new Date().toISOString()
        },
        serviceKey,
        prefer
      );
    }
  }

  return { statusCode: 200, body: 'ok' };
};
