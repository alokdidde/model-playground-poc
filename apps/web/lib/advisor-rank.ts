import { describeModel, type Intent } from "@fomo/llm";
import type { LeaderboardRow } from "@/lib/server/leaderboard";
import { rankCandidates, type Candidate } from "@/lib/recommend";

/** Rows we can rank: judged at least once, with a latency. */
export const withData = (rows: LeaderboardRow[]) => rows.filter((r) => r.avgScore !== null && r.avgLatencyMs !== null);

/** Ranks models with data by the user's priority; those breaking a stated limit go last. */
export function rank(rows: LeaderboardRow[], intent: Pick<Intent, "priority" | "maxCostPerCallUsd" | "maxLatencyMs">) {
  const byModel = new Map(rows.map((r) => [r.model, r]));
  // "Latency" for a person means when the answer starts showing: TTFT where we have it.
  const startsMs = (r: LeaderboardRow) => r.p50TtftMs ?? r.avgLatencyMs;
  const within = (r: LeaderboardRow) =>
    (intent.maxCostPerCallUsd === null || (r.avgCostUsd !== null && r.avgCostUsd <= intent.maxCostPerCallUsd)) &&
    (intent.maxLatencyMs === null || (startsMs(r) ?? Infinity) <= intent.maxLatencyMs);

  const candidates: Candidate[] = rows.map((r) => ({
    model: r.model,
    score: { model: r.model, label: "", accuracy: r.avgScore!, helpfulness: r.avgScore!, clarity: r.avgScore!, overall: r.avgScore! },
    metrics: { latencyMs: r.avgLatencyMs!, inputTokens: 0, outputTokens: 0, tokensEstimated: false, costUsd: r.avgCostUsd, attempts: 1 },
  }));
  const ordered = rankCandidates(candidates, intent.priority);
  const sorted = [...ordered.filter((o) => within(byModel.get(o.model)!)), ...ordered.filter((o) => !within(byModel.get(o.model)!))];

  return sorted.map(({ model, value }, i) => {
    const r = byModel.get(model)!;
    return {
      model,
      value,
      rank: i + 1,
      label: describeModel(model).label,
      avgScore: r.avgScore === null ? null : Math.round(r.avgScore * 10) / 10,
      p50TtftMs: r.p50TtftMs,
      avgLatencyMs: r.avgLatencyMs === null ? null : Math.round(r.avgLatencyMs),
      avgCostUsd: r.avgCostUsd,
      avgTokensPerSec: r.avgTokensPerSec === null ? null : Math.round(r.avgTokensPerSec),
      judged: r.judged,
      withinLimits: within(r),
    };
  });
}
