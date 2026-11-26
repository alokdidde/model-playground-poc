import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import type { ModelInfo } from "@fomo/shared";
import { describeModel } from "./catalog";
import { parseRetryAfter, UpstreamError } from "./errors";
import type { ChatProvider, ChatRequest, ChatResult, StreamChunk } from "./types";

export interface GradientConfig {
  baseUrl: string;
  apiKey: string;
  /** Ask for token usage in the final stream chunk (OpenAI's stream_options.include_usage). */
  streamUsage: boolean;
}

/**
 * DigitalOcean serverless inference. It speaks the OpenAI Chat Completions
 * protocol, so we use the official OpenAI SDK pointed at DO's base URL.
 *
 * The SDK's own retries are turned off (maxRetries: 0): retries, backoff and
 * rate limiting live in ModelGateway, where they also coordinate with the
 * shared lease store. Two retry layers would multiply attempts.
 */
export class GradientProvider implements ChatProvider {
  readonly name = "gradient";
  private readonly client: OpenAI;
  private modelsCache?: { at: number; models: ModelInfo[] };

  constructor(private readonly config: GradientConfig) {
    this.client = new OpenAI({ baseURL: config.baseUrl, apiKey: config.apiKey, maxRetries: 0 });
  }

  async listModels(): Promise<ModelInfo[]> {
    if (this.modelsCache && Date.now() - this.modelsCache.at < 5 * 60_000) return this.modelsCache.models;
    try {
      const page = await this.client.models.list();
      const models = page.data.map((m) => describeModel(m.id)).sort((a, b) => a.label.localeCompare(b.label));
      this.modelsCache = { at: Date.now(), models };
      return models;
    } catch (error) {
      throw toUpstreamError(error);
    }
  }

  async complete(request: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
    try {
      const response = await this.client.chat.completions.create(
        {
          model: request.model,
          messages: request.messages,
          ...samplingParams(request),
        },
        { signal },
      );
      return {
        text: response.choices[0]?.message?.content ?? "",
        usage: response.usage
          ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens }
          : undefined,
      };
    } catch (error) {
      throw toUpstreamError(error);
    }
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<StreamChunk> {
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: request.model,
          messages: request.messages,
          ...samplingParams(request),
          stream: true,
          ...(this.config.streamUsage ? { stream_options: { include_usage: true } } : {}),
        },
        { signal },
      );
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const text = choice?.delta?.content;
        if (text) yield { type: "delta", text };
        // Reasoning models stream their thinking in a non-standard field before any answer text.
        else if (hasReasoning(choice?.delta)) yield { type: "thinking" };
        if (choice?.finish_reason) yield { type: "finish", reason: choice.finish_reason };
        if (chunk.usage) {
          yield {
            type: "usage",
            usage: { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens },
          };
        }
      }
    } catch (error) {
      throw toUpstreamError(error);
    }
  }
}

function hasReasoning(delta: unknown): boolean {
  if (!delta || typeof delta !== "object") return false;
  const d = delta as { reasoning_content?: unknown; reasoning?: unknown };
  return Boolean(d.reasoning_content || d.reasoning);
}

/** Maps our request to OpenAI-protocol params, sending only what was set. */
function samplingParams(request: ChatRequest) {
  return {
    max_completion_tokens: request.maxTokens,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.topP !== undefined ? { top_p: request.topP } : {}),
    ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
  };
}

function toUpstreamError(error: unknown): unknown {
  // Caller aborts are not provider failures: let them propagate unchanged.
  if (error instanceof APIUserAbortError) return error;
  if (error instanceof APIConnectionTimeoutError) {
    return new UpstreamError("timeout", "Request to the model timed out", { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new UpstreamError("network", "Could not reach the model provider", { cause: error });
  }
  if (error instanceof APIError && error.status !== undefined) {
    const retryAfterMs = error.headers ? parseRetryAfter((name) => error.headers?.get(name)) : undefined;
    return UpstreamError.fromStatus(error.status, error.message, retryAfterMs, error);
  }
  return error;
}
