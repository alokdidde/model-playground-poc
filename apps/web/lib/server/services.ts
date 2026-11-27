import { DBOSClient } from "@dbos-inc/dbos-sdk";
import { dbosSystemDatabaseUrl, prisma } from "@fomo/db";
import { createGatewayFromEnv, type ModelGateway } from "@fomo/llm";

/**
 * Process-wide singletons. Parked on globalThis so Next.js hot reload in dev
 * does not create a new connection pool on every edit.
 */
const g = globalThis as unknown as { gateway?: ModelGateway; dbosClient?: Promise<DBOSClient> };

export function getGateway(): ModelGateway {
  g.gateway ??= createGatewayFromEnv(prisma, "web");
  return g.gateway;
}

/**
 * The web app does not run workflows; it only enqueues them by name into
 * DBOS's Postgres-backed queues, and the worker picks them up.
 */
export function getDbosClient(): Promise<DBOSClient> {
  if (!g.dbosClient) {
    g.dbosClient = DBOSClient.create({ systemDatabaseUrl: dbosSystemDatabaseUrl(), applicationName: "model-fomo" }).catch((error: unknown) => {
      g.dbosClient = undefined; // let the next request try again
      throw error;
    });
  }
  return g.dbosClient;
}

export { prisma };
