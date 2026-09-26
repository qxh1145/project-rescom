---
baseline_commit: a40a63c202dfab9d3bac0b818eb5287211e1070d
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/implementation-artifacts/4-1-survey-targeting-criteria.md"
  - "packages/schemas/src/forms/form-targeting.schema.ts"
---

# Story 4.2: Automated Marketplace Matching

Status: done

## Story

As a Respondent,
I want to see a personalized feed of surveys that match my demographic profile,
So that I don't waste time clicking on surveys I am not eligible for.

## Acceptance Criteria

### AC1 — Demographic Profile Contract (`packages/schemas`)
**Given** the shared schema package
**When** defining respondent demographic profiles
**Then**:
1. A `demographicProfileSchema` and `updateDemographicProfileSchema` exist in `packages/schemas`:
   - `age?: number` (integer between 13 and 100)
   - `gender?: Gender` ("MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY")
   - `location?: string` (trimmed string, max 100 chars)
   - `occupation?: string` (trimmed string, max 100 chars)
   - `fieldOfStudy?: string` (trimmed string, max 100 chars)
   - `householdIncome?: string` (optional trimmed string, max 100 chars)
   - `specificInterests?: string[] | Record<string, unknown>` (optional)
2. TypeScript types `DemographicProfileDto` and `UpdateDemographicProfileInput` are exported.
3. A helper `isProfileCompleted(profile: DemographicProfileDto | null): boolean` is exported, returning true if at least core demographic fields (e.g. age, location, gender) are populated.

### AC2 — Automated Matching Logic (`packages/schemas` / domain logic)
**Given** a survey's targeting criteria (`SurveyTargetingCriteria | null`) and a respondent's demographic profile (`DemographicProfileDto | null`)
**When** evaluating eligibility via `isSurveyTargetingMatch(targeting, profile)`
**Then**:
1. If `targeting` is `null`, `undefined`, or `{}` (no criteria set): the survey matches any respondent (open to all).
2. If `targeting` defines `ageRange`: respondent must have `age` populated and `ageRange.min <= age <= ageRange.max`. If profile has no age or age is outside range, returns `false`.
3. If `targeting` defines `locations` (non-empty array): respondent must have `location` populated and match one of the targeted locations (case-insensitive, trimmed comparison).
4. If `targeting` defines `genders` (non-empty array): respondent must have `gender` populated and in the allowed genders list.
5. If `targeting` defines `occupations` (non-empty array): respondent must have `occupation` populated and match one of the allowed occupations (case-insensitive, trimmed comparison).
6. If `targeting` defines `fieldOfStudy` (non-empty array): respondent must have `fieldOfStudy` populated and match one of the allowed fields of study (case-insensitive, trimmed comparison).
7. If any defined criteria fails, returns `false`. Only returns `true` if ALL defined criteria are satisfied (logical AND across criteria categories, logical OR within array items).

### AC3 — Demographics API & Persistence (`apps/backend`)
**Given** an authenticated user
**When** interacting with demographic profile endpoints
**Then**:
1. `GET /api/demographics`: returns the user's demographic profile and completion status. If no profile exists yet, returns empty/default profile with `isComplete: false`.
2. `PUT /api/demographics`: validates the request body against `updateDemographicProfileSchema`, persists the profile in the database (`demographic_profiles`), and returns the updated profile.
3. Both `InMemoryDemographicProfileRepository` and `PrismaDemographicProfileRepository` implement `DemographicProfileRepositoryPort`.

### AC4 — Marketplace Feed API (`apps/backend`)
**Given** an authenticated Respondent
**When** requesting the marketplace feed via `GET /api/marketplace/feed`
**Then**:
1. Returns HTTP 200 with `MarketplaceFeedResponseDto`:
   - `surveys`: array of `MarketplaceSurveyCardDto`
   - `total`: number of matching surveys
   - `profileCompleted`: boolean
2. Only surveys with `status === 'PUBLISHED'` and an active published version are considered.
3. Surveys are filtered using `isSurveyTargetingMatch`:
   - Non-targeted surveys are returned to everyone.
   - Targeted surveys are ONLY returned if the requesting user's demographic profile matches all specified criteria.
   - Surveys whose targeting criteria the user does not qualify for are strictly excluded.
