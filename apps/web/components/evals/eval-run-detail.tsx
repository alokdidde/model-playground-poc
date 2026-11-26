"use client";

import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import type { RunStatus } from "@fomo/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/api-client";
import { formatMs, formatUsd } from "@/lib/utils";
import { statusVariant } from "./eval-runs";

interface RunDetail {
  id: string;
  name: string;
  status: RunStatus;
  models: string[];
  judgeModel: string;
  error: string | null;
  prompts: { index: number; prompt: string; winnerModel: string | null; judgeRationale: string | null }[];
  results: {
    promptIndex: number;
    model: string;
    status: "SUCCEEDED" | "FAILED";
    output: string;
    score: number | null;
    latencyMs: number;
    costUsd: number | null;
  }[];
  progress: { totalCalls: number; completedCalls: number; failedCalls: number; ratio: number };
}

const ACTIVE: RunStatus[] = ["QUEUED", "RUNNING"];

export function EvalRunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<RunDetail>();
  const [error, setError] = useState<string>();

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
        <Badge variant="outline">judge: {run.judgeModel}</Badge>
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
      </div>
      {run.error && <p className="text-destructive text-sm">{run.error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/3">Prompt</TableHead>
            {run.models.map((m) => (
              <TableHead key={m}>{m}</TableHead>
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
                        </div>
                        <details>
                          <summary className="cursor-pointer">answer</summary>
                          <p className="mt-1 whitespace-pre-wrap">{r.output}</p>
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
