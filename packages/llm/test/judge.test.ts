import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/mock-provider";
import { ModelGateway } from "../src/gateway";
import { combineOrders, parseVerdict, pickJudgeModel, runJudge, shuffle, type OneOrder } from "../src/judge";
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

describe("buildJudgePrompt task focus", () => {
  it("adds the task-specific focus only for non-general tasks", async () => {
    const { buildJudgePrompt } = await import("../src/judge");
    const labelled = [{ label: "A", output: "42" }];
    expect(buildJudgePrompt("q", labelled)).not.toContain("Task type");
    expect(buildJudgePrompt("q", labelled, undefined, "reasoning")).toMatch(/^## Task type: Reasoning & math\n.*final answer/);
  });
});

describe("combineOrders (position bias)", () => {
  const metrics = { latencyMs: 100, inputTokens: 10, outputTokens: 5, tokensEstimated: false, costUsd: 0.001, attempts: 1 };
  const order = (winner: string | null, x: number, y: number): OneOrder => ({
    winnerModel: winner,
    rationale: "because",
    scores: [
      { model: "x", label: "A", accuracy: x, helpfulness: x, clarity: x, overall: x },
      { model: "y", label: "B", accuracy: y, helpfulness: y, clarity: y, overall: y },
    ],
    metrics,
  });

  it("keeps the winner when both orders agree, and averages the scores", () => {
    const v = combineOrders([order("x", 9, 6), order("x", 8, 7)]);
    expect(v.winnerModel).toBe("x");
    expect(v.positionConsistent).toBe(true);
    expect(v.scores.find((s) => s.model === "x")!.overall).toBe(8.5);
    expect(v.metrics.costUsd).toBeCloseTo(0.002);
  });

  it("counts a position flip as a tie", () => {
    const v = combineOrders([order("x", 9, 6), order("y", 6, 9)]);
    expect(v.winnerModel).toBeNull();
    expect(v.positionConsistent).toBe(false);
    expect(v.rationale).toMatch(/^Tie/);
  });

  it("uses a single order as is when the other call failed", () => {
    const v = combineOrders([order("y", 5, 7)]);
    expect(v).toMatchObject({ winnerModel: "y", orders: 1, positionConsistent: null });
  });
});

describe("runJudge order", () => {
  it("judges twice, the second time in reverse order", async () => {
    const seen: string[] = [];
    const gateway = {
      complete: async (req: { messages: { content: string }[] }) => {
        const user = req.messages[1]!.content;
        seen.push(user.indexOf("first answer") < user.indexOf("second answer") ? "first-then-second" : "second-then-first");
        return {
          output: '{"scores":[{"label":"A","accuracy":7,"helpfulness":7,"clarity":7,"overall":7},{"label":"B","accuracy":7,"helpfulness":7,"clarity":7,"overall":7}],"winner":"A","rationale":"ok"}',
          metrics: { latencyMs: 1, inputTokens: 1, outputTokens: 1, tokensEstimated: false, costUsd: 0, attempts: 1 },
        };
      },
    } as unknown as ModelGateway;
    await runJudge(gateway, {
      prompt: "q",
      candidates: [
        { model: "m1", output: "first answer" },
        { model: "m2", output: "second answer" },
      ],
      judgeModel: "j",
      selfJudged: false,
      random: () => 0.99, // shuffle keeps the order
    });
    expect(seen.sort()).toEqual(["first-then-second", "second-then-first"]);
  });
});

describe("buildJudgePrompt checks", () => {
  it("adds automatic check results under each response", async () => {
    const { buildJudgePrompt } = await import("../src/judge");
    const text = buildJudgePrompt("q", [{ label: "A", output: "{}", checks: [{ name: "valid_json", passed: false }] }], "42");
    expect(text).toContain("## Reference answer");
    expect(text).toContain("Automatic checks on Response A:\n- is valid JSON: FAILED");
  });
});
