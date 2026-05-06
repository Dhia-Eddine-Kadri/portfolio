# CLAUDE.md

## Stack
Pure vanilla JS, no build tools. Open `index.html` in browser. All JS shares `window` scope.

## Folder Structure
```
index.html          — app shell (entry point, stays at root)
css/styles.css      — all CSS; light/dark via --dp-solid, --on-glass CSS vars
js/loader.js        — fetches & injects all HTML sections; fires ss-ready when done
js/app.js           — all UI logic — navigation, course/file rendering, AI panel, state
js/supabase.js      — auth (_enterApp, _showModal), Supabase REST client, session restore
pages/              — HTML sections injected by loader.js (scripts inside do NOT run)
  landing.html      — logged-out landing page
  auth.html         — login/signup modal (#authModal)
  signup.html       — onboarding modal (#onboardModal)
  portal.html       — main dashboard (#portal, #psbDashboard, etc.)
  studip.html       — Stud.IP overlay (#studipDash, #sdCourseList) — position:fixed z-index:210
  files.html        — files/PDF view (#app) — position:fixed z-index:10
  modals.html       — misc modals
  toast.html        — toast notification
extension/          — Chrome browser extension (load this folder in chrome://extensions)
assets/             — media files
```

## HTML Injection Order (loader.js)
landing → auth → signup → toast → portal → modals → studip → files

## UI Navigation Map

### Landing page
| Action | Function | File |
|--------|----------|------|
| Any "Get started" / login CTA | `_googleAuth()` | `index.html` |
| Google One Tap passive sign-in | `_initOneTap()` → `_handleGoogleCredential()` | `index.html` |

### Auth modal
| Action | Function | File |
|--------|----------|------|
| "Continue with Google" | `_googleAuth()` | `index.html` |
| Email/password submit | `_showModal()` → Supabase signIn | `supabase.js` |
| After Google sign-in succeeds | `_verifyAndEnter()` → `_enterApp()` | `supabase.js` |

### Portal (dashboard)
| Action | Function | File |
|--------|----------|------|
| Nav pill clicks (Dashboard/Notes/etc.) | `setNavActive()` + `showPortalSection()` | `app.js` |
| "Stud.IP" card click | `showStudip()` | `app.js` |
| Night mode toggle (`#nightBtn`) | night mode handler | `app.js` |

### Stud.IP overlay (`#studipDash`)
| Action | Function | File |
|--------|----------|------|
| Course card click | `sdRenderCourses()` click handler → `hideStudip()` → `openCourse()` | `app.js` |
| Close / back arrow | `showPortal()` | `app.js` |
| Semester dropdown | `sdActiveSemId` change → `sdRenderCourses()` | `app.js` |

### Files / course view (`#app`)
| Action | Function | File |
|--------|----------|------|
| Sidebar course item click | `renderCourses()` click handler → `openCourse()` | `app.js` |
| Section tab (Files/Forum/etc.) | `showCourseSection(course, section)` | `app.js` |
| File row click ("Open") | `openFile(f, course)` | `app.js` |
| "← Back" button (`#goPortal`) | `showPortal()` | `app.js` |
| Sidebar toggle (`#sidebarToggle`) | sidebar visible toggle | `app.js` |
| Sidebar back (`#sbBack`) | returns to full course list | `app.js` |

### AI Panel
| Action | Function | File |
|--------|----------|------|
| Open (tab click / text select) | `openAI()` | `app.js` |
| Send message | `aiSend` handler → `POST /api/ai` | `app.js` |
| Close | `closeAI()` | `app.js` |

## Auth Flow (short)
1. `_googleAuth()` → tries One Tap → fallback: sets `ss_force_app` in sessionStorage → reload
2. Reload: `index.html` sees `ss_force_app` → sets `_ssIsLoggedIn=true` → `loader.js` loads full app → fires `ss-ready`
3. `supabase.js` `ss-ready` → `getUser()` → `_enterApp(user)` → shows portal (or auth modal if no session)
4. Google credential → `_handleGoogleCredential()` → Supabase token → `_onLoginSuccess()` → reload → portal

