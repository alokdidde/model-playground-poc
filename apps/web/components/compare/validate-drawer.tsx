"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2, X } from "lucide-react";
import { LIMITS, type CreateEvalRunInput, type ModelSettings, type PriorityWeights, type TaskType } from "@fomo/shared";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, ProblemError } from "@/lib/api-client";
import { parsePromptLines } from "@/lib/prompt-lines";
import { formatUsd } from "@/lib/utils";

/**
 * "Validate on my prompts": one compare is a sample of one. This turns it into
 * a batch eval with the same models, settings, task type and priority over
 * the user's own prompts, run by the durable worker.
 */
export function ValidateDrawer({
  open,
  onOpenChange,
  comparisonId,
  firstPrompt,
  models,
  modelSettings,
  taskType,
  priority,
  costPerPrompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comparisonId?: string;
  firstPrompt: string;
  models: string[];
  modelSettings: Record<string, ModelSettings>;
  taskType: TaskType;
  priority: PriorityWeights;
  /** What this compare cost across all models, to estimate the run. */
  costPerPrompt: number | null;
}) {
  const router = useRouter();
  const [text, setText] = useState(firstPrompt.replace(/\n+/g, " "));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const prompts = parsePromptLines(text);
  const tooMany = prompts.length > LIMITS.maxEvalPrompts;

  async function start() {
    setSubmitting(true);
    setError(undefined);
    const body: CreateEvalRunInput = {
      name: `Validate: ${firstPrompt.slice(0, 60)}${firstPrompt.length > 60 ? "…" : ""}`,
      models,
      prompts,
      taskType,
      priority,
      modelSettings,
      sourceComparisonId: comparisonId,
    };
    try {
      const run = await fetchJson<{ id: string }>("/api/evals", { method: "POST", body: JSON.stringify(body), idempotencyKey: crypto.randomUUID() });
      router.push(`/evals/${run.id}`);
    } catch (e) {
      setError(e instanceof ProblemError ? `${e.problem.title}: ${e.problem.detail ?? ""}` : String(e));
      setSubmitting(false);
    }
  }

  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-lg">
        <DrawerHeader className="border-b">
          <div className="flex items-center gap-2">
            <FlaskConical className="text-primary size-5" />
            <DrawerTitle>Validate on my prompts</DrawerTitle>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="ml-auto" aria-label="Close">
                <X />
              </Button>
            </DrawerClose>
          </div>
          <DrawerDescription>
            One prompt is a sample of one. Run the same {models.length} models, with the same settings, on a set of your own prompts. The worker runs it in the
            background and the recommendation is recomputed from all of them.
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <label className="text-sm font-medium" htmlFor="validate-prompts">
            Prompts, one per line
          </label>
          <Textarea
            id="validate-prompts"
            rows={14}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Summarise this ticket: …\nWhat is 17 × 23? => 391"}
            className="font-mono text-xs"
          />
          <p className="text-muted-foreground text-xs">
            Optional reference answers: <code>prompt =&gt; expected answer</code>. Use 10 to 50 prompts that look like your real traffic.
          </p>
          <div className="bg-muted/60 rounded-md p-3 text-sm">
            {prompts.length} prompts × {models.length} models = <span className="font-medium">{prompts.length * models.length} calls</span>
            {costPerPrompt !== null && prompts.length > 0 && <> · about {formatUsd(costPerPrompt * prompts.length)} plus judging</>}
            {tooMany && <p className="text-destructive mt-1">At most {LIMITS.maxEvalPrompts} prompts per run.</p>}
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <DrawerFooter className="justify-end border-t">
          <DrawerClose asChild>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
          <Button onClick={start} disabled={submitting || prompts.length === 0 || tooMany}>
            {submitting ? <Loader2 className="animate-spin" /> : <FlaskConical />} Start batch eval
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
