import { MemoryLeaseStore, RateLimiter } from "@fomo/ratelimit";
import type { ModelInfo } from "@fomo/shared";
import type { ChatProvider, ChatRequest, ChatResult, StreamChunk } from "../src/types";

/** A provider whose behaviour per attempt is scripted by the test. */
export class ScriptedProvider implements ChatProvider {
  readonly name = "scripted";
  calls = 0;
  constructor(private readonly script: (() => AsyncGenerator<StreamChunk>)[]) {}

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(): Promise<ChatResult> {
    let text = "";
    let usage: ChatResult["usage"];
    for await (const c of this.stream()) {
      if (c.type === "delta") text += c.text;
      else if (c.type === "usage") usage = c.usage;
    }
    return { text, usage };
  }

  stream(): AsyncIterable<StreamChunk> {
    const step = this.script[Math.min(this.calls, this.script.length - 1)]!;
    this.calls++;
    return step();
  }
}

export function limiter() {
  return new RateLimiter(new MemoryLeaseStore(), {
    requestsPerWindow: 1_000,
    tokensPerWindow: 10_000_000,
    maxInFlight: 100,
    windowMs: 60_000,
    leaseTtlMs: 60_000,
  });
}

export const request: ChatRequest = {
  model: "m",
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 32,
  temperature: 0,
};
