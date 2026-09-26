---
baseline_commit: a40a63c202dfab9d3bac0b818eb5287211e1070d
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "apps/backend/prisma/schema.prisma"
  - "packages/schemas/src/marketplace/marketplace.schema.ts"
  - "apps/backend/src/modules/marketplace/application/marketplace.service.ts"
---

# Story 5.1: Survey Attempt Initialization & Concurrency

Status: done

## Story

As a Respondent,
I want to start a survey attempt,
So that the system can verify my eligibility and reserve my spot before I spend time answering.

## Acceptance Criteria

### AC1 — Attempt Initialization Contract & Schemas (`packages/schemas`)
**Given** the shared schema package
**When** defining attempt initialization contracts
**Then**:
1. `startSurveyAttemptInputSchema` validates optional client context:
   - `clientContext?: z.record(z.unknown()).optional()`
2. `surveyAttemptResponseSchema` validates output payload:
   - `attemptId`: string UUID
   - `responseId`: string UUID nullable (present for `INTERNAL`, null for `EXTERNAL`)
   - `formId`: string UUID
   - `formVersionId`: string UUID
   - `type`: `'INTERNAL' | 'EXTERNAL'`
   - `status`: `'IN_PROGRESS'`
   - `startedAt`: ISO date string
   - `expiresAt`: ISO date string (server-authoritative reservation expiry)
   - `externalUrl`: string nullable (present for `EXTERNAL`)
3. TypeScript types `StartSurveyAttemptInput` and `SurveyAttemptResponseDto` are exported from `@rescom/schemas`.

### AC2 — Pre-Flight Eligibility & Logical Completion Verification (`apps/backend`)
**Given** an authenticated Respondent requesting `POST /api/forms/:id/attempts`
**When** the backend evaluates the attempt request
**Then**:
1. Verifies the exact `FormVersion` is published/open (`Form.status === 'PUBLISHED'`, `FormVersion.isPublished === true`). If draft, closed, or not found, rejects with HTTP 404/400.
2. Verifies targeting eligibility: evaluates `FormVersion.targetingJson` against the Respondent's `DemographicProfile` using `isSurveyTargetingMatch`. If not matched, rejects with HTTP 403 (`PARTICIPANT_NOT_ELIGIBLE`).
3. Enforces one-completion at the logical `Form` level (FR-25, AD-19): checks whether the authenticated user has already completed a Response for this logical `Form` (`SUBMITTED` or `VALIDATED`). If completed, rejects with HTTP 409 (`SURVEY_ALREADY_COMPLETED`).

### AC3 — Concurrency, Quota Reservation & Conflicting Active Attempt Protection (`apps/backend`)
**Given** high concurrency or simultaneous attempt requests
**When** checking quota and active attempts
**Then**:
1. **Quota Reservation:** Checks remaining quota (`expectedCompletions - (completedResponses + activeReservations)`). An active reservation is an `IN_PROGRESS` attempt with `startedAt >= now - reservationWindow` (default 30 minutes). If no quota remains, rejects with HTTP 409 (`SURVEY_QUOTA_FULL`).
2. **Conflicting Active Attempt:** Checks if the authenticated respondent already has an unexpired `IN_PROGRESS` attempt for this `Form`. If active attempt exists, rejects with HTTP 409 (`CONFLICTING_ACTIVE_ATTEMPT`). If an attempt is older than the reservation window, it is considered expired and can be marked `ABANDONED`.
3. Pinned to immutable `FormVersion`: Created `SurveyAttempt` record has foreign keys `surveyId` (Form.id) and `formVersionId` (FormVersion.id), `startedAt` is server-authoritative timestamp.

