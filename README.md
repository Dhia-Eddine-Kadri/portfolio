# Minallo

Minallo is an AI study workspace for students. It combines course PDFs, grounded AI tutoring, page-level citations, PDF tools, notes, flashcards, quizzes, German practice, focus tools, playlists, study games, and student chat in one authenticated app.

Production: [minallo.de](https://minallo.de)

Legal pages:
- [Impressum](https://minallo.de/impressum.html)
- [Privacy](https://minallo.de/privacy.html)
- [Terms](https://minallo.de/terms.html)
- [Withdrawal](https://minallo.de/withdrawal.html)

## Product Focus

Minallo is built around one promise: students should be able to ask questions about their own course material and get answers that match the uploaded lectures, exercises, and formula sheets.

Core user flows:
- Upload lecture PDFs, exercise sheets, notes, and formula sheets.
- Ask the AI tutor questions about course material.
- Solve exercises with structured steps and source-page citations.
- View, annotate, summarize, and organize PDFs.
- Generate notes, flashcards, quizzes, and study guides.
- Practice German in a separate learner space.
- Use Pomodoro, playlists, streaks, games, and study progress tools.
- Chat with other students in rooms and direct messages.

## Architecture

```text
Browser
  |
  | HTTPS
  v
Netlify
  - Static frontend from frontend/
  - Netlify Functions under backend/functions/
  - API routes such as /api/ai/ask, /api/documents/upload, /api/create-checkout
  |
  | Authenticated proxy calls
  v
FastAPI AI service
  - backend/python-ai
  - PDF indexing, retrieval, streaming answers, generation, writing coach
  |
  v
Supabase
  - Auth
  - Postgres + pgvector
  - Storage
  - Row-level security

Payments:
  - Stripe subscriptions
  - PayPal subscriptions
```

## Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, TypeScript compiled in place, no runtime bundler |
| Hosting | Netlify static hosting |
| Functions | Netlify Functions, TypeScript, Node 20 |
| AI service | FastAPI, Python 3.11+, deployed separately |
| Database | Supabase Postgres with pgvector |
| Auth | Supabase Auth |
| Storage | Supabase Storage |
| Payments | Stripe and PayPal subscriptions |
| PDF rendering | pdf.js |
| Tests | Node test runner, Playwright, pytest for Python service |

## Repository Layout

```text
frontend/
  index.html                  App entry loaded by loader.ts
  pages/                      Landing, portal, auth, static legal pages
  css/                        Global app and performance styles
  js/                         TypeScript source compiled to JS
    core/                     Navigation and state helpers
    features/                 AI chat, PDF, courses, settings, etc.
    pages/                    Landing page behavior
    services/                 Frontend service wrappers
  views/                      Feature HTML/CSS/JS fragments loaded lazily
  extension/                  Browser extension

backend/
  functions/                  Netlify API functions
  lib/                        Shared backend helpers
  python-ai/                  FastAPI AI and retrieval service

supabase/migrations/          Reproducible SQL migrations
tests/                        Node and frontend tests
docs/                         Specs, launch notes, endpoint docs
```

## Important Frontend Notes

- `frontend/js/loader.ts` loads the application shell and lazy feature bundles.
- `frontend/js/core/navigation.ts` owns portal section switching.
- `frontend/pages/new_landing.html` and `frontend/js/pages/new-landing.js` are the current landing page.
- Chatbot and Chat are lazy-loaded, with idle prewarming and skeleton placeholders for smoother navigation.
- Runtime `.js` files generated from TypeScript may be ignored by git. Edit tracked `.ts` files first and run the frontend build.

## API Surface

All paid user routes are authenticated with a Supabase JWT and checked against subscription/fair-use limits.

Common routes:

| Route | Purpose |
|---|---|
| `POST /api/ai` | General AI chat with image/file support |
| `POST /api/ai/ask` | Course-grounded RAG answer |
| `POST /api/ai/generate` | Notes, quiz, flashcard, and summary generation |
| `POST /api/ai/feedback` | Per-answer feedback |
| `POST /api/ai/evaluate` | Internal retrieval evaluation |
| `POST /api/ai/writing-coach` | German writing coach |
| `POST /api/notes/generate` | Full lecture-notes generation |
| `GET /api/notes` | Notes CRUD entry point |
| `POST /api/documents/upload` | Upload and index a document |
| `POST /api/documents/list` | List indexed documents |
| `POST /api/documents/delete` | Delete a document and chunks |
| `POST /api/documents/reindex-course` | Reindex a course |
| `POST /api/create-checkout` | Stripe Checkout |
| `POST /api/create-portal` | Stripe Billing Portal |
| `POST /api/verify-payment` | Post-checkout verification |
| `POST /api/activate-paypal-subscription` | PayPal activation |
| `POST /api/stripe-webhook` | Stripe webhook |
| `POST /api/paypal-webhook` | PayPal webhook |
| `POST /api/chat-friends` | Friend list and profile reads |
| `POST /api/send-chat-message` | Student chat message send |
| `POST /api/admin-users` | Admin user dashboard |
| `POST /api/admin-retrieval-logs` | Admin retrieval debug logs |

The browser may also stream directly to the Python AI service for SSE answers when configured.

## Local Development

### Prerequisites

- Node 20+
- Netlify CLI
- Python 3.11+ for the AI service
- Supabase project with migrations applied
- OpenAI, Stripe, and PayPal keys for full local functionality

### Install

```bash
npm install
cp .env.example .env
```

Fill `.env` with Supabase, OpenAI, Stripe, PayPal, and AI service values.

### Run frontend and functions

```bash
npm run dev
```

Use `netlify dev` through this command. Opening `frontend/index.html` directly only shows static markup and will not support auth, functions, payments, AI, or chat.

### Run Python AI service

```bash
cd backend/python-ai
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Set `AI_SERVICE_URL=http://localhost:8000` for local function proxying.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Run Netlify dev |
| `npm run dev:frontend` | Run Vite frontend dev server |
| `npm run build:frontend` | Compile frontend TypeScript |
| `npm run typecheck` | Type-check backend, frontend, and functions |
| `npm run typecheck:backend` | Type-check backend functions/lib |
| `npm run typecheck:frontend` | Type-check frontend |
| `npm run typecheck:pages` | Type-check functions project |
| `npm run lint` | ESLint frontend JS/TS |
| `npm run test` | Node tests |
| `npm run test:e2e` | Playwright tests |
| `npm run format` | Prettier write |

## Database Migrations

Migrations live in `supabase/migrations/` and should be run in filename order. Do not edit an already-applied production migration. Add a new migration instead.

See [supabase/migrations/README.md](supabase/migrations/README.md).

## Deployment

Normal production deployment is push-to-`main`.

Manual commands:

```bash
netlify deploy --prod

cd backend/python-ai
flyctl deploy
```

After deploys that touch subscriptions, webhooks, RLS, or retrieval, run the relevant verification queries from the migration files and launch docs.

## Security and Cost Controls

- Supabase RLS protects user-owned tables.
- Netlify functions verify Supabase JWTs before paid operations.
- Python AI endpoints require trusted authentication/proxy headers.
- Stripe and PayPal webhooks use signature checks and idempotency tables.
- AI usage is subscription-gated and rate-limited.
- Monthly fair-use limits split interactive chat/RAG calls from heavier generation calls.
- Retrieval uses document/course filters, debug logging, cache keys, and source citations.

## Documentation

- [backend/README.md](backend/README.md)
- [backend/python-ai/README.md](backend/python-ai/README.md)
- [supabase/migrations/README.md](supabase/migrations/README.md)
- [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md)
- [docs/python-ai-endpoints.md](docs/python-ai-endpoints.md)
- [docs/frontend-ts-migration.md](docs/frontend-ts-migration.md)

## License

Proprietary. Copyright 2026 Mohamed Ali Mariam. All rights reserved.
