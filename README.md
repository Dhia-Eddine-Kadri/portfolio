<div align="center">

# Minallo

**AI-integrated study platform for university students.**

Upload course materials, ask grounded questions across your PDFs, generate
notes, flashcards and quizzes, practice German writing, and chat with
study partners — all in one workspace.

[minallo.de](https://minallo.de) &nbsp;·&nbsp;
[Impressum](https://minallo.de/impressum.html) &nbsp;·&nbsp;
[Datenschutz](https://minallo.de/privacy.html) &nbsp;·&nbsp;
[AGB](https://minallo.de/terms.html)

</div>

---

## Highlights

- **Grounded RAG over your own PDFs** — hybrid vector + BM25 retrieval, page-cited answers, exercise/formula block detection.
- **Streaming AI chat** — SSE-streamed answers direct from the Python AI service, bypassing function timeouts.
- **Notes, flashcards, quizzes** — generated from indexed course materials with per-document anchoring.
- **Deutsch Schreibtrainer** — German writing coach that scores against the user's profile level (A1 → C1 Hochschule) and task type (Stellungnahme, E-Mail, Bericht, …).
- **Real-time chat** — friend list, course rooms, custom rooms, message reactions, all behind row-level security.
- **Subscriptions** — Stripe + PayPal, 7-day trial, fair-use cost protection, full GDPR/§19-UStG legal pages.
- **Browser extension** — capture lecture transcripts from YouTube and Opencast into Minallo notes.

## Architecture

```
                                                   ┌────────────────────────────┐
   Browser ──── HTTPS ─── Netlify (CDN + Functions)│  /api/ai/ask, /api/notes,  │
                              │                    │  /api/create-checkout,     │
                              │                    │  /api/stripe-webhook, …    │
                              │                    └────────────┬───────────────┘
                              │                                 │ JWT/internal-secret
                              │                                 ▼
                              │                       ┌──────────────────┐
                              │                       │  python-ai.fly.dev  (FastAPI)
                              │ SSE direct stream ──▶ │  /ask-stream,       │
                              │ (bypasses Netlify     │  /writing-coach-…   │
                              │  function timeout)    │  retrieval + LLM    │
                              │                       └────────┬─────────────┘
                              │                                │
                              ▼                                ▼
                  ┌────────────────────────────────────────────────┐
                  │     Supabase: Postgres + Auth + Storage         │
                  │     pgvector, RLS, idempotency ledgers          │
                  └────────────────────────────────────────────────┘

                  ┌────────────────────────┐    ┌────────────────────────┐
                  │  Stripe (subscription) │    │  PayPal (subscription) │
                  └────────────────────────┘    └────────────────────────┘
```

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla TypeScript + HTML + CSS, compiled to JS by `tsc` (no bundler at runtime) |
| Hosting & functions | Netlify (static frontend + Node 20 functions) |
| AI service | FastAPI on Fly.io, OpenAI for LLM + embeddings |
| Database / Auth / Storage | Supabase (Postgres + pgvector, GoTrue, Storage buckets) |
| Payments | Stripe Subscriptions + PayPal Subscriptions |
| PDF rendering | pdf.js (CDN) |

## Repository layout

```
frontend/                          Static site (publish dir for Netlify)
  index.html, *.html               App shells + standalone pages
  css/, assets/                    Styles + static assets
  js/                              TypeScript sources compiled in place
    main.ts, app.ts                Entry + portal bootstrap
    config.js                      Public config (anon keys, public IDs)
    auth-bootstrap.js              Supabase auth + Google Sign-In wiring
    services/                      ai-service, subscription-service, …
    features/                      ai-chat/, writing-coach/, study-timer/, …
    pages/                         Landing-page logic
  views/                           Per-feature HTML/CSS fragments
  extension/                       Chrome browser extension

backend/
  functions/                       Netlify Functions (auth + proxy + webhooks)
    ai-ask.ts, ai-generate.ts, …   Thin shells over the Python AI service
    create-checkout.ts             Stripe Checkout session with Widerruf-Verzicht
    stripe-webhook.ts              Idempotent, replay-protected, retry-on-failure
    paypal-webhook.ts              Signature-verified via PayPal API
    …
  lib/                             cors, env, responses, rate-limit,
                                   subscription-gate, stripe, supabase-admin, …
  python-ai/                       FastAPI service deployed to Fly.io
    app/routers/                   ask, ask-stream, generate, writing-coach, …
    app/services/                  retrieval, answer, notes, flashcards, quiz,
                                   writing_coach, access_control, …

supabase/migrations/               All schema + RLS migrations (run in order)
docs/                              CLAUDE.md, schreibtrainer spec, launch
                                   checklist, audit notes
tests/                             Node tests for backend handlers + utils
```

## Public API surface

All routes are HTTPS, JWT-authenticated (Supabase token in
`Authorization: Bearer …`), and gated by an active subscription where
relevant.

| Route | Purpose |
|---|---|
| `POST /api/ai` | Generic vision-capable chat (gpt-4o, capped to 2048 completion tokens) |
| `POST /api/ai/ask` | RAG question against indexed course PDFs |
| `POST /api/ai/generate` | Quizzes / flashcards / summary notes |
| `POST /api/ai/feedback` | Capture per-answer feedback (rating, text) |
| `POST /api/ai/evaluate` | Retrieval-quality evaluation harness (internal) |
| `POST /api/ai/writing-coach` | Deutsch Schreibtrainer analysis |
| `POST /api/notes/generate` | Full markdown lecture-notes generation |
| `GET  /api/notes` | List, fetch, persist generated notes |
| `POST /api/documents/upload` | Upload + index a PDF into pgvector |
| `POST /api/documents/list` | List user's indexed documents |
| `POST /api/documents/delete` | Delete a document + its chunks |
| `POST /api/documents/reindex-course` | Re-run indexing for an entire course |
| `POST /api/create-checkout` | Stripe Checkout session (captures Widerruf-Verzicht) |
| `POST /api/create-portal` | Stripe Billing Portal session |
| `POST /api/verify-payment` | Post-Checkout subscription activation |
| `POST /api/activate-paypal-subscription` | PayPal subscription activation |
| `POST /api/stripe-webhook` | Stripe events (signature + idempotency + retry) |
| `POST /api/paypal-webhook` | PayPal events (signature-verified via PayPal API) |
| `POST /api/admin-users` | Admin dashboard (backend-checked against `public.admins`) |
| `POST /api/chat-friends` | Friend list + cross-user profile read |
| `POST /api/send-chat-message` | Chat send with content moderation + rate limit |

The browser also calls `POST https://python-ai.fly.dev/ask-stream`
directly for SSE streaming. This endpoint enforces the same JWT auth,
subscription gate, and rate limit as the Netlify path.

## Cost protection

The platform is designed so a single subscriber cannot exceed the
€11,99/month price.

- **Subscription gate** on every paid endpoint (both Netlify and the
  Python service) — verified against `subscriptions.status` and
  `expires_at`.
- **Per-endpoint hourly rate limits** (`AI_ASK_RATE_LIMIT_MAX`,
  `NOTES_RATE_LIMIT_MAX`, …).
- **Split monthly fair-use caps** per user, reset on the 1st of each
  calendar month UTC: 2000 interactive calls (chat / RAG / writing-coach /
  streaming asks) and 200 generation calls (quiz / flashcards / notes
  summaries). Independent buckets so a quiz spree never locks out chat.
- **Hard `max_tokens` caps** in every LLM call site.
- **Cache-by-default** on RAG answers, keyed by document version hash so
  invalidation is automatic on document changes. Client cannot opt out.
- **Cap is contractually backed** in the AGB §4 ("Fair-Use") so users
  cannot claim surprise.

Worst-case spend at both caps: roughly $3-4/user/month with the default
gpt-4o-mini baseline (writing-coach escalates to gpt-4o for C1+ levels),
comfortably below the €11,99 list price.

## Security

- **Row-level security** on every user-data table, keyed on
  `auth.uid()`. Service-role writes only for `admins`, `security_events`,
  `subscriptions`, `stripe_webhook_events`, `paypal_webhook_events`.
- **Webhook signatures verified** against the raw body for Stripe, and
  via the PayPal `/v1/notifications/verify-webhook-signature`
  round-trip for PayPal.
- **Webhook idempotency + retry** — each provider has its own ledger
  table with the event ID as primary key. On Supabase write failure the
  function returns 5xx so the provider retries.
- **CSP hardened** in `netlify.toml` — no `unsafe-eval`, no
  `unsafe-inline` on `script-src`, third-party origins whitelisted.
- **No production npm dependencies** — `package.json` ships an empty
  `dependencies: {}`. Everything runtime is Node builtins or
  esbuild-bundled from `devDependencies`.
- **No service-role key, Stripe secret, or PayPal secret in the
  frontend.** Only the Supabase anon key is shipped (designed for it,
  RLS does the protection).

See [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) for the
monitoring SQL queries to keep an eye on after launch.

## Compliance (Germany / EU)

- **Impressum** with §5 DDG + §18 MStV details and §19 UStG
  Kleinunternehmer notice.
- **Datenschutzerklärung** covering hosting, Supabase auth, AI (OpenAI)
  transfers including DPF + SCC for the US, retention table, full Art.
  15-22 rights, and a documented response SLA.
- **AGB** with the price (11,99 €/Monat), Fair-Use clause referencing
  the split monthly caps (2000 interactive + 200 generation), and
  digital-services Widerruf rules.
- **Widerrufsbelehrung** with the standard 14-day form. The checkout
  flow captures explicit Widerruf-Verzicht consent (BGB §312j, §356(5))
  and persists it in Stripe metadata + the Netlify request log.

## Getting started

### Prerequisites

- Node 20+
- Netlify CLI (`npm install -g netlify-cli`)
- A Supabase project with the migrations applied (see below)
- API keys for OpenAI, Stripe, PayPal (test or live)
- Python 3.11+ if you also want to run the AI service locally

### Run the frontend + functions locally

```bash
npm install
cp .env.example .env
# Fill in .env with your keys

npm run dev          # netlify dev — runs frontend + functions on :8888
```

Opening `frontend/index.html` directly only renders static markup;
auth, AI, payments, and chat all need the functions, so use `netlify dev`.

### Run the Python AI service locally

```bash
cd backend/python-ai
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in
uvicorn app.main:app --reload --port 8000
```

Then point Netlify at it with `AI_SERVICE_URL=http://localhost:8000`.

### Apply Supabase migrations

```bash
# With the Supabase CLI:
supabase db push

# Or paste each file in supabase/migrations/ into the Supabase SQL editor
# in filename-sorted order. They are idempotent.
```

Critical migrations for a working install:
[`20260504_000001_admin_security.sql`](supabase/migrations/20260504_000001_admin_security.sql),
[`20260504_000002_rls_hardening.sql`](supabase/migrations/20260504_000002_rls_hardening.sql),
[`20260504_000004_storage_security.sql`](supabase/migrations/20260504_000004_storage_security.sql),
[`20260505_000001_rag_foundation.sql`](supabase/migrations/20260505_000001_rag_foundation.sql),
[`20260519_000004_profiles_subscriptions_rls_cleanup.sql`](supabase/migrations/20260519_000004_profiles_subscriptions_rls_cleanup.sql).

### Environment variables

See [.env.example](.env.example) for the full annotated list.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start `netlify dev` (frontend + functions) |
| `npm run build:frontend` | Compile TypeScript in `frontend/js/` to JS |
| `npm run typecheck` | Type-check backend + frontend |
| `npm run lint` | ESLint on `frontend/js/` |
| `npm run test` | Node test runner over `tests/backend/**` |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run format` | Prettier write |

## Deploying

```bash
# Frontend + functions
netlify deploy --prod

# Python AI service
cd backend/python-ai
flyctl deploy
```

Production deploy is wired to push-to-`main`; the commands above are
for manual / hotfix deploys.

After any deploy that touches webhooks or subscription logic, run the
verification queries in [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md)
to confirm policies and webhook ledgers look right.

## Documentation

- [docs/CLAUDE.md](docs/CLAUDE.md) — codebase conventions and contributor notes
- [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) — post-deploy steps + monitoring queries
- [docs/schreibtrainer-ai-spec.md](docs/schreibtrainer-ai-spec.md) — full Deutsch Schreibtrainer behaviour spec
- [docs/python-ai-endpoints.md](docs/python-ai-endpoints.md) — Python service request/response shapes
- [docs/frontend-ts-migration.md](docs/frontend-ts-migration.md) — TS migration notes

## License

Proprietary. © 2026 Mohamed Ali Mariam (Minallo). All rights reserved.
