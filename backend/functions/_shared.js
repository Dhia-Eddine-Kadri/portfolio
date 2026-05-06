function requireEnv(name) {
  var value = process.env[name];
  if (!value) throw new Error('Missing required environment variable: ' + name);
  return value;
}

function getAllowedOrigin() {
  return requireEnv('ALLOWED_ORIGIN');
}

function getSupabaseUrl() {
  return requireEnv('SUPABASE_URL');
}

module.exports = {
  requireEnv,
  getAllowedOrigin,
  getSupabaseUrl
};
