# ─────────────────────────────────────────────────────────────────────────
# HSDG Web (Next.js) — production image (multi-stage, standalone output).
#
# Build from the REPO ROOT (the build needs the npm workspace):
#   docker build -f apps/web/Dockerfile -t hsdg-web .
#
# The app talks to the API directly from the browser, so the API base URL is a
# BUILD-TIME public env (NEXT_PUBLIC_API_URL) baked into the client bundle.
# Pass it with --build-arg; in CI/CD it comes from the environment.
# ─────────────────────────────────────────────────────────────────────────

# ---- Stage 1: install + build ------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Manifests first for layer caching. The whole workspace is needed because the
# web app consumes the @hsdg/contracts workspace package.
COPY package.json package-lock.json ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/

RUN npm ci

# Public API base URL is compiled into the client bundle at build time.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

# Sources, then build. Contracts builds before the app (workspace order); the web
# build emits a self-contained server under apps/web/.next/standalone.
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm run build --workspace @hsdg/contracts && npm run build --workspace @hsdg/web

# ---- Stage 2: runtime --------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# The standalone bundle carries its own minimal node_modules and server. With
# outputFileTracingRoot at the repo root, the entrypoint is apps/web/server.js.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER node

ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
