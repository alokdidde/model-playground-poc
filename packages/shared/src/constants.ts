/** Hard limits that keep a single request bounded in cost and time. */
export const LIMITS = {
  /**
   * Enough for every chat model DO offers today (18 on our plan), still bounded
   * so one request can't fan out without limit. Judge labels run A-Z, so keep <= 26.
   */
  maxModelsPerCompare: 24,
  maxPromptChars: 20_000,
  maxSystemPromptChars: 4_000,
  maxOutputTokens: 4_096,
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
