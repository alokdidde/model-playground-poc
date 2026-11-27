"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Check, History, Link2, Loader2, Pencil, Square } from "lucide-react";
import { TASK_TYPE_IDS, TASK_TYPES, type ModelInfo, type ModelSettings, type PriorityWeights, type Problem, type TaskType } from "@fomo/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useModels } from "@/components/model-picker";
import { JudgePanel } from "@/components/compare/judge-panel";
import { MetricsTable } from "@/components/compare/metrics-table";
import { ModelPanel, type Rating } from "@/components/compare/model-panel";
import { RecommendationCard } from "@/components/compare/recommendation-card";
import { RunHistory } from "@/components/compare/run-history";
import { AnswerSort } from "@/components/run/answer-sort";
import { SynthesisCard } from "@/components/compare/synthesis-card";
import { fetchJson, ProblemError } from "@/lib/api-client";
import { restoreCompareState, type SavedComparison } from "@/lib/compare-state";
import { getLiveRun, subscribeLiveRuns } from "@/lib/live-run";
import { winsByModel, type MetricKey } from "@/lib/metrics";
import { PRIORITY_WEIGHTS, TASK_DEFAULT_PRIORITY } from "@/lib/recommend";
import { parseSortParams, sortModels, sortParam, type SortKey } from "@/lib/run-sort";
import { timeAgo } from "@/lib/utils";

/** What was sent, whether we read it from the live request or the saved run. */
interface RunInfo {
  prompt: string;
  systemPrompt: string | null;
  taskType: TaskType;
  priority: PriorityWeights | null;
  modelSettings: Record<string, ModelSettings>;
  createdAt: string | null;
}

const asTask = (t: string | undefined): TaskType => ((TASK_TYPE_IDS as readonly string[]).includes(t ?? "") ? (t as TaskType) : "general");

/**
 * One compare run: streams live when it was just started in this tab,
 * otherwise loads the saved run (and keeps polling while it is still running,
 * e.g. after a refresh mid-stream). The setup form lives on /compare.
 */
