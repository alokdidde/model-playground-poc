import { PROBLEM_TYPES, type Problem } from "@fomo/shared";
import { RateLimitExceededError } from "@fomo/ratelimit";
import { StreamInterruptedError, UpstreamError } from "./errors";

/**
 * Turn a model-call failure into an RFC 9457 problem. Used inside SSE events
 * and stored with failed results, so a failure looks the same everywhere.
 */
export function problemFromModelError(error: unknown, model: string): Problem {
  if (error instanceof StreamInterruptedError) {
    return { ...problemFromModelError(error.cause, model), detail: `${model} stopped mid-answer: ${error.cause.message}` };
  }
  if (error instanceof RateLimitExceededError) {
    return {
      type: PROBLEM_TYPES.rateLimited,
      title: "Rate limit budget exhausted",
      status: 429,
      detail: error.message,
      retryAfterMs: error.retryAfterMs,
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
        retryAfterMs: error.retryAfterMs,
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
  return {
    type: PROBLEM_TYPES.internal,
    title: "Unexpected error calling the model",
    status: 500,
    detail: error instanceof Error ? error.message : String(error),
    model,
  };
}
