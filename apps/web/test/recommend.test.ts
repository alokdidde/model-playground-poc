import { describe, expect, it } from "vitest";
import { describeRecommendation, percentages, recommend, setWeight, type Candidate } from "../lib/recommend";

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

describe("custom weight sliders", () => {
  const sum = (w: { quality: number; cost: number; speed: number }) => w.quality + w.cost + w.speed;

  it("moving one slider rebalances the others in their ratio", () => {
    const w = setWeight({ quality: 0.6, cost: 0.25, speed: 0.15 }, "quality", 0.2);
    expect(w.quality).toBeCloseTo(0.2);
    expect(w.cost).toBeCloseTo(0.5);
    expect(w.speed).toBeCloseTo(0.3);
    expect(sum(w)).toBeCloseTo(1);
  });

  it("splits evenly when the others are both zero", () => {
    const w = setWeight({ quality: 1, cost: 0, speed: 0 }, "quality", 0.4);
    expect(w).toEqual({ quality: 0.4, cost: 0.3, speed: 0.3 });
  });

  it("normalises raw weights first, so the thumb matches the label", () => {
    // The bug: raw weights 0.95/0.65/0.7 showed a near-full Quality thumb labelled 41%.
    const w = setWeight({ quality: 0.95, cost: 0.65, speed: 0.7 }, "cost", 0.29);
    expect(sum(w)).toBeCloseTo(1);
    expect(w.cost).toBeCloseTo(0.29);
  });

  it("shows whole percentages that add up to 100", () => {
    const p = percentages({ quality: 1, cost: 1, speed: 1 });
    expect(p.quality + p.cost + p.speed).toBe(100);
  });
});
