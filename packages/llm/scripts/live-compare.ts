/**
 * Live smoke test against DigitalOcean serverless inference.
 *
 *   DO_MODEL_ACCESS_KEY=... pnpm --filter @fomo/llm smoke:live ["prompt"]
 *
 * Runs the same path as /api/compare (ModelGateway.stream for each model in
 * parallel, then runJudge), but with an in-memory lease store so it needs no
 * database. Prints per-model latency, tokens and cost, and the judge verdict.
 */
import { MemoryLeaseStore, RateLimiter, limitsFromEnv } from "@fomo/ratelimit";
import { ModelGateway, createProviderFromEnv, isMockMode, judgeConfigFromEnv, pickJudgeModel, runJudge } from "../src";

const models = (process.env.SMOKE_MODELS ?? "deepseek-v4.1-flash,mistral-3-14B,glm-5.3-flash").split(",");
const prompt = process.argv[2] ?? "In three sentences, explain when to use a queue instead of a direct HTTP call between two services.";

async function main() {
  if (isMockMode()) throw new Error("Mock mode is on: set DO_MODEL_ACCESS_KEY and unset GRADIENT_MOCK.");
  const gateway = new ModelGateway(createProviderFromEnv(), new RateLimiter(new MemoryLeaseStore(), limitsFromEnv()));
  const started = Date.now();

  const outcomes = await Promise.all(
    models.map(async (model) => {
      let chunks = 0;
      try {
        const { output, metrics } = await gateway.stream(
          { model, messages: [{ role: "user", content: prompt }], maxTokens: 512, temperature: 0.7 },
          () => void chunks++,
          { onRetry: (r) => console.log(`  [${model}] retry`, r) },
        );
        return { model, output, ok: true as const, metrics, chunks };
      } catch (error) {
        return { model, output: "", ok: false as const, error: String(error), chunks };
      }
    }),
  );

  for (const o of outcomes) {
    console.log(`\n=== ${o.model} (${o.chunks} stream chunks) ===`);
    if (o.ok) {
      console.log(JSON.stringify(o.metrics));
      console.log(o.output.slice(0, 400) + (o.output.length > 400 ? " ..." : ""));
    } else console.log("FAILED:", o.error);
  }

  const ok = outcomes.filter((o) => o.ok);
  const cfg = judgeConfigFromEnv();
  const judge = pickJudgeModel(models, cfg.preferred, cfg.fallbacks);
  if (ok.length >= 2) {
    const verdict = await runJudge(gateway, { prompt, candidates: ok, judgeModel: judge.judgeModel, selfJudged: judge.selfJudged });
    console.log(`\n=== judge ${verdict.judgeModel} ===`);
    console.log(JSON.stringify(verdict, null, 2));
  }
  console.log(`\nwall clock ${Date.now() - started} ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
