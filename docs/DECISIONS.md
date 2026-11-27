# Decisions: what I built, what I skipped, and why

The one-page version of the design. [ARCHITECTURE.md](ARCHITECTURE.md) has the details behind each line, and [ROADMAP.md](ROADMAP.md) has what comes next.

## The goal

Customers with Model FOMO ask: *"did I pick the right model for my prompts?"* One prompt answered by five models is a demo. A decision needs evidence. So the PoC goes in three steps:

1. **Show me.** Send one prompt to several DO models at once and watch them stream side by side, with cost, speed and tokens.
2. **Combine it.** Get one view across the answers: a neutral judge scores them, a synthesizer merges them with citations, and a recommendation weighs quality against cost and speed ("X is 95% as good at 1/10th of the cost").
3. **Prove it.** Turn that compare into a batch eval over the customer's own prompts in one click, and read the result as a report and a leaderboard.

## What I built

| Piece | Why it's there |
| --- | --- |
| Streaming side-by-side compare (SSE) | The core ask. Streaming keeps a 30-second reasoning model from feeling broken. |
| LLM judge, synthesis, recommendation | The "combined view". The judge picks the best answer, the synthesis produces a better one, and the recommendation turns the scores into a decision. |
| Validate on my prompts + batch evals (DBOS) | One prompt is an anecdote. Batch runs are long and cost money, so they must survive restarts without paying twice. |
| Eval report, leaderboard, Help me choose | Reading the evidence. Help me choose answers in plain words, but it ranks from measured data only: the model writes the text, our code makes the decision. |
| One `ModelGateway` with retries and shared rate limiting | Every model call (web and worker) shares the same retries, timeouts and budget, so the whole system stays inside DO's per-model limits. |

## What I deliberately skipped

| Skipped | Why | Where it goes |
| --- | --- | --- |
| Auth and multi-tenancy | Not needed to judge the idea. `middleware.ts` already has the `authenticate()` hook and every route receives a `principal`. | Roadmap phase 1 |
| Observability stack (OTel, Phoenix/Langfuse) | It has to be self-hosted on DO, which is a project of its own. One structured log line per request covers the PoC. | Roadmap phase 1 |
| Kubernetes (DOKS) and a Helm chart | App Platform gives builds, TLS and scaling from one spec file. I provisioned a cluster, found it bought nothing for one app, and deleted it and the chart. | When the worker needs queue-depth autoscaling or sidecars |
| A Valkey lease store | Faster than Postgres at high call rates, but the live app never needed it, so I removed it rather than keep untested code. | One more `LeaseStore` when traffic grows |
| Temporal | Needs its own cluster. DBOS is a library on the Postgres we already run. | Only if orchestration outgrows one Postgres |
| Self-hosted models and fine-tuning | The brief is to use DO's AI products, and serverless inference covers it. Votes and judge verdicts are collected as future training data. | Roadmap phase 4 |
| Council / debate mode | Higher cost and latency for unclear gain at PoC stage. The synthesizer is the cheap version. | Roadmap phase 3 |
| Tool calling | Out of scope for comparing answers. | Roadmap (agent-level comparison) |

## The five tradeoffs I'd defend first

1. **SSE, not WebSockets.** The stream is one-way, SSE runs over plain HTTP through App Platform's load balancer, and cancel is just closing the request.
2. **Retry only before the first token.** Retrying after text reached the screen would show it twice. After that point a failure keeps the partial answer and is marked failed. Batch evals have no viewer, so they restart the stream.
3. **DBOS for batch, plain requests for compare.** Compare needs speed, and a crash just means "run it again". Batch needs durability. Each call is checkpointed in Postgres, and killing the worker mid-run (tested with `kill -9`) resumed without repeating a call.
4. **Lease-based rate limiting, learned from headers.** DO doesn't publish per-model limits, but every response carries `x-ratelimit-*` headers. We learn the limits, reserve tokens before each call, and keep 70% of capacity for interactive users.
5. **The judge is a second opinion, not ground truth.** Answers are shuffled and anonymised, and the judge is never one of the contestants. Deterministic checks run beside it, and human votes are stored so we can measure judge/human agreement.

## Honest limits

- **The judge is one model, and judge/human agreement is not measured yet.** The live data has 14 compares and no human votes. The vote and rating endpoints exist. The next step is to report the share of compares where the judge's winner matches the human vote, and to add a second judge when they disagree.
- **This account can't call Anthropic or proprietary OpenAI models (403).** So the demo can't show "open model vs frontier model", which is the most common FOMO question.
- **Costs use a static price table**, and tokens from failed attempts are not counted.
- **A compare whose browser disconnects is cancelled**, not finished in the background.

## Feedback for DigitalOcean

What I ran into while building on DO's AI stack, and what would have helped. Each one is something a real customer would hit too.

| What happened | Impact | Suggestion |
| --- | --- | --- |
| Anthropic and proprietary OpenAI models return `403 not available for your subscription tier`, but `GET /v1/models` lists them anyway. | We had to probe every model to learn what this key can call. A customer's first compare can fail on models they were shown. | Filter the models list by what the key can call, or add an `available` flag with the reason. |
| Per-model rate limits aren't documented. They are 120 requests/min per model, with different token limits per model. | We had to learn them from `x-ratelimit-*` headers. Most clients will just hit 429s. | Document the limits per model and tier, and say that they are counted per (key, model). |
| `x-ratelimit-remaining-tokens-per-day` showed about 10% of the limit right after light use. | Hard to tell whether the daily quota is shared, already spent, or reported wrong. | Document what the daily counter covers, or show usage against it in the control panel. |
| Models accept different parameters: Kimi rejects `temperature` and `top_p`, and some models reject `reasoning_effort`. | Requests fail with 400s that look like bugs on the caller's side. | Publish per-model capabilities in the models API. |
| The docs don't say whether `stream_options.include_usage` is supported. | Streaming token counts (and so cost) may be estimates. | State it in the API reference. |
| The account's database cluster limit refused an App Platform spec-managed database. | The live app wires an existing cluster in through secret URLs instead. | A clearer error in App Platform, and a pointer to the limit. |
| node-postgres (used by DBOS) treats `sslmode=require` as full verification, and DO Postgres signs with a per-account CA. | The first deploy's batch evals hung on "self-signed certificate in certificate chain". | Document the CA for Node clients next to the connection string, or expose it as an App Platform bindable variable. |
| Opportunity: batch inference is cheaper for some models. | Batch evals could cost much less. | Make batch inference available for the same models through the same key, so eval tools can use it. |

## What I'd do differently with more time

- Feature-freeze earlier. I added the eval report and Help me choose late, which left less time for tests and review.
- Measure judge/human agreement from day one, and seed some human votes during testing.
- Write a test for each core path (compare, eval workflow) as it's written, not afterwards.
