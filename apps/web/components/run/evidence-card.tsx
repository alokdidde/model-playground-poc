import { ListChecks } from "lucide-react";
import type { JudgeVerdict } from "@fomo/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { criterionReading, TIE_POINTS } from "@/lib/run-insights";

const CRITERIA = [
  { key: "accuracy", title: "Accuracy", hint: "Correct, and follows the prompt" },
  { key: "helpfulness", title: "Helpfulness", hint: "Answers what was asked" },
  { key: "clarity", title: "Clarity", hint: "Easy to read and use" },
  { key: "overall", title: "Overall", hint: "The judge's holistic score, not the average of the rows" },
] as const;

const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** One row per judge criterion, each with its own reading, plus answer length (judges tend to favour longer answers). */
export function EvidenceCard({
  verdict,
  outputs,
  label,
  colorOf,
}: {
  verdict: JudgeVerdict;
  outputs: Record<string, string>;
  label: (id: string) => string;
  colorOf: (id: string) => string;
}) {
  const lengths = verdict.scores.map((s) => ({ model: s.model, value: words(outputs[s.model] ?? "") }));
  const maxLen = Math.max(1, ...lengths.map((l) => l.value));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="text-primary size-4" /> How each answer scored
        </CardTitle>
        <CardDescription>
          Judge scores out of 10, averaged over both orders. A gap of {TIE_POINTS} or less reads as a tie.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {CRITERIA.map((c) => {
          const values = verdict.scores.map((s) => ({ model: s.model, value: s[c.key] }));
          const reading = criterionReading(values);
          return (
            <Row
              key={c.key}
              title={c.title}
              hint={c.hint}
              reading={reading.leader ? `${label(reading.leader)} leads by ${reading.gap}` : "Tie at the top"}
              bars={[...values].sort((a, b) => b.value - a.value).map((v) => ({ ...v, share: v.value / 10, text: String(v.value) }))}
              label={label}
              colorOf={colorOf}
            />
          );
        })}
        <Row
          title="Length"
          hint="Words in the answer. Check that a high score isn't just a longer answer."
          reading={`Longest: ${label([...lengths].sort((a, b) => b.value - a.value)[0]!.model)}`}
          bars={[...lengths].sort((a, b) => b.value - a.value).map((v) => ({ ...v, share: v.value / maxLen, text: `${v.value} words` }))}
          label={label}
          colorOf={colorOf}
        />
      </CardContent>
    </Card>
  );
}

function Row({
  title,
  hint,
  reading,
  bars,
  label,
  colorOf,
}: {
  title: string;
  hint: string;
  reading: string;
  bars: { model: string; share: number; text: string }[];
  label: (id: string) => string;
  colorOf: (id: string) => string;
}) {
  return (
    <div className="grid gap-x-6 gap-y-2 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_11rem]">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-muted-foreground text-xs">{hint}</div>
      </div>
      <ul className="min-w-0 space-y-1.5">
        {bars.map((b) => (
          <li key={b.model} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: colorOf(b.model) }} />
              <span className="truncate">{label(b.model)}</span>
            </span>
            <span className="bg-muted h-2 overflow-hidden rounded-full">
              <span className="block h-full rounded-full" style={{ width: `${Math.max(2, b.share * 100)}%`, background: colorOf(b.model) }} />
            </span>
            <span className="text-right tabular-nums">{b.text}</span>
          </li>
        ))}
      </ul>
      <div className="text-muted-foreground text-sm sm:text-right">{reading}</div>
    </div>
  );
}
