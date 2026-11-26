/**
 * Names shared between the web app (which enqueues work) and the worker
 * (which registers and runs it). DBOS resolves queued workflows by name, so
 * both sides must agree on these strings.
 */
export const QUEUES = {
  /** One entry per eval run. Low concurrency: a run fans out on its own. */
  evalRuns: "eval-runs",
  /** One entry per prompt in a run (calls every model, then the judge). */
  evalPrompts: "eval-prompts",
  /** One entry per (prompt, model) call. This is where flow control matters. */
  modelCalls: "model-calls",
} as const;

export const WORKFLOWS = {
  evalRun: "evalRunWorkflow",
  evalPrompt: "evalPromptWorkflow",
  modelCall: "modelCallWorkflow",
} as const;

/** Hard limits that keep a single request bounded in cost and time. */
export const LIMITS = {
  maxModelsPerCompare: 6,
  maxPromptChars: 20_000,
  maxSystemPromptChars: 4_000,
  maxOutputTokens: 4_096,
  maxEvalPrompts: 200,
} as const;
