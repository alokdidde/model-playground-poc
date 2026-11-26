import type { CallMetrics, JudgeScore, PriorityWeights, TaskType } from "@fomo/shared";

/**
 * Turns the judge's scores plus cost and latency into one recommendation:
 * "the answer worth paying for". Pure and deterministic so it is easy to test
 * and to explain.
 *
 * Each candidate gets three 0..1 sub-scores:
 *   quality = judge overall / 10
 *   cost    = cheapest cost / this cost      (1 = cheapest)
 *   speed   = fastest latency / this latency (1 = fastest)
 * and the pick maximises the weighted sum for the user's weights (presets or
 * custom, normalised to sum to 1).
 */
export type Priority = "quality" | "balanced" | "cost" | "speed";

export const PRIORITY_WEIGHTS: Record<Priority, PriorityWeights> = {
  quality: { quality: 1, cost: 0, speed: 0 },
  balanced: { quality: 0.6, cost: 0.25, speed: 0.15 },
  cost: { quality: 0.4, cost: 0.6, speed: 0 },
  speed: { quality: 0.4, cost: 0, speed: 0.6 },
};

/**
 * A sensible starting priority per task type; the user can always change it.
 * Code and maths need the right answer; extraction and summaries are
 * high-volume, so cost matters; chat is latency-sensitive.
 */
export const TASK_DEFAULT_PRIORITY: Record<TaskType, Priority> = {
  general: "balanced",
  coding: "quality",
  reasoning: "quality",
  writing: "balanced",
  summarization: "cost",
  extraction: "cost",
  chat: "speed",
};

/** The preset these weights match, or null for custom weights. */
export function presetFor(w: PriorityWeights): Priority | null {
  const n = normalise(w);
  for (const [name, preset] of Object.entries(PRIORITY_WEIGHTS) as [Priority, PriorityWeights][]) {
    const p = normalise(preset);
    if (Math.abs(p.quality - n.quality) < 0.01 && Math.abs(p.cost - n.cost) < 0.01 && Math.abs(p.speed - n.speed) < 0.01) return name;
  }
  return null;
}

export function normalise(w: PriorityWeights): PriorityWeights {
  const sum = w.quality + w.cost + w.speed || 1;
  return { quality: w.quality / sum, cost: w.cost / sum, speed: w.speed / sum };
}

export interface Candidate {
  model: string;
  score: JudgeScore;
  metrics: CallMetrics;
}

export interface Recommendation {
  pick: string;
  /** The highest-quality answer, used as the reference point. */
  best: string;
  /** pick's quality as a share of best's (0..1). */
  relativeQuality: number;
  /** best's cost divided by pick's cost (e.g. 10 = a tenth of the cost); null if unknown. */
  costRatio: number | null;
  /** best's latency divided by pick's latency. */
  speedRatio: number;
}

export function recommend(candidates: Candidate[], weights: PriorityWeights | Priority): Recommendation | null {
  if (candidates.length === 0) return null;
  const w = normalise(typeof weights === "string" ? PRIORITY_WEIGHTS[weights] : weights);
  const costs = candidates.map((c) => c.metrics.costUsd).filter((c): c is number => c !== null && c > 0);
  const minCost = costs.length ? Math.min(...costs) : null;
  const minLatency = Math.min(...candidates.map((c) => c.metrics.latencyMs));

  const value = (c: Candidate) => {
    const quality = c.score.overall / 10;
    // Unknown price counts as "no better than the most expensive" so we never recommend on a guess.
    const cost = minCost !== null && c.metrics.costUsd ? minCost / c.metrics.costUsd : 0;
    const speed = c.metrics.latencyMs > 0 ? minLatency / c.metrics.latencyMs : 1;
    return w.quality * quality + w.cost * cost + w.speed * speed;
  };

  const byQuality = [...candidates].sort((a, b) => b.score.overall - a.score.overall || a.metrics.latencyMs - b.metrics.latencyMs);
  const best = byQuality[0]!;
  const pick = [...candidates].sort((a, b) => value(b) - value(a) || b.score.overall - a.score.overall)[0]!;

  const pickCost = pick.metrics.costUsd;
  const bestCost = best.metrics.costUsd;
  return {
    pick: pick.model,
    best: best.model,
    relativeQuality: best.score.overall > 0 ? pick.score.overall / best.score.overall : 1,
    costRatio: pickCost && bestCost ? bestCost / pickCost : null,
    speedRatio: pick.metrics.latencyMs > 0 ? best.metrics.latencyMs / pick.metrics.latencyMs : 1,
  };
}

/** One plain sentence for the UI, e.g. "GLM-5.3 Flash is 95% as good as DeepSeek at 1/10th the cost." */
export function describeRecommendation(r: Recommendation, label: (id: string) => string): string {
  if (r.pick === r.best) return `${label(r.pick)} gave the best answer, and nothing else was better value for this priority.`;
  const parts: string[] = [];
  if (r.costRatio !== null && r.costRatio >= 1.2) parts.push(`${formatRatio(r.costRatio)} the cost`);
  if (r.speedRatio >= 1.2) parts.push(`${r.speedRatio.toFixed(1)}x faster`);
  const pct = Math.round(r.relativeQuality * 100);
  return `${label(r.pick)} is ${pct}% as good as ${label(r.best)}${parts.length ? ` at ${parts.join(" and ")}` : ""}.`;
}

function formatRatio(ratio: number): string {
  if (ratio < 1.95) return `${Math.round(100 / ratio)}% of`;
  const n = Math.round(ratio);
  return n === 2 ? "half" : n === 3 ? "a third of" : `1/${n}th of`;
}
