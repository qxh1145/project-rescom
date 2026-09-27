---
baseline_commit: 378e4a71ff125fb1acf6ee18291fc298ae56bf94
context:
  - "_bmad-output/planning-artifacts/epics.md#Story 6.6"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#4.10 Top-Up (Point Purchase)"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#Cross-Context Financial Workflow Map"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/implementation-artifacts/6-5-frozen-starter-points-lifecycle.md"
  - "_bmad-output/implementation-artifacts/9-6-event-notification-system.md"
  - "_bmad-output/implementation-artifacts/spec-mock-respondent-journey.md"
  - "apps/backend/src/modules/economy/application/ledger.service.ts"
  - "apps/backend/src/modules/participation/application/participation.service.ts"
  - "apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts"
---

# Story 6.6: Point Top-Up Request & Admin Approval

Status: done

## Story

As a User,
I want to top up my balance via bank transfer,
so that I can fund my account to publish surveys.

## Acceptance Criteria

Epic ACs (verbatim intent, `epics.md` Story 6.6):
- Given the Top-Up UI, when the user generates a transfer request, then they are shown a QR code / Bank Info with a unique transfer syntax (FR-34).
- And the request enters a "Pending Payment" state.
- And an Admin can later review this request and click "Approve"; Economy verifies the live capability and idempotently commits approval plus one Ledger journal keyed `topup-approval:{topUpId}`, records actor/correlation, and emits a replayable Moderation admin-audit event (FR-35, AD-16).

PRD consequences folded in (FR-34 / FR-35): minimum 100 Points (= 20,000 VND at 1 Point = 200 VND); request queued for Admin approval; top-up is one-way (no refund / no inter-account transfer); Admin sees pending requests with user info and amount; approval triggers ledger entry **and** user notification; rejection notifies the user **with a reason**.

### AC1 — Shared top-up contract (`packages/schemas`)
1. `packages/schemas/src/economy/top-up.schema.ts` exports:
   - Constants: `POINT_VND_RATE = 200`, `TOP_UP_MIN_POINTS = 100`, `TOP_UP_MAX_POINTS = 50_000`, `TOP_UP_MAX_PENDING_REQUESTS = 3`, `TOP_UP_REFERENCE_PREFIX = 'RESCOM'`, `TOP_UP_REFERENCE_ALPHABET` (32 unambiguous chars, no `0/O/1/I`), `TOP_UP_REFERENCE_CODE_LENGTH = 8`, `TOP_UP_REJECTION_REASON_MIN_LENGTH = 5`, `TOP_UP_REJECTION_REASON_MAX_LENGTH = 500`, `TOP_UP_LIST_DEFAULT_LIMIT = 20`, `TOP_UP_LIST_MAX_LIMIT = 50`.
   - `topUpStatusSchema` = `PENDING | APPROVED | REJECTED` (must equal the Prisma `TopUpStatus` enum). `PENDING` **is** the "Pending Payment" state (UI label "Chờ thanh toán").
   - `createTopUpRequestSchema` (strict): `{ amount: int, min 100, max 50,000 }`.
   - `topUpReferenceSchema`: `^RESCOM[A-HJ-NP-Z2-9]{8}$`.
   - `topUpPaymentInstructionsSchema`: `{ bankName, bankBin (6 digits), accountNumber (6–19 digits), accountName, amountVnd, transferContent, qrPayload }`.
   - `topUpRequestSchema` (owner DTO): `{ id, amount, amountVnd, status, transferReference, rejectionReason|null, createdAt, reviewedAt|null, paymentInstructions|null }` — instructions only for `PENDING`.
   - `adminTopUpRequestSchema` = owner DTO + `{ userId, userEmail|null, adminId|null, journalId|null, correlationId|null }`.
   - `listTopUpRequestsQuerySchema` (query-string tolerant: `limit`, `offset`, optional `status`), `topUpRequestListSchema`, `adminTopUpRequestListSchema` (`{ items, total, limit, offset, hasMore }`).
   - `rejectTopUpRequestSchema` (strict): `{ reason: trimmed string 5–500 }`.
   - `topUpReviewResultSchema`: `{ topUp: adminTopUpRequestSchema, journalId|null, replayed: boolean }`.
   - `topUpAdminAuditEventPayloadSchema` (Moderation consumer contract, `schemaVersion: 1`, `auditCategory: 'MODERATION_ADMIN_ACTION'`, `action: 'TOPUP_APPROVED' | 'TOPUP_REJECTED'`, ids, amounts, reference, `journalId|null`, `ledgerIdempotencyKey|null`, `rejectionReason|null`, `correlationId`, `occurredAt`).
   - Pure helpers: `pointsToVnd(points)`, `buildTopUpReference(randomBytes: Uint8Array)` (byte % 32 → unbiased), `crc16CcittFalse(text)`, `buildVietQrPayload({ bankBin, accountNumber, amountVnd, transferContent })` (EMVCo/NAPAS VietQR string with CRC).
