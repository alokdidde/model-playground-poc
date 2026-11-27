"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { LIMITS, TASK_TYPE_IDS, TASK_TYPES, type ModelInfo, type ModelSettings, type PriorityWeights, type TaskType } from "@fomo/shared";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useModels } from "@/components/model-picker";
import { fetchJson, ProblemError, streamCompare } from "@/lib/api-client";
import { compareReducer, initialCompareState, restoreCompareState, type SavedComparison } from "@/lib/compare-state";
import { winsByModel, type MetricKey } from "@/lib/metrics";
import { DEFAULT_SETTINGS, newSelection, toRequestSettings, type SelectedModel } from "@/lib/model-settings";
import { PRIORITY_WEIGHTS, TASK_DEFAULT_PRIORITY } from "@/lib/recommend";
import { JudgePanel } from "./judge-panel";
import { MetricsTable } from "./metrics-table";
import { ModelCatalog } from "./model-catalog";
import { ModelPanel, type Rating } from "./model-panel";
import { ModelSettingsDrawer } from "./model-settings-drawer";
import { PromptCard } from "./prompt-card";
import { RecommendationCard } from "./recommendation-card";
import { SelectedModels } from "./selected-models";
import { SynthesisCard } from "./synthesis-card";
import { RunHistory } from "./run-history";
import { ValidateDrawer } from "./validate-drawer";

/** What the last run actually sent, so "Validate on my prompts" reuses it even if the form changed since. */
interface RunSnapshot {
  prompt: string;
  models: string[];
  modelSettings: Record<string, ModelSettings>;
  taskType: TaskType;
}

// Deliberately excludes the default judge (gpt-oss-120b) so the judge stays neutral.
const DEFAULT_MODELS = ["deepseek-v4.1-flash", "mistral-3-14B", "glm-5.3-flash"];

