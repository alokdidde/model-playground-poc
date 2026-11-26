import { prisma } from "@fomo/db";
import { createGatewayFromEnv } from "@fomo/llm";

/** Same gateway (and therefore the same shared lease store) as the web app. */
export const gateway = createGatewayFromEnv(prisma);
export { prisma };
