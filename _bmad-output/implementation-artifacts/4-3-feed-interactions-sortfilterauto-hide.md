---
baseline_commit: a40a63c202dfab9d3bac0b818eb5287211e1070d
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "_bmad-output/implementation-artifacts/4-2-automated-marketplace-matching.md"
  - "packages/schemas/src/marketplace/marketplace.schema.ts"
  - "apps/backend/src/modules/marketplace/application/marketplace.service.ts"
---

# Story 4.3: Feed Interactions (Sort/Filter/Auto-Hide)

Status: review

## Story

As a Respondent,
I want to sort/filter my survey feed and automatically hide surveys I've already completed,
So that I can easily find new earning opportunities.

## Acceptance Criteria

### AC1 — Feed Query & Filtering Contract (`packages/schemas`)
**Given** the shared schema package
**When** defining feed interaction query parameters and survey cards
**Then**:
1. `marketplaceFeedQuerySchema` is exported in `packages/schemas/src/marketplace/marketplace.schema.ts`:
   - `sortBy`: enum `['best_match', 'reward_desc', 'reward_asc', 'duration_asc', 'duration_desc', 'newest']`, default `'best_match'`. Supports shorthand aliases (`'reward'` -> `'reward_desc'`, `'duration'` -> `'duration_asc'`).
   - `hideCompleted`: boolean (default `true`).
   - `search`: optional trimmed string (max 100 characters).
   - `type`: optional enum `['ALL', 'INTERNAL', 'EXTERNAL']`, default `'ALL'`.
   - `minReward`: optional non-negative integer.
   - `maxDuration`: optional positive integer (seconds).
2. `marketplaceSurveyCardSchema` includes:
   - `isCompletedByCurrentUser`: boolean (default `false`).
   - `completedCompletions`: non-negative integer count of accepted responses.
3. TypeScript types `MarketplaceFeedQueryDto` and updated `MarketplaceSurveyCardDto` are exported.

### AC2 — Response Persistence Port & Completed Survey Tracker (`apps/backend`)
**Given** the backend survey execution domain
**When** checking whether a user has already submitted a survey
**Then**:
1. `SurveyResponseRepositoryPort` is defined with:
   - `findCompletedFormIdsByRespondent(respondentId: string): Promise<Set<string>>`
   - `getCompletedCountsByFormIds(formIds: string[]): Promise<Map<string, number>>`
   - `recordResponse(response: { formId: string; formVersionId: string; respondentId: string; status: 'SUBMITTED' | 'VALIDATED' }): Promise<void>`
2. Both `InMemorySurveyResponseRepository` and `PrismaSurveyResponseRepository` implement the port.
3. Prisma implementation queries the `Response` table with `status IN ['SUBMITTED', 'VALIDATED']`.

### AC3 — Backend Feed Service Sort, Filter & Auto-Hide (`apps/backend`)
**Given** an authenticated Respondent calling `MarketplaceService.getFeed(userId, query)`
**When** processing published surveys
**Then**:
1. **Auto-Hide Completed Surveys:** Any survey where `userId` has already submitted a response (`status` IN `['SUBMITTED', 'VALIDATED']`) is automatically excluded when `hideCompleted: true` (default).
2. **Auto-Hide Quota-Reached Surveys:** Any survey where `completedCompletions >= expectedCompletions` is automatically hidden from the feed (FR-38).
3. **Manual Sorting:**
   - `'reward_desc'` / `'reward'`: highest reward per response first.
   - `'reward_asc'`: lowest reward per response first.
   - `'duration_asc'` / `'duration'`: shortest estimated effort time first.
   - `'duration_desc'`: longest estimated effort time first.
   - `'newest'`: most recently published first.
   - `'best_match'` (default): targeted surveys matching respondent first, then non-targeted, sorted by reward desc.
