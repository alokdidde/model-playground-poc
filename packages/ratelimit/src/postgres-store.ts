import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@fomo/db";
import { effectiveLimits, LocalBucketState } from "./policy";
import type { AcquireResult, Lease, LeaseStore, Limits, ObservedLimits } from "./types";

/**
 * Lease store on Postgres (the default: no extra infrastructure).
 *
 * Atomicity comes from a transaction-scoped advisory lock keyed by the
 * bucket name: concurrent acquires for the same bucket queue up behind
 * each other, while different buckets never block each other. The lock is
 * released automatically when the transaction commits or rolls back, so a
 * crashed caller cannot leave it held.
 *
 * All timestamps come from the database clock (`now()`), so instances with
 * skewed clocks still agree on the window.
 */
export class PostgresLeaseStore implements LeaseStore {
  readonly kind = "postgres" as const;

  /** Learned limits and the AIMD factor stay per process here (see LocalBucketState). */
  private readonly state = new LocalBucketState();

  constructor(private readonly prisma: PrismaClient) {}

  async tryAcquire(bucket: string, tokens: number, limits: Limits): Promise<AcquireResult> {
    const { factor } = this.state.get(bucket);
    const max = effectiveLimits(limits, this.state.get(bucket));
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bucket}))`;

      const cooldown = await tx.$queryRaw<{ wait_ms: number }[]>`
        SELECT ceil(extract(epoch FROM (until - now())) * 1000)::int AS wait_ms
        FROM rate_cooldown
        WHERE bucket = ${bucket} AND until > now()`;
      if (cooldown[0]) {
        return { granted: false, reason: "cooldown", retryAfterMs: cooldown[0].wait_ms } as const;
      }

      // Rows older than the window no longer count. Deleting them here keeps the table small.
      await tx.$executeRaw`
        DELETE FROM rate_lease
        WHERE bucket = ${bucket}
          AND created_at <= now() - ${limits.windowMs}::int * interval '1 millisecond'`;

      const [usage] = await tx.$queryRaw<
        { requests: number; tokens: number; in_flight: number; until_oldest_ms: number | null }[]
      >`
        SELECT
          count(*)::int AS requests,
          coalesce(sum(coalesce(tokens_actual, tokens_reserved)), 0)::int AS tokens,
          (count(*) FILTER (WHERE released_at IS NULL AND expires_at > now()))::int AS in_flight,
          ceil(extract(epoch FROM (min(created_at)
            + ${limits.windowMs}::int * interval '1 millisecond' - now())) * 1000)::int AS until_oldest_ms
        FROM rate_lease
        WHERE bucket = ${bucket}`;

      const untilOldestMs = Math.max(usage?.until_oldest_ms ?? limits.windowMs, 1);
      const used = { requests: usage?.requests ?? 0, tokens: usage?.tokens ?? 0, inFlight: usage?.in_flight ?? 0 };
      const snapshot = { used, max, factor };
      if (used.requests + 1 > max.requests) {
        return { granted: false, reason: "requests", retryAfterMs: untilOldestMs, snapshot } as const;
      }
      if (used.tokens + tokens > max.tokens) {
        return { granted: false, reason: "tokens", retryAfterMs: untilOldestMs, snapshot } as const;
      }
      if (used.inFlight + 1 > max.inFlight) {
        return { granted: false, reason: "in_flight", retryAfterMs: 250, snapshot } as const;
      }

      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rate_lease (id, bucket, tokens_reserved, created_at, expires_at)
        VALUES (${id}, ${bucket}, ${tokens}, now(), now() + ${limits.leaseTtlMs}::int * interval '1 millisecond')`;

      return { granted: true, lease: { id, bucket, tokensReserved: tokens }, snapshot } as const;
    });
  }

  async release(lease: Lease, actualTokens: number): Promise<void> {
    this.state.onSuccess(lease.bucket);
    // updateMany: no error if the row was already pruned out of the window.
    await this.prisma.rateLease.updateMany({
      where: { id: lease.id },
      data: { tokensActual: actualTokens, releasedAt: new Date() },
    });
  }

  async coolDown(bucket: string, ms: number, decrease = true): Promise<void> {
    // GREATEST: a shorter cooldown never cuts a longer one short.
    await this.prisma.$executeRaw`
      INSERT INTO rate_cooldown (bucket, until)
      VALUES (${bucket}, now() + ${Math.ceil(ms)}::int * interval '1 millisecond')
      ON CONFLICT (bucket) DO UPDATE SET until = GREATEST(rate_cooldown.until, EXCLUDED.until)`;
    // Debounced in LocalBucketState, so a burst of parallel 429s counts as one signal.
    if (decrease) this.state.onRateLimited(bucket);
  }

  async observe(bucket: string, observed: ObservedLimits): Promise<void> {
    this.state.observe(bucket, observed);
  }

  inspect(bucket: string) {
    return this.state.get(bucket);
  }
}
