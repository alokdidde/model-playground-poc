import { describe, expect, it } from "vitest";
import { parseRetryAfter, UpstreamError } from "../src/errors";

describe("parseRetryAfter", () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name];
  it("reads seconds, ms and HTTP dates", () => {
    expect(parseRetryAfter(headers({ "retry-after": "2" }))).toBe(2_000);
    expect(parseRetryAfter(headers({ "retry-after-ms": "150", "retry-after": "9" }))).toBe(150);
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter(headers({ "retry-after": "Thu, 01 Jan 2026 00:00:05 GMT" }), now)).toBe(5_000);
    expect(parseRetryAfter(headers({}))).toBeUndefined();
  });
});

describe("UpstreamError.retryable", () => {
  it.each([
    [429, true],
    [503, true],
    [529, true],
    [400, false],
    [401, false],
    [404, false],
  ])("status %i -> %s", (status, retryable) => {
    expect(UpstreamError.fromStatus(status, "x").retryable).toBe(retryable);
  });
});
