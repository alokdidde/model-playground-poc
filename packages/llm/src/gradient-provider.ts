import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import { parseRateLimitHeaders } from "@fomo/ratelimit";
import type { ModelInfo } from "@fomo/shared";
import { describeModel } from "./catalog";
import { parseRetryAfter, UpstreamError } from "./errors";
import type { ChatProvider, ChatRequest, ChatResult, ResponseMeta, StreamChunk } from "./types";

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
  private modelsRefresh?: Promise<ModelInfo[]>;

  constructor(private readonly config: GradientConfig) {
    this.client = new OpenAI({ baseURL: config.baseUrl, apiKey: config.apiKey, maxRetries: 0 });
  }

  /**
   * The catalog, cached. Every compare validates its models against it, so it
   * must not cost a provider round trip on the hot path: after the first load,
   * a stale list (older than 5 minutes) is returned at once and refreshed in
   * the background. Only the very first call waits for the provider.
   */
  async listModels(): Promise<ModelInfo[]> {
    const cached = this.modelsCache;
    if (cached) {
      if (Date.now() - cached.at >= 5 * 60_000) void this.refreshModels().catch(() => undefined);
      return cached.models;
    }
    return this.refreshModels();
  }

  /** One provider call at a time, however many requests want a fresh list. */
  private refreshModels(): Promise<ModelInfo[]> {
    this.modelsRefresh ??= this.client.models
      .list()
      .then((page) => {
        const models = page.data.map((m) => describeModel(m.id)).sort((a, b) => a.label.localeCompare(b.label));
        this.modelsCache = { at: Date.now(), models };
        return models;
      })
      .catch((error: unknown) => {
        throw toUpstreamError(error);
      })
      .finally(() => {
        this.modelsRefresh = undefined;
      });
    return this.modelsRefresh;
  }

  async complete(request: ChatRequest, signal: AbortSignal): Promise<ChatResult> {
    try {
      // withResponse() exposes the HTTP headers, where DO reports rate limits.
      const { data: response, response: raw } = await this.client.chat.completions
        .create(
          {
            model: request.model,
            messages: request.messages,
            ...samplingParams(request),
          },
          { signal },
        )
        .withResponse();
      const choice = response.choices[0];
      if (!choice?.message?.content?.trim() && choice?.finish_reason === "length") {
        throw new UpstreamError(
          "token_budget",
          `Used all ${request.maxTokens} max tokens on reasoning before writing an answer. Raise max tokens or lower the reasoning level.`,
        );
      }
      return {
        rateLimits: parseRateLimitHeaders((name) => raw.headers.get(name)),
        meta: responseMeta((name) => raw.headers.get(name)),
        text: choice?.message?.content ?? "",
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
      const { data: stream, response: raw } = await this.client.chat.completions
        .create(
          {
            model: request.model,
            messages: request.messages,
            ...samplingParams(request),
            stream: true,
            ...(this.config.streamUsage ? { stream_options: { include_usage: true } } : {}),
          },
          { signal },
        )
        .withResponse();
      const limits = parseRateLimitHeaders((name) => raw.headers.get(name));
      if (limits) yield { type: "limits", limits };
      yield { type: "meta", meta: responseMeta((name) => raw.headers.get(name)) };
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

function responseMeta(get: (name: string) => string | null): ResponseMeta {
  const upstream = Number(get("do-upstream-service-time"));
  return {
    requestId: get("x-request-id") ?? get("request-id") ?? undefined,
    upstreamMs: Number.isFinite(upstream) && get("do-upstream-service-time") ? upstream : undefined,
  };
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
    const header = (name: string) => error.headers?.get(name);
    const retryAfterMs = error.headers ? parseRetryAfter(header) : undefined;
    const rateLimits = error.headers ? parseRateLimitHeaders(header) : undefined;
    return UpstreamError.fromStatus(error.status, error.message, retryAfterMs, error, rateLimits, error.headers ? header("x-request-id") ?? undefined : undefined);
  }
  return error;
}
