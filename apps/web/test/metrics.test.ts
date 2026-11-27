import { describe, expect, it } from "vitest";
import type { CallMetrics } from "@fomo/shared";
import { bestBy, effectiveUsdPerMTokens, formatTps, rankByMetric, winsByModel } from "../lib/metrics";

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

describe("rankByMetric", () => {
  it("puts the lowest time first and says how much slower the others are", () => {
    const r = rankByMetric(
      [
        { model: "a", value: 900 },
        { model: "b", value: 300 },
        { model: "c", value: null },
      ],
      false,
    );
    expect(r.map((x) => x.model)).toEqual(["b", "a", "c"]);
    expect(r[0]).toMatchObject({ isBest: true, timesBest: null, share: 1 / 3 });
    expect(r[1]).toMatchObject({ isBest: false, timesBest: 3, share: 1 });
    expect(r[2]).toMatchObject({ value: null, share: 0, isBest: false });
  });

  it("puts the highest speed first when higher is better", () => {
    const r = rankByMetric(
      [
        { model: "a", value: 50 },
        { model: "b", value: 100 },
      ],
      true,
    );
    expect(r.map((x) => x.model)).toEqual(["b", "a"]);
    expect(r[1]!.timesBest).toBe(2);
  });

  it("marks every model tied for best", () => {
    const r = rankByMetric(
      [
        { model: "a", value: 0 },
        { model: "b", value: 0 },
      ],
      false,
    );
    expect(r.every((x) => x.isBest)).toBe(true);
  });
});

describe("winsByModel", () => {
  it("lists what each model won, and nothing for a single model", () => {
    const rows = [
      { model: "a", metrics: m({ ttftMs: 100, latencyMs: 900, outputTokensPerSec: 50, costUsd: 0.002 }) },
      { model: "b", metrics: m({ ttftMs: 300, latencyMs: 500, outputTokensPerSec: 80, costUsd: 0.001 }) },
    ];
    const wins = winsByModel(rows);
    expect([...wins.get("a")!]).toEqual(["ttftMs"]);
    expect([...wins.get("b")!].sort()).toEqual(["costUsd", "latencyMs", "outputTokensPerSec"]);
    expect(winsByModel(rows.slice(0, 1)).get("a")!.size).toBe(0);
  });
});
