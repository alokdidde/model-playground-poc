import type { FieldError, ModelSettings } from "@fomo/shared";
import { describeModel } from "./catalog";
import type { ChatMessage, ChatRequest } from "./types";

/**
 * The request actually sent to one model in a compare: the model's own
 * overrides first, then the caller's defaults.
 * Settings the model rejects (per the catalog) are left out so the provider
 * default applies, e.g. Kimi K2.6 only allows temperature 1.
 */
export function buildModelRequest(args: {
  model: string;
  prompt: string;
  systemPrompt?: string;
  defaults: { temperature: number; maxTokens: number };
  settings?: ModelSettings;
}): ChatRequest {
  const own = args.settings ?? {};
  const caps = describeModel(args.model).capabilities;
  const systemPrompt = own.systemPrompt || args.systemPrompt;
  const messages: ChatMessage[] = [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    { role: "user", content: args.prompt },
  ];
  return {
    model: args.model,
    messages,
    maxTokens: own.maxTokens ?? args.defaults.maxTokens,
    ...(caps.temperature ? { temperature: own.temperature ?? args.defaults.temperature } : {}),
    ...(caps.topP && own.topP !== undefined ? { topP: own.topP } : {}),
    ...(caps.reasoning && own.reasoningEffort ? { reasoningEffort: own.reasoningEffort } : {}),
  };
}

/** Explicit per-model settings that the model is known to reject, as field errors. */
export function unsupportedSettings(modelSettings: Record<string, ModelSettings>): FieldError[] {
  const problems: FieldError[] = [];
  for (const [model, own] of Object.entries(modelSettings)) {
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

/** What we store with each result, so a call can be reproduced. */
export function settingsRecord(request: ChatRequest) {
  return {
    maxTokens: request.maxTokens,
    temperature: request.temperature ?? null,
    topP: request.topP ?? null,
    reasoningEffort: request.reasoningEffort ?? null,
    systemPrompt: request.messages.find((m) => m.role === "system")?.content ?? null,
  };
}
