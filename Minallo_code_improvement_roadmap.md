# Minallo Code Improvement Roadmap

This document summarizes the recommended improvements for the `frontend` and `backend` parts of the Minallo repository.

## Overall Assessment

Minallo is already moving in a good direction. The project is functional, ambitious, and has a clearer folder structure than before. The current structure shows that the app is growing beyond a simple static website, especially with AI, PDF handling, subscriptions, backend functions, and possible future real-time features.

The main goal now is to make the codebase easier to maintain, safer, easier to deploy, and more professional.

---

## 1. Frontend Structure Improvements

### Current Situation

The frontend is already separated into useful folders such as:

```txt
frontend/
├── ai/
├── assets/
├── css/
├── extension/
├── features/
├── js/
├── pages/
├── index.html
└── privacy.html
```

The `features` folder is a strong improvement because it groups app areas by feature, such as:

```txt
features/
├── chat/
├── chatbot/
├── dashboard/
├── editor/
├── games/
├── lecturenotes/
├── practice/
├── profile/
├── settings/
├── subscription/
└── toast/
```

This is the correct direction.

### What to Improve

#### 1.1 Split the large `app.js`

The biggest frontend issue is that `frontend/js/app.js` is too large and handles too many responsibilities.

It likely includes logic for:

```txt
UI state
course rendering
file rendering
PDF handling
navigation
local storage
portal sections
event listeners
helper functions
```

This makes the file harder to debug and harder to maintain.

### Recommended Structure

Refactor gradually toward something like:

```txt
frontend/js/
├── core/
│   ├── state.js
│   ├── dom.js
│   ├── router.js
│   └── events.js
│
├── services/
│   ├── supabase-service.js
│   ├── file-service.js
│   ├── pdf-service.js
│   └── ai-service.js
│
├── features/
│   ├── courses/
│   │   ├── courses-render.js
│   │   ├── courses-events.js
│   │   └── courses-service.js
│   │
│   ├── pdf-viewer/
│   │   ├── pdf-render.js
│   │   └── pdf-events.js
│   │
│   ├── portal/
│   └── study-tools/
│
└── main.js
```

### Suggested Refactor Order

Start small. Do not rewrite everything at once.

```txt
1. Move course rendering logic out of app.js
2. Move file rendering logic out of app.js
3. Move PDF logic into a PDF module
4. Move Supabase calls into a service module
5. Move localStorage/sessionStorage logic into storage utilities
6. Keep app.js or main.js as the entry point only
```

---

## 2. Frontend Naming Improvements

### Rename `lecturenotes`

Current:

```txt
lecturenotes/
```

Recommended:

```txt
lecture-notes/
```

Reason: `lecture-notes` is more readable and follows common kebab-case naming.

### Consider Renaming `css`

Current:

```txt
frontend/css/
```

Recommended:

```txt
frontend/styles/
```

Possible structure:

```txt
frontend/styles/
├── variables.css
├── global.css
├── layout.css
├── components.css
└── pages.css
```

Reason: `styles` feels more professional and can contain more than just plain CSS files.

---

## 3. Safer Frontend Rendering

### Current Concern

If parts of the UI are generated using large template strings and `innerHTML`, the code becomes harder to maintain and can become risky if user-generated content is inserted without escaping.

Example of something to avoid when rendering user-generated values:

```js
container.innerHTML = `
  <h3>${course.name}</h3>
`;
```

If `course.name` ever contains unexpected HTML, this can become unsafe.

### Better Approach

Use DOM methods for dynamic user data:

```js
function createCourseCard(course) {
  const card = document.createElement('button');
  card.className = 'course-card';

  const title = document.createElement('h3');
  title.textContent = course.name;

  card.append(title);
  return card;
}
```

### Priority Areas

Refactor rendering for:

```txt
course cards
file names
folder names
user profile names
AI-generated titles or summaries
uploaded document names
```

---

## 4. Backend Structure Improvements

### Current Situation

The backend functions are separated into serverless files such as:

```txt
backend/functions/
├── admin-users.js
├── ai.js
├── create-checkout.js
├── create-portal.js
├── stripe-webhook.js
└── verify-payment.js
```

This is a good serverless layout.

### Main Improvement

Several backend files likely repeat similar logic, such as:

```txt
CORS headers
Supabase auth verification
Supabase REST calls
JSON responses
error responses
Stripe setup
environment variable checks
```

Repeated logic should be moved into shared utility files.

### Recommended Backend Structure

```txt
backend/
├── functions/
│   ├── admin-users.js
│   ├── ai.js
│   ├── create-checkout.js
│   ├── create-portal.js
│   ├── stripe-webhook.js
│   └── verify-payment.js
│
└── lib/
    ├── cors.js
    ├── responses.js
    ├── supabase-auth.js
    ├── supabase-rest.js
    ├── stripe.js
    └── validation.js
```

### Example Utilities

