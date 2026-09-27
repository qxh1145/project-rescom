---
baseline_commit: 378e4a71ff125fb1acf6ee18291fc298ae56bf94
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "_bmad-output/implementation-artifacts/4-5-external-survey-setup-google-forms.md"
  - "_bmad-output/implementation-artifacts/6-4-respondent-point-credit-pending-logic.md"
  - "apps/backend/src/modules/forms/infrastructure/completion-code.service.ts"
  - "apps/backend/src/modules/participation/application/participation.service.ts"
  - "apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts"
---

# Story 5.5: External Form Completion Code Verification

Status: done

## Story

As a Respondent,
I want to enter the Completion Code I received from an external survey (e.g., Google Forms),
So that I can prove I finished it and claim my points.

## Acceptance Criteria

### AC1 — External Completion Shared Schemas & Contracts (`packages/schemas`, FR-22, FR-23)
**Given** an external survey attempt
**When** defining validation and API request/response contracts
**Then**:
1. Defines `verifyExternalCompletionCodeInputSchema` / `VerifyExternalCompletionCodeInput`:
   - `attemptId`: optional UUID string (validated if provided, or from route param)
   - `completionCode`: 6-digit numeric string (trimmed, regex `/^\d{6}$/`)
   - `clientContext`: optional record of client metadata
2. Defines `verifyExternalCompletionCodeResponseSchema` / `VerifyExternalCompletionCodeResponseDto`:
   - `attemptId`: string UUID
   - `formId`: string UUID
   - `formVersionId`: string UUID
   - `status`: `'COMPLETED'`
   - `completedAt`: ISO datetime string
   - `reward`: `RewardSettlementResultDto` (reflecting PENDING credit with 48h lock)
   - `message`: string confirmation message
3. Defines `reportMissingCompletionCodeInputSchema` / `ReportMissingCompletionCodeInput`:
   - `attemptId`: optional UUID string
   - `reason`: string, trimmed, min 5, max 1000 characters
   - `clientContext`: optional record
4. Defines `reportMissingCompletionCodeResponseSchema` / `ReportMissingCompletionCodeResponseDto`:
   - `attemptId`: string UUID
   - `reportedAt`: ISO datetime string
   - `status`: `'REPORTED'`
   - `message`: string confirmation message
5. Exports all schemas and TypeScript types from `@rescom/schemas`.

### AC2 — Server-Authoritative Time Barrier Verification (`apps/backend`, FR-13, FR-22)
**Given** an external survey verification request
**When** checking elapsed participation time
**Then**:
1. Server checks `elapsedSeconds = (now - attempt.startedAt) / 1000` using the server-authoritative `startedAt` timestamp (client time is never trusted).
2. Verifies `elapsedSeconds >= minTimeBarrierSeconds` (from FormVersion metadata or default threshold).
3. If elapsed time is less than `minTimeBarrierSeconds`:
   - Throws `SubmissionTooFastException` with structured details (time remaining, elapsed, required).
   - Records a `FraudLog` entry with type `TIME_BARRIER` and attempt metadata.
   - Time barrier rejection does NOT count toward the 3 failed code attempts.

### AC3 — Keyed Verifier Constant-Time Verification & Abuse Prevention (`apps/backend`, FR-22, AD-16)
**Given** a candidate 6-digit completion code
**When** verifying the code against the pinned FormVersion
**Then**:
1. Fetches the exact immutable `FormVersion` pinned by the active `SurveyAttempt`.
2. Validates candidate code in constant time using `CompletionCodePort.verifyCode(formVersionId, candidateCode, formVersion.completionCode)`.
3. Plaintext completion code is NEVER written to logs, console, audit logs, or error responses.
4. If code is invalid:
   - Increments failed verification count for the attempt.
   - Records `FraudLog` entry with type `SECURITY_VIOLATION`.
   - If failed attempts reach 3:
     - Atomically transitions `SurveyAttempt.status` to `LOCKED`.
     - Throws `AttemptLockedException` (HTTP 423/409).
   - If failed attempts < 3:
     - Throws `InvalidCompletionCodeException` (HTTP 400) indicating remaining attempts allowed.

   > **Amendment 2026-09-26 (code-review decision E5-D1, option B — values provisional pending PRD Open Question 14):** the versioned policy `completion-code-policy-v1` adds an account-plus-FormVersion limit: wrong codes are summed across all of the account's attempts on the FormVersion (server-owned `survey_attempts.failed_code_verifications`, minus what an Admin forgave). At 6, further attempts on that version are refused at start and at verification (before the code is compared) with 409 `COMPLETION_CODE_LIMIT_REACHED`; a wrong code that reaches 6 locks its attempt even below 3; "remaining attempts" = min(3 − attempt failures, 6 − account failures). No automatic reset: an Admin recovers the account through `POST /admin/completion-code-limits/reset` (audited reset row; attempts and FraudLog evidence untouched). A new FormVersion (new code) starts a fresh count.

