# Build context: repo root. NEXT_PUBLIC_* are inlined at build time, so they are build args.
FROM node:22-bookworm-slim
WORKDIR /app

COPY apps/frontend/my-app/package.json apps/frontend/my-app/package-lock.json apps/frontend/my-app/
RUN cd apps/frontend/my-app && npm ci
# packages/schemas/src imports zod; locally the root workspace node_modules provides it.
RUN ln -s /app/apps/frontend/my-app/node_modules /app/node_modules

COPY packages/schemas packages/schemas
COPY apps/frontend/my-app apps/frontend/my-app

ARG NEXT_PUBLIC_API_MOCKING=disabled
ENV NEXT_PUBLIC_API_MOCKING=$NEXT_PUBLIC_API_MOCKING \
    NEXT_PUBLIC_API_URL=/api \
    NEXT_TELEMETRY_DISABLED=1
# The /api rewrite target is read in next.config at build time too.
ENV RESCOM_API_URL=http://backend:4000
WORKDIR /app/apps/frontend/my-app
RUN npx next build --webpack

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
