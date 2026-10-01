---
story_key: ir-4a-publisher-progress-response-viewing
epic: IR (Integration Readiness)
created: 2026-09-30
baseline_commit: d1175eb
context:
  - "_bmad-output/planning-artifacts/epics.md#Story IR.4a: Publisher Progress and Response Viewing (and Epic IR scope guard / dependencies)"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#4.12 Publisher Dashboard (FR-39, FR-40, FR-41, FR-42 amendment), §8 Open Questions 6, 8, 11, 22"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md (AD-2, AD-16, AD-18, AD-19, AD-21, Ownership Map, Consistency Conventions)"
  - "_bmad-output/planning-artifacts/implementation-readiness-report-2026-09-30.md (FR-39/FR-40 gap, API-14/API-15, 'no read-model decision for publisher analytics')"
  - "_bmad-output/brainstorming/brainstorm-backend-integration-deployment-2026-09-29/integration-deployment-plan.md (gap register API-14, API-15)"
  - "_bmad-output/implementation-artifacts/sprint-status.yaml (phase_2_deferred: 9-1, 9-3, 8-5, 4-4, epic-10)"
  - "_bmad-output/implementation-artifacts/deferred-work.md (Epic 6 DF6 no deadline field, Epic 5 DF7 lazy abandonment, E4-DN1 cursor deviation)"
  - "_bmad-output/implementation-artifacts/{2-6,2-7,5-4,9-2}-*.md"
  - "apps/frontend/my-app/lib/forms/{manage-service,manage-view,results-service,results-analytics-service,results-analytics,results-view,results-versions}.ts"
  - "apps/frontend/my-app/app/(signed-in)/(app)/forms/[id]/**"
  - "apps/frontend/my-app/mocks/handlers/{forms-manage,forms-results,forms-analytics}.ts, mocks/data/{form-analytics,form-analytics-seed,forms-manage}.ts, mocks/db/store.ts"
  - "apps/backend/src/modules/forms/** (forms.controller.ts, forms.service.ts, forms-escrow.coordinator.ts, ports/form-repository.port.ts, prisma-form.repository.ts)"
  - "apps/backend/src/modules/participation/** (participation.module.ts, prisma-participation.repository.ts)"
  - "apps/backend/src/common/database/completion-counts.ts, apps/backend/src/modules/economy/application/ledger.service.ts#getFormEscrowPosition"
  - "apps/backend/prisma/schema.prisma (Form, FormVersion, Response, SurveyAttempt, SurveyFeedback)"
---

# Story IR.4a: Publisher Progress and Response Viewing

Status: review

<!-- Created by bmad-create-story (unattended run, 2026-09-30). Validation is optional: run validate-create-story before dev-story. -->

## Story

As a Publisher,
I want to see my survey's progress and read the responses it has collected,
so that I can track collection and review my data inside RESCOM (FR-39, FR-40).

## Scope at a glance (read first)

This story turns the four ASSUMED publisher-results contracts into real, owner-scoped backend reads, promotes their schemas into `@rescom/schemas`, and cuts the frontend over to them. The frontend already ships the screens (commits `0628d8e`, `d1175eb`). The backend has **none** of these routes today (readiness report: FR-39 "NOT FOUND", FR-40 "effectively missing").

Grounding against the real backend changes several epic assumptions. The dev agent MUST follow the resolutions below. Each one is also listed under **Questions / Decisions for Owner** at the end.

