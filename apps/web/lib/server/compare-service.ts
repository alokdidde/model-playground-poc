import type { Comparison } from "@fomo/db";
import {
  buildSynthesisRequest,
  describeModel,
  judgeConfigFromEnv,
  pickJudgeModel,
  problemFromModelError,
  runJudge,
  type ChatMessage,
  type ChatRequest,
} from "@fomo/llm";
import { PROBLEM_TYPES, type CompareEvent, type CompareRequest, type FieldError, type RunStatus } from "@fomo/shared";
import { errors } from "./errors";
import { logger } from "./logger";
import { getGateway, prisma } from "./services";

/** Upper bound for a whole comparison, including the judge. */
const COMPARISON_DEADLINE_MS = 150_000;

/**
 * Step 1 (before the stream opens): persist the comparison. Doing this first
 * means a duplicate Idempotency-Key gets a proper 409 problem response
 * rather than an error buried inside an event stream.
 */
export async function createComparison(input: CompareRequest, requestId: string, idempotencyKey?: string): Promise<Comparison> {
  const unsupported = unsupportedSettings(input);
  if (unsupported.length > 0) throw errors.validation(unsupported, "Some models do not accept the settings sent for them.");
  if (idempotencyKey) {
    const existing = await prisma.comparison.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) {
      throw errors.conflict("A comparison with this Idempotency-Key already exists. Fetch it instead of re-running it.", {
        comparisonId: existing.id,
        location: `/api/compare/${existing.id}`,
      });
    }
  }
  return prisma.comparison.create({
    data: {
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
      models: input.models,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      taskType: input.taskType,
      priority: input.priority,
      idempotencyKey,
      requestId,
    },
  });
}

/**
 * Step 2 (inside the stream): call every model in parallel, stream their
 * tokens, record each result as soon as it finishes, then run the judge.
 *
 * Each model runs in its own promise and handles its own failure, so one
 * slow or broken model never blocks or hides the others (partial results).
 */
export async function executeComparison(
  comparison: Comparison,
  input: CompareRequest,
  emit: (event: CompareEvent) => void,
  clientSignal: AbortSignal,
): Promise<void> {
  const signal = AbortSignal.any([clientSignal, AbortSignal.timeout(COMPARISON_DEADLINE_MS)]);
  const gateway = getGateway();
  const judgeCfg = judgeConfigFromEnv();
  const judge = input.judge.enabled
    ? pickJudgeModel(input.models, input.judge.model ?? judgeCfg.preferred, input.judge.model ? [] : judgeCfg.fallbacks)
    : null;

  emit({ type: "comparison.started", comparisonId: comparison.id, models: input.models, judgeModel: judge?.judgeModel ?? null });

  const outcomes = await Promise.all(
    input.models.map(async (model) => {
      let partial = "";
      const request = buildModelRequest(input, model);
      const settings = settingsRecord(request);
      try {
        const { output, metrics } = await gateway.stream(
          request,
          (text) => {
            partial += text;
            emit({ type: "model.delta", model, text });
          },
          {
            signal,
            onRetry: (r) => emit({ type: "model.retrying", model, ...r }),
            onWait: (w) => emit({ type: "model.waiting", model, ...w }),
          },
        );
        await prisma.compareResult.create({
          data: { comparisonId: comparison.id, model, status: "SUCCEEDED", output, settings, ...metrics },
        });
        emit({ type: "model.completed", model, output, metrics });
        return { model, output, ok: true as const };
      } catch (error) {
        const problem = problemFromModelError(error, model);
        logger.warn("model call failed", { comparisonId: comparison.id, model, problem });
        await prisma.compareResult
          .create({
            data: {
              comparisonId: comparison.id,
              model,
              status: "FAILED",
              output: partial,
              settings,
              problem: problem as object,
              latencyMs: 0,
              inputTokens: 0,
              outputTokens: 0,
              tokensEstimated: true,
              attempts: 0,
            },
          })
          .catch((e: unknown) => logger.error("failed to record failure", { error: String(e) }));
        emit({ type: "model.failed", model, problem, partialOutput: partial });
        return { model, output: partial, ok: false as const };
      }
    }),
  );

  if (clientSignal.aborted) {
    await finish(comparison.id, "CANCELLED");
    return;
  }

  const succeeded = outcomes.filter((o) => o.ok);
  const enough = succeeded.length >= 2;
  const neutralModel = judge?.judgeModel ?? pickNeutralModel(input.models, judgeCfg);

  // The judge and the synthesizer only need the answers, so they run side by side.
  await Promise.all([
    judge ? runJudgeStep(comparison.id, input, succeeded, judge, gateway, signal, emit) : undefined,
    input.synthesize && enough ? runSynthesisStep(comparison.id, input.prompt, succeeded, neutralModel, gateway, signal, emit) : undefined,
  ]);

  const status: RunStatus =
    succeeded.length === outcomes.length ? "COMPLETED" : succeeded.length > 0 ? "PARTIAL" : "FAILED";
  await finish(comparison.id, status);
  emit({ type: "comparison.completed", comparisonId: comparison.id, status });
}

