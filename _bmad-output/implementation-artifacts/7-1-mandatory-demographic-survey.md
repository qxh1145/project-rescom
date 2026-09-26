---
baseline_commit: 378e4a71ff125fb1acf6ee18291fc298ae56bf94
---

# Story 7.1: Mandatory Demographic Survey

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a New Respondent,
I want to fill out my demographic profile upon my first login,
so that I can unlock my frozen starter points and access the survey marketplace.

## Acceptance Criteria

1. **Redirect to the mandatory survey (FR-6, FR-9).** Given a signed-in user whose demographic profile is not complete, when they open the Marketplace (or any survey-taking page: `/forms/[id]/respond`, `/attempts/[id]`), then they are redirected to the Mandatory Demographic Survey (`/onboarding`) before any earning UI renders, and the onboarding screen explains why they were sent there.
2. **Single shared definition of "complete" (FR-6 "All demographic fields are required").** A profile is complete only when ALL FR-6 fields are present and valid: `age` (integer 13–100), `gender`, `location` (region/province), `occupation`, `fieldOfStudy` (academic major), `householdIncome` (income bracket) and `specificInterests` (array with ≥ 1 non-blank interest). `isProfileCompleted` / `getMissingDemographicFields` in `@rescom/schemas` is the one definition; `DemographicProfileEntity.isComplete()`, `PrismaStarterPointsDataProvider.isDemographicComplete`, `MarketplaceService`, `ParticipationService` and the frontend mock repository all delegate to it.
3. **Cannot bypass — enforced server-side.** For an authenticated user without a complete profile:
   - `POST /forms/:id/attempts` and `POST /surveys/:id/attempts` reject with **403 `DEMOGRAPHIC_PROFILE_REQUIRED`** (details: `{ missingFields: string[] }`) before any attempt/reservation is created;
   - `GET /marketplace/feed` rejects with the same 403 `DEMOGRAPHIC_PROFILE_REQUIRED` (FR-6: "User cannot access Marketplace until demographic survey is completed").
   Internal submission and External code verification stay reachable only through an attempt, so they are covered transitively. Guest/public flows (`/public/forms/*`, Story 4.4, Phase-2-deferred) and `startAttempt(…, userId = null)` behave exactly as today.
4. **Submission endpoint.** `POST /demographics/survey` (Session + CSRF + JSON-only) validates the full mandatory survey with a strict shared schema (every FR-6 field required → 400 `VALIDATION_ERROR` otherwise), saves the profile (upsert), triggers the existing Story 6.5 unlock check, and returns `{ profile, isComplete: true, missingFields: [], nextStep }` where `nextStep` is `MARKETPLACE_ACTIVATION` until the user has completed one Marketplace survey / unlocked starter points (then `COMPLETED`).
5. **Profile read/update report completeness.** `GET /demographics` and `PUT /demographics` (partial update, FR-9 "update at any time") return `{ profile, isComplete, missingFields }`.
6. **Starter points stay Frozen (FR-7, FR-8).** Submitting the demographic survey alone never moves the 100 Frozen starter points; they unlock only after one additional Marketplace survey (existing `StarterPointsCoordinator` rule, unchanged).
7. **Post-submit handoff (mock-first UI).** After a successful submission the onboarding wizard navigates to the Marketplace activation step (`/marketplace?activation=1`), which shows the "Bước 2/2 — complete one Marketplace survey to unlock 100 Frozen points" prompt. (Story 7.2 fleshes the activation step out; 7.1 owns routing + the handoff only.)
8. **Frontend contract parity.** The mock repository enforces the same rules (feed + start attempt throw `DEMOGRAPHIC_PROFILE_REQUIRED`; `submitDemographicSurvey` validates every field and returns `nextStep`/`redirectUrl`), and a typed live-API client exists for `GET/PUT /demographics` and `POST /demographics/survey`.
9. **Regression safety.** Existing e2e specs that start attempts or read the feed seed complete profiles (the rule is not weakened); new tests cover the rejection path at unit, e2e and frontend level. Full verification (`verify.sh`) is green.

## Tasks / Subtasks

