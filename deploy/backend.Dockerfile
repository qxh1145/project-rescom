# Build context: repo root (`docker compose -f deploy/docker-compose.prod.yml build`).
# ponytail: one stage, dev deps kept (prisma CLI runs `migrate deploy` at start); split into
# build/runtime stages if image size matters.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
# Full schemas source: its `prepare` script (tsc) runs during npm ci.
COPY packages/schemas packages/schemas
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci

COPY apps/backend apps/backend
RUN cd apps/backend && npx prisma generate && npm run build

WORKDIR /app/apps/backend
ENV NODE_ENV=production
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/apps/backend/src/main"]
