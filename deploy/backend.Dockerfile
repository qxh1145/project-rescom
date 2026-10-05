# Backend image (Story 11.1). Build context: repo root, e.g.
#   docker build -f deploy/backend.Dockerfile -t rescom-api:local .
# One artifact for every host (AD-23). It never migrates on start: run
#   docker compose run --rm api npx prisma migrate deploy
# from the controlled pipeline (Story 11.3). No secrets: env comes from the host at run time.

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Workspace manifests the root lockfile expects (frontend deps are not installed here).
COPY package.json package-lock.json ./
COPY packages/schemas/package.json packages/schemas/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/

FROM base AS build
# Full schemas source: its `prepare` script (tsc) runs during npm ci.
COPY packages/schemas packages/schemas
RUN npm ci
COPY apps/backend apps/backend
# `prebuild` builds @rescom/schemas into packages/schemas/dist.
RUN cd apps/backend && npx prisma generate && npm run build

FROM base AS runtime
# The schemas `prepare` (tsc, a dev dep) still runs for a workspace link despite --ignore-scripts,
# so it is dropped from this stage's manifest copy; its dist is copied below.
RUN npm pkg delete scripts.prepare --workspace @rescom/schemas \
  && npm ci --omit=dev --ignore-scripts --workspace backend && npm cache clean --force
COPY --from=build /app/packages/schemas/dist packages/schemas/dist
COPY --from=build /app/apps/backend/dist apps/backend/dist
COPY --from=build /app/apps/backend/prisma apps/backend/prisma
# Prisma packages with their engines (skipped install scripts) and the generated client. The CLI is
# a runtime dependency so `prisma migrate deploy` runs from this same image.
COPY --from=build /app/apps/backend/node_modules/prisma apps/backend/node_modules/prisma
COPY --from=build /app/apps/backend/node_modules/@prisma apps/backend/node_modules/@prisma
COPY --from=build /app/apps/backend/node_modules/.prisma apps/backend/node_modules/.prisma
WORKDIR /app/apps/backend

ENV NODE_ENV=production
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/apps/backend/src/main"]
