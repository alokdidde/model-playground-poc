import { delayHonoringRetryAfter, sleep } from "./backoff";
import { RateLimitExceededError } from "./errors";
import { noopSink, type RateEvent, type RateEventSink } from "./events";
import type { DenyReason, Lease, LeaseStore, Limits, ObservedLimits } from "./types";

export type BucketStrategy = "account" | "model";

export interface AcquireOptions {
  signal?: AbortSignal;
  /** Give up (throw RateLimitExceededError) after waiting this long. */
  maxWaitMs: number;
  /** Called each time we have to wait, so the UI can say "queued for capacity". */
  onWait?: (info: { waitMs: number; reason: DenyReason }) => void;
  /** Correlation id for events (a comparison id). */
  tag?: string;
}

/**
 * The thing callers use. Wraps a LeaseStore with:
 *  - bucket naming: one budget per (access key, model) by default, because
 *    DO counts requests and tokens per model; "account" shares one budget,
 *  - learning limits from response headers (`observe`),
 *  - waiting: if there is no capacity, sleep until there probably is (with
 *    jitter) and try again, up to the caller's wait budget,
 *  - events: every decision is reported to `events` (see events.ts).
 */
export class RateLimiter {
  constructor(
    readonly store: LeaseStore,
    readonly limits: Limits,
    private readonly strategy: BucketStrategy = "model",
    /** Identifies the access key without revealing it (a short hash), so two keys never share a bucket. */
    private readonly scope = "default",
    readonly events: RateEventSink = noopSink,
  ) {}

  bucketFor(model: string): string {
    return this.strategy === "account" ? `gradient:${this.scope}` : `gradient:${this.scope}:${model}`;
  }

  async acquire(model: string, estimatedTokens: number, opts: AcquireOptions): Promise<Lease> {
    const base = { model, tag: opts.tag } satisfies Partial<RateEvent>;
    if (estimatedTokens > this.limits.tokensPerWindow) {
      throw new RateLimitExceededError(
        "too_large",
        0,
        `Request needs ~${estimatedTokens} tokens but the budget is ${this.limits.tokensPerWindow} per window`,
      );
    }

    const bucket = this.bucketFor(model);
    const startedAt = Date.now();
    const deadline = startedAt + opts.maxWaitMs;
    for (let attempt = 1; ; attempt++) {
      const result = await this.store.tryAcquire(bucket, estimatedTokens, this.limits);
      if (result.granted) {
        this.events.emit({
          ...base,
          kind: "lease_granted",
          ms: Date.now() - startedAt,
          data: { tokensReserved: estimatedTokens, polls: attempt, ...result.snapshot },
        });
        return { ...result.lease, ...base };
      }

      const waitMs = delayHonoringRetryAfter(attempt, result.retryAfterMs, { baseMs: 100, capMs: 2_000 });
      if (Date.now() + waitMs > deadline) {
        this.events.emit({ ...base, kind: "lease_timeout", ms: Date.now() - startedAt, data: { reason: result.reason, ...result.snapshot } });
        throw new RateLimitExceededError(
          result.reason,
          result.retryAfterMs,
          `No capacity (${result.reason}) for ${model} within ${opts.maxWaitMs}ms`,
        );
      }
      // Only the first wait of a call is logged in full; later polls are counted in lease_granted.polls.
      if (attempt === 1) {
        this.events.emit({ ...base, kind: "lease_wait", ms: waitMs, data: { reason: result.reason, retryAfterMs: result.retryAfterMs, ...result.snapshot } });
      }
      opts.onWait?.({ waitMs, reason: result.reason });
      await sleep(waitMs, opts.signal);
    }
  }

  async release(lease: Lease, actualTokens: number): Promise<void> {
    const before = this.store.inspect(lease.bucket).factor;
    await this.store.release(lease, actualTokens, this.limits);
    this.events.emit({
      kind: "lease_released",
      model: lease.model,
      tag: lease.tag,
      data: { tokensReserved: lease.tokensReserved, tokensActual: actualTokens },
    });
    this.reportFactor(lease.bucket, { model: lease.model, tag: lease.tag }, before, "success");
  }

  /**
   * Blocks the bucket for everyone for `ms`. After a real 429 (`decrease`) the
   * AIMD factor is halved too; see LeaseStore.coolDown.
   */
  async coolDown(model: string, ms: number, cause = "429", decrease = true, tag?: string): Promise<void> {
    const bucket = this.bucketFor(model);
    const before = this.store.inspect(bucket).factor;
    await this.store.coolDown(bucket, ms, decrease);
    this.events.emit({ kind: "cooldown", model, tag, ms, data: { cause, decrease } });
    if (decrease) this.reportFactor(bucket, { model, tag }, before, cause);
  }

  /**
   * Feeds the provider's rate-limit headers back in: learned limits replace
   * the configured fallback, and an exhausted counter (remaining 0, per minute
   * or per day) blocks the bucket until it resets instead of collecting 429s.
   *
   * That cooldown leaves the AIMD factor alone: the limit is known, only this
   * window is spent (often by another app on the same key). And it waits for
   * exactly 0, not "nearly 0": DO refills its counter gradually, so with a few
   * requests left capacity comes back within seconds (measured 2026-11-27).
   *
   * `tag` only labels the events this causes (the run whose call returned these headers).
   */
  async observe(model: string, observed: ObservedLimits, tag?: string): Promise<void> {
    const bucket = this.bucketFor(model);
    const before = this.store.inspect(bucket);
    await this.store.observe(bucket, observed);
    const after = this.store.inspect(bucket);
    if (after.learnedRequests !== before.learnedRequests || after.learnedTokens !== before.learnedTokens) {
      this.events.emit({
        kind: "limits_learned",
        model,
        tag,
        data: { requests: after.learnedRequests, tokens: after.learnedTokens, previous: { requests: before.learnedRequests, tokens: before.learnedTokens } },
      });
    }
    const exhausted = [
      ["requests", observed.remainingRequests, observed.resetRequestsMs],
      ["tokens", observed.remainingTokens, observed.resetTokensMs],
      ["tokens_per_day", observed.remainingTokensPerDay, observed.resetTokensPerDayMs],
    ] as const;
    for (const [counter, remaining, resetMs] of exhausted) {
      if (remaining === 0 && resetMs) await this.coolDown(model, resetMs, `${counter} exhausted`, false, tag);
    }
  }

  private reportFactor(bucket: string, who: { model?: string; tag?: string }, before: number, cause: string) {
    const after = this.store.inspect(bucket).factor;
    if (after !== before) this.events.emit({ kind: "factor_changed", ...who, data: { from: before, to: after, cause } });
  }
}
