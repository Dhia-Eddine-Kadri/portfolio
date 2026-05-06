function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

// Trims and enforces a max byte length. Returns the cleaned string or throws.
function cleanText(value, maxLength) {
  var str = String(value || '').trim();
  if (str.length > maxLength) throw new Error('Value exceeds maximum allowed length');
  return str;
}

// Ensures a value is one of the allowed set.
function requireOneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error((label || 'Value') + ' is not allowed');
  return value;
}

module.exports = { isUuid, cleanText, requireOneOf };
