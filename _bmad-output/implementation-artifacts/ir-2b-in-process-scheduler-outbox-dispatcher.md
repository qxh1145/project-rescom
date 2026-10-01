---
baseline_commit: d1175ebc9e1d31ffcc9a23956cfe4f8b870252bd
context:
  - "_bmad-output/planning-artifacts/epics.md#Story IR.2b: In-Process Scheduler and Outbox Dispatcher"
  - "_bmad-output/planning-artifacts/epics.md#Story 11.1: Deployment-Ready Backend Packaging"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md (AD-1, AD-5 + amendment, AD-6, AD-7, AD-10, AD-16, AD-17, AD-23, Cross-Context Financial Workflow Map)"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md (Outbox Event Minimum Contract, §14 Failure and Recovery)"
  - "_bmad-output/planning-artifacts/implementation-readiness-report-2026-09-30.md (Repository Reality Snapshot: Background work)"
  - "_bmad-output/implementation-artifacts/deferred-work.md (Story 9.6 entry, Story 7.2 entry, Epic 6 DF1/DF2/DF6, Epic 5 DF1/DF5/DF7, 5.3 DF11)"
  - "_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md (E9-D3, E5-D2, E8-D1, OC4)"
  - "_bmad-output/implementation-artifacts/5-1-survey-attempt-initialization-concurrency.md"
  - "_bmad-output/implementation-artifacts/6-3-escrow-lock-release-refund.md"
  - "_bmad-output/implementation-artifacts/6-4-respondent-point-credit-pending-logic.md"
  - "_bmad-output/implementation-artifacts/6-5-frozen-starter-points-lifecycle.md"
  - "_bmad-output/implementation-artifacts/9-6-event-notification-system.md"
  - "apps/backend/prisma/schema.prisma (OutboxEvent, ProcessedHandler, Form, SurveyAttempt, FormCloseKind)"
  - "apps/backend/src/common/database/prisma-unit-of-work.ts"
  - "apps/backend/src/common/config/env.schema.ts"
  - "apps/backend/src/common/system/system.controller.ts"
  - "apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts"
  - "apps/backend/src/modules/economy/application/starter-points.coordinator.ts"
  - "apps/backend/src/modules/forms/application/forms.service.ts"
  - "apps/backend/src/modules/forms/application/forms-escrow.coordinator.ts"
  - "apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts"
  - "apps/backend/src/modules/storage/infrastructure/storage-cleanup.service.ts"
---

# Story IR.2b: In-Process Scheduler and Outbox Dispatcher

Status: ready-for-dev

<!-- Created 2026-09-30 by the create-story workflow (non-interactive run). Open product/architecture questions are collected at the end under "Questions / Decisions for Owner"; each has a recommended default so development is not blocked. -->

## Story

As a Respondent and Publisher,
I want time-based point movements to happen automatically,
so that pending rewards release, starter points expire and unused escrow is refunded without an Admin pressing a button.

## Background: why this story exists

The 2026-09-30 readiness assessment found **no scheduler and no Outbox dispatcher** in the backend. FR-5, FR-24, FR-32, NFR-12 and NFR-13 therefore run only when an Admin calls an endpoint or when a later request triggers them lazily. Stories 6.4 and 6.5 are `done`, and Story 11.1 assumes this machinery exists. Evidence:

- `OutboxEvent` rows are written in 6 places (table below). Nothing claims, dispatches or acknowledges them: `status`, `attempts` and `claim*` are never updated, so every row stays `PENDING`. `ProcessedHandler` is never read or written.
- The only timers are `setInterval` in `apps/backend/src/common/system/system-metrics.service.ts:62-101` (metrics logging) and `apps/backend/src/modules/storage/infrastructure/storage-cleanup.service.ts:18-31` (hourly, no lease, no env flag, deferred as 5.3 DF11).
- `@nestjs/schedule` is **not installed**. There is no worker entrypoint, no clock provider and no request-ID propagation.
- Deferred items this story closes: Epic 6 DF1 (no scheduled matured-release), Epic 6 DF2 and the Story 7.2 entry (no scheduled starter expiry/catch-up), Epic 5 DF7 (lazy attempt abandonment), Epic 5 DF1 (`InternalRewardRequested` has no consumer), Epic 6 DF6 (no refund on survey expiry and no Publisher refund notification), and optionally 5.3 DF11 (storage cleanup has no lease).

## Acceptance Criteria

The epic ACs (epics.md, Story IR.2b) are restated as AC1–AC8. The indented **Binding detail** notes are this story's grounded interpretation and are part of the acceptance scope.

**AC1: One logical scheduler owner behind one flag (AD-5 amendment, AD-17, AD-23)**
**Given** the single-replica pilot
**When** the API starts with `SCHEDULER_ENABLED=true`
**Then** exactly one logical scheduler owner runs in-process. With the flag disabled (the default), no job and no dispatcher runs, but every Admin and operator endpoint keeps working. Every job claims its work through PostgreSQL with an owner, a fencing token and a lease (AD-10, AD-17), so a restart or an accidental second owner cannot double-process.
  > **Binding detail:**
  > - The flag name is `SCHEDULER_ENABLED`. Story 11.1 uses the same name in `docker-compose.prod.yml`.
  > - Leases live in a new `scheduler_job_leases` table (one row per job). The fencing token is a monotonically increasing `BIGINT`. A completion or renewal whose owner and token no longer match is rejected and logged. The runner never auto-starts when `NODE_ENV=test`.

**AC2: Pending release job (FR-24, NFR-13)**
**Given** External Form rewards whose 48-hour Pending window has elapsed and that carry no locked dispute hold
**When** the pending-release job runs
**Then** it releases them to Available through the existing idempotent Economy command, producing exactly one Ledger journal per reward (`release-pending:{attemptId}`) and one `REWARD_RELEASED` notification.
  > **Binding detail:** reuse `RewardSettlementCoordinator.releaseMaturedPendingRewards` (paged). Do not write a second release path.

**AC3: Starter expiry job (FR-5)**
**Given** accounts whose starter onboarding has not completed within 30 days of registration
**When** the starter-expiry job runs
**Then** the Frozen Points are voided exactly once through the existing Economy command (`starter-expiry:{userId}`), and the user is notified (`WARNING`, dedupe = journal key).
  > **Binding detail:**
  > - Reuse `StarterPointsCoordinator.expireUnmaturedStarterPoints` with its `after` cursor.
  > - Its catch-up unlock (`READY_TO_UNLOCK`) and its `PENDING_CONFIRMATION` deferral stay as they are.

**AC4: Reservation-expiry job**
**Given** Attempts whose reservation has expired
**When** the reservation-expiry job runs
**Then** each Attempt is closed as abandoned and its quota slot is released, without racing a concurrent submission.
  > **Binding detail:**
  > - The quota slot is already released logically by the 30-minute time window. The job's durable effect is the `IN_PROGRESS → ABANDONED` transition with reason `EXPIRED`.
  > - It must lose cleanly to a submit or verify that holds the attempt row lock (`FOR UPDATE SKIP LOCKED` plus a conditional status update).
  > - It acts only after `RESERVATION_EXPIRY_MS` plus a grace period, so it never abandons an attempt the service would still accept.
  > - The FR-23 missing-code report must keep working for expired External attempts (Q5).

**AC5: Deadline close and escrow refund job (FR-32, NFR-12)**
**Given** surveys whose deadline has passed with unfilled slots
**When** the escrow-refund job runs
**Then** the survey closes and the remaining Escrow is refunded under a stable close command (`close-refund:{formId}:c{closeCount}`), and the Publisher is notified (`ESCROW_RELEASED`).
  > **Binding detail:**
  > - The `Form` model has **no deadline field today**. This story adds `forms.deadline_at` (nullable, expand-only) and a system close kind `DEADLINE`.
  > - The close reuses `FormsEscrowCoordinator.coordinateClose` inside the existing Unit of Work.
  > - Write-path scope is Q1.

**AC6: Outbox dispatcher (AD-10)**
**Given** unprocessed `OutboxEvent` rows
**When** the Outbox dispatcher runs
**Then** it dispatches each event to its registered handlers with claim and lease, retry with backoff, and a dead-letter after a bounded number of attempts. Each handler's effect commits atomically with its `ProcessedHandler` record, so a replay is a no-op.
  > **Binding detail:**
  > - Event types with no registered handler are **not claimed**. They stay `PENDING` for their future consumer and are reported separately as "unsubscribed backlog".
  > - IR.2b registers one production handler, `InternalRewardRequested` → Economy settlement.
  > - The handler contract must also be usable by IR.4b's `EmailSenderPort` handler.

**AC7: Operator fallbacks keep working**
The existing Admin re-drive and manual release endpoints keep working as operator fallbacks:
- `POST /economy/rewards/release-matured`
- `POST /economy/rewards/release-pending/:attemptId`
- `POST /economy/starter-points/expire`
- `POST /economy/rewards/internal/:responseId`
- `POST /economy/rewards/external/:attemptId`
- `POST /forms/:id/close`

All of them also work under their `api/` twins.

