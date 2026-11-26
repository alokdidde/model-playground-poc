import type { ChatRequest } from "./types";

/**
 * Rough token estimate (~4 characters per token for English text). We only
 * use it for two things, both of which tolerate error:
 *  - reserving budget in the rate limiter before a call (reconciled after),
 *  - filling in usage when a provider does not report it (flagged as estimated).
 * A real tokenizer per model family is a roadmap item.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateInputTokens(request: ChatRequest): number {
  // +4 per message for role/formatting overhead.
  return request.messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

/** What we reserve up front: the prompt plus the worst-case completion. */
export function reservationFor(request: ChatRequest): number {
  return estimateInputTokens(request) + request.maxTokens;
}
