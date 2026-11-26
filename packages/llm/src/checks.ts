import type { TaskType } from "@fomo/shared";

/**
 * Cheap, deterministic checks that run next to the LLM judge. The judge is an
 * opinion; these are facts, so they catch what a judge can miss (a confident
 * wrong number, JSON that doesn't parse) and give a second signal to trust.
 */
export interface CheckResult {
  name: "matches_reference" | "valid_json";
  passed: boolean;
  detail: string;
}

export function runChecks(input: { prompt: string; expected?: string | null; taskType: TaskType; output: string }): CheckResult[] {
  const checks: CheckResult[] = [];
  if (input.expected?.trim()) checks.push(matchesReference(input.output, input.expected));
  if (wantsJson(input.prompt, input.taskType)) checks.push(validJson(input.output));
  return checks;
}

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Short references ("391", "Paris") must appear in the answer. Long ones
 * can't be matched literally, so we only require half of their longer words; the
 * judge, which also sees the reference, handles the nuance.
 */
function matchesReference(output: string, expected: string): CheckResult {
  const out = normalise(output);
  const ref = normalise(expected);
  if (ref.length <= 40) {
    const passed = out.includes(ref);
    return { name: "matches_reference", passed, detail: passed ? `contains "${expected}"` : `does not contain "${expected}"` };
  }
  const words = [...new Set(ref.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3))];
  const hits = words.filter((w) => out.includes(w)).length;
  const ratio = words.length ? hits / words.length : 0;
  return { name: "matches_reference", passed: ratio >= 0.5, detail: `${Math.round(ratio * 100)}% of the reference's key words` };
}

function wantsJson(prompt: string, taskType: TaskType): boolean {
  return taskType === "extraction" || /\bjson\b/i.test(prompt);
}

/** Accepts a bare JSON value or one fenced in ```json; prose around it fails, since callers would have to strip it. */
function validJson(output: string): CheckResult {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(output.trim());
  const body = (fenced ? fenced[1]! : output).trim();
  try {
    const value: unknown = JSON.parse(body);
    const kind = Array.isArray(value) ? "array" : typeof value;
    return { name: "valid_json", passed: true, detail: `parses as a JSON ${kind}${fenced ? " (in a code fence)" : ""}` };
  } catch (error) {
    return { name: "valid_json", passed: false, detail: `not valid JSON: ${(error as Error).message.slice(0, 80)}` };
  }
}
