"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, MessageSquareText, Sparkles } from "lucide-react";
import { TASK_TYPES } from "@fomo/shared";
import type { AdvisorResult } from "@/lib/server/advisor-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { fetchJson, ProblemError } from "@/lib/api-client";
import { formatTps } from "@/lib/metrics";
import { cn, formatMs, formatUsd } from "@/lib/utils";

const EXAMPLES = [
  "A customer support chatbot for an online shop. High volume, so it must be cheap, and replies should start in under 2 seconds.",
  "Code review comments on pull requests. Accuracy matters most; cost is secondary.",
  "Extract invoice number, date and total from emails into JSON, about 50,000 a day.",
];

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Builds the Compare page URL prefilled with the suggested models and settings. */
export function compareUrl(result: AdvisorResult, models: string[]): string {
  const p = result.intent.priority;
  const params = new URLSearchParams({
    models: models.join(","),
    prompt: result.intent.samplePrompts[0] ?? "",
    task: result.intent.taskType,
    priority: [p.quality, p.cost, p.speed].join(","),
  });
  return `/compare?${params.toString()}`;
}

/**
 * "Help me choose": describe a use case in plain words; get models ranked from
 * our measured data, with a short explanation, and one click to test them.
 */
export function HelpMeChoose() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<AdvisorResult>();

  async function ask(text = query) {
    setQuery(text);
    setLoading(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await fetchJson<AdvisorResult>("/api/advisor", { method: "POST", body: JSON.stringify({ query: text }) }));
    } catch (e) {
      setError(e instanceof ProblemError ? `${e.problem.title}: ${e.problem.detail ?? ""}` : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Ranked within-limits first, so the top 3 are the best fits plus, if needed, the closest alternatives.
  const top = result?.ranking.slice(0, 3).map((r) => r.model) ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Help me choose a model</h1>
        <p className="text-muted-foreground mt-1">
          Describe what you&apos;re building in plain words. We work out the task and what matters to you, then rank models using the scores, speed and cost measured in this app&apos;s compares, not a
          model&apos;s opinion.
        </p>
      </div>

      <Card className="gap-3 p-4">
        <Textarea
          rows={4}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. A support chatbot for an online shop. Cheap, and replies should start in under 2 seconds."
          aria-label="Describe your use case"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => ask()} disabled={loading || query.trim().length < 10}>
            {loading ? <Loader2 className="animate-spin" /> : <MessageSquareText />} Find my model
          </Button>
          <span className="text-muted-foreground text-xs">or try:</span>
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => ask(e)} disabled={loading} className="hover:bg-muted max-w-[260px] truncate rounded-full border px-3 py-1 text-xs">
              {e}
            </button>
          ))}
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
      </Card>

      {loading && <p className="text-muted-foreground text-sm">Reading your use case and checking the measured data…</p>}

      {result && (
        <>
          <Card className="border-primary/40 bg-accent-soft/40 gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="text-primary size-5" />
              <h2 className="font-semibold">{result.ranking[0] ? `Try ${result.ranking[0].label} first` : "No measured data yet"}</h2>
            </div>
            <p className="text-sm">{result.intent.summary}</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{TASK_TYPES[result.intent.taskType].label}</Badge>
              <Badge variant="outline">
                quality {pct(result.intent.priority.quality)} · cost {pct(result.intent.priority.cost)} · speed {pct(result.intent.priority.speed)}
              </Badge>
              {result.intent.maxLatencyMs !== null && <Badge variant="outline">starts within {formatMs(result.intent.maxLatencyMs)}</Badge>}
              {result.intent.maxCostPerCallUsd !== null && <Badge variant="outline">at most {formatUsd(result.intent.maxCostPerCallUsd)} per call</Badge>}
            </div>
            {result.explanation && <Markdown text={result.explanation} className="text-sm" />}
            <p className="text-muted-foreground text-xs">
              Ranked from {result.basis}. Explanation written by {result.assistantModel} from these numbers only.
            </p>
            {top.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => router.push(compareUrl(result, top))}>
                  Compare the top {top.length} <ArrowRight />
                </Button>
              </div>
            )}
          </Card>

          {result.ranking.length > 0 && (
            <Card className="gap-2 py-4">
              <h2 className="px-4 font-semibold">Ranking</h2>
              <div className="relative overflow-x-auto px-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead title="Weighted by your priorities, 0 to 1">Fit score</TableHead>
                      <TableHead title="Mean judge score, and how many answers it is based on">Quality</TableHead>
                      <TableHead title="Median time until the answer starts">First token</TableHead>
                      <TableHead>Total time</TableHead>
                      <TableHead>Speed</TableHead>
                      <TableHead>Cost per call</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.ranking.slice(0, 8).map((r) => (
                      <TableRow key={r.model} className={cn(!r.withinLimits && "opacity-60")}>
                        <TableCell>{r.rank}</TableCell>
                        <TableCell className="font-medium">
                          {r.label}
                          {!r.withinLimits && (
                            <Badge variant="warning" className="ml-2">
                              outside your limits
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{r.value.toFixed(2)}</TableCell>
                        <TableCell>
                          {r.avgScore ?? "–"}/10 <span className="text-muted-foreground text-xs">({r.judged})</span>
                        </TableCell>
                        <TableCell>{formatMs(r.p50TtftMs)}</TableCell>
                        <TableCell>{formatMs(r.avgLatencyMs)}</TableCell>
                        <TableCell>{formatTps(r.avgTokensPerSec)}</TableCell>
                        <TableCell>{formatUsd(r.avgCostUsd)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {result.untested.length > 0 && (
                <p className="text-muted-foreground px-4 text-xs">
                  Not ranked yet (no judged runs): {result.untested.map((u) => u.label).join(", ")}. Add them to a compare to measure them.
                </p>
              )}
            </Card>
          )}

          <Card className="gap-2 p-4">
            <h2 className="font-semibold">Sample prompts for your use case</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {result.intent.samplePrompts.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
