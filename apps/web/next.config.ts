import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server in .next/standalone, which keeps the
  // App Platform image small.
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // Our workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@fomo/shared", "@fomo/llm", "@fomo/ratelimit", "@fomo/db"],
  // Server-only packages with native or dynamic requires stay external.
  serverExternalPackages: ["@dbos-inc/dbos-sdk", "@prisma/client", "ioredis", "pg"],
};

export default nextConfig;
