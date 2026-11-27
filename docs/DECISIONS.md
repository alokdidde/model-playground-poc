# Decisions: what I built, what I skipped, and why

The one-page version of the design. [ARCHITECTURE.md](ARCHITECTURE.md) has the details behind each line, and [ROADMAP.md](ROADMAP.md) has what comes next.

## The goal

Customers with Model FOMO ask: *"did I pick the right model for my prompts?"* One prompt answered by five models is a demo. A decision needs evidence. So the PoC goes in three steps:

1. **Show me.** Send one prompt to several DO models at once and watch them stream side by side, with cost, speed and tokens.
2. **Combine it.** Get one view across the answers: a neutral judge scores them, a synthesizer merges them with citations, and a recommendation weighs quality against cost and speed ("X is 95% as good at 1/10th of the cost").
3. **Learn from it.** Every compare feeds a leaderboard. Running the same models over many prompts at once (batch evals) is the next step on the roadmap.

## What I built

| Piece | Why it's there |
| --- | --- |
| Streaming side-by-side compare (SSE) | The core ask. Streaming keeps a 30-second reasoning model from feeling broken. |
| LLM judge, synthesis, recommendation | The "combined view". The judge picks the best answer, the synthesis produces a better one, and the recommendation turns the scores into a decision. |
| Leaderboard | Reading the evidence across runs, cut by task type. |
| One `ModelGateway` with retries and shared rate limiting | Every model call, from every web instance, shares the same retries, timeouts and budget, so the whole system stays inside DO's per-model limits. |
| Rate-limit observability (`/ops/rate-limits`) | Every limiter and retry decision (waited for capacity, got a 429, cooled down, learned a limit, halved the factor, slept N ms before a retry) is one row in Postgres, drawn as a timeline per model and per compare. Without it, "how does it behave under load?" is a guess. It is an engineer's ops view of the architecture, not a user feature, so it is not in the nav or on the run page; the docs link to it. |

## What I deliberately skipped

| Skipped | Why | Where it goes |
| --- | --- | --- |
| Auth and multi-tenancy | Not needed to judge the idea. `middleware.ts` already has the `authenticate()` hook and every route receives a `principal`. | Roadmap phase 1 |
| Batch evals (many prompts × many models) | Built (DBOS workflows in a separate worker, a batch lane in the rate limiter, an eval report) and then cut. It doubled the moving parts (a second service, a workflow engine, lane arithmetic, a TLS workaround) for a step the brief doesn't ask for, and every part has to be defended in review. | Roadmap phase 2 |
| Observability stack (OTel, Phoenix/Langfuse) | It has to be self-hosted on DO, which is a project of its own. Rate-limit events plus one structured log line per request cover the PoC. An OTel exporter would be one more `RateEventSink`. | Roadmap phase 1 |
| Kubernetes (DOKS) and a Helm chart | App Platform gives builds, TLS and scaling from one spec file. I provisioned a cluster, found it bought nothing for one app, and deleted it and the chart. | When a background worker needs queue-depth autoscaling, or sidecars |
| A Valkey lease store | Faster than Postgres at high call rates, but the live app never needed it, so I removed it rather than keep untested code. | One more `LeaseStore` when traffic grows |
| Temporal / DBOS | Only needed for durable batch work, which was cut. If batch comes back, DBOS (a library on the Postgres we already run) is the first choice; Temporal needs its own cluster. | With batch evals |
| Self-hosted models and fine-tuning | The brief is to use DO's AI products, and serverless inference covers it. Votes and judge verdicts are collected as future training data. | Roadmap phase 4 |
| Council / debate mode | Higher cost and latency for unclear gain at PoC stage. The synthesizer is the cheap version. | Roadmap phase 3 |
| Tool calling | Out of scope for comparing answers. | Roadmap (agent-level comparison) |

## The five tradeoffs I'd defend first