#### `cors.js`

```js
export const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
```

#### `responses.js`

```js
export function jsonResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  };
}
```

#### `supabase-auth.js`

```js
export async function verifySupabaseUser(authHeader) {
  if (!authHeader) {
    throw new Error('Missing authorization header');
  }

  // Verify the Supabase JWT here.
}
```

---

## 5. Backend Security Improvements

### 5.1 Move Environment-Specific Values Into Environment Variables

Avoid hardcoded production values in backend functions.

Use environment variables for:

```txt
Supabase URL
Supabase anon key
Supabase service role key
OpenAI API key
Stripe secret key
Stripe webhook secret
allowed frontend origin
admin email or admin role config
```

Add a `.env.example` file:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
ALLOWED_ORIGIN=
ADMIN_EMAIL=
```

Never commit the real `.env` file.

### 5.2 Validate AI Requests

The AI function should validate:

```txt
message count
message length
allowed roles
max_tokens limit
request body size
authenticated user
subscription/payment status if required
```

Example checks:

```txt
Reject requests with too many messages
Reject messages that are too long
Clamp max_tokens to a safe upper limit
Only allow roles: system, user, assistant
Do not let the frontend fully control expensive model settings
```

### 5.3 Improve Admin Handling

If admin access is currently based on one `ADMIN_EMAIL`, that works for a small project, but a more scalable approach would be:

```txt
Supabase user role
admin claim
admins table
role-based access control
```

Example:

```txt
users table
├── id
├── email
└── role: "student" | "admin"
```

### 5.4 Payment Security

For Stripe:

```txt
Keep webhook signature verification
Never trust payment status only from the frontend
Use the webhook as the source of truth
Store subscription/payment state server-side
Verify authenticated user before creating a checkout session
```

---

## 6. Testing Improvements

Before adding automated deployment, add basic checks.

### Recommended Tools

```txt
ESLint
Prettier
basic frontend smoke tests
backend function unit tests
GitHub Actions checks
```

### Suggested Scripts

In `package.json`, add scripts similar to:

```json
{
  "scripts": {
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "node --test"
  }
}
```

### First Tests to Add

Start with simple tests:

```txt
Does the frontend load without JS syntax errors?
Do backend functions reject unauthenticated requests?
Does the AI function reject invalid payloads?
Does checkout creation require a valid user?
Does the webhook reject invalid signatures?
```

---

## 7. GitHub Actions Pipeline

### Recommended Flow

Avoid auto-merging directly to `main`.

Use this professional workflow instead:

```txt
feature branch
↓
pull request
↓
tests and lint checks
↓
manual review or approval
↓
merge to main
↓
build Docker image
↓
deploy to server
```

### Why This Is Better

```txt
main always stays deployable
broken code does not reach production
you can review changes before deployment
the deployment only happens after tests pass
rollback becomes easier
```

### Example GitHub Actions Checks

Create:

```txt
.github/workflows/test.yml
```

Example:

```yaml
name: Test

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Check formatting
        run: npm run format:check

      - name: Run lint
        run: npm run lint

      - name: Run tests
        run: npm test
```

---

## 8. Docker Improvements

### Why Docker Helps

Docker will make the project easier to deploy and more professional.

Benefits:

```txt
same environment locally and on the server
easier deployment
easier rollback
cleaner production setup
more reliable builds
better separation between frontend, backend, and workers
```

### Suggested Future Structure

```txt
Minallo/
├── frontend/
├── backend/
├── transcriber/
├── docker/
│   ├── nginx.conf
│   └── compose.prod.yml
├── .github/
│   └── workflows/
│       ├── test.yml
│       └── deploy.yml
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .env.example
└── README.md
```

### Deployment Flow With Docker

```txt
push to main
↓
GitHub Actions runs tests
↓
GitHub Actions builds Docker image
↓
image is pushed to GitHub Container Registry
↓
server pulls latest image
↓
server restarts container
```

### Important

Do Docker in stages:

```txt
1. Add Dockerfile
2. Build image locally
3. Add docker-compose.yml
4. Add GitHub Action to build image
5. Push image to registry
6. Deploy image to server
```

---

## 9. WebSocket / Real-Time Improvements

WebSockets are useful, but only for features that need live updates.

### Good WebSocket Use Cases for Minallo

```txt
live file upload status
PDF processing status
transcription progress
AI chat streaming
real-time notifications
collaborative notes
study session timer sync
```

### Best First WebSocket Feature

The best first real-time feature would be:

```txt
Live processing status for uploaded files
```

Example UI:

```txt
Lecture_01.pdf

✓ Uploaded
✓ Text extracted
⏳ Generating summary...
○ Creating flashcards...
○ Ready for study mode
```

### Do Not Use WebSockets For

```txt
loading courses
opening files
saving settings
basic login
normal CRUD actions
basic dashboard data
```

Use normal HTTP requests for those.

### Possible Future Architecture

```txt
Frontend
  ↓ HTTP
