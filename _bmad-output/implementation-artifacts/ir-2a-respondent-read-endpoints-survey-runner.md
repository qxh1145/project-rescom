---
baseline_commit: d1175ebc9e1d31ffcc9a23956cfe4f8b870252bd
created: 2026-09-30
context:
  - "_bmad-output/planning-artifacts/epics.md#Story IR.2a"
  - "_bmad-output/planning-artifacts/implementation-readiness-report-2026-09-30.md"
  - "_bmad-output/brainstorming/brainstorm-backend-integration-deployment-2026-09-29/integration-deployment-plan.md#6.5 (API-01..API-05)"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md (AD-16, AD-19, AD-20, Consistency Conventions)"
  - "_bmad-output/implementation-artifacts/5-1-survey-attempt-initialization-concurrency.md"
  - "_bmad-output/implementation-artifacts/5-4-internal-form-submission.md"
  - "_bmad-output/implementation-artifacts/5-5-external-form-completion-code-verification.md"
  - "_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md (E5-D1, E5-D3, E5-D4, E6-D1, E7-DN2/DN3, E8-D6, E9-D2)"
  - "_bmad-output/implementation-artifacts/deferred-work.md (Epic 5 DF7, E5-D4 option C)"
  - "apps/backend/src/modules/participation/**"
  - "apps/backend/src/modules/economy/application/{ledger.service,reward-settlement.coordinator,starter-points.coordinator}.ts"
  - "apps/frontend/my-app/lib/participation/{survey-form-service,attempts-service,submission-service,external-service}.ts"
  - "apps/frontend/my-app/mocks/handlers/{participation,participation-internal,participation-external}.ts"
---

# Story IR.2a: Respondent Read Endpoints for the Survey Runner

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Respondent,
I want the survey summary, my attempt, its pinned form and its outcome to load from the real backend,
so that I can start, resume, cancel and finish a survey without mock data.

**Why now:** the 2026-09-30 readiness assessment rates the respondent runner "Blocked": `GET /surveys/:id`, `GET /attempts/:id`, `GET /attempts/:id/outcome` and `POST /attempts/:id/cancel` exist only as MSW handlers, and the pinned-form read (API-05) is missing. IR.3 needs this story (and IR.2b) before it can run the respondent journey without mocks. The four routes are API-01 to API-04 in the integration plan register. API-05 is delivered inside `GET /attempts/:id` (see AC3).

**Scope guard (Epic IR):** this story adds Respondent-facing reads and one command. It does not reactivate Epic 10 (integrity decisions and reliability), disputes UI, admin reads or the scheduler (IR.2b). No new dependencies.

## Acceptance Criteria

### AC1: Shared contracts (`packages/schemas`), one schema per route, contract-tested

**Given** the frontend contracts marked ASSUMED in `lib/participation/survey-form-service.ts`, `attempts-service.ts`, `submission-service.ts` and `external-service.ts`
**When** the contracts are implemented
**Then** each request/response schema lives in `@rescom/schemas` (new file `packages/schemas/src/participation/survey-runner.schema.ts`, exported from `participation/index.ts`):
1. `surveySummarySchema` (`GET /surveys/:id`)
2. `attemptStatusSchema`, `attemptCloseReasonSchema`, `attemptPinnedFormSchema` and `surveyAttemptDetailsSchema` (`GET /attempts/:attemptId`)
3. `attemptRewardStateSchema` and `attemptOutcomeSchema` (`GET /attempts/:attemptId/outcome`)
4. `cancelAttemptResponseSchema` (`POST /attempts/:attemptId/cancel`). The request body is `{}` (`z.object({}).strict()`), and the `Idempotency-Key` header is validated with the existing `idempotencyKeySchema`.
5. Stable error-code constants: `SURVEY_NOT_FOUND_CODE`, `ATTEMPT_NOT_FOUND_CODE` and `ATTEMPT_NOT_IN_PROGRESS_CODE`, plus `attemptNotInProgressDetailsSchema`.

**And** every response schema is `.strict()`. A security-sensitive or unknown field then fails parsing instead of being silently ignored.
**And** the backend service return types are the inferred DTO types, and the frontend services import these same schemas. The local ASSUMED `z.object` definitions in the four frontend service files are deleted and replaced with re-exports.
**And** a backend contract test parses every success body (and every documented error `details`) with the shared schema. A frontend contract test parses every MSW handler response for these routes with the same schema.

### AC2: `GET /surveys/:id` returns public facts only (API-01)

**Given** any caller, including an unauthenticated one
**When** it calls `GET /surveys/:id` (also `GET /api/surveys/:id`)
**Then** it receives `200 { data: SurveySummary }` with exactly these fields: `id`, `title`, `description`, `type`, `status`, `rewardPerResponse`, `estimatedEffortSeconds`, `expectedCompletions`, `completedCompletions` and `remainingSlots` (the field-by-field table below gives each source).
**And** no targeting data (`targetingJson`, `hasTargeting`), Completion Code or verifier, `externalUrl`, `publisherId`, publisher email, escrow/pricing data or version internals are present. The strict schema and an explicit assertion in the test both enforce this.
**And** an unknown id, or a form whose status is not `PUBLISHED` (`DRAFT`, `ESCROW_LOCKED`, `MODERATION_QUEUE`, `CLOSED`), or a `PUBLISHED` form with no published version, returns `404 SURVEY_NOT_FOUND` with the same message in every case. The response does not reveal whether the survey exists.
**And** a malformed id returns `400 VALIDATION_ERROR` (existing `ParseUUIDPipe`).
**And** the route is `@Public()`. A session is optional and is never required, and the response is identical with or without a session.

### AC3: `GET /attempts/:attemptId` returns the owner's attempt with its PINNED version (API-02 + API-05)

**Given** an authenticated Respondent who owns the Attempt
**When** they call `GET /attempts/:attemptId`
**Then** the response returns the Attempt `status`, `closedReason`/`closedAt`, server `startedAt`/`expiresAt`/`submittedAt`, form `type`, the **pinned** `formVersionId`/`versionNumber`, `timeBarrier`, the completion-code counters, a survey header (`survey`), and for an Internal Form the pinned version's Form Definition in `form`.
**And** `form` is built from `attempt.formVersionId`, never from `currentVersion`. It is unchanged after the Publisher creates or publishes a newer version (AD-19, API-05). A test starts an attempt on v1, publishes v2 with different blocks, and asserts that the attempt read still returns v1's blocks and `versionNumber`.
**And** for an External attempt, `form` is `null` and `survey.externalUrl` is the pinned version's `externalUrl`.
**And** a missing attempt, another user's attempt, or a guest attempt (`respondentId = null`) returns `404 ATTEMPT_NOT_FOUND`, not 403. The message and timing are the same whether or not the attempt exists.
**And** there is no Admin read path in this story. The route is owner-only, and a signed-in Admin who does not own the attempt gets 404. See Questions Q6.
**And** the read is side-effect free: no lazy abandonment, no ledger or notification call. An expired reservation is returned as persisted (`IN_PROGRESS` with a past `expiresAt`). The client derives "expired" with `attemptPhase`, and IR.2b's reservation-expiry job closes it durably.
**And** the response carries `Cache-Control: no-store` (per-user private data).

### AC4: `GET /attempts/:attemptId/outcome` is derived from posted Ledger journals and is read-only (API-04)

**Given** an owned Attempt
**When** the Respondent calls `GET /attempts/:attemptId/outcome`
**Then** the response returns `reward.state` derived only from posted Ledger journals, read through Economy-owned query methods (AD-16):
- `AVAILABLE`: an Internal `internal-reward:{responseId}` journal (SHADOW/ADVISORY), or an External credit whose settlement state is `RELEASED`.
- `PENDING`: an External `external-completion:{attemptId}` credit still in the 48 h window, with `releasesAt = credit.createdAt + PENDING_REWARD_MATURITY_MS`.
- `HELD_IN_INTEGRITY`: only when an `integrity-hold:{responseId}` journal exists, which is written only under an `ENFORCED` policy deployment.
- The edge states `HELD_IN_DISPUTE`, `REVERSED`, `AWAITING_SETTLEMENT`, `NO_REWARD` and `NOT_COMPLETED` follow the mapping table in the Dev Notes (see Questions Q2).

