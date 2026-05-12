# Minallo Code Improvements Walkthrough

## Overview
This document outlines 7 critical code improvements with specific implementation steps for each. Work through them in the recommended priority order.

---

## 1. Error Swallowing (40+ Silent catch blocks)
**Priority:** 🔴 Critical | **Effort:** Low | **Time:** 30 min | **Files:** 40+

### Current Problem
Errors disappear silently, users see nothing, debugging is impossible.

```js
// app-storage.js:271
try {
  someOperation();
} catch (e) {} // Error disappears
```

### Implementation: Create Centralized Error Logger

#### Step 1: Create `frontend/js/utils/error-logger.js`
```js
export function logError(context, error, isSilent = false) {
  const msg = error?.message || String(error);
  const stack = error?.stack || '';
  
  // Always log to console in dev
  console.error(`[${context}]`, msg, stack);
  
  // If not silent, also send to backend for monitoring
  if (!isSilent) {
    fetch('/api/log-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        context, 
        message: msg, 
        stack, 
        url: window.location.href,
        timestamp: new Date().toISOString()
      })
    }).catch(() => {});
  }
}
```

#### Step 2: Import in main.js
Add to `frontend/js/main.js` imports:
```js
import { logError } from './utils/error-logger.js';
window.logError = logError; // Make available globally
```

#### Step 3: Replace silent catches in these files:
- `frontend/js/app-storage.js` — 7 places
- `frontend/js/supabase.js` — 11 places
- `frontend/js/auth-bootstrap.js` — 8 places
- `frontend/js/app.js` — 1 place
- `frontend/js/app-pdf.js` — 3 places
- `frontend/js/router.js` — 3 places
- `backend/functions/ai-ask.js` — 2 places
- `backend/functions/ai-generate.js` — 1 place

**Example replacement:**
```js
// BEFORE
} catch (e) {}

// AFTER
} catch (e) { 
  logError('appStorage_operation', e, true); 
}
```

### Impact
✅ All errors now logged to console  
✅ Non-silent errors sent to backend  
✅ Debuggable via browser console or error analytics

---

## 2. Circuit Breaker Stateful Object
**Priority:** 🔴 Critical | **Effort:** Medium | **Time:** 20 min | **Files:** `backend/functions/ai-ask.js`

### Current Problem
Module-level state persists across requests. One user's failures break other users' requests.

```js
// ai-ask.js:33 — persists across requests
const _fastBreaker = { failures: 0, skipsRemaining: 0 };

// If Request A fails 3 times, Request B gets skipped too
function _breakerNoteFailure() {
  _fastBreaker.failures++;
  if (_fastBreaker.failures >= 3) {
    _fastBreaker.skipsRemaining = 5; // Request B is now affected!
  }
}
```

### Implementation: Request-Scoped Circuit Breaker

#### Step 1: Refactor ai-ask.js
Replace the module-level breaker object with a factory function:

```js
function createCircuitBreaker() {
  return {
    failures: 0,
    skipsRemaining: 0,
    shouldSkip() {
      if (this.skipsRemaining > 0) {
        this.skipsRemaining--;
        return true;
      }
      return false;
    },
    noteSuccess() {
      this.failures = 0;
    },
    noteFailure() {
      this.failures++;
      if (this.failures >= 3) {
        this.skipsRemaining = 5;
        this.failures = 0;
      }
    }
  };
}
```

#### Step 2: Update handler to use request-scoped instance
In `ai-ask.js` handler:
```js
exports.handler = async function(event, context) {
  const breaker = createCircuitBreaker(); // Fresh per request
  
  // Pass breaker through all internal calls
  const hyde = await callFastOpenAI(..., breaker);
  const reranked = await rerank(..., breaker);
  
  // breaker state only affects this request
  return success({ answer, sources });
};
```

#### Step 3: Update all calls that reference `_breakerShouldSkip()`, `_breakerNoteSuccess()`, `_breakerNoteFailure()`
Change from:
```js
if (_breakerShouldSkip()) return Promise.resolve('');
_breakerNoteSuccess();
_breakerNoteFailure();
```

