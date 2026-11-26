/**
 * The side-effecting work the workflows run as DBOS steps. Plain async
 * functions, so they are easy to read and test on their own.
 *
 * Every write here is idempotent (upsert on a natural key, or a guarded
 * update). DBOS checkpoints a step's result after it returns; if the process
 * dies after the write but before the checkpoint, the step runs again, and
 * the second write must be harmless.
 */
import { problemFromModelError, runJudge } from "@fomo/llm";
import { gateway, prisma } from "./services";

export interface PromptContext {
  prompt: string;
  expected: string | null;
  models: string[];
  judgeModel: string;
  maxTokens: number;
}

export interface ModelCallOutcome {
  model: string;
  ok: boolean;
  output: string;
}

export async function markRunStarted(runId: string): Promise<{ promptCount: number }> {
  // Only QUEUED -> RUNNING: a replayed step must not resurrect a cancelled run.
  await prisma.evalRun.updateMany({
    where: { id: runId, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  return { promptCount: await prisma.evalPrompt.count({ where: { runId } }) };
}

export async function loadPromptContext(runId: string, index: number): Promise<PromptContext> {
  const prompt = await prisma.evalPrompt.findUniqueOrThrow({
    where: { runId_index: { runId, index } },
    include: { run: { select: { models: true, judgeModel: true, maxTokens: true } } },
  });
  return {
    prompt: prompt.prompt,
    expected: prompt.expected,
    models: prompt.run.models,
    judgeModel: prompt.run.judgeModel,
    maxTokens: prompt.run.maxTokens,
  };
}

/**
 * One model on one prompt. Failures are recorded, not thrown: a broken model
 * should show up as a failed cell in the results, not abort the whole run.
 */
export async function callModel(runId: string, promptIndex: number, model: string): Promise<ModelCallOutcome> {
  const ctx = await loadPromptContext(runId, promptIndex);
  const key = { runId_promptIndex_model: { runId, promptIndex, model } };

  try {
    const { output, metrics } = await gateway.complete(
      { model, messages: [{ role: "user", content: ctx.prompt }], maxTokens: ctx.maxTokens, temperature: 0.2 },
      // Batch work is patient: wait longer for capacity and retry more than the interactive path.
      { maxQueueWaitMs: 5 * 60_000, attemptTimeoutMs: 120_000, maxAttempts: 5 },
    );
    const { ttftMs: _notStreamed, ...measured } = metrics;
    const row = { status: "SUCCEEDED" as const, output, ...measured };
    await prisma.evalResult.upsert({ where: key, create: { runId, promptIndex, model, ...row }, update: row });
    return { model, ok: true, output };
  } catch (error) {
    const problem = problemFromModelError(error, model);
    const row = {
      status: "FAILED" as const,
      output: "",
      problem: problem as object,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      tokensEstimated: true,
      costUsd: null,
      attempts: 0,
    };
    await prisma.evalResult.upsert({ where: key, create: { runId, promptIndex, model, ...row }, update: row });
    return { model, ok: false, output: "" };
  }
}

export async function judgePrompt(runId: string, promptIndex: number, outcomes: ModelCallOutcome[]): Promise<void> {
  const ctx = await loadPromptContext(runId, promptIndex);
  const candidates = outcomes.filter((o) => o.ok).map(({ model, output }) => ({ model, output }));
  if (candidates.length === 0) return;

  let winnerModel: string | null = null;
  let rationale: string;
  let scores: Map<string, number> = new Map();
  try {
    const verdict = await runJudge(
      gateway,
      {
        prompt: ctx.prompt,
        expected: ctx.expected ?? undefined,
        candidates,
        judgeModel: ctx.judgeModel,
        selfJudged: ctx.models.includes(ctx.judgeModel),
      },
      { maxQueueWaitMs: 5 * 60_000, maxAttempts: 5 },
    );
    winnerModel = verdict.winnerModel;
    rationale = verdict.rationale;
    scores = new Map(verdict.scores.map((s) => [s.model, s.overall]));
  } catch (error) {
    rationale = `Judge failed: ${problemFromModelError(error, ctx.judgeModel).detail ?? "unknown error"}`;
  }

  await prisma.$transaction([
    prisma.evalPrompt.update({
      where: { runId_index: { runId, index: promptIndex } },
      data: { winnerModel, judgeRationale: rationale, judgedAt: new Date() },
    }),
    ...candidates.map((c) =>
      prisma.evalResult.update({
        where: { runId_promptIndex_model: { runId, promptIndex, model: c.model } },
        data: { score: scores.get(c.model) ?? null, isWinner: c.model === winnerModel },
      }),
    ),
  ]);
}

export async function finalizeRun(runId: string): Promise<void> {
  const [failed, total] = await Promise.all([
    prisma.evalResult.count({ where: { runId, status: "FAILED" } }),
    prisma.evalResult.count({ where: { runId } }),
  ]);
  const status = failed === 0 ? "COMPLETED" : failed < total ? "PARTIAL" : "FAILED";
  // Guarded update: never overwrite a run the user cancelled.
  await prisma.evalRun.updateMany({
    where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status, completedAt: new Date() },
  });
}

export async function markRunFailed(runId: string, message: string): Promise<void> {
  await prisma.evalRun.updateMany({
    where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", error: message.slice(0, 1_000), completedAt: new Date() },
  });
}
