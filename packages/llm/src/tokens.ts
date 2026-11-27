import type { ChatRequest } from "./types";

/**
 * Rough token estimate (~4 characters per token for English text). We only
 * use it for two things, both of which tolerate error:
 *  - reserving budget in the rate limiter before a call (reconciled after),
 *  - filling in usage when a provider does not report it (flagged as estimated).
 * TokenCalibration (below) corrects it per model from the usage the provider reports.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateInputTokens(request: ChatRequest): number {
  // +4 per message for role/formatting overhead.
  return request.messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

/** What we reserve up front: the prompt plus the worst-case completion. */
export function reservationFor(request: ChatRequest, ratio = 1): number {
  return Math.ceil(estimateInputTokens(request) * ratio) + request.maxTokens;
}

/**
 * Learns, per model, how far "4 characters per token" is from the provider's
 * real count (tokenizers differ: code, non-English text and some model
 * families use more tokens per character). Each reported usage nudges a
 * moving average of actual / estimated input tokens, which then scales the
 * next estimates. No tokenizer dependency per model family, and it adapts if
 * a provider changes tokenizer. Kept per process: a new instance relearns in
 * a few calls, and until then the old estimate (plus the refund on release)
 * applies.
 */
export class TokenCalibration {
  private readonly ratios = new Map<string, number>();

  /** actual / estimated for this model; 1 until we have seen usage. */
  ratio(model: string): number {
    return this.ratios.get(model) ?? 1;
  }

  observe(model: string, estimatedTokens: number, actualTokens: number): void {
    // Tiny prompts are dominated by fixed overhead (chat template), so they would skew the ratio.
    if (estimatedTokens < 20 || actualTokens <= 0) return;
    const sample = Math.min(MAX_RATIO, Math.max(MIN_RATIO, actualTokens / estimatedTokens));
    const previous = this.ratios.get(model);
    this.ratios.set(model, previous === undefined ? sample : previous * (1 - SMOOTHING) + sample * SMOOTHING);
  }
}

/** Weight of each new sample in the moving average. */
const SMOOTHING = 0.2;
/** One odd response must not make us reserve 10x or 0x. */
const MIN_RATIO = 0.5;
const MAX_RATIO = 3;
