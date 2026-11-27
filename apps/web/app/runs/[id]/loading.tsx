import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";

/** Shown at once while a run page loads, so opening a run never looks like nothing is happening. */
export default function RunLoading() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-6" aria-busy="true">
      <Card className="gap-3 p-4 sm:p-5">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Opening the run…
        </div>
        <div className="bg-muted h-5 w-3/4 animate-pulse rounded" />
        <div className="bg-muted h-5 w-1/2 animate-pulse rounded" />
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="h-48 animate-pulse p-4">
            <div className="bg-muted h-4 w-1/3 rounded" />
          </Card>
        ))}
      </div>
    </div>
  );
}
