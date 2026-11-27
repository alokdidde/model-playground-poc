# Rate limits under stress: what we measured, what we changed

This doc covers how the leasing and 429 handling behaves when DO's limits are actually hit. It explains how we can see that behaviour, how it compares with published best practice, and what changed as a result. The design itself is in [ARCHITECTURE.md § Staying under the limits](ARCHITECTURE.md#staying-under-the-limits-leasing).

## 1. Observability: a `rate_event` table and one timeline page

Every decision the limiter and the gateway make is now one row in `rate_event`. The kinds are listed in `packages/ratelimit/src/events.ts`:

| Event | `ms` means | `data` holds |
| --- | --- | --- |
| `lease_granted` | total time waited for capacity | bucket levels (`used` / `max` for requests, tokens, in-flight), AIMD factor, polls |
| `lease_wait` | the first sleep before asking again | why (`requests`, `tokens`, `in_flight`, `cooldown`), bucket levels |
| `lease_timeout` | how long it waited before giving up | why |
| `lease_released` | | tokens reserved vs actually used |
| `rate_limited` | | DO's headers on the 429 (remaining, reset), the wait we derived |
| `cooldown` | how long the bucket is blocked | cause (`429` or `requests exhausted`), whether AIMD decreased |
| `limits_learned` | | new and previous learned limits |
| `factor_changed` | | AIMD factor from → to, and why |
| `retry` | the delay actually slept | backoff ceiling, full-jitter draw, server wait + spread |
| `attempt_ok` / `attempt_failed` | attempt duration | TTFT, tokens, DO `x-request-id`, `do-upstream-service-time`, error kind |

Rows are tagged with the comparison or eval run id, so `/ops/rate-limits?tag=<run id>` shows one run. Each eval run page links to it. The page draws, per model: requests in our window against each lane's effective limit, the AIMD factor, and a strip of waits, 429s, cooldowns and retry sleeps. Every retry also gets a table row breaking down its delay. `GET /api/ops/rate-events` returns the raw rows and a summary for offline analysis.

**Why this and not OTel + Arize Phoenix (or Langfuse, SigNoz).** The questions here are about *our limiter's* decisions: why a call waited, what the bucket looked like, how the factor moved, and what a retry slept. Those are domain events, not spans. A tracing backend would need a new service on App Platform, a collector and a new UI, just to show the same handful of numbers. Postgres is already there. `PostgresEventSink` buffers events and writes them with one `INSERT` per second, never blocking or failing a model call. Rows older than 7 days are pruned, and `RATE_EVENTS=off` turns recording off. If we add OTel later, it's one more `RateEventSink` that turns events into span events or metrics. The emit points stay the same.

## 2. What DO actually does (measured 2026-11-27)

- **429s carry no `Retry-After`.** The body says which counter ran out (`Rate limit exceeded: requests_per_minute.`), and the `x-ratelimit-*` headers come with it (`remaining-requests: 0`, `reset-requests: <epoch s>`).
- **The counter is a sliding window counter, not a fixed window or a token bucket.** We ran 130 calls in 4 s, then one call every 2 s (`window.mjs` probe):
  - Everything got a 429 until exactly the next minute boundary (`reset` = `:00`).
  - After that, `remaining` did not jump back to 120. It started at 2 and grew by about 2 per second.
  - This matches the Cloudflare/nginx "sliding window counter": `used ≈ previous minute × (1 − elapsed/60) + this minute`.
  - So right after a burst, capacity returns gradually over the next minute, while the `reset` header points at the end of the current minute.
- **`reset` is a hint, not a promise.** In 2 of the 5 429s in our runs, the reset was a few seconds away rather than at `:00` (DO probably runs more than one counter behind its load balancer). A retry at reset + 63 ms got a second 429.
- Other headers worth keeping: `x-request-id`, to quote to DO support; `do-upstream-service-time`, the model's own time without network or gateway time; and per-day tokens, where `remaining` is about 10% of the limit, an oddity also seen on 2026-11-26.

