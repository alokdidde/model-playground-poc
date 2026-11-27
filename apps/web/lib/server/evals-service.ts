import { createHash } from "node:crypto";
import { Prisma, type EvalRun } from "@fomo/db";
import { judgeConfigFromEnv, pickJudgeModel, unsupportedSettings } from "@fomo/llm";
import { QUEUES, WORKFLOWS, type CreateEvalRun } from "@fomo/shared";
import { errors } from "./errors";
import { logger } from "./logger";
import { getDbosClient, prisma } from "./services";

export interface CreateRunResult {
  run: EvalRun;
  /** True when this was a retry of an earlier request with the same Idempotency-Key. */
  replayed: boolean;
}

/**
 * Creates an eval run and hands it to the worker.
 *
 * Idempotency, end to end:
 *  - Same Idempotency-Key + same body  -> returns the existing run (and
 *    re-enqueues it, which heals a crash between "row written" and
 *    "job enqueued").
 *  - Same key + different body         -> 422, so a client bug cannot
 *    silently get someone else's results.
 *  - The DBOS workflow id IS the run id, so enqueueing twice is a no-op.
 */
export async function createEvalRun(input: CreateEvalRun, idempotencyKey?: string): Promise<CreateRunResult> {
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");

  if (idempotencyKey) {
    const existing = await prisma.evalRun.findUnique({ where: { idempotencyKey } });
    if (existing) return replay(existing, requestHash);
  }

  const unsupported = unsupportedSettings(input.modelSettings);
  if (unsupported.length > 0) throw errors.validation(unsupported, "Some models do not accept the settings sent for them.");

  const cfg = judgeConfigFromEnv();
  const { judgeModel } = pickJudgeModel(input.models, input.judgeModel ?? cfg.preferred, input.judgeModel ? [] : cfg.fallbacks);

  let run: EvalRun;
  try {
    run = await prisma.evalRun.create({
      data: {
        name: input.name,
        models: input.models,
        judgeModel,
        maxTokens: input.maxTokens,
        taskType: input.taskType,
        priority: input.priority,
        modelSettings: input.modelSettings,
        sourceComparisonId: input.sourceComparisonId,
        idempotencyKey,
        requestHash,
        totalCalls: input.prompts.length * input.models.length,
        prompts: {
          create: input.prompts.map((p, index) => ({ index, prompt: p.prompt, expected: p.expected })),
        },
      },
    });
  } catch (error) {
    // Two identical requests raced past the findUnique above.
    if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.evalRun.findUniqueOrThrow({ where: { idempotencyKey } });
      return replay(existing, requestHash);
    }
    throw error;
  }

  await enqueue(run.id);
  return { run, replayed: false };
}

async function replay(existing: EvalRun, requestHash: string): Promise<CreateRunResult> {
  if (existing.requestHash !== requestHash) throw errors.idempotencyMismatch();
  if (existing.status === "QUEUED") await enqueue(existing.id);
  return { run: existing, replayed: true };
}

async function enqueue(runId: string): Promise<void> {
  try {
    const client = await getDbosClient();
    await client.enqueue(
      {
        queueName: QUEUES.evalRuns,
        workflowName: WORKFLOWS.evalRun,
        workflowID: runId,
        // Same workflow id again (a retried POST) returns the existing workflow instead of failing.
        workflowIDReusePolicy: "return-existing",
      },
      runId,
    );
  } catch (error) {
    logger.error("failed to enqueue eval run", { runId, error: String(error) });
    // The row stays QUEUED; retrying the POST with the same Idempotency-Key enqueues it.
    throw errors.unavailable("The eval run was saved but could not be queued. Retry with the same Idempotency-Key.");
  }
}

export async function getEvalRun(id: string) {
  const run = await prisma.evalRun.findUnique({
    where: { id },
    include: {
      prompts: { orderBy: { index: "asc" } },
      results: { orderBy: [{ promptIndex: "asc" }, { model: "asc" }] },
    },
  });
  if (!run) throw errors.notFound("Eval run", id);
  const completedCalls = run.results.length;
  const failedCalls = run.results.filter((r) => r.status === "FAILED").length;
  return {
    ...run,
    progress: { totalCalls: run.totalCalls, completedCalls, failedCalls, ratio: run.totalCalls ? completedCalls / run.totalCalls : 0 },
  };
}

export async function listEvalRuns(limit: number, cursor?: string) {
  const runs = await prisma.evalRun.findMany({
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { _count: { select: { results: true } } },
  });
  const page = runs.slice(0, limit);
  return {
    items: page.map(({ _count, ...run }) => ({ ...run, completedCalls: _count.results })),
    nextCursor: runs.length > limit ? page.at(-1)?.id : undefined,
  };
}

export async function cancelEvalRun(id: string) {
  const run = await prisma.evalRun.findUnique({ where: { id } });
  if (!run) throw errors.notFound("Eval run", id);
  if (["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(run.status)) {
    throw errors.conflict(`The run is already ${run.status.toLowerCase()}.`);
  }
  const client = await getDbosClient();
  await client.cancelWorkflow(id, { cancelChildren: true });
  return prisma.evalRun.update({ where: { id }, data: { status: "CANCELLED", completedAt: new Date() } });
}
