"use client";

import { useEffect, useState } from "react";
import { Bookmark, ChevronDown, Layers, Settings, X } from "lucide-react";
import { LIMITS, type ModelInfo } from "@fomo/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { clamp, loadPresets, savePreset, type Preset, type SelectedModel } from "@/lib/model-settings";
import { cn } from "@/lib/utils";
import { ProviderAvatar } from "./provider-avatar";

const UNSUPPORTED = "This model doesn't accept this setting";

export function SelectedModels({
  selected,
  catalog,
  onChange,
  onOpenSettings,
  activeId,
}: {
  selected: SelectedModel[];
  catalog: Map<string, ModelInfo>;
  onChange: (next: SelectedModel[]) => void;
  onOpenSettings: (id: string) => void;
  activeId: string | null;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  useEffect(() => setPresets(loadPresets()), []);

  const update = (id: string, patch: Partial<SelectedModel["settings"]>) =>
    onChange(selected.map((m) => (m.id === id ? { ...m, settings: { ...m.settings, ...patch } } : m)));

  function saveCurrent() {
    const name = window.prompt("Name this preset", selected.map((m) => catalog.get(m.id)?.label ?? m.id).join(" vs "));
    if (name?.trim()) setPresets(savePreset({ name: name.trim(), models: selected }));
  }

  return (
    <Card className="gap-3 py-4">
      <div className="flex flex-wrap items-center gap-2 px-4">
        <Layers className="text-primary size-5" />
        <h2 className="font-semibold">
          Selected models ({selected.length}/{LIMITS.maxModelsPerCompare})
        </h2>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={saveCurrent} disabled={selected.length === 0}>
            <Bookmark /> Save as preset
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Load preset <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Saved in this browser</DropdownMenuLabel>
              {presets.length === 0 && <DropdownMenuItem disabled>No presets yet</DropdownMenuItem>}
              {presets.map((p) => (
                <DropdownMenuItem key={p.name} onSelect={() => onChange(p.models.slice(0, LIMITS.maxModelsPerCompare))}>
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {selected.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-center text-sm">Add models from the catalog to compare them.</p>
      ) : (
        <>
        <ul className="divide-y border-t sm:hidden">
          {selected.map((m) => {
            const info = catalog.get(m.id);
            const caps = info?.capabilities ?? { temperature: true, topP: true, reasoning: true, tools: false };
            const summary = [
              caps.temperature && `temp ${m.settings.temperature}`,
              caps.topP && `top P ${m.settings.topP}`,
              `${m.settings.maxTokens} max tokens`,
              caps.reasoning && `reasoning ${m.settings.reasoningEffort ?? "default"}`,
            ].filter(Boolean);
            return (
              <li key={m.id} className={cn("flex items-center gap-2 px-4 py-2", activeId === m.id && "bg-accent-soft/60")}>
                <ProviderAvatar provider={info?.provider ?? m.id} className="size-7 shrink-0 text-xs" />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenSettings(m.id)}>
                  <div className="truncate text-sm font-medium">{info?.label ?? m.id}</div>
                  <div className="text-muted-foreground truncate text-xs">{summary.join(" · ")}</div>
                </button>
                <Button variant="ghost" size="icon" aria-label={`Settings for ${info?.label ?? m.id}`} onClick={() => onOpenSettings(m.id)}>
                  <Settings />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Remove ${info?.label ?? m.id}`} onClick={() => onChange(selected.filter((x) => x.id !== m.id))}>
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="relative hidden overflow-x-auto px-2 sm:block">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="px-2 py-2 font-medium">Model</th>
                <th className="px-1 py-2 font-medium" title="0 = focused, 2 = creative">Temperature</th>
                <th className="px-1 py-2 font-medium" title="Nucleus sampling">Top P</th>
                <th className="px-1 py-2 font-medium" title="Includes hidden reasoning tokens on reasoning models">Max tokens</th>
                <th className="px-1 py-2 font-medium">Reasoning</th>
                <th className="px-1 py-2 font-medium">Tools</th>
                <th className="sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {selected.map((m) => {
                const info = catalog.get(m.id);
                const caps = info?.capabilities ?? { temperature: true, topP: true, reasoning: true, tools: false };
                return (
                  <tr key={m.id} className={cn("border-t", activeId === m.id && "bg-accent-soft/60")}>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <ProviderAvatar provider={info?.provider ?? m.id} className="size-7 text-xs" />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{info?.label ?? m.id}</div>
                          <div className="text-muted-foreground truncate text-xs">{info?.provider}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-1 py-2">
                      <NumberCell
                        label={`Temperature for ${info?.label ?? m.id}`}
                        value={m.settings.temperature}
                        disabled={!caps.temperature}
                        step={0.1}
                        onCommit={(v) => update(m.id, { temperature: clamp(v, 0, 2) })}
                      />
                    </td>
                    <td className="px-1 py-2">
                      <NumberCell
                        label={`Top P for ${info?.label ?? m.id}`}
                        value={m.settings.topP}
                        disabled={!caps.topP}
                        step={0.05}
                        onCommit={(v) => update(m.id, { topP: clamp(v, 0.01, 1) })}
                      />
                    </td>
                    <td className="px-1 py-2">
                      <NumberCell
                        label={`Max tokens for ${info?.label ?? m.id}`}
                        value={m.settings.maxTokens}
                        step={256}
                        wide
                        onCommit={(v) => update(m.id, { maxTokens: Math.round(clamp(v, 16, LIMITS.maxOutputTokens)) })}
                      />
                    </td>
                    <td className="px-1 py-2">
                      {caps.reasoning ? (
                        <button
                          type="button"
                          onClick={() => onOpenSettings(m.id)}
                          className="bg-accent-soft text-accent-soft-foreground rounded-md px-2 py-1 text-xs font-medium capitalize"
                        >
                          {m.settings.reasoningEffort ?? "Default"}
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-xs" title={UNSUPPORTED}>—</span>
                      )}
                    </td>
                    <td className="px-1 py-2">
                      <span className="text-muted-foreground text-xs" title="Tool calling isn't wired up in this PoC yet (roadmap)">—</span>
                    </td>
                    <td className="px-1 py-2">
                      <div className="flex justify-end">
                        <Button variant="ghost" size="icon" aria-label={`Settings for ${info?.label ?? m.id}`} onClick={() => onOpenSettings(m.id)}>
                          <Settings />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Remove ${info?.label ?? m.id}`} onClick={() => onChange(selected.filter((x) => x.id !== m.id))}>
                          <X />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </Card>
  );
}

/** Small number input that only commits on blur/Enter, so typing "0." doesn't get clamped mid-edit. */
function NumberCell({
  label,
  value,
  disabled,
  step,
  wide,
  onCommit,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  step: number;
  wide?: boolean;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  if (disabled) {
    return (
      <span className="text-muted-foreground text-xs" title={UNSUPPORTED}>
        —
      </span>
    );
  }
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && draft.trim() !== "") onCommit(n);
    else setDraft(String(value));
  };
  return (
    <Input
      aria-label={label}
      type="number"
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={cn("h-8 px-2 text-center text-xs", wide ? "w-20" : "w-16")}
    />
  );
}
