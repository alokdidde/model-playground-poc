import { prisma } from "@fomo/db";

/**
 * Reads the rate_event table (written by the gateway and the limiter, see
 * packages/ratelimit/src/events.ts) and turns it into what the
 * /ops/rate-limits page draws: a per-model timeline and summary numbers.
 */

export interface RateEventRow {
  at: string;
  /** Milliseconds since the start of the selected range, for charts. */
  t: number;
  source: string;
  kind: string;
  model: string | null;
  lane: string | null;
  tag: string | null;
  attempt: number | null;
  ms: number | null;
  data: Record<string, unknown> | null;
}

export interface RateEventQuery {
  /** Look back this many minutes (ignored when `tag` is set: a run's whole history is shown). */
  minutes: number;
  tag?: string;
  model?: string;
}

const MAX_ROWS = 50_000;

export async function getRateEvents(q: RateEventQuery): Promise<RateEventRow[]> {
  const rows = await prisma.rateEvent.findMany({
    where: {
      ...(q.tag ? { tag: q.tag } : { at: { gte: new Date(Date.now() - q.minutes * 60_000) } }),
      ...(q.model ? { model: q.model } : {}),
    },
    orderBy: { id: "asc" },
    take: MAX_ROWS,
  });
  const start = rows[0]?.at.getTime() ?? Date.now();
  return rows.map((r) => ({
    at: r.at.toISOString(),
    t: r.at.getTime() - start,
    source: r.source,
    kind: r.kind,
    model: r.model,
    lane: r.lane,
    tag: r.tag,
    attempt: r.attempt,
    ms: r.ms,
    data: (r.data as Record<string, unknown> | null) ?? null,
  }));
}

export interface ModelSummary {
  model: string;
  granted: number;
  /** Calls that had to wait for capacity at least once. */
  waited: number;
  waitP50Ms: number | null;
  waitP95Ms: number | null;
  waitMaxMs: number | null;
  timeouts: number;
  rateLimited: number;
  retries: number;
  retryDelayP50Ms: number | null;
  retryDelayMaxMs: number | null;
  attemptsOk: number;
  attemptsFailed: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  /** Lowest AIMD factor reached, and the last one seen. */
  minFactor: number | null;
  lastFactor: number | null;
  learnedRequests: number | null;
  learnedTokens: number | null;
  /** From the first 429 to the first successful attempt after the last one. */
  firstRateLimitAt: number | null;
  recoveredAt: number | null;
}

export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

export function summarize(events: RateEventRow[]): ModelSummary[] {
  const byModel = new Map<string, RateEventRow[]>();
  for (const e of events) {
    if (!e.model) continue;
    const list = byModel.get(e.model) ?? [];
    list.push(e);
    byModel.set(e.model, list);
  }
  return [...byModel.entries()].map(([model, list]) => {
    const of = (kind: string) => list.filter((e) => e.kind === kind);
    const granted = of("lease_granted");
    // A lease that was granted on its first poll did not wait (its ms is just the store round trip).
    const waits = granted.filter((e) => Number(e.data?.polls ?? 1) > 1).map((e) => e.ms ?? 0);
    const retries = of("retry").map((e) => e.ms ?? 0);
    const ok = of("attempt_ok");
    const factors = of("factor_changed").map((e) => Number(e.data?.to));
    const learned = of("limits_learned").at(-1)?.data;
    const limited = of("rate_limited");
    const lastLimited = limited.at(-1)?.t;
    return {
      model,
      granted: granted.length,
      waited: waits.length,
      waitP50Ms: quantile(waits, 0.5),
      waitP95Ms: quantile(waits, 0.95),
      waitMaxMs: waits.length ? Math.max(...waits) : null,
      timeouts: of("lease_timeout").length,
      rateLimited: limited.length,
      retries: retries.length,
      retryDelayP50Ms: quantile(retries, 0.5),
      retryDelayMaxMs: retries.length ? Math.max(...retries) : null,
      attemptsOk: ok.length,
      attemptsFailed: of("attempt_failed").length,
      latencyP50Ms: quantile(ok.map((e) => e.ms ?? 0), 0.5),
      latencyP95Ms: quantile(ok.map((e) => e.ms ?? 0), 0.95),
      minFactor: factors.length ? Math.min(...factors) : null,
      lastFactor: factors.at(-1) ?? null,
      learnedRequests: (learned?.requests as number | undefined) ?? null,
      learnedTokens: (learned?.tokens as number | undefined) ?? null,
      firstRateLimitAt: limited[0]?.t ?? null,
      recoveredAt: lastLimited === undefined ? null : (ok.find((e) => e.t > lastLimited)?.t ?? null),
    };
  });
}

export interface TimelinePoint {
  t: number;
  /** Requests counted in the window (ours), and the effective limit, at that moment. */
  used: number;
  max: number;
  factor: number;
  lane: string;
}

/** Bucket levels over time, from the snapshot each lease_granted / lease_wait carries. */
export function levels(events: RateEventRow[], model: string): TimelinePoint[] {
  return events
    .filter((e) => e.model === model && (e.kind === "lease_granted" || e.kind === "lease_wait") && e.data?.used)
    .map((e) => {
      const d = e.data as { used: { requests: number }; max: { requests: number }; factor: number };
      return { t: e.t, used: d.used.requests, max: d.max.requests, factor: d.factor, lane: e.lane ?? "interactive" };
    });
}
