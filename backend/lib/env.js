function requireEnv(name) {
  var value = process.env[name];
  if (!value) throw new Error('Missing required environment variable: ' + name);
  return value;
}

function optionalEnv(name, defaultValue) {
  return process.env[name] || defaultValue || '';
}

module.exports = { requireEnv, optionalEnv };
