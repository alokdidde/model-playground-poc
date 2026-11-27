import { describe, expect, it } from "vitest";
import { rank } from "../lib/advisor-rank";
import type { LeaderboardRow } from "../lib/server/leaderboard";

const row = (model: string, over: Partial<LeaderboardRow>): LeaderboardRow => ({
  model,
  judged: 10,
  avgScore: 8,
  winRate: null,
  humanVotes: 0,
  calls: 10,
  errorRate: 0,
  avgLatencyMs: 2_000,
  p50TtftMs: 500,
  avgTokensPerSec: 100,
  avgCostUsd: 0.001,
  ...over,
});

const rows = [
  row("smart", { avgScore: 9.5, avgCostUsd: 0.01, p50TtftMs: 3_000, avgLatencyMs: 6_000 }),
  row("cheap", { avgScore: 7.5, avgCostUsd: 0.0005, p50TtftMs: 400, avgLatencyMs: 1_500 }),
];

describe("advisor ranking", () => {
  it("follows the user's priorities", () => {
    const quality = rank(rows, { priority: { quality: 1, cost: 0, speed: 0 }, maxCostPerCallUsd: null, maxLatencyMs: null });
    expect(quality.map((r) => r.model)).toEqual(["smart", "cheap"]);
    const cost = rank(rows, { priority: { quality: 0.3, cost: 0.7, speed: 0 }, maxCostPerCallUsd: null, maxLatencyMs: null });
    expect(cost[0]!.model).toBe("cheap");
  });

  it("puts models outside a stated limit last, even if they score best", () => {
    const r = rank(rows, { priority: { quality: 1, cost: 0, speed: 0 }, maxCostPerCallUsd: null, maxLatencyMs: 2_000 });
    expect(r.map((x) => [x.model, x.withinLimits])).toEqual([
      ["cheap", true],
      ["smart", false],
    ]);
  });
});
