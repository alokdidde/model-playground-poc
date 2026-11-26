import { DBOS } from "@dbos-inc/dbos-sdk";
import { isMockMode } from "@fomo/llm";
import { QUEUES } from "@fomo/shared";
import { prisma } from "./services";
import "./workflows"; // registers the workflows; must happen before DBOS.launch()

function intFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {
  const systemDatabaseUrl = process.env.DBOS_SYSTEM_DATABASE_URL;
  if (!systemDatabaseUrl) throw new Error("DBOS_SYSTEM_DATABASE_URL is not set");

  // Must match the applicationName the web app's DBOSClient uses.
  DBOS.setConfig({ name: "model-fomo", systemDatabaseUrl });
  await DBOS.launch();

  // Queue settings live in Postgres, so they are registered after launch.
  // The DBOS queue limits are coarse, per-worker flow control. The precise,
  // global RPM/TPM budget (shared with the web app) is the lease store.
  await DBOS.registerQueue(QUEUES.evalRuns, { workerConcurrency: intFromEnv("EVAL_RUN_CONCURRENCY", 2) });
  await DBOS.registerQueue(QUEUES.evalPrompts, { workerConcurrency: intFromEnv("EVAL_PROMPT_CONCURRENCY", 8) });
  await DBOS.registerQueue(QUEUES.modelCalls, {
    workerConcurrency: intFromEnv("MODEL_CALL_CONCURRENCY", 8),
    rateLimit: { limitPerPeriod: intFromEnv("MODEL_CALL_RATE_PER_MINUTE", 60), periodSec: 60 },
  });

  console.log(JSON.stringify({ level: "info", msg: "worker started", mockMode: isMockMode(), time: new Date().toISOString() }));

  // App Platform sends SIGTERM on redeploy. In-flight workflows are simply
  // resumed by the next worker, so a quick shutdown is safe.
  const shutdown = async (signal: string) => {
    console.log(JSON.stringify({ level: "info", msg: "worker stopping", signal }));
    await DBOS.shutdown();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", msg: "worker failed to start", error: String(error) }));
  process.exit(1);
});
