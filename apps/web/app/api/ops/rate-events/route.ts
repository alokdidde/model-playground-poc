import { RateEventsQuerySchema } from "@fomo/shared";
import { apiRoute } from "@/lib/server/api";
import { getRateEvents, summarize } from "@/lib/server/rate-events";

export const dynamic = "force-dynamic";

/** Raw rate-limit events plus a per-model summary, for the ops page and offline analysis. */
export const GET = apiRoute({
  query: RateEventsQuerySchema,
  handler: async ({ query }) => {
    const events = await getRateEvents(query);
    return { summary: summarize(events), events };
  },
});
