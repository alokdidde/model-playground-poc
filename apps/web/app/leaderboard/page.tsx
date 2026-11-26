import Link from "next/link";
import { TASK_TYPE_IDS, TASK_TYPES, type TaskType } from "@fomo/shared";
import { describeModel } from "@fomo/llm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getLeaderboard } from "@/lib/server/leaderboard";
import { formatTps } from "@/lib/metrics";
import { cn, formatMs, formatUsd } from "@/lib/utils";

export const dynamic = "force-dynamic";

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  const { task } = await searchParams;
  const taskType = (TASK_TYPE_IDS as readonly string[]).includes(task ?? "") ? (task as TaskType) : undefined;
  const rows = await getLeaderboard("all", taskType);
  const filters: { id?: TaskType; label: string }[] = [{ label: "All tasks" }, ...TASK_TYPE_IDS.map((id) => ({ id, label: TASK_TYPES[id].label }))];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Leaderboard</CardTitle>
        <CardDescription>
          Judge scores and win rates across batch evals and interactive comparisons, next to cost, latency and
          reliability. Human votes from the compare view are shown separately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <nav aria-label="Filter by task type" className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <Link
              key={f.label}
              href={f.id ? `/leaderboard?task=${f.id}` : "/leaderboard"}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                f.id === taskType ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{taskType ? `No ${TASK_TYPES[taskType].label.toLowerCase()} runs yet.` : "No data yet. Run a comparison or a batch eval."}</p>
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
                <TableHead title="Median time to first token">TTFT p50</TableHead>
                <TableHead title="Mean output tokens per second (includes reasoning tokens)">Speed</TableHead>
                <TableHead>Avg cost / call</TableHead>
                <TableHead>Error rate</TableHead>
                <TableHead>Calls</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.model}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="font-medium">{describeModel(r.model).label}</TableCell>
                  <TableCell>{r.avgScore === null ? "–" : `${r.avgScore.toFixed(1)} (${r.judged})`}</TableCell>
                  <TableCell>{pct(r.winRate)}</TableCell>
                  <TableCell>{r.humanVotes}</TableCell>
                  <TableCell>{formatMs(r.avgLatencyMs === null ? null : Math.round(r.avgLatencyMs))}</TableCell>
                  <TableCell>{formatMs(r.p50TtftMs)}</TableCell>
                  <TableCell>{formatTps(r.avgTokensPerSec)}</TableCell>
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
