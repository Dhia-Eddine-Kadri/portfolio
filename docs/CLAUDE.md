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
