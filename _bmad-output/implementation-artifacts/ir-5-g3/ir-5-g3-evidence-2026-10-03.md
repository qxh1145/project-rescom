# IR.5 G3 evidence pack: local integration gate (2026-10-03)

Story: `ir-5-launch-domain-closure-local-integration-gate.md`. Owner: Quan (solo owner of every IR role).

## 1. Build under test

- Base commit `1a8911c` (develop) plus the uncommitted IR.5 working-tree diff (File List in the story). Section 9 records the commit that holds this diff.
- Node v22.18.0. Next 16.3.0. NestJS backend via `ts-node` (`npm run start:dev`).
- docker compose services:

| Container | Image | Health |
| --- | --- | --- |
| rescom_postgres | `postgres:15-alpine` (:5433) | up |
| rescom_minio | `pgsty/minio:RELEASE.2026-08-04T00-00-00Z@sha256:b6bfe723…` | healthy |
| minio-init | `pgsty/mc:RELEASE.2026-09-16T00-00-00Z@sha256:cfc83108…` | one-shot, bucket private |
| rescom_clamav | `clamav/clamav-debian:stable`, `StreamMaxLength 100M` | healthy (new `clamdcheck.sh` healthcheck) |

- Scratch databases (none is `rescom_db`):
  - `rescom_ir5_check`: journey.
  - `rescom_storage_test`: real storage.
  - `rescom_ir5_seed_clone`: a fresh `pg_dump rescom_db` clone for the seeded-clone suite. `rescom_db` is only read.
  - `rescom_ledger_test`: Story 6.1 Postgres block.
  - The per-suite `rescom_*_test` databases.

## 2. Gate commands and raw results

