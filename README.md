# Model FOMO

Send one prompt to several LLMs on **DigitalOcean serverless inference**, each with its own settings, watch the answers stream in side by side, and get a **combined view**: an independent judge scores the anonymised answers, a synthesizer merges them into one answer that cites each model, and a recommendation weighs quality against cost and latency ("X is 95% as good at 1/10th of the cost"). For bigger questions ("which model is best for *my* prompts?"), run **batch evals** in a durable background worker and compare models on a leaderboard.

**Live PoC:** https://model-fomo-qlrb3.ondigitalocean.app

**Start here:**

- [docs/DECISIONS.md](docs/DECISIONS.md): one page on what I built, what I skipped and why, the key tradeoffs, and feedback for DigitalOcean.
- [docs/ROADMAP.md](docs/ROADMAP.md): the longer-term roadmap and why it matters to DO.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the deep dive (problem framing, both paths, reliability, rate limiting, API, deploy).
- [docs/CODE_TOUR.md](docs/CODE_TOUR.md): the files that matter, in reading order.
- [docs/DEMO.md](docs/DEMO.md): a 5-minute demo script.

## What's in the box

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 15 (App Router) + shadcn/ui. UI and HTTP API (compare over SSE, evals, leaderboard). |
| `apps/worker` | DBOS worker that runs batch evals as durable workflows on Postgres-backed queues. |
| `packages/llm` | `ModelGateway` (retries, timeouts, rate limiting), DO Gradient provider, mock provider, LLM judge. |
| `packages/ratelimit` | Token + request leasing, shared through Postgres (in-memory store for tests). |
| `packages/db` | Prisma schema and client. |
| `packages/shared` | zod request schemas, SSE event types, RFC 9457 problem types. |

## Run it locally

Requirements: Node 22+, pnpm 10, Docker (for Postgres).

```bash
pnpm install
cp .env.example .env              # mock mode by default: no access key needed, no tokens spent
docker compose up -d              # Postgres
pnpm db:generate && pnpm db:deploy
pnpm dev                          # web on http://localhost:3000 + the worker
```

To use real models, create a **model access key** in the DigitalOcean control panel (Inference → Serverless), then set `DO_MODEL_ACCESS_KEY=...` and `GRADIENT_MOCK=0` in `.env`.

Mock mode streams canned answers with realistic delays and randomly injects 429s and mid-stream failures (`MOCK_429_RATE`, `MOCK_ERROR_RATE`), so retries and partial results are visible in the UI.

## Tests

```bash
pnpm typecheck
pnpm test
# Also run the lease-store contract tests against real Postgres:
TEST_DATABASE_URL=postgresql://fomo:fomo@localhost:5432/fomo pnpm test
```

CI (`.github/workflows/ci.yml`) runs typecheck, all tests (with a Postgres service container) and a production build.

## API at a glance

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/models` | Live model list from DO, decorated with prices, badges, capabilities and plan availability. |
| `POST` | `/api/compare` | Body: prompt, models, `modelSettings` (per-model temperature/topP/maxTokens/reasoningEffort/systemPrompt), `judge`, `synthesize`. Response: `text/event-stream`. Optional `Idempotency-Key`. |
| `GET` | `/api/compare` | Run history, newest first: `?limit=20&before=<id>` (cursor pagination). |
| `GET` | `/api/compare/:id` | Stored comparison, results, judgement, vote. The Compare page reopens one at `/compare?run=<id>`. |
| `PUT` | `/api/compare/:id/vote` | "Best answer" vote (idempotent). |
| `PUT` | `/api/compare/:id/rating` | Thumbs up/down on one model's answer: `{model, rating: "up" \| "down" \| null}`. |
| `POST` | `/api/evals` | Create a batch eval run (optionally with `taskType`, `priority`, `modelSettings`, `sourceComparisonId`, as "Validate on my prompts" does). `202 Accepted` + `Location`. `Idempotency-Key` supported. |
| `GET` | `/api/evals` / `/api/evals/:id` | List runs (cursor pagination) / run progress and results. |
| `POST` | `/api/evals/:id/cancel` | Cancels the run and its child workflows. |
| `GET` | `/api/evals/:id/export?format=csv\|json` | Every cell as CSV, or the per-model summary plus cells as JSON. |
| `POST` | `/api/advisor` | "Help me choose": `{ query }` in plain words; returns the parsed intent, a ranking from measured data, and a short explanation. |
| `GET` | `/api/leaderboard` | Aggregated judge scores, win rates, human votes, latency, cost, errors. `?taskType=coding` filters by task type. |
| `GET` | `/api/health` | Health check used by App Platform. |

Every error is an RFC 9457 `application/problem+json` body with a `requestId`.

```bash
curl -N localhost:3000/api/compare -H 'content-type: application/json' \
  -d '{"prompt":"Explain CAP in one paragraph","models":["deepseek-v4.1-flash","mistral-3-14B"]}'
```

## Deploy to DigitalOcean App Platform

`.do/app.yaml` defines the web service, the worker, and a `PRE_DEPLOY` migration job, against an existing Managed Postgres cluster. All three build from the root `Dockerfile`, which picks its final stage from the `COMPONENT` build arg.

```bash
# 1. Give DigitalOcean access to the GitHub repo (control panel → Apps → Create → GitHub), once.
# 2. Set the secrets in the app's settings: DO_MODEL_ACCESS_KEY, DATABASE_URL,
#    DBOS_SYSTEM_DATABASE_URL, and DATABASE_CA_CERT (doctl databases get-ca <id>).
doctl apps create --spec .do/app.yaml
```

The spec is exactly what the live PoC runs: 1 web + 1 worker instance, deployed from `main`, with an existing `db-s-1vcpu-1gb` cluster wired in by secret URLs. See [ARCHITECTURE §8](docs/ARCHITECTURE.md#8-deployment-on-app-platform) for why, the TLS gotcha with DBOS, and when to move to DOKS.
