import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

/**
 * One PrismaClient per process. In Next.js dev mode modules are re-evaluated
 * on every hot reload, so we park the client on globalThis to avoid opening a
 * new connection pool each time.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
