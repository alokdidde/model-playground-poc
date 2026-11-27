import type { CallMetrics, JudgeScore, PriorityWeights } from "@fomo/shared";
import { rankCandidates } from "./recommend";

/**
 * Sorting the answers on a run page. Pure, so it is easy to test.
 *
 * Each key knows its own "better" direction (lower cost is better, a higher
 * score is better), so the list always reads best first. Answers that have
 * no value for the key (still running, failed, not judged) go last, in their
 * original order. Each later key breaks ties on the ones before it.
 */
export type SortKey = "order" | "combined" | "quality" | "cost" | "ttft" | "total" | "speed";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "order", label: "Order picked" },
  { key: "combined", label: "Combined score (your priority)" },
  { key: "quality", label: "Judge score" },
  { key: "cost", label: "Cheapest" },
  { key: "ttft", label: "First token" },
  { key: "total", label: "Total time" },
  { key: "speed", label: "Speed" },
];

export interface SortContext {
  /** Models in the order they were picked. */
  order: string[];
  /** Metrics of answers that succeeded. */
  metrics: Record<string, CallMetrics | undefined>;
  scores: Map<string, JudgeScore>;
  priority: PriorityWeights;
}

/** A number where higher is better, or undefined when the key has no value for this model. */
export function sortValues(key: SortKey, ctx: SortContext): Map<string, number> {
  const out = new Map<string, number>();
  if (key === "order") {
    ctx.order.forEach((m, i) => out.set(m, -i));
    return out;
  }
  if (key === "combined") {
    // The same weighted sum the recommendation uses, so the top of the list is the recommended pick.
    const candidates = ctx.order.flatMap((model) => {
      const metrics = ctx.metrics[model];
      const score = ctx.scores.get(model);
      return metrics && score ? [{ model, metrics, score }] : [];
    });
    for (const { model, value } of rankCandidates(candidates, ctx.priority)) out.set(model, value);
    return out;
  }
  for (const model of ctx.order) {
    const m = ctx.metrics[model];
    const v =
      key === "quality" ? ctx.scores.get(model)?.overall
      : key === "cost" ? negate(m?.costUsd)
      : key === "ttft" ? negate(m?.ttftMs)
      : key === "total" ? negate(m?.latencyMs)
      : m?.outputTokensPerSec;
    if (typeof v === "number" && Number.isFinite(v)) out.set(model, v);
  }
  return out;
}

const negate = (v: number | null | undefined) => (typeof v === "number" ? -v : undefined);

/** The models, best first by the first key, ties broken by each later key in turn, then by the order picked. */
export function sortModels(keys: SortKey[], ctx: SortContext): string[] {
  const values = keys.map((k) => sortValues(k, ctx));
  const pos = new Map(ctx.order.map((m, i) => [m, i]));
  const cmp = (v: Map<string, number>, x: string, y: string) => {
    const vx = v.get(x);
    const vy = v.get(y);
    if (vx === undefined && vy === undefined) return 0;
    if (vx === undefined) return 1;
    if (vy === undefined) return -1;
    return vy - vx;
  };
  return [...ctx.order].sort((x, y) => {
    for (const v of values) {
      const c = cmp(v, x, y);
      if (c) return c;
    }
    return pos.get(x)! - pos.get(y)!;
  });
}

const isSortKey = (k: string): k is SortKey => SORT_OPTIONS.some((o) => o.key === k);

/**
 * The sort keys from a run page URL: `?sort=cost,ttft,speed`. Older links used
 * `?sort=cost&then=ttft`, which still works. Unknown and repeated keys are
 * dropped, and "order" is left out because it is always the last tie-break.
 */
export function parseSortParams(sort: string | null, then: string | null): SortKey[] {
  const raw = [...(sort ?? "").split(","), ...(then ?? "").split(",")].map((k) => k.trim());
  return [...new Set(raw.filter(isSortKey))].filter((k) => k !== "order");
}

/** The `sort` URL value for these keys, or null for the default (order picked). */
export const sortParam = (keys: SortKey[]): string | null => (keys.length ? keys.join(",") : null);
