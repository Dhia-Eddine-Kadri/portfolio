# Backend

The backend contains Netlify Functions, shared TypeScript helpers, and the Python AI service.

## Layout

```text
backend/
  functions/                  Netlify Functions exposed through /api/*
  lib/                        Shared TypeScript helpers
  python-ai/                  FastAPI service for indexing, retrieval, AI answers
  tsconfig.json               Backend TypeScript config
```

SQL migrations live at `../supabase/migrations/`.

## Function Files

The project currently uses flat function filenames under `backend/functions/`. Public API routes are mapped in `netlify.toml`.

Examples:

| Public route | Function file |
|---|---|
| `/api/ai` | `functions/ai.ts` |
| `/api/ai/ask` | `functions/ai-ask.ts` |
| `/api/ai/generate` | `functions/ai-generate.ts` |
| `/api/documents/upload` | `functions/documents-upload.ts` |
| `/api/documents/list` | `functions/documents-list.ts` |
| `/api/notes/generate` | `functions/notes-generate.ts` |
| `/api/create-checkout` | `functions/create-checkout.ts` |
| `/api/create-portal` | `functions/create-portal.ts` |
| `/api/stripe-webhook` | `functions/stripe-webhook.ts` |
| `/api/paypal-webhook` | `functions/paypal-webhook.ts` |
| `/api/chat-friends` | `functions/chat-friends.ts` |
| `/api/send-chat-message` | `functions/send-chat-message.ts` |
| `/api/admin-users` | `functions/admin-users.ts` |
| `/api/admin-retrieval-logs` | `functions/admin-retrieval-logs.ts` |

When adding a function:

1. Add the TypeScript file under `backend/functions/`.
2. Add or confirm the route mapping in `netlify.toml`.
3. Call the clean `/api/...` route from the frontend.
4. Reuse shared helpers from `backend/lib/`.
5. Add tests when the function handles auth, billing, validation, or persistence.

## Shared Helpers

| File | Purpose |
|---|---|
| `cors.ts` | CORS headers and preflight handling |
| `env.ts` | Required/optional environment variable helpers |
| `logger.ts` | Structured backend logging |
| `python-ai-proxy.ts` | Proxy to the FastAPI AI service |
| `rate-limit.ts` | Per-user rate limiting helpers |
| `responses.ts` | JSON/failure response helpers |
| `stripe.ts` | Stripe client setup |
| `supabase-admin.ts` | Supabase service-role client |
| `supabase-auth.ts` | Supabase JWT verification |
| `subscription-gate.ts` | Paid feature access checks |
| `types.ts` | Shared backend types |
| `validation.ts` | Input validation helpers |

## AI Flow

Most AI routes are thin Netlify shells. They authenticate the user, enforce subscriptions/rate limits, and then call `backend/python-ai`.

Typical RAG ask flow:

```text
frontend
  -> /api/ai/ask
  -> Netlify function verifies JWT/subscription
  -> Python AI service retrieves course context
  -> LLM response returns with source metadata
```

Streaming answers may use the Python service directly when configured, but the same auth and subscription assumptions still apply.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Useful checks:

```bash
npm run typecheck:backend
npm run typecheck
npm run test
```

## Environment

See `../.env.example` for the canonical list. Backend functions commonly need:

- Supabase URL and service role key
- Supabase JWT/auth settings
- OpenAI keys/model settings
- AI service URL/internal secret
- Stripe keys/webhook secret
- PayPal keys/webhook ID
- Rate-limit and fair-use settings

Never expose service-role, Stripe, PayPal, or internal AI secrets to the frontend.

## Migrations

Use `../supabase/migrations/README.md` for order and process.

Rules:

- Run migrations in filename order.
- Do not edit applied production migrations.
- Add new migrations for new schema/RLS changes.
- Include verification SQL when touching RLS, subscriptions, webhooks, chat, or retrieval.
