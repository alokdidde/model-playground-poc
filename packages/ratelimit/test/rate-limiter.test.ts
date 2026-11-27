import { describe, expect, it } from "vitest";
import { MemoryLeaseStore } from "../src/memory-store";
import { RateLimiter } from "../src/rate-limiter";
import { MemoryEventSink } from "../src/events";
import { RateLimitExceededError } from "../src/errors";

const limits = { requestsPerWindow: 100, tokensPerWindow: 1_000, maxInFlight: 1, windowMs: 60_000, leaseTtlMs: 60_000 };

describe("RateLimiter", () => {
  it("waits for capacity and then succeeds", async () => {
    const limiter = new RateLimiter(new MemoryLeaseStore(), limits);
    const first = await limiter.acquire("m", 10, { maxWaitMs: 1_000 });
    const waits: number[] = [];
    setTimeout(() => void limiter.release(first, 10), 100);
    const second = await limiter.acquire("m", 10, { maxWaitMs: 5_000, onWait: (w) => waits.push(w.waitMs) });
    expect(second.id).not.toBe(first.id);
    expect(waits.length).toBeGreaterThan(0);
  });

  it("gives up after the wait budget", async () => {
    const limiter = new RateLimiter(new MemoryLeaseStore(), limits);
    await limiter.acquire("m", 10, { maxWaitMs: 1_000 });
    await expect(limiter.acquire("m", 10, { maxWaitMs: 50 })).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it("stretches a lease to outlive its holder's call timeout, so a slow call keeps its slot", async () => {
    const shortTtl = { ...limits, leaseTtlMs: 50 };
    const plain = new RateLimiter(new MemoryLeaseStore(), shortTtl);
    await plain.acquire("m", 10, { maxWaitMs: 1_000 });
    await new Promise((r) => setTimeout(r, 80));
    await expect(plain.acquire("m", 10, { maxWaitMs: 10 })).resolves.toBeDefined(); // expired: slot freed

    const held = new RateLimiter(new MemoryLeaseStore(), shortTtl);
    await held.acquire("m", 10, { maxWaitMs: 1_000, holdMs: 1_000 });
    await new Promise((r) => setTimeout(r, 80));
    await expect(held.acquire("m", 10, { maxWaitMs: 10 })).rejects.toBeInstanceOf(RateLimitExceededError); // still held
  });

  it("rejects a request that can never fit", async () => {
    const limiter = new RateLimiter(new MemoryLeaseStore(), limits);
    await expect(limiter.acquire("m", 5_000, { maxWaitMs: 1_000 })).rejects.toMatchObject({ reason: "too_large" });
  });

  it("uses one bucket per (key, model) by default, or one per key", () => {
    const store = new MemoryLeaseStore();
    expect(new RateLimiter(store, limits).bucketFor("a")).not.toBe(new RateLimiter(store, limits).bucketFor("b"));
    expect(new RateLimiter(store, limits, "model", "k1").bucketFor("a")).not.toBe(new RateLimiter(store, limits, "model", "k2").bucketFor("a"));
    expect(new RateLimiter(store, limits, "account").bucketFor("a")).toBe(new RateLimiter(store, limits, "account").bucketFor("b"));
  });

  it("blocks the bucket until reset when the provider says nothing is left", async () => {
    const limiter = new RateLimiter(new MemoryLeaseStore(), { ...limits, maxInFlight: 5 });
    await limiter.observe("m", { remainingRequests: 0, resetRequestsMs: 30_000 });
    await expect(limiter.acquire("m", 10, { maxWaitMs: 50 })).rejects.toMatchObject({ reason: "cooldown" });
    // Other models have their own counters.
    await expect(limiter.acquire("other", 10, { maxWaitMs: 50 })).resolves.toBeDefined();
  });
});

describe("RateLimiter and provider headers", () => {
  it("does not block while a few requests are left (DO refills gradually)", async () => {
    const limiter = new RateLimiter(new MemoryLeaseStore(), { ...limits, maxInFlight: 5 });
    await limiter.observe("m", { requestsPerWindow: 120, remainingRequests: 2, resetRequestsMs: 59_000 });
    await expect(limiter.acquire("m", 10, { maxWaitMs: 50 })).resolves.toBeDefined();
  });

  it("records waits, learned limits and header cooldowns as events, without halving the factor", async () => {
    const events = new MemoryEventSink();
    const limiter = new RateLimiter(new MemoryLeaseStore(), { ...limits, maxInFlight: 5 }, "model", "default", events);
    await limiter.observe("m", { requestsPerWindow: 120, remainingRequests: 0, resetRequestsMs: 60 }, "run-1");
    const lease = await limiter.acquire("m", 10, { maxWaitMs: 2_000, tag: "run-1" });
    await limiter.release(lease, 5);
    expect(events.ofKind("limits_learned")[0]!.data).toMatchObject({ requests: 120 });
    expect(events.ofKind("cooldown")[0]).toMatchObject({ ms: 60, tag: "run-1", data: { cause: "requests exhausted", decrease: false } });
    expect(events.ofKind("lease_wait")[0]!.data).toMatchObject({ reason: "cooldown" });
    const [granted] = events.ofKind("lease_granted");
    expect(granted).toMatchObject({ model: "m", tag: "run-1" });
    expect(Number(granted!.data!.polls)).toBeGreaterThan(1);
    expect(events.ofKind("lease_released")[0]!.data).toMatchObject({ tokensReserved: 10, tokensActual: 5 });
    expect(events.ofKind("factor_changed")).toHaveLength(0);
  });
});