1. **SSE, not WebSockets.** The stream is one-way, SSE runs over plain HTTP through App Platform's load balancer, and cancel is just closing the request.
2. **Retry only before the first token.** Retrying after text reached the screen would show it twice. After that point a failure keeps the partial answer and is marked failed.
3. **Plain requests, no job system.** A compare is seconds long and a person is watching it; if the server dies, "run it again" is the right recovery. That is why batch evals, which do need durability, were cut rather than half-built.
4. **Lease-based rate limiting, learned from headers.** DO doesn't publish per-model limits, but every response carries `x-ratelimit-*` headers. We learn the limits, reserve tokens before each call, and share one budget across instances. DO's 429s carry no `Retry-After`, so a retry waits for the reset of the counter the headers show as spent, or fails at once if that is longer than a person will wait.
5. **The judge is a second opinion, not ground truth.** Each guard against a known bias is in place because research on LLM judges measured that bias (next section). Human votes are stored so judge/human agreement can be measured.

## How the judge is built, and why

An LLM judge has measured biases. Each guard below exists because a paper measured the bias it addresses.

| Guard | What we do | Why (source) |
| --- | --- | --- |
| **Both orders, flip = tie** | The answers are shuffled, then judged twice: in that order and reversed (two parallel calls). Scores are averaged. If the two orders pick different winners, the result is a tie and neither model gets the win. | Judges favour answers based on their position. Swapping the order and treating an inconsistent result as a tie is the fix from MT-Bench [1], and judging in both orders is the "balanced position calibration" in [2]. |
| **Length shown, not rewarded** | The rubric says not to reward length, and the judge panel shows each answer's word count next to its score. | Judges prefer longer answers. Length-controlled AlpacaEval [3] showed that controlling for length makes automatic scores agree much better with human rankings. We don't fit a regression on a PoC; we make length visible. |
| **No self-judging** | Answers are anonymised as "Response A/B/C". The judge is a model that is not competing, and if none is free the verdict is flagged `selfJudged` in the UI. | Models recognise and favour their own outputs [1, 4]. |
| **Strict output** | JSON validated with zod, one re-ask on bad JSON, instructions inside answers ignored. | A verdict we can't parse is worse than none. |

**Cost.** Judging twice doubles the judge's cost. On the live app one judge call costs about $0.0005 with `gpt-oss-120b`, so a compare's judge goes from about $0.0005 to $0.001. That is similar to the cost of the answers themselves, and well under a cent. The two calls run in parallel, so it adds almost no wait. We did not add a second judge model: that would cost the same again and has a weaker case at PoC scale (see the panel of judges on the roadmap).

**Leaderboard honesty.** Mean scores show a 95% confidence interval (± 1.96 × standard deviation / √n) and how many runs each model took part in, so two models whose ranges overlap aren't presented as different.

## Why the parts beyond the brief exist

The brief asks for a multi-model compare with a combined view. Three parts go further, and each one is the smallest version that makes the core experience trustworthy:

