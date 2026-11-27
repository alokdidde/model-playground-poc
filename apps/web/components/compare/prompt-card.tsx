"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, FolderOpen, Play, Square, Target } from "lucide-react";
import { LIMITS, TASK_TYPES, type PriorityWeights, type TaskType } from "@fomo/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PriorityPicker } from "./priority-picker";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** Starter prompts that show off different strengths (reasoning, writing, code, facts). */
const PROMPT_LIBRARY: { title: string; prompt: string; task: TaskType }[] = [
  { title: "Process vs thread", task: "general", prompt: "Explain the difference between a process and a thread, with one example each." },
  { title: "Queue or HTTP call?", task: "general", prompt: "In three sentences, explain when to use a queue instead of a direct HTTP call between two services." },
  { title: "Logic puzzle", task: "reasoning", prompt: "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? Show your reasoning briefly." },
  { title: "SQL", task: "coding", prompt: "Write a Postgres query that returns each customer's most recent order, given customers(id, name) and orders(id, customer_id, created_at, total)." },
  { title: "Product copy", task: "writing", prompt: "Write a two-sentence product description for a reusable water bottle aimed at trail runners." },
  { title: "Summarise", task: "summarization", prompt: "Summarise the CAP theorem for a junior engineer in under 80 words." },
  {
    title: "Extract JSON",
    task: "extraction",
    prompt:
      'Extract {"name", "company", "email", "meeting_date"} as JSON from: "Hi, this is Priya Nair from Acme Robotics (priya@acme.io). Can we meet on 4 Dec?" Reply with JSON only.',
  },
];

export function PromptCard({
  prompt,
  onPromptChange,
  systemPrompt,
  onSystemPromptChange,
  judge,
  onJudgeChange,
  synthesize,
  onSynthesizeChange,
  taskType,
  onTaskTypeChange,
  priority,
  onPriorityChange,
  customPriority,
  onCustomPriorityChange,
  running,
  canRun,
  modelCount,
  onRun,
  onStop,
}: {
  prompt: string;
  onPromptChange: (v: string) => void;
  systemPrompt: string;
  onSystemPromptChange: (v: string) => void;
  judge: boolean;
  onJudgeChange: (v: boolean) => void;
  synthesize: boolean;
  onSynthesizeChange: (v: boolean) => void;
  taskType: TaskType;
  onTaskTypeChange: (t: TaskType) => void;
  priority: PriorityWeights;
  onPriorityChange: (w: PriorityWeights) => void;
  customPriority: boolean;
  onCustomPriorityChange: (v: boolean) => void;
  running: boolean;
  canRun: boolean;
  modelCount: number;
  onRun: () => void;
  onStop: () => void;
}) {
  const [showSystem, setShowSystem] = useState(Boolean(systemPrompt));

  return (
    <Card className="gap-3 py-4">
      <div className="flex items-center gap-2 px-4">
        <FileText className="text-primary size-5" />
        <h2 className="font-semibold">Prompt</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto">
              <FolderOpen /> Prompt library
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Example prompts</DropdownMenuLabel>
            {PROMPT_LIBRARY.map((p) => (
              <DropdownMenuItem
                key={p.title}
                onSelect={() => {
                  onPromptChange(p.prompt);
                  onTaskTypeChange(p.task);
                }}
                className="flex-col items-start gap-0.5"
              >
                <span className="font-medium">{p.title}</span>
                <span className="text-muted-foreground line-clamp-1 text-xs">{p.prompt}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="space-y-3 px-4">
        <Textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={4}
          maxLength={LIMITS.maxPromptChars}
          placeholder="Ask anything…"
          aria-label="Prompt"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canRun && !running) onRun();
          }}
        />
        <div className="bg-muted/50 flex flex-wrap items-start gap-x-6 gap-y-3 rounded-lg p-3">
          <div className="space-y-1.5">
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <Target className="size-3.5" /> Task type
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="bg-background" title="Tunes the judge to what good looks like for this kind of task">
                  {TASK_TYPES[taskType].label} <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={taskType} onValueChange={(v) => onTaskTypeChange(v as TaskType)}>
                  {(Object.keys(TASK_TYPES) as TaskType[]).map((t) => (
                    <DropdownMenuRadioItem key={t} value={t}>
                      {TASK_TYPES[t].label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="space-y-1.5">
            <div className="text-muted-foreground text-xs font-medium">What matters most</div>
            <PriorityPicker value={priority} onChange={onPriorityChange} custom={customPriority} onCustomChange={onCustomPriorityChange} size="sm" />
          </div>
        </div>
        {showSystem && (
          <Textarea
            value={systemPrompt}
            onChange={(e) => onSystemPromptChange(e.target.value)}
            rows={2}
            maxLength={LIMITS.maxSystemPromptChars}
            placeholder="System prompt applied to every model (a model's own override wins)"
            aria-label="System prompt"
          />
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={() => setShowSystem((v) => !v)} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm">
            {showSystem ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            {showSystem ? "System prompt" : "Add system prompt (optional)"}
          </button>
          <label className="flex items-center gap-2 text-sm" title="A neutral model scores the anonymised answers">
            <Switch checked={judge} onCheckedChange={onJudgeChange} /> Judge
          </label>
          <label className="flex items-center gap-2 text-sm" title="A neutral model merges the answers into one, citing each model">
            <Switch checked={synthesize} onCheckedChange={onSynthesizeChange} /> Synthesize
          </label>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                onPromptChange("");
                onSystemPromptChange("");
              }}
              disabled={running || (!prompt && !systemPrompt)}
            >
              Clear
            </Button>
            {running ? (
              <Button variant="outline" onClick={onStop}>
                <Square /> Stop
              </Button>
            ) : (
              <Button onClick={onRun} disabled={!canRun}>
                <Play /> Compare{modelCount > 0 ? ` ${modelCount}` : ""}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