Backend API
  ↓
Database / Supabase

Frontend
  ↓ WebSocket
Realtime server
  ↓
AI/transcription worker
```

Advanced Docker setup later:

```txt
docker-compose.yml
├── frontend
├── backend-api
├── websocket-server
├── transcriber-worker
└── redis
```

---

## 10. README Improvements

The README should match the real current structure.

Update the project structure section so it does not describe old files that no longer match the repo.

Recommended README sections:

```txt
Project name
Description
Features
Tech stack
Screenshots
Folder structure
How to run locally
Environment variables
Testing
Deployment
Roadmap
```

### Add Screenshots

Include screenshots for:

```txt
landing page
courses page
dashboard
chat/AI feature
file viewer
subscription flow if ready
```

### Add `.env.example`

This helps other developers understand what environment variables are needed without exposing secrets.

---

## 11. Priority Checklist

Use this as the main action list.

### High Priority

```txt
[x] Split frontend/js/app.js into smaller modules
[x] Move repeated backend logic into backend/lib
[x] Add .env.example
[x] Move hardcoded environment values into env variables
[x] Add validation to AI backend function
[x] Add validation to payment/backend functions
[x] Update README project structure
```

### Medium Priority

```txt
[ ] Rename lecturenotes to lecture-notes
[ ] Consider renaming frontend/css to frontend/styles
[x] Replace unsafe innerHTML rendering with DOM methods where user data is involved
[x] Add ESLint
[x] Add Prettier
[ ] Add basic tests
[ ] Add GitHub Actions test workflow
```

### Later / Advanced

```txt
[ ] Dockerize the app
[ ] Add Docker image build pipeline
[ ] Add deployment pipeline to hosted server
[ ] Add WebSocket server for live processing updates
[ ] Add Redis if background jobs need real-time status updates
[ ] Add staging environment
[ ] Add automatic rollback strategy
```

---

## 12. Suggested Development Order

Recommended order to avoid overwhelming rewrites:

```txt
1. Update README and add .env.example
2. Add ESLint and Prettier
3. Split the largest frontend sections out of app.js
4. Create backend/lib utilities
5. Add backend input validation
6. Add simple tests
7. Add GitHub Actions test workflow
8. Add Dockerfile and docker-compose.yml
9. Add image build pipeline
10. Add server deployment
11. Add WebSocket features only when needed
```

---

---

# App.js Professional Restructuring Plan

This section explains how to split `frontend/js/app.js` into smaller, cleaner, professional modules.

## Why `app.js` Needs Refactoring

The current `app.js` is doing too many jobs in one place. It contains logic for:

```txt
sidebar icons
PDF.js setup
pull-to-refresh behavior
global AI helper functions
night mode
router/navigation helpers
portal navigation
course rendering
course opening
file and folder management
PDF opening
multi-file AI summary
translations/language switching
settings
admin panel logic
```

This makes the file hard to maintain because every new feature increases the risk of breaking unrelated parts of the app.

The goal is to make `app.js` or `main.js` responsible only for starting the application.

---

## Target Frontend JavaScript Structure

A cleaner professional structure would look like this:

```txt
frontend/js/
├── main.js
│
├── config/
│   ├── icons.js
│   ├── pdf-config.js
│   └── constants.js
│
├── core/
│   ├── dom.js
│   ├── state.js
│   ├── navigation.js
│   ├── panels.js
│   ├── history.js
│   └── events.js
│
├── services/
│   ├── pdf-service.js
│   ├── ai-service.js
│   ├── storage-service.js
│   ├── course-storage-service.js
│   └── admin-service.js
│
├── features/
│   ├── courses/
│   │   ├── courses-render.js
│   │   ├── courses-actions.js
│   │   ├── course-view.js
│   │   ├── course-files.js
│   │   └── course-folders.js
│   │
│   ├── pdf-viewer/
│   │   ├── pdf-viewer.js
│   │   ├── pdf-download.js
│   │   └── pdf-text-extraction.js
│   │
│   ├── ai-chat/
│   │   ├── ai-panel.js
│   │   ├── ai-message-actions.js
│   │   ├── ai-markdown.js
│   │   └── multi-file-summary.js
│   │
│   ├── settings/
│   │   ├── language.js
│   │   └── settings.js
│   │
│   └── admin/
│       └── admin-panel.js
│
└── utils/
    ├── escape-html.js
    ├── clipboard.js
    ├── local-storage.js
    └── ui-helpers.js
