# StudySphere exact quiz/flashcard count fix

## Problem

The frontend passes the requested count correctly, but the backend does not enforce it after generation.

Main backend issue:

```js
const rawItems = result.items || [];
const items = deduplicateItems(rawItems);
return { items, text: result.text || '', sources };
```

If the model returns 11 items and `deduplicateItems()` removes 3 as too similar, the backend returns 8.
There is no repair/backfill step.

## Fix

Edit:

```text
backend/lib/study-pipeline.js
```

Add these helper functions after `deduplicateItems(items)`:

```js
function _itemMainText(item) {
  return String((item && (item.question || item.front)) || '').trim();
}

function _isValidQuizItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (!String(item.question || '').trim()) return false;
  if (!item.options || typeof item.options !== 'object') return false;

  const letters = ['A', 'B', 'C', 'D'];
  const hasAllOptions = letters.every(function (l) {
    return String(item.options[l] || '').trim();
  });

  if (!hasAllOptions) return false;

  const ans = String(item.answer || '').trim().toUpperCase();
  if (!letters.includes(ans)) return false;

  if (!String(item.explanation || '').trim()) return false;
  return true;
}

function _isValidFlashcardItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (!String(item.front || '').trim()) return false;
  if (!String(item.back || '').trim()) return false;
  return true;
}

function normalizeGeneratedItems(tool, items) {
  const arr = Array.isArray(items) ? items : [];

  if (tool === 'quiz') {
    return arr.filter(_isValidQuizItem).map(function (item) {
      return {
        question: String(item.question || '').trim(),
        options: {
          A: String(item.options.A || '').trim(),
          B: String(item.options.B || '').trim(),
          C: String(item.options.C || '').trim(),
          D: String(item.options.D || '').trim(),
        },
        answer: String(item.answer || '').trim().toUpperCase(),
        explanation: String(item.explanation || '').trim(),
        difficulty: item.difficulty || 'medium',
        question_type: item.question_type || 'application',
        why_important: item.why_important || '',
        source: item.source || '',
      };
    });
  }

  if (tool === 'flashcards') {
    return arr.filter(_isValidFlashcardItem).map(function (item) {
      return {
        front: String(item.front || '').trim(),
        back: String(item.back || '').trim(),
        card_type: item.card_type || 'definition',
        difficulty: item.difficulty || 'medium',
        why_important: item.why_important || '',
        source: item.source || '',
      };
    });
  }

  return arr;
}

function mergeUniqueItems(existing, incoming, targetCount) {
  const merged = existing.slice();

  incoming.forEach(function (item) {
    const text = _itemMainText(item);
    if (!text) return;

    const duplicate = merged.some(function (old) {
      return wordJaccard(text, _itemMainText(old)) >= 0.72;
    });

    if (!duplicate) merged.push(item);
  });

  return merged.slice(0, targetCount);
}

function exactCountInstruction(tool, count) {
  if (tool === 'quiz') {
    return [
      '',
      '## STRICT COUNT REQUIREMENT',
      'You MUST return EXACTLY ' + count + ' quiz questions in the JSON items array.',
      'Do not return fewer.',
      'Do not return more.',
      'Every question must have exactly four options A, B, C, D.',
      'The answer must be one of "A", "B", "C", or "D".',
      'If the context is small, create different question angles from the same source material, but still return EXACTLY ' + count + ' valid questions.',
    ].join('\n');
  }

  if (tool === 'flashcards') {
    return [
      '',
      '## STRICT COUNT REQUIREMENT',
      'You MUST return EXACTLY ' + count + ' flashcards in the JSON items array.',
      'Do not return fewer.',
      'Do not return more.',
      'Every flashcard must have a non-empty front and a non-empty back.',
      'If the context is small, create different card types from the same source material, but still return EXACTLY ' + count + ' valid flashcards.',
    ].join('\n');
  }

  return '';
}

function buildRepairPrompt(tool, missing, targetCount, existingItems) {
  const existingLines = existingItems
    .map(function (item, i) {
      return String(i + 1) + '. ' + _itemMainText(item).slice(0, 180);
    })
    .join('\n');

  const noun = tool === 'quiz' ? 'quiz questions' : 'flashcards';

  return [
    '',
    '## REPAIR GENERATION',
    'The previous response did not produce enough valid unique items.',
    'Generate EXACTLY ' + missing + ' ADDITIONAL ' + noun + '.',
    'Do NOT repeat or closely paraphrase these existing items:',
    existingLines || '(none)',
    '',
    'Return ONLY JSON with {"items":[...]} and exactly ' + missing + ' items.',
    'The final total must become exactly ' + targetCount + '.',
  ].join('\n');
}
```

