import type { ModelInfo, ModelSettings, ReasoningEffort } from "@fomo/shared";

/** What the UI keeps per selected model. `undefined` reasoning means "provider default". */
export interface SelectedModel {
  id: string;
  settings: {
    temperature: number;
    topP: number;
    maxTokens: number;
    reasoningEffort?: ReasoningEffort;
    systemPrompt: string;
  };
}

export const DEFAULT_SETTINGS: SelectedModel["settings"] = {
  temperature: 0.7,
  topP: 1,
  // Reasoning models spend part of this on hidden thinking; 1024 was often not enough.
  maxTokens: 2048,
  systemPrompt: "",
};

export function newSelection(id: string): SelectedModel {
  return { id, settings: { ...DEFAULT_SETTINGS } };
}

/**
 * The per-model settings to send, keeping only what the model accepts.
 * The server would reject the rest, and the UI hides those controls anyway.
 */
export function toRequestSettings(selected: SelectedModel, info: ModelInfo | undefined): ModelSettings {
  const caps = info?.capabilities ?? { temperature: true, topP: true, reasoning: true, tools: false };
  const s = selected.settings;
  return {
    maxTokens: s.maxTokens,
    ...(caps.temperature ? { temperature: s.temperature } : {}),
    ...(caps.topP ? { topP: s.topP } : {}),
    ...(caps.reasoning && s.reasoningEffort ? { reasoningEffort: s.reasoningEffort } : {}),
    ...(s.systemPrompt.trim() ? { systemPrompt: s.systemPrompt.trim() } : {}),
  };
}

/** Clamp numeric inputs to the API's limits so typing never produces an invalid request. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// ---- presets (per browser, localStorage) ---------------------------------

export interface Preset {
  name: string;
  models: SelectedModel[];
}

const PRESETS_KEY = "fomo.presets.v1";

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Preset[]) : [];
  } catch {
    return [];
  }
}

export function savePreset(preset: Preset): Preset[] {
  const next = [...loadPresets().filter((p) => p.name !== preset.name), preset];
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private mode); the preset just isn't kept.
  }
  return next;
}
