"use client";

import { useEffect, useMemo, useState } from "react";
import { Crown, Sparkles } from "lucide-react";
import { TASK_TYPES, type PriorityWeights, type RunStatus, type TaskType } from "@fomo/shared";
import { Card } from "@/components/ui/card";
import { PriorityPicker } from "@/components/compare/priority-picker";
import { Markdown } from "@/components/markdown";
import { useModels } from "@/components/model-picker";
import type { ResultRow } from "@/lib/eval-report";
import { formatTps } from "@/lib/metrics";
import { EvalReport } from "./eval-report";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";
import { aggregateResults, describeRecommendation, presetFor, PRIORITY_WEIGHTS, recommend, TASK_DEFAULT_PRIORITY } from "@/lib/recommend";
import { formatMs, formatUsd } from "@/lib/utils";
import { statusVariant } from "./eval-runs";

interface RunDetail {
  id: string;
  name: string;
  status: RunStatus;
  models: string[];
  judgeModel: string;
  error: string | null;
  taskType: TaskType;
  priority: PriorityWeights | null;
  sourceComparisonId: string | null;
  prompts: { index: number; prompt: string; winnerModel: string | null; judgeRationale: string | null }[];
  results: (ResultRow & { output: string })[];
  progress: { totalCalls: number; completedCalls: number; failedCalls: number; ratio: number };
}

const ACTIVE: RunStatus[] = ["QUEUED", "RUNNING"];

export function EvalRunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<RunDetail>();
  const [error, setError] = useState<string>();
  const { models } = useModels();
  const labels = useMemo(() => new Map(models.map((m) => [m.id, m.label])), [models]);
  const label = (id: string) => labels.get(id) ?? id;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await fetchJson<RunDetail>(`/api/evals/${id}`);
        setRun(data);
        if (ACTIVE.includes(data.status)) timer = setTimeout(load, 1_500);
      } catch (e) {
        setError(String(e));
      }
    };
    void load();
    return () => clearTimeout(timer);
  }, [id]);

  if (error) return <p className="text-destructive">{error}</p>;
  if (!run) return <p className="text-muted-foreground">Loading…</p>;

  const cell = (promptIndex: number, model: string) => run.results.find((r) => r.promptIndex === promptIndex && r.model === model);

  async function cancel() {
    await fetchJson(`/api/evals/${id}/cancel`, { method: "POST" }).catch(() => undefined);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{run.name}</h1>
        <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
        <Badge variant="outline">{TASK_TYPES[run.taskType]?.label ?? run.taskType}</Badge>
        <Badge variant="outline">judge: {label(run.judgeModel)}</Badge>
        {run.sourceComparisonId && (
          <Badge variant="outline" title={`Comparison ${run.sourceComparisonId}`}>
            validates a compare
          </Badge>
        )}
        {ACTIVE.includes(run.status) && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={cancel}>
            Cancel run
          </Button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Progress value={run.progress.ratio * 100} />
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {run.progress.completedCalls}/{run.progress.totalCalls} calls · {run.progress.failedCalls} failed
        </span>
        <a href={`/ops/rate-limits?tag=${run.id}`} className="text-muted-foreground text-xs whitespace-nowrap underline">
          Rate-limit timeline
        </a>
      </div>
      {run.error && <p className="text-destructive text-sm">{run.error}</p>}

      <AggregateRecommendation run={run} label={label} />
      <EvalReport runId={run.id} models={run.models} results={run.results} label={label} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/3">Prompt</TableHead>
            {run.models.map((m) => (
              <TableHead key={m}>{label(m)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {run.prompts.map((p) => (
            <TableRow key={p.index}>
              <TableCell className="align-top text-sm">
                {p.prompt}
                {p.judgeRationale && <p className="text-muted-foreground mt-1 text-xs">{p.judgeRationale}</p>}
              </TableCell>
              {run.models.map((m) => {
                const r = cell(p.index, m);
                return (
                  <TableCell key={m} className="align-top text-xs">
                    {!r ? (
                      <span className="text-muted-foreground">…</span>
                    ) : r.status === "FAILED" ? (
                      <Badge variant="destructive">failed</Badge>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 font-medium">
                          {p.winnerModel === m && <Crown className="text-primary size-3" />}
                          {r.score !== null ? `${r.score}/10` : "not judged"}
                        </div>
                        <div className="text-muted-foreground">
                          {formatMs(r.latencyMs)} · {formatUsd(r.costUsd)}
                          {r.outputTokensPerSec ? ` · ${formatTps(r.outputTokensPerSec)}` : ""}
                        </div>
                        {r.checks?.map((c) => (
                          <Badge key={c.name} variant={c.passed ? "success" : "destructive"} title={c.detail}>
                            {c.name === "valid_json" ? "JSON" : "reference"} {c.passed ? "✓" : "✗"}
                          </Badge>
                        ))}
                        <details>
                          <summary className="cursor-pointer">answer</summary>
                          <Markdown text={r.output} className="mt-1" />
                        </details>
                      </div>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The compare page's recommendation, recomputed over every prompt in the run:
 * mean judge score, mean latency and mean cost per prompt for each model.
 */
function AggregateRecommendation({ run, label }: { run: RunDetail; label: (id: string) => string }) {
  const initial = run.priority ?? PRIORITY_WEIGHTS[TASK_DEFAULT_PRIORITY[run.taskType] ?? "balanced"];
  const [priority, setPriority] = useState<PriorityWeights>(initial);
  const [custom, setCustom] = useState(presetFor(initial) === null);
  const candidates = aggregateResults(run.results);
  const rec = recommend(candidates, priority);
  if (!rec) return null;
  const pick = candidates.find((c) => c.model === rec.pick)!;
  const prompts = run.prompts.length;
  const partial = run.status === "QUEUED" || run.status === "RUNNING";

  return (
    <Card className="border-primary/40 bg-accent-soft/40 gap-3 py-4">
      <div className="flex flex-wrap items-center gap-2 px-4">
        <Sparkles className="text-primary size-5" />
        <h2 className="font-semibold">
          Recommended across {prompts} prompts: <span className="text-primary">{label(rec.pick)}</span>
        </h2>
        <div className="ml-auto">
          <PriorityPicker value={priority} onChange={setPriority} custom={custom} onCustomChange={setCustom} size="sm" />
        </div>
      </div>
      <div className="space-y-2 px-4">
        <p className="text-base">{describeRecommendation(rec, label)}</p>
        <p className="text-muted-foreground text-xs">
          Averages per model: judge score, latency and cost per prompt. {label(rec.pick)} scored {pick.score.overall}/10 on {pick.judged} judged
          prompts{pick.failed ? ` (${pick.failed} failed)` : ""}.{partial ? " The run is still going, so this may change." : ""}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {[...candidates]
            .sort((a, b) => b.score.overall - a.score.overall)
            .map((c) => (
              <Badge key={c.model} variant={c.model === rec.pick ? "default" : "outline"}>
                {label(c.model)}: {c.score.overall}/10 · {formatMs(c.metrics.latencyMs)} · {formatUsd(c.metrics.costUsd)}
              </Badge>
            ))}
        </div>
      </div>
    </Card>
  );
}
