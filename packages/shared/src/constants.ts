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

/**
 * What kind of task the prompt is. It changes two things: the judge gets a
 * task-specific focus (what "good" means for this kind of prompt), and the UI
 * picks a sensible default priority (e.g. extraction leans on cost).
 */
export const TASK_TYPES = {
  general: { label: "General", judgeFocus: "" },
  coding: {
    label: "Coding",
    judgeFocus: "Weigh correctness of the code most: would it run, does it handle edge cases, does it use real APIs? Penalise invented functions or libraries.",
  },
  reasoning: {
    label: "Reasoning & math",
    judgeFocus: "Weigh whether the final answer is correct and the steps are sound. A wrong final answer caps overall at 3, however well written.",
  },
  writing: {
    label: "Writing",
    judgeFocus: "Weigh tone, fit to the audience, and following the requested format and length. Originality matters; filler does not.",
  },
  summarization: {
    label: "Summarize",
    judgeFocus: "Weigh faithfulness to the source (no added facts), coverage of the key points, and brevity.",
  },
  extraction: {
    label: "Extraction / JSON",
    judgeFocus: "Weigh exact adherence to the requested output format, no extra text, and every field being correct.",
  },
  chat: {
    label: "Support / chat",
    judgeFocus: "Weigh being helpful, polite, concise and safe, as a customer-facing assistant would need to be.",
  },
} as const;

export type TaskType = keyof typeof TASK_TYPES;
export const TASK_TYPE_IDS = Object.keys(TASK_TYPES) as [TaskType, ...TaskType[]];
