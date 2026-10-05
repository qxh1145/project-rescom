---
created: 2026-10-03
story_key: 11-1-deployment-ready-backend-packaging
epic: 11 (Production Deployment & Pilot Readiness)
baseline_commit: 605ae2f
context:
  - "_bmad-output/planning-artifacts/epics.md#Story 11.1 (L1356-1374), Epic 11 gate model (L1350-1354), Epic IR gates (L1100-1106)"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md (AD-5 amendment L111, AD-10 L133, AD-17 L168, AD-23 L198, AD-3/AD-4 amendment L104)"
  - "_bmad-output/planning-artifacts/implementation-readiness-report-2026-09-30.md (L492-493 trusted client IP conflict, L557)"
  - "_bmad-output/implementation-artifacts/ir-1-pilot-contract-inventory-2026-10-02.md (section 3 items 10/14, decision 3: canonical origin app.rescom.com.vn)"
  - "_bmad-output/implementation-artifacts/ir-5-launch-domain-closure-local-integration-gate.md (E3.2 TRUST_PROXY_HOPS=1, ClamAV StreamMaxLength)"
  - "deploy/ (existing single-VPS internal-testing stack)"
---

# Story 11.1: Deployment-Ready Backend Packaging

Status: done

## Story

As a Developer,
I want the backend packaged as one production Docker image with a production Compose file,
so that the same artifact runs locally, on the Google Cloud VM, and on any later host.

## Acceptance Criteria

Source: epics.md L1362-1374. Numbering is used by Tasks.

1. **Image.** A multi-stage `Dockerfile` builds `@rescom/schemas` and the backend, runs as a non-root user on Node 22, and contains no secrets.
2. **Compose.** `docker-compose.prod.yml` runs `caddy`, `api` and `clamav` with restart policies and healthchecks; no database, object storage or other business data lives in a container volume (AD-23).
3. **No frontend on the VM.** The frontend is not packaged or served by Caddy; browser traffic stays on the canonical frontend origin and reaches the backend only through Vercel's external `/api` rewrite, the public API edge/Cloudflare and Caddy.
4. **Edge and client IP.** The `Caddyfile` proxies edge traffic to NestJS on private port 4000, and the trusted-proxy configuration restores, logs and rate-limits by the real client IP across the approved multi-hop chain.
5. **Health.** Liveness and readiness endpoints exist; readiness reports database reachability and scanner reachability without leaking payloads (AD-17, NFR-ADD-4).
6. **Scheduler.** Scheduled durable work (pending-credit release, frozen-starter expiry, reservation expiry, Outbox dispatch) runs in-process behind one configuration flag so exactly one scheduler owner exists, still claiming work through PostgreSQL (AD-5 amendment, AD-10).
7. **S3 portability.** The S3 client sets `requestChecksumCalculation` and `responseChecksumValidation` to `WHEN_REQUIRED`, and presigned upload plus download pass against Google Cloud Storage's S3 interoperability endpoint as well as local MinIO.
8. **Pinned local images.** Local `docker-compose.yml` pins MinIO and `minio/mc` to fixed tags instead of `latest`.
9. **No provider SDK.** No provider-specific SDK (`@google-cloud/*`) is introduced (AD-23).

## What already exists (read before writing anything)

This story closes gaps. Several ACs are already met and only need proof:

| AC | State at `605ae2f` | Work left |
|---|---|---|
| 1 | `deploy/backend.Dockerfile`: single stage, `node:22-bookworm-slim`, runs as **root**, keeps dev deps, CMD runs `prisma migrate deploy` on every start | Rewrite as multi-stage, non-root, no auto-migrate |
| 2 | `deploy/docker-compose.prod.yml` is the **all-in-one internal-testing VPS stack** (caddy, frontend, backend, postgres, minio, minio-init, clamav). Backend has no healthcheck | New AD-23 compose; keep the internal stack under another name (Task 1) |
| 3 | `deploy/Caddyfile` + `deploy/frontend.Dockerfile` serve the frontend on the VM | Not in the AD-23 file set |
| 4 | `main.ts:18-20` sets Express `trust proxy` from `TRUST_PROXY_HOPS` (prod refuses < 1, `env.schema.ts:403-408`). Throttler keys on `req.ip` (`security.module.ts:39`, `app-throttler.guard.ts:42`). No code reads XFF/CF headers directly (keep it that way, see `public-forms.controller.ts:37`) | Caddy chain + edge-key design (Task 4); AD-23 amendment |
| 5 | Only `GET /system/health` (`system.controller.ts:64-82`): heavy (`collectMetrics()`), always HTTP 200, no scanner check. `scheduler-health.service.ts:41` says it is "reused by Story 11.1's readiness endpoint" | New `/health/live` + `/health/ready` (Task 3) |
| 6 | **Done** by IR.2b: `SCHEDULER_ENABLED` (`env.schema.ts:203`, default false; prod refuses false at L415-420), lease claim in `prisma-job-lease.repository.ts:24-49`, jobs: outbox-dispatch, pending-release, starter-expiry, reservation-expiry, deadline-close, storage-cleanup, password-reset-cleanup | Verify + document only (Task 6) |
| 7 | **Config done**: `s3-object-storage.service.ts:24-38` sets both `WHEN_REQUIRED`; spec `s3-object-storage.service.spec.ts:27-37` asserts no checksum in presigned PUT. MinIO real e2e: `test/file-storage.real.e2e-spec.ts` | GCS interop evidence run (Task 7) |
| 8 | **Done**: `docker-compose.yml` pins `pgsty/minio:RELEASE.2026-08-04T00-00-00Z@sha256:…` and `pgsty/mc:RELEASE.2026-09-16T00-00-00Z@sha256:…` (MinIO Inc. stopped publishing `minio/minio`; pgsty fork is the same binary) | Verify only; do not "fix" back to `minio/minio` |
| 9 | **Done**: no `@google-cloud/*` dep (only `google-auth-library` for OAuth, which is allowed) | Add a guard test (Task 8) |

