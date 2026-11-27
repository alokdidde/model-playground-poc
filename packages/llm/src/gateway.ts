import type { CallMetrics } from "@fomo/shared";
import {
  delayHonoringRetryAfter,
  RateLimitExceededError,
  sleep,
  type Lane,
  type Lease,
  type ObservedLimits,
  type RateLimiter,
} from "@fomo/ratelimit";
import { estimateCostUsd } from "./catalog";
import { StreamInterruptedError, UpstreamError } from "./errors";
import { estimateInputTokens, estimateTokens, reservationFor } from "./tokens";
import type { ChatProvider, ChatRequest, Usage } from "./types";

export interface CallOptions {
  /** Cancels everything (e.g. the browser disconnected). Never retried. */
  signal?: AbortSignal;
  /** Total time allowed for one attempt. */
  attemptTimeoutMs?: number;
  /** Streaming only: fail the attempt if no token arrives in this time. */
  firstTokenTimeoutMs?: number;
  maxAttempts?: number;
  /** How long we are willing to wait for rate-limit capacity before each attempt. */
  maxQueueWaitMs?: number;
  /** "interactive" (a person is watching; default) or "batch" (yields capacity to interactive). */
  lane?: Lane;
  /**
   * Streaming only: retry a stream that failed part-way, discarding its text.
   * Safe when nobody has seen the text yet (the batch worker); the compare
   * view leaves this off, since retrying would duplicate text on screen.
   */
  restartInterruptedStreams?: boolean;
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
  onWait?: (info: { waitMs: number; reason: string }) => void;
}

export interface CallResult {
  output: string;
  metrics: CallMetrics;
}

/** On a "token_budget" failure, retry once with max_tokens times this, up to MAX_RAISED_TOKENS. */
const TOKEN_BUDGET_GROWTH = 4;
const MAX_RAISED_TOKENS = 8_192;

const DEFAULTS = {
  attemptTimeoutMs: 60_000,
  firstTokenTimeoutMs: 20_000,
  maxAttempts: 3,
  maxQueueWaitMs: 15_000,
} satisfies Partial<CallOptions>;

/**
 * The single choke point for every model call, from both the web app and
 * the worker. Each attempt:
 *
 *   1. takes a lease from the shared RateLimiter (requests + tokens),
 *   2. calls the provider with a per-attempt timeout,
 *   3. releases the lease with the real token usage.
 *
 * Retryable failures (429, 5xx, timeouts, network) are retried with
 * exponential backoff and full jitter, honouring Retry-After. A 429 also
 * puts the bucket into a shared cooldown so other instances back off too.
 *
 * Streams are only retried if nothing has been sent to the user yet;
 * otherwise we would duplicate text on screen.
 */
export class ModelGateway {
  constructor(
    readonly provider: ChatProvider,
    readonly limiter: RateLimiter,
  ) {}

  /** Non-streaming call (used by the judge and the batch worker). */
  complete(request: ChatRequest, options: CallOptions = {}): Promise<CallResult> {
    return this.run(request, options, async (attemptRequest, signal) => {
      const result = await this.provider.complete(attemptRequest, signal);
      if (result.rateLimits) this.observe(request.model, result.rateLimits);
      return { text: result.text, usage: result.usage };
    });
  }