**And** `reward.amount` is the credited amount from the journal's positive total (`toSettlementResult` → `positiveTotal`), never `form.rewardPerResponse`. It is `0` when no journal exists.
**And** `starterUnlock.activatedByThisAttempt` (mirrored as `accountActivated`) is `true` only when a `starter-unlock:{userId}` journal exists and the activation survey chosen by the shared rule (`evaluateStarterActivation`) is this attempt's logical Form and source.
**And** the endpoint never recomputes or mutates balances. It never calls `settle*`, `redrive*`, `releasePendingReward`, `tryUnlockStarterPoints`, `ensureStarterGrant`, `recoverPendingCreditNotice` or `NotificationPublisher.publish`. A unit test asserts zero calls on spies of these methods, and an e2e test asserts that the ledger journal count is unchanged.
**And** another user's attempt returns `404 ATTEMPT_NOT_FOUND`.
**And** the response carries `Cache-Control: no-store`.

### AC5: `POST /attempts/:attemptId/cancel` abandons and releases the reservation atomically, idempotently (API-03)

**Given** an owned, unexpired `IN_PROGRESS` Attempt
**When** the Respondent calls `POST /attempts/:attemptId/cancel` with a session cookie, a valid `X-CSRF-Token`, `Content-Type: application/json`, body `{}` and an `Idempotency-Key` header
**Then** in ONE transaction the Attempt moves `IN_PROGRESS → ABANDONED`, with `closedReason = 'CANCELLED'` and `closedAt = now`, through a state-predicated conditional update. This releases its quota reservation: quota counts only unexpired `IN_PROGRESS` attempts, so the slot is free as soon as the row commits.
**And** the response is `200 { data: { attemptId, status: 'ABANDONED', closedReason: 'CANCELLED', closedAt } }`.
**And** a retry, from the same tab with the same key or from another tab with a different key, on an attempt that is already `ABANDONED` with `closedReason = 'CANCELLED'` returns `200` with the original body. The original `closedAt` is returned and is never rewritten.
**And** cancelling a `COMPLETED` or `LOCKED` attempt, an attempt `ABANDONED` for another reason, or an `IN_PROGRESS` attempt whose reservation already expired returns `409 ATTEMPT_NOT_IN_PROGRESS` with `details: { status, closedReason }`. For the expired `IN_PROGRESS` case, `closedReason` is the derived `'EXPIRED'`.
**And** a missing or malformed `Idempotency-Key` returns `400 INVALID_IDEMPOTENCY_KEY` (the existing code from `forms.controller.ts`). A missing CSRF token returns 403 (`CsrfGuard`). A non-JSON body returns 415 (`JsonOnlyGuard`). No session returns 401. Another user's attempt returns `404 ATTEMPT_NOT_FOUND`.
**And** the lazy expiry path (`abandonExpiredAttemptsWith`, used by `reserveAttempt`) now writes `closedReason = 'EXPIRED'` and `closedAt`, so every future `ABANDONED` row carries a reason. Rows abandoned before the migration keep `NULL`, and the client falls back to its `expiresAt` rule.

### AC6: Envelope, error codes and failure-mode tests

**And** every route returns the `{ data, error, meta }` envelope (`createSuccessEnvelope` / `HttpExceptionFilter`), and every new error has a stable machine code mapped in `http-exception.filter.ts`.
**And** each route is registered under both `x` and `api/x` (Bug 1.3; `test/architecture.spec.ts` enforces this).
**And** tests cover unauthorized, not-found (unknown, other owner, guest attempt), conflict (409 on completed/locked/expired), idempotent retry (cancel twice), concurrency (cancel racing submit, and cancel racing completion-code verify: exactly one wins, and the loser gets its documented 409), and quota release (at full quota, a second respondent can start after the first cancels).

### AC7: The frontend consumes the promoted contracts; MSW stays in parity

**And** `attempts-service.ts`, `submission-service.ts`, `external-service.ts` and `survey-form-service.ts` import the shared schemas. `cancelAttempt` sends an `Idempotency-Key` (a UUID generated once per user confirmation and reused on retry).
**And** `SurveyTakingScreen` renders the runner from `attempt.form` (pinned) instead of `GET /public/forms/:id`. The `isVersionMismatch` restart path is replaced by a `survey.status !== 'PUBLISHED'` check (see Dev Notes, "Frontend changes").
**And** `completion-view.ts` maps `reward.state` (not `RewardSettlementStatus`), `SurveyRunnerView` no longer requires `publisherName`, and the cancel dialog treats `409 ATTEMPT_NOT_IN_PROGRESS` as "already closed".
**And** the MSW handlers for the four routes return exactly the shared shapes and error codes, and the frontend contract test proves it.
**And** frontend `tsc --noEmit`, `eslint` and `node --test` pass, and so do backend `jest` (unit), `test:e2e`, the architecture spec and the migration-chain spec.

## Tasks / Subtasks

- [ ] **T1: Shared schemas (AC1)**. Add `packages/schemas/src/participation/survey-runner.schema.ts` and export it from `packages/schemas/src/participation/index.ts`.
  - [ ] 1.1 `attemptStatusSchema = z.enum(['IN_PROGRESS','COMPLETED','ABANDONED','LOCKED'])` (mirrors Prisma `AttemptStatus` and `survey-attempt.entity.ts`) and `attemptCloseReasonSchema = z.enum(['EXPIRED','CANCELLED'])`.
  - [ ] 1.2 `surveySummarySchema` (strict), with the fields from the AC2 table. Import `formStatusEnum` and `formTypeEnum` from `forms/form-draft.schema.ts`.
  - [ ] 1.3 `attemptPinnedFormSchema` (strict) = `{ formVersionId, versionNumber, title, description (nullable), blocks: z.array(formBlockSchema).min(1), sections: z.array(formSectionSchema).max(50).optional(), settings: formSettingsSchema, metadata: formIntegrityMetadataSchema, publishedAt: datetime | null }`. Reuse the building blocks of `publicFormDetailsSchema` (`forms/public-form.schema.ts`) without `publicUrl` or `type`.
  - [ ] 1.4 `surveyAttemptDetailsSchema` (strict), per the AC3 table. `timeBarrier` reuses `attemptTimeBarrierSchema` (`participation/bot-protection.ts`).
  - [ ] 1.5 `attemptRewardStateSchema = z.enum(['AVAILABLE','PENDING','HELD_IN_INTEGRITY','HELD_IN_DISPUTE','REVERSED','AWAITING_SETTLEMENT','NO_REWARD','NOT_COMPLETED'])` and `attemptOutcomeSchema` (strict), per the AC4 table. Add a `superRefine`: `releasesAt` is non-null iff `state === 'PENDING'`; `journalId`/`creditedAt` are non-null iff a journal exists.
  - [ ] 1.6 `cancelAttemptRequestSchema = z.object({}).strict()`, `cancelAttemptResponseSchema` (strict: `attemptId`, `status: z.literal('ABANDONED')`, `closedReason: z.literal('CANCELLED')`, `closedAt`) and `attemptNotInProgressDetailsSchema = { status: attemptStatusSchema, closedReason: attemptCloseReasonSchema.nullable() }`.
  - [ ] 1.7 Error-code constants: `SURVEY_NOT_FOUND_CODE`, `ATTEMPT_NOT_FOUND_CODE`, `ATTEMPT_NOT_IN_PROGRESS_CODE`.
  - [ ] 1.8 Extract the BE-12 effort rule into a pure shared helper, `resolveEstimatedEffortSeconds({ estimatedDurationMinutes, metadata })` (minutes × 60 when > 0, else `metadata.expectedEffortSeconds`, else 60). Put it next to the marketplace schema (`packages/schemas/src/marketplace/`) and use it in `MarketplaceService.getFeed` (behaviour-preserving) and in the new summary/attempt reads.
  - [ ] 1.9 `packages/schemas/src/participation/survey-runner.schema.spec.ts`: accepts valid shapes, rejects unknown keys (for example `targetingJson`, `completionCode`, `publisherId` on the summary), enforces the PENDING ⇔ `releasesAt` refinement, and the cancel body rejects any key. Rebuild `dist` (`npm --prefix packages/schemas run build`); the frontend `pretypecheck` depends on it.