- [x] **Task 1 — Shared schema: one definition of "complete" (AC: 2, 4, 5)**
  - [x] 1.1 In `packages/schemas/src/users/demographic-profile.schema.ts` add `REQUIRED_DEMOGRAPHIC_FIELDS`, `DemographicProfileField`, `getMissingDemographicFields(profile)`; re-implement `isProfileCompleted` on top of it (all 7 FR-6 fields; interests = array with ≥1 non-blank string; record-shaped interests do NOT count).
  - [x] 1.2 Add strict `submitDemographicSurveySchema` (all fields required, trimmed non-empty strings ≤100, age int 13–100, gender enum, interests array 1..30 of trimmed non-empty strings ≤100).
  - [x] 1.3 Add response schemas/types: `demographicProfileStatusSchema` (`{ profile, isComplete, missingFields }`), `DEMOGRAPHIC_ONBOARDING_NEXT_STEPS` / `demographicSurveySubmissionResultSchema` (`… & { nextStep }`), constant `DEMOGRAPHIC_PROFILE_REQUIRED_CODE = 'DEMOGRAPHIC_PROFILE_REQUIRED'`.
  - [x] 1.4 New `packages/schemas/src/users/demographic-profile.schema.spec.ts` covering completeness edge cases + strict schema.
- [x] **Task 2 — Backend: unify completeness + gate (AC: 2, 3)**
  - [x] 2.1 `DemographicProfileEntity.isComplete()` / new `missingFields()` delegate to the shared functions.
  - [x] 2.2 `prisma-demographic-profile.repository.ts`: export the raw→entity mapper (`toDemographicProfileEntity`) and stop leaking the packed JSON (gender/occupation/fieldOfStudy) as `specificInterests` when `customInterests` is absent (legacy array rows still map through).
  - [x] 2.3 `PrismaStarterPointsDataProvider.isDemographicComplete` uses that mapper + `isComplete()` (no private copy of the rule).
  - [x] 2.4 `users/application/exceptions/demographics.exceptions.ts`: `DemographicProfileRequiredException` (`code = 'DEMOGRAPHIC_PROFILE_REQUIRED'`, `missingFields`). Map to 403 + `details: { missingFields }` in `http-exception.filter.ts` (+ filter spec case).
  - [x] 2.5 `users/application/demographic-profile.gate.ts`: `requireCompleteDemographicProfile(repo, userId)` → returns the DTO or throws.
  - [x] 2.6 `ParticipationService.startAttempt`: for authenticated users call the gate first (before form lookup, before any reservation) and reuse the returned profile for targeting. Guest (`userId = null`) path unchanged.
  - [x] 2.7 `MarketplaceService.getFeed`: call the gate first; `profileCompleted` stays in the DTO (always `true` on success) for contract compatibility.
  - [x] 2.8 Unit tests: participation + marketplace services reject incomplete/missing profiles with the new exception and create no attempt; existing specs seed complete profiles.
- [x] **Task 3 — Backend: demographics API (AC: 4, 5, 6)**
  - [x] 3.1 `DemographicsService.getProfile/updateProfile` return `missingFields`; new `submitMandatorySurvey(userId, input)` (strict parse, upsert, unlock check, `nextStep` from `StarterPointsCoordinator.getStatus` → `COMPLETED` when unlocked or a Marketplace survey is already completed, else `MARKETPLACE_ACTIVATION`; no coordinator → `MARKETPLACE_ACTIVATION`).
  - [x] 3.2 `DemographicsController`: `POST /demographics/survey` (CsrfGuard + JsonOnlyGuard + `ZodValidationPipe(submitDemographicSurveySchema)`, 200); register routes under `demographics` and `api/demographics`.
  - [x] 3.3 Service + controller unit specs (incl. strict validation, unlock trigger, nextStep, missingFields).
- [x] **Task 4 — Backend e2e (AC: 3, 4, 6, 9)**
  - [x] 4.1 Shared e2e fixture `apps/backend/test/fixtures/demographic-profile.fixture.ts` (complete FR-6 profile + overrides helper).
  - [x] 4.2 Seed complete profiles in `survey-attempt`, `participation-submission`, `marketplace-feed`, `survey-moderation` (and any other spec that turns out to start attempts / read the feed); convert the "new user feed shows profileCompleted=false" case into the 403 rejection case.
  - [x] 4.3 New `test/demographic-onboarding.e2e-spec.ts`: GET incomplete status, feed/start-attempt 403 `DEMOGRAPHIC_PROFILE_REQUIRED`, strict submission 400, CSRF required, successful submission → `nextStep: MARKETPLACE_ACTIVATION`, feed + attempt now allowed, Frozen points still Frozen (in-memory ledger), PUT partial update reports `missingFields`.
