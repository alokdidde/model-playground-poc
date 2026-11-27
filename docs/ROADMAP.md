# Roadmap: if Model Playground gets traction

The PoC answers "which of these models did best on *this* prompt?". With traction, the customer's real question becomes "**which model should I use for my workload, and is it still the right one?**". Comparing answers by hand doesn't scale. The roadmap moves from *showing* answers, to *measuring* models on the customer's own data, to *choosing* the model automatically, and finally to *making* a better one.

This is the text version of the roadmap PDF that accompanies the build guide. Each phase reuses what the one before it collected: comparisons, judge verdicts, human votes, cost and latency.

| Stage | Phases | What it means |
| --- | --- | --- |
| **Show** | 0, the PoC | Side-by-side answers with a neutral judge, a synthesis and a recommendation. |
| **Measure** | 1 and 2 | On the customer's account, with their own prompts and rubrics. |
| **Decide** | 3 and 4 | Route each request for them, then train a model that beats off-the-shelf. |

## What each phase could offer

Customers who aren't sure they picked the right model tend to stay on one default, or go looking elsewhere. The value to the customer is clear: evidence for their own workload. What it means for DigitalOcean is written below as a hypothesis from the outside, to test with DO's product team and data.

| Phase | The customer gets | How it could help DO | DO products |
| --- | --- | --- | --- |
| 1. Production ready | Model Playground on their own account, key and budget | Customers try more of the models already on offer | Serverless inference, App Platform |
| 2. Evals on your data | Evidence on their own workload | Evaluation data lives next to the models, so a model change can be a guided step | Serverless inference, Spaces, Managed Postgres |
| 3. Choose for me | `model: "auto"` at a quality bar they set | A routing endpoint that builds on DO's own inference | Serverless inference, agent platform |
| 4. Better model | A tuned model that beats off-the-shelf on their data | A path to fine-tuning and dedicated capacity for customers who outgrow off-the-shelf models | Dedicated inference, GPU Droplets |

**Why this order.** Each phase needs the data the one before it collects. Routing is only trustworthy once there are evals on customer data, and fine-tuning needs the preference pairs that the earlier phases gather. Phase 1 uses only DO products that exist today, so value ships early.

**Ship first: judge and human agreement.** It tells us whether the combined view can be trusted, which everything after it depends on. It's small, and it uses votes the PoC already collects. Batch evals come right after.

**Do** build on the customer's own prompts: public benchmarks can't see their workload, and that is our edge. **Don't** build another public, general-purpose leaderboard: those exist, and they answer "which model is best in general", the wrong question.

## Phase 0: the PoC (this repo)

- Side-by-side streaming compare across DO serverless models, each with its own settings, with cost, latency and tokens.
- A combined view: a neutral LLM judge run in both orders, a synthesized answer with per-model citations, and a recommendation that weighs quality against cost and speed. Human votes and thumbs sit beside the judge.
- Shared, lease-based rate limiting that keeps every instance inside the account's per-model limits, with every decision recorded and drawn as a timeline at `/ops/rate-limits`.

## Phase 1: Production ready

Goal: customers use it on their own account, with their own key and budget.

- **Sign-in and team workspaces.** DO account login, workspaces per team, each with its own model access key. The PoC already routes every request through an `authenticate()` hook, so this slots in.
- **Quotas and budgets.** Per-team token budgets and spend caps on top of the lease store, and "this will cost about $X" before a large run. Many users on one customer's key can use up their whole quota.
- **Guardrails.** Input and output moderation and PII scrubbing, because real customers will paste real data. Later, refusal rates and safety behaviour as one more column in the comparison.
- **Private networking.** App and database inside a VPC, the database open only to the app, and scoped keys per team. The PoC calls everything over public endpoints with one account-wide key.
- **Observability on DO.** OpenTelemetry traces across the app and model calls, self-hosted: Arize Phoenix on App Platform, or Langfuse or SigNoz on DOKS. Alerts on 429 rate and capacity waits. The PoC's rate-event log becomes one more exporter (`RateEventSink`).
- **Accurate cost.** Per-family tokenizers, prices from an API instead of a table, long-context price tiers, and tokens from failed attempts counted. Cost is half of every recommendation, so it has to be right.

*Main risk:* per-customer limits and spend. One busy team can exhaust a shared key, so budgets ship with sign-in, not after.
*How we'd know it works:* weekly active comparers, compares per user, the share of compares with a human vote, and judge and human agreement.

## Phase 2: Evals on your own data

Goal: replace "it felt better" with evidence on the customer's workload.

