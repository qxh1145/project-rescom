---
baseline_commit: df79eb3593858e451708cd6430d562e84d9cbde2
---
# Story 13.1: Top-Up Schema for PayOS

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Developer,
I want `TopUpRequest` extended for the PayOS channel,
so that manual and PayOS top-ups share one durable, constrained entity.

## Acceptance Criteria

1. **Given** the current `top_up_requests` table with `PENDING`/`APPROVED`/`REJECTED` manual rows, **When** the migration runs, **Then** `TopUpRequest` gains `channel` (`MANUAL` | `PAYOS`, existing rows backfilled `MANUAL`), `orderCode` (unique, from a PostgreSQL sequence starting at `1000000000`), `paymentLinkId`, `expiresAt`, `cancelledAt`, `pointsCredited`, write-once provider facts `amountPaidVnd`, `providerReference`, `paidAt`, and nullable `counterAccountBankId`, `counterAccountBankName`, `counterAccountName`, `counterAccountNumber` (AD-25).
2. **And** `TopUpStatus` adds `PROCESSING`, `SUCCESSFUL`, `CANCELLED`, `EXPIRED`, `AMOUNT_MISMATCH`, `MANUAL_REFUNDED`; legacy statuses keep their meaning and existing rows are unchanged.
3. **And** `transferReference` becomes nullable and stays unique for `MANUAL` rows.
4. **And** raw-SQL migration steps own the sequence, the `CHECK`s for `PAYOS` rows (10,000 ≤ `amountVnd` ≤ 5,000,000, `amountVnd % 200 = 0`), and the partial unique index allowing at most one `PROCESSING` row per user.
5. **And** a second `PROCESSING` insert for the same user fails at the database, proven by an integration test.
6. **And** the full migration chain applies from an empty database and from the current production snapshot, and the existing manual top-up tests still pass.

## Tasks / Subtasks

- [x] Task 1: Enum-value migration (AC: 2)
  - [x] Create `apps/backend/prisma/migrations/20261017100000_top_up_payos_status_values/migration.sql` containing ONLY `ALTER TYPE "TopUpStatus" ADD VALUE IF NOT EXISTS '<v>';` for the six new values, in AC order. Do not reference the new values anywhere else in this file (see Dev Notes, "Enum gotcha").
- [x] Task 2: Channel/columns/constraints migration (AC: 1, 3, 4)
  - [x] Create `apps/backend/prisma/migrations/20261017110000_top_up_payos_channel/migration.sql` (must sort after `20261016100000_rewards_my_vouchers_code_issues`, the current last migration).
  - [x] `CREATE TYPE "TopUpChannel" AS ENUM ('MANUAL', 'PAYOS');`
  - [x] `ADD COLUMN "channel" "TopUpChannel" NOT NULL DEFAULT 'MANUAL'` (backfills every existing row to `MANUAL` in one statement; keep the default so the manual create path needs no change).
  - [x] `CREATE SEQUENCE "top_up_order_code_seq" START WITH 1000000000;` and `"order_code" INTEGER` (nullable, no column default; 13.3 draws `nextval` only for PAYOS rows) + unique index `top_up_requests_order_code_key`.
  - [x] Add nullable columns: `payment_link_id TEXT` (unique), `expires_at`, `cancelled_at`, `paid_at` (`TIMESTAMP(3)`), `points_credited INTEGER`, `amount_paid_vnd INTEGER`, `provider_reference TEXT`, `counter_account_bank_id TEXT`, `counter_account_bank_name TEXT`, `counter_account_name TEXT`, `counter_account_number TEXT`.
  - [x] `ALTER COLUMN "transfer_reference" DROP NOT NULL`; keep the existing unique index `top_up_requests_transfer_reference_key` (PostgreSQL unique allows many NULLs, so it stays unique for MANUAL rows).
  - [x] CHECK constraints (names are suggestions, keep `top_up_requests_*` prefix):
    - `top_up_requests_payos_amount_check`: `"channel" <> 'PAYOS' OR ("amount_vnd" BETWEEN 10000 AND 5000000 AND "amount_vnd" % 200 = 0)`
    - `top_up_requests_channel_shape_check`: `("channel" = 'MANUAL' AND "transfer_reference" IS NOT NULL) OR ("channel" = 'PAYOS' AND "order_code" IS NOT NULL AND "expires_at" IS NOT NULL)`
    - `top_up_requests_points_credited_check`: `"points_credited" IS NULL OR "points_credited" > 0`
    - `top_up_requests_amount_paid_check`: `"amount_paid_vnd" IS NULL OR "amount_paid_vnd" >= 0`
  - [x] Partial unique index: `CREATE UNIQUE INDEX "top_up_requests_one_processing_per_user" ON "top_up_requests"("user_id") WHERE "status" = 'PROCESSING';`
  - [x] Index for 13.5 reconciliation scans: `CREATE INDEX "top_up_requests_channel_status_created_at_idx" ON "top_up_requests"("channel", "status", "created_at");`
  - [x] Statements unconditional (no `to_regclass` guard — `test/migration-chain.spec.ts` forbids it), re-runnable where cheap (`IF NOT EXISTS`).
