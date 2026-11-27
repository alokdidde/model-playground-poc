import type { ModelCapabilities, ModelInfo, ModelKind } from "@fomo/shared";

/**
 * Local metadata for DigitalOcean serverless-inference models. The live list
 * comes from GET /v1/models; this file only decorates it with labels, prices,
 * badges and which request settings each model accepts.
 *
 * Prices: USD per 1M tokens, standard tier, from
 * docs.digitalocean.com/products/inference/details/pricing (checked 2026-11-26).
 *
 * Capabilities and availability were probed on 2026-11-26 by calling every
 * chat model with temperature, top_p and reasoning_effort (results in
 * docs/ARCHITECTURE.md, "Per-model settings and capabilities"). Unknown models default to "accepts everything"
 * and the provider's error is shown if that turns out wrong.
 */
interface Entry {
  label: string;
  provider: string;
  pricing?: { inputPerM: number; outputPerM: number };
  contextWindow?: number;
  tags?: string[];
  /** Settings the model rejects. */
  rejects?: Partial<Record<"temperature" | "topP" | "reasoning", true>>;
}

const KNOWN: Record<string, Entry> = {
  "openai-gpt-oss-120b": { label: "gpt-oss-120b", provider: "OpenAI (open weights)", contextWindow: 128_000, pricing: { inputPerM: 0.1, outputPerM: 0.7 }, tags: ["Reasoning", "Cost-effective"] },
  "openai-gpt-5-nano": { label: "GPT-5 nano", provider: "OpenAI", contextWindow: 400_000, pricing: { inputPerM: 0.05, outputPerM: 0.4 }, tags: ["Fast", "Cost-effective"] },
  "openai-gpt-5.4-mini": { label: "GPT-5.4 mini", provider: "OpenAI", contextWindow: 400_000, pricing: { inputPerM: 0.75, outputPerM: 4.5 }, tags: ["Balanced"] },
  "anthropic-claude-haiku-4.5": { label: "Claude Haiku 4.5", provider: "Anthropic", contextWindow: 200_000, pricing: { inputPerM: 1, outputPerM: 5 }, tags: ["Fast"] },
  "anthropic-claude-sonnet-5.5": { label: "Claude Sonnet 5.5", provider: "Anthropic", contextWindow: 1_000_000, pricing: { inputPerM: 2, outputPerM: 10 }, tags: ["Balanced", "Long context"] },
  "deepseek-v4.1-flash": { label: "DeepSeek V4.1 Flash", provider: "DeepSeek", contextWindow: 1_048_576, pricing: { inputPerM: 0.3, outputPerM: 1.2 }, tags: ["Fast", "Reasoning"] },
  "deepseek-v4-pro-0813": { label: "DeepSeek V4 Pro (0813)", provider: "DeepSeek", tags: ["Reasoning", "High performance"] },
  "deepseek-v4-flash-0731": { label: "DeepSeek V4 Flash (0731)", provider: "DeepSeek", tags: ["Fast"] },
  "deepseek-v4.1-flash-1017": { label: "DeepSeek V4.1 Flash (1017)", provider: "DeepSeek", tags: ["Fast"] },
  "qwen3.8-max": { label: "Qwen3.8-Max", provider: "Alibaba", contextWindow: 1_000_000, pricing: { inputPerM: 2, outputPerM: 6 }, tags: ["High performance", "Long context"] },
  "mistral-3-14B": { label: "Ministral 3 14B", provider: "Mistral AI", contextWindow: 262_144, pricing: { inputPerM: 0.2, outputPerM: 0.2 }, tags: ["Fast", "Cost-effective"], rejects: { reasoning: true } },
  "kimi-k2.6": { label: "Kimi K2.6", provider: "Moonshot AI", contextWindow: 262_144, pricing: { inputPerM: 0.95, outputPerM: 4 }, tags: ["Reasoning"], rejects: { temperature: true, topP: true } },
  "kimi-k3": { label: "Kimi K3", provider: "Moonshot AI", tags: ["Reasoning"], rejects: { topP: true } },
  "kimi-k3.1-pro": { label: "Kimi K3.1 Pro", provider: "Moonshot AI", tags: ["Reasoning", "High performance"] },
  "glm-5.3-flash": { label: "GLM-5.3 Flash", provider: "Z.ai", contextWindow: 1_048_576, pricing: { inputPerM: 0.15, outputPerM: 0.5 }, tags: ["Fast", "Cost-effective"] },
  "glm-5.3": { label: "GLM-5.3", provider: "Z.ai", tags: ["Reasoning"] },
  "glm-5.2": { label: "GLM-5.2", provider: "Z.ai", tags: ["General"], rejects: { reasoning: true } },
  "minimax-m2.5": { label: "MiniMax M2.5", provider: "MiniMax", tags: ["Reasoning"] },
  "minimax-m3.1-flash": { label: "MiniMax M3.1 Flash", provider: "MiniMax", tags: ["Fast"] },
  "nemotron-3.5-super-vl": { label: "Nemotron 3.5 Super VL", provider: "NVIDIA", contextWindow: 1_048_576, pricing: { inputPerM: 0.3, outputPerM: 0.65 }, tags: ["Vision", "Long context"] },
  "arcee-trinity-large-thinking": { label: "Arcee Trinity Large", provider: "Arcee", tags: ["Reasoning", "Long context"] },
};

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  glm: "Z.ai",
  kimi: "Moonshot AI",
  qwen3: "Alibaba",
  mistral: "Mistral AI",
  minimax: "MiniMax",
  nemotron: "NVIDIA",
  arcee: "Arcee",
};

