import { z } from "zod";
import { IdParamsSchema } from "@fomo/shared";
import { apiRoute } from "@/lib/server/api";
import { getEvalRun } from "@/lib/server/evals-service";
import { summariseRun, toCsv, type ResultRow } from "@/lib/eval-report";

export const dynamic = "force-dynamic";

/** GET /api/evals/:id/export?format=csv|json: every cell (CSV) or the summary plus cells (JSON). */
export const GET = apiRoute({
  params: IdParamsSchema,
  query: z.object({ format: z.enum(["csv", "json"]).default("csv") }),
  handler: async ({ params, query }) => {
    const run = await getEvalRun(params.id);
    const rows = run.results as unknown as ResultRow[];
    const filename = `eval-${run.id}.${query.format}`;
    const headers = { "content-disposition": `attachment; filename="${filename}"` };
    if (query.format === "json") {
      const body = { id: run.id, name: run.name, taskType: run.taskType, models: run.models, summary: summariseRun(rows, run.models), prompts: run.prompts, results: run.results };
      return new Response(JSON.stringify(body, null, 2), { headers: { ...headers, "content-type": "application/json" } });
    }
    const outputs = new Map(run.results.map((r) => [`${r.promptIndex}:${r.model}`, r.output]));
    return new Response(toCsv(rows, run.prompts, outputs), { headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
  },
});
