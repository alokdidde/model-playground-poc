import { AdvisorRequestSchema } from "@fomo/shared";
import { apiRoute } from "@/lib/server/api";
import { adviseModels } from "@/lib/server/advisor-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/advisor  { query }  ->  intent, ranking from measured data, explanation.
 * Not idempotent-keyed: it writes nothing, so a retry is just another question.
 */
export const POST = apiRoute({
  body: AdvisorRequestSchema,
  handler: async ({ req, body }) => adviseModels(body.query, req.signal),
});
