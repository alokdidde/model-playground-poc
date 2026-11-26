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
  readonly kind: "memory" | "postgres" | "redis";
  tryAcquire(bucket: string, tokens: number, limits: Limits): Promise<AcquireResult>;
  /**
   * Frees the in-flight slot and replaces the token estimate with the actual
   * count. The request itself stays counted in the window: it happened.
   */
  release(lease: Lease, actualTokens: number, limits: Limits): Promise<void>;
  /** Block the bucket for everyone until `ms` from now (used after a 429). */
  coolDown(bucket: string, ms: number): Promise<void>;
  close?(): Promise<void>;
}
