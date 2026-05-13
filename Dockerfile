# syntax=docker/dockerfile:1.6

# ── Stage 1: build web bundle ──────────────────────────────────────
FROM oven/bun:1.3-alpine AS web-build
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
COPY packages/server/package.json packages/server/
COPY packages/shim/package.json packages/shim/
RUN bun install --frozen-lockfile
COPY packages/shared packages/shared
COPY packages/web packages/web
RUN cd packages/web && bun run build
# packages/web/dist/ now contains the SPA bundle

# ── Stage 2: build server ──────────────────────────────────────────
FROM oven/bun:1.3-alpine AS server-build
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/shim/package.json packages/shim/
RUN bun install --frozen-lockfile
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY --from=web-build /app/packages/web/dist /app/packages/web/dist
# Embed the web dist into the server binary location
RUN cd packages/server && bun run build:bin
# packages/server outputs to ../../dist/prixmaviz at workspace root

# ── Stage 3: runtime ───────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
COPY --from=server-build /app/dist/prixmaviz /app/prixmaviz
COPY --from=server-build /app/packages/server/migrations /app/migrations
COPY --from=web-build /app/packages/web/dist /app/web-dist
ENV PRIXMAVIZ_WEB_DIST=/app/web-dist
ENV PRIXMAVIZ_MIGRATIONS_DIR=/app/migrations
EXPOSE 5180
# Note: 127.0.0.1 explicitly (not "localhost") — in alpine, localhost resolves
# to IPv6 ::1 first, and Bun's server binds IPv4 0.0.0.0 only. Using localhost
# here causes wget to fail with "Connection refused" → unhealthy → Traefik
# refuses to route traffic. exec-form (no shell, no pipe) keeps it simple.
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:5180/api/health || exit 1
CMD ["/app/prixmaviz"]
