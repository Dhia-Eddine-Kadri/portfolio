const { requireEnv } = require('../lib/env');
const { jsonResponse, fail, handleOptions } = require('../lib/responses');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'GET') return fail(405, 'Method Not Allowed');

  const paypalPlanId = requireEnv('PAYPAL_PLAN_ID');
  return jsonResponse(200, { paypalPlanId });
};
