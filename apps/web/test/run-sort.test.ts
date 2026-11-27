import { describe, expect, it } from "vitest";
import type { CallMetrics, JudgeScore } from "@fomo/shared";
import { sortModels, type SortContext } from "../lib/run-sort";
import { PRIORITY_WEIGHTS } from "../lib/recommend";

const metrics = (costUsd: number | null, latencyMs: number, ttftMs: number, outputTokensPerSec?: number): CallMetrics => ({
  costUsd,
  latencyMs,
  ttftMs,
  outputTokensPerSec,
  inputTokens: 10,
  outputTokens: 100,
  tokensEstimated: false,
  attempts: 1,
});
const score = (model: string, overall: number): JudgeScore => ({ model, label: "A", accuracy: overall, helpfulness: overall, clarity: overall, overall });

const ctx: SortContext = {
  order: ["a", "b", "c", "failed"],
  metrics: {
    a: metrics(0.01, 3000, 500, 40),
    b: metrics(0.001, 1000, 200, 90),
    c: metrics(0.001, 2000, 900, 60),
    failed: undefined,
  },
  scores: new Map([
    ["a", score("a", 9)],
    ["b", score("b", 7)],
    ["c", score("c", 7)],
  ]),
  priority: PRIORITY_WEIGHTS.balanced,
};

describe("sortModels", () => {
  it("reads best first whatever the direction: highest score, lowest cost, fastest", () => {
    expect(sortModels("quality", "order", ctx)).toEqual(["a", "b", "c", "failed"]);
    expect(sortModels("total", "order", ctx)).toEqual(["b", "c", "a", "failed"]);
    expect(sortModels("speed", "order", ctx)).toEqual(["b", "c", "a", "failed"]);
  });

  it("breaks ties with the second key", () => {
    // c was picked before b. They cost the same and score the same, but b starts and finishes sooner.
    const picked = { ...ctx, order: ["a", "c", "b", "failed"] };
    expect(sortModels("cost", "order", picked)).toEqual(["c", "b", "a", "failed"]);
    expect(sortModels("cost", "ttft", picked)).toEqual(["b", "c", "a", "failed"]);
    expect(sortModels("quality", "total", picked)).toEqual(["a", "b", "c", "failed"]);
  });

  it("puts answers with no value last, in the order picked", () => {
    expect(sortModels("cost", "order", { ...ctx, metrics: { ...ctx.metrics, a: metrics(null, 3000, 500) } }).slice(-2)).toEqual(["a", "failed"]);
  });

  it("sorts by the combined score the recommendation uses", () => {
    // Quality only: a (9) wins. Cost-heavy: the cheap, decent answers win.
    expect(sortModels("combined", "order", { ...ctx, priority: PRIORITY_WEIGHTS.quality })[0]).toBe("a");
    expect(sortModels("combined", "order", { ...ctx, priority: PRIORITY_WEIGHTS.cost })[0]).toBe("b");
  });
});
