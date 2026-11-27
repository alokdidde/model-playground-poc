import type { JudgeScore, TaskType } from "@fomo/shared";
import { percentile } from "@/lib/eval-report";
import { prisma } from "./services";

export interface LeaderboardRow {
  model: string;
  /** Answers the judge scored. */
  judged: number;
  avgScore: number | null;
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
}

/**
 * Aggregates batch eval results and interactive comparisons into one table.
 * Computed on read: fine at PoC scale. At larger scale this becomes a
 * materialised view refreshed by the worker (see ROADMAP.md).
 */
export async function getLeaderboard(source: "all" | "evals" | "compare", taskType?: TaskType): Promise<LeaderboardRow[]> {
  // "Best model" depends on the job, so the table can be cut by task type.
  const runWhere = taskType ? { run: { taskType } } : {};
  const acc = new Map<string, Acc>();
  const get = (model: string) => {
    let a = acc.get(model);
    if (!a) acc.set(model, (a = { calls: 0, failures: 0, latency: [], ttft: [], tps: [], cost: [], scores: [], wins: 0, contests: 0, votes: 0 }));
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

  if (source !== "compare") {
    const [results, prompts] = await Promise.all([
      prisma.evalResult.findMany({ where: runWhere, select: {
          model: true,
          status: true,
          latencyMs: true,
          ttftMs: true,
          outputTokensPerSec: true,
          costUsd: true,
          score: true,
          runId: true,
          promptIndex: true,
        }, }),
      prisma.evalPrompt.findMany({ where: { judgedAt: { not: null }, ...runWhere }, select: { runId: true, index: true, winnerModel: true } }),
    ]);
    const judged = new Set(prompts.map((p) => `${p.runId}:${p.index}`));
    for (const r of results) {
      addCall(r);
      if (r.score !== null) get(r.model).scores.push(r.score);
      if (r.status === "SUCCEEDED" && judged.has(`${r.runId}:${r.promptIndex}`)) get(r.model).contests++;
    }
    for (const p of prompts) if (p.winnerModel) get(p.winnerModel).wins++;
  }

  if (source !== "evals") {
    const comparisons = await prisma.comparison.findMany({
      where: taskType ? { taskType } : {},
      select: {
        results: { select: { model: true, status: true, latencyMs: true, ttftMs: true, outputTokensPerSec: true, costUsd: true } },
        judgement: true,
        vote: true,
      },
    });
    for (const c of comparisons) {
      c.results.forEach(addCall);
      if (c.judgement) {
        for (const s of c.judgement.scores as unknown as JudgeScore[]) {
          get(s.model).scores.push(s.overall);
          get(s.model).contests++;
        }
        if (c.judgement.winnerModel) get(c.judgement.winnerModel).wins++;
      }
      if (c.vote?.preferredModel) get(c.vote.preferredModel).votes++;
    }
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  return [...acc.entries()]
    .map(([model, a]) => ({
      model,
      judged: a.scores.length,
      avgScore: avg(a.scores),
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
