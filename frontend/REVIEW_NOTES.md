# StudySphere — Remaining Work

## Assets

- Compress `icon-chatbot.png`, `icon-lounge.png`, and `hero.png` — these are large files hurting load time.
  Use [Squoosh](https://squoosh.app) or `cwebp` to convert to WebP or reduce file size. Cannot be done in code.

---

# What Was Fixed (Structured Feedback)

## Security — Backend

- **`verify-payment.js`**: Rewrote completely. JWT is now verified server-side via Supabase `/auth/v1/user`. `userId` is no longer trusted from the request body — it is compared against `session.metadata.user_id` from Stripe. Returns 403 if they don't match. CORS locked to production origin.
- **`create-checkout.js`**: Verified JWT server-side. `userId` and `email` are now derived from Supabase, not trusted from the client body.
- **`create-portal.js`**: Verified JWT server-side. `stripe_customer_id` is looked up from Supabase using the service role key, not accepted from the client.
- **`ai.js` (backend)**: Added auth check — requires valid Supabase JWT. CORS locked to production origin.
- **`stripe-webhook.js`**: Fails closed if `STRIPE_WEBHOOK_SECRET` is missing. Added handlers for `customer.subscription.updated` (syncs status + `expires_at` from `current_period_end`) and `invoice.payment_failed` (sets status to `past_due`).
- **`admin-users.js`**: CORS locked from `*` to production origin. Hardcoded admin email fallback removed — now fails with 500 if `ADMIN_EMAIL` env var is not set.

## Security — Extension

- **`extension/content.js`**: Incoming `window.addEventListener('message')` now validates `e.origin === location.origin` and whitelists only known message types (`SS_REQUEST_SUMMARIES`, `SS_DELETE_SUMMARY`). All outgoing `window.postMessage` calls changed from `'*'` to `location.origin`.
- **`extension/content.js` — `renderMarkdown`**: Added HTML escaping (`&`, `<`, `>`) before markdown transforms to prevent XSS from AI response content being injected into `innerHTML`.

## Security — Frontend

- **`lecturenotes.js`**: All outgoing `postMessage` calls tightened from `'*'` to `location.origin`. Incoming message listener already validated origin correctly.
- **`ai/ai.js`**: Fixed bug where `lnRenderMarkdown` was called in `runMultiSummary` — that function is IIFE-local to `lecturenotes.js` and would throw a `ReferenceError`. Changed to `renderMarkdown` (the global from `app.js`).

## Code Quality — Inline Handlers Removed

- **`pages/signup.html`** (onboarding modal):
  - Removed `onmouseover`/`onmouseout` from Log out button → replaced with `.ob-logout-btn:hover` CSS rule.
  - Removed all `onclick` handlers from step buttons (Continue, Back ×3, path cards, test cards, Finish ×2).
  - Added `id` attributes to each button for JS wiring.
  - Test cards now use `data-test` attributes; level buttons use `data-level` attributes.
  - Event listeners added in `app.js` via `ss-ready` handler. Test and level grids use event delegation.

- **`features/editor/editor.html`**:
  - Hub cards (Writer, PDF Editor, Merger): removed `onmouseover`/`onmouseout` → CSS classes `ed-hub-card-blue/purple/green` with `:hover` rules in `editor.css`.
  - All 11 tool sidebar items: removed `onclick` → replaced with `data-tool` attributes; wired via `querySelectorAll` in `editor.js`.
  - Mode buttons (Pan, Select): removed `onclick` → `data-mode` attributes; wired in `editor.js`.
  - Shape buttons (Rect, Oval, Arrow): removed `onclick` → `data-shape` attributes; wired in `editor.js`.
  - PDF editor drop zone: removed `ondragover`/`ondragleave`/`ondrop` → wired in `editor.js`.
  - Merger drop zone: removed `ondragover`/`ondragleave`/`ondrop` → wired in `editor.js`.
  - "Choose a PDF" button: removed `onclick` → added `id="edPdfChooseBtn"`, wired in `editor.js`.
  - Pro tip close button: removed `onclick` → added `id="edPdfProTipClose"`, wired in `editor.js`.

## Code Quality — Other

- **`pages/signup.html`**: Removed stray unprofessional comment `<!--hiiiiiiii!!!!!!-->`.
- **`pages/landing.html`**: Moved embedded `<style>` block and inline `onmouseover`/`onmouseout` handlers to `css/landing.css`. Review cards and back-to-top button now use CSS `:hover`.
- **`pages/auth.html`**: Removed inline `onclick` password toggle handlers from `#togglePw` and `#toggleConfirm`. Event listeners added in `app.js`.
- **`extension/manifest.json`**: Removed `http://localhost:5050/*` from `host_permissions`.
- **`extension/offscreen.js`**: Added try/catch around Whisper model load in `getTranscriber()`. On failure: resets `transcriber = null` (allows retry), notifies the user with a readable error message including cause.

## Architecture — Code Splits

- **`js/app.js`** (6260 → ~4755 lines): Split into `app-data.js` (constants: COLORS, SEMS, MAJOR_LIST, SUBJECT_LIST), `app-storage.js` (all `_uf*` file/storage helpers), `app-pdf.js` (PDF viewer, annotation engine, export). Load order maintained via `loader.js` Promise chain.
- **`js/styles.css`**: Split into `css/base.css` (reset + light theme vars), `css/theme.css` (dark mode, auth vars, animations), `css/styles.css` (portal/feature styles), `css/layout.css` (shell, sidebar, responsive), `css/landing.css` (landing page only). Cascade order preserved.
- **`features/games/games.js`**: Split into `games-tetris.js`, `games-solitaire.js`, `games-bird.js`, `games-chess.js`. Each is a self-contained IIFE exposing only `window.*` functions.

## Concurrency Bugs Fixed

- **Bug #9**: `_chatOpenRoom` — stale room guard after `await _chatLoad(true)`.
- **Bug #10**: `_chatLoad` — in-flight boolean + monotonic sequence counter prevents concurrent fetches.
- **Bug #12**: `openCourse` — sequence counter captures before async `_ufMerge`, checked at `.then()` entry.
- **Bug #13**: Folder delete — uses `Promise.allSettled` with per-file error reporting; button disabled during operation.
- **Bug #14**: `_aipLoadCourseFiles` — captures active course before async, checks on return.
- **Bug #15**: `_chatSearchGifs` — monotonic GIF search sequence counter prevents stale results.