To:
```js
if (breaker.shouldSkip()) return Promise.resolve('');
breaker.noteSuccess();
breaker.noteFailure();
```

### Impact
✅ Each request gets isolated state  
✅ One user's failures don't affect others  
✅ Container reuse doesn't cause cross-pollution

---

## 3. Rate Limiting Full Table Scans
**Priority:** 🔴 Critical | **Effort:** Low | **Time:** 15 min | **Files:** `backend/lib/rate-limit.js` + migration

### Current Problem
Counts all rows in table. As millions accumulate, queries get slow.

```js
// backend/lib/rate-limit.js:7
const path = 'security_events?user_id=eq...&event_type=eq...&created_at=gte...&select=id';
const res = await supaRequest('GET', path, null, serviceKey);
return Array.isArray(res.body) ? res.body.length : 0; // Full table scan!
```

### Implementation: Use COUNT(*) Aggregate

#### Step 1: Update `backend/lib/rate-limit.js`
Replace the counting functions:

```js
async function countRecentEvents(serviceKey, userId, eventType, windowMs) {
  const since = new Date(Date.now() - windowMs).toISOString();
  
  // Use COUNT aggregate instead of fetching all rows
  const path = 
    'security_events?user_id=eq.' + encodeURIComponent(userId) +
    '&event_type=eq.' + encodeURIComponent(eventType) +
    '&created_at=gte.' + encodeURIComponent(since) +
    '&select=count(id)'; // Request count only
  
  const res = await supaRequest('GET', path, null, serviceKey, {
    Prefer: 'count=exact' // Tell Supabase to calculate count
  });
  
  // Result is array with { count: N }
  return res.body?.[0]?.count || 0;
}

async function countRecentMessages(serviceKey, userId, windowMs) {
  const since = new Date(Date.now() - windowMs).toISOString();
  
  const path = 
    'messages?user_id=eq.' + encodeURIComponent(userId) +
    '&created_at=gte.' + encodeURIComponent(since) +
    '&select=count(id)';
  
  const res = await supaRequest('GET', path, null, serviceKey, {
    Prefer: 'count=exact'
  });
  
  return res.body?.[0]?.count || 0;
}
```

#### Step 2: Create migration `backend/migrations/009_rate_limit_index.sql`
```sql
-- Add indexes to speed up rate limit queries
CREATE INDEX IF NOT EXISTS idx_security_events_rate_limit 
ON security_events(user_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_rate_limit 
ON messages(user_id, created_at DESC);

-- Run migration in Supabase via:
-- Copy entire SQL file contents into Supabase SQL editor and execute
```

### Impact
✅ Query time from O(n) to O(1)  
✅ Scales to millions of rows  
✅ Supabase only returns count, not all rows

---

## 4. Unvalidated localStorage State Restore
**Priority:** 🟡 High | **Effort:** Low | **Time:** 20 min | **Files:** State restore points

### Current Problem
Corrupted or old data in localStorage crashes app silently.

```js
// supabase.js:100
var st = JSON.parse(localStorage.getItem('ss_state') || '{}');
// If ss_state is corrupted, JSON.parse throws
// If structure is wrong, code that assumes properties breaks
```

### Implementation: Add State Schema Validator

#### Step 1: Create `frontend/js/utils/state-validator.js`
```js
export function validateState(raw) {
  try {
    const st = typeof raw === 'string' ? JSON.parse(raw) : raw;
    
    // Define expected schema with type checking
    const validated = {
      inApp: st?.inApp === true,
      semId: typeof st?.semId === 'string' ? st.semId : null,
      courseId: typeof st?.courseId === 'string' ? st.courseId : null,
      fileName: typeof st?.fileName === 'string' ? st.fileName : null,
      section: typeof st?.section === 'string' ? st.section : 'files',
      portalSection: typeof st?.portalSection === 'string' ? st.portalSection : 'dashboard'
    };
    
    return validated;
  } catch (e) {
    // Corrupted state, return safe defaults
    if (typeof window.logError === 'function') {
      window.logError('validateState', e, true);
    }
    return {
      inApp: false,
      semId: null,
      courseId: null,
      fileName: null,
      section: 'files',
      portalSection: 'dashboard'
    };
  }
}
```

