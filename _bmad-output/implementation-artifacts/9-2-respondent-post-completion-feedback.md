---
baseline_commit: 378e4a71ff125fb1acf6ee18291fc298ae56bf94
context:
  - "_bmad-output/planning-artifacts/epics.md#Story 9.2"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#4.13 Feedback System (FR-43), FR-42, FR-44, FR-62"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md (ownership map, AD-10, AD-16, Consistency Conventions, Open Questions: Publisher-visible Survey Quality)"
  - "_bmad-output/implementation-artifacts/9-6-event-notification-system.md"
  - "_bmad-output/implementation-artifacts/spec-mock-respondent-journey.md"
  - "apps/backend/src/modules/participation/application/participation.service.ts"
  - "apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts"
  - "apps/frontend/my-app/app/forms/[id]/respond/page.tsx"
  - "apps/frontend/my-app/app/attempts/[id]/page.tsx"
  - "apps/frontend/my-app/lib/mock/repository.ts"
---

# Story 9.2: Respondent Post-Completion Feedback

Status: done

## Story

As a Respondent,
I want to rate and review the survey I just completed,
so that I can report if a survey was broken, misleading, or too long.

## Acceptance Criteria

Epic source (FR-43): **Given** a newly submitted survey **When** the submission is successful **Then** the UI immediately prompts the Respondent with a 5-star rating component and an optional comment box **And** the feedback is saved, linked to the `form_id`, and feeds into Survey Quality aggregation only after validation.

_Decision E9-D1 (2026-09-26, option A, accepted by Quan):_ the Phase 1 feedback model is **one required overall 1–5 rating plus optional issue tags** (and an optional comment) — not five separately rated FR-43 dimensions. PRD FR-42 and FR-43 carry dated amendment notes: Story 9.3 will show the average overall rating plus the share of respondents reporting each issue tag. No schema change.

PRD FR-43 consequences in scope: prompt after successful submission; feedback optional but encouraged; validated feedback contributes to Survey Quality only after minimum evidence (the aggregator is Phase 2 / Epic 10 — this story stores the evidence with an explicit validation state and emits the event the aggregator will consume). Out of scope (Phase 2, `phase_2_deferred`): 9.1 analytics dashboard, 9.3 Publisher feedback summary ("visible to Publisher in dashboard"), 9.4 negative-feedback deprioritization, Epic 10 Survey Quality assessment.

### AC1 — Shared feedback contracts (`packages/schemas/src/participation/survey-feedback.schema.ts`)
1. Constants: `SURVEY_FEEDBACK_RATING_MIN = 1`, `SURVEY_FEEDBACK_RATING_MAX = 5`, `SURVEY_FEEDBACK_COMMENT_MAX_LENGTH = 500`, `SURVEY_FEEDBACK_SUBMITTED_EVENT_TYPE = 'SurveyFeedbackSubmitted'`, error codes `SURVEY_FEEDBACK_ATTEMPT_NOT_FOUND_CODE = 'FEEDBACK_ATTEMPT_NOT_FOUND'`, `SURVEY_FEEDBACK_NOT_ALLOWED_CODE = 'FEEDBACK_NOT_ALLOWED'`, `SURVEY_FEEDBACK_ALREADY_SUBMITTED_CODE = 'FEEDBACK_ALREADY_SUBMITTED'`.
2. `SURVEY_FEEDBACK_ISSUE_TAGS` / `surveyFeedbackIssueTagSchema` = `UNCLEAR_QUESTIONS` (question clarity), `LONGER_THAN_ESTIMATED` (survey length accuracy), `MISLEADING_DESCRIPTION` (description accuracy), `TECHNICAL_ISSUE` (technical issues) — must equal the Prisma `SurveyFeedbackIssueTag` enum.
3. `SURVEY_FEEDBACK_VALIDATION_STATUSES` / `surveyFeedbackValidationStatusSchema` = `PENDING`, `ACCEPTED`, `EXCLUDED` — must equal the Prisma `SurveyFeedbackValidationStatus` enum.
4. `normalizeSurveyFeedbackComment(raw)`: CRLF/CR → LF, strips C0 control characters except `\n`/`\t` and DEL, trims; empty → `null`. Plain text: HTML is NOT stripped or interpreted (it is stored verbatim and rendered as text). _Code review 2026-09-26 (P8):_ also removes lone UTF-16 surrogates (the database rejects them), normalizes to NFC, maps U+2028/U+2029 to LF, strips further invisible/bidi characters (U+00AD, U+061C, U+180E, U+2061–U+2064, U+FFF9–U+FFFB, tag characters U+E0000–U+E007F), and returns `null` when no visible character remains.
5. `submitSurveyFeedbackInputSchema` (strict): `rating` integer 1..5 (no string coercion); `comment` optional string | null → normalized, ≤ 500 chars after normalization (raw input capped at 2 000 chars to bound work); `issueTags` optional array (≤ 4 raw entries) of issue tags → de-duplicated in canonical order, default `[]`. Output `{ rating, comment: string | null, issueTags }`.
6. DTOs: `surveyFeedbackSchema` `{ id, attemptId, formId, formVersionId, formType: 'INTERNAL' | 'EXTERNAL', rating, comment, issueTags, validationStatus, submittedAt (datetime) }` — ids are opaque non-empty strings (spine: public IDs are opaque at API boundaries; the mock uses non-UUID ids). NO `respondentId`/`responseId`. `surveyFeedbackStatusSchema` `{ attemptId, state: 'ELIGIBLE' | 'SUBMITTED' | 'NOT_ELIGIBLE', feedback: SurveyFeedbackDto | null }`. `submitSurveyFeedbackResultSchema` `{ feedback, replayed: boolean }`.
7. Event contract `surveyFeedbackSubmittedEventPayloadSchema` (schemaVersion 1): `{ schemaVersion: 1, feedbackId, attemptId, responseId: string | null, formId, formVersionId, formType, respondentId, rating, issueTags, hasComment, validationStatus: 'PENDING', submittedAt }` — no comment text (data minimization; Phase 2 reads comments through a Participation query port).
8. `isSameSurveyFeedbackContent(existing, input)` — shared replay rule (rating, normalized comment, tag set).
9. Exported via `participation/index.ts`; unit tests in `survey-feedback.schema.spec.ts`.

