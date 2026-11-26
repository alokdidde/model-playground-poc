import { createHash } from "node:crypto";
import type { PrismaClient } from "@fomo/db";
import { MemoryLeaseStore } from "./memory-store";
import { PostgresLeaseStore } from "./postgres-store";
import { RedisLeaseStore } from "./redis-store";
import { RateLimiter, type BucketStrategy } from "./rate-limiter";
import type { LeaseStore, Limits } from "./types";

export * from "./types";
export * from "./errors";
export * from "./backoff";
export { RateLimiter, type BucketStrategy, type AcquireOptions } from "./rate-limiter";
export { MemoryLeaseStore } from "./memory-store";
export { PostgresLeaseStore } from "./postgres-store";
export { RedisLeaseStore } from "./redis-store";
export * from "./policy";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function limitsFromEnv(): Limits {
  return {
    requestsPerWindow: intFromEnv("RATE_LIMIT_RPM", 100),
    tokensPerWindow: intFromEnv("RATE_LIMIT_TPM", 1_000_000),
    maxInFlight: intFromEnv("RATE_LIMIT_MAX_IN_FLIGHT", 16),
    windowMs: intFromEnv("RATE_LIMIT_WINDOW_MS", 60_000),
    leaseTtlMs: intFromEnv("RATE_LIMIT_LEASE_TTL_MS", 120_000),
    batchShare: shareFromEnv("RATE_LIMIT_BATCH_SHARE", 0.3),
  };
}

function shareFromEnv(name: string, fallback: number): number {
  const value = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback;
}

/** A short, non-reversible id for the access key, so buckets are per key without storing the key. */
export function keyScope(key: string | undefined): string {
  return key ? createHash("sha256").update(key).digest("hex").slice(0, 10) : "default";
}

/**
 * Builds the limiter from env: LEASE_STORE=redis (Valkey, recommended when
 * REDIS_URL is set) | postgres (default otherwise) | memory (one process only).
 */
export function createRateLimiterFromEnv(prisma: PrismaClient): RateLimiter {
  const kind = process.env.LEASE_STORE ?? (process.env.REDIS_URL ? "redis" : "postgres");
  let store: LeaseStore;
  if (kind === "redis") {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("LEASE_STORE=redis requires REDIS_URL");
    store = new RedisLeaseStore(url);
  } else if (kind === "memory") {
    store = new MemoryLeaseStore();
  } else {
    store = new PostgresLeaseStore(prisma);
  }
  const strategy: BucketStrategy = process.env.RATE_LIMIT_BUCKET === "account" ? "account" : "model";
  return new RateLimiter(store, limitsFromEnv(), strategy, keyScope(process.env.DO_MODEL_ACCESS_KEY));
}
