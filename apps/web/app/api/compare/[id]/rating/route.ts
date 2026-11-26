import { IdParamsSchema, RatingRequestSchema } from "@fomo/shared";
import { apiRoute } from "@/lib/server/api";
import { errors } from "@/lib/server/errors";
import { prisma } from "@/lib/server/services";

export const dynamic = "force-dynamic";

/**
 * Thumbs up/down on one model's answer. PUT is idempotent: sending the same
 * rating twice changes nothing, and `rating: null` clears it. Ratings are
 * training/eval signal for the roadmap ("learn from votes").
 */
export const PUT = apiRoute({
  params: IdParamsSchema,
  body: RatingRequestSchema,
  handler: async ({ params, body }) => {
    const result = await prisma.compareResult.findUnique({
      where: { comparisonId_model: { comparisonId: params.id, model: body.model } },
      select: { id: true, status: true },
    });
    if (!result) throw errors.notFound("Answer", `${params.id}/${body.model}`);
    if (result.status !== "SUCCEEDED") {
      throw errors.validation([{ pointer: "body.model", message: "Only successful answers can be rated" }]);
    }
    const rating = body.rating === "up" ? 1 : body.rating === "down" ? -1 : null;
    await prisma.compareResult.update({ where: { id: result.id }, data: { rating } });
    return { comparisonId: params.id, model: body.model, rating: body.rating };
  },
});
