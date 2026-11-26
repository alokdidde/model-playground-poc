import { describe, expect, it } from "vitest";
import { runChecks } from "../src/checks";

describe("runChecks", () => {
  it("checks short references literally, ignoring case and markdown", () => {
    expect(runChecks({ prompt: "17 x 23?", expected: "391", taskType: "reasoning", output: "The answer is **391**." })).toEqual([
      { name: "matches_reference", passed: true, detail: 'contains "391"' },
    ]);
    expect(runChecks({ prompt: "17 x 23?", expected: "391", taskType: "reasoning", output: "It is 381." })[0]!.passed).toBe(false);
  });

  it("checks long references by key words", () => {
    const expected = "Decoupling: producers and consumers scale independently and survive each other's outages";
    const [check] = runChecks({ prompt: "q", expected, taskType: "general", output: "Decoupling lets producers and consumers scale independently." });
    expect(check!.passed).toBe(true);
  });

  it("checks JSON for extraction tasks or prompts that ask for JSON", () => {
    expect(runChecks({ prompt: "Extract the name", taskType: "extraction", output: '```json\n{"name":"Ada"}\n```' })[0]).toMatchObject({
      name: "valid_json",
      passed: true,
    });
    expect(runChecks({ prompt: "Reply in JSON", taskType: "general", output: 'Sure! {"a":1}' })[0]!.passed).toBe(false);
    expect(runChecks({ prompt: "Write a poem", taskType: "writing", output: "Roses" })).toEqual([]);
  });
});
