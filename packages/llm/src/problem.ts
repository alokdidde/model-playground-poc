import { PROBLEM_TYPES, type Problem } from "@fomo/shared";
import { RateLimitExceededError } from "@fomo/ratelimit";
import { StreamInterruptedError, UpstreamError } from "./errors";
import { resetOfSpentCounter } from "./gateway";

/**
 * Turn a model-call failure into an RFC 9457 problem. Used inside SSE events
 * and stored with failed results, so a failure looks the same everywhere.
 */
export function problemFromModelError(error: unknown, model: string): Problem {
  if (error instanceof StreamInterruptedError) {
    return { ...problemFromModelError(error.cause, model), detail: `${model} stopped mid-answer: ${error.cause.message}` };
  }
  // Also matched by name: in Next.js dev the class can be loaded twice (once per bundle),
  // and then instanceof fails and a rate limit was reported as a 500.
  if (error instanceof RateLimitExceededError || (error instanceof Error && error.name === "RateLimitExceededError")) {
    const e = error as RateLimitExceededError;
    return {
      type: PROBLEM_TYPES.rateLimited,
      title: "Rate limit budget exhausted",
      status: 429,
      detail: e.message,
      retryAfterMs: e.retryAfterMs,
      model,
    };
  }
  if (error instanceof UpstreamError) {
    if (error.kind === "timeout") {
      return { type: PROBLEM_TYPES.upstreamTimeout, title: "Model timed out", status: 504, detail: error.message, model };
    }
    if (error.kind === "rate_limited") {
      return {
        type: PROBLEM_TYPES.rateLimited,
        title: "Model provider rate limited the request",
        status: 429,
        detail: error.message,
        // DO sends no Retry-After; the spent counter's reset is the honest hint.
        retryAfterMs: error.retryAfterMs ?? resetOfSpentCounter(error.rateLimits),
        model,
      };
    }
    return {
      type: PROBLEM_TYPES.upstreamError,
      title: "Model call failed",
      status: 502,
      detail: error.message,
      upstreamStatus: error.status,
      model,
    };
  }
  // Anything else is our bug (a DB error, a TypeError...). Its message can hold
  // internals, and this problem is streamed to the browser and stored, so it
  // gets a generic detail; the caller logs the real error.
  return {
    type: PROBLEM_TYPES.internal,
    title: "Unexpected error calling the model",
    status: 500,
    detail: "Something went wrong on our side. Quote the requestId when reporting it.",
    model,
  };
}
