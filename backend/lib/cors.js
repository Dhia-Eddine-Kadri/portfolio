const { optionalEnv } = require('./env');

// In production ALLOWED_ORIGIN must be set in Netlify env vars.
// In local dev (netlify dev / unit tests) it falls back to localhost.
// Never falls back to '*' which would allow any origin.
var _origin = optionalEnv('ALLOWED_ORIGIN', '') || 'http://localhost:8888';

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': _origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, PATCH, DELETE, OPTIONS'
  };
}

module.exports = { getCorsHeaders };
