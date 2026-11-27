import {
  RateLimitExceededError,
  buildExplainRequest,
  describeModel,
  judgeConfigFromEnv,
  parseUseCase,
  problemFromModelError,
  UpstreamError,
  type Intent,
  type RankedModel,
} from "@fomo/llm";
import { TASK_TYPES } from "@fomo/shared";
import { rank, withData } from "@/lib/advisor-rank";
import { errors } from "./errors";
import { getLeaderboard } from "./leaderboard";
import { getGateway } from "./services";

/** A ranking needs at least this many models with judged data for a task type, else we use all tasks. */
const MIN_MODELS_WITH_DATA = 2;

export interface AdvisorResult {
  intent: Intent;
  /** What data the ranking used, e.g. "Coding runs" or "all runs (not enough coding data yet)". */
  basis: string;
  ranking: (RankedModel & { model: string; value: number; p50TtftMs: number | null; avgTokensPerSec: number | null })[];
  /** Chat models we have no judged data for yet: worth trying, but we can't rank them. */
  untested: { model: string; label: string }[];
  explanation: string | null;
  assistantModel: string;
}

/**
 * Use case in plain words -> structured intent (LLM) -> ranking from measured
 * leaderboard data (our code) -> a short explanation of that ranking (LLM).
 */
export async function adviseModels(query: string, signal: AbortSignal): Promise<AdvisorResult> {
  const gateway = getGateway();
  // The judge model is our neutral "house" model; any capable chat model would do.
  const assistantModel = judgeConfigFromEnv().preferred;
  const callOptions = { signal, maxQueueWaitMs: 15_000, attemptTimeoutMs: 60_000 };

  try {
    const intent = await parseUseCase(gateway, query, assistantModel, callOptions);

    let rows = withData(await getLeaderboard("all", intent.taskType));
    let basis = `${TASK_TYPES[intent.taskType].label} runs`;
    if (rows.length < MIN_MODELS_WITH_DATA) {
      rows = withData(await getLeaderboard("all"));
      basis = `all runs (not enough ${TASK_TYPES[intent.taskType].label.toLowerCase()} data yet)`;
    }

    const ranking = rank(rows, intent);
    const available = (await gateway.provider.listModels()).filter((m) => m.kind === "chat" && m.available);
    const ranked = new Set(ranking.map((r) => r.model));
    const untested = available.filter((m) => !ranked.has(m.id)).map((m) => ({ model: m.id, label: m.label }));

    let explanation: string | null = null;
    if (ranking.length > 0) {
      const top = ranking.slice(0, 5).map(({ model: _id, value: _v, avgTokensPerSec: _t, ...rest }) => rest);
      const { output } = await gateway
        .complete(buildExplainRequest({ summary: intent.summary, taskType: intent.taskType, priority: intent.priority, ranking: top, basis, model: assistantModel }), callOptions)
        .catch(() => ({ output: "" })); // the ranking stands on its own; the prose is a nice-to-have
      explanation = output.trim() || null;
    }
    return { intent, basis, ranking, untested, explanation, assistantModel: describeModel(assistantModel).label };
  } catch (error) {
    if (error instanceof UpstreamError || error instanceof RateLimitExceededError) {
      throw errors.unavailable(problemFromModelError(error, assistantModel).detail ?? "The assistant model is unavailable.");
    }
    throw error;
  }
}
