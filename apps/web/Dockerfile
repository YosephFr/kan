# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=20
ARG DISTROLESS_NODE_IMAGE=gcr.io/distroless/nodejs${NODE_VERSION}-debian12

# ============================================
# Stage 1: Debian 12 base with pnpm and turbo
# ============================================
FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates git && \
    rm -rf /var/lib/apt/lists/* /tmp/* && \
    corepack enable && \
    corepack prepare pnpm@9.14.2 --activate && \
    npm install turbo@2.3.1 --global && \
    pnpm config set store-dir ~/.pnpm-store

# ============================================
# Stage 2: Prune the monorepo
# ============================================
FROM base AS pruner

WORKDIR /app
COPY . .

# Generate version from git (fallback if APP_VERSION not provided)
RUN git fetch --tags --unshallow 2>/dev/null || git fetch --tags 2>/dev/null || true && \
    AUTO_VERSION=$(git describe --tags --always --long 2>/dev/null | \
    sed -E 's/^v?([0-9]+\.[0-9]+\.[0-9]+)-[0-9]+-g([a-f0-9]{7}).*/\1+\2/' | \
    sed 's/^v//' || \
    git rev-parse --short HEAD 2>/dev/null | head -c 7 || \
    echo "unknown") && \
    echo "$AUTO_VERSION" > /app/AUTO_VERSION

RUN turbo prune --scope=@kan/web --scope=@kan/db --docker

# ============================================
# Stage 3: Install dependencies
# ============================================
FROM base AS deps
WORKDIR /app

COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/json/ .

ENV CI=true
RUN --mount=type=cache,id=pnpm,target=~/.pnpm-store pnpm install --frozen-lockfile

# ============================================
# Stage 4: Build the web application
# ============================================
FROM base AS builder
ARG APP_VERSION

WORKDIR /app

COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/AUTO_VERSION /tmp/AUTO_VERSION

# Force standalone output for production Docker image
ENV NEXT_PUBLIC_USE_STANDALONE_OUTPUT=true
ENV CI=true

RUN VERSION="${APP_VERSION:-$(cat /tmp/AUTO_VERSION 2>/dev/null | tr -d '\n\r' || echo 'unknown')}" && \
    NEXT_PUBLIC_APP_VERSION="$VERSION" pnpm build --filter=@kan/web

# ============================================
# Stage 5: Workspace canvas image backfill
# ============================================
FROM builder AS backfill

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@kan/api", "backfill:workspace-canvas-images"]

# ============================================
# Stage 6: Visual wall backfill
# ============================================
FROM builder AS visual-wall-backfill

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@kan/api", "backfill:visual-walls"]

# ============================================
# Stage 7: Migration image (run-once container)
# ============================================
FROM node:${NODE_VERSION}-alpine AS migrate
WORKDIR /db

COPY packages/db/drizzle.config.ts ./drizzle.config.ts
COPY packages/db/migrations/ ./migrations/

RUN npm init -y && \
    npm install drizzle-kit drizzle-orm pg --save-exact && \
    # Strip unnecessary files from node_modules
    find node_modules -type f \( \
      -name '*.d.ts' -o \
      -name '*.d.mts' -o \
      -name '*.d.cts' -o \
      -name '*.map' -o \
      -name '*.md' -o \
      -name '*.txt' -o \
      -name 'LICENSE*' -o \
      -name 'CHANGELOG*' -o \
      -name 'README*' -o \
      -name '.eslint*' -o \
      -name '.prettier*' -o \
      -name 'tsconfig*.json' \
    \) -delete && \
    find node_modules -type d -empty -delete && \
    rm -rf /root/.npm /tmp/*

CMD ["npx", "drizzle-kit", "migrate"]

# ============================================
# Stage 8: Production web image (distroless)
# ============================================
FROM ${DISTROLESS_NODE_IMAGE} AS web
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy the standalone Next.js server
COPY --chown=1000:1000 --from=builder /app/apps/web/.next/standalone/ ./
# Copy static assets and public files
COPY --chown=1000:1000 --from=builder /app/apps/web/.next/static/ ./apps/web/.next/static/
COPY --chown=1000:1000 --from=builder /app/apps/web/public/ ./apps/web/public/

# Copy bootstrap script for runtime env var injection
COPY --chown=1000:1000 apps/web/bootstrap.cjs ./bootstrap.cjs

USER 1000:1000

EXPOSE 3000
CMD ["bootstrap.cjs"]
