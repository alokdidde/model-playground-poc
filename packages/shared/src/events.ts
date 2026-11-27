import type { CallMetrics, JudgeVerdict, RunStatus } from "./schemas";
import type { Problem } from "./problem";

/**
 * Server-sent events emitted by POST /api/compare.
 *
 * The stream is a sequence of `event: <type>\ndata: <json>\n\n` frames. Every
 * model gets exactly one terminal event (`model.completed` or `model.failed`),
 * so the client can render partial results: one model failing never hides the
 * others.
 */
export type CompareEvent =
  | { type: "comparison.started"; comparisonId: string; models: string[]; judgeModel: string | null }
  | { type: "model.delta"; model: string; text: string }
  | { type: "model.retrying"; model: string; attempt: number; delayMs: number; reason: string }
  | { type: "model.waiting"; model: string; waitMs: number; reason: string }
  | { type: "model.completed"; model: string; output: string; metrics: CallMetrics }
  | { type: "model.failed"; model: string; problem: Problem; partialOutput: string }
  | { type: "judge.started"; judgeModel: string }
  | { type: "judge.completed"; verdict: JudgeVerdict }
  | { type: "judge.failed"; problem: Problem }
  | { type: "synthesis.started"; model: string }
  | { type: "synthesis.delta"; text: string }
  | { type: "synthesis.completed"; model: string; output: string; metrics: CallMetrics }
  | { type: "synthesis.failed"; problem: Problem }
  | { type: "comparison.completed"; comparisonId: string; status: RunStatus };

export type CompareEventType = CompareEvent["type"];