| # | Epic / frontend assumption | Reality in code | Resolution in this story |
|---|---|---|---|
| R1 | Pause/resume go through "the existing `POST /forms/:id/status`" | `FormsService.transitionStatus` is **Admin-only** (`FormForbiddenException('Only administrators may use the generic form status transition endpoint.')`). `FormStatus` has **no PAUSED** value, and `FORM_STATUS_TRANSITIONS.PUBLISHED = ['CLOSED']` | Pause is **not implementable** without a new lifecycle state. `PAUSE_SUPPORTED` stays `false`. The ASSUMED `setPublisherFormPaused` and the MSW `/pause` `/resume` handlers become unreachable dead code and are removed. A pause story needs its own IR.1 decision (Q7). |
| R2 | Progress shows a "deadline countdown" (`deadlineAt`) | The `Form` model has **no deadline column** anywhere (deferred-work Epic 6 DF6) | `deadlineAt` stays in the contract as `null` (never faked). The UI already renders "Không đặt hạn". Adding a deadline is a separate data-model story (Q8, which also blocks IR.2b's escrow-refund job). |
| R3 | "Lượt mở khảo sát" chart (`opens`) | No view/open tracking exists: no event, no table. FR-41 traffic analytics is Story 9.1 (Phase 2 deferred) | The "bucketed time series for the requested `range`" (epic AC) is a **completions series** derived from completion timestamps. `opens` is removed. The chart title becomes "Lượt hoàn thành" (Q5). |
| R4 | Progress `started`, `abandoned`, `averageDurationSeconds`; analytics `startedCount`, `averageDurationSeconds` | Derivable, but they are FR-41 funnel metrics (Story 9.1, deferred; scope guard excludes "advanced analytics") | Removed from the contracts by default. Derivations are documented so IR.1 can approve them later (Q6). |
| R5 | Progress `feedback` card | `SurveyFeedback` rows exist (Story 9.2), but every row is `PENDING`, no validator runs, and Publisher-visible feedback is Story 9.3 (Phase 2, FR-42 amendment, minimum-aggregation gate) | Removed from the contract. `FeedbackCard` is hidden (Q9). |
| R6 | Progress `pendingAttempts` + complaints route (`POST /forms/:id/attempts/:attemptId/disputes`) | No Publisher dispute route exists. Story 8.5 is deferred | Removed from the contract. `PendingAttemptsCard` is hidden and `/forms/[id]/complaints/*` returns `notFound()` (Q10). |
| R7 | Responses list "every row of the version" (client-side filter/search/pagination) | Spine: "list APIs use cursor pagination"; `apiRequest` drops `meta` | The backend is keyset-cursor paginated, with `nextCursor` inside `data` (precedent: `starter-points.schema.ts`). The frontend collects pages up to a hard cap so the existing client-side search and position logic keep working (Q13). |
| R8 | Response `quality: PASSED/NEEDS_REVIEW` + `reviewReasons` | Epic 10 is deferred. The spine says "integrity metadata is `NOT_ASSESSED`" | Each row carries `integrity: { applicability: 'NOT_ASSESSED' }`. The quality filter, `QualityTag` and review reasons are removed. |
| R9 | Non-owner gets `403 FORM_FORBIDDEN`, Admin may read (MSW `ownedForm`) | Epic AC: "a non-owner receives 404; Admin read access, if granted, is explicit and audited". No generic admin-read audit sink exists | New routes are **owner-only**: any non-owner, **including an Admin**, gets `404 FORM_NOT_FOUND` (Q4). Existing `GET /forms/:id` (403, Admin allowed) is unchanged. |
| R10 | EXTERNAL responses list verified completion codes (`codeVerified`) | Epic AC: "an External Form returns an explicit not-applicable result" | `availability: 'NOT_APPLICABLE', reason: 'EXTERNAL_FORM'` for responses and analytics. `codeVerified` is removed. |
| R11 | `shortLabel` column headers | Nothing stores them (the MSW `SHORT_LABELS` map is mock-only) | Removed. The table header falls back to the question title (the existing behaviour for `null`). |
| R12 | Version detail feeds "Thay đổi so với v1" (diff) and "Xem (chỉ đọc)" | Epic AC: version-diff routes stay hidden (OQ-8) | `GET /forms/:id/versions/:versionId` is built only if IR.1 approves version detail (Q3). The diff UI is hidden regardless. |

## Acceptance Criteria

**Epic source (IR.4a).** Given the ASSUMED contracts in `lib/forms/manage-service.ts` (`GET /forms/:id/progress?range=`), `lib/forms/results-service.ts` (`GET /forms/:id/responses[?versionNumber=]`, `GET /forms/:id/versions/:versionId`) and `lib/forms/results-analytics-service.ts` (`GET /forms/:id/analytics`), each implemented schema is promoted into `@rescom/schemas`, is shared by the frontend service and the backend controller, and is covered by a contract test. Any field IR.1 did not approve is removed from the frontend, never faked. Owner: progress (FR-39); Internal responses, cursor-paginated per pinned version, newest first, with `formVersionId` and answers (FR-40); analytics per question per version within NFR-1 with no unbounded scan (NFR-30) if IR.1 approves, else hidden; pause/resume only through a working transition; export, Survey Quality and version-diff stay hidden (OQ-6, OQ-8). Tests cover owner, non-owner, empty, paginated and mixed-version cases.

### AC0 — IR.1 scope gate is honoured before coding

1. Before starting, the dev agent reads the IR.1 decision record (G0/G1 contract register). For each conditional item (analytics summary Q1, respondent identity Q2, version detail Q3, Admin read Q4, FR-41 funnel metrics Q6), it follows the recorded decision. **If IR.1 has not recorded a decision, it applies the defaults in "Questions / Decisions for Owner"** and notes this in Completion Notes.
2. Build-time scope flags live in one new file, `apps/frontend/my-app/lib/forms/results-scope.ts`. It follows the existing `PAUSE_SUPPORTED` pattern of plain exported `const` booleans with a comment citing the decision. Defaults: `RESULTS_ANALYTICS_ENABLED` (Q1), `VERSION_DETAIL_ENABLED` (Q3), `VERSION_DIFF_ENABLED = false`, `SURVEY_QUALITY_ENABLED = false`, `RESPONSE_EXPORT_ENABLED = false`, `PUBLISHER_DISPUTES_ENABLED = false`, `PUBLISHER_FEEDBACK_SUMMARY_ENABLED = false`. `PAUSE_SUPPORTED` stays in `manage-service.ts`, set to `false`.

### AC1 — Shared contracts in `@rescom/schemas`

1. New file `packages/schemas/src/forms/publisher-results.schema.ts`, exported from `packages/schemas/src/forms/index.ts`. It contains the query and response schemas for the four endpoints, exactly as specified in the **Contract tables** (Dev Notes). Response DTO objects are `.strict()`, so a leaked field such as `respondentId` fails parsing (privacy guard).
2. New pure module `packages/schemas/src/forms/form-analytics.aggregate.ts` (only if Q1 is approved). It is a port of `apps/frontend/my-app/mocks/data/form-analytics.ts` (`buildFormAnalytics`, `numberBuckets`, `median`, `percentOf`) with identical rules, operating on `{ id, submittedAt, answers }` rows and the shared question projection. The backend service and the MSW handler both call it. The mock file becomes a thin re-export, so MSW and the backend cannot drift.
3. New helpers `encodePublisherResponsesCursor` / `decodePublisherResponsesCursor` (base64url JSON `{ v: 1, versionId, submittedAt, id }`). Reuse the ASCII base64url approach of `packages/schemas/src/economy/starter-points.schema.ts`. No `Buffer`/`btoa`: the helpers run in Node and in the browser.
4. Golden fixtures `packages/schemas/src/forms/__fixtures__/publisher-results/*.json` (progress, responses page 1/2, responses NOT_APPLICABLE, analytics, version detail) are parsed by a schemas spec, by a backend e2e, and by a frontend `node --test` file. These three parses are the contract test.
5. The frontend services import these schemas instead of their local copies: `formProgressSchema` in `manage-service.ts`; `formResponsesSchema`, `formVersionDetailSchema` in `results-service.ts`; `formAnalyticsSchema` in `results-analytics-service.ts`.

### AC2 — `GET /forms/:id/progress?range=hour|day|week|month` (FR-39)

1. Route on `FormsController` (`['forms','api/forms']`, `SessionAuthGuard`). The query is validated with `publisherProgressQuerySchema`: `range` defaults to `day`; an unknown value returns `400 VALIDATION_ERROR`. `:id` goes through `ParseUUIDPipe` (`400 VALIDATION_ERROR`).
2. Owner only. An unknown form, or a form not owned by the caller (**Admin included**), returns `404 FORM_NOT_FOUND` with no existence leak.
3. The response body has `{ formId, status, completed, expected, pointsSpent, escrowRemaining, deadlineAt: null, completionsSeries: { range, timeZone: 'Asia/Ho_Chi_Minh', total, buckets: [{ startsAt, endsAt, count }] } }`. The field rules are in the Progress contract table:
   - `completed` equals `GET /forms/:id` `completedCompletions` (same `listRewardableCompletions` read).
   - `escrowRemaining` equals `escrowLocked` (same ledger position).
   - `pointsSpent` is the ledger-posted Escrow consumption (`FormEscrowPosition.consumed`).
4. Bucket windows are zero-filled and chronological, and the last bucket contains "now":
   - `hour`: 8 × 3 h over the last 24 h, aligned to local 3-hour boundaries.
   - `day`: 7 local days ending today.
   - `week`: 4 ISO weeks (Monday start) ending the current week.
   - `month`: 6 local calendar months ending the current month.
   Buckets are computed in `Asia/Ho_Chi_Minh`. `startsAt`/`endsAt` are UTC ISO-8601. `total` is the sum of the counts.
5. A free survey (effective cost 0), a DRAFT or a MODERATION_QUEUE survey returns zeros, not an error.
6. Invariant, tested: `pointsSpent + escrowRemaining + refunded + owed×draw == reserved` for a paid survey.

### AC3 — `GET /forms/:id/responses[?versionNumber=&cursor=&limit=]` (FR-40)

1. Owner-only route. The non-owner rule is the same as AC2 (404). The query is validated with `publisherResponsesQuerySchema`: `versionNumber` is a positive int; `limit` is 1..100 with default 50; `cursor` is opaque.
2. **Version selection.** With `versionNumber`, that version of the form is used; an unknown number returns `404 FORM_VERSION_NOT_FOUND`. Without it, the highest `versionNumber` that has ≥ 1 listed response is used, else the highest published version, else the highest version. This is the MSW `pickVersion` rule, kept for UX parity.
3. **Internal form.** The response is `availability: 'AVAILABLE'` with `form`, `questions` (from the pinned version's `schemaJson.blocks`, sorted by `order`), `responses`, `totalCount` and `nextCursor`.
   - Rows include only Responses of that one `formVersionId` with status `SUBMITTED` or `VALIDATED`, ordered `submittedAt DESC, id DESC` with a keyset cursor.
   - `IN_PROGRESS`, `DISPUTED` and `REJECTED` rows are never listed (Q12).
   - Each row is `{ id, code, formVersionId, submittedAt, durationSeconds, integrity: { applicability: 'NOT_ASSESSED' }, answers }`.
   - `nextCursor` is `null` on the last page.
   - A cursor from another version, or a malformed cursor, returns `400 INVALID_CURSOR`.
4. **External form.** The response is `availability: 'NOT_APPLICABLE', reason: 'EXTERNAL_FORM'`, with `form: { id, title, type: 'EXTERNAL', externalUrl }` and no rows. It is never an empty list.
5. **Privacy (AD-18).** Rows are built by an explicit projection. No generic Prisma serialization, and no `respondentId`, `attemptId`, `ipAddress`, `isGuest`, `clientContext`, integrity events or assessments, feedback, demographics, name/email, `StoredObject` id/key/bucket. `code` is a per-response pseudonym that cannot be linked across forms. `answers` only contains keys of blocks that exist in the pinned version. File answers are projected to file names only (Q11). See "Privacy rules".
6. Responses of other versions never appear. The mixed-version test proves this for v1 vs v2 of the same form.

### AC4 — `GET /forms/:id/analytics[?versionNumber=]` (FR-40 summary; CONDITIONAL on Q1)

1. **If Q1 is approved.** Owner-only route with the same version selection, errors and External `NOT_APPLICABLE` result as AC3.
   - An Internal form returns `{ availability: 'AVAILABLE', form, totalResponses, lastResponseAt, questions[] }`.
   - Per-question aggregates are computed server-side by the shared aggregator (AC1.2) over that one version's `SUBMITTED`/`VALIDATED` responses.
   - The read is bounded: first an index-backed `COUNT`. If the count is above `PUBLISHER_ANALYTICS_MAX_RESPONSES` (default 5 000, a shared constant), the route returns `422 PUBLISHER_ANALYTICS_LIMIT_EXCEEDED` with `details: { totalResponses, limit }`. Otherwise it streams keyset batches of 500, selecting only `id, submitted_at, answers_json`.
   - The route never loads raw events and never scans across forms or versions (NFR-30). A local timing at the cap is recorded against the NFR-1 < 500 ms target (OQ-22 governs the formal profile).
2. **If Q1 is not approved.** No backend route is added. `RESULTS_ANALYTICS_ENABLED = false`. The "Tóm tắt" and "Theo câu hỏi" sub-nav entries are hidden, `/forms/:id/responses` and `/forms/:id/responses/questions` redirect to `/forms/:id/responses/individual` (keeping `?v=`), and `AnalyticsProvider` issues no request.

### AC5 — `GET /forms/:id/versions/:versionId` (CONDITIONAL on Q3)

1. **If Q3 is approved.** Owner-only route (`:id` and `:versionId` both `ParseUUIDPipe`).
   - A version that does not belong to the form returns `404 FORM_VERSION_NOT_FOUND`.
   - The response is `{ id, formId, versionNumber, isPublished, publishedAt, createdAt, externalUrl, schemaJson }`. `schemaJson` is the stored definition. `completionCode` and `targetingJson` are never returned.
   - The frontend "Xem (chỉ đọc)" page uses it.
2. The diff card "Thay đổi so với vN" is hidden (`VERSION_DIFF_ENABLED = false`). `useFormVersions` must not fetch version details for the diff.
3. **If Q3 is not approved.** No route is added, the "Xem (chỉ đọc)" link is hidden, and `/forms/[id]/versions/[versionNumber]` returns `notFound()`.

### AC6 — Pause / resume

1. `PAUSE_SUPPORTED` remains `false`. The generic `/status` route is Admin-only and there is no PAUSED state (R1). The "Tạm dừng" / "Tiếp tục" buttons stay unrendered, and the existing test `assert.equal(service.PAUSE_SUPPORTED, false)` keeps passing.
2. Remove the unreachable ASSUMED client `setPublisherFormPaused`, the `togglePause`/`pausing` wiring in `use-form-actions.tsx`, and the MSW `POST /forms/:id/pause|resume` handlers. The frontend then makes no call to a non-existent route. No backend change is made. A future pause story owns the lifecycle change (Q7).

### AC7 — Deferred entry points are unreachable in the pilot build

1. **Export (OQ-6).** The "Xuất dữ liệu" buttons (`HeaderActions`, `MobileStatusActions`) are hidden. `/forms/[id]/export` returns `notFound()`. Copy that promises export ("xuất .xlsx/.csv" in `AnswersNote`; "hoặc xuất file để có tất cả câu hỏi" in `ResponsesScreen`) is reworded.
2. **Survey Quality (OQ-8).** The "Chất lượng" tab is removed from `SurveyTabs`. `/forms/[id]/quality` returns `notFound()`. Quality stats and tags on `VersionsScreen` are hidden.
3. **Version diff (OQ-8).** Hidden per AC5.2.
4. **Disputes (Story 8.5).** `/forms/[id]/complaints/*` returns `notFound()` and the "Lượt đang chờ 48 giờ" card is hidden.
5. **Feedback summary (Story 9.3).** `FeedbackCard` is hidden.
6. A frontend test asserts every flag above has its pilot value, and that each hidden page module calls `notFound()` when its flag is off.

### AC8 — Frontend cut-over (mock and real use the same code path)

1. Services parse the shared schemas. `getFormResponses` is replaced by `collectFormResponses(formId, versionNumber, signal)`.
   - It walks `nextCursor` with `limit=100` up to `RESPONSES_MAX_PAGES = 20` (2 000 rows), de-duplicates by `id`, and returns `{ ...firstPage, responses, truncated }`.
   - When `truncated` is true, the screens show "Chỉ hiển thị 2.000 câu trả lời mới nhất."
   - Client-side search, pagination (`paginate`), `responsePosition` and the question table keep working unchanged.
2. `ResponsesScreen`, `ResponsesTable`, `ResponsesMobile` and `ResponseAnswers` drop the quality filter (`QualitySegments`, `QualityChips`, `?quality=`, which is ignored when present), `QualityTag`, `reviewReasons`, `REVIEW_DISCLAIMER` and every `codeVerified` / EXTERNAL row branch.
   - A neutral `Tag` "Chưa đánh giá chất lượng" shows `NOT_ASSESSED` in the detail meta only.
   - A null `durationSeconds` renders "—".
   - `NOT_APPLICABLE` renders the existing `GOOGLE_FORMS_ANSWERS_NOTE` with an "Mở Google Forms" link (`form.externalUrl`).
3. `ProgressScreen` / `ProgressCards` / `OpensChart` / `use-form-progress.ts` / `manage-view.ts`:
   - The chart shows `completionsSeries`, titled "Lượt hoàn thành".
   - Labels are computed on the client from `startsAt` in Vietnam time by a new `seriesBucketLabel(range, startsAt)`: `hour` → "0h".."21h"; `day` → "T2".."CN"; `week` → "dd/MM" of the Monday; `month` → "T1".."T12".
   - `opensSummary` is renamed `seriesSummary` and keeps the peak logic: "7 ngày qua · 5 lượt hoàn thành · nhiều nhất thứ Năm".
   - MiniStats (started, abandoned, average time), `FeedbackCard` and `PendingAttemptsCard` are removed unless the matching Q is approved.
   - The "Điểm đã chi" subtitle is `Cho {completed} lượt hoàn thành` for both form types.
4. `AnalyticsHeader` / `headerMetrics` drop the completion-rate and average-time tiles, because those fields are absent (R4). "N câu trả lời", "phiên bản vX" and the "Câu trả lời gần nhất" tile remain.
5. The MSW handlers (`forms-manage.ts` progress, `forms-results.ts` responses and version detail, `forms-analytics.ts`) return the new shapes. They validate with the shared schemas and enforce the owner-only 404 rule (the Admin bypass in `ownedForm` is removed for these routes). The responses handler paginates with the shared cursor helpers.
   - Bump `mocks/db/store.ts` `SCHEMA_VERSION` to 5 **only if** a persisted collection shape changes. If it does, add a "5: …" comment line and update `docs/frontend/mock-strategy.md`.
6. With mocking disabled (`NEXT_PUBLIC_API_MOCKING` ≠ `enabled`), the four screens work against the real backend through `/api`, with no MSW request.

### AC9 — Query design, indexes and bounds (NFR-1, NFR-30)

1. One Participation-owned migration `apps/backend/prisma/migrations/20260930120000_publisher_results_read_indexes/migration.sql` (no `to_regclass` guards; see the migration-chain test) creates:
   - `responses_version_completed_feed_idx` ON `responses (form_version_id, submitted_at DESC, id DESC) WHERE status IN ('SUBMITTED','VALIDATED')`
   - `responses_form_completed_submitted_idx` ON `responses (form_id, submitted_at) WHERE status IN ('SUBMITTED','VALIDATED')`
   - `survey_attempts_survey_id_status_submitted_at_idx` ON `survey_attempts (survey_id, status, submitted_at)`. This one is also declared in `schema.prisma` as `@@index([surveyId, status, submittedAt])`.
   The two partial indexes are raw SQL (Prisma 6.0 cannot express `WHERE`). Document them in a `///` comment on `model Response`.
2. Every read is bounded by one of: one form, one version, a fixed bucket window, a page `limit ≤ 100`, or the analytics cap. No endpoint loads `integrity_events`, and none issues a per-row query (no N+1). The durations come from a single join on `survey_attempts.id`.

### AC10 — Tests and verification (see Test plan)

1. Schemas, backend unit, backend e2e (in-memory), backend Prisma e2e (real SQL, skipped without a database like the existing `*.prisma.e2e-spec.ts`), and frontend `node --test` suites cover: owner, non-owner (user and Admin → 404), unauthenticated (401), validation (400), empty, paginated walk, cursor misuse, mixed versions, External `NOT_APPLICABLE`, analytics cap, the privacy projection, and the timezone bucket boundaries.
2. `npm run typecheck`, `lint` and `test` pass in `packages/schemas`, `apps/backend` (unit + `test:e2e`) and `apps/frontend/my-app`, as does `npm run build` for the frontend. `test/architecture.spec.ts` and `test/migration-chain.spec.ts` stay green.

## Tasks / Subtasks

- [ ] **T0 — Scope gate (AC0).**
  - [ ] T0.1 Read the IR.1 decision record. Record Q1–Q13 outcomes, or the defaults applied, in Completion Notes.
  - [ ] T0.2 Create `apps/frontend/my-app/lib/forms/results-scope.ts` with the AC0.2 flags and comments citing the decision or OQ.
- [ ] **T1 — Shared contracts (AC1).**
  - [ ] T1.1 `packages/schemas/src/forms/publisher-results.schema.ts`: `PUBLISHER_PROGRESS_RANGES`, `publisherProgressQuerySchema`, `publisherProgressSchema`, `publisherResponsesQuerySchema`, `publisherResponseQuestionSchema`, `publisherResponseAnswerValueSchema`, `publisherResponseRowSchema`, `publisherResponsesPageSchema` (discriminated on `availability`), `publisherAnalyticsQuerySchema`, `publisherAnalyticsSchema` (+ question summary union, if Q1), `publisherFormVersionDetailSchema` (if Q3), the `PUBLISHER_RESPONSES_PAGE_LIMIT_{DEFAULT=50,MAX=100}` and `PUBLISHER_ANALYTICS_MAX_RESPONSES = 5000` constants, and the error-code constants `FORM_VERSION_NOT_FOUND_CODE`, `INVALID_CURSOR_CODE`, `PUBLISHER_ANALYTICS_LIMIT_EXCEEDED_CODE`.
  - [ ] T1.2 Cursor helpers (AC1.3), next to the schema.
  - [ ] T1.3 (Q1) `packages/schemas/src/forms/form-analytics.aggregate.ts`: port the MSW aggregator verbatim (rules in its header comment), plus the question projection `toPublisherQuestions(blocks)` (the MSW `questionsOf` without `shortLabel`). Also used by the responses route even when Q1 is rejected, so place `toPublisherQuestions` in `publisher-results.schema.ts` if the aggregator file is skipped. `responseDisplayCode` stays backend-only (it uses Node `crypto`).
  - [ ] T1.4 Export from `packages/schemas/src/forms/index.ts`. Add `publisher-results.schema.spec.ts` and `form-analytics.aggregate.spec.ts` (port the cases from `apps/frontend/my-app/tests/forms-analytics.test.mjs`) plus the golden fixtures (AC1.4). Include a strictness test: a row with `respondentId` fails.
- [ ] **T2 — Backend: exceptions and filter.**
  - [ ] T2.1 In `apps/backend/src/modules/forms/application/exceptions/form.exceptions.ts`: `FormVersionNotFoundException` (`FORM_VERSION_NOT_FOUND`), `InvalidResultsCursorException` (`INVALID_CURSOR`), and (Q1) `PublisherAnalyticsLimitExceededException` (`PUBLISHER_ANALYTICS_LIMIT_EXCEEDED`, with `details`).
  - [ ] T2.2 Map them in `apps/backend/src/common/http/http-exception.filter.ts`: 404 in the NOT_FOUND chain, 400 and 422 in new branches, following the existing `instanceof` style.
- [ ] **T3 — Backend: progress (AC2), Research-owned.**
  - [ ] T3.1 `FormRepositoryPort.bucketCompletions(formId, window: { unit: 'hour'|'day'|'week'|'month'; from: Date; to: Date; timeZone: string }) → Array<{ bucketStart: Date; count: number }>`. Implement it in `prisma-form.repository.ts` by delegating to a new shared helper `bucketCompletionsForForm(client, …)` in `apps/backend/src/common/database/completion-counts.ts`. The helper uses the same completion definition as `countCompletionsByFormIds`: Responses `SUBMITTED`/`VALIDATED` by `submitted_at`, plus `COMPLETED` attempts without a Response by `submitted_at`. It uses a parameterized `$queryRaw` with `date_trunc($unit, submitted_at, $tz)` and `GROUP BY` (≤ 24 rows). Implement `in-memory-form.repository.ts` too, from seeded completion timestamps; add a seeding method.
  - [ ] T3.2 `FormsEscrowCoordinator.getProgressEscrow(form, completions) → { held: number; spent: number }`. Refactor the private `loadEscrowState` to also return the `FormEscrowPosition`. `spent = position.consumed`, `held = max(0, remaining)`. A free survey returns `{0,0}`. Do not change `getFundingPosition`, `getHeldEscrowByForm` or `coordinateClose` behaviour. Their existing specs must pass unchanged.
  - [ ] T3.3 `FormsService.getProgress(id, requester, range)`:
    - Owner check → `FormNotFoundException` (not Forbidden).
    - Read `listRewardableCompletions` once and reuse it for the escrow (as `toManagedDetailDto` does).
    - Window math uses an injectable clock: add an optional `clock: () => Date = () => new Date()` as the **last** constructor parameter and pass it in `forms.module.ts`.
    - Zero-fill the buckets.
    - Keep the window math in a pure, framework-free function `progressWindow(range, now)` in `apps/backend/src/modules/forms/application/progress-window.ts`.
  - [ ] T3.4 `FormsController` `@Get(':id/progress')` with `@Query(new ZodValidationPipe(publisherProgressQuerySchema, 'VALIDATION_ERROR', 'query'))`, returning `createSuccessEnvelope`. Set `Cache-Control: private, no-store` (a `@Header` decorator is fine).
- [ ] **T4 — Backend: responses (AC3) and analytics (AC4), Participation-owned (AD-16).**
  - [ ] T4.1 Port `apps/backend/src/modules/participation/application/ports/publisher-response-read.port.ts`, token `PUBLISHER_RESPONSE_READ_PORT`:
    - `countListed(formVersionId)`
    - `listPage({ formVersionId, after?: { submittedAt, id }, limit })` → rows `{ id, formVersionId, submittedAt, answers, attemptStartedAt | null }`
    - `versionIdsWithListedResponses(formId)`
    - (Q1) `streamAnswers({ formVersionId, batchSize })` as an async iterator, or `listAnswerBatch(after, limit)`
  - [ ] T4.2 Adapters:
    - `infrastructure/prisma-publisher-response-read.repository.ts`: `select` only the needed columns; `LEFT JOIN survey_attempts` via the relation for `startedAt`; keyset `WHERE (submitted_at, id) < ($1, $2)`; `take: limit + 1`.
    - `infrastructure/in-memory-publisher-response-read.repository.ts`, reading the public `attempts`/`responses` maps of `InMemoryParticipationRepository`, or its own maps plus seed helpers.
  - [ ] T4.3 `application/publisher-results.service.ts`, framework-free:
    - Ownership and versions come from `FORM_REPOSITORY_PORT` (exported by `FormsModule`, which `ParticipationModule` already imports): `findById` and `findAllVersions`.
    - Version selection (AC3.2), cursor decode and mismatch checks, the projection (see "Privacy rules" and the Responses contract table), and `durationSeconds = max(0, round((submittedAt − attemptStartedAt)/1000))`, else `null`.
    - `code = responseDisplayCode(id)`: the first 6 hex characters of `sha256('rescom-response-code:v1:' + id)`, upper-cased.
    - (Q1) `getAnalytics`: count, cap, batch through the shared aggregator.
  - [ ] T4.4 `presentation/publisher-results.controller.ts`, `@Controller(['forms','api/forms'])` + `SessionAuthGuard`: `@Get(':id/responses')` and (Q1) `@Get(':id/analytics')`, zod query pipes, `Cache-Control: private, no-store`. Register the providers with `useFactory` in `participation.module.ts`, like the existing services. Do NOT import `ParticipationModule` into `FormsModule`: that would be circular, because Participation already imports Forms.
- [ ] **T5 — Backend: version detail (AC5, only if Q3).** `FormsService.getVersionDetail(id, versionId, requester)`: owner → 404, version belongs to form → else 404 `FORM_VERSION_NOT_FOUND`, explicit mapper (no `completionCode`, no `targetingJson`). Add `FormsController` `@Get(':id/versions/:versionId')` (both params `ParseUUIDPipe`).
- [ ] **T6 — Migration and indexes (AC9).**
  - [ ] T6.1 Add `@@index([surveyId, status, submittedAt])` on `SurveyAttempt`, and the `///` note on `Response` in `apps/backend/prisma/schema.prisma`.
  - [ ] T6.2 Write the migration SQL with `CREATE INDEX IF NOT EXISTS`, no `to_regclass`. Do **not** edit `prisma/sql/post-push-invariants.sql`: `migration-chain.spec.ts` requires it to equal the frozen reconcile section. The partial indexes are therefore absent in `db push` dev databases, which is acceptable; `db push` is not a promotion path.
  - [ ] T6.3 Run `npm run prisma:validate --workspace backend`, `npx prisma generate`, and `prisma migrate deploy` on a clean local database.
- [ ] **T7 — Frontend services (AC1.5, AC8.1).**
  - [ ] T7.1 `lib/forms/manage-service.ts`:
    - Import the progress schema and ranges from `@rescom/schemas`. Delete the local `formProgressSchema`, `OPENS_RANGES` (re-export the shared constant under the old name if that is easier) and the `disputeSchema`/`pendingAttempts` types.
    - Move `submitAttemptDispute`, `DISPUTE_REASONS` and the `PendingAttempt` type into a new `lib/forms/dispute-service.ts`, used only by the hidden complaints route, so the hidden code still typechecks.
    - Delete `setPublisherFormPaused`.
  - [ ] T7.2 `lib/forms/results-service.ts`:
    - Use the shared `publisherResponsesPageSchema`, and the version detail schema if Q3.
    - Add `getFormResponsesPage` and `collectFormResponses` (AC8.1), and export `RESPONSES_MAX_PAGES`.
    - Keep `formVersionSummarySchema` (VERIFIED list) and its optional ASSUMED stats. They stay absent from the real backend and the UI shows "—".
    - Keep `getFormQuality`/`formQualitySchema` untouched. They are mock-only, and their route is hidden.
    - Update the header table comment (ASSUMED → VERIFIED, and the 404 rule).
  - [ ] T7.3 (Q1) `lib/forms/results-analytics-service.ts`: use the shared schema, and update `lib/forms/results-analytics.ts` `headerMetrics` (R4).
  - [ ] T7.4 `lib/forms/results-view.ts`: remove the quality filter helpers (`QualityFilter`, `QUALITY_FILTERS`, `parseQualityFilter`, `matchesQuality`, `qualityCounts`) and make `filterResponses` search-only. Make `formatDurationShort`/`formatDurationLong` callers handle `null`.
  - [ ] T7.5 `lib/forms/manage-view.ts`: `seriesBucketLabel`, and rename `opensSummary` → `seriesSummary`. Window captions stay "24 giờ qua / 7 ngày qua / 4 tuần qua / 6 tháng qua".
  - [ ] T7.6 `lib/forms/results-messages.ts`: add messages for `FORM_VERSION_NOT_FOUND` ("Không có phiên bản này."), `PUBLISHER_ANALYTICS_LIMIT_EXCEEDED`, `INVALID_CURSOR` (reload), and the truncation note. `loadError`'s 403 branch can stay (it is harmless).
- [ ] **T8 — Frontend screens (AC7, AC8.2–8.4).** All files are under `app/(signed-in)/(app)/forms/[id]/`.
  - [ ] T8.1 `components/ProgressScreen.tsx`, `ProgressCards.tsx`, `OpensChart.tsx` (rename optional), `hooks/use-form-progress.ts` (the `range` state and "day"-first loading stay).
  - [ ] T8.2 `components/HeaderActions.tsx`, `components/ProgressScreen.tsx#MobileStatusActions` (export hidden, pause removed), `hooks/use-form-actions.tsx` (remove the pause state), `components/SurveyTabs.tsx` (quality tab removed).
  - [ ] T8.3 `responses/hooks/responses-context.tsx` (`collectFormResponses`), `responses/components/ResponsesScreen.tsx`, `ResponsesToolbar.tsx` (drop the quality controls, keep `SearchBox`/`ColumnPicker`), `ResponsesTable.tsx`, `ResponsesMobile.tsx`, `ResponseAnswers.tsx`, `QualityTag.tsx` (delete or replace with the neutral tag), and the NOT_APPLICABLE branch.
  - [ ] T8.4 (Q1) `responses/components/SummaryScreen.tsx`, `QuestionScreen.tsx` (the full text list reads `collectFormResponses` data; show the truncation note), `AnalyticsHeader.tsx`. If Q1 is not approved: `responses/page.tsx` and `responses/questions/page.tsx` redirect; `ResponsesSubnav.tsx` hides the two entries; `analytics-context.tsx` gets a `null` key.
  - [ ] T8.5 `versions/components/VersionsScreen.tsx` (hide the quality stat/tag and the diff card; gate "Xem (chỉ đọc)" on `VERSION_DETAIL_ENABLED`), `versions/hooks/use-form-versions.ts` (no diff fetch while `VERSION_DIFF_ENABLED` is false), `versions/components/VersionReadOnly.tsx` (unchanged if Q3; otherwise the page returns `notFound()`).
  - [ ] T8.6 `notFound()` guards: `export/page.tsx`, `quality/page.tsx`, `complaints/[attemptId]/page.tsx`, and `versions/[versionNumber]/page.tsx` when Q3 is not approved. Keep `ExportDialog`/`results-export.ts`/`results-xlsx.ts` compiling against the new row type: remove the `includeQuality` / `scope: 'passed'` options.
- [ ] **T9 — MSW parity (AC8.5).**
  - [ ] T9.1 `mocks/handlers/forms-manage.ts`: progress returns the shared shape, with the series derived from the mock completions (or seeded counts); delete the pause/resume handlers; keep the dispute handler, which is unreachable.
  - [ ] T9.2 `mocks/handlers/forms-results.ts`: responses with availability, cursor, `limit` and `integrity`; owner-only 404; version detail returns the shared shape.
  - [ ] T9.3 (Q1) `mocks/handlers/forms-analytics.ts` + `mocks/data/form-analytics.ts` re-export the shared aggregator.
  - [ ] T9.4 Bump `SCHEMA_VERSION` only if a persisted shape changed (AC8.5).
- [ ] **T10 — Tests (AC10), per the Test plan.**
- [ ] **T11 — Verification.**
  - [ ] T11.1 Run the full suites plus typecheck, lint and build.
  - [ ] T11.2 Do a manual real-stack smoke with mocking disabled: owner sees progress and responses; a second account gets 404; a Google Forms survey shows the not-applicable note.
  - [ ] T11.3 Record the analytics timing at the cap (Prisma e2e log).
  - [ ] T11.4 Update the IR.1 contract register rows API-14/API-15 (and progress/version detail) from `assumed` to `verified`, with evidence paths, if the register exists as a file. Otherwise list the evidence in Completion Notes. Do NOT edit `epics.md` or `sprint-status.yaml` beyond the normal dev-story status flow.

### Review Findings

_bmad-code-review 2026-10-01 of commit `3e9c69e` (Blind Hunter, Edge Case Hunter, Acceptance Auditor; Sonnet)._

- [ ] [Review][Decision] Test-gap scope before done — missing: `forms-escrow.coordinator.spec` for `getProgressEscrow` and the AC2.3 equalities (escrowRemaining = escrowLocked, completed = completedCompletions); e2e analytics non-owner/401/400/422-over-HTTP; version-detail non-owner/401 (AC10.1).
- [ ] [Review][Patch] Month-range peak is mapped through WEEKDAY_NAMES, so "T2".."T7" (Feb..Jul) read as "thứ Hai".."thứ Bảy" [apps/frontend/my-app/lib/forms/manage-view.ts:199]
- [ ] [Review][Patch] Completion note says the response code is an HMAC; `responseDisplayCode` is an unkeyed sha256 (as T4.3 specified) — correct the note [this file, Completion Notes]
- [x] [Review][Defer] Submit validation accepts any finite number for rating/linear_scale (and non-option single_choice), so the aggregator counts such answers as skipped [packages/schemas/src/forms/internal-submission.schema.ts:215] — deferred, pre-existing
- [x] [Review][Defer] Analytics count/scan not snapshot-bound: a concurrent submit shifts the aggregated set by one row [publisher-results.service.ts getAnalytics] — deferred
- [x] [Review][Defer] `versionIdsWithListedResponses` DISTINCT scan per analytics call (index lacks form_version_id) [prisma-publisher-response-read.repository.ts] — deferred (NFR-1 profile OQ-22)
- [x] [Review][Defer] Number buckets NaN/Infinity for extreme values; 6-hex code collisions above ~4k responses; default-version cursor INVALID_CURSOR for direct API callers; `collectResponsePages` drops fetched rows on a later-page failure; deep link beyond 2 000 shows not-found — deferred

## Dev Notes

### Contract tables (frontend expectation vs backend source)

Legend: **KEEP** = derivable, implement. **ADD** = new field. **DROP** = not derivable, or not approved; remove from schema and UI. **NULL** = contract field kept but always `null` in Phase 1 (honest unknown, UI already handles it).

#### 1. `GET /forms/:id/progress?range=` (frontend today: `manage-service.ts#formProgressSchema`, MSW `forms-manage.ts`)

| Field | Frontend today | Backend source | Verdict |
|---|---|---|---|
| `formId` | string | `Form.id` | KEEP |
| `status` | — | `Form.status` (`formStatusEnum`) | ADD (FR-39 lists status; the header also has it) |
| `completed` | int | `listRewardableCompletions(formId).completedCount`: Responses SUBMITTED/VALIDATED + COMPLETED attempts with no Response, guests included. Identical to `FormDetailDto.completedCompletions` | KEEP |
| `expected` | int | `Form.expectedCompletions` | KEEP |
| `pointsSpent` | int (mock: `completed × escrowDrawPerCompletion`) | `LedgerService.getFormEscrowPosition(...).consumed`: Escrow debits of `internal-reward:` / `integrity-hold:` / `external-completion:` journals, reversed journals excluded | KEEP. Semantics are ledger-posted, so the value lags the mock by `owed × draw` until the Outbox settles (IR.2b) |
| `escrowRemaining` | int | `max(0, reserved − refunded − consumed − owed×draw)`, the same value as `FormDetailDto.escrowLocked` | KEEP |
| `deadlineAt` | string \| null | none: no column on `Form` | NULL (R2, Q8) |
| `opens{range,total,buckets[{label,count}]}` | chart | none: no view tracking; FR-41 / Story 9.1 is deferred | DROP (R3) |
| `completionsSeries{range,timeZone,total,buckets[{startsAt,endsAt,count}]}` | — | `bucketCompletionsForForm` (T3.1) | ADD (epic "bucketed time series"). Labels are formatted by the client |
| `started` | int | derivable: `COUNT(survey_attempts WHERE survey_id)` | DROP by default (Q6) |
| `abandoned` | int | derivable: `ABANDONED` + `IN_PROGRESS AND started_at < now − 30 min` (abandonment is lazy, Epic 5 DF7) | DROP by default (Q6) |
| `averageDurationSeconds` | number \| null | derivable: `AVG(submitted_at − started_at)` of COMPLETED attempts | DROP by default (Q6) |
| `pendingAttempts[]` | 48 h dispute rows | partial (`codeVerifiedAt` = attempt `submittedAt`, `reviewEndsAt` = +48 h); `dispute` needs Story 8.5 | DROP (R6, Q10) |
| `feedback{count,averageRating,issues[]}` | card | `SurveyFeedback` rows are all `PENDING`; Story 9.3 is deferred | DROP (R5, Q9) |

Errors: `400 VALIDATION_ERROR` (range, UUID), `401` (session guard), `404 FORM_NOT_FOUND` (unknown, not owner, or Admin).

#### 2. `GET /forms/:id/responses` (frontend today: `results-service.ts#formResponsesSchema`, MSW `forms-results.ts`)

Top level: `availability: 'AVAILABLE' | 'NOT_APPLICABLE'` (ADD).

| Field | Frontend today | Backend source | Verdict |
|---|---|---|---|
| `form.id`, `form.title` | ✓ | `Form` | KEEP |
| `form.type` | INTERNAL \| EXTERNAL | `Form.type` (a literal per branch) | KEEP |
| `form.versionId` | — | selected `FormVersion.id` | ADD |
| `form.versionNumber` | ✓ | selected `FormVersion.versionNumber` | KEEP (AVAILABLE only) |
| `form.estimatedEffortSeconds` | ✓ | `schemaJson.metadata.expectedEffortSeconds` | DROP (only export/quality read it; both hidden) |
| `form.externalUrl` | ✓ | `FormVersion.externalUrl` | KEEP in the NOT_APPLICABLE branch only |
| `reason` | — | `'EXTERNAL_FORM'` | ADD (NOT_APPLICABLE) |
| `questions[].id/number/title/type/required` | ✓ | version `schemaJson.blocks` sorted by `order`; `number` = index + 1 | KEEP |
| `questions[].shortLabel` | string \| null | none (mock-only map) | DROP (R11) |
| `questions[].options[{value,label}]` | ✓ | choice blocks `options` | KEEP |
| `questions[].allowOther` | ✓ | choice blocks `allowOther` | KEEP |
| `questions[].scale` | ✓ | `linear_scale {min,max,minLabel??null,maxLabel??null}`; `rating {1,maxRating,null,null}`; else `null` | KEEP |
| `responses[].id` | ✓ | `Response.id` | KEEP |
| `responses[].code` | "#47AD" | `responseDisplayCode(Response.id)` (6 hex characters) | KEEP (derived pseudonym, Q2) |
| `responses[].formVersionId` | — | `Response.formVersionId` | ADD (epic AC) |
| `responses[].submittedAt` | ✓ | `Response.submittedAt` (ISO) | KEEP |
| `responses[].durationSeconds` | int | `Response.submittedAt − SurveyAttempt.startedAt`; `null` when `attemptId` is null (guest, Story 4.4 gated) | KEEP, now **nullable** |
| `responses[].quality`, `reviewReasons` | PASSED/NEEDS_REVIEW | none: Epic 10 deferred | DROP (R8) |
| `responses[].integrity` | — | constant `{ applicability: 'NOT_ASSESSED' }` (spine "Integrity Applicability") | ADD |
| `responses[].answers` | record | `Response.answersJson`, projected (see Privacy rules) | KEEP |
| `responses[].codeVerified` | bool \| null | External rows are not listed | DROP (R10) |
| `totalCount` | — | `COUNT` of listed rows for the version (index-backed) | ADD (for "7 / 20" and totals) |
| `nextCursor` | — | keyset `(submittedAt,id)` of the last row when `limit + 1` rows exist, else `null` | ADD |

Errors: 400 `VALIDATION_ERROR` / `INVALID_CURSOR`, 401, 404 `FORM_NOT_FOUND` / `FORM_VERSION_NOT_FOUND`.

#### 3. `GET /forms/:id/analytics` (Q1; frontend today: `results-analytics-service.ts#formAnalyticsSchema`, MSW `forms-analytics.ts`, aggregator `mocks/data/form-analytics.ts`)

| Field | Backend source | Verdict |
|---|---|---|
| `availability` / `reason` | as in responses | ADD |
| `form{id,title,type,versionNumber}` + `versionId` | as in responses | KEEP / ADD |
| `totalResponses` | `countListed(versionId)` | KEEP |
| `startedCount` | derivable: `COUNT(survey_attempts WHERE form_version_id)` | DROP by default (Q6); the completion-rate tile hides |
| `averageDurationSeconds` | derivable (join) | DROP by default (Q6) |
| `lastResponseAt` | `MAX(submitted_at)`: the first row of the feed index | KEEP |
| `questions[]{questionId,number,title,type,required,answeredCount,skippedCount,summary}` | shared aggregator over `answersJson` | KEEP (all five `summary.kind`s; the `file` kind is count-only) |
| `summary.text.samples[{responseId,value,submittedAt}]` | newest 5 non-empty | KEEP (`responseId` is already public in responses) |
| `summary.choice.other.samples` | ≤ 5 distinct free "Khác" texts | KEEP (owner's own data) |

Aggregation rules, ported unchanged from `mocks/data/form-analytics.ts`:
- Empty answers (null, missing, `""`, `[]`) are skipped.
- A rating or linear-scale answer counts only as an integer within [min, max]. A number answer counts only as a finite JS number; no coercion.
- `percentage = round(count/answered × 1000)/10`. The multiple-choice denominator is the number of respondents who answered, so the shares may exceed 100%.
- A choice answer matches an option by `value` **or** `label`.
- Number buckets use ≤ 8 bins of 1·2·5×10ⁿ width.
- Text samples are the newest 5.
- `date` answers are treated as text.

#### 4. `GET /forms/:id/versions/:versionId` (Q3; frontend today: `results-service.ts#formVersionDetailSchema`)

| Field | Backend source | Verdict |
|---|---|---|
| `id, formId, versionNumber, isPublished, publishedAt, createdAt` | `FormVersion` columns | KEEP |
| `externalUrl` | `FormVersion.externalUrl` | ADD (nullable) |
| `schemaJson{blocks[...]}` (passthrough) | `FormVersion.schemaJson` | KEEP. Owner-authored; `attentionCheck.expectedValue` is the owner's own config |
| `updatedAt`, `submittedForReviewAt`, `collectedFrom`, `collectedUntil`, `responseCount`, `questionCount`, `qualityStatus` | no columns (optional ASSUMED extensions) | absent. They stay `optional()` in the list schema; the UI shows "—" / falls back to `createdAt` |
| `completionCode`, `targetingJson` | exist | never returned |

`GET /forms/:id/versions` (VERIFIED, `FormsService.listVersions`, 403 for non-owner, Admin allowed) is **not changed** by this story.

### Privacy rules (AD-18, AD-21, FR-40 consequences)

1. **Row authorization.** The caller must be `Form.publisherId`. Everyone else, Admins included, gets `404 FORM_NOT_FOUND` (no existence leak, 9.2/9.6 precedent). A version must belong to the form.
2. **Explicit projection only.** Build DTOs field by field. Never spread Prisma rows or entities. Response schemas are `.strict()`, and a unit test feeds a row with extra keys to prove they are rejected.
3. **Never returned:** `respondentId`, `attemptId`, `ipAddress`, `isGuest`, `clientContext`, failed-code counters, integrity events/assessments/reason codes, `SurveyFeedback` (rating/comment/tags), demographics, name/email/avatar, StoredObject `objectId`/key/bucket/checksum/status, `completionCode`, `targetingJson`.
4. **Respondent identity (default, Q2).** A per-response pseudonymous `code` derived from the response id, so it cannot be linked across forms. There is no per-respondent handle. The existing "Ẩn danh" tag stays.
5. **Answers.** Only keys that are block ids of the pinned version are returned; stale or unknown keys are dropped.
   - Strings, finite numbers and string arrays pass through.
   - `file_upload` arrays of `{ fileName, … }` → `string[]` of `fileName` (Q11). Downloads are out of scope (AD-22 needs signed, row-authorized access).
   - Booleans → `String(value)`.
   - Anything else → omitted.
6. **Rendering.** React renders every answer as text. No `dangerouslySetInnerHTML`, no Markdown.
7. **Integrity.** Always `NOT_ASSESSED` in Phase 1. No score, confidence or reason codes (Epic 10 deferred; the FR-40 "safe integrity metadata" list returns with Epic 10).
8. **Transport and logging.** Set `Cache-Control: private, no-store` on progress, responses, analytics and version detail. Never log answers, codes or cursors at info level. Error `details` never echo answer content.
9. **Export stays impossible** (OQ-6/OQ-11): no CSV/XLSX route, UI entry hidden.

### Performance and query design

- **Progress (≈ 8–10 queries, all bounded).**
  - `findById` (form + versions).
  - `listRewardableCompletions` (3 grouped reads).
  - Ledger position: `publish:` keys by id, the `reopen-escrow:`/`close-refund:` prefix reads, payout keys by id, and the escrow account. These are existing reads used by `GET /forms/:id`.
  - One bucket query (a `UNION ALL` of two `GROUP BY date_trunc(...)` subqueries over `responses_form_completed_submitted_idx` and `survey_attempts_survey_id_status_submitted_at_idx`, both limited to `[from, to)`), returning ≤ 24 rows.
  - The `hour` range groups by `date_trunc('hour', …, tz)` and folds to 3 h buckets in Node.
  - The `week` range uses `date_trunc('week', …, tz)` (ISO Monday). Postgres ≥ 12 supports the 3-argument `date_trunc(field, timestamptz, zone)`. Local Docker runs `postgres:15-alpine`; Cloud SQL must be ≥ 12.
  - Known risk: `findJournalsByIdempotencyKeyPrefix` uses `LIKE 'prefix%'`, which the default-collation unique index may not serve. This is existing behaviour; measure it. If it dominates, note it for a follow-up (`text_pattern_ops` index). Do not fix it silently here.
- **Responses.** Version resolution is one `groupBy formVersionId` on the partial form index (≤ number of versions). Then `COUNT(*)` and the page query `WHERE form_version_id = $v AND status IN (...) [AND (submitted_at, id) < ($ts,$id)] ORDER BY submitted_at DESC, id DESC LIMIT $limit+1` on `responses_version_completed_feed_idx`. `startedAt` comes from the unique `attempt_id` join. Two queries per page, O(limit).
- **Analytics.** The count comes first, with a cap (5 000 by default; product can tune it). Then keyset batches of 500 on the same index, selecting only `id, submitted_at, answers_json`, and aggregating incrementally.
  - The ported aggregator takes all rows at once. Either feed it the concatenated batches (memory is bounded by the cap: ≤ 5 000 × answer size), or refactor it into an accumulator. The first is acceptable at the cap. Record the timing.
  - A SQL `jsonb` aggregation or a per-version projection is the documented follow-up if pilot volumes exceed the cap (readiness report: "no read-model decision for publisher analytics").
- **Version detail.** `findAllVersions` then filter by id (≤ tens of rows), or add `findVersion(formId, versionId)`.
- **Frontend.** `collectFormResponses` fetches pages **sequentially** (each needs `nextCursor`): at most 20 requests of 100 rows. The Summary tab never loads responses; Theo câu hỏi loads them only for a free-text question (the existing `ResponsesProvider.needed` logic is kept).

### Current state of files being modified (read fully before editing)

**Backend**
- `apps/backend/src/modules/forms/presentation/forms.controller.ts`:
  - `@Controller(['forms','api/forms'])` + `SessionAuthGuard`.
  - Existing GETs: `''` (list), `:id`, `:id/pricing-quote`, `:id/in-progress-attempts`, `:id/versions`. POSTs: `:id/status` (**Admin-only in the service**), `:id/close`, `:id/reopen`, `:id/versions`, `:id/publish`, `:id/rotate-code`, `external`.
  - Add `:id/progress` and (Q3) `:id/versions/:versionId`. Preserve every existing route.
- `apps/backend/src/modules/forms/application/forms.service.ts` (1 455 lines):
  - `getFormById` (owner or ADMIN, else 403) → `toManagedDetailDto` computes `completedCompletions` + `escrowLocked`.
  - `listVersions` (owner/ADMIN, ascending).
  - `transitionStatus` rejects non-Admins first.
  - Constructor is positional: `(formRepository, completionCodePort?, escrowCoordinator?, unitOfWork = PassThrough)`. Append `clock` last so existing `new FormsService(...)` calls in specs keep compiling.
- `apps/backend/src/modules/forms/application/forms-escrow.coordinator.ts`:
  - `loadEscrowState` (private) → `toEscrowState` computes `remaining = reserved − refunded − consumed − unsettled×draw`.
  - `getFundingPosition` returns `{required, held, shortfall}` only. The new method must reuse the same state so `held` stays identical to `escrowLocked`.
- `apps/backend/src/modules/forms/application/ports/form-repository.port.ts` + `infrastructure/prisma-form.repository.ts`/`in-memory-form.repository.ts`:
  - `listRewardableCompletions` already reads Participation tables through `common/database/completion-counts.ts` (and `countInProgressAttempts` reads `surveyAttempt` directly). `completion-counts.ts` is the sanctioned shared completion-definition seam, so the bucket helper goes there, not into ad-hoc Prisma calls.
- `apps/backend/src/common/database/completion-counts.ts`:
  - `COMPLETED_RESPONSE_STATUSES = ['SUBMITTED','VALIDATED']`.
  - `countCompletionsByFormIds`, `listCompletionRefsForForm`, `listCompletionRefsByFormIds`.
  - Add `bucketCompletionsForForm`. Do not change the existing functions (the Marketplace feed and escrow depend on them).
- `apps/backend/src/modules/participation/participation.module.ts`: imports `FormsModule` (so `FORM_REPOSITORY_PORT` is injectable). Exports `ParticipationService`, `PARTICIPATION_REPOSITORY_PORT`, `SurveyFeedbackService`, `SURVEY_FEEDBACK_REPOSITORY_PORT`. Add the new controller and providers; keep existing wiring.
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts`:
  - Internal submit sets `Response.status='VALIDATED'`, `answersJson=normalizedAnswers` (a record keyed by block id; file answers are arrays of `{objectId,fileName,fileSize,mimeType,status}` via `withStoredFileMetadata`), `submittedAt`, and sets `SurveyAttempt.status='COMPLETED'`, `submittedAt`.
  - Guest public submissions (marketplace repo) create `status='SUBMITTED', isGuest=true, attemptId=null`.
  - External completions set the attempt `COMPLETED` + `submittedAt` and create no Response.
- `apps/backend/src/common/http/http-exception.filter.ts`: one long `instanceof` chain (403 group includes `FormForbiddenException`; 404 group includes `FormNotFoundException`).
- `apps/backend/prisma/schema.prisma`:
  - `Response` has **no index** on `form_id`/`form_version_id`.
  - `SurveyAttempt` has indexes only on `(respondent_id, status, submitted_at)` and `(respondent_id, form_version_id)`, plus the partial unique ones from migrations.

**Frontend** (paths under `apps/frontend/my-app/`)
- `lib/forms/manage-service.ts`: VERIFIED list/detail/close/reopen/delete/versions; ASSUMED progress, pause, dispute. `PAUSE_SUPPORTED = false` is guarded by `tests/forms-manage.test.mjs:295`.
- `lib/forms/results-service.ts`: ASSUMED responses/quality/version detail; VERIFIED versions list with optional stats.
- `lib/forms/results-analytics-service.ts` / `results-analytics.ts`: the analytics schema and view rules (Recharts cards in `components/analytics/*`, unchanged).
- `lib/api/client.ts#apiRequest` parses only envelope `data`, and throws `ApiError{status,code}` on non-2xx. This is why `nextCursor` goes in `data`.
- `app/(signed-in)/(app)/forms/[id]/components/FormWorkspace.tsx` loads `GET /forms/:id` once (`useFormHeader`); tabs render under it.
- `responses/layout.tsx` nests `AnalyticsProvider` > `ResponsesProvider` > `ResponsesSubnav`. Keep the `?v=` version param and the `needed` gating.
- MSW:
  - `mocks/handlers/forms-results.ts#ownedForm` allows ADMIN (change to owner-only for the new routes); `pickVersion` is the version rule to mirror.
  - `mocks/handlers/forms-manage.ts` progress builds from `mocks/data/forms-manage.ts` tracking (`WEEK_LABELS`, `HOUR_LABELS`, `MONTH_LABELS`).
  - `mocks/db/store.ts` `SCHEMA_VERSION = 4` (3 = analytics seed, 4 = empty analytics survey is also a respondent survey).

**What must be preserved:**
- Close, reopen, withdraw, delete and create-version flows and their header refresh (`applyForm`, `revision`).
- `GET /forms/:id` semantics (403/Admin).
- The versions list.
- The Recharts analytics cards and their skeleton.
- Client search, column picker and mobile "Xem thêm".
- Session-loss redirects (`useSessionLossRedirect`).

### Architecture guardrails

- **AD-2.** One Zod contract per endpoint, in `packages/schemas`, imported by both sides. There are no hand-maintained duplicate types.
- **AD-7 / `test/architecture.spec.ts`.** Nothing under `modules/*/domain|application` imports `@nestjs/*`, `@prisma/client`, express, or anything named "adapter". Node `crypto` is allowed (it is already used in `forms.service.ts`). Wire everything via `useFactory`.
- **AD-16.**
  - Research (`forms`) owns progress and version detail. Participation owns Response/Attempt reads (responses, analytics) behind its own port.
  - The only shared read seam is `common/database/completion-counts.ts`, and all reads are read-only.
  - No writes anywhere in this story.
  - Migrations for `responses`/`survey_attempts` indexes are Participation-owned; name the owner in the migration header comment.
- **AD-18.** Audience-specific versioned projection (the `v1` schema) and row authorization per owned FormVersion.
- **AD-19.** Responses are pinned to their version and never mixed.
- **Spine conventions.**
  - `{data,error,meta}` via `createSuccessEnvelope`.
  - Stable codes.
  - Cursor pagination (this story complies; the marketplace/moderation offset deviations are unrelated).
  - UUID ids.
  - UTC ISO dates.

### Previous story intelligence

- **2.6 / 2.7 (publish, versioning).** `currentVersion` is the highest `versionNumber`, even when it is a draft. `listVersions` returns ascending summaries without `schemaJson` ("list performance"). Version creation is atomic and published versions are immutable, so a version's `schemaJson` is a safe basis for the question projection.
- **5.4 (internal submission).** Answers are validated against the pinned version and stored as a normalized record. `Response` moves `IN_PROGRESS → VALIDATED` at submit. The `IN_PROGRESS` Response created at attempt start (AD-19) must be filtered out of every read.
- **9.2 (feedback).**
  - Owner-or-404 with no existence leak.
  - DTOs never contain `respondentId`.
  - E2E specs boot `AppModule` with a mocked `PrismaService` plus in-memory repositories, so **every new port needs an in-memory adapter and an e2e override**.
  - Postgres aborts a transaction on a unique violation (not relevant here: read-only).
  - Feedback rows stay `PENDING` with no Publisher read, which confirms R5.
- **9.6 / 6.x.** The Prisma e2e specs (`*.prisma.e2e-spec.ts`) probe the database and skip when none is available; follow that pattern for the SQL tests.
- **deferred-work.md.** Epic 6 DF6 (no deadline field → R2), Epic 5 DF7 (abandonment is lazy → the Q6 derivation note), E4-DN1/Epic 8 DF3 (cursor deviations elsewhere; do not copy the offset style).

### Git intelligence

- `0628d8e`: the survey monitoring dashboard plus the Summary/Questions/Individual responses UI, Recharts cards, and the `results-analytics-service.ts` ASSUMED contract.
- `d1175eb`: analytics refinements, `mocks/data/form-analytics.ts` hardening (invalid numeric skip, nice-width bins), `SCHEMA_VERSION` 4, `tests/forms-analytics.test.mjs` (+104 lines, the reference cases for the shared aggregator spec).
- `987d359`: integration planning and the Epic IR additions (source of this story).

No backend commits touched forms or participation since the Phase 5 M-series; the backend baseline is clean for this area.

### Library and framework requirements

- No new dependencies.
- **Backend.** NestJS 10.4, Prisma 6.0.0 (pinned; partial indexes need raw SQL), Zod 3.x via `@rescom/schemas`.
- **Frontend.** Next 16.3 / React 19.2, Recharts 3.10 (already used by `components/analytics/*`; not touched functionally), MSW 2.15, zod 3.25.
- **Tests.** Frontend tests run with `node --test` and Node type stripping: use explicit `.ts` import specifiers and `import type`, and no enums or parameter properties in TS imported by tests. Schemas and backend use Jest (`ts-jest`).

### Test plan

**`packages/schemas` (Jest)**
- `publisher-results.schema.spec.ts`:
  - Every golden fixture parses.
  - Strict rejection of `respondentId`/`attemptId`/`quality`.
  - `range` default is `day` and an invalid value is rejected.
  - `limit` bounds are enforced.
  - The `availability` discriminator works.
  - `durationSeconds` accepts `null`.
  - The integrity literal is enforced.
- Cursor helpers: round-trip; garbage, wrong `v` and non-ISO values are rejected.
- `form-analytics.aggregate.spec.ts` (Q1): port every case of `tests/forms-analytics.test.mjs`, including the invalid numeric skip, value-or-label matching, "Khác" samples ≤ 5 distinct, multiple-choice > 100%, nice-width bins including negatives and decimals, and text samples newest-5.

**Backend unit (Jest)**
- `progress-window.spec.ts`:
  - Each range's bucket starts at `now` = 2026-09-30T16:59:59Z and 17:00:00Z. That instant is local midnight in UTC+7, so the day, week and month boundaries flip there.
  - Month rollover (Dec→Jan). ISO week containing a month boundary.
- `forms.service.spec.ts` (add a `getProgress` block):
  - Owner 200 shape.
  - Non-owner → `FormNotFoundException`; Admin → `FormNotFoundException`.
  - Free survey zeros. DRAFT zeros.
  - The spent/remaining ledger invariant, using `InMemoryLedgerRepository` publish, payout and refund journals.
  - Zero-filled buckets.
- `forms-escrow.coordinator.spec.ts`: `getProgressEscrow` matches `getFundingPosition().held`; `spent` excludes reversed journals.
- `publisher-results.service.spec.ts`:
  - The version rule (newest with rows, then newest published, then newest; explicit `versionNumber`; unknown → 404).
  - EXTERNAL → NOT_APPLICABLE.
  - Pagination: 120 rows walked with limit 50 gives 50 + 50 + 20 with `nextCursor` null at the end and no duplicates or gaps, including equal `submittedAt` ties broken by `id`.
  - A cursor from v1 used on v2 → `InvalidResultsCursorException`.
  - Mixed versions: v1 rows are never listed for v2.
  - Status filter: `IN_PROGRESS`/`DISPUTED`/`REJECTED` are excluded.
  - Projection: unknown answer keys dropped, file answers → names, guest `durationSeconds` null, the `code` is deterministic and 6 hex characters.
  - (Q1) Analytics cap → 422; aggregates equal the shared aggregator output.
- `publisher-results.controller.spec.ts` / `forms.controller.spec.ts`: the envelope, and `publisher*Schema.parse(body.data)`.
- `http-exception.filter.spec.ts`: the three new mappings (404/400/422).

**Backend e2e (in-memory; new `test/publisher-results.e2e-spec.ts`, overrides copied from `forms-versioning.e2e-spec.ts` + `survey-feedback.e2e-spec.ts`)**
- For each of progress, responses, (Q1) analytics and (Q3) version detail:
  - Owner 200. Every body parses with the shared schema and the golden-fixture shape: this is the backend half of the contract test.
  - Non-owner 404. Admin 404. Unauthenticated 401.
  - Invalid UUID 400. Invalid `range`/`limit`/`cursor` → 400.
- Responses: empty form (`totalCount: 0`, `responses: []`, `nextCursor: null`), a paginated walk, and a mixed-version form (v1 and v2 lists are disjoint).
- External form → `NOT_APPLICABLE`.
- `GET /forms/:id` still returns 403 for a non-owner (regression guard for R9).

**Backend Prisma e2e (`test/publisher-results.prisma.e2e-spec.ts`, skipped without a database)**
- The migration applies. `bucketCompletionsForForm` counts Responses plus External attempts at local-midnight boundaries.
- A keyset page against real rows gives the same results as the in-memory run.
- `EXPLAIN` of the page query mentions `responses_version_completed_feed_idx` (informational assertion; `SET enable_seqscan = off` inside the test transaction if needed).
- Seed 2 000 and 5 000 responses: log the progress, page and analytics timings. This is evidence, not a CI gate (OQ-22).

**Frontend (`node --test`)**
- `tests/forms-manage.test.mjs`: the shared progress schema, `seriesBucketLabel` for all ranges across the VN midnight, `seriesSummary` peak, `PAUSE_SUPPORTED === false`, and no `setPublisherFormPaused` export.
- `tests/forms-results.test.mjs`:
  - Fixtures migrated to the new row shape.
  - `collectFormResponses`, with a stubbed page fetcher: follows cursors, de-duplicates, stops at `RESPONSES_MAX_PAGES` with `truncated: true`, and passes `NOT_APPLICABLE` through.
  - Search-only `filterResponses`.
  - `responsePosition` over the collected list.
  - Duration formatting for `null`.
- `tests/forms-analytics.test.mjs` (Q1): import the aggregator from `@rescom/schemas`; `headerMetrics` without started/avg.
- New `tests/publisher-results-contract.test.mjs`:
  - The golden fixtures parse through the service schemas (the frontend half of the contract test).
  - The flags in `results-scope.ts` have their pilot values.
  - The hidden pages call `notFound()`. Import the page modules, or grep the source if RSC imports are not loadable under node.
- `npm run typecheck`, `npm run lint`, `npm run build` in `apps/frontend/my-app`.

**Manual real-stack smoke (T11.2):** mocking disabled, local backend. Create an Internal survey, submit 3 responses across 2 versions, and check progress, responses v1/v2 and pagination (use `limit` via devtools). A second publisher gets "Không tìm thấy khảo sát này". An External survey shows the not-applicable note. Keep screenshots and HAR as IR.4 evidence input.

### Project structure notes

- New backend files follow the per-module layout already used by 9.2: `participation/application/{publisher-results.service.ts, ports/publisher-response-read.port.ts}`, `participation/infrastructure/{prisma,in-memory}-publisher-response-read.repository.ts`, `participation/presentation/publisher-results.controller.ts`, `forms/application/progress-window.ts`.
- New shared files: `packages/schemas/src/forms/{publisher-results.schema.ts, form-analytics.aggregate.ts, __fixtures__/publisher-results/*.json}`. If `tsc` in `packages/schemas` complains about JSON fixtures, load them in specs with `fs` rather than `import`.
- Frontend: new `lib/forms/results-scope.ts` and `lib/forms/dispute-service.ts`; everything else is edits.
- **Variance to note.** Routes under the `forms/` URL prefix are now served by two modules (`FormsController`, `PublisherResultsController`). This matches the existing split, where `ParticipationController` serves `forms/:id/attempts` and `forms/:id/submissions`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story IR.4a: Publisher Progress and Response Viewing] and #Epic IR (scope guard, dependencies: IR.4 requires IR.4a)
- [Source: prd.md#FR-39 Progress Tracking, #FR-40 Response Data (Internal Forms Only), #FR-41 Traffic Analytics, #FR-42 amendment E9-D1, §8 OQ-6/OQ-8/OQ-11/OQ-22; NFR-1, NFR-30]
- [Source: ARCHITECTURE-SPINE.md#AD-16, #AD-18, #AD-19, #AD-21, #Module and Durable-State Ownership Map, #Consistency Conventions ("list APIs use cursor pagination"; "Integrity Applicability")]
- [Source: implementation-readiness-report-2026-09-30.md lines 355–382, 418–435, 466, 547 (FR-39/FR-40 gaps, pause mapping, no read model)]
- [Source: integration-deployment-plan.md gap register API-14 `GET /forms/:id/responses`, API-15 `GET /forms/:id/analytics`]
- [Source: sprint-status.yaml#phase_2_deferred (9-1, 9-3, 8-5, 4-4, epic-10)]
- [Source: deferred-work.md Epic 6 DF6, Epic 5 DF7, E4-DN1, Epic 8 DF3]
- [Source: apps/backend/src/modules/forms/application/forms.service.ts#transitionStatus (Admin-only), #getFormById, #listVersions, #toManagedDetailDto]
- [Source: apps/backend/src/modules/forms/application/forms-escrow.coordinator.ts#getFundingPosition, #toEscrowState; apps/backend/src/modules/economy/application/ledger.service.ts#FormEscrowPosition]
- [Source: packages/schemas/src/forms/form-publish.schema.ts#FORM_STATUS_TRANSITIONS; packages/schemas/src/forms/form-draft.schema.ts#formStatusEnum, FormVersionSummaryDto]
- [Source: apps/frontend/my-app/mocks/data/form-analytics.ts (reference aggregator); mocks/handlers/forms-results.ts#pickVersion, #questionsOf]

## Questions / Decisions for Owner

Each item has a **default** that the dev agent applies if IR.1 has not decided (AC0). Items 1–3 are the scope items the epic says IR.1 must approve.

1. **Analytics summary (`GET /forms/:id/analytics`, Tóm tắt / Theo câu hỏi) in pilot?** *Default: approved.* The UI is fully built, and the data is the owner's own responses aggregated per version, which is not FR-41 traffic analytics. It is bounded by a 5 000-response cap (422 above). If rejected: skip T1.3/T4 analytics/T7.3/T8.4/T9.3 and apply AC4.2 (entry hidden, redirect to Individual).
2. **Respondent identity visible to Publishers?** *Default: none.* Show only a per-response pseudonymous 6-hex `code`, not linkable across forms; no name, email, demographics or respondent id (AD-18/AD-21; the privacy register is not yet approved). Alternatives (per-respondent stable pseudonym, or real identity with consent) need Privacy/Legal sign-off.
3. **Version detail (`GET /forms/:id/versions/:versionId`) in pilot?** *Default: approved for the read-only "Xem (chỉ đọc)" view only.* The version diff stays hidden (epic, OQ-8). If rejected: no route, and the link and page are hidden.
4. **Admin read access to a publisher's progress, responses and analytics?** *Default: none (404).* There is no admin-read audit sink today. Granting it needs a Moderation-owned audited read (who, when, which form), which is a separate story. Note the inconsistency this leaves: `GET /forms/:id` and `/versions` still allow Admin (403 for other users).
5. **What does the progress time series count?** *Default: completions per bucket.* "Lượt mở" (opens/views) has no data source and is FR-41 / Story 9.1 (deferred). The alternative is attempt starts (derivable), which is still funnel analytics.
6. **FR-41 basic funnel metrics (`started`, `abandoned`/drop-off, average completion time, completion-rate tile)?** *Default: dropped* (Story 9.1 deferred; epic scope guard). The derivations are in the contract tables if IR.1 approves them. Note that abandonment is lazy until IR.2b's reservation-expiry job.
7. **Pause / resume.** Not implementable as specified: `/forms/:id/status` is Admin-only and there is no PAUSED status or transition. *Default: stays hidden (`PAUSE_SUPPORTED=false`) and the dead client and mock code are removed.* If wanted for the pilot, open a lifecycle story: a new state or flag, an owner command, and marketplace/start guards.
8. **Survey deadline.** `Form` has no deadline column (FR-39 "deadline countdown", FR-37 "nearest deadline", IR.2b "deadline passed → refund" all assume one). *Default: `deadlineAt: null`, UI shows "Không đặt hạn".* A data-model story is needed before IR.2b's escrow-refund job can work.
9. **Feedback card on progress (Story 9.3).** *Default: hidden.* Feedback is unvalidated (`PENDING`), and the minimum-aggregation launch gate applies.
10. **"Lượt đang chờ 48 giờ" card + complaints (Publisher dispute, Story 8.5).** *Default: hidden.* There is no Publisher dispute route; manual Admin moderation stays the Phase 1 path.
11. **File-upload answers in the response view.** *Default: file names only, no download.* Alternatives: count only (most private), or a signed download (AD-22, a separate story).
12. **Which response statuses are shown?** *Default: `SUBMITTED` + `VALIDATED`,* consistent with the completion count. `DISPUTED`/`REJECTED` responses are excluded. Should rejected responses be visible and flagged instead?
13. **Caps.** Responses load at most 2 000 rows in the browser (20 × 100, with a truncation note); analytics refuses above 5 000 responses per version. Confirm these fit the pilot sample sizes. `MAX_EXPECTED_COMPLETIONS` is 100 000, so a server-side projection or search is the follow-up if they do not. NFR-1's formal profile is still OQ-22.
14. **Integrity display.** *Default: a neutral "Chưa đánh giá chất lượng" tag (`NOT_ASSESSED`)* in the response detail only. Or show nothing at all?
15. **Version list stats.** `responseCount` / `questionCount` per version are absent from the real `GET /forms/:id/versions`, so the UI shows "—". Add them (cheap, grouped count) in this story or leave them for later? *Default: leave (not in the AC).*
16. **Guest responses (Story 4.4 gated).** If the public route is ever enabled, guest rows are listed with `durationSeconds: null` and the same pseudonymous code. Confirm, or exclude guests?

## Dev Agent Record

### Agent Model Used

_(to be filled by dev-story)_

### Debug Log References

### Completion Notes List

- Story context created 2026-09-30 by an unattended create-story run. The ultimate context engine analysis completed, and a comprehensive developer guide was created. `epics.md` and `sprint-status.yaml` were intentionally not edited (caller constraint); sprint status still lists `ir-4a-publisher-progress-response-viewing: backlog`, so update it through the normal flow.
- Several epic assumptions were corrected against code (R1–R12). Pause (R1) and deadline (R2) cannot be delivered as the epic worded them without new lifecycle and data-model work.

- **2026-10-01, implemented outside the story flow:** built in commit `3e9c69e` as mock-off Phase 3 of `.omc/plans/mock-off-full-backend.md`, not through bmad-dev-story. Task boxes are left unticked on purpose; this entry is the record. Reconciled by `sprint-change-proposal-2026-10-01.md`. Status → `review`.
- Evidence: full verify 2026-10-01 (schemas 615, backend unit 2224, e2e 431 incl. Postgres suites, FE 744, typecheck and lint clean); real-stack smoke and gate G journeys passed. Read-only AC audit 2026-10-01 (targeted unit suites re-run green).
- AC audit: AC1–AC4, AC6, AC9 MET; AC5 MET (version detail built, Q3); AC8 and AC10 partly verified.
- **Deliberate overrides (owner decision 2026-10-01, internal testing only; see the Epic IR note in `epics.md`):** AC0/AC7: no screen is hidden. Export stays open with real `/responses` data; Survey Quality and complaints stay reachable and are mock-served in hybrid mode. AC5.2: version diff stays visible (computed client-side from real version details). Only the feedback summary is hidden. IR.1 must re-gate these for the pilot.
- Open questions as the code resolved them: Q1 analytics BUILT · Q3 version detail BUILT · Q2 respondent identity is an HMAC pseudonym per response · Q4 Admin gets 404 · Q5, Q8, Q11–Q13 story defaults (caps 2000 / 5000).
- Open before `done`: confirm the AC8 frontend cut-over (quality filter / `QualityTag` / `REVIEW_DISCLAIMER` removed, MSW owner-only 404).

### File List

Key files are listed in the AC audit; the complete list is `git show --stat 3e9c69e`.

