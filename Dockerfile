# syntax=docker/dockerfile:1

# better-sqlite3 is a native module, so the build stage needs a toolchain and the
# runtime must share the same base image or the compiled binding will not load.
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
# PUBLIC_* vars are inlined at build time by Astro, so the Turnstile site key has
# to be present here rather than at runtime.
ARG PUBLIC_TURNSTILE_SITE_KEY=""
ENV PUBLIC_TURNSTILE_SITE_KEY=$PUBLIC_TURNSTILE_SITE_KEY
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    WAITLIST_DB_PATH=/data/waitlist.db

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates wget \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data && chown node:node /data

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 4321
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4321/ >/dev/null 2>&1 || exit 1

CMD ["node", "./dist/server/entry.mjs"]
