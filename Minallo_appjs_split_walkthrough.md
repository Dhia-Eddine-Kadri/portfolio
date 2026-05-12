# Minallo `app.js` Split Walkthrough

This walkthrough explains how to continue splitting `frontend/js/app.js` in the current Minallo repository.

The goal is to move from a large compatibility/controller file toward a cleaner frontend architecture where:

```txt
main.js = starts the app
app.js = temporary compatibility bridge only, then removed
features/ = user-facing feature behavior
services/ = API, Supabase, storage, payment, AI calls
core/ = app-wide shell, navigation, state, theme, globals
utils/ = small reusable helpers
```

---

## 1. Current Situation

Your repository already has a good modular base:

```txt
frontend/js/
├── app.js
├── main.js
├── app-data.js
├── app-pdf.js
├── app-storage.js
├── auth-bootstrap.js
├── loader.js
├── router.js
├── minallo.js
├── supabase.js
├── config/
├── core/
├── features/
├── services/
└── utils/
```

You have already started moving code into:

```txt
frontend/js/features/
├── admin/
├── ai-chat/
├── auth/
├── courses/
├── pdf-viewer/
├── settings/
└── study-timer/
```

and services like:

```txt
frontend/js/services/
├── admin-service.js
├── ai-service.js
├── pdf-service.js
├── storage-service.js
└── subscription-service.js
```

This is good. The remaining problem is that `app.js` still behaves like a big compatibility/controller file.

---

## 2. Final Target

The final target should be:

```txt
frontend/js/main.js
```

becomes the real app entry point.

```txt
frontend/js/app.js
```

should become either:

```txt
temporary compatibility bridge only
```

or eventually:

```txt
removed completely
```

Target size:

```txt
main.js: 50-150 lines
app.js: 0-100 lines while migrating, then deleted
```

`app.js` should not contain:

```txt
auth modal logic
course rendering
file/folder logic
AI fetch calls
PDF rendering
music/Spotify/YouTube logic
Study Lounge rendering
admin backend calls
large event listener blocks
large HTML template strings
```

---

# Phase 1: Make `main.js` the Real Entry Point

Right now, `main.js` exists, but it should become the file that starts the app.

Create or update:

```txt
frontend/js/main.js
```

Example:

```js
import { initAppShell } from './core/app-shell.js';
import { initNavigation } from './core/navigation.js';
import { initAuthModal } from './features/auth/auth-modal.js';
import { initAuthIndicator } from './features/auth/auth-indicator.js';
import { initOnboarding } from './features/auth/onboarding.js';
import { initAdminPanel } from './features/admin/admin-panel.js';
import { initStudyTimer } from './features/study-timer/study-timer.js';
import { initStudyLounge } from './features/study-lounge/lounge-render.js';
import { initMusic } from './features/music/music.js';

document.addEventListener('DOMContentLoaded', async () => {
  initAppShell();
  initNavigation();

  initAuthModal();
  initAuthIndicator();
  initOnboarding();

  initStudyTimer();
  initStudyLounge();
  initMusic();

  initAdminPanel();

  window.Minallo?.markReady?.('main-js-ready', {});
});
```

The exact imports may differ depending on your final file names, but the idea is:

```txt
main.js initializes modules.
main.js does not contain feature logic.
```

---

# Phase 2: Keep `app.js` as a Temporary Bridge

During migration, some old HTML or inline handlers may still call functions on `window`.

Instead of keeping all logic in `app.js`, use it as a bridge:

```js
import { openCourse } from './features/courses/course-view.js';
import { openFile } from './features/pdf-viewer/pdf-viewer.js';
import { copyBubble, regenMsg } from './features/ai-chat/ai-message-actions.js';

window.openCourse = openCourse;
window.openFile = openFile;
window.copyBubble = copyBubble;
window.regenMsg = regenMsg;
```

This allows old buttons to keep working while you slowly remove inline `onclick` handlers.