**AC8: Observability and test evidence**
Job runs, claim conflicts, retries and dead letters are logged with correlation IDs and exposed to readiness and metrics. Tests cover a clock-controlled boundary for every job, duplicate and concurrent runs, crash-after-claim recovery and a no-double-journal ledger invariant.

## Tasks / Subtasks

> Order matters: Task 1 (schema) → Task 2 (infrastructure primitives) → Task 3 (runner) → Task 4 (dispatcher) → Tasks 5–9 (jobs and handler) → Task 10 (observability) → Task 11 (tests) → Task 12 (docs).

- [ ] **Task 1: Expand-only migration and Prisma schema (AC1, AC4, AC5, AC6)**
  - [ ] 1.1 Add model `SchedulerJobLease` → table `scheduler_job_leases` (Platform Infrastructure owns it; ownership map row "OutboxEvent claim/lease/retry state"). Fields:
    - `jobName String @id @map("job_name")`
    - `leaseOwner String? @map("lease_owner")`
    - `fencingToken BigInt @default(0) @map("fencing_token")`
    - `leaseExpiresAt DateTime? @map("lease_expires_at")`
    - `nextRunAt DateTime @default(now()) @map("next_run_at")`
    - `lastStartedAt DateTime? @map("last_started_at")`
    - `lastFinishedAt DateTime? @map("last_finished_at")`
    - `lastStatus String? @map("last_status")` (`SUCCEEDED` | `PARTIAL` | `FAILED` | `LEASE_LOST`)
    - `lastSummary Json? @map("last_summary")` (counts only, never user ids or payloads)
    - `lastError String? @map("last_error")`
    - `consecutiveFailures Int @default(0) @map("consecutive_failures")`
    - `createdAt DateTime @default(now()) @map("created_at")`
    - `updatedAt DateTime @updatedAt @map("updated_at")`
  - [ ] 1.2 `OutboxEvent`: add the Prisma-expressible indexes `@@index([orderingStream, streamSequence])` (stream-gap check) and `@@index([eventType, status])` (backlog by type). Keep every existing column. Keep the existing statuses `PENDING | PROCESSED | FAILED | DEAD_LETTER` (no enum change). "Claimed" means `claim_expires_at > now`, not a new status.
  - [ ] 1.3 `ProcessedHandler`: leave as is (`@@unique([handlerName, eventId])` is the dedupe key).
  - [ ] 1.4 `Form`:
    - Add `deadlineAt DateTime? @map("deadline_at")` and `@@index([status, deadlineAt])`.
    - Add `DEADLINE` to `enum FormCloseKind`.
    - Add `"DEADLINE"` to `formCloseKindEnum` in `packages/schemas/src/forms/form-publish.schema.ts:52`, keeping Prisma order, and update the doc comment there.
    - No parity test covers `FormCloseKind` today. Add `apps/backend/src/modules/forms/infrastructure/form-close-kind.parity.spec.ts`, modelled on `notifications/infrastructure/notification-type.parity.spec.ts`.
  - [ ] 1.5 `SurveyAttempt`:
    - Add `@@index([status, startedAt])` so the sweep is not a full scan. No index on `(status, started_at)` exists today; see `schema.prisma:533-577`.
    - **The close-reason columns belong to IR.2a** (`ir-2a-respondent-read-endpoints-survey-runner.md`, T2): `enum AttemptCloseReason { EXPIRED CANCELLED }`, `closedReason AttemptCloseReason? @map("closed_reason")` and `closedAt DateTime? @map("closed_at")`, in migration `20260930xxxxxx_survey_attempt_close_reason`. IR.2a also makes the lazy `abandonExpiredAttemptsWith` write `closedReason='EXPIRED'`.
    - Task 8 depends on those columns. **Preferred:** merge IR.2a T2 first and do not re-declare them.
    - If IR.2b must merge first, its migration creates the **identical** enum (guarded `CREATE TYPE` / `duplicate_object`, as in `20260926090000_event_notifications`) and the columns (`ADD COLUMN IF NOT EXISTS`). IR.2a's migration must then be equally drift-tolerant. Never use different names, such as `abandon_reason`.
  - [ ] 1.6 Write one hand-written migration, `apps/backend/prisma/migrations/20261001000000_scheduler_outbox_dispatcher/migration.sql`. Use a timestamp later than `20260927060000`.
    - **Expand-only:** `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` (nullable or defaulted), `CREATE INDEX IF NOT EXISTS`, and `ALTER TYPE "FormCloseKind" ADD VALUE IF NOT EXISTS 'DEADLINE'`.
    - Follow the precedent in `20260927030000_notification_reward_earned`. Do not use the new enum value in the same migration.
    - No `DROP`, no `RENAME`, no `NOT NULL` without a default, no data rewrite.
  - [ ] 1.7 Migration-chain guardrails (`apps/backend/test/migration-chain.spec.ts`):
    - Do **not** wrap any statement in a `to_regclass` guard. The guarded list is frozen and asserted by the test.
    - Do **not** edit `prisma/sql/post-push-invariants.sql` or `20260927040000_reconcile_db_push_tables`. They must stay byte-identical, and editing an applied migration breaks its checksum.
    - Every new object must be expressible in `schema.prisma`, so `npm run prisma:db-push` reproduces it. For that reason, do not use a PostgreSQL `SEQUENCE` for fencing tokens.
  - [ ] 1.8 Run `npm run prisma:validate --workspace backend` and `npx prisma generate`. Extend `test/migration-chain.prisma.e2e-spec.ts` so it asserts that `scheduler_job_leases`, `forms.deadline_at`, the `survey_attempts (status, started_at)` index and (if IR.2a is merged) `survey_attempts.closed_reason` exist after `migrate deploy` from an empty database.

- [ ] **Task 2: Shared primitives: clock, env flag, after-commit hook (AC1, AC6, AC8)**
  - [ ] 2.1 `apps/backend/src/common/time/clock.ts` (new):
    - `CLOCK` token, `interface Clock { now(): Date }`, `SystemClock`, and a test `FixedClock` (`set`/`advance`).
    - Register it in a `@Global()` provider (in `SchedulerModule` or a small `TimeModule`).
    - Wire it into `LedgerService` through the existing `clock` option (`ledger.service.ts:106-107, 264-278`) in the `economy.module.ts` factory. This lets Postgres-gated tests control the 48h maturity boundary.
    - Leave other services' `new Date()` calls alone unless a test needs them. Where a command reads `new Date()`, tests backdate data instead (e.g. `backdateAttempt` in `test/fixtures/participation.fixture.ts`).
  - [ ] 2.2 `apps/backend/src/common/config/env.schema.ts`:
    - Add `SCHEDULER_ENABLED: booleanEnv(false)`. Use the existing helper at :30-60; never `z.coerce.boolean()` (BE-9).
    - Add `SCHEDULER_TICK_SECONDS: z.coerce.number().int().min(1).max(300).default(15)` and `OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8)`.
    - Add typed getters `schedulerEnabled`, `schedulerTickSeconds` and `outboxMaxAttempts` to `env.service.ts`, following the style at :66.
    - Add commented lines to `apps/backend/.env.example`, and cases to `env.service.spec.ts` (true/false/invalid strings, bounds).
    - Keep per-job cadences, lease TTLs and batch sizes as code constants in `common/scheduler/scheduler.constants.ts`, not as env vars. Story 11.1 needs exactly one flag.
  - [ ] 2.3 `apps/backend/src/common/database/prisma-unit-of-work.ts`: add an after-commit hook.
    - Change the ambient store to `{ tx, afterCommit: Array<() => Promise<void>> }`.
    - Export `afterCommit(callback)`. Inside an ambient transaction it queues the callback, and the outermost `runInTransaction` runs the queue only after `$transaction` resolves. The queue is dropped on rollback. Callbacks never throw: catch and log.
    - Callbacks run **outside** the finished ambient ALS context (for example, after `ambientTransaction.run` returns). A callback that calls `runInTransaction` then opens a fresh transaction instead of reusing a closed one. IR.4b depends on this: its deferred `publish` writes the notification and a `NotificationEmailRequested` Outbox row in one notifications-local transaction.
    - Outside a transaction it runs the callback immediately.
    - Keep `currentClient` and `isInAmbientTransaction` behaviour identical, and extend `prisma-unit-of-work.spec.ts`.
  - [ ] 2.4 `apps/backend/src/modules/notifications/infrastructure/prisma-notification.repository.ts`: in `createIfAbsent`, when `isInAmbientTransaction()` is true, defer the `createMany({ skipDuplicates: true })` through `afterCommit` and return `true`.
    - This keeps the Story 9.6 contract ("published only after the source transaction commits") when a coordinator is called from inside an Outbox handler transaction.
    - Behaviour outside a transaction is unchanged. Add a spec for both branches: deferred then committed, and deferred then rolled back (no notification row).

