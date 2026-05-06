# Two-Account Manual Security Test Plan

Use two browser sessions (Account A = admin, Account B = regular free user).

## 1. Paywall enforcement

| # | Step | Expected |
|---|------|----------|
| 1 | Sign in as Account B (free). Open app. | Paywall modal appears after a moment. |
| 2 | Open browser DevTools console. Set `window._userIsPro = true`. | Paywall disappears — but reload resets it. |
| 3 | Reload. Try to call a Pro-gated feature directly (e.g. AI chat). | Paywall re-appears. Server rejects any AI request without valid Pro sub. |

## 2. Admin access isolation

| # | Step | Expected |
|---|------|----------|
| 1 | Sign in as Account B. Check for Admin button in sidebar. | Admin button is hidden. |
| 2 | Call `GET /api/admin-users` with Account B's token. | Returns 403. |
| 3 | Sign in as Account A (admin). | Admin button visible, paywall never shown. |
| 4 | Call `GET /api/admin-users` with Account A's token. | Returns user list. |

## 3. Subscription spoofing

| # | Step | Expected |
|---|------|----------|
| 1 | As Account B, call `POST /api/activate-paypal-subscription` with a fake `subscriptionID`. | Returns 400 or 422 — backend verifies with PayPal before writing to DB. |
| 2 | Modify `_userIsPro` in JS. Try to use AI chat. | AI request goes to `/api/ai` which checks DB subscription status, not client flag. Returns 403 or rate-limited. |

## 4. Cross-account data access

| # | Step | Expected |
|---|------|----------|
| 1 | As Account B, note Account A's user ID from the URL or a chat message. | — |
| 2 | Call `GET /api/admin-users` with Account B's token. | 403 — RLS blocks it. |
| 3 | Try to fetch another user's uploaded files via storage URL. | 403 — Supabase storage RLS requires matching `user_id`. |

## 5. Token reuse

| # | Step | Expected |
|---|------|----------|
| 1 | Copy Account B's JWT from DevTools (Authorization header). | — |
| 2 | Sign out Account B. Use copied token in a curl request to `/api/send-chat-message`. | 401 — expired or revoked token rejected. |

## 6. Rate limiting

| # | Step | Expected |
|---|------|----------|
| 1 | As Account B, rapidly send 25 AI requests. | After 20 requests (within 1 hour), receives 429 with `Retry-After` header. |
| 2 | As Account A (admin), repeat. | Same limit applies — admin is not exempt from rate limits. |

## 7. File upload validation

| # | Step | Expected |
|---|------|----------|
| 1 | As Account B, upload a `.exe` file via the course file upload UI. | File is rejected (type not in allow-list). |
| 2 | Upload a valid PDF over 50 MB. | Upload fails with size error. |

## Notes

- Run these tests before every major release.
- If any test fails, open a security issue (private) before merging.