- [x] **Task 5 — Frontend mock + live client (AC: 1, 7, 8)**
  - [x] 5.1 `lib/mock/repository.ts`: `getOnboardingStatus()`, private gate throwing `repositoryError(…, 'DEMOGRAPHIC_PROFILE_REQUIRED', { missingFields })` in `getMarketplaceFeed` + `startSurveyAttempt`; `submitDemographicSurvey(input)` (strict shared schema → `VALIDATION_ERROR` with field details; returns `{ profile, isComplete, missingFields, nextStep, redirectUrl }`); `isOnboarded` derived from the shared definition on every save.
  - [x] 5.2 `lib/onboarding.ts` (pure helpers: `ONBOARDING_PATH`, `MARKETPLACE_ACTIVATION_PATH`, `buildOnboardingRedirect(returnTo)`, `sanitizeReturnTo`, `isDemographicProfileRequiredError`) + `lib/use-onboarding-guard.ts` client hook (redirect to `/login` or `/onboarding?returnTo=…`).
  - [x] 5.3 `app/onboarding/demographics-api.ts` typed live client (`fetchDemographicProfile`, `updateDemographicProfile`, `submitDemographicSurvey`) validating responses with the shared schemas; errors carry `code`/`details`.
- [x] **Task 6 — Frontend pages (AC: 1, 7)**
  - [x] 6.1 Marketplace page: guard before fetching; handle `DEMOGRAPHIC_PROFILE_REQUIRED` from the feed; replace the unreachable "profile incomplete" banner with the `?activation=1` handoff prompt (Bước 2/2).
  - [x] 6.2 `MarketplaceCard`, `forms/[id]/respond`, `attempts/[id]`, dashboard "start survey": redirect to onboarding on `DEMOGRAPHIC_PROFILE_REQUIRED`; respond + attempts pages use the guard hook.
  - [x] 6.3 Dashboard: un-onboarded users do not load the feed; the recommendations area shows a locked state with the onboarding CTA.
  - [x] 6.4 Onboarding wizard: validate every field per step (incl. ≥1 interest, 17+ interest categories per FR-6), submit via `submitDemographicSurvey`, show the "why you are here" notice when redirected, then `router.replace(result.redirectUrl)`.
- [x] **Task 7 — Frontend tests (AC: 8, 9)**
  - [x] 7.1 Update `lib/mock/repository.test.mjs` and `tests/respondent-journey.test.mjs` for the gate (pre-onboarding feed/start now reject).
  - [x] 7.2 New `tests/onboarding-gate.test.mjs` (mock gate, strict submission, handoff, frozen points unchanged, helpers) and `tests/demographics-api.test.mjs` (live client).
- [x] **Task 8 — Verification & bookkeeping (AC: 9)**
  - [x] 8.1 `npx eslint "{src,test}/**/*.ts" --fix` in apps/backend; frontend lint/typecheck.
  - [x] 8.2 Run `verify.sh`; all green (3 skipped Postgres-gated ledger tests expected).
  - [x] 8.3 Story file Dev Agent Record + File List; sprint-status → `review`; append deferred items to `deferred-work.md`.

### Review Findings

Code review 2026-09-26 (Epic 7, full mode: Blind Hunter + Edge Case Hunter + Acceptance Auditor). This story owns no `decision-needed` item; Epic 7's decisions E7-DN1..DN3 belong to Story 7.2. All patches were applied (option "Apply every patch").

