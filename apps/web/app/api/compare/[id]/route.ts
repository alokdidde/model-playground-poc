import { IdParamsSchema } from "@fomo/shared";
import { apiRoute } from "@/lib/server/api";
import { errors } from "@/lib/server/errors";
import { prisma } from "@/lib/server/services";

export const dynamic = "force-dynamic";

export const GET = apiRoute({
  params: IdParamsSchema,
  handler: async ({ params }) => {
    const comparison = await prisma.comparison.findUnique({
      where: { id: params.id },
      include: { results: { orderBy: { model: "asc" } }, judgement: true, vote: true },
    });
    if (!comparison) throw errors.notFound("Comparison", params.id);
    return comparison;
  },
});
