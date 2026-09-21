---
baseline_commit: a40a63c202dfab9d3bac0b818eb5287211e1070d
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/addendum.md"
  - "apps/backend/prisma/schema.prisma"
  - "packages/schemas/src/forms/form-blocks.schema.ts"
  - "packages/schemas/src/forms/form-definition.schema.ts"
  - "packages/schemas/src/participation/survey-attempt.schema.ts"
---

# Story 5.2: Internal Form Rendering & Execution

Status: review

## Story


As a Respondent,
I want a smooth survey answering experience,
So that I can easily navigate questions even with unstable internet.

## Acceptance Criteria

### AC1 — Behavioral Telemetry Event Schemas & Contracts (`packages/schemas`)
**Given** the shared schemas package
**When** defining behavioral telemetry event contracts (FR-58)
**Then**:
1. `integrityEventTypeEnum` defines allowed non-invasive event types matching Prisma `IntegrityEventType`:
   `SURVEY_ATTEMPT_STARTED`, `SURVEY_ATTEMPT_RESUMED`, `SURVEY_ATTEMPT_ABANDONED`, `SURVEY_SUBMITTED`,
   `QUESTION_SHOWN`, `QUESTION_FOCUSED`, `QUESTION_BLURRED`, `ANSWER_SELECTED`, `ANSWER_ENTERED`,
   `ANSWER_CHANGED`, `ANSWER_CLEARED`, `QUESTION_SKIPPED`, `QUESTION_RETURNED`, `PAGE_HIDDEN`,
   `PAGE_VISIBLE`, `ATTENTION_CHECK_PASSED`, `ATTENTION_CHECK_FAILED`, `TIME_BARRIER_TRIGGERED`.
2. Raw keystrokes, clipboard content, cross-site trackers, and background device inspection are strictly prohibited.
3. `telemetryEventItemSchema` validates:
   - `clientEventId`: string UUID
   - `eventType`: `IntegrityEventType`
   - `attemptId`: string UUID
   - `formVersionId`: string UUID
   - `responseId`: string UUID optional / nullable
   - `questionId`: string optional
   - `sequence`: number optional (int >= 0)
   - `occurredAt`: ISO date string
   - `metadata`: record of unknown optional (validated strictly for privacy: max 2KB, no disallowed keys)
4. `batchTelemetryEventsInputSchema` validates:
   - `events`: array of `telemetryEventItemSchema` (min 1, max 100)
   - `consentNoticeVersion`: string optional
5. TypeScript types (`IntegrityEventType`, `TelemetryEventItem`, `BatchTelemetryEventsInput`) are exported from `@rescom/schemas`.

### AC2 — Backend Behavioral Telemetry Ingestion & Idempotent Persistence (`apps/backend`)
**Given** an authenticated or authorized client submitting telemetry events
**When** calling `POST /api/responses/:responseId/integrity-events` or `POST /api/forms/:id/attempts/:attemptId/integrity-events`
**Then**:
1. Telemetry controller validates batch payload via `batchTelemetryEventsInputSchema`.
2. Validates that the referenced attempt exists and matches the authenticated user (or is accessible if guest).
3. Persists events to `IntegrityEvent` table in Prisma with idempotent deduplication via `(attemptId, clientEventId)` unique constraint (`skipDuplicates: true` or idempotent upsert).
4. Returns HTTP 200 with count of ingested events and status.
5. Ingestion failures return informative error responses without impacting any survey attempt state.

### AC3 — Dynamic Internal Form Rendering & Execution (`apps/frontend/my-app`)
**Given** an `IN_PROGRESS` internal survey
**When** the respondent views and interacts with the form (FR-26)
**Then**:
1. Frontend dynamically renders all question types based on the shared Form Definition contract (text, textarea, number, single_choice, multiple_choice, rating, linear_scale, date, file_upload).
2. Displays real-time progress bar reflecting completion percentage and answered question counts.
3. Validates answers against question rules (required, min/max, number ranges) with inline feedback and auto-scroll to the first invalid input.
4. Allows clear/reset of answers and handles submission states (disabled while submitting, loading spinner).