- [x] Task 3: `schema.prisma` (AC: 1, 2, 3)
  - [x] Add `enum TopUpChannel { MANUAL PAYOS }`; append six values to `enum TopUpStatus` (line ~219).
  - [x] Update `model TopUpRequest` (line ~994): `transferReference String? @unique`, `channel TopUpChannel @default(MANUAL)`, `orderCode Int? @unique @map("order_code")`, `paymentLinkId String? @unique`, the other new nullable fields with `@map` snake_case, `@@index([channel, status, createdAt])`.
  - [x] Extend the `///` model comment: channel meaning, sequence `top_up_order_code_seq`, the CHECKs, and the partial unique index live only in the migration (Prisma 6 cannot express them) — same documentation style as `model SurveyAttempt`.
  - [x] Run `npx prisma validate` + `npx prisma generate`; `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <scratch>` must show no drift other than objects Prisma cannot model.
- [x] Task 4: Keep the manual flow compiling and unchanged (AC: 6)
  - [x] `prisma-top-up.repository.ts`: every manual read/write adds `channel: 'MANUAL'` (`findById`, `findReviewRecordById`, `listByUser`, `listForReview`, `count` in `createPending`, `saveReviewDecision` CAS `where`). `findByIdForUpdate` raw SQL adds `AND channel = 'MANUAL'`. This is AD-25's "status CAS + `channel = own`" for legacy `ApproveTopUp`, and keeps PAYOS rows out of the frozen manual API contract.
  - [x] `toEntity`: narrow the widened Prisma row to the manual entity — throw if `transferReference === null` or status is not `PENDING|APPROVED|REJECTED` (unreachable once queries filter `MANUAL`; it replaces an unsafe cast). Keep `TopUpRequestEntity` and `TopUpRequestStatus` manual-only.
  - [x] `prisma-admin-economy-stats.ts` (PENDING aggregate + oldest pending) and `prisma-account-funding.reader.ts` (APPROVED within window): leave as is — status values used there are MANUAL-only. Do not touch `@rescom/schemas` `topUpStatusSchema` or the frontend (see Dev Notes).
  - [x] Update `prisma-top-up.repository.spec.ts` mocks/assertions for the added `channel` filter; add one case asserting `toEntity` rejects a PAYOS-shaped row.
