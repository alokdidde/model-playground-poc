"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Crown, History, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { fetchJson } from "@/lib/api-client";
import { cn, timeAgo } from "@/lib/utils";

interface Summary {
  id: string;
  prompt: string;
  models: string[];
  status: string;
  createdAt: string;
  winnerModel: string | null;
  preferredModel: string | null;
}

/** Past compares, newest first. Each opens its run page with the full results. */
export function RunHistory({
  open,
  onOpenChange,
  currentId,
  label,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentId?: string;
  label: (id: string) => string;
}) {
  const [items, setItems] = useState<Summary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function load(before?: string) {
    setLoading(true);
    setError(undefined);
    try {
      const page = await fetchJson<{ items: Summary[]; nextCursor: string | null }>(`/api/compare?limit=20${before ? `&before=${encodeURIComponent(before)}` : ""}`);
      setItems((prev) => (before ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Refresh every time it opens, so a run that just finished is listed.
  useEffect(() => {
    if (open) void load();
  }, [open]);

  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-md">
        <DrawerHeader className="border-b">
          <div className="flex items-center gap-2">
            <History className="text-primary size-5" />
            <DrawerTitle>Past runs</DrawerTitle>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="ml-auto" aria-label="Close">
                <X />
              </Button>
            </DrawerClose>
          </div>
          <DrawerDescription>Every compare is saved. Open one to see its answers, scores and metrics again.</DrawerDescription>
        </DrawerHeader>
        <div className="flex-1 overflow-y-auto">
          {error && <p className="text-destructive p-4 text-sm">{error}</p>}
          {!loading && items.length === 0 && !error && <p className="text-muted-foreground p-4 text-sm">No runs yet.</p>}
          <ul className="divide-y">
            {items.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/runs/${run.id}`}
                  onClick={() => onOpenChange(false)}
                  className={cn("hover:bg-muted/60 block space-y-1.5 px-4 py-3", run.id === currentId && "bg-accent-soft/60")}
                >
                  <div className="line-clamp-2 text-sm font-medium">{run.prompt}</div>
                  <div className="text-muted-foreground text-xs">
                    {timeAgo(run.createdAt)} · {run.models.map(label).join(", ")}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {run.winnerModel && (
                      <Badge variant="secondary">
                        <Crown /> Judge: {label(run.winnerModel)}
                      </Badge>
                    )}
                    {run.preferredModel && <Badge variant="outline">Your pick: {label(run.preferredModel)}</Badge>}
                    {run.status !== "COMPLETED" && <Badge variant="outline">{run.status.toLowerCase()}</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {loading && (
            <p className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          )}
          {cursor && !loading && (
            <div className="p-4">
              <Button variant="outline" className="w-full" onClick={() => load(cursor)}>
                Show older runs
              </Button>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
