# Concurrency Bugs

## Status Key

- ✅ Fixed
- ⬜ Pending

---

## Critical

✅ **11. app.js ~line 940 — stale `openFile()` async PDF load can render after a newer file opens**

- `openFile(f, course)` starts async work for uploaded PDFs (`_ufFetchBytes(...).then(...)`) and bundled PDFs (`_fetchPdfBytes(...).then(...)`).
- There is no per-open request token checked before mutating shared globals/DOM such as `pdfDoc`, `pdfFullText`, `pdfBody`, `pdfFileName`, and `activeFileName`-dependent UI.
- If the user opens file A, then quickly opens file B, a slower response for file A can finish last and render file A into the viewer while the app state says file B is active.
- Better fix: increment a `pdfOpenSeq`/token at the start of `openFile()` and ignore all async continuations unless the token and file/course still match.

✅ **7. loader.js ~line 280 — `ss-ready` can fire before feature scripts finish loading**

- `loader.js` appends `toast/chat/chatbot/dashboard/profile/settings/...` scripts, then immediately appends `ai/ai.js`.
- `ss-ready` is dispatched from `ai/ai.js` `onload`, but none of the feature script loads are awaited.
- Concrete effects:
  - `supabase.js` can run `_enterApp()` / `loadUserData()` before `settings.js` loads.
  - `applySettings()` may restore `_autoOpenEnabled=false` / `_saveChatEnabled=false`, then `settings.js` later executes `var _autoOpenEnabled = true; var _saveChatEnabled = true;` and silently overwrites DB-restored preferences.
  - Restored/opened PDFs can call `openFile()` before `chat.js` wraps it, so per-PDF chat history does not load for that restored file.
- Better fix: make loader await all required feature scripts before dispatching `ss-ready`, or split `ss-ready` into `app-ready` and `features-ready` events with auth/data restore waiting for the latter.

✅ **8. app.js/router.js restore ordering — `_pendingPortalRestore` can be reset after `restoreState()` clears it**

- `app.js` has router stubs so early restore paths can run before `router.js` loads.
- During file/course restore, `restoreState()` sets `_pendingPortalRestore = null` because portal tab restore should not apply while entering files view.
- Later, `router.js` executes and assigns `_pendingPortalRestore` again from `sessionStorage.getItem('ss_portal_tab')`.
- Result: an old saved portal tab can be resurrected after a file/course restore, causing a later `showPortalSection('dashboard')` call to jump to the stale tab.
- Better fix: preserve the stub-cleared value or move pending portal tab initialization before any possible `restoreState()` call.

✅ **1. chatbot.js ~line 525 — `_busy` flag cleared in multiple paths**

- `_busy=false` existed in `.then()`, stop-typing branch, AND `.catch()` with no single-exit guarantee
- Fix: replaced all 3 with `_releaseBusy()` guarded by `_fetchDone` one-shot flag

✅ **2. dashboard.js ~line 644 — `setInterval` fires `_gcScheduleReminders()` every 5 min with no in-flight guard**

- If Google Calendar API is slow, next tick fires while previous fetch is still pending
- Pushes duplicate timers into `_gcReminderTimers`, shows duplicate reminder toasts for the same event
- Fix: added `_gcScheduling` boolean; concurrent calls return immediately; flag resets in `.catch().then()`

---

## Moderate

✅ **12. app.js ~line 913 — background `_ufMerge(course)` can redraw an old course after navigation**

- `openCourse(course)` renders cached files immediately, then starts `_ufMerge(course).then(function(){ showCourseSection(course, 'files'); ... })` in the background.
- If the user opens another course or a PDF before that merge finishes, the old course merge still calls `showCourseSection()` and can pull the UI back to the old course/files view.
- Better fix: capture the active course ID at merge start and only render/cache if `activeCourseId` still matches and the files view is still showing that course.

✅ **13. app.js ~line 1490 — folder delete fires remote deletes without awaiting them**