### AC4 — Atomic Unit of Work & Economy Pending Settlement (`apps/backend`, FR-24, AD-16)
**Given** a verified completion code and elapsed time barrier
**When** committing the completion claim
**Then**:
1. A named Participation coordinator commits the completion claim and Economy Pending journal under one shared Unit of Work keyed `external-completion:${attemptId}`:
   - Transitions `SurveyAttempt.status` to `COMPLETED` and sets `submittedAt = now`.
   - Invokes `LedgerService.creditPendingReward` to move `rewardPerResponse` points from Publisher `ESCROW` to Respondent `PENDING` account.
2. Failure in either rolls both back; retrying a completed attempt returns the original success result idempotently without duplicate point movements.

### AC5 — Alternate Flow: Missing Code Report (`apps/backend`, FR-23)
**Given** a respondent who completed an external survey where the Publisher failed to provide a completion code
**When** the respondent submits a "Missing Code Report"
**Then**:
1. Verifies the attempt belongs to the caller and is currently `IN_PROGRESS`.
2. Records the report details (`reason`, `reportedAt`) in the attempt metadata and logs an audit/moderation entry for Admin investigation.
3. Returns confirmation with instructions that the admin will review and compensate within 24 working hours.

### AC6 — Frontend Respondent External Survey View (`apps/frontend/my-app`, FR-22, FR-23, UJ-2)
**Given** a respondent participating in an external survey
**When** navigating to `/forms/[id]/respond?attemptId=[attemptId]`
**Then**:
1. Displays dedicated external survey completion view:
   - External Google Forms link with "Re-open Survey" button.
   - Time barrier countdown indicator if minimum time has not elapsed.
   - 6-digit completion code input field.
   - Failed attempts remaining indicator.
   - "Verify & Claim Reward" button (disabled while timer is active or if locked).
   - "Report Missing Code" alternate action modal for reporting missing publisher codes.
   - Success state showing points credited to Pending Balance (48-hour maturity period).

### AC7 — Verification & Monorepo Test Coverage
**Given** unit, integration, and E2E test suites
**When** running verification
**Then**:
1. Unit tests for schemas and DTOs in `packages/schemas`.
2. Service unit tests for `ParticipationService.verifyExternalCompletionCode` and `reportMissingCompletionCode`.
3. E2E tests in `apps/backend/test/external-completion.e2e-spec.ts`.
4. Monorepo verification passes with 0 errors.

---

## Tasks & Subtasks

- [x] **Task 1: Shared Schemas & Contracts (`packages/schemas`)** (AC: 1)
  - [x] 1.1 Define `verifyExternalCompletionCodeInputSchema` and `verifyExternalCompletionCodeResponseSchema`.
  - [x] 1.2 Define `reportMissingCompletionCodeInputSchema` and `reportMissingCompletionCodeResponseSchema`.
  - [x] 1.3 Export types and schemas from `packages/schemas/src/forms/external-completion.schema.ts` and barrel exports.
  - [x] 1.4 Add schema unit tests in `packages/schemas/src/forms/external-completion.schema.spec.ts`.

- [x] **Task 2: Backend Participation Repository & Abuse Tracking (`apps/backend`)** (AC: 2, 3, 5)
  - [x] 2.1 Update `ParticipationRepositoryPort` with `recordFailedAttemptVerification`, `lockAttempt`, `completeExternalAttemptTransaction`, and `reportMissingCompletionCode`.
  - [x] 2.2 Implement methods in `PrismaParticipationRepository` and `InMemoryParticipationRepository`.
  - [x] 2.3 Implement exception classes (`InvalidCompletionCodeException`, `AttemptLockedException`, `AttemptNotExternalException`) and register in `http-exception.filter.ts`.

