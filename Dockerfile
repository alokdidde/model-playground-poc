# The web app (Next.js). App Platform builds this for the web service and
# reuses the same image for the pre-deploy migrate job.
#   docker build -t fomo-web .
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---- install dependencies (cached unless a manifest changes) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/ratelimit/package.json packages/ratelimit/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ---- copy sources, generate the Prisma client, build ----
FROM deps AS web
COPY . .
RUN pnpm --filter @fomo/db generate
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @fomo/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@fomo/web", "start"]