### AC4 — Passive Telemetry Emission & Non-Blocking Guarantee (`apps/frontend/my-app`)
**Given** an answering respondent interacting with the form
**When** interactions occur (viewing questions, focusing/blurring inputs, changing answers, tab visibility changes)
**Then**:
1. Form renderer passively captures permitted behavioral telemetry events (`QUESTION_SHOWN`, `QUESTION_FOCUSED`, `QUESTION_BLURRED`, `ANSWER_SELECTED`, `ANSWER_CHANGED`, `ANSWER_CLEARED`, `PAGE_HIDDEN`, `PAGE_VISIBLE`).
2. Buffers telemetry events in memory and periodically flushes in batches via `POST /api/forms/:id/attempts/:attemptId/integrity-events` (or `navigator.sendBeacon`).
3. **Non-blocking guarantee:** Missing client telemetry, fetch failures, or network timeouts must NEVER block form submission, disrupt typing, or show blocking error modals to the respondent (FR-58).

### AC5 — Offline Caching, Warning & Automatic Reconnection (`apps/frontend/my-app`)
**Given** unstable internet or sudden network disconnection during survey answering (UX-ADD-3)
**When** the respondent is answering questions
**Then**:
1. UI automatically caches all entered answers locally (in `localStorage` keyed by `rescom_survey_draft_${attemptId}`).
2. On page load / refresh, automatically restores previously saved answers for this attempt and displays a subtle notification ("Restored saved progress").
3. Detects online/offline browser state (`navigator.onLine`, `window.addEventListener('online'/'offline')`):
   - When offline: displays a non-intrusive offline warning banner ("You are currently offline. Your responses are saved safely on your device and will be submitted once reconnected.").
   - When online restores: updates banner to "Back online!" and automatically resumes network operations.
4. Successfully submitting a survey clears the local draft cache.

### AC6 — Dedicated Respondent Survey Route & Marketplace Integration (`apps/frontend/my-app`)
**Given** the marketplace or direct survey link
**When** a respondent starts an internal survey
**Then**:
1. Dedicated execution route `/forms/[id]/respond` handles the active respondent experience (accepting `attemptId` and `responseId` query parameters).
2. Verifies attempt status, loads the published form schema, renders the form in respondent execution mode (with offline caching and telemetry enabled).
3. `MarketplaceCard.tsx` routes internal survey attempts to `/forms/${survey.id}/respond?attemptId=${attempt.attemptId}&responseId=${attempt.responseId || ""}`.

### AC7 — Comprehensive Test Coverage Across Workspaces
**Given** test suites across `packages/schemas`, `apps/backend`, and `apps/frontend/my-app`
**When** running unit, integration, and E2E tests
**Then**:
1. Unit tests in `packages/schemas` for behavioral telemetry event schemas, batch schema, and privacy-validation constraints.
2. Unit tests in `apps/backend` for `ParticipationTelemetryService` and `ParticipationController` integrity-events endpoints.
3. Integration/E2E test for telemetry ingestion in `apps/backend/test/survey-telemetry.e2e-spec.ts`.
4. Unit/component tests in `apps/frontend/my-app` for offline caching and telemetry collection hook/utility.
5. All workspace tests and builds pass with 100% success and zero regressions.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Telemetry Schemas & Contracts (`packages/schemas`)** (AC: 1)
  - [x] 1.1 Create `packages/schemas/src/participation/survey-telemetry.schema.ts` defining `integrityEventTypeEnum`, `telemetryEventItemSchema`, `batchTelemetryEventsInputSchema`, and DTO types.
  - [x] 1.2 Enforce privacy guardrails: prohibit keystrokes, clipboard content, and oversized metadata.
  - [x] 1.3 Export new schemas and types from `packages/schemas/src/participation/index.ts` and `packages/schemas/src/index.ts`.
  - [x] 1.4 Write unit tests in `packages/schemas/src/participation/survey-telemetry.schema.spec.ts`.

- [x] **Task 2: Backend Telemetry Ingestion API & Repository (`apps/backend`)** (AC: 2)
  - [x] 2.1 Update `ParticipationRepositoryPort` with `saveIntegrityEvents(events: IntegrityEventEntity[]): Promise<number>`.
  - [x] 2.2 Implement `saveIntegrityEvents` in `PrismaParticipationRepository` with idempotent deduplication via `(attemptId, clientEventId)`.
  - [x] 2.3 Implement `saveIntegrityEvents` in `InMemoryParticipationRepository`.
  - [x] 2.4 Add `recordTelemetryEvents` method in `ParticipationService`.
  - [x] 2.5 Add `POST /forms/:id/attempts/:attemptId/integrity-events` and `POST /responses/:responseId/integrity-events` in `ParticipationController`.
  - [x] 2.6 Author unit tests for telemetry service and controller.
  - [x] 2.7 Author integration/E2E test in `apps/backend/test/survey-telemetry.e2e-spec.ts`.

