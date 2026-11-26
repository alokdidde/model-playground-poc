import type { ModelInfo } from "@fomo/shared";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult {
  text: string;
  /** Undefined when the provider did not report usage. */
  usage?: Usage;
}

export type StreamChunk = { type: "delta"; text: string } | { type: "usage"; usage: Usage };

/**
 * The only thing the rest of the code knows about a model provider.
 * Implementations: GradientProvider (real) and MockProvider (local dev, tests).
 * Implementations must throw UpstreamError for provider failures.
 */
export interface ChatProvider {
  readonly name: string;
  listModels(): Promise<ModelInfo[]>;
  complete(request: ChatRequest, signal: AbortSignal): Promise<ChatResult>;
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<StreamChunk>;
}
