import { AlertTriangle, Crown, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import type { JudgeScore } from "@fomo/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { ModelPanel as Panel } from "@/lib/compare-state";
import { cn, formatMs, formatUsd } from "@/lib/utils";
import { Markdown } from "@/components/markdown";
import { formatTps } from "@/lib/metrics";

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
}) {
  const badge = STATUS_BADGE[panel.status];
  const busy = panel.status === "pending" || panel.status === "streaming" || panel.status === "retrying" || panel.status === "waiting";

  return (
    <Card className={cn("min-h-64", isWinner && "border-primary ring-primary/30 ring-2")}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="truncate text-sm" title={panel.model}>
            {label}
          </CardTitle>
          {isWinner && <Crown className="text-primary size-4" aria-label="Judge's pick" />}
          <Badge variant={badge.variant} className="ml-auto">
            {busy && <Loader2 className="animate-spin" />}
            {badge.label}
          </Badge>
        </div>
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

      <CardFooter className="flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs">
        {panel.metrics ? (
          <>
            <span title="Time to first token">TTFT {formatMs(panel.metrics.ttftMs)}</span>
            <span>Total {formatMs(panel.metrics.latencyMs)}</span>
            {panel.metrics.outputTokensPerSec !== undefined && (
              <span title={panel.metrics.reasoned ? "Includes hidden reasoning tokens" : "Output tokens per second"}>
                {formatTps(panel.metrics.outputTokensPerSec)}
              </span>
            )}
            <span title={panel.metrics.tokensEstimated ? "Estimated: provider did not report usage" : undefined}>
              {panel.metrics.inputTokens}→{panel.metrics.outputTokens} tok{panel.metrics.tokensEstimated ? "*" : ""}
            </span>
            <span>{formatUsd(panel.metrics.costUsd)}</span>
            {panel.metrics.attempts > 1 && <span>{panel.metrics.attempts} attempts</span>}
          </>
        ) : (
          <span className="text-muted-foreground">No metrics yet</span>
        )}
        {score && <span className="font-medium">Judge: {score.overall}/10</span>}
        {canVote && (
          <div className="ml-auto flex items-center gap-1">
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
            <Button size="sm" variant={voted ? "default" : "outline"} onClick={onVote}>
              <Crown /> {voted ? "Your pick" : "Best answer"}
            </Button>
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
