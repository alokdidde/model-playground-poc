"use client";

import { Combine, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { CompareState } from "@/lib/compare-state";
import { formatMs, formatUsd } from "@/lib/utils";
import { Markdown } from "@/components/markdown";

/** The merged answer, rendered as Markdown with each [Model] citation shown as a chip. */
export function SynthesisCard({ synthesis, label }: { synthesis: CompareState["synthesis"]; label: (id: string) => string }) {
  if (synthesis.status === "off") return null;

  return (
    <Card className="gap-3 py-4">
      <div className="flex flex-wrap items-center gap-2 px-4">
        <Combine className="text-primary size-5" />
        <h2 className="font-semibold">Combined answer</h2>
        {synthesis.model && <Badge variant="outline">written by {label(synthesis.model)}</Badge>}
        {synthesis.metrics && (
          <span className="text-muted-foreground ml-auto text-xs">
            {formatMs(synthesis.metrics.latencyMs)} · {formatUsd(synthesis.metrics.costUsd)}
          </span>
        )}
      </div>
      <div className="px-4">
        {synthesis.status === "pending" && (
          <span className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Waiting for the answers…
          </span>
        )}
        {synthesis.status === "running" && !synthesis.output && (
          <span className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Merging…
          </span>
        )}
        {synthesis.status === "failed" && (
          <span className="text-destructive text-sm">
            {synthesis.problem?.title}: {synthesis.problem?.detail}
          </span>
        )}
        {synthesis.output && <Markdown text={synthesis.output} citations />}
      </div>
      <p className="text-muted-foreground px-4 text-xs">
        A neutral model merged the answers above and cited where each part came from. It can still make mistakes, so check the cited answers.
      </p>
    </Card>
  );
}
