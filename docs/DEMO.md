# Demo script

About 5 minutes on the live app: https://model-fomo-qlrb3.ondigitalocean.app. Open it once a few minutes before, so the first request isn't slow.

## The 2-minute story (say this first)

> Customers on DigitalOcean can call dozens of models with one key. That makes switching cheap, but choosing hard: "did I pick the right model, or am I overpaying?" That's Model FOMO.
>
> One prompt answered by five models is a demo, not a decision. So the PoC goes in three steps. **Show me**: run one prompt on several DO models side by side, with cost and speed. **Combine it**: a neutral judge scores the answers, a synthesizer merges them with citations, and a recommendation turns that into "use X, it's 95% as good at a tenth of the cost". **Learn from it**: every compare is saved with its own page, and batch evals over the customer's own prompts come next.
>
> Everything runs on DO: serverless inference for the models, App Platform for the web app, and Managed Postgres for data and shared rate limiting.

## Walkthrough

| # | Do this | Point out |
| --- | --- | --- |
| 1 | Home → **Compare**. Pick `DeepSeek V4.1 Flash`, `GLM-5.3 Flash`, `Ministral 3 14B`. Open one model's settings drawer. | Per-model settings. Unsupported settings are disabled with the reason, from probing every model. |
| 2 | Prompt: *"Explain the CAP theorem to a backend engineer in one paragraph, with one concrete example."* Priority **Balanced**. Press Compare. | Answers stream side by side. GLM thinks first, so its first token comes later (TTFT). Cost and tokens per second are shown per model. |
| 3 | Wait for the judge and the synthesis. | The judge is a model that isn't competing, and the answers are anonymised and shuffled. The synthesis cites each model. The recommendation names the trade-off. Change the priority to **Cost** and watch the pick change. |
| 4 | Open `/ops/rate-limits?tag=<run id>` (the id is in the run URL). It is an ops view, so it is not in the nav. | Every lease, wait, 429, cooldown and retry for this compare, with how long each retry slept and why. `/ops/rate-limits` alone shows the last 30 minutes across all compares. |
| 5 | **Home** → a recent run. | Every run keeps its own page with answers, judge and metrics. There is no cross-run leaderboard on purpose: different prompts have different expectations, so averaging their scores would mislead. |
| 6 | Optional: show a failure. Point at a `PARTIAL` run in history. (The catalog only lists models this account can call, so plan-blocked models like Anthropic never appear.) | One failing model never hides the others, and the error names the model and the reason. |

## If something goes wrong live

- **A model is slow or times out:** that is the point of per-model isolation. Say so and carry on with the others.
- **429s:** the card shows "waiting for capacity" or "retrying". That is the gateway's backoff and leasing working as designed, and the rate-limit timeline shows exactly what happened.
- **The app is down:** run it locally in mock mode (`GRADIENT_MOCK=1`, see the README). It streams canned answers and injects 429s and failures.

## Close

> If this got traction, the roadmap goes from showing answers, to measuring models on the customer's own data, to choosing the model automatically (`model: "auto"`), to tuning a better one. Each step keeps more of the customer's inference on DO. Details are in ROADMAP.md, and what I'd tell the DO inference team is in DECISIONS.md.