4. Each survey card includes: `id`, `title`, `description`, `type`, `status`, `rewardPerResponse`, `expectedCompletions`, `estimatedEffortSeconds`, `versionNumber`, `publishedAt`, and `targetingJson`.

### AC5 — Marketplace Feed UI (`apps/frontend/my-app`)
**Given** an authenticated user on the frontend
**When** navigating to `/marketplace`
**Then**:
1. The page renders the Marketplace feed displaying eligible survey cards with reward amount, estimated time, survey type, and targeting summary.
2. A Demographic Profile status card/panel shows current profile values (Age, Location, Gender, Occupation, Field of Study) and allows quick inline editing/saving.
3. Updating demographic profile immediately refreshes the feed to demonstrate real-time matching filtering.

> _Code review 2026-09-26 (DF14): items 2–3 are superseded by the Story 7.1 mandatory demographic onboarding and the human-owned mock respondent journey spec; the `/marketplace` page no longer embeds the profile panel._
4. If no surveys match or all available surveys require different demographics, an empty state is shown explaining the matching status.
5. Navigation link allows switching easily between Publisher Forms (`/forms`) and Marketplace (`/marketplace`).

### AC6 — Comprehensive Test Coverage
**Given** unit, integration, and E2E suites across the monorepo
**When** tests and builds are executed
**Then**:
1. Unit tests for `isSurveyTargetingMatch` covering all criteria combinations, edge cases, missing fields, case-insensitivity, and empty targeting.
2. Unit and integration tests for `DemographicsService` and `MarketplaceService`.
3. E2E tests for `GET /api/marketplace/feed` verifying that only demographic-matched published surveys are returned.
4. Full test suite passes with 0 failures and frontend builds with 0 TypeScript errors.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Schemas & Matching Logic (`packages/schemas`)** (AC: 1, 2)
  - [x] 1.1 Create `demographic-profile.schema.ts` in `packages/schemas/src/users/` with `demographicProfileSchema`, `updateDemographicProfileSchema`, `isProfileCompleted`, and type exports.
  - [x] 1.2 Create `marketplace.schema.ts` with `marketplaceSurveyCardSchema`, `marketplaceFeedResponseSchema`, `MarketplaceSurveyCardDto`, and `MarketplaceFeedResponseDto`.
  - [x] 1.3 Create `survey-matching.ts` with `isSurveyTargetingMatch()` implementing multi-criteria matching (ageRange, locations, genders, occupations, fieldOfStudy).
  - [x] 1.4 Write unit tests in `apps/backend/src/modules/marketplace/presentation/survey-matching.spec.ts` testing all matching permutations.
  - [x] 1.5 Export all new schemas and helpers from `@rescom/schemas`.

- [x] **Task 2: Backend — Demographic Profile Module (`apps/backend`)** (AC: 3)
  - [x] 2.1 Define `DemographicProfileRepositoryPort` and `DemographicProfileEntity` in `apps/backend/src/modules/users/`.
  - [x] 2.2 Implement `InMemoryDemographicProfileRepository` and `PrismaDemographicProfileRepository`.
  - [x] 2.3 Implement `DemographicsService` with `getProfile` and `updateProfile`.
  - [x] 2.4 Implement `DemographicsController` with `GET /api/demographics` and `PUT /api/demographics` with guards (`SessionAuthGuard`, `CsrfGuard`).
  - [x] 2.5 Add unit tests for `DemographicsService` and `DemographicsController`.

- [x] **Task 3: Backend — Marketplace Matching & Feed Service (`apps/backend`)** (AC: 4)
  - [x] 3.1 Update `FormRepositoryPort` and `InMemoryFormRepository` / `PrismaFormRepository` to support `findPublishedForms()`.
  - [x] 3.2 Create `MarketplaceService` in `apps/backend/src/modules/marketplace/application/` to fetch published forms and filter by demographic profile matching.
  - [x] 3.3 Create `MarketplaceController` in `apps/backend/src/modules/marketplace/presentation/` with `GET /api/marketplace/feed`.
  - [x] 3.4 Wire `MarketplaceModule` into `AppModule`.
  - [x] 3.5 Write unit tests for `MarketplaceService` and `MarketplaceController`.
  - [x] 3.6 Write E2E tests in `apps/backend/test/marketplace-feed.e2e-spec.ts`.

