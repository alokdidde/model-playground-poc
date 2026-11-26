import { describe, expect, it } from "vitest";
import { SseParser, encodeSseEvent, SSE_HEARTBEAT } from "../src/sse";

describe("SseParser", () => {
  it("parses frames split across arbitrary chunk boundaries", () => {
    const wire =
      encodeSseEvent({ type: "a", n: 1 } as { type: string }) +
      SSE_HEARTBEAT +
      encodeSseEvent({ type: "b", text: "hello\nworld" } as { type: string });
    const parser = new SseParser<{ type: string }>();
    const out: { type: string }[] = [];
    for (let i = 0; i < wire.length; i += 7) out.push(...parser.push(wire.slice(i, i + 7)));
    expect(out).toEqual([
      { type: "a", n: 1 },
      { type: "b", text: "hello\nworld" },
    ]);
  });
});
