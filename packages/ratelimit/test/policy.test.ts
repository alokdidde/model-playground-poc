import { describe, expect, it } from "vitest";
import { effectiveLimits, parseRateLimitHeaders, parseReset } from "../src/policy";

const limits = { requestsPerWindow: 100, tokensPerWindow: 1_000_000, maxInFlight: 16, windowMs: 60_000, leaseTtlMs: 60_000, batchShare: 0.3 };

describe("bucket policy", () => {
  it("prefers learned limits, scaled by safety, AIMD factor and lane", () => {
    expect(effectiveLimits(limits, { factor: 1 }, "interactive")).toEqual({ requests: 100, tokens: 1_000_000, inFlight: 16 });
    expect(effectiveLimits(limits, { factor: 1, learnedRequests: 120 }, "interactive").requests).toBe(108);
    expect(effectiveLimits(limits, { factor: 1, learnedRequests: 120 }, "batch")).toEqual({ requests: 32, tokens: 300_000, inFlight: 4 });
    expect(effectiveLimits(limits, { factor: 0.5 }, "interactive")).toEqual({ requests: 50, tokens: 500_000, inFlight: 8 });
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
