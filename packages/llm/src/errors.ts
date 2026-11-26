import type { ObservedLimits } from "@fomo/ratelimit";

/**
 * A failure talking to the model provider, normalised so the retry logic
 * does not need to know about SDK-specific error classes.
 */
export type UpstreamErrorKind = "rate_limited" | "timeout" | "server" | "network" | "client" | "bad_output";

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export class UpstreamError extends Error {
  constructor(
    readonly kind: UpstreamErrorKind,
    message: string,
    readonly options: { status?: number; retryAfterMs?: number; cause?: unknown; rateLimits?: ObservedLimits } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "UpstreamError";
  }

  get status(): number | undefined {
    return this.options.status;
  }

  get retryAfterMs(): number | undefined {
    return this.options.retryAfterMs;
  }

  /** Rate-limit headers that came with the error response, if any. */
  get rateLimits(): ObservedLimits | undefined {
    return this.options.rateLimits;
  }

  /** 4xx errors (bad request, unknown model, auth) will fail the same way again. */
  get retryable(): boolean {
    if (this.kind === "client" || this.kind === "bad_output") return false;
    if (this.status !== undefined) return RETRYABLE_STATUSES.has(this.status);
    return true; // timeouts and network errors
  }

  static fromStatus(status: number, message: string, retryAfterMs?: number, cause?: unknown, rateLimits?: ObservedLimits): UpstreamError {
    const kind: UpstreamErrorKind =
      status === 429 ? "rate_limited" : status === 408 ? "timeout" : status >= 500 ? "server" : "client";
    return new UpstreamError(kind, message, { status, retryAfterMs, cause, rateLimits });
  }
}

/** Thrown when a stream fails after some text was already sent to the user (cannot be retried safely). */
export class StreamInterruptedError extends Error {
  constructor(
    readonly cause: UpstreamError,
    readonly partialOutput: string,
  ) {
    super(`Stream interrupted: ${cause.message}`);
    this.name = "StreamInterruptedError";
  }
}

/**
 * Parses Retry-After (seconds or an HTTP date) and the non-standard
 * retry-after-ms header that OpenAI-compatible servers often send.
 */
export function parseRetryAfter(get: (name: string) => string | null | undefined, now = Date.now()): number | undefined {
  const ms = get("retry-after-ms");
  if (ms && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));

  const value = get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
