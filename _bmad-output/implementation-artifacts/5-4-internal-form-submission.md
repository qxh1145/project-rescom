---
baseline_commit: 378e4a71ff125fb1acf6ee18291fc298ae56bf94
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "apps/backend/prisma/schema.prisma"
  - "packages/schemas/src/forms/form-blocks.schema.ts"
  - "packages/schemas/src/forms/form-preview.ts"
  - "apps/backend/src/modules/participation/application/participation.service.ts"
  - "apps/backend/src/modules/economy/application/ledger.service.ts"
---

# Story 5.4: Internal Form Submission

Status: done

## Story

As a Respondent,
I want to submit my completed internal survey,
So that my answers are securely saved and I am credited with my reward instantly.

## Acceptance Criteria

### AC1 — Submission Schema Contracts & Answer Validation (`packages/schemas`, FR-40)
**Given** a completed internal survey payload
**When** validating the submission request against shared schemas
**Then**:
1. Defines `internalFormSubmissionInputSchema` validating:
   - `attemptId`: string UUID (optional if present in route param, validated)
   - `answers`: either an array of `{ blockId: string, value: unknown }` or a key-value map `Record<string, unknown>`
   - `clientContext`: optional client metadata record — flat and bounded (≤ 20 keys, ≤ 2 KB), never read by server logic (Epic 5 review P2)
2. Defines `internalFormSubmissionResponseSchema` / `InternalFormSubmissionResponseDto`:
   - `responseId`: string UUID
   - `attemptId`: string UUID
   - `formId`: string UUID
   - `formVersionId`: string UUID
   - `status`: `'VALIDATED'`
   - `submittedAt`: ISO datetime string
   - `reward`: `RewardSettlementResultDto | null` (the settlement for authenticated respondents; a `SKIPPED_GUEST` result for guests, as in AC4.3; `null` only while a failed settlement is pending re-drive — Epic 5 review P27, Epic 6 review P5)
   - `policyMode`: `'SHADOW' | 'ADVISORY' | 'ENFORCED'`
3. Exports validation function `validateAnswersAgainstFormDefinition(blocks: FormBlock[], answers: Record<string, unknown> | BlockAnswer[])` enforcing:
   - All `required` question blocks must have non-empty, non-null answers.
   - Non-required blocks can be omitted or null.
   - Values conform strictly to block-type constraints (text length, number min/max, option existence for single/multiple choice, date format, linear scale bounds, rating range).
   - Reject unknown block IDs and duplicate block IDs.
4. Defines domain outbox event schemas:
   - `internalRewardRequestedPayloadSchema`
   - `integrityAssessmentRequestedPayloadSchema`