#### Step 2: Update `frontend/js/supabase.js`
Add import:
```js
import { validateState } from './utils/state-validator.js';
```

Replace all state restores. Search for `JSON.parse(localStorage.getItem('ss_state')` and replace with:
```js
validateState(localStorage.getItem('ss_state'))
```

#### Step 3: Update other files
Do the same in:
- `frontend/js/router.js` — line 15, 21
- `frontend/js/navigation.js` — line 100, 119

### Impact
✅ App doesn't crash on corrupted state  
✅ Always has valid default fallback  
✅ Wrong types are caught and corrected

---

## 5. Manual HTTPS Requests in Backend
**Priority:** 🟡 High | **Effort:** Medium | **Time:** 25 min | **Files:** Backend lib files

### Current Problem
Raw `https.request()` calls are verbose, error-prone, no built-in timeout.

```js
// backend/lib/supabase-admin.js:16
const req = https.request({...}, function(res) {
  let data = '';
  res.on('data', function(c) { data += c; });
  res.on('end', function() { ... });
});
req.on('error', reject);
// No timeout handling visible
```

### Implementation: Use fetch Instead

#### Step 1: Refactor `backend/lib/supabase-admin.js`
Replace entire `supaRequest` function:

```js
async function supaRequest(method, path, body, serviceKey, extraHeaders) {
  const supaUrl = requireEnv('SUPABASE_URL');
  const bodyStr = body ? JSON.stringify(body) : null;
  
  const res = await fetch(`${supaUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(extraHeaders || {})
    },
    body: bodyStr,
    signal: AbortSignal.timeout(10000) // 10 second timeout
  });
  
  const data = await res.text();
  return {
    status: res.status,
    body: data ? JSON.parse(data) : null
  };
}

// Do the same for supaAuthAdminRequest
async function supaAuthAdminRequest(method, path, serviceKey) {
  const supaUrl = requireEnv('SUPABASE_URL');
  
  const res = await fetch(`${new URL(supaUrl).hostname}/auth/v1/admin/${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`
    },
    signal: AbortSignal.timeout(5000)
  });
  
  const data = await res.text();
  return {
    status: res.status,
    body: data ? JSON.parse(data) : null
  };
}
```

#### Step 2: Refactor `backend/lib/supabase-auth.js`
Replace `verifySupabaseToken`:

```js
async function verifySupabaseToken(token) {
  const supaUrl = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  
  try {
    const res = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey
      },
      signal: AbortSignal.timeout(5000)
    });
    
    if (res.status !== 200) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}
```

#### Step 3: Remove `const https = require('https');` from both files

### Impact
✅ Cleaner, more readable code  
✅ Built-in timeout handling (prevents hanging)  
✅ Less error-prone than manual stream handling

---

## 6. No Centralized Error Response Format
**Priority:** 🟡 High | **Effort:** Medium | **Time:** 40 min | **Files:** All backend function files

### Current Problem
Different endpoints return different error shapes. Frontend error handling breaks.

```js
// Some return
{ error: { message } }

// Others return
{ error: message }

// Some return
{ statusCode: 429, body: JSON.stringify({ ... }) }
```

### Implementation: Standardize Response Format

#### Step 1: Update `backend/lib/responses.js`
Replace entire file:

```js
const { getCorsHeaders } = require('./cors');

function jsonResponse(statusCode, body, extraHeaders) {
  const isSuccess = statusCode < 400;
  
  return {
    statusCode,
    headers: Object.assign(getCorsHeaders(), extraHeaders || {}),
    body: JSON.stringify({
      success: isSuccess,
      data: isSuccess ? body : null,
      error: !isSuccess ? {
        code: statusCode,
        message: typeof body === 'string' ? body : (body?.message || 'Unknown error')
      } : null
    })
  };
}

function success(data) {
  return jsonResponse(200, data);
}

function fail(statusCode, message) {
  return jsonResponse(statusCode, message);
}