  /** Streaming call: `onDelta` receives text as it arrives. */
  stream(request: ChatRequest, onDelta: (text: string) => void, options: CallOptions = {}): Promise<CallResult> {
    const firstTokenTimeoutMs = options.firstTokenTimeoutMs ?? DEFAULTS.firstTokenTimeoutMs;
    let sentSoFar = "";

    return this.run(request, options, async (attemptRequest, signal, startedAt) => {
      // A separate controller so we can abort if the first token is too slow.
      const firstToken = new AbortController();
      const timer = setTimeout(
        () => firstToken.abort(new UpstreamError("timeout", `No first token within ${firstTokenTimeoutMs}ms`)),
        firstTokenTimeoutMs,
      );
      const combined = AbortSignal.any([signal, firstToken.signal]);

      let text = "";
      let usage: Usage | undefined;
      let ttftMs: number | undefined;
      let firstChunkAt: number | undefined;
      let reasoned = false;
      let finishReason: string | undefined;
      try {
        for await (const chunk of this.provider.stream(attemptRequest, combined)) {
          if (chunk.type === "usage") {
            usage = chunk.usage;
            continue;
          }
          if (chunk.type === "limits") {
            this.observe(request.model, chunk.limits);
            continue;
          }
          if (chunk.type === "finish") {
            finishReason = chunk.reason;
            continue;
          }
          firstChunkAt ??= Date.now();
          if (chunk.type === "thinking") {
            // The model is reasoning: it is alive, so stop the first-token timer,
            // but TTFT still measures the first visible answer token.
            reasoned = true;
            clearTimeout(timer);
            continue;
          }
          if (ttftMs === undefined) {
            ttftMs = Date.now() - startedAt;
            clearTimeout(timer);
          }
          text += chunk.text;
          sentSoFar += chunk.text;
          onDelta(chunk.text);
        }
      } catch (error) {
        let upstream = error;
        if (firstToken.signal.aborted) upstream = firstToken.signal.reason;
        else if (signal.aborted && isTimeout(signal.reason)) upstream = new UpstreamError("timeout", "Model call timed out");
        // Text already reached the user: retrying would duplicate it.
        if (sentSoFar.length > 0 && upstream instanceof UpstreamError && !options.restartInterruptedStreams) {
          throw new StreamInterruptedError(upstream, sentSoFar);
        }
        throw upstream;
      } finally {
        clearTimeout(timer);
      }
      // Some SDK versions end the iterator quietly on abort instead of throwing.
      if (!text && firstToken.signal.aborted) throw firstToken.signal.reason;
      if (!text.trim() && finishReason === "length") {
        // Typical for reasoning models with a small max_tokens: all of it went on thinking.
        throw new UpstreamError(
          "token_budget",
          `Used all ${attemptRequest.maxTokens} max tokens on reasoning before writing an answer. Raise max tokens or lower the reasoning level.`,
        );
      }
      return { text, usage, ttftMs, firstChunkAt, reasoned };
    });
  }