> **Amendment 2026-09-26 (code-review decision E5-D2, option A):** the reservation window stays a fixed 30 minutes, and a survey must fit it to be published — its effective minimum time (Internal `computeInternalTimeBarrier`: answerable questions × 2 s and the publisher minimum; External: the configured minimum) must leave a 5-minute grace (≤ 25 min), and `metadata.expectedEffortSeconds` / `estimatedDurationMinutes` must not exceed 30 minutes, else 422 `SURVEY_DURATION_EXCEEDS_RESERVATION`. Phase 1 does not support surveys longer than 30 minutes (per-attempt reservations are Phase 2).
>
> **Amendment 2026-09-26 (code-review decision E8-D6, option A; Story 8.2 AC3.2):** an authenticated start also reserves FR-46 completion capacity — completions in the rolling window plus the account's open attempts must stay below the limit, re-checked under the per-user completion lock inside the reservation transaction (lock order: user lock → form row).

### AC4 — Atomic Internal Response Identity Creation (`apps/backend`)
**Given** an attempt on an `INTERNAL` survey
**When** the attempt is committed
**Then**:
1. In the **exact same database transaction** as `SurveyAttempt`, creates exactly one one-to-one `Response` record (FR-ADD-9, AD-19):
   - `id`: unique UUID (`responseId`)
   - `formId`: Form.id
   - `formVersionId`: FormVersion.id
   - `attemptId`: SurveyAttempt.id
   - `respondentId`: User.id
   - `status`: `'IN_PROGRESS'`
   - `ipAddress`: captured client IP
   - `isGuest`: false (or true if guest)
2. Pre-submission telemetry has a durable `responseId`; submission will transition this same record and never create a second `Response`.
3. For `EXTERNAL` survey attempts, the same checks (published/open, eligibility, logical-completion, quota, conflicting-attempt, reservation, server-start-time) apply, but the pre-submit Internal `Response` record is omitted (`responseId` is null, `externalUrl` returned).

### AC5 — Frontend Integration (`apps/frontend/my-app`)
**Given** the Marketplace survey card or Survey Start action
**When** a user clicks "Start Survey"
**Then**:
1. Frontend calls `POST /api/forms/:id/attempts` to initialize the attempt.
2. If `INTERNAL`: redirects user to the answering interface with pre-assigned `responseId`.
3. If `EXTERNAL`: opens the external survey URL in a new window and redirects/navigates to the external survey completion screen.
4. If the survey is full or user is ineligible/already completed, displays friendly error message.

### AC6 — Comprehensive Test Coverage
**Given** the unit, integration, and E2E test suites
**When** executing tests and build
**Then**:
1. Unit tests in `packages/schemas` for attempt initialization schemas.
2. Unit tests in `apps/backend` for `ParticipationService` covering:
   - Successful internal attempt + response creation in single transaction
   - Successful external attempt creation (no response record)
   - Rejection when form is not published
   - Rejection when targeting criteria do not match
   - Rejection when logical form is already completed by user
   - Rejection when quota is exhausted (concurrency/active reservations)
   - Rejection when conflicting active attempt exists
3. Integration/E2E test for `POST /api/forms/:id/attempts` and alias `/surveys/:id/attempts`.
4. All workspace tests and builds pass with zero regressions.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Schemas for Survey Attempts (`packages/schemas`)** (AC: 1)
  - [x] 1.1 Create `packages/schemas/src/participation/survey-attempt.schema.ts` defining `startSurveyAttemptInputSchema`, `surveyAttemptResponseSchema`, and associated DTO types.
  - [x] 1.2 Export new schemas and types from `packages/schemas/src/index.ts`.
  - [x] 1.3 Add unit tests for attempt schemas in `packages/schemas/src/participation/survey-attempt.schema.spec.ts`.

- [x] **Task 2: Backend Participation Domain & Repository Ports (`apps/backend`)** (AC: 2, 3, 4)
  - [x] 2.1 Define `ParticipationRepositoryPort` in `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts` with methods for: finding active attempts, checking completed logical forms, counting reservations/completions, creating attempt + response atomically within a transaction.
  - [x] 2.2 Implement `PrismaParticipationRepository` in `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts`.
  - [x] 2.3 Define participation exceptions in `apps/backend/src/modules/participation/application/exceptions/participation.exceptions.ts`: `ParticipantNotEligibleException` (403), `SurveyAlreadyCompletedException` (409), `SurveyQuotaFullException` (409), `ConflictingActiveAttemptException` (409), `SurveyNotAvailableException` (404/400).
  - [x] 2.4 Register participation exceptions in `apps/backend/src/common/http/http-exception.filter.ts`.