- [ ] **Task 3: Scheduler runner and job leases (AC1, AC8)** in `apps/backend/src/common/scheduler/` (new; Platform Infrastructure, next to `common/system`)
  - [ ] 3.1 `scheduled-job.ts`:
    - `interface ScheduledJob { name: string; intervalMs: number; leaseTtlMs: number; run(ctx: JobRunContext): Promise<JobRunSummary> }`.
    - `JobRunContext = { runId: string; now: Date; owner: string; fencingToken: string; shouldContinue(): Promise<boolean> /* renews the lease with CAS; false when stopping or lease lost */; logger }`.
    - `JobRunSummary = { status: 'SUCCEEDED' | 'PARTIAL'; counts: Record<string, number>; hasMore: boolean }`.
    - `ScheduledJobRegistry.register(job)` rejects duplicate names. Jobs self-register in their module's `onModuleInit`, so `common/` never imports feature modules.
  - [ ] 3.2 `prisma-job-lease.repository.ts`. All SQL takes `$now` from `CLOCK`, never `now()`, so tests control time. Assumes one host clock (single VM, NTP).
    - `ensureJobs(names)`: `INSERT … ON CONFLICT (job_name) DO NOTHING`.
    - `tryAcquire(job, owner, now, ttl)`: `UPDATE scheduler_job_leases SET lease_owner=$owner, fencing_token=fencing_token+1, lease_expires_at=$now+$ttl, last_started_at=$now WHERE job_name=$job AND next_run_at <= $now AND (lease_owner IS NULL OR lease_expires_at < $now) RETURNING fencing_token`. Zero rows means not due or held elsewhere; log `SCHEDULER_CLAIM_CONFLICT` at debug level only when held.
    - `renew(job, owner, token, now, ttl)`: CAS on `lease_owner` and `fencing_token`.
    - `complete(job, owner, token, now, outcome)`: CAS. It sets `lease_owner = NULL`, `lease_expires_at = NULL`, `next_run_at`, `last_*` and `consecutive_failures`. Zero rows logs `SCHEDULER_STALE_LEASE` and changes nothing.
    - `BigInt` values from `$queryRaw` become strings at the boundary.
  - [ ] 3.3 `scheduler-runner.service.ts` (`@Injectable`, `OnApplicationBootstrap`, `OnModuleDestroy`; mirror the `SystemMetricsService` timer pattern at :62-101). It starts only if `env.schedulerEnabled && !env.isTest`.
    - One `setInterval(tick, SCHEDULER_TICK_SECONDS*1000)` with `.unref()`.
    - `tick()` is guarded by an in-flight flag, so ticks never overlap.
    - Jobs run **sequentially** within a tick, which keeps DB load and pool usage low on one replica.
    - The owner id is `${os.hostname()}:${process.pid}:${randomUUID()}`, logged once at start.
  - [ ] 3.4 Run semantics:
    - Acquire the lease, call `job.run(ctx)`, then `complete`.
    - `next_run_at`:
      - success: `now + intervalMs`
      - `hasMore` with the budget exhausted: `now + 5s` (catch-up)
      - failure: `now + min(intervalMs · 2^consecutiveFailures, 1h)`
    - A thrown job error never escapes the tick. It is logged and recorded.
    - Each job enforces a per-run budget (e.g. at most 20 batches) and calls `ctx.shouldContinue()` between batches.
  - [ ] 3.5 Graceful shutdown: `onModuleDestroy` clears the interval, sets `stopping`, and awaits the in-flight run for up to 10 s. `main.ts` already calls `enableShutdownHooks()` (:22). A run cut short leaves its lease to expire; the next owner re-acquires with a higher fencing token.
  - [ ] 3.6 Expose `runJobOnce(name)` and `tick()` for tests and for the dispatcher e2e. Do **not** expose them over HTTP.
  - [ ] 3.7 `scheduler.module.ts`: `@Global()`. It provides `CLOCK`, `ScheduledJobRegistry`, `OutboxHandlerRegistry`, the runner, the lease and claim repositories and `SchedulerHealthService`, and exports the registries, `CLOCK` and `SchedulerHealthService`. Import it in `app.module.ts` right after `PrismaModule`.

- [ ] **Task 4: Outbox dispatcher (AC6)** in `apps/backend/src/common/scheduler/outbox/`
  - [ ] 4.1 `outbox-handler.ts`:
    - `interface OutboxHandler { name: string /* globally unique, e.g. 'economy.internal-reward-settlement' */; eventType: string; schemaVersions: number[]; handle(event: OutboxEnvelope): Promise<void>; isRetryable?(error: unknown): boolean }`.
    - `OutboxEnvelope` is `{id, idempotencyKey, eventType, schemaVersion, producer, aggregateType, aggregateId, aggregateVersion, orderingStream, streamSequence, correlationId, causationId, payload: unknown, attempts, createdAt}`.
    - Handlers **must** parse `payload` with the shared Zod schema of their event.
    - `OutboxHandlerRegistry.register(handler)` rejects duplicate names.
    - **`outbox-handler.ts` must be framework-free:** no `@nestjs/*`, no `@prisma/client`, no "adapter" identifiers. A handler class may then live in a context's `application/` layer. IR.4b plans `notifications/application/email-delivery.handler.ts` (handler `notifications.email-delivery` for `NotificationEmailRequested`).
    - Registration always happens in Nest wiring: a module `onModuleInit` or an `infrastructure/*-outbox.registrar.ts` injects `OutboxHandlerRegistry` and the handler.
  - [ ] 4.2 Handler kinds (documented in the file header):
    - **(a) PostgreSQL-local effect:** the handler runs inside the dispatcher's transaction, and the effect, the `ProcessedHandler` row and the outbox state update commit together (AD-10). This is the only kind IR.2b ships.
    - **(b) External effect:** for example, IR.4b email. The handler first persists a delivery attempt keyed by `event.idempotencyKey`, calls the provider with that idempotency key, and reconciles the provider status on retry before acknowledging. An irreversible provider without idempotency or status lookup is not an approved adapter (AD-10).
  - [ ] 4.3 `prisma-outbox-claim.repository.ts`, `claimBatch(types, owner, token, now, leaseMs, limit)`, as one statement:
    ```sql
    WITH candidates AS (
      SELECT o.id FROM outbox_events o
      WHERE o.event_type = ANY($types)
        AND o.status IN ('PENDING','FAILED')
        AND o.available_at <= $now
        AND (o.claim_expires_at IS NULL OR o.claim_expires_at < $now)
        AND (o.ordering_stream IS NULL OR NOT EXISTS (
              SELECT 1 FROM outbox_events p
              WHERE p.ordering_stream = o.ordering_stream
                AND p.stream_sequence < o.stream_sequence
                AND p.status <> 'PROCESSED'))
      ORDER BY o.available_at, o.created_at, o.id
      LIMIT $limit
      FOR UPDATE OF o SKIP LOCKED)
    UPDATE outbox_events e
       SET claim_owner = $owner, claim_fencing_token = $token,
           claim_expires_at = $now + $leaseMs, attempts = e.attempts + 1, updated_at = $now
      FROM candidates c WHERE e.id = c.id
    RETURNING e.*;
    ```
    - `attempts` increments **at claim time**, so a crash loop still reaches the dead letter.
    - The fencing token is `${dispatcherLeaseFencingToken}.${claimBatchCounter}`. It increases monotonically across lease epochs and is unique per claim batch. The column is `TEXT`, and only equality is compared.
  - [ ] 4.4 Per claimed event and per handler that has **no** `ProcessedHandler` row for `(handler.name, event.id)`, run `runInTransaction`:
    1. `SELECT … FROM outbox_events WHERE id=$id AND claim_owner=$owner AND claim_fencing_token=$token FOR UPDATE`. Zero rows means a stale claimant: abort without effect and log `OUTBOX_STALE_CLAIM`.
    2. `handler.handle(envelope)`. Economy commands join the ambient Unit of Work.
    3. `INSERT INTO processed_handlers (id, handler_name, event_id, stream_sequence, processed_at)`.
    4. If this was the last pending handler, `UPDATE outbox_events SET status='PROCESSED', processed_at=$now, claim_* = NULL, last_error = NULL`.
    5. Commit. Notifications published inside the handler flush through `afterCommit` (Task 2.3/2.4).
  - [ ] 4.5 Failure path (separate short transaction, CAS on owner and token):
    - **Retryable:** `status='FAILED'`, `available_at = now + backoff(attempts)`, where backoff is 30 s · 2^(attempts−1), capped at 1 h, with ±20 % jitter. `last_error` is `"${name}: ${message}"` truncated to 500 characters, with no payload and no personal data. Claim columns are cleared.
    - `attempts >= OUTBOX_MAX_ATTEMPTS`: `status='DEAD_LETTER'`, `terminal_state='MAX_ATTEMPTS'`.
    - Payload Zod failure or unsupported `schemaVersion`: `DEAD_LETTER` immediately (`INVALID_PAYLOAD` / `UNSUPPORTED_SCHEMA_VERSION`).
    - `ConcurrentLedgerCommandException`, `IdempotencyConflictException` races and Prisma `P2034`/`P2028` are **retryable**. A unique violation inside an ambient transaction aborts it (Epic 6 review P14).
    - A dead-lettered event with an `orderingStream` blocks later sequences of that stream only (AD-10).
  - [ ] 4.6 `outbox-dispatch.job.ts` is itself a `ScheduledJob`:
    - Name `outbox-dispatch`, interval = tick, lease 60 s, batch 20, at most 10 batches per run.
    - It claims only `registry.subscribedEventTypes()`. It never marks an event PROCESSED without a handler.
    - Keep each handler transaction short. The Prisma interactive-transaction default timeout is 5 s (`maxWait` 2 s), and `runInTransaction` uses defaults.
  - [ ] 4.7 **Minimal audited dead-letter operations (AD-10 "audited re-drive"; Q9):**
    - New `admin-outbox.controller.ts` with `@Controller(['admin/outbox','api/admin/outbox'])`. The both-prefix rule is asserted in `test/architecture.spec.ts`.
    - Guards: `SessionAuthGuard, RolesGuard` with `@Roles('ADMIN')`. Mutations also use `CsrfGuard, JsonOnlyGuard` and a strict empty body.
    - `GET /admin/outbox/dead-letters?limit&cursor` returns `{id, eventType, aggregateType, aggregateId, attempts, terminalState, lastError, createdAt, updatedAt}`, **never the payload**.
    - `POST /admin/outbox/events/:eventId/redrive` moves `DEAD_LETTER → PENDING` with `attempts=0`, `available_at=now`, and keeps the event identity. It writes an admin audit entry through `AuditLogService` (exported by `admin.module.ts:55`). The event must be `DEAD_LETTER`, otherwise 409.
    - "Skip" is **not** offered, because money-stream skips need a compensating command (AD-10).

