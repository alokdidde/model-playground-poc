import Link from "next/link";
import { ArrowRight, Columns3, Crown, History } from "lucide-react";
import { describeModel } from "@fomo/llm";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { listComparisons } from "@/lib/server/compare-service";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

const label = (id: string) => describeModel(id).label;

/** One way in (start a compare), plus the latest runs. */
export default async function HomePage() {
  // The home page must still render if the database is briefly unavailable.
  const recent = await listComparisons(5).catch(() => null);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Which model should you use?</h1>
        <p className="text-muted-foreground mt-1">Try the models side by side and see which one is worth it for your work.</p>
      </div>

      <Link href="/compare" className="group block">
        <Card className="hover:border-primary/60 flex-row items-center gap-4 p-5 transition-colors">
          <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
            <Columns3 className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Start a compare</h2>
            <p className="text-muted-foreground text-sm">Pick the models, write a prompt, and see the answers side by side with a judge&apos;s score, speed and cost.</p>
          </div>
          <ArrowRight className="text-primary size-5 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </Card>
      </Link>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <History className="text-primary size-5" />
          <h2 className="font-semibold">Recent runs</h2>
          {recent && recent.items.length > 0 && (
            <Link href="/compare?history=1" className="text-primary ml-auto text-sm hover:underline">
              See all past runs
            </Link>
          )}
        </div>
        {recent === null ? (
          <p className="text-muted-foreground text-sm">Past runs are unavailable right now.</p>
        ) : recent.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">No runs yet. Your compares will be listed here.</p>
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {recent.items.map((run) => (
                <li key={run.id}>
                  <Link href={`/runs/${run.id}`} className="hover:bg-muted/60 block space-y-1 px-4 py-3">
                    <div className="line-clamp-1 text-sm font-medium">{run.prompt}</div>
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span>{timeAgo(run.createdAt)}</span>
                      <span>·</span>
                      <span>{run.models.map(label).join(", ")}</span>
                      {run.winnerModel && (
                        <Badge variant="secondary">
                          <Crown /> {label(run.winnerModel)}
                        </Badge>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
