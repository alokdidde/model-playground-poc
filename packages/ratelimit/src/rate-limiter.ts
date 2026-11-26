import { delayHonoringRetryAfter, sleep } from "./backoff";
import { RateLimitExceededError } from "./errors";
import type { DenyReason, Lease, LeaseStore, Limits } from "./types";

export type BucketStrategy = "account" | "model";

export interface AcquireOptions {
  signal?: AbortSignal;
  /** Give up (throw RateLimitExceededError) after waiting this long. */
  maxWaitMs: number;
  /** Called each time we have to wait, so the UI can say "queued for capacity". */
  onWait?: (info: { waitMs: number; reason: DenyReason }) => void;
}

/**
 * The thing callers use. Wraps a LeaseStore with:
 *  - bucket naming (one shared budget per access key, or one per model),
 *  - waiting: if there is no capacity, sleep until there probably is (with
 *    jitter) and try again, up to the caller's wait budget.
 */
export class RateLimiter {
  constructor(
    readonly store: LeaseStore,
    readonly limits: Limits,
    private readonly strategy: BucketStrategy = "account",
  ) {}

  bucketFor(model: string): string {
    return this.strategy === "account" ? "gradient:account" : `gradient:model:${model}`;
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
      const result = await this.store.tryAcquire(bucket, estimatedTokens, this.limits);
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
}
