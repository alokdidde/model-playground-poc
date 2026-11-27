"use client";

import { ArrowUpDown, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SORT_OPTIONS, type SortKey } from "@/lib/run-sort";

const labelOf = (k: SortKey) => SORT_OPTIONS.find((o) => o.key === k)?.label ?? k;

/** "Sort by X, then by Y". Each key sorts best first, so there is no direction to pick. */
export function AnswerSort({
  primary,
  secondary,
  onChange,
  combinedAvailable,
}: {
  primary: SortKey;
  secondary: SortKey;
  onChange: (primary: SortKey, secondary: SortKey) => void;
  /** The combined score needs the judge's scores. */
  combinedAvailable: boolean;
}) {
  const options = SORT_OPTIONS.filter((o) => combinedAvailable || o.key !== "combined");
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Menu label="Sort by" value={primary} options={options} onSelect={(k) => onChange(k, k === secondary ? "order" : secondary)} />
      {primary !== "order" && (
        <Menu label="then by" value={secondary} options={options.filter((o) => o.key !== primary)} onSelect={(k) => onChange(primary, k)} />
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
