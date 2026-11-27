"use client";

import { useState } from "react";
import { AlertTriangle, Check, Coins, Copy, Crown, Loader2, ThumbsDown, ThumbsUp, Timer, Trophy, Zap } from "lucide-react";
import type { JudgeScore } from "@fomo/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import type { ModelPanel as Panel } from "@/lib/compare-state";
import { isJsonAnswer } from "@/lib/run-insights";
import { cn, formatMs, formatUsd } from "@/lib/utils";
import type { MetricKey } from "@/lib/metrics";

const STATUS_BADGE: Record<Panel["status"], { label: string; variant: "secondary" | "outline" | "success" | "destructive" | "warning" }> = {
  pending: { label: "Queued", variant: "outline" },
  streaming: { label: "Streaming", variant: "secondary" },
  retrying: { label: "Retrying", variant: "warning" },
  waiting: { label: "Waiting", variant: "warning" },
  done: { label: "Done", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
};

export type Rating = "up" | "down" | null;

/**
 * One model's answer as a column. The header stays pinned under the tab bar
 * while you read, so you always know whose text it is and what it cost.
 */
export function AnswerColumn({
  panel,
  label,
  color,
  score,
  isWinner,
  picked,
  canVote,
  rating,
  onRate,
  onPick,
  wins,
  pinHeader,
}: {
  panel: Panel;
  label: string;
  color: string;
  score?: JudgeScore;
  isWinner: boolean;
  picked: boolean;
  canVote: boolean;
  rating: Rating;
  onRate: (rating: Rating) => void;
  /** Toggles: picking your pick again clears it. */
  onPick: () => void;
  /** Metrics this model was best on, to highlight them. */
  wins: Set<MetricKey>;
  /** Pin the header while scrolling. Off when the columns scroll sideways, where sticky can't work. */
  pinHeader: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const busy = ["pending", "streaming", "retrying", "waiting"].includes(panel.status);
  const badge = STATUS_BADGE[panel.status];
  const m = panel.metrics;

  async function copy() {
    await navigator.clipboard.writeText(panel.output).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <article
      id={`answer-${panel.model}`}
      className={cn("bg-card flex min-w-0 flex-col rounded-xl border shadow-sm", isWinner && "border-primary/60 ring-primary/20 ring-2")}
      aria-label={`${label}'s answer`}
    >
      <header className={cn("bg-card z-10 space-y-1.5 rounded-t-xl border-b px-4 py-3", pinHeader && "md:sticky md:top-14")}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <h3 className="truncate text-sm font-semibold" title={panel.model}>
            {label}
          </h3>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {panel.status !== "done" && (
              <Badge variant={badge.variant}>
                {busy && <Loader2 className="animate-spin" />}
                {badge.label}
              </Badge>
            )}
            {score && (
              <span
                className={cn("rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums", isWinner ? "bg-primary text-primary-foreground" : "bg-muted")}
                title="The judge's overall score"
              >
                {score.overall}/10
              </span>
            )}
          </div>
        </div>
        {(isWinner || picked) && (
          <div className="flex flex-wrap gap-1">
            {isWinner && (
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                <Trophy /> Judge&apos;s winner
              </Badge>
            )}
            {picked && (
              <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                <Crown /> Your pick
              </Badge>
            )}
          </div>
        )}
        {m && (
          <dl className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
            <Stat icon={Timer} label="Done in" short="done" value={formatMs(m.latencyMs)} best={wins.has("latencyMs")} />
            <Stat icon={Zap} label="First word" short="first word" value={formatMs(m.ttftMs)} best={wins.has("ttftMs")} />
            <Stat icon={Coins} label="Cost" value={formatUsd(m.costUsd)} best={wins.has("costUsd")} />
          </dl>
        )}
      </header>

      <div className="flex-1 px-4 py-3">
        {panel.note && <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">{panel.note}</p>}
        {panel.problem && (
          <div className="border-destructive/40 bg-destructive/5 mb-3 flex gap-2 rounded-md border p-2 text-xs">
            <AlertTriangle className="text-destructive size-4 shrink-0" />
            <div>
              <div className="font-medium">{panel.problem.title}</div>
              <div className="text-muted-foreground">{panel.problem.detail}</div>
            </div>
          </div>
        )}
        {panel.output ? (
          isJsonAnswer(panel.output) ? (
            <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{panel.output.trim()}</pre>
          ) : (
            <Markdown text={panel.output} className="text-[0.95rem] leading-relaxed" />
          )
        ) : busy ? (
          <span className="text-muted-foreground text-sm">Waiting for the first word… (reasoning models think first)</span>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center gap-1 border-t px-3 py-2">
        {m && (
          <span className="text-muted-foreground mr-auto pl-1 text-xs tabular-nums" title={m.tokensEstimated ? "Estimated: the provider did not report usage" : undefined}>
            {m.inputTokens} in · {m.outputTokens} out{m.tokensEstimated ? "*" : ""}
            {m.attempts > 1 && ` · ${m.attempts} tries`}
          </span>
        )}
        {panel.output && (
          <IconButton label={copied ? "Copied" : "Copy answer"} onClick={copy}>
            {copied ? <Check /> : <Copy />}
          </IconButton>
        )}
        {canVote && (
          <>
            <IconButton label="Good answer" pressed={rating === "up"} onClick={() => onRate(rating === "up" ? null : "up")} activeClass="text-emerald-600 bg-emerald-500/10">
              <ThumbsUp />
            </IconButton>
            <IconButton label="Bad answer" pressed={rating === "down"} onClick={() => onRate(rating === "down" ? null : "down")} activeClass="text-destructive bg-destructive/10">
              <ThumbsDown />
            </IconButton>
            <IconButton
              label={picked ? "Your pick (click to clear)" : "Pick as the best answer"}
              pressed={picked}
              onClick={onPick}
              activeClass="text-amber-600 bg-amber-500/15 dark:text-amber-300"
            >
              <Crown />
            </IconButton>
          </>
        )}
      </footer>
      {m?.maxTokensRaisedTo && (
        <p className="border-t px-4 py-2 text-xs text-amber-600 dark:text-amber-400">
          Ran out of tokens while reasoning, so it was retried with max tokens {m.maxTokensRaisedTo}. Only the retry is counted.
        </p>
      )}
    </article>
  );
}

function Stat({ icon: Icon, label, short, value, best }: { icon: typeof Timer; label: string; short?: string; value: string; best: boolean }) {
  return (
    <div className="flex items-center gap-1" title={best ? `${label}: best in this run` : label}>
      <Icon className="size-3.5" aria-hidden />
      <dt className="sr-only">{label}</dt>
      <dd className={cn("text-foreground", best && "font-semibold text-emerald-600 dark:text-emerald-400")}>
        {value}
        {short && <span className="text-muted-foreground font-normal"> {short}</span>}
      </dd>
    </div>
  );
}

function IconButton({
  label,
  pressed,
  onClick,
  activeClass,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  activeClass?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-8", pressed && activeClass)}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