- [x] **Task 3: Frontend Offline Caching & Reconnect Utilities (`apps/frontend/my-app`)** (AC: 5)
  - [x] 3.1 Create `apps/frontend/my-app/app/forms/hooks/useSurveyOfflineCache.ts` managing `localStorage` draft saving, restoring, and online/offline detection.
  - [x] 3.2 Create `OfflineBanner.tsx` component providing accessible visual offline and reconnection feedback.
  - [x] 3.3 Add unit test for offline caching logic.

- [x] **Task 4: Frontend Passive Behavioral Telemetry Collector (`apps/frontend/my-app`)** (AC: 4)
  - [x] 4.1 Create `apps/frontend/my-app/app/forms/hooks/useSurveyTelemetry.ts` providing non-blocking buffered event collection, periodic batch dispatch, and unload flushing.
  - [x] 4.2 Verify non-blocking behavior: ensure network drops or telemetry rejections never throw or block UI rendering or submission.
  - [x] 4.3 Add unit test for telemetry collector buffering and dispatch.

- [x] **Task 5: FormRenderer Enhancements & Execution Page (`apps/frontend/my-app`)** (AC: 3, 6)
  - [x] 5.1 Integrate `useSurveyOfflineCache` and `useSurveyTelemetry` into `FormRenderer.tsx`.
  - [x] 5.2 Create dedicated respondent survey execution page `apps/frontend/my-app/app/forms/[id]/respond/page.tsx`.
  - [x] 5.3 Update `MarketplaceCard.tsx` to navigate internal survey attempts to `/forms/${survey.id}/respond`.
  - [x] 5.4 Ensure progress bar, section/question navigation, and error summaries operate smoothly.

- [x] **Task 6: Verification & Full Workspace Quality Assurance** (AC: 7)
  - [x] 6.1 Run all unit test suites (`packages/schemas`, `apps/backend`, `apps/frontend/my-app`).
  - [x] 6.2 Run backend E2E test suites (`npm run test:e2e --workspace backend`).
  - [x] 6.3 Run Next.js production build (`npm run build --prefix apps/frontend/my-app`).
  - [x] 6.4 Verify zero regressions and update status to review.

---

## Dev Notes

### Architecture Context (FR-26, FR-58, UX-ADD-3, AD-19)
- **FR-26 (In-Platform Survey Experience):**
  - Internal surveys must render within the RESCOM application using the Form Renderer driven by the published FormVersion's Form Definition JSON.
  - All question types from the Component Registry (`text`, `textarea`, `number`, `single_choice`, `multiple_choice`, `rating`, `linear_scale`, `date`, `file_upload`) are supported.
  - Live progress bar tracks answered questions vs. total questions.
- **FR-58 (Consent-Aware Behavioral Telemetry):**
  - Permitted event types: `QUESTION_SHOWN`, `QUESTION_FOCUSED`, `QUESTION_BLURRED`, `ANSWER_SELECTED`, `ANSWER_ENTERED`, `ANSWER_CHANGED`, `ANSWER_CLEARED`, `QUESTION_SKIPPED`, `QUESTION_RETURNED`, `PAGE_HIDDEN`, `PAGE_VISIBLE`, `ATTENTION_CHECK_PASSED`, `ATTENTION_CHECK_FAILED`, `TIME_BARRIER_TRIGGERED`.
  - Prohibited: raw keystrokes, clipboard content, cross-site trackers, unrelated background device activity.
  - Telemetry is non-invasive and privacy-preserving.
  - **Non-blocking guarantee:** Client telemetry is purely supportive evidence for research integrity. Telemetry network drops or failures must NEVER block the respondent from submitting their answers.
- **UX-ADD-3 (Offline Resiliency & Caching):**
  - Unstable university/mobile internet must not result in lost survey answers.
  - Local caching stores user answers in `localStorage` under key `rescom_survey_draft_${attemptId}`.
  - Browser online/offline events display an amber warning badge when offline and automatically sync status when connection returns.
  - Submitting successfully purges the local draft.

---

## Dev Agent Record