- [x] **Task 3: Backend Participation Service & Business Logic (`apps/backend`)** (AC: 2, 3, 4)
  - [x] 3.1 Implement `ParticipationService` in `apps/backend/src/modules/participation/application/participation.service.ts` containing:
    - Published/open FormVersion verification
    - Demographic targeting evaluation via `isSurveyTargetingMatch`
    - Logical-Form completion check
    - Expiring quota reservation calculation (`RESERVATION_EXPIRY_MINUTES = 30`)
    - Conflicting active attempt detection
    - Atomic creation of `SurveyAttempt` (and `Response` for INTERNAL forms)
  - [x] 3.2 Author comprehensive unit tests in `apps/backend/src/modules/participation/application/participation.service.spec.ts`.

- [x] **Task 4: Participation Presentation Layer & Module Wire-up (`apps/backend`)** (AC: 2, 3, 4)
  - [x] 4.1 Create `ParticipationController` in `apps/backend/src/modules/participation/presentation/participation.controller.ts` with `POST /forms/:id/attempts` (and alias `POST /surveys/:id/attempts`).
  - [x] 4.2 Wire `ParticipationModule` in `apps/backend/src/modules/participation/participation.module.ts` and register in `app.module.ts`.
  - [x] 4.3 Add controller tests and integration/E2E test in `apps/backend/test/survey-attempt.e2e-spec.ts`.

- [x] **Task 5: Frontend Integration & Build Verification** (AC: 5, 6)
  - [x] 5.1 Create `participation-api.ts` in `apps/frontend/my-app/app/marketplace/` for calling `POST /api/forms/:id/attempts`.
  - [x] 5.2 Update `MarketplaceCard.tsx` "Start Survey" action to initiate attempt and handle responses/errors gracefully.
  - [x] 5.3 Run all tests across workspaces (`packages/schemas`, `apps/backend`, `apps/frontend/my-app`).
  - [x] 5.4 Verify frontend and backend builds pass with zero TypeScript errors.

### Review Findings

_Epic 5 code review, 2026-09-26 (triage IDs in brackets; applied after the Epic 4 and Epic 6 review patches). 10 triage items across Epic 5 were dismissed (X1–X10: mock-first journey by design; Epic 6 P5/P6/P7/P14 own post-commit settlement, idempotent replay, close-vs-completion and the Unit of Work; `NotificationsService.publish` never throws; a scanner outage is not permanent; the cleanup-vs-attach race and the null External URL are unreachable)._

