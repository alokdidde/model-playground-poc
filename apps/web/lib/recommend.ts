import type { CallMetrics, JudgeScore, PriorityWeights } from "@fomo/shared";

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

const KEYS = ["quality", "cost", "speed"] as const;

/**
 * Sets one weight to `share` (0..1) and splits the rest between the other two
 * in their current ratio (evenly if both are zero). The result always sums to
 * 1, so each custom slider shows its real share of 100%.
 */
export function setWeight(w: PriorityWeights, key: keyof PriorityWeights, share: number): PriorityWeights {
  const v = Math.min(1, Math.max(0, share));
  const n = normalise(w);
  const others = KEYS.filter((k) => k !== key);
  const rest = others.reduce((s, k) => s + n[k], 0);
  const next = { ...n, [key]: v };
  for (const k of others) next[k] = rest > 0 ? ((1 - v) * n[k]) / rest : (1 - v) / others.length;
  return next;
}

/** Whole percentages that add up to exactly 100 (largest remainder). */
export function percentages(w: PriorityWeights): Record<keyof PriorityWeights, number> {
  const n = normalise(w);
  const raw = KEYS.map((k) => ({ k, x: n[k] * 100 }));
  const out = Object.fromEntries(raw.map(({ k, x }) => [k, Math.floor(x)])) as Record<keyof PriorityWeights, number>;
  let left = 100 - KEYS.reduce((s, k) => s + out[k], 0);
  for (const { k } of [...raw].sort((a, b) => (b.x % 1) - (a.x % 1))) {
    if (left-- <= 0) break;
    out[k] += 1;
  }
  return out;
}

export interface Candidate {
  model: string;
  score: JudgeScore;
  metrics: CallMetrics;
}

/**
 * Outside a cost-first priority, never recommend an answer the judge scored
 * this many points (or more) below the best one. Without it, a 6x price gap
 * on a fraction of a cent can outvote a clearly worse answer.
 */
export const QUALITY_GUARD_POINTS = 2;

export interface Recommendation {
  pick: string;
  /** The highest-quality answer, used as the reference point. */
  best: string;
  /** best's score minus pick's score, in judge points (0 when pick is best). */
  scoreGap: number;
  /** best's cost divided by pick's cost (e.g. 10 = a tenth of the cost); null if unknown. */
  costRatio: number | null;
  /** best's latency divided by pick's latency. */
  speedRatio: number;
  /** True when the quality guard overruled the weighted pick. */
  guarded: boolean;
}

/**
 * Scores every candidate 0..1 for the given priority: a weighted sum of
 * quality (judge score / 10), cost (cheapest / this) and speed (fastest / this).
 * Highest value first; ties go to higher quality.
 */
export function rankCandidates(candidates: Candidate[], weights: PriorityWeights | Priority): { model: string; value: number }[] {
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
  return candidates
    .map((c) => ({ model: c.model, value: value(c), quality: c.score.overall }))
    .sort((a, b) => b.value - a.value || b.quality - a.quality)
    .map(({ model, value }) => ({ model, value: Math.round(value * 1000) / 1000 }));
}

export function recommend(candidates: Candidate[], weights: PriorityWeights | Priority): Recommendation | null {
  if (candidates.length === 0) return null;
  const w = normalise(typeof weights === "string" ? PRIORITY_WEIGHTS[weights] : weights);
  const byQuality = [...candidates].sort((a, b) => b.score.overall - a.score.overall || a.metrics.latencyMs - b.metrics.latencyMs);
  const best = byQuality[0]!;
  const ranked = rankCandidates(candidates, weights);
  const byId = new Map(candidates.map((c) => [c.model, c]));
  // Cost-first priorities may trade quality away on purpose; everything else stays within the guard.
  const guardOn = w.cost <= w.quality;
  const withinGuard = (c: Candidate) => best.score.overall - c.score.overall < QUALITY_GUARD_POINTS;
  const top = byId.get(ranked[0]!.model)!;
  const pick = guardOn ? byId.get(ranked.find((r) => withinGuard(byId.get(r.model)!))!.model)! : top;

  const pickCost = pick.metrics.costUsd;
  const bestCost = best.metrics.costUsd;
  return {
    pick: pick.model,
    best: best.model,
    scoreGap: Math.round((best.score.overall - pick.score.overall) * 10) / 10,
    costRatio: pickCost && bestCost ? bestCost / pickCost : null,
    speedRatio: pick.metrics.latencyMs > 0 ? best.metrics.latencyMs / pick.metrics.latencyMs : 1,
    guarded: pick.model !== top.model,
  };
}

/** One plain sentence for the UI, e.g. "GLM-5.3 Flash scored 8 vs 9 for DeepSeek, at 1/10th of the cost." */
export function describeRecommendation(r: Recommendation, label: (id: string) => string): string {
  if (r.pick === r.best) return `${label(r.pick)} gave the best answer.`;
  const parts: string[] = [];
  if (r.costRatio !== null && r.costRatio >= 1.2) parts.push(`${formatRatio(r.costRatio)} the cost`);
  if (r.speedRatio >= 1.2) parts.push(`${r.speedRatio.toFixed(1)}x faster`);
  const pickScore = r.scoreGap === 0 ? "the same score as" : `${r.scoreGap} point${r.scoreGap === 1 ? "" : "s"} below`;
  return `${label(r.pick)} scored ${pickScore} ${label(r.best)}${parts.length ? `, at ${parts.join(" and ")}` : ""}.`;
}

function formatRatio(ratio: number): string {
  if (ratio < 1.95) return `${Math.round(100 / ratio)}% of`;
  const n = Math.round(ratio);
  return n === 2 ? "half" : n === 3 ? "a third of" : `1/${n}th of`;
}
