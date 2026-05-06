import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../../frontend/js/utils/escape-html.js';

test('escapeHtml escapes &', () => {
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml escapes <', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});

test('escapeHtml escapes >', () => {
  assert.equal(escapeHtml('a > b'), 'a &gt; b');
});

test('escapeHtml escapes double quotes', () => {
  assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
});

test('escapeHtml escapes single quotes', () => {
  assert.equal(escapeHtml("it's"), 'it&#039;s');
});

test('escapeHtml handles empty string', () => {
  assert.equal(escapeHtml(''), '');
});

test('escapeHtml coerces non-string input', () => {
  assert.equal(escapeHtml(42), '42');
});

test('escapeHtml handles XSS payload', () => {
  const result = escapeHtml('<img src=x onerror="alert(1)">');
  assert.ok(!result.includes('<img'));
  assert.ok(!result.includes('>'));
});
