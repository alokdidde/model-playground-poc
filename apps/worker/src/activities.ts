/**
 * The side-effecting work the workflows run as DBOS steps. Plain async
 * functions, so they are easy to read and test on their own.
 *
 * Every write here is idempotent (upsert on a natural key, or a guarded
 * update). DBOS checkpoints a step's result after it returns; if the process
 * dies after the write but before the checkpoint, the step runs again, and
 * the second write must be harmless.
 */
import { buildModelRequest, problemFromModelError, runChecks, runJudge, settingsRecord } from "@fomo/llm";
import { Prisma } from "@fomo/db";
import type { JudgeScore, ModelSettings, TaskType } from "@fomo/shared";
import { gateway, prisma } from "./services";

export interface PromptContext {
  prompt: string;
  expected: string | null;
  models: string[];
  judgeModel: string;
  maxTokens: number;
  taskType: TaskType;
  modelSettings: Record<string, ModelSettings>;
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
    include: { run: { select: { models: true, judgeModel: true, maxTokens: true, taskType: true, modelSettings: true } } },
  });
  return {
    prompt: prompt.prompt,
    expected: prompt.expected,
    models: prompt.run.models,
    judgeModel: prompt.run.judgeModel,
    maxTokens: prompt.run.maxTokens,
    taskType: prompt.run.taskType as TaskType,
    modelSettings: (prompt.run.modelSettings ?? {}) as Record<string, ModelSettings>,
  };
}

/**
 * One model on one prompt. Failures are recorded, not thrown: a broken model
 * should show up as a failed cell in the results, not abort the whole run.
 */
export async function callModel(runId: string, promptIndex: number, model: string): Promise<ModelCallOutcome> {
  const ctx = await loadPromptContext(runId, promptIndex);
  const key = { runId_promptIndex_model: { runId, promptIndex, model } };

  // Batch defaults: a low temperature for comparable runs, unless the user set one for this model.
  const request = buildModelRequest({
    model,
    prompt: ctx.prompt,
    defaults: { temperature: 0.2, maxTokens: ctx.maxTokens },
    settings: ctx.modelSettings[model],
  });
  const settings = settingsRecord(request);

  try {
    // Streamed (to nobody) so batch results get the same TTFT and tokens/sec as compare.
    const { output, metrics } = await gateway.stream(request, () => {}, {
      // Batch lane: it only fills its share of each model's capacity, so a person running a compare never waits behind an eval.
      lane: "batch",
      tag: runId,
      // Batch work is patient: wait longer for capacity and retry more than the interactive path.
      maxQueueWaitMs: 5 * 60_000,
      attemptTimeoutMs: 120_000,
      firstTokenTimeoutMs: 60_000,
      maxAttempts: 5,
      // Nobody has seen the text, so a stream that breaks part-way can simply start over.
      restartInterruptedStreams: true,
    });
    const checks = runChecks({ prompt: ctx.prompt, expected: ctx.expected, taskType: ctx.taskType, output });
    const row = { status: "SUCCEEDED" as const, output, settings, ...metrics, checks: checks as object[] };
    await prisma.evalResult.upsert({ where: key, create: { runId, promptIndex, model, ...row }, update: row });
    return { model, ok: true, output };
  } catch (error) {
    const problem = problemFromModelError(error, model);
    const row = {
      status: "FAILED" as const,
      output: "",
      settings,
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

  // Reference-guided judging: the judge also sees each answer's automatic check results.
  const checked = await prisma.evalResult.findMany({ where: { runId, promptIndex, status: "SUCCEEDED" }, select: { model: true, checks: true } });
  const checks = Object.fromEntries(checked.map((r) => [r.model, (r.checks as { name: string; passed: boolean }[] | null) ?? []]));

  let winnerModel: string | null = null;
  let positionConsistent: boolean | null = null;
  let rationale: string;
  let scores: Map<string, JudgeScore> = new Map();
  try {
    const verdict = await runJudge(
      gateway,
      {
        prompt: ctx.prompt,
        expected: ctx.expected ?? undefined,
        checks,
        taskType: ctx.taskType,
        candidates,
        judgeModel: ctx.judgeModel,
        selfJudged: ctx.models.includes(ctx.judgeModel),
      },
      { lane: "batch", tag: runId, maxQueueWaitMs: 5 * 60_000, maxAttempts: 5 },
    );
    winnerModel = verdict.winnerModel;
    positionConsistent = verdict.positionConsistent ?? null;
    rationale = verdict.rationale;
    scores = new Map(verdict.scores.map((s) => [s.model, s]));
  } catch (error) {
    rationale = `Judge failed: ${problemFromModelError(error, ctx.judgeModel).detail ?? "unknown error"}`;
  }

  await prisma.$transaction([
    prisma.evalPrompt.update({
      where: { runId_index: { runId, index: promptIndex } },
      data: { winnerModel, positionConsistent, judgeRationale: rationale, judgedAt: new Date() },
    }),
    ...candidates.map((c) =>
      prisma.evalResult.update({
        where: { runId_promptIndex_model: { runId, promptIndex, model: c.model } },
        data: {
          score: scores.get(c.model)?.overall ?? null,
          criteria: criteriaOf(scores.get(c.model)),
          isWinner: c.model === winnerModel,
        },
      }),
    ),
  ]);
}

function criteriaOf(s: JudgeScore | undefined) {
  return s ? { accuracy: s.accuracy, helpfulness: s.helpfulness, clarity: s.clarity } : Prisma.DbNull;
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