- [x] [Review][Decision] Fixed 30-minute reservation vs publisher effort / Time Barrier settings of up to 24 h (D2, medium) — `minTimeBarrierSeconds` and `expectedEffortSeconds` accept up to 86,400 s: a required barrier ≥ 1,800 s makes a survey unsubmittable, and honest surveys longer than 30 min expire (Internal answers lost, a valid External code rejected as expired). Options: (A) cap at publish — reject when the required barrier > window − 5 min or `expectedEffortSeconds` > window (`SURVEY_DURATION_EXCEEDS_RESERVATION`); (B) per-attempt reservation `expires_at = startedAt + max(30 min, 2 × effort, barrier + 10 min)` capped at ~3 h, used by every expiry check (quota, conflict, abandon, submit, verify, storage write access); (C) keep 30 min and add a reservation extend/heartbeat. **Triage recommendation: A** for Phase 1 (the PO confirms whether surveys > 30 min are required; if so, B). Under any option the invariant "required barrier + grace < reservation window" must be enforced at publish. No decision-independent part to apply; the window is now one shared constant (`RESERVATION_EXPIRY_MS` in `@rescom/schemas`, P16). [apps/backend/src/modules/participation/application/participation.service.ts:157] — **Resolved 2026-09-26:** option A accepted by Quan; publishing (standard publish, External auto-publish and the moderation approval re-check) refuses with 422 `SURVEY_DURATION_EXCEEDS_RESERVATION` any survey whose effective minimum time (Internal: `computeInternalTimeBarrier` = max(answerable questions × 2 s, publisher minimum); External: its configured minimum) exceeds 25 min (30-min window − 5-min grace), or whose `expectedEffortSeconds` > 1,800 s or `estimatedDurationMinutes` > 30 (shared `checkSurveyFitsReservationWindow` in `@rescom/schemas`, builder pre-check + Vietnamese 422 copy); embedded sub-question default recorded: **Phase 1 does not support surveys longer than 30 minutes** (option B = Phase 2, `deferred-work.md`). Tests: schemas, forms service/e2e (incl. boundaries and approval re-check), frontend helper.
- [x] [Review][Patch] Attempt start is check-then-insert: concurrent starts create duplicate active attempts, overbook the quota and allow double completion/reward (P1, high) — fixed: new `ParticipationRepositoryPort.reserveAttempt` runs, in one transaction under `SELECT status FROM forms … FOR NO KEY UPDATE`, the open-form / published-version check, the account's logical completion, the lazy abandon, the conflicting-attempt check and the quota count (shared `countCompletionsByFormIds` definition), then inserts the Attempt (+ Internal Response). Outcomes `CREATED | NOT_OPEN | ALREADY_COMPLETED | CONFLICTING_ACTIVE | QUOTA_FULL` map to the existing 404/409s; the service keeps its reads as cheap pre-checks; eligibility and rate limits stay outside. Hand-written, drift-tolerant migration `20260926230000_participation_concurrency_guards` normalizes duplicate IN_PROGRESS rows (all but the newest → ABANDONED) and adds the partial unique indexes `survey_attempts_one_active_per_account` and — only when no duplicate COMPLETED pairs exist, else `RAISE WARNING` with the count — `survey_attempts_one_completion_per_account`, both named in a `///` comment on `model SurveyAttempt` (`db push` environments must apply the SQL). P2002 on them maps to `CONFLICTING_ACTIVE` / `ALREADY_COMPLETED_LOGICAL`; both completion paths also re-check the logical completion under their locks (→ 409 `SURVEY_ALREADY_COMPLETED`). Lock order forms → survey_attempts is shared by start, Internal submit and External verify. In-memory parity is synchronous (atomic). Tests: 10 parallel starts by one account → 1 created + 9 × 409; N+5 accounts on a quota-N form → exactly N; outcome mapping; repository spec asserts the lock SQL runs first and the P2002 mapping. The PostgreSQL proof is DF5. [apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts:342]
- [x] [Review][Patch] A CONFLICTING_ACTIVE_ATTEMPT 409 carries no resume information, locking out a user who closed the tab for up to 30 min (P24, low) — fixed: `ConflictingActiveAttemptException.details {attemptId, responseId, formVersionId, type, expiresAt}` for the caller's own attempt (re-read when only the unique index caught the race); a dedicated filter branch forwards `details` (the generic branch is untouched); shared `conflictingActiveAttemptDetailsSchema`. Service, filter and e2e tests. The frontend adopts it at the live API swap. [apps/backend/src/modules/participation/application/participation.service.ts:328]
- [x] [Review][Patch] The storage capability is minted with `process.env.JWT_SECRET || '<literal>'` but verified with `EnvService` (P22, low) — fixed: optional `STORAGE_CAPABILITY_SECRET` (min 32; `.env.example`) behind `EnvService.storageCapabilitySecret` (falls back to `JWT_SECRET`, same pattern as Epic 4 P7), injected into `ParticipationService` through the module factory (`ParticipationServiceOptions`) and used by Storage's owner authorization; no `process.env`, no literal (a random per-instance key when unconfigured, e.g. unit tests). Env and service tests. [apps/backend/src/modules/participation/application/participation.service.ts:312]
- [x] [Review][Patch] Contract drift: the attempt DTO allows four statuses and non-ISO strings; Story 5.4 contradicts itself on the guest `reward` (P27, low) — fixed: `surveyAttemptResponseSchema.status` is `'IN_PROGRESS'` and `startedAt/expiresAt` are ISO `datetime()`; Story 5.4 AC1.2 reworded to the implemented `SKIPPED_GUEST` result for guests. Schema tests. [packages/schemas/src/participation/survey-attempt.schema.ts:67]
- [x] [Review][Defer] Expired attempts leave their Response IN_PROGRESS and abandonment is lazy (only when the same account restarts) (DF7, low) [apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts:342] — deferred: `ResponseStatus` has no ABANDONED value (enum change); the Attempt is authoritative (AD-19) and the quota uses the time window. Add a sweeper with the Outbox worker.
- [x] [Review][Defer] A DISPUTED or REJECTED response stops counting toward the quota, reopening its slot (DF8, low) [apps/backend/src/common/database/completion-counts.ts:25] — deferred: nothing writes those statuses until Story 8.5 (Phase 2); then align with Epic 4 P3's completion definition (count COMPLETED attempts).
- [x] [Review][Defer] Row locks, the partial unique indexes, the attach predicate and Unit-of-Work rollback are never exercised against PostgreSQL (DF5, medium; also Stories 5.4/5.5) [apps/backend/test/survey-attempt.e2e-spec.ts] — deferred: needs the Docker PostgreSQL test container (same root cause as the Epic 6 DF5 entry in `deferred-work.md`); the Postgres-gated cases to add are listed in the P1/P2/P4/P6/P7 fix plans.

