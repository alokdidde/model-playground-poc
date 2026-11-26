import type { PrismaClient } from "@fomo/db";
import { createRateLimiterFromEnv } from "@fomo/ratelimit";
import { ModelGateway } from "./gateway";
import { GradientProvider } from "./gradient-provider";
import { MockProvider } from "./mock-provider";
import type { ChatProvider } from "./types";

export function isMockMode(): boolean {
  return process.env.GRADIENT_MOCK === "1" || !process.env.MODEL_ACCESS_KEY;
}

export function createProviderFromEnv(): ChatProvider {
  if (isMockMode()) {
    return new MockProvider({
      rateLimitRate: Number(process.env.MOCK_429_RATE ?? 0.15),
      errorRate: Number(process.env.MOCK_ERROR_RATE ?? 0.05),
      speed: Number(process.env.MOCK_SPEED ?? 1),
      random: Math.random,
    });
  }
  return new GradientProvider({
    baseUrl: process.env.GRADIENT_BASE_URL ?? "https://inference.do-ai.run/v1",
    apiKey: process.env.MODEL_ACCESS_KEY!,
    streamUsage: process.env.GRADIENT_STREAM_USAGE !== "0",
  });
}

export function createGatewayFromEnv(prisma: PrismaClient): ModelGateway {
  return new ModelGateway(createProviderFromEnv(), createRateLimiterFromEnv(prisma));
}

export function judgeConfigFromEnv(): { preferred: string; fallbacks: string[] } {
  return {
    preferred: process.env.JUDGE_MODEL ?? "openai-gpt-oss-120b",
    fallbacks: (process.env.JUDGE_FALLBACK_MODELS ?? "openai-gpt-5-nano,deepseek-v4.1-flash")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
  };
}
