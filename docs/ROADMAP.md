# Roadmap: beyond side-by-side compare

The PoC answers "which of these models did best on *this* prompt?". If it gets traction, the real customer question becomes "**which model should I use for my workload, and how do I know it's still the right one?**". Comparing outputs by hand doesn't scale; the roadmap moves from *showing* answers, to *measuring* models on the customer's own data, to *choosing* the model automatically, and finally to *making* a better model.

Each phase reuses what the previous one collected: comparisons, judge verdicts, human votes, cost and latency.

## Why this matters to DigitalOcean

DO earns money when customers send inference traffic through DO and keep it there. Model FOMO hurts that in two ways. Customers who aren't sure stay on a default model and never try others. Others leave for a provider whose "best model" they read about. Each phase below turns that uncertainty into more usage on DO:

| Phase | What the customer gets | What DO gets | DO products it uses or sells |
| --- | --- | --- | --- |
| 1. Production ready | Use it on their own account and budget | Trial of more models per customer; a reason to sign in to the AI section | Serverless inference, App Platform, batch inference |
| 2. Evals on your data | Evidence for their own workload | Stickiness: datasets and scheduled evals live on DO, and forced model upgrades become a DO-guided migration, not a reason to shop around | Serverless and batch inference, Spaces (datasets), Managed Postgres |
| 3. Choose for me | `model: "auto"` routing at a quality bar | All of a customer's traffic goes through a DO endpoint; DO can shift volume to models with better margin at equal quality | Serverless inference, the agent platform |
| 4. Make a better model | A tuned or distilled model that beats off-the-shelf | Higher-value workloads: fine-tuning jobs and dedicated GPU capacity | Dedicated inference, GPU Droplets, the agent platform (knowledge bases, agents) |

**Why this order:** each phase needs the data the one before it collects. Routing (3) is only trustworthy once evals on customer data (2) exist, and fine-tuning (4) needs the preference pairs that 1 to 3 gather. It also ships value early. Phase 1 is weeks and uses only existing DO products.

**What we would not build:** a public, general-purpose benchmark leaderboard. Those exist already, and they answer "which model is best in general", which is the wrong question. Our edge is the customer's own prompts.

## The first thing to ship next

**Judge/human agreement, then batch evals.** Agreement tells us whether the combined view can be trusted, which everything after it depends on; it is small (days) and uses data that already exists. Batch evals (one model set over many prompts, with a cost estimate before the run) are the step after, and the first thing in phase 2.

## Phase 0: PoC (this repo)

- Side-by-side streaming compare across DO serverless models, each with its own settings, with cost, latency and tokens.
- Combined view: LLM-as-judge scores (shuffled, anonymised, neutral judge), a synthesized answer with per-model citations, and a cost/quality/speed recommendation; thumbs up/down and votes.
- A leaderboard from every compare, and Help me choose (plain words in, a shortlist ranked from measured runs out).
- Shared, lease-based rate limiting so the whole system stays inside the account's limits, with every limiter and retry decision recorded and drawn as a timeline (`/ops/rate-limits`).
- Built and cut: durable batch evals (DBOS worker). Cut to keep the PoC small enough to defend line by line; the design notes carry into phase 2.

## Phase 1: Production-ready (weeks)