- [x] [Review][Patch] P1 (medium) Open redirect: `sanitizeReturnTo` could be bypassed with an embedded tab/CR/LF (`"/\t/evil.example"` resolves to `https://evil.example/`); `"/onboarding#x"` was not rejected. Now rejects any control character in the raw value, resolves against a placeholder origin and requires it to stay same-origin, rejects every form of the onboarding path and returns the normalized `pathname + search + hash` [apps/frontend/my-app/lib/onboarding.ts:34]
- [x] [Review][Patch] P4 (low) `nextStep` sent PENDING_CONFIRMATION, EXPIRED and NOT_GRANTED users to the activation step and dropped their `returnTo`. Backend and mock now return `MARKETPLACE_ACTIVATION` only for `SURVEY_REQUIRED`/`DEMOGRAPHICS_REQUIRED` (status-read failure and "no coordinator" still fall back to it) [apps/backend/src/modules/users/application/demographics.service.ts:97, apps/frontend/my-app/lib/mock/repository.ts:624]
- [x] [Review][Patch] P6 (low) The demographic `upsert` is a native `INSERT … ON CONFLICT DO UPDATE` in Prisma 6, so the Epic 4 P15 P2002 retry was dead code and two concurrent first-time partial writes lost fields. The write now runs `createMany({ skipDuplicates: true })` → `SELECT … FOR UPDATE` (always locks a row) → merge → `update`; the retry and `isUniqueViolation` are gone [apps/backend/src/modules/users/infrastructure/prisma-demographic-profile.repository.ts:92]
- [x] [Review][Patch] P8 (low) A stale persisted `isOnboarded` made the dashboard fail silently (blank wallet, no redirect). The mock derives `isOnboarded` from the stored profile on every read (`getCurrentUser`, `getCurrentSession`, `login`, `switchDemoUser`); the dashboard loads wallet and feed independently (`Promise.allSettled`) and redirects to onboarding on `DEMOGRAPHIC_PROFILE_REQUIRED` [apps/frontend/my-app/lib/mock/repository.ts:252, apps/frontend/my-app/app/dashboard/page.tsx:47]
- [x] [Review][Patch] P9 (low) The onboarding wizard hid saved values that are not in its option lists (demo fixture included). Catalogs moved to `lib/demographic-options.ts`; the fixture profile uses catalog values; a saved value outside a catalog is rendered as an extra select option / a selected, removable interest chip [apps/frontend/my-app/app/onboarding/page.tsx:396, apps/frontend/my-app/lib/demographic-options.ts]
- [x] [Review][Patch] P11 (low) The Wallet page said starter points unlock when the profile is completed (English copy, wrong rule). Both strings now state the FR-7/FR-8 rule in Vietnamese; the FR-34-contradicting "withdrawing"/"transfer" wording was removed in the same pass (the rest of the 6.x wallet copy is still English) [apps/frontend/my-app/app/wallet/page.tsx:258]
- [x] [Review][Patch] P12 (low) Mock parity: the Marketplace feed was served to signed-out callers. It now throws `AUTH_REQUIRED` before the 7.1 gate, like the backend's `SessionAuthGuard` [apps/frontend/my-app/lib/mock/repository.ts:750]
- [x] [Review][Patch] P13 (low) Mock parity: `null` never cleared a profile field, so the gate never re-engaged in the mock. `undefined` keeps, `null` (or a blank string) clears, matching `PUT /demographics` [apps/frontend/my-app/lib/mock/repository.ts:262]
- [x] [Review][Defer] DF5 Categorical fields are free strings and interests accept duplicates/junk that pass the FR-6 gate [packages/schemas/src/users/demographic-profile.schema.ts:203] — deferred, recorded design decision tied to Epic 4 DF16 (canonical catalogs); farming angle is E7-DN2
- [x] [Review][Defer] DF6 The profile can be rewritten just before a targeted survey and reverted afterwards (no cooldown/history/snapshot) [apps/backend/src/modules/users/application/demographics.service.ts:44] — deferred, already Epic 4 DF8; anti-gaming is Story 7.3 (Phase 2)
- [x] [Review][Defer] DF7 The e2e suites re-derive the eligibility rule in a test provider; Prisma query shapes, `FOR UPDATE` and the profile/unlock races never run against PostgreSQL [apps/backend/test/demographic-onboarding.e2e-spec.ts] — deferred, needs the Postgres test container (Epic 6 DF5); shared with Story 7.2
- [x] [Review][Defer] DF9 Integer age instead of FR-6 "age range"; FR-9 "academic year" not collected; no migration for older partial profiles [packages/schemas/src/users/demographic-profile.schema.ts:220] — deferred, recorded decisions awaiting PO confirmation (Epic 4 DF10)
- [x] [Review][Defer] DF10 The strict live-client response schema would reject a stored legacy value that violates `demographicProfileSchema`, so the user could neither load nor fix the profile [apps/frontend/my-app/app/onboarding/demographics-api.ts:43] — deferred, live client unused until the API swap and no legacy data exists

## Dev Notes

### What exists today (audit — read before changing)

