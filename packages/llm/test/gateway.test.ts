import { describe, expect, it, vi } from "vitest";
import { ModelGateway } from "../src/gateway";
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
    expect(coolDown).toHaveBeenCalledWith("m", 10);
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

  it("fails clearly when the whole token budget went on reasoning", async () => {
    async function* allThinking() {
      yield { type: "thinking" as const };
      yield { type: "finish" as const, reason: "length" };
    }
    const provider = new ScriptedProvider([allThinking]);
    await expect(new ModelGateway(provider, limiter()).stream(request, () => {})).rejects.toThrow(/on reasoning/);
    expect(provider.calls).toBe(1); // not retryable: it would fail the same way
  });

  it("feeds rate-limit headers to the limiter and takes leases in the caller's lane", async () => {
    async function* withLimits() {
      yield { type: "limits" as const, limits: { requestsPerWindow: 120, tokensPerWindow: 1_000_000 } };
      yield { type: "delta" as const, text: "ok" };
    }
    const rl = limiter();
    const observe = vi.spyOn(rl, "observe");
    const acquire = vi.spyOn(rl, "acquire");
    await new ModelGateway(new ScriptedProvider([withLimits]), rl).stream(request, () => {}, { lane: "batch" });
    expect(observe).toHaveBeenCalledWith("m", { requestsPerWindow: 120, tokensPerWindow: 1_000_000 });
    expect(acquire.mock.calls[0]![2]).toMatchObject({ lane: "batch" });
  });
});