---

## Dev Notes

### Architecture Context (AD-19, AD-16, AD-10)
- **AD-19 (Logical Form and Immutable FormVersion):**
  - Form is the stable logical survey aggregate.
  - FormVersion is a separate entity with `unique(formId, versionNumber)`.
  - Starting any Form transactionally validates: published/open state, targeting eligibility, logical Form not completed, quota remains, and no conflicting active Attempt exists.
  - Internal start additionally creates its one-to-one `IN_PROGRESS` Response identity in the same transaction, so pre-submission telemetry has a durable `responseId`; submission transitions that same Response and never creates a second one.
  - External start applies the same checks, omitting only the pre-submit Internal Response identity.
- **Quota & Expiring Reservations:**
  - Reservations expire after 30 minutes (`RESERVATION_EXPIRY_MINUTES = 30`).
  - Count of claimed slots = Completed Responses (`SUBMITTED` | `VALIDATED`) + Active `IN_PROGRESS` Attempts where `startedAt >= now - 30 minutes`.
  - Expired attempts are not counted toward quota and are lazily marked `ABANDONED`.
- **Clean Architecture & Boundary Rules:**
  - `ParticipationService` lives in `modules/participation/application` and is a pure domain/application service without framework dependencies (`@nestjs/common`).
  - Injected via NestJS provider factory in `ParticipationModule`.
- **Concurrency Protection:**
  - Enforced within PostgreSQL transaction. Prisma `$transaction` guarantees atomicity.

---

## Dev Agent Record

### Implementation Plan
1. Task 1: Create shared schemas in `packages/schemas/src/participation/` and unit tests.
2. Task 2: Create `ParticipationRepositoryPort`, `PrismaParticipationRepository`, domain exceptions, and register in `http-exception.filter.ts`.
3. Task 3: Implement pure `ParticipationService` with full validation (published, targeting, logical completion, quota reservation, conflicting active attempt, atomic attempt+response creation) and unit tests.
4. Task 4: Implement `ParticipationController`, `ParticipationModule`, register in `AppModule`, add controller unit test and E2E test suite (`test/survey-attempt.e2e-spec.ts`).
5. Task 5: Integrate with frontend `MarketplaceCard`, verify full test suites and production build across all workspaces.

### Completion Notes
- Implemented `packages/schemas/src/participation/survey-attempt.schema.ts` with `startSurveyAttemptInputSchema`, `surveyAttemptResponseSchema`, and DTO types.
- Implemented `ParticipationRepositoryPort`, `PrismaParticipationRepository`, `InMemoryParticipationRepository`, `SurveyAttemptEntity`, and `ResponseEntity`.
- Implemented `ParticipationService` enforcing published status, participant targeting criteria, one-completion per logical form, 30-minute expiring quota reservations, and atomic one-to-one response identity creation for internal forms.
- Implemented `ParticipationController` with `POST /forms/:id/attempts` and alias route `POST /surveys/:id/attempts`.
- Integrated `startSurveyAttempt` in `MarketplaceCard.tsx` with loading and error states.
- 57 backend unit test suites (556 tests) passing.
- 15 backend E2E test suites (143 tests) passing.
- `packages/schemas` test suite (49 tests) passing.
- Next.js production build (`next build`) passing with zero TypeScript errors.

