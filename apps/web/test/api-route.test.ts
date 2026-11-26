import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiRoute } from "../lib/server/api";
import { errors } from "../lib/server/errors";

const segment = { params: Promise.resolve({}) };
const post = (body: string, contentType = "application/json") =>
  new NextRequest("http://localhost/api/thing", {
    method: "POST",
    body,
    headers: { "content-type": contentType, "x-request-id": "req-12345678" },
  });

const route = apiRoute({
  body: z.object({ name: z.string().min(1), count: z.number().int() }),
  handler: async ({ body }) => {
    if (body.name === "boom") throw new Error("database password is hunter2");
    if (body.name === "missing") throw errors.notFound("Thing", "42");
    return { ok: true, name: body.name };
  },
});

describe("apiRoute", () => {
  it("passes validated input to the handler", async () => {
    const res = await route(post(JSON.stringify({ name: "a", count: 1 })), segment);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "a" });
    expect(res.headers.get("x-request-id")).toBe("req-12345678");
  });

  it("returns RFC 9457 problems with field pointers for invalid bodies", async () => {
    const res = await route(post(JSON.stringify({ name: "", count: 1.5 })), segment);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const problem = await res.json();
    expect(problem).toMatchObject({ type: "/problems/validation-error", status: 400, instance: "/api/thing", requestId: "req-12345678" });
    expect(problem.errors.map((e: { pointer: string }) => e.pointer).sort()).toEqual(["body.count", "body.name"]);
  });

  it("rejects malformed JSON and the wrong content type", async () => {
    expect((await route(post("{nope"), segment)).status).toBe(400);
    expect((await route(post("x", "text/plain"), segment)).status).toBe(415);
  });

  it("maps ApiError to its status", async () => {
    const res = await route(post(JSON.stringify({ name: "missing", count: 1 })), segment);
    expect(res.status).toBe(404);
    expect((await res.json()).title).toBe("Thing not found");
  });

  it("hides internal error details", async () => {
    const res = await route(post(JSON.stringify({ name: "boom", count: 1 })), segment);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
  });
});