## Tasks / Subtasks

### Task 1: Split the deploy file set (AC 2, 3) **[Q1]**

- [x] 1.1 `git mv deploy/docker-compose.prod.yml deploy/docker-compose.internal.yml` and `git mv deploy/Caddyfile deploy/Caddyfile.internal`; `git mv deploy/.env.prod.example deploy/.env.internal.example`. Update the internal compose's Caddyfile mount path, `env_file`, and the header comment. Keep `frontend.Dockerfile` and `backup.sh` (internal-only; `backup.sh` must point at the renamed compose/env files).
- [x] 1.2 The internal stack keeps migrating on start: give its `backend` service `command: ["sh", "-c", "npx prisma migrate deploy && node dist/apps/backend/src/main"]` (the new image no longer does this, Task 2.4).
- [x] 1.3 `deploy/README.md` (Vietnamese, keep the language): update the `rescom` alias and every path for the internal stack; add a short section "Pilot AD-23 (Google Cloud)" that points to the new files and says provisioning is Story 11.2, CI/CD Story 11.3. Do not rewrite the rest of the README.
- [x] 1.4 `.gitignore` already ignores `deploy/.env.prod`; add `deploy/.env.internal` and `deploy/certs/`. Do not touch the untracked real `deploy/.env.prod` on disk (it holds the internal VPS secrets; rename it by hand only if Quan says so; note it in Completion Notes).

### Task 2: Multi-stage, non-root backend image (AC 1)

