const { optionalEnv, requireEnv } = require('./env');

// In production ALLOWED_ORIGIN must be set in Netlify env vars.
// In local dev (netlify dev / unit tests) it falls back to localhost.
// Never falls back to '*' which would allow any origin.
function resolveOrigin() {
  const configured = optionalEnv('ALLOWED_ORIGIN', '');
  if (configured) return configured;
  if (optionalEnv('NETLIFY', '') === 'true' || optionalEnv('CONTEXT', '') === 'production') {
    return requireEnv('ALLOWED_ORIGIN');
  }
  return 'http://localhost:8888';
}

function getCorsHeaders() {
  const origin = resolveOrigin();
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, PATCH, DELETE, OPTIONS'
  };
}

module.exports = { getCorsHeaders };
