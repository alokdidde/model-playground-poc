import { z } from "zod";
import { TASK_TYPE_IDS, TASK_TYPES, type PriorityWeights, type TaskType } from "@fomo/shared";
import { UpstreamError } from "./errors";
import type { CallOptions, ModelGateway } from "./gateway";
import type { ChatRequest } from "./types";

/**
 * The "FOMO assistant": a user describes their use case in plain words.
 *
 * The model does two narrow jobs: (1) turn the description into structured
 * intent (task type, priority weights, hard limits, a few test prompts), and
 * (2) explain a ranking it is *given*. The ranking itself is computed by our
 * code from measured data, so the model can't invent benchmark numbers or
 * favour a model it "likes".
 */
export const IntentSchema = z.object({
  taskType: z.enum(TASK_TYPE_IDS),
  priority: z.object({
    quality: z.coerce.number().min(0).max(1),
    cost: z.coerce.number().min(0).max(1),
    speed: z.coerce.number().min(0).max(1),
  }),
  /** Hard limits, only when the user stated them. */
  maxCostPerCallUsd: z.coerce.number().positive().nullable().default(null),
  maxLatencyMs: z.coerce.number().positive().nullable().default(null),
  /** 3 realistic prompts for this use case, to test candidates on. */
  samplePrompts: z.array(z.string().min(1).max(2_000)).min(1).max(5),
  /** One line restating the need, shown back to the user. */
  summary: z.string().min(1).max(300),
});
export type Intent = z.infer<typeof IntentSchema>;

const TASK_LIST = TASK_TYPE_IDS.map((id) => `- ${id}: ${TASK_TYPES[id].label}`).join("\n");

export const INTENT_SYSTEM_PROMPT = `You turn a description of an AI use case into settings for choosing a model.
Return only JSON, no prose, with exactly these fields:
{"taskType": one of the ids below,
 "priority": {"quality": 0..1, "cost": 0..1, "speed": 0..1}  (relative importance; at least one > 0),
 "maxCostPerCallUsd": number or null  (only if the user states a budget per request or call),
 "maxLatencyMs": number or null  (only if the user states a response-time limit; it means time until the answer starts showing),
 "samplePrompts": [3 realistic prompts a user of this product would send. Each must be self-contained: include the code, text or data it refers to, so a model can answer it without asking for more],
 "summary": "one sentence restating what they need"}

Task types:
${TASK_LIST}

Rules: do not name or recommend any model. If the user says "cheap" or mentions volume, raise cost; "fast", "real-time" or "chat" raise speed; "accurate", "legal", "medical" or "code" raise quality. Convert "under 2 seconds" to 2000.`;

export function buildIntentRequest(query: string, model: string): ChatRequest {
  return {
    model,
    messages: [
      { role: "system", content: INTENT_SYSTEM_PROMPT },
      { role: "user", content: query },
    ],
    maxTokens: 1_500,
    temperature: 0,
  };
}

export function parseIntent(text: string): Intent {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new UpstreamError("bad_output", "The assistant did not return JSON");
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new UpstreamError("bad_output", "The assistant returned malformed JSON");
  }
  const parsed = IntentSchema.safeParse(json);
  if (!parsed.success) throw new UpstreamError("bad_output", `The assistant's JSON had the wrong shape: ${parsed.error.message}`);
  // Only the ratio matters; normalise so the UI can show shares that add up to 100%.
  const { quality, cost, speed } = parsed.data.priority;
  const sum = quality + cost + speed;
  const round = (x: number) => Math.round((x / sum) * 100) / 100;
  parsed.data.priority = sum === 0 ? { quality: 0.6, cost: 0.25, speed: 0.15 } : { quality: round(quality), cost: round(cost), speed: round(speed) };
  return parsed.data;
}

/** Parses the use case, with one re-ask if the JSON is unusable (as the judge does). */
export async function parseUseCase(gateway: ModelGateway, query: string, model: string, options: CallOptions = {}): Promise<Intent> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { output } = await gateway.complete(buildIntentRequest(query, model), options);
    try {
      return parseIntent(output);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** One row of the ranking we hand to the model to explain. Numbers only: the model must not add any. */
export interface RankedModel {
  label: string;
  rank: number;
  avgScore: number | null;
  p50TtftMs: number | null;
  avgLatencyMs: number | null;
  avgCostUsd: number | null;
  judged: number;
  withinLimits: boolean;
}

export const EXPLAIN_SYSTEM_PROMPT = `You explain a model recommendation to a developer, in 3 to 5 plain sentences.
You are given their need, their priorities, and a ranking computed from measured benchmark data.
Use only the numbers in the data. Never invent numbers, models or benchmarks. Recommend rank 1, say why in terms of their priorities,
and name the main trade-off against the runner-up. If the data is thin (few judged answers) or the leader breaks a limit, say so.
No headings, no lists.`;

export function buildExplainRequest(input: {
  summary: string;
  taskType: TaskType;
  priority: PriorityWeights;
  ranking: RankedModel[];
  basis: string;
  model: string;
}): ChatRequest {
  const data = {
    need: input.summary,
    taskType: TASK_TYPES[input.taskType].label,
    priorities: input.priority,
    dataBasis: input.basis,
    ranking: input.ranking,
  };
  return {
    model: input.model,
    messages: [
      { role: "system", content: EXPLAIN_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(data, null, 2) },
    ],
    maxTokens: 1_200,
    temperature: 0.2,
  };
}
