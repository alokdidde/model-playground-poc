import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryLeaseStore } from "../src/memory-store";
import { PostgresLeaseStore } from "../src/postgres-store";
import { RedisLeaseStore } from "../src/redis-store";
import type { LeaseStore, Limits } from "../src/types";

/**
 * One behavioural contract, run against every store. Postgres and Redis run
 * only when TEST_DATABASE_URL / TEST_REDIS_URL are set (CI and local docker).
 */
const limits: Limits = {
  requestsPerWindow: 5,
  tokensPerWindow: 1_000,
  maxInFlight: 3,
  windowMs: 60_000,
  leaseTtlMs: 60_000,
  batchShare: 0.4,
};

const stores: { name: string; make: () => Promise<LeaseStore> }[] = [
  { name: "memory", make: async () => new MemoryLeaseStore() },
];

const cleanups: (() => Promise<void>)[] = [];

if (process.env.TEST_DATABASE_URL) {
  stores.push({
    name: "postgres",
    make: async () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      const { PrismaClient } = await import("@fomo/db");
      const prisma = new PrismaClient();
      cleanups.push(() => prisma.$disconnect());
      return new PostgresLeaseStore(prisma);
    },
  });
}
if (process.env.TEST_REDIS_URL) {
  stores.push({
    name: "redis",
    make: async () => {
      const store = new RedisLeaseStore(process.env.TEST_REDIS_URL!);
      cleanups.push(() => store.close());
      return store;
    },
  });
}

afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

describe.each(stores)("$name lease store", ({ make }) => {
  // A fresh bucket per test keeps tests independent without truncating tables.
  const bucket = () => `test:${randomUUID()}`;

  it("caps concurrent leases at maxInFlight, and frees the slot on release", async () => {
    const store = await make();
    const b = bucket();
    const leases = [];
    for (let i = 0; i < 3; i++) {
      const r = await store.tryAcquire(b, 10, limits);
      expect(r.granted).toBe(true);
      if (r.granted) leases.push(r.lease);
    }
    const denied = await store.tryAcquire(b, 10, limits);
    expect(denied).toMatchObject({ granted: false, reason: "in_flight" });

    await store.release(leases[0]!, 10, limits);
    expect((await store.tryAcquire(b, 10, limits)).granted).toBe(true);
  });

  it("caps requests per window even after leases are released", async () => {
    const store = await make();
    const b = bucket();
    for (let i = 0; i < 5; i++) {
      const r = await store.tryAcquire(b, 1, limits);
      expect(r.granted).toBe(true);
      if (r.granted) await store.release(r.lease, 1, limits);
    }
    const denied = await store.tryAcquire(b, 1, limits);
    expect(denied).toMatchObject({ granted: false, reason: "requests" });
    if (!denied.granted) expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("caps tokens per window and reconciles estimates with actual usage", async () => {
    const store = await make();
    const b = bucket();
    const first = await store.tryAcquire(b, 900, limits);
    expect(first.granted).toBe(true);
    expect(await store.tryAcquire(b, 200, limits)).toMatchObject({ granted: false, reason: "tokens" });

    // The call used far fewer tokens than estimated: the budget comes back.
    if (first.granted) await store.release(first.lease, 100, limits);
    expect((await store.tryAcquire(b, 200, limits)).granted).toBe(true);
  });

  it("rejects everyone during a cooldown", async () => {
    const store = await make();
    const b = bucket();
    await store.coolDown(b, 5_000);
    const denied = await store.tryAcquire(b, 1, limits);
    expect(denied).toMatchObject({ granted: false, reason: "cooldown" });
    if (!denied.granted) expect(denied.retryAfterMs).toBeGreaterThan(3_000);
  });

  it("never over-grants under concurrent acquires", async () => {
    const store = await make();
    const b = bucket();
    const results = await Promise.all(Array.from({ length: 20 }, () => store.tryAcquire(b, 1, limits)));
    expect(results.filter((r) => r.granted)).toHaveLength(limits.maxInFlight);
  });

  it("holds capacity back from the batch lane for interactive calls", async () => {
    const store = await make();
    const b = bucket();
    // batchShare 0.4 of 3 in-flight = 1 batch slot.
    expect((await store.tryAcquire(b, 10, limits, "batch")).granted).toBe(true);
    expect(await store.tryAcquire(b, 10, limits, "batch")).toMatchObject({ granted: false, reason: "in_flight" });
    // Interactive still gets the remaining two slots.
    expect((await store.tryAcquire(b, 10, limits, "interactive")).granted).toBe(true);
    expect((await store.tryAcquire(b, 10, limits)).granted).toBe(true);
    // And batch counts interactive usage too: it never pushes the total past its share.
    expect((await store.tryAcquire(b, 500, limits, "batch")).granted).toBe(false);
  });

  it("uses limits learned from response headers, with a safety margin", async () => {
    const store = await make();
    const b = bucket();
    await store.observe(b, { requestsPerWindow: 3 }); // 3 x 0.9 = 2 requests
    for (let i = 0; i < 2; i++) {
      const r = await store.tryAcquire(b, 1, limits);
      expect(r.granted).toBe(true);
      if (r.granted) await store.release(r.lease, 1, limits);
    }
    expect(await store.tryAcquire(b, 1, limits)).toMatchObject({ granted: false, reason: "requests" });
  });

  it("halves capacity after a 429 (once for a burst of them)", async () => {
    const store = await make();
    const b = bucket();
    const roomy = { ...limits, maxInFlight: 10 };
    await Promise.all([store.coolDown(b, 100), store.coolDown(b, 100), store.coolDown(b, 100)]);
    await new Promise((r) => setTimeout(r, 200));
    // Factor 0.5: 5 requests -> 2. (Three halvings would leave 1.)
    expect(await store.tryAcquire(b, 1, roomy)).toMatchObject({ granted: true });
    expect(await store.tryAcquire(b, 1, roomy)).toMatchObject({ granted: true });
    expect(await store.tryAcquire(b, 1, roomy)).toMatchObject({ granted: false, reason: "requests" });
  });
});