- Folder delete calls `_ufDeleteRemote(...)` inside `fd.files.forEach(...)` and immediately removes the folder locally/rerenders.
- If remote deletes are still pending or one fails, a later `_ufMerge(course)` can rediscover the files and make the deleted folder/files reappear.
- Better fix: collect delete promises, disable the folder controls, await `Promise.allSettled()`, then merge and show failures explicitly.

✅ **14. chatbot.js ~line 386 — course import modal can render stale `_ufMerge()` results**

- `_aipLoadCourseFiles(course)` sets `_aipActiveCourse = course`, starts `_ufMerge(course)`, then always calls `_aipRenderLevel()` when it resolves.
- If the user changes the selected course before the first merge resolves, the older merge can still refresh/render the modal against stale course data.
- Better fix: use an import-course load token or verify `_aipActiveCourse === course` before hiding the loader and rendering.

✅ **9. chat.js ~line 670/753 — stale `_chatOpenRoom()` continues after switching rooms**

- `_chatOpenRoom(roomA)` sets `_chatRoomId = roomA`, awaits `_chatLoad(true)`, then starts `_chatPollTimer`.
- If the user switches to `roomB` while room A is still loading, the room A async function continues after the await.
- Concrete effects:
  - A stale room load can render room A messages into the currently selected room B panel because `_chatLoad()` does not verify the room is still current before rendering.
  - Room A can start a polling interval after room B cleared the old timer, leaving an orphan interval that keeps running.
- Better fix: use a monotonically increasing room load token, check it after each await, and only install the poll timer if the token still matches.

✅ **10. chat.js ~line 754/818 — `_chatLoad(false)` polling has no in-flight or version guard**

- The 3-second interval calls `_chatLoad(false)` even if the previous fetch is still pending.
- If a slower older response returns after a newer response, it can move `_chatLastTs` backward.
- Duplicate DOM insertion is mostly blocked by `[data-mid]`, but the regressed timestamp causes later polls to refetch already-rendered messages and can reload reactions unnecessarily.
- Better fix: add `_chatLoading` or a request sequence number; ignore stale responses and avoid overlapping polls.

✅ **3. lecturenotes.js ~line 260 — fire-and-forget saves inside `forEach`**

- `summaries.forEach(s => lnSaveNoteToSupabase(s))` — no await, all uploads fire in parallel
- If user deletes a note before an in-flight upload completes, deleted note gets re-written to Supabase
- Fix: collect notes to save into `toSave[]`, then chain with `.reduce()` for sequential uploads

✅ **4. chat.js ~line 1165 — no re-entrance guard on `_chatSend()`**

- Double-clicking Send or pressing Enter twice passes slowmode check both times, fires two concurrent fetches
- Results in duplicate messages sent to the room
- Fix: added `_chatSending` boolean with `try/finally` so it always clears on success or error

✅ **5. dashboard.js ~line 310 — event listeners re-attached to notes widget on every `render()` call**

- `render()` is called after every drag/resize; each call adds new `click` listeners to `.nw-save`, `.nw-add-btn`, `.nw-cancel`
- One click on Save fires multiple `_nwSave()` API calls
- Fix: added `body._nwBound` flag; subsequent `render()` calls skip listener attachment and only call `body._nwRender()`

---

## Minor

✅ **15. chat.js ~line 1434 — GIF search responses can arrive out of order**

- The GIF input debounces requests, but `_chatSearchGifs(q)` has no search token/current-query check.
- A slower response for an older query can render after a newer query response, showing results that no longer match the search box.
- Better fix: track `_gifSearchSeq` or compare the current input value before calling `_chatRenderGifs()`.

✅ **6. writer.js ~line 764 — `_edSaveToSupabase()` called without await (fire-and-forget)**

- "Saved" badge disappeared after 3 seconds but Supabase upload may still be pending
- Closing browser in that window silently lost the cloud copy (localStorage was written, Supabase was not)
- Fix: `_edSaveDoc` made async; badge shown immediately on local save, timer only starts after cloud write resolves (success or error via `finally`)

---

## False Positive (Not a Bug)

❌ **merger.js renderList() — listener stacking claim was wrong**

- `renderList()` sets `list.innerHTML = ''` first, destroying all old DOM nodes and their listeners
- Fresh nodes are created each call — no stacking occurs
