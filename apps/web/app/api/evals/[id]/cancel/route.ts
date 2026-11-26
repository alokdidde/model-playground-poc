import { IdParamsSchema } from "@fomo/shared";
import { apiRoute } from "@/lib/server/api";
import { cancelEvalRun } from "@/lib/server/evals-service";

export const dynamic = "force-dynamic";

export const POST = apiRoute({
  params: IdParamsSchema,
  handler: async ({ params }) => cancelEvalRun(params.id),
});