- [x] Task 5: Tests (AC: 2, 4, 5, 6)
  - [x] `test/migration-chain.spec.ts`: add a `describe` for 13.1 following the 12.9/12.10 cases — the enum migration only adds values (each value appears once, not used), the channel migration has no `to_regclass`, sorts after the enum migration, and contains the sequence, both CHECKs, the partial unique index. Decide `post-push-invariants.sql` mirroring by matching the existing 12.9/12.10 tests; if mirrored, the mirror test must cover it.
  - [x] `test/migration-chain.prisma.e2e-spec.ts`: add a case asserting `top_up_order_code_seq` exists with `start_value = 1000000000`, the partial index and the CHECKs exist (`pg_indexes`, `pg_constraint`).
  - [x] New `test/top-up-payos-schema.prisma.e2e-spec.ts` (pattern: `probeDatabase`/`requireDb`/`describe.skip` from `test/fixtures/financial-pg-harness.ts`, raw `PrismaClient` is enough — no HTTP harness needed):
    - second `PROCESSING` row for the same user → unique violation (`P2002` / SQLSTATE `23505`) — **AC 5 proof**;
    - a `PROCESSING` row for user A and one for user B both succeed; a second PAYOS row for the same user in `CANCELLED` succeeds;
    - PAYOS `amountVnd` 9,800 / 5,000,200 / 10,100 rejected (`23514`); 10,000 and 5,000,000 accepted;
    - PAYOS row without `orderCode` rejected; MANUAL row without `transferReference` rejected;
    - two `nextval('top_up_order_code_seq')` calls return ≥ 1,000,000,000 and distinct;
    - a MANUAL insert without `channel` gets `MANUAL`.
  - [x] Run existing suites unchanged: `npm test --workspace backend -- top-up` (unit: entity, service, repository) and `npm run test:e2e --workspace backend -- top-up` (`test/top-up.e2e-spec.ts`), plus `test/admin-read-views.prisma.e2e-spec.ts`, `test/financial-publisher.prisma.e2e-spec.ts`, `test/rewards-redemption.prisma.e2e-spec.ts` (they create top-up rows).
  - [x] Production-snapshot check (AC 6): restore a `pg_dump` of prod (Owner runs the dump on the VPS; never commit it) into a scratch DB (e.g. `rescom_readiness_check`), run `prisma migrate deploy`, and record: the 4 PENDING rows are still `PENDING`, every row `channel = 'MANUAL'`, `order_code` all NULL. Record the command and counts in the Dev Agent Record.

### Review Findings

- [x] [Review][Patch] (Decision resolved 2026-10-15: add in 13.1) Tighten channel CHECKs to AD-25 state model [apps/backend/prisma/migrations/20261017110000_top_up_payos_channel/migration.sql:20] — Today a MANUAL row can hold PROCESSING/SUCCESSFUL/AMOUNT_MISMATCH and a PAYOS row can hold PENDING (the column default)/APPROVED/REJECTED; `toEntity` would then throw and 500 the whole manual list, and a PAYOS PENDING row would leak into admin pending stats. Also `amount` is not tied to `amount_vnd / 200` for PAYOS. Candidate: `top_up_requests_channel_status_check` (MANUAL ∈ PENDING/APPROVED/REJECTED; PAYOS ∈ PROCESSING/SUCCESSFUL/CANCELLED/EXPIRED/AMOUNT_MISMATCH/MANUAL_REFUNDED) plus `"channel" <> 'PAYOS' OR "amount" * 200 = "amount_vnd"`. Not in AC4's CHECK list, so needs Owner call.
- [x] [Review][Patch] Mirror 13.1 CHECKs, partial unique index and `top_up_order_code_seq` into `post-push-invariants.sql` (12.9/12.10 precedent; `prisma:db-push` envs otherwise lack AC4/AC5 invariants and the sequence 13.3 needs) and assert the mirror in `migration-chain.spec.ts` [apps/backend/prisma/sql/post-push-invariants.sql]
- [x] [Review][Patch] Add `channel: 'MANUAL'` to `pendingTopUpSummary` and `oldestPendingTopUp` filters, matching the repository convention [apps/backend/src/modules/economy/infrastructure/prisma-admin-economy-stats.ts:24]
- [x] [Review][Patch] Fill empty "Agent Model Used" in Dev Agent Record [_bmad-output/implementation-artifacts/13-1-top-up-schema-for-payos.md:130]

## Dev Notes

### Scope boundary (read first)

13.1 is schema only. Out of scope, owned by later stories — do not build them here:
- `PaymentProviderPort`, `@payos/node` (13.2); checkout, cancel, `PAYOS_ENABLED`, rate limit, `nextval` usage (13.3); webhook + `CreditTopUp` (13.4); reconciliation (13.5).
- `TopUpRefundRequest` and `LedgerAccountClass.REFUND_HOLD` belong to **13.10** (epics.md). `solution-design.md` slice 1 lists them in the schema slice; the epic story wins — do not add them now.
- Shared contract `packages/schemas/src/economy/top-up.schema.ts` `topUpStatusSchema` stays `PENDING|APPROVED|REJECTED`. Its comment says "must stay identical to the Prisma enum" and `top-up.schema.spec.ts:56` asserts the 3 values — that parity is intentionally broken until 13.3/13.7 define the PayOS wire contract. Update the comment to: "Manual-channel statuses only; Prisma `TopUpStatus` also holds PayOS statuses (Story 13.1), exposed by the PayOS contract." Extending it now breaks the frontend at compile time: `Record<TopUpStatus, …>` maps in `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/PendingScreen.tsx:17` and `.../admin/top-ups/components/TopUpQueueTable.tsx:11,18`.