```

---

## What Should Move Where

## 1. `config/icons.js`

Move the sidebar icon map and sidebar icon setup into this file.

Current responsibility in `app.js`:

```txt
ICONS object
sidebar sprite setup
data-sprite background image assignment
```

Suggested file:

```js
export const ICONS = {
  home: 'assets/icon-home.png',
  courses: 'assets/icon-courses.png',
  notes: 'assets/icon-notes.png',
  lounge: 'assets/icon-lounge.png',
  editor: 'assets/icon-editor.png',
  chat: 'assets/icon-chat.png',
  notifications: 'assets/icon-notifications.png',
  games: 'assets/icon-games.png',
  chatbot: 'assets/icon-chatbot.png',
  profile: 'assets/icon-profile.png',
  settings: 'assets/icon-settings.png',
  subscription: 'assets/icon-subscription.png'
};

export function applySidebarIcons() {
  Object.keys(ICONS).forEach((name) => {
    document.querySelectorAll(`.sb-sprite[data-sprite="${name}"]`).forEach((el) => {
      el.style.backgroundImage = `url("${ICONS[name]}")`;
    });
  });
}
```

---

## 2. `config/pdf-config.js`

Move PDF.js setup and static demo PDF configuration here.

Current responsibility in `app.js`:

```txt
PDF_DATA
pdfjsLib.GlobalWorkerOptions.workerSrc
```

Suggested file:

```js
export const PDF_DATA = {
  'Aufgabe_1_3.pdf': 'assets/Aufgabe_1_3.pdf'
};

export function configurePdfJs() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}
```

---

## 3. `core/navigation.js`

Move navigation-related functions here.

Functions to move:

```txt
showPortal()
showStudip()
hideStudip()
showApp()
setNavActive()
showPortalSection()
_navTo()
```

This file should only handle app navigation and section switching.

It should not contain:

```txt
course rendering
PDF rendering
AI logic
admin logic
file upload logic
```

---

## 4. `core/panels.js`

Move generic panel visibility helpers here.

Functions to move:

```txt
_showFilesView()
_hideFilesView()
_panelShow()
_panelHide()
```

These helpers are shared UI utilities and should be isolated from feature logic.

---

## 5. `features/courses/courses-render.js`

Move course rendering logic here.

Functions to move:

```txt
renderCourses()
sdRenderCourses()
```

Purpose:

```txt
render course cards
render sidebar course list
render file count badges
render empty course states
```

Recommended exported functions:

```js
export function renderSidebarCourses(state, handlers) {
  // Render course list in sidebar or portal area.
}

export function renderDashboardCourses(state, handlers) {
  // Render main Minallo course cards.
}
```

Important improvement: avoid rendering user-generated course names with raw `innerHTML`.

Avoid:

```js
card.innerHTML = `
  <h3>${course.name}</h3>
`;
```

Prefer:

```js
const title = document.createElement('h3');
title.textContent = course.name;
card.append(title);
```

This makes the UI safer and easier to maintain.

---

## 6. `features/courses/course-view.js`

Move course page/view state logic here.

Functions to move:

```txt
openCourse()
showCourseSection()
```

`openCourse()` should control:

```txt
active course state
course breadcrumb
course title
course section rendering
course file refresh
```

`showCourseSection()` is currently doing too much and should eventually be split further.

Recommended split:

```txt
course-view.js        controls active course and section switching
course-files.js       handles file list rendering and file actions
course-folders.js     handles folder actions
course-events.js      binds course page event listeners
```

---

## 7. `features/courses/course-files.js`

Move file-specific course logic here.

Logic to move from `showCourseSection()`:

```txt
rendering files
selecting multiple files
multi-delete
multi-move
download file button
upload file button
file row click handlers
file action menus
```

Suggested functions:

```js
export function renderFilesSection(course) {
  // Render files for the current course.
}

export function bindFileEvents(course) {
  // Attach file-related listeners.
}

export function getSelectedFiles() {
  // Return selected file IDs or names.
}

