import { CreateEvalRunSchema, ListQuerySchema } from "@fomo/shared";
import { apiRoute, json, readIdempotencyKey } from "@/lib/server/api";
import { createEvalRun, listEvalRuns } from "@/lib/server/evals-service";

export const dynamic = "force-dynamic";

export const GET = apiRoute({
  query: ListQuerySchema,
  handler: async ({ query }) => listEvalRuns(query.limit, query.cursor),
});

/**
 * 202 Accepted + Location: the work happens asynchronously in the worker.
 * A replay of the same Idempotency-Key returns 200 with the original run.
 */
export const POST = apiRoute({
  body: CreateEvalRunSchema,
  handler: async ({ req, body }) => {
    const { run, replayed } = await createEvalRun(body, readIdempotencyKey(req));
    return json(run, replayed ? 200 : 202, {
      Location: `/api/evals/${run.id}`,
      ...(replayed ? { "Idempotent-Replayed": "true" } : {}),
    });
  },
});