type Answer = { model: string; output: string };
type Emit = (event: CompareEvent) => void;
type Gateway = ReturnType<typeof getGateway>;

function pickNeutralModel(models: string[], cfg: { preferred: string; fallbacks: string[] }): string {
  return pickJudgeModel(models, cfg.preferred, cfg.fallbacks).judgeModel;
}

async function runJudgeStep(
  comparisonId: string,
  input: CompareRequest,
  succeeded: Answer[],
  judge: { judgeModel: string; selfJudged: boolean },
  gateway: Gateway,
  signal: AbortSignal,
  emit: Emit,
) {
  if (succeeded.length < 2) {
    emit({
      type: "judge.failed",
      problem: {
        type: PROBLEM_TYPES.upstreamError,
        title: "Not enough answers to judge",
        status: 422,
        detail: "The judge needs at least two successful answers.",
      },
    });
    return;
  }
  emit({ type: "judge.started", judgeModel: judge.judgeModel });
  try {
    const verdict = await runJudge(
      gateway,
      { prompt: input.prompt, taskType: input.taskType, candidates: succeeded, judgeModel: judge.judgeModel, selfJudged: judge.selfJudged },
      { signal },
    );
    await prisma.judgement.create({
      data: {
        comparisonId,
        judgeModel: verdict.judgeModel,
        selfJudged: verdict.selfJudged,
        winnerModel: verdict.winnerModel,
        rationale: verdict.rationale,
        scores: verdict.scores as object[],
        latencyMs: verdict.metrics.latencyMs,
        costUsd: verdict.metrics.costUsd,
      },
    });
    emit({ type: "judge.completed", verdict });
  } catch (error) {
    emit({ type: "judge.failed", problem: problemFromModelError(error, judge.judgeModel) });
  }
}

/** Streams one merged answer (with [Model] citations) from a neutral model. */
async function runSynthesisStep(
  comparisonId: string,
  prompt: string,
  succeeded: Answer[],
  model: string,
  gateway: Gateway,
  signal: AbortSignal,
  emit: Emit,
) {
  emit({ type: "synthesis.started", model });
  try {
    const { output, metrics } = await gateway.stream(buildSynthesisRequest(prompt, succeeded, model), (text) => emit({ type: "synthesis.delta", text }), {
      signal,
    });
    await prisma.comparison.update({ where: { id: comparisonId }, data: { synthesis: output, synthesisModel: model } });
    emit({ type: "synthesis.completed", model, output, metrics });
  } catch (error) {
    emit({ type: "synthesis.failed", problem: problemFromModelError(error, model) });
  }
}

async function finish(id: string, status: RunStatus) {
  await prisma.comparison
    .update({ where: { id }, data: { status, completedAt: new Date() } })
    .catch((error: unknown) => logger.error("failed to finish comparison", { id, error: String(error) }));
}

/**
 * The request actually sent to one model: its own overrides first, then the
 * request-level defaults. Settings the model rejects (per the catalog) are
 * left out so the provider default applies, e.g. Kimi K2.6 only allows
 * temperature 1.
 */
export function buildModelRequest(input: CompareRequest, model: string): ChatRequest {
  const own = input.modelSettings[model] ?? {};
  const caps = describeModel(model).capabilities;
  const systemPrompt = own.systemPrompt || input.systemPrompt;
  const messages: ChatMessage[] = [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    { role: "user", content: input.prompt },
  ];
  return {
    model,
    messages,
    maxTokens: own.maxTokens ?? input.maxTokens,
    ...(caps.temperature ? { temperature: own.temperature ?? input.temperature } : {}),
    ...(caps.topP && own.topP !== undefined ? { topP: own.topP } : {}),
    ...(caps.reasoning && own.reasoningEffort ? { reasoningEffort: own.reasoningEffort } : {}),
  };
}

/** Explicit per-model settings that the model is known to reject. */
export function unsupportedSettings(input: CompareRequest): FieldError[] {
  const problems: FieldError[] = [];
  for (const [model, own] of Object.entries(input.modelSettings)) {
    const caps = describeModel(model).capabilities;
    const check = (field: "temperature" | "topP" | "reasoningEffort", supported: boolean) => {
      if (own[field] !== undefined && !supported) {
        problems.push({ pointer: `body.modelSettings.${model}.${field}`, message: `${model} does not accept ${field}` });
      }
    };
    check("temperature", caps.temperature);
    check("topP", caps.topP);
    check("reasoningEffort", caps.reasoning);
  }
  return problems;
}

/** What we store with each result, so a comparison can be reproduced. */
function settingsRecord(request: ChatRequest) {
  return {
    maxTokens: request.maxTokens,
    temperature: request.temperature ?? null,
    topP: request.topP ?? null,
    reasoningEffort: request.reasoningEffort ?? null,
    systemPrompt: request.messages.find((m) => m.role === "system")?.content ?? null,
  };
}
