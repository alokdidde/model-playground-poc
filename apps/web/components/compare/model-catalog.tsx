"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, Check, ChevronDown, Layers, Plus, Search } from "lucide-react";
import type { ModelInfo } from "@fomo/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ProviderAvatar } from "./provider-avatar";

type PriceFilter = "any" | "under-0.5" | "under-2" | "known";
type SpeedFilter = "any" | "fast";
type SortKey = "best" | "name" | "price" | "context";

const PRICE_LABELS: Record<PriceFilter, string> = {
  any: "Any price",
  "under-0.5": "Under $0.50 / 1M out",
  "under-2": "Under $2 / 1M out",
  known: "Price known",
};
const SORT_LABELS: Record<SortKey, string> = {
  best: "Best match",
  name: "Name",
  price: "Price (low to high)",
  context: "Context window",
};

/** Models first by usefulness here: callable chat models, curated ones (with tags), then the rest. */
function rank(m: ModelInfo, query: string): number {
  let score = 0;
  if (m.kind === "chat" && m.available) score += 100;
  if (m.tags.length > 0) score += 10;
  if (query && m.label.toLowerCase().startsWith(query)) score += 50;
  return score;
}

export function ModelCatalog({
  models,
  selectedIds,
  canAddMore,
  onAdd,
  onAddMany,
}: {
  models: ModelInfo[];
  selectedIds: string[];
  canAddMore: boolean;
  onAdd: (id: string) => void;
  /** Adds every model in the list that can be compared (the caller enforces the cap). */
  onAddMany: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [price, setPrice] = useState<PriceFilter>("any");
  const [speed, setSpeed] = useState<SpeedFilter>("any");
  const [sort, setSort] = useState<SortKey>("best");
  const [showAll, setShowAll] = useState(false);

  const allProviders = useMemo(() => [...new Set(models.map((m) => m.provider))].sort(), [models]);
  const allTags = useMemo(() => [...new Set(models.flatMap((m) => m.tags))].sort(), [models]);
  const hiddenCount = models.filter((m) => m.kind !== "chat" || !m.available).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = models.filter((m) => {
      if (!showAll && (m.kind !== "chat" || !m.available)) return false;
      if (q && !`${m.label} ${m.id} ${m.provider}`.toLowerCase().includes(q)) return false;
      if (providers.length && !providers.includes(m.provider)) return false;
      if (tags.length && !tags.some((t) => m.tags.includes(t))) return false;
      if (speed === "fast" && !m.tags.includes("Fast")) return false;
      const out = m.pricing?.outputPerM;
      if (price === "known" && out === undefined) return false;
      if (price === "under-0.5" && !(out !== undefined && out < 0.5)) return false;
      if (price === "under-2" && !(out !== undefined && out < 2)) return false;
      return true;
    });
    const byName = (a: ModelInfo, b: ModelInfo) => a.label.localeCompare(b.label);
    const sorters: Record<SortKey, (a: ModelInfo, b: ModelInfo) => number> = {
      best: (a, b) => rank(b, q) - rank(a, q) || byName(a, b),
      name: byName,
      price: (a, b) => (a.pricing?.outputPerM ?? Infinity) - (b.pricing?.outputPerM ?? Infinity) || byName(a, b),
      context: (a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0) || byName(a, b),
    };
    return out.sort(sorters[sort]);
  }, [models, query, providers, tags, price, speed, sort, showAll]);

  // What "Add all" would add: the models shown right now (after search and filters) that can be compared.
  const addable = visible.filter((m) => m.kind === "chat" && m.available && !selectedIds.includes(m.id)).map((m) => m.id);

  const toggle = (list: string[], value: string, set: (v: string[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <Card className="gap-3 py-4">
      <div className="flex items-center gap-2 px-4">
        <Layers className="text-primary size-5" />
        <h2 className="font-semibold">Model catalog</h2>
        <span className="text-muted-foreground ml-auto text-sm">{models.length} models</span>
      </div>

      <div className="space-y-2 px-4">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-2.5 left-3 size-4" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models…" className="pl-9" aria-label="Search models" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterMenu label="Provider" active={providers.length > 0}>
            <DropdownMenuLabel>Provider</DropdownMenuLabel>
            {allProviders.map((p) => (
              <DropdownMenuCheckboxItem key={p} checked={providers.includes(p)} onCheckedChange={() => toggle(providers, p, setProviders)} onSelect={(e) => e.preventDefault()}>
                {p}
              </DropdownMenuCheckboxItem>
            ))}
          </FilterMenu>
          <FilterMenu label="Capability" active={tags.length > 0}>
            <DropdownMenuLabel>Capability</DropdownMenuLabel>
            {allTags.map((t) => (
              <DropdownMenuCheckboxItem key={t} checked={tags.includes(t)} onCheckedChange={() => toggle(tags, t, setTags)} onSelect={(e) => e.preventDefault()}>
                {t}
              </DropdownMenuCheckboxItem>
            ))}
          </FilterMenu>
          <FilterMenu label="Price" active={price !== "any"}>
            <DropdownMenuRadioGroup value={price} onValueChange={(v) => setPrice(v as PriceFilter)}>
              {(Object.keys(PRICE_LABELS) as PriceFilter[]).map((k) => (
                <DropdownMenuRadioItem key={k} value={k}>
                  {PRICE_LABELS[k]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </FilterMenu>
          <FilterMenu label="Speed" active={speed !== "any"}>
            <DropdownMenuRadioGroup value={speed} onValueChange={(v) => setSpeed(v as SpeedFilter)}>
              <DropdownMenuRadioItem value="any">Any speed</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="fast">Fast only</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </FilterMenu>
        </div>
        <div className="flex items-center justify-between gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ArrowUpDown /> Sort: {SORT_LABELS[sort]} <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <DropdownMenuRadioItem key={k} value={k}>
                    {SORT_LABELS[k]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {addable.length > 1 && (
            <Button variant="outline" size="sm" disabled={!canAddMore} title={canAddMore ? undefined : "Model limit reached"} onClick={() => onAddMany(addable)}>
              <Plus /> Add all {addable.length}
            </Button>
          )}
          {hiddenCount > 0 && (
            <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs" title="Models your plan can't call, and embedding / image / audio models">
              <Checkbox checked={showAll} onCheckedChange={(v) => setShowAll(v === true)} /> Show {hiddenCount} more
            </label>
          )}
        </div>
      </div>

      <ul className="max-h-[34rem] divide-y overflow-y-auto border-t lg:max-h-[calc(100vh-22rem)]">
        {visible.map((m) => {
          const added = selectedIds.includes(m.id);
          const reason = m.kind !== "chat" ? "Not a chat model" : !m.available ? "Not available on your DO plan" : !canAddMore ? "Model limit reached" : undefined;
          return (
            <li key={m.id} className={cn("flex items-center gap-3 px-4 py-2.5", added && "bg-accent-soft/60")}>
              <ProviderAvatar provider={m.provider} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" title={m.id}>
                  {m.label}
                </div>
                <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <span className="truncate">{m.provider}</span>
                  {m.pricing && <span title="USD per 1M input / output tokens">· ${m.pricing.inputPerM}/${m.pricing.outputPerM}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {!m.available && m.kind === "chat" && <Badge variant="outline" className="text-muted-foreground">Not on plan</Badge>}
                  {m.tags.slice(0, 2).map((t) => (
                    <Badge key={t} variant="outline" className="bg-accent-soft text-accent-soft-foreground border-transparent">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
              {added ? (
                <span className="text-primary flex items-center gap-1 text-xs font-medium">
                  <Check className="size-4" /> Added
                </span>
              ) : (
                <Button size="sm" variant="outline" disabled={Boolean(reason)} title={reason} onClick={() => onAdd(m.id)} className="text-primary">
                  Add
                </Button>
              )}
            </li>
          );
        })}
        {visible.length === 0 && <li className="text-muted-foreground px-4 py-8 text-center text-sm">No models match these filters.</li>}
      </ul>
    </Card>
  );
}

function FilterMenu({ label, active, children }: { label: string; active: boolean; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn(active && "border-primary text-primary")}>
          {label} <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
