# Model FOMO

Send one prompt to several LLMs on **DigitalOcean serverless inference**, watch the answers stream in side by side, and get a **combined view**: an independent judge model scores the anonymised answers, picks a winner and explains why, next to each model's latency, tokens and cost. For bigger questions ("which model is best for *my* prompts?"), run **batch evals** in a durable background worker and compare models on a leaderboard.

- Design choices and tradeoffs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Longer-term roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)

## What's in the box

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 15 (App Router) + shadcn/ui. UI and HTTP API (compare over SSE, evals, leaderboard). |
| `apps/worker` | DBOS worker that runs batch evals as durable workflows on Postgres-backed queues. |
| `packages/llm` | `ModelGateway` (retries, timeouts, rate limiting), DO Gradient provider, mock provider, LLM judge. |
| `packages/ratelimit` | Token + request leasing with Postgres (default), Redis/Valkey, or in-memory stores. |
| `packages/db` | Prisma schema and client. |
| `packages/shared` | zod request schemas, SSE event types, RFC 9457 problem types. |

## Run it locally

Requirements: Node 22+, pnpm 10, Docker (for Postgres).

```bash
pnpm install
cp .env.example .env              # mock mode by default: no access key needed, no tokens spent
docker compose up -d              # Postgres (add --profile redis for Valkey)
pnpm db:generate && pnpm db:deploy
pnpm dev                          # web on http://localhost:3000 + the worker
```

To use real models, create a **model access key** in the DigitalOcean control panel (Inference → Serverless), then set `MODEL_ACCESS_KEY=...` and `GRADIENT_MOCK=0` in `.env`.

Mock mode streams canned answers with realistic delays and randomly injects 429s and mid-stream failures (`MOCK_429_RATE`, `MOCK_ERROR_RATE`), so retries and partial results are visible in the UI.

## Tests

```bash
pnpm typecheck
pnpm test
# Also run the lease-store contract tests against real Postgres and Valkey:
TEST_DATABASE_URL=postgresql://fomo:fomo@localhost:5432/fomo TEST_REDIS_URL=redis://localhost:6379 pnpm test
```

CI (`.github/workflows/ci.yml`) runs typecheck, all tests (with Postgres and Valkey service containers) and a production build.

## API at a glance

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/models` | Live model list from DO, decorated with prices. |
| `POST` | `/api/compare` | Body: prompt, models, options. Response: `text/event-stream`. Optional `Idempotency-Key`. |
| `GET` | `/api/compare/:id` | Stored comparison, results, judgement, vote. |
| `PUT` | `/api/compare/:id/vote` | Human preference (idempotent). |
| `POST` | `/api/evals` | Create a batch eval run. `202 Accepted` + `Location`. `Idempotency-Key` supported. |
| `GET` | `/api/evals` / `/api/evals/:id` | List runs (cursor pagination) / run progress and results. |
| `POST` | `/api/evals/:id/cancel` | Cancels the run and its child workflows. |
| `GET` | `/api/leaderboard` | Aggregated judge scores, win rates, human votes, latency, cost, errors. |
| `GET` | `/api/health` | Health check used by App Platform. |

Every error is an RFC 9457 `application/problem+json` body with a `requestId`.

```bash
curl -N localhost:3000/api/compare -H 'content-type: application/json' \
  -d '{"prompt":"Explain CAP in one paragraph","models":["deepseek-v4.1-flash","mistral-3-14B"]}'
```

## Deploy to DigitalOcean App Platform

`.do/app.yaml` defines the web service (2 instances, health check on `/api/health`), the worker, a `PRE_DEPLOY` migration job and a Managed Postgres database. All three components build from the root `Dockerfile`, which picks its final stage from the `COMPONENT` build arg.

```bash
doctl apps create --spec .do/app.yaml
# then set MODEL_ACCESS_KEY (as a secret) in the app's settings
```
