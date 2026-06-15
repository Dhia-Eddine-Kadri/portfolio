import { test } from 'node:test';
import assert from 'node:assert/strict';

// Same setup as ai-input-render.test.mjs: renderMarkdown reads `window`
// lazily and the delegated DOM handlers are guarded by
// `typeof document !== 'undefined'`, so a bare window stub is enough.
globalThis.window = globalThis.window || {};

const { renderMarkdown, AI_ACTION_TABS, AI_ASK_ACTIONS } = await import(
  '../../frontend/js/features/ai-chat/ai-markdown.ts'
);

function renderActions(spec) {
  return renderMarkdown('```minallo-actions\n' + JSON.stringify(spec) + '\n```');
}

test('valid minallo-actions renders allowlisted buttons', () => {
  const html = renderActions({
    actions: [
      { action: 'generate_flashcards', label: 'Generate flashcards' },
      { action: 'open_quiz', label: 'Open Quiz' },
    ],
  });
  assert.ok(html.includes('md-ai-actions'));
  assert.ok(html.includes('data-ai-action="generate_flashcards"'));
  assert.ok(html.includes('data-ai-action="open_quiz"'));
  assert.ok(html.includes('Generate flashcards'));
  assert.equal((html.match(/<button /g) || []).length, 2);
});

test('unknown action ids are dropped; all-unknown renders nothing', () => {
  const mixed = renderActions({
    actions: [
      { action: 'rm_rf_everything', label: 'Nope' },
      { action: 'open_files', label: 'Open Files' },
    ],
  });
  assert.ok(!mixed.includes('rm_rf_everything'));
  assert.ok(mixed.includes('data-ai-action="open_files"'));

  const none = renderActions({ actions: [{ action: 'not_a_real_action', label: 'X' }] });
  assert.ok(!none.includes('md-ai-actions'));
  assert.ok(!none.includes('<button'));
});

test('malformed JSON renders nothing and does not throw', () => {
  const html = renderMarkdown('```minallo-actions\n{broken json,,,\n```');
  assert.ok(!html.includes('md-ai-actions'));
  assert.ok(!html.includes('<button'));
});

test('at most 3 buttons render', () => {
  const html = renderActions({
    actions: [
      { action: 'open_files', label: 'a' },
      { action: 'open_quiz', label: 'b' },
      { action: 'open_flashcards', label: 'c' },
      { action: 'open_examforge', label: 'd' },
    ],
  });
  assert.equal((html.match(/<button /g) || []).length, 3);
});

test('unfenced minallo-actions marker still renders buttons', () => {
  // The model sometimes drops the code fences and emits a bare marker line
  // followed by the JSON; it must not leak into the chat as plain text.
  const html = renderMarkdown(
    'Here you go:\n\nminallo-actions\n\n{"actions":[{"action":"generate_quiz","label":"Quiz erstellen"}]}'
  );
  assert.ok(html.includes('md-ai-actions'));
  assert.ok(html.includes('data-ai-action="generate_quiz"'));
  assert.ok(html.includes('Quiz erstellen'));
  assert.ok(!html.includes('minallo-actions{'));
  assert.ok(!html.includes('&quot;actions&quot;')); // raw JSON did not leak as text
});

test('unfenced multi-line minallo-actions JSON renders buttons', () => {
  const html = renderMarkdown(
    'minallo-actions\n{\n  "actions": [\n    {"action":"open_quiz","label":"Quiz öffnen"}\n  ]\n}'
  );
  assert.ok(html.includes('data-ai-action="open_quiz"'));
  assert.ok(html.includes('Quiz öffnen'));
});

test('bare minallo-actions marker with no JSON falls through to text', () => {
  const html = renderMarkdown('minallo-actions\n\nSome other prose.');
  assert.ok(!html.includes('md-ai-actions'));
  assert.ok(html.includes('Some other prose.'));
});

test('HTML in labels is escaped (no injection)', () => {
  const html = renderActions({
    actions: [{ action: 'open_quiz', label: '<img src=x onerror=alert(1)>' }],
  });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
});

test('a missing or empty label drops the button', () => {
  const html = renderActions({ actions: [{ action: 'open_quiz' }, { action: 'open_files', label: '  ' }] });
  assert.ok(!html.includes('<button'));
});

test('every nav action maps to one of the six real course tabs', () => {
  const tabs = new Set(['files', 'quiz', 'flashcards', 'examforge', 'cheatsheet', 'deeplearn']);
  for (const [action, tab] of Object.entries(AI_ACTION_TABS)) {
    assert.ok(tabs.has(tab), action + ' maps to unknown tab ' + tab);
  }
});

test('ask actions compose non-empty follow-up questions', () => {
  for (const [action, text] of Object.entries(AI_ASK_ACTIONS)) {
    assert.ok(typeof text === 'string' && text.trim().length > 10, action);
  }
});
