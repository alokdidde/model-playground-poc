import { describe, expect, it } from "vitest";
import type { CallMetrics } from "@fomo/shared";
import { bestBy, effectiveUsdPerMTokens, formatTps } from "../lib/metrics";

const m = (over: Partial<CallMetrics>): CallMetrics => ({
  latencyMs: 1_000,
  inputTokens: 100,
  outputTokens: 400,
  tokensEstimated: false,
  costUsd: 0.001,
  attempts: 1,
  ...over,
});

describe("metrics", () => {
  it("picks the best model per column, ignoring unknowns", () => {
    const rows = [
      { model: "a", metrics: m({ ttftMs: 300, outputTokensPerSec: 40, costUsd: null }) },
      { model: "b", metrics: m({ ttftMs: 200, outputTokensPerSec: 90, costUsd: 0.002 }) },
      { model: "c", metrics: m({ ttftMs: undefined, latencyMs: 500 }) },
    ];
    expect(bestBy(rows, "ttftMs")).toBe("b");
    expect(bestBy(rows, "outputTokensPerSec")).toBe("b");
    expect(bestBy(rows, "latencyMs")).toBe("c");
    expect(bestBy(rows, "costUsd")).toBe("c");
  });

  it("computes the effective price per 1M tokens", () => {
    expect(effectiveUsdPerMTokens(m({}))).toBeCloseTo(2);
    expect(effectiveUsdPerMTokens(m({ costUsd: null }))).toBeNull();
  });

  it("formats speed", () => {
    expect(formatTps(42.34)).toBe("42.3 tok/s");
    expect(formatTps(156.7)).toBe("157 tok/s");
    expect(formatTps(undefined)).toBe("–");
  });
});
