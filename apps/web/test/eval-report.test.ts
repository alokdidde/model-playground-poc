import { describe, expect, it } from "vitest";
import { percentile, summariseRun, toCsv, type ResultRow } from "../lib/eval-report";

const row = (over: Partial<ResultRow>): ResultRow => ({
  promptIndex: 0,
  model: "a",
  status: "SUCCEEDED",
  score: 8,
  latencyMs: 1_000,
  inputTokens: 10,
  outputTokens: 100,
  costUsd: 0.001,
  ...over,
});

describe("eval report", () => {
  it("uses nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    expect(percentile([], 50)).toBeNull();
  });

  it("summarises quality, speed, cost and failures per model", () => {
    const rows = [
      row({ promptIndex: 0, score: 8, criteria: { accuracy: 8, helpfulness: 9, clarity: 7 }, isWinner: true, ttftMs: 200, outputTokensPerSec: 50 }),
      row({ promptIndex: 1, score: 6, criteria: { accuracy: 6, helpfulness: 7, clarity: 5 }, ttftMs: 400, outputTokensPerSec: 70, latencyMs: 3_000, checks: [{ name: "valid_json", passed: false, detail: "" }] }),
      row({ promptIndex: 2, status: "FAILED", score: null, costUsd: null }),
      row({ model: "b", costUsd: null }),
    ];
    const [a, b] = summariseRun(rows, ["a", "b"]);
    expect(a).toMatchObject({
      prompts: 3,
      failed: 1,
      meanScore: 7,
      accuracy: 7,
      helpfulness: 8,
      clarity: 6,
      wins: 1,
      checksPassed: 0,
      checksRun: 1,
      latencyP50: 1_000,
      latencyP95: 3_000,
      ttftP50: 200,
      meanTokensPerSec: 60,
      totalCostUsd: 0.002,
      costPerPromptUsd: 0.001,
    });
    // A failed call's unknown cost doesn't count, but an unknown price on a success does.
    expect(b!.totalCostUsd).toBeNull();
  });

  it("exports CSV with quoting", () => {
    const csv = toCsv([row({})], [{ index: 0, prompt: 'Say "hi", please' }], new Map([["0:a", "line1\nline2"]]));
    const [header, line] = csv.split("\n", 2);
    expect(header).toContain("promptIndex,prompt,model");
    expect(line).toContain('"Say ""hi"", please"');
    expect(csv).toContain('"line1\nline2"');
  });
});
