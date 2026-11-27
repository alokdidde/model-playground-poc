import type { JudgeVerdict } from "@fomo/shared";

/**
 * Small pure helpers behind the run page's verdict, evidence and cost views.
 * Pure so they are easy to test and to explain in review.
 */

/** A judge lead of more than this many points (with both orders agreeing) reads as a clear winner. */
export const CLEAR_WIN_POINTS = 1;
/** Per-criterion gaps this small read as a tie. */
export const TIE_POINTS = 0.5;

export type Confidence =
  | { kind: "clear"; gap: number }
  | { kind: "close"; gap: number }
  /** The two answer orders picked different winners, so the judge calls it a tie. */
  | { kind: "flip" }
  | { kind: "single" };

/** How sure the verdict is, from data the judge already returns. */
export function verdictConfidence(v: JudgeVerdict): Confidence {
  if (v.scores.length < 2) return { kind: "single" };
  if (v.positionConsistent === false) return { kind: "flip" };
  const [a, b] = [...v.scores].sort((x, y) => y.overall - x.overall);
  const gap = Math.round((a!.overall - b!.overall) * 10) / 10;
  return v.winnerModel && gap > CLEAR_WIN_POINTS ? { kind: "clear", gap } : { kind: "close", gap };
}

/**
 * The judge writes "Response B (glm-5.3-flash)" once answers are de-anonymised.
 * Show the display name instead, so the page uses one name per model.
 */
export function readableRationale(text: string, label: (id: string) => string): string {
  return text.replace(/\bResponse [A-Z]+ \(([^)]+)\)/g, (_match, id: string) => label(id));
}

/** One reading per criterion row: who leads and by how much, or a tie. */
export function criterionReading(values: { model: string; value: number }[]): { leader: string | null; gap: number } {
  const sorted = [...values].sort((a, b) => b.value - a.value);
  if (sorted.length < 2) return { leader: sorted[0]?.model ?? null, gap: 0 };
  const gap = Math.round((sorted[0]!.value - sorted[1]!.value) * 10) / 10;
  return { leader: gap > TIE_POINTS ? sorted[0]!.model : null, gap };
}

/**
 * Models that nothing else in the run beats on both quality and cost:
 * no other model is at least as cheap and at least as good, and better on one.
 */
export function paretoFront(points: { model: string; cost: number; score: number }[]): Set<string> {
  return new Set(
    points
      .filter((p) => !points.some((o) => o !== p && o.cost <= p.cost && o.score >= p.score && (o.cost < p.cost || o.score > p.score)))
      .map((p) => p.model),
  );
}

/** What this prompt would cost a month at a steady number of calls a day. */
export const monthlyCost = (costPerCallUsd: number, callsPerDay: number) => costPerCallUsd * callsPerDay * 30;

/** True when the whole answer is a JSON value, so it can be shown as code. */
export function isJsonAnswer(text: string): boolean {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}
