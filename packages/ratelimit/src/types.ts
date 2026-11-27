/**
 * Token + request leasing.
 *
 * Before every model call we take a *lease* from a shared store. A lease
 * reserves one request and an estimated number of tokens inside a sliding
 * time window (default 60s), and occupies one "in-flight" slot until it is
 * released or its TTL expires. When the call finishes we release the lease
 * with the real token count, so the window reflects actual usage.
 *
 * Because every web instance and every worker takes leases from the same
 * store, the whole system stays under the provider's RPM/TPM limits instead
 * of each process guessing on its own.
 */

export interface Limits {
  /** Max requests started per window. */
  requestsPerWindow: number;
  /** Max tokens (input + output) per window. */
  tokensPerWindow: number;
  /** Max calls running at once. */
  maxInFlight: number;
  windowMs: number;
  /** How long an unreleased lease holds its in-flight slot (protects against crashed callers). */
  leaseTtlMs: number;
  /**
   * Share of each limit (requests, tokens, in-flight) that batch work may
   * fill. The rest is held back so an interactive compare never queues
   * behind a big eval. 0.3 means interactive keeps 70% to itself.
   */
  batchShare: number;
}

/** Who is asking. Interactive (a person is watching a stream) beats batch (a background eval). */
export type Lane = "interactive" | "batch";

/**
 * What the provider told us in its x-ratelimit-* response headers. Limits
 * replace the configured fallback for that bucket; a remaining count of 0
 * blocks the bucket until the reset time.
 */
export interface ObservedLimits {
  requestsPerWindow?: number;
  tokensPerWindow?: number;
  remainingRequests?: number;
  remainingTokens?: number;
  remainingTokensPerDay?: number;
  /** Milliseconds until each counter resets. */
  resetRequestsMs?: number;
  resetTokensMs?: number;
  resetTokensPerDayMs?: number;
}

export interface Lease {
  id: string;
  bucket: string;
  tokensReserved: number;
}

export type DenyReason = "requests" | "tokens" | "in_flight" | "cooldown";

export type AcquireResult =
  | { granted: true; lease: Lease }
  | { granted: false; reason: DenyReason; retryAfterMs: number };

/**
 * The storage contract. Each implementation must make `tryAcquire` atomic:
 * the check ("is there capacity?") and the write ("take it") happen as one
 * operation, otherwise two callers can both see room for one more.
 */
export interface LeaseStore {
  readonly kind: "memory" | "postgres";
  /**
   * Takes capacity if there is room under the bucket's *effective* limits:
   * learned limits (or the configured ones), scaled by the AIMD factor, and
   * by `batchShare` for the batch lane. See `effectiveLimits`.
   */
  tryAcquire(bucket: string, tokens: number, limits: Limits, lane?: Lane): Promise<AcquireResult>;
  /**
   * Frees the in-flight slot and replaces the token estimate with the actual
   * count. The request itself stays counted in the window: it happened.
   * Also the "additive increase" half of AIMD: each finished call nudges the
   * bucket's factor back towards 1.
   */
  release(lease: Lease, actualTokens: number, limits: Limits): Promise<void>;
  /**
   * After a 429: block the bucket for everyone until `ms` from now, and halve
   * its AIMD factor (once per cooldown, so a burst of parallel 429s counts once).
   */
  coolDown(bucket: string, ms: number): Promise<void>;
  /** Records limits learned from response headers for this bucket. */
  observe(bucket: string, observed: ObservedLimits): Promise<void>;
  close?(): Promise<void>;
}