export function clearSelectedFiles() {
  // Clear selected file state.
}
```

---

## 8. `features/courses/course-folders.js`

Move folder-specific logic here.

Logic to move:

```txt
_showFolderPickerPopup()
new folder creation
folder toggle
folder delete
folder upload
folder select all
move selected files to folder
```

Folder logic should not be mixed with PDF viewing or AI logic.

---

## 9. `features/pdf-viewer/pdf-viewer.js`

Move PDF opening and viewer state here.

Functions/logic to move:

```txt
openFile()
PDF viewer visibility
active file state
PDF loading messages
file breadcrumb updates
PDF render trigger
```

This file should control the PDF viewer experience.

---

## 10. `services/pdf-service.js`

Move PDF data loading here.

Functions/logic to move:

```txt
_fetchPdfBytes()
fetch PDF from local asset
fetch PDF from uploaded storage
handle PDF byte errors
```

This service should not directly manipulate the UI. It should fetch and return data.

Example purpose:

```js
export async function fetchPdfBytes(file) {
  // Return ArrayBuffer or Uint8Array for a PDF file.
}
```

---

## 11. `features/pdf-viewer/pdf-text-extraction.js`

Move PDF text extraction logic here.

This is especially important for AI summaries and multi-file analysis.

Responsibilities:

```txt
read PDF pages
extract text
normalize extracted text
return text to AI features
```

---

## 12. `features/ai-chat/ai-message-actions.js`

Move AI message action helpers here.

Functions to move:

```txt
copyBubble()
fallbackCopy()
regenMsg()
```

Also reduce inline `onclick` usage over time.

Prefer:

```js
button.addEventListener('click', () => {
  copyBubble(messageId);
});
```

Instead of:

```html
<button onclick="copyBubble('message-1')">Copy</button>
```

---

## 13. `features/ai-chat/multi-file-summary.js`

Move multi-file AI summary logic here.

Responsibilities:

```txt
selected PDFs
multi-summary modal state
extracting text from several files
sending selected file context to AI
saving summary output
opening AI panel with generated context
```

This is a real feature and deserves its own file.

---

## 14. `features/ai-chat/ai-markdown.js`

Move markdown and math rendering logic here.

Logic to move:

```txt
display math blocks
$$ math blocks
fenced code blocks
headings
horizontal rules
blockquotes
numbered lists
bullet lists
paragraphs
KaTeX rendering helpers
```

This logic should not be mixed into the main app startup file.

---

## 15. `features/settings/language.js`

Move translations and language helpers here.

Functions/data to move:

```txt
_translations
_t()
applyLanguage()
```

Suggested structure:

```js
export const translations = {
  en: {},
  de: {}
};

export function t(key) {
  // Return translated string.
}

export function applyLanguage(lang) {
  // Apply current language to UI.
}
```

---

## 16. `features/settings/settings.js`

Move user settings logic here.

Logic to move:

```txt
applySettings()
night mode preference syncing
auto-open AI setting
save chat history setting
YouTube playlist settings
settings event listeners
```

This keeps settings separate from courses, PDFs, and AI logic.

---

## 17. `features/admin/admin-panel.js`

Move admin UI logic here.

Functions/logic to move:

```txt
_adminShowIfEligible()
_adminSearch()
admin search button listeners
admin search input listeners
admin results rendering
```

Important: the frontend should only show or hide admin UI. Real admin authorization must always happen in the backend.

---

## 18. `utils/escape-html.js`

Create a small escaping utility for places where HTML strings are still necessary.

Example:

```js
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
```

Use this when you absolutely must insert dynamic content into an HTML string.

---

## 19. `core/state.js`

Create one central state module.

Right now the app relies on many global variables.

Examples of global state that should eventually move into `state.js`:

```txt
activeSemId
activeCourseId
activeFileName
SEMS
COLORS
_currentUser
selected files
current language
current settings
```

Suggested state shape:

```js
export const appState = {
  activeSemesterId: null,
  activeCourseId: null,
  activeFileName: null,
  currentUser: null,
  selectedFiles: new Set(),
  settings: {}
};
```

Later, add helper functions:

```js
export function setActiveCourse(courseId) {
  appState.activeCourseId = courseId;
}

export function getActiveCourse() {
  // Return active course object.
}
```

---

## 20. `services/storage-service.js`

Move localStorage/sessionStorage helpers here.

Responsibilities:

```txt
read user settings
save user settings
read cached courses
save cached courses
read uploaded file metadata
save uploaded file metadata
```

Do not let every feature access localStorage directly. Centralizing storage reduces bugs.

---

## 21. `services/ai-service.js`

Move AI API calls here.

Responsibilities:

```txt
send chat request
send summary request
handle AI backend response
handle AI errors
apply request limits
```

Example:

```js
export async function sendAiRequest(payload) {
  const response = await fetch('/.netlify/functions/ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${payload.token}`
    },
    body: JSON.stringify(payload.body)
  });

  if (!response.ok) {
    throw new Error('AI request failed');
  }

  return response.json();
}
```

---

## 22. `services/admin-service.js`

Move admin backend calls here.

Responsibilities:

```txt
search users
update user roles or subscriptions if supported
fetch admin-only data
handle admin API errors
```

The admin panel UI should call this service instead of using `fetch` directly.

---

# What `main.js` Should Look Like

After restructuring, `main.js` should be small and easy to understand.

Example:

```js
import { applySidebarIcons } from './config/icons.js';
import { configurePdfJs } from './config/pdf-config.js';
import { initNavigation } from './core/navigation.js';
import { initSettings } from './features/settings/settings.js';
import { initCourses } from './features/courses/course-view.js';
import { initPdfViewer } from './features/pdf-viewer/pdf-viewer.js';
import { initAiPanel } from './features/ai-chat/ai-panel.js';
import { initAdminPanel } from './features/admin/admin-panel.js';

