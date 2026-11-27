import { describe, expect, it } from "vitest";
import { linkCitations } from "../lib/citations";

describe("linkCitations", () => {
  it("turns [Model] and 【Model】 into cite links but leaves real links alone", () => {
    expect(linkCitations("A [GLM-5.3 Flash] B 【Kimi K2.6】 [docs](https://x.io)")).toBe(
      "A [GLM-5.3 Flash](#cite) B [Kimi K2.6](#cite) [docs](https://x.io)",
    );
  });
});
