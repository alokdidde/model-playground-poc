# Roadmap: beyond side-by-side compare

The PoC answers "which of these models did best on *this* prompt?". If it gets traction, the real customer question becomes "**which model should I use for my workload, and how do I know it's still the right one?**". Comparing outputs by hand doesn't scale; the roadmap moves from *showing* answers, to *measuring* models on the customer's own data, to *choosing* the model automatically, and finally to *making* a better model.

Each phase reuses what the previous one collected: comparisons, judge verdicts, human votes, eval results, cost and latency.

## Phase 0: PoC (this repo)

- Side-by-side streaming compare across DO serverless models, with cost, latency and tokens.
- LLM-as-judge combined view (shuffled, anonymised, neutral judge) plus human votes.
- Durable batch evals (DBOS) and a leaderboard.
- Shared, lease-based rate limiting so the whole system stays inside the account's limits.

## Phase 1: Production-ready (weeks)

Goal: something customers can use on their own account.

- **Auth and tenancy**: DO account login (OAuth), per-team workspaces, each team's own model access key. The middleware hook and `principal` are already in place.
- **Quotas and budgets**: per-team token budgets and spend caps on top of the lease store; show "this run will cost about $X" before starting a batch eval.
- **Observability**: OpenTelemetry traces across web, worker and model calls (DBOS emits spans); dashboards for p50/p95 latency, error rate and 429 rate per model.
- **Accurate tokens and prices**: per-family tokenizers, prices pulled from an API instead of a table, long-context price tiers.
- **Shareable results**: permalinks to a comparison or eval run, export to CSV/JSON.
- **Cheaper batch evals**: use DO's batch inference (up to 50% off for some models) for runs that don't need to finish in minutes.

## Phase 2: Evals on your own data (1-2 quarters)

Goal: replace "vibes" with evidence on the customer's workload.

- **Datasets**: upload prompts (CSV/JSONL) with optional reference answers, or capture them from production traffic (opt-in, sampled, PII-scrubbed).
- **Custom rubrics and graders**: per-dataset judge prompts, plus deterministic checks (JSON schema valid, regex, contains/doesn't contain, code compiles, exact match) mixed with LLM judges.
- **Judge calibration**: measure judge/human agreement using the votes we already collect; use multiple judges and majority voting for high-stakes runs; report confidence intervals, not just averages.
- **Cost/quality/latency frontier**: a Pareto chart per dataset ("Model B is 95% as good as Model A at 20% of the price").
- **Regression testing for prompts and models ("CI for prompts")**: re-run a dataset on a schedule or on every prompt change, and alert when quality drops. This matters on DO specifically because only the two most recent versions of each model stay available, so model upgrades are forced.

## Phase 3: Choose for me (2-3 quarters)

Goal: the customer stops picking models by hand.

- **Model recommendations**: "for prompts like yours, use X": a nearest-neighbour lookup over embeddings of past evaluated prompts, using judge scores and votes as labels.
- **Smart routing endpoint**: an OpenAI-compatible endpoint where `model: "auto"` routes each request to the cheapest model predicted to meet a quality bar, using a small classifier trained on accumulated eval data. Customers set the policy (cost-optimised, quality-optimised, latency SLO).
- **Fallback chains**: if the primary model is rate-limited or down, fail over to the next-best model for that task (the gateway already knows about 429s and outages).
- **Shadow and A/B traffic**: send a sample of live traffic to a candidate model in the background, judge offline, and promote it when it wins.
- **Council / ensemble mode**: several models answer, then a synthesiser merges the best parts (mixture-of-agents), or models critique each other before a final answer. Higher cost and latency, for tasks where quality matters most. The compare view becomes its debugging UI.

## Phase 4: Make a better model (longer term)

Goal: close the loop from preferences to a model tuned for the customer.

- **Preference data**: every vote and judge verdict is a (prompt, chosen, rejected) pair, the exact format DPO-style fine-tuning needs.
- **Fine-tune and distill**: fine-tune an open-weight model (or distill a large model's outputs into a small one) on that data, deploy it on DO dedicated inference, and evaluate it against the incumbents on the customer's dataset before switching traffic.
- **Agent-level comparisons**: compare whole DO AI agents (model + system prompt + knowledge base + tools), not just models, since that's what customers actually ship.

## How we'd measure success

| Phase | Signal |
| --- | --- |
| 0-1 | Weekly active comparers; comparisons per user; share of comparisons with a vote; judge/human agreement rate. |
| 2 | Datasets created; scheduled eval runs; regressions caught before customers noticed. |
| 3 | Share of traffic on `model: "auto"`; cost saved vs. the customer's previous fixed model at equal quality. |
| 4 | Fine-tuned models deployed; win rate of tuned models vs. the best off-the-shelf model. |

## Technical evolution that supports this

- **Lease store → Valkey** once call volume makes Postgres transactions per call noticeable (config switch today).
- **Leaderboard → materialised views** refreshed by the worker; eventually a column store for analytics on millions of results.
- **API → standalone gateway service** (the `llm` + `ratelimit` packages lift out unchanged) when the routing endpoint ships; at that point a Rust or Go proxy may be worth it for per-request overhead.
- **DBOS → Temporal** only if orchestration needs outgrow a single Postgres (multi-region, multi-team ownership); DBOS's workflow code maps closely onto Temporal's model.
