import { Gavel, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CompareState } from "@/lib/compare-state";

const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

export function JudgePanel({
  judge,
  label = (id) => id,
  outputs = {},
}: {
  judge: CompareState["judge"];
  label?: (id: string) => string;
  /** The answers, to show each one's length next to its score (judges tend to favour longer answers). */
  outputs?: CompareState["panels"];
}) {
  if (judge.status === "off") return null;
  const verdict = judge.verdict;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="text-primary size-4" /> Judge scores
          {judge.model && <Badge variant="outline">judge: {label(judge.model)}</Badge>}
          {verdict?.selfJudged && <Badge variant="warning">judge is also a contestant</Badge>}
          {verdict?.positionConsistent === false && <Badge variant="warning">tie: order changed the winner</Badge>}
        </CardTitle>
        <CardDescription>
          Answers are anonymised and scored by an independent model{verdict?.orders === 2 ? " twice, in two orders, and averaged" : ""}.
          If the order changes the winner, it counts as a tie. Treat this as a second opinion, not ground truth.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
        {verdict && (
          <>
            <p className="text-sm">
              <span className="font-medium">
                Winner: {verdict.winnerModel ? label(verdict.winnerModel) : verdict.positionConsistent === false ? "tie" : "none"}.
              </span>{" "}
              {verdict.rationale}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead>Helpfulness</TableHead>
                  <TableHead>Clarity</TableHead>
                  <TableHead>Overall</TableHead>
                  <TableHead title="Answer length. Judges tend to favour longer answers, so check that a high score isn't just length.">Words</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...verdict.scores]
                  .sort((a, b) => b.overall - a.overall)
                  .map((s) => (
                    <TableRow key={s.model}>
                      <TableCell className="font-medium">{label(s.model)}</TableCell>
                      <TableCell>{s.accuracy}</TableCell>
                      <TableCell>{s.helpfulness}</TableCell>
                      <TableCell>{s.clarity}</TableCell>
                      <TableCell className="font-semibold">{s.overall}</TableCell>
                      <TableCell className="text-muted-foreground">{outputs[s.model] ? wordCount(outputs[s.model]!.output) : "—"}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
