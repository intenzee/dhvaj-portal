# ─────────────────────────────────────────────────────────────────────────
# HSDG API — production image (multi-stage).
#
# Build from the REPO ROOT (the build needs the npm workspace):
#   docker build -f apps/api/Dockerfile -t hsdg-api .
#
# The image runs the compiled API as a non-root user. Migrations are NOT run
# here — they are a separate, controlled deploy step (npm run db:migrate as the
# migrator role). Configuration comes entirely from the environment.
# ─────────────────────────────────────────────────────────────────────────

# ---- Stage 1: install + build ------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Copy only manifests first for better layer caching. package-lock.json pins the
# whole workspace; the per-workspace package.json files must be present for
# `npm ci` to link them.
COPY package.json package-lock.json ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/

RUN npm ci

# Now the sources, and build (workspaces build packages before apps). The shared
# TypeScript config lives in packages/tsconfig, copied here with the rest.
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run build

# Drop dev dependencies so only runtime deps are carried forward.
RUN npm prune --omit=dev

# ---- Stage 2: runtime --------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Pruned production dependencies (includes the @hsdg/contracts workspace symlink).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Compiled workspaces. @hsdg/contracts resolves via its dist build at runtime.
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

# Deploy entrypoint + SQL assets it applies at boot (migrations + seeds). These
# come straight from the build context (they are not part of the compiled app).
# The entrypoint provisions the two DB roles on a managed Postgres, migrates and
# seeds (idempotent), then launches the API. See scripts/deploy/start.mjs.
COPY db ./db
COPY scripts/deploy ./scripts/deploy

# Run unprivileged (the node image ships a `node` user, uid 1000).
USER node

ENV PORT=3001
EXPOSE 3001

# Liveness probe using Node's built-in fetch (no extra tooling in the image).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default: run the app directly (compose/local, where migrations are a separate
# step). On a managed host set the start command to the deploy entrypoint:
#   node scripts/deploy/start.mjs
CMD ["node", "apps/api/dist/main.js"]
