"use client";

import { useState } from "react";
import { Calculator, ChevronRight, CircleDollarSign, Timer } from "lucide-react";
import type { CallMetrics, JudgeScore, ModelInfo } from "@fomo/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bestBy, effectiveUsdPerMTokens, formatPerM, formatTps, type MetricKey } from "@/lib/metrics";
import { monthlyCost, paretoFront } from "@/lib/run-insights";
import { cn, formatMs, formatUsd } from "@/lib/utils";

type Row = { model: string; metrics: CallMetrics };

/** Cost at your volume, and quality against cost for the whole run. */
export function CostCard({
  rows,
  scores,
  label,
  colorOf,
}: {
  rows: Row[];
  scores: Map<string, JudgeScore>;
  label: (id: string) => string;
  colorOf: (id: string) => string;
}) {
  const [calls, setCalls] = useState(10_000);
  const priced = rows.filter((r) => r.metrics.costUsd !== null).sort((a, b) => a.metrics.costUsd! - b.metrics.costUsd!);
  const points = priced.flatMap((r) => (scores.has(r.model) && r.metrics.costUsd! > 0 ? [{ model: r.model, cost: r.metrics.costUsd!, score: scores.get(r.model)!.overall }] : []));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="text-primary size-4" /> Cost at your volume
        </CardTitle>
        <CardDescription>This prompt&apos;s measured cost per call, times your calls a day, times 30 days.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="flex flex-wrap items-center gap-2 text-sm" htmlFor="calls-per-day">
            Calls like this one per day
            <Input
              id="calls-per-day"
              type="number"
              min={0}
              step={1000}
              value={calls}
              onChange={(e) => setCalls(Math.max(0, Number(e.target.value) || 0))}
              className="w-32 tabular-nums"
            />
          </label>
          <ul className="space-y-1.5">
            {priced.map((r) => (
              <li key={r.model} className="bg-muted/50 flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: colorOf(r.model) }} />
                  <span className="truncate">{label(r.model)}</span>
                </span>
                <span className="font-semibold tabular-nums">
                  ${monthlyCost(r.metrics.costUsd!, calls).toLocaleString(undefined, { maximumFractionDigits: 2 })} a month
                </span>
              </li>
            ))}
          </ul>
          {priced.length < rows.length && <p className="text-muted-foreground text-xs">Models without a known price are left out.</p>}
        </div>
        {points.length >= 2 && <QualityVsCost points={points} label={label} colorOf={colorOf} />}
      </CardContent>
    </Card>
  );
}

