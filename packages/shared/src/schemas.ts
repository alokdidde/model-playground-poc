import { z } from "zod";
import { LIMITS } from "./constants";

/**
 * Request and response contracts for the HTTP API. The server validates with
 * these and the client imports the inferred types, so the two cannot drift.
 */

const modelId = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[\w.\-/:]+$/, "Model ids may only contain letters, digits and . - _ / :");

// ---------------------------------------------------------------------------
// Interactive compare
// ---------------------------------------------------------------------------

export const ReasoningEffortSchema = z.enum(["low", "medium", "high"]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

/**
 * Per-model overrides. Every field is optional: anything left out falls back
 * to the request-level value (temperature, maxTokens, systemPrompt) or to the
 * provider's default (topP, reasoningEffort). Whether a model accepts a given
 * setting is checked on the server against the model catalog.
 */

/** How the user trades quality against cost and speed. Any non-negative weights; normalised on use. */
export const PriorityWeightsSchema = z
  .object({
    quality: z.number().min(0).max(1),
    cost: z.number().min(0).max(1),
    speed: z.number().min(0).max(1),
  })
  .refine((w) => w.quality + w.cost + w.speed > 0, "At least one weight must be above 0");
export type PriorityWeights = z.infer<typeof PriorityWeightsSchema>;

export const ModelSettingsSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().gt(0).max(1).optional(),
    maxTokens: z.number().int().min(16).max(LIMITS.maxOutputTokens).optional(),
    reasoningEffort: ReasoningEffortSchema.optional(),
    /** Replaces the shared system prompt for this model only. */
    systemPrompt: z.string().trim().max(LIMITS.maxSystemPromptChars).optional(),
  })
  .strict();
export type ModelSettings = z.infer<typeof ModelSettingsSchema>;

export const CompareRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(LIMITS.maxPromptChars),
    systemPrompt: z.string().trim().max(LIMITS.maxSystemPromptChars).optional(),
    models: z
      .array(modelId)
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, "Models must be unique"),
    maxTokens: z.number().int().min(16).max(LIMITS.maxOutputTokens).default(1024),
    temperature: z.number().min(0).max(2).default(0.7),
    judge: z
      .object({
        enabled: z.boolean().default(true),
        model: modelId.optional(),
      })
      .default({ enabled: true }),
    /** The user's stated priority, stored with the comparison (the recommendation itself is computed client-side). */
    priority: PriorityWeightsSchema.optional(),
    /** Also ask a neutral model to merge the answers into one, with attribution. */
    synthesize: z.boolean().default(true),
    /** Keyed by model id; every key must also be in `models`. */
    modelSettings: z.record(modelId, ModelSettingsSchema).default({}),
  })
  .superRefine((req, ctx) => {
    for (const id of Object.keys(req.modelSettings)) {
      if (!req.models.includes(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["modelSettings", id],
          message: "Settings given for a model that is not in `models`",
        });
      }
    }
  });
export type CompareRequest = z.infer<typeof CompareRequestSchema>;
/** What the client sends (defaults not yet applied). */
export type CompareRequestInput = z.input<typeof CompareRequestSchema>;

export const VoteRequestSchema = z.object({
  /** The model whose answer the user preferred, or null for "they're all bad". */
  preferredModel: modelId.nullable(),
});
export type VoteRequest = z.infer<typeof VoteRequestSchema>;

/** Thumbs up/down on one model's answer; null clears it. PUT, so repeating it is harmless. */
export const RatingRequestSchema = z.object({
  model: modelId,
  rating: z.enum(["up", "down"]).nullable(),
});
export type RatingRequest = z.infer<typeof RatingRequestSchema>;

export const IdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

/** GET /api/compare: past comparisons, newest first. `before` is the last id of the previous page. */
export const CompareListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().min(1).max(64).optional(),
});

// ---------------------------------------------------------------------------
// Shared response shapes
// ---------------------------------------------------------------------------

export type ModelKind = "chat" | "embedding" | "reranker" | "image" | "audio" | "video" | "router";

/** Which request settings a model accepts (probed against DO serverless inference). */
export interface ModelCapabilities {
  temperature: boolean;
  topP: boolean;
  reasoning: boolean;
  /** Tool calling is not wired up in this PoC yet, so this is false for every model. */
  tools: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  kind: ModelKind;
  /** False when the account's inference tier cannot call this model (DO returns 403). */
  available: boolean;
  /** Short catalog badges, e.g. "Reasoning", "Fast", "Long context". */
  tags: string[];
  capabilities: ModelCapabilities;
  /** USD per 1M tokens, when we know it. */
  pricing?: { inputPerM: number; outputPerM: number };
  contextWindow?: number;
}

export interface CallMetrics {
  latencyMs: number;
  /** Time to first visible answer token (streaming only). */
  ttftMs?: number;
  /**
   * Generation speed: output tokens / time from the first streamed chunk
   * (answer or reasoning) to the end. Streaming only. For reasoning models
   * the output tokens include the hidden reasoning, which is billed too.
   */
  outputTokensPerSec?: number;
  /** The model streamed reasoning before answering. */
  reasoned?: boolean;
  inputTokens: number;
  outputTokens: number;
  /** True when the provider did not report usage and we estimated it. */
  tokensEstimated: boolean;
  /** Null when we do not know the model's price. */
  costUsd: number | null;
  attempts: number;
  /** Set when a reasoning model ran out of tokens and was retried with this bigger max_tokens. */
  maxTokensRaisedTo?: number;
}

export interface JudgeScore {
  model: string;
  /** The anonymous label the judge saw, e.g. "B". */
  label: string;
  accuracy: number;
  helpfulness: number;
  clarity: number;
  overall: number;
}

export interface JudgeVerdict {
  judgeModel: string;
  /** True when no neutral judge was available and a contestant judged. */
  selfJudged: boolean;
  /** Null when the answers tie, including when the two orders disagree. */
  winnerModel: string | null;
  rationale: string;
  /** Averaged over both orders when the judge saw both. */
  scores: JudgeScore[];
  metrics: CallMetrics;
  /** How many answer orders were judged: 2 normally, 1 if one judge call failed (or for old runs). */
  orders?: number;
  /** Both orders picked the same winner. False means a position flip, counted as a tie. Null with one order. */
  positionConsistent?: boolean | null;
}

export type RunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";

// ---------------------------------------------------------------------------
// Ops: rate-limit events (see packages/ratelimit/src/events.ts)
// ---------------------------------------------------------------------------

export const RateEventsQuerySchema = z.object({
  minutes: z.coerce.number().int().min(1).max(7 * 24 * 60).default(30),
  tag: z.string().max(100).optional(),
  model: z.string().max(200).optional(),
});