- [x] **Task 3: Backend External Completion Coordination (`apps/backend`)** (AC: 2, 3, 4, 5)
  - [x] 3.1 Implement `verifyExternalCompletionCode` in `ParticipationService` with constant-time verification, time barrier check, 3-attempt locking, and atomic settlement via `RewardSettlementCoordinator`.
  - [x] 3.2 Implement `reportMissingCompletionCode` in `ParticipationService`.
  - [x] 3.3 Add unit tests in `apps/backend/src/modules/participation/application/participation.service.spec.ts`.

- [x] **Task 4: Presentation Endpoints & Wire-Up (`apps/backend`)** (AC: 1, 3, 4, 5)
  - [x] 4.1 In `ParticipationController`, add `POST forms/:id/attempts/:attemptId/verify-code` and `POST forms/:id/attempts/:attemptId/report-missing-code` (with survey and attempt alias routes).
  - [x] 4.2 Add controller unit tests in `apps/backend/src/modules/participation/presentation/participation.controller.spec.ts`.
  - [x] 4.3 Add integration/E2E tests in `apps/backend/test/external-completion.e2e-spec.ts`.

- [x] **Task 5: Frontend External Completion Experience (`apps/frontend/my-app`)** (AC: 6)
  - [x] 5.1 Add API client functions in `apps/frontend/my-app/app/marketplace/participation-api.ts`.
  - [x] 5.2 Implement `ExternalSurveyCompletionView` in `apps/frontend/my-app/app/forms/[id]/respond/page.tsx` with 6-digit code input, live time barrier timer, attempt locking warning, missing code reporting modal, and pending points reward card.
  - [x] 5.3 Update `MarketplaceCard.tsx` external survey routing.

- [x] **Task 6: Verification & Definition of Done** (AC: 7)
  - [x] 6.1 Run all unit tests, integration tests, E2E tests across all workspaces.
  - [x] 6.2 Check for zero regressions and full type safety.
  - [x] 6.3 Update story file checkboxes, Dev Agent Record, File List, and set Status to `review`.
  - [x] 6.4 Update `sprint-status.yaml` status to `review`.

### Review Findings

_Epic 5 code review, 2026-09-26 (triage IDs in brackets; applied after the Epic 4 and Epic 6 review patches). Dismissed items are summarized in Story 5.1._