2. Exported from `packages/schemas/src/economy/index.ts`; unit tests in `top-up.schema.spec.ts` (bounds, strictness, reference format, CRC check value `"123456789" → 29B1`, VietQR structure + trailing CRC).

### AC2 — Persistence (`apps/backend/prisma`)
1. `TopUpRequest` gains: `amountVnd Int`, `transferReference String @unique`, `journalId String? @unique @db.Uuid`, `rejectionReason String?`, `correlationId String? @db.Uuid`, `reviewedAt DateTime?`, `updatedAt DateTime @updatedAt`, indexes `(status, createdAt)` and `(userId, createdAt)`. Keeps `id, userId, amount, status, adminId, createdAt`.
2. A hand-written, drift-tolerant migration `apps/backend/prisma/migrations/20260926120000_top_up_requests/migration.sql` (no earlier migration creates `TopUpStatus`/`top_up_requests`, follow the Story 9.6 `IF NOT EXISTS` pattern). `npm run prisma:validate --workspace backend` and `npx prisma generate` pass.

### AC3 — User creates / lists requests (FR-34)
1. `POST /economy/top-ups` (+ `api/` prefix): `SessionAuthGuard` + `CsrfGuard` + `JsonOnlyGuard`, body validated with `createTopUpRequestSchema`; returns `201` + `topUpRequestSchema` with `status: PENDING`, a unique `transferReference` and `paymentInstructions` (bank info from configuration, `amountVnd = amount × 200`, `transferContent = transferReference`, VietQR `qrPayload`).
2. A user may hold at most `TOP_UP_MAX_PENDING_REQUESTS` (3) PENDING requests → otherwise `409 TOPUP_PENDING_LIMIT_REACHED`. Reference collisions are retried (unique index), max 3 attempts.
3. `GET /economy/top-ups` lists only the caller's own requests, newest first, paginated.
4. No ledger movement happens on creation; points are credited only on approval (one-way, no refund/transfer endpoints).

### AC4 — Admin approval: `ApproveTopUp` coordinator (FR-35, AD-16)
1. `GET /admin/top-ups` (+ `api/`): `SessionAuthGuard` + `RolesGuard` + `@Roles('ADMIN')`; filter by `status` (default `PENDING`), oldest first for PENDING (FIFO queue), includes `userEmail` + amount.
2. `POST /admin/top-ups/:id/approve`: `SessionAuthGuard` + `RolesGuard('ADMIN')` + `CsrfGuard`; `ParseUUIDPipe`; optional `X-Correlation-Id` (UUID, else generated).
3. `TopUpService.approveTopUp` runs under `UnitOfWorkPort.run('topup-approval:{topUpId}', …)`:
   a. lock the request row (`SELECT … FOR UPDATE`),
   b. `APPROVED` → return the original result (`replayed: true`), `REJECTED` → `409 TOPUP_ALREADY_REVIEWED`,
   c. re-verify the **live** capability inside the transaction via `AdminCapabilityPort` (`users` row read `FOR SHARE`: role `ADMIN` and status `ACTIVE`), else `403 TOPUP_ADMIN_CAPABILITY_REQUIRED`; an admin cannot approve their own request (`403 TOPUP_SELF_REVIEW_FORBIDDEN`),
   d. post exactly one Ledger journal through `LedgerService.creditApprovedTopUp` keyed `topup-approval:{topUpId}` (`SYSTEM_CLEARING` → user `USER_AVAILABLE`, `amount` points),
   e. conditionally transition `PENDING → APPROVED` (`adminId`, `journalId`, `correlationId`, `reviewedAt`) **and** write an `OutboxEvent` (`eventType: 'AdminTopUpApproved'`, `producer: 'economy-service'`, `aggregateType: 'TopUpRequest'`, `aggregateVersion: 2`, `idempotencyKey: 'admin-audit:topup-approval:{topUpId}'`, `correlationId`, payload = `topUpAdminAuditEventPayloadSchema`) in the same transaction.
   Any failure rolls all of it back. Concurrent/double approvals cannot credit twice (row lock + conditional transition + unique journal key); a lost conditional transition re-reads and returns the winner's result.
