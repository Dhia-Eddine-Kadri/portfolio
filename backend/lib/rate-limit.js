const { supaRequest } = require('./supabase-admin');
const { getCorsHeaders } = require('./cors');

// Counts recent security_events for a user within a rolling window.
async function countRecentEvents(serviceKey, userId, eventType, windowMs) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const path =
    'security_events?user_id=eq.' +
    encodeURIComponent(userId) +
    '&event_type=eq.' +
    encodeURIComponent(eventType) +
    '&created_at=gte.' +
    encodeURIComponent(since) +
    '&select=id';
  const res = await supaRequest('GET', path, null, serviceKey);
  return Array.isArray(res.body) ? res.body.length : 0;
}

// Counts recent messages for a user within a rolling window (chat rate limit).
async function countRecentMessages(serviceKey, userId, windowMs) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const path =
    'messages?user_id=eq.' +
    encodeURIComponent(userId) +
    '&created_at=gte.' +
    encodeURIComponent(since) +
    '&select=id';
  const res = await supaRequest('GET', path, null, serviceKey);
  return Array.isArray(res.body) ? res.body.length : 0;
}

// Returns a 429 response with Retry-After header.
function rateLimitResponse(windowMs, message) {
  return {
    statusCode: 429,
    headers: Object.assign(getCorsHeaders(), {
      'Retry-After': String(Math.ceil(windowMs / 1000))
    }),
    body: JSON.stringify({ error: { message: message || 'Rate limit exceeded. Try again soon.' } })
  };
}

module.exports = { countRecentEvents, countRecentMessages, rateLimitResponse };