- **Rate-limit leasing, and its event log.** Many people comparing at once share one DO key, and DO limits each (key, model) to 120 requests a minute. Without a shared budget, every web instance would think it had the whole limit and users would collect 429s. Leasing in the Postgres we already run is the minimum that keeps instances inside one budget; retries alone only react after the limit is hit. The event log is what lets us show, not claim, how it behaves (stress test numbers in [ARCHITECTURE § 4](ARCHITECTURE.md#4-reliability-the-modelgateway)).
- **Help me choose: built, then cut.** A plain-language advisor (use case in, shortlist ranked from measured runs out) was built and removed on 2026-11-27. The brief asks for a side-by-side view and a combined result, not an AI assistant, and every extra LLM feature is more to defend. It is on the roadmap as the first step toward the agentic assistant.

## Related work

How this PoC relates to existing work, and what it borrows:

- **MT-Bench and Chatbot Arena** [1], **Chatbot Arena** [5]: LLM-as-judge and pairwise human preference at scale. We borrow the judge bias mitigations, and our human votes are a small, per-customer version of Arena.
- **HELM** [6]: holistic evaluation across many metrics (accuracy, cost, latency, robustness). Our leaderboard reports quality next to cost, latency and errors for the same reason: "best" depends on what you're paying for.
- **FrugalGPT** [7] and **RouteLLM** [8]: send each query to the cheapest model that is good enough. That is the "choose for me" phase on our roadmap. Our compares collect the training data a learned router needs.
- **LLM-Blender** [9]: rank several models' outputs, then fuse the best ones. Our judge plus synthesizer is the same idea, using one LLM for each step instead of trained rankers.

References:

1. Zheng et al., *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena*, NeurIPS 2023 (arXiv:2306.05685).
2. Wang et al., *Large Language Models are not Fair Evaluators*, 2023 (arXiv:2305.17926).
3. Dubois et al., *Length-Controlled AlpacaEval: A Simple Way to Debias Automatic Evaluators*, 2024 (arXiv:2404.04475).
4. Panickssery et al., *LLM Evaluators Recognize and Favor Their Own Generations*, 2024 (arXiv:2404.13076).
5. Chiang et al., *Chatbot Arena: An Open Platform for Evaluating LLMs by Human Preference*, 2024 (arXiv:2403.04132).
6. Liang et al., *Holistic Evaluation of Language Models (HELM)*, 2022 (arXiv:2211.09110).
7. Chen, Zaharia and Zou, *FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance*, 2023 (arXiv:2305.05176).
8. Ong et al., *RouteLLM: Learning to Route LLMs with Preference Data*, 2024 (arXiv:2406.18665).
9. Jiang, Ren and Lin, *LLM-Blender: Ensembling Large Language Models with Pairwise Ranking and Generative Fusion*, ACL 2023 (arXiv:2306.02561).
10. Verga et al., *Replacing Judges with Juries: Evaluating LLM Generations with a Panel of Diverse Models*, 2024 (arXiv:2404.18796).

## Honest limits

- **The judge is one model, and judge/human agreement is not measured yet.** The live data has no human votes yet. The vote and rating endpoints exist. The next step is to report the share of compares where the judge's winner matches the human vote (roadmap).
- **The confidence intervals are a normal approximation.** Judge scores are bounded integers, so the intervals are a guide, not a statistical test.
- **This account can't call Anthropic or proprietary OpenAI models (403).** So the demo can't show "open model vs frontier model", which is the most common FOMO question.
- **Costs use a static price table**, and tokens from failed attempts are not counted.
- **A compare reopened mid-run shows answers as they are saved**, not token by token; only the tab that started it streams live.

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
| 429s carry no `Retry-After`. The body names the spent counter (`requests_per_minute`), and the counter is a sliding window: after a burst everything gets 429 until about the minute boundary, then capacity comes back about 2 requests a second. The `reset` header is sometimes a few seconds off. | Clients have to guess when to retry. Our first version retried after 70 ms against a 5.8 s reset and just collected more 429s. | Send `Retry-After` on every 429 and document the window algorithm. |
| node-postgres treats `sslmode=require` as full verification, and DO Postgres signs with a per-account CA. | An earlier version (batch evals on DBOS) hung on "self-signed certificate in certificate chain". | Document the CA for Node clients next to the connection string, or expose it as an App Platform bindable variable. |
| Opportunity: batch inference is cheaper for some models. | Batch evals could cost much less. | Make batch inference available for the same models through the same key, so eval tools can use it. |

## What I'd do differently with more time

- Feature-freeze earlier, and cut sooner. Batch evals were built in full before I weighed what they cost to explain; scoping them to the roadmap from the start would have left more time for tests and review.
- Measure judge/human agreement from day one, and seed some human votes during testing.
- Build the judge's position and length controls in from the start instead of adding them at the end.
- Write a test for each core path as it's written, not afterwards.
