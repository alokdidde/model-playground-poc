import { LeaderboardQuerySchema } from "@fomo/shared";
import { apiRoute } from "@/lib/server/api";
import { getLeaderboard } from "@/lib/server/leaderboard";

export const dynamic = "force-dynamic";

export const GET = apiRoute({
  query: LeaderboardQuerySchema,
  handler: async ({ query }) => ({ items: await getLeaderboard(query.taskType) }),
});