4. **Filtering:**
   - Text search query filters by case-insensitive substring match on survey `title` or `description`.
   - Type filter matches `INTERNAL` or `EXTERNAL`.
   - `minReward` and `maxDuration` filters applied when present.

### AC4 — Marketplace API Endpoints (`apps/backend`)
**Given** an authenticated Respondent
**When** sending `GET /api/marketplace/feed` with query parameters (e.g. `?sortBy=reward_desc&search=tech&type=INTERNAL`)
**Then**:
1. The endpoint parses and validates query parameters using `marketplaceFeedQuerySchema`.
2. Returns HTTP 200 with the filtered, sorted, auto-hidden survey cards and metadata.

### AC5 — Frontend Feed Interactions & Controls (`apps/frontend/my-app`)
**Given** an authenticated Respondent on `/marketplace`
**When** interacting with the feed
**Then**:
1. The UI provides a Sort selector: "Best Match", "Highest Reward", "Shortest Time", "Newest".
2. The UI provides a Search input box for instant keyword filtering.
3. The UI provides Filter controls: Survey Type (All / Internal / External), and "Hide Completed" toggle (active by default).
4. Changing sort/filters immediately updates the displayed survey cards.
5. If completed surveys exist and "Hide Completed" is untoggled, completed survey cards display a distinct "Completed" badge.
6. A "Clear Filters" action resets filters when active.

### AC6 — Comprehensive Test Coverage
**Given** unit, integration, and E2E suites across the monorepo
**When** tests and builds are executed
**Then**:
1. Unit tests for `marketplaceFeedQuerySchema` parsing, defaults, and aliases.
2. Unit tests for `SurveyResponseRepository` implementations.
3. Unit tests for `MarketplaceService` covering auto-hide completed, quota auto-hide, each sort mode, and filter combinations.
4. E2E tests in `marketplace-feed.e2e-spec.ts` verifying completed survey auto-hiding per respondent and sorting query parameters.
5. Full regression test suite passes with 0 failures and frontend builds cleanly.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Schemas & Feed Query Contract (`packages/schemas`)** (AC: 1)
  - [x] 1.1 Extend `packages/schemas/src/marketplace/marketplace.schema.ts` with `marketplaceFeedQuerySchema`, sorting enums, and query type exports.
  - [x] 1.2 Update `marketplaceSurveyCardSchema` to include `isCompletedByCurrentUser` and `completedCompletions`.
  - [x] 1.3 Write schema unit tests verifying query normalization, aliases, defaults, and type exports.
  - [x] 1.4 Build and export `@rescom/schemas`.

- [x] **Task 2: Backend — Response Repository Port & Adapters (`apps/backend`)** (AC: 2)
  - [x] 2.1 Define `SurveyResponseRepositoryPort` and token `SURVEY_RESPONSE_REPOSITORY_PORT` in `apps/backend/src/modules/marketplace/application/ports/`.
  - [x] 2.2 Implement `InMemorySurveyResponseRepository` supporting respondent completed query, quota counts, and mock response recording.
  - [x] 2.3 Implement `PrismaSurveyResponseRepository` querying Prisma `Response` model.
  - [x] 2.4 Add unit tests for `InMemorySurveyResponseRepository` and `PrismaSurveyResponseRepository`.

- [x] **Task 3: Backend — Marketplace Sorting, Filtering & Auto-Hide Engine (`apps/backend`)** (AC: 3)
  - [x] 3.1 Update `MarketplaceService` constructor to inject `SurveyResponseRepositoryPort`.
  - [x] 3.2 Implement auto-hide logic for surveys already completed by the requesting user.
  - [x] 3.3 Implement quota auto-hide logic for surveys reaching `expectedCompletions`.
  - [x] 3.4 Implement sorting algorithms for `best_match`, `reward_desc`, `reward_asc`, `duration_asc`, `duration_desc`, and `newest`.
  - [x] 3.5 Implement search and criteria filtering (keyword, type, minReward, maxDuration).
  - [x] 3.6 Add comprehensive unit tests in `marketplace.service.spec.ts` testing all sort/filter/auto-hide permutations.

