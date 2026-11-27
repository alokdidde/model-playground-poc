import { describe, expect, it } from "vitest";
import { compareReducer, initialCompareState, restoreCompareState, type SavedComparison } from "../lib/compare-state";

describe("compareReducer", () => {
  it("accumulates deltas and keeps other models independent", () => {
    let s = compareReducer(initialCompareState, { type: "start", models: ["a", "b"], judge: true, synthesize: false });
    s = compareReducer(s, { type: "event", event: { type: "model.delta", model: "a", text: "Hel" } });
    s = compareReducer(s, { type: "event", event: { type: "model.delta", model: "a", text: "lo" } });
    s = compareReducer(s, {
      type: "event",
      event: {
        type: "model.failed",
        model: "b",
        partialOutput: "par",
        problem: { type: "/problems/upstream-error", title: "x", status: 502 },
      },
    });
    expect(s.panels.a).toMatchObject({ status: "streaming", output: "Hello" });
    expect(s.panels.b).toMatchObject({ status: "failed", output: "par" });
    expect(s.judge.status).toBe("pending");
  });

  it("clears retry notes once tokens arrive", () => {
    let s = compareReducer(initialCompareState, { type: "start", models: ["a"], judge: false, synthesize: false });
    s = compareReducer(s, { type: "event", event: { type: "model.retrying", model: "a", attempt: 1, delayMs: 900, reason: "429" } });
    expect(s.panels.a?.note).toContain("Retry 1");
    s = compareReducer(s, { type: "event", event: { type: "model.delta", model: "a", text: "x" } });
    expect(s.panels.a?.note).toBeUndefined();
  });
});

describe("compareReducer synthesis", () => {
  it("streams the merged answer and skips it when it never starts", () => {
    let s = compareReducer(initialCompareState, { type: "start", models: ["a", "b"], judge: false, synthesize: true });
    expect(s.synthesis.status).toBe("pending");
    s = compareReducer(s, { type: "event", event: { type: "synthesis.started", model: "j" } });
    s = compareReducer(s, { type: "event", event: { type: "synthesis.delta", text: "Merged " } });
    s = compareReducer(s, { type: "event", event: { type: "synthesis.delta", text: "answer" } });
    expect(s.synthesis).toMatchObject({ status: "running", output: "Merged answer", model: "j" });

    let skipped = compareReducer(initialCompareState, { type: "start", models: ["a"], judge: false, synthesize: true });
    skipped = compareReducer(skipped, { type: "event", event: { type: "comparison.completed", comparisonId: "c", status: "COMPLETED" } });
    expect(skipped.synthesis.status).toBe("off");
  });
});

describe("restoreCompareState", () => {
  const result = (model: string, over: Partial<SavedComparison["results"][number]> = {}): SavedComparison["results"][number] => ({
    model,
    status: "SUCCEEDED",
    output: `answer ${model}`,
    settings: null,
    rating: null,
    problem: null,
    latencyMs: 1000,
    ttftMs: 200,
    outputTokensPerSec: null,
    reasoned: null,
    inputTokens: 10,
    outputTokens: 20,
    tokensEstimated: false,
    costUsd: 0.001,
    attempts: 1,
    ...over,
  });
  const saved: SavedComparison = {
    id: "c1",
    prompt: "hi",
    systemPrompt: null,
    models: ["a", "b", "c"],
    taskType: "general",
    priority: null,
    status: "PARTIAL",
    createdAt: "2026-11-27T00:00:00Z",
    synthesis: "merged",
    synthesisModel: "j",
    results: [result("a"), result("b", { status: "FAILED", problem: { type: "x", title: "boom", status: 502 } })],
    judgement: { judgeModel: "j", selfJudged: false, winnerModel: "a", rationale: "r", scores: [], latencyMs: 5, costUsd: null },
    vote: null,
  };

  it("rebuilds panels in the original order, with metrics, judge and synthesis", () => {
    const s = restoreCompareState(saved);
    expect(s.order).toEqual(["a", "b", "c"]);
    expect(s.panels.a).toMatchObject({ status: "done", output: "answer a", metrics: { ttftMs: 200, outputTokensPerSec: undefined } });
    expect(s.panels.b).toMatchObject({ status: "failed", problem: { title: "boom" } });
    expect(s.panels.c).toMatchObject({ status: "failed", problem: { title: "No result saved" } });
    expect(s.judge.verdict?.winnerModel).toBe("a");
    expect(s.synthesis).toMatchObject({ status: "done", output: "merged" });
  });
});