Then replace this section near the end of `runPipeline`:

```js
const rawItems = result.items || [];
const items = deduplicateItems(rawItems);
```

with this:

```js
let rawItems = normalizeGeneratedItems(tool, result.items || []);
let items = mergeUniqueItems([], rawItems, itemCount);

// Backfill missing items.
// The model sometimes returns fewer than requested, and deduplication can remove items.
// We repair instead of silently returning fewer.
if ((tool === 'quiz' || tool === 'flashcards') && items.length < itemCount) {
  for (let attempt = 0; attempt < 2 && items.length < itemCount; attempt++) {
    const missing = itemCount - items.length;

    const repairSystemPrompt =
      systemPrompt +
      exactCountInstruction(tool, missing) +
      buildRepairPrompt(tool, missing, itemCount, items);

    let repairResult = null;

    try {
      repairResult = await callOpenAI(
        repairSystemPrompt,
        userMessage,
        tool === 'quiz' ? 3200 : 3000,
        model
      );
    } catch (e) {
      repairResult = null;
    }

    const repairItems = normalizeGeneratedItems(
      tool,
      repairResult && repairResult.items ? repairResult.items : []
    );

    items = mergeUniqueItems(items, repairItems, itemCount);
  }
}

// Final exact-size enforcement.
// Never return more than requested.
items = items.slice(0, itemCount);
```

Also change the system prompt construction in `runPipeline`.

Find:

```js
if (tool === 'flashcards') systemPrompt = flashcardsSystemPrompt(itemCount);
else if (tool === 'quiz') systemPrompt = quizSystemPrompt(itemCount, diff);
else systemPrompt = summarySystemPrompt();
```

Replace with:

```js
if (tool === 'flashcards') systemPrompt = flashcardsSystemPrompt(itemCount) + exactCountInstruction('flashcards', itemCount);
else if (tool === 'quiz') systemPrompt = quizSystemPrompt(itemCount, diff) + exactCountInstruction('quiz', itemCount);
else systemPrompt = summarySystemPrompt();
```

Finally increase max tokens slightly.

Find:

```js
const maxTokens = tool === 'flashcards' ? 3200 : tool === 'quiz' ? (useStrongModel ? 4096 : 3200) : 2000;
```

Replace with:

```js
const maxTokens =
  tool === 'flashcards'
    ? Math.min(7000, 1800 + itemCount * 450)
    : tool === 'quiz'
      ? Math.min(8000, 2200 + itemCount * 520)
      : 2000;
```

## Optional frontend safety warning

In:

```text
frontend/features/quiz/quiz.js
frontend/features/flashcards/flashcards.js
```

After generation, warn if the backend still returns fewer items.

Quiz:

```js
if (result.items.length !== genOpts.count) {
  _toast(
    'Generated fewer than requested',
    'Asked for ' + genOpts.count + ', got ' + result.items.length + '. Try selecting more indexed files.'
  );
}
```

Flashcards:

```js
if (result.items.length !== genOpts.count) {
  _toast(
    'Generated fewer than requested',
    'Asked for ' + genOpts.count + ', got ' + result.items.length + '. Try selecting more indexed files.'
  );
}
```

But the real fix is backend repair/backfill.