- [x] **Task 4: Backend — Controller & Query Param Integration (`apps/backend`)** (AC: 4)
  - [x] 4.1 Update `MarketplaceController.getFeed` to receive query parameters validated with `marketplaceFeedQuerySchema`.
  - [x] 4.2 Update `MarketplaceModule` to bind `SURVEY_RESPONSE_REPOSITORY_PORT` with `PrismaSurveyResponseRepository`.
  - [x] 4.3 Update `marketplace.controller.spec.ts` to test query parameters handling.
  - [x] 4.4 Add E2E tests in `marketplace-feed.e2e-spec.ts` verifying auto-hide per user and sorting via HTTP queries.

- [x] **Task 5: Frontend — Feed Interactions, Sort & Filter Controls (`apps/frontend/my-app`)** (AC: 5)
  - [x] 5.1 Update `marketplace-api.ts` to support feed query params (`sortBy`, `search`, `type`, `hideCompleted`).
  - [x] 5.2 Create `MarketplaceFilterBar.tsx` with search input, sort selector, type selector, and hide completed toggle.
  - [x] 5.3 Update `MarketplaceCard.tsx` with completed badge and duration/reward highlights.
  - [x] 5.4 Update `app/marketplace/page.tsx` with filter bar, responsive query handling, active filter badges, and empty states.

- [x] **Task 6: Full Monorepo Regression Testing & Verification** (AC: 6)
  - [x] 6.1 Run all backend unit tests (`npm test`).
  - [x] 6.2 Run all backend E2E tests (`npm run test:e2e`).
  - [x] 6.3 Run frontend production build (`next build`).
  - [x] 6.4 Verify all Acceptance Criteria are met and mark story for review.

---

## Dev Notes

### Architecture Context
- **Ownership (AD-16 / ARCHITECTURE-SPINE):** `Marketplace` is a projection and discovery service. It consumes read projections from `Forms` and `Responses` to determine feed availability without modifying response or form aggregate roots.
- **Auto-Hide Completed Logic:** A response counts as "completed" if `status` is `SUBMITTED` or `VALIDATED`. In-progress or abandoned drafts do not hide the survey from the feed.
- **Quota Auto-Hide (FR-38):** If the total count of completed responses for a form reaches `expectedCompletions`, it is automatically hidden from the active marketplace feed.
- **Sorting Performance:** In-memory sorting and filtering on the projected candidate set is fast and deterministic for candidate surveys matched to a respondent.

---

## Dev Agent Record

### Implementation Plan
1. Extend `@rescom/schemas` with feed query schema and updated card schema.
2. Implement `SurveyResponseRepositoryPort` and its InMemory/Prisma adapters.
3. Update `MarketplaceService` with auto-hide, quota, sort, and filter logic.
4. Update `MarketplaceController`, tests, and E2E suite.
5. Enhance frontend with `MarketplaceFilterBar`, sort options, search, and completed state.
6. Verify monorepo test suites and build.

### Debug Log
- Corrected NestJS module import in `marketplace.module.ts` from non-existent `DatabaseModule` to `PrismaModule`.
- Resolved ESLint `@typescript-eslint/no-unused-vars` and Prettier format warnings in test suites with automated format fixes and removing unneeded variables.
- Verified all 49 backend unit test suites (480 tests), all 12 E2E test suites (124 tests), and full `npm run verify` pipeline with zero errors.

