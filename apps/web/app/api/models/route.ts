import { isMockMode } from "@fomo/llm";
import { apiRoute } from "@/lib/server/api";
import { getGateway } from "@/lib/server/services";

export const dynamic = "force-dynamic";

export const GET = apiRoute({
  handler: async () => {
    // Only models that can be compared: text generation (chat) that this account's plan can call.
    // Embedding, image, audio, video and router models don't answer a prompt with text, and
    // plan-blocked models (e.g. Anthropic, proprietary OpenAI) would only fail with a 403.
    const models = (await getGateway().provider.listModels()).filter((m) => m.kind === "chat" && m.available);
    return { items: models, mockMode: isMockMode() };
  },
});
