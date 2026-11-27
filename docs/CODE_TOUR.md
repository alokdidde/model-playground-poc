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
- **Expect:** "What if the browser disconnects?" The request's `AbortSignal` is passed down to the HTTP call, so tokens stop being spent and the run is saved as `CANCELLED`. The known gap is that it isn't finished in the background.

## 4. The browser side of the stream: `apps/web/lib/api-client.ts`, `live-run.ts`, `compare-state.ts`

`streamCompare()` POSTs and parses SSE from `fetch` (`EventSource` can't POST a body). `live-run.ts` keeps the stream outside React, so moving from `/compare` to `/runs/:id` doesn't cut it off. `compare-state.ts` is a pure reducer from events to UI state (tested).

- **Expect:** "Why not WebSockets?" The stream is one-way, SSE runs over plain HTTP through App Platform's load balancer, and cancel means closing the request.

## 5. Every model call: `packages/llm/src/gateway.ts`

`ModelGateway.stream()` / `complete()`. Each attempt takes a lease, calls the provider with an attempt timeout and a first-token timeout, then releases the lease with the real token usage. Retries use exponential backoff with full jitter, and never wait less than `Retry-After`.

- **Design choice:** retry only *before the first token* in compare, so text never shows twice. Batch sets `restartInterruptedStreams` because nobody is watching. Reasoning chunks count as "alive" for the first-token timer. If a reasoning model uses up `max_tokens`, there is one retry with 4x the budget.
- **Expect:** "Why full jitter?" Many clients that got the same 429 shouldn't all retry at the same instant. "Why turn off the SDK's retries?" Two retry layers would multiply the attempts.

## 6. DO serverless inference: `packages/llm/src/gradient-provider.ts`, `errors.ts`, `catalog.ts`

The OpenAI SDK pointed at `https://inference.do-ai.run/v1`. Turns SDK errors into `UpstreamError` with a kind (rate limited, timeout, server, client). Parses `x-ratelimit-*` headers. `catalog.ts` holds prices, badges and the probed capability table (which models reject which parameters).

- **Expect:** "Why a static price table?" DO has no pricing API we could find. Unknown prices show "cost unknown", never $0.

## 7. The combined view: `packages/llm/src/judge.ts`, `synthesis.ts`, `checks.ts`

The judge shuffles the answers, labels them A/B/C, and picks a judge model that isn't competing. It judges twice, in parallel: once in that order and once reversed (`runJudge` → `judgeOnce` ×2 → `combineOrders`). Each call asks for strict JSON, validates it with zod, re-asks once on bad JSON, and maps labels back to models. `combineOrders` averages the scores, and turns a disagreement on the winner into a tie. In batch evals the judge also gets the reference answer and each answer's check results. Synthesis merges the answers with `[Model]` citations. Checks are deterministic (matches the reference answer, valid JSON).

- **Expect:** "How do you know the judge is right?" You don't, fully. Each guard maps to a paper (DECISIONS, "How the judge is built"). "Why not two judge models?" It costs the same again; a panel of judges is on the roadmap. Checks run beside the judge, and human votes are stored to measure agreement, which isn't measured yet (see DECISIONS).

## 8. From scores to a decision: `apps/web/lib/recommend.ts` and `advisor-rank.ts`

Pure functions. Each model gets quality (judge / 10), cost (cheapest / this) and speed (fastest / this) scores. The user's priority sets the weights, and the highest weighted sum wins. Help me choose ranks the leaderboard with the same function.

- **Design choice:** the LLM writes the words and the code makes the decision, so the advisor can't invent benchmarks.

## 9. Staying under DO's limits: `packages/ratelimit/src/policy.ts`, `postgres-store.ts`, `rate-limiter.ts`

A bucket is per (hashed key, model). A lease reserves 1 request plus estimated tokens in a 60 s sliding window, and is reconciled with real usage afterwards. `policy.ts` holds the arithmetic: learned limit × 0.9 × AIMD factor × (batch share if batch). `postgres-store.ts` makes check-and-take atomic with `pg_advisory_xact_lock(hashtext(bucket))` and uses the database clock.

- **Expect:** "Why an advisory lock and not `SELECT … FOR UPDATE`?" There is no single row to lock, because the bucket is a set of lease rows. The lock is per bucket, so different models never block each other, and it is released on commit or rollback. "What is AIMD for?" It finds the real capacity when someone else shares the key: halve the factor on a 429, then add a little back on each success. "Why a lease TTL?" A crashed caller can't hold capacity forever. The TTL (150 s) is longer than the longest attempt (120 s).
- **Observability:** `events.ts` defines one event per limiter or retry decision. `RateLimiter` and `ModelGateway` emit them, and `PostgresEventSink` writes them in one insert per second. `/ops/rate-limits` (`apps/web/app/ops/rate-limits/page.tsx`) draws them. **Expect:** "Why not OTel?" These are domain decisions (why a call waited, what a retry slept), not spans, and Postgres is already there. An OTel exporter would be one more `RateEventSink`. "Why does a 429 retry wait for the reset header?" DO sends no `Retry-After`, and [RATE_LIMITS.md](RATE_LIMITS.md) has the measurements.

## 10. The batch path: `apps/worker/src/workflows.ts`, `activities.ts`, `apps/web/lib/server/evals-service.ts`

The web app writes the run and enqueues `evalRunWorkflow` with the run id as the workflow id. The worker fans out to one workflow per prompt, then one per (prompt, model) on a rate-limited queue, then a judge step per prompt and a finalize step. `activities.ts` holds the steps: plain functions that upsert on natural keys.

- **Design choice:** idempotency at every layer. That means the HTTP `Idempotency-Key`, the workflow id equal to the run id, child ids derived from the run (`<run>:p<i>:<model>`), upserts, and guarded status updates. A replay after a crash finds existing work instead of paying twice.
- **Expect:** "What happens on `kill -9` mid-run?" DBOS resumes from the last checkpointed step. This was tested: 13 of 36 calls were done, and after the restart there were exactly 36 call outputs. "Why await children in a fixed order?" So the workflow is deterministic on replay.

## 11. Data: `packages/db/prisma/schema.prisma`

`Comparison` → `CompareResult`, `Judgement`, `Vote`. `EvalRun` → `EvalPrompt` → `EvalResult`. `rate_lease` and `rate_cooldown` back the lease store, and `rate_event` records its decisions. DBOS keeps its own tables.

- **Expect:** "Why aggregate the leaderboard on read?" It's fine at PoC scale. The next step is a materialised view refreshed by the worker.

## 12. Deploy: `Dockerfile`, `.do/app.yaml`, `packages/db/src/dbos-url.ts`

One image, with the final stage picked by the `COMPONENT` build arg (web or worker). A `PRE_DEPLOY` job runs migrations. `dbos-url.ts` writes DO's CA certificate to a file, so node-postgres verifies TLS instead of failing (or being told to skip verification).