- [ ] **T2: Persistence, closed reason (AC5)**. Participation-owned migration (AD-16, schema-change convention).
  - [ ] 2.1 `apps/backend/prisma/schema.prisma`: add `enum AttemptCloseReason { EXPIRED CANCELLED }`. On `SurveyAttempt` add `closedReason AttemptCloseReason? @map("closed_reason")` and `closedAt DateTime? @map("closed_at")`.
  - [ ] 2.2 New migration `apps/backend/prisma/migrations/20260930xxxxxx_survey_attempt_close_reason/migration.sql` (expand-only: nullable columns and the enum type; no backfill; no index needed). Follow the naming and format of `20260927060000_product_tour_progress`. Run `migration-chain.spec.ts` / `migration-chain.prisma.e2e-spec.ts`.
  - [ ] 2.3 `domain/survey-attempt.entity.ts`: add `closedReason: 'EXPIRED' | 'CANCELLED' | null` and `closedAt: Date | null`. Add them after `codeVerification` with default `null` so existing constructor call sites stay valid, or use a trailing options object. Update `toAttemptEntity` in `prisma-participation.repository.ts` and the in-memory repository.
  - [ ] 2.4 `abandonExpiredAttemptsWith` (prisma repo, about line 348) and the in-memory equivalent write `closedReason: 'EXPIRED', closedAt: now` together with `status: 'ABANDONED'`.

- [ ] **T3: Repository port additions (AC3, AC5)**. `application/ports/participation-repository.port.ts`, with the Prisma and in-memory implementations.
  - [ ] 3.1 `cancelAttempt(params: { attemptId; respondentId; formId; cutoffDate; now }): Promise<CancelAttemptResult>`, where `CancelAttemptResult = { outcome: 'CANCELLED'; attempt } | { outcome: 'ALREADY_CANCELLED'; attempt } | { outcome: 'NOT_IN_PROGRESS'; attempt; derivedCloseReason: 'EXPIRED' | null } | { outcome: 'NOT_FOUND' }`.
  - [ ] 3.2 Prisma implementation, in one `runInTransaction`. Lock order: `SELECT id FROM forms WHERE id = $formId FOR SHARE`, then `SELECT id FROM survey_attempts WHERE id = $attemptId FOR UPDATE`, then re-read. If the row is `IN_PROGRESS` with `respondentId` matching, `startedAt >= cutoffDate` and `isGuest = false`: `updateMany({ where: { id, status: 'IN_PROGRESS' }, data: { status: 'ABANDONED', closedReason: 'CANCELLED', closedAt: now } })`, and expect `count === 1`. Otherwise map the current state to an outcome. Why the form lock first: `reserveAttempt` takes the form row `FOR NO KEY UPDATE` and then updates attempt rows (lazy abandon), and completion transactions take the form row `FOR SHARE` and then the attempt row `FOR UPDATE`. Taking the form lock first keeps one global order (form, then attempt), so cancel can never deadlock with start, submit or verify. Cancel does **not** take the per-user completion advisory lock: it only removes a reservation, so the E8-D6 count can only go down.
  - [ ] 3.3 The Internal `Response` stays `IN_PROGRESS`. `ResponseStatus` has no abandoned value; the Attempt is authoritative (AD-19; deferred-work Epic 5 DF7). Do not touch `stored_objects`. Storage write authorization already requires `IN_PROGRESS` (`prisma-storage-owner-authorization.service.ts` about lines 158-170).
  - [ ] 3.4 In-memory implementation with the same state machine; the e2e suites and unit specs use it.

- [ ] **T4: Economy read-only query surface (AC4)**. Economy owns these methods (AD-16); Participation depends on a port.
  - [ ] 4.1 `RewardSettlementCoordinator` (`apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts`): add `getExternalSettlementState(attemptId)`, which delegates to `LedgerService.getExternalSettlementState` (already exists, about line 2072) and returns `'NONE'|'PENDING'|'RELEASED'|'REVERSED'|'HELD'|'REFUNDED_TO_PUBLISHER'`. `findInternalSettlement` and `findExternalSettlement` already exist.
  - [ ] 4.2 `StarterPointsCoordinator`: add a read-only `getActivationSnapshot(userId): Promise<{ unlockedAt: Date | null; amount: number | null; activationSurvey: ActivationSurveyDto | null }>`. It must **not** call `ensureStarterGrant` (which writes, `getStatus` calls it) nor publish anything. Fast path: if `findJournalByIdempotencyKey('starter-unlock:' + userId)` is null, return `{ unlockedAt: null, amount: null, activationSurvey: null }` without loading completions. Otherwise reuse the private `loadSnapshot(userId, now)` and return `evaluation.activationSurvey` and `creditedAmount(unlockJournal)`.
  - [ ] 4.3 New port `apps/backend/src/modules/participation/application/ports/attempt-reward-query.port.ts` (`AttemptRewardQueryPort`: `findInternalSettlement`, `findExternalSettlement`, `getExternalSettlementState`, `getActivationSnapshot`). Model it on the existing `external-credit-state.port.ts`. Wire it in `participation.module.ts` with a factory that adapts `RewardSettlementCoordinator` and the optional `StarterPointsCoordinator`. Participation never imports `LedgerService` or Prisma ledger tables.
  - [ ] 4.4 Unit specs next to each coordinator: `getActivationSnapshot` never writes (a spy on `ledgerService.grantStarterPoints` is not called); `getExternalSettlementState` delegates.

- [ ] **T5: Application service (AC2-AC5)**. New `apps/backend/src/modules/participation/application/survey-runner-read.service.ts` (framework-free; `test/architecture.spec.ts` forbids `@nestjs/*` in application files). Model it on `SurveyFeedbackService` (deps object, injectable clock `now`).
  - [ ] 5.1 `getSurveySummary(formId)`: `formRepository.findById`, then 404 unless `form.status === 'PUBLISHED'` and a published version exists. Pick the newest `isPublished` version from `versions` (sorted by `versionNumber` desc), not blindly `currentVersion`: after "Create New Version" the newest row is an unpublished draft (and the form is DRAFT, so it is already 404). `participationRepository.getQuotaStatus(form.id, cutoff)` gives `completedCompletions` (shared definition `countCompletionsByFormIds`) and `remainingSlots = max(0, expected − completed − activeReservations)`, the same arithmetic as the start check (`participation.service.ts` about line 293). Use `resolveEstimatedEffortSeconds`.
  - [ ] 5.2 `getAttemptDetails(attemptId, callerUserId)`: `loadOwnedAttempt`, which returns 404 when the attempt is missing, `respondentId !== callerUserId` or `isGuest`. Then `formRepository.findById(attempt.surveyId)` and the pinned version via the same rule as `ParticipationService.findPinnedVersion` (about line 1600). Move that function into a small shared helper in `participation/application/` rather than duplicating it. If the pinned version is missing (data corruption), return 404 `ATTEMPT_NOT_FOUND` and log a warning. `responseId` comes from `findResponseByAttemptId` (INTERNAL only). `timeBarrier` comes from the same `resolveTimeBarrier` + `describeAttemptTimeBarrier` logic used at start. Extract both from `ParticipationService` (currently private, about lines 1616-1659) into an exported pure helper so the start response and the read agree byte-for-byte. `accountWrongCodeCount = countCompletionCodeFailures(userId, attempt.formVersionId)` for EXTERNAL, `0` for INTERNAL. `form` = `attemptPinnedFormSchema` projection of the pinned `schemaJson` (INTERNAL only). Use the same defaults as `PublicFormsService.getPublicForm` (`settings` / `metadata` fallbacks), and parse with `parseFormDefinitionDraft`; if parsing fails, 404 plus a warning, the same as submit.
  - [ ] 5.3 `getAttemptOutcome(attemptId, callerUserId)`: `loadOwnedAttempt`, then the reward-state mapping (Dev Notes table), then `starterUnlock`. Return `NOT_COMPLETED` without any ledger read when `attempt.status !== 'COMPLETED'`.
  - [ ] 5.4 `cancelAttempt(attemptId, callerUserId)`: pre-read with `loadOwnedAttempt` (404), then `participationRepository.cancelAttempt({ ..., cutoffDate: now − RESERVATION_EXPIRY_MS, now })`. Map `CANCELLED` / `ALREADY_CANCELLED` to 200 with the stored `closedAt`, `NOT_IN_PROGRESS` to `AttemptNotInProgressException(details)`, and `NOT_FOUND` to `AttemptNotFoundException`. Apply `rateLimiter?.assertBurstAllowed(userId, 'ATTEMPT_START', { attemptId })`, or add a `'ATTEMPT_CANCEL'` action if the limiter's action union allows it (check `participation-rate-limiter.ts`). A cancel must not become a free start/cancel loop that farms reservations.
  - [ ] 5.5 New exceptions in `application/exceptions/participation.exceptions.ts`: `SurveyNotFoundException` (`SURVEY_NOT_FOUND`), `AttemptNotFoundException` (`ATTEMPT_NOT_FOUND`) and `AttemptNotInProgressException` (`ATTEMPT_NOT_IN_PROGRESS`, `details`). Map them in `apps/backend/src/common/http/http-exception.filter.ts`: 404, 404 and 409 with `details`. Add `http-exception.filter.spec.ts` cases.

