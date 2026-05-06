// Security event logger. Writes to the security_events table via service-role key.
// Fails silently — logging must never break the main request flow.

const { supaRequest } = require('./supabase-admin');

async function logSecurityEvent(serviceKey, userId, eventType, metadata) {
  try {
    await supaRequest(
      'POST',
      'security_events',
      {
        user_id: userId || null,
        event_type: eventType,
        metadata: metadata || {},
        created_at: new Date().toISOString()
      },
      serviceKey,
      { Prefer: 'return=minimal' }
    );
  } catch (e) {}
}

module.exports = { logSecurityEvent };
