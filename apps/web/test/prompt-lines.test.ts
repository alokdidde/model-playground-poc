import { describe, expect, it } from "vitest";
import { parsePromptLines } from "../lib/prompt-lines";

describe("parsePromptLines", () => {
  it("reads one prompt per line, with optional expected answers", () => {
    expect(parsePromptLines("What is 17 x 23? => 391\n\n  Summarise this  \nUse => in code")).toEqual([
      { prompt: "What is 17 x 23?", expected: "391" },
      { prompt: "Summarise this" },
      { prompt: "Use", expected: "in code" },
    ]);
  });

  it("keeps an arrow without spaces as part of the prompt", () => {
    expect(parsePromptLines("map x=>x+1")).toEqual([{ prompt: "map x=>x+1" }]);
  });
});
