"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LIMITS, type CompareRequestInput, type ModelInfo, type PriorityWeights, type Problem } from "@fomo/shared";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useModels } from "@/components/model-picker";
import { fetchJson, ProblemError } from "@/lib/api-client";
import type { SavedComparison } from "@/lib/compare-state";
import { getLiveRun, startLiveRun } from "@/lib/live-run";
import { DEFAULT_SETTINGS, newSelection, toRequestSettings, type SelectedModel } from "@/lib/model-settings";
import { PRIORITY_WEIGHTS } from "@/lib/recommend";
import { ModelCatalog } from "./model-catalog";
import { ModelSettingsDrawer } from "./model-settings-drawer";
import { PromptCard } from "./prompt-card";
import { SelectedModels } from "./selected-models";
import { RunHistory } from "./run-history";

// Deliberately excludes the default judge (gpt-oss-120b) so the judge stays neutral.
const DEFAULT_MODELS = ["deepseek-v4.1-flash", "mistral-3-14B", "glm-5.3-flash"];

/**
 * The compare setup: prompt, models and their settings. Pressing Compare
 * starts the run and opens its own page (/runs/:id), where it streams.
 */
export function CompareView() {
  const router = useRouter();
  const { models, mockMode, error: modelsError } = useModels();
  const catalog = useMemo(() => new Map<string, ModelInfo>(models.map((m) => [m.id, m])), [models]);
  const label = (id: string) => catalog.get(id)?.label ?? id;

  const [prompt, setPrompt] = useState("Explain the difference between a process and a thread, with one example each.");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selected, setSelected] = useState<SelectedModel[]>(() => DEFAULT_MODELS.map(newSelection));
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [judgeEnabled, setJudgeEnabled] = useState(true);
  const [synthesize, setSynthesize] = useState(true);
  const [priority, setPriority] = useState<PriorityWeights>(PRIORITY_WEIGHTS.balanced);
  const [customPriority, setCustomPriority] = useState(false);

  // ?from=<id> fills the form from an earlier run ("Edit and rerun"); ?run=<id> is an old link to a run;
  // ?history=1 opens the list of past runs.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const runId = q.get("run");
    if (runId) return router.replace(`/runs/${encodeURIComponent(runId)}`);
    const from = q.get("from");
    if (from) return void prefillFrom(from);
    if (q.get("history")) setHistoryOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on load
  }, []);

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<Problem>();
  const [historyOpen, setHistoryOpen] = useState(false);

  // Load the run page's code while the user writes the prompt, so pressing Compare doesn't wait for it.
  // The id is a placeholder: only the route's code and loading screen are fetched.
  useEffect(() => router.prefetch("/runs/prefetch"), [router]);

  async function run() {
    setStarting(true);
    setError(undefined);
    const request: CompareRequestInput = {
      prompt,
      systemPrompt: systemPrompt.trim() || undefined,
      models: selected.map((m) => m.id),
      judge: { enabled: judgeEnabled },
      synthesize,
      priority,
      modelSettings: Object.fromEntries(selected.map((m) => [m.id, toRequestSettings(m, catalog.get(m.id))])),
    };
    try {
      router.push(`/runs/${await startLiveRun(request)}`);
    } catch (e) {
      setError(e instanceof ProblemError ? e.problem : { type: "about:blank", title: "Could not start the run", status: 0, detail: String(e) });
      setStarting(false);
    }
  }

  /** "Edit and rerun": the form as that run was sent. Read from this tab if it is still live, else from the API. */
  async function prefillFrom(id: string) {
    try {
      const live = getLiveRun(id)?.request;
      const c = live ? null : await fetchJson<SavedComparison>(`/api/compare/${encodeURIComponent(id)}`);
      const sent = live
        ? { prompt: live.prompt, systemPrompt: live.systemPrompt ?? "", models: live.models, priority: live.priority, settings: live.modelSettings ?? {} }
        : {
            prompt: c!.prompt,
            systemPrompt: c!.systemPrompt ?? "",
            models: c!.models,
            priority: c!.priority ?? undefined,
            settings: Object.fromEntries(c!.results.map((r) => [r.model, r.settings ?? {}])),
          };
      setPrompt(sent.prompt);
      setSystemPrompt(sent.systemPrompt);
      setSelected(sent.models.map((m) => ({ id: m, settings: { ...DEFAULT_SETTINGS, ...sent.settings[m] } }) as SelectedModel));
      if (sent.priority) {
        setPriority(sent.priority);
        setCustomPriority(true);
      }
    } catch (e) {
      setError(e instanceof ProblemError ? e.problem : { type: "about:blank", title: "Could not load that run", status: 0, detail: String(e) });
    }
  }

  const editing = selected.find((m) => m.id === settingsFor) ?? null;

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
            onAdd={(id) => setSelected((s) => [...s, newSelection(id)])}
            onAddMany={(ids) => setSelected((s) => [...s, ...ids.map(newSelection)])}
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
            priority={priority}
            onPriorityChange={setPriority}
            customPriority={customPriority}
            onCustomPriorityChange={setCustomPriority}
            running={false}
            starting={starting}
            canRun={!starting && Boolean(prompt.trim()) && selected.length > 0}
            modelCount={selected.length}
            onRun={run}
            onStop={() => {}}
          />
          {starting && <p className="text-muted-foreground text-sm">Starting the run…</p>}
          {!starting && !prompt.trim() && <p className="text-muted-foreground text-sm">Type a prompt to compare.</p>}
          {!starting && prompt.trim() && selected.length === 0 && <p className="text-muted-foreground text-sm">Pick at least one model below.</p>}
          {error && (
            <p className="text-destructive text-sm">
              {error.title}
              {error.detail ? `: ${error.detail}` : ""}
              {error.errors?.map((e) => ` (${e.pointer}: ${e.message})`)}
            </p>
          )}
          <SelectedModels selected={selected} catalog={catalog} onChange={setSelected} onOpenSettings={setSettingsFor} activeId={settingsFor} />
        </div>
      </div>

      <RunHistory open={historyOpen} onOpenChange={setHistoryOpen} label={label} />

      <ModelSettingsDrawer
        model={editing}
        info={editing ? catalog.get(editing.id) : undefined}
        onChange={(settings) => setSelected((list) => list.map((m) => (m.id === settingsFor ? { ...m, settings } : m)))}
        onClose={() => setSettingsFor(null)}
      />
    </div>
  );
}
