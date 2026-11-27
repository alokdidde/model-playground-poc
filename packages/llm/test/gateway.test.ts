import { describe, expect, it, vi } from "vitest";
import { MemoryEventSink } from "@fomo/ratelimit";
import { ModelGateway, resetOfSpentCounter, tokensPerSecond } from "../src/gateway";
import { StreamInterruptedError, UpstreamError } from "../src/errors";
import { ScriptedProvider, limiter, request } from "./helpers";

async function* ok() {
  const text = "hello world";
  for (const w of text.split(" ")) yield { type: "delta" as const, text: w + " " };
  yield { type: "usage" as const, usage: { inputTokens: 3, outputTokens: 2 } };
}
async function* rateLimited(): AsyncGenerator<never> {
  throw UpstreamError.fromStatus(429, "slow down", 10);
}
async function* badRequest(): AsyncGenerator<never> {
  throw UpstreamError.fromStatus(400, "unknown model");
}
async function* failsMidStream() {
  yield { type: "delta" as const, text: "partial " };
  throw UpstreamError.fromStatus(500, "reset");
}

/** DO's 429: no Retry-After, but the headers say the request counter is spent until the reset. */
function doStyle429(resetMs: number) {
  return async function* (): AsyncGenerator<never> {
    throw UpstreamError.fromStatus(429, "Rate limit exceeded: requests_per_minute.", undefined, undefined, {
      requestsPerWindow: 120,
      remainingRequests: 0,
      resetRequestsMs: resetMs,
      remainingTokens: 999_000,
      resetTokensMs: resetMs,
    });
  };
}