export function RunView({ id }: { id: string }) {
  const { models } = useModels();
  const catalog = useMemo(() => new Map<string, ModelInfo>(models.map((m) => [m.id, m])), [models]);
  const label = (m: string) => catalog.get(m)?.label ?? m;

  const live = useSyncExternalStore(subscribeLiveRuns, () => getLiveRun(id), () => undefined);
  const isLive = Boolean(live);
  const [saved, setSaved] = useState<SavedComparison>();
  const [loadError, setLoadError] = useState<Problem>();

  useEffect(() => {
    if (isLive) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const c = await fetchJson<SavedComparison>(`/api/compare/${encodeURIComponent(id)}`);
        if (cancelled) return;
        setSaved(c);
        if (c.status === "RUNNING" || c.status === "QUEUED") timer = setTimeout(load, 3_000);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof ProblemError ? error.problem : { type: "about:blank", title: "Could not load this run", status: 0, detail: String(error) });
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, isLive]);

  const state = useMemo(() => live?.state ?? (saved ? restoreCompareState(saved) : undefined), [live, saved]);
  const info: RunInfo | undefined = live
    ? {
        prompt: live.request.prompt,
        systemPrompt: live.request.systemPrompt ?? null,
        taskType: asTask(live.request.taskType),
        priority: live.request.priority ?? null,
        modelSettings: (live.request.modelSettings ?? {}) as Record<string, ModelSettings>,
        createdAt: null,
      }
    : saved && {
        prompt: saved.prompt,
        systemPrompt: saved.systemPrompt,
        taskType: asTask(saved.taskType),
        priority: saved.priority,
        modelSettings: Object.fromEntries(saved.results.map((r) => [r.model, (r.settings ?? {}) as ModelSettings])),
        createdAt: saved.createdAt,
      };

  // Votes and ratings start from what was saved, then follow the user's clicks.
  const [vote, setVote] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  useEffect(() => {
    if (!saved) return;
    setVote(saved.vote?.preferredModel ?? null);
    setRatings(Object.fromEntries(saved.results.filter((r) => r.rating).map((r) => [r.model, r.rating! > 0 ? "up" : "down"])));
  }, [saved?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- only when a different run loads

  // The recommendation's weights start from the run's and can be changed here to see "what if".
  const [priorityOverride, setPriorityOverride] = useState<PriorityWeights | null>(null);
  const [customPriority, setCustomPriority] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  // The sort lives in the URL (?sort=cost,ttft,speed), so a shared link opens sorted the same way.
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setSortKeys(parseSortParams(q.get("sort"), q.get("then")));
  }, []);
  function changeSort(keys: SortKey[]) {
    setSortKeys(keys);
    const url = new URL(window.location.href);
    url.searchParams.delete("sort");
    url.searchParams.delete("then");
    const value = sortParam(keys);
    if (value) url.searchParams.set("sort", value);
    // Commas are fine in a query string, and ?sort=cost,ttft reads better than cost%2Cttft.
    window.history.replaceState(null, "", url.toString().replaceAll("%2C", ","));
  }
  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackLink />
        <p className="text-destructive">
          {loadError.title}
          {loadError.detail ? `: ${loadError.detail}` : ""}
        </p>
      </div>
    );
  }
  if (!state || !info) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading run…
      </p>
    );
  }

  const running = state.status === "running" || state.status === "RUNNING" || state.status === "QUEUED";
  const finished = !running;
  const priority = priorityOverride ?? info.priority ?? PRIORITY_WEIGHTS[TASK_DEFAULT_PRIORITY[info.taskType]];
  const scores = new Map(state.judge.verdict?.scores.map((s) => [s.model, s]));
  // One fixed color per model for this run, shared by every chart and card.
  const colorOf = (m: string) => `var(--series-${(state.order.indexOf(m) % 6) + 1})`;
  // Only answers that succeeded are measured; a failed call is never "fastest" or "cheapest".
  const metrics = Object.fromEntries(state.order.map((m) => [m, state.panels[m]?.status === "done" ? state.panels[m]?.metrics : undefined]));
  const metricRows = state.order.flatMap((m) => (metrics[m] ? [{ model: m, metrics: metrics[m]! }] : []));
  // Only once every model is done, so a model that finishes early is not shown as "best" too soon.
  const wins = finished ? winsByModel(metricRows) : new Map<string, Set<MetricKey>>();
  const answered = state.order.filter((m) => ["done", "failed"].includes(state.panels[m]?.status ?? "")).length;
  const sortedModels = sortModels(sortKeys, { order: state.order, metrics, scores, priority });
  const longPrompt = info.prompt.length > 280 || info.prompt.split("\n").length > 5;

  // Works for a run streaming in this tab and for one left running when the tab was closed.
  function stopRun() {
    if (live) return live.stop();
    void fetchJson(`/api/compare/${encodeURIComponent(id)}/cancel`, { method: "POST" }).catch(() => undefined);
  }

  async function castVote(model: string) {
    setVote(model);
    await fetchJson(`/api/compare/${id}/vote`, { method: "PUT", body: JSON.stringify({ preferredModel: model }) }).catch(() => setVote(null));
  }

  async function rate(model: string, rating: Rating) {
    const previous = ratings[model] ?? null;
    setRatings((r) => ({ ...r, [model]: rating }));
    await fetchJson(`/api/compare/${id}/rating`, { method: "PUT", body: JSON.stringify({ model, rating }) }).catch(() =>
      setRatings((r) => ({ ...r, [model]: previous })),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BackLink />
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setHistoryOpen(true)}>
          <History /> Past runs
        </Button>
      </div>

      <Card className="gap-3 p-4 sm:p-5">
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-foreground font-medium">Compare run</span>
          {info.createdAt && <span>· {timeAgo(info.createdAt)}</span>}
          <span>· {TASK_TYPES[info.taskType].label}</span>
          <span>· {state.order.length} models</span>
          <StatusBadge status={state.status} />
        </div>
        <div>
          <p className={`text-base whitespace-pre-wrap sm:text-lg ${longPrompt && !showFullPrompt ? "line-clamp-4" : ""}`}>{info.prompt}</p>
          {longPrompt && (
            <button type="button" className="text-primary mt-1 text-sm hover:underline" onClick={() => setShowFullPrompt((v) => !v)}>
              {showFullPrompt ? "Show less" : "Show the whole prompt"}
            </button>
          )}
          {info.systemPrompt && <p className="text-muted-foreground mt-2 text-sm">System prompt: {info.systemPrompt}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {running && (
            <Button variant="outline" size="sm" onClick={stopRun}>
              <Square /> Stop
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href={`/compare?from=${encodeURIComponent(id)}`}>
              <Pencil /> Edit and rerun
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={copyLink} title="Copy a link to this run to share it">
            {copied ? <Check /> : <Link2 />} {copied ? "Link copied" : "Copy link"}
          </Button>
          <Link href={`/ops/rate-limits?tag=${encodeURIComponent(id)}`} className="text-muted-foreground hover:text-foreground text-sm underline">
            Rate-limit timeline
          </Link>
          {running && (
            <span className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {answered < state.order.length ? `${answered} of ${state.order.length} answers in` : state.judge.status === "running" ? "Judging the answers" : "Finishing up"}
            </span>
          )}
        </div>
        {state.error && (
          <p className="text-destructive text-sm">
            {state.error.title}
            {state.error.detail ? `: ${state.error.detail}` : ""}
          </p>
        )}
      </Card>

      {state.judge.verdict && (
        <RecommendationCard
          verdict={state.judge.verdict}
          metrics={metrics}
          label={label}
          priority={priority}
          onPriorityChange={setPriorityOverride}
          customPriority={customPriority}
          onCustomPriorityChange={setCustomPriority}
          taskLabel={TASK_TYPES[info.taskType].label}
        />
      )}

      {finished && <MetricsTable rows={metricRows} catalog={catalog} label={label} colorOf={colorOf} scores={scores} />}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-lg font-semibold">Answers</h2>
          {state.order.length > 1 && (
            <AnswerSort keys={sortKeys} onChange={changeSort} combinedAvailable={scores.size > 0} />
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedModels.map((m) => (
            <ModelPanel
              key={m}
              panel={state.panels[m]!}
              label={label(m)}
              rating={ratings[m] ?? null}
              onRate={(r) => rate(m, r)}
              score={scores.get(m)}
              isWinner={state.judge.verdict?.winnerModel === m}
              voted={vote === m}
              canVote={finished && state.panels[m]?.status === "done"}
              onVote={() => castVote(m)}
              color={colorOf(m)}
              wins={wins.get(m)}
            />
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SynthesisCard synthesis={state.synthesis} label={label} />
        <JudgePanel judge={state.judge} label={label} outputs={state.panels} />
      </div>

      <RunHistory open={historyOpen} onOpenChange={setHistoryOpen} currentId={id} label={label} />

    </div>
  );
}

function BackLink() {
  return (
    <Link href="/compare" className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm">
      <ArrowLeft className="size-4" /> New compare
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "running" || status === "RUNNING" || status === "QUEUED") return <Badge variant="secondary">running</Badge>;
  if (status === "COMPLETED") return <Badge variant="success">done</Badge>;
  if (status === "PARTIAL") return <Badge variant="warning">some models failed</Badge>;
  return <Badge variant="outline">{status.toLowerCase()}</Badge>;
}