- [x] **Task 4: Frontend — Marketplace Feed & Demographics UI (`apps/frontend/my-app`)** (AC: 5)
  - [x] 4.1 Create `DemographicsCard.tsx` component allowing respondents to view and update their demographic profile.
  - [x] 4.2 Create `MarketplaceCard.tsx` displaying survey details (reward points, duration, targeting criteria, action button).
  - [x] 4.3 Create `app/marketplace/page.tsx` rendering the feed, demographic status, empty states, and dynamic filter feedback.
  - [x] 4.4 Add navigation bar / link between `/forms` and `/marketplace`.

- [x] **Task 5: Full Regression Testing & Verification** (AC: 6)
  - [x] 5.1 Run all tests in `@rescom/schemas` and `apps/backend`.
  - [x] 5.2 Run frontend production build (`next build --webpack`).
  - [x] 5.3 Verify all acceptance criteria are met with zero regressions.

### Review Findings

_Opened by the 2026-09-15 review; updated in place by the Epic 4 code review of 2026-09-26 (triage IDs DN/P/DF/X in brackets)._

- [x] [Review][Decision] Cursor pagination for the Marketplace feed (DN1, shared with Story 4.3) — ARCHITECTURE-SPINE (`API Format`) requires cursor pagination for list APIs, but the feed returns every match (`total === surveys.length`) and targeting/filter/sort all run in Node over every PUBLISHED form, so a cursor cannot bound the load until matching moves into SQL; changing the contract also touches the shared type the human-owned mock journey consumes ("Ask First: replacing existing shared schemas"). Options: (A) implement now — `cursor` + `limit` (default 20, max 50) in `marketplaceFeedQuerySchema`, `nextCursor` in the response, opaque cursor encoding the sort key + `id`, mock repository updated; (B) defer pagination to the live-API swap / SQL feed-projection work and record the spine deviation in `deferred-work.md` (per-request load already reduced by P11); (C) hard server cap (e.g. 100 cards) with no cursor — not recommended (silent truncation). **Triage recommendation: B.** [packages/schemas/src/marketplace/marketplace.schema.ts:27] — **Resolved 2026-09-26:** option B accepted by Quan; cursor pagination deferred to the live-API swap / SQL feed projection and the deviation from the spine's cursor rule recorded in `deferred-work.md` ("code-review decisions 2026-09-26 (Batch B)"); P11's per-request load reduction verified in place (Prisma loads only the newest published version per form and skips forms without one; same in the in-memory adapter; `prisma-form.repository.spec.ts`, `marketplace.service.spec.ts`).
- [x] [Review][Decision] Self-participation: publishers see and can complete their own surveys (DN2, Stories 4.2/4.3) — the feed has no `publisherId === userId` exclusion and `startAttempt` does not reject the owner, so a publisher can be paid from their own Escrow and inflate completions; already an open PO item in `deferred-work.md` (Story 7.2). Options: (A) forbid — feed skips own surveys, `startAttempt` throws 403 `SELF_PARTICIPATION_FORBIDDEN`, mock mirrors the rule; (B) allow as an unpaid preview (no reward, no quota consumption, no activation credit); (C) keep current behaviour. **Triage recommendation: A** (matches the other four-eyes rules: self-moderation and self-approval of top-ups are forbidden; activation already ignores own surveys). [apps/backend/src/modules/marketplace/application/marketplace.service.ts:57] — **Resolved 2026-09-26:** option A accepted by Quan (decided together with E7-DN2); the feed skips `form.isOwnedBy(userId)`, `startAttempt` throws the new `SelfParticipationForbiddenException` (403 `SELF_PARTICIPATION_FORBIDDEN`, shared code in `@rescom/schemas`, mapped in `HttpExceptionFilter`) before any reservation, and the mock hides own surveys and refuses to start them with the same code; tests: marketplace service, participation service, filter, `marketplace-activation` e2e (feed + 403), mock tests.
- [x] [Review][Patch] Reject unknown demographic update properties so misspelled fields return a validation error instead of being silently stripped and reported as a successful update — fixed 2026-09-26 (P14): `updateDemographicProfileSchema` is `.strict()`; the array form of `specificInterests` is bounded (≤30 items, trimmed, 1–100 chars). [packages/schemas/src/users/demographic-profile.schema.ts:52]
- [x] [Review][Patch] Normalize Unicode before demographic string comparison so canonically equivalent Vietnamese location, occupation, and field-of-study values match consistently — fixed 2026-09-26 (P13): NFC + trim + whitespace collapse + `vi` lower-casing on both sides; non-string targeting items are skipped. Synonym/diacritic-less folding deferred (DF16). [packages/schemas/src/marketplace/survey-matching.ts:63]
- [x] [Review][Defer] Tighten the survey-card output contract so AC4 fields are required and `publishedAt` is a valid ISO-8601 datetime [packages/schemas/src/marketplace/marketplace.schema.ts:60] — deferred (DF11): nothing parses the card schema at runtime (tests only) and tightening the shared type affects the human-owned mock frontend ("Ask First"); tighten at the live-API swap.
- [x] [Review][Patch] Extend unit coverage for malformed persisted targeting, invalid profile-completion ages, empty criterion arrays, Unicode-equivalent strings, strict update payloads, and required survey-card output fields — resolved: invalid-age cases added by Story 7.1; malformed targeting / empty arrays (P12), Unicode (P13) and strict payloads (P14) covered 2026-09-26; card output contract → DF11. [apps/backend/src/modules/marketplace/presentation/survey-matching.spec.ts:19]
- [x] [Review][Patch] Route Marketplace "Start Survey" actions to respondent participation flows instead of the ownership-protected Publisher preview — resolved before 2026-09-26: `MarketplaceCard` routes to `/forms/{id}/respond` or `/attempts/{id}`. [apps/frontend/my-app/app/marketplace/MarketplaceCard.tsx:27]
- [x] [Review][Defer] Synchronize the demographic edit draft when the asynchronously loaded profile changes and restore persisted values when cancelling edits [apps/frontend/my-app/app/marketplace/DemographicsCard.tsx:27] — deferred (DF15): the component is unused; `deferred-work.md` (7.1) already says to delete or replace it at the live-API swap.
- [x] [Review][Patch] Normalize and validate the JSON-backed demographic metadata envelope so legacy interest arrays, explicit null clears, and malformed reserved fields round-trip without corruption or leakage — legacy arrays and null clears resolved (Story 7.1); malformed reserved fields dismissed (X6): every write is schema-validated and the 7.1 completeness gate fails closed on malformed values. [apps/backend/src/modules/users/infrastructure/prisma-demographic-profile.repository.ts:8]
- [x] [Review][Patch] Make concurrent partial demographic updates concurrency-safe so changes to different JSON-backed fields cannot overwrite one another — fixed 2026-09-26 (P15): read-merge-upsert runs in one transaction behind `SELECT … FOR UPDATE` on the user's row; a concurrent first-time create (P2002) is retried once. [apps/backend/src/modules/users/infrastructure/prisma-demographic-profile.repository.ts:50]
- [x] [Review][Patch] Exclude `PUBLISHED` forms that have no version explicitly marked `isPublished` instead of exposing the newest draft as an active survey — fixed 2026-09-26 (P11): `findPublishedForms` loads only the newest published version per form (Prisma `where isPublished, take 1`) and skips forms without one (both adapters). [apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts:356]
- [x] [Review][Patch] Runtime-validate stored targeting JSON and fail closed per survey so malformed or unknown criteria cannot expose an ineligible survey or crash the entire feed — fixed 2026-09-26 (P12): new `parseStoredTargeting` in `@rescom/schemas`; the feed skips a malformed survey and `startAttempt` treats it as not eligible. [apps/backend/src/modules/marketplace/application/marketplace.service.ts:98]
- [x] [Review][Patch] Validate marketplace query parameters through the standard Zod validation pipe so invalid inputs return HTTP 400 rather than an unhandled Zod error/HTTP 500 — fixed 2026-09-26 (P8, tracked in Story 4.3). [apps/backend/src/modules/marketplace/presentation/marketplace.controller.ts:14]
- [x] [Review][Patch] Reset loading/error state for every filter request and clear stale surveys on failure so the UI never presents old results under new filters — fixed 2026-09-26 (P18, tracked in Story 4.3; page stays mock-backed). [apps/frontend/my-app/app/marketplace/page.tsx:48]
- [x] [Review][Patch] Debounce search-triggered feed requests and decouple demographic-profile loading from filter changes — fixed 2026-09-26 (P18: ~300 ms debounce); the profile-loading part no longer applies (the page loads no profile since Story 7.1). [apps/frontend/my-app/app/marketplace/page.tsx:53]
- [x] [Review][Patch] Add Prisma demographic adapter and persistence coverage for array interests, explicit null clearing, malformed metadata, and concurrent partial updates — fixed 2026-09-26 (P15): mocked-transaction tests for the row lock, the P2002 retry, null clears per packed field and malformed stored JSON. [apps/backend/src/modules/users/infrastructure/prisma-demographic-profile.repository.spec.ts]
- [x] [Review][Patch] Complete the story File List with every runtime-required port, adapter, filter component, and related test imported by the listed implementation — dismissed (X7): the named files were introduced by Story 4.3 and are listed in its File List. [_bmad-output/implementation-artifacts/4-2-automated-marketplace-matching.md:183]
- [x] [Review][Patch] Enforce the full age invariant in profile-completion checks so corrupt non-integer, non-finite, or over-100 values cannot mark a profile complete — resolved by Story 7.1 (`demographic-profile.schema.ts` completeness rule). [packages/schemas/src/users/demographic-profile.schema.ts:143]
- [x] [Review][Defer] Cards expose exact targeting criteria and respondents can edit demographics at any time, so targeting is easy to game (DF8) [apps/backend/src/modules/marketplace/application/marketplace.service.ts:133] — deferred: AC4.4 requires `targetingJson` on the card and FR-9 allows edits; anti-gaming (edit cooldown, cross-check) is Story 7.3 (Phase 2).
- [x] [Review][Defer] Age is stored as an integer and never advances (DF10) [packages/schemas/src/users/demographic-profile.schema.ts:12] — deferred: follows the AC1/FR-6 contract; a birth-year model needs a PO decision and a schema migration.
- [x] [Review][Defer] AC5.2/5.3 (inline demographic panel and live re-matching on `/marketplace`) is no longer met (DF14) [apps/frontend/my-app/app/marketplace/page.tsx:1] — deferred: superseded by the Story 7.1 mandatory onboarding and the human-owned mock journey spec; profile screens are deferred in `deferred-work.md`.
- [x] [Review][Defer] Free-text targeting misses synonyms and diacritic-less variants ("Ha Noi", "Hanoi" vs "Hà Nội") (DF16) [packages/schemas/src/marketplace/survey-matching.ts] — deferred: beyond P13's NFC fix; needs canonical province/occupation/major catalogs (product/data decision).

