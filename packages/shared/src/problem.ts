/**
 * RFC 9457 "Problem Details for HTTP APIs".
 * https://www.rfc-editor.org/rfc/rfc9457
 *
 * Every error response from our API has this shape and the
 * `application/problem+json` content type. The same shape is reused inside
 * SSE events when one model fails mid-stream, so the client only has to
 * understand one error format.
 */
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/** The `type` URIs we emit. Each one is documented at /problems/<slug>. */
export const PROBLEM_TYPES = {
  validation: "/problems/validation-error",
  notFound: "/problems/not-found",
  conflict: "/problems/conflict",
  idempotencyMismatch: "/problems/idempotency-key-reused",
  rateLimited: "/problems/rate-limited",
  upstreamTimeout: "/problems/upstream-timeout",
  upstreamError: "/problems/upstream-error",
  unauthorized: "/problems/unauthorized",
  forbidden: "/problems/forbidden",
  internal: "/problems/internal-error",
  unavailable: "/problems/service-unavailable",
} as const;

export type ProblemType = (typeof PROBLEM_TYPES)[keyof typeof PROBLEM_TYPES];

export interface FieldError {
  /** Dotted path into the request, e.g. "body.models.0" */
  pointer: string;
  message: string;
}

export interface Problem {
  type: ProblemType | string;
  title: string;
  status: number;
  detail?: string;
  /** The request path that produced the problem. */
  instance?: string;
  // ---- extension members (allowed by RFC 9457 §3.2) ----
  requestId?: string;
  errors?: FieldError[];
  /** When the client may retry, in milliseconds (mirrors Retry-After). */
  retryAfterMs?: number;
  [extension: string]: unknown;
}

export function isProblem(value: unknown): value is Problem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Problem).type === "string" &&
    typeof (value as Problem).title === "string" &&
    typeof (value as Problem).status === "number"
  );
}
