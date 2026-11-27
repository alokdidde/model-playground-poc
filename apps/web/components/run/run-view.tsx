"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowDownUp, ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Gauge, History, Link2, ListChecks, ListOrdered, Loader2, MessagesSquare, Pencil, Scale, Square, Timer, Trophy } from "lucide-react";
import type { ModelInfo, ModelSettings, PriorityWeights, Problem } from "@fomo/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useModels } from "@/components/model-picker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WithTooltip } from "@/components/ui/tooltip";
import { RecommendationCard } from "@/components/compare/recommendation-card";
import { RunHistory } from "@/components/compare/run-history";
import { SynthesisCard } from "@/components/compare/synthesis-card";
import { AnswerColumn, type Rating } from "@/components/run/answer-column";
import { CostCard, SpeedCard } from "@/components/run/cost-speed";
import { EvidenceCard } from "@/components/run/evidence-card";
import { JudgeCard } from "@/components/run/judge-card";
import { VerdictBar } from "@/components/run/verdict-bar";
import { fetchJson, ProblemError } from "@/lib/api-client";
import { restoreCompareState, type SavedComparison } from "@/lib/compare-state";
import { getLiveRun, subscribeLiveRuns } from "@/lib/live-run";
import { winsByModel, type MetricKey } from "@/lib/metrics";
import { PRIORITY_WEIGHTS } from "@/lib/recommend";
import { parseSortParams, sortModels, type SortKey } from "@/lib/run-sort";
import { cn, timeAgo } from "@/lib/utils";

const TABS = ["answers", "decision", "evidence", "cost"] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string): v is Tab => (TABS as readonly string[]).includes(v);

const TAB_META: { value: Tab; label: string; hint: string; icon: typeof Trophy }[] = [
  { value: "answers", label: "Answers", hint: "Read the answers side by side", icon: MessagesSquare },
  { value: "decision", label: "Decision", hint: "The judge's verdict, the recommendation and the combined answer", icon: Scale },
  { value: "evidence", label: "Evidence", hint: "Scores per criterion, with the judge's reasons", icon: ListChecks },
  { value: "cost", label: "Cost and speed", hint: "What each answer cost and how fast it came", icon: Gauge },
];

/** The ways to order the answer columns. Each sorts best first; ties fall back to the order picked. */
const ORDERS: { key: SortKey; label: string; icon: typeof Trophy }[] = [
  { key: "quality", label: "Judge score", icon: Trophy },
  { key: "total", label: "Fastest", icon: Timer },
  { key: "cost", label: "Cheapest", icon: CircleDollarSign },
  { key: "order", label: "Order picked", icon: ListOrdered },
];