| Piece | File | Current state | This story |
|---|---|---|---|
| Completeness rule (schemas) | `packages/schemas/src/users/demographic-profile.schema.ts` `isProfileCompleted` | age≥13 + gender + location only | Becomes the single full FR-6 rule |
| Entity rule | `apps/backend/src/modules/users/domain/demographic-profile.entity.ts` `isComplete()` | private copy of the 3-field rule | delegate |
| Starter-points rule | `apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.ts` `isDemographicComplete` | third private copy, reads gender from packed JSON | delegate via shared mapper |
| Prisma repo | `apps/backend/src/modules/users/infrastructure/prisma-demographic-profile.repository.ts` | `DemographicProfile` table has only `age`, `location`, `householdIncome`, `specificInterests Json`; gender/occupation/fieldOfStudy/interests are packed into `specificInterests` JSON (`customInterests` key holds the interest list) | keep storage (no migration), export mapper, fix interests fallback |
| Service/controller | `users/application/demographics.service.ts`, `users/presentation/demographics.controller.ts` (registered in `MarketplaceModule`, which imports `AuthModule`) | GET/PUT; PUT triggers `StarterPointsCoordinator.checkAndUnlockStarterPoints` when complete (Story 6.5) | add `missingFields`, POST `/demographics/survey` |
| Feed | `marketplace/application/marketplace.service.ts` | returns feed to anyone, `profileCompleted` flag | gate first |
| Start attempt | `participation/application/participation.service.ts#startAttempt` | targeting check with possibly-null profile; open surveys startable without profile | gate first (authenticated only) |
| Frontend onboarding | `apps/frontend/my-app/app/onboarding/page.tsx` | 3-step resumable wizard via mock repo; success card with links; interests not validated; 9 interest options | strict validation, 17+ interests, handoff redirect |
| Mock routing | `lib/mock/repository.ts` login/register return `/onboarding` for un-onboarded users; no guard on marketplace/survey pages; feed shows open surveys to un-onboarded users | add gate + guard hook |

- `EconomyModule` is `@Global()`, so `StarterPointsCoordinator` is injectable in `UsersModule` (already used optionally).
- The frontend `/api/*` rewrite strips `/api`, so the backend sees bare routes (`/demographics`). Adding the `api/demographics` alias follows the convention used by economy controllers.
- `app/marketplace/DemographicsCard.tsx` is an unused legacy live component (PUT /demographics); leave it alone.
- Public guest pages (`app/f/[id]`) use the live `/public/forms` API and must remain untouched.

### Design decisions (conservative, recorded for review)

