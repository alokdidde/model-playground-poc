import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { AcquireResult, DenyReason, Lease, LeaseStore, Limits } from "./types";

/**
 * Lease store on Redis / Valkey (DigitalOcean Managed Caching).
 *
 * The whole check-and-take runs as one Lua script, which Redis executes
 * atomically. Keys for a bucket share a `{hash tag}` so they land on the
 * same shard if the cluster is ever sharded.
 *
 * Data layout per bucket:
 *   {b}:leases    ZSET  leaseId -> createdAt (ms)       requests in the window
 *   {b}:tokens    HASH  leaseId -> tokens               reserved or actual tokens
 *   {b}:inflight  ZSET  leaseId -> expiresAt (ms)       unreleased leases
 *   {b}:cooldown  STRING with a PX expiry               set after a 429
 */
const ACQUIRE_SCRIPT = `
local leases, tokensKey, inflight, cooldown = KEYS[1], KEYS[2], KEYS[3], KEYS[4]
local leaseId = ARGV[1]
local tokens = tonumber(ARGV[2])
local maxRequests, maxTokens, maxInFlight = tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5])
local windowMs, ttlMs = tonumber(ARGV[6]), tonumber(ARGV[7])

local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local cd = redis.call('PTTL', cooldown)
if cd > 0 then return {0, 'cooldown', cd} end

-- Drop leases that slid out of the window.
local expired = redis.call('ZRANGEBYSCORE', leases, '-inf', now - windowMs)
if #expired > 0 then
  redis.call('ZREMRANGEBYSCORE', leases, '-inf', now - windowMs)
  redis.call('HDEL', tokensKey, unpack(expired))
end
redis.call('ZREMRANGEBYSCORE', inflight, '-inf', now)

local untilOldest = windowMs
local oldest = redis.call('ZRANGE', leases, 0, 0, 'WITHSCORES')
if oldest[2] then untilOldest = math.max(tonumber(oldest[2]) + windowMs - now, 1) end

if redis.call('ZCARD', leases) + 1 > maxRequests then return {0, 'requests', untilOldest} end

local used = 0
for _, v in ipairs(redis.call('HVALS', tokensKey)) do used = used + tonumber(v) end
if used + tokens > maxTokens then return {0, 'tokens', untilOldest} end

if redis.call('ZCARD', inflight) + 1 > maxInFlight then return {0, 'in_flight', 250} end

redis.call('ZADD', leases, now, leaseId)
redis.call('HSET', tokensKey, leaseId, tokens)
redis.call('ZADD', inflight, now + ttlMs, leaseId)
for _, k in ipairs({leases, tokensKey, inflight}) do redis.call('PEXPIRE', k, windowMs + ttlMs) end
return {1, 'ok', 0}
`;

const RELEASE_SCRIPT = `
-- Only fix up the token count if the lease is still inside the window.
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then
  redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
end
redis.call('ZREM', KEYS[3], ARGV[1])
return 1
`;

function keys(bucket: string) {
  const tag = `{rl:${bucket}}`;
  return [`${tag}:leases`, `${tag}:tokens`, `${tag}:inflight`, `${tag}:cooldown`] as const;
}

export class RedisLeaseStore implements LeaseStore {
  readonly kind = "redis" as const;
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: true });
  }

  async tryAcquire(bucket: string, tokens: number, limits: Limits): Promise<AcquireResult> {
    const id = randomUUID();
    const [granted, reason, retryAfterMs] = (await this.redis.eval(
      ACQUIRE_SCRIPT,
      4,
      ...keys(bucket),
      id,
      tokens,
      limits.requestsPerWindow,
      limits.tokensPerWindow,
      limits.maxInFlight,
      limits.windowMs,
      limits.leaseTtlMs,
    )) as [number, string, number];

    if (granted === 1) return { granted: true, lease: { id, bucket, tokensReserved: tokens } };
    return { granted: false, reason: reason as DenyReason, retryAfterMs };
  }

  async release(lease: Lease, actualTokens: number): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 4, ...keys(lease.bucket), lease.id, actualTokens);
  }

  async coolDown(bucket: string, ms: number): Promise<void> {
    const cooldownKey = keys(bucket)[3];
    const current = await this.redis.pttl(cooldownKey);
    // Never shorten an existing cooldown.
    if (current < ms) await this.redis.set(cooldownKey, "1", "PX", Math.ceil(ms));
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