### Completion Notes
- **AC1 — Feed Query & Filtering Contract:** Exported `marketplaceFeedQuerySchema`, `marketplaceSortOptionSchema`, `MarketplaceSortOption`, and `MarketplaceFeedQueryDto` in `@rescom/schemas`. Added `isCompletedByCurrentUser` (boolean, default false) and `completedCompletions` (integer, default 0) to `marketplaceSurveyCardSchema`.
- **AC2 — Response Persistence Port & Adapters:** Defined `SurveyResponseRepositoryPort` and token `SURVEY_RESPONSE_REPOSITORY_PORT`. Implemented `InMemorySurveyResponseRepository` and `PrismaSurveyResponseRepository` with response counting and respondent completed checking (`status IN ['SUBMITTED', 'VALIDATED']`).
- **AC3 — Feed Service Sort, Filter & Auto-Hide Engine:** Implemented auto-hide for completed surveys per user (when `hideCompleted: true`), quota completion auto-hide (`completedCompletions >= expectedCompletions` per FR-38), sorting by reward (asc/desc), duration (asc/desc), newest, and best match, as well as text search and type filtering.
- **AC4 — Marketplace API Endpoints:** Extended `MarketplaceController.getFeed` with validated `@Query()` parameters and wired dependencies in `MarketplaceModule`.
- **AC5 — Frontend Feed Interactions UI:** Created `MarketplaceFilterBar.tsx` featuring instant keyword search, sort selector (Best Match, Highest Reward, Shortest Time, Newest), survey type filter (All, Internal, External), and "Hide completed" toggle. Updated `MarketplaceCard.tsx` with a distinct "Completed" badge and status, and updated `page.tsx` with reactive filter state and empty states.
- **AC6 — Comprehensive Test Coverage:** Added unit test suites for schema validation and repository implementations, updated `marketplace.service.spec.ts` with 15 tests, added E2E tests in `marketplace-feed.e2e-spec.ts` testing auto-hide, sorting, and filtering via HTTP requests. All 480 unit tests and 124 E2E tests pass.

---

## File List
- `packages/schemas/src/marketplace/marketplace.schema.ts`
- `apps/backend/src/modules/marketplace/application/ports/survey-response.repository.port.ts`
- `apps/backend/src/modules/marketplace/infrastructure/in-memory-survey-response.repository.ts`
- `apps/backend/src/modules/marketplace/infrastructure/prisma-survey-response.repository.ts`
- `apps/backend/src/modules/marketplace/infrastructure/survey-response.repository.spec.ts`
- `apps/backend/src/modules/marketplace/application/marketplace.service.ts`
- `apps/backend/src/modules/marketplace/application/marketplace.service.spec.ts`
- `apps/backend/src/modules/marketplace/presentation/marketplace.controller.ts`
- `apps/backend/src/modules/marketplace/presentation/marketplace.controller.spec.ts`
- `apps/backend/src/modules/marketplace/presentation/marketplace-feed.schema.spec.ts`
- `apps/backend/src/modules/marketplace/marketplace.module.ts`
- `apps/backend/test/marketplace-feed.e2e-spec.ts`
- `apps/frontend/my-app/app/marketplace/marketplace-api.ts`
- `apps/frontend/my-app/app/marketplace/MarketplaceFilterBar.tsx`
- `apps/frontend/my-app/app/marketplace/MarketplaceCard.tsx`
- `apps/frontend/my-app/app/marketplace/page.tsx`
- `_bmad-output/implementation-artifacts/4-3-feed-interactions-sortfilterauto-hide.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

---

## Change Log
- 2026-09-15: Initial story specification created for Story 4.3: Feed Interactions (Sort/Filter/Auto-Hide). Status set to ready-for-dev.
- 2026-09-15: Implemented Story 4.3 Feed Interactions (Sort/Filter/Auto-Hide). Added shared query schema with sorting options/aliases, response repository port with in-memory and prisma adapters, feed service auto-hide for completed surveys and quota completion, manual sorting (reward desc/asc, duration asc/desc, newest, best match), search and type filtering, controller query integration, frontend filter bar and card completed badges, and comprehensive test suites (480 unit tests, 124 E2E tests, clean Next.js build). Status updated to review.
