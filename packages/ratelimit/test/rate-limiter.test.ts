import { describe, expect, it } from "vitest";
import { MemoryLeaseStore } from "../src/memory-store";
import { RateLimiter } from "../src/rate-limiter";
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

  it("rejects a request that can never fit", async () => {
    const limiter = new RateLimiter(new MemoryLeaseStore(), limits);
    await expect(limiter.acquire("m", 5_000, { maxWaitMs: 1_000 })).rejects.toMatchObject({ reason: "too_large" });
  });

  it("uses one bucket per account by default, or one per model", () => {
    const store = new MemoryLeaseStore();
    expect(new RateLimiter(store, limits).bucketFor("a")).toBe(new RateLimiter(store, limits).bucketFor("b"));
    expect(new RateLimiter(store, limits, "model").bucketFor("a")).not.toBe(
      new RateLimiter(store, limits, "model").bucketFor("b"),
    );
  });
});
