/**
 * Turns a batch eval's per-prompt cells into one row per model: quality
 * (judge overall and per criterion, automatic checks, wins), speed (TTFT,
 * total latency percentiles, generation speed), cost and reliability.
 * Pure, so the report page, the export and the tests share it.
 */
export interface ResultRow {
  promptIndex: number;
  model: string;
  status: "SUCCEEDED" | "FAILED";
  score: number | null;
  criteria?: { accuracy: number; helpfulness: number; clarity: number } | null;
  checks?: { name: string; passed: boolean; detail: string }[] | null;
  isWinner?: boolean;
  latencyMs: number;
  ttftMs?: number | null;
  outputTokensPerSec?: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface ModelSummary {
  model: string;
  prompts: number;
  failed: number;
  errorRate: number;
  judged: number;
  meanScore: number | null;
  accuracy: number | null;
  helpfulness: number | null;
  clarity: number | null;
  wins: number;
  checksPassed: number;
  checksRun: number;
  latencyP50: number | null;
  latencyP95: number | null;
  ttftP50: number | null;
  meanTokensPerSec: number | null;
  /** Null if any successful call had an unknown price: a partial sum would flatter the model. */
  totalCostUsd: number | null;
  costPerPromptUsd: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

/** Nearest-rank percentile: simple to explain, and honest for small samples. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export function summariseRun(rows: ResultRow[], models: string[]): ModelSummary[] {
  return models.map((model) => {
    const all = rows.filter((r) => r.model === model);
    const ok = all.filter((r) => r.status === "SUCCEEDED");
    const scored = ok.filter((r) => r.score !== null);
    const criteria = ok.flatMap((r) => (r.criteria ? [r.criteria] : []));
    const checks = ok.flatMap((r) => r.checks ?? []);
    const costs = ok.map((r) => r.costUsd);
    const totalCostUsd = ok.length && costs.every((c) => c !== null) ? (costs as number[]).reduce((a, b) => a + b, 0) : null;
    const pick = <T>(f: (r: ResultRow) => T | null | undefined) => ok.map(f).filter((v): v is T => v !== null && v !== undefined);

    return {
      model,
      prompts: all.length,
      failed: all.length - ok.length,
      errorRate: all.length ? (all.length - ok.length) / all.length : 0,
      judged: scored.length,
      meanScore: round1(mean(scored.map((r) => r.score!))),
      accuracy: round1(mean(criteria.map((c) => c.accuracy))),
      helpfulness: round1(mean(criteria.map((c) => c.helpfulness))),
      clarity: round1(mean(criteria.map((c) => c.clarity))),
      wins: ok.filter((r) => r.isWinner).length,
      checksPassed: checks.filter((c) => c.passed).length,
      checksRun: checks.length,
      latencyP50: percentile(pick((r) => r.latencyMs), 50),
      latencyP95: percentile(pick((r) => r.latencyMs), 95),
      ttftP50: percentile(pick((r) => r.ttftMs), 50),
      meanTokensPerSec: round1(mean(pick((r) => r.outputTokensPerSec))),
      totalCostUsd,
      costPerPromptUsd: totalCostUsd === null ? null : totalCostUsd / ok.length,
    };
  });
}

const CSV_COLUMNS = [
  "promptIndex",
  "prompt",
  "model",
  "status",
  "score",
  "accuracy",
  "helpfulness",
  "clarity",
  "isWinner",
  "checks",
  "latencyMs",
  "ttftMs",
  "outputTokensPerSec",
  "inputTokens",
  "outputTokens",
  "costUsd",
  "output",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per (prompt, model) cell, for spreadsheets. */
export function toCsv(rows: ResultRow[], prompts: { index: number; prompt: string }[], outputs: Map<string, string>): string {
  const promptText = new Map(prompts.map((p) => [p.index, p.prompt]));
  const lines = rows.map((r) =>
    [
      r.promptIndex,
      promptText.get(r.promptIndex),
      r.model,
      r.status,
      r.score,
      r.criteria?.accuracy,
      r.criteria?.helpfulness,
      r.criteria?.clarity,
      r.isWinner,
      r.checks?.map((c) => `${c.name}:${c.passed ? "pass" : "fail"}`).join(" "),
      r.latencyMs,
      r.ttftMs,
      r.outputTokensPerSec,
      r.inputTokens,
      r.outputTokens,
      r.costUsd,
      outputs.get(`${r.promptIndex}:${r.model}`),
    ]
      .map(csvCell)
      .join(","),
  );
  return [CSV_COLUMNS.join(","), ...lines].join("\n");
}
