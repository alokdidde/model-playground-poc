import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/advisor";

describe("parseIntent", () => {
  it("reads the intent JSON even with prose around it, and coerces numbers", () => {
    const text = `Here you go:
{"taskType":"chat","priority":{"quality":"0.4","cost":0.4,"speed":0.2},"maxCostPerCallUsd":null,"maxLatencyMs":2000,
 "samplePrompts":["Where is my order?"],"summary":"A cheap, fast support bot."}`;
    expect(parseIntent(text)).toMatchObject({ taskType: "chat", priority: { quality: 0.4, cost: 0.4, speed: 0.2 }, maxLatencyMs: 2000 });
  });

  it("normalises weights to shares that add up to 1", () => {
    const text = '{"taskType":"chat","priority":{"quality":0.2,"cost":0.7,"speed":0.7},"samplePrompts":["x"],"summary":"s"}';
    expect(parseIntent(text).priority).toEqual({ quality: 0.13, cost: 0.44, speed: 0.44 });
  });

  it("falls back to balanced weights when all are zero", () => {
    const text = '{"taskType":"general","priority":{"quality":0,"cost":0,"speed":0},"samplePrompts":["x"],"summary":"s"}';
    expect(parseIntent(text).priority).toEqual({ quality: 0.6, cost: 0.25, speed: 0.15 });
  });

  it("rejects unknown task types and missing JSON", () => {
    expect(() => parseIntent('{"taskType":"poetry","priority":{"quality":1,"cost":0,"speed":0},"samplePrompts":["x"],"summary":"s"}')).toThrow(
      /wrong shape/,
    );
    expect(() => parseIntent("I think you should use model X")).toThrow(/did not return JSON/);
  });
});
