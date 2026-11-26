import type { ModelInfo } from "@fomo/shared";

/**
 * Metadata we keep locally for known DigitalOcean serverless-inference
 * models: display names and list prices (USD per 1M tokens, standard tier).
 *
 * Source: docs.digitalocean.com/products/inference/details/pricing, checked
 * 2026-11-26. The live model list comes from GET /v1/models; this table only
 * decorates it. Unknown models still work, they just show "cost unknown".
 * Tiered prices (e.g. >100K-token prompts) use the base tier here.
 */
export const KNOWN_MODELS: ModelInfo[] = [
  { id: "openai-gpt-oss-120b", label: "gpt-oss-120b", provider: "OpenAI (open weights)", contextWindow: 128_000, pricing: { inputPerM: 0.1, outputPerM: 0.7 } },
  { id: "openai-gpt-5-nano", label: "GPT-5 nano", provider: "OpenAI", contextWindow: 400_000, pricing: { inputPerM: 0.05, outputPerM: 0.4 } },
  { id: "openai-gpt-5.4-mini", label: "GPT-5.4 mini", provider: "OpenAI", contextWindow: 400_000, pricing: { inputPerM: 0.75, outputPerM: 4.5 } },
  { id: "anthropic-claude-haiku-4.5", label: "Claude Haiku 4.5", provider: "Anthropic", contextWindow: 200_000, pricing: { inputPerM: 1, outputPerM: 5 } },
  { id: "anthropic-claude-sonnet-5.5", label: "Claude Sonnet 5.5", provider: "Anthropic", contextWindow: 1_000_000, pricing: { inputPerM: 2, outputPerM: 10 } },
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", provider: "DeepSeek", contextWindow: 1_048_576, pricing: { inputPerM: 0.3, outputPerM: 1.2 } },
  { id: "qwen3.8-max", label: "Qwen3.8-Max", provider: "Alibaba", contextWindow: 1_000_000, pricing: { inputPerM: 2, outputPerM: 6 } },
  { id: "mistral-3-14B", label: "Ministral 3 14B", provider: "Mistral AI", contextWindow: 262_144, pricing: { inputPerM: 0.2, outputPerM: 0.2 } },
  { id: "kimi-k2.6", label: "Kimi K2.6", provider: "Moonshot AI", contextWindow: 262_144, pricing: { inputPerM: 0.95, outputPerM: 4 } },
  { id: "glm-5.3-flash", label: "GLM-5.3 Flash", provider: "Z.ai", contextWindow: 1_048_576, pricing: { inputPerM: 0.15, outputPerM: 0.5 } },
  { id: "nemotron-3.5-super-vl", label: "Nemotron 3.5 Super VL", provider: "NVIDIA", contextWindow: 1_048_576, pricing: { inputPerM: 0.3, outputPerM: 0.65 } },
];

const byId = new Map(KNOWN_MODELS.map((m) => [m.id, m]));

export function describeModel(id: string): ModelInfo {
  return byId.get(id) ?? { id, label: id, provider: id.split("-")[0] ?? "unknown" };
}

/** USD cost of one call, or null when we do not know the model's price. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = byId.get(model)?.pricing;
  if (!pricing) return null;
  return (inputTokens * pricing.inputPerM + outputTokens * pricing.outputPerM) / 1_000_000;
}