### AC2 — Persistence (`apps/backend/prisma`, Participation-owned, AD-16 ownership)
1. Enums `SurveyFeedbackIssueTag`, `SurveyFeedbackValidationStatus`; model `SurveyFeedback` (`survey_feedback`): `id`, `attemptId` (**unique** → exactly one feedback per attempt), `responseId?` (unique, Internal only), `formId`, `formVersionId`, `respondentId`, `formType FormType`, `rating Int`, `comment String? @db.Text`, `issueTags SurveyFeedbackIssueTag[] @default([])`, `validationStatus @default(PENDING)`, `validatedAt DateTime?`, `submittedAt`, `createdAt`, `updatedAt`; relations to `SurveyAttempt` (Cascade), `Response` (Cascade), `Form`/`FormVersion` (Restrict, like `Response`), `User` respondent (Cascade — deleting an account removes its free text); indexes `(formId, validationStatus)`, `(formVersionId, validationStatus)`, `(respondentId, submittedAt)`. Back-relation fields on `User`, `Form`, `FormVersion`, `SurveyAttempt`, `Response`.
2. Hand-written drift-tolerant migration `20260926200000_survey_feedback/migration.sql`: guarded `CREATE TYPE` (incl. `FormType` if absent — no earlier migration creates it), `CREATE TABLE IF NOT EXISTS`, `CHECK (rating BETWEEN 1 AND 5)`, `CHECK (comment IS NULL OR char_length(comment) <= 500)`, unique/regular indexes `IF NOT EXISTS`, FKs to `users` unconditionally and to `forms`/`form_versions`/`survey_attempts`/`responses` only when those tables exist (`to_regclass`), all re-runnable.
3. `npm run prisma:validate --workspace backend` and `npx prisma generate` succeed.

