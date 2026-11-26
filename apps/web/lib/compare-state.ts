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
  error?: Problem;
}

export const initialCompareState: CompareState = { status: "idle", panels: {}, order: [], judge: { status: "off" } };

export type CompareAction =
  | { type: "start"; models: string[]; judge: boolean }
  | { type: "event"; event: CompareEvent }
  | { type: "error"; problem: Problem };

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
    };
  }
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
    case "comparison.completed":
      return { ...state, status: e.status };
  }
}
