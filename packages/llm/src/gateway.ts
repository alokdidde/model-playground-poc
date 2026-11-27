import type { CallMetrics } from "@fomo/shared";
import {
  RateLimitExceededError,
  retryDelay,
  sleep,
  type Lease,
  type ObservedLimits,
  type RateLimiter,
} from "@fomo/ratelimit";
import { estimateCostUsd } from "./catalog";
import { StreamInterruptedError, UpstreamError } from "./errors";
import { estimateInputTokens, estimateTokens, reservationFor } from "./tokens";
import type { ChatProvider, ChatRequest, ResponseMeta, Usage } from "./types";

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
  /** Correlation id for rate events (a comparison id). */
  tag?: string;
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
 * The single choke point for every model call. Each attempt:
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

  /** Non-streaming call (used by the judge). */
  complete(request: ChatRequest, options: CallOptions = {}): Promise<CallResult> {
    return this.run(request, options, async (attemptRequest, signal) => {
      const result = await this.provider.complete(attemptRequest, signal);
      if (result.rateLimits) this.observe(request.model, result.rateLimits, options.tag);
      return { text: result.text, usage: result.usage, meta: result.meta };
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
      let meta: ResponseMeta | undefined;
      try {
        for await (const chunk of this.provider.stream(attemptRequest, combined)) {
          if (chunk.type === "usage") {
            usage = chunk.usage;
            continue;
          }
          if (chunk.type === "limits") {
            this.observe(request.model, chunk.limits, options.tag);
            continue;
          }
          if (chunk.type === "meta") {
            meta = chunk.meta;
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
          "token_budget",
          `Used all ${attemptRequest.maxTokens} max tokens on reasoning before writing an answer. Raise max tokens or lower the reasoning level.`,
        );
      }
      return { text, usage, ttftMs, firstChunkAt, reasoned, meta };
    });
  }

  private async run(
    request: ChatRequest,
    options: CallOptions,
    attemptFn: (attemptRequest: ChatRequest, signal: AbortSignal, startedAt: number) => Promise<AttemptResult>,
  ): Promise<CallResult> {
    const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
    const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULTS.attemptTimeoutMs;
    const maxQueueWaitMs = options.maxQueueWaitMs ?? DEFAULTS.maxQueueWaitMs;
    const events = this.limiter.events;
    const ev = { model: request.model, tag: options.tag } as const;
    // Only max_tokens ever changes between attempts (see "token_budget" below).
    let current = request;
    for (let attempt = 1; ; attempt++) {
      const lease = await this.limiter.acquire(request.model, reservationFor(current), {
        signal: options.signal,
        maxWaitMs: maxQueueWaitMs,
        onWait: options.onWait,
        tag: options.tag,
      });

      const attemptStartedAt = Date.now();
      const timeout = AbortSignal.timeout(attemptTimeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

      try {
        const { text, usage, ttftMs, firstChunkAt, reasoned, meta } = await attemptFn(current, signal, attemptStartedAt);
        const finishedAt = Date.now();
        const inputTokens = usage?.inputTokens ?? estimateInputTokens(request);
        const outputTokens = usage?.outputTokens ?? estimateTokens(text);
        events.emit({ ...ev, kind: "attempt_ok", attempt, ms: finishedAt - attemptStartedAt, data: { ttftMs, inputTokens, outputTokens, ...meta } });
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
        events.emit({ ...ev, kind: "attempt_failed", attempt, ms: Date.now() - attemptStartedAt, data: describeFailure(error) });
        await this.releaseQuietly(lease, tokensChargedFor(error, lease));

        if (options.signal?.aborted) throw options.signal.reason ?? error;

        // A reasoning model that thought until it hit max_tokens fails the same way every
        // time, so a plain retry is pointless. One retry with a bigger budget usually works.
        const raised = Math.min(request.maxTokens * TOKEN_BUDGET_GROWTH, MAX_RAISED_TOKENS);
        if (error instanceof UpstreamError && error.kind === "token_budget" && current === request && raised > request.maxTokens && attempt < maxAttempts) {
          current = { ...request, maxTokens: raised };
          events.emit({ ...ev, kind: "retry", attempt, ms: 0, data: { errorKind: error.kind, maxTokensRaisedTo: raised } });
          options.onRetry?.({ attempt, delayMs: 0, reason: `ran out of tokens while reasoning, retrying with max tokens ${raised}` });
          continue;
        }
        if (!(error instanceof UpstreamError) || !error.retryable || attempt >= maxAttempts) throw error;

        if (error.rateLimits) this.observe(request.model, error.rateLimits, options.tag);
        // DO sends no Retry-After on a 429, but its headers say which counter ran out and when it resets.
        const retryAfterMs = error.retryAfterMs ?? (error.kind === "rate_limited" ? resetOfSpentCounter(error.rateLimits) : undefined);
        if (error.kind === "rate_limited") {
          events.emit({ ...ev, kind: "rate_limited", attempt, data: { retryAfterMs, retryAfterHeader: error.retryAfterMs, headers: error.rateLimits, message: error.message } });
          // Tell every instance to back off, not just this one.
          await this.limiter.coolDown(request.model, retryAfterMs ?? 1_000, "429", true, options.tag).catch(() => undefined);
        }
        const delay = retryDelay(attempt, retryAfterMs);
        // Don't sleep past what the caller will wait anyway: a person watching a compare would
        // rather see "rate limited" now than a spinner until the provider's window resets.
        if (delay.delayMs > maxQueueWaitMs) {
          events.emit({ ...ev, kind: "attempt_failed", attempt, data: { errorKind: "gave_up", reason: `retry would wait ${delay.delayMs} ms, over the ${maxQueueWaitMs} ms budget` } });
          throw error;
        }
        events.emit({ ...ev, kind: "retry", attempt, ms: delay.delayMs, data: { ...delay, errorKind: error.kind, status: error.status } });
        options.onRetry?.({ attempt, delayMs: delay.delayMs, reason: error.message });
        await sleep(delay.delayMs, options.signal);
      }
    }
  }

  /** Learns the provider's real limits from its headers. Fire and forget: never slows or fails a call. */
  private observe(model: string, limits: ObservedLimits, tag?: string): void {
    this.limiter.observe(model, limits, tag).catch((error: unknown) => console.warn("[gateway] could not record rate limits", error));
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
  meta?: ResponseMeta;
}

function describeFailure(error: unknown): Record<string, unknown> {
  if (error instanceof UpstreamError) {
    return { errorKind: error.kind, status: error.status, retryable: error.retryable, requestId: error.options.requestId, message: error.message.slice(0, 200) };
  }
  if (error instanceof StreamInterruptedError) return { errorKind: "stream_interrupted", cause: error.cause.kind };
  return { errorKind: "other", message: String(error).slice(0, 200) };
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
 * When a 429 comes without Retry-After, the reset time of whichever counter
 * is spent (remaining 0) is the honest wait. Undefined if none is.
 */
export function resetOfSpentCounter(limits: ObservedLimits | undefined): number | undefined {
  if (!limits) return undefined;
  const spent = [
    [limits.remainingRequests, limits.resetRequestsMs],
    [limits.remainingTokens, limits.resetTokensMs],
    [limits.remainingTokensPerDay, limits.resetTokensPerDayMs],
  ].filter(([remaining, reset]) => remaining === 0 && reset !== undefined);
  return spent.length ? Math.max(...spent.map(([, reset]) => reset!)) : undefined;
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
