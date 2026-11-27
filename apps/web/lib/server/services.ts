import { prisma } from "@fomo/db";
import { createGatewayFromEnv, type ModelGateway } from "@fomo/llm";

/**
 * Process-wide singletons. Parked on globalThis so Next.js hot reload in dev
 * does not create a new connection pool on every edit.
 */
const g = globalThis as unknown as { gateway?: ModelGateway };

export function getGateway(): ModelGateway {
  g.gateway ??= createGatewayFromEnv(prisma, "web");
  return g.gateway;
}

export { prisma };