describe("429s without Retry-After (DO)", () => {
  it("takes the wait from the spent counter's reset", () => {
    expect(resetOfSpentCounter({ remainingRequests: 0, resetRequestsMs: 40_000, remainingTokens: 5, resetTokensMs: 40_000 })).toBe(40_000);
    expect(resetOfSpentCounter({ remainingRequests: 3, resetRequestsMs: 40_000 })).toBeUndefined();
    expect(resetOfSpentCounter(undefined)).toBeUndefined();
  });

  it("retries no sooner than the reset, and records why", async () => {
    const events = new MemoryEventSink();
    const result = await new ModelGateway(new ScriptedProvider([doStyle429(30), ok]), limiter(events)).complete(request, { tag: "run-1" });
    expect(result.metrics.attempts).toBe(2);
    const [retry] = events.ofKind("retry");
    expect(retry!.data).toMatchObject({ retryAfterMs: 30, errorKind: "rate_limited" });
    expect(retry!.ms).toBeGreaterThanOrEqual(30);
    expect(retry!.tag).toBe("run-1");
    expect(events.ofKind("rate_limited")).toHaveLength(1);
    expect(events.ofKind("cooldown")[0]!.data).toMatchObject({ cause: "429", decrease: true });
    expect(events.ofKind("factor_changed")[0]!.data).toMatchObject({ from: 1, to: 0.5 });
    expect(events.ofKind("attempt_failed")).toHaveLength(1);
    expect(events.ofKind("attempt_ok")).toHaveLength(1);
    expect(events.ofKind("lease_granted")).toHaveLength(2);
  });

  it("gives up at once when the reset is further away than the caller will wait", async () => {
    const provider = new ScriptedProvider([doStyle429(50_000), ok]);
    const started = Date.now();
    const events = new MemoryEventSink();
    await expect(new ModelGateway(provider, limiter(events)).complete(request, { maxQueueWaitMs: 1_000 })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(Date.now() - started).toBeLessThan(500);
    expect(provider.calls).toBe(1);
    expect(events.ofKind("attempt_failed").at(-1)!.data).toMatchObject({ errorKind: "gave_up" });
  });
});

describe("ModelGateway", () => {
  it("retries a 429, cools the bucket down, and reports attempts", async () => {
    const provider = new ScriptedProvider([rateLimited, ok]);
    const rl = limiter();
    const coolDown = vi.spyOn(rl, "coolDown");
    const retries: number[] = [];
    const gateway = new ModelGateway(provider, rl);

    const result = await gateway.complete(request, { onRetry: (r) => retries.push(r.delayMs) });

    expect(result.output).toBe("hello world ");
    expect(result.metrics.attempts).toBe(2);
    expect(result.metrics.tokensEstimated).toBe(false);
    expect(coolDown).toHaveBeenCalledWith("m", 10, "429", true, undefined);
    expect(retries[0]).toBeGreaterThanOrEqual(10); // honours Retry-After
  });

  it("does not retry non-retryable errors", async () => {
    const provider = new ScriptedProvider([badRequest, ok]);
    await expect(new ModelGateway(provider, limiter()).complete(request)).rejects.toMatchObject({ status: 400 });
    expect(provider.calls).toBe(1);
  });

  it("gives up after maxAttempts", async () => {
    const provider = new ScriptedProvider([rateLimited]);
    await expect(new ModelGateway(provider, limiter()).complete(request, { maxAttempts: 2 })).rejects.toBeInstanceOf(
      UpstreamError,
    );
    expect(provider.calls).toBe(2);
  });

  it("does not retry a stream that already sent text, and keeps the partial output", async () => {
    const provider = new ScriptedProvider([failsMidStream, ok]);
    const deltas: string[] = [];
    const error = await new ModelGateway(provider, limiter())
      .stream(request, (t) => deltas.push(t))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StreamInterruptedError);
    expect((error as StreamInterruptedError).partialOutput).toBe("partial ");
    expect(provider.calls).toBe(1);
  });

  it("times out a slow first token and retries", async () => {
    async function* slow() {
      await new Promise((r) => setTimeout(r, 200));
      yield { type: "delta" as const, text: "late" };
    }
    // The scripted generator ignores the signal, like a misbehaving SDK would;
    // the gateway must still move on.
    const provider = new ScriptedProvider([slow, ok]);
    const result = await new ModelGateway(provider, limiter()).stream(request, () => {}, {
      firstTokenTimeoutMs: 20,
      attemptTimeoutMs: 50,
    });
    expect(result.metrics.attempts).toBeGreaterThanOrEqual(1);
  });

  it("estimates usage when the provider reports none, and records ttft", async () => {
    async function* noUsage() {
      yield { type: "delta" as const, text: "abcdefgh" };
    }
    const result = await new ModelGateway(new ScriptedProvider([noUsage]), limiter()).stream(request, () => {});
    expect(result.metrics.tokensEstimated).toBe(true);
    expect(result.metrics.outputTokens).toBe(2);
    expect(result.metrics.ttftMs).toBeDefined();
    expect(result.metrics.costUsd).toBeNull(); // "m" has no known price
  });

  it("treats reasoning chunks as alive, so a slow thinker is not timed out", async () => {
    async function* thinker() {
      yield { type: "thinking" as const };
      await new Promise((r) => setTimeout(r, 60));
      yield { type: "delta" as const, text: "answer" };
    }
    const provider = new ScriptedProvider([thinker]);
    const result = await new ModelGateway(provider, limiter()).stream(request, () => {}, { firstTokenTimeoutMs: 20 });
    expect(result.output).toBe("answer");
    expect(provider.calls).toBe(1);
  });

  async function* allThinking() {
    yield { type: "thinking" as const };
    yield { type: "finish" as const, reason: "length" };
  }

  it("retries once with a bigger budget when a reasoning model runs out of tokens", async () => {
    const provider = new ScriptedProvider([allThinking, ok]);
    const reasons: string[] = [];
    const result = await new ModelGateway(provider, limiter()).stream(request, () => {}, { onRetry: (r) => reasons.push(r.reason) });
    expect(provider.maxTokens).toEqual([32, 128]);
    expect(result.metrics).toMatchObject({ attempts: 2, maxTokensRaisedTo: 128 });
    expect(reasons[0]).toMatch(/ran out of tokens while reasoning/);
  });

  it("fails clearly if the bigger budget runs out too, without retrying again", async () => {
    const provider = new ScriptedProvider([allThinking]);
    await expect(new ModelGateway(provider, limiter()).stream(request, () => {})).rejects.toThrow(/Used all 128 max tokens on reasoning/);
    expect(provider.calls).toBe(2); // the same budget would fail the same way
  });

  it("feeds rate-limit headers to the limiter", async () => {
    async function* withLimits() {
      yield { type: "limits" as const, limits: { requestsPerWindow: 120, tokensPerWindow: 1_000_000 } };
      yield { type: "delta" as const, text: "ok" };
    }
    const rl = limiter();
    const observe = vi.spyOn(rl, "observe");
    await new ModelGateway(new ScriptedProvider([withLimits]), rl).stream(request, () => {});
    expect(observe).toHaveBeenCalledWith("m", { requestsPerWindow: 120, tokensPerWindow: 1_000_000 }, undefined);
  });

  it("measures decode speed from the first chunk, and flags reasoning", async () => {
    async function* slowThinker() {
      yield { type: "thinking" as const };
      await new Promise((r) => setTimeout(r, 150));
      yield { type: "delta" as const, text: "answer" };
      yield { type: "usage" as const, usage: { inputTokens: 3, outputTokens: 30 } };
    }
    const result = await new ModelGateway(new ScriptedProvider([slowThinker]), limiter()).stream(request, () => {});
    expect(result.metrics.reasoned).toBe(true);
    expect(result.metrics.outputTokensPerSec).toBeGreaterThan(100);
    expect(result.metrics.outputTokensPerSec).toBeLessThan(220);
    expect(tokensPerSecond(100, 1_000, 3_000)).toBe(50);
    expect(tokensPerSecond(100, undefined, 3_000)).toBeUndefined(); // not streamed
  });
});
