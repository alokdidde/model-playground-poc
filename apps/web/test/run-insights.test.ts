import { describe, expect, it } from "vitest";
import type { JudgeVerdict } from "@fomo/shared";
import { criterionReading, isJsonAnswer, monthlyCost, paretoFront, readableRationale, verdictConfidence } from "../lib/run-insights";

const verdict = (scores: [string, number][], extra: Partial<JudgeVerdict> = {}): JudgeVerdict =>
  ({
    scores: scores.map(([model, overall], i) => ({ model, label: String.fromCharCode(65 + i), accuracy: overall, helpfulness: overall, clarity: overall, overall })),
    winnerModel: scores[0]![0],
    rationale: "",
    selfJudged: false,
    positionConsistent: true,
    orders: 2,
    ...extra,
  }) as JudgeVerdict;

describe("verdictConfidence", () => {
  it("is clear when both orders agree and the lead is over 1 point", () => {
    expect(verdictConfidence(verdict([["a", 10], ["b", 6.5]]))).toEqual({ kind: "clear", gap: 3.5 });
  });
  it("is a close call within 1 point", () => {
    expect(verdictConfidence(verdict([["a", 8], ["b", 7.5]]))).toEqual({ kind: "close", gap: 0.5 });
  });
  it("is a flip when the order changed the winner", () => {
    expect(verdictConfidence(verdict([["a", 8], ["b", 6]], { positionConsistent: false, winnerModel: null }))).toEqual({ kind: "flip" });
  });
});

describe("readableRationale", () => {
  it("swaps 'Response B (model-id)' for the display name", () => {
    const label = (id: string) => ({ "glm-5.3-flash": "GLM-5.3 Flash" })[id] ?? id;
    expect(readableRationale("Response B (glm-5.3-flash) returns pure JSON.", label)).toBe("GLM-5.3 Flash returns pure JSON.");
  });
});

describe("criterionReading", () => {
  it("names a leader only beyond half a point", () => {
    expect(criterionReading([{ model: "a", value: 9 }, { model: "b", value: 7 }])).toEqual({ leader: "a", gap: 2 });
    expect(criterionReading([{ model: "a", value: 9 }, { model: "b", value: 8.5 }])).toEqual({ leader: null, gap: 0.5 });
  });
});

describe("paretoFront", () => {
  it("drops models that another beats on both cost and score", () => {
    const front = paretoFront([
      { model: "cheap", cost: 1, score: 6 },
      { model: "best", cost: 3, score: 9 },
      { model: "worse", cost: 2, score: 5 },
    ]);
    expect([...front].sort()).toEqual(["best", "cheap"]);
  });
});

describe("small helpers", () => {
  it("prices a month of calls", () => expect(monthlyCost(0.00007, 10_000)).toBeCloseTo(21));
  it("spots a whole-JSON answer", () => {
    expect(isJsonAnswer('{"name": "Ravi"}')).toBe(true);
    expect(isJsonAnswer("Here it is: {}")).toBe(false);
  });
});