---

## Dev Notes

### Architecture Context
- **Ownership (AD-16 / ARCHITECTURE-SPINE):** `Marketplace` is a dedicated bounded context that reads approved projections from Research (`Form`/`FormVersion`) and Identity (`User`/`DemographicProfile`). It owns no source survey or profile state.
- **Matching Rule:** Logical AND across criteria categories. If a survey specifies both `ageRange` (18-25) and `locations` (["Hanoi"]), a respondent must be between 18-25 AND located in Hanoi. Surveys with no criteria (`targetingJson: null` or `{}`) are open to everyone.
- **Case-Insensitive Normalization:** Location, occupation, and field of study text comparisons are case-insensitive and whitespace-trimmed.
- **DemographicProfile Model:** `demographic_profiles` table in Prisma contains `age`, `location`, `household_income`, and `specific_interests`. We store `gender`, `occupation`, and `fieldOfStudy` cleanly in `specific_interests` JSON (and also support top-level columns if present) without requiring destructive DB alterations.

---

## Dev Agent Record

### Implementation Plan
1. Implement shared schemas, matching algorithm, and unit tests in `@rescom/schemas`.
2. Implement Demographic Profile repository port, in-memory/prisma adapters, service, and controller in backend.
3. Update Form repository to support `findPublishedForms()`.
4. Implement Marketplace module, service, and controller with automated matching.
5. Create frontend Marketplace feed page and Demographics profile widget.
6. Verify with complete test suite and frontend build.

