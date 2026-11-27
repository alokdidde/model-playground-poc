# Code tour

The files that matter, in reading order. Read them in this order and you have read the whole design. For each one: what it does, the one design choice in it, and what a reviewer is likely to push on.

Everything else is UI (`apps/web/components`), pages (`apps/web/app`), or small helpers that these files call.

## 1. The contract: `packages/shared/src/schemas.ts`, `events.ts`, `problem.ts`

zod schemas for every request body, the SSE event types, and the RFC 9457 problem shape. The server and the browser both import them.

- **Design choice:** one source of truth for types. The client can't send a body the server would reject for shape, and an event the client doesn't know about is a type error.
- **Expect:** "Why zod and not OpenAPI?" One language, inferred types, no codegen step. An OpenAPI spec can be generated from these schemas later.

## 2. Every API route: `apps/web/lib/server/api.ts` and `apps/web/middleware.ts`

`apiRoute()` wraps each handler. It parses params, query and body with zod, enforces JSON (415), a 1 MB limit (413) and valid JSON (400), and turns any thrown error into a problem response with the request id. `middleware.ts` assigns `x-request-id` and calls `authenticate()`, which returns an anonymous principal today.

- **Design choice:** errors are handled in one place, so every route returns the same error shape and never leaks internals (tested in `test/api-route.test.ts`).
- **Expect:** "How would you add auth?" Implement `authenticate()` in `middleware.ts`. Handlers already receive `principal`, and middleware always overwrites the principal header, so a client can't spoof it.

## 3. The interactive path: `apps/web/app/api/compare/route.ts` → `apps/web/lib/server/compare-service.ts`

`createComparison()` validates and saves the row *before* the stream opens, so idempotency conflicts get a real 409. `executeComparison()` runs every model in parallel. Each model gets its own `try/catch`, which saves its result and emits exactly one `model.completed` or `model.failed`. Then the judge and the synthesis run side by side, and the run ends `COMPLETED`, `PARTIAL` or `FAILED`.

- **Design choice:** per-model isolation. One broken model never hides the others (tested in `test/compare-service.test.ts`).
- **Expect:** "What if the browser disconnects?" Nothing: the run isn't tied to the request, so it finishes and is saved, and the run page polls until it ends. Stop is an explicit `POST /api/compare/:id/cancel`, which aborts the run's calls (`cancelComparison`). A run left `RUNNING` by a restart is marked failed when read (`isAbandoned`).

## 4. The browser side of the stream: `apps/web/lib/api-client.ts`, `live-run.ts`, `compare-state.ts`

