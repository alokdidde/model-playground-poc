"use client";

import { useEffect, useState } from "react";
import type { ModelInfo } from "@fomo/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { fetchJson } from "@/lib/api-client";

export function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [mockMode, setMockMode] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    fetchJson<{ items: ModelInfo[]; mockMode: boolean }>("/api/models")
      .then((r) => {
        setModels(r.items);
        setMockMode(r.mockMode);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  return { models, mockMode, error };
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
      {models.map((m) => {
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
