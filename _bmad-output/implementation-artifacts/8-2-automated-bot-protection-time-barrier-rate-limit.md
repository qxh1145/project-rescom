---
baseline_commit: 378e4a71ff125fb1acf6ee18291fc298ae56bf94
context:
  - "_bmad-output/planning-artifacts/epics.md#Story 8.2 (and 8.3 FraudLog AC)"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#FR-28, FR-45, FR-46, FR-47, NFR-4, Open Question 16"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-6 Redis Is Optional Ephemeral Infrastructure, FraudLog rule, Ownership Map (Moderation owns security FraudLog)"
  - "_bmad-output/implementation-artifacts/5-4-internal-form-submission.md"
  - "_bmad-output/implementation-artifacts/5-5-external-form-completion-code-verification.md"
  - "_bmad-output/implementation-artifacts/8-1-survey-moderation-queue.md"
  - "_bmad-output/implementation-artifacts/spec-mock-respondent-journey.md"
  - "apps/backend/src/modules/participation/application/participation.service.ts"
  - "apps/backend/src/common/security/security.module.ts"
  - "packages/schemas/src/forms/form-blocks.schema.ts"
---

# Story 8.2: Automated Bot Protection (Time Barrier & Rate Limit)

Status: done

## Story

As a System Architect,
I want to implement automated protections against bots,
so that malicious scripts cannot drain Publisher Escrows.

## Acceptance Criteria

Epic ACs (`epics.md` Story 8.2):
- **Given** a Respondent submitting an Internal Form **When** the system receives the submission **Then** it checks the "Time Barrier" (submission must take at least `number_of_questions * 2` seconds). If too fast, it's rejected (FR-45).
- **And** it enforces the configured Rate Limit (FR-46, FR-28); PostgreSQL remains authoritative for the Attempt, and Redis becomes the shared counter store when multi-replica/shared enforcement is required.
- **And** these security controls operate independently of and provide evidence to the Research Integrity Engine.

PRD consequences folded in: FR-45 "startTime is recorded server-side only; rejection triggers FraudLog entry"; FR-28 "FraudLog records the attempt with timing data; hard bot controls remain separate from Research Integrity assessments, although their outcomes may be eligible integrity evidence"; FR-46 "limits how many surveys a user can complete in a given time window; exceeding the limit blocks further attempts temporarily; limits are centrally versioned security policy, not per-user Admin settings (launch values = Open Question 16)"; FR-47 "FraudLog append-only, records user, timestamp, survey, violation type, details"; NFR-4 / AD-6 "single-replica/no-Redis profile = PostgreSQL durable abuse counters + conservative per-process request limits; `REDIS_SHARED` uses Redis counters".

