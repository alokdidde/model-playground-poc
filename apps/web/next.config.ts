import type { NextConfig } from "next";

// Local dev: one .env at the repo root serves every app and package.
// In production the platform injects env vars and this file does not exist.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url).pathname);
} catch {
  // no root .env: fine
}

/**
 * Security headers on every response. The CSP is the second line of defence
 * for model output (the Markdown renderer is the first): even if some HTML
 * got through, scripts and images from other origins would not load, so a
 * prompt-injected answer cannot beacon data out with an <img>.
 * 'unsafe-inline' for scripts is needed by Next's inline bootstrap without
 * nonces; 'unsafe-eval' only in dev (React refresh).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework version.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Compare is the home page now; old links (including ?from= and ?history=1) keep working.
  async redirects() {
    return [{ source: "/compare", destination: "/", permanent: false }];
  },
  // Our workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@fomo/shared", "@fomo/llm", "@fomo/ratelimit", "@fomo/db"],
  // Server-only packages with native or dynamic requires stay external.
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
