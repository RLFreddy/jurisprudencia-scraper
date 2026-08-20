# ==========================================
# Stage 1: Shared base and pnpm setup
# ==========================================
FROM node:24.10.0-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml ./

# ==========================================
# Stage 2: Production dependencies
# ==========================================
FROM base AS prod-deps
# Toolchain required to compile native modules such as better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

# ==========================================
# Stage 3: Build (TypeScript / Assets)
# ==========================================
FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ==========================================
# Stage 4: Final runtime (ultra slim)
# ==========================================
FROM node:24.10.0-slim AS runtime

ENV NODE_ENV=production \
    BASE_DIR=/app/data

WORKDIR /app

# Pre-create all output directories with permissions for the 'node' user
RUN mkdir -p /app/data/files /app/data/errors && chown -R node:node /app

# Copy artifacts assigning ownership directly to the node user
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./

USER node

CMD ["node", "dist/main.js"]