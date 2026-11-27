"use client";

import { useEffect, useState } from "react";
import type { ModelInfo } from "@fomo/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { fetchJson } from "@/lib/api-client";

type ModelsResponse = { items: ModelInfo[]; mockMode: boolean };
/** Fetched once per tab: the Compare page and the run page it opens share it instead of loading it twice. */
let modelsRequest: Promise<ModelsResponse> | undefined;
let modelsLoaded: ModelsResponse | undefined;
const NO_MODELS: ModelInfo[] = [];

export function useModels() {
  const [data, setData] = useState<ModelsResponse | undefined>(modelsLoaded);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (modelsLoaded) return;
    modelsRequest ??= fetchJson<ModelsResponse>("/api/models");
    modelsRequest
      .then((r) => {
        modelsLoaded = r;
        setData(r);
      })
      .catch((e: Error) => {
        modelsRequest = undefined; // let the next page try again
        setError(e.message);
      });
  }, []);
  return { models: data?.items ?? NO_MODELS, mockMode: data?.mockMode ?? false, error };
}

export function ModelPicker({
  models,
  selected,
  onChange,
  max,
}: {
  models: ModelInfo[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max: number;
}) {
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...selected, id].slice(0, max) : selected.filter((m) => m !== id));

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {models.filter((m) => m.kind === "chat" && m.available).map((m) => {
        const checked = selected.includes(m.id);
        return (
          <label key={m.id} className="hover:bg-muted/50 flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm">
            <Checkbox
              checked={checked}
              disabled={!checked && selected.length >= max}
              onCheckedChange={(v) => toggle(m.id, v === true)}
              className="mt-0.5"
            />
            <span className="flex-1">
              <span className="font-medium">{m.label}</span>
              <span className="text-muted-foreground block text-xs">{m.provider}</span>
            </span>
            {m.pricing && (
              <Badge variant="outline" title="USD per 1M input / output tokens">
                ${m.pricing.inputPerM} / ${m.pricing.outputPerM}
              </Badge>
            )}
          </label>
        );
      })}
    </div>
  );
}