- [ ] **T6: Controllers (AC2-AC6)**. `apps/backend/src/modules/participation/presentation/`.
  - [ ] 6.1 New `survey-runner.controller.ts`: `@Controller(['', 'api'])` + `@UseGuards(SessionAuthGuard)`, like `ParticipationController`. Keep it separate so `participation.controller.ts` (commands) stays unchanged. Routes:
    - `@Get('surveys/:id') @Public()`
    - `@Get('attempts/:attemptId') @Header('Cache-Control','no-store')`
    - `@Get('attempts/:attemptId/outcome') @Header('Cache-Control','no-store')`
    - `@Post('attempts/:attemptId/cancel') @HttpCode(200) @UseGuards(CsrfGuard, JsonOnlyGuard) @Body(new ZodValidationPipe(cancelAttemptRequestSchema))` plus `@Headers('idempotency-key')` validated with `idempotencyKeySchema`. Throw `BadRequestException({ code: 'INVALID_IDEMPOTENCY_KEY', ... })`, exactly as in `forms.controller.ts` lines 72-88, but the header is **required** here.

    Use `ParseUUIDPipe` on every id.
  - [ ] 6.2 Route collision check: `SurveyFeedbackController` owns `attempts/:attemptId/feedback`, and `ParticipationController` owns `POST attempts/:attemptId/verify-code` / `report-missing-code` and `POST surveys/:id/attempts`. The new GET routes are distinct paths or methods, so they do not collide. Still, add a controller spec that hits each neighbouring route once, to prove Nest's router resolves them.
  - [ ] 6.3 Register the controller and `SurveyRunnerReadService` (factory with `FORM_REPOSITORY_PORT`, `PARTICIPATION_REPOSITORY_PORT`, the `AttemptRewardQueryPort` adapter and `ParticipationRateLimiter`) in `participation.module.ts`.

- [ ] **T7: Backend tests (AC6)**. See the Test Plan below.

- [ ] **T8: Frontend adoption (AC7)**. `apps/frontend/my-app`
  - [ ] 8.1 `lib/participation/survey-form-service.ts`: delete the local `surveySummarySchema`; re-export the shared one. Keep `getSurveyForm` (still used by guest/public flows, if any; otherwise remove it once 8.4 lands and nothing imports it).
  - [ ] 8.2 `lib/participation/attempts-service.ts`: replace `attemptStatusSchema` / `attemptDetailsSchema` with the shared `attemptStatusSchema` / `surveyAttemptDetailsSchema` (keep the exported type name `AttemptDetails` as an alias to limit churn). Update `attemptPhase` to accept the new `closedReason` (unchanged logic).
  - [ ] 8.3 `lib/participation/submission-service.ts`: shared `attemptOutcomeSchema`. `lib/participation/external-service.ts`: shared `cancelAttemptResponseSchema`; `cancelAttempt(attemptId, idempotencyKey, signal)` sends `headers: { 'Idempotency-Key': key }` (the client already supports `headers`).
  - [ ] 8.4 `app/(signed-in)/(focus)/attempts/[id]/components/SurveyTakingScreen.tsx`: drop the `getSurveyForm` query. Render `SurveyRunnerView` with `attempt.form`, and change the prop type from `SurveyForm` to `AttemptPinnedForm` (or a small adapter). Replace `isVersionMismatch` with `current.survey.status !== 'PUBLISHED'` → `FormUpdatedPanel` (cancel + restart), because under E5-D4 option A the submit fails with `SURVEY_NOT_AVAILABLE` once the form leaves PUBLISHED.
  - [ ] 8.5 `SurveyRunnerView.tsx` line 176 `publisher={attempt.survey.publisherName}`: the field is not derivable (see Q1). Render nothing or the product copy agreed in Q1.
  - [ ] 8.6 `lib/participation/completion-view.ts`: `kindOf` maps `reward.state` (`AVAILABLE`→available, `PENDING`→pending, `HELD_IN_INTEGRITY`|`HELD_IN_DISPUTE`→held). For `AWAITING_SETTLEMENT`, `NO_REWARD` and `REVERSED`, fall back to the current type-based rule, or add the copy agreed in Q2. `activated` = `outcome.starterUnlock.activatedByThisAttempt`. Drop the `rewardStatus` fallback, because the attempt read no longer returns it.
  - [ ] 8.7 `app/(signed-in)/(focus)/attempts/[id]/google-form/components/CancelAttemptDialog.tsx`: generate one `crypto.randomUUID()` per dialog open and reuse it on retry. Treat `409 ATTEMPT_NOT_IN_PROGRESS` as closed (call `onCancelled`/refresh) instead of `cancelFailed`.
  - [ ] 8.8 MSW parity: `mocks/handlers/participation.ts` (`GET /attempts/:attemptId`), `mocks/handlers/participation-internal.ts` (`GET /surveys/:id`, `GET /attempts/:attemptId/outcome`) and `mocks/handlers/participation-external.ts` (`POST /attempts/:attemptId/cancel`) must emit exactly the shared shapes. The cancel mock currently uses the shared `guard()`, which answers `404 SURVEY_NOT_AVAILABLE` / `403 PARTICIPANT_NOT_ELIGIBLE`. Change it to `404 ATTEMPT_NOT_FOUND` for both unknown and non-owner. Add the `Idempotency-Key` check (400 `INVALID_IDEMPOTENCY_KEY`) and the replay → 200 behaviour. `GET /surveys/:id` must return 404 for non-PUBLISHED surveys and must drop `publisherName`. The outcome mock may keep calling `releaseDuePendingRewards` (mock-only substitute for IR.2b), but label it MOCK-ONLY in a comment.
  - [ ] 8.9 Update the ASSUMED/VERIFIED doc comments in the four service files to `VERIFIED: <controller file>`.

## Field-by-field contract tables

Legend: ✅ derivable from the source of truth · ⚠️ derivable with a stated rule · ❌ **not derivable**, contract change required

### `GET /surveys/:id` (frontend `surveySummarySchema`, `survey-form-service.ts` lines 34-44)

| Field | Frontend expects | Backend source of truth | Status |
|---|---|---|---|
| `id` | uuid | `Form.id` | ✅ |
| `title` | string ≥1 | `Form.title` | ✅ |
| `description` | (absent) | `Form.description` (nullable). The AC lists it; add it to the schema | ✅ new |
| `type` | `INTERNAL`\|`EXTERNAL` | `Form.type` | ✅ |
| `status` | `formStatusEnum` | `Form.status`; always `'PUBLISHED'` on 200 (other statuses 404) | ✅ |
| `rewardPerResponse` | int ≥0 | `Form.rewardPerResponse` (the advertised reward, credited in full per E6-D1) | ✅ |
| `estimatedEffortSeconds` | int ≥0 | BE-12: `Form.estimatedDurationMinutes*60` if >0, else `schemaJson.metadata.expectedEffortSeconds` of the newest **published** version, else 60 (`marketplace.service.ts` about lines 92-97) | ⚠️ shared helper T1.8 |
| `expectedCompletions` | int ≥0 | `Form.expectedCompletions` | ✅ |
| `completedCompletions` | int ≥0 | `getQuotaStatus().completedCount` = `countCompletionsByFormIds` (Responses SUBMITTED/VALIDATED + COMPLETED attempts without a Response, guests included) | ✅ |
| `remainingSlots` | (absent) | `max(0, expected − completed − activeReservationCount)`. The AC says "remaining slots"; add it | ✅ new |
| `publisherName` | optional string | ❌ `User` has no display-name column (only `email`, which is PII and must not be exposed on a public route) | ❌ drop (Q1) |
| — excluded | — | `targetingJson`, `completionCode`, `externalUrl`, `publisherId`, `closeCount/closeKind`, escrow/pricing | never |