document.addEventListener('DOMContentLoaded', async () => {
  applySidebarIcons();
  configurePdfJs();

  initNavigation();
  initSettings();
  initCourses();
  initPdfViewer();
  initAiPanel();
  initAdminPanel();
});
```

The professional goal:

```txt
main.js starts the app.
features/ contains user-facing features.
services/ contains API/storage/PDF calls.
core/ contains app-wide helpers and state.
utils/ contains small reusable helpers.
config/ contains constants and setup.
```

---

# Recommended Refactor Order

Do the refactor gradually. Do not rewrite everything in one commit.

## Phase 1: Low-Risk Moves

```txt
[x] Move translations into features/settings/language.js
[x] Move sidebar icons into config/icons.js
[x] Move PDF config into config/pdf-config.js
[x] Move generic panel helpers into core/panels.js
```

These are good first steps because they are mostly isolated.

## Phase 2: Navigation and Rendering

```txt
[x] Move navigation functions into core/navigation.js
[x] Move renderCourses() into features/courses/courses-render.js
[x] Move sdRenderCourses() into features/courses/courses-render.js
[x] Keep temporary window bridges if needed
```

Temporary bridge example:

```js
import { renderCourses } from './features/courses/courses-render.js';

window.renderCourses = renderCourses;
```

This helps avoid breaking older inline event handlers while you refactor.

## Phase 3: Course View Split

```txt
[x] Move openCourse() into features/courses/course-view.js
[ ] Split showCourseSection() into smaller functions
[x] Move file list rendering into course-files.js
[x] Move folder logic into course-folders.js
[ ] Move course event binding into course-events.js
```

This is probably the most important and most delicate part of the frontend refactor.

## Phase 4: PDF Viewer Split

```txt
[x] Move openFile() into features/pdf-viewer/pdf-viewer.js
[x] Move _fetchPdfBytes() into services/pdf-service.js
[ ] Move PDF text extraction into pdf-text-extraction.js
[x] Keep the PDF viewer UI separate from PDF data loading
```

## Phase 5: AI Split

```txt
[x] Move copyBubble(), fallbackCopy(), and regenMsg() into ai-message-actions.js
[x] Move markdown rendering into ai-markdown.js
[x] Move multi-file summary logic into multi-file-summary.js
[x] Move backend AI fetch calls into services/ai-service.js
```

## Phase 6: Settings and Admin

```txt
[x] Move applySettings() into features/settings/settings.js
[x] Move language code into features/settings/language.js
[x] Move admin UI into features/admin/admin-panel.js
[x] Move admin API calls into services/admin-service.js
```

## Phase 7: Replace `app.js`

```txt
[ ] Create frontend/js/main.js
[ ] Import all feature initializers into main.js
[x] Keep app.js temporarily as a compatibility layer
[ ] Remove app.js once all global dependencies are gone
```

---

# Important Warning About Globals

Do not convert everything to clean ES modules in one huge commit.

The current app depends on global variables and global functions, such as:

```txt
activeSemId
activeCourseId
activeFileName
SEMS
COLORS
_currentUser
showToast
openAI
renderCourses
openCourse
openFile
```

The safest strategy is:

```txt
Step 1: move code into separate files
Step 2: temporarily attach needed functions to window
Step 3: create a central state object
Step 4: replace global reads/writes with state helpers
Step 5: remove window bridges
Step 6: convert everything to clean imports/exports
```

Example temporary compatibility bridge:

```js
import { openCourse } from './features/courses/course-view.js';

window.openCourse = openCourse;
```

This lets existing inline handlers keep working while you refactor.

---

# Safer Rendering Rules for `app.js` Refactor

When moving rendering code out of `app.js`, improve it at the same time.

## Avoid Raw `innerHTML` for User Data

Avoid this:

```js
card.innerHTML = `
  <h3>${course.name}</h3>
`;
```

Use this instead:

```js
const title = document.createElement('h3');
title.textContent = course.name;
card.append(title);
```

## Use `innerHTML` Only for Static Markup

This is acceptable:

```js
button.innerHTML = `
  <span class="icon"></span>
  <span>Open course</span>
`;
```

But avoid putting dynamic user values directly inside it.

## Escape Dynamic Values If Needed

If you must use HTML strings, use an escaping helper:

```js
import { escapeHtml } from '../utils/escape-html.js';