- [x] [Review][Decision] Account-plus-FormVersion completion-code limit: what happens after an attempt is LOCKED (D1, medium) — a LOCKED attempt blocks nothing: the user starts a new attempt and gets 3 more guesses against the same per-version code (only the 8.2 burst limit and the ≥ 15 s barrier slow this down). FR-22 leaves maximum failures, lock duration and recovery to versioned security policy (OQ14). Options: (A) hard lock per account + FormVersion (409 `COMPLETION_CODE_LIMIT_REACHED` on start and verify) until an Admin resolves it via FR-23, a new FormVersion resets it; (B) cumulative cap via a versioned `completion-code-policy-v1`: 3 tries per attempt and N per account + FormVersion (e.g. 6), then block as in A; (C) time-based cooldown of X hours after a lock, then 3 more tries. **Triage recommendation: B** — 3 per attempt, 6 per account + FormVersion, no automatic reset, Admin recovery; enforce in `startAttempt` and before the code comparison; count `SUM(failed_code_verifications)` over the respondent's attempts on the `form_version_id`; values provisional pending OQ14. Decision-independent part applied: P2's server-owned `survey_attempts.failed_code_verifications` column is the counter option B would sum. [apps/backend/src/modules/participation/application/participation.service.ts:855] — **Resolved 2026-09-26:** option B accepted by Quan; versioned `completion-code-policy-v1` in `@rescom/schemas` (3 wrong codes lock an attempt; 6 per account and FormVersion summed across attempts from the server-owned `failed_code_verifications`, minus Admin-forgiven ones) — provisional pending PRD Open Question 14 (recorded in the PRD FR-22 amendment and `deferred-work.md`). Enforced in `startAttempt` (pre-check + inside the reservation transaction under the form row lock) and under the attempt lock before the code comparison (409 `COMPLETION_CODE_LIMIT_REACHED` with `{ formVersionId, failedVerifications, limit, policyVersion }`, no strike); a wrong code that reaches 6 locks the attempt; remaining tries = min(attempt, account). No automatic reset: Admin recovery via `POST /admin/completion-code-limits/reset` (Admin + CSRF + JSON, reason required) writing an append-only `completion_code_limit_resets` audit row (migration `20260927010000_completion_code_limit_resets`); a new FormVersion starts a fresh count. Mock journey mirrors it. Tests: schemas, repository (mocked tx), service, controller, e2e, frontend mock.
- [x] [Review][Patch] Security counters live in the client-writable `clientContext`: the 3-strike lock can be bypassed and missing-code reports suppressed (P2, high) — fixed: server-owned columns `failed_code_verifications`, `last_failed_verification_at`, `missing_code_reported_at`, `missing_code_reason` (Prisma fields, entity `codeVerification`, mapper), added by migration `20260926230000_participation_concurrency_guards`, which backfills the counter from numeric JSON values only (clamped 0..3) and the marker from existing `missing-code-report:{id}` Outbox rows only, then strips `failedVerifications`, `lastFailedAt` and `reportedMissingCode` from `client_context`. `recordFailedAttemptVerification` increments the column under `FOR UPDATE` and never reads the JSON; `reportMissingCompletionCode` is a compare-and-set (`updateMany where missingCodeReportedAt: null`) that writes exactly one Outbox row; `remainingAttempts = min(3, max(0, 3 − failures))`. Every `clientContext` (start, verify, report, submit) is bounded: a flat record, keys ≤ 64 chars, values string ≤ 256 / finite number / boolean / null, ≤ 20 keys, ≤ 2 KB; server logic never reads it. Tests: a seeded `failedVerifications: -1000000` has no effect and the third wrong code locks; a seeded `reportedMissingCode` still yields exactly one Outbox row; a nested/oversized context → 400; the repository spec asserts no JSON counter is read. [apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts:711]
- [x] [Review][Patch] Parallel code guesses exceed the 3-strike limit and reveal the correct code through different "locked" messages (P6, medium) — fixed (Epic 6 P6 step 1's form-status check was already before the code check): the status check, the constant-time comparison and the strike or claim run in one `unitOfWork.run('external-completion:{attemptId}')` unit: `lockAttemptForVerification` (forms `FOR SHARE` → attempt `FOR UPDATE`) → COMPLETED ⇒ replay (P19), LOCKED ⇒ locked, not IN_PROGRESS ⇒ expired → compare → a mismatch increments in the same transaction and its error is thrown only after the unit committed (a strike is never rolled back) → a match claims and settles as before. The time barrier, rate limit and form status stay before the lock so they never burn a try. Every locked reply carries the same `ATTEMPT_LOCKED` body. Test: 5 wrong codes and 1 right code in parallel (serializing Unit of Work) → ≤ 3 strikes, no settlement, identical locked bodies. The PostgreSQL variant is in DF5 (Story 5.1). [apps/backend/src/modules/participation/application/participation.service.ts:985]
- [x] [Review][Patch] An unusable verifier is counted as the respondent's strike, so honest respondents are locked and logged as security violations (P9, medium) — fixed: `CompletionCodePort.canVerify(stored)` (parses, configured key version, 64-hex digest); an unverifiable version or a missing completion-code service → 404 `SURVEY_NOT_AVAILABLE` "Completion code verification is unavailable for this survey version" before any strike or FraudLog entry, plus an operational warning (never the code). Fail-safe behind Epic 4 P2/P7. Tests: null / malformed / unknown-key verifier and a missing service → no strike, no FraudLog. [apps/backend/src/modules/participation/application/participation.service.ts:969]
- [x] [Review][Patch] The External replay re-settles at the *current* price instead of returning the recorded journal (P19, low) — partly covered already by Epic 6 P5/P8 (an existing journal was returned as is); the remainder is fixed: every replay (fast path, a concurrent winner, or ALREADY_COMPLETED) is read-only via `RewardSettlementCoordinator.findExternalSettlement(attemptId)` — amount and message come from the posted journal, amount 0 when none was posted — and never posts. A missing journal is recovered only through the Admin re-drive (Epic 6 P1). Tests: replay after a price edit → original amount, no new journal; a reward-0 completion replays as 0. [apps/backend/src/modules/participation/application/participation.service.ts:1135]
- [x] [Review][Patch] Missing-code reports: no External check and no timing evidence for the Admin (P20, low) — fixed: the form must be EXTERNAL (else 400 `ATTEMPT_NOT_EXTERNAL`); the `COMPLETION_CODE` burst limit applies; the Outbox payload adds `startedAt`, `elapsedSeconds`, `requiredBarrierSeconds` and `reservationExpired`; expired attempts may still report (the honest case). Tests. [apps/backend/src/modules/participation/application/participation.service.ts:1469]
- [x] [Review][Defer] Missing-code reports never reach an Admin (no consumer, no admin read path) while the reply promises compensation "within 24 working hours" (DF2, medium) [apps/backend/src/modules/participation/application/participation.service.ts:1469] — deferred: the Admin portal and the Outbox worker are deferred (8.3 is Phase 2); soften the copy at the live API swap. The worker gap itself is DF1 (Story 5.4).

---

## Dev Notes

- **Cryptographic Security (FR-22, AD-16):** Verification must use `CompletionCodeService.verifyCode()` using constant-time comparison `crypto.timingSafeEqual` against the HMAC verifier `<keyVersion>:<digest>` bound to the pinned `FormVersion`.
- **Zero Plaintext Code Logging:** The plaintext 6-digit code input must NEVER appear in application logs, audit logs, `FraudLog`, or error payloads.
- **3-Attempt Lockout:** 3 failed verification attempts lock the `SurveyAttempt` (`status = LOCKED`), and records a `FraudLog` entry (`SECURITY_VIOLATION`).
- **Time Barrier (FR-13):** Must enforce server-side `(now - attempt.startedAt) >= minTimeBarrierSeconds`.
- **Atomic Unit of Work (AD-16, FR-24):** Keyed `external-completion:${attemptId}`. `SurveyAttempt.status = COMPLETED` and Economy pending reward journal credit both commit or both roll back.

### References
- `_bmad-output/planning-artifacts/epics.md`#Story-5.5
- `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md`#AD-16
- `apps/backend/src/modules/forms/infrastructure/completion-code.service.ts`
- `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts`

## Dev Agent Record

### Agent Model Used
Gemini 3.8 Flash (High) — initial implementation (2026-09-24); Claude Opus 5.5 (claude-opus-5-5) — AD-16 hardening, frontend completion and verification (2026-09-26).

### Implementation Plan
- Verification order in `ParticipationService.verifyExternalCompletionCode`: ownership → pinned FormVersion → idempotent COMPLETED fast path → LOCKED/ABANDONED/expired checks → server-authoritative time barrier (FraudLog `TIME_BARRIER`, does not count as a strike) → constant-time keyed verifier (`CompletionCodePort.verifyCode`) → failure counting/locking → atomic claim + Pending credit.
- AD-16 shared Unit of Work: new `UnitOfWorkPort` (`common/database/unit-of-work.port.ts`) with a Prisma adapter (`prisma-unit-of-work.ts`) that keeps the interactive transaction in `AsyncLocalStorage`. `runInTransaction` lets owner repositories join the ambient transaction, so `PrismaParticipationRepository.completeExternalAttemptTransaction` (Participation-owned `survey_attempts`) and `PrismaLedgerRepository.postJournalTransaction` (Economy-owned ledger tables) commit or roll back together under key `external-completion:${attemptId}`. Each owner still writes only its own tables.
- Concurrency: the claim locks the attempt row (`SELECT … FOR UPDATE`) and transitions only IN_PROGRESS → COMPLETED, returning `COMPLETED | ALREADY_COMPLETED | NOT_CLAIMABLE`. The failure counter is also row-locked, so parallel wrong guesses cannot bypass the 3-strike lock.
- Missing-code reports are an Admin investigation request, not abuse: they are stored on the attempt and queued as an `ExternalCompletionCodeMissingReported` Outbox event (`missing-code-report:${attemptId}`, idempotent) instead of a `SECURITY_VIOLATION` FraudLog entry, which would have flagged the reporter.
- Frontend follows the human-owned mock-first respondent journey spec (`spec-mock-respondent-journey.md`: "Never call the live backend in this demo journey"). The dedicated external completion view lives at `/attempts/[id]`; `/forms/[id]/respond?attemptId=…` redirects EXTERNAL surveys there, and `MarketplaceCard` routes EXTERNAL surveys to it. The typed live-API client (`participation-api.ts`) is ready for the later API adapter swap.

### Debug Log References
- Found story tasks unchecked although the backend, schemas, API client and e2e suite already existed; audited each against the ACs before checking them.
- Gaps found and fixed: claim and Pending credit were two independent commits (violated AC4 / AD-16); unconditional COMPLETED update could overwrite a concurrent LOCKED state; failure counter had a lost-update race; missing-code report was written to FraudLog as `SECURITY_VIOLATION`; frontend had no remaining-attempts indicator, the mock never locked after 3 wrong codes, and mock codes (`RES689`) violated the 6-digit numeric contract.

### Completion Notes List
- ✅ AC1: shared schemas in `packages/schemas/src/forms/external-completion.schema.ts` with unit tests.
- ✅ AC2/AC3: time barrier, constant-time verifier, zero plaintext logging, 3-strike lock (`InvalidCompletionCodeException` with remaining attempts, `AttemptLockedException`), and race-safe failure counting.
- ✅ AC4: claim + `LedgerService.creditPendingReward` run inside `UnitOfWorkPort.run('external-completion:${attemptId}')`; retries return the original completion time without duplicate journals. New unit tests cover Unit of Work keying, failure propagation (rollback), concurrent lock, and concurrent claim; `prisma-unit-of-work.spec.ts` covers ambient transaction reuse, rollback propagation, and no context leakage.
- ✅ AC5: missing-code report is ownership- and status-checked, idempotent, and queued for Admin review via the Outbox. The e2e test asserts the Outbox event, no FraudLog entry, and a stable `reportedAt` on retry.
- ✅ AC6: external view shows the Google Forms link/re-open, countdown, 6-digit numeric input, a new "Còn X/3 lần nhập mã" indicator, a disabled submit while the timer runs or when locked, the missing-code report flow, and the 48h Pending receipt. The mock repository now enforces the 3-strike lock (time-barrier rejections and malformed codes do not count) using `verifyExternalCompletionCodeInputSchema`; fixture codes are 6-digit numeric.
- ✅ AC7: schema, service, controller and e2e (`apps/backend/test/external-completion.e2e-spec.ts`) tests pass; frontend repository/journey tests cover the lockout.
- Known limitation: Prisma-backed repository behaviour (row locks, ambient transaction) is covered by unit tests with fakes only; live PostgreSQL integration tests remain deferred (Docker is not running locally, consistent with existing deferred-work entries).

### File List
- `packages/schemas/src/forms/external-completion.schema.ts` (new)
- `packages/schemas/src/forms/external-completion.schema.spec.ts` (new)
- `packages/schemas/src/forms/index.ts` (modified)
- `apps/backend/src/common/database/unit-of-work.port.ts` (new)
- `apps/backend/src/common/database/prisma-unit-of-work.ts` (new)
- `apps/backend/src/common/database/prisma-unit-of-work.spec.ts` (new)
- `apps/backend/src/common/database/prisma.module.ts` (modified)
- `apps/backend/src/common/http/http-exception.filter.ts` (modified)
- `apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts` (modified)
- `apps/backend/src/modules/participation/application/exceptions/participation.exceptions.ts` (modified)
- `apps/backend/src/modules/participation/application/participation.service.ts` (modified)
- `apps/backend/src/modules/participation/application/participation.service.spec.ts` (modified)
- `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts` (modified)
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts` (modified)
- `apps/backend/src/modules/participation/infrastructure/in-memory-participation.repository.ts` (modified)
- `apps/backend/src/modules/participation/participation.module.ts` (modified)
- `apps/backend/src/modules/participation/presentation/participation.controller.ts` (modified)
- `apps/backend/src/modules/participation/presentation/participation.controller.spec.ts` (modified)
- `apps/backend/test/external-completion.e2e-spec.ts` (new)
- `apps/frontend/my-app/app/marketplace/participation-api.ts` (modified)
- `apps/frontend/my-app/app/attempts/[id]/page.tsx` (new)
- `apps/frontend/my-app/app/forms/[id]/respond/page.tsx` (modified)
- `apps/frontend/my-app/app/marketplace/MarketplaceCard.tsx` (modified)
- `apps/frontend/my-app/lib/mock/types.ts` (modified)
- `apps/frontend/my-app/lib/mock/fixtures.ts` (modified)
- `apps/frontend/my-app/lib/mock/repository.ts` (modified)
- `apps/frontend/my-app/lib/mock/repository.test.mjs` (modified)
- `apps/frontend/my-app/tests/respondent-journey.test.mjs` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20260926230000_participation_concurrency_guards/migration.sql`
- `packages/schemas/src/forms/external-completion.schema.ts`
- `packages/schemas/src/participation/survey-attempt.schema.ts`
- `packages/schemas/src/participation/survey-attempt.schema.spec.ts`
- `apps/backend/src/modules/forms/application/ports/completion-code.port.ts`
- `apps/backend/src/modules/forms/infrastructure/completion-code.service.ts`
- `apps/backend/src/modules/forms/infrastructure/completion-code.service.spec.ts`
- `apps/backend/src/modules/participation/domain/survey-attempt.entity.ts`
- `apps/backend/src/modules/participation/application/participation.service.ts`
- `apps/backend/src/modules/participation/application/participation.service.spec.ts`
- `apps/backend/src/modules/participation/application/participation.service.bot-protection.spec.ts`
- `apps/backend/src/modules/participation/application/participation.service.epic5-review.spec.ts`
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts`
- `apps/backend/src/modules/participation/infrastructure/in-memory-participation.repository.ts`
- `apps/backend/src/modules/participation/participation.module.ts`
- `apps/backend/test/external-completion.e2e-spec.ts`
- `apps/backend/test/survey-attempt.e2e-spec.ts`
- Decision follow-up 2026-09-26 (E5-D1): `packages/schemas/src/participation/completion-code-policy.ts` (new), `packages/schemas/src/participation/decision-batch-c1.spec.ts` (new), `packages/schemas/src/participation/index.ts`, `apps/backend/prisma/schema.prisma`, `apps/backend/prisma/migrations/20260927010000_completion_code_limit_resets/migration.sql` (new), `apps/backend/src/modules/participation/domain/survey-attempt.entity.ts`, `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts`, `apps/backend/src/modules/participation/application/participation.service.ts`, `apps/backend/src/modules/participation/application/exceptions/participation.exceptions.ts`, `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts`, `apps/backend/src/modules/participation/infrastructure/in-memory-participation.repository.ts`, `apps/backend/src/modules/participation/presentation/admin-completion-code-limit.controller.ts` (new), `apps/backend/src/modules/participation/participation.module.ts`, `apps/backend/src/common/http/http-exception.filter.ts`, `apps/backend/src/modules/participation/application/participation.service.completion-code-limit.spec.ts` (new), `apps/backend/src/modules/participation/presentation/admin-completion-code-limit.controller.spec.ts` (new), `apps/backend/src/modules/participation/application/participation.service.spec.ts`, `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.spec.ts`, `apps/backend/test/external-completion.e2e-spec.ts`, `apps/backend/test/fixtures/participation.fixture.ts`, `apps/frontend/my-app/lib/mock/repository.ts`, `apps/frontend/my-app/lib/mock/repository.test.mjs`, `apps/frontend/my-app/app/attempts/[id]/page.tsx`, `_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md`, `_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md`, `_bmad-output/implementation-artifacts/deferred-work.md`

### Change Log
- 2026-09-24: Created Story 5.5 specification and implemented schemas, backend verification/reporting endpoints, API client, and e2e suite.
- 2026-09-26: Enforced the AD-16 shared Unit of Work for claim + Pending credit, fixed claim/lock race conditions, moved missing-code reports from FraudLog to the Outbox, completed the frontend attempts indicator/lockout, aligned mock codes with the 6-digit contract, and verified the full monorepo. Status → review.
- 2026-09-26: Code review 2026-09-26: Epic 5 review findings written (1 decision open — D1; 5 patches applied — P2 server-owned strike counter/missing-code marker + bounded clientContext, P6 serialized verification, P9, P19 journal-based replay, P20; 1 deferred — DF2); status set to in-progress pending D1.
- 2026-09-26: Decision follow-up 2026-09-26: E5-D1 option B accepted by Quan — `completion-code-policy-v1` (3 per attempt, 6 per account + FormVersion across attempts; provisional pending OQ14) enforced at start (pre-check + reservation transaction) and before the code comparison (409 `COMPLETION_CODE_LIMIT_REACHED`); Admin recovery endpoint with an append-only reset table (migration `20260927010000_completion_code_limit_resets`); mock journey parity; AC3.4 amended. No review items left open; status → done.
