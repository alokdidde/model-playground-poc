/** Hard limits that keep a single request bounded in cost and time. */
export const LIMITS = {
  maxPromptChars: 20_000,
  maxSystemPromptChars: 4_000,
  maxOutputTokens: 4_096,
} as const;
