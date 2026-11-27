import { describe, expect, it } from "vitest";
import { delayHonoringRetryAfter, fullJitterDelay } from "../src/backoff";

describe("fullJitterDelay", () => {
  it("grows exponentially and is capped", () => {
    const max = () => 0.999999;
    expect(fullJitterDelay(1, { baseMs: 100, random: max })).toBe(99);
    expect(fullJitterDelay(4, { baseMs: 100, random: max })).toBe(799);
    expect(fullJitterDelay(30, { baseMs: 100, capMs: 5_000, random: max })).toBe(4_999);
  });

  it("can be zero (that is the point of full jitter)", () => {
    expect(fullJitterDelay(3, { random: () => 0 })).toBe(0);
  });
});

describe("delayHonoringRetryAfter", () => {
  it("never waits less than Retry-After", () => {
    for (let i = 0; i < 50; i++) expect(delayHonoringRetryAfter(1, 3_000)).toBeGreaterThanOrEqual(3_000);
  });
});
