import { PROBLEM_TYPES, type FieldError, type Problem } from "@fomo/shared";

/**
 * Throw an ApiError anywhere in a route handler and the apiRoute wrapper
 * turns it into an RFC 9457 problem response. Anything else that is thrown
 * becomes a generic 500 (details are logged, not leaked to the client).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly title: string,
    readonly detail?: string,
    readonly extensions: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(detail ?? title);
    this.name = "ApiError";
  }

  toProblem(instance: string, requestId: string): Problem {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      ...(this.detail ? { detail: this.detail } : {}),
      instance,
      requestId,
      ...this.extensions,
    };
  }
}

export const errors = {
  validation: (errors: FieldError[], detail = "The request is invalid.") =>
    new ApiError(400, PROBLEM_TYPES.validation, "Validation failed", detail, { errors }),
  badRequest: (detail: string) => new ApiError(400, PROBLEM_TYPES.validation, "Bad request", detail),
  notFound: (what: string, id: string) =>
    new ApiError(404, PROBLEM_TYPES.notFound, `${what} not found`, `No ${what.toLowerCase()} with id "${id}".`),
  conflict: (detail: string, extensions?: Record<string, unknown>) =>
    new ApiError(409, PROBLEM_TYPES.conflict, "Conflict", detail, extensions),
  idempotencyMismatch: () =>
    new ApiError(
      422,
      PROBLEM_TYPES.idempotencyMismatch,
      "Idempotency key reused",
      "This Idempotency-Key was already used with a different request body.",
    ),
  unsupportedMediaType: () =>
    new ApiError(415, PROBLEM_TYPES.validation, "Unsupported media type", "Send the body as application/json."),
  payloadTooLarge: (maxBytes: number) =>
    new ApiError(413, PROBLEM_TYPES.validation, "Payload too large", `The body must be at most ${maxBytes} bytes.`),
  unavailable: (detail: string, retryAfterSeconds = 5) =>
    new ApiError(503, PROBLEM_TYPES.unavailable, "Service unavailable", detail, {}, { "Retry-After": String(retryAfterSeconds) }),
};
