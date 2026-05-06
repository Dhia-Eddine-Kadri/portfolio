const { optionalEnv } = require('./env');

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': optionalEnv('ALLOWED_ORIGIN', '*'),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

module.exports = { getCorsHeaders };