**Key gotcha:** Scripts inside injected HTML (`landing.html`, etc.) do NOT execute. Auth JS must live in `index.html`.

## State / Navigation
- `saveState()` / `restoreState()` — persist course/file view in `localStorage.ss_state`
- `ss_state.inApp=true` means user is in files view; `_enterApp` won't reset to portal if this is set
- `showStudip()` shows overlay; `hideStudip()` hides it and shows `#app`
- `showPortal()` hides `#app`, shows `#portal`

## loader.js — What It Does
Runs immediately after `supabase.js`. Reads `window._ssIsLoggedIn` (set by `index.html`) and branches:

| `_ssIsLoggedIn` | Action |
|----------------|--------|
| `false` | Fetches `landing.html`, injects via `innerHTML`, stops. `ss-ready` never fires. |
| `true` | Loads all app sections sequentially → loads `app.js` → fires `ss-ready` |

**Section load order (full app):**
```
auth.html → signup.html → toast.html → portal.html → modals.html → studip.html → files.html
```
After all sections: injects `app.js` as a `<script>` tag → on load fires `window.dispatchEvent(new Event('ss-ready'))`.

**Key rule:** Scripts inside injected HTML never execute (innerHTML limitation). All auth JS must live in `index.html`. `auth.html` contains only modal markup.

**Landing page CTAs** (`onclick="window._googleAuth()"`) are already wired inline — no extra binding in loader.js.

**Error handling:** If any section file 404s, loader logs the error and continues loading the rest so one missing file can't break the whole app.

## index.html — Script Block Reference
Runs before `supabase.js` and `loader.js`. Eight numbered sections:

| # | Name | What it does | Connects to |
|---|------|-------------|------------|
| 1 | Session routing IIFE | Sets `window._ssIsLoggedIn`. Checks `ss_logged_in` (sessionStorage), OAuth hash `#access_token`, query params (`token`, `code`), and `ss_force_app` flag | `loader.js` reads `_ssIsLoggedIn` |
| 2 | `_onLoginSuccess` | Sets `ss_logged_in='true'` → reloads. Called by `supabase.js:_enterApp` on first login | `supabase.js:_enterApp` |
| 3 | Constants | `_GCID` (Google client ID), `_SUPA` (Supabase URL), `_SAKEY` (anon key), `_REDIRECT` (OAuth return URL) | Used by sections 4–6 |
| 4 | `_oauthFallback()` | Redirects to Supabase Google OAuth. The bulletproof fallback | Called by sections 5, 7 |
| 5 | `_handleGoogleCredential(r)` | Exchanges Google ID token → Supabase `access_token` via `grant_type=id_token`. On success calls `_onLoginSuccess()`; on failure calls `_oauthFallback()` | GSI callback, `_onLoginSuccess`, `_oauthFallback` |
| 6 | `_initOneTap()` | Inits GSI, auto-prompts on landing page. Sets `_oneTapBlocked=true` if FedCM blocks/dismisses | Called by section 8 when GSI loads |
| 7 | `_googleAuth()` | Entry point for all login CTAs. In app shell → `_oauthFallback()`. On landing → try One Tap → fallback: sets `ss_force_app + ss_show_auth` → reload | `landing.html` CTAs, `auth.html` Google button |
| 8 | GSI load watcher | `setInterval` polls until `google.accounts` is ready, then calls `_initOneTap()` | Triggers section 6 |

**Activity tracker** (second `<script>` block): event listeners on `mousemove/keydown/click/touchstart/scroll` → update `ss_last_active` in sessionStorage. Used by `supabase.js` session timeout (30 min).

**Login CTA flow:** click → `_googleAuth()` → One Tap or `ss_force_app` reload → `loader.js` loads full app → `supabase.js ss-ready` → session restored or `_showModal()`.