- [ ] **Task 5: `InternalRewardRequested` handler (AC6; closes Epic 5 DF1 for rewards)**
  - [ ] 5.1 `apps/backend/src/modules/economy/infrastructure/outbox/internal-reward-requested.handler.ts`, named `economy.internal-reward-settlement`, for event type `InternalRewardRequested`, schema version `[1]`.
    - Parse with `internalRewardRequestedPayloadSchema` (`packages/schemas/src/forms/internal-submission.schema.ts:53`).
    - Call `RewardSettlementCoordinator.settleInternalReward({ responseId, publisherId, respondentId, rewardPerResponse: payload.rewardAmount, policyMode })`, the same mapping as `ParticipationService.redriveInternalReward` (`participation.service.ts:1411-1461`).
    - The journal key `internal-reward:{responseId}` makes replay a no-op. `notifyRewardEarned` publishes only when it posts a new credit (decision E9-D2).
    - The handler self-registers in `onModuleInit`.
  - [ ] 5.2 The synchronous post-commit settlement in the submit path (`participation.service.ts:891-913`) stays, so rewards remain instant. The handler is the durable recovery path. To avoid needless contention with it, set `availableAt: new Date(submittedAt + 60_000)` on the `InternalRewardRequested` insert (`prisma-participation.repository.ts:803`) and on its in-memory twin (`in-memory-participation.repository.ts:604`). Do not change the `IntegrityAssessmentRequested` insert.
  - [ ] 5.3 A guest submission never writes this event (`prisma-participation.repository.ts:803` writes it only for a non-guest respondent). A zero-reward or `SKIPPED_GUEST` result is still a successful, recorded handling.

- [ ] **Task 6: Pending-release job (AC2)**
  - [ ] 6.1 `apps/backend/src/modules/economy/infrastructure/jobs/pending-release.job.ts`: name `pending-release`, interval 5 min, lease 5 min.
    - Loop `RewardSettlementCoordinator.releaseMaturedPendingRewards({ limit: 100, after })` (`reward-settlement.coordinator.ts:302`) while `hasMore` and `ctx.shouldContinue()`.
    - Summary counts: `processed`, `releasedCount`, `disputedCount`, `failedCount`.
  - [ ] 6.2 **Head-of-line fix:**
    - The scan re-reads the oldest unreleased credits every call (`prisma-ledger.repository.ts:220-296`). Today a credit that keeps failing "stays at the head of the queue" (Epic 6 DF1 note), and `limit` persistent failures would starve the job.
    - Add an optional keyset cursor `after` (`{createdAt, journalId}`, opaque base64url, server-issued only) to `findMaturedPendingCredits`, `LedgerService.findMaturedPendingCredits`, `ReleaseMaturedPendingRewardsParams` and the result (`nextCursor`). Mirror Story 6.5 P15 (`prisma-starter-points-data-provider.ts:104`).
    - Accept `after` on `releaseMaturedPendingRewardsSchema` (`packages/schemas/src/economy/reward.schema.ts:54`) as an optional, backward-compatible field.
    - Each job run starts without a cursor, so failed items are retried once per run.
  - [ ] 6.3 Do not change maturity, dispute or clamping semantics:
    - The cutoff is clamped to `now − 48h` (`PENDING_REWARD_MATURITY_MS`).
    - `EXTERNAL_DISPUTE_HOLD_QUERY_PORT` stays `NoExternalDisputeHolds` (Story 8.5 is Phase 2).
    - The notification stays `REWARD_RELEASED` with `dedupeKey = release-pending:{attemptId}`.
    - The starter unlock trigger `tryUnlockStarterPoints(…, 'PENDING_RELEASE')` stays.

- [ ] **Task 7: Starter-expiry job (AC3)**
  - [ ] 7.1 `apps/backend/src/modules/economy/infrastructure/jobs/starter-expiry.job.ts`: name `starter-expiry`, interval 1 h, lease 10 min.
    - Loop `StarterPointsCoordinator.expireUnmaturedStarterPoints(undefined, { limit: 100, after })` (`starter-points.coordinator.ts:387`) until `nextCursor === null` or the budget is spent. Persist nothing between runs; each run starts from the beginning.
    - Summary counts: `scannedCount`, `expiredCount`, `unlockedCount` (from `unlockedUserIds.length`), `deferredCount`, `failedCount`, `totalPointsVoided`.
    - **Never log `expiredUserIds` or `unlockedUserIds`.**
  - [ ] 7.2 Semantics stay identical to the Admin endpoint `POST /economy/starter-points/expire` (`starter-points.controller.ts:58-71`): the default cutoff is `now − 30 days`, catch-up unlock for `READY_TO_UNLOCK`, deferral for `PENDING_CONFIRMATION`, `WARNING` with dedupe = journal key, and the 7-day notification recovery window (`NOTIFICATION_RECOVERY_WINDOW_MS`).

- [ ] **Task 8: Reservation-expiry job (AC4; closes Epic 5 DF7)**
  - [ ] 8.1 Port: add `abandonExpiredAttemptsBatch(cutoff: Date, limit: number): Promise<{ abandonedIds: string[] }>` to `ParticipationRepositoryPort` (`participation-repository.port.ts:124-136`).
    - Prisma implementation (raw SQL, `prisma-participation.repository.ts`, next to `abandonExpiredAttemptsWith` at :348-364):
      ```sql
      WITH due AS (
        SELECT id FROM survey_attempts
        WHERE status = 'IN_PROGRESS' AND started_at < $cutoff
        ORDER BY started_at, id LIMIT $limit
        FOR UPDATE SKIP LOCKED)
      UPDATE survey_attempts sa
         SET status = 'ABANDONED', closed_reason = 'EXPIRED', closed_at = $now, updated_at = $now
        FROM due WHERE sa.id = due.id AND sa.status = 'IN_PROGRESS'
      RETURNING sa.id;
      ```
    - Implement the in-memory twin in `in-memory-participation.repository.ts:235-253`.
    - The lazy `abandonExpiredAttemptsWith` already writes `closedReason='EXPIRED'` after IR.2a T2.4. Do not duplicate that change.
  - [ ] 8.2 Why it does not race submit or verify:
    - Submit and verify lock in the order user advisory lock → `forms FOR SHARE` → `survey_attempts … FOR UPDATE` (`prisma-participation.repository.ts:668-895, 919-941, 1143-1238`) and write conditionally on `status='IN_PROGRESS'`.
    - The sweep locks only attempt rows with `SKIP LOCKED`, so it cannot deadlock and never waits on an in-flight submit.
    - Cutoff = `now − RESERVATION_EXPIRY_MS − 2 min grace` (`packages/schemas/src/participation/survey-attempt.schema.ts:9-10`). The sweep therefore only touches attempts the service already rejects (`participation.service.ts:705-724`, `:1064-1077`).
  - [ ] 8.3 Leave the Internal `Response` in `IN_PROGRESS`. `ResponseStatus` has no ABANDONED value, and the Attempt is authoritative (AD-19; Epic 5 DF7).
  - [ ] 8.4 **FR-23 regression guard (Q5):** today `reportMissingCompletionCode` rejects `ABANDONED` with `ATTEMPT_EXPIRED` (`participation.service.ts:1827-1829`) but accepts an expired `IN_PROGRESS` External attempt (`reservationExpired: true` evidence). Once the sweep runs, expired External attempts become ABANDONED within minutes, so the report must still be accepted for `status='ABANDONED' AND closed_reason='EXPIRED'` (recommended default). A `CANCELLED` attempt (IR.2a) stays rejected. Add a unit test and an e2e test.
  - [ ] 8.5 `apps/backend/src/modules/participation/infrastructure/jobs/reservation-expiry.job.ts`: name `reservation-expiry`, interval 5 min, lease 5 min, batch 200, and its own budget. Quota numbers must not change (they already use the time window; `getQuotaStatusWith` at :370-389). Assert this in a test.

