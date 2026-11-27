import { describe, expect, it } from "vitest";
import { describeRecommendation, recommend, type Candidate } from "../lib/recommend";

const c = (model: string, overall: number, costUsd: number | null, latencyMs: number): Candidate => ({
  model,
  score: { model, label: "A", accuracy: overall, helpfulness: overall, clarity: overall, overall },
  metrics: { latencyMs, inputTokens: 1, outputTokens: 1, tokensEstimated: false, costUsd, attempts: 1 },
});

describe("recommend", () => {
  const cands = [c("big", 10, 0.01, 4000), c("small", 9, 0.001, 1000)];

  it("quality priority picks the best answer", () => {
    expect(recommend(cands, "quality")?.pick).toBe("big");
  });

  it("cost priority trades a little quality for a lot of savings", () => {
    const r = recommend(cands, "cost")!;
    expect(r).toMatchObject({ pick: "small", best: "big" });
    expect(describeRecommendation(r, (id) => id)).toBe("small is 90% as good as big at 1/10th of the cost and 4.0x faster.");
  });

  it("never recommends on an unknown price", () => {
    expect(recommend([c("known", 8, 0.002, 1000), c("unknown", 8, null, 1000)], "cost")?.pick).toBe("known");
  });
});

describe("priority weights", () => {
  it("accepts custom weights and recognises presets", async () => {
    const { presetFor, recommend: rec } = await import("../lib/recommend");
    expect(presetFor({ quality: 6, cost: 2.5, speed: 1.5 })).toBe("balanced");
    expect(presetFor({ quality: 0.5, cost: 0.5, speed: 0 })).toBeNull();
    const cands = [c("big", 10, 0.01, 4000), c("small", 9, 0.001, 1000)];
    expect(rec(cands, { quality: 0, cost: 0, speed: 1 })?.pick).toBe("small");
  });
});
