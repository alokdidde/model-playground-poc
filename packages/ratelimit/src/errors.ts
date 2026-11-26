import type { DenyReason } from "./types";

/** Thrown when we could not get a lease within the caller's wait budget. */
export class RateLimitExceededError extends Error {
  constructor(
    readonly reason: DenyReason | "too_large",
    readonly retryAfterMs: number,
    message: string,
  ) {
    super(message);
    this.name = "RateLimitExceededError";
  }
}