- [ ] **Task 9: Deadline close + escrow refund job (AC5; closes Epic 6 DF6)**
  - [ ] 9.1 Deadline write path (scope per Q1, recommended default):
    - Accept optional `deadlineAt` (ISO datetime, at least now + 1 h, at most now + 180 days) in `createExternalSurveySchema` (`packages/schemas/src/forms/external-form.schema.ts:14`), `createFormDraftSchema` and `updateFormDraftSchema` (`form-draft.schema.ts:136, :185`). The field is editable only while the form is `DRAFT`. The schemas are strict, so the field must be added explicitly.
    - Persist it through the forms repository. Return `deadlineAt` in the form detail DTO; the frontend `manage-service.ts:38-39` already expects `deadlineAt`.
    - Wiring the create wizard (`apps/frontend/my-app/lib/forms/create-wizard.ts:412-420` deliberately omits it) belongs to IR.4.
  - [ ] 9.2 Stop new starts at the deadline:
    - In `reserveAttempt` (`prisma-participation.repository.ts:502-611`), under the existing `forms … FOR NO KEY UPDATE` lock, reject when `deadline_at <= now` with the existing `SURVEY_NOT_AVAILABLE`. No new error code.
    - Exclude past-deadline forms from the Marketplace feed (`marketplace/application/marketplace.service.ts:144`) and from the guest path (`marketplace/infrastructure/prisma-survey-response.repository.ts:51-85`).
  - [ ] 9.3 `FormRepositoryPort.findFormsPastDeadline(cutoff: Date, limit: number): Promise<string[]>` returns form ids with `status IN ('PUBLISHED','MODERATION_QUEUE') AND deadline_at <= $cutoff`, ordered by `deadline_at, id` (Q2).
  - [ ] 9.4 `FormsService.closeFormAtDeadline(formId: string, now: Date): Promise<{ closed: boolean; refundAmount: number; refundIdempotencyKey: string | null }>` (system actor, no requester):
    - Re-read the form. Skip (`closed:false`) if it is already closed, has no deadline, or the deadline is later than `now − grace`.
    - Grace = `RESERVATION_EXPIRY_MS + 2 min`, so attempts started before the deadline can still finish.
    - `form.close('DEADLINE', now)` (`form.entity.ts:110`).
    - Inside `unitOfWork.run('close-refund:{id}:c{n}', …)`, run the same optimistic `formRepository.update(…, { status, updatedAt })` that `closeForm` uses (`forms.service.ts:~985`), then `FormsEscrowCoordinator.coordinateClose(updatedForm, publisherId)` (`forms-escrow.coordinator.ts:259`).
    - A lost optimistic race (owner closed or reopened concurrently) is `closed:false`, not an error.
    - After commit, publish `ESCROW_RELEASED` to the Publisher with `dedupeKey = deadline-close:{formId}:c{closeCount}` and a message giving the refund amount (which may be 0). `ESCROW_RELEASED` exists in the enum but has no producer today.
    - Inject `NOTIFICATION_PUBLISHER_PORT` as an optional dependency in the `FormsService` factory (`forms.module.ts:74-93`), the same way the Economy coordinators do.
  - [ ] 9.5 Reopen (FR-33, Q3): recommended default is that `isOwnerReopenableClose` (`form-publish.schema.ts:61`) accepts `OWNER | DEADLINE`, and reopening a `DEADLINE` close requires a new `deadlineAt` that is null or in the future. Otherwise the job re-closes the survey on its next run.
  - [ ] 9.6 `apps/backend/src/modules/forms/infrastructure/jobs/deadline-close.job.ts`: name `deadline-close`, interval 5 min, lease 5 min, batch 25, one form per Unit of Work. Summary counts: `closedCount`, `skippedCount`, `failedCount`, `pointsRefunded`.
  - [ ] 9.7 Do not export `FormsEscrowCoordinator`. The job calls only `FormsService.closeFormAtDeadline`, keeping the AD-16 coordinator inside Research.

- [ ] **Task 10: Observability, readiness and metrics (AC8)**
  - [ ] 10.1 Structured logs via the Nest `Logger` (no new logger library). Include the owner, `fencingToken`, `runId` and `durationMs` where applicable.
    - `SCHEDULER_STARTED` / `SCHEDULER_DISABLED` once at boot
    - `SCHEDULER_JOB_RUN` with `{job, runId, owner, fencingToken, outcome, counts, durationMs}`
    - `SCHEDULER_CLAIM_CONFLICT`, `SCHEDULER_STALE_LEASE`
    - `OUTBOX_DISPATCHED`, `OUTBOX_RETRY_SCHEDULED`, `OUTBOX_DEAD_LETTERED`, `OUTBOX_STALE_CLAIM`
    - Every job run gets a fresh UUID `runId`. The Outbox logs use `event.correlationId ?? event.id` as the correlation id, plus `eventId`, `eventType`, `handler` and `attempts`.
    - No payloads, answers, user-identifying lists or balances appear in logs (AD-18, NFR-ADD-4).
    - Producers do not set correlation or causation ids yet (Epic 5 DF13); that stays out of scope.
  - [ ] 10.2 `SchedulerHealthService.snapshot(now)`:
    - `{ enabled, status: 'ok' | 'degraded' | 'disabled', jobs: [{name, lastStatus, lastFinishedAt, nextRunAt, consecutiveFailures, overdue}], outbox: { pending, retrying, deadLetter, oldestAvailableAgeSeconds, unsubscribedPending } }`.
    - `overdue` means `now − next_run_at > 3 × interval` while enabled.
    - `degraded` means any job is overdue or has `consecutiveFailures >= 3`, or the oldest subscribed available event is older than 15 min.
    - Use bounded aggregate queries (`count(*) … GROUP BY status` on subscribed types with indexes).
  - [ ] 10.3 `GET /system/health` (public, throttled; `system.controller.ts:21-33`) adds only `scheduler: { enabled, status }`. `GET /system/metrics` (ADMIN) and `SystemMetrics` (`system-metrics.interface.ts`) add the full snapshot. Story 11.1's readiness endpoint reuses `SchedulerHealthService`.

- [ ] **Task 11: Tests (AC1–AC8)** (see "Testing Requirements" for the full matrix)
  - [ ] 11.1 Unit specs, colocated `*.spec.ts` under `src/`:
    - runner: flag off means no timers; `isTest` means no timers; in-flight guard; shutdown; backoff scheduling
    - lease repository contract (via an in-memory double)
    - dispatcher state machine
    - backoff and jitter bounds
    - registries (duplicate names)
    - every job adapter: paging until `hasMore=false`, stopping on lease loss, summary without ids
    - `closeFormAtDeadline`
    - `abandonExpiredAttemptsBatch` in-memory
    - missing-code report on `ABANDONED/EXPIRED`
    - after-commit hook
    - notification deferral
  - [ ] 11.2 A Postgres-gated suite `apps/backend/test/scheduler.prisma.e2e-spec.ts`, following the pattern in `test/ledger-maturity-scan.prisma.e2e-spec.ts:26-122`:
    - `SCHEDULER_TEST_DATABASE_URL`, defaulting to `postgresql://rescom_admin:rescom_password@localhost:5433/rescom_scheduler_test`; the database name must end in `_test`
    - `probeDatabase()` decides between `it` and `it.skip`, and an explicit URL makes the suite fail rather than skip
    - `beforeAll` runs `prisma migrate deploy`
    - scenarios that need concurrent transactions use separate `PrismaService` instances and clean up in `afterEach`, because a single rolled-back transaction cannot show two claimants
  - [ ] 11.3 e2e (`test/scheduler.e2e-spec.ts`, `AppModule` with in-memory overrides as in the existing suites):
    - Booting with `SCHEDULER_ENABLED=false` runs nothing.
    - With `true` but `NODE_ENV=test`, nothing starts automatically.
    - `runJobOnce` works.
    - The AC7 fallback endpoints still pass their existing e2e suites unchanged (`reward-settlement`, `starter-points`, `ledger`, `forms-escrow`).
  - [ ] 11.4 Run `npm run test --workspace backend`, `npm run test:e2e --workspace backend` (with Postgres up for the `.prisma.e2e` suites), `npm run lint`/`typecheck`, and the `packages/schemas` tests. The baseline is 1814/1814 backend unit tests (readiness report).

