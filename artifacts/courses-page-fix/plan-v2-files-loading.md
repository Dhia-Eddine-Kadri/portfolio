# Plan v2 — "Loading your files…" persists on course open

## Problem

When opening a course (e.g. "Fertigungstechnik"), the user sees `Loading your files…` with a spinner for too long. Two distinct causes in [frontend/js/features/courses/course-view.ts](frontend/js/features/courses/course-view.ts):

- **A. Conflated loading signal.** `hasCache` is computed from `course.files.length`. If `localStorage.ss_uf_cache_<courseId>` exists but is empty (legit "no files" *or* prewarm hasn't reached this course yet), `_filesLoading` is forced `true` → spinner — even when the cache is actually authoritative.
- **B. Failed `_ufMerge` never clears the spinner.** The `.catch` at [line 245-247](frontend/js/features/courses/course-view.ts#L245-L247) sets `course._filesLoading = false` but does *not* re-render. The DOM was painted with the spinner; nothing replaces it.

Prewarm coverage is also a likely contributor (Fertigungstechnik probably wasn't warmed by the time the user clicked), but that is **out of scope for this PR** — we'd need measurement first.

## Fix — two surgical changes, two files

Files: `frontend/js/features/courses/course-view.ts` and the `.js` build twin.

### Change 1 — clear stuck spinner on `_ufMerge` failure

Replace the `.catch` with a re-render guarded by the same `myCourseSeq === window._courseOpenSeq` check the `.then` already uses:

```ts
.catch(() => {
  course._filesLoading = false;
  if (myCourseSeq === window._courseOpenSeq) {
    window._ssRestoring = true;
    showCourseSection(course, 'files');
    window._ssRestoring = false;
  }
});
```

Effect: when storage list errors / times out / aborts, the panel re-renders into either real cached files or the "No files yet — click Upload" copy. The spinner can no longer persist forever.

### Change 2 — distinguish "cache entry exists" from "cache has files", but keep a loading signal

Track whether the cache *entry* was present (not whether it has files). If present, skip the full-panel spinner — but show a small inline "refreshing…" pill until the background `_ufMerge` resolves, so the user knows we're still verifying.

Pseudocode for `openCourse`:

```ts
const ufCacheKey = 'ss_uf_cache_' + course.id;
const cachedJson = localStorage.getItem(ufCacheKey);
const hadCacheEntry = cachedJson != null;
// ... existing hydration from cachedJson ...

const hasAnyFiles =
  (course.files?.length ?? 0) > 0 ||
  (course.userFolders || []).some((fd) => fd.files && fd.files.length > 0);

// Show full-panel spinner ONLY when we have neither a cache entry nor any files.
// When we have a cache entry (even empty), trust it for first paint and show a
// subtle "refreshing" pill instead.
course._filesLoading = !hadCacheEntry && !hasAnyFiles;
course._filesRefreshing = hadCacheEntry; // background fetch in flight
```

In `buildFilesContent`, render the pill when `_filesRefreshing` is true (small, top-right of the files panel, non-blocking). Existing full-panel spinner only renders when `_filesLoading` is true.

After `_ufMerge` resolves (`.then` *or* the new `.catch` re-render), set `course._filesRefreshing = false`.

Effect: courses with cached files paint instantly. Courses with cache-known-empty paint as "No files yet" instantly (plus the refreshing pill). Only truly-first-time-ever opens show the full spinner.

### Out of scope (explicit, with reason)

- **Prewarm `CONCURRENCY` 4 → 8** — inference, not measurement. Could rate-limit Supabase or starve the in-focus course's list call. Don't ship without data. Note: the real bottleneck for high-folder-count courses may be the sequential `for` loop in [app-storage.js:465-467](frontend/js/app-storage.js#L465-L467) (one round-trip per folder), not list-call concurrency. Separate task.
- **Refactoring `_ufMergeImpl` folder listing into `Promise.all`** — bigger change, higher regression risk; needs its own scoped task and review.
- **Server-driven cache invalidation** (e.g. websockets, Supabase realtime) — out of scope; the "refreshing pill" handles cross-device staleness adequately.

## Files touched

- `frontend/js/features/courses/course-view.ts` (source)
- `frontend/js/features/courses/course-view.js` (build twin)

Maybe a few CSS lines for the pill in the inline style block of `buildFilesContent` (already inline; keep it inline to match the existing pattern).

## Verification

1. `npm run typecheck:frontend` passes.
2. Manual: open a course that was warmed by prewarm → files appear instantly, no full spinner, brief refreshing pill while the live fetch confirms.
3. Manual: hard-reload, immediately click a course before prewarm finishes → full spinner shows once, then files appear when `_ufMerge` resolves. (We can't avoid this case without prewarm fixes.)
4. Manual: DevTools → offline, open a course → spinner does NOT persist; falls back to "No files yet" or whatever the cache shows. **This validates Change 1.**
5. Manual: cross-device test — upload file on one tab/device, open course on another → cached state appears first, then refreshes to include new file. **This validates Change 2.**

## Risk

Low. Change 1 is purely additive (extra branch in `.catch`). Change 2 changes the *signal* shown for cache-empty case from spinner → "No files yet" + pill, which is the desired UX. If we hate the pill we can drop it and just remove the spinner — easy to tune.

## Commit

Single commit on `fix/courses-page`:

```
fix(courses): keep spinner from sticking on _ufMerge failure; show files from cache instantly
```