- **Required fields = FR-6 list** (age, gender, region/province, occupation, academic major, income bracket, interests). FR-9 also lists "academic year", but FR-6 (the collection list for the mandatory survey) does not and no schema/DB field exists → not collected; logged in deferred-work.
- **Age stays an integer** (targeting uses `ageRange` against it); the UI may present it as a number input.
- **Interests** are free strings (bounded) server-side; the UI offers a fixed catalog of ≥17 Vietnamese categories. Validating against a server-side catalog is deferred.
- **Gate placement**: `requireCompleteDemographicProfile` runs before form lookup in `startAttempt`, so an un-onboarded user always gets `DEMOGRAPHIC_PROFILE_REQUIRED` (not 404/409) and no reservation is ever created. Submissions/code verification need an attempt, so they are covered transitively.
- **Feed gate**: the feed returns 403 for incomplete profiles; `profileCompleted` is kept in `MarketplaceFeedResponseDto` for compatibility and is always `true` in a 200 response.
- **All authenticated roles** are gated uniformly (every account is a potential Respondent in RESCOM's P2P model). Publisher/admin/wallet/top-up/forms features are not earning features and remain accessible.
- **PUT stays partial** (FR-9 edits). Clearing a field makes the profile incomplete again and re-engages the gate — consistent with a single profile-derived rule.
- **No Prisma migration**: storage layout is unchanged.
- **nextStep** is computed from `StarterPointsCoordinator.getStatus`. _Amended by code review P4 (2026-09-26):_ `MARKETPLACE_ACTIVATION` only while `activationState` is `SURVEY_REQUIRED` or `DEMOGRAPHICS_REQUIRED`; every other state (PENDING_CONFIRMATION, READY_TO_UNLOCK, ACTIVATED, EXPIRED, NOT_GRANTED) → `COMPLETED`, so `returnTo` is honoured. A failed status read still falls back to `MARKETPLACE_ACTIVATION`.

### Architecture compliance

- Clean Architecture guard (`apps/backend/test/architecture.spec.ts`): the gate helper, exception, and service changes live in `application/`/`domain/` and must import only `@rescom/schemas` and sibling application/domain code — no `@nestjs/*`, `@prisma/client`, or `*adapter*` imports.
- Identity context owns `DemographicProfile` (ARCHITECTURE-SPINE: "no other context writes users"); Participation/Marketplace only read through `DemographicProfileRepositoryPort`.
- Mutation endpoint conventions: `SessionAuthGuard` (class) + `CsrfGuard` + `JsonOnlyGuard` + `ZodValidationPipe`, `createSuccessEnvelope`.
- Domain exceptions carry `code`; HTTP mapping only in `http-exception.filter.ts`.

### Testing requirements

- Backend unit (`npm run test --workspace backend`), e2e (`npm run test:e2e --workspace backend`, WHOLE suite), schemas (`npm test --workspace @rescom/schemas` or via verify.sh), frontend `npm --prefix apps/frontend/my-app test`, typecheck, lint.
- e2e CSRF: `.set('x-csrf-token', tokens.csrfToken).set('Origin', 'http://localhost:3000')`. Controller unit specs instantiate the controller directly (no guard override needed) or `.overrideGuard(CsrfGuard)` when using the testing module.
- e2e specs boot the full `AppModule` with in-memory repositories; `DEMOGRAPHIC_PROFILE_REPOSITORY_PORT` is overridden with `InMemoryDemographicProfileRepository` in the relevant specs — seed complete profiles there. Do not call `app.listen()`.
- Frontend tests import TS files directly via `node --test` (type stripping); keep `lib/onboarding.ts` free of React/Next imports so it is testable.

### Previous story intelligence (Story 6.5 — Frozen Starter Points)

- Adding a new Prisma-backed dependency to an existing flow broke 4 e2e suites in 6.5 → this story adds none (the gate only uses the already-overridden demographic repository).
- `StarterPointsCoordinator.checkAndUnlockStarterPoints` is already triggered from demographics update, internal submission and external verification; unlock requires demographics complete AND one Marketplace survey. Strengthening the completeness rule tightens unlock eligibility consistently.
- Mock repo `checkAndUnlockFrozenPoints` relies on `user.isOnboarded`; keep that flag in sync with the shared rule.

### Project Structure Notes

- New files: `packages/schemas/src/users/demographic-profile.schema.spec.ts`, `apps/backend/src/modules/users/application/demographic-profile.gate.ts`, `apps/backend/src/modules/users/application/exceptions/demographics.exceptions.ts`, `apps/backend/test/fixtures/demographic-profile.fixture.ts`, `apps/backend/test/demographic-onboarding.e2e-spec.ts`, `apps/frontend/my-app/lib/onboarding.ts`, `apps/frontend/my-app/lib/use-onboarding-guard.ts`, `apps/frontend/my-app/app/onboarding/demographics-api.ts`, `apps/frontend/my-app/tests/onboarding-gate.test.mjs`, `apps/frontend/my-app/tests/demographics-api.test.mjs`.
- `apps/frontend/my-app` is a nested git repo; do not commit.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.1, #Story 7.2, #Story 6.5]
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#4.2 Onboarding & Point Activation (FR-6, FR-7, FR-8), #4.3 (FR-9)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md — Identity context ownership]
- [Source: _bmad-output/implementation-artifacts/spec-mock-respondent-journey.md — mock-first rules]
- [Source: _bmad-output/implementation-artifacts/6-5-frozen-starter-points-lifecycle.md — unlock hooks, e2e regressions]
- [Source: PROJECT_SUMMARY.md §6.2 Onboarding Flow]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Full verification (`verify.sh`, 2026-09-26): schemas 234/234, backend unit 929/929 (81 suites), backend e2e 240 passed / 3 skipped (27 suites; the 3 skips are the Postgres-gated ledger tests), frontend 105/105, typecheck clean, lint clean, `prisma validate` clean. Logs: scratchpad `log-*.txt`.
- Red phases observed: schema spec (missing exports), gate spec (missing module), mapper/provider specs (missing export; 3-field rule still "complete"), filter spec (no mapping), participation/marketplace specs (no gate), demographics service/controller specs (no `missingFields`/`submitMandatorySurvey`), frontend gate + live-client tests (missing modules/methods).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **One definition of "complete"**: `getMissingDemographicFields` / `isProfileCompleted` in `@rescom/schemas` now require all 7 FR-6 fields (age int 13–100, gender enum, location, occupation, fieldOfStudy, householdIncome, ≥1 non-blank interest; record-shaped interests never count). `DemographicProfileEntity.isComplete()/missingFields()`, `PrismaStarterPointsDataProvider.isDemographicComplete` (via the shared `toDemographicProfileEntity` mapper), `MarketplaceService`, `ParticipationService` and the mock repository all delegate to it — the three private copies of the old 3-field rule are gone.
- **Server-side gate**: `requireCompleteDemographicProfile` (users/application) throws `DemographicProfileRequiredException` (`DEMOGRAPHIC_PROFILE_REQUIRED`, mapped to 403 with `details.missingFields`). It runs first in `startAttempt` for authenticated users (before form lookup / quota / reservation; guest `userId = null` path unchanged) and in `getFeed`. `profileCompleted` stays in the feed DTO (always `true` on a 200). Public guest routes (`/public/forms/*`) are untouched.
- **API**: `GET/PUT /demographics` return `{ profile, isComplete, missingFields }`; new `POST /demographics/survey` (Session + CSRF + JSON-only + strict `submitDemographicSurveySchema`) upserts, re-runs the Story 6.5 unlock check and returns `nextStep` (`MARKETPLACE_ACTIVATION` unless the starter points are already unlocked or a Marketplace survey was completed → `COMPLETED`). Controller now also answers under `api/demographics`.
- **Prisma mapper fix**: rows whose JSON column has no `customInterests` no longer leak the packed `{gender, occupation, fieldOfStudy}` object as `specificInterests`; legacy array rows are preserved on read and on upsert. No schema change / migration.
- **Starter points stay Frozen** after the survey (asserted in the new e2e via the wallet and `/economy/starter-points/status`).
- **E2E**: new shared fixture `test/fixtures/demographic-profile.fixture.ts`; complete profiles are seeded in `survey-attempt`, `participation-submission`, `marketplace-feed`, `survey-moderation` (the only suites that start attempts or read the feed over HTTP); the old "new user sees open surveys" case became the 403 rejection case. New `demographic-onboarding.e2e-spec.ts` (6 tests) covers status, feed/attempt rejection with no reservation created, strict 400, CSRF, happy path + Frozen points, and gate re-engagement after a profile edit clears a field.
- **Frontend (mock-first)**: mock repository gates `getMarketplaceFeed`/`startSurveyAttempt` with the same code, adds `getOnboardingStatus()` and `submitDemographicSurvey()` (strict shared schema → `VALIDATION_ERROR` + `details.fields`; returns `nextStep` + `redirectUrl`), and keeps `isOnboarded` in sync with the shared rule. New pure helpers `lib/onboarding.ts` and client hook `lib/use-onboarding-guard.ts` redirect signed-out users to `/login` and incomplete profiles to `/onboarding?required=1&returnTo=…` (same-origin paths only). Marketplace, `/forms/[id]/respond` and `/attempts/[id]` use the guard and also redirect on the error code; MarketplaceCard and dashboard "start survey" redirect on the code; the dashboard shows a locked Marketplace state instead of loading the feed for un-onboarded users. Onboarding wizard: answers start empty, every field validated per step (incl. ≥1 interest), 18 interest categories, strict submission, "why you are here" notice, then `router.replace` to `/marketplace?activation=1` where a "Bước 2/2" activation prompt is shown (Story 7.2 will flesh the step out). Typed live client `app/onboarding/demographics-api.ts` for GET/PUT/POST.
- **Code review 2026-09-26 (Epic 7):** applied P1 (open-redirect fix in `sanitizeReturnTo`), P4 (`nextStep` from the activation state, backend + mock), P6 (profile write = `createMany skipDuplicates` + `FOR UPDATE` + `update`; dead P2002 retry removed), P8 (mock derives `isOnboarded` on read; dashboard loads wallet/feed independently and redirects on the gate code), P9 (shared option catalogs, catalog-aligned fixture, saved off-catalog values stay visible), P11 (Vietnamese Wallet copy stating the real unlock rule), P12 (mock feed requires sign-in), P13 (mock `null` clears a field). 5 items deferred (DF5, DF6, DF7, DF9, DF10). Behaviour changes: a crafted `returnTo` with control characters now falls back to the default page; a re-submitted survey sends PENDING_CONFIRMATION/EXPIRED users to `/marketplace` instead of the activation step; the mock feed rejects signed-out callers with `AUTH_REQUIRED`.
- **Decisions** (also in Dev Notes): FR-6 list is the required set (FR-9 "academic year" not collected); all authenticated roles are gated uniformly; PUT stays partial; `useSearchParams` pages are wrapped in `Suspense` (same pattern as the login page). Deferred items appended to `deferred-work.md`.

### File List

- `packages/schemas/src/users/demographic-profile.schema.ts` (modified)
- `packages/schemas/src/users/demographic-profile.schema.spec.ts` (new)
- `packages/schemas/src/marketplace/marketplace.schema.ts` (modified — `profileCompleted` doc comment)
- `apps/backend/src/modules/users/application/demographic-profile.gate.ts` (new)
- `apps/backend/src/modules/users/application/demographic-profile.gate.spec.ts` (new)
- `apps/backend/src/modules/users/application/exceptions/demographics.exceptions.ts` (new)
- `apps/backend/src/modules/users/application/demographics.service.ts` (modified)
- `apps/backend/src/modules/users/application/demographics.service.spec.ts` (modified)
- `apps/backend/src/modules/users/domain/demographic-profile.entity.ts` (modified)
- `apps/backend/src/modules/users/infrastructure/prisma-demographic-profile.repository.ts` (modified)
- `apps/backend/src/modules/users/infrastructure/prisma-demographic-profile.repository.spec.ts` (new)
- `apps/backend/src/modules/users/presentation/demographics.controller.ts` (modified)
- `apps/backend/src/modules/users/presentation/demographics.controller.spec.ts` (modified)
- `apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.ts` (modified)
- `apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.spec.ts` (new)
- `apps/backend/src/modules/participation/application/participation.service.ts` (modified)
- `apps/backend/src/modules/participation/application/participation.service.spec.ts` (modified)
- `apps/backend/src/modules/marketplace/application/marketplace.service.ts` (modified)
- `apps/backend/src/modules/marketplace/application/marketplace.service.spec.ts` (modified)
- `apps/backend/src/modules/marketplace/presentation/marketplace.controller.spec.ts` (modified)
- `apps/backend/src/modules/marketplace/presentation/survey-matching.spec.ts` (modified)
- `apps/backend/src/common/http/http-exception.filter.ts` (modified)
- `apps/backend/src/common/http/http-exception.filter.spec.ts` (modified)
- `apps/backend/test/fixtures/demographic-profile.fixture.ts` (new)
- `apps/backend/test/demographic-onboarding.e2e-spec.ts` (new)
- `apps/backend/test/survey-attempt.e2e-spec.ts` (modified)
- `apps/backend/test/marketplace-feed.e2e-spec.ts` (modified)
- `apps/backend/test/participation-submission.e2e-spec.ts` (modified)
- `apps/backend/test/survey-moderation.e2e-spec.ts` (modified)
- `apps/frontend/my-app/lib/onboarding.ts` (new)
- `apps/frontend/my-app/lib/use-onboarding-guard.ts` (new)
- `apps/frontend/my-app/lib/mock/repository.ts` (modified)
- `apps/frontend/my-app/lib/mock/types.ts` (modified)
- `apps/frontend/my-app/lib/mock/repository.test.mjs` (modified)
- `apps/frontend/my-app/app/onboarding/page.tsx` (modified)
- `apps/frontend/my-app/app/onboarding/demographics-api.ts` (new)
- `apps/frontend/my-app/app/marketplace/page.tsx` (modified)
- `apps/frontend/my-app/app/marketplace/MarketplaceCard.tsx` (modified)
- `apps/frontend/my-app/app/dashboard/page.tsx` (modified)
- `apps/frontend/my-app/app/forms/[id]/respond/page.tsx` (modified)
- `apps/frontend/my-app/app/attempts/[id]/page.tsx` (modified)
- `apps/frontend/my-app/tests/onboarding-gate.test.mjs` (new)
- `apps/frontend/my-app/tests/demographics-api.test.mjs` (new)
- `apps/frontend/my-app/tests/respondent-journey.test.mjs` (modified)
- `apps/frontend/my-app/tests/notifications.test.mjs` (modified)
- `apps/frontend/my-app/lib/demographic-options.ts` (new — code review P9)
- `apps/frontend/my-app/lib/mock/fixtures.ts` (modified — code review P9)
- `apps/frontend/my-app/app/wallet/page.tsx` (modified — code review P11)
- `_bmad-output/implementation-artifacts/7-1-mandatory-demographic-survey.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified)

### Change Log

- 2026-09-26: Story created (ready-for-dev); epic-7 → in-progress.
- 2026-09-26: Implemented Tasks 1–8 — shared FR-6 completeness rule, server-side `DEMOGRAPHIC_PROFILE_REQUIRED` gate on feed + survey attempts, `POST /demographics/survey` with `nextStep`, Prisma mapper fix, e2e seeding + new onboarding e2e, mock gate + guard hook + onboarding wizard handoff to the Marketplace activation step, typed live client. Full verification green. Status → review.
- 2026-09-26: Code review 2026-09-26 (Epic 7): applied P1, P4, P6, P8, P9, P11, P12, P13 with tests; 5 items deferred to `deferred-work.md`; no decision items owned by this story. Status → done.
