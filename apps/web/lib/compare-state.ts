import type { CallMetrics, CompareEvent, JudgeVerdict, Problem, RunStatus } from "@fomo/shared";

export type ModelStatus = "pending" | "streaming" | "retrying" | "waiting" | "done" | "failed";

export interface ModelPanel {
  model: string;
  status: ModelStatus;
  output: string;
  note?: string;
  metrics?: CallMetrics;
  problem?: Problem;
}

export interface CompareState {
  comparisonId?: string;
  status: "idle" | "running" | RunStatus;
  panels: Record<string, ModelPanel>;
  order: string[];
  judge: { status: "off" | "pending" | "running" | "done" | "failed"; model?: string; verdict?: JudgeVerdict; problem?: Problem };
  synthesis: { status: "off" | "pending" | "running" | "done" | "failed"; model?: string; output: string; metrics?: CallMetrics; problem?: Problem };
  error?: Problem;
}

export const initialCompareState: CompareState = {
  status: "idle",
  panels: {},
  order: [],
  judge: { status: "off" },
  synthesis: { status: "off", output: "" },
};

export type CompareAction =
  | { type: "start"; models: string[]; judge: boolean; synthesize: boolean }
  | { type: "event"; event: CompareEvent }
  | { type: "error"; problem: Problem }
  | { type: "restore"; state: CompareState };

/**
 * Pure reducer from server events to UI state. Keeping it pure makes the
 * streaming UI easy to reason about and to unit test.
 */
export function compareReducer(state: CompareState, action: CompareAction): CompareState {
  if (action.type === "start") {
    return {
      status: "running",
      order: action.models,
      panels: Object.fromEntries(action.models.map((m) => [m, { model: m, status: "pending", output: "" }])),
      judge: { status: action.judge ? "pending" : "off" },
      synthesis: { status: action.synthesize ? "pending" : "off", output: "" },
    };
  }
  if (action.type === "restore") return action.state;
  if (action.type === "error") return { ...state, status: "FAILED", error: action.problem };

  const e = action.event;
  const update = (model: string, patch: Partial<ModelPanel>): CompareState => {
    const panel = state.panels[model] ?? { model, status: "pending", output: "" };
    return { ...state, panels: { ...state.panels, [model]: { ...panel, ...patch } } };
  };

  switch (e.type) {
    case "comparison.started":
      return { ...state, comparisonId: e.comparisonId, judge: { ...state.judge, model: e.judgeModel ?? undefined } };
    case "model.delta":
      return update(e.model, { status: "streaming", note: undefined, output: (state.panels[e.model]?.output ?? "") + e.text });
    case "model.retrying":
      return update(e.model, { status: "retrying", note: `Retry ${e.attempt} in ${(e.delayMs / 1000).toFixed(1)}s: ${e.reason}` });
    case "model.waiting":
      return update(e.model, { status: "waiting", note: `Waiting for capacity (${e.reason})` });
    case "model.completed":
      return update(e.model, { status: "done", output: e.output, metrics: e.metrics, note: undefined });
    case "model.failed":
      return update(e.model, { status: "failed", problem: e.problem, output: e.partialOutput, note: undefined });
    case "judge.started":
      return { ...state, judge: { status: "running", model: e.judgeModel } };
    case "judge.completed":
      return { ...state, judge: { status: "done", model: e.verdict.judgeModel, verdict: e.verdict } };
    case "judge.failed":
      return { ...state, judge: { ...state.judge, status: "failed", problem: e.problem } };
    case "synthesis.started":
      return { ...state, synthesis: { status: "running", model: e.model, output: "" } };
    case "synthesis.delta":
      return { ...state, synthesis: { ...state.synthesis, output: state.synthesis.output + e.text } };
    case "synthesis.completed":
      return { ...state, synthesis: { status: "done", model: e.model, output: e.output, metrics: e.metrics } };
    case "synthesis.failed":
      return { ...state, synthesis: { ...state.synthesis, status: "failed", problem: e.problem } };
    case "comparison.completed":
      // A synthesis that never started (fewer than two answers) is simply skipped.
      return {
        ...state,
        status: e.status,
        synthesis: state.synthesis.status === "pending" ? { ...state.synthesis, status: "off" } : state.synthesis,
      };
  }
}

