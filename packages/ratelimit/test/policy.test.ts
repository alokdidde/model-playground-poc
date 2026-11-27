import { describe, expect, it } from "vitest";
import { effectiveLimits, LocalBucketState, parseRateLimitHeaders, parseReset } from "../src/policy";

const limits = { requestsPerWindow: 100, tokensPerWindow: 1_000_000, maxInFlight: 16, windowMs: 60_000, leaseTtlMs: 60_000 };

describe("bucket policy", () => {
  it("prefers learned limits, scaled by safety and the AIMD factor", () => {
    expect(effectiveLimits(limits, { factor: 1 })).toEqual({ requests: 100, tokens: 1_000_000, inFlight: 16 });
    expect(effectiveLimits(limits, { factor: 1, learnedRequests: 120 }).requests).toBe(108);
    expect(effectiveLimits(limits, { factor: 0.5 })).toEqual({ requests: 50, tokens: 500_000, inFlight: 8 });
  });

  it("halves once for a burst of 429s and recovers in exact steps", () => {
    let now = 0;
    const state = new LocalBucketState(() => now);
    state.onRateLimited("b");
    state.onRateLimited("b"); // same burst
    expect(state.get("b").factor).toBe(0.5);
    now += 10_000;
    state.onRateLimited("b"); // a new 429 later counts again
    expect(state.get("b").factor).toBe(0.25);
    state.onSuccess("b");
    expect(state.get("b").factor).toBe(0.3);
  });

  it("parses DO's rate-limit headers", () => {
    const now = 1_795_712_340_000;
    const headers: Record<string, string> = {
      "x-ratelimit-limit-requests": "120",
      "x-ratelimit-remaining-requests": "119",
      "x-ratelimit-reset-requests": "1795712400",
      "x-ratelimit-limit-tokens-per-minute": "1000000",
      "x-ratelimit-remaining-tokens-per-day": "2993935",
    };
    expect(parseRateLimitHeaders((n) => headers[n], now)).toEqual({
      requestsPerWindow: 120,
      remainingRequests: 119,
      resetRequestsMs: 60_000,
      tokensPerWindow: 1_000_000,
      remainingTokensPerDay: 2_993_935,
    });
    expect(parseRateLimitHeaders(() => null)).toBeUndefined();
  });

  it("reads reset times as epoch seconds, seconds, or durations", () => {
    expect(parseReset("1795712400", 1_795_712_340_000)).toBe(60_000);
    expect(parseReset("2")).toBe(2_000);
    expect(parseReset("6m0s")).toBe(360_000);
    expect(parseReset("250ms")).toBe(250);
    expect(parseReset("soon")).toBeUndefined();
  });
});