### Implementation Plan
1. Task 1: Define shared schemas in `packages/schemas/src/participation/survey-telemetry.schema.ts`, export from packages, and add unit tests.
2. Task 2: Implement backend repository methods, `ParticipationService.recordTelemetryEvents`, controller endpoints for integrity-events, and E2E test.
3. Task 3: Implement frontend offline cache hook and offline banner component.
4. Task 4: Implement frontend non-blocking telemetry buffer collector hook.
5. Task 5: Enhance `FormRenderer.tsx` with offline banner and telemetry hooks, create `/forms/[id]/respond/page.tsx`, and update `MarketplaceCard.tsx`.
6. Task 6: Run full test suites across all packages and frontend build.

### Completion Notes
- Implemented `packages/schemas/src/participation/survey-telemetry.schema.ts` with `integrityEventTypeEnum`, `telemetryEventItemSchema`, `batchTelemetryEventsInputSchema`, and privacy validation rules rejecting keystrokes, clipboard text, and oversized metadata.
- Exported all telemetry schemas and types from `@rescom/schemas`.
- Implemented backend telemetry persistence in `PrismaParticipationRepository` and `InMemoryParticipationRepository` with idempotent conflict skipping via `(attemptId, clientEventId)`.
- Implemented `ParticipationService.recordTelemetryEvents` and `recordResponseTelemetryEvents` verifying attempt existence and ownership.
- Added endpoints in `ParticipationController`: `POST /api/forms/:id/attempts/:attemptId/integrity-events`, alias route `POST /api/surveys/:id/attempts/:attemptId/integrity-events`, and `POST /api/responses/:responseId/integrity-events`.
- Updated `SessionAuthGuard` to support optional user extraction on public routes so both authenticated and guest respondents can submit telemetry.
- Created frontend hooks `useSurveyOfflineCache` and `useSurveyTelemetry` with non-blocking queueing, periodic batching (every 5s or on 10 events), and unload flushing.
- Created `OfflineBanner` component providing visual feedback for offline status, connection restoration, and local draft restoration.
- Integrated offline caching and telemetry into `FormRenderer.tsx`.
- Created dedicated respondent execution page at `apps/frontend/my-app/app/forms/[id]/respond/page.tsx`.
- Updated `MarketplaceCard.tsx` to route internal survey attempts to `/forms/${survey.id}/respond`.
- Authored unit and E2E tests: 4 schema test suites (59 tests), 57 backend unit test suites (563 tests), 16 backend E2E suites (149 tests), and 14 frontend node tests.
- Next.js production build (`next build`) passes with zero errors and generates the `/forms/[id]/respond` route.

---

## File List
- `_bmad-output/implementation-artifacts/5-2-internal-form-rendering-execution.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/schemas/src/participation/survey-telemetry.schema.ts`
- `packages/schemas/src/participation/survey-telemetry.schema.spec.ts`
- `packages/schemas/src/participation/index.ts`
- `apps/backend/src/modules/participation/domain/integrity-event.entity.ts`
- `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts`
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts`
- `apps/backend/src/modules/participation/infrastructure/in-memory-participation.repository.ts`
- `apps/backend/src/modules/participation/application/participation.service.ts`
- `apps/backend/src/modules/participation/application/participation.service.spec.ts`
- `apps/backend/src/modules/participation/presentation/participation.controller.ts`
- `apps/backend/src/modules/participation/presentation/participation.controller.spec.ts`
- `apps/backend/src/modules/auth/presentation/guards/session-auth.guard.ts`
- `apps/backend/test/survey-telemetry.e2e-spec.ts`
- `apps/frontend/my-app/app/forms/hooks/offline-cache.mjs`
- `apps/frontend/my-app/app/forms/hooks/useSurveyOfflineCache.ts`
- `apps/frontend/my-app/app/forms/hooks/telemetry-buffer.mjs`
- `apps/frontend/my-app/app/forms/hooks/useSurveyTelemetry.ts`
- `apps/frontend/my-app/app/forms/components/OfflineBanner.tsx`
- `apps/frontend/my-app/app/forms/components/renderer/FormRenderer.tsx`
- `apps/frontend/my-app/app/forms/[id]/respond/page.tsx`
- `apps/frontend/my-app/app/marketplace/MarketplaceCard.tsx`
- `apps/frontend/my-app/tests/offline-cache.test.mjs`
- `apps/frontend/my-app/tests/telemetry-buffer.test.mjs`

---

## Change Log
- 2026-09-15: Initialized Story 5.2 specification and completed implementation of Internal Form Rendering & Execution with behavioral telemetry collection, offline caching/reconnection, and dedicated respondent execution page. Transitioned to review.

