import { delayHonoringRetryAfter, sleep } from "./backoff";
import { RateLimitExceededError } from "./errors";
import type { DenyReason, Lane, Lease, LeaseStore, Limits, ObservedLimits } from "./types";

export type BucketStrategy = "account" | "model";

export interface AcquireOptions {
  signal?: AbortSignal;
  /** Interactive (default) may use all capacity; batch only `limits.batchShare` of it. */
  lane?: Lane;
  /** Give up (throw RateLimitExceededError) after waiting this long. */
  maxWaitMs: number;
  /** Called each time we have to wait, so the UI can say "queued for capacity". */
  onWait?: (info: { waitMs: number; reason: DenyReason }) => void;
}

/**
 * The thing callers use. Wraps a LeaseStore with:
 *  - bucket naming: one budget per (access key, model) by default, because
 *    DO counts requests and tokens per model; "account" shares one budget,
 *  - priority lanes (interactive vs batch),
 *  - learning limits from response headers (`observe`),
 *  - waiting: if there is no capacity, sleep until there probably is (with
 *    jitter) and try again, up to the caller's wait budget.
 */
export class RateLimiter {
  constructor(
    readonly store: LeaseStore,
    readonly limits: Limits,
    private readonly strategy: BucketStrategy = "model",
    /** Identifies the access key without revealing it (a short hash), so two keys never share a bucket. */
    private readonly scope = "default",
  ) {}

  bucketFor(model: string): string {
    return this.strategy === "account" ? `gradient:${this.scope}` : `gradient:${this.scope}:${model}`;
  }

  async acquire(model: string, estimatedTokens: number, opts: AcquireOptions): Promise<Lease> {
    if (estimatedTokens > this.limits.tokensPerWindow) {
      throw new RateLimitExceededError(
        "too_large",
        0,
        `Request needs ~${estimatedTokens} tokens but the budget is ${this.limits.tokensPerWindow} per window`,
      );
    }

    const bucket = this.bucketFor(model);
    const deadline = Date.now() + opts.maxWaitMs;
    for (let attempt = 1; ; attempt++) {
      const result = await this.store.tryAcquire(bucket, estimatedTokens, this.limits, opts.lane ?? "interactive");
      if (result.granted) return result.lease;

      const waitMs = delayHonoringRetryAfter(attempt, result.retryAfterMs, { baseMs: 100, capMs: 2_000 });
      if (Date.now() + waitMs > deadline) {
        throw new RateLimitExceededError(
          result.reason,
          result.retryAfterMs,
          `No capacity (${result.reason}) for ${model} within ${opts.maxWaitMs}ms`,
        );
      }
      opts.onWait?.({ waitMs, reason: result.reason });
      await sleep(waitMs, opts.signal);
    }
  }

  release(lease: Lease, actualTokens: number): Promise<void> {
    return this.store.release(lease, actualTokens, this.limits);
  }

  coolDown(model: string, ms: number): Promise<void> {
    return this.store.coolDown(this.bucketFor(model), ms);
  }

  /**
   * Feeds the provider's rate-limit headers back in: learned limits replace
   * the configured fallback, and an exhausted counter (remaining 0, per minute
   * or per day) blocks the bucket until it resets instead of collecting 429s.
   */
  async observe(model: string, observed: ObservedLimits): Promise<void> {
    const bucket = this.bucketFor(model);
    await this.store.observe(bucket, observed);
    const exhausted = [
      [observed.remainingRequests, observed.resetRequestsMs],
      [observed.remainingTokens, observed.resetTokensMs],
      [observed.remainingTokensPerDay, observed.resetTokensPerDayMs],
    ] as const;
    for (const [remaining, resetMs] of exhausted) {
      if (remaining === 0 && resetMs) await this.store.coolDown(bucket, resetMs);
    }
  }
}
