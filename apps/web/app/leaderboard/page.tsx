import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getLeaderboard } from "@/lib/server/leaderboard";
import { formatMs, formatUsd } from "@/lib/utils";

export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

export default async function LeaderboardPage() {
  const rows = await getLeaderboard("all");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Leaderboard</CardTitle>
        <CardDescription>
          Judge scores and win rates across batch evals and interactive comparisons, next to cost, latency and
          reliability. Human votes from the compare view are shown separately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No data yet. Run a comparison or a batch eval.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Avg judge score</TableHead>
                <TableHead>Win rate</TableHead>
                <TableHead>Human votes</TableHead>
                <TableHead>Avg latency</TableHead>
                <TableHead>Avg cost / call</TableHead>
                <TableHead>Error rate</TableHead>
                <TableHead>Calls</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.model}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="font-medium">{r.model}</TableCell>
                  <TableCell>{r.avgScore === null ? "–" : `${r.avgScore.toFixed(1)} (${r.judged})`}</TableCell>
                  <TableCell>{pct(r.winRate)}</TableCell>
                  <TableCell>{r.humanVotes}</TableCell>
                  <TableCell>{formatMs(r.avgLatencyMs === null ? null : Math.round(r.avgLatencyMs))}</TableCell>
                  <TableCell>{formatUsd(r.avgCostUsd)}</TableCell>
                  <TableCell>{pct(r.errorRate)}</TableCell>
                  <TableCell>{r.calls}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
