import { PROBLEM_TYPES } from "@fomo/shared";
import { apiRoute } from "@/lib/server/api";
import { ApiError } from "@/lib/server/errors";

/** Unknown API paths get a problem+json 404 instead of Next's HTML page. */
const notFound = apiRoute({
  handler: async ({ req }) => {
    throw new ApiError(404, PROBLEM_TYPES.notFound, "Not found", `No API route for ${req.method} ${req.nextUrl.pathname}.`);
  },
});

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
