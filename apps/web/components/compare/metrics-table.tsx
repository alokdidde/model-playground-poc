"use client";

import { Award, ChevronRight, Clock, Coins, Gauge, Zap } from "lucide-react";
import type { CallMetrics, JudgeScore, ModelInfo } from "@fomo/shared";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { effectiveUsdPerMTokens, formatPerM, formatTps, rankByMetric, type RankedValue } from "@/lib/metrics";
import { cn, formatMs, formatUsd } from "@/lib/utils";

type Row = { model: string; metrics: CallMetrics };

interface Metric {
  key: string;
  title: string;
  /** Plain-language meaning, shown under the title. */
  hint: string;
  /** Short name for the winner tile, e.g. "Starts answering first". */
  winnerTitle: string;
  icon: typeof Clock;
  higherIsBetter: boolean;
  value: (model: string) => number | null | undefined;
  format: (v: number) => string;
  /** How the gap to the best reads, e.g. "slower". */
  gap: string;
  /** Fixed bar scale (e.g. 10 for a judge score); otherwise bars are relative to the largest value. */
  scaleMax?: number;
}

/**
 * The run's numbers, made comparable at a glance: one tile per "who won" and
 * one bar chart per metric, best first, with units and the gap to the best.
 * The full table (tokens, list prices) stays available under "All numbers".
 */
