import { IdParamsSchema, VoteRequestSchema } from "@fomo/shared";
import { apiRoute } from "@/lib/server/api";
import { errors } from "@/lib/server/errors";
import { prisma } from "@/lib/server/services";

export const dynamic = "force-dynamic";

/** PUT is idempotent by definition: voting twice just updates the vote. */
export const PUT = apiRoute({
  params: IdParamsSchema,
  body: VoteRequestSchema,
  handler: async ({ params, body }) => {
    const comparison = await prisma.comparison.findUnique({ where: { id: params.id }, select: { models: true } });
    if (!comparison) throw errors.notFound("Comparison", params.id);
    if (body.preferredModel && !comparison.models.includes(body.preferredModel)) {
      throw errors.validation([{ pointer: "body.preferredModel", message: "Not one of the compared models" }]);
    }
    return prisma.vote.upsert({
      where: { comparisonId: params.id },
      create: { comparisonId: params.id, preferredModel: body.preferredModel },
      update: { preferredModel: body.preferredModel },
    });
  },
});