`streamCompare()` POSTs and parses SSE from `fetch` (`EventSource` can't POST a body). `live-run.ts` keeps the stream outside React, so moving from `/compare` to `/runs/:id` doesn't cut it off. `compare-state.ts` is a pure reducer from events to UI state (tested).

- **Expect:** "Why not WebSockets?" The stream is one-way, SSE runs over plain HTTP through App Platform's load balancer, and cancel means closing the request.

## 5. Every model call: `packages/llm/src/gateway.ts`

`ModelGateway.stream()` / `complete()`. Each attempt takes a lease, calls the provider with an attempt timeout and a first-token timeout, then releases the lease with the real token usage. Retries use exponential backoff with full jitter, and never wait less than `Retry-After`. DO sends none on a 429, so `resetOfSpentCounter()` takes the wait from the reset header of the counter at 0; if that is longer than the caller will wait (5 min for compare), the call fails at once with a clear problem instead of a spinner. Every attempt, 429 and retry (with its backoff ceiling, jitter draw and server wait) is emitted as a rate event.

- **Design choice:** retry only *before the first token*, so text never shows twice. Reasoning chunks count as "alive" for the first-token timer. If a reasoning model uses up `max_tokens`, there is one retry with 4x the budget.
- **Expect:** "Why full jitter?" Many clients that got the same 429 shouldn't all retry at the same instant. "Why turn off the SDK's retries?" Two retry layers would multiply the attempts.

## 6. DO serverless inference: `packages/llm/src/gradient-provider.ts`, `errors.ts`, `catalog.ts`

The OpenAI SDK pointed at `https://inference.do-ai.run/v1`. Turns SDK errors into `UpstreamError` with a kind (rate limited, timeout, server, client). Parses `x-ratelimit-*` headers. `catalog.ts` holds prices, badges and the probed capability table (which models reject which parameters).

- **Expect:** "Why a static price table?" DO has no pricing API we could find. Unknown prices show "cost unknown", never $0.

## 7. The combined view: `packages/llm/src/judge.ts`, `synthesis.ts`

The judge shuffles the answers, labels them A/B/C, and picks a judge model that isn't competing. It judges twice, in parallel: once in that order and once reversed (`runJudge` → `judgeOnce` ×2 → `combineOrders`). Each call asks for strict JSON, validates it with zod, re-asks once on bad JSON, and maps labels back to models. `combineOrders` averages the scores, and turns a disagreement on the winner into a tie. Synthesis merges the answers with `[Model]` citations.

- **Expect:** "How do you know the judge is right?" You don't, fully. Each guard maps to a paper (DECISIONS, "How the judge is built"). "Why not two judge models?" It costs the same again; a panel of judges is on the roadmap. Human votes are stored to measure agreement, which isn't measured yet (see DECISIONS).

## 8. From scores to a decision: `apps/web/lib/recommend.ts` and `advisor-rank.ts`

Pure functions. Each model gets quality (judge / 10), cost (cheapest / this) and speed (fastest / this) scores. The user's priority sets the weights, and the highest weighted sum wins. Help me choose ranks the leaderboard with the same function.

- **Design choice:** the LLM writes the words and the code makes the decision, so the advisor can't invent benchmarks.

## 9. Staying under DO's limits: `packages/ratelimit/src/policy.ts`, `postgres-store.ts`, `rate-limiter.ts`

A bucket is per (hashed key, model). A lease reserves 1 request plus estimated tokens in a 60 s sliding window, and is reconciled with real usage afterwards. `policy.ts` holds the arithmetic: learned limit × 0.9 × AIMD factor. A real 429 halves the factor (once per 5 s, so a burst of parallel 429s counts once); a cooldown predicted from the headers does not. `postgres-store.ts` makes check-and-take atomic with `pg_advisory_xact_lock(hashtext(bucket))` and uses the database clock.

- **Expect:** "Why an advisory lock and not `SELECT … FOR UPDATE`?" There is no single row to lock, because the bucket is a set of lease rows. The lock is per bucket, so different models never block each other, and it is released on commit or rollback. "What is AIMD for?" It finds the real capacity when someone else shares the key: halve the factor on a 429, then add a little back on each success. "Why a lease TTL?" A crashed caller can't hold capacity forever. The TTL (150 s) is longer than the longest attempt (60 s) plus its waits.

## 10. Seeing what the limiter did: `packages/ratelimit/src/events.ts`, `apps/web/lib/server/rate-events.ts`, `apps/web/app/ops/rate-limits/page.tsx`

`events.ts` defines one event per limiter or retry decision (lease granted or waited for, 429, cooldown, limits learned, AIMD factor changed, retry, attempt ok or failed). `RateLimiter` and `ModelGateway` emit them, tagged with the comparison id, and `PostgresEventSink` writes them in one insert per second, never blocking a model call. `/ops/rate-limits` draws a per-model timeline and summary; each run page links to its own. `scripts/stress-compare.mjs` fires many parallel compares and prints the summary.

- **Expect:** "Why not OTel?" These are domain decisions (why a call waited, what a retry slept), not spans, and Postgres is already there. An OTel exporter would be one more `RateEventSink`. "What does it cost?" One small insert per second while calls are running, and rows older than 7 days are pruned.

## 11. Data: `packages/db/prisma/schema.prisma`

`Comparison` → `CompareResult`, `Judgement`, `Vote`. `rate_lease` and `rate_cooldown` back the lease store, and `rate_event` records its decisions.

- **Expect:** "Why aggregate the leaderboard on read?" It's fine at PoC scale. The next step is a materialised view refreshed on a schedule.

## 12. Deploy: `Dockerfile`, `.do/app.yaml`

One image for the web service. A `PRE_DEPLOY` job runs migrations with the same image.