### Enum gotcha (critical)

PostgreSQL rejects using an enum value added by `ALTER TYPE … ADD VALUE` in the same transaction (`unsafe use of new value "PROCESSING" of enum type "TopUpStatus"`). The partial index `WHERE "status" = 'PROCESSING'` uses it. Prisma applies a migration file as one script, so the values must be in their own earlier migration (Task 1) — the same "add values without using them" pattern `test/migration-chain.spec.ts` already checks for `FormCloseKind`/`NotificationType`.

### Current state of files touched

- `apps/backend/prisma/schema.prisma` — `enum TopUpStatus { PENDING APPROVED REJECTED }` (~l.219); `model TopUpRequest` (~l.994): `amount` (Points), `amountVnd`, `transferReference String @unique`, `status`, `adminId`, `journalId String? @unique` (single credit journal per top-up — reuse it for PayOS, AD-25), `rejectionReason`, `correlationId`, `reviewedAt`, indexes `[status, createdAt]`, `[userId, createdAt]`, table `top_up_requests`.
- Original DDL: `prisma/migrations/20260926120000_top_up_requests/migration.sql` (drift-tolerant because prod tables once came from `db push`).
- `src/modules/economy/infrastructure/prisma-top-up.repository.ts` — manual-only repository: `createPending` (advisory lock `top-up:{userId}`, max 3 PENDING), `findByIdForUpdate` (raw `FOR UPDATE`), `saveReviewDecision` (CAS `status: 'PENDING'` + admin-audit Outbox in one tx), `toEntity`. Preserve all of it; only add the `MANUAL` filter and narrowing.
- `src/modules/economy/domain/top-up-request.entity.ts` — `TopUpRequestStatus = 'PENDING'|'APPROVED'|'REJECTED'`, `transferReference: string`. Unchanged.
- `src/modules/economy/infrastructure/in-memory-top-up.repository.ts` — entity-based, no change needed.
- `src/scripts/seed.ts:787` — reads `PENDING`; manual rows only, no change.

### Field semantics (for the `///` comments; enforced by later stories)

- `amount` stays requested Points (`amountVnd / 200`); `pointsCredited` = Points actually credited (differs after mismatch resolution, 13.9).
- `orderCode`: int4 is enough (sequence from 1e9 leaves ~1.1e9 values) and stays a JS `number`, no `BigInt` plumbing; payOS needs a JS-safe integer. payOS `description` = `RC` + last 7 digits (13.2).
- "Write-once" provider facts are enforced by the 13.4 compare-and-set, not by a DB trigger: `amountPaidVnd` is cumulative across `UNDERPAID` → `AMOUNT_MISMATCH` updates (AD-25 table), so a trigger would block a legal update.
- `counterAccount*`: first non-null value wins (13.4); nullable because payOS may omit them (13.6 probe confirms).
- `paidAt` stored UTC (parsed from `Asia/Ho_Chi_Minh` in 13.2).

### Architecture compliance

- AD-25 (spine `ARCHITECTURE-SPINE.md` l.212–280): single entity for both channels; raw-SQL migrations own index, checks, sequence; existing unique `journalId` = single credit journal.
- AD-16: Economy owns `top_up_requests`; no other module reads it directly (stats/funding readers already live in Economy).
- AD-1: no ledger change in this story.
- Prod snapshot has 4 manual `PENDING` rows (2026-10-15); they must survive untouched — FR-79/13.13 resolves them later.

### Cross-story note (do not implement)

`prisma-account-funding.reader.ts` (fraud "flash after top-up", migration `20261014100000_fraud_log_flash_after_topup`) counts only `APPROVED` top-ups. PayOS credits will be `SUCCESSFUL` — 13.4 must extend that reader to `SUCCESSFUL` by `paidAt`. Record this in Completion Notes so 13.4 picks it up.

### Testing standards

