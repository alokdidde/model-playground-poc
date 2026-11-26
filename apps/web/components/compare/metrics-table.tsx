"use client";

import { Gauge } from "lucide-react";
import type { CallMetrics, ModelInfo } from "@fomo/shared";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bestBy, effectiveUsdPerMTokens, formatPerM, formatTps, type MetricKey } from "@/lib/metrics";
import { cn, formatMs, formatUsd } from "@/lib/utils";

const KEYS: MetricKey[] = ["ttftMs", "latencyMs", "outputTokensPerSec", "costUsd"];

/**
 * The run's numbers side by side: latency (TTFT and total), generation speed,
 * tokens, and cost, both for this call and per 1M tokens. The best value in
 * each column is highlighted.
 */
export function MetricsTable({
  rows,
  catalog,
  label,
}: {
  rows: { model: string; metrics: CallMetrics }[];
  catalog: Map<string, ModelInfo>;
  label: (id: string) => string;
}) {
  if (rows.length === 0) return null;
  const best = Object.fromEntries(KEYS.map((k) => [k, bestBy(rows, k)]));
  const hi = (key: MetricKey, model: string) => cn(rows.length > 1 && best[key] === model && "text-primary font-semibold");

  return (
    <Card className="gap-2 py-4">
      <div className="flex flex-wrap items-center gap-2 px-4">
        <Gauge className="text-primary size-5" />
        <h2 className="font-semibold">Run metrics</h2>
        <span className="text-muted-foreground text-xs">best in each column highlighted</span>
      </div>
      <div className="relative overflow-x-auto px-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead title="Time to the first visible answer token">TTFT</TableHead>
              <TableHead>Total</TableHead>
              <TableHead title="Output tokens per second, from the first streamed chunk to the end">Speed</TableHead>
              <TableHead>Tokens in / out</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead title="List price per 1M tokens, input / output">Price per 1M</TableHead>
              <TableHead title="This call's cost divided by all its tokens">Effective per 1M</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ model, metrics: m }) => {
              const pricing = catalog.get(model)?.pricing;
              return (
                <TableRow key={model}>
                  <TableCell className="font-medium">{label(model)}</TableCell>
                  <TableCell className={hi("ttftMs", model)}>{formatMs(m.ttftMs)}</TableCell>
                  <TableCell className={hi("latencyMs", model)}>{formatMs(m.latencyMs)}</TableCell>
                  <TableCell className={hi("outputTokensPerSec", model)}>
                    {formatTps(m.outputTokensPerSec)}
                    {m.reasoned && (
                      <span className="text-muted-foreground ml-1 text-xs font-normal" title="Includes hidden reasoning tokens, which are billed as output">
                        incl. reasoning
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {m.inputTokens} / {m.outputTokens}
                    {m.tokensEstimated && <span title="Estimated: the provider did not report usage">*</span>}
                  </TableCell>
                  <TableCell className={hi("costUsd", model)}>{formatUsd(m.costUsd)}</TableCell>
                  <TableCell>{pricing ? `${formatPerM(pricing.inputPerM)} / ${formatPerM(pricing.outputPerM)}` : "–"}</TableCell>
                  <TableCell>{formatPerM(effectiveUsdPerMTokens(m))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
