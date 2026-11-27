import type { NextConfig } from "next";

// Local dev: one .env at the repo root serves every app and package.
// In production the platform injects env vars and this file does not exist.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url).pathname);
} catch {
  // no root .env: fine
}

const nextConfig: NextConfig = {
  // Our workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@fomo/shared", "@fomo/llm", "@fomo/ratelimit", "@fomo/db"],
  // Server-only packages with native or dynamic requires stay external.
  serverExternalPackages: ["@dbos-inc/dbos-sdk", "@prisma/client", "pg"],
};

export default nextConfig;
