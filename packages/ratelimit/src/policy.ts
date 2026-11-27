import type { Limits, ObservedLimits } from "./types";

/**
 * The bucket policy, shared by every store.
 *
 *   base      = learned limit × LEARNED_SAFETY, or the configured fallback
 *   effective = base × aimdFactor
 *
 * The AIMD factor starts at 1, halves on a 429 (multiplicative decrease)
 * and recovers by AIMD_STEP per finished call (additive increase), so we
 * converge on what the provider really allows even when it publishes no
 * limits or shares them with other users of the same key.
 */
export const LEARNED_SAFETY = 0.9;
export const AIMD_MIN = 0.1;
export const AIMD_STEP = 0.05;
/** Learned limits are forgotten after this long without a fresh header. */
export const LEARNED_TTL_MS = 60 * 60_000;

export interface BucketState {
  learnedRequests?: number;
  learnedTokens?: number;
  factor: number;
}

export interface EffectiveLimits {
  requests: number;
  tokens: number;
  inFlight: number;
}

export function effectiveLimits(limits: Limits, state: BucketState): EffectiveLimits {
  const scale = state.factor;
  const requests = state.learnedRequests ? state.learnedRequests * LEARNED_SAFETY : limits.requestsPerWindow;
  const tokens = state.learnedTokens ? state.learnedTokens * LEARNED_SAFETY : limits.tokensPerWindow;
  return {
    requests: Math.max(1, Math.floor(requests * scale)),
    tokens: Math.floor(tokens * scale),
    inFlight: Math.max(1, Math.floor(limits.maxInFlight * scale)),
  };
}

/** 429s within this long of a decrease are the same signal (a burst of parallel 429s halves once). */
export const DECREASE_DEBOUNCE_MS = 5_000;

// Rounded to 2 decimals so repeated steps stay exact (0.5, not 0.49999999999999994).
const round2 = (x: number) => Math.round(x * 100) / 100;
export const decreased = (factor: number) => Math.max(AIMD_MIN, round2(factor / 2));
export const increased = (factor: number) => Math.min(1, round2(factor + AIMD_STEP));

/**
 * Per-process bucket state (learned limits, AIMD factor). The leases and
 * cooldowns themselves are shared through the store; each instance learns
 * limits on its own, which is good enough at PoC scale (one web instance).
 */
export class LocalBucketState {
  private states = new Map<string, BucketState & { learnedAt?: number; decreasedAt?: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get(bucket: string): BucketState {
    const s = this.states.get(bucket);
    if (!s) return { factor: 1 };
    if (s.learnedAt !== undefined && this.now() - s.learnedAt > LEARNED_TTL_MS) {
      return { factor: s.factor };
    }
    return s;
  }

  private update(bucket: string, patch: Partial<BucketState & { learnedAt: number; decreasedAt: number }>) {
    this.states.set(bucket, { factor: 1, ...this.states.get(bucket), ...patch });
  }

  observe(bucket: string, o: ObservedLimits) {
    if (!o.requestsPerWindow && !o.tokensPerWindow) return;
    this.update(bucket, {
      ...(o.requestsPerWindow ? { learnedRequests: o.requestsPerWindow } : {}),
      ...(o.tokensPerWindow ? { learnedTokens: o.tokensPerWindow } : {}),
      learnedAt: this.now(),
    });
  }

  onSuccess(bucket: string) {
    const f = this.states.get(bucket)?.factor ?? 1;
    if (f < 1) this.update(bucket, { factor: increased(f) });
  }

  onRateLimited(bucket: string) {
    const s = this.states.get(bucket);
    if (s?.decreasedAt !== undefined && this.now() - s.decreasedAt < DECREASE_DEBOUNCE_MS) return;
    this.update(bucket, { factor: decreased(s?.factor ?? 1), decreasedAt: this.now() });
  }
}

/**
 * Parses DO serverless inference's headers. Seen on 2026-11-26:
 *   x-ratelimit-limit-requests: 120              (per model, per minute)
 *   x-ratelimit-limit-tokens-per-minute: 1000000
 *   x-ratelimit-remaining-tokens-per-day: 2993935
 *   x-ratelimit-reset-requests: 1795712400       (epoch seconds)
 * Resets may also come as seconds or Go-style durations ("6m0s", "250ms").
 */
export function parseRateLimitHeaders(get: (name: string) => string | null | undefined, now = Date.now()): ObservedLimits | undefined {
  const num = (name: string) => {
    const v = get(name);
    const n = v == null || v === "" ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const reset = (name: string) => parseReset(get(name), now);
  const out: ObservedLimits = {
    requestsPerWindow: num("x-ratelimit-limit-requests"),
    tokensPerWindow: num("x-ratelimit-limit-tokens-per-minute") ?? num("x-ratelimit-limit-tokens"),
    remainingRequests: num("x-ratelimit-remaining-requests"),
    remainingTokens: num("x-ratelimit-remaining-tokens-per-minute") ?? num("x-ratelimit-remaining-tokens"),
    remainingTokensPerDay: num("x-ratelimit-remaining-tokens-per-day"),
    resetRequestsMs: reset("x-ratelimit-reset-requests"),
    resetTokensMs: reset("x-ratelimit-reset-tokens-per-minute") ?? reset("x-ratelimit-reset-tokens"),
    resetTokensPerDayMs: reset("x-ratelimit-reset-tokens-per-day"),
  };
  const defined = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as ObservedLimits;
  return Object.keys(defined).length ? defined : undefined;
}

export function parseReset(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n)) {
    // Large numbers are absolute epoch seconds (or ms); small ones are seconds from now.
    if (n > 1e12) return Math.max(0, n - now);
    if (n > 1e9) return Math.max(0, n * 1000 - now);
    return Math.max(0, n * 1000);
  }
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of value.matchAll(re)) {
    matched = true;
    total += Number(amount) * (unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : 3_600_000);
  }
  return matched ? total : undefined;
}