4. After commit, publish `TOPUP_SUCCESS` via the optional `NOTIFICATION_PUBLISHER_PORT` (`dedupeKey: 'topup-approval:{topUpId}'`); replays re-publish (deduplicated). Response: `topUpReviewResultSchema`.

### AC5 — Admin rejection (FR-35)
1. `POST /admin/top-ups/:id/reject` (`RolesGuard('ADMIN')` + `CsrfGuard` + `JsonOnlyGuard`, body `rejectTopUpRequestSchema`).
2. Same locking + live-capability + self-review rules, UoW key `topup-rejection:{topUpId}`; `PENDING → REJECTED` with `rejectionReason`, no journal; Outbox `AdminTopUpRejected` (`admin-audit:topup-rejection:{topUpId}`). `REJECTED` replay → original result; `APPROVED` → `409 TOPUP_ALREADY_REVIEWED`.
3. After commit, `WARNING` notification with the reason (`dedupeKey: 'topup-rejection:{topUpId}'`).

### AC6 — Configuration
`env.schema.ts` + `EnvService`: `TOPUP_BANK_NAME` (default `Vietcombank`), `TOPUP_BANK_BIN` (6 digits, default `970436`), `TOPUP_BANK_ACCOUNT_NUMBER` (6–19 digits, default placeholder `0000000000`), `TOPUP_BANK_ACCOUNT_NAME` (default `RESCOM DEMO`). Production refuses the placeholder account number/name. `.env.example` documents them.

### AC7 — Frontend (mock-first + typed live client)
1. `apps/frontend/my-app/app/wallet/top-up-api.ts`: typed live client (`createTopUpRequest`, `listMyTopUpRequests`, and admin `listTopUpRequestsForReview`, `approveTopUpRequest`, `rejectTopUpRequest`) using `formMutationFetch` for CSRF mutations and schema-validated responses.
2. Mock repository (`lib/mock/*`): `getTopUpOptions()`, `createTopUpRequest(amount)`, `getMyTopUpRequests()`; business rules (bounds, pending limit, VND conversion, reference, VietQR payload) live in the repository and reuse the shared helpers/constants. Mock never credits points on creation.
3. New page `app/wallet/top-up/page.tsx` inside `PortalShell`: amount input + presets, live VND conversion, validation messages, submit → "Chờ thanh toán" payment card (bank name, account number, account name, VND amount, transfer syntax with copy buttons, VietQR payload string), request history with status badges and rejection reason; loading/empty/error/retry states; Vietnamese copy; keyboard focus visible; responsive. The existing wallet page gets a "Nạp điểm" link.
4. QR image: **not rendered** (no QR encoder dependency allowed); the VietQR payload string is shown/copyable instead — documented decision.
5. Admin approval UI: **deferred** (Admin portal is deferred in `deferred-work.md` and the human-owned mock spec forbids implementing deferred Admin modules) — record it in `deferred-work.md`.
6. Frontend tests for mock repository behaviour and the live client.

### AC8 — Verification
Schema, backend unit, backend e2e (`apps/backend/test/top-up.e2e-spec.ts` + the **whole** e2e suite), frontend tests, typecheck, lint and `prisma validate` all pass (`verify.sh`).

## Tasks / Subtasks