## 3. Best practice vs ours

| Practice (source) | What it says | Ours before | Gap |
| --- | --- | --- | --- |
| Exponential backoff + full jitter ([AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/), [Builders' Library](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)) | `random(0, min(cap, base·2^n))`. Cap attempts and retry at one layer only. | Yes. SDK retries off, one layer in the gateway. 3 attempts interactive, 5 batch. | None. |
| Honour the server's wait (OpenAI/Anthropic rate-limit guides) | Wait at least `Retry-After` and read the limit headers. | Honoured `Retry-After`, but DO doesn't send it. A 429 retry slept 0–500 ms of jitter and then queued in the limiter. | **Fixed:** the spent counter's reset is used as Retry-After. |
| Respect the caller's deadline (Builders' Library, SRE "deadline propagation") | Don't retry if the retry can't finish in time. | Retried, then failed in the limiter after the wait budget. | **Fixed:** the gateway gives up at once when the wait exceeds the caller's budget. |
| Client-side adaptive throttling ([Google SRE ch. 21](https://sre.google/sre-book/handling-overload/)) / AIMD | Slow down in proportion to rejections; one overload event is one signal. | AIMD halves on a 429. But a single event halved it twice, and a header-predicted cooldown (someone else used the window) also halved it. | **Fixed:** only real 429s decrease the factor, debounced to one decrease per 5 s. |
| Shared, global limiter ([GCRA](https://brandur.org/rate-limiting), Envoy global rate limit) | Every instance draws from one budget. | Yes: Postgres leases with an advisory lock, and a shared cooldown. | The AIMD factor and learned limits are still per process. |
| Retry budgets ([Envoy](https://www.envoyproxy.io/docs/envoy/latest/api-v3/config/cluster/v3/circuit_breaker.proto) `budget_percent` 20%, SRE "10% per client") | Cap retries as a share of live traffic, so retries can't amplify an outage. | Per-call caps only. | Open. The lease limiter bounds total request rate (retries included), so a 429 storm can't amplify past DO's limit. A 5xx storm still triples load. |
| Reserve `max_tokens` against TPM ([OpenAI rate-limit guide](https://developers.openai.com/api/docs/guides/rate-limits)) | Limits are estimated from the max of `max_tokens` and the input. | Yes: reserve input + `max_tokens`, then refund actual use. | Estimates use 4 chars/token (known). |
| Priority with work conservation (weighted fair queuing) | Low priority uses idle capacity. | Batch is capped at 30% even when nobody is comparing. | Open. See §5. |

## 4. The experiments

All runs went against **real DO inference** from a local web + worker on a local Postgres. The code and config matched live (`RATE_LIMIT_BATCH_SHARE=0.3`, in-flight 16). Each batch eval ran Ministral 3 14B and GLM-5.3 Flash, and gpt-oss-120b judged every prompt in both orders. Partway through, `scripts/stress-batch.mjs` fired 130–150 tiny calls on Ministral straight at DO, like a second app sharing the key, so that DO's counter really ran out. Total spend was **$0.13** plus well under $0.01 for the bursts.

| Run | Code | Calls (eval + judge) | Burst (ok / 429) | 429s our calls got | Retry slept vs DO reset | AIMD low point | Ministral wait p95 | Wall time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | before | 200 + 200 | 104 / 26 | **0** | – | 0.5 (web only) | 29 s | 475 s |
| B2 | before | 120 + 120 | 106 / 44 | 1 | **70 ms** vs 5.8 s | **0.25** (one event halved twice) | 48 s | 273 s |
| A1 | header headroom rule (reverted) | 120 + 120 | 105 / 45 | 1 | 3.65 s vs 3.10 s ✓ | 0.5 | **117 s** | 344 s |
| A2 | after | 120 + 120 | 106 / 44 | 2 | 8.31 s vs 8.25 s ✓, 2.59 s vs 2.55 s ✓ | 0.28 (two separate 429s, 9 s apart) | 62 s | 303 s |

Every run finished with **0 failed calls**. What the timelines show:

1. **The shared cooldown does most of the work.** In B1 an interactive compare happened to see `remaining-requests: 0` first. The bucket was blocked for 48 s for *every* process, and the batch waited instead of collecting 429s. When the batch sees the 429 itself (B2, A2), there is exactly one 429 per exhaustion. Everyone else queues behind the cooldown.
2. **Retry timing now tells the truth.** Before, the retry table said "slept 70 ms" while the call actually sat in the limiter for 6 s. Now a 429 retry sleeps `reset + spread` (63 ms and 40 ms of spread), and the backoff ceiling and jitter draw are recorded next to it.
3. **AIMD no longer over-reacts.** In B2 one neighbour burst cut Ministral's batch limit from 32 to 8 requests/min, and it took about 70 s to recover. Now a header-predicted exhaustion doesn't touch the factor, and parallel 429s count once. A2's drop to 0.28 came from two separate 429s, because DO's reset hint was wrong once. Recovery is +0.05 per successful call: back to 1.0 within about 90 s at batch speed.
4. **A1 is why we don't cool down on "nearly spent".** We tried blocking the bucket when DO said ≤ 10% remained. Because DO refills gradually (§2), that blocked for 37–59 s while capacity was coming back within seconds. p95 wait went from 48 s to 117 s. We reverted it and only cool down at exactly 0.
5. **Interactive during a neighbour's burst fails fast now, and says why.** In A2 a compare started 6 s after the burst. GLM answered, and Ministral gave up after 5 s with a 429 problem ("no capacity (cooldown) within 15000 ms"), not a 60 s spinner. Before the fix this was reported as a 500 "unexpected error": in Next.js dev the error class was loaded twice and `instanceof` failed. It is now also matched by name.
6. **The real throughput limit is our own batch lane, not DO.** gpt-oss-120b (the judge, about 8 s per call, 2 calls per prompt) waited for an **in-flight** slot on 99 of 120 leases, at p95 38 s. The batch lane gets `floor(16 × 0.3) = 4` concurrent calls per model. By Little's law that's 4 / 8 s = 30 judge calls/min = 15 prompts/min, so a 100-prompt eval takes about 8 minutes. The old claim in ARCHITECTURE.md ("50 × 3 in about 1.5 minutes") was wrong and has been corrected.

## 5. What's still open, in order of value

1. **Make the batch lane work-conserving.** Let batch borrow idle interactive capacity and keep only a small reserve: say 10 requests and 2 in-flight slots per model, enough for a few compares. That would make evals about 3× faster. It changes a decision we made on 2026-11-26 (70% held for interactive), so it's Alok's call.
2. **Share the AIMD factor and learned limits across processes.** Store them in a `rate_bucket` row in Postgres (or Valkey). Today the web app doesn't learn from the worker's 429s.
3. **Check the daily token budget before starting a batch.** `remaining-tokens-per-day` is about 3M on Ministral. A big eval could use it up and then fail for hours.
4. **Add a retry budget for 5xx/timeouts** (at most 20% of a bucket's calls per window are retries), so a provider outage isn't tripled.
5. **Queue waiters FIFO** instead of having them poll with jitter, so a long waiter can't be overtaken by newcomers indefinitely.
6. **Feedback for DO:** send `Retry-After` on 429s, document the sliding-window semantics, and explain why `remaining-tokens-per-day` starts at 10%.

## Reproduce

```bash
pnpm dev                                    # web + worker against real DO (GRADIENT_MOCK=0)
node scripts/stress-batch.mjs --prompts 60 --models mistral-3-14B,glm-5.3-flash \
     --burst mistral-3-14B --burst-at 30 --burst-size 150 --compare-at 6
# then open the printed /ops/rate-limits?tag=<run id>
```
