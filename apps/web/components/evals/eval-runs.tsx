"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LIMITS, type CreateEvalRunInput, type RunStatus } from "@fomo/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { ModelPicker, useModels } from "@/components/model-picker";
import { fetchJson, ProblemError } from "@/lib/api-client";

interface RunSummary {
  id: string;
  name: string;
  status: RunStatus;
  models: string[];
  totalCalls: number;
  completedCalls: number;
  createdAt: string;
}

const SAMPLE_PROMPTS = [
  "Summarise the CAP theorem in two sentences.",
  "Write a SQL query that returns the top 3 customers by total order value.",
  "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much is the ball?",
  "Translate 'Where is the train station?' into French, Spanish and German.",
].join("\n");

export function statusVariant(status: RunStatus) {
  return status === "COMPLETED" ? "success" : status === "FAILED" || status === "CANCELLED" ? "destructive" : status === "PARTIAL" ? "warning" : "secondary";
}

export function EvalRuns() {
  const { models } = useModels();
  const [name, setName] = useState("Quick sanity check");
  const [prompts, setPrompts] = useState(SAMPLE_PROMPTS);
  const [selected, setSelected] = useState<string[]>(["deepseek-v4.1-flash", "mistral-3-14B", "glm-5.3-flash"]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  // One key per form submission: double-clicks and retries cannot create two runs.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const refresh = useCallback(() => {
    fetchJson<{ items: RunSummary[] }>("/api/evals?limit=20").then((r) => setRuns(r.items)).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const promptList = prompts
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  // Same rules as the API: a name, at least one prompt and one model.
  const missing = !name.trim() ? "Add a run name." : promptList.length === 0 ? "Add at least one prompt." : selected.length === 0 ? "Pick at least one model." : null;

  async function submit() {
    setSubmitting(true);
    setError(undefined);
    const body: CreateEvalRunInput = {
      name,
      models: selected,
      prompts: promptList.map((prompt) => ({ prompt })),
    };
    try {
      await fetchJson("/api/evals", { method: "POST", body: JSON.stringify(body), idempotencyKey });
      setIdempotencyKey(crypto.randomUUID());
      refresh();
    } catch (e) {
      const p = e instanceof ProblemError ? e.problem : undefined;
      setError(p ? `${p.title}: ${p.detail ?? ""} ${p.errors?.map((x) => `${x.pointer} ${x.message}`).join("; ") ?? ""}` : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New batch eval</CardTitle>
          <CardDescription>
            Runs every prompt against every model in the background worker, then judges each prompt. Safe to close the
            tab: progress is durable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Run name" />
          <Textarea value={prompts} onChange={(e) => setPrompts(e.target.value)} rows={5} placeholder="One prompt per line" />
          <ModelPicker models={models} selected={selected} onChange={setSelected} max={LIMITS.maxModelsPerCompare} />
          <div className="flex items-center gap-3">
            {error ? <p className="text-destructive text-sm">{error}</p> : missing && <p className="text-muted-foreground text-sm">{missing}</p>}
            <Button className="ml-auto" disabled={submitting || missing !== null} onClick={submit}>
              Start eval run
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="font-semibold">Recent runs</h2>
        {runs.length === 0 && <p className="text-muted-foreground text-sm">No runs yet.</p>}
        {runs.map((run) => (
          <Link key={run.id} href={`/evals/${run.id}`} className="hover:bg-muted/50 block rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{run.name}</span>
              <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
              <span className="text-muted-foreground ml-auto text-xs">{new Date(run.createdAt).toLocaleString()}</span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Progress value={(run.completedCalls / Math.max(1, run.totalCalls)) * 100} />
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                {run.completedCalls}/{run.totalCalls} calls
              </span>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