- [x] 2.1 Rewrite `deploy/backend.Dockerfile` (build context stays the repo root):
  - **build stage** `node:22-bookworm-slim`: `apt-get install openssl ca-certificates`; copy root `package.json`/`package-lock.json`, `packages/schemas`, `apps/backend/package.json`, `apps/frontend/package.json` (the workspace manifest the lockfile expects, same as today); `npm ci`; copy `apps/backend`; `cd apps/backend && npx prisma generate && npm run build` (the `prebuild` script builds `@rescom/schemas`).
  - **runtime stage** `node:22-bookworm-slim` + `openssl ca-certificates`: `npm ci --omit=dev --ignore-scripts --workspace backend` with the same manifests (`--ignore-scripts` because `@rescom/schemas`' `prepare` runs `tsc`, a dev dep). Then copy from build: `packages/schemas/dist`, `apps/backend/dist`, `apps/backend/prisma` (schema + migrations), and run `npx prisma generate` in `apps/backend` (needs the CLI, see 2.2).
  - `USER node` (uid 1000, ships with the image); `chown` only what must be writable (nothing should be).
  - `ENV NODE_ENV=production`, `EXPOSE 4000`, `CMD ["node", "dist/apps/backend/src/main"]`, `WORKDIR /app/apps/backend`.
  - `HEALTHCHECK` with Node's `fetch` (the slim image has no curl): `node -e "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`.
- [x] 2.2 Move `prisma` (pinned `6.0.0`) from `devDependencies` to `dependencies` in `apps/backend/package.json` and refresh the root lockfile (`npm install` at root). The CLI must be in the runtime image so Story 11.3 can run `docker compose run --rm api npx prisma migrate deploy` with the same artifact.
- [x] 2.3 Runtime resolution check: the backend compiles to `dist/apps/backend/src/main` because `tsconfig.json` `paths` maps `@rescom/schemas` to source, but at runtime Node resolves `@rescom/schemas` through the workspace symlink `node_modules/@rescom/schemas → packages/schemas` and its `main: ./dist/index.js`. The runtime stage must therefore contain the symlink (created by `npm ci`) **and** `packages/schemas/dist` and `packages/schemas/package.json`. Prove it by booting the container (Task 9).
- [x] 2.4 No migrate-on-start in the image (AD-23 / Story 11.3: migrations run only through the controlled pipeline).
- [x] 2.5 No secrets: root `.dockerignore` already excludes `**/.env`, `**/.env.*`. Add `**/*.local.md` (excludes `apps/backend/.seed-credentials.local.md`), `**/coverage`, `**/.omc`. Verify with `docker run --rm --entrypoint sh <img> -c 'find / -name ".env*" -o -name "*.local.md" 2>/dev/null | grep -v node_modules'` returning nothing, and `docker history --no-trunc` showing no secret values.
- [x] 2.6 Record the final image size in Completion Notes (no target; just evidence).

### Task 3: Liveness and readiness endpoints (AC 5)

- [x] 3.1 New `apps/backend/src/common/system/health.controller.ts`, registered in `SystemModule` (`system.module.ts`). `@Controller('health')`, no auth, `@SkipThrottle()` on the class (Docker/uptime probes poll from one IP; `security.e2e-spec.ts:151` documents the pattern). Leave `/system/health` unchanged (tests and admin dashboard rely on it).
- [x] 3.2 `GET /health/live`: no I/O. Returns `createSuccessEnvelope({ status: 'ok' })`.
- [x] 3.3 `GET /health/ready`: checks in parallel, each with a ~2 s timeout:
  - database: `prisma.$queryRaw\`SELECT 1\`` (inject `PrismaService`; do **not** call `collectMetrics()`)
  - scanner: new `ping()` on the ClamAV adapter (3.4)
  - scheduler: `schedulerHealth.cachedSnapshot()` status (informational: `ok | degraded | disabled`; does not fail readiness, AD-17 asks it to be exposed)
  - 200 → `createSuccessEnvelope({ status: 'ready', checks: { database: 'up', scanner: 'up', scheduler } })`; any of database/scanner down → HTTP 503 with the same `checks` object through the existing error envelope (`HttpExceptionFilter`, `ServiceUnavailableException`). **No** error messages, hostnames, connection strings, counts or stack traces in the body. Log the failure reason server-side only.
  - Cache the computed result for ~5 s (same idea as `SchedulerHealthService.cachedSnapshot`, `SCHEDULER_HEALTH_CACHE_MS`), so an unauthenticated, unthrottled endpoint cannot be used to hammer the DB/clamd. Do not cache a rejected promise.
- [x] 3.4 Add `ping(): Promise<boolean>` to `MalwareScannerPort` (`modules/storage/application/ports/malware-scanner.port.ts`), implement in `clamav-malware-scanner.service.ts` (send `zPING\0`, expect `PONG`, reuse the existing socket/timeout handling and `MALWARE_SCANNER_*` env) and in `stub-malware-scanner.service.ts` (returns `true`). Inject via the exported `MALWARE_SCANNER_PORT` token (`storage.module.ts:81`); import `StorageModule` into `SystemModule` only if that does not create a cycle, otherwise move the controller into the storage-independent spot that does compile and say why.
- [x] 3.5 Tests: `health.controller.spec.ts` (live 200; ready 200; DB down → 503; scanner down → 503; body contains no error text; second call within cache window does not re-query); `clamav-malware-scanner.service.spec.ts` add PING/PONG and timeout → `false`. One e2e in `test/security.e2e-spec.ts` or a new `test/health.e2e-spec.ts` proving `/health/live` is not throttled.

### Task 4: Caddy edge, real client IP across the multi-hop chain (AC 3, 4) **[Q2]**

Why this is not just "trust one hop": the chain is browser → Vercel (`sin1`, external rewrite) → Cloudflare (public API edge) → Caddy → NestJS. Cloudflare's `CF-Connecting-IP` would be **Vercel's egress IP**, so every user would share a few rate-limit buckets (readiness report 2026-09-30 L492). Vercel overwrites `X-Forwarded-For` and sets `x-real-ip` to the real client on non-Enterprise plans, so the client IP must be carried from Vercel, and only trusted when the request provably came from our Vercel deployment.

Recommended design (default for Q2):

- [x] 4.1 **Frontend, `apps/frontend/my-app/proxy.ts`** (Next 16 middleware): for `/api/:path*`, when server-only env `RESCOM_EDGE_KEY` is set, forward with added request headers `x-rescom-edge-key: <RESCOM_EDGE_KEY>` and `x-rescom-client-ip: <x-real-ip>` via `NextResponse.next({ request: { headers } })` (proxy runs before `next.config.ts` rewrites, so the headers reach the external destination). Always delete any incoming `x-rescom-*` first (client spoofing). When the env is unset (local dev), do nothing. Keep the existing pilot-hidden 404 behaviour for its routes untouched: add `"/api/:path*"` to the literal `matcher` and branch on `request.nextUrl.pathname`. Update `tests/pilot-scope.test.mjs` if it pins the matcher to exactly `PILOT_HIDDEN_ROUTES`. `RESCOM_EDGE_KEY` must **never** be `NEXT_PUBLIC_*`.
- [x] 4.2 **New `deploy/Caddyfile`** (AD-23):
  - Global options: `servers { trusted_proxies static {$TRUSTED_PROXY_RANGES}  client_ip_headers X-Rescom-Client-Ip }` so Caddy's `{client_ip}` (and its access log `client_ip`) is the end user only when the TCP peer is Cloudflare. `TRUSTED_PROXY_RANGES` defaults in `.env.prod.example` to the published Cloudflare IPv4+IPv6 list (https://www.cloudflare.com/ips/), with a comment on refreshing it. No Caddy plugins (stock `caddy:2` image only).
  - Site `{$API_DOMAIN}` with `tls /certs/origin.pem /certs/origin-key.pem` (Cloudflare Origin CA cert for SSL mode Full (strict); files mounted read-only from `deploy/certs/`, gitignored, created in Story 11.2).
  - `handle /health/*` → `reverse_proxy api:4000` without the key (uptime monitor and Story 11.3 smoke go through the edge).
  - Everything else: matcher `@edge header X-Rescom-Edge-Key {$EDGE_KEY}`; non-matching → `respond 403`. Matching → `reverse_proxy api:4000 { header_up X-Forwarded-For {client_ip}  header_up -X-Rescom-Edge-Key  header_up -X-Rescom-Client-Ip }`. With `TRUST_PROXY_HOPS=1`, Express `req.ip` = that single XFF entry = the real client, so the existing throttler and logs need **no code change**.
  - `request_body { max_size 10MB }` (uploads go straight to storage via presigned URLs; API bodies are small). `log { output stdout format json }`.
- [x] 4.3 `deploy/.env.prod.example` comment block replaces the old CF-Connecting-IP text: document the chain, `EDGE_KEY` (= Vercel's `RESCOM_EDGE_KEY`, `openssl rand -hex 32`, rotate both together), `TRUSTED_PROXY_RANGES`, `TRUST_PROXY_HOPS=1` ("never raise").
- [x] 4.4 **AD-23 amendment**: add a dated amendment under AD-23 in `ARCHITECTURE-SPINE.md` replacing "Caddy restores the client address from `CF-Connecting-IP`" with the chain above (Vercel `x-real-ip` → `x-rescom-client-ip` + edge key → Cloudflare → Caddy `client_ip_headers`/`header_up X-Forwarded-For {client_ip}` → NestJS `TRUST_PROXY_HOPS=1`). This closes readiness-report finding L492-493. Owner: Quan (solo owner of all roles; record the name, do not block).
- [x] 4.5 Evidence (local, Task 9): with a fake peer range, a request without the key → 403; with key + `X-Rescom-Client-Ip: 203.0.113.7` → backend `req.ip` is `203.0.113.7` (assert through the auth throttle bucket or a log line); with key + a forged `X-Forwarded-For: 1.2.3.4` from the client → ignored. Staging proof through real Vercel + Cloudflare belongs to Story 11.2/IR.6; list it there as an open check in Completion Notes.

### Task 5: AD-23 production compose (AC 2, 3)

- [x] 5.1 New `deploy/docker-compose.prod.yml` with exactly three services:
  - `caddy`: `caddy:2-alpine` pinned to a fixed version tag (no floating `2-alpine` in prod), `restart: unless-stopped`, ports `80:80`, `443:443`, `443:443/udp`, mounts `./Caddyfile:ro`, `./certs:/certs:ro`, `caddy_data`, `caddy_config` (certificate/state only), env `API_DOMAIN`, `EDGE_KEY`, `TRUSTED_PROXY_RANGES`; healthcheck `wget -qO- http://127.0.0.1:2019/config/ >/dev/null` (admin API, loopback) or equivalent; `depends_on: api: condition: service_healthy`.
  - `api`: `image: ${API_IMAGE:-ghcr.io/qxh1145/rescom-api}:${API_TAG:?}` plus `build:` (context `..`, `deploy/backend.Dockerfile`) so it builds locally; `env_file: .env.prod`; **no published ports** (Caddy reaches `api:4000` on the compose network); `restart: unless-stopped`; healthcheck = the image's `/health/live`; `depends_on: clamav: condition: service_healthy`.
  - `clamav`: `clamav/clamav-debian` pinned to a fixed version tag, `CLAMD_CONF_StreamMaxLength: 100M` (IR.5 C4/DF9, keep), the existing `clamdcheck.sh` healthcheck with `start_period: 360s`, no published ports, volume `clamav_data` (signature cache only; re-downloadable, not business data).
  - No `postgres`, `minio`, `frontend` services; no other volumes. Header comment: database = Cloud SQL private IP via `DATABASE_URL`, storage = GCS S3 interop via `STORAGE_*`, frontend = Vercel.
- [x] 5.2 New `deploy/.env.prod.example` for AD-23: `API_DOMAIN`, `API_IMAGE`, `API_TAG`, `EDGE_KEY`, `TRUSTED_PROXY_RANGES`, `DATABASE_URL` (Cloud SQL private IP, add `sslmode=require` per Story 11.2), `STORAGE_ENDPOINT=https://storage.googleapis.com`, `STORAGE_REGION=auto` or `asia-southeast1` (whichever the Task 7 run proves), `STORAGE_FORCE_PATH_STYLE=true`, HMAC key placeholders, `MALWARE_SCANNER_HOST=clamav`, and the backend variables already in the internal example (copy, do not invent: `SCHEDULER_ENABLED=true`, `TRUST_PROXY_HOPS=1`, `AUTH_RATE_LIMIT_*`, `FRONTEND_ORIGINS=https://app.rescom.com.vn`, OAuth URLs under `app.rescom.com.vn/api/...`, SMTP, `TOPUP_*`, `ABUSE_CONTROL_PROFILE=REDIS_DISABLED_SINGLE_REPLICA`, `PARTICIPATION_RATE_LIMIT_POLICY_VERSION`). Placeholders must start with `CHANGE_ME` so `env.schema.ts:467-484` refuses to boot with them. Header says: file mode 600 on the VM, never committed (NFR-ADD-3).
- [x] 5.3 `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod.example config` must render without errors (with a dummy `API_TAG`).

### Task 6: Scheduler single-owner verification (AC 6)

- [x] 6.1 No code change expected. Confirm and record in Completion Notes: one `api` replica, `SCHEDULER_ENABLED=true` in the prod example, production refuses `false` (`env.schema.ts:415-420`), all claims go through `scheduler_job_leases` (`prisma-job-lease.repository.ts`), and `docker compose run --rm api npx prisma migrate deploy` does not boot Nest (so it starts no second scheduler). Cite the existing passing suites: `test/scheduler.e2e-spec.ts`, `test/scheduler.prisma.e2e-spec.ts` (needs `SCHEDULER_TEST_DATABASE_URL`, DB name ending `_test`/`_check`).
- [x] 6.2 `/health/ready` exposes `checks.scheduler` (Task 3.3), which satisfies AD-17's "worker-backlog state" without counts.

### Task 7: GCS S3-interop evidence (AC 7)

- [ ] 7.1 Run the existing real-storage suite `test/file-storage.real.e2e-spec.ts` (or, if it is hard-wired to MinIO/ClamAV, a minimal script under `apps/backend/src/scripts/` that uses `S3ObjectStorageService` to presign PUT, `fetch` PUT a small file, presign GET, download and compare SHA-256, then delete) against **both** local MinIO and a GCS bucket via `https://storage.googleapis.com` with an HMAC key. Use the production adapter unchanged; only env differs.
- [ ] 7.2 GCS needs a bucket + HMAC key (Story 11.2 provisions the real ones). Quan can create a throwaway bucket in the trial project for this run; the bucket must be private, and its CORS must allow `PUT`/`GET` from the test origin only. If no GCS bucket is available, leave this subtask unchecked, move the story to `review` with the blocker named, and do **not** claim AC 7.
- [ ] 7.3 Record in Completion Notes: endpoint, region value used, path-style setting, both results, and that no `x-amz-checksum-*` parameter appears in the presigned PUT.

### Task 8: Portability guard (AC 9, 8)

- [x] 8.1 Add one test to `apps/backend/test/architecture.spec.ts`: read every `package.json` under `apps/` and `packages/` (skip `node_modules`) and fail if any dependency name starts with `@google-cloud/`. Also fail if `apps/backend/src` imports `@google-cloud/`.
- [x] 8.2 AC 8: confirm the pins in `docker-compose.yml` (lines with `pgsty/minio` and `pgsty/mc`) and record it. No change.

### Task 9: Local proof and regression (all ACs)

- [x] 9.1 Build: `docker build -f deploy/backend.Dockerfile -t rescom-api:local .` succeeds; `docker run --rm rescom-api:local id -u` prints a non-zero uid.
- [x] 9.2 Boot the prod compose locally against the local dev Postgres/MinIO (`docker compose up -d postgres minio minio-init` from the root file; point `DATABASE_URL`/`STORAGE_ENDPOINT` at `host.docker.internal`), with a self-signed cert in `deploy/certs/` and `TRUSTED_PROXY_RANGES` set to the docker bridge range for the test. Run `docker compose run --rm api npx prisma migrate deploy` first (proves the CLI is in the image). Then:
  - `docker compose ps` shows all three services `healthy`.
  - `curl -k --resolve $API_DOMAIN:443:127.0.0.1 https://$API_DOMAIN/health/ready` → 200 with `database: up, scanner: up`; `docker compose stop clamav` → 503, body without error text; start it again.
  - Task 4.5 edge-key and client-IP checks.
- [x] 9.3 Internal stack still renders: `docker compose -f deploy/docker-compose.internal.yml --env-file deploy/.env.internal.example config`.
- [x] 9.4 `npm run verify` at the repo root passes (build, typecheck, lint, all unit tests incl. frontend `tests/*.mjs` after the proxy change).
- [x] 9.5 Save command outputs (trimmed) under `_bmad-output/implementation-artifacts/11-1-evidence/` for the G4/G5 reviews (Story 11.4, IR.6). No secrets in the evidence.

### Review Findings

Code review 2026-10-03 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 1 decision-needed, 9 patch, 2 defer, 4 dismissed.

- [x] [Review][Decision] Missing `x-real-ip` silently collapses users into the Cloudflare peer's rate-limit bucket — RESOLVED 2026-10-03: fail closed with HTTP 400 (`respond "Missing client IP" 400`). Rationale: failing open silently maps all users behind Cloudflare to a shared IP bucket (`remote_ip`), creating severe risk of platform-wide collateral rate limiting under `AppThrottlerGuard` (`AUTH_RATE_LIMIT_MAX_REQUESTS=60`). Failing closed protects user isolation and immediately alerts operators to upstream header misconfigurations. Tested in Caddy routing and evidence 03.
- [x] [Review][Patch] Caddy responds 400 when keyed request lacks X-Rescom-Client-Ip [deploy/Caddyfile:41]
- [x] [Review][Patch] Scheduler status runs outside the 2 s probe timeout, so a hung DB hangs `/health/ready` instead of returning 503 [apps/backend/src/common/system/health.controller.ts:79]
- [x] [Review][Patch] ClamAV `ping()` socket lives for `MALWARE_SCANNER_TIMEOUT_MS` (30 s) after the 2 s probe gives up; give ping its own short timeout [apps/backend/src/modules/storage/infrastructure/clamav-malware-scanner.service.ts:67]
- [x] [Review][Patch] Caddy access log writes full URIs, incl. OAuth `code`/`state` and token query params; filter them [deploy/Caddyfile:20]
- [x] [Review][Patch] `/health/*` block forwards client-supplied `X-Rescom-*` / `X-Forwarded-For` unchanged; apply the same `header_up` hygiene [deploy/Caddyfile:31]
- [x] [Review][Patch] `proxy.ts` tests `startsWith("/api/")` but the matcher also matches bare `/api`, which then falls into the pilot-hidden rewrite [apps/frontend/my-app/proxy.ts:16]
- [x] [Review][Patch] Edge headers delete only two `x-rescom-*` names; spec/AD-23 say drop every client-sent `x-rescom-*` [apps/frontend/my-app/lib/api/edge-headers.ts:19]
- [x] [Review][Patch] AD-23 Rule sentence still says Caddy restores the client from `CF-Connecting-IP`; mark it superseded by the 2026-10-03 amendment [ARCHITECTURE-SPINE.md:201]
- [x] [Review][Patch] `STORAGE_REGION=auto` is unproven until the AC7 GCS run; mark it provisional in the example [deploy/.env.prod.example:76]
- [x] [Review][Patch] Evidence 03 shows clamav `health: starting`, not the claimed "all three healthy"; refresh the stack evidence after the fixes [_bmad-output/implementation-artifacts/11-1-evidence/03-stack-health-edge.txt:3]
- [x] [Review][Defer] Placeholder `EDGE_KEY=CHANGE_ME` is accepted by compose (`:?` rejects only empty) and Caddy; reject placeholder/short keys in the Story 11.3 deploy pre-flight [deploy/.env.prod.example:12] — deferred, belongs to the 11.3 deploy pipeline
- [x] [Review][Defer] GCS S3-interoperability round trip unverified (AC 7) — deferred to Story 11.2 (needs GCP bucket + HMAC credentials) [11-1-deployment-ready-backend-packaging.md:123-127]

## Dev Notes

### Scope guard

- In: image, AD-23 compose, Caddyfile, health endpoints, edge-key client-IP chain (backend config + Next proxy + Caddy), env examples, AD-23 amendment, evidence.
- Out: provisioning GCP/Cloudflare/Vercel (11.2), GitHub Actions, GHCR push, release manifest, deploy/rollback scripts (11.3), Sentry, uptime monitor, alerts (11.4). Redis, worker container, AI host, Tailscale stay out (AD-23 Deferred). Do not add `@nestjs/terminus` (two endpoints are a few lines; no new dependency).
- Do not change `TRUST_PROXY_HOPS` semantics, the throttler, or add any code that reads `X-Forwarded-For`/`CF-Connecting-IP` in NestJS: `req.ip` stays the single source.

### Architecture constraints

- AD-23: portable interfaces only (Docker image, PG connection string, S3 API through the storage port, env vars). No `@google-cloud/*`, no in-code Secret Manager, no mandatory Cloud SQL Auth Proxy. No business data on the VM disk: a lost VM is replaced by redeploying the image.
- AD-5 amendment: one API replica runs the scheduler in-process; dedicated worker returns only with Epic 10, a second replica or measured contention.
- AD-17: readiness exposes DB and worker-backlog state without sensitive payloads. Environments are isolated (staging gets its own DB, bucket, OAuth client, `EDGE_KEY`).
- AD-10: Outbox claims stay in PostgreSQL (unchanged).
- NFR-ADD-3: secrets only in the VM `.env` (mode 600) and GitHub Actions secrets. NFR-ADD-4: health bodies leak nothing.
- Canonical origin is `app.rescom.com.vn` (IR.1 decision 3). OAuth callback is same-host `app.rescom.com.vn/api/auth/google/callback`; the Next rewrite strips `/api` (`next.config.ts`: `/api/:path*` → `${RESCOM_API_URL}/:path*`), so the backend sees `/auth/google/callback`. The backend has no global prefix (`main.ts`), so Caddy forwards paths unchanged.

### Key code locations

- `apps/backend/src/main.ts` (trust proxy, no global prefix)
- `apps/backend/src/common/config/env.schema.ts` (prod refusals L393-622; `TRUST_PROXY_HOPS` L127; `SCHEDULER_ENABLED` L203; storage L323-328; scanner L329-336)
- `apps/backend/src/common/system/{system.controller.ts,system.module.ts}`; `common/scheduler/scheduler-health.service.ts` (`cachedSnapshot`)
- `apps/backend/src/modules/storage/infrastructure/{s3-object-storage.service.ts,clamav-malware-scanner.service.ts,stub-malware-scanner.service.ts}`; port `application/ports/malware-scanner.port.ts`; `storage.module.ts` exports `MALWARE_SCANNER_PORT`
- `apps/backend/src/common/http/response.envelope.ts` (`createSuccessEnvelope`), `http-exception.filter.ts`
- `apps/frontend/my-app/{proxy.ts,next.config.ts,lib/pilot-scope.ts,tests/pilot-scope.test.mjs}`
- `deploy/*`, root `.dockerignore`, `.gitignore`

### Gotchas from earlier stories

- IR.5: clamd's default `StreamMaxLength` (25M) is below the 50 MB upload limit; keep `100M` in every compose file.
- IR.5 E3.2: `TRUST_PROXY_HOPS=1`, and the untracked `deploy/.env.prod` on Quan's disk still has `2` (internal VPS). Do not edit that file; mention it.
- IR.2b: scheduler never runs under `NODE_ENV=test`; PG suites refuse DB names not ending `_test`/`_check`.
- The S3 checksum fix exists because SDK ≥3.729 adds a CRC32 of the empty body to presigned PUTs, which breaks browser uploads (MinIO and GCS). Do not "simplify" it away.
- `npm run build` at the root also builds the frontend with `--webpack` (see memory note: webpack bundle check gotcha in IR.5).
- Prisma 6.0.0 with no `binaryTargets`: fine because `prisma generate` runs inside the Debian image. Do not switch the runtime base to Alpine (musl would need `binaryTargets`).

### Testing standards

- Backend unit: Jest, `src/**/*.spec.ts` (`apps/backend/jest.config.js`); e2e: `npm run test:e2e --workspace backend` (`test/jest-e2e.json`, runInBand). Frontend: node test runner `tests/*.mjs`. Root gate: `npm run verify`.
- One runnable check per non-trivial piece: health controller spec, scanner ping spec, architecture guard, Next proxy header test. Docker/Caddy behaviour is proven by the Task 9 evidence commands, not by new test frameworks.

### Latest technical notes (checked 2026-10-03)

- AWS SDK v3 `requestChecksumCalculation`/`responseChecksumValidation: 'WHEN_REQUIRED'` is the documented setting for S3-compatible stores such as GCS ([AWS SDK data integrity](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html)).
- Vercel overwrites `X-Forwarded-For` behind proxies and exposes the client as `x-real-ip` / `x-vercel-forwarded-for`; custom XFF trust is Enterprise-only ([Vercel request headers](https://vercel.com/docs/headers/request-headers)). Hence the edge-key design.
- Next 16 renamed `middleware.ts` to `proxy.ts` (already used here); request-header overrides via `NextResponse.next({ request: { headers } })` apply before `next.config` rewrites.
- Caddy 2 `servers { trusted_proxies static …; client_ip_headers … }` and the `{client_ip}` placeholder are stock features (no plugin).

### Project Structure Notes

- Deploy assets stay in `deploy/`; no new top-level folders. Evidence in `_bmad-output/implementation-artifacts/11-1-evidence/` (same pattern as `ir-5-g3/`).
- The epic text says "a multi-stage `Dockerfile`"; the file keeps its existing name `deploy/backend.Dockerfile` (one Dockerfile, already referenced by both stacks).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 11.1]
- [Source: ARCHITECTURE-SPINE.md#AD-23, #AD-5 amendment, #AD-17, #AD-10]
- [Source: implementation-readiness-report-2026-09-30.md L492-493]
- [Source: ir-1-pilot-contract-inventory-2026-10-02.md section 3 items 10, 14; decision 3]
- [Source: ir-5-launch-domain-closure-local-integration-gate.md E3.2]

## Open Questions (owner: Quan; defaults assumed by Tasks)

- **[Q1] Keep the internal-testing VPS stack?** Default: yes, renamed to `docker-compose.internal.yml` / `Caddyfile.internal` / `.env.internal.example`, while `docker-compose.prod.yml` becomes the AD-23 stack the epic names. Alternative: delete the internal stack once staging exists (then drop Task 1.1-1.2 and `frontend.Dockerfile`/`backup.sh`).
- **[Q2] Client-IP trust across Vercel → Cloudflare → Caddy.** Default: the edge-key design in Task 4 plus the AD-23 amendment. Alternatives: (a) accept the shared Vercel-egress bucket and raise auth limits (weak, R07); (b) move browser `/api` traffic to an `api.` host (breaks AD-20 host-only cookies and the same-origin design, not recommended).
- **[Q3] GCS test bucket for AC 7** before Story 11.2: create a throwaway private bucket in the trial project, or accept AC 7 staying open until 11.2.

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (lead: deploy files, Dockerfile, Caddy, frontend proxy, evidence); Claude Sonnet executor (Task 3 health endpoints + scanner ping, Task 8 guard test).

### Debug Log References

- Runtime stage `npm ci --omit=dev --ignore-scripts` still ran the `@rescom/schemas` workspace `prepare` (tsc → exit 127), and `npm rebuild prisma` did the same. Fix: `npm pkg delete scripts.prepare --workspace @rescom/schemas` in the runtime stage; Prisma packages (engines skipped by --ignore-scripts) and the generated client are copied from the build stage instead of regenerated.
- First smoke run showed Caddy's JSON access log recording request headers, including `X-Rescom-Edge-Key`. Added a `format filter` that deletes the edge key, Cookie, Authorization and Set-Cookie. Re-verified: `edge_key_logged: False` (evidence 05).
- `ping()` returns `false` rather than throwing, so a down scanner was not logged; the readiness probe now logs `failed: unreachable` server-side (evidence 05).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created (2026-10-03).
- Open questions Q1-Q3 ran on their defaults (owner Quan; solo owner, recorded, not blocking).
- **AC 1:** multi-stage `deploy/backend.Dockerfile` (`node:22-bookworm-slim`, runs as `node`/uid 1000, no migrate-on-start, HEALTHCHECK on `/health/live` via Node `fetch`). `prisma` 6.0.0 moved to `dependencies` so `docker compose run --rm api npx prisma migrate deploy` uses the same image. Secret scan of the image and `docker history` are clean; size 607 MB (linux/arm64 local build; CI in 11.3 builds amd64). Evidence 01, 02.
- **AC 2, 3:** new `deploy/docker-compose.prod.yml` (`name: rescom-pilot`) with only `caddy` (2.11.6-alpine), `api` and `clamav` (1.5.4), all `restart: unless-stopped` with healthchecks. The api publishes no port. The only volumes are Caddy state and the ClamAV signature cache. No frontend, DB or object store on the VM. The internal-testing stack was renamed to `docker-compose.internal.yml` / `Caddyfile.internal` / `.env.internal.example`; it keeps migrate-on-start through a `command` override. Local smoke: all three services healthy, port 4000 not reachable from the host (evidence 03).
- **AC 4:** edge-key design implemented as specified (`proxy.ts` + `lib/api/edge-headers.ts`, `deploy/Caddyfile`, AD-23 amendment 2026-10-03 in ARCHITECTURE-SPINE.md). Local proof: no or wrong key → 403; valid key → reaches NestJS. Keyed request missing client IP fails closed with HTTP 400 (`respond "Missing client IP" 400`) to prevent collapsing callers into Cloudflare peer IP. The auth bucket keys on `X-Rescom-Client-Ip` (61st request from 203.0.113.7 → 429, while 203.0.113.8 → 401). A forged client `X-Forwarded-For` is ignored. Caddy logs `client_ip=203.0.113.8` with `remote_ip` = peer (evidence 03-05). **Still open:** proof through real Vercel + Cloudflare, i.e. that the Next proxy headers survive Vercel's external rewrite and that Vercel's `x-real-ip` is the client. That belongs to Story 11.2/IR.6.
- **AC 5:** `GET /health/live` and `GET /health/ready` (database `SELECT 1`, ClamAV `PING`, informational scheduler status; 2 s per-check timeout; 5 s result cache; all throttle buckets skipped). Scanner stopped → 503 with only `{database, scanner, scheduler}` and no error text (evidence 05). Deviation: the controller is `['health','api/health']`, because the existing architecture test requires every controller to register an `api/` twin.
- **AC 6:** no code change; verified (evidence 07). `/health/ready` exposes `checks.scheduler`.
- **AC 7: NOT CLAIMED.** The `WHEN_REQUIRED` config is in place. The new `src/scripts/storage-smoke.ts` (presign PUT → PUT → presign GET → SHA-256 compare → delete, through the unchanged `S3ObjectStorageService`) passes against local MinIO, both on the host and inside the production image with `NODE_ENV=production`, with no checksum parameters in the presigned PUT (evidence 06). The Google Cloud Storage run is blocked on a bucket + HMAC key (Q3). Tasks 7.1-7.3 stay unchecked until Quan provides one; the command is in evidence 06.
- **AC 8:** already pinned (pgsty fork by tag + digest); verified (evidence 08).
- **AC 9:** no `@google-cloud/*`; guard test added to `test/architecture.spec.ts` (evidence 08).
- Tests: `npm run verify` exit 0 (schemas 620, backend 2289 in 150 suites, frontend 770). e2e health/security/scheduler/file-storage/auth-throttling: 35/35 passing (evidence 09).
- Additions beyond the task text, each small and needed for the evidence: `API_ENV_FILE` override of the api `env_file`, so local smoke runs never load the real `deploy/.env.prod`; Caddy log redaction; `storage-smoke.ts` (the alternative Task 7.1 allows).
- For Quan: the untracked `deploy/.env.prod` on your disk (internal VPS, `TRUST_PROXY_HOPS=2`) was not touched. On the internal VPS run `mv deploy/.env.prod deploy/.env.internal` and update the `rescom` alias; this is in the README header.
- Smoke resources were removed afterwards: the `rescom-smoke` compose project with its volumes, the scratch DB `rescom_pkg_check` and role, the MinIO user `rescompkg`, and the self-signed `deploy/certs/`.

### File List

- `.dockerignore` (modified)
- `.gitignore` (modified)
- `apps/backend/package.json` (modified: prisma → dependencies)
- `package-lock.json` (modified)
- `apps/backend/src/common/system/health.controller.ts` (new)
- `apps/backend/src/common/system/health.controller.spec.ts` (new)
- `apps/backend/src/common/system/system.module.ts` (modified)
- `apps/backend/src/modules/storage/application/ports/malware-scanner.port.ts` (modified)
- `apps/backend/src/modules/storage/infrastructure/clamav-malware-scanner.service.ts` (modified)
- `apps/backend/src/modules/storage/infrastructure/clamav-malware-scanner.service.spec.ts` (modified)
- `apps/backend/src/modules/storage/infrastructure/stub-malware-scanner.service.ts` (modified)
- `apps/backend/src/scripts/storage-smoke.ts` (new)
- `apps/backend/test/health.e2e-spec.ts` (new)
- `apps/backend/test/architecture.spec.ts` (modified)
- `apps/frontend/my-app/proxy.ts` (modified)
- `apps/frontend/my-app/lib/api/edge-headers.ts` (new)
- `apps/frontend/my-app/tests/edge-headers.test.mjs` (new)
- `apps/frontend/my-app/tests/pilot-scope.test.mjs` (modified)
- `apps/frontend/my-app/.env.example` (modified)
- `deploy/backend.Dockerfile` (rewritten)
- `deploy/docker-compose.prod.yml` (new, AD-23)
- `deploy/Caddyfile` (new, AD-23)
- `deploy/.env.prod.example` (new, AD-23)
- `deploy/docker-compose.internal.yml` (renamed from docker-compose.prod.yml, modified)
- `deploy/Caddyfile.internal` (renamed from Caddyfile)
- `deploy/.env.internal.example` (renamed from .env.prod.example, modified)
- `deploy/backup.sh` (modified)
- `deploy/README.md` (modified)
- `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` (AD-23 amendment)
- `_bmad-output/implementation-artifacts/11-1-evidence/01-image.txt` … `09-tests.txt` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

### Change Log

- 2026-10-03: Story 11.1 implemented. Multi-stage non-root image; AD-23 three-service compose and Caddyfile; edge-key client-IP chain with AD-23 amendment; liveness/readiness endpoints; portability guard; MinIO storage smoke. Internal VPS stack renamed. AC 7's GCS run is pending a bucket (Q3).