| # | Command (cwd) | Result |
| --- | --- | --- |
| 1 | `npx jest` (apps/backend) | 149 suites, 2278 tests passed, 0 failed |
| 2 | `CI=1 STORAGE_REAL_TEST=1 RUN_LEDGER_POSTGRES_E2E=true DATABASE_URL=…/rescom_ledger_test SCHEDULER_SEED_CLONE_DATABASE_URL=…/rescom_ir5_seed_clone npm run test:e2e` (apps/backend) | **60/60 suites, 498/498 tests passed, 0 skipped, 0 failed** |
| 2a | the PG suites inside run 2 (`*.prisma.e2e-spec.ts`) | 17/17 suites passed. `CI=1` makes an unreachable DB fail instead of skip, so 0 were skipped |
| 2b | real-storage suite inside run 2 (`file-storage.real.e2e-spec.ts`) | 6/6 passed (C5.1–C5.6) |
| 3 | `npm run typecheck` / `npm run lint` (apps/backend) | clean / clean (after repair loop 1; the verifier's first run found 1 prettier error, see section 9) |
| 4 | `npm test` (apps/frontend/my-app) | 767 tests, 767 pass, 0 fail, 0 skipped (after repair loop 1; first run 766) |
| 5 | `npm run typecheck` / `npm run lint` (apps/frontend/my-app) | 0 errors / 0 problems |
| 6 | `NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled npm run build` (Turbopack) **and** `… npx next build --webpack` (the bundler `deploy/frontend.Dockerfile` ships) (apps/frontend/my-app) | exit 0 for both. The output lists `ƒ Proxy (Middleware)` |
| 7 | `node scripts/check-pilot-bundle.mjs` (apps/frontend/my-app) | Turbopack: ok, 100 files. **Webpack: ok, 125 files, after repair loop 1.** Before the fix, the webpack build shipped MSW chunks; see section 9. Negative control: a hybrid webpack build fails the check (exit 1) |
| 8 | `node --no-warnings scripts/ir5-journey.mjs` (repo root, runbook in section 4) | **PASS**: 44/44 journey steps, 36/36 routes, on both the Turbopack and the webpack pilot build. The committed report is from the webpack run |
| 9 | `node apps/frontend/my-app/scripts/contract-matrix.mjs` | wrote `contract-matrix.md` (section 3) |

Counts compared with IR.3/IR.4 (31 PG tests): run 2 is the first full e2e run with every opt-in enabled. It includes `product-tours`, `admin-missing-code-reports`, the seeded-clone suite and the Story 6.1 Postgres block.

## 3. Contracts (AC 1): contract matrix

The generated `contract-matrix.md` sits in this folder; its counts are not hand-edited. Distinct frontend calls: **101**, of which **83 matched** a backend route, **18 allowlisted** with a reason, and **0 unmatched**. `tests/contract-callsites.test.mjs` enforces this. Since repair loop 1 it also requires **every one of the 83 matched calls to be called by at least one backend e2e spec**: 83/83, shown in the matrix's spec column. The scanner now reads harness helpers such as `get(admin, '/x')`, `send('post', '/x')` and `${prefix}/x`. An allowlist entry fails if no call site uses it, or if the backend now serves the path.

- `deferred-hidden` (14 entries) must equal `ROUTE_ALLOWLIST.DEFERRED_KEEP_MOCK` exactly. These cover disputes, quality, AI builder, engagement and trust.
- `out-of-api` (4 entries):
  - `POST /auth/google/mock-complete` and `GET /mock/demo-accounts`: mock-only, gated by `isApiMockingEnabled`, which is forced off in the pilot.
  - The presigned `PUT`: object storage, outside `/api`.
  - `HEAD <page-url>`: the offline probe.

Frontend-only ASSUMED fields from Q2 were removed (A2):

- Manage: `pausedAt`, `hiddenFromMarketplace`, `audienceLabel`, top-level `publishedAt`, `questionCount`.
- Results: the version stats.
- Wallet: `surveyTitle`.

Publisher, version and wallet schemas are now the shared `@rescom/schemas`, or pure `.extend` of them. `ledger.e2e` parses the real wallet with `walletDetailsSchema`. `grep "ASSUMED API"` in `lib|app|components` now matches deferred-scope files only:

- AI builder: `builder-service`, `builder-ai`, `ai-thinking`, `ai-reveal`, `AiChatScreen`.
- `results-service` (quality row only).
- `dispute-service`, `admin/disputes-service`, `admin/quality-service`.
- `engagement-service`, `leaderboard-service`, `trust-service`.

## 4. Journeys (AC 4): D1 report

The full table is in `ir5-journey-report.md` / `.json` in this folder. It has no passwords, cookies, tokens or seed credentials: passwords are random and kept in memory only.

Runbook:

1. Start the stack: `docker compose up -d postgres minio minio-init clamav`.
2. Create and migrate the scratch DB: `createdb rescom_ir5_check` and `prisma migrate deploy`.
3. Backend: `.claude/launch.json` → `backend-ir5-check`. It runs `DATABASE_URL=…/rescom_ir5_check` with `AUTH_RATE_LIMIT_MAX_REQUESTS=60` on :4000.
4. Pilot frontend: build it (gate row 6), then `frontend-pilot` (`next start` with pilot flags and `RESCOM_API_URL=http://localhost:4000`) on :3000.
5. Run the journey: `node --no-warnings scripts/ir5-journey.mjs`.

Every API call goes through `http://localhost:3000/api/*` (the Next rewrite), with browser-like cookies, CSRF and `Origin`.

- **Respondent (D1.1):**
  - Steps: register → CSRF → demographics onboarding → feed (contains the survey) → summary → start attempt → pinned read (`formVersionId` = the published version) → upload initiate → presigned PUT to MinIO (200) → finalize, which ClamAV scans to **CLEAN** → wait 16 s for the 15 s barrier → submit → same-key replay → outcome → wallet → notifications.
  - Submit returns `VALIDATED`, reward `SETTLED`. The same-key replay returns the **same journal id**. The outcome is `COMPLETED`.
  - Wallet: available 110 (starter points plus 10), pending 0. An internal reward settles directly; pending applies to External surveys and is covered by `respondent-journey.prisma` (f).
  - Notifications: 2.
- **Publisher + two admins (D1.2):**
  - Admin A's own top-up → admin A's approve is refused with **403 `TOPUP_SELF_REVIEW_FORBIDDEN`**.
  - The publisher's top-up → admin A approves (200) → a replay returns `replayed: true`.
  - Create an internal form (text + `file_upload`) → publish with escrow → `MODERATION_QUEUE` → admin B approves moderation.
  - `GET /admin/ledger/journals`: 200.
  - SQL: exactly one `publish:`, `internal-reward:` and `topup-approval:` journal each, all zero-sum. Ledger invariants on the whole scratch DB: `{unbalancedJournals:0, driftedAccounts:0, negativeUserAccounts:0, duplicateKeys:0}`.
- Every API response carries an `X-Request-Id` (C1), and the report records it per step.
- Concurrency and race results are proven by the PG suites in run 2:
  - `respondent-journey.prisma`: parallel start, quota race, 5 parallel submits.
  - `financial-publisher.prisma`: raced publish, two admins approving concurrently, autosave race.
  - `moderation.prisma`.

## 5. Upload, fail-closed, correlation (AC 3)

- Presign, private upload, scan and finalize run on the real stack. The `file-storage.real` suite covers:
  - Presign, signed PUT, finalize, `CLEAN` and `verified/`. The owner downloads; another user gets 403.
  - EICAR is `REJECTED` and its bytes are deleted.
  - An anonymous GET on the object URL gets 403.
  - Cleanup removes an expired `INITIATED` object.
- Scanner outage (scanner on a closed port): 503 `STORAGE_SCANNER_OUTAGE`. The row is `QUARANTINED`/`OUTAGE` and the download is 403. The structured log `storage.scan_outage {objectId, requestId, reason}` has `requestId` equal to the response's `X-Request-Id`, and `/system/metrics` `storage.outagesSinceBoot` increments.
- Storage outage (S3 on a closed port): 503 `STORAGE_UNAVAILABLE` (new). The row stays `INITIATED` and finalize stays retryable. The log is `storage.unavailable` with the same request id.
- In-memory equivalents in `file-storage.e2e` (C6) run in CI without Docker.
- "Alertable" (Q4): a structured error log event plus a `/system/metrics` counter, correlated by `X-Request-Id`, which is also in the error envelope (`error.requestId`, additive). Sentry and uptime wiring is Story 11.4.
- ClamAV readiness (C4): a `clamdcheck.sh` healthcheck in both compose files, and the prod backend `depends_on clamav: service_healthy`. `CLAMD_CONF_StreamMaxLength=100M` is set explicitly; clamd's real default is 25M, so the old comment was wrong.

## 6. Direct mock consumers (AC 2) and hidden scope (AC 5)

- `tests/no-direct-mocks.test.mjs`: no `@/mocks` / `mocks/` / `mockRepository` import in `app|lib|components`. The only exceptions are `MswProvider.tsx` (a dynamic import behind the literal env check) and `lib/api/config.ts`. The detector has a non-vacuity self-test.
- `tests/pilot-scope.test.mjs` (9 tests):
  - Guards must sit in the same enclosing function.
  - The deferred list is derived from `DEFERRED_KEEP_MOCK` (14 routes → 14 services), and `lib/` is scanned.
  - A sweep checks string literals that link to a hidden route.
  - `proxy.ts`'s matcher must equal `PILOT_HIDDEN_ROUTES`.
  - The stricter checks found and fixed two gaps:
    - `BuilderScreen` `regenerate`/`suggestIntoSheet` had no pilot guard.
    - The `ProfileCard` link to `/account/tier` was unguarded.
- **E1 runtime sweep (pilot build, signed in):**
  - All 11 `PILOT_HIDDEN_ROUTES` → **404**.
  - Pilot-visible pages → **200**: 7 respondent, 4 publisher, 7 admin and 6 guest pages.
  - `/dashboard` → 307 to `/marketplace` (a declared redirect).
  - First run finding: 10 of the 11 hidden routes answered **200** with the not-found UI. The app shell starts streaming before the page's `notFound()` throws, so Next cannot change the status any more. Fixed by `apps/frontend/my-app/proxy.ts` (Next 16 Proxy, literal matcher), which rewrites the hidden routes to an unmatched path in pilot builds and so gives a real 404 before any rendering. The page guards stay as the second layer.
- **E2: deferred scope statement.** `sprint-status.yaml` `phase_2_deferred` still lists Epic 3, 4.4, 7.3–7.6, 8.3–8.5, 9.1/9.3–9.5 and Epic 10. `git diff 1a8911c -- sprint-status.yaml` changes only the IR.5 line and `last_updated`; no deferred status moved. The block (statuses only):

```yaml
phase_2_deferred:
  epic-3:            # AI Form Generation Assistant
    3-1-ai-prompt-submission-payload-preparation: review   # unchanged since before IR.5
    3-2-ai-json-generation-ux-loading-states: backlog
    3-3-ai-output-parsing-zod-validation: backlog
    3-4-ai-failure-fallback-isolation: backlog
  epic-4-deferred:
    4-4-public-link-guest-submissions: review                # unchanged; /f/[id] hidden (404) in pilot
  epic-7-deferred:   # 7-3, 7-4, 7-5, 7-6: backlog
  epic-8-deferred:   # 8-3, 8-4, 8-5: backlog
  epic-9-deferred:   # 9-1, 9-3, 9-4, 9-5: backlog
  epic-10:           # 10-1 … 10-8: backlog
```

## 7. Production defaults (IR.1 section 3, "verify at IR.5")

- E3.1: production refuses `SCHEDULER_ENABLED=false` or unset (`env.schema.ts`). Spec: `env.service.spec.ts` "refuses SCHEDULER_ENABLED=false (or unset) in production (IR.5 E3.1)".
- E3.2: `deploy/.env.prod.example` `TRUST_PROXY_HOPS=1`, with the chain documented. The e2e in `auth-throttling.e2e-spec.ts` (trust proxy 1) shows the auth bucket keys on the client IP from `X-Forwarded-For`: spoofed leftmost entries share one bucket, and a different client IP gets its own.
- E3.3: `AUTH_RATE_LIMIT_MAX_REQUESTS=60` and `AUTH_RATE_LIMIT_TTL_SECONDS=60` added to `.env.prod.example` (Q5).
- E3.4 (no change), existing specs in `env.service.spec.ts`:
  - "refuses capture, disabled and an unset mode in production".
  - "requires credentials, HTTPS links and TLS in production".
  - "accepts a valid production configuration".
  - NODE_ENV is `z.enum(['development','test','production'])`, and `deploy/backend.Dockerfile` sets `NODE_ENV=production`.

## 8. Accepted deviations and open owner items

1. **D3, accepted deviation (the story's stop rule).** A revoked-session submit still returns 403 `PARTICIPANT_NOT_ELIGIBLE`. The cause is not guard ordering: `SessionAuthGuard` deliberately treats any invalid session on `@Public()` routes as a guest, and `POST /responses/:id/submit` is public (guest forms). A fix changes public-route semantics for expired tokens too, so it needs a product/design decision. No data risk: the submit is refused either way.
2. **Real `deploy/.env.prod` (not edited)** still has `TRUST_PROXY_HOPS=2` and no `AUTH_RATE_LIMIT_*`, so the default of 10 per 60 s applies. Owner to align it with the example before IR.6 staging.
3. `deploy/Caddyfile` does not restore `CF-Connecting-IP`. That is only relevant if Cloudflare proxying is enabled; the README says DNS-only today. Hops=1 holds because the Next `/api` rewrite forwards `X-Forwarded-For` unchanged.
4. Admin and moderation views still read frontend-only optional fields the backend never emits:
   - users: `name`, `activated`, `signInMethod`, `balance`, `attemptCount`, `fraudLog`, `profile`;
   - top-up: `userName`, `userCreatedAt`;
   - moderation: `publisherName`, `publisherFraudLogCount`, `targetingJson.schools`.

   They render "—" and are labelled `ASSUMED (design) display extensions`. They are outside A2's list; owner to decide whether Q2 extends to them. **AC1 is therefore closed for the Q2 field list only, not for these display fields.** One bare `ASSUMED` comment, a backend TTL assumption, also remains in `lib/auth/session-refresh.ts:23`.
5. `public/mockServiceWorker.js` is still served as a static file in the pilot build. It is never registered without MSW, and the bundle check covers `.next/static` as specified. IR.6 may exclude it.
6. Admin disputes calls are gated by `isHybridMocking` rather than a hidden route. They are allowlisted as `deferred-hidden`, because a pilot build forces hybrid off.
7. The stale `scheduler-seeded-clone` assertion: IR.4b added the `NotificationEmailRequested` handler, but the opt-in suite still expected that type to stay PENDING. Updated to the two subscribed types. This was found because D2 forbids skips.
8. **Owner decision: production `AUTH_RATE_LIMIT_MAX_REQUESTS=60` (Q5 default, E3.3).** Review finding 3: with `TRUST_PROXY_HOPS=1` the auth bucket is per client IP, and no per-account lockout exists, so 60 is 6× looser than the code default of 10 for login, register and reset. It may still be right if campus users share a NAT IP. Owner to confirm 60, or pick 10–20 for prod and keep 60 for local and journey runs only.
9. D1.1 says "wallet pending credit". An internal reward settles directly to `available` (110/0 in the journey), so pending credit applies only to External rewards. That case is proven by `respondent-journey.prisma` (f), not by the D1 journey.
10. Deferred to IR.6:
    - No test uploads a file above clamd's old 25M default, so the effect of `StreamMaxLength=100M` is configured but not exercised.
    - Add a staging smoke with two clients and two IPs to show that hops=1 keys real client IPs through Caddy and the Next proxy. This review confirmed the Next 16.3 rewrite does not add `X-Forwarded-For` (no `xfwd`), but nothing pins that.
11. Process note: the frontend agent ran `git stash`/`pop` once in the shared tree (about 15 s, clean pop). Gate runs 1–9 were all taken after that, on the final tree.

## 9. Independent G3 pass (AC 6, F2)

Both runs were in fresh contexts, on 2026-10-03. Neither agent edited a file.

**Code review: code-reviewer (Sonnet, fresh context), bmad-code-review layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor).** Verdict: **Approve with patches**. No High findings, and no correctness or security defect in the backend changes.

| # | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | Med | The bundle check ran on Turbopack; deploy builds with `next build --webpack` | **Patched, and the defect was real.** The webpack pilot build shipped `msw`/`mockServiceWorker` chunks (2 files), because webpack keeps an `import()` that follows a constant early return. `MswProvider.tsx` now has the `import()` inside the enabled-or-hybrid branch, and `no-direct-mocks.test.mjs` pins that structure. Webpack pilot: clean (125 files). Hybrid control: fails as expected. Journey re-run on the webpack build: PASS |
| 2 | Med | Matrix spec column `—` for matched rows (no passing test shown) | **Patched.** The scanner reads harness and prefix calls, and a new test requires a spec for every matched row: 83/83 |
| 3 | Med | Prod auth limit 60 vs per-IP keying | Owner decision, section 8 item 8 |
| 4 | Low-Med | Admin, top-up and moderation display-only fields | Owner decision, section 8 item 4; the AC1 claim is narrowed |
| 5 | Low | `StreamMaxLength` not exercised by a large upload | Deferred to IR.6 (section 8 item 10) |
| 6 | Low | hops=1 relies on Next not adding `X-Forwarded-For` | Deferred to the IR.6 staging smoke (section 8 item 10) |
| 7 | Low | `auth-throttling` leaves `trust proxy` set; `mocks/` regex edge case; `recordOutage` with a short filename | `trust proxy` now restored (suite 6/6). The other two are dismissed: no baseUrl alias exists, and the short-filename case is a harmless garble |
| 8 | Low | Story record empty; wallet pending not under deviations | Story updated; wallet pending is section 8 item 9 |

**Gate verification: verifier (Sonnet, fresh context).** It re-ran every gate command, rebuilt the seed clone, and used its own journey output directory.

- Reproduced exactly: frontend 766/766, typecheck and lint; journey 44/44 and 36/36; backend unit 149/2278; e2e **60/60 suites, 498/498, 0 skipped**, including 17/17 PG suites, `file-storage.real` and the seeded clone; pilot build and bundle check (100 files); matrix 101/83/18/0; no secrets in the reports.
- **One mismatch: backend lint failed** with a prettier error at `scheduler-seeded-clone.prisma.e2e-spec.ts:165`, which I edited after the pack's lint run. Fixed with `eslint --fix`; the change is whitespace only.
- Per-AC verdicts:
  - AC1: pass with deviation (the matrix spec gap, since patched).
  - AC2–AC5: pass.
  - AC6: fail until the lint fix.
- The verifier judged D3 honestly disclosed: `session-auth.guard.ts:45-67`, `participation.controller.ts:143`, and the pinned `respondent-journey.e2e-spec.ts:376-382`.

**Repair loop 1** (one loop of the two allowed):

- Changes: the lint fix, `trust proxy` restore, the spec-coverage scanner plus a new test, and the `MswProvider` branch plus its test.
- Re-run after it:
  - Frontend `npm test`: 767/767.
  - Typecheck and lint, both apps: clean.
  - `auth-throttling` e2e: 6/6.
  - Turbopack and webpack pilot builds and bundle checks: clean.
  - Journey on the webpack build: PASS.
- The full backend e2e was not re-run. The backend changes in this loop are a whitespace-only lint fix and a test-local `trust proxy` restore, and the affected suite was re-run on its own.

**G3 verdict: PASS with deviations.** The deviations are D3 and owner items 2–6 and 8–10 in section 8. **Targeted re-review of the loop-1 fixes: code-reviewer (Sonnet, fresh context).** Verdict: **Approve**, with 0 Critical, High or Medium findings.

- `MswProvider` behaviour is unchanged for enabled and hybrid. The structure test is not vacuous: the old early-return shape fails it.
- No false positives in the coverage regex. Spot-checked rows really call the route, and every `—` row is an allowlisted one.
- `trust proxy` cannot leak: the app is rebuilt per test.
- The subscribed list equals the two registered handlers.
- Low notes, both dismissed:
  - The spec column means "a spec calls the path", which may be a negative-path call. That matches the AC1 and matrix wording.
  - The guard regex is exact-text by design.