### `GET /attempts/:attemptId` (frontend `attemptDetailsSchema`, `attempts-service.ts` lines 52-96)

| Field | Frontend expects | Backend source of truth | Status |
|---|---|---|---|
| `attemptId` | uuid | `SurveyAttempt.id` | ✅ |
| `responseId` | uuid\|null | `findResponseByAttemptId(attempt.id)?.id`; null for EXTERNAL | ✅ |
| `formId` | uuid | `SurveyAttempt.surveyId` | ✅ |
| `formVersionId` | uuid | `SurveyAttempt.formVersionId`. For EXTERNAL it may have been **re-pinned** to a newer version by BE-7 (decision D4) after a code rotation; this is intended | ✅ |
| `versionNumber` | int>0, nullable/optional | pinned `FormVersion.versionNumber`. Make it **required** (non-null) in the shared schema | ✅ |
| `type` | enum | `Form.type` | ✅ |
| `status` | `IN_PROGRESS`/`COMPLETED`/`ABANDONED`/`LOCKED` | `SurveyAttempt.status`, returned as persisted (no lazy expiry on read) | ✅ |
| `closedReason` | `EXPIRED`\|`CANCELLED`\|null, optional | NEW column `closed_reason` (T2). Null for open or completed attempts and for legacy abandoned rows | ⚠️ needs migration |
| `closedAt` | (absent) | NEW column `closed_at`; add it | ⚠️ new |
| `rewardStatus` | optional | Duplicates `/outcome` and would require ledger reads on every runner load. **Remove** from the attempt read; the completion screen uses `/outcome` | ❌ remove (Q3) |
| `startedAt` | datetime | `SurveyAttempt.startedAt` (server-authoritative) | ✅ |
| `expiresAt` | datetime | `startedAt + RESERVATION_EXPIRY_MS` (not stored; same formula as the start response and `conflictingAttemptError`) | ✅ |
| `submittedAt` | datetime\|null | `SurveyAttempt.submittedAt` | ✅ |
| `wrongCodeCount` | int ≥0 | `failedCodeVerifications` (`codeVerification.failedCount`) | ✅ |
| `accountWrongCodeCount` | int ≥0, optional | `countCompletionCodeFailures(respondentId, formVersionId)` (E5-D1, reset-aware); `0` for INTERNAL. Make it required | ✅ |
| `timeBarrier` | `attemptTimeBarrierSchema`, nullable/optional | `describeAttemptTimeBarrier(resolveTimeBarrier(type, pinnedVersion), startedAt)`, identical to the start response. Make it required | ✅ |
| `survey.title` | string | `Form.title` | ✅ |
| `survey.rewardPerResponse` | int | `Form.rewardPerResponse` | ✅ |
| `survey.estimatedEffortSeconds` | int | BE-12 helper using the **pinned** version's metadata | ⚠️ |
| `survey.publisherName` | **required** string | ❌ no source (see summary) | ❌ drop (Q1) |
| `survey.externalUrl` | url\|null | pinned `FormVersion.externalUrl` for EXTERNAL; null for INTERNAL | ✅ |
| `survey.status` | (absent) | `Form.status`. Add it: it drives the "form updated/closed" panel (replaces `isVersionMismatch`) | ✅ new |
| `form` | (absent; today fetched from `GET /public/forms/:id` = **current** version, which also refuses `requireAuth` forms) | pinned `FormVersion.schemaJson` projected to `attemptPinnedFormSchema`; INTERNAL only, else null | ✅ new (API-05) |

### `GET /attempts/:attemptId/outcome` (frontend `attemptOutcomeSchema`, `submission-service.ts` lines 39-50)

| Field | Frontend expects | Backend source of truth | Status |
|---|---|---|---|
| `attemptId` | uuid | `SurveyAttempt.id` | ✅ |
| `attemptStatus` | (absent) | `SurveyAttempt.status`; add it | ✅ new |
| `submittedAt` | datetime\|null | `SurveyAttempt.submittedAt` | ✅ |
| `reward` | object\|null | Always an object; `state` expresses "no reward" (Q2) | ⚠️ shape change |
| `reward.status` → `reward.state` | `rewardSettlementStatusSchema` (`SETTLED`/`PENDING`/`HELD_IN_INTEGRITY`/`SKIPPED_GUEST`) | `attemptRewardStateSchema`, derived per the mapping below. The epic names `AVAILABLE`, which the existing enum calls `SETTLED` | ⚠️ enum change (Q2) |
| `reward.amount` | int ≥0 | journal positive total (`RewardSettlementResultDto.amount`); 0 when no journal | ✅ |
| `reward.targetAccountClass` | ledger class\|null | `USER_AVAILABLE` / `PENDING` / `INTEGRITY_HOLD` from the journal kind; null when no journal | ✅ |
| `reward.journalId` | (absent) | journal id; add it (traceability, IR.3 "explained by ledger entries") | ✅ new |
| `reward.creditedAt` | (absent) | `journal.createdAt` (`settledAt` in `RewardSettlementResultDto`) | ✅ new |
| `reward.releasesAt` | (absent) | `external-completion` `createdAt + PENDING_REWARD_MATURITY_MS` (48 h), PENDING only. Required by the epic AC | ✅ new |
| `accountActivated` | boolean | = `starterUnlock.activatedByThisAttempt` | ⚠️ rule below |
| `starterUnlock` | (absent) | `{ activatedByThisAttempt, amount, activatedAt }` from `getActivationSnapshot` | ⚠️ new |

**Reward-state mapping (read-only):**

