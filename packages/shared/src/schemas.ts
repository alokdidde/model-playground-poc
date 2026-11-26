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

export const CompareRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(LIMITS.maxPromptChars),
  systemPrompt: z.string().trim().max(LIMITS.maxSystemPromptChars).optional(),
  models: z
    .array(modelId)
    .min(1)
    .max(LIMITS.maxModelsPerCompare)
    .refine((ids) => new Set(ids).size === ids.length, "Models must be unique"),
  maxTokens: z.number().int().min(16).max(LIMITS.maxOutputTokens).default(1024),
  temperature: z.number().min(0).max(2).default(0.7),
  judge: z
    .object({
      enabled: z.boolean().default(true),
      model: modelId.optional(),
    })
    .default({ enabled: true }),
});
export type CompareRequest = z.infer<typeof CompareRequestSchema>;
/** What the client sends (defaults not yet applied). */
export type CompareRequestInput = z.input<typeof CompareRequestSchema>;

export const VoteRequestSchema = z.object({
  /** The model whose answer the user preferred, or null for "they're all bad". */
  preferredModel: modelId.nullable(),
});
export type VoteRequest = z.infer<typeof VoteRequestSchema>;

export const IdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

// ---------------------------------------------------------------------------
// Batch evals
// ---------------------------------------------------------------------------

export const CreateEvalRunSchema = z.object({
  name: z.string().trim().min(1).max(120),
  models: z
    .array(modelId)
    .min(1)
    .max(LIMITS.maxModelsPerCompare)
    .refine((ids) => new Set(ids).size === ids.length, "Models must be unique"),
  prompts: z
    .array(
      z.object({
        prompt: z.string().trim().min(1).max(LIMITS.maxPromptChars),
        /** Optional reference answer, shown to the judge. */
        expected: z.string().trim().max(LIMITS.maxPromptChars).optional(),
      }),
    )
    .min(1)
    .max(LIMITS.maxEvalPrompts),
  judgeModel: modelId.optional(),
  maxTokens: z.number().int().min(16).max(LIMITS.maxOutputTokens).default(512),
});
export type CreateEvalRun = z.infer<typeof CreateEvalRunSchema>;
export type CreateEvalRunInput = z.input<typeof CreateEvalRunSchema>;

export const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(64).optional(),
});

export const LeaderboardQuerySchema = z.object({
  source: z.enum(["all", "evals", "compare"]).default("all"),
});

// ---------------------------------------------------------------------------
// Shared response shapes
// ---------------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  /** USD per 1M tokens, when we know it. */
  pricing?: { inputPerM: number; outputPerM: number };
  contextWindow?: number;
}

export interface CallMetrics {
  latencyMs: number;
  /** Time to first token (streaming only). */
  ttftMs?: number;
  inputTokens: number;
  outputTokens: number;
  /** True when the provider did not report usage and we estimated it. */
  tokensEstimated: boolean;
  /** Null when we do not know the model's price. */
  costUsd: number | null;
  attempts: number;
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
  winnerModel: string | null;
  rationale: string;
  scores: JudgeScore[];
  metrics: CallMetrics;
}

export type RunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
