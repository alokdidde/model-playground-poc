"use client";

import { Sparkles } from "lucide-react";
import type { CallMetrics, JudgeVerdict, PriorityWeights } from "@fomo/shared";
import { Card } from "@/components/ui/card";
import { describeRecommendation, QUALITY_GUARD_POINTS, recommend } from "@/lib/recommend";
import { formatMs, formatUsd } from "@/lib/utils";
import { PriorityPicker } from "./priority-picker";

/** "Which one should I use?" — the judge's quality score traded off against cost and latency. */
export function RecommendationCard({
  verdict,
  metrics,
  label,
  priority,
  onPriorityChange,
  customPriority,
  onCustomPriorityChange,
}: {
  verdict: JudgeVerdict;
  metrics: Record<string, CallMetrics | undefined>;
  label: (id: string) => string;
  priority: PriorityWeights;
  onPriorityChange: (w: PriorityWeights) => void;
  customPriority: boolean;
  onCustomPriorityChange: (v: boolean) => void;
}) {
  const candidates = verdict.scores.flatMap((score) => {
    const m = metrics[score.model];
    return m ? [{ model: score.model, score, metrics: m }] : [];
  });
  const rec = recommend(candidates, priority);
  if (!rec) return null;
  const pick = candidates.find((c) => c.model === rec.pick)!;
  // The cheapest answer, to show what you'd give up or save by switching.
  const cheapest = [...candidates].filter((c) => c.metrics.costUsd !== null).sort((a, b) => a.metrics.costUsd! - b.metrics.costUsd!)[0];
  const saving = cheapest && pick.metrics.costUsd !== null ? pick.metrics.costUsd - cheapest.metrics.costUsd! : 0;

  return (
    <Card className="border-primary/20 bg-accent-soft/30 gap-3 py-4">
      <div className="flex flex-wrap items-center gap-2 px-4">
        <Sparkles className="text-primary size-5" />
        <h2 className="font-semibold">
          Recommended: <span className="text-primary">{label(rec.pick)}</span>
        </h2>
        <div className="w-full">
          <PriorityPicker value={priority} onChange={onPriorityChange} custom={customPriority} onCustomChange={onCustomPriorityChange} size="sm" />
        </div>
      </div>
      <div className="px-4">
        <p className="text-base">{describeRecommendation(rec, label)}</p>
        {rec.guarded && (
          <p className="text-muted-foreground mt-1 text-sm">
            A cheaper or faster answer ranked higher on the weights, but the judge scored it {QUALITY_GUARD_POINTS}+ points lower, so it isn&apos;t recommended.
          </p>
        )}
        {cheapest && cheapest.model !== rec.pick && saving > 0 && (
          <p className="bg-muted/60 mt-2 rounded-md px-3 py-2 text-sm">
            Cheapest option: <b className="font-medium">{label(cheapest.model)}</b> scored {cheapest.score.overall} vs {pick.score.overall}. It saves{" "}
            {formatUsd(saving)} a call, about ${Math.round(saving * 1_000_000).toLocaleString()} per million calls.
          </p>
        )}
        <p className="text-muted-foreground mt-1 text-xs">
          Judge score {pick.score.overall}/10 · {formatUsd(pick.metrics.costUsd)} · {formatMs(pick.metrics.latencyMs)}. Based on this one prompt, so
          check it on your own prompts before switching models in production.
        </p>
      </div>
    </Card>
  );
}