function QualityVsCost({
  points,
  label,
  colorOf,
}: {
  points: { model: string; cost: number; score: number }[];
  label: (id: string) => string;
  colorOf: (id: string) => string;
}) {
  const W = 360,
    H = 220,
    pl = 30,
    pr = 16,
    pt = 12,
    pb = 34;
  const costs = points.map((p) => p.cost);
  const lo = Math.log10(Math.min(...costs) / 1.6);
  const hi = Math.log10(Math.max(...costs) * 1.6);
  const x = (v: number) => pl + ((Math.log10(v) - lo) / (hi - lo || 1)) * (W - pl - pr);
  const y = (v: number) => pt + ((10 - v) / 10) * (H - pt - pb);
  const front = paretoFront(points);
  const frontLine = points.filter((p) => front.has(p.model)).sort((a, b) => a.cost - b.cost);
  const beaten = points.filter((p) => !front.has(p.model));
  return (
    <figure className="min-w-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" role="img" aria-label="Judge score against cost per call">
        {[0, 5, 10].map((v) => (
          <g key={v}>
            <line x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} className="stroke-border" />
            <text x={pl - 6} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {v}
            </text>
          </g>
        ))}
        {frontLine.length > 1 && (
          <polyline
            fill="none"
            strokeDasharray="4 3"
            className="stroke-muted-foreground"
            points={frontLine.map((p) => `${x(p.cost)},${y(p.score)}`).join(" ")}
          />
        )}
        {points.map((p) => (
          <circle
            key={p.model}
            cx={x(p.cost)}
            cy={y(p.score)}
            r={6}
            fill={colorOf(p.model)}
            className={front.has(p.model) ? "stroke-foreground" : "stroke-none"}
            strokeWidth={1.5}
          >
            <title>{`${label(p.model)}: ${p.score}/10, ${formatUsd(p.cost)}`}</title>
          </circle>
        ))}
        <text x={pl} y={H - 18} className="fill-muted-foreground text-[10px]">
          {formatUsd(Math.min(...costs))}
        </text>
        <text x={W - pr} y={H - 18} textAnchor="end" className="fill-muted-foreground text-[10px]">
          {formatUsd(Math.max(...costs))}
        </text>
        <text x={(W + pl) / 2} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          Cost per call (log scale) →
        </text>
      </svg>
      {/* A legend instead of on-chart labels: dots at similar cost and score would make labels collide. */}
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {points.map((p) => (
          <li key={p.model} className="flex items-center gap-1.5">
            <span className={cn("inline-block size-2.5 rounded-full", front.has(p.model) && "ring-foreground ring-1")} style={{ background: colorOf(p.model) }} />
            {label(p.model)}
            <span className="text-muted-foreground tabular-nums">
              {p.score}/10 · {formatUsd(p.cost)}
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="text-muted-foreground mt-1 text-xs">
        Judge score (up) against cost (right). Outlined dots: nothing in this run is both cheaper and better.{" "}
        {beaten.length ? `${beaten.map((p) => label(p.model)).join(", ")} ${beaten.length === 1 ? "is" : "are"} beaten on both.` : "Every model here is a fair trade-off."}
      </figcaption>
    </figure>
  );
}

/** Waiting vs writing on one shared time axis, then the numbers. */
export function SpeedCard({
  rows,
  scores,
  catalog,
  label,
  colorOf,
}: {
  rows: Row[];
  scores: Map<string, JudgeScore>;
  catalog: Map<string, ModelInfo>;
  label: (id: string) => string;
  colorOf: (id: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.metrics.latencyMs));
  const step = niceStep(max);
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const best = (key: MetricKey) => (rows.length > 1 ? bestBy(rows, key) : undefined);
  const bestScore = Math.max(...[...scores.values()].map((s) => s.overall));
  const byTime = [...rows].sort((a, b) => a.metrics.latencyMs - b.metrics.latencyMs);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Timer className="text-primary size-4" /> How long each model took
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5">
            <span className="bg-muted-foreground/30 inline-block h-2 w-4 rounded-sm" /> Waiting for the first word
          </span>
          <span className="flex items-center gap-1.5">
            <span className="bg-primary inline-block h-2 w-4 rounded-sm" /> Writing the answer
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          {byTime.map(({ model, metrics: m }) => {
            const ttft = m.ttftMs ?? m.latencyMs;
            return (
              <div key={model} className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[13rem_minmax(0,1fr)]">
                <div className="min-w-0 text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: colorOf(model) }} />
                    <span className="truncate">{label(model)}</span>
                  </div>
                  <div className="text-muted-foreground text-xs tabular-nums">
                    first word {formatMs(m.ttftMs)} · done {formatMs(m.latencyMs)}
                  </div>
                </div>
                <div
                  className="relative h-3"
                  role="img"
                  aria-label={`${label(model)}: first word at ${formatMs(m.ttftMs)}, done at ${formatMs(m.latencyMs)}`}
                >
                  <span className="bg-muted-foreground/30 absolute inset-y-0 left-0 rounded-l-sm" style={{ width: `${(ttft / max) * 100}%` }} />
                  <span
                    className="absolute inset-y-0 rounded-r-sm"
                    style={{ left: `${(ttft / max) * 100}%`, width: `${Math.max(0.5, ((m.latencyMs - ttft) / max) * 100)}%`, background: colorOf(model) }}
                  />
                </div>
              </div>
            );
          })}
          <div className="sm:ml-[14rem]">
            <div className="text-muted-foreground relative h-4 border-t text-[10px] tabular-nums">
              {ticks.map((t) => (
                <span
                  key={t}
                  className={cn("absolute top-0.5 whitespace-nowrap", t === 0 ? "" : t / max > 0.85 ? "-translate-x-full" : "-translate-x-1/2")}
                  style={{ left: `${(t / max) * 100}%` }}
                >
                  {formatMs(t)}
                </span>
              ))}
            </div>
          </div>
          {rows.some((r) => r.metrics.reasoned) && (
            <p className="text-muted-foreground text-xs">Reasoning models think before they write, and that thinking counts as waiting here.</p>
          )}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Judge score</TableHead>
                <TableHead>First word in</TableHead>
                <TableHead>Done in</TableHead>
                <TableHead title="Output tokens per second once it starts. A token is about 3/4 of a word.">Writing speed</TableHead>
                <TableHead>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ model, metrics: m }) => (
                <TableRow key={model}>
                  <TableCell className="font-medium whitespace-nowrap">
                    <span className="mr-1.5 inline-block size-2.5 rounded-full" style={{ background: colorOf(model) }} />
                    {label(model)}
                  </TableCell>
                  <Cell best={rows.length > 1 && scores.get(model)?.overall === bestScore}>{scores.has(model) ? `${scores.get(model)!.overall}/10` : "–"}</Cell>
                  <Cell best={best("ttftMs") === model}>{formatMs(m.ttftMs)}</Cell>
                  <Cell best={best("latencyMs") === model}>{formatMs(m.latencyMs)}</Cell>
                  <Cell best={best("outputTokensPerSec") === model}>
                    {formatTps(m.outputTokensPerSec)}
                    {m.reasoned && <span title="Includes hidden reasoning tokens">*</span>}
                  </Cell>
                  <Cell best={best("costUsd") === model}>{formatUsd(m.costUsd)}</Cell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground mt-2 text-xs">
            <CircleDollarSign className="mr-1 inline size-3.5 align-[-2px]" />
            Green is best in the column. * includes hidden reasoning tokens, which are billed as output.
          </p>
        </div>

        <details className="group">
          <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1 text-sm">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" /> Tokens and prices
          </summary>
          <div className="mt-2 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Tokens in / out</TableHead>
                  <TableHead title="List price per 1M tokens, input / output">List price per 1M (in / out)</TableHead>
                  <TableHead title="This call's cost divided by all its tokens">Actual per 1M</TableHead>
                  <TableHead>Attempts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ model, metrics: m }) => {
                  const pricing = catalog.get(model)?.pricing;
                  return (
                    <TableRow key={model}>
                      <TableCell className="font-medium">{label(model)}</TableCell>
                      <TableCell className="tabular-nums">
                        {m.inputTokens} / {m.outputTokens}
                        {m.tokensEstimated && <span title="Estimated: the provider did not report usage">*</span>}
                      </TableCell>
                      <TableCell className="tabular-nums">{pricing ? `${formatPerM(pricing.inputPerM)} / ${formatPerM(pricing.outputPerM)}` : "–"}</TableCell>
                      <TableCell className="tabular-nums">{formatPerM(effectiveUsdPerMTokens(m))}</TableCell>
                      <TableCell className="tabular-nums">{m.attempts}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function Cell({ best, children }: { best: boolean; children: React.ReactNode }) {
  return <TableCell className={cn("tabular-nums", best && "font-semibold text-emerald-600 dark:text-emerald-400")}>{children}</TableCell>;
}

/** A round tick spacing that gives about 4 ticks. */
function niceStep(max: number): number {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw * 0.9) ?? raw;
}