function handleOptions() {
  return { 
    statusCode: 204, 
    headers: getCorsHeaders(), 
    body: '' 
  };
}

function withHandler(handler) {
  return async function (event, context) {
    if (event.httpMethod === 'OPTIONS') return handleOptions();
    try {
      return await handler(event, context);
    } catch (err) {
      const message = err && err.message ? err.message : 'Internal server error';
      const status = err && err.statusCode ? err.statusCode : 500;
      return fail(status, message);
    }
  };
}

module.exports = { jsonResponse, fail, success, handleOptions, withHandler };
```

#### Step 2: Update all function handlers
Replace all response calls:

**BEFORE:**
```js
if (!token) return fail(401, 'Missing token');
return jsonResponse(200, { answer: ... });
```

**AFTER:**
```js
if (!token) return fail(401, 'Missing token');
return success({ answer: ... });
```

Files to update (search and replace):
- `backend/functions/ai.js`
- `backend/functions/ai-ask.js`
- `backend/functions/ai-generate.js`
- `backend/functions/send-chat-message.js`
- `backend/functions/admin-users.js`
- All other function files

### Frontend Side: Update error handling in services
In `frontend/js/services/*.js`:

```js
export async function someApiCall() {
  const res = await fetch('/api/endpoint', { ... });
  const data = await res.json();
  
  // New format check
  if (!data.success) {
    throw new Error(data.error?.message || 'Request failed');
  }
  
  return data.data;
}
```

### Impact
✅ Consistent response format across all endpoints  
✅ Frontend can reliably parse errors  
✅ Error codes are standardized (4xx client, 5xx server)

---

## 7. Centralize Magic Constants
**Priority:** 🟢 Medium | **Effort:** Low | **Time:** 25 min | **Files:** Config + all functions

### Current Problem
Magic numbers scattered everywhere. Hard to tune or test.

```js
// ai-ask.js:23
const MAX_CHUNKS = 12;
const MIN_SIMILARITY = 0.18;
const STRONG_SIMILARITY_THRESHOLD = 0.3;

// ai.js:15
const MAX_MESSAGES = 20;
const MAX_TEXT_CHARS = 120000;

// app-storage.js:4
const _SS_UPLOAD_DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
```

### Implementation: Create Central Config

#### Step 1: Create `backend/lib/config.js`
```js
const { optionalEnv } = require('./env');

const AI_CONFIG = {
  // RAG retrieval settings
  MAX_CHUNKS: 12,
  MIN_SIMILARITY: 0.18,
  STRONG_SIMILARITY_THRESHOLD: 0.3,
  
  // Embeddings
  EMBED_MODEL: 'text-embedding-3-small',
  EMBED_DIMENSIONS: 1536,
  OPENAI_CHAT_MODEL: optionalEnv('AI_MODEL', 'gpt-4o'),
  OPENAI_FAST_MODEL: 'gpt-4o-mini',
  
  // Rate limiting
  RATE_LIMIT_MAX: Number(optionalEnv('AI_RATE_LIMIT_MAX', '20')),
  RATE_LIMIT_WINDOW_MS: Number(optionalEnv('AI_RATE_LIMIT_WINDOW_MS', '3600000')),
  
  // Message validation
  MAX_MESSAGES: 20,
  MAX_TEXT_CHARS: 120000,
  MAX_IMAGE_BLOCKS: 5,
  MAX_IMAGE_BASE64_CHARS: 1500000,
  MAX_COMPLETION_TOKENS: 2048,
  ALLOWED_ROLES: { user: true, assistant: true, system: true },
  ALLOWED_IMAGE_MEDIA_TYPES: {
    'image/png': true,
    'image/jpeg': true,
    'image/jpg': true,
    'image/webp': true,
    'image/gif': true
  }
};

const CHAT_CONFIG = {
  RATE_LIMIT_WINDOW_MS: Number(optionalEnv('CHAT_RATE_LIMIT_WINDOW_MS', '60000')),
  RATE_LIMIT_MAX: Number(optionalEnv('CHAT_RATE_LIMIT_MAX', '8'))
};

const STORAGE_CONFIG = {
  BUCKET: optionalEnv('RAG_STORAGE_BUCKET', 'course-documents'),
  UPLOAD_MAX_BYTES: 25 * 1024 * 1024,
  IMAGE_MAX_BYTES: 6 * 1024 * 1024,
  AI_IMAGE_MAX_BYTES: 1024 * 1024,
  ALLOWED_EXTENSIONS: ['.pdf', '.txt', '.docx', '.png', '.jpg', '.jpeg'],
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg'
  ],
  BLOCKED_EXTENSIONS: [
    '.html', '.htm', '.js', '.mjs', '.svg', '.exe', '.bat', 
    '.cmd', '.sh', '.php', '.ps1', '.vbs', '.msi', '.jar', '.zip'
  ]
};

module.exports = { AI_CONFIG, CHAT_CONFIG, STORAGE_CONFIG };
```

#### Step 2: Replace constants in each function file

**BEFORE:**
```js
// ai-ask.js:23
const MAX_CHUNKS = 12;
const MIN_SIMILARITY = 0.18;
const OPENAI_CHAT_MODEL = optionalEnv('AI_MODEL', 'gpt-4o');
```

**AFTER:**
```js
// ai-ask.js:3
const { AI_CONFIG } = require('../lib/config');
const MAX_CHUNKS = AI_CONFIG.MAX_CHUNKS;
const MIN_SIMILARITY = AI_CONFIG.MIN_SIMILARITY;
const OPENAI_CHAT_MODEL = AI_CONFIG.OPENAI_CHAT_MODEL;
```

Files to update:
- `backend/functions/ai.js` — replace all CONST declarations
- `backend/functions/ai-ask.js` — replace all CONST declarations
- `backend/functions/ai-generate.js` — replace all CONST declarations
- `backend/functions/send-chat-message.js` — replace CHAT_RATE_LIMIT constants
- `backend/functions/documents-upload.js` — replace STORAGE constants

### Impact
✅ Single source of truth for all constants  
✅ Easy to tune without code changes  
✅ Easy to test with different values

---

## Recommended Implementation Order

| Order | Issue | Time | Blocker |
|-------|-------|------|---------|
| 1️⃣ | Error logger | 30 min | None — do first |
| 2️⃣ | Circuit breaker | 20 min | None |
| 3️⃣ | Rate limit COUNT | 15 min | None |
| 4️⃣ | State validator | 20 min | None |
| 5️⃣ | Fetch HTTPS | 25 min | None |
| 6️⃣ | Response format | 40 min | Requires frontend update |
| 7️⃣ | Config file | 25 min | None |

**Total: ~2.5 hours**

---

## Quick Reference: Files Needing Changes

### Frontend
- `frontend/js/main.js` — import error logger
- `frontend/js/utils/error-logger.js` — **CREATE NEW**
- `frontend/js/utils/state-validator.js` — **CREATE NEW**
- `frontend/js/supabase.js` — import validator, replace JSON.parse calls
- `frontend/js/router.js` — replace JSON.parse calls
- `frontend/js/navigation.js` — replace JSON.parse calls
- `frontend/js/services/*.js` — update error handling

### Backend
- `backend/lib/config.js` — **CREATE NEW**
- `backend/lib/responses.js` — standardize format
- `backend/lib/rate-limit.js` — use COUNT aggregate
- `backend/lib/supabase-admin.js` — replace HTTPS with fetch
- `backend/lib/supabase-auth.js` — replace HTTPS with fetch
- `backend/migrations/009_rate_limit_index.sql` — **CREATE NEW**
- All `backend/functions/*.js` — import from config, update responses

---

## Testing Checklist

After each fix, verify:
- [ ] No console errors
- [ ] Feature still works as before
- [ ] Can trigger error and see it logged
- [ ] Rate limiting still works
- [ ] API responses parse correctly in frontend

---

## Notes
- All changes are backward compatible
- No database schema changes required (only indexes)
- Can be deployed incrementally
- No breaking changes to APIs