## auth.html — What Lives Here
Only the `#authModal` markup. **No scripts** — all auth JS is in `index.html` and `app.js`.

| Element | Purpose | Wired by |
|---------|---------|----------|
| `#authModal` | Full-screen overlay; `display:flex` = visible | `_showModal()` in `supabase.js` |
| `#authEmail`, `#authPassword` | Login credentials | `app.js` authSubmit handler |
| `#authSubmit` | Sign In / Create Account button | `app.js` authSubmit click + Enter key |
| `#authSwitch` | Toggle signin ↔ signup mode | `app.js` authSwitch click |
| `#googleSignIn` | "Continue with Google" | `onclick="window._googleAuth()"` → `index.html` |
| `#staySignedIn` | Persist token in localStorage | read by `supabase.js` `signIn()` |
| `#authError` | Error message bar | `showAuthError()` / `hideAuthError()` in `app.js` |
| `#authTitle` | Heading text | `_setAuthMode()` in `app.js` |
| `#authConfirmWrap` | Confirm-password field (signup only) | `_setAuthMode()` in `app.js` |
| `#pwStrengthWrap` | Password strength bars (signup only) | `app.js` authPassword input handler |

## app.js — Function Reference

### Navigation
| Function | Purpose | Called from |
|----------|---------|------------|
| `showStudip()` | Animates Stud.IP overlay in, hides portal | `pcStudip` click, `showApp()` |
| `hideStudip()` | Instantly hides Stud.IP overlay | course card click in `sdRenderCourses()` |
| `showPortal()` | Shows portal, hides #app + Stud.IP | `goPortal`, `studipBack`, `showApp()` fallback |
| `showApp()` | Alias for `showStudip()` + push history | history nav |
| `setNavActive(id)` | Highlights active portal nav pill | portal nav clicks |
| `showPortalSection(sec)` | Shows one `.portal-section`, hides others | nav clicks, `_enterApp` |
| `openSB()` / `closeSB()` | Sidebar open/close | sidebar toggle, sbClose btn |
| `showToast(title, sub)` | Shows toast notification for 6 s | throughout |

### Course & File Loading
| Function | Purpose |
|----------|---------|
| `renderCourses()` | Populates sidebar course list for active semester |
| `openCourse(course)` | Switches to course view, builds sidebar nav, shows overview |
| `showCourseSection(course, sec)` | Shows a tab (Files/Forum/etc.) in the course overview |
| `openFile(f, course)` | Decodes base64 PDF → pdf.js → text extraction → updates AI panel |
| `buildSbCourseNav(course, sec)` | Builds accordion sections in sidebar course view |
| `renderTT()` / `renderMails()` | Populates timetable / mail sidebar lists |
| `sdRenderCourses()` / `sdRenderTT()` / `sdRenderMails()` | Populates Stud.IP overlay cards |

### PDF Controls
| Function | Purpose |
|----------|---------|
| `renderPages()` | Renders visible PDF pages with text layer |
| `updatePageInfo()` | Updates page counter |
| `updateZoomPct()` | Updates zoom % label |
| `downloadFile(fname)` | Triggers download of current PDF |

### AI Panel
| Function | Purpose |
|----------|---------|
| `openAI()` / `closeAI()` / `forceCloseAI()` | Show/hide AI panel |
| `askAI(question, skipUserBubble)` | POSTs to `/api/ai`, streams response with typewriter effect |
| `stopGeneration()` | Cancels in-flight generation |
| `addBotMsg(text)` | Appends bot message bubble |
| `addUserMsg(text)` | Appends user message bubble |
| `chipPrompt(type, level)` | Sends a quick-action prompt (summarise/quiz/etc.) |
| `showSelectionBanner(txt)` | Shows "Ask AI about this?" banner on text selection |
| `renderMarkdown(text)` | Converts `**bold**`, `` `code` ``, `### h3`, `- list` → HTML with proper `<ul>` |
| `serializeChatDOM()` / `saveChatForFile()` / `loadChatForFile()` | Per-PDF chat persistence in localStorage |

