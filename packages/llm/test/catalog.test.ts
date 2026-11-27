import { describe, expect, it } from "vitest";
import { describeModel } from "../src/catalog";

/** What the catalog offers: only text models this account can actually call. */
describe("describeModel", () => {
  const usable = (id: string) => {
    const m = describeModel(id);
    return m.kind === "chat" && m.available;
  };

  it("offers open-weight chat models", () => {
    expect(usable("glm-5.3-flash")).toBe(true);
    expect(usable("openai-gpt-oss-120b")).toBe(true);
  });

  it("leaves out plan-blocked models (403) and listed-but-missing ones (404)", () => {
    expect(usable("anthropic-claude-sonnet-4")).toBe(false);
    expect(usable("openai-gpt-5")).toBe(false);
    expect(usable("typesafe-jev-1.13.0")).toBe(false);
  });

  it("leaves out routers and non-text models", () => {
    expect(describeModel("router:general").kind).toBe("router");
    expect(usable("router:general")).toBe(false);
    expect(usable("bge-large-en-embed")).toBe(false);
  });
});
