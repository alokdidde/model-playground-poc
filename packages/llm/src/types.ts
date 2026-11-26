import type { ModelInfo, ReasoningEffort } from "@fomo/shared";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** Left out for models that reject it (the provider default applies). */
  temperature?: number;
  topP?: number;
  reasoningEffort?: ReasoningEffort;
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

export type StreamChunk =
  | { type: "delta"; text: string }
  /** Hidden reasoning is being produced: no answer text yet, but the model is alive. */
  | { type: "thinking" }
  | { type: "usage"; usage: Usage }
  /** Why generation stopped, e.g. "stop" or "length" (ran out of max tokens). */
  | { type: "finish"; reason: string };

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