Later, remove these bridges and use `addEventListener()` instead.

---

# Phase 3: Split Remaining Auth Code

You already have:

```txt
frontend/js/features/auth/
├── onboarding.js
└── user-data.js
```

Add:

```txt
frontend/js/features/auth/
├── auth-modal.js
├── auth-events.js
├── auth-indicator.js
├── onboarding.js
└── user-data.js
```

Move these from `app.js`:

```txt
auth form submit logic
sign in / sign up mode switch
password visibility toggles
auth state listener
updateAuthIndicator()
handleAuthClick()
landShowAuth()
auth modal open/close behavior
```

Suggested responsibilities:

```txt
auth-modal.js      = open/close auth modal, tab switching, password toggles
auth-events.js     = event listeners for auth forms/buttons
auth-indicator.js  = header/profile login state UI
onboarding.js      = onboarding flow
user-data.js       = profile/user data helpers
```

Temporary bridge:

```js
import { openAuthModal } from './features/auth/auth-modal.js';

window.landShowAuth = openAuthModal;
```

---

# Phase 4: Move Study Lounge Out of `app.js`

`app.js` still contains a Study Lounge block with stats and rendering logic.

Create:

```txt
frontend/js/features/study-lounge/
├── lounge-state.js
├── lounge-render.js
├── lounge-stats.js
└── lounge-events.js
```

Move these from `app.js`:

```txt
_statsTrackFile()
_statsStopFile()
_statsTrackAI()
_statsTrackGame()
_loungeRender()
_timeAgo()
recent file rendering
streak rendering
AI count rendering
game count rendering
study time rendering
```

Suggested responsibilities:

```txt
lounge-state.js   = state object and localStorage persistence
lounge-stats.js   = track file/AI/game/study-time activity
lounge-render.js  = render Study Lounge cards and activity rows
lounge-events.js  = button/event wiring
```

This is one of the biggest chunks that should leave `app.js`.

---

# Phase 5: Move Spotify / YouTube Music Code Out of `app.js`

`app.js` still contains music-related logic, such as Spotify PKCE, Spotify polling, YouTube playlist storage, and music UI controls.

Create:

```txt
frontend/js/features/music/
├── music.js
├── spotify-service.js
├── spotify-ui.js
├── youtube-playlists.js
└── music-events.js
```

Move these from `app.js`:

```txt
_spConnect()
_spExchangeCode()
_spApi()
_spPollPlayback()
_spUpdateUI()
_spDisconnect()
_ytGetPlaylists()
_ytSavePlaylists()
_ytRenderList()
_ytRenderSelect()
_ytAdd()
_ytRemove()
music control event listeners
playlist UI logic
```

Suggested responsibilities:

```txt
music.js              = initMusic(), coordinates Spotify + YouTube modules
spotify-service.js    = Spotify auth, token exchange, API calls
spotify-ui.js         = renders current Spotify player state
youtube-playlists.js  = local playlist storage and rendering
music-events.js       = connects buttons/dropdowns to handlers
```

This will make `app.js` much smaller.

---

# Phase 6: Clean Up AI Split

You already have:

```txt
frontend/js/features/ai-chat/
├── ai-ask.js
├── ai-chips.js
├── ai-export.js
├── ai-markdown.js
├── ai-message-actions.js
└── multi-summary.js
```

This is good.

The next step is to make sure all AI backend calls go through:

```txt
frontend/js/services/ai-service.js
```

Rule:

```txt
features/ai-chat/ = UI behavior
services/ai-service.js = backend request only
```

Move any direct AI `fetch()` calls from UI files into `ai-service.js`.

---

# Phase 7: Finish Course Split

You already have:

```txt
frontend/js/features/courses/
├── course-files.js
├── course-folders.js
├── course-render.js
├── course-view.js
└── courses-render.js
```

Add:

```txt
frontend/js/features/courses/
├── course-events.js
└── course-actions.js
```

Suggested responsibilities:

```txt
course-render.js        = render one course view/card
courses-render.js       = render course lists/grids
course-view.js          = selected course screen and section switching
course-files.js         = file upload/delete/move/download
course-folders.js       = folder create/delete/toggle/move
course-events.js        = button and click handler wiring
course-actions.js       = create/rename/delete/open course actions
```

Also consider renaming later:

```txt
course-render.js
courses-render.js
```

to clearer names:

```txt
course-card-render.js
courses-list-render.js
```

or merge them if they overlap.

---

# Phase 8: PDF Viewer Cleanup

You already have:

```txt
frontend/js/features/pdf-viewer/
├── pdf-text-extraction.js
└── pdf-viewer.js
```

If `pdf-viewer.js` is still large, split it into:

```txt
frontend/js/features/pdf-viewer/
├── pdf-viewer.js
├── pdf-render.js
├── pdf-toolbar.js
├── pdf-navigation.js
├── pdf-download.js
└── pdf-text-extraction.js
```

Suggested responsibilities:

```txt
pdf-viewer.js           = open/close viewer and coordinate modules
pdf-render.js           = render PDF pages
pdf-toolbar.js          = zoom, rotate, page controls, toolbar buttons
pdf-navigation.js       = current page, next/previous page
pdf-download.js         = download/export logic
pdf-text-extraction.js  = text extraction for AI
```

Keep:

```txt
frontend/js/services/pdf-service.js
```

for:

```txt
fetching PDF bytes
loading from storage/assets
normalizing PDF file sources
```

---

# Phase 9: Move Generic App Shell Stuff Out of `app.js`

Create or use:

```txt
frontend/js/core/
├── app-shell.js
├── pull-to-refresh.js
├── console-filter.js
├── theme.js
├── globals.js
└── state.js
```

Move from `app.js`:

```txt
sidebar icon setup
PDF worker config boot
pull-to-refresh
console warning suppression
night mode boot
window compatibility bridges
global state
```

Suggested responsibilities:

```txt
app-shell.js         = sidebar icons, app shell setup
pull-to-refresh.js   = mobile pull-to-refresh behavior
console-filter.js    = optional warning/noise filtering
theme.js             = dark mode / theme boot
globals.js           = temporary window bridges
state.js             = shared state object
```

---

# Phase 10: Add a Central State Module

Create:

```txt
frontend/js/core/state.js
```

Use it to replace scattered globals.

Example:

```js
export const appState = {
  currentUser: null,
  activeSemesterId: null,
  activeCourseId: null,
  activeFileName: null,
  selectedFiles: new Set(),
  settings: {},
  ui: {
    activeSection: null,
    pdfViewerOpen: false,
    aiPanelOpen: false
  }
};
```

Add helpers:

```js
export function setCurrentUser(user) {
  appState.currentUser = user;
}

export function setActiveCourse(courseId) {
  appState.activeCourseId = courseId;
}

export function clearSelectedFiles() {
  appState.selectedFiles.clear();
}
```

Instead of this pattern:

```js
let activeCourseId = null;
```

use:

```js
import { appState } from '../../core/state.js';

appState.activeCourseId = courseId;
```

---

# Phase 11: Add or Improve Frontend Services

Your `services` folder should eventually look like:

```txt
frontend/js/services/
├── api-client.js
├── auth-service.js
├── ai-service.js
├── admin-service.js
├── pdf-service.js
├── storage-service.js
├── course-service.js
├── chat-service.js
├── subscription-service.js
└── profile-service.js
```

## `api-client.js`

Use this as a shared fetch wrapper.

```js
export async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }

  return data;
}
```

The rule:

```txt
UI modules should call service functions.
UI modules should not contain raw backend endpoint details everywhere.
```

---

# Phase 12: Remove Inline Handlers Gradually

If your HTML has inline handlers like:

```html
<button onclick="openCourse('abc')">Open</button>
```

replace them with event listeners:

```html
<button class="course-open-btn" data-course-id="abc">Open</button>
```

Then:

```js
document.addEventListener('click', (event) => {
  const btn = event.target.closest('.course-open-btn');
  if (!btn) return;

  openCourse(btn.dataset.courseId);
});
```

This lets you remove `window.openCourse`.

Do this gradually, one feature at a time.

---

# Phase 13: Replace Unsafe `innerHTML`

While splitting `app.js`, improve rendering.

Avoid:

```js
card.innerHTML = `<h3>${course.name}</h3>`;
```

Prefer:

```js
const title = document.createElement('h3');
title.textContent = course.name;
card.append(title);
```

If you must use `innerHTML`, escape dynamic values:

```js
import { escapeHtml } from '../../utils/escape-html.js';

card.innerHTML = `
  <h3>${escapeHtml(course.name)}</h3>
`;
```

This is especially important for:

```txt
course names
folder names
file names
chat messages
profile names
AI-generated titles
room names
nicknames
```

---

# Recommended Practical Order

Do this in order:

```txt
1. Put real startup code into main.js
2. Make app.js a temporary compatibility bridge
3. Move auth modal logic out of app.js
4. Move Study Lounge block out of app.js
5. Move Spotify/YouTube music block out of app.js
6. Move remaining global shell utilities out of app.js
7. Add course-events.js and course-actions.js
8. Move remaining direct AI fetch calls into services/ai-service.js
9. Move remaining admin fetch calls into services/admin-service.js
10. Move remaining subscription fetch calls into services/subscription-service.js
11. Add core/state.js and replace globals gradually
12. Replace inline onclick handlers gradually
13. Replace unsafe innerHTML gradually
14. Remove app.js once main.js fully replaces it
```

---

# Suggested Commit Plan

Avoid one giant refactor commit. Use small commits:

```txt
commit 1: add main.js bootstrap
commit 2: add core/globals.js bridge
commit 3: move auth modal code
commit 4: move Study Lounge code
commit 5: move music code
commit 6: move shell/theme/pull-to-refresh code
commit 7: add course-events.js and course-actions.js
commit 8: move service fetch calls
commit 9: add state.js and migrate first globals
commit 10: remove unused app.js code
```

Each commit should keep the app working.

---

# How to Know You Are Done

You are done when:

```txt
main.js initializes the app
app.js is empty, tiny, or removed
no feature logic lives in app.js
most UI files do not call fetch directly
state is stored in core/state.js
feature modules have focused responsibilities
inline onclick handlers are mostly removed
unsafe innerHTML usage is reduced
```

Final ideal shape:

```txt
frontend/js/
├── main.js
├── config/
├── core/
│   ├── app-shell.js
│   ├── globals.js
│   ├── navigation.js
│   ├── state.js
│   ├── theme.js
│   └── pull-to-refresh.js
├── features/
│   ├── auth/
│   ├── courses/
│   ├── ai-chat/
│   ├── pdf-viewer/
│   ├── admin/
│   ├── settings/
│   ├── study-lounge/
│   ├── study-timer/
│   └── music/
├── services/
│   ├── api-client.js
│   ├── ai-service.js
│   ├── admin-service.js
│   ├── auth-service.js
│   ├── chat-service.js
│   ├── course-service.js
│   ├── pdf-service.js
│   ├── profile-service.js
│   ├── storage-service.js
│   └── subscription-service.js
└── utils/
    ├── clipboard.js
    ├── dom.js
    ├── escape-html.js
    ├── file-size.js
    ├── format-date.js
    └── validators.js
```

---

# Final Summary

Your repository is already moving in the right direction. You have the folders and many modules in place.

The biggest remaining work is to make `main.js` the real startup file and reduce `app.js` into a temporary bridge.

Priority:

```txt
main.js
auth split
Study Lounge split
music split
core shell split
course events/actions
service layer cleanup
state.js
remove globals
remove app.js
```

Do this gradually and test after every move.
