import { Gavel, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CompareState } from "@/lib/compare-state";
import { readableRationale } from "@/lib/run-insights";

/** Why the judge picked its winner, in display names. The scores themselves live on the Evidence tab. */
export function JudgeCard({ judge, label }: { judge: CompareState["judge"]; label: (id: string) => string }) {
  if (judge.status === "off") return null;
  const verdict = judge.verdict;
  return (
    <Card className="bg-accent-soft/30 border-primary/20">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Gavel className="text-primary size-4" />
          {verdict ? (verdict.winnerModel ? `Why the judge picked ${label(verdict.winnerModel)}` : "Why there is no winner") : "Judge"}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-1.5">
          {judge.model && <Badge variant="outline">judge: {label(judge.model)}</Badge>}
          {verdict?.selfJudged && <Badge variant="warning">the judge is also a contestant</Badge>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(judge.status === "pending" || judge.status === "running") && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {judge.status === "pending" ? "Waiting for the answers…" : "Judging…"}
          </p>
        )}
        {judge.status === "failed" && (
          <p className="text-destructive text-sm">
            {judge.problem?.title}: {judge.problem?.detail}
          </p>
        )}
        {verdict && <p className="leading-relaxed">{readableRationale(verdict.rationale, label)}</p>}
        <p className="text-muted-foreground text-xs">
          Answers are anonymised and scored by a separate model{verdict?.orders === 2 ? " twice, in swapped order, and averaged" : ""}. If the order changes the
          winner, it counts as a tie. Treat it as a second opinion, not ground truth.
        </p>
      </CardContent>
    </Card>
  );
}
