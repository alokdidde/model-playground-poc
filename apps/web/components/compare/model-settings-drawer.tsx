"use client";

import { Info, Settings, X } from "lucide-react";
import { LIMITS, type ModelInfo, type ReasoningEffort } from "@fomo/shared";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { clamp, DEFAULT_SETTINGS, type SelectedModel } from "@/lib/model-settings";
import { cn } from "@/lib/utils";
import { ProviderAvatar } from "./provider-avatar";

const LEVELS: (ReasoningEffort | undefined)[] = [undefined, "low", "medium", "high"];

/**
 * Per-model settings in a right-hand shadcn Drawer (vaul). Controls the model
 * doesn't accept are shown disabled with the reason, rather than hidden, so
 * users learn why e.g. Kimi K2.6 has no temperature.
 */
export function ModelSettingsDrawer({
  model,
  info,
  onChange,
  onClose,
}: {
  model: SelectedModel | null;
  info: ModelInfo | undefined;
  onChange: (settings: SelectedModel["settings"]) => void;
  onClose: () => void;
}) {
  const caps = info?.capabilities ?? { temperature: true, topP: true, reasoning: true, tools: false };
  const s = model?.settings ?? DEFAULT_SETTINGS;
  const set = (patch: Partial<SelectedModel["settings"]>) => onChange({ ...s, ...patch });

  return (
    <Drawer direction="right" open={model !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="sm:max-w-md">
        <DrawerHeader className="border-b">
          <div className="flex items-center gap-2">
            <Settings className="text-primary size-5" />
            <DrawerTitle>Model settings</DrawerTitle>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="ml-auto" aria-label="Close">
                <X />
              </Button>
            </DrawerClose>
          </div>
          <DrawerDescription className="sr-only">Settings applied to this model only.</DrawerDescription>
          <div className="mt-2 flex items-center gap-3">
            <ProviderAvatar provider={info?.provider ?? model?.id ?? "?"} className="size-10" />
            <div>
              <div className="font-semibold">{info?.label ?? model?.id}</div>
              <div className="text-muted-foreground text-sm">{info?.provider}</div>
            </div>
          </div>
        </DrawerHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <Field label="Temperature" hint="Higher is more varied, lower is more focused (0 to 2)." unsupported={!caps.temperature}>
            <SliderWithInput value={s.temperature} min={0} max={2} step={0.05} disabled={!caps.temperature} onChange={(v) => set({ temperature: v })} />
          </Field>

          <Field label="Top P" hint="Only sample from the most likely tokens whose probabilities add up to P." unsupported={!caps.topP}>
            <SliderWithInput value={s.topP} min={0.01} max={1} step={0.01} disabled={!caps.topP} onChange={(v) => set({ topP: v })} />
          </Field>

          <Field label="Max tokens" hint={`Output budget, up to ${LIMITS.maxOutputTokens}. Reasoning models spend part of it thinking.`}>
            <Input
              type="number"
              min={16}
              max={LIMITS.maxOutputTokens}
              step={256}
              value={s.maxTokens}
              onChange={(e) => set({ maxTokens: Math.round(clamp(Number(e.target.value), 16, LIMITS.maxOutputTokens)) })}
              className="w-40"
            />
          </Field>

          <Field label="Reasoning level" hint="How much the model thinks before answering. Default leaves it to the provider." unsupported={!caps.reasoning}>
            <div className={cn("bg-muted inline-flex rounded-lg p-1", !caps.reasoning && "opacity-50")} role="radiogroup" aria-label="Reasoning level">
              {LEVELS.map((level) => {
                const active = s.reasoningEffort === level;
                return (
                  <button
                    key={level ?? "default"}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!caps.reasoning}
                    onClick={() => set({ reasoningEffort: level })}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm capitalize transition-colors disabled:cursor-not-allowed",
                      active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {level ?? "Default"}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="System prompt override" hint="Replaces the shared system prompt for this model only.">
            <Textarea
              rows={3}
              value={s.systemPrompt}
              maxLength={LIMITS.maxSystemPromptChars}
              onChange={(e) => set({ systemPrompt: e.target.value })}
              placeholder="Optional: a custom system prompt for this model only…"
            />
          </Field>

          <Field label="Tools" hint="Tool calling (web search, code execution) is on the roadmap; no model has it in this PoC yet." unsupported unsupportedText="Coming later (roadmap)">
            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              <Switch checked={false} disabled /> Enable tools
            </label>
          </Field>
        </div>

        <DrawerFooter className="justify-between border-t">
          <Button variant="outline" onClick={() => onChange({ ...DEFAULT_SETTINGS })}>
            Reset to default
          </Button>
          <DrawerClose asChild>
            <Button>Done</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function Field({
  label,
  hint,
  unsupported,
  unsupportedText = "Not supported by this model",
  children,
}: {
  label: string;
  hint: string;
  unsupported?: boolean;
  unsupportedText?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        <Info className="text-muted-foreground size-3.5" aria-label={hint}>
          <title>{hint}</title>
        </Info>
        {unsupported && <span className="text-muted-foreground ml-auto text-xs font-normal">{unsupportedText}</span>}
      </div>
      {children}
    </div>
  );
}

function SliderWithInput({
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <Slider value={[value]} min={min} max={max} step={step} disabled={disabled} onValueChange={([v]) => onChange(Number(v!.toFixed(2)))} />
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
        className="w-20 text-center"
        aria-label="Value"
      />
    </div>
  );
}
