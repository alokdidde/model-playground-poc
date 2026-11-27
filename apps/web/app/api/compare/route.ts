import { CompareListQuerySchema, CompareRequestSchema, type CompareEvent } from "@fomo/shared";
import { apiRoute, readIdempotencyKey } from "@/lib/server/api";
import { createComparison, executeComparison, listComparisons } from "@/lib/server/compare-service";
import { sseResponse } from "@/lib/server/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * POST /api/compare  ->  text/event-stream of CompareEvent
 *
 * Validation and the idempotency check happen before the stream opens, so
 * those failures are normal problem+json responses with a real status code.
 * Once streaming, failures are per-model events with problem payloads.
 */
export const POST = apiRoute({
  body: CompareRequestSchema,
  handler: async ({ req, body, requestId }) => {
    const comparison = await createComparison(body, requestId, readIdempotencyKey(req));
    // The run outlives the connection: if the tab closes, the stream stops but the compare finishes and is saved.
    return sseResponse<CompareEvent>(req.signal, (emit) => executeComparison(comparison, body, emit));
  },
});

/** GET /api/compare?limit=20&before=<id>  ->  run history, newest first. */
export const GET = apiRoute({
  query: CompareListQuerySchema,
  handler: async ({ query }) => listComparisons(query.limit, query.before),
});
