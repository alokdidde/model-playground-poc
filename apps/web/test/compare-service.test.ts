import { describe, expect, it, vi } from "vitest";
import { ModelGateway, UpstreamError, type ChatProvider, type ChatRequest, type StreamChunk } from "@fomo/llm";
import { MemoryLeaseStore, RateLimiter } from "@fomo/ratelimit";
import { CompareRequestSchema, type CompareEvent } from "@fomo/shared";

/**
 * The core interactive path, end to end with no network and no database:
 * three models, one of which fails, then the judge and the synthesizer.
 */

const JUDGE = "openai-gpt-oss-120b";
const BROKEN = "mistral-3-14B";

/** Contestants stream a short answer; BROKEN is rejected (400, not retried); the judge returns valid JSON. */
class FakeProvider implements ChatProvider {
  readonly name = "fake";
  async listModels() {
    return [];
  }
  async complete(request: ChatRequest) {
    // Only the judge uses complete(). Two answers are labelled A and B (in shuffled order).
    return {
      text: JSON.stringify({
        scores: [
          { label: "A", accuracy: 8, helpfulness: 8, clarity: 8, overall: 8 },
          { label: "B", accuracy: 6, helpfulness: 6, clarity: 6, overall: 6 },
        ],
        winner: "A",
        rationale: "Response A is more precise.",
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
      model: request.model,
    };
  }
  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    if (request.model === BROKEN) throw UpstreamError.fromStatus(400, "bad request");
    const text = request.model === JUDGE ? "Merged answer [Model]" : `answer from ${request.model}`;
    for (const word of text.split(" ")) yield { type: "delta", text: `${word} ` };
    yield { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } };
  }
}

// In-memory stand-ins for the database rows the service writes.
const db = vi.hoisted(() => ({ results: [] as { model: string; status: string }[], judgements: [] as unknown[], updates: [] as unknown[] }));

vi.mock("../lib/server/services", () => {
  const limiter = new RateLimiter(new MemoryLeaseStore(), {
    requestsPerWindow: 1_000,
    tokensPerWindow: 10_000_000,
    maxInFlight: 100,
    windowMs: 60_000,
    leaseTtlMs: 60_000,
    batchShare: 0.3,
  });
  const gateway = new ModelGateway(new FakeProvider(), limiter);
  const prisma = {
    compareResult: { create: async ({ data }: { data: { model: string; status: string } }) => db.results.push(data) },
    judgement: { create: async ({ data }: { data: unknown }) => db.judgements.push(data) },
    comparison: { update: async (args: unknown) => db.updates.push(args) },
  };
  return { getGateway: () => gateway, prisma };
});

describe("executeComparison", () => {
  it("keeps going when one model fails: the run ends PARTIAL and the judge and synthesis still run", async () => {
    const { executeComparison } = await import("../lib/server/compare-service");
    const input = CompareRequestSchema.parse({
      prompt: "Explain CAP in one paragraph",
      models: ["deepseek-v4.1-flash", "glm-5.3-flash", BROKEN],
    });
    const events: CompareEvent[] = [];

    await executeComparison({ id: "cmp_1" } as never, input, (e) => events.push(e), new AbortController().signal);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("comparison.started");
    expect(types.at(-1)).toBe("comparison.completed");
    expect(events.filter((e) => e.type === "model.completed")).toHaveLength(2);

    const failed = events.find((e) => e.type === "model.failed");
    expect(failed && "model" in failed && failed.model).toBe(BROKEN);

    const verdict = events.find((e) => e.type === "judge.completed");
    expect(verdict && "verdict" in verdict && verdict.verdict.judgeModel).toBe(JUDGE);
    // The fake judge always picks "A", which is a different model once the order is reversed:
    // a position flip, so the verdict is a tie.
    expect(verdict && "verdict" in verdict && verdict.verdict.orders).toBe(2);
    expect(verdict && "verdict" in verdict && verdict.verdict.positionConsistent).toBe(false);
    expect(verdict && "verdict" in verdict && verdict.verdict.winnerModel).toBeNull();
    expect(types).toContain("synthesis.completed");

    const done = events.at(-1);
    expect(done && "status" in done && done.status).toBe("PARTIAL");

    // Every model gets exactly one stored result, failures included.
    expect(db.results.map((r) => [r.model, r.status]).sort()).toEqual([
      ["deepseek-v4.1-flash", "SUCCEEDED"],
      ["glm-5.3-flash", "SUCCEEDED"],
      [BROKEN, "FAILED"],
    ]);
    expect(db.judgements).toHaveLength(1);
  });
});
