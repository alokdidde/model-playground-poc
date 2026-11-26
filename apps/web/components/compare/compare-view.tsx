"use client";

import { useReducer, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { LIMITS } from "@fomo/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ModelPicker, useModels } from "@/components/model-picker";
import { fetchJson, ProblemError, streamCompare } from "@/lib/api-client";
import { compareReducer, initialCompareState } from "@/lib/compare-state";
import { JudgePanel } from "./judge-panel";
import { ModelPanel } from "./model-panel";

const DEFAULT_MODELS = ["openai-gpt-oss-120b", "deepseek-v4.1-flash", "mistral-3-14B"];

export function CompareView() {
  const { models, mockMode, error: modelsError } = useModels();
  const [prompt, setPrompt] = useState("Explain the difference between a process and a thread, with one example each.");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selected, setSelected] = useState<string[]>(DEFAULT_MODELS);
  const [judgeEnabled, setJudgeEnabled] = useState(true);
  const [state, dispatch] = useReducer(compareReducer, initialCompareState);
  const [vote, setVote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const running = state.status === "running";

  async function run() {
    const controller = new AbortController();
    abortRef.current = controller;
    setVote(null);
    dispatch({ type: "start", models: selected, judge: judgeEnabled });
    try {
      await streamCompare(
        { prompt, systemPrompt: systemPrompt || undefined, models: selected, judge: { enabled: judgeEnabled } },
        (event) => dispatch({ type: "event", event }),
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) return dispatch({ type: "event", event: { type: "comparison.completed", comparisonId: "", status: "CANCELLED" } });
      dispatch({
        type: "error",
        problem: error instanceof ProblemError ? error.problem : { type: "about:blank", title: "Network error", status: 0, detail: String(error) },
      });
    }
  }

  async function castVote(model: string) {
    if (!state.comparisonId) return;
    setVote(model);
    await fetchJson(`/api/compare/${state.comparisonId}/vote`, {
      method: "PUT",
      body: JSON.stringify({ preferredModel: model }),
    }).catch(() => setVote(null));
  }

  const scores = new Map(state.judge.verdict?.scores.map((s) => [s.model, s]));
  const finished = state.status !== "idle" && state.status !== "running";

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Compare models</h1>
          {mockMode && <Badge variant="warning">mock mode: canned responses, no tokens spent</Badge>}
        </div>
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} maxLength={LIMITS.maxPromptChars} placeholder="Ask anything…" />
        <Textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={1}
          maxLength={LIMITS.maxSystemPromptChars}
          placeholder="Optional system prompt (applied to every model)"
        />
        {modelsError && <p className="text-destructive text-sm">Could not load models: {modelsError}</p>}
        <ModelPicker models={models} selected={selected} onChange={setSelected} max={LIMITS.maxModelsPerCompare} />
        <div className="flex flex-wrap items-center gap-4">
          <Label>
            <Checkbox checked={judgeEnabled} onCheckedChange={(v) => setJudgeEnabled(v === true)} /> Judge the answers
          </Label>
          <span className="text-muted-foreground text-xs">
            {selected.length}/{LIMITS.maxModelsPerCompare} models selected
          </span>
          {running ? (
            <Button variant="outline" className="ml-auto" onClick={() => abortRef.current?.abort()}>
              <Square /> Stop
            </Button>
          ) : (
            <Button className="ml-auto" disabled={!prompt.trim() || selected.length === 0} onClick={run}>
              <Play /> Run on {selected.length} model{selected.length === 1 ? "" : "s"}
            </Button>
          )}
        </div>
        {state.error && (
          <p className="text-destructive text-sm">
            {state.error.title}
            {state.error.detail ? `: ${state.error.detail}` : ""}
            {state.error.errors?.map((e) => ` (${e.pointer}: ${e.message})`)}
          </p>
        )}
      </section>

      {state.order.length > 0 && (
        <>
          <JudgePanel judge={state.judge} />
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {state.order.map((model) => (
              <ModelPanel
                key={model}
                panel={state.panels[model]!}
                score={scores.get(model)}
                isWinner={state.judge.verdict?.winnerModel === model}
                voted={vote === model}
                canVote={finished && Boolean(state.comparisonId) && state.panels[model]?.status === "done"}
                onVote={() => castVote(model)}
              />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
