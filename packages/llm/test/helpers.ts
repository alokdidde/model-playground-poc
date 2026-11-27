import { MemoryLeaseStore, RateLimiter, type RateEventSink } from "@fomo/ratelimit";
import type { ModelInfo } from "@fomo/shared";
import type { ChatProvider, ChatRequest, ChatResult, StreamChunk } from "../src/types";

/** A provider whose behaviour per attempt is scripted by the test. */
export class ScriptedProvider implements ChatProvider {
  readonly name = "scripted";
  calls = 0;
  /** max_tokens of each attempt, to check budget changes. */
  maxTokens: number[] = [];
  constructor(private readonly script: (() => AsyncGenerator<StreamChunk>)[]) {}

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(request?: ChatRequest): Promise<ChatResult> {
    let text = "";
    let usage: ChatResult["usage"];
    for await (const c of this.stream(request)) {
      if (c.type === "delta") text += c.text;
      else if (c.type === "usage") usage = c.usage;
    }
    return { text, usage };
  }

  stream(request?: ChatRequest): AsyncIterable<StreamChunk> {
    if (request) this.maxTokens.push(request.maxTokens);
    const step = this.script[Math.min(this.calls, this.script.length - 1)]!;
    this.calls++;
    return step();
  }
}

export function limiter(events?: RateEventSink) {
  return new RateLimiter(
    new MemoryLeaseStore(),
    { requestsPerWindow: 1_000, tokensPerWindow: 10_000_000, maxInFlight: 100, windowMs: 60_000, leaseTtlMs: 60_000 },
    "model",
    "default",
    events,
  );
}

export const request: ChatRequest = {
  model: "m",
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 32,
  temperature: 0,
};