### Lecture Notes
| Function | Purpose |
|----------|---------|
| `lnLoadFromSupabase(uid)` | Fetches notes from `lecture_notes` table |
| `lnRender(summaries)` | Renders note cards grid |
| `lnRenderMarkdown(text)` | Same as `renderMarkdown` but with `## h3` + `### h4` support |
| `lnSaveNoteToSupabase(note)` | Upserts note to Supabase |
| `lnDeleteNoteFromSupabase(id)` | Deletes note from Supabase |
| `runMultiSummary(fnames, course)` | Combines multiple PDFs → single AI summary |

### Auth & User
| Function | Purpose |
|----------|---------|
| `_setAuthMode(mode)` | Switches modal between `signin` / `signup` |
| `showAuthError(msg)` / `hideAuthError()` | Shows/hides `#authError` bar |
| `updateAuthIndicator(user)` | Updates avatar initial + display name in topbar |
| `handleAuthClick()` | Topbar auth button: sign out if logged in, else open modal |
| `loadUserData(uid)` | Loads profile + settings + subscription from Supabase; falls back to localStorage cache |
| `applyProfile(p)` / `applySettings(s)` / `applySubscription(sub)` | Apply loaded data to UI fields |
| `saveProfile()` / `saveSettings(patch)` | Save profile/settings to Supabase |

### State & History
| Function | Purpose |
|----------|---------|
| `saveState()` / `restoreState()` | Persist course/file view in `localStorage.ss_state` |
| `_ssPushHistory()` / `_ssReplaceHistory()` | Browser history management |
| `_ssApplyHistoryState(state)` | Restores view from popstate event |

### Onboarding
| Function | Purpose |
|----------|---------|
| `_showOnboarding(email)` | Shows `#onboardModal` |
| `_obNext()` / `_obBack()` | Step 1 → Step 2 navigation |
| `_obFinish()` | Saves profile to Supabase + localStorage, closes modal |

**Key rules for app.js:**
- All DOM listeners are at top level (app.js executes after all HTML is injected by loader.js)
- Night mode preference stored in `localStorage.ss_dark` (persists across restarts)
- Chat history stored per-file in `localStorage` under key `ss_chat_<filename>`

## Dev Agents (agents.py)

Three sub-agents I invoke myself to work faster and avoid mistakes.
Requires: `pip install claude-agent-sdk` (one-time setup).

| Agent | When I use it | Command |
|-------|--------------|---------|
| **research** | Before implementing anything requiring external knowledge (API specs, browser APIs, Supabase features) | `python agents.py research "<question>"` |
| **qa** | After editing any JS or HTML file — before telling the user I'm done | `python agents.py qa <file1> [file2 ...]` |
| **review** | Before finishing a multi-file task or a complex function | `python agents.py review <file>` |

### When I MUST use each agent

**research** — use when:
- Implementing Stud.IP API integration (endpoints, auth flows, response shapes)
- Unsure about a browser API, Supabase method, or OAuth spec
- The task involves an external system I haven't seen in this codebase

**qa** — use when:
- I edited app.js, supabase.js, loader.js, or index.html
- I added new DOM IDs or renamed existing ones
- I added new localStorage keys
- Any async change was made

**review** — use when:
- I wrote more than ~30 lines of new code
- I refactored an existing function
- The task involved auth, tokens, or user data

### Rules
- Run qa BEFORE declaring any code task complete
- Act on the findings — fix all CRITICAL and HIGH issues found
- If agents.py isn't installed yet, note it to the user once, then proceed without

## Rules
- **After every edit, tell the user which file(s) were modified.**
- No frameworks — use `getElementById`, `querySelector`, event listeners
- Light/dark mode: CSS vars in `styles.css`; night class is `body.night`
- PDF rendering: pdf.js v3.11.174 from CDN
