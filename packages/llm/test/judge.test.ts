import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/mock-provider";
import { ModelGateway } from "../src/gateway";
import { parseVerdict, pickJudgeModel, runJudge, shuffle } from "../src/judge";
import { limiter } from "./helpers";

describe("pickJudgeModel", () => {
  it("prefers a judge that is not competing", () => {
    expect(pickJudgeModel(["a", "b"], "a", ["b", "c"])).toEqual({ judgeModel: "c", selfJudged: false });
  });
  it("flags self-judging when there is no neutral option", () => {
    expect(pickJudgeModel(["a", "b"], "a", ["b"])).toEqual({ judgeModel: "a", selfJudged: true });
  });
});

describe("parseVerdict", () => {
  it("tolerates code fences and drops unknown labels", () => {
    const text =
      '```json\n{"scores":[{"label":"A","accuracy":8,"helpfulness":7,"clarity":9,"overall":8},{"label":"Z","accuracy":1,"helpfulness":1,"clarity":1,"overall":1}],"winner":"Z","rationale":"A is best"}\n```';
    const verdict = parseVerdict(text, ["A", "B"]);
    expect(verdict.scores.map((s) => s.label)).toEqual(["A"]);
    expect(verdict.winner).toBeNull();
  });
  it("rejects prose", () => {
    expect(() => parseVerdict("I think A is better", ["A"])).toThrow(/JSON/);
  });
});

describe("shuffle", () => {
  it("is a permutation", () => {
    expect(shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("runJudge (mock provider)", () => {
  it("maps anonymous labels back to model ids", async () => {
    const provider = new MockProvider({ rateLimitRate: 0, errorRate: 0, speed: 0, random: Math.random });
    const verdict = await runJudge(new ModelGateway(provider, limiter()), {
      prompt: "What is 2+2?",
      candidates: [
        { model: "model-x", output: "4" },
        { model: "model-y", output: "5" },
      ],
      judgeModel: "judge",
      selfJudged: false,
    });
    expect(verdict.scores.map((s) => s.model).sort()).toEqual(["model-x", "model-y"]);
    expect(["model-x", "model-y"]).toContain(verdict.winnerModel);
  });
});
