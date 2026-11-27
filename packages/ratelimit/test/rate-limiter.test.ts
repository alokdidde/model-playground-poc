import { describe, expect, it } from "vitest";
import { MemoryLeaseStore } from "../src/memory-store";
import { RateLimiter } from "../src/rate-limiter";
import { RateLimitExceededError } from "../src/errors";
import { MemoryEventSink } from "../src/events";

const limits = { requestsPerWindow: 100, tokensPerWindow: 1_000, maxInFlight: 1, windowMs: 60_000, leaseTtlMs: 60_000, batchShare: 0.3 };

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
  it("cools down on a spent counter without halving the AIMD factor (the limit is known)", async () => {
    const events = new MemoryEventSink();
    const limiter = new RateLimiter(new MemoryLeaseStore(), { ...limits, maxInFlight: 5 }, "model", "default", events);
    await limiter.observe("m", { requestsPerWindow: 120, remainingRequests: 0, resetRequestsMs: 30_000 });
    await expect(limiter.acquire("m", 10, { maxWaitMs: 50 })).rejects.toMatchObject({ reason: "cooldown" });
    expect(limiter.store.inspect(limiter.bucketFor("m")).factor).toBe(1);
    expect(events.ofKind("cooldown")[0]).toMatchObject({ ms: 30_000, data: { decrease: false } });
    expect(events.ofKind("factor_changed")).toHaveLength(0);
  });

  it("does not block while a few requests are left (DO refills gradually)", async () => {
    const limiter = new RateLimiter(new MemoryLeaseStore(), { ...limits, maxInFlight: 5 });
    await limiter.observe("m", { requestsPerWindow: 120, remainingRequests: 2, resetRequestsMs: 59_000 });
    await expect(limiter.acquire("m", 10, { maxWaitMs: 50 })).resolves.toBeDefined();
  });

  it("reports waits, grants with bucket levels, and AIMD changes as events", async () => {
    const events = new MemoryEventSink();
    const limiter = new RateLimiter(new MemoryLeaseStore(), limits, "model", "default", events);
    const first = await limiter.acquire("m", 10, { maxWaitMs: 1_000, tag: "run1" });
    setTimeout(() => void limiter.release(first, 7), 50);
    await limiter.acquire("m", 10, { maxWaitMs: 5_000, tag: "run1" });
    expect(events.ofKind("lease_wait")[0]).toMatchObject({ model: "m", tag: "run1", data: { reason: "in_flight" } });
    expect(events.ofKind("lease_granted")[1]!.data).toMatchObject({ used: { inFlight: 0 }, max: { inFlight: 1 } });
    expect(events.ofKind("lease_released")[0]!.data).toEqual({ tokensReserved: 10, tokensActual: 7 });
    await limiter.coolDown("m", 10);
    expect(events.ofKind("factor_changed")[0]!.data).toMatchObject({ from: 1, to: 0.5, cause: "429" });
  });
});