### Debug Log
- Resolved pre-existing test failure in `forms.controller.spec.ts` where non-admin user was passed to `transitionStatus`.
- Fixed circular dependency between `UsersModule` and `AuthModule` by placing `DemographicsController` in `MarketplaceModule` alongside `MarketplaceController`, keeping `UsersModule` strictly a provider module.
- Addressed Next.js / React 19 ESLint `react-hooks/set-state-in-effect` error in `marketplace/page.tsx` by using an asynchronous `fetchData` closure with cancellation flag inside `useEffect`.
- Successfully ran full verification pipeline (`verify`: build, typecheck, lint, and test) across all monorepo workspaces with 100% pass rate.

### Completion Notes
- **AC1 — Demographic Profile Contract:** Implemented `demographicProfileSchema`, `updateDemographicProfileSchema`, and `isProfileCompleted` helper in `packages/schemas/src/users/demographic-profile.schema.ts`.
- **AC2 — Automated Matching Logic:** Implemented `isSurveyTargetingMatch` in `packages/schemas/src/marketplace/survey-matching.ts` supporting `ageRange`, `locations`, `genders`, `occupations`, and `fieldOfStudy` with case-insensitivity and trim normalization. Verified with 30 unit test cases in `survey-matching.spec.ts`.
- **AC3 — Demographics API & Persistence:** Created `DemographicProfileEntity`, `DemographicProfileRepositoryPort`, `InMemoryDemographicProfileRepository`, `PrismaDemographicProfileRepository`, `DemographicsService`, and `DemographicsController` (`GET /api/demographics`, `PUT /api/demographics`).
- **AC4 — Marketplace Feed API:** Created `MarketplaceService` and `MarketplaceController` (`GET /api/marketplace/feed`) in `apps/backend/src/modules/marketplace/`. Automated matching filters out unpublished forms and surveys where respondent demographics do not match criteria. Verified in E2E tests (`marketplace-feed.e2e-spec.ts`).
- **AC5 — Marketplace Feed UI:** Built responsive frontend feed at `/marketplace` with `DemographicsCard` and `MarketplaceCard` components, real-time matching updates on profile change, and navigation between Publisher and Marketplace feeds.
- **AC6 — Comprehensive Test Coverage:** 47 test suites (452 tests) and 12 E2E suites (121 tests) pass with 0 failures. Next.js production build and TypeScript check pass cleanly.
- **Code review 2026-09-26 (Epic 4):** applied P11 (feed loads only the newest published version; forms without one excluded), P12 (`parseStoredTargeting`, fail closed per survey in the feed and in `startAttempt`), P13 (NFC/whitespace-normalized matching), P14 (`.strict()` + bounded interests on demographic updates) and P15 (row-locked, P2002-retried demographic upsert); old 2026-09-15 items re-mapped in place; DN1 (cursor pagination) and DN2 (self-participation) await a product decision.
- **Decision follow-up 2026-09-26 (E4-DN1 option B, E4-DN2 option A, accepted by Quan):** feed cursor pagination deferred (deviation from the spine's cursor rule for list APIs recorded in `deferred-work.md`; the feed still returns every match with `total === surveys.length` until matching moves into SQL; P11 verified as the interim load reduction). Self-participation forbidden: the feed hides the caller's own surveys, `POST /forms/:id/attempts` by the owner returns 403 `SELF_PARTICIPATION_FORBIDDEN`, and the mock mirrors both (the respondent-facing mock feed hides own surveys, the mock start rejects). Verification: schemas 418 (23 suites), backend unit 1419 (98 suites), backend e2e 291 passed / 3 skipped (30 suites), frontend 238, typecheck + lint clean, `prisma validate` clean.

---

## File List
- `packages/schemas/src/users/demographic-profile.schema.ts`
- `packages/schemas/src/users/index.ts`
- `packages/schemas/src/marketplace/marketplace.schema.ts`
- `packages/schemas/src/marketplace/survey-matching.ts`
- `packages/schemas/src/marketplace/index.ts`
- `packages/schemas/src/index.ts`
- `apps/backend/src/modules/users/domain/demographic-profile.entity.ts`
- `apps/backend/src/modules/users/application/ports/demographic-profile.repository.port.ts`
- `apps/backend/src/modules/users/infrastructure/in-memory-demographic-profile.repository.ts`
- `apps/backend/src/modules/users/infrastructure/prisma-demographic-profile.repository.ts`
- `apps/backend/src/modules/users/application/demographics.service.ts`
- `apps/backend/src/modules/users/application/demographics.service.spec.ts`
- `apps/backend/src/modules/users/presentation/demographics.controller.ts`
- `apps/backend/src/modules/users/presentation/demographics.controller.spec.ts`
- `apps/backend/src/modules/users/users.module.ts`
- `apps/backend/src/modules/forms/application/ports/form-repository.port.ts`
- `apps/backend/src/modules/forms/infrastructure/in-memory-form.repository.ts`
- `apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts`
- `apps/backend/src/modules/forms/presentation/forms.controller.spec.ts`
- `apps/backend/src/modules/marketplace/application/marketplace.service.ts`
- `apps/backend/src/modules/marketplace/application/marketplace.service.spec.ts`
- `apps/backend/src/modules/marketplace/presentation/marketplace.controller.ts`
- `apps/backend/src/modules/marketplace/presentation/marketplace.controller.spec.ts`
- `apps/backend/src/modules/marketplace/presentation/survey-matching.spec.ts`
- `apps/backend/src/modules/marketplace/marketplace.module.ts`
- `apps/backend/src/app.module.ts`
- `apps/backend/test/marketplace-feed.e2e-spec.ts`
- `apps/frontend/my-app/app/marketplace/marketplace-api.ts`
- `apps/frontend/my-app/app/marketplace/DemographicsCard.tsx`
- `apps/frontend/my-app/app/marketplace/MarketplaceCard.tsx`
- `apps/frontend/my-app/app/marketplace/page.tsx`
- `apps/frontend/my-app/app/forms/page.tsx`
- `apps/frontend/my-app/app/page.tsx`
- `_bmad-output/implementation-artifacts/4-2-automated-marketplace-matching.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/schemas/src/marketplace/stored-targeting.ts`
- `packages/schemas/src/marketplace/stored-targeting.spec.ts`
- `packages/schemas/src/users/demographic-profile.schema.spec.ts`
- `apps/backend/src/modules/participation/application/participation.service.ts`
- `apps/backend/src/modules/participation/application/participation.service.spec.ts`
- `apps/backend/src/modules/forms/infrastructure/prisma-form.repository.spec.ts`
- `apps/backend/src/modules/users/infrastructure/prisma-demographic-profile.repository.spec.ts`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- Decision follow-up 2026-09-26 (E4-DN1, E4-DN2):
  - `packages/schemas/src/participation/survey-attempt.schema.ts` (`SELF_PARTICIPATION_FORBIDDEN_CODE`)
  - `apps/backend/src/modules/marketplace/application/marketplace.service.ts` (+ spec)
  - `apps/backend/src/modules/participation/application/participation.service.ts` (+ spec), `apps/backend/src/modules/participation/application/exceptions/participation.exceptions.ts`
  - `apps/backend/src/common/http/http-exception.filter.ts` (+ spec)
  - `apps/backend/test/marketplace-activation.e2e-spec.ts`
  - `apps/frontend/my-app/lib/mock/repository.ts`, `apps/frontend/my-app/tests/marketplace-activation.test.mjs`, `apps/frontend/my-app/tests/survey-feedback.test.mjs`
  - `_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md`, `_bmad-output/implementation-artifacts/spec-mock-respondent-journey.md` (Spec Change Log), `_bmad-output/implementation-artifacts/sprint-status.yaml`, `_bmad-output/implementation-artifacts/deferred-work.md`

---

## Change Log
- 2026-09-15: Implemented Story 4.2 Automated Marketplace Matching. Added shared schemas for demographic profile and marketplace feed, implemented multi-criteria automated matching logic, built Demographic Profile repository/service/controller, implemented Marketplace service and feed endpoint, built frontend Marketplace feed with live demographic matching updates, and verified with 452 unit tests, 12 E2E suites, and full monorepo build verification. Status updated to review.
- 2026-09-26: Code review 2026-09-26: Epic 4 review findings written (2 decisions open, 5 patches applied — P11–P15, 6 deferred, old items re-mapped); status set to in-progress pending DN1/DN2.
- 2026-09-26: Decision follow-up 2026-09-26: E4-DN1 → option B (feed cursor pagination deferred to the live-API swap / SQL feed projection; spine deviation recorded in `deferred-work.md`; P11 verified); E4-DN2 → option A (feed hides own surveys, owner `startAttempt` → 403 `SELF_PARTICIPATION_FORBIDDEN`, mock parity, tests). No unchecked decision/patch items remain → Status `done`.
