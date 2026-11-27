import type { CallMetrics } from "@fomo/shared";

/** "42.3 tok/s", or "–" when the call wasn't streamed or was too short to measure. */
export function formatTps(tps: number | null | undefined): string {
  if (tps === null || tps === undefined) return "–";
  return `${tps >= 100 ? Math.round(tps) : tps.toFixed(1)} tok/s`;
}

/** "$0.150" per 1M tokens. */
export function formatPerM(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return "–";
  return `$${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`;
}

/**
 * What this call actually cost per 1M tokens (input and output together).
 * Differs from the list price because the input/output mix differs per call,
 * and reasoning models bill their hidden thinking as output.
 */
export function effectiveUsdPerMTokens(m: Pick<CallMetrics, "costUsd" | "inputTokens" | "outputTokens">): number | null {
  const tokens = m.inputTokens + m.outputTokens;
  if (m.costUsd === null || tokens === 0) return null;
  return (m.costUsd / tokens) * 1_000_000;
}

export type MetricKey = "ttftMs" | "latencyMs" | "outputTokensPerSec" | "costUsd";

/** Which model is best on a metric: lowest time and cost, highest speed. Ignores unknowns. */
export function bestBy(rows: { model: string; metrics: CallMetrics }[], key: MetricKey): string | undefined {
  const higherIsBetter = key === "outputTokensPerSec";
  let best: { model: string; value: number } | undefined;
  for (const { model, metrics } of rows) {
    const value = metrics[key];
    if (value === null || value === undefined) continue;
    if (!best || (higherIsBetter ? value > best.value : value < best.value)) best = { model, value };
  }
  return best?.model;
}

export interface RankedValue {
  model: string;
  value: number | null;
  /** Bar length, 0..1, relative to the largest value on this metric. */
  share: number;
  /** How far from the best: "1.8× slower" / "2.0× the cost". Null for the best and for unknowns. */
  timesBest: number | null;
  isBest: boolean;
}

/**
 * One metric across models, best first, ready to draw as bars.
 * Unknown values go last. A tie for best marks every tied model.
 */
export function rankByMetric(values: { model: string; value: number | null | undefined }[], higherIsBetter: boolean): RankedValue[] {
  const known = values.filter((v): v is { model: string; value: number } => typeof v.value === "number");
  const sorted = [...known].sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));
  const max = Math.max(0, ...known.map((v) => v.value));
  const best = sorted[0]?.value;
  const ranked = sorted.map(({ model, value }): RankedValue => {
    const isBest = value === best;
    const ratio = higherIsBetter ? (value > 0 ? best! / value : null) : best! > 0 ? value / best! : null;
    return { model, value, share: max > 0 ? value / max : 0, timesBest: isBest || ratio === null ? null : ratio, isBest };
  });
  const unknown = values.filter((v) => typeof v.value !== "number").map(({ model }) => ({ model, value: null, share: 0, timesBest: null, isBest: false }));
  return [...ranked, ...unknown];
}

/** Same wording as the "How the models did" tiles. */
export const WIN_LABELS: Record<MetricKey, string> = {
  ttftMs: "Starts answering first",
  latencyMs: "Finishes first",
  outputTokensPerSec: "Writes fastest",
  costUsd: "Cheapest",
};

/** For each model, the metrics it is best (or tied best) on. Empty when only one model ran. */
export function winsByModel(rows: { model: string; metrics: CallMetrics }[]): Map<string, Set<MetricKey>> {
  const wins = new Map(rows.map((r) => [r.model, new Set<MetricKey>()]));
  if (rows.length < 2) return wins;
  for (const key of Object.keys(WIN_LABELS) as MetricKey[]) {
    const ranked = rankByMetric(
      rows.map((r) => ({ model: r.model, value: r.metrics[key] })),
      key === "outputTokensPerSec",
    );
    for (const r of ranked) if (r.isBest) wins.get(r.model)!.add(key);
  }
  return wins;
}