card.innerHTML = `
  <h3>${escapeHtml(course.name)}</h3>
`;
```

---

# Final Target for `app.js`

The final version should not be a large feature file.

It should either be deleted or replaced by a small entry file.

Target:

```txt
frontend/js/app.js or frontend/js/main.js
```

Should only do:

```txt
import modules
initialize app
connect global event listeners
start feature modules
handle fatal startup errors
```

It should not do:

```txt
render all courses
manage all files
open PDFs
call AI directly
manage admin users
contain translations
contain large HTML templates
contain every event listener
```

Professional final goal:

```txt
app.js/main.js: 50-150 lines
feature files: focused and readable
service files: API/data access only
core files: state/navigation/helpers only
utils files: tiny reusable helpers
```

---

# App.js Refactor Checklist

```txt
[ ] Create frontend/js/main.js
[x] Create frontend/js/config/icons.js
[x] Create frontend/js/config/pdf-config.js
[x] Create frontend/js/core/state.js
[x] Create frontend/js/core/navigation.js
[x] Create frontend/js/core/panels.js
[x] Create frontend/js/features/courses/courses-render.js
[x] Create frontend/js/features/courses/course-view.js
[x] Create frontend/js/features/courses/course-files.js
[x] Create frontend/js/features/courses/course-folders.js
[x] Create frontend/js/features/pdf-viewer/pdf-viewer.js
[x] Create frontend/js/features/pdf-viewer/pdf-text-extraction.js
[x] Create frontend/js/features/ai-chat/ai-message-actions.js
[x] Create frontend/js/features/ai-chat/ai-markdown.js
[x] Create frontend/js/features/ai-chat/multi-file-summary.js
[x] Create frontend/js/features/settings/language.js
[x] Create frontend/js/features/settings/settings.js
[x] Create frontend/js/features/admin/admin-panel.js
[x] Create frontend/js/services/pdf-service.js
[x] Create frontend/js/services/ai-service.js
[x] Create frontend/js/services/storage-service.js
[x] Create frontend/js/services/admin-service.js
[x] Create frontend/js/utils/escape-html.js
[x] Move code one section at a time
[x] Add temporary window bridges where required
[ ] Replace inline onclick handlers gradually
[ ] Replace unsafe innerHTML usage gradually
[x] Reduce global variables gradually
[ ] Remove old app.js once main.js fully replaces it
```

## Final Verdict

Minallo has a strong foundation and is becoming a serious full-stack student productivity project.

The most important next step is not adding more features immediately. The priority should be making the existing codebase easier to maintain, safer, and easier to deploy.

Focus first on:

```txt
cleaner modules
shared backend utilities
environment variables
input validation
tests
GitHub Actions
Docker
```

After that, advanced features like WebSockets, live processing updates, and background workers will be much easier to add.

---

# Missing / Newly Added Codebase Improvement Points

## 13. Repository Hygiene Improvements

Checklist:

```txt
[x] Update README project structure to match the real folders
[ ] Add screenshots to README
[x] Add .env.example
[ ] Add LICENSE if the project will be public/open source
[ ] Add CONTRIBUTING.md if others may contribute
[ ] Add SECURITY.md with how to report vulnerabilities
[ ] Add CHANGELOG.md or release notes later
[ ] Move outdated review/debug notes from frontend/ into docs/
```

Recommended docs structure:

```txt
docs/
├── architecture.md
├── security-hardening.md
├── deployment.md
├── database.md
├── api.md
└── roadmap.md
```

---

## 14. Backend Shared Utilities Still Missing

Recommended structure:

```txt
backend/
├── functions/
└── lib/
    ├── cors.js
    ├── env.js
    ├── responses.js
    ├── supabase-auth.js
    ├── supabase-admin.js
    ├── validation.js
    ├── rate-limit.js
    ├── logger.js
    ├── stripe.js
    └── paypal.js
