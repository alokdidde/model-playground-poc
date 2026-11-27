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
5. **The judge is a second opinion, not ground truth.** Each guard against a known bias is in place because research on LLM judges measured that bias (next section). Human votes are stored so judge/human agreement can be measured.

## How the judge is built, and why

An LLM judge has measured biases. Each guard below exists because a paper measured the bias it addresses.

| Guard | What we do | Why (source) |
| --- | --- | --- |
| **Both orders, flip = tie** | The answers are shuffled, then judged twice: in that order and reversed (two parallel calls). Scores are averaged. If the two orders pick different winners, the result is a tie and neither model gets the win. | Judges favour answers based on their position. Swapping the order and treating an inconsistent result as a tie is the fix from MT-Bench [1], and judging in both orders is the "balanced position calibration" in [2]. |
| **Length shown, not rewarded** | The rubric says not to reward length, and the judge panel shows each answer's word count next to its score. | Judges prefer longer answers. Length-controlled AlpacaEval [3] showed that controlling for length makes automatic scores agree much better with human rankings. We don't fit a regression on a PoC; we make length visible. |
| **Reference-guided** | When a prompt has a reference answer or automatic checks (batch evals), the judge sees the reference and each answer's check results (e.g. "is valid JSON: FAILED"). | Judges miss errors they could have caught with a reference. MT-Bench [1] found that giving the judge a reference answer reduces mistakes on math and reasoning. |
| **No self-judging** | Answers are anonymised as "Response A/B/C". The judge is a model that is not competing, and if none is free the verdict is flagged `selfJudged` in the UI. | Models recognise and favour their own outputs [1, 4]. |
| **Strict output** | JSON validated with zod, one re-ask on bad JSON, instructions inside answers ignored. | A verdict we can't parse is worse than none. |

**Cost.** Judging twice doubles the judge's cost. On the live app one judge call costs about $0.0005 with `gpt-oss-120b`, so a compare's judge goes from about $0.0005 to $0.001. That is similar to the cost of the answers themselves, and well under a cent. The two calls run in parallel, so it adds almost no wait. We did not add a second judge model: that would cost the same again and has a weaker case at PoC scale (see the panel of judges on the roadmap).

**Leaderboard honesty.** Mean scores show a 95% confidence interval (± 1.96 × standard deviation / √n) and how many runs each model took part in, so two models whose ranges overlap aren't presented as different.

## Why the parts beyond the brief exist

The brief asks for a multi-model compare with a combined view. Three parts go further, and each one is the smallest version that makes the core experience trustworthy:

- **Rate-limit leasing.** The web app and the worker share one DO key, and DO limits each (key, model). Without a shared budget, a batch eval would cause 429s for the person watching a compare. Leasing in the Postgres we already run is the minimum that lets two processes share one key safely. Retries alone only react after the limit is hit.
- **Durable batch evals (DBOS).** These back **Validate on my prompts**, the step that turns "one nice answer" into evidence. A 50-prompt run is hundreds of paid calls over minutes, and App Platform restarts containers. Without checkpoints, a redeploy either loses the run or pays for it twice. DBOS is a library on the same Postgres, not a new service.
- **Help me choose and the home page.** Not every customer knows which models to compare. Help me choose turns a plain-language need into a shortlist, ranked only from measured runs, and opens Compare prefilled with it. The home page simply offers the two ways in. It is a small step toward the agentic assistant on the roadmap, without the cost of an agent that spends tokens on its own.

## Related work

How this PoC relates to existing work, and what it borrows:

- **MT-Bench and Chatbot Arena** [1], **Chatbot Arena** [5]: LLM-as-judge and pairwise human preference at scale. We borrow the judge bias mitigations, and our human votes are a small, per-customer version of Arena.
- **HELM** [6]: holistic evaluation across many metrics (accuracy, cost, latency, robustness). Our leaderboard reports quality next to cost, latency and errors for the same reason: "best" depends on what you're paying for.
- **FrugalGPT** [7] and **RouteLLM** [8]: send each query to the cheapest model that is good enough. That is the "choose for me" phase on our roadmap. Our compares and evals collect the training data a learned router needs.
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
- Build the judge's position and length controls in from the start instead of adding them at the end.
- Write a test for each core path (compare, eval workflow) as it's written, not afterwards.
