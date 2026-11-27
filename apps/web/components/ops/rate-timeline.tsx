import type { RateEventRow, TimelinePoint } from "@/lib/server/rate-events";

const W = 960;
const PAD = { left: 64, right: 16 };
const LEVEL_H = 150;
const FACTOR_H = 60;
const STRIP_H = 70;

/**
 * One model's rate-limit story on a shared time axis:
 *   1. requests counted in our window vs the effective limit (learned limit x AIMD factor x lane share),
 *   2. the AIMD factor (1 = full speed, halves on each 429),
 *   3. a strip of events: waits for capacity, 429s, cooldowns, retries (hover a mark for its numbers).
 * Native <title> tooltips keep this a server component with no chart library.
 */
export function RateTimeline({ model, points, events, durationMs }: { model: string; points: TimelinePoint[]; events: RateEventRow[]; durationMs: number }) {
  const span = Math.max(durationMs, 1_000);
  const x = (t: number) => PAD.left + (t / span) * (W - PAD.left - PAD.right);
  const yMax = Math.max(1, ...points.map((p) => Math.max(p.used, p.max))) * 1.1;
  const yLevel = (v: number) => 22 + (1 - v / yMax) * (LEVEL_H - 32);
  const yFactor = (f: number) => LEVEL_H + 12 + (1 - f) * (FACTOR_H - 18);
  const stripTop = LEVEL_H + FACTOR_H;
  const total = stripTop + STRIP_H + 24;

  const step = (values: { t: number; v: number }[], y: (v: number) => number) =>
    values.map((p, i) => `${i === 0 ? "M" : "H"}${x(p.t).toFixed(1)}${i === 0 ? `,${y(p.v).toFixed(1)}` : ` V${y(p.v).toFixed(1)}`}`).join(" ");

  const mine = events.filter((e) => e.model === model);
  const rows: { kind: string; label: string; y: number; color: string }[] = [
    { kind: "lease_wait", label: "wait", y: stripTop + 10, color: "var(--series-1)" },
    { kind: "rate_limited", label: "429", y: stripTop + 26, color: "var(--destructive)" },
    { kind: "cooldown", label: "cooldown", y: stripTop + 42, color: "var(--series-5)" },
    { kind: "retry", label: "retry", y: stripTop + 58, color: "var(--series-2)" },
  ];
  const ticks = Array.from({ length: 6 }, (_, i) => (span / 5) * i);

  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${total}`} className="w-full" role="img" aria-label={`Rate-limit timeline for ${model}`}>
        {/* Panel 1: bucket level */}
        <text x={4} y={10} className="fill-muted-foreground text-[10px]">requests in window</text>
        {[0, yMax / 2, yMax].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yLevel(v)} y2={yLevel(v)} className="stroke-border" strokeDasharray="2 4" />
            <text x={PAD.left - 6} y={yLevel(v) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{Math.round(v)}</text>
          </g>
        ))}
        {/* One limit line per lane: batch may only fill its share of the bucket. */}
        {(["interactive", "batch"] as const).map((lane) => {
          const lanePoints = points.filter((p) => p.lane === lane);
          return lanePoints.length ? (
            <path key={lane} d={step(lanePoints.map((p) => ({ t: p.t, v: p.max })), yLevel)} fill="none" stroke={lane === "batch" ? "var(--series-2)" : "var(--series-4)"} strokeWidth={1.5} strokeDasharray="5 3" />
          ) : null;
        })}
        <path d={step(points.map((p) => ({ t: p.t, v: p.used })), yLevel)} fill="none" stroke="var(--series-1)" strokeWidth={1.5} />

        {/* Panel 2: AIMD factor */}
        <text x={4} y={LEVEL_H + 2} className="fill-muted-foreground text-[10px]">AIMD factor</text>
        <line x1={PAD.left} x2={W - PAD.right} y1={yFactor(1)} y2={yFactor(1)} className="stroke-border" strokeDasharray="2 4" />
        <line x1={PAD.left} x2={W - PAD.right} y1={yFactor(0)} y2={yFactor(0)} className="stroke-border" strokeDasharray="2 4" />
        <text x={PAD.left - 6} y={yFactor(1) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">1</text>
        <text x={PAD.left - 6} y={yFactor(0) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">0</text>
        <path d={step(points.map((p) => ({ t: p.t, v: p.factor })), yFactor)} fill="none" stroke="var(--series-3)" strokeWidth={1.5} />

        {/* Panel 3: event strip */}
        {rows.map((r) => (
          <g key={r.kind}>
            <text x={PAD.left - 6} y={r.y + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{r.label}</text>
            {mine
              .filter((e) => e.kind === r.kind)
              .map((e, i) =>
                r.kind === "cooldown" || r.kind === "retry" ? (
                  // Durations are drawn as bars: how long the bucket was blocked / the retry slept.
                  <rect key={i} x={x(e.t)} y={r.y - 4} width={Math.max(1.5, x(e.t + (e.ms ?? 0)) - x(e.t))} height={8} fill={r.color} opacity={0.55}>
                    <title>{describe(e)}</title>
                  </rect>
                ) : (
                  <circle key={i} cx={x(e.t)} cy={r.y} r={2.5} fill={r.color}>
                    <title>{describe(e)}</title>
                  </circle>
                ),
              )}
          </g>
        ))}

        {/* Time axis */}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={total - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{`${Math.round(t / 1000)} s`}</text>
        ))}
      </svg>
      <figcaption className="text-muted-foreground flex flex-wrap gap-x-4 text-xs">
        <span><span style={{ color: "var(--series-1)" }}>━</span> requests in our window</span>
        <span><span style={{ color: "var(--series-2)" }}>╍</span> batch lane limit</span>
        <span><span style={{ color: "var(--series-4)" }}>╍</span> interactive lane limit</span>
        <span><span style={{ color: "var(--series-3)" }}>━</span> AIMD factor</span>
        <span>bars = how long a cooldown or a retry sleep lasted</span>
      </figcaption>
    </figure>
  );
}

export function describe(e: RateEventRow): string {
  const d = e.data ?? {};
  const at = `${(e.t / 1000).toFixed(1)} s`;
  switch (e.kind) {
    case "retry":
      return `${at} retry after attempt ${e.attempt}: slept ${e.ms} ms (backoff ceiling ${d.ceilingMs} ms, jitter draw ${d.jitteredMs} ms${d.retryAfterMs !== undefined ? `, server said wait ${d.retryAfterMs} ms + spread ${d.spreadMs} ms` : ""}) because ${d.errorKind}`;
    case "rate_limited":
      return `${at} 429 on attempt ${e.attempt}: ${String(d.message ?? "")}`;
    case "cooldown":
      return `${at} bucket blocked for ${e.ms} ms (${String(d.cause)})`;
    case "lease_wait":
      return `${at} ${e.lane} waiting ${e.ms} ms for capacity (${String(d.reason)})`;
    default:
      return `${at} ${e.kind}${e.ms !== null ? ` ${e.ms} ms` : ""}`;
  }
}
