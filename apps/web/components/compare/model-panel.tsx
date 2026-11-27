import { AlertTriangle, Crown, Loader2, ThumbsDown, ThumbsUp, Trophy } from "lucide-react";
import type { JudgeScore } from "@fomo/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { ModelPanel as Panel } from "@/lib/compare-state";
import { cn, formatMs, formatUsd } from "@/lib/utils";
import { Markdown } from "@/components/markdown";
import { formatTps, WIN_LABELS, type MetricKey } from "@/lib/metrics";

const STATUS_BADGE: Record<Panel["status"], { label: string; variant: "secondary" | "outline" | "success" | "destructive" | "warning" }> = {
  pending: { label: "Queued", variant: "outline" },
  streaming: { label: "Streaming", variant: "secondary" },
  retrying: { label: "Retrying", variant: "warning" },
  waiting: { label: "Waiting", variant: "warning" },
  done: { label: "Done", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
};

export type Rating = "up" | "down" | null;

export function ModelPanel({
  panel,
  label,
  rating,
  onRate,
  score,
  isWinner,
  voted,
  canVote,
  onVote,
  color,
  wins = new Set(),
}: {
  panel: Panel;
  label: string;
  rating: Rating;
  onRate: (rating: Rating) => void;
  score?: JudgeScore;
  isWinner: boolean;
  voted: boolean;
  canVote: boolean;
  onVote: () => void;
  /** This model's color in the "How the models did" charts. */
  color?: string;
  /** Metrics this model was best on in this run. */
  wins?: Set<MetricKey>;
}) {
  const badge = STATUS_BADGE[panel.status];
  const busy = panel.status === "pending" || panel.status === "streaming" || panel.status === "retrying" || panel.status === "waiting";

  return (
    <Card className={cn("min-h-64", isWinner && "border-primary ring-primary/30 ring-2")}>
      <CardHeader>
        <div className="flex items-center gap-2">
          {color && <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />}
          <CardTitle className="truncate text-sm" title={panel.model}>
            {label}
          </CardTitle>
          {score ? (
            <span
              className={cn("ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums", isWinner ? "bg-primary text-primary-foreground" : "bg-muted")}
              title="The judge's overall score"
            >
              {isWinner && <Crown className="mr-1 inline size-3.5 align-[-2px]" aria-label="Judge's pick" />}
              {score.overall}/10
            </span>
          ) : (
            <span className="ml-auto" />
          )}
          {panel.status !== "done" && (
            <Badge variant={badge.variant}>
              {busy && <Loader2 className="animate-spin" />}
              {badge.label}
            </Badge>
          )}
        </div>
        {(isWinner || wins.size > 0) && (
          <div className="flex flex-wrap gap-1">
            {isWinner && <WinChip>Judge&apos;s pick</WinChip>}
            {[...wins].map((k) => (
              <WinChip key={k}>{WIN_LABELS[k]}</WinChip>
            ))}
          </div>
        )}
        {panel.note && <p className="text-xs text-amber-600">{panel.note}</p>}
      </CardHeader>

      <CardContent className="flex-1">
        {panel.problem && (
          <div className="border-destructive/40 bg-destructive/5 mb-3 flex gap-2 rounded-md border p-2 text-xs">
            <AlertTriangle className="text-destructive size-4 shrink-0" />
            <div>
              <div className="font-medium">{panel.problem.title}</div>
              <div className="text-muted-foreground">{panel.problem.detail}</div>
            </div>
          </div>
        )}
        <div className="max-h-96 overflow-y-auto">
          {panel.output ? (
            <Markdown text={panel.output} />
          ) : busy ? (
            <span className="text-muted-foreground text-sm">Waiting for the first token… (reasoning models think first)</span>
          ) : null}
        </div>
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-3 border-t pt-3">
        {panel.status === "failed" ? (
          <span className="text-muted-foreground text-xs">No answer, so nothing to measure.</span>
        ) : panel.metrics ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              <Stat label="First token" value={formatMs(panel.metrics.ttftMs)} best={wins.has("ttftMs")} hint="Time until the answer starts to appear" />
              <Stat label="Total time" value={formatMs(panel.metrics.latencyMs)} best={wins.has("latencyMs")} />
              <Stat
                label="Speed"
                value={formatTps(panel.metrics.outputTokensPerSec) + (panel.metrics.reasoned ? "*" : "")}
                best={wins.has("outputTokensPerSec")}
                hint={panel.metrics.reasoned ? "Includes hidden reasoning tokens" : "Output tokens per second"}
              />
              <Stat label="Cost" value={formatUsd(panel.metrics.costUsd)} best={wins.has("costUsd")} />
            </dl>
            <p className="text-muted-foreground text-xs" title={panel.metrics.tokensEstimated ? "Estimated: provider did not report usage" : undefined}>
              {panel.metrics.inputTokens} tokens in · {panel.metrics.outputTokens} tokens out{panel.metrics.tokensEstimated ? " (estimated)" : ""}
              {panel.metrics.attempts > 1 && ` · ${panel.metrics.attempts} attempts`}
            </p>
            {panel.metrics.maxTokensRaisedTo && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Ran out of tokens while reasoning, so it was retried with max tokens {panel.metrics.maxTokensRaisedTo}. Only the retry is counted above.
              </p>
            )}
          </>
        ) : (
          <span className="text-muted-foreground text-xs">No metrics yet</span>
        )}
        {canVote && (
          <div className="flex items-center gap-1 border-t pt-3">
            <span className="text-muted-foreground mr-1 text-xs">Rate this answer</span>
            <Button
              size="icon"
              variant={rating === "up" ? "default" : "ghost"}
              className="size-8"
              aria-label="Good answer"
              aria-pressed={rating === "up"}
              onClick={() => onRate(rating === "up" ? null : "up")}
            >
              <ThumbsUp />
            </Button>
            <Button
              size="icon"
              variant={rating === "down" ? "destructive" : "ghost"}
              className="size-8"
              aria-label="Bad answer"
              aria-pressed={rating === "down"}
              onClick={() => onRate(rating === "down" ? null : "down")}
            >
              <ThumbsDown />
            </Button>
            <Button size="sm" className="ml-auto" variant={voted ? "default" : "outline"} onClick={onVote}>
              <Crown /> {voted ? "Your pick" : "Pick as best"}
            </Button>
          </div>
        )}
      </CardFooter>
    </Card>
  );
}

function WinChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
      <Trophy className="size-3" />
      {children}
    </span>
  );
}

function Stat({ label, value, best, hint }: { label: string; value: string; best: boolean; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-muted-foreground text-[11px]">
        {label}
        {best && <span className="text-primary font-medium"> · best</span>}
      </dt>
      <dd className={cn("text-sm font-medium whitespace-nowrap tabular-nums", best && "text-primary font-semibold")}>{value}</dd>
    </div>
  );
}
