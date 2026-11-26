"use client";

import { Download, FileBarChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { summariseRun, type ModelSummary, type ResultRow } from "@/lib/eval-report";
import { formatTps } from "@/lib/metrics";
import { cn, formatMs, formatUsd } from "@/lib/utils";
import { ScatterChart } from "./scatter-chart";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const seriesColor = (i: number) => `var(--series-${(i % 6) + 1})`;

/** Lowest/highest non-null value in a column, for highlighting. */
function best(rows: ModelSummary[], key: keyof ModelSummary, higherIsBetter: boolean): string | undefined {
  const scored = rows.flatMap((r) => (typeof r[key] === "number" ? [{ model: r.model, value: r[key] as number }] : []));
  if (scored.length < 2) return undefined;
  return scored.reduce((a, b) => ((higherIsBetter ? b.value > a.value : b.value < a.value) ? b : a)).model;
}

/**
 * The eval run's report: one row per model with quality (judge overall and
 * per criterion, automatic checks, wins), speed and cost, plus quality-vs-cost
 * and quality-vs-speed charts and a CSV/JSON export.
 */
export function EvalReport({ runId, models, results, label }: { runId: string; models: string[]; results: ResultRow[]; label: (id: string) => string }) {
  const rows = summariseRun(results, models);
  if (!rows.some((r) => r.prompts > 0)) return null;
  const hi = (key: keyof ModelSummary, model: string, higherIsBetter = false) =>
    cn(best(rows, key, higherIsBetter) === model && "text-primary font-semibold");
  const color = new Map(models.map((m, i) => [m, seriesColor(i)]));
  const anyChecks = rows.some((r) => r.checksRun > 0);

  const costPoints = rows.flatMap((r) =>
    r.meanScore !== null && r.costPerPromptUsd !== null
      ? [{ model: r.model, label: label(r.model), x: r.costPerPromptUsd, y: r.meanScore, color: color.get(r.model)!, xText: formatUsd(r.costPerPromptUsd), yText: `${r.meanScore}/10` }]
      : [],
  );
  const speedPoints = rows.flatMap((r) =>
    r.meanScore !== null && r.meanTokensPerSec !== null
      ? [{ model: r.model, label: label(r.model), x: r.meanTokensPerSec, y: r.meanScore, color: color.get(r.model)!, xText: formatTps(r.meanTokensPerSec), yText: `${r.meanScore}/10` }]
      : [],
  );

  return (
    <Card className="gap-4 py-4">
      <div className="flex flex-wrap items-center gap-2 px-4">
        <FileBarChart className="text-primary size-5" />
        <h2 className="font-semibold">Report</h2>
        <span className="text-muted-foreground text-xs">best in each column highlighted</span>
        <div className="ml-auto flex gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={`/api/evals/${runId}/export?format=csv`}>
              <Download /> CSV
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`/api/evals/${runId}/export?format=json`}>
              <Download /> JSON
            </a>
          </Button>
        </div>
      </div>

      <div className="relative overflow-x-auto px-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead title="Mean judge overall score">Quality</TableHead>
              <TableHead title="Mean judge scores per criterion">Accuracy / Helpful / Clarity</TableHead>
              <TableHead title="Prompts where the judge picked this model">Wins</TableHead>
              {anyChecks && <TableHead title="Automatic checks: reference answer match, valid JSON">Checks</TableHead>}
              <TableHead title="Median time to first token">TTFT p50</TableHead>
              <TableHead title="Median and 95th percentile total time">Latency p50 / p95</TableHead>
              <TableHead title="Mean output tokens per second (includes reasoning tokens)">Speed</TableHead>
              <TableHead>Cost / prompt</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Errors</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.model}>
                <TableCell className="font-medium">
                  <span className="mr-1.5 inline-block size-2.5 rounded-full" style={{ background: color.get(r.model) }} />
                  {label(r.model)}
                </TableCell>
                <TableCell className={hi("meanScore", r.model, true)}>{r.meanScore === null ? "–" : `${r.meanScore}/10`}</TableCell>
                <TableCell>{r.accuracy === null ? "–" : `${r.accuracy} / ${r.helpfulness} / ${r.clarity}`}</TableCell>
                <TableCell className={hi("wins", r.model, true)}>{r.wins}</TableCell>
                {anyChecks && <TableCell>{r.checksRun ? `${r.checksPassed}/${r.checksRun}` : "–"}</TableCell>}
                <TableCell className={hi("ttftP50", r.model)}>{formatMs(r.ttftP50)}</TableCell>
                <TableCell className={hi("latencyP50", r.model)}>
                  {formatMs(r.latencyP50)} / {formatMs(r.latencyP95)}
                </TableCell>
                <TableCell className={hi("meanTokensPerSec", r.model, true)}>{formatTps(r.meanTokensPerSec)}</TableCell>
                <TableCell className={hi("costPerPromptUsd", r.model)}>{formatUsd(r.costPerPromptUsd)}</TableCell>
                <TableCell>{formatUsd(r.totalCostUsd)}</TableCell>
                <TableCell className={cn(r.failed > 0 && "text-destructive")}>
                  {r.failed}/{r.prompts} ({pct(r.errorRate)})
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-1 gap-6 px-4 md:grid-cols-2">
        <ScatterChart
          title="Quality vs cost"
          caption="Top left is best: higher scores for less money per prompt."
          xLabel="Cost per prompt"
          yLabel="Judge score"
          points={costPoints}
          formatX={(x) => (x === 0 ? "$0" : `$${x.toPrecision(2)}`)}
        />
        <ScatterChart
          title="Quality vs speed"
          caption="Top right is best: higher scores, faster generation."
          xLabel="Output tokens/sec"
          yLabel="Judge score"
          points={speedPoints}
          formatX={(x) => `${Math.round(x)}`}
        />
      </div>
    </Card>
  );
}
