function _authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + (window._sbToken || '')
  };
}

export async function createCheckoutSession(noTrial) {
  var res = await fetch('/api/create-checkout', {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify({ noTrial: !!noTrial })
  });
  return res.json().catch(function () {
    return {};
  });
}

export async function createPortalSession() {
  var res = await fetch('/api/create-portal', {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify({})
  });
  return res.json().catch(function () {
    return {};
  });
}

export async function verifyPayment(sessionId) {
  var res = await fetch('/api/verify-payment', {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify({ sessionId: sessionId })
  });
  return res.json().catch(function () {
    return {};
  });
}

export async function activatePayPalSubscription(subscriptionID) {
  var res = await fetch('/api/activate-paypal-subscription', {
    method: 'POST',
    headers: _authHeaders(),
    body: JSON.stringify({ subscriptionID: subscriptionID })
  });
  var payload = await res.json().catch(function () {
    return {};
  });
  if (!res.ok) throw new Error(payload.error || 'Activation failed');
  return payload;
}

export async function loadBillingConfig() {
  var res = await fetch('/api/public-billing-config');
  var payload = await res.json().catch(function () {
    return {};
  });
  if (!res.ok)
    throw new Error((payload.error && payload.error.message) || 'Could not load billing config');
  return payload;
}