- [ ] **Task 12: Documentation and tracking (no status file edits by the dev beyond this story)**
  - [ ] 12.1 Mark the closed items in `deferred-work.md` (Epic 6 DF1/DF2/DF6, Story 7.2 scheduler entry, Epic 5 DF1 for `InternalRewardRequested`, Epic 5 DF7, 5.3 DF11 if Task 13 is done) with "Resolved by IR.2b".
  - [ ] 12.2 Update the code comments that say the scheduler is deferred: `reward-settlement.coordinator.ts:293-298`, `ledger.controller.ts:159-162`, `starter-points.controller.ts:54`, and the `NotificationPublisherPort` doc (`notification-publisher.port.ts:9-24`). The latter must say that jobs and Outbox handlers exist, while option B of E9-D3 (every producer writes `NotificationRequested`) is still pending.
  - [ ] 12.3 Add a short "Scheduler operations" section to `apps/backend/README` or `docs/`: the flag, the job table, how to re-drive a dead letter, and how to disable the scheduler before an image rollback (see "Rollback note").

- [ ] **Task 13 (recommended, Q8): Re-host storage cleanup under the scheduler (closes 5.3 DF11)**
  - [ ] 13.1 Turn `StorageCleanupService` (`storage-cleanup.service.ts`) into a `ScheduledJob` named `storage-cleanup` (interval 1 h, lease 15 min) that calls the same `storageService.cleanupExpired(now, …)` (`storage.service.ts:517`). Remove its own `setInterval`. Keep `runCleanup()` never rejecting, and adapt `storage-cleanup.service.spec.ts`.

## Job Table

| Job (name) | Cadence (default) | Claim | Work selection (claim query) | Command reused | Idempotency key | Notification |
|---|---|---|---|---|---|---|
| `outbox-dispatch` | every tick (15 s) | job lease + per-row claim (`claim_owner`, `claim_fencing_token`, `claim_expires_at`) with `FOR UPDATE SKIP LOCKED` | Task 4.3 CTE: subscribed types, `status IN (PENDING, FAILED)`, `available_at <= now`, lease expired or unclaimed, no unprocessed earlier stream sequence | registered `OutboxHandler` (IR.2b: `economy.internal-reward-settlement`) | `ProcessedHandler (handler_name, event_id)` + the command's own key (`internal-reward:{responseId}`) | per handler: `REWARD_EARNED` (dedupe `internal-reward:{responseId}`), flushed after commit |
| `pending-release` | 5 min | job lease | `findMaturedPendingCredits(cutoff = now − 48 h, limit, after)`: `external-completion:%` journals with no `release-pending:` journal, not reversed, not dispute-settled | `RewardSettlementCoordinator.releaseMaturedPendingRewards` → `releasePendingReward` → `LedgerService.releasePendingReward` | `release-pending:{attemptId}` | `REWARD_RELEASED`, dedupe `release-pending:{attemptId}` (existing) |
| `starter-expiry` | 1 h | job lease | `findUsersForExpiry(cutoff = now − 30 d, {limit, after})`: FROZEN balance > 0, `users.created_at <= cutoff`, keyset `(created_at, user_id)` | `StarterPointsCoordinator.expireUnmaturedStarterPoints` → `LedgerService.expireStarterPoints` (or the catch-up unlock) | `starter-expiry:{userId}` (`starter-unlock:{userId}` for catch-up) | `WARNING` (expiry) / `ACCOUNT_ACTIVATED` (catch-up), dedupe = journal key (existing) |
| `reservation-expiry` | 5 min | job lease + attempt row lock `FOR UPDATE SKIP LOCKED` | `status='IN_PROGRESS' AND started_at < now − 30 min − 2 min` | new `ParticipationRepositoryPort.abandonExpiredAttemptsBatch` (global form of `abandonExpiredAttemptsWith`) | state-based: conditional `status='IN_PROGRESS'` update (no journal) | none |
| `deadline-close` | 5 min | job lease + optimistic form update (`status`, `updatedAt`) inside the Unit of Work | `findFormsPastDeadline(cutoff = now − 32 min)`: `status IN (PUBLISHED, MODERATION_QUEUE) AND deadline_at <= cutoff` | new `FormsService.closeFormAtDeadline` → `FormEntity.close('DEADLINE')` + `FormsEscrowCoordinator.coordinateClose` → `LedgerService.refundUnusedEscrow` | `close-refund:{formId}:c{closeCount}` | `ESCROW_RELEASED` to the Publisher, dedupe `deadline-close:{formId}:c{closeCount}` (new producer) |
| `storage-cleanup` (Task 13) | 1 h | job lease | existing `cleanupExpired` selection | `StorageService.cleanupExpired` | state-based (`StoredObject` state machine) | none |

Every job is safe to run twice or concurrently even without its lease: each item's effect is keyed by a unique journal key or a conditional state transition. The lease exists for single ownership, observability and bounded load, as AC1 requires. It is not the only double-processing guard.

## Dev Notes

### Mechanism decision: a custom `setInterval` runner with PostgreSQL leases, not `@nestjs/schedule`

- **Recommended:** implement the runner in-house (Task 3). Do **not** add `@nestjs/schedule`.
- **Reasons:**
  1. The current `@nestjs/schedule` is 12.0.2, and its peers are `@nestjs/common`/`core` `^11 || ^12`. This backend runs Nest `^10.4.15`, and only 4.x/5.x support Nest 10 (verified with `npm view` on 2026-09-30). Adding it means pinning an old major or upgrading Nest, which is out of scope.
  2. The jobs need intervals, not cron expressions. They also need a PostgreSQL lease and fencing check around every run, which `@Cron` does not provide (its locks are in-memory).
  3. The repository already uses the `OnApplicationBootstrap` + `setInterval` + `.unref()` + `OnModuleDestroy` pattern (`system-metrics.service.ts:62-101`), which is reviewed and tested with fake timers.
  4. Explicit `tick()`/`runJobOnce()` plus an injected `CLOCK` gives deterministic, clock-controlled tests.
- **Consistency with the architecture:**
  - AD-5 amendment: co-located in the API, one flag, same application services.
  - AD-10/AD-17: PostgreSQL is the only claim authority; owner, fencing token and lease; `availableAt`; retry and backoff; terminal dead letter; audited re-drive; idempotent commands.
  - AD-6: no Redis.
  - AD-23: no provider SDK or cloud scheduler.
  - When the dedicated worker returns (AD-5 triggers: Epic 10, a second replica, or latency), a `src/worker.ts` entrypoint boots the same `SchedulerModule` with `SCHEDULER_ENABLED=true`, and the API runs with `false`. No redesign is needed.
- **Accidental second owner:** `ABUSE_CONTROL_PROFILE=REDIS_SHARED` is already rejected at startup (`env.schema.ts:286-293`), so this build runs only as one replica. If two processes start anyway, the per-job lease plus the per-item idempotency keys keep processing single.

### Outbox producers today (all in-transaction with their business effect)

| eventType | Producer / file | idempotencyKey | orderingStream | IR.2b handler? |
|---|---|---|---|---|
| `InternalRewardRequested` | participation, `prisma-participation.repository.ts:803` | `internal-reward:{responseId}` | `internal-reward:{responseId}` #1 | **Yes**: `economy.internal-reward-settlement` |
| `IntegrityAssessmentRequested` | participation, `:836` | `integrity-assessment:{responseId}:{policyDeploymentId}` | `integrity:{responseId}` #1 | No (Epic 10, Phase 2); stays PENDING |
| `ExternalCompletionCodeMissingReported` | participation, `:1281` | `missing-code-report:{attemptId}` | none | No (Story 8.3, Phase 2) |
| `SurveyFeedbackSubmitted` | participation, `prisma-survey-feedback.repository.ts:54` (raw `$transaction`) | `survey-feedback:{attemptId}` | none | No |
| `AdminTopUpApproved` / `AdminTopUpRejected` | economy, `prisma-top-up.repository.ts:151` | `admin-audit:topup-approval:{id}` / `…-rejection:{id}` | none | No (Moderation audit projection not built) |
| `AdminSurveyApproved` / `AdminSurveyRejected` | moderation, `prisma-survey-moderation.repository.ts:67` | `admin-audit:moderation:{formVersionId}` | none | No |

- The only existing Outbox read is `findInternalRewardRequest` (`prisma-participation.repository.ts:1240-1248`), which re-drive uses to get the pinned payload. It must keep working, so never delete Outbox rows.
- Retention and purge of PROCESSED rows is out of scope.

### Notification semantics (Story 9.6, decision E9-D3)

- `NotificationPublisherPort.publish` never throws, is idempotent by `(userId, dedupeKey)` (`notifications_user_id_dedupe_key_key`), and must run only **after** the source commit.
- `PrismaNotificationRepository` deliberately writes outside the ambient Unit of Work (`prisma-notification.repository.ts:23-38`).
- Jobs call coordinators **outside** any ambient transaction, exactly like the Admin endpoints, so their notifications behave as they do today.
- The Outbox handler runs the coordinator **inside** the dispatcher transaction. That is why Task 2.3/2.4 adds `afterCommit` deferral: otherwise `REWARD_EARNED` could be written before, or without, the journal commit.
- E9-D3 option B (every producer emits `NotificationRequested` through the Outbox) is **not** in this story. It stays recorded in `deferred-work.md`.

### Files touched: current state, change and what to preserve

