import { randomUUID } from "node:crypto";
import { effectiveLimits, LocalBucketState } from "./policy";
import type { AcquireResult, Lane, Lease, LeaseStore, Limits, ObservedLimits } from "./types";

interface Entry {
  id: string;
  createdAt: number;
  tokens: number;
  expiresAt: number;
  released: boolean;
}

/**
 * Single-process store. Good for unit tests and for running one instance
 * locally. It does NOT coordinate across processes, so never use it when
 * the web app and the worker both call models in production.
 */
export class MemoryLeaseStore implements LeaseStore {
  readonly kind = "memory" as const;
  private buckets = new Map<string, Entry[]>();
  private cooldowns = new Map<string, number>();
  private readonly state: LocalBucketState;

  constructor(private readonly now: () => number = Date.now) {
    this.state = new LocalBucketState(now);
  }

  async tryAcquire(bucket: string, tokens: number, limits: Limits, lane: Lane = "interactive"): Promise<AcquireResult> {
    const max = effectiveLimits(limits, this.state.get(bucket), lane);
    const now = this.now();

    const cooldownUntil = this.cooldowns.get(bucket) ?? 0;
    if (cooldownUntil > now) {
      return { granted: false, reason: "cooldown", retryAfterMs: cooldownUntil - now };
    }

    const windowStart = now - limits.windowMs;
    const entries = (this.buckets.get(bucket) ?? []).filter((e) => e.createdAt > windowStart);
    this.buckets.set(bucket, entries);

    const oldest = entries[0];
    const untilOldestExpires = oldest ? oldest.createdAt + limits.windowMs - now : limits.windowMs;
    const usedTokens = entries.reduce((sum, e) => sum + e.tokens, 0);
    const inFlight = entries.filter((e) => !e.released && e.expiresAt > now);

    if (entries.length + 1 > max.requests) {
      return { granted: false, reason: "requests", retryAfterMs: untilOldestExpires };
    }
    if (usedTokens + tokens > max.tokens) {
      return { granted: false, reason: "tokens", retryAfterMs: untilOldestExpires };
    }
    if (inFlight.length + 1 > max.inFlight) {
      // We cannot know when a call finishes; poll again shortly.
      return { granted: false, reason: "in_flight", retryAfterMs: 250 };
    }

    const entry: Entry = { id: randomUUID(), createdAt: now, tokens, expiresAt: now + limits.leaseTtlMs, released: false };
    entries.push(entry);
    return { granted: true, lease: { id: entry.id, bucket, tokensReserved: tokens } };
  }

  async release(lease: Lease, actualTokens: number): Promise<void> {
    this.state.onSuccess(lease.bucket);
    const entry = this.buckets.get(lease.bucket)?.find((e) => e.id === lease.id);
    if (!entry) return; // already outside the window, nothing to fix up
    entry.tokens = actualTokens;
    entry.released = true;
  }

  async coolDown(bucket: string, ms: number): Promise<void> {
    if ((this.cooldowns.get(bucket) ?? 0) <= this.now()) this.state.onRateLimited(bucket);
    const until = this.now() + ms;
    this.cooldowns.set(bucket, Math.max(this.cooldowns.get(bucket) ?? 0, until));
  }

  async observe(bucket: string, observed: ObservedLimits): Promise<void> {
    this.state.observe(bucket, observed);
  }
}