export function MetricsTable({
  rows,
  catalog,
  label,
  colorOf,
  scores,
}: {
  rows: Row[];
  catalog: Map<string, ModelInfo>;
  label: (id: string) => string;
  colorOf: (id: string) => string;
  scores?: Map<string, JudgeScore>;
}) {
  if (rows.length === 0) return null;
  const byModel = new Map(rows.map((r) => [r.model, r.metrics]));
  const metrics: Metric[] = [
    ...(scores && scores.size > 0
      ? [
          {
            key: "quality",
            title: "Answer quality",
            hint: "The judge's overall score, out of 10. Higher is better.",
            winnerTitle: "Best answer",
            icon: Award,
            higherIsBetter: true,
            value: (m: string) => scores.get(m)?.overall,
            format: (v: number) => `${v.toFixed(1)} / 10`,
            gap: "",
            scaleMax: 10,
          } satisfies Metric,
        ]
      : []),
    {
      key: "ttft",
      title: "Time to first token",
      hint: "How long until the answer starts to appear. Shorter is better.",
      winnerTitle: "Starts answering first",
      icon: Clock,
      higherIsBetter: false,
      value: (m) => byModel.get(m)?.ttftMs,
      format: (v) => formatMs(v),
      gap: "slower",
    },
    {
      key: "total",
      title: "Total time",
      hint: "From sending the prompt to the full answer. Shorter is better.",
      winnerTitle: "Finishes first",
      icon: Clock,
      higherIsBetter: false,
      value: (m) => byModel.get(m)?.latencyMs,
      format: (v) => formatMs(v),
      gap: "slower",
    },
    {
      key: "speed",
      title: "Generation speed",
      hint: "Output tokens per second once it starts. Higher is better.",
      winnerTitle: "Writes fastest",
      icon: Zap,
      higherIsBetter: true,
      value: (m) => byModel.get(m)?.outputTokensPerSec,
      format: (v) => formatTps(v),
      gap: "slower",
    },
    {
      key: "cost",
      title: "Cost of this run",
      hint: "What this one answer cost, in US dollars. Lower is better.",
      winnerTitle: "Cheapest",
      icon: Coins,
      higherIsBetter: false,
      value: (m) => byModel.get(m)?.costUsd,
      format: (v) => formatUsd(v),
      gap: "pricier",
    },
  ];
  const models = rows.map((r) => r.model);
  const ranked = metrics.map((metric) => ({
    metric,
    ranking: rankByMetric(
      models.map((model) => ({ model, value: metric.value(model) })),
      metric.higherIsBetter,
    ),
  }));
  const comparing = rows.length > 1;

  return (
    <Card className="gap-4 py-4">
      <div className="px-4">
        <div className="flex items-center gap-2">
          <Gauge className="text-primary size-5" />
          <h2 className="font-semibold">How the models did</h2>
        </div>
        <p className="text-muted-foreground mt-0.5 text-sm">Measured on this run. Each chart lists the best model first.</p>
      </div>

      {comparing && (
        <div className="grid grid-cols-2 gap-2 px-4 lg:grid-cols-5">
          {ranked.map(({ metric, ranking }) => (
            <WinnerTile key={metric.key} metric={metric} ranking={ranking} label={label} colorOf={colorOf} />
          ))}
        </div>
      )}

      <div className="grid gap-x-8 gap-y-5 px-4 md:grid-cols-2">
        {ranked.map(({ metric, ranking }) => (
          <MetricBars key={metric.key} metric={metric} ranking={ranking} label={label} colorOf={colorOf} comparing={comparing} byModel={byModel} />
        ))}
      </div>

      <details className="group px-4">
        <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1 text-sm">
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
          All numbers (tokens and prices)
        </summary>
        <div className="relative mt-2 overflow-x-auto">
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
    </Card>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

function WinnerTile({
  metric,
  ranking,
  label,
  colorOf,
}: {
  metric: Metric;
  ranking: RankedValue[];
  label: (id: string) => string;
  colorOf: (id: string) => string;
}) {
  const winners = ranking.filter((r) => r.isBest);
  const first = winners[0];
  const runnerUp = ranking.find((r) => !r.isBest && r.timesBest !== null);
  const Icon = metric.icon;
  return (
    <div className="bg-muted/50 min-w-0 rounded-lg p-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5" /> {metric.winnerTitle}
      </div>
      {first ? (
        <>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            {winners.map((w) => (
              <Dot key={w.model} color={colorOf(w.model)} />
            ))}
            <span className="truncate">{winners.length > 1 ? `Tie: ${winners.map((w) => label(w.model)).join(" & ")}` : label(first.model)}</span>
          </div>
          <div className="text-lg font-semibold tabular-nums">{metric.format(first.value!)}</div>
          {runnerUp && (
            <div className="text-muted-foreground truncate text-xs">
              next: {metric.format(runnerUp.value!)}
            </div>
          )}
        </>
      ) : (
        <div className="text-muted-foreground mt-1 text-sm">Not measured</div>
      )}
    </div>
  );
}

function MetricBars({
  metric,
  ranking,
  label,
  colorOf,
  comparing,
  byModel,
}: {
  metric: Metric;
  ranking: RankedValue[];
  label: (id: string) => string;
  colorOf: (id: string) => string;
  comparing: boolean;
  byModel: Map<string, CallMetrics>;
}) {
  return (
    <section className="min-w-0">
      <h3 className="text-sm font-medium">{metric.title}</h3>
      <p className="text-muted-foreground text-xs">{metric.hint}</p>
      <ul className="mt-2 space-y-2">
        {ranking.map((r) => {
          const share = metric.scaleMax && r.value !== null ? r.value / metric.scaleMax : r.share;
          const reasoned = metric.key === "speed" && byModel.get(r.model)?.reasoned;
          return (
            <li key={r.model} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
              <div className="flex min-w-0 items-center gap-1.5 text-sm sm:col-start-1">
                <Dot color={colorOf(r.model)} />
                <span className={cn("truncate", comparing && r.isBest && "font-semibold")}>{label(r.model)}</span>
              </div>
              <div className="text-right text-sm tabular-nums sm:col-start-3 sm:row-start-1">
                {r.value === null ? (
                  <span className="text-muted-foreground">not measured</span>
                ) : (
                  <>
                    <span className={cn(comparing && r.isBest && "font-semibold")}>{metric.format(r.value)}</span>
                    {reasoned && (
                      <span className="text-muted-foreground" title="Includes hidden reasoning tokens, which are billed as output">
                        *
                      </span>
                    )}
                    {comparing && (
                      <span className={cn("ml-1.5 inline-block w-[4.5rem] text-left text-xs", r.isBest ? "text-primary font-medium" : "text-muted-foreground")}>
                        {r.isBest ? "best" : gapText(metric, r, ranking[0]!.value)}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="bg-muted col-span-2 h-2 overflow-hidden rounded-full sm:col-span-1 sm:col-start-2 sm:row-start-1">
                {r.value !== null && (
                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, share * 100)}%`, background: colorOf(r.model) }} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {ranking.some((r) => metric.key === "speed" && byModel.get(r.model)?.reasoned) && (
        <p className="text-muted-foreground mt-1 text-xs">* includes hidden reasoning tokens</p>
      )}
    </section>
  );
}

/** "1.8× slower"; for a 0–10 score a ratio misleads, so "−1.5 pts". */
function gapText(metric: Metric, r: RankedValue, best: number | null): string {
  if (metric.scaleMax !== undefined) return r.value !== null && best !== null ? `−${(best - r.value).toFixed(1)} pts` : "";
  return r.timesBest !== null ? `${formatTimes(r.timesBest)} ${metric.gap}` : "";
}

/** "1.8×", "12×". */
function formatTimes(x: number): string {
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)}×`;
}
