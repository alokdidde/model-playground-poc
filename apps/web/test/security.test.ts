import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { CompareRequestSchema } from "@fomo/shared";
import { Markdown } from "../components/markdown";
import { apiRoute, isJsonContentType } from "../lib/server/api";
import { isCrossSiteWrite, middleware } from "../middleware";

/** The fixes from the security audit (see docs/SECURITY.md), one block each. */

vi.mock("../lib/server/services", () => ({
  getGateway: () => ({
    provider: {
      listModels: async () => [
        { id: "glm-5.3-flash", kind: "chat", available: true },
        { id: "openai-gpt-oss-120b", kind: "chat", available: true },
        { id: "anthropic-claude-test", kind: "chat", available: false },
        { id: "bge-embed", kind: "embedding", available: false },
      ],
    },
  }),
  prisma: {},
}));

describe("JSON content type (CSRF via simple requests)", () => {
  it("accepts application/json with parameters only", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("Application/JSON; charset=utf-8")).toBe(true);
    expect(isJsonContentType("text/plain; application/json")).toBe(false);
    expect(isJsonContentType("text/plain")).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
  });

  it("rejects a text/plain body that merely mentions application/json", async () => {
    const route = apiRoute({ body: z.object({}), handler: async () => ({ ok: true }) });
    const req = new NextRequest("http://localhost/api/x", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "text/plain; application/json" },
    });
    expect((await route(req, { params: Promise.resolve({}) })).status).toBe(415);
  });
});

describe("cross-site write guard", () => {
  const req = (method: string, headers: Record<string, string>) =>
    new NextRequest("https://app.example/api/compare", { method, headers: { host: "app.example", ...headers } });

  it("lets reads and same-origin writes through", () => {
    expect(isCrossSiteWrite(req("GET", { "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isCrossSiteWrite(req("POST", { "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSiteWrite(req("POST", { origin: "https://app.example" }))).toBe(false);
    // curl and scripts send neither header: not a CSRF vector.
    expect(isCrossSiteWrite(req("POST", {}))).toBe(false);
  });

  it("refuses writes from other sites, including sibling *.ondigitalocean.app apps", () => {
    expect(isCrossSiteWrite(req("POST", { "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(isCrossSiteWrite(req("PUT", { "sec-fetch-site": "same-site" }))).toBe(true);
    expect(isCrossSiteWrite(req("POST", { origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSiteWrite(req("POST", { origin: "null" }))).toBe(true);
  });

  it("middleware answers 403 problem+json", async () => {
    const res = await middleware(req("POST", { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ type: "/problems/forbidden", status: 403 });
  });
});

describe("compare model ids must come from the catalog", () => {
  const input = (models: string[], judgeModel?: string) =>
    CompareRequestSchema.parse({ prompt: "hi", models, judge: { enabled: true, model: judgeModel } });

  it("accepts catalog chat models", async () => {
    const { unknownModels } = await import("../lib/server/compare-service");
    expect(await unknownModels(input(["glm-5.3-flash", "openai-gpt-oss-120b"]))).toEqual([]);
  });

  it("rejects made-up ids and non-chat models, so a request cannot fan out unboundedly", async () => {
    const { unknownModels } = await import("../lib/server/compare-service");
    const many = Array.from({ length: 500 }, (_, i) => `fake-${i}`);
    expect(await unknownModels(input(many))).toHaveLength(500);
    const problems = await unknownModels(input(["glm-5.3-flash", "bge-embed"], "nope"));
    expect(problems.map((p) => p.pointer)).toEqual(["body.models.1", "body.judge.model"]);
  });

  it("rejects chat models the plan cannot call, instead of letting them fail with a 403", async () => {
    const { unknownModels } = await import("../lib/server/compare-service");
    const problems = await unknownModels(input(["glm-5.3-flash", "anthropic-claude-test"]));
    expect(problems.map((p) => p.pointer)).toEqual(["body.models.1"]);
  });
});

describe("Markdown renders model output safely", () => {
  const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

  it("does not render raw HTML", () => {
    const html = render('<img src=x onerror="alert(1)"><script>alert(2)</script>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });

  it("drops javascript: links", () => {
    expect(render("[click](javascript:alert(1))")).not.toContain("javascript:");
  });

  it("turns images into links, so nothing is fetched from a URL a model chose", () => {
    const html = render("![x](https://evil.example/pixel?q=secret)");
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://evil.example/pixel?q=secret"');
  });
});