### AC1 — Shared bot-protection contract (`@rescom/schemas`)
1. New `packages/schemas/src/participation/bot-protection.ts` (exported from the participation index) is the single rule source for backend **and** the frontend mock:
   - `TIME_BARRIER_SECONDS_PER_QUESTION = 2`, `TIME_BARRIER_POLICY_VERSION = 'time-barrier-v1'`, `PARTICIPATION_RATE_LIMIT_POLICY_VERSION = 'participation-rate-limit-v1'`, `DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY` (`completionLimit: 20`, `completionWindowSeconds: 3600`, `burstLimit: 10`, `burstWindowSeconds: 60`), `DEFAULT_EXTERNAL_TIME_BARRIER_SECONDS = 15`.
   - `isAnswerableBlockType(type)` / `countAnswerableQuestions(blocks)`: counts only answerable blocks. Every current block type (`text`, `textarea`, `number`, `single_choice`, `multiple_choice`, `rating`, `linear_scale`, `date`, `file_upload`) is answerable; any unknown/static type (future section/description blocks) is excluded.
   - `computeInternalTimeBarrier({ blocks, metadata })` → `{ requiredSeconds, questionCount, secondsPerQuestion, publisherMinimumSeconds, policyVersion }` with `requiredSeconds = max(questionCount × 2, metadata.minTimeBarrierSeconds ?? 0)`.
   - `evaluateTimeBarrier({ startedAt, now, requiredSeconds })` → `{ passed, elapsedSeconds, requiredSeconds, remainingSeconds, earliestSubmitAt }`, millisecond precision: passes iff `now − startedAt ≥ requiredSeconds × 1000` (exactly N×2 s passes); `remainingSeconds = ceil(...)` (≥ 1 when failing, 0 when passing).
   - `evaluateRollingWindowLimit({ eventTimes, now, limit, windowSeconds })` → `{ allowed, count, limit, windowSeconds, retryAfterSeconds, retryAt, anchor }` (rolling window, exact retry time = when the blocking event leaves the window; `anchor` = that event's time, used for once-per-window evidence keys).
   - Error-detail schemas: `timeBarrierRejectionDetailsSchema` and `participationRateLimitDetailsSchema` (`scope: 'COMPLETIONS' | 'ATTEMPT_START' | 'INTERNAL_SUBMISSION' | 'COMPLETION_CODE'`).
   - `SUBMISSION_TOO_FAST_CODE = 'SUBMISSION_TOO_FAST'`, `PARTICIPATION_RATE_LIMITED_CODE = 'PARTICIPATION_RATE_LIMITED'`.
2. `surveyAttemptResponseSchema` gains optional `timeBarrier` (`{ requiredSeconds, questionCount, secondsPerQuestion, earliestSubmitAt, policyVersion }`) so a live client can show the requirement; `integrityAssessmentRequestedPayloadSchema` gains optional `securityEvidence`.
3. Unit tests for every helper incl. the exact boundary, non-answerable blocks, publisher minimum dominating, rolling-window retry math.

### AC2 — Internal Time Barrier (FR-45, FR-28), server-authoritative
1. `ParticipationService.submitInternalResponse` resolves the attempt's **pinned** FormVersion (`attempt.formVersionId` in `versions`, falling back to `currentVersion` when the ids match; otherwise `404 SURVEY_NOT_AVAILABLE`); the pinned version must be published. The barrier is computed from the pinned version's parsed definition (`parseFormDefinitionDraft`, whose metadata default is 15 s) with `computeInternalTimeBarrier`; elapsed time uses only the server-recorded `attempt.startedAt` and the server clock (no client timestamp/clientContext is read). Answer validation and the transaction also use the pinned version (AD-19 exact-version rule).
2. Order: idempotent fast path → expiry/abandoned checks → form/pinned version → **time barrier** → answer validation → completion rate limit → transaction. A too-fast submission is rejected even if its answers are invalid (bot evidence first).
3. Rejection: `422 SUBMISSION_TOO_FAST` with `details = { requiredSeconds, elapsedSeconds, remainingSeconds, retryAfterSeconds, earliestSubmitAt, questionCount, secondsPerQuestion, publisherMinimumSeconds, policyVersion }` and a `Retry-After` header (= remainingSeconds). The Response/Attempt are not touched (stay `IN_PROGRESS`), so the respondent can submit again once enough time has passed and then succeeds.
4. Evidence: authenticated respondents get **one** FraudLog `TIME_BARRIER` entry per attempt (`dedupeKey: time-barrier:{attemptId}`; details: source `INTERNAL_SUBMISSION`, attemptId, responseId, formId, formVersionId, elapsedSeconds, requiredSeconds, questionCount, policyVersion). Guest responses (no user row; Phase-2 guest scope) are rejected identically but not logged. Evidence recording never turns the rejection into a 500 (fail-closed control, fail-open evidence).
5. Accepted submissions carry `securityEvidence.timeBarrier { policyVersion, requiredSeconds, elapsedSeconds, questionCount }` in the `IntegrityAssessmentRequested` Outbox payload (evidence for the deferred Integrity Engine; no scoring built).
6. `startAttempt` returns the `timeBarrier` block (INTERNAL: computed barrier; EXTERNAL: the existing external barrier).
7. External completion-code verification keeps its existing barrier value (`metadata.minTimeBarrierSeconds`, default 15 s — number of questions is unknown for External forms) but uses the same structured details / `Retry-After` and the same once-per-attempt FraudLog dedupe key.

### AC3 — Rate limits (FR-46, NFR-4, AD-6)
1. Centrally versioned policy `participation-rate-limit-v1` from env (validated in `env.schema.ts`, defaults = `DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY`): `PARTICIPATION_COMPLETION_LIMIT`, `PARTICIPATION_COMPLETION_WINDOW_SECONDS`, `PARTICIPATION_BURST_LIMIT`, `PARTICIPATION_BURST_WINDOW_SECONDS`, and `ABUSE_CONTROL_PROFILE` (`REDIS_DISABLED_SINGLE_REPLICA` default; `REDIS_SHARED` is rejected at startup because no Redis adapter is installed yet). Documented in `.env.example`.
   _Amended by decision E8-D4 (2026-09-26, option B):_ the policy version is configurable — `PARTICIPATION_RATE_LIMIT_POLICY_VERSION` (1–64 chars) is **required in production**, defaults to `participation-rate-limit-v1` elsewhere, and `participation-rate-limit-v1` may only name the default values (custom `PARTICIPATION_*` values need a new name, in any environment). The configured version is stamped on every 429 (`details.policyVersion`) and every `RATE_LIMIT` FraudLog entry; the values still await PRD Open Question 16 (PRD FR-46 amendment note).
2. **Durable completion limit (PostgreSQL-authoritative):** per authenticated user, completed attempts (`survey_attempts.status = COMPLETED`, `submitted_at` in the rolling window — Internal and External) ≥ limit → `429 PARTICIPATION_RATE_LIMITED` (scope `COMPLETIONS`). Enforced at attempt start (after eligibility checks), at Internal submission (not for idempotent replays) and at External code verification (before the code is checked, so a 429 never burns one of the 3 code tries). Retry time = when the blocking completion leaves the window.
3. **Per-user request burst limit (ephemeral):** per authenticated user and action (`ATTEMPT_START`, `INTERNAL_SUBMISSION`, `COMPLETION_CODE`), fixed window counter behind `RateLimitCounterStorePort` (`src/common/security/rate-limit-counter-store.port.ts`, token `RATE_LIMIT_COUNTER_STORE`) with the single-process `InMemoryRateLimitCounterStore` provided by `SecurityModule`; a Redis adapter can replace the provider without touching the application code. Exceeding → `429 PARTICIPATION_RATE_LIMITED` with the action scope. Runs before any other work; the global IP throttler stays unchanged.
4. Every 429 sets `Retry-After` and returns `details = { scope, limit, windowSeconds, retryAfterSeconds, retryAt, policyVersion }`; nothing is consumed (attempt stays `IN_PROGRESS`).

> **Amendment 2026-09-26 to AC3.2 (and the AC2.2 order) — code-review decision E8-D6, option A:** the durable completion limit **reserves capacity when an attempt starts**: a start is allowed only while the user's completions in the rolling window **plus** their open attempts (unexpired `IN_PROGRESS`, any survey) stay below the limit; the count is re-checked inside the start transaction under the per-user completion lock (taken before the form row lock — the same order as the completion transactions). Internal submission and External code verification **no longer pre-check** the limit, so an attempt that was allowed to start can always be completed; the Epic 8 review P3 in-transaction backstop stays (it counts completed attempts only, so a reserved attempt is never counted twice). An abandoned, locked or expired attempt releases its reservation. The retry time is when the earliest blocking completion leaves the window or the earliest open attempt's reservation expires; a start refused this way also returns `details.completionsInWindow` and `details.inProgressAttempts`.
5. Evidence: FraudLog `RATE_LIMIT` **once per window** — burst key `rate-limit:{userId}:{scope}:{windowStartMs}` (only the first rejected request of the window records), completion key `rate-limit:{userId}:COMPLETIONS:{anchorIso}`; the unique `dedupeKey` is the durable backstop across retries/replicas.
6. `ParticipationRateLimiter` (participation/application) owns both checks; `ParticipationService` takes it as an optional last constructor dependency (absent in legacy unit tests → only the Time Barrier applies).

### AC4 — FraudLog persistence
1. Prisma `FraudLog.dedupeKey String? @unique @map("dedupe_key")`; `SurveyAttempt @@index([respondentId, status, submittedAt])` for the rolling-window query. Hand-written drift-tolerant migration (tables are created by `db push`, not by a migration). FraudLog stays append-only (insert-only, `createMany … skipDuplicates`).
2. `ParticipationRepositoryPort.recordFraudLog(userId, type, details?, dedupeKey?)` (returns whether a row was written) and `findCompletionTimesSince(respondentId, since)`; Prisma + in-memory adapters.

### AC5 — Frontend (mock-first)
1. Mock repository mirrors the rules with the shared helpers: Internal attempts store the computed barrier; `submitInternalSurvey` rejects too-fast submissions (`SUBMISSION_TOO_FAST` + details, attempt untouched) and over-limit completions (`PARTICIPATION_RATE_LIMITED`); `startSurveyAttempt` and `submitExternalSurvey` enforce the completion limit; the External too-fast error becomes structured; new `getTimeBarrierStatus(attemptId)`.
2. Respond page (`app/forms/[id]/respond/page.tsx`) shows the minimum-time requirement ("N câu hỏi × 2 giây") with a live countdown before submission, a friendly "please take your time" state with the remaining seconds when a too-fast submission is rejected (answers preserved), and a rate-limit state with the retry time. `FormRenderer` gets an optional `onSubmitError` hook so the page can own these states. Vietnamese copy, `role="status"`/`aria-live`, responsive.
3. Marketplace/attempt start surfaces the rate-limit message; the External attempt page shows the structured wait.
4. Typed live client: `submitInternalResponse` in `app/marketplace/participation-api.ts` (reads `Retry-After`), plus pure helpers `lib/participation-guards.ts` (`getParticipationGuard(error)`, `formatWaitDuration`) covered by `node --test`.
   _Amended by decision E8-D5 (2026-09-26, option B):_ the typed live client lives in the new `app/marketplace/participation-submit-api.ts` (`submitInternalResponse`, `ParticipationApiError`, `toParticipationApiError`); the existing `participation-api.ts` adapter is restored to its prior API surface, as the human-owned mock-journey spec requires.

### AC6 — Quality
1. Unit tests: shared helpers; service (rejection + details + FraudLog once, exact boundary with fake timers, retry after waiting, pinned version, guest no log, evidence payload, rate limits at start/submit/verify, no consumption); rate limiter; counter store; repositories; exception filter (`Retry-After`, details); env schema.
2. New `test/bot-protection.e2e-spec.ts`: too-fast 422 + details + `Retry-After` + one FraudLog + attempt still IN_PROGRESS; retry after waiting → 200; completion limit 429 at start/submit; burst 429 + FraudLog once per window.
3. Existing unit/e2e specs that submit quickly are updated by back-dating `startedAt` (never by weakening the rule). The WHOLE e2e suite, backend unit, schemas, frontend tests, typecheck and lint pass.

## Tasks / Subtasks

- [x] Task 1: Shared contract (AC1)
  - [x] 1.1 `bot-protection.ts` helpers, constants, detail schemas; export.
  - [x] 1.2 `timeBarrier` on the attempt DTO; `securityEvidence` on the assessment payload.
  - [x] 1.3 `bot-protection.spec.ts`.
- [x] Task 2: Persistence (AC4)
  - [x] 2.1 Prisma `FraudLog.dedupeKey`, `SurveyAttempt` index; migration; validate + generate.
  - [x] 2.2 Port + Prisma/in-memory adapters (`recordFraudLog` dedupe, `findCompletionTimesSince`, evidence in outbox payload).
- [x] Task 3: Security infrastructure (AC3)
  - [x] 3.1 Env settings + `EnvService` getters + profile guard + `.env.example`.
  - [x] 3.2 `RateLimitCounterStorePort` + `InMemoryRateLimitCounterStore` (+ spec), provided/exported by `SecurityModule`.
- [x] Task 4: Participation (AC2, AC3)
  - [x] 4.1 Exceptions with details (`SubmissionTooFastException`, `ParticipationRateLimitedException`) + filter mapping (`Retry-After`).
  - [x] 4.2 `ParticipationRateLimiter` (+ spec).
  - [x] 4.3 `ParticipationService`: pinned version, barrier, evidence, rate limits, attempt `timeBarrier`; module wiring.
  - [x] 4.4 Update/add service + repository + filter unit tests.
- [x] Task 5: e2e (AC6)
  - [x] 5.1 `test/bot-protection.e2e-spec.ts`.
  - [x] 5.2 Update existing specs that submit quickly (back-date `startedAt`); run the whole suite.
- [x] Task 6: Frontend (AC5)
  - [x] 6.1 Mock repository rules + types.
  - [x] 6.2 `lib/participation-guards.ts`, live client, `FormRenderer.onSubmitError`, respond page notice, External page/start messaging.
  - [x] 6.3 Tests (`tests/bot-protection.test.mjs`) + fix existing FE tests that submit instantly.
- [x] Task 7: Verification & bookkeeping
  - [x] 7.1 `verify.sh` + prisma validate + eslint --fix.
  - [x] 7.2 Deferred items → `deferred-work.md`; story + sprint status → `review`.

### Review Findings

_Epic 8 code review of 2026-09-26 (Blind Hunter + Edge Case Hunter + Acceptance Auditor; triage IDs D/P/DF in brackets, decision IDs from `code-review-decisions-2026-09-26.md`). Findings of Stories 8.1 and 8.2 were triaged together; this list holds the ones that belong to 8.2. Dismissed as noise across the epic: 9 (see Story 8.1's list)._

- [x] [Review][Decision] E8-D4 — Provisional rate-limit values and what "centrally versioned" means (D4, medium) — All four limits can be overridden from env, yet every 429 and FraudLog entry says `participation-rate-limit-v1`, and nothing stops production from running the unapproved defaults (20 completions / rolling hour, 10 requests / minute per action; PRD Open Question 16). Mitigation: the evidence already records `limit` and `windowSeconds`. Options: (A) pin v1 — PO/Security approve the defaults, env overrides only in development/test; (B) keep the overrides and add `PARTICIPATION_RATE_LIMIT_POLICY_VERSION`: a production `superRefine` requires it explicitly and requires it to differ from `participation-rate-limit-v1` whenever any value differs from the defaults; stamp it into the 429 details and FraudLog entries; (C) leave it until OQ16, tracked as a launch-gate item. **Recommendation: B**, plus OQ16 approval of the values before launch. Not implemented (decision pending). [apps/backend/src/common/config/env.schema.ts:93] — **Resolved 2026-09-26:** option B accepted by Quan; new env var `PARTICIPATION_RATE_LIMIT_POLICY_VERSION` (required in production by an `env.schema.ts` refinement; `participation-rate-limit-v1` reserved for the default values in any environment; default v1 in dev/test) stamped by `ParticipationRateLimiter` on every 429 and RATE_LIMIT FraudLog entry instead of the hard-coded label; `.env.example`/README ops notes, PRD FR-46 amendment note; the values still await OQ16 (launch gate in `deferred-work.md`). Tests: schemas helpers, env service, limiter, `test/bot-protection.e2e-spec.ts` (explicit e2e version on the 429 and FraudLog).
- [x] [Review][Decision] E8-D6 — Where the completion limit applies, given the 30-minute attempt lifetime (D6, medium; decide with E5-D2) — A user at 19/20 starts attempts on surveys A and B (the conflict guard is per form), finishes B (20/20); submitting/verifying A then returns 429 with `retryAfterSeconds` up to 3 600, but A expires after 30 min, so the finished answers or the External work are lost — "nothing consumed, retry later" is false when the retry time falls after expiry. Options: (A) reserve capacity at start — start only when completed-in-window + the user's other unexpired IN_PROGRESS attempts < limit; submit/verify drop the COMPLETIONS pre-check (P3's in-transaction backstop still catches races); amend AC3.2; (B) keep AC3.2 as written and warn at start when other attempts are in flight; (C) enforce at start only (races overshoot by the number of in-flight attempts). **Recommendation: A** (matches FR-46 "blocks further attempts"; an honest user never loses finished work; compatible with P3). Not implemented — the pre-checks at start/submit/verify are unchanged. [apps/backend/src/modules/participation/application/participation-rate-limiter.ts:111] — **Resolved 2026-09-26:** option A accepted by Quan; the FR-46 completion limit reserves capacity at attempt start: a start is allowed only while completions in the rolling window + the user's open attempts (unexpired IN_PROGRESS, any form) stay below the limit (`evaluateCompletionCapacity` in `@rescom/schemas`; `ParticipationRateLimiter.assertStartCapacity` pre-check, re-checked inside `reserveAttempt` under the Epic 8 P3 per-user advisory lock taken FIRST, then the form row — same lock order as the completion transactions; a raced refusal → `rejectStartCapacity` after the transaction, nothing written). Submit and verify no longer pre-check; P3's in-transaction backstop stays (completed attempts only → no double counting). Reservations are released on abandon/lock/expiry. 429 details gain optional `completionsInWindow`/`inProgressAttempts` (copy in backend, guards and mock). AC3.2 amended. Tests: schemas, limiter, repository, service, e2e, frontend mock/guards. Story stays in-progress (E8-D4/E8-D5 belong to the next batch).
- [x] [Review][Decision] E8-D5 — The human-owned mock-journey spec vs the 8.1/8.2 frontend additions (D5, low, governance; shared with Story 8.1) — the 8.2 part is the additive live-client change in `app/marketplace/participation-api.ts` (error shape with `retryAfterSeconds`, new `submitInternalResponse`), which the spec reserves ("existing API adapters remain untouched"). Options: (A) accept, with a Spec Change Log note; (B) move the new live participation client code into e.g. `app/marketplace/participation-submit-api.ts` and restore `participation-api.ts`; (C) (8.1 only) remove or flag the Admin page. **Recommendation: A for the Admin page, B for the adapter**; the human owner decides. Not implemented (`participation-api.ts` untouched by the review). [apps/frontend/my-app/app/marketplace/participation-api.ts:12] — **Resolved 2026-09-26:** option A (Admin page) + B (adapter) accepted by Quan; the 8.2 additions (`submitInternalResponse`, `ParticipationApiError`, `toParticipationApiError`) moved to the new `app/marketplace/participation-submit-api.ts`, `participation-api.ts` restored byte-for-byte to its pre-8.2 content (API surface `startSurveyAttempt`/`verifyExternalCompletionCode`/`reportMissingCompletionCode`); tests updated in `tests/bot-protection.test.mjs` (+ a surface guard); acceptance recorded in the mock spec's Change Log.
- [x] [Review][Patch] The FR-46 completion limit was check-then-act: parallel completions could overshoot the hard cap (P3, medium) — fixed: optional `completionLimit { userId, limit, windowSeconds, now }` on `submitInternalResponseTransaction` and `completeExternalAttemptTransaction` (port, Prisma, in-memory); the Prisma transactions take the per-user advisory lock `pg_advisory_xact_lock(hashtextextended('participation-completions:{userId}', 0))` first (lock order user lock → `forms … FOR SHARE` → attempt `FOR UPDATE`; `lockAttemptForVerification` takes it first too), count the rolling window after the attempt-state checks and before any write, and return `RATE_LIMITED` with the completion times (no writes). The limiter gained `completionLimitCheck(userId)` and `rejectCompletions(userId, times, context)` (once-per-window evidence + 429, shared with `assertCompletionCapacity`); the service maps `RATE_LIMITED` to the 429 `COMPLETIONS` only after the transaction / Unit of Work ended, so the FraudLog row survives and no code strike is recorded. The cheap pre-checks stay (E8-D6 open). Only authenticated respondents with a configured limiter pass the check; replays never reach it. Tests: Prisma repository spec (lock SQL before the form/attempt locks and the count, `RATE_LIMITED` writes nothing), in-memory repository spec, limiter spec, service spec (pre-check passes, transaction reports `RATE_LIMITED` → 429, attempt stays IN_PROGRESS, one FraudLog entry, External: no strike, evidence written outside the Unit of Work). The 8.2 "concurrency caveat" and the `deferred-work.md` item were replaced. [apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts:158]
- [x] [Review][Patch] Burst `RATE_LIMIT` FraudLog entries did not record the survey (P4, medium; FR-47) — fixed: `assertBurstAllowed(userId, action, target?)` merges `requestedFormId` / `requestedResponseId` / `requestedAttemptId` (present ids only; "requested" because the check runs before any lookup) into the evidence; the 429 body is unchanged. Callers: start `{ formId }`, submit (response endpoint `{ responseId }`, form endpoint `{ formId, responseId, attemptId }`), verify `{ formId, attemptId }`, and the missing-code report `{ formId, attemptId }`. Tests: limiter spec, `bot-protection.e2e-spec.ts` (burst FraudLog carries `requestedFormId`). [apps/backend/src/modules/participation/application/participation-rate-limiter.ts:65]
- [x] [Review][Patch] The in-memory burst counter store never enforced `maxEntries` and rescanned the whole map for every new key (P10, low) — fixed: after evicting expired windows the oldest entry is evicted when still at capacity; a restarted window is moved to the back (delete + set) so insertion order tracks recency; `nextSweepAtMs` skips full scans until the earliest known reset (lowered on every insert). Evicting a live window only resets that user's ephemeral counter; the durable completion limit still holds. Tests: counter-store spec (`maxEntries: 3` keeps size 3 with a 4th live key; the scan is bounded). [apps/backend/src/common/security/in-memory-rate-limit-counter.store.ts:15]
- [x] [Review][Patch] A huge stored `minTimeBarrierSeconds` made attempt start or code verification throw `RangeError` (500) (P11, low) — fixed: `MAX_TIME_BARRIER_SECONDS = 86_400` (the metadata-schema maximum) exported from `bot-protection.ts`; `positiveWholeSeconds` clamps to it. Tests: schemas spec (`1e20` → 86 400); service specs with an unparseable Internal / External `schemaJson` carrying `minTimeBarrierSeconds: 1e20` → successful start and a structured 422 instead of a 500 (they fail with `RangeError` without the clamp). [packages/schemas/src/participation/bot-protection.ts:94]
- [x] [Review][Patch] The time-barrier copy credited the researcher for a platform default (P12, low) — fixed: "mức tối thiểu của khảo sát (áp dụng cho N câu hỏi)" instead of "mức tối thiểu do nhà nghiên cứu đặt"; `tests/bot-protection.test.mjs` updated; Dev Notes record that the effective Internal barrier is `max(q × 2 s, publisher minimum — 15 s by default)`. [apps/frontend/my-app/lib/participation-guards.ts:65]
- [x] [Review][Defer] The security FraudLog is owned by Moderation, but Participation writes it, and 8.2 widened that path (DF1, medium) [apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts] — deferred: 8.2 AC4.2 prescribes the Participation port; moving it behind a Moderation-owned recorder port is Story 8.3 (Phase 2), already in `deferred-work.md` (8.2 dev entry "FraudLog ownership & dashboard").
- [x] [Review][Defer] Concurrency paths never run against PostgreSQL — P3's advisory lock and parallel completions, the `fraud_logs.dedupe_key` insert (DF4, medium; shared with Story 8.1) [apps/backend/test/bot-protection.e2e-spec.ts] — deferred: needs the Postgres test container (Epic 6 DF5, Epic 5 DF5); add "parallel completions of one user on different surveys at 19/20 → exactly one succeeds" there.
- [x] [Review][Defer] The public guest path (`/f/:id`) accepts Internal submissions with no Time Barrier and no server-recorded start (DF5, low) [apps/backend/src/modules/forms/application/public-forms.service.ts:78] — deferred: guest participation is Story 4.4 (Phase 2, OQ19), guests are unpaid (no Escrow drain); already in `deferred-work.md` (8.2 dev entry "Guest scope").
- [x] [Review][Defer] Startup does not refuse the single-replica profile with more than one replica; no Redis adapter (DF6, low) [apps/backend/src/common/security/security.module.ts] — deferred: no replica metadata to check; already in `deferred-work.md` (8.2 dev entry "`REDIS_SHARED` profile not available"); do it with the Redis `RateLimitCounterStorePort`.
- [x] [Review][Defer] The countdown compares the server's absolute `earliestSubmitAt` / `retryAt` with the browser clock (DF8, low) [apps/frontend/my-app/app/forms/[id]/respond/TimeBarrierNotice.tsx:46] — deferred: latent (the respond page is mock-backed and the mock uses the same clock) and the file is inside the human-owned mock journey; at the live-API swap anchor on `remainingSeconds` / `retryAfterSeconds` plus the local receipt time; route with Epic 5 DF12.
- [x] [Review][Defer] FR-28 says the threshold depends on question count "and type"; block type is ignored (DF9, low) [packages/schemas/src/participation/bot-protection.ts] — deferred: the 8.2 epic AC defines Phase 1 precisely (`questions × 2`); type weights need PO values, raise them with OQ16 (E8-D4).

## Dev Notes

### Current state (read before changing)
- **Internal submission** (`participation.service.ts` `submitInternalResponse`, ~l.284): validates answers against `currentVersion` (not the pinned one), then applies a time barrier only via `metadata.minTimeBarrierSeconds` (parsed default 15 s) — no per-question rule, no structured details, no FraudLog. The transaction (`submitInternalResponseTransaction`) is only reached after all checks, so throwing before it never consumes the attempt.
- **External verification** (~l.501): barrier = `metadata.minTimeBarrierSeconds` (default 15), FraudLog `TIME_BARRIER` on **every** rejection (no dedupe), error message only (no details). 3 failed codes lock the attempt (`recordFailedAttemptVerification` writes `SECURITY_VIOLATION`).
- **Rate limiting today:** global `AppThrottlerGuard` (APP_GUARD) with `ThrottlerModule` named limits `default` (100/60 s per IP; lifted to 10000 in test) and `auth` (auth controllers only); in-memory storage. Guest public submissions (Story 4.4, Phase-2 deferred) have their own IP limiter `GuestSubmissionRateLimiter` — out of scope, do not expand.
- **FraudLog** (`prisma/schema.prisma`): `id, userId (FK users), type FraudLogType {TIME_BARRIER, RATE_LIMIT, DEMO_MISMATCH, RECAPTCHA_FAIL, SECURITY_VIOLATION}, details Json?, createdAt` — no survey column (survey ids go into `details`), no dedupe. Written today only through `ParticipationRepositoryPort.recordFraudLog` / `recordFailedAttemptVerification`. The `fraud_logs`, `survey_attempts`, `forms`… tables are not created by any migration (db push) → migrations must be drift-tolerant (see 8.1's migration).
- **Form Definition:** `parseFormDefinitionDraft` returns sorted blocks + metadata with defaults (`expectedEffortSeconds 60`, `minTimeBarrierSeconds 15`, refine `min ≤ expected`). All 9 block types are answerable; no static/section blocks exist yet.
- **FormRepository.findById** returns `versions` (desc) in Prisma/in-memory adapters; unit-test mocks often return only `{ form, currentVersion }` → pinned lookup must fall back to `currentVersion` when ids match.
- **Frontend mock:** `lib/mock/repository.ts` `submitInternalSurvey` has **no** time barrier; `submitExternalSurvey` has one (plain `Error`). Tests already back-date attempts for External (`minTimeBarrierSeconds + 5`). Frontend tests import `@rescom/schemas` from `packages/schemas/dist` (rebuilt by the backend `pretest`).

### Design decisions
- **Effective internal barrier = max(answerable questions × 2 s, publisher `minTimeBarrierSeconds`).** The publisher minimum (default 15 s) stays meaningful; the epic's per-question rule is the floor. Barrier from the pinned version only.
- **Time barrier before answer validation** so a fast bot with junk answers still produces `TIME_BARRIER` evidence.
- **FraudLog once per attempt / once per window** via a unique nullable `dedupe_key` (insert-only `ON CONFLICT DO NOTHING`), satisfying FR-45/FR-47 without floods. External path adopts the same per-attempt key.
- **Two rate-limit layers, exactly NFR-4's single-replica profile:** (1) FR-46 completion limit counted from PostgreSQL (authoritative, works across replicas without Redis); (2) conservative per-process, per-user request bursts behind `RateLimitCounterStorePort` (Redis `INCR`+`PEXPIRE` adapter slots in for `REDIS_SHARED`). `ABUSE_CONTROL_PROFILE=REDIS_SHARED` fails fast at startup until that adapter exists (AD-6: each deployment declares one profile).
- **Launch values are provisional** (PRD Open Question 16): 20 completions / rolling hour, 10 requests / minute per action. Recorded in deferred-work for PO/Security sign-off.
- **Rate-limit checks live in the application service**, not a Nest guard, because they need the authenticated user id, durable counts and FraudLog evidence; the global IP throttler remains the outer layer.
- **Ownership:** the architecture assigns the security FraudLog to Moderation; Phase 1 keeps the existing Participation write path (`recordFraudLog`) introduced by Story 5.5 — moving it behind a Moderation port belongs to Story 8.3 (Phase-2 deferred).
- **Integrity evidence without Epic 10:** FraudLog for rejections (confirmed hard-rule violations) + `securityEvidence.timeBarrier` in the already-emitted `IntegrityAssessmentRequested` Outbox payload for accepted submissions. No scoring, no incident creation.
- **Completion limit serialization (code review 2026-09-26, P3; replaces the former "concurrency caveat"):** the cheap pre-checks at start / submit / verify stay (fast 429 before answer validation or code comparison), and both completion transactions re-check the limit authoritatively: they take a per-user transaction advisory lock (`pg_advisory_xact_lock(hashtextextended('participation-completions:{userId}', 0))`) FIRST, count the user's COMPLETED attempts in the rolling window after the attempt-state checks and before any write, and return `RATE_LIMITED` (no writes) at the limit; the service then records the once-per-window evidence and throws the 429 **after** the transaction / Unit of Work ended, so the FraudLog row is never rolled back. Lock order in both flows: user advisory lock → `forms … FOR SHARE` (Epic 6 P6) → attempt `FOR UPDATE` (Epic 5 P7); External verification's `lockAttemptForVerification` takes the advisory lock first too (re-entrant). Attempt start (`forms … FOR NO KEY UPDATE`) does not take it, so there is no inversion. On the External path the in-transaction rejection comes after a valid code, so it burns no try. Where the limit applies relative to the 30-minute attempt lifetime is decision E8-D6 (open).
- **Evidence targets (code review 2026-09-26, P4):** burst `RATE_LIMIT` FraudLog details also record the requested route ids (`requestedFormId` / `requestedResponseId` / `requestedAttemptId`, validated by `ParseUUIDPipe`; the burst check runs before any lookup) for attempt start, submission, code verification and the missing-code report (FR-47 "survey").
- **Effective Internal barrier (code review 2026-09-26, P12):** `max(answerable questions × 2 s, publisher minTimeBarrierSeconds)`; the builder writes `minTimeBarrierSeconds: 15` by default, so for forms with ≤ 7 questions the 15 s floor is the platform default — the copy now says "mức tối thiểu của khảo sát (áp dụng cho N câu hỏi)". Stored barrier values are clamped to `MAX_TIME_BARRIER_SECONDS = 86 400` (P11) so a corrupt row can never make `toISOString` throw.

### Guardrails
- Clean Architecture guard: nothing under `modules/*/application|domain` imports `@nestjs/*`, `@prisma/client`, `express`, or any path containing "adapter". The counter port lives in `src/common/security` (plain TS). Wire in `participation.module.ts` / `security.module.ts` via `useFactory`.
- Domain exceptions carry `code`; mapping in `http-exception.filter.ts` (details + `Retry-After`). CORS already exposes `Retry-After`.
- No new npm dependencies (no Redis client).
- FraudLog stays append-only; never log answers or completion codes.

### Testing standards
- Backend unit (Jest): in-memory adapters, `jest.useFakeTimers().setSystemTime()` for the exact boundary.
- e2e: boot `AppModule` with mocked `PrismaService`; override `PARTICIPATION_REPOSITORY_PORT`, `FORM_REPOSITORY_PORT`, `DEMOGRAPHIC_PROFILE_REPOSITORY_PORT`, `LEDGER_REPOSITORY_PORT`, `NOTIFICATION_REPOSITORY_PORT`, `STARTER_POINTS_DATA_PROVIDER`, user/session/audit ports; small limits via the `EnvService` override. Back-date `startedAt` through the in-memory repository's `attempts` map instead of sleeping.
- Frontend: `node --test tests/*.test.mjs`, typecheck, lint.

### Project Structure Notes
- New: `packages/schemas/src/participation/bot-protection.ts` (+ spec); `apps/backend/src/common/security/rate-limit-counter-store.port.ts`, `in-memory-rate-limit-counter.store.ts` (+ spec); `apps/backend/src/modules/participation/application/participation-rate-limiter.ts` (+ spec); migration `20260926180000_bot_protection_evidence`; `apps/backend/test/bot-protection.e2e-spec.ts`; `apps/frontend/my-app/lib/participation-guards.ts`; `apps/frontend/my-app/app/forms/[id]/respond/TimeBarrierNotice.tsx`; `apps/frontend/my-app/tests/bot-protection.test.mjs`.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.2, #Story 8.3]
- [Source: prd.md#FR-28, FR-45, FR-46, FR-47, NFR-4, Open Question 16, SM-7]
- [Source: ARCHITECTURE-SPINE.md#AD-6, FraudLog rule (l.146), Ownership Map (Moderation row)]
- [Source: solution-design.md#Redis profile (l.317)]
- [Source: _bmad-output/implementation-artifacts/8-1-survey-moderation-queue.md#Dev Notes — e2e override list, drift-tolerant migrations]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5) — unattended BMAD sprint run (bmad-create-story → bmad-dev-story).

### Implementation Plan

1. Shared contract first (`@rescom/schemas` `bot-protection.ts`): answerable-question count, effective Internal barrier `max(questions × 2 s, publisher minimum)`, millisecond-exact `evaluateTimeBarrier`, rolling-window limit math with exact retry time/anchor, detail schemas, attempt `timeBarrier` block and `securityEvidence` payload field.
2. Persistence: `FraudLog.dedupeKey` (unique, append-only insert via `createMany … skipDuplicates`) + `survey_attempts` rolling-window index; drift-tolerant migration; port/adapters (`recordFraudLog(…, dedupeKey)`, `findCompletionTimesSince`).
3. Security infrastructure: env policy (`PARTICIPATION_*`, `ABUSE_CONTROL_PROFILE`), `RateLimitCounterStorePort` + `InMemoryRateLimitCounterStore` bound in `SecurityModule` (single Redis swap point).
4. Participation: exceptions with details + filter (`Retry-After`), `ParticipationRateLimiter` (burst per user/action + PostgreSQL completion limit, once-per-window evidence), service changes (pinned version, barrier before validation, evidence, limits at start/submit/verify, attempt `timeBarrier`).
5. Tests at every layer, whole e2e suite (only Story 5.4's spec needed back-dating), then the mock-first frontend (shared helpers in the mock, countdown notice, live client).

### Debug Log References

- First whole-e2e run after the service change: only `participation-submission.e2e-spec.ts` failed (2 tests slept 1.1 s against what is now a 4 s barrier: 2 questions × 2 s) — fixed with the new `test/fixtures/participation.fixture.ts` `backdateAttempt`, not by weakening the rule. All other 27 suites passed unchanged (the burst/completion defaults did not affect them).
- Schema spec expectation error (my arithmetic: 4 events / limit 2 → three must leave, anchor = 30-min-old event); the helper was right, the test was fixed.
- Frontend typecheck initially could not see the new exports: the FE resolves `@rescom/schemas` through `packages/schemas/dist` (its tsconfig path points outside the repo), so `npm run build --workspace @rescom/schemas` is required after schema changes (the backend `pretest` also rebuilds it).
- Mutation check of the service-level spec (the service was written just before it): forcing the current version instead of the pinned one fails 1 test; dropping the per-question rule fails 4 tests.
- 4 existing FE spec files submitted Internal surveys instantly and were updated to back-date the mock attempt start.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Time Barrier (FR-45, FR-28):** Internal submissions must take at least `max(answerable questions × 2 s, publisher minTimeBarrierSeconds)` measured from the server-recorded `attempt.startedAt` of the attempt's **pinned** FormVersion (client timestamps are never read). Exactly N×2 s passes. Rejection = `422 SUBMISSION_TOO_FAST` with `details {requiredSeconds, elapsedSeconds, remainingSeconds, retryAfterSeconds, earliestSubmitAt, questionCount, secondsPerQuestion, publisherMinimumSeconds, policyVersion}` + `Retry-After`; the attempt/response stay `IN_PROGRESS` and the same attempt succeeds once the time has passed. The barrier is checked before answer validation. One FraudLog `TIME_BARRIER` per attempt (`time-barrier:{attemptId}`) for authenticated respondents; guests are rejected but not logged. `POST /forms/:id/attempts` now returns `timeBarrier`. External verification keeps its 15 s / publisher value with the same contract and dedupe.
- **Rate limit (FR-46, NFR-4, AD-6):** central policy `participation-rate-limit-v1` from env (defaults 20 completions / rolling hour; 10 requests / minute per user per action). (1) PostgreSQL-authoritative completion limit enforced at attempt start, Internal submission (not idempotent replays) and External verification (before the code is judged); (2) per-user burst limit on attempt start / submission / code verification via `RateLimitCounterStorePort` (in-memory now; Redis adapter slots into `SecurityModule`, `REDIS_SHARED` is refused at startup until it exists). `429 PARTICIPATION_RATE_LIMITED` + `Retry-After` + details; nothing consumed; FraudLog `RATE_LIMIT` once per window (dedupe keys + first-rejection rule). The global IP throttler is unchanged.
- **Integrity evidence (Epic 10 deferred):** accepted Internal submissions forward `securityEvidence.timeBarrier` in the `IntegrityAssessmentRequested` Outbox payload; rejections are FraudLog hard-rule evidence. No scoring or incident logic was built.
- **Frontend (mock-first):** the mock repository applies the same shared helpers (Internal barrier on submit, structured External too-fast error, completion limit on start/submit/verify, `getTimeBarrierStatus`). The respond page shows a "Tối thiểu N giây" chip and a `TimeBarrierNotice` before the submit button: live countdown with the rule ("5 câu hỏi × 2 giây"), a friendly "Hãy dành thời gian đọc kỹ câu hỏi" state after a too-fast rejection (answers kept, via the new `FormRenderer.onSubmitError` hook), and a rate-limit state; screen readers get one polite announcement per phase. The External attempt page takes its countdown from the repository and shows structured messages; the dashboard now surfaces start errors (e.g. the rate limit). Live client: `submitInternalResponse` + `Retry-After`-aware errors in `app/marketplace/participation-api.ts`; pure helpers in `lib/participation-guards.ts`.
- **Decisions:** effective barrier keeps the stricter publisher minimum; barrier-before-validation; FraudLog dedupe via a nullable unique column (append-only); limits in the application service (needs user id, durable counts and evidence) rather than a Nest guard; FraudLog writes stay on the Story 5.5 participation path (Moderation-owned port = Story 8.3); Internal validation now also uses the pinned version (AD-19). Provisional limits and the other open items are in `deferred-work.md`.
- **Prisma:** `FraudLog.dedupeKey String? @unique @map("dedupe_key")`, `SurveyAttempt @@index([respondentId, status, submittedAt])`; migration `20260926180000_bot_protection_evidence` (drift-tolerant); `prisma validate` + `prisma generate` OK.
- **Verification (final `verify.sh`, OVERALL PASS):** schemas 282 (+22), backend unit 998 (+38), backend e2e 251 passed / 3 skipped in 29 suites (+4 tests, +1 suite), frontend 143 (+15), typecheck + lint clean; `next build --webpack` passes. No manual browser QA.
- Code review 2026-09-26: applied patches P3 (completion limit re-checked inside both completion transactions under a per-user `pg_advisory_xact_lock`, lock order user lock → form `FOR SHARE` → attempt `FOR UPDATE`; `RATE_LIMITED` → 429 after the transaction, evidence never rolled back, no code strike), P4 (burst evidence records `requestedFormId` / `requestedResponseId` / `requestedAttemptId`), P10 (counter store enforces `maxEntries`, bounded sweeps), P11 (`MAX_TIME_BARRIER_SECONDS = 86 400` clamp, no `RangeError` 500) and P12 (time-barrier copy no longer credits the researcher). Three decisions stay open (E8-D4, E8-D6, E8-D5 — see Review Findings); 6 defers recorded in `deferred-work.md`. Verification: `verify.sh` OVERALL PASS — schemas 366, backend unit 1364 (96 suites), backend e2e 284 passed / 3 skipped (30 suites), frontend 216, typecheck + lint clean; `prisma validate` OK. Status → in-progress (open decisions).

### File List

New:
- `packages/schemas/src/participation/bot-protection.ts`
- `packages/schemas/src/participation/bot-protection.spec.ts`
- `apps/backend/prisma/migrations/20260926180000_bot_protection_evidence/migration.sql`
- `apps/backend/src/common/security/rate-limit-counter-store.port.ts`
- `apps/backend/src/common/security/in-memory-rate-limit-counter.store.ts`
- `apps/backend/src/common/security/in-memory-rate-limit-counter.store.spec.ts`
- `apps/backend/src/modules/participation/application/participation-rate-limiter.ts`
- `apps/backend/src/modules/participation/application/participation-rate-limiter.spec.ts`
- `apps/backend/src/modules/participation/application/participation.service.bot-protection.spec.ts`
- `apps/backend/src/modules/participation/infrastructure/participation-bot-protection.repositories.spec.ts`
- `apps/backend/test/bot-protection.e2e-spec.ts`
- `apps/backend/test/fixtures/participation.fixture.ts`
- `apps/frontend/my-app/lib/participation-guards.ts`
- `apps/frontend/my-app/app/forms/[id]/respond/TimeBarrierNotice.tsx`
- `apps/frontend/my-app/tests/bot-protection.test.mjs`

Modified:
- `packages/schemas/src/participation/index.ts`
- `packages/schemas/src/participation/survey-attempt.schema.ts`
- `packages/schemas/src/forms/internal-submission.schema.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/.env.example`
- `apps/backend/src/common/config/env.schema.ts`
- `apps/backend/src/common/config/env.service.ts`
- `apps/backend/src/common/config/env.service.spec.ts`
- `apps/backend/src/common/security/security.module.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/common/http/http-exception.filter.spec.ts`
- `apps/backend/src/modules/participation/participation.module.ts`
- `apps/backend/src/modules/participation/application/participation.service.ts`
- `apps/backend/src/modules/participation/application/participation.service.spec.ts`
- `apps/backend/src/modules/participation/application/exceptions/participation.exceptions.ts`
- `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts`
- `apps/backend/src/modules/participation/infrastructure/in-memory-participation.repository.ts`
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts`
- `apps/backend/test/participation-submission.e2e-spec.ts`
- `apps/backend/test/marketplace-activation.e2e-spec.ts` (comment only)
- `apps/frontend/my-app/lib/mock/repository.ts`
- `apps/frontend/my-app/lib/mock/types.ts`
- `apps/frontend/my-app/lib/mock/repository.test.mjs`
- `apps/frontend/my-app/app/forms/[id]/respond/page.tsx`
- `apps/frontend/my-app/app/forms/components/renderer/FormRenderer.tsx`
- `apps/frontend/my-app/app/attempts/[id]/page.tsx`
- `apps/frontend/my-app/app/dashboard/page.tsx`
- `apps/frontend/my-app/app/marketplace/participation-api.ts`
- `apps/frontend/my-app/tests/marketplace-activation.test.mjs`
- `apps/frontend/my-app/tests/notifications.test.mjs`
- `apps/frontend/my-app/tests/respondent-journey.test.mjs`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

Code review 2026-09-26 (modified):
- `packages/schemas/src/participation/bot-protection.ts`, `bot-protection.spec.ts`
- `apps/backend/src/common/security/in-memory-rate-limit-counter.store.ts`, `in-memory-rate-limit-counter.store.spec.ts`
- `apps/backend/src/modules/participation/application/participation-rate-limiter.ts`, `participation-rate-limiter.spec.ts`, `participation.service.ts`, `participation.service.bot-protection.spec.ts`, `ports/participation-repository.port.ts`
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts`, `prisma-participation.repository.spec.ts`, `in-memory-participation.repository.ts`, `participation-bot-protection.repositories.spec.ts`
- `apps/backend/test/bot-protection.e2e-spec.ts`
- `apps/frontend/my-app/lib/participation-guards.ts`, `apps/frontend/my-app/tests/bot-protection.test.mjs`
- `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`

Decision follow-up 2026-09-26 (Batch C2: E8-D4, E8-D5):
- New: `apps/frontend/my-app/app/marketplace/participation-submit-api.ts`
- Modified: `packages/schemas/src/participation/bot-protection.ts`, `bot-protection.spec.ts`; `apps/backend/src/common/config/env.schema.ts`, `env.service.ts`, `env.service.spec.ts`; `apps/backend/src/modules/auth/presentation/cookie-options.helper.spec.ts` (production fixtures name the policy version); `apps/backend/src/modules/participation/application/participation-rate-limiter.ts`, `participation-rate-limiter.spec.ts`; `apps/backend/test/bot-protection.e2e-spec.ts`; `apps/backend/.env.example`, `apps/backend/README.md`; `apps/frontend/my-app/app/marketplace/participation-api.ts` (restored), `apps/frontend/my-app/tests/bot-protection.test.mjs`
- Docs: `_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md` (FR-46 amendment note), `_bmad-output/implementation-artifacts/spec-mock-respondent-journey.md` (Change Log), `deferred-work.md`, `sprint-status.yaml`, `code-review-decisions-2026-09-26.md`

Decision follow-up 2026-09-26 (E8-D6, modified):
- `packages/schemas/src/participation/bot-protection.ts`, `packages/schemas/src/participation/decision-batch-c1.spec.ts` (new)
- `apps/backend/src/modules/participation/application/participation-rate-limiter.ts`, `participation-rate-limiter.spec.ts`, `participation.service.ts`, `participation.service.bot-protection.spec.ts`, `exceptions/participation.exceptions.ts`, `ports/participation-repository.port.ts`
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts`, `prisma-participation.repository.spec.ts`, `in-memory-participation.repository.ts`
- `apps/backend/test/bot-protection.e2e-spec.ts`
- `apps/frontend/my-app/lib/mock/repository.ts`, `apps/frontend/my-app/lib/participation-guards.ts`, `apps/frontend/my-app/tests/bot-protection.test.mjs`
- `_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md`

### Change Log

- 2026-09-26: Implemented Story 8.2 — shared bot-protection contract; server-authoritative Internal Time Barrier (answerable questions × 2 s or publisher minimum, pinned FormVersion, structured 422 + Retry-After, attempt not consumed); FR-46 rate limits (PostgreSQL rolling-window completion limit + per-user burst counters behind a Redis-ready port, 429 + Retry-After); once-per-attempt/window FraudLog evidence (`dedupe_key`) and Time Barrier evidence in `IntegrityAssessmentRequested`; env policy + abuse-control profile; mock-first frontend countdown / take-your-time / rate-limit states and typed live client; tests at every layer. Status → review.
- 2026-09-26: Code review 2026-09-26: Review Findings written (3 decisions, 5 patches P3/P4/P10/P11/P12, 6 defers; 9 dismissed across the epic); every patch applied with tests (serialized completion limit under a per-user advisory lock, burst evidence targets, bounded counter store, clamped barrier values, honest barrier copy); the "concurrency caveat" design note was replaced. Status → in-progress (decisions E8-D4/D6/D5 open).
- 2026-09-26: Decision follow-up 2026-09-26: E8-D6 option A accepted by Quan — completion capacity reserved at attempt start (completions in window + open attempts, re-checked under the per-user advisory lock taken before the form row lock); submit/verify pre-checks removed, P3 backstop kept (no double counting; reservations released on abandon/lock/expiry); AC3.2 amended. Status stays in-progress (E8-D4 and E8-D5 owned by the next batch).
- 2026-09-26: Decision follow-up 2026-09-26: E8-D4 option B and E8-D5 options A/B accepted by Quan (Batch C2) — explicit `PARTICIPATION_RATE_LIMIT_POLICY_VERSION` (required in production, v1 reserved for the default values) stamped on every 429 and RATE_LIMIT FraudLog entry, values still pending OQ16; the 8.2 live-client additions moved to `participation-submit-api.ts` and `participation-api.ts` restored to its prior API surface; AC3.1 and AC5.4 amended. No decision or patch items remain open. Status → done.
