import { describe, expect, it } from "vitest";
import { compareReducer, initialCompareState } from "../lib/compare-state";

describe("compareReducer", () => {
  it("accumulates deltas and keeps other models independent", () => {
    let s = compareReducer(initialCompareState, { type: "start", models: ["a", "b"], judge: true });
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
    let s = compareReducer(initialCompareState, { type: "start", models: ["a"], judge: false });
    s = compareReducer(s, { type: "event", event: { type: "model.retrying", model: "a", attempt: 1, delayMs: 900, reason: "429" } });
    expect(s.panels.a?.note).toContain("Retry 1");
    s = compareReducer(s, { type: "event", event: { type: "model.delta", model: "a", text: "x" } });
    expect(s.panels.a?.note).toBeUndefined();
  });
});