Goal: something customers can use on their own account. *Size: 1 or 2 engineers, about 4 to 6 weeks. Main risk: per-customer limits and spend (many users on one customer's key can use up their quota).*

- **Auth and tenancy**: DO account login (OAuth), per-team workspaces, each team's own model access key. The middleware hook and `principal` are already in place.
- **Quotas and budgets**: per-team token budgets and spend caps on top of the lease store; show "this will cost about $X" before a large run.
- **Observability**: OpenTelemetry traces across the web app and model calls, self-hosted on DO (Arize Phoenix on App Platform, or Langfuse/SigNoz on DOKS). The rate-limit events already recorded become one more exporter (`RateEventSink`). Alerts on 429 rate and capacity waits per model.
- **Accurate tokens and prices**: per-family tokenizers, prices pulled from an API instead of a table, long-context price tiers.
- **Shareable results**: permalinks to a comparison (already there), export to CSV/JSON.

## Phase 2: Evals on your own data (1-2 quarters)

Goal: replace "vibes" with evidence on the customer's workload. *Size: a small team (3 or 4 engineers). Main risk: judge quality on specialised domains. Mitigated by calibration against human labels and deterministic checks.*

- **Batch evals**: run a model set over many prompts as a durable background job (DBOS workflows in a worker on the same Postgres; a PoC version was built and cut, so the design is proven), with a cost estimate before the run, a report (scores, wins, p50/p95 latency, cost per prompt) and DO's batch inference (up to 50% off for some models) for runs that don't need to finish in minutes. Batch needs its own share of each model's rate limit so it never starves a person watching a compare.
- **Datasets**: upload prompts (CSV/JSONL) with optional reference answers, or capture them from production traffic (opt-in, sampled, PII-scrubbed).
- **Custom rubrics and graders**: per-dataset judge prompts, plus deterministic checks (JSON schema valid, regex, contains/doesn't contain, code compiles, exact match) mixed with LLM judges.
- **Judge/human agreement from votes**: report how often the judge's winner matches the human "best answer" vote and thumbs, per task type, using the votes we already collect. Where agreement is low, re-weight or replace the judge for that task.
- **A panel of judges**: for high-stakes runs, several smaller judges from different model families vote instead of one large judge. This cuts both one model's bias and cost (Verga et al. 2024, *Replacing Judges with Juries*). It builds on the two-order judging we already do.
- **Cost/quality/latency frontier**: a Pareto chart per dataset ("Model B is 95% as good as Model A at 20% of the price").
- **Regression testing for prompts and models ("CI for prompts")**: re-run a dataset on a schedule or on every prompt change, and alert when quality drops. This matters on DO specifically because only the two most recent versions of each model stay available, so model upgrades are forced.

## Phase 3: Choose for me (2-3 quarters)

Goal: the customer stops picking models by hand. *Size: the phase 2 team plus an ML engineer. Main risk: trust. A wrong route is a production incident for the customer, so start with shadow traffic and explicit quality bars.*

- **Model recommendations**: "for prompts like yours, use X": a nearest-neighbour lookup over embeddings of past evaluated prompts, using judge scores and votes as labels.
- **Learned routing**: train a router on accumulated (prompt, model, score, cost) data to pick, per request, the cheapest model expected to meet the quality bar (as in FrugalGPT 2023 and RouteLLM 2024). This powers `model: "auto"` below.
- **Smart routing endpoint**: an OpenAI-compatible endpoint where `model: "auto"` routes each request to the cheapest model predicted to meet a quality bar, using a small classifier trained on accumulated eval data. Customers set the policy (cost-optimised, quality-optimised, latency SLO).
- **Fallback chains**: if the primary model is rate-limited or down, fail over to the next-best model for that task (the gateway already knows about 429s and outages).
- **Shadow and A/B traffic**: send a sample of live traffic to a candidate model in the background, judge offline, and promote it when it wins.
- **Council / ensemble mode**: the PoC's synthesizer, promoted to an API: several models answer, then a synthesiser merges the best parts (mixture-of-agents), or models critique each other before a final answer. Higher cost and latency, for tasks where quality matters most. The compare view becomes its debugging UI.

- **Potential: an agentic FOMO assistant.** The customer describes their use case in a chat. An agent picks candidate models, writes or collects sample prompts, runs the benchmarks (compare and batch evals through the existing APIs), and explains the tradeoffs, asking follow-up questions where the need is unclear. "Help me choose" is the first step: it already turns plain words into a task type, weights and sample prompts, and ranks from measured data. It stays out of the PoC on purpose. The brief asks for a side-by-side view, and an agent loop that spends the customer's tokens needs budgets, approval steps and evals of its own first. The same rule holds: the agent plans and explains, and the measured results make the decision.

## Phase 4: Make a better model (longer term)

Goal: close the loop from preferences to a model tuned for the customer. *Size: needs GPU capacity and an ML platform team. Main risk: cost and a long payback per customer, so it suits high-volume customers first.*

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

- **Lease store → Valkey** once call volume makes Postgres transactions per call noticeable (one more `LeaseStore` implementation behind the existing contract tests).
- **Leaderboard → materialised views** refreshed on a schedule; eventually a column store for analytics on millions of results.
- **API → standalone gateway service** (the `llm` + `ratelimit` packages lift out unchanged) when the routing endpoint ships; at that point a Rust or Go proxy may be worth it for per-request overhead.
- **App Platform → DOKS** when we need queue-depth autoscaling, sidecars, or to self-host observability or small models next to the app.
- **Batch work → DBOS, then Temporal** only if orchestration outgrows a single Postgres (multi-region, multi-team ownership); DBOS's workflow code maps closely onto Temporal's model.
