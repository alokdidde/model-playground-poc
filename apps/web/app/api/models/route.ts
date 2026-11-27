import { isMockMode } from "@fomo/llm";
import { apiRoute } from "@/lib/server/api";
import { getGateway } from "@/lib/server/services";

export const dynamic = "force-dynamic";

export const GET = apiRoute({
  handler: async () => {
    const models = await getGateway().provider.listModels();
    return { items: models, mockMode: isMockMode() };
  },
});
