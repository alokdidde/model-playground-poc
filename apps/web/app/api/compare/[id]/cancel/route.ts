import { IdParamsSchema } from "@fomo/shared";
import { apiRoute } from "@/lib/server/api";
import { cancelComparison } from "@/lib/server/compare-service";
import { errors } from "@/lib/server/errors";
import { prisma } from "@/lib/server/services";

export const dynamic = "force-dynamic";

/**
 * POST /api/compare/:id/cancel: the Stop button. Closing the tab no longer
 * stops a compare, so stopping is an explicit request. Idempotent: stopping a
 * finished run changes nothing.
 *
 * The run is aborted in this process (its model calls stop, it is saved as
 * CANCELLED). With several web instances a cancel can land on an instance
 * that isn't running it; the live app runs one, and the fix would be a
 * "cancel requested" flag the runner checks.
 */
export const POST = apiRoute({
  params: IdParamsSchema,
  handler: async ({ params }) => {
    const comparison = await prisma.comparison.findUnique({ where: { id: params.id }, select: { id: true, status: true } });
    if (!comparison) throw errors.notFound("Comparison", params.id);
    const stopped = cancelComparison(comparison.id);
    return { id: comparison.id, stopped, status: stopped ? "CANCELLED" : comparison.status };
  },
});