- `apps/backend/prisma/schema.prisma`
  - Now: `OutboxEvent` at :751-781 has lease columns that are never used. `ProcessedHandler` at :783-792 is unused. `Form` has no deadline. `FormCloseKind` is `OWNER | ADMIN | MODERATION`. `SurveyAttempt` has no expiry or abandon columns.
  - Change: Task 1.
  - Preserve: every existing column, index and partial unique index (`survey_attempts_one_active_per_account`, `…_one_completion_per_account`).
- `apps/backend/src/common/database/prisma-unit-of-work.ts`
  - Now: 59 lines; an ALS ambient transaction.
  - Change: the after-commit queue.
  - Preserve: `runInTransaction` joins an existing ambient transaction, `currentClient` behaviour, and `isInAmbientTransaction`. Every repository depends on these.
- `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts`
  - Now: `releaseMaturedPendingRewards` (:302) has no cursor; `releasePendingReward` (:235) publishes `REWARD_RELEASED` and triggers the starter unlock.
  - Change: the optional `after`/`nextCursor` pass-through.
  - Preserve: the maturity clamp, dispute and not-found classification as "disputed", and one failure never stopping the batch.
- `apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts:220-296`
  - Now: the maturity scan SQL.
  - Change: an optional keyset predicate `(j.created_at, j.id) > ($afterCreatedAt, $afterId)`.
  - Preserve: `ORDER BY created_at ASC, id ASC`, the dispute-settled CTE, and the reversal exclusion. The live SQL test is `test/ledger-maturity-scan.prisma.e2e-spec.ts`; extend it with the cursor.