/** Non-chat models, recognised by id. Order matters: first match wins. */
const KIND_RULES: [RegExp, ModelKind][] = [
  [/^router:/, "router"],
  [/reranker/, "reranker"],
  [/embed|^bge-|^e5-|^gte-|mini-lm|mpnet/, "embedding"],
  [/image|diffusion/, "image"],
  [/tts/, "audio"],
  [/t2v/, "video"],
];

/**
 * Proprietary OpenAI/Anthropic models (and Arcee) answer 403 "not available
 * for your subscription tier" on the account this PoC runs on. They are marked
 * unavailable, and `GET /api/models` and the compare API leave them out.
 */
function isAvailable(id: string): boolean {
  if (id === "openai-gpt-oss-120b") return true;
  return !/^(openai-|anthropic-|arcee-)/.test(id);
}

function kindOf(id: string): ModelKind {
  return KIND_RULES.find(([re]) => re.test(id))?.[1] ?? "chat";
}

function prettify(id: string): string {
  return id
    .replace(/^(openai|anthropic)-/, "")
    .split("-")
    .map((part) => (/^[a-z]/.test(part) ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function describeModel(id: string): ModelInfo {
  const entry = KNOWN[id];
  const kind = kindOf(id);
  const prefix = id.split(/[-:]/)[0] ?? id;
  const chat = kind === "chat";
  const capabilities: ModelCapabilities = {
    temperature: chat && !entry?.rejects?.temperature,
    topP: chat && !entry?.rejects?.topP,
    reasoning: chat && !entry?.rejects?.reasoning,
    tools: false,
  };
  const tags = entry?.tags ?? (chat ? [] : [kind[0]!.toUpperCase() + kind.slice(1)]);
  return {
    id,
    label: entry?.label ?? prettify(id),
    provider: entry?.provider ?? PROVIDER_NAMES[prefix] ?? prefix,
    kind,
    available: chat && isAvailable(id),
    tags,
    capabilities,
    ...(entry?.pricing ? { pricing: entry.pricing } : {}),
    ...(entry?.contextWindow ? { contextWindow: entry.contextWindow } : {}),
  };
}

/** The decorated entries for the models we know, e.g. for the mock provider. */
export const KNOWN_MODELS: ModelInfo[] = Object.keys(KNOWN).map(describeModel);

/** USD cost of one call, or null when we do not know the model's price. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = KNOWN[model]?.pricing;
  if (!pricing) return null;
  return (inputTokens * pricing.inputPerM + outputTokens * pricing.outputPerM) / 1_000_000;
}