- [x] **Task 1: Shared schemas** (AC: 1)
  - [x] 1.1 `packages/schemas/src/economy/top-up.schema.ts` (constants, schemas, DTO types, helpers).
  - [x] 1.2 Export from `packages/schemas/src/economy/index.ts`.
  - [x] 1.3 `top-up.schema.spec.ts` (bounds, strict bodies, reference, CRC vector, VietQR payload, audit payload).
- [x] **Task 2: Prisma model + migration** (AC: 2)
  - [x] 2.1 Extend `TopUpRequest` in `schema.prisma`.
  - [x] 2.2 Drift-tolerant migration `20260926120000_top_up_requests/migration.sql`.
  - [x] 2.3 `prisma:validate` + `prisma generate`.
- [x] **Task 3: Domain + application** (AC: 3, 4, 5)
  - [x] 3.1 `domain/top-up-request.entity.ts` (create / approve / reject transitions, owner/admin DTO mapping helpers stay in application).
  - [x] 3.2 Ports: `application/ports/top-up-repository.port.ts`, `application/ports/admin-capability.port.ts`.
  - [x] 3.3 Exceptions in `economy.exceptions.ts` + mapping in `http-exception.filter.ts`.
  - [x] 3.4 `LedgerService.creditApprovedTopUp` (+ spec).
  - [x] 3.5 `application/top-up.service.ts` (create/list/listForReview/approve/reject + notifications) + `top-up.service.spec.ts` (rollback, replay, concurrency, capability, self-review, limits).
- [x] **Task 4: Infrastructure** (AC: 2, 4, 5)
  - [x] 4.1 `infrastructure/prisma-top-up.repository.ts` (`runInTransaction`, `FOR UPDATE`, conditional `updateMany`, Outbox insert, reference-collision error) + spec with a mocked tx.
  - [x] 4.2 `infrastructure/in-memory-top-up.repository.ts` (records outbox events).
  - [x] 4.3 `infrastructure/prisma-admin-capability.repository.ts` (`FOR SHARE` in ambient tx) + `in-memory-admin-capability.repository.ts`.
- [x] **Task 5: Presentation + config + wiring** (AC: 3, 4, 5, 6)
  - [x] 5.1 `presentation/top-up.controller.ts` (user) + `presentation/admin-top-up.controller.ts` (admin) + specs (override `CsrfGuard`).
  - [x] 5.2 Env vars in `env.schema.ts`, getters in `env.service.ts`, `.env.example`, env spec cases.
  - [x] 5.3 Wire providers/controllers in `economy.module.ts` (`useFactory`, optional notification publisher, `UNIT_OF_WORK_PORT`).
- [x] **Task 6: Backend e2e** (AC: 8)
  - [x] 6.1 `test/top-up.e2e-spec.ts` (create → pending → admin approve → wallet credited once → replay → notification → outbox; reject path; RBAC/CSRF/validation/limit; demoted admin rejected by live capability).
  - [x] 6.2 Run the whole e2e suite; override new Prisma providers wherever existing flows reach them.
- [x] **Task 7: Frontend** (AC: 7)
  - [x] 7.1 `app/wallet/top-up-api.ts` + `tests/top-up-api.test.mjs`.
  - [x] 7.2 Mock types/store/fixtures/repository + `tests/top-up.test.mjs`.
  - [x] 7.3 `app/wallet/top-up/page.tsx` + "Nạp điểm" link on `app/wallet/page.tsx`.
- [x] **Task 8: Docs & verification** (AC: 7.5, 8)
  - [x] 8.1 Append deferrals to `deferred-work.md`.
  - [x] 8.2 `verify.sh` green; prisma validate; story + sprint-status → `review`.

### Review Findings

