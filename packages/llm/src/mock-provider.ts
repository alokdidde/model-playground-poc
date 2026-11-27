import type { ModelInfo } from "@fomo/shared";
import { sleep } from "@fomo/ratelimit";
import { KNOWN_MODELS } from "./catalog";
import { UpstreamError } from "./errors";
import { JUDGE_SYSTEM_PROMPT } from "./judge";
import { estimateInputTokens, estimateTokens } from "./tokens";
import type { ChatProvider, ChatRequest, ChatResult, StreamChunk } from "./types";

export interface MockConfig {
  /** Fraction of calls that fail up front with 429 + Retry-After. */
  rateLimitRate: number;
  /** Fraction of calls that fail with a 500 part-way through the stream. */
  errorRate: number;
  /** Multiplies all delays; 0 makes tests instant. */
  speed: number;
  random: () => number;
}

const STYLES = [
  (p: string) => `Here's a concise answer to "${p}". The key idea is to break the problem into small, testable parts, handle the edge cases explicitly, and verify the result against a simple example before generalising.`,
  (p: string) => `Great question! Let me walk through "${p}" step by step.\n\n1. First, clarify the goal and constraints.\n2. Next, consider two or three candidate approaches.\n3. Then pick the simplest one that meets the constraints.\n4. Finally, check it with a worked example.\n\nIn short: start simple, measure, then iterate.`,
  (p: string) => `Short version: it depends on your constraints. For "${p}", I would favour the boring, well-understood option first. If latency matters more than cost, choose the faster model; if accuracy matters most, choose the larger one and add a verification step.`,
  (p: string) => `**Answer**\n\nRegarding "${p}": there are trade-offs between speed, cost and quality. A good default is a mid-sized model with a clear system prompt. Larger models help with multi-step reasoning, while smaller ones are often enough for extraction and classification.`,
];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Canned, delayed responses so the whole app runs locally without an access
 * key or spending tokens. Each model gets its own "personality" and speed,
 * and failures can be injected to exercise retries and partial results.
 */
export class MockProvider implements ChatProvider {
  readonly name = "mock";

  constructor(private readonly config: MockConfig) {}

  async listModels(): Promise<ModelInfo[]> {
    return KNOWN_MODELS;
  }

  async complete(request: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
    let text = "";
    let usage: ChatResult["usage"];
    for await (const chunk of this.stream(request, signal)) {
      if (chunk.type === "delta") text += chunk.text;
      else if (chunk.type === "usage") usage = chunk.usage;
    }
    return { text, usage };
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<StreamChunk> {
    const { random, speed } = this.config;
    const seed = hash(request.model);
    const msPerToken = (15 + (seed % 5) * 12) * speed; // some models are just faster
    await sleep((150 + (seed % 7) * 120 + random() * 300) * speed, signal); // time to first token

    if (random() < this.config.rateLimitRate) {
      throw UpstreamError.fromStatus(429, "Mock: too many requests", 1_000 * Math.max(speed, 0.01));
    }

    const isJudge = request.messages[0]?.content === JUDGE_SYSTEM_PROMPT;
    const text = isJudge ? this.judgeAnswer(request) : this.answer(request, seed);
    const words = text.split(/(?<=\s)/);
    const failAt = random() < this.config.errorRate && !isJudge ? Math.floor(words.length / 3) : -1;

    for (let i = 0; i < words.length; i++) {
      if (i === failAt) throw UpstreamError.fromStatus(500, "Mock: upstream connection reset");
      await sleep(msPerToken, signal);
      yield { type: "delta", text: words[i]! };
    }
    yield { type: "usage", usage: { inputTokens: estimateInputTokens(request), outputTokens: estimateTokens(text) } };
  }

  private answer(request: ChatRequest, seed: number): string {
    const prompt = request.messages.at(-1)?.content.slice(0, 120) ?? "";
    const style = STYLES[seed % STYLES.length]!;
    return style(prompt.replace(/\s+/g, " ").trim());
  }

  /** Scores every "Response X" label in the judge prompt with plausible numbers. */
  private judgeAnswer(request: ChatRequest): string {
    const userPrompt = request.messages.at(-1)?.content ?? "";
    const labels = [...userPrompt.matchAll(/^### Response ([A-Z])$/gm)].map((m) => m[1]!);
    const scores = labels.map((label) => {
      const base = 5 + Math.floor(this.config.random() * 5);
      return { label, accuracy: base, helpfulness: Math.min(10, base + 1), clarity: base, overall: base };
    });
    const winner = [...scores].sort((a, b) => b.overall - a.overall)[0];
    return JSON.stringify({
      scores,
      winner: winner?.label ?? null,
      rationale: winner
        ? `Response ${winner.label} was the most complete and directly answered the question; the others were vaguer or less structured. (Mock judge.)`
        : "No responses to compare.",
    });
  }
}
