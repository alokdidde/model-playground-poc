import Link from "next/link";
import { describeModel } from "@fomo/llm";
import { RateEventsQuerySchema } from "@fomo/shared";
import { describe, RateTimeline } from "@/components/ops/rate-timeline";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getRateEvents, levels, summarize } from "@/lib/server/rate-events";
import { cn, formatMs } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RANGES = [10, 30, 120, 24 * 60];

/**
 * Ops view of the rate limiter: what every lease, wait, 429, cooldown and
 * retry looked like over time. Filter by run with ?tag=<comparison or eval id>.
 */
export default async function RateLimitsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const parsed = RateEventsQuerySchema.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : { minutes: 30 };
  const events = await getRateEvents(query);
  const summary = summarize(events).sort((a, b) => b.granted - a.granted);
  const durationMs = events.at(-1)?.t ?? 0;
  const retries = events.filter((e) => e.kind === "retry");
  const start = events[0]?.at;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Rate limits</CardTitle>
          <CardDescription>
            Every lease, wait for capacity, 429, cooldown and retry the gateway made
            {query.tag ? ` for run ${query.tag}` : ` in the last ${labelFor(query.minutes)}`}
            {start ? `, starting ${new Date(start).toLocaleTimeString()}` : ""}. Hover a mark for its numbers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <nav aria-label="Time range" className="flex flex-wrap gap-1.5">
            {RANGES.map((m) => (
              <Link
                key={m}
                href={`/ops/rate-limits?minutes=${m}`}
                className={cn("rounded-full border px-3 py-1 text-xs", !query.tag && m === query.minutes ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}
              >
                {labelFor(m)}
              </Link>
            ))}
          </nav>
          {summary.length === 0 ? (
            <p className="text-muted-foreground text-sm">No rate-limit events in this range. Run a comparison or a batch eval.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead title="Leases granted (one per attempt)">Leases</TableHead>
                    <TableHead title="Leases that had to wait for capacity: count, p50 / p95 / max wait">Waited</TableHead>
                    <TableHead title="Gave up waiting for capacity">Timeouts</TableHead>
                    <TableHead>429s</TableHead>
                    <TableHead title="Retries, p50 / max delay actually slept">Retries</TableHead>
                    <TableHead title="Failed attempts / successful attempts">Failed / ok</TableHead>
                    <TableHead title="Latency of successful attempts, p50 / p95">Latency</TableHead>
                    <TableHead title="Lowest and last AIMD factor">AIMD</TableHead>
                    <TableHead title="Limits learned from DO's x-ratelimit headers">Learned limits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((s) => (
                    <TableRow key={s.model}>
                      <TableCell className="font-medium">{describeModel(s.model).label}</TableCell>
                      <TableCell>{s.granted}</TableCell>
                      <TableCell>{s.waited ? `${s.waited} · ${formatMs(s.waitP50Ms)} / ${formatMs(s.waitP95Ms)} / ${formatMs(s.waitMaxMs)}` : "0"}</TableCell>
                      <TableCell>{s.timeouts}</TableCell>
                      <TableCell>{s.rateLimited}</TableCell>
                      <TableCell>{s.retries ? `${s.retries} · ${formatMs(s.retryDelayP50Ms)} / ${formatMs(s.retryDelayMaxMs)}` : "0"}</TableCell>
                      <TableCell>{`${s.attemptsFailed} / ${s.attemptsOk}`}</TableCell>
                      <TableCell>{`${formatMs(s.latencyP50Ms)} / ${formatMs(s.latencyP95Ms)}`}</TableCell>
                      <TableCell>{s.minFactor === null ? "1" : `${s.minFactor.toFixed(2)} → ${s.lastFactor?.toFixed(2)}`}</TableCell>
                      <TableCell>{s.learnedRequests ? `${s.learnedRequests} req, ${(s.learnedTokens ?? 0) / 1000}k tok` : "–"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {summary.map((s) => (
        <Card key={s.model}>
          <CardHeader>
            <CardTitle className="text-base">{describeModel(s.model).label}</CardTitle>
          </CardHeader>
          <CardContent>
            <RateTimeline model={s.model} points={levels(events, s.model)} events={events} durationMs={durationMs} />
          </CardContent>
        </Card>
      ))}

      {retries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Retries</CardTitle>
            <CardDescription>
              Each retry's delay: full jitter draws uniformly below the exponential ceiling; when the server says how long to wait, we wait that long plus a small random spread.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>At</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>After attempt</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>Ceiling</TableHead>
                  <TableHead>Jitter draw</TableHead>
                  <TableHead>Server wait + spread</TableHead>
                  <TableHead>Slept</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {retries.slice(-200).map((e, i) => (
                  <TableRow key={i} title={describe(e)}>
                    <TableCell>{(e.t / 1000).toFixed(1)} s</TableCell>
                    <TableCell>{e.model ? describeModel(e.model).label : "–"}</TableCell>
                    <TableCell>{e.attempt}</TableCell>
                    <TableCell>{String(e.data?.errorKind ?? "")}</TableCell>
                    <TableCell>{formatMs(e.data?.ceilingMs as number)}</TableCell>
                    <TableCell>{formatMs(e.data?.jitteredMs as number)}</TableCell>
                    <TableCell>{e.data?.retryAfterMs === undefined ? "–" : `${formatMs(e.data.retryAfterMs as number)} + ${formatMs(e.data.spreadMs as number)}`}</TableCell>
                    <TableCell className="font-medium">{formatMs(e.ms)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function labelFor(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : minutes < 24 * 60 ? `${minutes / 60} h` : `${minutes / (24 * 60)} day`;
}