### AC3 — Feedback use cases (`apps/backend/src/modules/participation`, framework-free)
1. `SurveyFeedbackEntity` (domain) + `toDto()` + `hasSameContent(input)`; invariants: rating 1..5 integer, comment ≤ 500.
2. `SURVEY_FEEDBACK_REPOSITORY_PORT` / `SurveyFeedbackRepositoryPort`: `findByAttemptId(attemptId)`, `createWithOutboxEvent(feedback, event) → { created: boolean; feedback }` (unique attempt conflict → `created: false` + the stored row, never an error).
3. `SurveyFeedbackService`:
   - `submitFeedback(attemptId, callerUserId, input)`: attempt unknown / guest / owned by someone else → `SurveyFeedbackAttemptNotFoundException` (404 `FEEDBACK_ATTEMPT_NOT_FOUND`, no existence leak). Existing feedback: identical content → `{ feedback, replayed: true }` (200, no new row/event); different → `SurveyFeedbackAlreadySubmittedException` (409 `FEEDBACK_ALREADY_SUBMITTED`). Eligibility: attempt `COMPLETED` AND (Internal: its Response is `VALIDATED` and owned by the caller; External: form type `EXTERNAL`) else `SurveyFeedbackNotAllowedException` (409 `FEEDBACK_NOT_ALLOWED`). _Code review 2026-09-26:_ the survey's own publisher is never eligible (P2), and an External completion whose credit was reversed is not eligible (P3, via the optional `ExternalCreditStatePort`; open dispute holds do not block). Persists `validationStatus = PENDING` + one `SurveyFeedbackSubmitted` Outbox event (idempotency key `survey-feedback:{attemptId}`) atomically. A concurrent duplicate resolves through the same replay/conflict rule.
   - `getFeedbackStatus(attemptId, callerUserId)` → `SurveyFeedbackStatusDto` (`SUBMITTED` with the caller's feedback, else `ELIGIBLE` / `NOT_ELIGIBLE`); same 404 rule.
   - Never touches Economy/Ledger/rewards, Notifications or FraudLog (feedback and skipping it cannot change rewards).
4. Adapters: `PrismaSurveyFeedbackRepository` (feedback + Outbox row in one `$transaction`; P2002 on `attempt_id` → re-read, `created: false`) and `InMemorySurveyFeedbackRepository` (exposes rows + outbox events for tests).
5. Exceptions mapped in `http-exception.filter.ts` (404 / 409 / 409).

### AC4 — Endpoints (`SurveyFeedbackController`, routes `['attempts/:attemptId/feedback', 'api/attempts/:attemptId/feedback']`)
1. Class-level `@UseGuards(SessionAuthGuard)`; `attemptId` validated with `ParseUUIDPipe`.
2. `GET` → `SurveyFeedbackStatusDto`.
3. `POST` (`CsrfGuard`, `JsonOnlyGuard`, `ZodValidationPipe(submitSurveyFeedbackInputSchema)`, HTTP 200 for both create and identical replay) → `SubmitSurveyFeedbackResultDto`. Invalid body → 400 `VALIDATION_ERROR`; 401 unauthenticated; 403 missing CSRF.
4. No Publisher/Admin read endpoint in Phase 1 (Publisher-visible feedback is 9.3, gated by the spine's "minimum aggregation + pseudonymous linkability" open question).
5. Wired in `ParticipationModule` (service factory + Prisma repository provider; export the port for e2e overrides).

### AC5 — Mock-first frontend (`apps/frontend/my-app/lib/mock`)
1. `MockSurveyFeedback` type; `MockStoreState.surveyFeedback?: Record<attemptId, MockSurveyFeedback>` (absent in persisted stores → tolerated); store helpers `getSurveyFeedback(attemptId)` / `saveSurveyFeedback(feedback)`.
2. Repository `getSurveyFeedbackStatus(attemptId)` and `submitSurveyFeedback(attemptId, input)` mirror the backend rules and error codes (signed-in, owned attempt, `COMPLETED`, shared schema validation → `VALIDATION_ERROR`, one per attempt, identical replay → `replayed: true`, different → `FEEDBACK_ALREADY_SUBMITTED`). Responses satisfy the shared DTO schemas. Wallet/transactions/notifications are never touched.
3. `resetDemo` clears feedback (fresh initial state).

### AC6 — Feedback prompt UI (`components/feedback/SurveyFeedbackPrompt.tsx`)
1. Shown immediately inside the Internal success receipt (`app/forms/[id]/respond/page.tsx`) and the External code-verified receipt (`app/attempts/[id]/page.tsx`, also when revisiting an already-completed attempt).
2. 5-star rating as a native radio group (`fieldset`/`legend`, visually-hidden `input type="radio"` + star labels → arrow-key navigation, visible focus ring, Vietnamese labels "1 sao – Rất tệ" … "5 sao – Rất tốt", hover/selected preview); optional issue chips (checkboxes) for the four tags; optional comment `textarea` with label, 500-char limit and live counter; submit disabled until a rating is chosen. _(Decision E9-D1: this single overall rating + issue tags is the signed-off Phase 1 model — see PRD FR-42/FR-43 amendments.)_
3. States: loading (skeleton), `NOT_ELIGIBLE` → renders nothing, submitting, error (`role="alert"`, answers kept, retry), submitted/thank-you (`role="status"`, shows the given stars), skipped ("Bỏ qua" collapses to a one-line note with "Đánh giá ngay" to reopen; skip is UI-only and never calls the repository).
4. Copy states feedback is optional and never affects points, and makes **no promise about what the survey's Publisher can see** (decision E9-D4, 2026-09-26: the thank-you note is the shared `SURVEY_FEEDBACK_THANK_YOU_NOTE` in `lib/survey-feedback.ts`; an identity/visibility promise may be re-added only once Story 9.3's privacy design is approved); comment rendered as plain text only (no `dangerouslySetInnerHTML`). Responsive (no overflow at 375 px), left-aligned inside the centered receipt.
5. All rules live in the repository; the component only formats.

### AC7 — Typed live API client (`app/attempts/survey-feedback-api.ts`)
`fetchSurveyFeedbackStatus(attemptId, { signal })` and `submitSurveyFeedback(attemptId, input)` — input validated with the shared schema before the call, responses validated with the shared DTO schemas, mutation via `formMutationFetch` (CSRF), `error.code`/`status` surfaced, friendly 401 message. Not wired into the mock-first UI (later swap). _Code review 2026-09-26 (P4):_ every 401 surfaces code `AUTH_REQUIRED`, and `AUTH_USER_LOCKED` hides the prompt like the other errors a retry cannot fix.

### AC8 — Tests & verification
1. Schemas: contract tests (bounds, normalization, strictness, tag de-dup, DTO/event schemas, replay rule, enum parity lists).
2. Backend: entity/service unit spec (ownership 404, guest, not completed, internal response not VALIDATED, external ok, replay, conflict, concurrent duplicate, no reward/ledger interaction), in-memory + Prisma repository specs (mocked Prisma: transaction writes + P2002 path), controller spec (guards overridden), exception-filter mapping, new `test/survey-feedback.e2e-spec.ts` (external verify-code → feedback → replay → conflict; internal validated response; not-owned 404; not completed 409; validation 400; CSRF 403; 401; ledger/wallet unchanged).
3. The WHOLE backend e2e suite passes (no existing flow calls the new Prisma provider; confirm).
4. Frontend: mock repository feedback tests + live client tests.
5. `verify.sh` all green; `prisma validate` clean.

## Tasks / Subtasks

- [x] **Task 1: Shared contracts** (AC: 1)
  - [x] 1.1 `survey-feedback.schema.spec.ts` (red) then `survey-feedback.schema.ts`; export from `participation/index.ts`.
- [x] **Task 2: Prisma schema + migration** (AC: 2)
  - [x] 2.1 Enums + `SurveyFeedback` model + back-relations.
  - [x] 2.2 `20260926200000_survey_feedback/migration.sql` (drift-tolerant, CHECK constraints).
  - [x] 2.3 `prisma:validate`, `prisma generate`, `prisma format` sanity.
- [x] **Task 3: Domain + application** (AC: 3)
  - [x] 3.1 Entity, exceptions, repository port.
  - [x] 3.2 `SurveyFeedbackService` + spec (red → green).
  - [x] 3.3 In-memory + Prisma repositories + specs.
  - [x] 3.4 Exception filter mapping + spec cases.
- [x] **Task 4: Endpoints + wiring** (AC: 4)
  - [x] 4.1 `SurveyFeedbackController` + spec.
  - [x] 4.2 `ParticipationModule` providers/controllers/exports.
- [x] **Task 5: Backend e2e** (AC: 8)
  - [x] 5.1 `test/survey-feedback.e2e-spec.ts`.
  - [x] 5.2 Run the WHOLE e2e suite.
- [x] **Task 6: Frontend** (AC: 5, 6, 7)
  - [x] 6.1 Mock types/store/repository feedback methods.
  - [x] 6.2 `components/feedback/SurveyFeedbackPrompt.tsx`; mount in both receipts.
  - [x] 6.3 `app/attempts/survey-feedback-api.ts`.
  - [x] 6.4 `tests/survey-feedback.test.mjs` (mock repository + live client).
- [x] **Task 7: Verification & bookkeeping** (AC: 8)
  - [x] 7.1 Backend `npx eslint "{src,test}/**/*.ts" --fix`; frontend lint/typecheck.
  - [x] 7.2 `verify.sh` green; story file, sprint-status, deferred-work.

### Review Findings

_Epic 9 code review of 2026-09-26 (full mode: Blind Hunter + Edge Case Hunter + Acceptance Auditor; triage IDs D/P/DF in brackets, decision IDs from `code-review-decisions-2026-09-26.md`). Stories 9.2 and 9.6 were triaged together; this list holds the findings that belong to 9.2 (P4 and P12 also touch Story 9.6). Dismissed as noise across the epic: 8 (see Story 9.6). The decisions were **not** implemented; every patch was applied with tests ("Apply every patch"), P13 only in its decision-independent part._

- [x] [Review][Decision] E9-D1 — FR-43 asks for five rated dimensions; 9.2 ships one overall rating plus four optional issue tags (D1, medium) — FR-43 lists question clarity, survey length accuracy, description accuracy, technical issues and overall experience, and FR-42 (Story 9.3) expects "average ratings per feedback dimension"; the epic AC says "a 5-star rating component". Tag data cannot be back-filled into per-dimension averages, but there is no production data yet. Options: (A) keep the overall rating + issue tags and amend FR-42/FR-43 (9.3 shows the average rating plus a per-issue rate); (B) add four optional nullable per-dimension star columns now (additive migration, schema/DTO/event v2, four more star groups in the prompt and the mock); (C) A now, B's columns with Story 9.3 (two incompatible data populations). **Recommendation: A**, with the PO sign-off recorded here and FR-42/FR-43 amended; if per-dimension averages are wanted, choose B before launch, not C. — **Resolved 2026-09-26:** option A accepted by Quan; PO sign-off recorded here (Epic source note, AC6.2, Dev Notes "Dimensions") and dated E9-D1 amendment notes added next to PRD FR-42 (9.3 shows the average overall rating + per-issue-tag share) and FR-43 (Phase 1 model); no schema or code change.
- [x] [Review][Decision] E9-D4 — The thank-you copy promises Publisher anonymity, which the spine keeps as an open launch gate (D4, low) — `SurveyFeedbackPrompt.tsx:269` says "danh tính của bạn không được hiển thị cho người đăng khảo sát". True today (no Publisher endpoint, DTOs carry no `respondentId`), but it commits Story 9.3 to a privacy outcome Product/Research have not approved (low-N comments are linkable). Options: (A) remove the identity clause now and keep "optional … used to improve survey quality … never affects your points", re-adding a promise once 9.3's privacy design is approved; (B) keep it and make pseudonymous display + minimum aggregation (no free text below the threshold) a binding 9.3 requirement with Product/Privacy approval recorded in the spine's Open Questions. **Recommendation: A.** On resolution, also align the completion note that claims the promise was removed (the D4-dependent remainder of P13). — **Resolved 2026-09-26:** option A accepted by Quan; the identity clause is removed — the thank-you note now reads "Đánh giá được dùng để cải thiện chất lượng khảo sát và điểm thưởng của bạn không bị ảnh hưởng." (shared `SURVEY_FEEDBACK_THANK_YOU_NOTE` in `lib/survey-feedback.ts`, rendered by `SurveyFeedbackPrompt.tsx`), guarded by a new `tests/survey-feedback.test.mjs` case (note text + no identity/Publisher wording in the component); AC6.4 and the completion note aligned (P13 remainder).
- [x] [Review][Patch] A publisher could rate their own survey (P2, medium) — fixed: `resolveEligibility` returns not-eligible ("Publishers cannot rate their own survey.") when `form.isOwnedBy(attempt.respondentId)`, before the Internal/External branch → status `NOT_ELIGIBLE` (prompt hidden), submit 409 `FEEDBACK_NOT_ALLOWED`; an already-stored feedback still replays/conflicts first. Independent of Epic 4 DN2 (every option implies the same feedback rule). Mock parity in `getSurveyFeedbackStatus` / `submitSurveyFeedback`. Tests: service spec (own Internal and own External survey), e2e (publisher's own completed External attempt → GET `NOT_ELIGIBLE`, POST 409), frontend mock tests (own survey refused; stored feedback still replays first). [apps/backend/src/modules/participation/application/survey-feedback.service.ts:189, apps/frontend/my-app/lib/mock/repository.ts:1164]
- [x] [Review][Patch] External feedback was accepted for a completion whose credit was reversed (P3, low) — fixed: optional framework-free `ExternalCreditStatePort` (`participation/application/ports/external-credit-state.port.ts`) in `SurveyFeedbackServiceDeps`, wired to `RewardSettlementCoordinator` (P1's `getExternalCreditState`) in `participation.module.ts`; state `REVERSED` → not eligible ("This survey completion was reversed and can no longer be rated."); `PENDING`/`RELEASED`/`NONE` stay eligible. Open dispute holds deliberately do not block feedback (a publisher could suppress it). Tests: service spec (REVERSED → `NOT_ELIGIBLE` + 409; the other states eligible; Internal never consults the port), e2e (Admin `POST /economy/journals/:id/reverse` of the credit → GET `NOT_ELIGIBLE`, POST 409). [apps/backend/src/modules/participation/application/survey-feedback.service.ts:203, apps/backend/src/modules/participation/participation.module.ts:137]
- [x] [Review][Patch] The live feedback client treated 401 (and a locked account's 403) as retryable (P4, low; also Story 9.6's notification client) — fixed: both live clients map every 401 to code `AUTH_REQUIRED` (the friendly message was already status-based); `resolveSurveyFeedbackFailure` hides the prompt for `AUTH_USER_LOCKED` too, while CSRF/origin 403s stay `RETRY` (`formMutationFetch` can recover them). Tests: `tests/survey-feedback.test.mjs` (401 → `AUTH_REQUIRED` + status 401 + `HIDE`; `AUTH_USER_LOCKED` → `HIDE`; CSRF stays `RETRY`), `tests/notifications.test.mjs` (401 → `AUTH_REQUIRED`). [apps/frontend/my-app/app/attempts/survey-feedback-api.ts:57, apps/frontend/my-app/lib/survey-feedback.ts:45, apps/frontend/my-app/app/notifications/notifications-api.ts:49]
- [x] [Review][Patch] Comment normalization gaps: lone surrogates (500), invisible-only comments, missed bidi/invisible characters, no NFC (P8, low) — fixed in the shared `normalizeSurveyFeedbackComment` (so the mock follows automatically): lone surrogates removed (shared `removeLoneSurrogates`), NFC, CR/CRLF/U+2028/U+2029 → LF, U+00AD, U+061C, U+180E, U+2061–U+2064, U+FFF9–U+FFFB and the tag block U+E0000–U+E007F stripped, NFC re-applied after stripping (a removed character can leave a non-NFC sequence), trimmed, and a comment with no visible character (only whitespace, ZWJ/ZWNJ, CGJ, variation selectors, Khmer/Mongolian invisibles, Hangul/Braille blanks) → `null`; joiners and variation selectors stay inside visible text (a post-fix verifier pass added the second NFC and the extra blank characters). Tests: schema spec (lone high/low surrogate removed, emoji kept; NFD "Tiếng Việt" → NFC and shorter; ZWJ-only / U+3164-only → null; ALM and tag characters stripped; U+2028 → LF), e2e (raw `"\ud83d"` comment → 200 with `comment: null`, not 500). [packages/schemas/src/participation/survey-feedback.schema.ts:94]
- [x] [Review][Patch] The feedback enum "parity" tests compared against hard-coded copies, not Prisma (P12, low; the notification half is in Story 9.6) — fixed: `survey-feedback-enums.parity.spec.ts` asserts `SURVEY_FEEDBACK_ISSUE_TAGS` (exact canonical order) and `SURVEY_FEEDBACK_VALIDATION_STATUSES` equal the generated `$Enums`; the schema-package tests are kept. [apps/backend/src/modules/participation/infrastructure/survey-feedback-enums.parity.spec.ts:1]
- [x] [Review][Patch] Story-record accuracy (P13, low; 9.2 part) — decision-independent part fixed: the completion note claiming the copy "no longer promises … Publisher visibility" is annotated as inaccurate (the copy still says the identity is not shown to the publisher); AC1.4, AC3.3, AC7 and the Dev Notes "Who may submit" bullet state the P2/P3/P4/P8 rules; Change Log entry added. The D4-dependent alignment of that note is carried by E9-D4 above.
- [x] [Review][Defer] `SurveyFeedbackSubmitted` rows carry no correlation or causation ID (DF6, low) [apps/backend/src/modules/participation/application/ports/survey-feedback-repository.port.ts:9] — deferred: pre-existing pattern for every Participation Outbox producer (Epic 5 DF13); the IDs are row columns, not payload fields, so adding them later is not an event-schema change.
- [x] [Review][Defer] An Internal Response that becomes DISPUTED/REJECTED after feedback leaves the feedback PENDING (DF8, low) [apps/backend/src/modules/participation/application/survey-feedback.service.ts:98] — deferred: no Phase 1 code moves a Response to REJECTED/DISPUTED; the Phase-2 validator must exclude these (already recorded in the Story 9.2 dev entry).
- [x] [Review][Defer] No maximum age for submitting feedback after completion (DF9, low) [apps/backend/src/modules/participation/application/survey-feedback.service.ts:170] — deferred: recorded PO question (Story 9.2 dev entry "Product questions"); the PRD sets no window.
- [x] [Review][Defer] A P2002 on the Outbox key or `response_id` with no feedback row is rethrown as a 500 (DF10, low) [apps/backend/src/modules/participation/infrastructure/prisma-survey-feedback.repository.ts:72] — deferred: unreachable (every deletion path also removes eligibility); already recorded as a deliberate Low follow-up (Story 9.2 dev entry (b)); map to 409 `FEEDBACK_ALREADY_SUBMITTED` if feedback deletion is ever added.
- [x] [Review][Defer] The `survey_feedback` CHECKs and the unique race are proven only against mocks (DF3, low; shared with Story 9.6) [apps/backend/src/modules/participation/infrastructure/prisma-survey-feedback.repository.ts:1] — deferred: needs the Postgres test container (Epic 6 DF5).
- [x] [Review][Defer] No-overflow at 375 px is unverified for the feedback prompt (DF4, medium; shared with Story 9.6) [apps/frontend/my-app/components/feedback/SurveyFeedbackPrompt.tsx:1] — deferred: needs manual browser QA (already recorded); run it before moving 9.2 to done.
- [x] [Review][Defer] No tests for the prompt's UI-behaviour ACs (skip never calls the repository, focus) and no explicit "no reward interaction" unit case (DF7, low; shared with Story 9.6) [apps/frontend/my-app/components/feedback/SurveyFeedbackPrompt.tsx:1] — deferred: no DOM harness; reward isolation is structural (no Economy dependency on the write path) and asserted by the e2e wallet-unchanged check.

## Dev Notes

### Decisions (unattended run — recorded here instead of asking)
- **Owner = Participation.** The spine ownership map has no Feedback context. Feedback is a respondent's post-completion submission about their own Attempt/Response, which Participation owns; eligibility needs Attempt/Response state that only Participation may read directly. Survey Quality (Integrity context, Epic 10, Phase 2) consumes the `SurveyFeedbackSubmitted` Outbox event; validation transitions (`PENDING → ACCEPTED | EXCLUDED`) will be an owner-provided Participation command invoked by the Survey Quality validator (AD-16: only the owner writes its table). Implemented as a separate `SurveyFeedbackService` + controller inside `modules/participation` (ParticipationService is already ~1 000 lines).
- **"Only after validation":** every row starts `validationStatus = PENDING`; nothing aggregates in Phase 1. FR-62 makes Survey Quality Internal-only, so `formType` is stored and External feedback will stay out of Survey Quality (still usable by 9.3/9.4). PRD "a single negative review cannot materially change Survey Quality" + minimum evidence are aggregator rules → deferred.
- **Dimensions (lean):** one required overall 5-star rating (epic AC) + optional comment + optional issue tags mapping the other FR-43 dimensions (clarity, length accuracy, description accuracy, technical issues). Separate star ratings per dimension (FR-42 "average per dimension") are deferred with 9.3; tag rates per dimension are computable later. _Signed off 2026-09-26 (decision E9-D1, option A): PRD FR-42/FR-43 amended — Story 9.3 shows the average overall rating plus the per-issue-tag share; per-dimension stars, if ever wanted, must be added before launch._
- **One per attempt, idempotent:** unique `attempt_id`. Identical re-submission (network retry) → 200 `replayed: true`, no second row/event; different content → 409 `FEEDBACK_ALREADY_SUBMITTED` (feedback is immutable evidence; no edit in Phase 1).
- **Who may submit:** only the authenticated owner of a `COMPLETED` attempt; Internal additionally requires the Response `VALIDATED`. Guests cannot (no account identity; Guest Internal is Phase-2 gated). Unknown and not-owned attempts both → 404 (no existence leak; 9.6 precedent). _Code review 2026-09-26:_ never the survey's own publisher (P2 — not independent evidence, whatever Epic 4 DN2 decides), and not an External completion whose credit an Admin reversed (P3).
- **Rewards:** feedback has no Economy/Ledger/Notification side effects; skipping is client-only (no API call), so neither can change rewards.
- **Comment safety:** plain text; normalized (control chars stripped, trimmed, ≤ 500) server-side and in the mock via the shared function; React renders it as text. Not stored in the Outbox payload.
- **No rate limiter action:** abuse is bounded by one feedback per completed attempt (and completions are already rate-limited, FR-46). The global Throttler still applies.
- **No feedback window:** PRD sets none; a max-age window is recorded as a deferred product question.

### Architecture guardrails
- Clean Architecture guard: nothing under `participation/domain|application` imports `@nestjs/*`, `@prisma/client`, express, or "adapter". Wire via `useFactory` in `participation.module.ts`.
- AD-10: feedback row + Outbox event commit in one transaction (`prisma.$transaction`). Event: `eventType 'SurveyFeedbackSubmitted'`, `schemaVersion 1`, `producer 'participation-service'`, `aggregateType 'SurveyFeedback'`, `aggregateId = feedback.id`, `idempotencyKey 'survey-feedback:{attemptId}'`, payload per AC1.7.
- Postgres aborts a transaction on a unique violation → catch P2002 outside `$transaction`, then re-read with the base client.
- Spine: "Publisher sees approved aggregate fields only… Minimum aggregation and pseudonymous linkability remain launch gates before Publisher-visible Survey Quality" → no Publisher endpoint; DTOs never contain `respondentId`.

### Current state of files being modified (read before editing)
- `participation/participation.module.ts` — factories for `ParticipationRateLimiter` and `ParticipationService`; exports `ParticipationService`, `PARTICIPATION_REPOSITORY_PORT`. Add feedback providers/controller; keep existing wiring unchanged.
- `participation/infrastructure/in-memory-participation.repository.ts` — public `attempts`/`responses` maps (e2e seeds them directly).
- `common/http/http-exception.filter.ts` — long `instanceof` chain; add the three feedback exceptions (NotFound → 404, NotAllowed/AlreadySubmitted → 409).
- `prisma/schema.prisma` — `SurveyAttempt`, `Response`, `Form`, `FormVersion`, `User` gain back-relation fields only.
- `app/forms/[id]/respond/page.tsx` — success receipt (`submissionResult`) with reward box, starter unlock box, action links. Insert the prompt after the reward/unlock boxes, before the actions. Preserve everything else.
- `app/attempts/[id]/page.tsx` — External receipt (`submissionResult`, also synthesized for already-COMPLETED attempts). Insert the prompt before the actions.
- `lib/mock/{types,store,repository}.ts` — persisted at `rescom_demo_v1_store`; old states lack `surveyFeedback` → default `{}`.

### E2E pitfalls (Stories 6.5 / 9.6)
- e2e specs boot `AppModule` with a mocked `PrismaService`; override `SURVEY_FEEDBACK_REPOSITORY_PORT` with the in-memory repository in the new spec. Existing flows never call the feedback repository, so no existing spec needs an override (verify by running the whole suite).
- CSRF-guarded requests: `.set('x-csrf-token', csrfToken).set('Origin', 'http://localhost:3000')`. Do not call `app.listen()`.
- External verify-code flow needs `LEDGER_REPOSITORY_PORT`, `NOTIFICATION_REPOSITORY_PORT`, `STARTER_POINTS_DATA_PROVIDER` overrides (copy from `external-completion.e2e-spec.ts`).

### Frontend rules
- Mock-first; the prompt uses `mockRepository` only. Tests: `node --test` with Node type stripping → explicit `.ts` imports, `import type`, no parameter properties/enums in TS imported by tests.
- No new dependencies (inline SVG stars).

### Testing standards
- Backend Jest specs next to sources; e2e in `apps/backend/test`. Schemas Jest. Frontend `node --test tests/*.test.mjs`.
- Baseline before story: schemas 282, backend unit 998, e2e 251 passed / 3 skipped (29 suites), frontend 143.

### Project Structure Notes
- New files follow the per-module layout: `participation/domain/survey-feedback.entity.ts`, `participation/application/survey-feedback.service.ts`, `participation/application/ports/survey-feedback-repository.port.ts`, `participation/application/exceptions/survey-feedback.exceptions.ts`, `participation/infrastructure/{prisma,in-memory}-survey-feedback.repository.ts`, `participation/presentation/survey-feedback.controller.ts`.
- Live API client colocated in `app/attempts/` (non-route file, like `app/notifications/notifications-api.ts`).

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.2: Respondent Post-Completion Feedback]
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#FR-43: Post-Completion Feedback] (+ FR-42, FR-44, FR-62, UJ-2)
- [Source: PROJECT_SUMMARY.md#6.9 Feedback System]
- [Source: ARCHITECTURE-SPINE.md — Module and Durable-State Ownership Map; AD-10 Transactional Outbox; AD-16; Consistency Conventions (opaque public IDs, Schema Change); Open Questions (Publisher-visible Survey Quality)]
- [Source: _bmad-output/implementation-artifacts/9-6-event-notification-system.md] (404 ownership rule, e2e override discipline, mock/live client pattern)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Implementation Plan

- **Owner:** Participation context (feedback is the respondent's post-completion submission about their own Attempt/Response). Separate framework-free `SurveyFeedbackService` + `SurveyFeedbackController` inside `modules/participation`; `ParticipationService` untouched. The Phase-2 Survey Quality validator (Integrity) will consume the `SurveyFeedbackSubmitted` Outbox event and call an owner-provided Participation command to move rows `PENDING → ACCEPTED | EXCLUDED` (AD-16).
- **Contract first:** one shared schema module (`survey-feedback.schema.ts`) owns rating bounds, comment normalization (plain text; control and invisible bidi/zero-width spoofing characters stripped, trimmed, ≤ 500), canonical issue-tag de-dup, DTOs without respondent identity, the versioned event payload and the replay rule, so backend and mock cannot drift.
- **Idempotency:** unique `attempt_id`; pre-check + insert; the Prisma adapter catches P2002 outside the aborted `$transaction` and re-reads, so a concurrent duplicate resolves through the same identical-replay (200 `replayed: true`) / conflict (409) rule.
- **Eligibility:** owner-only (unknown/guest/foreign → one 404), attempt `COMPLETED`, Internal additionally a `VALIDATED` Response owned by the caller (form type read from the Research form repository). No Economy/Notification/FraudLog interaction at all.
- **Frontend:** mock repository mirrors the backend rules/codes; `SurveyFeedbackPrompt` only formats (native radio star group, issue chips, comment with counter, skip/reopen, thank-you, load/submit errors resolved by code) and is mounted in both success receipts; typed live client validates input/output with the shared schemas and uses `formMutationFetch`.

### Debug Log References

- Red phase confirmed before implementation for the schema spec, service spec, exception-filter cases and the frontend mock/client tests (missing modules/exports). The controller spec and its controller were written in the same step.
- `npx prisma format` also re-aligned unrelated `FraudLog` lines from an earlier story; reverted to keep the unrelated working-tree change untouched (schema validated and generated from the unformatted file).
- Migration checked against `prisma migrate diff --from-empty --to-schema-datamodel` output: enums, columns (incl. nullable `issue_tags` enum array with `ARRAY[]` default), indexes and FKs match exactly; CHECK constraints added by hand.
- First full backend run after wiring: unit 1038 / e2e 257 passed + 3 skipped (30 suites) — no existing e2e spec needed an override (no existing flow calls the feedback repository).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- AC1: shared contracts + 23 schema tests (constants/codes, enum parity lists, normalization incl. spoofing characters, strict input, opaque-id DTOs, event payload without comment text, replay rule).
- AC2: `SurveyFeedback` model (`survey_feedback`), enums `SurveyFeedbackIssueTag` / `SurveyFeedbackValidationStatus`, back-relations on User/Form/FormVersion/SurveyAttempt/Response; drift-tolerant migration `20260926200000_survey_feedback` with CHECK constraints (rating 1–5, comment 1–500 chars) and conditional FKs to `db push` tables. `prisma validate` + `prisma generate` OK.
- AC3/AC4: entity (+ Internal ⇔ Response invariant), service, port, Prisma + in-memory adapters, exceptions mapped 404/409/409, `GET|POST /attempts/:attemptId/feedback` (+ `api/` prefix; `SessionAuthGuard`, POST `CsrfGuard` + `JsonOnlyGuard`, `ParseUUIDPipe`, `ZodValidationPipe`, 200 for create and replay). New e2e `survey-feedback.e2e-spec.ts`: External verify-code → status ELIGIBLE → submit → wallet unchanged → one Outbox event → SUBMITTED → identical replay → 409 conflict; Internal VALIDATED via `api/` route (HTML kept as plain text); not completed 409; foreign/unknown 404; 400 validation (7 bodies + non-UUID id); 403 CSRF, 415 non-JSON, 401.
- AC5–AC7: mock `surveyFeedback` store (legacy stores tolerated, reset clears), `getSurveyFeedbackStatus` / `submitSurveyFeedback`; `SurveyFeedbackPrompt` in the Internal and External receipts (also on revisiting a completed External attempt); live client `app/attempts/survey-feedback-api.ts`; shared Vietnamese messages `lib/survey-feedback.ts` (mock + client parity). Internal mock helper `createNotificationId` renamed `createMockUuid` (now also used for feedback ids).
- Decisions (see Dev Notes): Participation ownership; one overall rating + optional issue tags instead of five star dimensions; identical replay vs. conflict; 404 for foreign attempts; no Publisher endpoint; no feedback window; skip is UI-only; no extra rate limit.
- Independent review (code-reviewer agent): no Critical/High. Fixed: [Medium] submit button contrast (amber-700/800 with white text); [Low] star outline contrast; errors that cannot succeed no longer show "Thử lại" (not found / not allowed / signed out hide the prompt, already-submitted reloads the thank-you); copy no longer promises anonymous aggregation or Publisher visibility (_code review 2026-09-26 P13: this was inaccurate — the thank-you copy still promised the identity was not shown to the publisher. **Aligned 2026-09-26 (decision E9-D4, option A):** that clause is now removed; the note only states the purpose and that points are unaffected_); live client shows the same Vietnamese messages as the mock; `relative` on sr-only input labels; reopening focuses the checked star; entity requires the Response on Internal feedback; bidi/zero-width/C1 characters stripped from comments. Deferred (deferred-work.md): heavier-than-needed form lookup for the form type; theoretical Outbox-key P2002 after a feedback deletion.
- Verification (2026-09-26, final `verify.sh`): schemas 305/305 (+23), backend unit 1039/1039 (+41), backend e2e 257 passed / 3 skipped, 30 suites (+6 tests, +1 suite), frontend 162/162 (+19), typecheck clean, lint clean; `npm run prisma:validate --workspace backend` valid.
- No manual browser QA at 375 px (no dev server in this unattended run); recorded in deferred-work.
- **Decision follow-up 2026-09-26 (Batch D, decisions E9-D1 and E9-D4, both option A accepted by Quan):** E9-D1 — the overall rating + issue-tag model is signed off; dated amendment notes next to PRD FR-42/FR-43 (no schema/code change). E9-D4 — the Publisher-anonymity clause is removed from the thank-you note (`SURVEY_FEEDBACK_THANK_YOU_NOTE`), with a regression test. No unchecked Decision/Patch items remain → Status `done`. Still open for a human: the 375 px browser QA of the prompt (DF4, `deferred-work.md`). Final `verify.sh` (2026-09-26, shared with the Story 9.6 decision follow-up): schemas 435/435, backend unit 1516/1516 (100 suites), backend e2e 299 passed / 3 skipped (30 suites), frontend 254/254, typecheck clean, lint clean; `npm run prisma:validate --workspace backend` valid.
- **Code review 2026-09-26 (Epic 9):** applied P2 (a publisher cannot rate their own survey; backend + mock), P3 (reversed External completion credits are not rateable, via the new optional `ExternalCreditStatePort` wired to `RewardSettlementCoordinator.getExternalCreditState`), P4 (live clients map 401 → `AUTH_REQUIRED`; `AUTH_USER_LOCKED` hides the prompt), P8 (comment normalization: lone surrogates, NFC, more invisible characters, invisible-only → null; shared helpers in `packages/schemas/src/common/unicode-text.ts`), P12 (Prisma-backed feedback enum parity spec) and the decision-independent part of P13. Decisions E9-D1 (rating dimensions) and E9-D4 (privacy promise in the thank-you copy) are open and not implemented — `SurveyFeedbackPrompt.tsx` is unchanged. 7 items deferred (DF3, DF4, DF6–DF10; DF3/DF4/DF7 shared with 9.6). Final `verify.sh` (2026-09-26): schemas 379/379, backend unit 1394/1394 (98 suites), backend e2e 288 passed / 3 skipped (30 suites), frontend 224/224, typecheck clean, lint clean; `npm run prisma:validate --workspace backend` valid.

### File List

- `packages/schemas/src/participation/survey-feedback.schema.ts` (new)
- `packages/schemas/src/participation/survey-feedback.schema.spec.ts` (new)
- `packages/schemas/src/participation/index.ts` (modified)
- `apps/backend/prisma/schema.prisma` (modified)
- `apps/backend/prisma/migrations/20260926200000_survey_feedback/migration.sql` (new)
- `apps/backend/src/modules/participation/domain/survey-feedback.entity.ts` (new)
- `apps/backend/src/modules/participation/domain/survey-feedback.entity.spec.ts` (new)
- `apps/backend/src/modules/participation/application/survey-feedback.service.ts` (new)
- `apps/backend/src/modules/participation/application/survey-feedback.service.spec.ts` (new)
- `apps/backend/src/modules/participation/application/ports/survey-feedback-repository.port.ts` (new)
- `apps/backend/src/modules/participation/application/exceptions/survey-feedback.exceptions.ts` (new)
- `apps/backend/src/modules/participation/infrastructure/prisma-survey-feedback.repository.ts` (new)
- `apps/backend/src/modules/participation/infrastructure/in-memory-survey-feedback.repository.ts` (new)
- `apps/backend/src/modules/participation/infrastructure/survey-feedback.repositories.spec.ts` (new)
- `apps/backend/src/modules/participation/presentation/survey-feedback.controller.ts` (new)
- `apps/backend/src/modules/participation/presentation/survey-feedback.controller.spec.ts` (new)
- `apps/backend/src/modules/participation/participation.module.ts` (modified)
- `apps/backend/src/common/http/http-exception.filter.ts` (modified)
- `apps/backend/src/common/http/http-exception.filter.spec.ts` (modified)
- `apps/backend/test/survey-feedback.e2e-spec.ts` (new)
- `apps/frontend/my-app/lib/mock/types.ts` (modified)
- `apps/frontend/my-app/lib/mock/store.ts` (modified)
- `apps/frontend/my-app/lib/mock/fixtures.ts` (modified)
- `apps/frontend/my-app/lib/mock/repository.ts` (modified)
- `apps/frontend/my-app/lib/survey-feedback.ts` (new)
- `apps/frontend/my-app/components/feedback/SurveyFeedbackPrompt.tsx` (new)
- `apps/frontend/my-app/app/forms/[id]/respond/page.tsx` (modified)
- `apps/frontend/my-app/app/attempts/[id]/page.tsx` (modified)
- `apps/frontend/my-app/app/attempts/survey-feedback-api.ts` (new)
- `apps/frontend/my-app/tests/survey-feedback.test.mjs` (new)
- `_bmad-output/implementation-artifacts/9-2-respondent-post-completion-feedback.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified)

Code review 2026-09-26 (new):
- `packages/schemas/src/common/unicode-text.ts` (shared with Story 9.6)
- `packages/schemas/src/common/unicode-text.spec.ts`
- `apps/backend/src/modules/participation/application/ports/external-credit-state.port.ts`
- `apps/backend/src/modules/participation/infrastructure/survey-feedback-enums.parity.spec.ts`

Code review 2026-09-26 (modified):
- `packages/schemas/src/index.ts`
- `packages/schemas/src/participation/survey-feedback.schema.ts`
- `packages/schemas/src/participation/survey-feedback.schema.spec.ts`
- `apps/backend/src/modules/participation/application/survey-feedback.service.ts`
- `apps/backend/src/modules/participation/application/survey-feedback.service.spec.ts`
- `apps/backend/src/modules/participation/participation.module.ts`
- `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts` (`getExternalCreditState`, Story 9.6 P1)
- `apps/backend/test/survey-feedback.e2e-spec.ts`
- `apps/frontend/my-app/lib/mock/repository.ts`
- `apps/frontend/my-app/lib/survey-feedback.ts`
- `apps/frontend/my-app/app/attempts/survey-feedback-api.ts`
- `apps/frontend/my-app/tests/survey-feedback.test.mjs`

Decision follow-up 2026-09-26 (modified):
- `_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md` (E9-D1 amendment notes at FR-42 and FR-43)
- `apps/frontend/my-app/lib/survey-feedback.ts` (`SURVEY_FEEDBACK_THANK_YOU_NOTE`, E9-D4)
- `apps/frontend/my-app/components/feedback/SurveyFeedbackPrompt.tsx` (identity clause removed, E9-D4)
- `apps/frontend/my-app/tests/survey-feedback.test.mjs` (E9-D4 regression test)
- `_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md`, `deferred-work.md`, `sprint-status.yaml`

### Change Log

- 2026-09-26: Story created (create-story) and implemented (dev-story): shared feedback contracts, Participation-owned `SurveyFeedback` model + drift-tolerant migration, feedback service/repositories/endpoints with atomic Outbox event, mock-first 5-star prompt in both success receipts, typed live API client, unit + e2e + frontend tests.
- 2026-09-26: Addressed independent review findings (button/star contrast, code-aware error handling, privacy-accurate copy, localized live-client errors, label positioning, checked-star focus, Internal Response invariant, spoofing-character stripping). Status → review.
- 2026-09-26: Code review 2026-09-26 (Epic 9): Review Findings written (2 decisions, 6 patch items covering P2/P3/P4/P8/P12/P13, 7 defers; 8 dismissed across the epic); every patch applied with tests (no self-rating, no rating of a reversed External completion, 401/locked handling in the live clients, surrogate-safe NFC comment normalization, Prisma parity spec, story-record corrections — P13 only in its decision-independent part). Status → in-progress (decisions E9-D1/E9-D4 open; 375 px QA pending).
- 2026-09-26: Decision follow-up 2026-09-26: E9-D1 (A) — overall rating + issue tags signed off, PRD FR-42/FR-43 amendment notes; E9-D4 (A) — Publisher-anonymity promise removed from the thank-you note (shared constant + regression test). No unchecked Decision/Patch items remain. Status → done (375 px manual QA still recorded in deferred-work).