/** A saved comparison as GET /api/compare/:id returns it (dates as strings). */
export interface SavedComparison {
  id: string;
  prompt: string;
  systemPrompt: string | null;
  models: string[];
  taskType: string;
  priority: { quality: number; cost: number; speed: number } | null;
  status: RunStatus;
  createdAt: string;
  synthesis: string | null;
  synthesisModel: string | null;
  results: {
    model: string;
    status: "SUCCEEDED" | "FAILED";
    output: string;
    settings: Record<string, unknown> | null;
    rating: number | null;
    problem: Problem | null;
    latencyMs: number;
    ttftMs: number | null;
    outputTokensPerSec: number | null;
    reasoned: boolean | null;
    inputTokens: number;
    outputTokens: number;
    tokensEstimated: boolean;
    costUsd: number | null;
    attempts: number;
    maxTokensRaisedTo: number | null;
  }[];
  judgement: {
    judgeModel: string;
    selfJudged: boolean;
    winnerModel: string | null;
    rationale: string;
    scores: JudgeVerdict["scores"];
    latencyMs: number;
    costUsd: number | null;
    orders: number;
    positionConsistent: boolean | null;
  } | null;
  vote: { preferredModel: string | null } | null;
}

/**
 * Rebuilds the results view from a saved comparison, so an old run looks the
 * same as when it streamed. Models that never finished (the tab was closed
 * mid-run) show as failed with no answer.
 */
export function restoreCompareState(c: SavedComparison): CompareState {
  const byModel = new Map(c.results.map((r) => [r.model, r]));
  const panels = Object.fromEntries(
    c.models.map((model): [string, ModelPanel] => {
      const r = byModel.get(model);
      if (!r) {
        // Still running in the background (the tab was closed or refreshed): show it as in progress.
        if (c.status === "RUNNING" || c.status === "QUEUED") return [model, { model, status: "pending", output: "", note: "running on the server" }];
        return [model, { model, status: "failed", output: "", problem: { type: "about:blank", title: "No result saved", status: 0 } }];
      }
      const metrics: CallMetrics = {
        latencyMs: r.latencyMs,
        ttftMs: r.ttftMs ?? undefined,
        outputTokensPerSec: r.outputTokensPerSec ?? undefined,
        reasoned: r.reasoned ?? undefined,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        tokensEstimated: r.tokensEstimated,
        costUsd: r.costUsd,
        attempts: r.attempts,
        ...(r.maxTokensRaisedTo ? { maxTokensRaisedTo: r.maxTokensRaisedTo } : {}),
      };
      // A failed call has no real metrics (the row stores zeros), so it must not show up in charts or "best" picks.
      return [model, r.status === "SUCCEEDED" ? { model, status: "done", output: r.output, metrics } : { model, status: "failed", output: r.output, problem: r.problem ?? undefined }];
    }),
  );
  const j = c.judgement;
  return {
    comparisonId: c.id,
    status: c.status,
    order: c.models,
    panels,
    judge: j
      ? {
          status: "done",
          model: j.judgeModel,
          verdict: {
            judgeModel: j.judgeModel,
            selfJudged: j.selfJudged,
            winnerModel: j.winnerModel,
            rationale: j.rationale,
            scores: j.scores,
            orders: j.orders,
            positionConsistent: j.positionConsistent,
            // Only latency and cost are stored for the judge call.
            metrics: { latencyMs: j.latencyMs, inputTokens: 0, outputTokens: 0, tokensEstimated: true, costUsd: j.costUsd, attempts: 1 },
          },
        }
      : { status: "off" },
    synthesis: c.synthesis ? { status: "done", model: c.synthesisModel ?? undefined, output: c.synthesis } : { status: "off", output: "" },
  };
}
