import { IdParamsSchema } from "@fomo/shared";
import { apiRoute } from "@/lib/server/api";
import { errors } from "@/lib/server/errors";
import { isAbandoned } from "@/lib/server/compare-service";
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
    // A restart or crash mid-run leaves it RUNNING forever; say what happened instead.
    if (isAbandoned(comparison)) {
      return prisma.comparison.update({
        where: { id: comparison.id },
        data: { status: comparison.results.length ? "PARTIAL" : "FAILED", completedAt: new Date() },
        include: { results: { orderBy: { model: "asc" } }, judgement: true, vote: true },
      });
    }
    return comparison;
  },
});
