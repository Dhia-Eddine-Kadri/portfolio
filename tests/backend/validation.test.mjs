import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isUuid, cleanText, requireOneOf } = require('../../backend/lib/validation.js');

test('isUuid accepts valid v4 UUID', () => {
  assert.equal(isUuid('550e8400-e29b-41d4-a716-446655440000'), true);
});

test('isUuid rejects empty string', () => {
  assert.equal(isUuid(''), false);
});

test('isUuid rejects arbitrary string', () => {
  assert.equal(isUuid('not-a-uuid'), false);
});

test('isUuid rejects null', () => {
  assert.equal(isUuid(null), false);
});

test('cleanText trims whitespace', () => {
  assert.equal(cleanText('  hello  ', 100), 'hello');
});

test('cleanText throws when value exceeds maxLength', () => {
  assert.throws(() => cleanText('a'.repeat(101), 100), /maximum allowed length/);
});

test('cleanText accepts value at exactly maxLength', () => {
  assert.equal(cleanText('a'.repeat(100), 100), 'a'.repeat(100));
});

test('requireOneOf returns value when allowed', () => {
  assert.equal(requireOneOf('pro', ['free', 'pro'], 'plan'), 'pro');
});

test('requireOneOf throws when not allowed', () => {
  assert.throws(() => requireOneOf('admin', ['free', 'pro'], 'plan'), /not allowed/);
});
