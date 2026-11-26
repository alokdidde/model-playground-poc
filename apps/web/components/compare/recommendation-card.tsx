"use client";

import { Sparkles } from "lucide-react";
import type { CallMetrics, JudgeVerdict } from "@fomo/shared";
import { Card } from "@/components/ui/card";
import { describeRecommendation, recommend, type Priority } from "@/lib/recommend";
import { cn, formatMs, formatUsd } from "@/lib/utils";

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "quality", label: "Quality" },
  { value: "balanced", label: "Balanced" },
  { value: "cost", label: "Cost" },
  { value: "speed", label: "Speed" },
];

/** "Which one should I use?" — the judge's quality score traded off against cost and latency. */
export function RecommendationCard({
  verdict,
  metrics,
  label,
  priority,
  onPriorityChange,
}: {
  verdict: JudgeVerdict;
  metrics: Record<string, CallMetrics | undefined>;
  label: (id: string) => string;
  priority: Priority;
  onPriorityChange: (p: Priority) => void;
}) {
  const candidates = verdict.scores.flatMap((score) => {
    const m = metrics[score.model];
    return m ? [{ model: score.model, score, metrics: m }] : [];
  });
  const rec = recommend(candidates, priority);
  if (!rec) return null;
  const pick = candidates.find((c) => c.model === rec.pick)!;

  return (
    <Card className="border-primary/40 bg-accent-soft/40 gap-3 py-4">
      <div className="flex flex-wrap items-center gap-2 px-4">
        <Sparkles className="text-primary size-5" />
        <h2 className="font-semibold">
          Recommended: <span className="text-primary">{label(rec.pick)}</span>
        </h2>
        <div className="bg-background ml-auto inline-flex rounded-lg border p-0.5" role="radiogroup" aria-label="Optimise for">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={priority === p.value}
              onClick={() => onPriorityChange(p.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                priority === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4">
        <p className="text-base">
          {describeRecommendation(rec, label)}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Judge score {pick.score.overall}/10 · {formatUsd(pick.metrics.costUsd)} · {formatMs(pick.metrics.latencyMs)}. Based on this one prompt; run a
          batch eval on your own prompts before switching models in production.
        </p>
      </div>
    </Card>
  );
}
