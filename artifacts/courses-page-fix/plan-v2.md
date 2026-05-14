# Plan v2 — fix `/api/documents/list` 401s on first courses-page load

## Problem (re-stated)

On the `alreadyIn` auth path, the cached-profile IIFE in [frontend/js/app.ts:552-562](frontend/js/app.ts#L552-L562) calls `_loadUserCourses(cp.courses)` synchronously at module load — *before* `ss-ready` fires and `_verifyAndEnter` sets `_sbToken`. The resulting `_hydrateCardCount` calls fire `GET /api/documents/list` with `Authorization: Bearer ` (empty), backend rejects with 401, and per-card file counts never populate on the first render.

The existing `await window._sbSessionReady` in [ai-service.ts:144](frontend/js/services/ai-service.ts#L144) does not help because:
- `_sbSessionReady` is only assigned inside `restoreSession()`, not `_verifyAndEnter()`.
- Even if it were, the IIFE in `app.ts` runs before `_verifyAndEnter` is called, so the await would still see `undefined`.

Confirmation that the token is otherwise fine: the *same* token, used later by `admin-service.ts`, returns 403 ("not admin") from [admin-users.ts:63](backend/functions/admin-users.ts#L63) — meaning `verifySupabaseToken` accepted it. So the bug is purely client-side timing, not a backend or token problem.

## Fix — minimal, one file

In [frontend/js/features/courses/courses-render.ts](frontend/js/features/courses/courses-render.ts) (and its built `.js` twin), make `_hydrateCardCount` skip the network fetch when there is no auth token yet, and instead render the cached count from `localStorage` (`ss_fc_<courseId>`) which `_hydrateCardCount` itself already writes on every successful fetch.

When auth completes, `_enterApp → loadUserData(user.id)` runs the *real* `_loadUserCourses` with server data, which re-renders the cards and triggers `_hydrateCardCount` again — this second call has a valid token and populates fresh counts.

### Diff sketch

```ts
function _hydrateCardCount(courseId: string, badge: HTMLElement): void {
  // Skip while auth is still pending — the cached-profile pre-render fires
  // before _sbToken is set. A second render runs after auth completes and
  // will hit the network with a valid bearer.
  if (!window._sbToken) {
    try {
      const cached = localStorage.getItem('ss_fc_' + courseId);
      if (cached != null) {
        const n = Number(cached);
        if (Number.isFinite(n)) badge.textContent = n + ' file' + (n !== 1 ? 's' : '');
      }
    } catch { /* quota / parse */ }
    return;
  }
  // …existing logic…
}
```

## Files touched

- `frontend/js/features/courses/courses-render.ts` (source)
- `frontend/js/features/courses/courses-render.js` (build output — must stay in sync per project rule)

No backend changes. No `netlify.toml` changes. No `supabase.js` changes.

## Out of scope (intentionally)

- The `alive2 = false` log bug at [supabase.js:705,719](frontend/js/supabase.js#L705-L719) — handoff says "only touch if user asks." Cosmetic log, not the cause.
- The PDF.js CSP `unpkg.com` cmap warnings — separate issue, cosmetic for non-CJK PDFs.
- The 403 from `admin-users` — expected for non-admins, not a bug.
- Re-architecting `_sbSessionReady` to cover the `alreadyIn` path — broader, riskier, and unnecessary given the cache-fallback above. Note for future if other endpoints exhibit the same race.

## Verification

1. `npm run typecheck:frontend` passes.
2. Manual: visit `minallo.de` with `ss_logged_in=true` already set (i.e. open a tab that already had a session) and a `#course=…` URL. On first paint, course cards should show their cached counts immediately and refresh to live counts after auth — *zero* `401` errors in the console for `/api/documents/list`.
3. Manual: hard-reload from a logged-out state, sign in fresh — counts should still populate (this exercises the non-`alreadyIn` path, which already worked, to make sure we didn't break it).
4. Network tab should show one `documents/list` request per course on first load, not two.

## Risk

Low. The change is purely defensive: if no token, skip the doomed network call and fall back to a value the same function already cached. Worst case if the cache is missing: badge text stays empty for a few hundred ms until the post-auth re-render fills it in — strictly better than the current "401, badge stays empty until manual refresh."

## Commit

Single commit on `fix/courses-page`:

```
fix(courses): skip card-count fetch before auth → eliminates first-load 401s
```