- **Judge and human agreement.** Report how often the judge's winner matches the human "best answer" vote, per dataset. Where agreement is low, re-weight or replace the judge for that task. Everything that follows trusts the judge, so measure it first, with votes we already collect.
- **Batch evals.** One set of models over many prompts as durable background jobs (DBOS workflows on the same Postgres), with a cost estimate before the run and a report of scores, wins, p50 and p95 latency and cost per prompt. One prompt is an anecdote; a dataset is evidence. Batch work gets its own share of each model's rate limit, so it never starves a person watching a compare.
- **Datasets.** Upload prompts as CSV or JSONL with optional reference answers, or capture them from production traffic: opt-in, sampled and PII-scrubbed.
- **Custom rubrics and checks.** Per-dataset judge prompts, mixed with deterministic checks: valid JSON schema, regex, exact match, code compiles. Where a rule can decide, don't ask a model.
- **Leaderboards per dataset.** Rank models only across prompts that share expectations (one dataset, or one task category with a fixed rubric), with confidence intervals so overlapping models aren't shown as different. A 7/10 on a hard coding prompt and a 7/10 on a one-line definition don't mean the same thing, so averaging across unrelated prompts misleads.
- **A panel of judges.** For high-stakes runs, several smaller judges from different model families vote instead of one large judge. It cuts both one model's bias and cost (Verga et al. 2024, *Replacing Judges with Juries*).
- **CI for prompts.** Re-run a dataset on a schedule or on every prompt change, and alert when quality drops. Model versions get retired, so the right model today can change without the customer touching anything.
- **Multimodal compare.** The same side-by-side view for image, audio and embedding models, each modality with its own judge and its own cost units.

*Main risk:* judge quality on specialised domains. Calibrate against human labels and lean on deterministic checks where they apply.
*How we'd know it works:* datasets created, scheduled eval runs, and regressions caught before the customer noticed.

## Phase 3: Choose for me

Goal: the customer stops picking models by hand.

- **A "help me choose" advisor.** Describe the use case in plain words. An LLM turns that into quality, cost and speed weights and sample prompts; our code ranks models from measured runs; the LLM explains the ranking using only those numbers, then opens a compare prefilled. It answers the FOMO question before anyone picks models, and the decision still comes from measurements.
- **Recommendations.** "For prompts like yours, use X": a nearest-neighbour lookup over past evaluated prompts, with judge scores and votes as labels.
- **Smart routing endpoint.** An OpenAI-compatible endpoint where `model: "auto"` routes each request to the cheapest model expected to meet the customer's quality bar, using a router trained on accumulated eval data. This is the approach of FrugalGPT (2023) and RouteLLM (2024): pay for a big model only when a small one won't do.
- **Fallbacks, shadow and A/B traffic.** Fail over to the next-best model when one is rate-limited or down. Send a sample of live traffic to a candidate in the background, judge it offline, and promote it when it wins. The gateway already knows about 429s and outages.
- **Council mode as an API.** Several models answer, then a synthesizer merges the best parts, or models critique each other before a final answer. More cost and latency, for tasks where quality matters most. The compare view becomes its debugging UI.
- **An agentic assistant.** Grows out of the advisor: it picks candidate models, collects sample prompts, runs the benchmarks through the existing APIs, and explains the tradeoffs. It spends the customer's tokens, so it needs budgets, approval steps and its own evals first. The agent plans and explains; measured results decide.

*Main risk:* trust. A wrong route is a production incident for the customer, so start with shadow traffic and explicit quality bars.
*How we'd know it works:* share of traffic on `model: "auto"`, and cost saved against the customer's previous fixed model at equal quality.

## Phase 4: Make a better model

Goal: close the loop from preferences to a model tuned for the customer.

- **Preference data.** Every vote and judge verdict is a (prompt, chosen, rejected) pair, the format DPO-style fine-tuning needs. Phases 1 to 3 collect it as a by-product.
- **Fine-tune and distill.** Tune an open-weight model, or distill a large model into a small one, deploy it on DO dedicated inference or GPU Droplets, and switch traffic only after it beats the incumbents on the customer's dataset.
- **Agent-level comparisons.** Compare whole DO agents (model, system prompt, knowledge base and tools), not just models. That's what customers actually ship.

*Main risk, and the signal:* cost and a long payback per customer. We'd count tuned models deployed, and their win rate against the best off-the-shelf model.

## Scaling: infrastructure grows with load, not before

The first ceiling is DO's per-model rate limit, not our servers. The lease store already shares that budget across instances, so adding web instances is safe today. Beyond that:

| From | To | When |
| --- | --- | --- |
| Postgres leases | Valkey | When a transaction per model call starts to show. One more `LeaseStore` behind the same contract tests. |
| App Platform | DOKS | When workers need queue-depth autoscaling or sidecars, or to self-host observability next to the app. |
| In-app gateway | Gateway service | When the routing endpoint ships. The `llm` and `ratelimit` packages lift out unchanged. |
| DBOS | Temporal | Only if batch orchestration outgrows one Postgres: many regions or many owning teams. |
