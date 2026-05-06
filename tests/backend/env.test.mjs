import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { requireEnv, optionalEnv } = require('../../backend/lib/env.js');

test('requireEnv returns value when set', () => {
  process.env._TEST_VAR = 'hello';
  assert.equal(requireEnv('_TEST_VAR'), 'hello');
  delete process.env._TEST_VAR;
});

test('requireEnv throws when variable is missing', () => {
  delete process.env._MISSING_VAR;
  assert.throws(() => requireEnv('_MISSING_VAR'), /Missing required environment variable/);
});

test('optionalEnv returns value when set', () => {
  process.env._TEST_OPT = 'world';
  assert.equal(optionalEnv('_TEST_OPT', 'default'), 'world');
  delete process.env._TEST_OPT;
});

test('optionalEnv returns default when missing', () => {
  delete process.env._MISSING_OPT;
  assert.equal(optionalEnv('_MISSING_OPT', 'fallback'), 'fallback');
});
