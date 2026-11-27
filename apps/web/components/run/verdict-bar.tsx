"use client";

import { AlertTriangle, ArrowRight, CircleCheck, Crown, Loader2, Scale, Sparkles, Trophy } from "lucide-react";
import type { CallMetrics, JudgeVerdict, PriorityWeights } from "@fomo/shared";
import { Button } from "@/components/ui/button";
import { presetFor, recommend } from "@/lib/recommend";
import { verdictConfidence } from "@/lib/run-insights";

/**
 * The combined analysis in one line, shown above every tab: the judge's
 * winner and how sure it is, the recommendation, and your own pick.
 */
export function VerdictBar({
  verdict,
  judging,
  metrics,
  priority,
  vote,
  label,
  onOpenDecision,
}: {
  verdict: JudgeVerdict | null | undefined;
  judging: boolean;
  metrics: Record<string, CallMetrics | undefined>;
  priority: PriorityWeights;
  vote: string | null;
  label: (id: string) => string;
  onOpenDecision: () => void;
}) {
  if (!verdict) {
    if (!judging) return null;
    return (
      <div className="bg-accent-soft/50 border-primary/20 text-muted-foreground flex items-center gap-2 rounded-xl border px-4 py-3 text-sm">
        <Loader2 className="size-4 animate-spin" /> The judge scores the answers once they are all in.
      </div>
    );
  }
  const confidence = verdictConfidence(verdict);
  const winnerScore = verdict.scores.find((s) => s.model === verdict.winnerModel)?.overall;
  const candidates = verdict.scores.flatMap((score) => (metrics[score.model] ? [{ model: score.model, score, metrics: metrics[score.model]! }] : []));
  const rec = recommend(candidates, priority);
  const priorityName = presetFor(priority) ?? "your weights";

  return (
    <section aria-label="Verdict" className="bg-accent-soft/50 border-primary/20 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-4 py-3 text-sm">
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
        <Scale className="size-4" /> Verdict
      </span>

      <span className="flex items-center gap-1.5">
        <Trophy className="text-primary size-4" />
        {verdict.winnerModel ? (
          <>
            Judge&apos;s winner: <b className="font-semibold">{label(verdict.winnerModel)}</b>
            {winnerScore !== undefined && <span className="text-muted-foreground tabular-nums">{winnerScore}/10</span>}
          </>
        ) : (
          <b className="font-semibold">No winner</b>
        )}
      </span>

      {confidence.kind !== "single" && (
        <span
          className={
            confidence.kind === "clear"
              ? "flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
              : "flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
          }
          title="Clear means the judge picked the same winner with the answers in both orders and it leads by more than 1 point."
        >
          {confidence.kind === "clear" ? <CircleCheck className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
          {confidence.kind === "clear"
            ? `Clear: ${confidence.gap} pts ahead, same in both orders`
            : confidence.kind === "flip"
              ? "No clear winner: the order changed the pick"
              : `Close call: ${confidence.gap} pts apart`}
        </span>
      )}

      {rec && (
        <span className="flex items-center gap-1.5">
          <Sparkles className="text-primary size-4" />
          Recommended ({priorityName}): <b className="font-semibold">{label(rec.pick)}</b>
        </span>
      )}

      {vote && (
        <span className="flex items-center gap-1.5">
          <Crown className="size-4 text-amber-600 dark:text-amber-300" />
          Your pick: <b className="font-semibold">{label(vote)}</b>
          {verdict.winnerModel && (
            <span className="text-muted-foreground">{vote === verdict.winnerModel ? "· the judge agrees" : `· the judge picked ${label(verdict.winnerModel)}`}</span>
          )}
        </span>
      )}

      <Button variant="ghost" size="sm" className="text-primary ml-auto" onClick={onOpenDecision}>
        Why <ArrowRight />
      </Button>
    </section>
  );
}
