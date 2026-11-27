"use client";

import { SlidersHorizontal } from "lucide-react";
import type { PriorityWeights } from "@fomo/shared";
import { Slider } from "@/components/ui/slider";
import { normalise, percentages, presetFor, PRIORITY_WEIGHTS, setWeight, type Priority } from "@/lib/recommend";
import { cn } from "@/lib/utils";

const PRESETS: { value: Priority; label: string }[] = [
  { value: "quality", label: "Quality" },
  { value: "balanced", label: "Balanced" },
  { value: "cost", label: "Cost" },
  { value: "speed", label: "Speed" },
];

/**
 * "What matters most?" Presets for the common cases, plus a Custom mode with
 * three sliders. The sliders always add up to 100%: moving one rebalances the
 * other two in proportion, so each thumb shows its real share.
 */
export function PriorityPicker({
  value,
  onChange,
  custom,
  onCustomChange,
  size = "md",
}: {
  value: PriorityWeights;
  onChange: (w: PriorityWeights) => void;
  custom: boolean;
  onCustomChange: (v: boolean) => void;
  size?: "sm" | "md";
}) {
  const active = custom ? null : presetFor(value);
  const share = normalise(value);
  const pct = percentages(value);
  return (
    <div className="space-y-3">
      <div className="bg-background inline-flex flex-wrap rounded-lg border p-0.5" role="radiogroup" aria-label="What matters most">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={active === p.value}
            onClick={() => {
              onCustomChange(false);
              onChange(PRIORITY_WEIGHTS[p.value]);
            }}
            className={cn(
              "rounded-md transition-colors",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1 text-sm",
              active === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={active === null}
          onClick={() => onCustomChange(true)}
          className={cn(
            "flex items-center gap-1 rounded-md transition-colors",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1 text-sm",
            active === null ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <SlidersHorizontal className="size-3.5" /> Custom
        </button>
      </div>
      {active === null && (
        <div className="grid max-w-md gap-2">
          {(["quality", "cost", "speed"] as const).map((k) => (
            <label key={k} className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-3 text-sm capitalize">
              {k}
              <Slider
                value={[share[k]]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={([v]) => onChange(setWeight(value, k, v ?? 0))}
                aria-label={`${k} weight`}
                valueText={`${pct[k]}%`}
              />
              <span className="text-muted-foreground text-right text-xs tabular-nums">{pct[k]}%</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