/** What was sent, whether we read it from the live request or the saved run. */
interface RunInfo {
  prompt: string;
  systemPrompt: string | null;
  priority: PriorityWeights | null;
  modelSettings: Record<string, ModelSettings>;
  createdAt: string | null;
}

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
        priority: live.request.priority ?? null,
        modelSettings: (live.request.modelSettings ?? {}) as Record<string, ModelSettings>,
        createdAt: null,
      }
    : saved && {
        prompt: saved.prompt,
        systemPrompt: saved.systemPrompt,
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
  // The column order lives in the URL (?sort=cost) and the tab in the hash (#evidence), so a shared link opens the same view.
  // Null until chosen: then the columns follow the judge's score when there is one.
  const [order, setOrder] = useState<SortKey | null>(null);
  const [tab, setTab] = useState<Tab>("answers");
  const [seenDecision, setSeenDecision] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const first = q.get("sort") === "order" ? "order" : parseSortParams(q.get("sort"), q.get("then"))[0];
    if (first) setOrder(first);
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      setTab(isTab(h) ? h : "answers");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  function changeOrder(key: SortKey) {
    setOrder(key);
    const url = new URL(window.location.href);
    url.searchParams.delete("then");
    url.searchParams.set("sort", key);
    window.history.replaceState(null, "", url.toString());
  }
  function changeTab(value: string) {
    if (!isTab(value)) return;
    setTab(value);
    if (value === "decision") setSeenDecision(true);
    const url = new URL(window.location.href);
    url.hash = value === "answers" ? "" : value;
    window.history.replaceState(null, "", url.toString());
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
  const priority = priorityOverride ?? info.priority ?? PRIORITY_WEIGHTS.balanced;
  const scores = new Map(state.judge.verdict?.scores.map((s) => [s.model, s]));
  // One fixed color per model for this run, shared by every chart and card.
  const colorOf = (m: string) => `var(--series-${(state.order.indexOf(m) % 6) + 1})`;
  // Only answers that succeeded are measured; a failed call is never "fastest" or "cheapest".
  const metrics = Object.fromEntries(state.order.map((m) => [m, state.panels[m]?.status === "done" ? state.panels[m]?.metrics : undefined]));
  const metricRows = state.order.flatMap((m) => (metrics[m] ? [{ model: m, metrics: metrics[m]! }] : []));
  // Only once every model is done, so a model that finishes early is not shown as "best" too soon.
  const wins = finished ? winsByModel(metricRows) : new Map<string, Set<MetricKey>>();
  const answered = state.order.filter((m) => ["done", "failed"].includes(state.panels[m]?.status ?? "")).length;
  const hasScores = scores.size > 0;
  const chosen = order ?? (hasScores ? "quality" : "order");
  const orderKey = chosen === "quality" && !hasScores ? "order" : chosen;
  const sortedModels = sortModels(orderKey === "order" ? [] : [orderKey], { order: state.order, metrics, scores, priority });
  const verdict = state.judge.verdict;
  // A dot on the Decision tab once the verdict is in and you haven't looked yet.
  const decisionIsNew = Boolean(verdict) && !seenDecision && tab !== "decision";
  const outputs = Object.fromEntries(state.order.map((m) => [m, state.panels[m]?.output ?? ""]));
  const longPrompt = info.prompt.length > 280 || info.prompt.split("\n").length > 5;

  // Works for a run streaming in this tab and for one left running when the tab was closed.
  function stopRun() {
    if (live) return live.stop();
    void fetchJson(`/api/compare/${encodeURIComponent(id)}/cancel`, { method: "POST" }).catch(() => undefined);
  }

  // Picking your current pick again clears it.
  async function castVote(model: string) {
    const previous = vote;
    const next = vote === model ? null : model;
    setVote(next);
    await fetchJson(`/api/compare/${id}/vote`, { method: "PUT", body: JSON.stringify({ preferredModel: next }) }).catch(() => setVote(previous));
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
            <Button variant="outline" size="sm" onClick={stopRun} tooltip="Stop the models that are still answering">
              <Square /> Stop
            </Button>
          )}
          <Button variant="outline" size="sm" asChild tooltip="Open the compare form with this prompt and these models">
            <Link href={`/?from=${encodeURIComponent(id)}`}>
              <Pencil /> Edit and rerun
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={copyLink} tooltip="Copy a link to this run to share it">
            {copied ? <Check /> : <Link2 />} {copied ? "Link copied" : "Copy link"}
          </Button>
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

      <VerdictBar
        verdict={verdict}
        judging={running && state.judge.status !== "off"}
        metrics={metrics}
        priority={priority}
        vote={vote}
        label={label}
        onOpenDecision={() => changeTab("decision")}
      />

      <Tabs value={tab} onValueChange={changeTab}>
        <div className="pointer-events-none sticky top-0 z-20 py-2">
          <TabsList className="pointer-events-auto w-full border shadow-sm sm:w-fit">
            {TAB_META.map((t) => (
              <WithTooltip key={t.value} text={t.hint} side="bottom">
                <TabsTrigger value={t.value}>
                  <t.icon />
                  {t.value === "cost" ? (
                    <span>
                      Cost<span className="hidden sm:inline"> and speed</span>
                    </span>
                  ) : (
                    t.label
                  )}
                  {t.value === "decision" && decisionIsNew && <span className="bg-primary absolute top-1.5 right-1 size-1.5 rounded-full" aria-label="new" />}
                </TabsTrigger>
              </WithTooltip>
            ))}
          </TabsList>
        </div>

        <TabsContent value="answers" className="space-y-3">
          {state.order.length > 1 && (
            <div className="flex items-center gap-2">
              {/* Chips jump to a column whenever the row scrolls sideways: always on phones, and with 4+ models. */}
              <div className={cn("flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1", state.order.length <= 3 && "md:invisible")} aria-label="Jump to an answer">
                {sortedModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="bg-card hover:bg-accent flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors"
                    onClick={() => document.getElementById(`answer-${m}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })}
                  >
                    <span className="inline-block size-2 rounded-full" style={{ background: colorOf(m) }} />
                    {label(m)}
                  </button>
                ))}
              </div>
              <SortMenu value={orderKey} options={ORDERS.filter((o) => o.key !== "quality" || hasScores)} onChange={changeOrder} />
            </div>
          )}
          <EdgeScroller enabled={state.order.length > 3} count={sortedModels.length}>
            <div
              className={cn(
                // contain:paint stops mobile Chrome from zooming the page out to fit the off-screen columns.
                "relative flex snap-x snap-mandatory items-start gap-4 overflow-x-auto pb-2 max-md:[contain:paint] md:snap-none",
                "[&>article]:w-[88%] [&>article]:shrink-0 [&>article]:snap-start",
                state.order.length <= 3
                  ? cn("md:grid md:overflow-visible md:[&>article]:w-auto", state.order.length === 2 ? "md:grid-cols-2" : state.order.length === 3 ? "md:grid-cols-3" : "md:grid-cols-1")
                  : "md:[&>article]:w-[24rem]",
              )}
            >
              {sortedModels.map((m) => (
                <AnswerColumn
                  key={m}
                  panel={state.panels[m]!}
                  label={label(m)}
                  color={colorOf(m)}
                  score={scores.get(m)}
                  isWinner={verdict?.winnerModel === m}
                  picked={vote === m}
                  canVote={finished && state.panels[m]?.status === "done"}
                  rating={ratings[m] ?? null}
                  onRate={(r) => rate(m, r)}
                  onPick={() => castVote(m)}
                  wins={wins.get(m) ?? new Set()}
                  pinHeader={state.order.length <= 3}
                />
              ))}
            </div>
          </EdgeScroller>
        </TabsContent>

        <TabsContent value="decision" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <JudgeCard judge={state.judge} label={label} />
            {verdict ? (
              <RecommendationCard
                verdict={verdict}
                metrics={metrics}
                label={label}
                priority={priority}
                onPriorityChange={setPriorityOverride}
                customPriority={customPriority}
                onCustomPriorityChange={setCustomPriority}
              />
            ) : (
              <Pending>The recommendation appears once the judge has scored the answers.</Pending>
            )}
          </div>
          <SynthesisCard synthesis={state.synthesis} label={label} />
        </TabsContent>

        <TabsContent value="evidence">
          {verdict ? (
            <EvidenceCard verdict={verdict} outputs={outputs} label={label} colorOf={colorOf} />
          ) : (
            <Pending>{state.judge.status === "off" ? "This run was not judged." : "Scores appear once the judge has scored the answers."}</Pending>
          )}
        </TabsContent>

        <TabsContent value="cost" className="space-y-4">
          {finished && metricRows.length > 0 ? (
            <>
              <CostCard rows={metricRows} scores={scores} label={label} colorOf={colorOf} />
              <SpeedCard rows={metricRows} scores={scores} catalog={catalog} label={label} colorOf={colorOf} />
            </>
          ) : (
            <Pending>{finished ? "No answers succeeded, so there is nothing to measure." : "Timing and cost appear once every answer is in."}</Pending>
          )}
        </TabsContent>
      </Tabs>

      <RunHistory open={historyOpen} onOpenChange={setHistoryOpen} currentId={id} label={label} />

    </div>
  );
}

function SortMenu({ value, options, onChange }: { value: SortKey; options: typeof ORDERS; onChange: (key: SortKey) => void }) {
  const current = options.find((o) => o.key === value) ?? options[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground shrink-0" tooltip="Change the order of the answer columns">
          <ArrowDownUp /> <span className="hidden sm:inline">Sort:</span> <span className="text-foreground">{current.label}</span>
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Order columns by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as SortKey)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.key} value={o.key}>
              <o.icon className="text-muted-foreground size-4" /> {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Fades the edge of a sideways-scrolling row and adds arrow buttons, so it is
 * obvious that more answers sit off-screen. The arrows stay at mid-screen while
 * you scroll down the (long) columns.
 */
function EdgeScroller({ enabled, count, children }: { enabled: boolean; count: number; children: React.ReactElement }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const scroller = () => wrap.current?.firstElementChild as HTMLElement | null | undefined;

  const measure = useCallback(() => {
    const el = scroller();
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
  }, []);

  useEffect(() => {
    const el = scroller();
    if (!enabled || !el) return;
    const frame = requestAnimationFrame(measure);
    el.addEventListener("scroll", measure, { passive: true });
    // Watch the columns too: the row's own size doesn't change when answers arrive.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [enabled, measure, count]);

  const step = (dir: 1 | -1) => {
    const el = scroller();
    const col = el?.firstElementChild as HTMLElement | null | undefined;
    el?.scrollBy({ left: dir * ((col?.offsetWidth ?? 320) + 16), behavior: "smooth" });
  };

  if (!enabled) return children;
  return (
    <div ref={wrap} className="relative">
      {children}
      {(["left", "right"] as const).map((side) => (
        <div
          key={side}
          aria-hidden={!edges[side]}
          className={cn(
            "pointer-events-none absolute inset-y-0 z-[15] w-16 transition-opacity duration-200 max-md:hidden",
            side === "left" ? "from-page left-0 bg-gradient-to-r to-transparent" : "from-page right-0 bg-gradient-to-l to-transparent",
            edges[side] ? "opacity-100" : "opacity-0",
          )}
        >
          <div className={cn("sticky top-[45vh] flex", side === "left" ? "justify-start" : "justify-end")}>
            <Button
              variant="outline"
              size="icon"
              className={cn("rounded-full shadow-md", edges[side] && "pointer-events-auto")}
              tabIndex={edges[side] ? 0 : -1}
              aria-label={side === "left" ? "Previous answers" : "More answers"}
              tooltip={side === "left" ? "Previous answers" : "More answers"}
              onClick={() => step(side === "left" ? -1 : 1)}
            >
              {side === "left" ? <ChevronLeft /> : <ChevronRight />}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Pending({ children }: { children: React.ReactNode }) {
  return (
    <Card className="text-muted-foreground items-center justify-center px-5 py-10 text-center text-sm">
      <p>{children}</p>
    </Card>
  );
}

function BackLink() {
  return (
    <Link href="/" className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm">
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
