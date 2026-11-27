import type { JudgeScore, TaskType } from "@fomo/shared";
import { ci95HalfWidth, percentile } from "@/lib/stats";
import { prisma } from "./services";

export interface LeaderboardRow {
  model: string;
  /** Answers the judge scored. */
  judged: number;
  avgScore: number | null;
  /** ± half-width of the 95% confidence interval of avgScore (null below 2 judged answers). */
  scoreCi95: number | null;
  /** Distinct compares this model took part in. */
  runs: number;
  /** Share of judged prompts this model won. */
  winRate: number | null;
  /** Times a human preferred this model in the compare view. */
  humanVotes: number;
  calls: number;
  errorRate: number;
  avgLatencyMs: number | null;
  /** Median time to first token (streamed calls). */
  p50TtftMs: number | null;
  /** Mean output tokens/sec (streamed calls; includes reasoning tokens). */
  avgTokensPerSec: number | null;
  avgCostUsd: number | null;
}

interface Acc {
  calls: number;
  failures: number;
  latency: number[];
  ttft: number[];
  tps: number[];
  cost: number[];
  scores: number[];
  wins: number;
  contests: number;
  votes: number;
  runs: Set<string>;
}

/**
 * Aggregates every comparison into one table. Computed on read: fine at
 * PoC scale. At larger scale this becomes a materialised view (see ROADMAP.md).
 */
export async function getLeaderboard(taskType?: TaskType): Promise<LeaderboardRow[]> {
  const acc = new Map<string, Acc>();
  const get = (model: string) => {
    let a = acc.get(model);
    if (!a) acc.set(model, (a = { calls: 0, failures: 0, latency: [], ttft: [], tps: [], cost: [], scores: [], wins: 0, contests: 0, votes: 0, runs: new Set() }));
    return a;
  };
  const addCall = (r: {
    model: string;
    status: string;
    latencyMs: number;
    ttftMs: number | null;
    outputTokensPerSec: number | null;
    costUsd: number | null;
  }) => {
    const a = get(r.model);
    a.calls++;
    if (r.status === "FAILED") return void a.failures++;
    a.latency.push(r.latencyMs);
    if (r.ttftMs !== null) a.ttft.push(r.ttftMs);
    if (r.outputTokensPerSec !== null) a.tps.push(r.outputTokensPerSec);
    if (r.costUsd !== null) a.cost.push(r.costUsd);
  };

  // "Best model" depends on the job, so the table can be cut by task type.
  const comparisons = await prisma.comparison.findMany({
    where: taskType ? { taskType } : {},
    select: {
      id: true,
      results: { select: { model: true, status: true, latencyMs: true, ttftMs: true, outputTokensPerSec: true, costUsd: true } },
      judgement: true,
      vote: true,
    },
  });
  for (const c of comparisons) {
    for (const r of c.results) {
      addCall(r);
      get(r.model).runs.add(c.id);
    }
    if (c.judgement) {
      for (const s of c.judgement.scores as unknown as JudgeScore[]) {
        get(s.model).scores.push(s.overall);
        get(s.model).contests++;
      }
      if (c.judgement.winnerModel) get(c.judgement.winnerModel).wins++;
    }
    if (c.vote?.preferredModel) get(c.vote.preferredModel).votes++;
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  return [...acc.entries()]
    .map(([model, a]) => ({
      model,
      judged: a.scores.length,
      avgScore: avg(a.scores),
      scoreCi95: ci95HalfWidth(a.scores),
      runs: a.runs.size,
      winRate: a.contests ? a.wins / a.contests : null,
      humanVotes: a.votes,
      calls: a.calls,
      errorRate: a.calls ? a.failures / a.calls : 0,
      avgLatencyMs: avg(a.latency),
      p50TtftMs: percentile(a.ttft, 50),
      avgTokensPerSec: avg(a.tps),
      avgCostUsd: avg(a.cost),
    }))
    .sort((x, y) => (y.avgScore ?? -1) - (x.avgScore ?? -1) || (y.winRate ?? -1) - (x.winRate ?? -1));
}