---

## File List
- `_bmad-output/implementation-artifacts/5-1-survey-attempt-initialization-concurrency.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/schemas/src/participation/survey-attempt.schema.ts`
- `packages/schemas/src/participation/survey-attempt.schema.spec.ts`
- `packages/schemas/src/participation/index.ts`
- `packages/schemas/src/index.ts`
- `apps/backend/src/modules/participation/domain/survey-attempt.entity.ts`
- `apps/backend/src/modules/participation/domain/response.entity.ts`
- `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts`
- `apps/backend/src/modules/participation/application/exceptions/participation.exceptions.ts`
- `apps/backend/src/modules/participation/application/participation.service.ts`
- `apps/backend/src/modules/participation/application/participation.service.spec.ts`
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts`
- `apps/backend/src/modules/participation/infrastructure/in-memory-participation.repository.ts`
- `apps/backend/src/modules/participation/presentation/participation.controller.ts`
- `apps/backend/src/modules/participation/presentation/participation.controller.spec.ts`
- `apps/backend/src/modules/participation/participation.module.ts`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/test/survey-attempt.e2e-spec.ts`
- `apps/frontend/my-app/app/marketplace/participation-api.ts`
- `apps/frontend/my-app/app/marketplace/MarketplaceCard.tsx`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20260926230000_participation_concurrency_guards/migration.sql`
- `apps/backend/src/modules/participation/application/participation.service.epic5-review.spec.ts`
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.spec.ts`
- `apps/backend/src/common/config/env.schema.ts`
- `apps/backend/src/common/config/env.service.ts`
- `apps/backend/src/common/config/env.service.spec.ts`
- `apps/backend/.env.example`
- `apps/backend/src/common/http/http-exception.filter.spec.ts`
- Decision follow-up 2026-09-26 (E5-D2): `packages/schemas/src/participation/reservation-window.ts` (new), `packages/schemas/src/participation/decision-batch-c1.spec.ts` (new), `packages/schemas/src/participation/index.ts`, `apps/backend/src/modules/forms/application/form-publishability.ts`, `apps/backend/src/modules/forms/application/forms.service.ts`, `apps/backend/src/modules/forms/application/forms.service.spec.ts`, `apps/backend/test/forms-publish.e2e-spec.ts`, `apps/frontend/my-app/app/forms/attempt-window.ts` (new), `apps/frontend/my-app/app/forms/[id]/edit/page.tsx`, `apps/frontend/my-app/tests/attempt-window.test.mjs` (new), `_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md`, `_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md`, `_bmad-output/implementation-artifacts/deferred-work.md`

---

## Change Log
- 2026-09-15: Initialized Story 5.1 specification and implemented complete Survey Attempt Initialization & Concurrency workflow across schemas, backend, tests, and frontend. Transitioned to review.
- 2026-09-26: Code review 2026-09-26: Epic 5 review findings written (1 decision open — D2; 4 patches applied — P1 atomic reservation + partial unique indexes, P22, P24, P27; 3 deferred — DF5, DF7, DF8); migration `20260926230000_participation_concurrency_guards`; status set to in-progress pending D2.
- 2026-09-26: Decision follow-up 2026-09-26: E5-D2 option A accepted by Quan — publish-time 422 `SURVEY_DURATION_EXCEEDS_RESERVATION` for surveys that cannot fit the 30-minute attempt reservation (effective barrier via `computeInternalTimeBarrier` ≤ 25 min, effort/duration ≤ 30 min; also on External auto-publish and the moderation approval re-check), builder pre-check and copy; AC3 amended (also for E8-D6 start-time capacity reservation); Phase 1 limited to surveys ≤ 30 min (recorded). No review items left open; status → done.
