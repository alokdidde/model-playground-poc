# One Dockerfile for both components. The COMPONENT build arg picks the
# final stage: App Platform passes BUILD_TIME env vars as --build-arg.
#   docker build --build-arg COMPONENT=web -t fomo-web .
#   docker build --build-arg COMPONENT=worker -t fomo-worker .
ARG COMPONENT=web

FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---- install dependencies (cached unless a manifest changes) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/ratelimit/package.json packages/ratelimit/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ---- copy sources and generate the Prisma client ----
FROM deps AS source
COPY . .
RUN pnpm --filter @fomo/db generate

# ---- web: Next.js production build ----
FROM source AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @fomo/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@fomo/web", "start"]

# ---- worker: DBOS workflows (runs TypeScript via tsx, no build step) ----
FROM source AS worker
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@fomo/worker", "start"]

# ---- final image: the stage named by COMPONENT ----
FROM ${COMPONENT} AS final
