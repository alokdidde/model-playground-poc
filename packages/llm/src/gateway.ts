import type { CallMetrics } from "@fomo/shared";
import { delayHonoringRetryAfter, RateLimitExceededError, sleep, type RateLimiter, type Lease } from "@fomo/ratelimit";
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
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
  onWait?: (info: { waitMs: number; reason: string }) => void;
}

export interface CallResult {
  output: string;
  metrics: CallMetrics;
}

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
    return this.run(request, options, async (signal) => {
      const result = await this.provider.complete(request, signal);
      return { text: result.text, usage: result.usage, ttftMs: undefined };
    });
  }

  /** Streaming call: `onDelta` receives text as it arrives. */
  stream(request: ChatRequest, onDelta: (text: string) => void, options: CallOptions = {}): Promise<CallResult> {
    const firstTokenTimeoutMs = options.firstTokenTimeoutMs ?? DEFAULTS.firstTokenTimeoutMs;
    let sentSoFar = "";

    return this.run(request, options, async (signal, startedAt) => {
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
      let finishReason: string | undefined;
      try {
        for await (const chunk of this.provider.stream(request, combined)) {
          if (chunk.type === "usage") {
            usage = chunk.usage;
            continue;
          }
          if (chunk.type === "finish") {
            finishReason = chunk.reason;
            continue;
          }
          if (chunk.type === "thinking") {
            // The model is reasoning: it is alive, so stop the first-token timer,
            // but TTFT still measures the first visible answer token.
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
        if (sentSoFar.length > 0 && upstream instanceof UpstreamError) {
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
          "bad_output",
          `Used all ${request.maxTokens} max tokens on reasoning before writing an answer. Raise max tokens or lower the reasoning level.`,
        );
      }
      return { text, usage, ttftMs };
    });
  }

  private async run(
    request: ChatRequest,
    options: CallOptions,
    attemptFn: (signal: AbortSignal, startedAt: number) => Promise<{ text: string; usage?: Usage; ttftMs?: number }>,
  ): Promise<CallResult> {
    const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
    const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULTS.attemptTimeoutMs;
    for (let attempt = 1; ; attempt++) {
      const lease = await this.limiter.acquire(request.model, reservationFor(request), {
        signal: options.signal,
        maxWaitMs: options.maxQueueWaitMs ?? DEFAULTS.maxQueueWaitMs,
        onWait: options.onWait,
      });

      const attemptStartedAt = Date.now();
      const timeout = AbortSignal.timeout(attemptTimeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

      try {
        const { text, usage, ttftMs } = await attemptFn(signal, attemptStartedAt);
        const inputTokens = usage?.inputTokens ?? estimateInputTokens(request);
        const outputTokens = usage?.outputTokens ?? estimateTokens(text);
        await this.releaseQuietly(lease, inputTokens + outputTokens);
        return {
          output: text,
          metrics: {
            // Latency of the successful attempt: a fair measure of the model itself,
            // not of our queueing or retries (those show up in `attempts`).
            latencyMs: Date.now() - attemptStartedAt,
            ttftMs,
            inputTokens,
            outputTokens,
            tokensEstimated: usage === undefined,
            costUsd: estimateCostUsd(request.model, inputTokens, outputTokens),
            attempts: attempt,
          },
        };
      } catch (rawError) {
        const error =
          timeout.aborted && !options.signal?.aborted && !(rawError instanceof StreamInterruptedError)
            ? timeoutError(attemptTimeoutMs, rawError)
            : rawError;
        await this.releaseQuietly(lease, tokensChargedFor(error, lease));

        if (options.signal?.aborted) throw options.signal.reason ?? error;
        if (!(error instanceof UpstreamError) || !error.retryable || attempt >= maxAttempts) throw error;

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

  /** A lease store hiccup must not turn a successful model call into a failure. */
  private async releaseQuietly(lease: Lease, tokens: number): Promise<void> {
    try {
      await this.limiter.release(lease, tokens);
    } catch (error) {
      console.warn("[gateway] failed to release lease; it will expire on its own", error);
    }
  }
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
