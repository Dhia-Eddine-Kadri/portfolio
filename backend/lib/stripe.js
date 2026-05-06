// Stripe API helpers. Uses STRIPE_SECRET_KEY from env.

const https = require('https');
const { requireEnv } = require('./env');

function stripePost(path, params) {
  return new Promise(function (resolve, reject) {
    const secretKey = requireEnv('STRIPE_SECRET_KEY');
    const bodyStr = params.toString();
    const req = https.request(
      {
        hostname: 'api.stripe.com',
        path,
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(secretKey + ':').toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      },
      function (res) {
        let data = '';
        res.on('data', function (c) {
          data += c;
        });
        res.on('end', function () {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function stripeGet(path) {
  return new Promise(function (resolve, reject) {
    const secretKey = requireEnv('STRIPE_SECRET_KEY');
    const req = https.request(
      {
        hostname: 'api.stripe.com',
        path,
        method: 'GET',
        headers: {
          Authorization: 'Basic ' + Buffer.from(secretKey + ':').toString('base64')
        }
      },
      function (res) {
        let data = '';
        res.on('data', function (c) {
          data += c;
        });
        res.on('end', function () {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

module.exports = { stripePost, stripeGet };