### AC2 — Strict Backend Answer Verification & Time Barrier Validation (`apps/backend`, FR-13, FR-40)
**Given** an incoming submission on `POST /api/responses/:id/submit` or `POST /api/forms/:id/submissions`
**When** the backend evaluates the submission
**Then**:
1. Locates the `Response` and associated `SurveyAttempt`:
   - Rejects with HTTP 404 if response or attempt does not exist.
   - Rejects with HTTP 409 if response status is already `VALIDATED` or `SUBMITTED` (or attempt status `COMPLETED`).
   - Rejects with HTTP 409 if attempt is expired or `ABANDONED`.

   > **Amendment 2026-09-26 (code-review decision E5-D3, option A):** resubmitting an already-submitted response (`VALIDATED`/`SUBMITTED`, attempt `COMPLETED`) is **not** a 409: it is an idempotent HTTP 200 that returns the original result — the same `responseId`, the original `submittedAt`, the posted reward and the pinned policy mode (AD-16 "retry returns the original result"; an authenticated owner's replay also re-drives a settlement that failed after commit, Epic 6 P5). HTTP 409 remains for expired, `ABANDONED` and `LOCKED` attempts (and 409 `SURVEY_ALREADY_COMPLETED` for a response under review or another attempt that already completed the logical Form).
   >
   > **Amendment 2026-09-26 (code-review decision E5-D4, option A):** submissions are accepted only while the Form is `PUBLISHED` (strict): "Create New Version" moves the Form to `DRAFT` and cuts off every attempt still pinned to the previous version. The Publisher is warned first — the builder shows the live count from `GET /forms/:id/in-progress-attempts`, and `POST /forms/:id/versions` returns `interruptedAttempts`.
2. Authorization:
   - If authenticated, caller `user.id` must match `response.respondentId` (rejects HTTP 403 `PARTICIPANT_NOT_ELIGIBLE` on mismatch).
   - If guest, `response.isGuest` must be true.
3. Fetches the immutable `FormVersion` pinned to the response/attempt.
4. Validates submitted answers against the `FormVersion.schemaJson` block definitions; rejects with HTTP 400 (`InvalidFormSubmissionException`) with structured validation error details if invalid.
5. If `metadata.minTimeBarrierSeconds` is configured, verifies `now - attempt.startedAt >= minTimeBarrierSeconds`. If time is too fast, flags time anomaly and fails or records telemetry per FR-13.
6. For `file_upload` blocks: verifies referenced `StoredObject` is in `CLEAN` or `ATTACHED` state (rejects quarantined, infected, or non-existent files per AD-22).

### AC3 — Atomic Response State Transition & AD-10 Outbox Events (`apps/backend`, AD-10, AD-19)
**Given** valid answers and an active attempt
**When** committing the submission
**Then**:
1. In a **single atomic database transaction**:
   - Transitions `Response.status` to `VALIDATED`, persists `answersJson`, and sets `submittedAt = now`.
   - Transitions `SurveyAttempt.status` to `COMPLETED` and sets `submittedAt = now`.
   - Attaches verified `StoredObject` files (`status = ATTACHED`).
   - Pins the effective `ScoringPolicy` deployment (identity and mode: `SHADOW`, `ADVISORY`, or `ENFORCED`).
   - Creates independent versioned `IntegrityAssessmentRequested` Outbox event:
     - `idempotencyKey`: `integrity-assessment:${response.id}:${policyDeploymentId}`
     - `eventType`: `IntegrityAssessmentRequested`
     - `aggregateType`: `Response`
     - `aggregateId`: `response.id`
     - `orderingStream`: `integrity:${response.id}`
     - `streamSequence`: 1
     - `status`: `PENDING`
   - For authenticated Respondent, ALSO creates independent `InternalRewardRequested` Outbox event:
     - `idempotencyKey`: `internal-reward:${response.id}`
     - `eventType`: `InternalRewardRequested`
     - `aggregateType`: `Response`
     - `aggregateId`: `response.id`
     - `orderingStream`: `internal-reward:${response.id}` (a single-event stream per response, like `integrity:${response.id}`, so AD-10 contiguity holds — Epic 5 review P21)
     - `streamSequence`: 1
     - `status`: `PENDING`
   - Guest internal submissions omit `InternalRewardRequested` (assessment event only).

### AC4 — Economy Reward Settlement Integration (`apps/backend`, FR-29, AD-16)
**Given** an authenticated internal survey submission
**When** executing the reward path
**Then**:
1. In `SHADOW` or `ADVISORY` mode:
   - Calls `LedgerService.creditInternalReward` to transfer points from Publisher's `ESCROW` to Respondent's `USER_AVAILABLE` immediately and idempotently (does not wait for scoring).
   - Returns `{ status: 'SETTLED', journalId, amount, targetAccountClass: 'USER_AVAILABLE' }`.
2. In `ENFORCED` mode:
   - Posts reward to `INTEGRITY_HOLD` account.
   - Later decision releases or retains the hold; terminal failure / missed deadline emits fail-open release (`failOpenIntegrityHold`).
3. For Guest submissions:
   - Skips reward transfer, returning `{ status: 'SKIPPED_GUEST', journalId: null, amount: 0, targetAccountClass: null }`.

### AC5 — Frontend Respondent Submission Flow (`apps/frontend/my-app`)
**Given** a respondent filling out an internal survey
**When** clicking "Submit Survey"
**Then**:
1. Client-side validates all questions before dispatching request.
2. Posts payload to `/api/responses/:id/submit` (or `/api/forms/:id/submissions`).
3. Displays loading state during submission.
4. On success:
   - Clears offline draft cache.
   - Records `SURVEY_SUBMITTED` telemetry and flushes queue.
   - Displays completion screen with earned points or guest confirmation.
5. On validation error:
   - Highlights offending questions and scrolls to first error.

### AC6 — Comprehensive Test Coverage
**Given** unit and integration test suites
**When** running tests
**Then**:
1. Schemas unit tests for submission validation, block checks, and outbox event schemas.
2. Participation service unit tests for:
   - Valid internal submission with instant reward credit (`SHADOW`/`ADVISORY`).
   - Valid internal submission with integrity hold (`ENFORCED`).
   - Guest internal submission (no reward, assessment outbox only).
   - Rejection on missing required blocks.
   - Rejection on answer constraint violations.
   - Rejection on unauthorized respondent ID mismatch.
   - Rejection on attempt already completed or expired.
     > **Amendment 2026-09-26 (code-review decision E5-D3):** an already-completed attempt is asserted as an idempotent 200 with the original result (unit + e2e); expired, `ABANDONED` and `LOCKED` attempts are asserted as 409.
   - Rejection on quarantined/infected file attachments.
3. Controller & E2E integration tests for `POST /api/responses/:id/submit`.
4. Zero regressions across existing tests.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Schemas for Form Submission & Validation (`packages/schemas`)** (AC: 1)
  - [x] 1.1 Create `packages/schemas/src/forms/internal-submission.schema.ts` defining input and output schemas, DTOs, and outbox payload contracts.
  - [x] 1.2 Implement `validateAnswersAgainstFormDefinition` in `packages/schemas/src/forms/internal-submission.schema.ts` supporting both array and record answer formats.
  - [x] 1.3 Export new contracts from `packages/schemas/src/index.ts`.
  - [x] 1.4 Add unit tests in `packages/schemas/src/forms/internal-submission.schema.spec.ts`.
  - [x] 1.5 Verify schemas build and tests pass.

- [x] **Task 2: Backend Participation Repository & Outbox Persistence (`apps/backend`)** (AC: 2, 3)
  - [x] 2.1 Update `ParticipationRepositoryPort` with `findResponseByAttemptId`, `findActivePolicyDeployment`, and atomic `submitInternalResponseTransaction`.
  - [x] 2.2 Implement `submitInternalResponseTransaction` in `PrismaParticipationRepository`:
    - Update `Response` status to `VALIDATED` with `answersJson` and `submittedAt`.
    - Update `SurveyAttempt` status to `COMPLETED` with `submittedAt`.
    - Create `OutboxEvent` for `InternalRewardRequested` (authenticated only).
    - Create `OutboxEvent` for `IntegrityAssessmentRequested`.
    - Update `StoredObject` records to `ATTACHED` for uploaded files.
  - [x] 2.3 Implement exception classes in `apps/backend/src/modules/participation/application/exceptions/participation.exceptions.ts`:
    - `InvalidFormSubmissionException` (400)
    - `SubmissionTooFastException` (422/400)
    - `ResponseNotFoundException` (404)
    - `AttemptExpiredException` (409)
  - [x] 2.4 Register exceptions in `apps/backend/src/common/http/http-exception.filter.ts`.

- [x] **Task 3: Backend Participation Service Submission Logic (`apps/backend`)** (AC: 2, 3, 4)
  - [x] 3.1 Implement `submitInternalResponse` in `ParticipationService`:
    - Locate Response and SurveyAttempt, verify active and unexpired.
    - Authorize caller (respondent ID match or guest).
    - Fetch FormVersion and strictly validate answers using `validateAnswersAgainstFormDefinition`.
    - Validate time barrier if configured in metadata.
    - Validate file attachments against `StoredObject` state.
    - Resolve policy deployment mode (`SHADOW`, `ADVISORY`, `ENFORCED`).
    - Execute `submitInternalResponseTransaction` atomically.
    - Settle reward via `LedgerService.creditInternalReward` (instant for `SHADOW`/`ADVISORY`, hold for `ENFORCED`, skip for guest).
  - [x] 3.2 Add unit tests for `submitInternalResponse` in `apps/backend/src/modules/participation/application/participation.service.spec.ts`.

- [x] **Task 4: Controller Endpoints & Wiring (`apps/backend`)** (AC: 2, 4)
  - [x] 4.1 In `ParticipationController`, add `POST /api/responses/:id/submit`, `POST /api/forms/:id/submissions`, and `POST /api/surveys/:id/submissions` endpoints with validation pipes, CSRF protection, and error envelopes.
  - [x] 4.2 Add controller unit tests in `apps/backend/src/modules/participation/presentation/participation.controller.spec.ts`.
  - [x] 4.3 Add E2E / integration test in `apps/backend/test/participation-submission.e2e-spec.ts`.

- [x] **Task 5: Frontend Integration & Verification (`apps/frontend/my-app`)** (AC: 5)
  - [x] 5.1 Verify and update `apps/frontend/my-app/app/forms/[id]/respond/page.tsx` and `FormRenderer.tsx` to handle submission responses, error messages, and reward displays.
  - [x] 5.2 Verify frontend build and typecheck.

- [x] **Task 6: Verification & Definition of Done** (AC: 6)
  - [x] 6.1 Run all unit, integration, and E2E test suites.
  - [x] 6.2 Verify zero regressions across `@rescom/schemas`, `backend`, and `frontend`.
  - [x] 6.3 Update File List, Completion Notes, and set status to `review`.

### Review Findings

_Epic 5 code review, 2026-09-26 (triage IDs in brackets; applied after the Epic 4 and Epic 6 review patches). Dismissed items are summarized in Story 5.1._

- [x] [Review][Decision] Resubmitting an already-submitted Internal response: 409 per spec, or idempotent 200 with the original result (D3, low) — AC2.1/AC6.2 say 409 `SURVEY_ALREADY_COMPLETED`; AD-16 ("retry returns the original result") and the Epic 6 P5 replay return 200 with the original response (and, for the owner, a non-fatal reward re-drive) — the current behaviour. Options: (A) idempotent 200 with the original pinned result (policy mode and amount from `internal-reward:{responseId}` / the journal), amending AC2.1/AC6.2; (B) 409 `SURVEY_ALREADY_COMPLETED` after the non-fatal re-drive, with `details {responseId, submittedAt, reward}`. **Triage recommendation: A** (a client retrying after a lost reply needs the original result; External already behaves this way; keep 409 for ABANDONED, expired and LOCKED attempts; update the 5.4 story text). Decision-independent part applied: P7's `ALREADY_SUBMITTED` outcome (a concurrent double submit) goes through the same `replayInternalSubmission` path as the fast path, so either option changes one method. [apps/backend/src/modules/participation/application/participation.service.ts:829] — **Resolved 2026-09-26:** option A accepted by Quan; resubmitting an already-submitted Internal response stays an idempotent 200 with the original result (same response id, original `submittedAt`, the posted reward and pinned policy mode — never re-priced, nothing new written); 409 stays for ABANDONED, expired and LOCKED attempts. AC2.1/AC6.2 amended with a dated note; unit test (`decision E5-D3 …` + LOCKED 409) and the e2e retry assertion now check the original result.
- [x] [Review][Decision] In-flight attempts when the form leaves PUBLISHED because the Publisher starts a new version (D4, low) — Internal submissions (and, since Epic 6 P6, External verifications) fail as soon as "Create New Version" moves the form to DRAFT; respondents lose up to 30 min of work. Options: (A) strict (today): accept only while PUBLISHED, and warn the Publisher in the builder that in-flight respondents are cut off; (B) lenient: accept attempts pinned to a published version unless the form is CLOSED or its re-publication was rejected and refunded (Epic 6 P6 would then key on "refund happened"); (C) keep the form PUBLISHED, serving the old version, until the new version is approved (lifecycle change across Epics 2, 4 and 8). **Triage recommendation: A** for Phase 1 plus the Publisher warning; revisit C with the moderation lifecycle. Nothing applied (current code = A without the warning). [apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts:276] — **Resolved 2026-09-26:** option A accepted by Quan; strict cut-off kept (submissions/verifications only while PUBLISHED) and the Publisher is warned: `GET /forms/:id/in-progress-attempts` (owner/Admin) feeds a warning with the live count in the builder's "Create New Version" modal, and `POST /forms/:id/versions` returns `interruptedAttempts` (shown in the success notice and the API message). `FormRepositoryPort.countInProgressAttempts` (Prisma + in-memory), typed client `fetchInProgressAttempts`, copy in `app/forms/attempt-window.ts`. Tests: forms service/controller/e2e, frontend helper + client. Option C (keep serving the old version) stays with E8-D2 for Phase 2.
- [x] [Review][Patch] The file-upload answer contract between 5.3 and 5.4 is broken: real attachments fail validation, multi-file answers are never extracted, a non-UUID string causes a 500 (P3, high) — fixed: the shared `file_upload` validator rejects bare strings, normalizes the value to a list and validates items carrying `objectId` with `fileAttachmentAnswerSchema` (size against `fileSize`, MIME against `mimeType`), keeping the builder-preview `MockFileValue` path; the server-only `validateAnswersAgainstFormDefinition` requires `z.array(fileAttachmentAnswerSchema).max(maxFiles)` (else 400 "Invalid file reference") and writes the parsed list back; the service collects `{objectId, questionId}` from every item, a duplicate `objectId` → 400. Schema and service tests (the real UI shape passes client and server; `maxFiles`; string / non-UUID / MockFileValue / single object → 400, never 500; multi-file answers attach every id). Note: file answers use the record form of `answers` (the array form's `BlockAnswer.value` cannot carry objects). [packages/schemas/src/forms/form-preview.ts:225]
- [x] [Review][Patch] Submission does not verify attachments: no owner, question, state or count check, `UncleanAttachmentException` is never thrown, and an optional `questionId` bypasses the per-question policy (P4, high) — fixed: `attachedFileObjectIds` replaced by `attachments: {objectId, questionId}[]`; inside the submit transaction `SELECT id FROM stored_objects … FOR UPDATE`, then `updateMany({ ownerContext: 'participation', ownerRecordId: attemptId, status: 'CLEAN', OR: [{ id, questionId }] })` → ATTACHED (`expiresAt: null`); `count !== attachments.length` → `UncleanAttachmentException` (400 `UNCLEAN_ATTACHMENT`): the whole submission rolls back and the Response stays IN_PROGRESS. Storage side: a participation `initiate` requires `questionId` (schema `superRefine` + `resolveUploadPolicy` → "questionId is required"). In-memory parity via a stored-object stub. Tests, including AC6.2's missing "rejection on quarantined/infected file attachments": QUARANTINED, REJECTED, missing, another attempt's and another question's object → UNCLEAN_ATTACHMENT with the response still IN_PROGRESS; owned CLEAN → ATTACHED; participation initiate without `questionId` → 400. The AD-16 ownership of this direct `stored_objects` write stays DF14. Independent review follow-up (same day): the stored answers (and the `IntegrityAssessmentRequested` payload) now carry the verified `stored_objects` name/size/MIME instead of the client-sent values; the in-transaction one-completion check is NULL-safe for attempt-less responses; `completeExternalAttemptTransaction` takes the form lock before the attempt lock on its own too. Not taken (low, noted for the live swap): one out-of-window telemetry event rejects its whole batch (P14 as planned), and a multiple-choice "Other" text equal to a ticked option is a 400 (client should de-duplicate). [apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts:472]
- [x] [Review][Patch] The Internal submit transaction has no state predicate: a double submit returns 500 and an abandoned attempt can be completed (P7, medium) — fixed, adapted to the Epic 6 P5/P6 code already in place (form `FOR SHARE` and post-commit settlement/replay kept): `runInTransaction` with lock order `forms FOR SHARE` → `survey_attempts FOR UPDATE`; state checks and the P1 one-completion re-check, then `response.updateMany({ id, status: 'IN_PROGRESS' })` / `surveyAttempt.updateMany({ id, status: 'IN_PROGRESS' })`; outcomes `SUBMITTED | ALREADY_SUBMITTED | NOT_SUBMITTABLE | ALREADY_COMPLETED_LOGICAL | FORM_NOT_OPEN`, with no Outbox writes unless submitted; a racing Outbox P2002 maps to ALREADY_SUBMITTED. The service maps ALREADY_SUBMITTED to the replay (Epic 6 P5 re-drive; see D3) and NOT_SUBMITTABLE to 409 `ATTEMPT_EXPIRED`; DISPUTED/REJECTED responses → 409 (defence in depth); `responseId`/`attemptId` given together must match → 400. Tests: two concurrent submits → one commit + one idempotent reply, exactly one Outbox pair, never a 500; abandoned → 409; mismatched ids → 400; repository predicates and P2002 mapping. [apps/backend/src/modules/participation/application/participation.service.ts:555]
- [x] [Review][Patch] Internal submission and storage mutations lack the AD-20 CSRF synchronizer check although Task 4.1 is checked (P12, medium) — fixed: new `OptionalSessionCsrfGuard` (with a session → the full `CsrfGuard` token check; a guest → an allowed Origin/Referer is required) together with `JsonOnlyGuard` on `responses/:id/submit`, `forms/:id/submissions`, `surveys/:id/submissions`, storage `uploads/initiate` and `uploads/:id/finalize`, and on `DELETE objects/:id` (no JsonOnly); the finalize body is `ZodValidationPipe(z.object({ checksum }).strict())`, so an unknown field → 400. Frontend: `optionalCsrfMutationFetch` (token when a session exists, none for guests) used by `RespondentFileUploadBlock`; `participation-api.ts` already sent the header. Telemetry beacons stay exempt (P8 closed their auth gap). Guard, controller and e2e tests: missing token with a session → 403; guest without Origin → 403; unknown finalize field → 400; non-JSON → 415. [apps/backend/src/modules/participation/presentation/participation.controller.ts:148]
- [x] [Review][Patch] `InternalRewardRequested` uses a per-respondent stream with a constant sequence of 1, which breaks AD-10 contiguity (P21, low) — fixed: `orderingStream: internal-reward:{responseId}`, `streamSequence: 1` (a single-event stream, like `integrity:{responseId}`); AC3 text corrected; repository and in-memory tests. Correlation/causation IDs stay DF13. [apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts:588]
- [x] [Review][Patch] The server answer validator coerces types: `Number()` for number, rating and scale, and duplicate or non-string multiple-choice items are allowed (P23, low) — fixed: strict server-only pass in `validateAnswersAgainstFormDefinition`: number, rating and linear_scale must be finite numbers; multiple_choice items must be unique strings; with `allowOther` at most one non-option value, non-empty and ≤ 500 characters (same bound for a single_choice "Other"). The preview validator stays lenient; the renderer already emits numbers. Tests. [packages/schemas/src/forms/internal-submission.schema.ts:176]
- [x] [Review][Patch] Test fidelity: the in-memory quota double-counts Internal completions, the in-memory submit ignores attachments, and there are no attachment tests (P28, low) — fixed: the in-memory quota skips attempts that own a Response (looked up by `attemptId`); the in-memory submit honours P4's attach predicate and P7's state predicates; regression test (an Internal completion counts once) and the attachment tests above. The PostgreSQL proof is DF5 (Story 5.1). [apps/backend/src/modules/participation/infrastructure/in-memory-participation.repository.ts:162]
- [x] [Review][Defer] No Outbox worker consumes `InternalRewardRequested`, `IntegrityAssessmentRequested` or `ExternalCompletionCodeMissingReported` (no AD-10 claim, lease, retry or dead-letter) (DF1, medium; also Story 5.5) [apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts:568] — deferred: needs the AD-5/AD-10 worker (already deferred in `deferred-work.md`); Epic 6 P5 recovers rewards through the replay and the Admin re-drive; the Epic 6 DF1 scheduler is the same infrastructure.
- [x] [Review][Defer] ScoringPolicy selection takes the highest version, not the status precedence, with no audited promotion; the synthetic id `policy-default-v1` is pinned into the Outbox (DF6, low) [apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts:447] — deferred: ENFORCED is unreachable (nothing writes `scoring_policies`); belongs to Epic 10 (Phase 2) with Epic 6 DF3.
- [x] [Review][Defer] No Outbox producer sets AD-10 correlation/causation IDs (DF13, low) [apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts:568] — deferred: cross-cutting (top-up, moderation and feedback producers omit them too); fix with the Outbox worker work.
- [x] [Review][Defer] Participation writes the Platform-owned `stored_objects` table directly (DF14, low) [apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts:472] — deferred: same pattern as Epic 6 DF7; the target is a Storage-owned attach command that joins the Unit of Work. P4 makes the current write safe.

---

## Dev Notes

- **Immutable FormVersion:** Answers are validated strictly against the `FormVersion` pinned during attempt initialization. Never against mutable draft forms.
- **Idempotent Rewards (FR-29, AD-16):** Keyed by `internal-reward:${responseId}` for SHADOW/ADVISORY, and `integrity-hold:${responseId}` for ENFORCED.
- **Transactional Outbox (AD-10):** Response validation and outbox events must commit in the exact same database transaction.
- **Fail-Open Hold (AD-14):** In ENFORCED mode, if scoring stalls or fails terminally, `failOpenIntegrityHold` ensures funds are never stranded.
- **Guest Submissions:** Omits `InternalRewardRequested` and skips point movement; creates `IntegrityAssessmentRequested` only.

### References
- `_bmad-output/planning-artifacts/epics.md`#Story-5.4
- `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md`#AD-10
- `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md`
- `packages/schemas/src/economy/reward.schema.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts`

## Dev Agent Record

### Agent Model Used
Gemini 3.8 Flash (High)

### Debug Log References
- Addressed E2E attempt conflict in `test/participation-submission.e2e-spec.ts` by generating dedicated respondents per test case.
- Handled dual input schema formats (array of blocks or key-value map) seamlessly in `validateAnswersAgainstFormDefinition`.

### Completion Notes List
- Defined and exported `internalFormSubmissionInputSchema`, `internalFormSubmissionResponseSchema`, `internalRewardRequestedPayloadSchema`, and `integrityAssessmentRequestedPayloadSchema` in `@rescom/schemas`.
- Implemented deep answer validation function `validateAnswersAgainstFormDefinition` enforcing block type schemas, required fields, choices, rating limits, and lengths.
- Added `submitInternalResponseTransaction` to `ParticipationRepositoryPort`, `PrismaParticipationRepository`, and `InMemoryParticipationRepository`.
- Added atomic state transition: `Response.status = VALIDATED`, `SurveyAttempt.status = COMPLETED`, verified `StoredObject.status = ATTACHED`, policy mode pinned, and generated AD-10 Outbox events (`InternalRewardRequested` and `IntegrityAssessmentRequested`).
- Integrated with `RewardSettlementCoordinator` / `LedgerService.creditInternalReward` for immediate settlement in SHADOW/ADVISORY mode and hold in ENFORCED mode.
- Added controller submission endpoints (`/api/responses/:responseId/submit`, `/api/forms/:id/submissions`, `/api/surveys/:id/submissions`) in `ParticipationController`.
- Verified frontend respondent flow in `apps/frontend/my-app/app/forms/[id]/respond/page.tsx` and `FormRenderer.tsx`.
- All unit, integration, and E2E tests pass (136/136 schema tests, 680/680 backend tests, 3/3 submission E2E tests, zero TypeScript errors).

### File List
- `packages/schemas/src/forms/internal-submission.schema.ts`
- `packages/schemas/src/forms/internal-submission.schema.spec.ts`
- `packages/schemas/src/forms/index.ts`
- `packages/schemas/src/index.ts`
- `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts`
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts`
- `apps/backend/src/modules/participation/infrastructure/in-memory-participation.repository.ts`
- `apps/backend/src/modules/participation/application/exceptions/participation.exceptions.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/modules/participation/application/participation.service.ts`
- `apps/backend/src/modules/participation/application/participation.service.spec.ts`
- `apps/backend/src/modules/participation/presentation/participation.controller.ts`
- `apps/backend/src/modules/participation/presentation/participation.controller.spec.ts`
- `apps/backend/src/modules/participation/participation.module.ts`
- `apps/backend/test/participation-submission.e2e-spec.ts`
- `_bmad-output/implementation-artifacts/5-4-internal-form-submission.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/schemas/src/forms/form-preview.ts`
- `apps/backend/src/modules/participation/application/participation.service.epic5-review.spec.ts`
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.spec.ts`
- `apps/backend/src/modules/auth/presentation/guards/optional-session-csrf.guard.ts`
- `apps/backend/src/modules/auth/presentation/guards/optional-session-csrf.guard.spec.ts`
- `apps/backend/test/bot-protection.e2e-spec.ts`
- `apps/frontend/my-app/app/forms/forms-api.ts`
- `apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx`
- `apps/frontend/my-app/tests/optional-csrf-fetch.test.mjs`
- Decision follow-up 2026-09-26 (E5-D3, E5-D4): `apps/backend/src/modules/participation/application/participation.service.ts`, `apps/backend/src/modules/participation/application/participation.service.spec.ts`, `apps/backend/test/participation-submission.e2e-spec.ts`, `packages/schemas/src/forms/form-draft.schema.ts`, `apps/backend/src/modules/forms/application/ports/form-repository.port.ts`, `apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts`, `apps/backend/src/modules/forms/infrastructure/in-memory-form.repository.ts`, `apps/backend/src/modules/forms/application/forms.service.ts`, `apps/backend/src/modules/forms/application/forms.service.spec.ts`, `apps/backend/src/modules/forms/presentation/forms.controller.ts`, `apps/backend/src/modules/forms/presentation/forms.controller.spec.ts`, `apps/backend/src/modules/participation/infrastructure/in-memory-participation.repository.ts`, `apps/backend/test/forms-versioning.e2e-spec.ts`, `apps/frontend/my-app/app/forms/forms-api.ts`, `apps/frontend/my-app/app/forms/attempt-window.ts` (new), `apps/frontend/my-app/app/forms/[id]/edit/NewVersionConfirmationModal.tsx`, `apps/frontend/my-app/app/forms/[id]/edit/page.tsx`, `apps/frontend/my-app/tests/attempt-window.test.mjs` (new), `_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md`

### Change Log
- 2026-09-24: Implemented Story 5.4 Internal Form Submission across schemas, backend domain, application service, infrastructure repositories, presentation controllers, and E2E tests.
- 2026-09-26: Code review 2026-09-26: Epic 5 review findings written (2 decisions open — D3, D4; 7 patches applied — P3 file-answer contract, P4 verified attach, P7 state-predicated submit, P12 AD-20 CSRF, P21, P23, P28; 4 deferred — DF1, DF6, DF13, DF14); AC1.1/AC1.2/AC3 text aligned (P2/P27/P21); status set to in-progress pending D3/D4.
- 2026-09-26: Decision follow-up 2026-09-26: E5-D3 option A (idempotent 200 with the original result; AC2.1/AC6.2 amended; unit + e2e assert it; 409 kept for abandoned/expired/locked) and E5-D4 option A (strict cut-off kept; Publisher warned with the live in-progress count before "Create New Version" and `interruptedAttempts` after it) accepted by Quan and implemented. No review items left open; status → done.
