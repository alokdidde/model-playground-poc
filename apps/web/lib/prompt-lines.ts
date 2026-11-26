/**
 * Parses the "Validate on my prompts" box: one prompt per line, optionally
 * "prompt => expected answer", which the judge sees as a (possibly imperfect)
 * reference. Blank lines are ignored.
 */
export function parsePromptLines(text: string): { prompt: string; expected?: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [prompt, expected] = line.split(/\s+=>\s+/, 2);
      return expected ? { prompt: prompt!.trim(), expected: expected.trim() } : { prompt: line };
    });
}
