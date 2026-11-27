import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";
import type { ChatRequest } from "./types";

/**
 * Token counts before a call, used for two things that tolerate some error:
 *  - reserving budget in the rate limiter (reconciled with real usage after),
 *  - filling in usage when a provider does not report it (flagged as estimated).
 *
 * We count with OpenAI's o200k tokenizer (tiktoken). It is exact for gpt-oss
 * and close for the other families, and unlike "4 characters per token" it
 * sees that code and non-English text use more tokens per character.
 * Each family's own tokenizer still differs, so TokenCalibration (below)
 * learns a per-model correction from the usage the provider reports.
 */
let encoder: Tiktoken | undefined;

export function estimateTokens(text: string): number {
  // Built on first use: loading the ranks takes ~100 ms, so not at import time.
  encoder ??= new Tiktoken(o200kBase);
  return encoder.encode(text).length;
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
 * Learns, per model, how far the o200k count is from the provider's real
 * count (each model family has its own tokenizer and chat template). Each reported usage nudges a
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
