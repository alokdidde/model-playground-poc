"use client";

import { ArrowUpDown, ChevronDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SORT_OPTIONS, type SortKey } from "@/lib/run-sort";

const labelOf = (k: SortKey) => SORT_OPTIONS.find((o) => o.key === k)?.label ?? k;

/**
 * "Sort by X, then by Y, then by Z", as many keys as there are options.
 * Each key sorts best first, so there is no direction to pick. No keys means the order picked.
 */
export function AnswerSort({
  keys,
  onChange,
  combinedAvailable,
}: {
  keys: SortKey[];
  onChange: (keys: SortKey[]) => void;
  /** The combined score needs the judge's scores. */
  combinedAvailable: boolean;
}) {
  const options = SORT_OPTIONS.filter((o) => o.key !== "order" && (combinedAvailable || o.key !== "combined"));
  // A menu offers every key not already used by another menu.
  const free = (except?: SortKey) => options.filter((o) => o.key === except || !keys.includes(o.key));
  const unused = free();

  if (keys.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Menu label="Sort by" value="order" options={SORT_OPTIONS.filter((o) => o.key === "order" || options.includes(o))} onSelect={(k) => onChange(k === "order" ? [] : [k])} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {keys.map((key, i) => (
        <div key={key} className="flex items-center">
          <Menu
            label={i === 0 ? "Sort by" : "then by"}
            value={key}
            options={free(key)}
            onSelect={(k) => onChange(keys.map((old, j) => (j === i ? k : old)))}
          />
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Remove ${labelOf(key)}`} onClick={() => onChange(keys.filter((_, j) => j !== i))}>
            <X />
          </Button>
        </div>
      ))}
      {unused.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <Plus /> then by
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Best first</DropdownMenuLabel>
            <DropdownMenuRadioGroup value="" onValueChange={(v) => onChange([...keys, v as SortKey])}>
              {unused.map((o) => (
                <DropdownMenuRadioItem key={o.key} value={o.key}>
                  {o.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function Menu({ label, value, options, onSelect }: { label: string; value: SortKey; options: typeof SORT_OPTIONS; onSelect: (k: SortKey) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowUpDown /> {label}: {labelOf(value)} <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Best first</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onSelect(v as SortKey)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.key} value={o.key}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