```

Checklist:

```txt
[x] Move repeated CORS code into backend/lib/cors.js
[x] Move required environment checks into backend/lib/env.js
[x] Move JSON response helpers into backend/lib/responses.js
[x] Move Supabase token verification into backend/lib/supabase-auth.js
[x] Move service-role writes into backend/lib/supabase-admin.js
[x] Move payment provider setup into backend/lib/stripe.js and paypal.js
[x] Move backend validators into backend/lib/validation.js
[x] Move rate limit logic into backend/lib/rate-limit.js
[x] Move safe logging into backend/lib/logger.js
```

---

## 15. Frontend Services Still Missing

Recommended structure:

```txt
frontend/js/services/
├── api-client.js
├── auth-service.js
├── ai-service.js
├── admin-service.js
├── storage-service.js
├── pdf-service.js
├── subscription-service.js
├── chat-service.js
└── profile-service.js
```

Checklist:

```txt
[ ] Create shared frontend API client
[x] Move AI fetch calls into ai-service.js
[x] Move admin fetch calls into admin-service.js
[x] Move subscription/payment calls into subscription-service.js
[ ] Move chat Supabase calls into chat-service.js
[ ] Move profile/settings calls into profile-service.js
[ ] Keep UI files free of raw fetch/Supabase query details when possible
```

---

## 16. Replace `app.js` With a Real Entry Point

Final goal:

```txt
frontend/js/main.js = app bootstrap only
frontend/js/app.js = removed or tiny compatibility shim
```

Checklist:

```txt
[x] Create main.js
[x] Update HTML script tag to load main.js
[x] Keep app.js only as temporary bridge
[ ] Remove inline handlers that require window functions
[ ] Delete app.js when compatibility bridge is no longer needed
```

---

## 17. Add Global Error Handling

Frontend:

```js
window.addEventListener('error', (event) => {
  console.error('Unhandled error', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection', event.reason);
});
```

Backend:

```txt
wrap handlers in try/catch
return structured JSON errors
log safe error metadata
never leak secrets in error messages
```

Checklist:

```txt
[x] Add frontend global error handler
[ ] Add backend safe error wrapper
[ ] Add consistent error response format
[ ] Add user-friendly toast messages for failures
```

---

## 18. Add Formatting and Linting Config Files

Recommended files:

```txt
eslint.config.js
.prettierrc
.prettierignore
.editorconfig
```

Checklist:

```txt
[x] Add ESLint config
[x] Add Prettier config
[x] Add EditorConfig
[x] Add npm scripts for lint and format check
[ ] Run formatter once in a dedicated commit
```

---

## 19. Add Testing Structure

Recommended:

```txt
tests/
├── frontend/
│   ├── smoke.test.js
│   └── utils.test.js
├── backend/
│   ├── ai.test.js
│   ├── payments.test.js
│   └── admin.test.js
└── security/
    ├── rls-checklist.md
    └── two-account-test-plan.md
```

Minimum tests:

```txt
AI rejects unauthenticated requests
AI rejects oversized payloads
payment functions reject invalid plan/price
admin functions reject normal users
escapeHtml works
app loads without syntax errors
```

Checklist:

```txt
[x] Add test folder
[x] Add backend function tests
[x] Add frontend utility tests
[ ] Add two-account manual security test plan
```

---

## 20. Add CI/CD Workflows

Recommended workflows:

```txt
.github/workflows/ci.yml
.github/workflows/codeql.yml
.github/workflows/docker-build.yml
.github/workflows/deploy.yml
```

Suggested order:

```txt
1. ci.yml for lint/test/format
2. codeql.yml for security scanning
3. docker-build.yml for image build only
4. deploy.yml after server setup is stable
```

Checklist:

```txt
[ ] Add CI workflow
[ ] Add CodeQL workflow
[ ] Add Docker build workflow
[ ] Add deploy workflow only after manual deploy works
[ ] Require CI checks before merging to main
```

---

## 21. Dockerization Details Still Missing

Add concrete files when ready:

```txt
Dockerfile
docker-compose.yml
.dockerignore
docker/nginx.conf
docker/compose.prod.yml
```

Possible deployment models:

```txt
Option A: Static frontend + Netlify Functions
Option B: Dockerized frontend served by Nginx
Option C: Dockerized API/worker services, frontend still on Netlify
Option D: Full VPS deployment with reverse proxy
```

Recommended staged path:

```txt
Stage 1: Keep Netlify frontend/functions
Stage 2: Dockerize transcriber/worker if needed
Stage 3: Dockerize full app only if moving to VPS
```

Checklist:

```txt
[ ] Decide Netlify vs VPS hosting strategy
[ ] Add .dockerignore
[ ] Add Dockerfile for static frontend if needed
[ ] Add Dockerfile for backend/worker if needed
[ ] Add docker-compose for local production-like testing
```

---

## 22. Database and Supabase Documentation Missing

Create:

```txt
docs/database.md
```

Include:

```txt
table list
ownership column per table
RLS summary per table
storage bucket policies
known type issue: room_id text vs uuid
migration instructions
backup instructions
```

Checklist:

```txt
[ ] Create docs/database.md
[ ] Document each table and owner column
[ ] Document each RLS rule in plain English
[ ] Document storage buckets
[ ] Document migration process
```

---

## 23. Performance Improvements

Checklist:

```txt
[ ] Lazy-load PDF viewer
[ ] Lazy-load AI panel
[ ] Add pagination/limit to chat messages
[ ] Avoid loading all files/messages at once
[ ] Add loading/error/empty states consistently
```

---

## 24. Accessibility Improvements

Checklist:

```txt
[ ] Buttons have accessible names
[ ] Modals trap focus and close with Escape
[ ] Color contrast is sufficient
[ ] Interactive cards are keyboard accessible
[ ] Form inputs have labels
[ ] Toasts/alerts are announced appropriately
[ ] Avoid using divs as buttons without role/tabindex
```

---

## 25. Final Missing Items Summary

```txt
[ ] Remove wildcard API CORS
[ ] Add .env.example
[ ] Move repeated backend code into backend/lib
[ ] Add frontend API/service layer
[ ] Create real main.js and retire app.js
[ ] Add ESLint/Prettier configs
[ ] Add tests
[ ] Add GitHub Actions CI
[ ] Add CodeQL/Dependabot/secret scanning
[ ] Update README
[ ] Add SECURITY.md
[ ] Add docs/database.md
[ ] Add migration files for database/security SQL
[ ] Decide Docker/hosting strategy
[ ] Add accessibility checklist
[ ] Add performance/lazy-loading plan
```