- Unit: Jest co-located `*.spec.ts`; DB proofs: `test/*.prisma.e2e-spec.ts` against real PostgreSQL via `FINANCIAL_TEST_DATABASE_URL` (default `postgresql://rescom_admin:rescom_password@localhost:${PG_PORT:-5432}/rescom_financial_test`), skipped when unreachable unless `requireDb`. Run with `npm run test:e2e --workspace backend -- <file>`.
- `migration-chain.prisma.e2e-spec.ts` resets its DB (`prisma migrate reset`) — only point it at a scratch DB.
- Build check: `npm run build --workspace backend` and `npm run lint --workspace backend`; `npm test --workspace @rescom/schemas` after the comment change.

### Project Structure Notes

- Migration folder names: `YYYYMMDDHHMMSS_snake_case`; latest is `20261016100000_…`, so use `20261017100000_…` and `20261017110000_…`.
- No new module, no new package dependency.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.1] (l.1785–1800) and Epic 13 overview (l.1781)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-25] state diagram + mapping table
- [Source: .../solution-design.md#PayOS Top-Up and Refund Flows] (l.295–370)
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md] FR-34, FR-35, FR-76, FR-79
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-15.md] readiness fixes
- [Source: apps/backend/test/migration-chain.spec.ts] migration conventions

## Dev Agent Record

### Agent Model Used

Not recorded during implementation (gap noted in code review 2026-10-15).

### Debug Log References

- 2026-10-15: Owner supplied `/Users/quan/rescom-prod-snapshot.dump` outside git. Confirmed fresh scratch DB `rescom_13_1_snapshot_check` absent, created via `docker exec rescom_postgres createdb -U rescom_admin rescom_13_1_snapshot_check`; restored using `PGPASSWORD=<local Docker password> pg_restore --no-owner --no-privileges --exit-on-error -h 127.0.0.1 -p 5433 -U rescom_admin -d rescom_13_1_snapshot_check /Users/quan/rescom-prod-snapshot.dump`. Before migration: 4 PENDING / 4 total rows, 42 applied migrations. Ran `DATABASE_URL='postgresql://rescom_admin:<local Docker password>@127.0.0.1:5433/rescom_13_1_snapshot_check?schema=public' npm exec --workspace backend -- prisma migrate deploy`; both 13.1 migrations applied. After migration: 4 PENDING / 4 total rows, 0 rows with non-MANUAL or NULL channel, 0 non-NULL order codes, 44 applied migrations. Queried aggregate counts only; no row data printed. Scratch DB retained for inspection; never target it with migration-reset tests.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Added split enum/channel migrations, PayOS schema/index/CHECK/sequence, manual-channel query isolation, and DB constraint tests. Existing manual contract stays unchanged.
- Verified empty-DB migration chain 17/17; financial DB migrate deploy; constraint tests 3/3; manual/regression E2E 45/45; backend unit suite 2482/2482; shared schemas 645/645; backend build/lint, Prisma validate/generate, and migrate diff (`No difference detected`).
- Production snapshot AC6 verified in isolated scratch DB: 4 PENDING rows preserved; all rows MANUAL with NULL order codes. Story 13.4 must extend `prisma-account-funding.reader.ts` to `SUCCESSFUL` top-ups using `paidAt`.


### File List

- apps/backend/prisma/migrations/20261017100000_top_up_payos_status_values/migration.sql
- apps/backend/prisma/migrations/20261017110000_top_up_payos_channel/migration.sql
- apps/backend/prisma/schema.prisma
- apps/backend/src/modules/economy/infrastructure/prisma-top-up.repository.ts
- apps/backend/src/modules/economy/infrastructure/prisma-top-up.repository.spec.ts
- apps/backend/src/modules/economy/infrastructure/prisma-admin-economy-stats.ts
- apps/backend/test/migration-chain.spec.ts
- apps/backend/test/migration-chain.prisma.e2e-spec.ts
- apps/backend/test/top-up-payos-schema.prisma.e2e-spec.ts
- packages/schemas/src/economy/top-up.schema.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/13-1-top-up-schema-for-payos.md

### Change Log

- 2026-10-15: Implemented PayOS top-up schema and manual isolation; left production-snapshot verification open.
- 2026-10-15: Verified production snapshot in isolated scratch DB, completed AC6, advanced story to review.