- `apps/backend/src/modules/forms/application/forms.service.ts`
  - Now: `closeForm` (:929) needs a requester and sends no notification.
  - Change: add `closeFormAtDeadline`, and the `deadlineAt` persistence on create and draft update.
  - Preserve: `closeForm` behaviour, the `closeKind` rules (E8-D1), and the optimistic concurrency and Unit of Work key format.
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts`
  - Change: add the batch abandon, the `availableAt` delay on `InternalRewardRequested`, and the deadline check in `reserveAttempt`.
  - Preserve: lock order (user lock → form → attempt), the P2002 → `CONFLICTING_ACTIVE` / `ALREADY_SUBMITTED` mappings, and every existing Outbox insert shape.
- `apps/backend/src/common/system/*`: add health and metrics fields. Preserve the health throttle and the unauthenticated minimal payload.
- `apps/backend/src/app.module.ts`: import `SchedulerModule`, and keep the module order otherwise.

### Architecture guardrails (enforced by tests)

- `test/architecture.spec.ts:7-15` forbids `@nestjs/`, `@prisma/client`, `express`, `bcrypt`, `google-auth-library` **and any identifier matching `/adapter/i`** in `src/modules/*/domain|application/**`. So:
  - Job classes and Nest registrars live in `src/modules/<owner>/infrastructure/jobs|outbox/`. Framework-free handler classes may live in `application/` (IR.4b does this). IR.2b's Economy handler goes in `economy/infrastructure/outbox/`.
  - Runner and dispatcher code lives in `src/common/scheduler/` (outside `modules/`).
  - Do not name an application file `*adapter*`.
- Every controller registers a plain and an `api/` prefix (architecture test :137).
- Only the Notifications context may import its repository or service (architecture test :61). Other contexts use `NOTIFICATION_PUBLISHER_PORT` only.
- AD-16 ownership:
  - Jobs call the owner's commands. The scheduler never touches another context's tables.
  - The Outbox claim repository touches only `outbox_events`, `processed_handlers` and `scheduler_job_leases` (Platform Infrastructure).
- AD-1: no direct balance updates. Every point movement goes through the existing `LedgerService` commands.
- AD-7: Economy handlers depend on the `RewardSettlementCoordinator` application API, not on Prisma.

### Previous story intelligence

- **6.3:** close and refund keys are `close-refund:{formId}:c{closeCount}` (P3; `Form.closeCount`). The refund is the form's own Escrow position (P4). Completions after close are rejected under a form row lock (P6). Reuse `coordinateClose`; never recompute the refund in the job.
- **6.4:** the maturity scan is journal-derived (no `releasesAt` column; P2). Replay compatibility checks compare accounts and amounts (P8). The Admin re-drive controller lives in participation (P1). A known limitation is head-of-line failure, which Task 6.2 fixes.
- **6.5:** the expiry sweep is bounded and cursor-paged (P15). The self-healing starter grant (P10) is unchanged.
- **5.1:** lazy abandon runs inside the start transaction. Lock order is documented at `participation-repository.port.ts:314-326`. The fixed 30-minute window is decision E5-D2 (surveys longer than 30 minutes cannot be published). DF5: Postgres behaviour of these guards was never tested, so this story's Postgres suite must cover the sweep-vs-submit race for real.
- **9.6:** the publisher is optional-injected everywhere. A failing publish never changes the source result. Dedupe keys generally equal the journal key.
- **Epic 6 review P14:** a unique violation inside an ambient transaction aborts it, and repositories throw `ConcurrentLedgerCommandException` instead of converging. The dispatcher treats this as retryable.
- **E2E flake fix:** `test/setup-e2e.ts` binds apps to `127.0.0.1`. Reuse the existing jest-e2e config; do not add another.

### Git intelligence

The last 5 commits (`d1175eb`, `2c7ae67`, `9fd09d9`, `987d359`, `0628d8e`) touch only frontend analytics, planning documents and `docker-compose.yml`. No backend change since the Epic 6/9 reviews, so the code references above are current. `987d359` added the integration/deployment plan (A02: one API replica, one scheduler owner).

### Rollback note (expand-only migrations and previous-image rollback, Story 11.3)

- The new columns and tables are ignored by the previous image.
- A `FormCloseKind = 'DEADLINE'` row could fail strict Zod parsing in an older image if a DTO parses `closeKind` with `formCloseKindEnum`. Before rolling back past IR.2b:
  1. Set `SCHEDULER_ENABLED=false`.
  2. Accept that deadline-closed surveys may render as non-reopenable. Where parsing is strict, map an unknown `closeKind` to `null` in the new image's DTO so a future enum value cannot trap a later rollback.
- Document this in the operations section (Task 12.3).

### Project structure notes

- New directories: `apps/backend/src/common/scheduler/` (plus `outbox/`), `apps/backend/src/common/time/`, `apps/backend/src/modules/{economy,participation,forms}/infrastructure/jobs/`, and `apps/backend/src/modules/economy/infrastructure/outbox/`.
- Variance: the Structural Seed in the spine lists `src/worker.ts`. It is deliberately **not** created (AD-5 amendment). `SchedulerModule` is written so that a future worker entrypoint only needs to import it.

## Testing Requirements

Clock control: tests inject `FixedClock` through `CLOCK` and call `runner.runJobOnce(name)` / `tick()`. Do not use jest fake timers for DB-time logic. Fake timers are only for the runner's `setInterval` wiring. Where an existing command reads `new Date()`, backdate the data instead (ledger `created_at`, attempt `started_at`, user `created_at`, form `deadline_at`).

| # | Scenario | Level | Expectation |
|---|---|---|---|
| T1 | Flag off / `NODE_ENV=test` | unit + e2e | No timer is created and no lease row is claimed. Admin endpoints still work (AC7). |
| T2 | Two runners acquire the same job lease concurrently | Postgres | Exactly one gets a token, and the token is incremented. The loser logs a claim conflict. |
| T3 | Stale lease completion | Postgres | Owner A acquires; the clock passes the lease expiry; B acquires (token + 1). A's `complete`/`renew` updates 0 rows, and A's `shouldContinue()` returns false. |
| T4 | Crash after claim (Outbox) | Postgres | A claims an `InternalRewardRequested` event and stops without acknowledging. The clock passes `claim_expires_at`. B re-claims with a new token (`attempts=2`) and settles. There is exactly **one** `internal-reward:{responseId}` journal and one `ProcessedHandler` row. A's late acknowledgement is rejected (`OUTBOX_STALE_CLAIM`). |
| T5 | Handler atomicity | Postgres | A handler that throws after posting the journal leaves no journal, no `ProcessedHandler` row and no notification (the after-commit queue is dropped). The row becomes `FAILED` with `available_at` in the future. The retry succeeds once. |
| T6 | Concurrent dispatchers | Postgres | Two dispatchers claim 50 events in parallel (`Promise.all`). Each event is handled exactly once, with no duplicate `ProcessedHandler` row and no duplicate journal. |
| T7 | Retry/backoff/dead letter | unit + Postgres | Backoff stays within bounds. After `OUTBOX_MAX_ATTEMPTS` the row is `DEAD_LETTER`/`MAX_ATTEMPTS`. An invalid payload is dead-lettered at once. A dead-lettered stream event blocks later sequences of the same stream only. Admin re-drive resets the row, keeps its identity and writes an audit entry. |
| T8 | Unsubscribed types | Postgres | `IntegrityAssessmentRequested` and the others are never claimed, their `attempts` stays 0, and they appear in `unsubscribedPending`. |
| T9 | Pending-release boundary | Postgres | A credit created exactly 48 h − 1 ms before `now` is not released; at 48 h it is released. Running twice, or two runs in parallel, produces one `release-pending:` journal and one `REWARD_RELEASED`. |
| T10 | Pending-release head-of-line | unit + Postgres | More than `limit` persistently failing credits do not block newer mature credits within one run (cursor). |
| T11 | Starter-expiry boundary | Postgres or unit with backdated `users.created_at` | At 30 d − 1 ms no expiry; at 30 d the account expires once (`starter-expiry:{userId}`, `WARNING`). `READY_TO_UNLOCK` unlocks instead. `PENDING_CONFIRMATION` is deferred. A rerun changes nothing. |
| T12 | Reservation-expiry boundary and race | Postgres | An attempt at 30 min + grace − 1 ms stays `IN_PROGRESS`; past it, it becomes `ABANDONED`/`EXPIRED`. While transaction X holds `survey_attempts … FOR UPDATE` (a simulated submit), the sweep skips that row. After X completes, the row is `COMPLETED` and the sweep never touches it. Quota counts are identical before and after the sweep. |
| T13 | FR-23 after sweep | unit + e2e | A missing-code report on an External attempt that is `ABANDONED` with `closedReason='EXPIRED'` is accepted (Q5 default), and a `CANCELLED` one is rejected. |
| T14 | Deadline-close boundary | Postgres | `deadline_at + grace − 1 ms` gives no close; past it the form is `CLOSED`/`DEADLINE`, `closeCount + 1`, with one `close-refund:{formId}:c{n}` journal equal to the form's Escrow position and one `ESCROW_RELEASED` notice. A rerun closes nothing more. An owner close racing the job produces one close and one refund. |
| T15 | Deadline blocks new starts | e2e | Once the deadline passes, `POST` start returns `SURVEY_NOT_AVAILABLE` and the feed omits the survey. An in-flight attempt started before the deadline can still submit within its window. |
| T16 | No-double-journal invariant | Postgres | After running every job twice, including concurrently: `SELECT idempotency_key FROM ledger_journals GROUP BY 1 HAVING count(*) > 1` is empty; for each journal the entry sum is 0; every `ledger_balances` value equals the sum of its entries (use the existing reconcile helper if exposed); and no user-class balance is negative. |
| T17 | Notifications after commit | unit + Postgres | Inside an ambient transaction the publish is deferred. A commit writes exactly one row per `(userId, dedupeKey)`; a rollback writes none. |
| T18 | Health and metrics | unit + e2e | `/system/health` shows `scheduler.enabled/status` and no counts. `/system/metrics` (ADMIN) shows job and Outbox counts. An overdue job or 3 consecutive failures report `degraded`. |
| T19 | Migration chain | Postgres + static | `migrate deploy` from an empty DB and from the current snapshot succeeds. `migration-chain.spec.ts` stays green (no new `to_regclass`; invariants file unchanged). `prisma validate` passes. |

## Latest Technical Notes

- `@nestjs/schedule` latest is 12.0.2, with peers `@nestjs/common`/`core` `^11 || ^12`. Versions 4.x/5.x are the last to support Nest 10. It is not adopted (see the mechanism decision).
- Prisma 6.0.0 interactive transactions default to `timeout: 5000 ms` and `maxWait: 2000 ms`. Keep one handler or one form close per transaction, never a whole batch.
- `$queryRaw` returns PostgreSQL `BIGINT` as JS `bigint`. Serialize it to a string before logging or JSON.
- PostgreSQL 15 (local `postgres:15-alpine`; Cloud SQL PG in production) supports `FOR UPDATE SKIP LOCKED` inside a CTE, and `ALTER TYPE … ADD VALUE IF NOT EXISTS` inside a transaction, provided the new value is not used in that same transaction.
- Node 22 LTS: `setInterval(...).unref()` keeps timers from holding the event loop open. `enableShutdownHooks()` is already on (`main.ts:22`).

## Project Context Reference

- No `project-context.md` exists in the repository (the `persistent_facts` glob matched nothing). The project overview is `PROJECT_SUMMARY.md`, and the authority order is SPEC → PRD → ARCHITECTURE-SPINE → solution-design → epics → repository reality.
- Related stories:
  - IR.2a (owns `AttemptCloseReason` and `survey_attempts.closed_reason`/`closed_at`; its attempt read relies on this story's sweep to close expired attempts durably)
  - IR.3 (requires IR.2b)
  - IR.4b (`ir-4b-profile-update-email-delivery-admin-overview.md`: `NotificationsService.publish` writes a `NotificationEmailRequested` Outbox row, and the `notifications.email-delivery` handler, kind (b), runs on this dispatcher; it takes retry, backoff and dead-letter settings from IR.2b)
  - 11.1 (sets `SCHEDULER_ENABLED=true` in `docker-compose.prod.yml` and reuses `SchedulerHealthService` for readiness; it must **not** re-implement the scheduler)

## Questions / Decisions for Owner

Each question has a recommended default that the dev implements unless the owner decides otherwise.

1. **Q1: Survey deadline source (FR-32/NFR-12).** The backend has no deadline, and the frontend keeps `deadlineAt` UI-only.
   - **Default:** add `forms.deadline_at` plus an optional `deadlineAt` on external create and draft create/update (1 h to 180 d ahead, editable only in DRAFT), returned in the detail DTO. Frontend wiring comes in IR.4.
   - Alternatives: column plus a dormant job only (no write path yet), or an implicit deadline such as `publishedAt + N days`.
   - Also confirm the 180-day maximum.
2. **Q2: What the deadline job closes.**
   - **Default:** `PUBLISHED` and `MODERATION_QUEUE` surveys; new starts blocked at the deadline; close at deadline + 32 min, so in-flight attempts can finish.
   - Alternative: `PUBLISHED` only.
3. **Q3: Can a `DEADLINE` close be reopened (FR-33)?**
   - **Default:** yes, by the owner, only with a new future deadline or none.
   - Alternative: deadline closes are final, like Admin takedowns.
4. **Q4: Publisher notification scope.**
   - **Default:** `ESCROW_RELEASED` only for system (deadline) closes.
   - The Admin-takedown notification remains the Story 8.1 follow-up, and an owner's own close sends nothing. Confirm.
5. **Q5: FR-23 missing-code reports after the reservation sweep.**
   - **Default:** accept a report on `ABANDONED` attempts whose `closed_reason='EXPIRED'` (IR.2a column; today the same report works while the attempt is still `IN_PROGRESS`).
   - Alternative: exclude External attempts from the sweep.
6. **Q6: Per-item dead letter for scanner jobs (AD-17 wording).**
   - **Default:** scanner jobs retry failed items on every run (cursor-paged, idempotent keys), expose `failedCount` and `consecutiveFailures`, and rely on the existing audited Admin endpoints for manual re-drive. There is no per-item dead-letter table.
   - Alternative (heavier): every due item is enqueued as an Outbox command event, so it gets per-item retry and dead-letter semantics.
   - The Architect should record the chosen reading of AD-17 as a spine note.
7. **Q7: Event types with no consumer.**
   - **Default:** leave `IntegrityAssessmentRequested`, `ExternalCompletionCodeMissingReported`, `SurveyFeedbackSubmitted` and the admin-audit events `PENDING` (unclaimed) for their future consumers, and report them as informational backlog.
   - Alternative: register explicit no-op handlers now, which would mark them PROCESSED and lose them for Epic 10 / 8.3.
8. **Q8: Re-host `StorageCleanupService` under the scheduler (Task 13, closes 5.3 DF11)?**
   - **Default:** yes. Consequence: no upload cleanup when `SCHEDULER_ENABLED=false` (local dev).
9. **Q9: Admin dead-letter list and re-drive endpoints in IR.2b (Task 4.7)?**
   - **Default:** yes, minimal and audited, with no "skip".
   - Alternative: defer them and re-drive through SQL runbooks during the pilot.
10. **Q10: Default cadences.** Outbox 15 s, pending release 5 min (release lands within about 5 min after 48 h), starter expiry hourly, reservation expiry 5 min, deadline close 5 min, and `OUTBOX_MAX_ATTEMPTS=8` (about 2 h of backoff). Confirm, or name the SLOs.
11. **Q11: Stale PENDING top-up expiry (OC4 / 6.6 DF12).** Not in the IR.2b ACs.
    - **Default:** out of scope.
    - If the PO confirms a 7-day expiry, it can become one more job on this runner in a follow-up story.
12. **Q12: Merge order with IR.2a.**
    - **Default:** IR.2a's migration (`AttemptCloseReason`, `closed_reason`, `closed_at`) merges before IR.2b's Task 8, and IR.2b adds only the `(status, started_at)` index.
    - If IR.2b must go first, it creates the identical enum and columns in a drift-tolerant way (Task 1.5). Confirm the order with the IR.2a owner.

## Dev Agent Record

### Agent Model Used

(to be filled by dev agent)

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created (create-story, 2026-09-30).

### File List

(to be filled by dev agent)

## Change Log

- 2026-09-30: Story created (create-story workflow, non-interactive). Status → `ready-for-dev`.