| Attempt | Ledger evidence (Economy query) | `state` | `targetAccountClass` |
|---|---|---|---|
| not `COMPLETED` | none read | `NOT_COMPLETED` | null |
| INTERNAL, COMPLETED | `findInternalSettlement(responseId)` status `SETTLED` (`internal-reward:`) | `AVAILABLE` | `USER_AVAILABLE` |
| INTERNAL, COMPLETED | status `HELD_IN_INTEGRITY` (`integrity-hold:`, ENFORCED only) | `HELD_IN_INTEGRITY` | `INTEGRITY_HOLD` |
| INTERNAL, COMPLETED | no journal and `findInternalRewardRequest(responseId)` has `rewardAmount > 0` | `AWAITING_SETTLEMENT` (settlement failed after commit; re-driven by the owner's submit replay or Admin re-drive, Epic 6 P5) | null |
| INTERNAL, COMPLETED | no journal and no positive reward request (zero-reward survey) | `NO_REWARD` | null |
| EXTERNAL, COMPLETED | `getExternalSettlementState` = `PENDING` | `PENDING` (+`releasesAt`) | `PENDING` |
| EXTERNAL, COMPLETED | `RELEASED` (release journal or dispute resolved for the respondent) | `AVAILABLE` | `USER_AVAILABLE` |
| EXTERNAL, COMPLETED | `HELD` (open dispute hold) | `HELD_IN_DISPUTE` | `PENDING` |
| EXTERNAL, COMPLETED | `REVERSED` or `REFUNDED_TO_PUBLISHER` | `REVERSED` | null |
| EXTERNAL, COMPLETED | `NONE` (zero reward or missing credit) | `NO_REWARD` | null |

`amount` / `journalId` / `creditedAt` always come from the **credit** journal (`findExternalSettlement` / `findInternalSettlement`), including after a release, so the Respondent sees what was credited. Integrity-hold release through `integrity-decision:{decisionId}` is **not** looked up: Epic 10 decisions are deferred and ENFORCED is gated, so a held reward stays `HELD_IN_INTEGRITY` until Epic 10 adds a decision lookup. Record this in the Completion Notes.

**Starter-unlock attribution:** `activatedByThisAttempt = unlockedAt !== null && activationSurvey?.formId === attempt.surveyId && activationSurvey.source === form.type`. FR-25 allows one completion per account per logical Form, so `(formId, source)` identifies the attempt. For EXTERNAL, activation only happens after the 48 h release (the activation rule requires a CONFIRMED completion), so a PENDING outcome reads `false`. This matches the frontend rule "activation is only claimed for a confirmed reward".

### `POST /attempts/:attemptId/cancel` (frontend `cancelAttemptResponseSchema`, `external-service.ts` lines 65-77)

| Item | Frontend expects | Backend | Status |
|---|---|---|---|
| request body | `{}` | `z.object({}).strict()` via `ZodValidationPipe` + `JsonOnlyGuard` | ✅ |
| `Idempotency-Key` | not sent today | **required**, `idempotencyKeySchema` (8-128 chars `[A-Za-z0-9._:-]`); 400 `INVALID_IDEMPOTENCY_KEY` | ⚠️ FE change (Q4) |
| `X-CSRF-Token` | sent by `apiRequest` (non-GET default) | `CsrfGuard` | ✅ |
| `attemptId` | uuid | `SurveyAttempt.id` | ✅ |
| `status` | `'ABANDONED'` | persisted status | ✅ |
| `closedReason` | (absent) | `'CANCELLED'`; add it | ✅ new |
| `closedAt` | (absent) | persisted `closed_at` (original on replay) | ✅ new |
| 409 code | `ATTEMPT_NOT_IN_PROGRESS` | `AttemptNotInProgressException` + `details {status, closedReason}` | ✅ |
| not-owner code | mock: 403 `PARTICIPANT_NOT_ELIGIBLE` / 404 `SURVEY_NOT_AVAILABLE` | **404 `ATTEMPT_NOT_FOUND`** (epic AC); fix the mock | ⚠️ mock change |

## Dev Notes

### Current state of the code this story touches (read before editing)

- **`participation.controller.ts`**: commands only (`POST forms|surveys/:id/attempts`, telemetry, submit, verify-code, report-missing-code), with class-level `@UseGuards(SessionAuthGuard)` and `@Controller(['', 'api'])`. There is no GET route. Do **not** add the reads here: put them in a new `survey-runner.controller.ts` (T6) to keep the diff small.
- **`participation.service.ts` (1,864 lines)**: `startAttempt` computes `expiresAt = startedAt + RESERVATION_EXPIRY_MS` and returns `timeBarrier` from the private `resolveTimeBarrier`/`describeAttemptTimeBarrier` (about lines 1616-1659) and the pinned version from the private `findPinnedVersion` (about line 1600). Extract these three into an exported pure helper module (for example `application/attempt-projection.ts`) and call it from both services. **Preserve** behaviour: every existing `participation.service*.spec.ts` must stay green unchanged.
- **Ownership pattern divergence**: verify-code and report-missing-code answer a non-owner with `403 PARTICIPANT_NOT_ELIGIBLE` and an unknown attempt with `404 SURVEY_NOT_AVAILABLE`. The epic requires **404 `ATTEMPT_NOT_FOUND`** for the new routes. Do not change the existing commands (their contract is VERIFIED in `external-service.ts`); the divergence is recorded here on purpose.
- **Submit after cancel**: `submitInternalResponse` sees `attempt.status !== 'IN_PROGRESS'` → `409 ATTEMPT_EXPIRED` ("abandoned…"). A cancel that wins the row lock makes `submitInternalResponseTransaction` return `NOT_SUBMITTABLE` → `409 ATTEMPT_EXPIRED`. Verify-code: `ABANDONED` → `409 ATTEMPT_EXPIRED`. The report-missing-code route refuses ABANDONED attempts (`ATTEMPT_EXPIRED`), so a cancelled External attempt can no longer report a missing code (Q5).
- **Quota release is implicit**: `getQuotaStatusWith` and `reserveAttempt` count only `IN_PROGRESS` attempts with `startedAt >= cutoff`. The ABANDONED transition *is* the release; there is no counter to decrement. The E8-D6 per-user open-attempt count (`findOpenAttemptStartTimes`) uses the same predicate, so it drops too.
- **Lazy abandonment (Epic 5 DF7)** happens only inside `reserveAttempt` when the same account restarts. IR.2b adds the reservation-expiry job and must write `closedReason='EXPIRED'` too (coordinate: the column lands here).
- **`GET /public/forms/:id`** (`public-forms.service.ts`) serves the **current** version and refuses `settings.requireAuth === true || allowPublicAccess === false` with 403 `PUBLIC_FORM_ACCESS_DISABLED`. That is why the authenticated runner must stop using it (AC3/T8.4). Leave the public route untouched: guest `/f/:id` still depends on it.
- **E5-D4 option A (strict)**: "Create New Version" moves the form PUBLISHED→DRAFT, and in-flight submits then fail. After the new version is published, the form is PUBLISHED again and the *old* pinned version still has `isPublished = true`, so an attempt pinned to v1 can still submit within its 30 minutes. Serving the pinned `form` is therefore both correct (AD-19) and necessary.
- **Economy read methods already present**: `LedgerService.findInternalRewardSettlement`, `findPendingRewardSettlement`, `getExternalCreditState`, `getExternalSettlementState`, `findJournalByIdempotencyKey`. `RewardSettlementCoordinator` exposes `findInternalSettlement`, `findExternalSettlement` and `getExternalCreditState`, so only `getExternalSettlementState` must be added (T4.1). `StarterPointsCoordinator.getStatus` **writes** (`ensureStarterGrant`), so it must not be used from the outcome route (T4.2).
- **Frontend runner today**: `SurveyTakingScreen` → `getAttempt` then `getSurveyForm(formId)` (current version) plus a version-mismatch restart. `use-completion.ts` → `getAttempt` + `getAttemptOutcome` + a sessionStorage stash fallback (`readStashedSubmission`, keep it). `use-start-survey.ts` and `app/surveys/[id]/full/SurveyFullContent.tsx` → `getSurveySummary`. `CancelAttemptDialog.tsx` and `SurveyTakingScreen` → `cancelAttempt`.
- **MSW mock behaviours that are NOT backend behaviour**: the mock attempt read reports an expired `IN_PROGRESS` as `ABANDONED`/`EXPIRED`, and the mock outcome calls `releaseDuePendingRewards` (releases 48 h rewards on read). The real backend does neither: a read is side-effect free and releases happen via IR.2b. IR.3 tests must not rely on either.

### Architecture compliance (must follow)

- **AD-16**: Participation owns `SurveyAttempt`/`Response` and the migration. Economy data is read only through Economy-owned methods behind `AttemptRewardQueryPort`; no Prisma ledger access from Participation. Research data is read through `FormRepositoryPort` (already the case).
- **AD-19**: the pinned `formVersionId` is the only source for `form`, `versionNumber`, `timeBarrier`, `externalUrl` and effort on the attempt read. The server-authoritative `startedAt` is the basis of `expiresAt`/barrier.
- **AD-20**: `CsrfGuard` + `JsonOnlyGuard` on the cancel command, session-only reads, `@Public()` summary. No token or code material is logged.
- **Consistency conventions**: `{data,error,meta}`, stable codes, strict Zod on every boundary, UUIDs, ISO-8601 UTC, and a contract-defined `Idempotency-Key` on the retryable command. No list endpoints here, so the cursor-pagination question does not apply.
- **Clean Architecture** (`test/architecture.spec.ts`): no `@nestjs/*` or infrastructure import in `domain/` or `application/`. Controllers are registered with both prefixes.
- **AD-18 / privacy**: no publisher identity, targeting or completion-code verifier leaves the backend on these routes.

### Library / framework

No new dependency. Use the existing Zod `^3.24.2` (`packages/schemas`), NestJS guards/pipes already in the repo, Prisma (existing client; run `prisma generate` after the schema change), `supertest` for e2e, and `node --test` on the frontend. No web research was needed: every API used here is already in use in this repository at the pinned versions.

### File structure

**New:**
- `packages/schemas/src/participation/survey-runner.schema.ts` (+ `.spec.ts`)
- `apps/backend/prisma/migrations/20260930xxxxxx_survey_attempt_close_reason/migration.sql`
- `apps/backend/src/modules/participation/application/survey-runner-read.service.ts` (+ `.spec.ts`)
- `apps/backend/src/modules/participation/application/attempt-projection.ts` (extracted pure helpers) (+ `.spec.ts`)
- `apps/backend/src/modules/participation/application/ports/attempt-reward-query.port.ts`
- `apps/backend/src/modules/participation/presentation/survey-runner.controller.ts` (+ `.spec.ts`)
- `apps/backend/test/survey-runner-reads.e2e-spec.ts`
- `apps/backend/test/attempt-cancel.prisma.e2e-spec.ts`
- `apps/frontend/my-app/tests/participation-contract.test.mjs`

**Updated:**
- `packages/schemas/src/participation/index.ts`
- `packages/schemas/src/marketplace/*` (effort helper export)
- `apps/backend/prisma/schema.prisma`
- `participation/domain/survey-attempt.entity.ts`
- `participation/application/ports/participation-repository.port.ts`
- `participation/infrastructure/{prisma,in-memory}-participation.repository.ts`
- `participation/application/participation.service.ts` (use the extracted helpers only)
- `participation/application/exceptions/participation.exceptions.ts`
- `participation/participation.module.ts`
- `common/http/http-exception.filter.ts` (+ spec)
- `economy/application/reward-settlement.coordinator.ts` (+ spec)
- `economy/application/starter-points.coordinator.ts` (+ spec)
- `marketplace/application/marketplace.service.ts` (helper)
- Frontend: the four `lib/participation/*-service.ts` files, `completion-view.ts`, `SurveyTakingScreen.tsx`, `SurveyRunnerView.tsx`, `CancelAttemptDialog.tsx`, `mocks/handlers/participation{,-internal,-external}.ts`, and the affected `tests/*.test.mjs` (`participation-internal`, `participation-review`, `respondent-journey`, `external-code`, `attempt-window`, as applicable)

## Test Plan

**Unit (`apps/backend`, `jest`)**
1. `survey-runner-read.service.spec.ts` (in-memory form/participation repositories, fake `AttemptRewardQueryPort`, fixed clock):
   - Summary: 200 for PUBLISHED. 404 `SURVEY_NOT_FOUND` for unknown, DRAFT, ESCROW_LOCKED, MODERATION_QUEUE, CLOSED, and PUBLISHED without a published version, all with identical messages. `remainingSlots` counts active reservations and ignores expired ones. Effort: minutes rule, metadata fallback, default 60. The output parses with the strict schema, and a `JSON.stringify` of the output contains none of `targetingJson`/`completionCode`/`publisherId`/`externalUrl`.
   - Attempt read: owner 200. Other user, guest attempt and unknown all give 404 `ATTEMPT_NOT_FOUND`. **Pinning**: v1 attempt → v2 published → still v1 blocks/`versionNumber`/`timeBarrier`. EXTERNAL: `form: null`, pinned `externalUrl`, `accountWrongCodeCount` reflects an Admin reset (E5-D1). An expired IN_PROGRESS is returned as IN_PROGRESS (no write: the repository spy shows no update calls). `timeBarrier` deep-equals the start response for the same attempt.
   - Outcome: every row of the reward-state mapping table, `releasesAt = createdAt + 48h`, amount from the journal (not the form price after a price edit), and the starter attribution cases (activated by this form / by another form / not unlocked / EXTERNAL pending). **No-mutation spies**: `settleInternalReward`, `settleExternalReward`, `releasePendingReward`, `tryUnlockStarterPoints`, `ensureStarterGrant` and `publish` are all called 0 times.
   - Cancel: IN_PROGRESS → CANCELLED with `closedAt`. Replay → 200 with the same `closedAt`. COMPLETED, LOCKED, ABANDONED-EXPIRED and expired IN_PROGRESS → 409 with the right `details`. Not owner → 404. The burst limiter is invoked.
2. `attempt-projection.spec.ts`: the extracted helpers are unchanged against the old private behaviour (Internal barrier = max(questions × 2 s, publisher minimum); External = publisher minimum or 15 s).
3. `survey-runner.controller.spec.ts`: guard metadata (`@Public` only on the summary; `CsrfGuard`+`JsonOnlyGuard` on cancel), `Cache-Control: no-store` on the attempt reads, `INVALID_IDEMPOTENCY_KEY` for a missing, short or illegal-character key, and envelope shape.
4. `http-exception.filter.spec.ts`: 404/404/409 mappings with `details`.
5. `reward-settlement.coordinator.spec.ts` / `starter-points.coordinator.spec.ts`: new read methods delegate, and `getActivationSnapshot` never writes.
6. `prisma-participation.repository.spec.ts`: the `cancelAttempt` SQL order (form `FOR SHARE` before attempt `FOR UPDATE`, asserted on the mocked `$queryRaw` call order, like the existing submit/verify specs), and that `abandonExpiredAttemptsWith` writes `closedReason: 'EXPIRED'`.
7. Existing suites untouched and green: `participation.service*.spec.ts`, `marketplace.service.spec.ts` (effort helper), `survey-feedback.*`.

**Schemas (`packages/schemas`, `jest`)**: `survey-runner.schema.spec.ts` as in T1.9.

**E2E (`apps/backend/test`, `npm run test:e2e`)**
- `survey-runner-reads.e2e-spec.ts` (AppModule, in-memory repositories, same scaffolding as `survey-attempt.e2e-spec.ts`):
  - Summary without a cookie → 200. With a cookie → identical body. Draft → 404.
  - Start → `GET /attempts/:id` (+ `/api/` twin) parses with `surveyAttemptDetailsSchema`, and `responseId` and `timeBarrier` match the start response.
  - A second user gets 404 on read, outcome and cancel.
  - Cancel without CSRF → 403. Without a key → 400. Non-JSON → 415. No session → 401.
  - At full quota, respondent B gets `SURVEY_QUOTA_FULL`; A cancels; B's start → 201.
  - Cancel twice → both 200, same `closedAt`. Submit after cancel → 409 `ATTEMPT_EXPIRED`.
  - Internal submit → outcome `AVAILABLE` with amount = credited journal, and journal count unchanged after 3 outcome reads.
  - External verify → outcome `PENDING` with `releasesAt`. After the Admin `POST /economy/rewards/release-pending/:attemptId` (clock past 48 h) → `AVAILABLE`.
  - Every body is parsed with the shared schema (the backend half of the contract test).
- `attempt-cancel.prisma.e2e-spec.ts` (real PostgreSQL, gated and skipped like `external-survey-idempotency.prisma.e2e-spec.ts`; dedicated `*_test` DB via `migrate deploy`): 20 iterations of `Promise.all([cancel, submit])` on fresh attempts. Exactly one of {200 cancel, 200 submit} wins; the other gets its documented 409. The final attempt row is consistent (COMPLETED with a VALIDATED Response, or ABANDONED/CANCELLED with an IN_PROGRESS Response), and there is no reward journal when cancel won. Repeat for `cancel` vs `verify-code` on External attempts. This also closes the E8-D6 "proven only with mocks" gap for the cancel path.

**Frontend (`apps/frontend/my-app`, `node --test`, `tsc --noEmit`, `eslint`)**
- `tests/participation-contract.test.mjs`: for each of the four routes, drive the MSW handler (the same approach as the existing handler tests) and `safeParse` the `data` with the shared schema; assert the error codes 404 `SURVEY_NOT_FOUND`, 404 `ATTEMPT_NOT_FOUND`, 409 `ATTEMPT_NOT_IN_PROGRESS` and 400 `INVALID_IDEMPOTENCY_KEY`.
- `completion-view` mapping for every `reward.state`. `attemptPhase` with `closedReason`.
- The runner uses `attempt.form` (no `/public/forms` call for authenticated attempts). The `survey.status !== 'PUBLISHED'` panel. The cancel dialog: 409 → closed.

## Previous Story Intelligence (Epic 5 / 6 / 9 learnings that apply)

- **Epic 5 review P7 / E5-D3**: every attempt state change is state-predicated under the attempt row lock, and a replay returns the original result (200) instead of a 409. Cancel follows the same shape (`ALREADY_CANCELLED` → original `closedAt`).
- **Epic 5 review P1 / Epic 6 P6 / Epic 8 P3, lock order**: user completion lock → `forms` row → attempt row. Never take the attempt lock before the form lock (T3.2).
- **Epic 5 review P2**: security counters come only from server-owned columns (`failed_code_verifications`), never from `clientContext`. The attempt read must not echo `clientContext`.
- **Epic 5 review P16**: `RESERVATION_EXPIRY_MS` is shared from `@rescom/schemas`; do not hard-code 30 minutes.
- **Epic 5 review P24**: `CONFLICTING_ACTIVE_ATTEMPT.details` points to the caller's own attempt. The new `GET /attempts/:id` is what the frontend calls next to resume it.
- **BE-7 (decision D4)**: an External attempt can be re-pinned to a newer version after a code rotation. `formVersionId` on the read is the current pin, by design.
- **BE-12**: `estimatedDurationMinutes` wins over `metadata.expectedEffortSeconds`. Extract it; do not re-implement it (T1.8).
- **Epic 6 review P5 / P19**: replays and reads never re-price. The amount comes from the posted journal.
- **Epic 9 review P1 / P3**: notification recovery is a replay-only concern. The outcome GET must not trigger it.
- **Story 9.2 (`SurveyFeedbackService`)**: the owner-only `loadOwnedAttempt` → 404 pattern and the deps-object service constructor are the model for T5.
- **Bug 1.3**: every controller registers `x` and `api/x`.

## Git Intelligence

The last 5 commits (`d1175eb`, `2c7ae67`, `9fd09d9`, `987d359`, `0628d8e`) touch frontend publisher analytics mocks and planning docs only. None touches `participation`, `economy` or the four respondent service files, so the baseline in this story is current. The working tree has uncommitted planning edits (`epics.md`, `sprint-status.yaml`) unrelated to this code.

## Project Structure Notes

- The frontend is **not** an npm workspace member. It consumes `@rescom/schemas` via a tsconfig path + `transpilePackages`, and `npm run typecheck` pre-builds `packages/schemas/dist`. Rebuild after T1.
- The backend e2e `moduleNameMapper` maps `@rescom/schemas` to `src`, so no rebuild is needed for backend tests.
- Migration naming: `YYYYMMDDHHMMSS_snake_case`. The latest is `20260927060000_product_tour_progress`; pick a later timestamp.

## References

- Epic and ACs: `_bmad-output/planning-artifacts/epics.md` → "Story IR.2a" (lines about 1145-1176); dependency notes lines about 1100-1106.
- Gap register: `_bmad-output/planning-artifacts/implementation-readiness-report-2026-09-30.md` → "Backend-Missing Endpoints" and "Critical Violations #1".
- API-01..API-05: `_bmad-output/brainstorming/brainstorm-backend-integration-deployment-2026-09-29/integration-deployment-plan.md` §6.5 and the register table (about lines 338-342).
- Architecture: `ARCHITECTURE-SPINE.md` AD-16, AD-18, AD-19, AD-20, "Cross-Context Financial Workflow Map", "Consistency Conventions".
- Decisions: `code-review-decisions-2026-09-26.md` E5-D1, E5-D3, E5-D4 (A), E6-D1, E7-DN2/DN3, E8-D6, E9-D2; `deferred-work.md` Epic 5 DF7, E5-D4 option C, E8-D6 note.
- Backend code: `participation.controller.ts`, `participation.service.ts` (`startAttempt` about lines 174-396, `submitInternalResponse` about lines 606-935, `verifyExternalCompletionCode` about lines 984-1320, helpers about lines 1600-1660), `participation-repository.port.ts`, `prisma-participation.repository.ts` (`abandonExpiredAttemptsWith` about line 348, `submitInternalResponseTransaction` about line 668), `survey-feedback.service.ts`, `public-forms.service.ts`, `forms.controller.ts` (Idempotency-Key pattern, lines 72-88), `reward-settlement.coordinator.ts`, `ledger.service.ts` (keys lines 56-99, `findInternalRewardSettlement`/`findPendingRewardSettlement` about lines 1399-1430, `getExternalSettlementState` about line 2072), `starter-points.coordinator.ts` (`getStatus` / `ensureStarterGrant` / `loadSnapshot`), `common/http/response.envelope.ts`, `common/http/http-exception.filter.ts`, `common/database/completion-counts.ts`, `prisma/schema.prisma` (`Form`, `FormVersion`, `SurveyAttempt`, `Response`, `User`).
- Frontend code: `lib/participation/{survey-form-service,attempts-service,submission-service,external-service,completion-view}.ts`, `mocks/handlers/participation{,-internal,-external}.ts`, `app/(signed-in)/(focus)/attempts/[id]/components/SurveyTakingScreen.tsx`, `.../complete/hooks/use-completion.ts`, `.../google-form/components/CancelAttemptDialog.tsx`.

## Questions / Decisions for Owner

Each question has a recommended default that the dev agent may implement if no answer arrives before development starts. The default is marked **(default)**.

1. **Q1: `publisherName` has no source.** `User` has no display name; the only identity is `email` (PII). Options: A **(default)**: drop the field from both schemas and render no publisher line on the runner/consent card. B: add a Publisher display name (Identity-owned column + profile edit, which fits IR.4b "Profile update") and expose it later. C: expose a masked email (not recommended: AD-18/privacy).
2. **Q2: Outcome state vocabulary.** The epic names `AVAILABLE`; the existing shared `rewardSettlementStatusSchema` (used by submit/verify responses) says `SETTLED`. The story introduces an outcome-specific `attemptRewardStateSchema` (AVAILABLE, PENDING, HELD_IN_INTEGRITY, HELD_IN_DISPUTE, REVERSED, AWAITING_SETTLEMENT, NO_REWARD, NOT_COMPLETED) and leaves the submit/verify schemas unchanged. Confirm the edge states and whether the UI needs copy for `AWAITING_SETTLEMENT`/`REVERSED`/`HELD_IN_DISPUTE` in the pilot (disputes are P2-hidden per the readiness report). **(default: implement all eight states; the UI falls back to existing copy for the edge states.)**
3. **Q3: Drop `rewardStatus` from `GET /attempts/:id`?** It duplicates `/outcome` and would add ledger reads to every runner load. **(default: drop.)**
4. **Q4: `Idempotency-Key` required on cancel?** The AC says the key is sent. Replay is state-based anyway (a second cancel with any key returns the original 200), so the key is validated but not stored. **(default: required and validated, not persisted.)** Alternative: persist `cancel_idempotency_key` for audit, or make the key optional.
5. **Q5: Cancel after a missing-code report (External).** Once cancelled, the attempt can no longer be reported (the report route refuses ABANDONED). Should cancel refuse an attempt with `missingCodeReportedAt` set? **(default: allow cancel; the existing report stays on the row for Admin follow-up.)**
6. **Q6: Admin read access.** The epic allows "Admin read access, if any, is explicit and audited". **(default: none in this story; Admin attempt inspection belongs to the Admin dispute/fraud tooling, which is P2-deferred.)**
7. **Q7: CLOSED surveys on `GET /surveys/:id`.** The AC's "unpublished → 404" is applied strictly, so a survey closed by its owner or by the IR.2b deadline refund returns 404, and the 18.7 "Khảo sát đã đủ người" page shows its card-less variant (already supported by `SurveyFullContent`). Should owner/deadline-closed surveys instead return 200 with `status: 'CLOSED'`? **(default: strict 404.)**
8. **Q8: The reservation-expiry job in IR.2b** must set `closedReason = 'EXPIRED'` using the column added here. Confirm that IR.2b's implementation owner is aware (sequencing: IR.2a migration first).

## Dev Agent Record

### Agent Model Used

(to be filled by the dev agent)

### Debug Log References

### Completion Notes List

- Story context created 2026-09-30 by create-story (context-engine analysis completed; comprehensive developer guide created). Grounded in the code at baseline `d1175eb`.

### File List