  private async run(
    request: ChatRequest,
    options: CallOptions,
    attemptFn: (attemptRequest: ChatRequest, signal: AbortSignal, startedAt: number) => Promise<AttemptResult>,
  ): Promise<CallResult> {
    const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
    const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULTS.attemptTimeoutMs;
    // Only max_tokens ever changes between attempts (see "token_budget" below).
    let current = request;
    for (let attempt = 1; ; attempt++) {
      const lease = await this.limiter.acquire(request.model, reservationFor(current), {
        signal: options.signal,
        maxWaitMs: options.maxQueueWaitMs ?? DEFAULTS.maxQueueWaitMs,
        onWait: options.onWait,
        lane: options.lane,
      });

      const attemptStartedAt = Date.now();
      const timeout = AbortSignal.timeout(attemptTimeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

      try {
        const { text, usage, ttftMs, firstChunkAt, reasoned } = await attemptFn(current, signal, attemptStartedAt);
        const finishedAt = Date.now();
        const inputTokens = usage?.inputTokens ?? estimateInputTokens(request);
        const outputTokens = usage?.outputTokens ?? estimateTokens(text);
        await this.releaseQuietly(lease, inputTokens + outputTokens);
        return {
          output: text,
          metrics: {
            // Latency of the successful attempt: a fair measure of the model itself,
            // not of our queueing or retries (those show up in `attempts`).
            latencyMs: finishedAt - attemptStartedAt,
            ttftMs,
            outputTokensPerSec: tokensPerSecond(outputTokens, firstChunkAt, finishedAt),
            ...(reasoned ? { reasoned } : {}),
            inputTokens,
            outputTokens,
            tokensEstimated: usage === undefined,
            costUsd: estimateCostUsd(request.model, inputTokens, outputTokens),
            attempts: attempt,
            ...(current.maxTokens !== request.maxTokens ? { maxTokensRaisedTo: current.maxTokens } : {}),
          },
        };
      } catch (rawError) {
        const error =
          timeout.aborted && !options.signal?.aborted && !(rawError instanceof StreamInterruptedError)
            ? timeoutError(attemptTimeoutMs, rawError)
            : rawError;
        await this.releaseQuietly(lease, tokensChargedFor(error, lease));

        if (options.signal?.aborted) throw options.signal.reason ?? error;

        // A reasoning model that thought until it hit max_tokens fails the same way every
        // time, so a plain retry is pointless. One retry with a bigger budget usually works.
        const raised = Math.min(request.maxTokens * TOKEN_BUDGET_GROWTH, MAX_RAISED_TOKENS);
        if (error instanceof UpstreamError && error.kind === "token_budget" && current === request && raised > request.maxTokens && attempt < maxAttempts) {
          current = { ...request, maxTokens: raised };
          options.onRetry?.({ attempt, delayMs: 0, reason: `ran out of tokens while reasoning, retrying with max tokens ${raised}` });
          continue;
        }
        if (!(error instanceof UpstreamError) || !error.retryable || attempt >= maxAttempts) throw error;

        if (error.rateLimits) this.observe(request.model, error.rateLimits);
        if (error.kind === "rate_limited") {
          // Tell every instance to back off, not just this one.
          await this.limiter.coolDown(request.model, error.retryAfterMs ?? 1_000).catch(() => undefined);
        }
        const delayMs = delayHonoringRetryAfter(attempt, error.retryAfterMs);
        options.onRetry?.({ attempt, delayMs, reason: error.message });
        await sleep(delayMs, options.signal);
      }
    }
  }

  /** Learns the provider's real limits from its headers. Fire and forget: never slows or fails a call. */
  private observe(model: string, limits: ObservedLimits): void {
    this.limiter.observe(model, limits).catch((error: unknown) => console.warn("[gateway] could not record rate limits", error));
  }

  /** A lease store hiccup must not turn a successful model call into a failure. */
  private async releaseQuietly(lease: Lease, tokens: number): Promise<void> {
    try {
      await this.limiter.release(lease, tokens);
    } catch (error) {
      console.warn("[gateway] failed to release lease; it will expire on its own", error);
    }
  }
}

interface AttemptResult {
  text: string;
  usage?: Usage;
  ttftMs?: number;
  /** When the first chunk of any kind arrived (streaming only). */
  firstChunkAt?: number;
  reasoned?: boolean;
}

/**
 * Decode speed, measured from the first streamed chunk so it excludes queueing
 * and time to first token. Undefined for non-streaming calls and for windows
 * too short to measure (a one-chunk answer).
 */
export function tokensPerSecond(outputTokens: number, firstChunkAt: number | undefined, finishedAt: number): number | undefined {
  if (firstChunkAt === undefined || outputTokens <= 1) return undefined;
  const ms = finishedAt - firstChunkAt;
  if (ms < 100) return undefined;
  return Math.round((outputTokens / (ms / 1000)) * 10) / 10;
}

function isTimeout(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "TimeoutError";
}

function timeoutError(ms: number, cause: unknown): UpstreamError {
  return cause instanceof UpstreamError && cause.kind === "timeout"
    ? cause
    : new UpstreamError("timeout", `Model call exceeded ${ms}ms`, { cause });
}

/**
 * How many tokens a failed attempt probably consumed. A 429 or 4xx was
 * rejected before generation (0). For timeouts and 5xx we cannot know, so we
 * keep the reservation: over-counting is safe, under-counting causes 429s.
 */
function tokensChargedFor(error: unknown, lease: Lease): number {
  if (error instanceof UpstreamError && (error.kind === "rate_limited" || error.kind === "client")) return 0;
  return lease.tokensReserved;
}

export { RateLimitExceededError };