_Epic 6 code review of 2026-09-26 (triage IDs DF/X in brackets); findings of Stories 6.3–6.6 were triaged together. No decision or patch belongs to 6.6. Dismissed for 6.6 after reading the code: X1 (a notification failure after commit cannot fail the approval — the publisher never throws), X2 (the target user's status is not a top-up rule; the Admin can reject), X5 and X6 (no pre-6.6 rows exist in `top_up_requests`, so the backfill cannot overflow and the list cannot receive out-of-range legacy rows). The shared ledger fixes P7 (reads join the Unit of Work), P8 (replay compatibility) and P14 (retryable concurrent duplicate) also harden `ApproveTopUp`; they are tracked in Stories 6.3/6.4._

- [x] [Review][Defer] Stale PENDING top-ups have no cancel or expiry and block users at the cap of 3 (DF12, low) [apps/backend/src/modules/economy/application/top-up.service.ts:145] — deferred: already recorded (`deferred-work.md`, Story 6.6 entry "Stale PENDING requests never expire"); needs a scheduler or a PO decision.
- [x] [Review][Defer] Row locks and Unit-of-Work rollback of `ApproveTopUp` are never exercised against PostgreSQL (DF5, medium, shared with 6.3/6.4) [apps/backend/src/modules/economy/application/top-up.service.spec.ts:440] — deferred: already recorded (`deferred-work.md`, Story 6.6 entry on Postgres-gated integration tests).
- [x] [Review][Defer] Every approval row-locks the global `SYSTEM_CLEARING` account; system balances are INT4 (DF8/DF9, low, shared with 6.5) [apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts:221] — deferred with Story 6.5 (scale concerns, not correctness at MVP volume).

## Dev Notes

### Current state (read before changing)
- `TopUpRequest` Prisma model exists (id, userId, amount, status `TopUpStatus` PENDING/APPROVED/REJECTED, adminId, createdAt) with a `User.topUpRequests` back-relation, but **no migration creates it** and **no code uses it**. The Story 9.6 migration shows the drift-tolerant pattern (`DO $$ … duplicate_object`, `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, drop/re-add FK).
- `LedgerService` (`apps/backend/src/modules/economy/application/ledger.service.ts`): every money movement is a method with a stable idempotency key calling `postJournal` (which compares an existing journal's description+entries and throws `IdempotencyConflictException` on mismatch). `getOrCreateAccount(null, 'SYSTEM_CLEARING')` is valid (system accounts may overdraft). Add `creditApprovedTopUp` next to `grantStarterPoints`; **do not** use a fast-path that skips the compatibility check.
- AD-16 reference implementation: `ParticipationService.verifyExternalCompletionCode` (UoW `run(key, …)`) + `PrismaParticipationRepository.completeExternalAttemptTransaction` (`runInTransaction` + `SELECT … FOR UPDATE` + status check) + `PrismaLedgerRepository.postJournalTransaction` (joins the ambient tx). Outbox insert pattern: `prisma-participation.repository.ts` (`tx.outboxEvent.create({ data: { id, idempotencyKey, eventType, schemaVersion, producer, aggregateType, aggregateId, aggregateVersion, status: 'PENDING', correlationId, payload } })`).
- Inside an interactive Postgres tx a unique violation aborts the tx; the row lock taken first means the second approver waits and then sees `APPROVED`, so it never reaches the journal insert.
- `SessionAuthGuard` loads the user row per request, but AD-16 requires the capability re-check inside the financial transaction: read `users.role/status` `FOR SHARE` in the ambient tx so a concurrent demotion/lock (`PrismaUserAdminTransactionAdapter.lockActiveAdmins` takes `FOR UPDATE`) serialises with the approval.
- `NOTIFICATION_PUBLISHER_PORT` is optional, never throws, dedupes by `(userId, dedupeKey)`, and must be called **after** commit (see `RewardSettlementCoordinator`, `ParticipationService.notifyPendingCredit`).
- Economy module is `@Global`, wires services with `useFactory`; `UNIT_OF_WORK_PORT` comes from the global `PrismaModule`; `EnvService` from the global `ConfigModule`.
- Frontend wallet page (`app/wallet/page.tsx`) currently calls the live `wallet-api.ts` (English copy, pre-mock). Do **not** redesign it (mock spec "Ask First"); only add a link. The new top-up page is mock-backed.

### Architecture guardrails
- Clean architecture guard (`test/architecture.spec.ts`): files in `domain/` and `application/` must not match `/adapter/i` (even in comments!), `@nestjs/`, `@prisma/client`, `express`. Bank config reaches `TopUpService` as a plain object built from `EnvService` in the module factory.
- Economy is the sole writer of Point records and owns `TopUpRequest` (AD-16 row "Approve manual top-up": "financial authority is the journal/approval transaction; audit delivery is replayable and cannot duplicate credit").
- FraudLog is not used here. The admin-audit record is the Outbox event (Moderation consumes it later; no Moderation consumer exists yet → defer).
- Ledger account choice: `SYSTEM_CLEARING` (external VND settlement) → `USER_AVAILABLE`, keeping purchased points distinguishable from granted `SYSTEM_ISSUANCE` starter points (useful for the FR-56 dashboard later).
- Guards: user mutations `CsrfGuard` + `JsonOnlyGuard`; admin approve `RolesGuard` + `CsrfGuard` (no body → no `JsonOnlyGuard`); admin reject adds `JsonOnlyGuard`. Controllers registered with bare and `api/` prefixes.

### Decisions (conservative, recorded)
- "Pending Payment" = stored `PENDING` (no enum rename → no risky enum migration).
- Max 50,000 points per request (10,000,000 VND) and ≤ 3 open pending requests per user: abuse/overflow guards not in the PRD (PRD only fixes the 100-point minimum).
- Transfer syntax `RESCOM` + 8 chars from a 32-char unambiguous alphabet (≈1.1e12 space, unique index + retry).
- Self-approval forbidden (separation of duties).
- VietQR payload built server-side (and by the mock) from shared pure helpers; QR image rendering deferred (no QR encoder dependency; external image services would leak transfer data).
- Correlation id: `X-Correlation-Id` header when it is a UUID, otherwise a generated UUID; stored on the request row and the Outbox event.

### Testing standards
- Backend unit: jest specs beside sources; use `InMemoryLedgerRepository`, `InMemoryTopUpRepository`, `PassThroughUnitOfWork`, and a failing/rolling-back UoW double to prove atomicity.
- Controller specs `.overrideGuard(CsrfGuard)` (and RolesGuard/SessionAuthGuard as in `starter-points.controller.spec.ts`).
- e2e: boot `AppModule`, mock `PrismaService` (`$transaction: cb => cb(mockPrisma)`), override `USER_REPOSITORY_PORT`, `SESSION_REPOSITORY_PORT`, `IDENTITY_AUDIT_PORT`, `LEDGER_REPOSITORY_PORT`, `NOTIFICATION_REPOSITORY_PORT`, `TOP_UP_REPOSITORY_PORT`, `ADMIN_CAPABILITY_PORT`, `EnvService`. CSRF requests send `x-csrf-token` + `Origin: http://localhost:3000`.
- Frontend: `node --test tests/*.test.mjs`, `setMockStorage(createMockStorage())`, `mockRepository.setLatency(0)`.

### Project Structure Notes
- Backend: `apps/backend/src/modules/economy/{domain,application,infrastructure,presentation}` (new files listed in tasks). Exceptions stay in `application/exceptions/economy.exceptions.ts`.
- Schemas: `packages/schemas/src/economy/top-up.schema.ts`.
- Frontend: `apps/frontend/my-app/app/wallet/top-up/page.tsx`, `app/wallet/top-up-api.ts`, `lib/mock/*`, `tests/top-up*.test.mjs`.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.6]
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#FR-34, #FR-35, Glossary "Point"]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#Cross-Context Financial Workflow Map ("Approve manual top-up"), #Consistency Conventions]
- [Source: _bmad-output/implementation-artifacts/spec-mock-respondent-journey.md#Boundaries & Constraints]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Deferred from: frontend mock implementation split]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Implementation Plan

- Shared contract first (`@rescom/schemas` `top-up.schema.ts`): constants, DTOs, audit-event payload and pure helpers (`pointsToVnd`, `buildTopUpReference`, `crc16CcittFalse`, `buildVietQrPayload`) reused by backend and mock.
- Economy owns `TopUpRequest`. `TopUpService.approveTopUp` is the AD-16 `ApproveTopUp` coordinator: `UnitOfWorkPort.run('topup-approval:{id}')` → `findByIdForUpdate` (row lock) → live capability via `AdminCapabilityPort` (`users` row `FOR SHARE` in the same tx) + self-review guard → `LedgerService.creditApprovedTopUp` (`SYSTEM_CLEARING` → `USER_AVAILABLE`, key `topup-approval:{id}`, no fast path so replays are parameter-checked) → `saveReviewDecision` (conditional `updateMany … status = PENDING` + Outbox `AdminTopUpApproved` in the same tx). A lost conditional transition re-reads and returns the winner as a replay. Notifications (`TOPUP_SUCCESS` / `WARNING`) are published after commit with dedupe keys `topup-approval:{id}` / `topup-rejection:{id}`.
- Create path: per-user `pg_advisory_xact_lock` + pending count + insert (atomic 3-open-request cap); transfer-reference unique violations are retried up to 3 times.
- Frontend: mock repository methods (`getTopUpOptions`, `createTopUpRequest`, `getMyTopUpRequests`) returning live-API DTO shapes, a typed live client, and a new `app/wallet/top-up` page inside `PortalShell`.

### Debug Log References

- Red phases confirmed for schema spec (module missing), ledger `creditApprovedTopUp` spec (method missing) and mock repository test (9/9 failing) before implementation.
- e2e: first run expected `AUTH_FORBIDDEN` for RolesGuard denials; the project code is `FORBIDDEN_RESOURCE` (test expectation fixed). One isolated run of `top-up.e2e-spec.ts` later failed a single test without reproducible cause; 9 consecutive reruns and two full-suite runs passed — consistent with the known supertest ephemeral-port flake on this machine.
- `npx next build` succeeded (route `/wallet/top-up` generated).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- AC1: `packages/schemas/src/economy/top-up.schema.ts` (+18 tests). VietQR payload follows NAPAS/EMVCo (GUID `A000000727`, service `QRIBFTTA`, currency 704, CRC-16/CCITT-FALSE verified with check value `29B1`).
- AC2: `TopUpRequest` extended (`amountVnd`, unique `transferReference`, unique `journalId`, `rejectionReason`, `correlationId`, `reviewedAt`, `updatedAt`, two indexes); drift-tolerant migration `20260926120000_top_up_requests` (creates enum/table if missing, backfills legacy rows, drops the temporary `updated_at` default so the shape matches Prisma). `prisma validate` + `prisma generate` pass.
- AC3–AC5: user endpoints `POST/GET /economy/top-ups`, admin endpoints `GET /admin/top-ups`, `POST /admin/top-ups/:id/approve|reject` (all also under `api/`), guards per convention (CSRF on every mutation, `RolesGuard('ADMIN')` on admin, `JsonOnlyGuard` where a body is sent). New error codes: `TOPUP_INVALID_REQUEST` 400, `TOPUP_NOT_FOUND` 404, `TOPUP_ADMIN_CAPABILITY_REQUIRED` / `TOPUP_SELF_REVIEW_FORBIDDEN` 403, `TOPUP_ALREADY_REVIEWED` / `TOPUP_PENDING_LIMIT_REACHED` / `TOPUP_REFERENCE_CONFLICT` 409.
- AC6: `TOPUP_BANK_NAME/BIN/ACCOUNT_NUMBER/ACCOUNT_NAME` with dev defaults; production refuses the placeholder account (existing production env fixtures in `env.service.spec.ts` and `cookie-options.helper.spec.ts` now set real-looking values). The bank config is read lazily per request so e2e specs that override `EnvService` are unaffected.
- AC7: mock-first `/wallet/top-up` page (amount presets, VND conversion, validation, payment card with copy buttons, VietQR string, history with status/rejection reason, loading/empty/error/retry states, Vietnamese copy); "+ Nạp điểm" link on `/wallet` and a Sidebar entry. QR image and the Admin review UI are deferred (documented in `deferred-work.md`).
- Existing e2e suites needed no new overrides: no existing flow calls the new Prisma-backed providers (they are only constructed at boot).
- Decisions: `PENDING` = "Pending Payment" (no enum rename); `SYSTEM_CLEARING` as the funding account; max 50,000 points/request and ≤3 open requests; self-approval forbidden; `X-Correlation-Id` honoured when it is a UUID, otherwise generated; approval replays return the original result even for a different admin (the replay has no side effects).
- Verification (2026-09-26, `verify.sh`): schemas 193 passed; backend unit 829 passed (74 suites); backend e2e 219 passed / 3 skipped (25 suites); frontend 81 passed; typecheck clean; lint clean; `prisma validate` clean; `next build` OK.
- Code review 2026-09-26: no decisions or patches for 6.6; 3 deferred (DF12, DF5, DF8/DF9 — all shared or already recorded), 4 dismissed (X1, X2, X5, X6). The shared ledger hardening (P7/P8/P14, Stories 6.3/6.4) also covers `creditApprovedTopUp`. Verification after the Epic 6 patches: schemas 343, backend unit 1183, backend e2e 275 passed / 3 skipped (30 suites), frontend 173, typecheck + lint clean.

### File List

New:
- `packages/schemas/src/economy/top-up.schema.ts`
- `packages/schemas/src/economy/top-up.schema.spec.ts`
- `apps/backend/prisma/migrations/20260926120000_top_up_requests/migration.sql`
- `apps/backend/src/modules/economy/domain/top-up-request.entity.ts`
- `apps/backend/src/modules/economy/domain/top-up-request.entity.spec.ts`
- `apps/backend/src/modules/economy/application/top-up.service.ts`
- `apps/backend/src/modules/economy/application/top-up.service.spec.ts`
- `apps/backend/src/modules/economy/application/ports/top-up-repository.port.ts`
- `apps/backend/src/modules/economy/application/ports/admin-capability.port.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-top-up.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-top-up.repository.spec.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-top-up.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-admin-capability.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-admin-capability.repository.ts`
- `apps/backend/src/modules/economy/presentation/top-up.controller.ts`
- `apps/backend/src/modules/economy/presentation/admin-top-up.controller.ts`
- `apps/backend/src/modules/economy/presentation/top-up.controller.spec.ts`
- `apps/backend/test/top-up.e2e-spec.ts`
- `apps/frontend/my-app/app/wallet/top-up-api.ts`
- `apps/frontend/my-app/app/wallet/top-up/page.tsx`
- `apps/frontend/my-app/tests/top-up.test.mjs`
- `apps/frontend/my-app/tests/top-up-api.test.mjs`

Modified:
- `packages/schemas/src/economy/index.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/.env.example`
- `apps/backend/src/common/config/env.schema.ts`
- `apps/backend/src/common/config/env.service.ts`
- `apps/backend/src/common/config/env.service.spec.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/common/http/http-exception.filter.spec.ts`
- `apps/backend/src/modules/auth/presentation/cookie-options.helper.spec.ts`
- `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts`
- `apps/backend/src/modules/economy/application/ledger.service.spec.ts`
- `apps/backend/src/modules/economy/economy.module.ts`
- `apps/frontend/my-app/lib/mock/types.ts`
- `apps/frontend/my-app/lib/mock/store.ts`
- `apps/frontend/my-app/lib/mock/fixtures.ts`
- `apps/frontend/my-app/lib/mock/repository.ts`
- `apps/frontend/my-app/app/wallet/page.tsx`
- `apps/frontend/my-app/components/layout/Sidebar.tsx`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- Code review 2026-09-26: `_bmad-output/implementation-artifacts/6-6-point-top-up-request-admin-approval.md`, `_bmad-output/implementation-artifacts/deferred-work.md` (no 6.6 code changes)

### Change Log

- 2026-09-26: Story created (ready-for-dev).
- 2026-09-26: Implemented Story 6.6 — shared top-up contract, TopUpRequest persistence + migration, ApproveTopUp coordinator (row lock, live Admin capability, single `topup-approval:{id}` journal, Outbox admin-audit event, post-commit notifications), rejection flow, user/admin endpoints, bank configuration, mock-first top-up page + typed live client, tests at every layer. Status → review.
- 2026-09-26: Code review 2026-09-26: 0 decisions, 0 patches, 3 deferred (DF12, DF5, DF8/DF9), 4 dismissed. Status → `done`.
