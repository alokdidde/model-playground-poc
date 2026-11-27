import type { Candidate } from "./judge";
import { describeModel } from "./catalog";
import { fence, FENCE_RULE } from "./fence";
import type { ChatRequest } from "./types";

/**
 * The "combined view" in its literal sense: one answer merged from all of
 * them. Unlike the judge, the synthesizer sees model names, because the
 * point is to attribute each part of the merged answer to its source.
 * It uses the same neutral model as the judge.
 */
export const SYNTHESIS_SYSTEM_PROMPT = `You merge several AI assistants' answers to the same prompt into one best answer.

Rules:
- Keep what is correct and useful from each answer; drop errors, repetition and filler.
- Where answers disagree, say so briefly and prefer the better-supported claim.
- After each sentence or bullet that comes mainly from one answer, cite it in square brackets with the model name exactly as given, e.g. [GLM-5.3 Flash]. Cite several if they agree, e.g. [GLM-5.3 Flash, Ministral 3 14B].
- Do not add facts that none of the answers contain.
- Be no longer than the longest answer. Use Markdown only if the answers do.
- Do not include images.
- ${FENCE_RULE}`;

export function buildSynthesisRequest(prompt: string, candidates: Candidate[], synthModel: string): ChatRequest {
  const body = candidates
    .map((c) => `### ${describeModel(c.model).label}\n${fence("answer", c.output, { model: describeModel(c.model).label })}`)
    .join("\n\n");
  return {
    model: synthModel,
    messages: [
      { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
      { role: "user", content: `## User prompt\n${fence("user_prompt", prompt)}\n\n## Answers\n${body}\n\nWrite the merged answer now.` },
    ],
    maxTokens: 1500,
    temperature: 0.2,
  };
}
