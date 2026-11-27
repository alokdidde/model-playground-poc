# Model FOMO

Send one prompt to several LLMs on **DigitalOcean serverless inference**, each with its own settings, watch the answers stream in side by side, and get a **combined view**: an independent judge scores the anonymised answers, a synthesizer merges them into one answer that cites each model, and a recommendation weighs quality against cost and latency ("X is 95% as good at 1/10th of the cost"). Every comparison feeds a **leaderboard**, and **Help me choose** turns a use case in plain words into a ranked shortlist. Every model call shares one rate-limit budget per model, and **/ops/rate-limits** shows each wait, 429, cooldown and retry as a timeline. Batch evals over many prompts are on the [roadmap](docs/ROADMAP.md).

**Live PoC:** https://model-fomo-qlrb3.ondigitalocean.app

**Start here:**

- [docs/DECISIONS.md](docs/DECISIONS.md): one page on what I built, what I skipped and why, the key tradeoffs, and feedback for DigitalOcean.
- [docs/ROADMAP.md](docs/ROADMAP.md): the longer-term roadmap and why it matters to DO.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the deep dive (problem framing, the compare path, reliability, rate limiting, API, deploy).
- [docs/CODE_TOUR.md](docs/CODE_TOUR.md): the files that matter, in reading order.
- [docs/DEMO.md](docs/DEMO.md): a 5-minute demo script.
- [docs/SECURITY.md](docs/SECURITY.md): the security pass: what was fixed and which risks are accepted for a PoC.

## What's in the box

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 15 (App Router) + shadcn/ui. UI and HTTP API (compare over SSE, Help me choose, leaderboard). |
| `packages/llm` | `ModelGateway` (retries, timeouts, rate limiting), DO Gradient provider, mock provider, LLM judge. |
| `packages/ratelimit` | Token + request leasing, shared through Postgres (in-memory store for tests), plus the rate-event log. |
| `packages/db` | Prisma schema and client. |
| `packages/shared` | zod request schemas, SSE event types, RFC 9457 problem types. |

## Run it locally

Requirements: Node 22+, pnpm 10, Docker (for Postgres).

```bash
pnpm install
cp .env.example .env              # mock mode by default: no access key needed, no tokens spent
docker compose up -d              # Postgres
pnpm db:generate && pnpm db:deploy
pnpm dev                          # web on http://localhost:3000
```

To use real models, create a **model access key** in the DigitalOcean control panel (Inference → Serverless), then set `DO_MODEL_ACCESS_KEY=...` and `GRADIENT_MOCK=0` in `.env`.

Mock mode streams canned answers with realistic delays and randomly injects 429s and mid-stream failures (`MOCK_429_RATE`, `MOCK_ERROR_RATE`), so retries and partial results are visible in the UI.

## Tests

```bash
pnpm typecheck
pnpm test
# Also run the lease-store contract tests against real Postgres:
TEST_DATABASE_URL=postgresql://fomo:fomo@localhost:5432/fomo pnpm test
# Load test: many parallel compares, then the rate-limit summary (spends real tokens unless in mock mode)
node scripts/stress-compare.mjs --compares 40 --models mistral-3-14B,glm-5.2
```

CI (`.github/workflows/ci.yml`) runs typecheck, all tests (with a Postgres service container) and a production build.

## API at a glance

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/models` | Live model list from DO, decorated with prices, badges, capabilities and plan availability. |
| `POST` | `/api/compare` | Body: prompt, models, `modelSettings` (per-model temperature/topP/maxTokens/reasoningEffort/systemPrompt), `judge`, `synthesize`. Response: `text/event-stream`. Optional `Idempotency-Key`. |
| `GET` | `/api/compare` | Run history, newest first: `?limit=20&before=<id>` (cursor pagination). |
| `GET` | `/api/compare/:id` | Stored comparison, results, judgement, vote. The Compare page reopens one at `/compare?run=<id>`. |
| `POST` | `/api/compare/:id/cancel` | Stop a running compare. Closing the tab does not stop it: it finishes and is saved. |
| `PUT` | `/api/compare/:id/vote` | "Best answer" vote (idempotent). |
| `PUT` | `/api/compare/:id/rating` | Thumbs up/down on one model's answer: `{model, rating: "up" \| "down" \| null}`. |
| `POST` | `/api/advisor` | "Help me choose": `{ query }` in plain words; returns the parsed intent, a ranking from measured data, and a short explanation. |
| `GET` | `/api/leaderboard` | Aggregated judge scores, win rates, human votes, latency, cost, errors. `?taskType=coding` filters by task type. |
| `GET` | `/api/ops/rate-events` | Every rate-limit decision (`?minutes=30`, `?tag=<comparison id>`, `?model=`) plus a per-model summary. Drawn at `/ops/rate-limits`. |
| `GET` | `/api/health` | Health check used by App Platform. |

Every error is an RFC 9457 `application/problem+json` body with a `requestId`.

```bash
curl -N localhost:3000/api/compare -H 'content-type: application/json' \
  -d '{"prompt":"Explain CAP in one paragraph","models":["deepseek-v4.1-flash","mistral-3-14B"]}'
```

## Deploy to DigitalOcean App Platform

`.do/app.yaml` defines the web service and a `PRE_DEPLOY` migration job, against an existing Managed Postgres cluster. Both build from the root `Dockerfile`.

```bash
# 1. Give DigitalOcean access to the GitHub repo (control panel → Apps → Create → GitHub), once.
# 2. Set the secrets in the app's settings: DO_MODEL_ACCESS_KEY and DATABASE_URL.
doctl apps create --spec .do/app.yaml
```

The spec is exactly what the live PoC runs: 1 web instance, deployed from `main`, with an existing `db-s-1vcpu-1gb` cluster wired in by a secret URL. See [ARCHITECTURE](docs/ARCHITECTURE.md) for why, and when to move to DOKS.
