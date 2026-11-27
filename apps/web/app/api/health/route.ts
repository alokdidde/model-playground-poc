import { isMockMode } from "@fomo/llm";
import { apiRoute, json } from "@/lib/server/api";
import { prisma } from "@/lib/server/services";

export const dynamic = "force-dynamic";

/** Liveness + readiness for App Platform's health check. */
export const GET = apiRoute({
  handler: async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "ok", mockMode: isMockMode() };
    } catch {
      return json({ status: "degraded", database: "unreachable" }, 503);
    }
  },
});
