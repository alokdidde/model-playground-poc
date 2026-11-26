import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { AIMD_MIN, AIMD_STEP, LEARNED_SAFETY, LEARNED_TTL_MS } from "./policy";
import type { AcquireResult, DenyReason, Lane, Lease, LeaseStore, Limits, ObservedLimits } from "./types";

/**
 * Lease store on Valkey / Redis (DigitalOcean Managed Caching). The
 * recommended store once more than one instance calls models.
 *
 * Every operation is one Lua script, which Valkey runs atomically, so the
 * check ("is there room?") and the take can never interleave between
 * instances. Keys for a bucket share a `{hash tag}` so they land on the same
 * shard if the cluster is ever sharded. Timestamps come from Valkey's clock
 * (`TIME`), so instances with skewed clocks still agree on the window.
 *
 * Data layout per bucket (one bucket = one access key × one model):
 *   {b}:leases    ZSET  leaseId -> createdAt (ms)       requests in the window
 *   {b}:tokens    HASH  leaseId -> tokens               reserved, then actual tokens
 *   {b}:inflight  ZSET  leaseId -> expiresAt (ms)       unreleased leases
 *   {b}:cooldown  STRING with a PX expiry               set after a 429
 *   {b}:state     HASH  factor, rpm, tpm                AIMD factor + limits learned from headers
 *
 * The effective-limit arithmetic mirrors `effectiveLimits()` in policy.ts.
 */
const NOW = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
`;

const ACQUIRE_SCRIPT = `
local leases, tokensKey, inflight, cooldown, state = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]
local leaseId = ARGV[1]
local tokens = tonumber(ARGV[2])
local cfgRequests, cfgTokens, cfgInFlight = tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5])
local windowMs, ttlMs = tonumber(ARGV[6]), tonumber(ARGV[7])
local laneShare, safety = tonumber(ARGV[8]), tonumber(ARGV[9])
${NOW}
local cd = redis.call('PTTL', cooldown)
if cd > 0 then return {0, 'cooldown', cd} end

-- Effective limits: learned (x safety) or configured, x AIMD factor, x lane share.
local s = redis.call('HMGET', state, 'factor', 'rpm', 'tpm')
local factor = tonumber(s[1]) or 1
local scale = factor * laneShare
local maxRequests = math.max(1, math.floor((tonumber(s[2]) and tonumber(s[2]) * safety or cfgRequests) * scale))
local maxTokens = math.floor((tonumber(s[3]) and tonumber(s[3]) * safety or cfgTokens) * scale)
local maxInFlight = math.max(1, math.floor(cfgInFlight * scale))

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
-- AIMD additive increase: a finished call nudges the factor back towards 1.
local f = tonumber(redis.call('HGET', KEYS[5], 'factor'))
if f and f < 1 then redis.call('HSET', KEYS[5], 'factor', tostring(math.min(1, f + tonumber(ARGV[3])))) end
return 1
`;

const COOLDOWN_SCRIPT = `
local cooldown, state = KEYS[4], KEYS[5]
local ms, minFactor = tonumber(ARGV[1]), tonumber(ARGV[2])
local current = redis.call('PTTL', cooldown)
-- AIMD multiplicative decrease, once per cooldown: parallel 429s are one signal.
if current <= 0 then
  local f = tonumber(redis.call('HGET', state, 'factor')) or 1
  redis.call('HSET', state, 'factor', tostring(math.max(minFactor, f / 2)))
  redis.call('PEXPIRE', state, ARGV[3])
end
-- Never shorten an existing cooldown.
if current < ms then redis.call('SET', cooldown, '1', 'PX', ms) end
return 1
`;

const OBSERVE_SCRIPT = `
if ARGV[1] ~= '' then redis.call('HSET', KEYS[5], 'rpm', ARGV[1]) end
if ARGV[2] ~= '' then redis.call('HSET', KEYS[5], 'tpm', ARGV[2]) end
redis.call('PEXPIRE', KEYS[5], ARGV[3])
return 1
`;

function keys(bucket: string) {
  const tag = `{rl:${bucket}}`;
  return [`${tag}:leases`, `${tag}:tokens`, `${tag}:inflight`, `${tag}:cooldown`, `${tag}:state`] as const;
}

export class RedisLeaseStore implements LeaseStore {
  readonly kind = "redis" as const;
  private readonly redis: Redis;

  /** `rediss://` URLs (DO Managed Caching) use TLS with normal certificate checks. */
  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: true });
    this.redis.defineCommand("leaseAcquire", { numberOfKeys: 5, lua: ACQUIRE_SCRIPT });
    this.redis.defineCommand("leaseRelease", { numberOfKeys: 5, lua: RELEASE_SCRIPT });
    this.redis.defineCommand("leaseCoolDown", { numberOfKeys: 5, lua: COOLDOWN_SCRIPT });
    this.redis.defineCommand("leaseObserve", { numberOfKeys: 5, lua: OBSERVE_SCRIPT });
  }

  /** defineCommand caches each script by SHA (EVALSHA), so scripts are sent once per connection. */
  private run(name: string, bucket: string, ...args: (string | number)[]): Promise<unknown> {
    const fn = (this.redis as unknown as Record<string, (...a: (string | number)[]) => Promise<unknown>>)[name]!;
    return fn.call(this.redis, ...keys(bucket), ...args);
  }

  async tryAcquire(bucket: string, tokens: number, limits: Limits, lane: Lane = "interactive"): Promise<AcquireResult> {
    const id = randomUUID();
    const [granted, reason, retryAfterMs] = (await this.run(
      "leaseAcquire",
      bucket,
      id,
      tokens,
      limits.requestsPerWindow,
      limits.tokensPerWindow,
      limits.maxInFlight,
      limits.windowMs,
      limits.leaseTtlMs,
      lane === "batch" ? limits.batchShare : 1,
      LEARNED_SAFETY,
    )) as [number, string, number];

    if (granted === 1) return { granted: true, lease: { id, bucket, tokensReserved: tokens } };
    return { granted: false, reason: reason as DenyReason, retryAfterMs };
  }

  async release(lease: Lease, actualTokens: number): Promise<void> {
    await this.run("leaseRelease", lease.bucket, lease.id, actualTokens, AIMD_STEP);
  }

  async coolDown(bucket: string, ms: number): Promise<void> {
    await this.run("leaseCoolDown", bucket, Math.max(1, Math.ceil(ms)), AIMD_MIN, LEARNED_TTL_MS);
  }

  async observe(bucket: string, observed: ObservedLimits): Promise<void> {
    if (!observed.requestsPerWindow && !observed.tokensPerWindow) return;
    await this.run("leaseObserve", bucket, observed.requestsPerWindow ?? "", observed.tokensPerWindow ?? "", LEARNED_TTL_MS);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