export function CompareView() {
  const { models, mockMode, error: modelsError } = useModels();
  const catalog = useMemo(() => new Map<string, ModelInfo>(models.map((m) => [m.id, m])), [models]);
  const label = (id: string) => catalog.get(id)?.label ?? id;

  const [prompt, setPrompt] = useState("Explain the difference between a process and a thread, with one example each.");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selected, setSelected] = useState<SelectedModel[]>(() => DEFAULT_MODELS.map(newSelection));
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [judgeEnabled, setJudgeEnabled] = useState(true);
  const [synthesize, setSynthesize] = useState(true);
  const [taskType, setTaskType] = useState<TaskType>("general");
  const [priority, setPriority] = useState<PriorityWeights>(PRIORITY_WEIGHTS.balanced);
  const [customPriority, setCustomPriority] = useState(false);

  // ?run=<id> reopens a saved run (history, refresh, shared link); ?history=1 opens the list of past runs.
  // Otherwise the form can be prefilled from a link, e.g. "Compare the top 3" on Help me choose:
  // ?models=a,b&prompt=...&task=coding&priority=q,c,s
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const runId = q.get("run");
    if (runId) return void openRun(runId);
    if (q.get("history")) setHistoryOpen(true);
    const models = q.get("models")?.split(",").filter(Boolean).slice(0, LIMITS.maxModelsPerCompare);
    if (models?.length) setSelected(models.map(newSelection));
    const p = q.get("prompt");
    if (p) setPrompt(p);
    const task = q.get("task");
    if (task && (TASK_TYPE_IDS as readonly string[]).includes(task)) setTaskType(task as TaskType);
    const [quality, cost, speed] = (q.get("priority") ?? "").split(",").map(Number);
    if ([quality, cost, speed].every((n) => n !== undefined && Number.isFinite(n) && n >= 0 && n <= 1) && quality! + cost! + speed! > 0) {
      setPriority({ quality: quality!, cost: cost!, speed: speed! });
      setCustomPriority(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on load
  }, []);

  // Picking a task type suggests its default priority, unless the user has set custom weights.
  function changeTaskType(t: TaskType) {
    setTaskType(t);
    if (!customPriority) setPriority(PRIORITY_WEIGHTS[TASK_DEFAULT_PRIORITY[t]]);
  }
  const [state, dispatch] = useReducer(compareReducer, initialCompareState);
  const [vote, setVote] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [lastRun, setLastRun] = useState<RunSnapshot | null>(null);
  const [validateOpen, setValidateOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const running = state.status === "running";
  const finished = state.status !== "idle" && state.status !== "running";

  async function run() {
    const controller = new AbortController();
    abortRef.current = controller;
    setVote(null);
    setRatings({});
    const ids = selected.map((m) => m.id);
    const modelSettings = Object.fromEntries(selected.map((m) => [m.id, toRequestSettings(m, catalog.get(m.id))]));
    // Evals have no shared system prompt, so carry it into each model's settings for "Validate".
    const shared = systemPrompt.trim();
    setLastRun({
      prompt,
      models: ids,
      taskType,
      modelSettings: Object.fromEntries(
        Object.entries(modelSettings).map(([id, s]) => [id, shared && !s.systemPrompt ? { ...s, systemPrompt: shared } : s]),
      ),
    });
    dispatch({ type: "start", models: ids, judge: judgeEnabled, synthesize });
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      await streamCompare(
        {
          prompt,
          systemPrompt: systemPrompt.trim() || undefined,
          models: ids,
          judge: { enabled: judgeEnabled },
          synthesize,
          taskType,
          priority,
          modelSettings,
        },
        (event) => {
          // Put the run in the URL, so a refresh or a shared link reopens it.
          if (event.type === "comparison.started") window.history.replaceState(null, "", `/compare?run=${encodeURIComponent(event.comparisonId)}`);
          dispatch({ type: "event", event });
        },
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

  /** Reopens a saved run: its results, and the form as it was sent, so it can be tweaked and re-run. */
  async function openRun(id: string) {
    abortRef.current?.abort();
    setHistoryOpen(false);
    try {
      const c = await fetchJson<SavedComparison>(`/api/compare/${encodeURIComponent(id)}`);
      const settings = new Map(c.results.map((r) => [r.model, r.settings ?? {}]));
      const restoredSelection = c.models.map((m) => ({ id: m, settings: { ...DEFAULT_SETTINGS, ...settings.get(m) } }) as SelectedModel);
      const task = (TASK_TYPE_IDS as readonly string[]).includes(c.taskType) ? (c.taskType as TaskType) : "general";
      setPrompt(c.prompt);
      setSystemPrompt(c.systemPrompt ?? "");
      setSelected(restoredSelection);
      setTaskType(task);
      if (c.priority) {
        setPriority(c.priority);
        setCustomPriority(true);
      }
      setVote(c.vote?.preferredModel ?? null);
      setRatings(Object.fromEntries(c.results.filter((r) => r.rating).map((r) => [r.model, r.rating! > 0 ? "up" : "down"])));
      setLastRun({
        prompt: c.prompt,
        models: c.models,
        taskType: task,
        modelSettings: Object.fromEntries(c.results.map((r) => [r.model, (r.settings ?? {}) as ModelSettings])),
      });
      dispatch({ type: "restore", state: restoreCompareState(c) });
      window.history.replaceState(null, "", `/compare?run=${encodeURIComponent(c.id)}`);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (error) {
      dispatch({
        type: "error",
        problem: error instanceof ProblemError ? error.problem : { type: "about:blank", title: "Could not open that run", status: 0, detail: String(error) },
      });
    }
  }

  async function castVote(model: string) {
    if (!state.comparisonId) return;
    setVote(model);
    await fetchJson(`/api/compare/${state.comparisonId}/vote`, { method: "PUT", body: JSON.stringify({ preferredModel: model }) }).catch(() => setVote(null));
  }

  async function rate(model: string, rating: Rating) {
    if (!state.comparisonId) return;
    const previous = ratings[model] ?? null;
    setRatings((r) => ({ ...r, [model]: rating }));
    await fetchJson(`/api/compare/${state.comparisonId}/rating`, { method: "PUT", body: JSON.stringify({ model, rating }) }).catch(() =>
      setRatings((r) => ({ ...r, [model]: previous })),
    );
  }

  const scores = new Map(state.judge.verdict?.scores.map((s) => [s.model, s]));
  // One fixed color per model for this run, shared by every chart.
  const colorOf = (id: string) => `var(--series-${(state.order.indexOf(id) % 6) + 1})`;
  const editing = selected.find((m) => m.id === settingsFor) ?? null;
  const metrics = Object.fromEntries(state.order.map((id) => [id, state.panels[id]?.metrics]));
  const metricRows = state.order.flatMap((model) => (metrics[model] ? [{ model, metrics: metrics[model]! }] : []));
  // Only once every model is done, so a model that finishes early is not shown as "best" too soon.
  const wins = finished ? winsByModel(metricRows) : new Map<string, Set<MetricKey>>();
  const costs = Object.values(metrics).map((m) => m?.costUsd);
  const costPerPrompt = costs.length && costs.every((c) => typeof c === "number") ? (costs as number[]).reduce((a, b) => a + b, 0) : null;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compare AI models</h1>
          {mockMode && <Badge variant="warning">mock mode: canned responses, no tokens spent</Badge>}
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setHistoryOpen(true)}>
            <History /> Past runs
          </Button>
        </div>
        <p className="text-muted-foreground mt-1">Run the same prompt across several models, each with its own settings, and see which answer is worth using.</p>
      </div>

      {modelsError && <p className="text-destructive text-sm">Could not load models: {modelsError}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <div className="order-2 lg:order-1">
          <ModelCatalog
            models={models}
            selectedIds={selected.map((m) => m.id)}
            canAddMore={selected.length < LIMITS.maxModelsPerCompare}
            onAdd={(id) => setSelected((s) => [...s, newSelection(id)])}
          />
        </div>
        <div className="order-1 min-w-0 space-y-6 lg:order-2">
          <PromptCard
            prompt={prompt}
            onPromptChange={setPrompt}
            systemPrompt={systemPrompt}
            onSystemPromptChange={setSystemPrompt}
            judge={judgeEnabled}
            onJudgeChange={setJudgeEnabled}
            synthesize={synthesize}
            onSynthesizeChange={setSynthesize}
            taskType={taskType}
            onTaskTypeChange={changeTaskType}
            priority={priority}
            onPriorityChange={setPriority}
            customPriority={customPriority}
            onCustomPriorityChange={setCustomPriority}
            running={running}
            canRun={Boolean(prompt.trim()) && selected.length > 0}
            modelCount={selected.length}
            onRun={run}
            onStop={() => abortRef.current?.abort()}
          />
          {!running && !prompt.trim() && <p className="text-muted-foreground text-sm">Type a prompt to compare.</p>}
          {!running && prompt.trim() && selected.length === 0 && <p className="text-muted-foreground text-sm">Pick at least one model below.</p>}
          {state.error && (
            <p className="text-destructive text-sm">
              {state.error.title}
              {state.error.detail ? `: ${state.error.detail}` : ""}
              {state.error.errors?.map((e) => ` (${e.pointer}: ${e.message})`)}
            </p>
          )}
          <SelectedModels selected={selected} catalog={catalog} onChange={setSelected} onOpenSettings={setSettingsFor} activeId={settingsFor} />
        </div>
      </div>

      {state.order.length > 0 && (
        <div ref={resultsRef} className="scroll-mt-4 space-y-4">
          <h2 className="text-xl font-semibold">Results</h2>
          {state.judge.verdict && (
            <RecommendationCard
              verdict={state.judge.verdict}
              metrics={metrics}
              label={label}
              priority={priority}
              onPriorityChange={setPriority}
              customPriority={customPriority}
              onCustomPriorityChange={setCustomPriority}
              taskLabel={TASK_TYPES[lastRun?.taskType ?? taskType].label}
              onValidate={finished && state.comparisonId ? () => setValidateOpen(true) : undefined}
            />
          )}
          <MetricsTable
            rows={metricRows}
            catalog={catalog}
            label={label}
            colorOf={colorOf}
            scores={scores}
          />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <SynthesisCard synthesis={state.synthesis} label={label} />
            <JudgePanel judge={state.judge} label={label} />
          </div>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {state.order.map((model) => (
              <ModelPanel
                key={model}
                panel={state.panels[model]!}
                label={label(model)}
                rating={ratings[model] ?? null}
                onRate={(r) => rate(model, r)}
                score={scores.get(model)}
                isWinner={state.judge.verdict?.winnerModel === model}
                voted={vote === model}
                canVote={finished && Boolean(state.comparisonId) && state.panels[model]?.status === "done"}
                onVote={() => castVote(model)}
                color={colorOf(model)}
                wins={wins.get(model)}
              />
            ))}
          </section>
        </div>
      )}

      <RunHistory open={historyOpen} onOpenChange={setHistoryOpen} currentId={state.comparisonId} label={label} onPick={openRun} />

      {lastRun && (
        <ValidateDrawer
          key={state.comparisonId ?? "none"}
          open={validateOpen}
          onOpenChange={setValidateOpen}
          comparisonId={state.comparisonId}
          firstPrompt={lastRun.prompt}
          models={lastRun.models}
          modelSettings={lastRun.modelSettings}
          taskType={lastRun.taskType}
          priority={priority}
          costPerPrompt={costPerPrompt}
        />
      )}

      <ModelSettingsDrawer
        model={editing}
        info={editing ? catalog.get(editing.id) : undefined}
        onChange={(settings) => setSelected((list) => list.map((m) => (m.id === settingsFor ? { ...m, settings } : m)))}
        onClose={() => setSettingsFor(null)}
      />
    </div>
  );
}
