import { IdParamsSchema } from "@fomo/shared";
import { apiRoute } from "@/lib/server/api";
import { getEvalRun } from "@/lib/server/evals-service";

export const dynamic = "force-dynamic";

export const GET = apiRoute({
  params: IdParamsSchema,
  handler: async ({ params }) => getEvalRun(params.id),
});
