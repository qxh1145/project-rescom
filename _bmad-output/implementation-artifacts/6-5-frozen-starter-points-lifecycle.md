---
baseline_commit: 378e4a71ff125fb1acf6ee18291fc298ae56bf94
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "_bmad-output/implementation-artifacts/6-1-double-entry-ledger-core-idempotency.md"
  - "_bmad-output/implementation-artifacts/6-2-wallet-balance-aggregation-presentation.md"
  - "_bmad-output/implementation-artifacts/6-3-escrow-lock-release-refund.md"
  - "_bmad-output/implementation-artifacts/6-4-respondent-point-credit-pending-logic.md"
  - "apps/backend/src/modules/economy/application/ledger.service.ts"
  - "apps/backend/src/modules/auth/application/auth.service.ts"
  - "apps/backend/src/modules/auth/application/google-oauth.service.ts"
  - "apps/backend/src/modules/users/application/demographics.service.ts"
  - "apps/backend/src/modules/participation/application/participation.service.ts"
---

# Story 6.5: Frozen Starter Points Lifecycle

Status: done

## Story

As a New User,
I want to receive starter points that unlock when I complete my profile,
So that I am incentivized to fill out my demographic data.

## Acceptance Criteria

### AC1 — Shared Schemas & Types for Starter Points Lifecycle (`packages/schemas`, FR-4, FR-5, FR-8)
**Given** starter points lifecycle operations (granting upon registration, unlock on onboarding completion, 30-day expiry)
**When** validating or executing starter points operations
**Then**:
1. Defines Zod schemas and TypeScript DTOs in `packages/schemas/src/economy/starter-points.schema.ts`:
   - `grantStarterPointsSchema` / `GrantStarterPointsInput`: `{ userId: string (uuid), amount?: number (> 0, default: 100) }`
   - `unlockStarterPointsSchema` / `UnlockStarterPointsInput`: `{ userId: string (uuid) }`
   - `expireStarterPointsSchema` / `ExpireStarterPointsInput`: `{ cutoffDate?: string (datetime, optional) }`
   - `starterPointsStatusSchema` / `StarterPointsStatusDto`:
     - `userId`: string (uuid)
     - `isGranted`: boolean
     - `frozenBalance`: number
     - `isDemographicComplete`: boolean
     - `hasCompletedMarketplaceSurvey`: boolean
     - `isUnlocked`: boolean
     - `isExpired`: boolean
     - `registeredAt`: string (datetime)
     - `expiresAt`: string (datetime)
     - `daysRemaining`: number
     - `unlockEligibility`: `{ eligible: boolean; missingSteps: string[] }`
   - `expireStarterPointsResultSchema` / `ExpireStarterPointsResultDto`:
     - `scannedCount`: number
     - `expiredCount`: number
     - `expiredUserIds`: string[] (uuid array)
     - `totalPointsVoided`: number
     - `timestamp`: string (datetime)
2. All schemas export parse and validate functions with unit tests in `packages/schemas/src/economy/starter-points.schema.spec.ts`.

### AC2 — Double-Entry Starter Points Granting (`apps/backend`, FR-4, AD-16)
**Given** a newly registered account (via password registration or Google OAuth)
**When** the account is created
**Then**:
1. `LedgerService.grantStarterPoints`:
   - Atomically transfers 100 points from `SYSTEM_ISSUANCE` (system account, `userId: null`) to the user's `FROZEN` ledger account.
   - Enforces double-entry ledger rules (sum of journal entries = 0).
   - Fast-path idempotency keyed by `starter-grant:${userId}`.
   - Description: `Starter points grant: ${userId}`.
2. Hooked into:
   - `AuthService.register`: grants starter points upon successful user registration.
   - `GoogleOAuthService.handleCallback`: grants starter points when a new user is created via OAuth (`isNewUser === true`).
3. If the grant was already processed for `userId`, returns existing journal idempotently without error.

### AC3 — Starter Points Activation & Unlock (`apps/backend`, FR-8, AD-16)
**Given** a user with frozen starter points
**When** they successfully complete the Mandatory Demographic Survey and 1 additional marketplace survey
**Then**:
1. `StarterPointsCoordinator.checkAndUnlockStarterPoints`:
   - Checks onboarding criteria:
     a) Demographic profile complete (`DemographicsService.getProfile(userId).isComplete === true`).
     b) At least 1 marketplace survey completed (`Response` in `VALIDATED` status or `SurveyAttempt` in `COMPLETED` status).
     c) Account within 30-day registration window (`createdAt >= now - 30 days`).
     d) User has frozen balance to unlock (`FROZEN` balance > 0).
   - When all conditions are satisfied:
     - Atomically transfers 100 points from user's `FROZEN` account to user's `USER_AVAILABLE` account.
     - Fast-path idempotency keyed by `starter-unlock:${userId}`.
     - Description: `Starter points onboarding unlock: ${userId}`.
     - Creates an in-app `Notification`:
       - `userId`: user's id
       - `type`: `TOPUP_SUCCESS`
       - `message`: `Congratulations! Your 100 starter points have been unlocked to your Available balance.`
     - Returns `{ unlocked: true, journalId: string, amount: 100 }`.
   - When conditions are NOT satisfied:
     - Returns `{ unlocked: false, missingSteps: string[] }`.
2. Automatically evaluated on:
   - Demographic profile update in `DemographicsService.updateProfile`.
   - Survey submission in `ParticipationService.submitInternalResponse`.

### AC4 — 30-Day Starter Points Expiry Scheduled Worker (`apps/backend`, FR-5, AD-16)
**Given** accounts created more than 30 days ago that have not completed onboarding
**When** `StarterPointsCoordinator.expireUnmaturedStarterPoints` runs
**Then**:
1. Scans users registered on or before `cutoffDate` (default: `now - 30 days`) who have:
   - Incomplete demographic profile OR 0 completed marketplace surveys.
   - `FROZEN` balance > 0.
2. For each eligible user:
   - Atomically transfers remaining `FROZEN` balance from user's `FROZEN` account to `SYSTEM_SINK` (system account, `userId: null`).
   - Fast-path idempotency keyed by `starter-expiry:${userId}`.
   - Description: `Starter points 30-day onboarding expiry: ${userId}`.
   - Creates an in-app `Notification`:
     - `userId`: user's id
     - `type`: `WARNING`
     - `message`: `Your 100 frozen starter points have expired because onboarding was not completed within 30 days of registration.`
3. Returns `ExpireStarterPointsResultDto` detailing scanned count, expired count, affected user IDs, and voided point sum.

### AC5 — Presentation Endpoints & Wire-Up (`apps/backend`, FR-4, FR-5, FR-8)
**Given** authenticated requests and worker/admin triggers
**When** invoking starter points endpoints
**Then**:
1. Exposes endpoints in `StarterPointsController` (route: `/economy/starter-points`):
   - `GET /economy/starter-points/status`: Returns current `StarterPointsStatusDto` for authenticated user.
   - `POST /economy/starter-points/unlock`: Evaluates eligibility and unlocks starter points for authenticated user.
   - `POST /economy/starter-points/expire`: Admin/worker endpoint to trigger 30-day expiry sweep with optional `cutoffDate`.
2. Registers `StarterPointsCoordinator` and `StarterPointsController` in `EconomyModule`.
3. Handles unauthorized access with standard 401/403 responses.

### AC6 — End-to-End & Regression Verification
**Given** the complete suite of tests
**When** running verification across all workspaces
**Then**:
1. All unit tests for schemas, ledger operations, coordinator, and controllers pass 100%.
2. E2E tests in `apps/backend/test/starter-points.e2e-spec.ts` pass 100%.
3. Full test suites for `@rescom/schemas`, `backend`, and `frontend` pass with zero regressions.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Schemas & DTOs in `@rescom/schemas`** (AC: 1)
  - [x] 1.1 Create `packages/schemas/src/economy/starter-points.schema.ts` with Zod schemas and DTO types (`grantStarterPointsSchema`, `unlockStarterPointsSchema`, `expireStarterPointsSchema`, `starterPointsStatusSchema`, `expireStarterPointsResultSchema`).
  - [x] 1.2 Export new schemas and types from `packages/schemas/src/economy/index.ts` and `packages/schemas/src/index.ts`.
  - [x] 1.3 Author unit tests in `packages/schemas/src/economy/starter-points.schema.spec.ts`.

- [x] **Task 2: Ledger Service Starter Points Operations in `apps/backend`** (AC: 2, 3, 4)
  - [x] 2.1 Add `grantStarterPoints(userId, amount)` to `LedgerService` (`SYSTEM_ISSUANCE` -> `FROZEN`, idempotency: `starter-grant:${userId}`).
  - [x] 2.2 Add `unlockStarterPoints(userId, amount)` to `LedgerService` (`FROZEN` -> `USER_AVAILABLE`, idempotency: `starter-unlock:${userId}`).
  - [x] 2.3 Add `expireStarterPoints(userId, amount)` to `LedgerService` (`FROZEN` -> `SYSTEM_SINK`, idempotency: `starter-expiry:${userId}`).
  - [x] 2.4 Author unit tests for new methods in `apps/backend/src/modules/economy/application/ledger.service.spec.ts`.

- [x] **Task 3: Starter Points Coordinator & Service Lifecycle in `apps/backend`** (AC: 2, 3, 4)
  - [x] 3.1 Create `StarterPointsCoordinator` in `apps/backend/src/modules/economy/application/starter-points.coordinator.ts`.
  - [x] 3.2 Implement `getStatus(userId)` aggregating grant date, frozen balance, demographic completion, marketplace completion, and expiry info.
  - [x] 3.3 Implement `checkAndUnlockStarterPoints(userId)` with demographic & marketplace completion validation, ledger transfer, and in-app notification.
  - [x] 3.4 Implement `expireUnmaturedStarterPoints(cutoffDate)` finding expired onboarding accounts and voiding frozen points to `SYSTEM_SINK` with user notifications.
  - [x] 3.5 Author comprehensive unit tests in `apps/backend/src/modules/economy/application/starter-points.coordinator.spec.ts`.

- [x] **Task 4: Registration & Lifecycle Hooks Wire-Up in `apps/backend`** (AC: 2, 3)
  - [x] 4.1 Wire starter points grant into `AuthService.register` on user registration.
  - [x] 4.2 Wire starter points grant into `GoogleOAuthService` on new user OAuth callback.
  - [x] 4.3 Wire unlock check into `DemographicsService.updateProfile` upon demographic completion.
  - [x] 4.4 Wire unlock check into `ParticipationService.submitInternalResponse` upon marketplace survey completion.
  - [x] 4.5 Update auth, demographics, and participation specs to verify starter points lifecycle integration.

- [x] **Task 5: Presentation Endpoints & Module Wire-Up in `apps/backend`** (AC: 5)
  - [x] 5.1 Create `StarterPointsController` with `GET /economy/starter-points/status`, `POST /economy/starter-points/unlock`, `POST /economy/starter-points/expire`.
  - [x] 5.2 Register `StarterPointsCoordinator` and `StarterPointsController` in `EconomyModule`.
  - [x] 5.3 Author controller tests in `apps/backend/src/modules/economy/presentation/starter-points.controller.spec.ts`.

- [x] **Task 6: End-to-End & Regression Verification** (AC: 6)
  - [x] 6.1 Author comprehensive E2E tests in `apps/backend/test/starter-points.e2e-spec.ts`.
  - [x] 6.2 Run full test suite across `@rescom/schemas`, `backend`, and `frontend` to ensure 0 regressions.

### Review Findings

_Epic 6 code review of 2026-09-26 (triage IDs P/DF in brackets); findings of Stories 6.3–6.6 were triaged together and this list holds the ones that belong to 6.5. The replay-compatibility fix for the starter grant/unlock/expiry fast paths (P8) is tracked in Story 6.4._

- [x] [Review][Patch] The starter-points grant was not atomic with account creation and never recovered (P10, medium) — fixed: new idempotent, never-throwing `StarterPointsCoordinator.ensureStarterGrant(userId)` (grants only when there is no `starter-grant:` and no `starter-expiry:` journal and a known registration date is within the 30-day window; logs a warning without balances on failure). It replaces the direct grant in `AuthService.register` (both branches — registration now returns 201 even when the grant fails), runs after every successful password login and every Google login (not only new users), and at the start of `getStatus` and `tryUnlockStarterPoints`, so a failed grant self-heals exactly once. Tests: register-then-heal via login/status, second Google login heals, no grant after 30 days / after expiry / unknown registration date. [apps/backend/src/modules/economy/application/starter-points.coordinator.ts:170]
- [x] [Review][Patch] The starter-points expiry sweep was unbounded (P15, low) — fixed: `expireStarterPointsSchema` adds `limit` (1..500, default 100) and an opaque base64url cursor `after` (`{registeredAt, userId}`, only server-issued tokens accepted); candidates are ordered by `(users.created_at, user id)` in both data providers; the result adds `nextCursor` (null on the last page), which lies after every scanned candidate so deferred, caught-up and failed users never block the next batch; a bad cursor/limit is a 400. Tests: two-page sweep with a registration-date tie, deferred/failed users do not block, invalid cursor 400, schema bounds. [apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.ts:104]
- [x] [Review][Defer] No scheduled worker runs the 30-day starter expiry; only the Admin endpoint does (DF2, medium) [apps/backend/src/modules/economy/presentation/starter-points.controller.ts:54] — deferred: same missing AD-5/AD-17 worker infrastructure (`deferred-work.md`, Story 7.2 entry "No scheduler yet for the activation catch-up / expiry sweep"); the Admin/worker endpoint with a cutoff exists (AC5.1) and P15 makes it chunkable.
- [x] [Review][Defer] Economy reads Participation and Identity tables directly (AD-16) (DF7, low) [apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.ts:14] — deferred: already recorded (`deferred-work.md`, Story 7.2 entry "Activation reads Participation tables from Economy"); a Participation-owned query port is blocked by the circular module dependency. The Epic 6 P4 close refund adds a similar Research-side read of `responses`/`survey_attempts`.
- [x] [Review][Defer] Every starter grant, expiry and top-up approval row-locks one global system account (DF8, low, also 6.6) [apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts:221] — deferred: the architecture requires locking all affected rows and the projection `UPDATE` locks the row anyway; a scale concern at MVP volume that needs sharded system accounts.
- [x] [Review][Defer] System-account balances could pass INT4 min after ~2.1B points issued (DF9, low, also 6.1/6.6) [apps/backend/prisma/schema.prisma:449] — deferred: unreachable at MVP scale (~21M starter grants or ~43k maximum top-ups); BIGINT needs a schema migration.
- [x] [Review][Defer] Activation lookup limited to 20 completions, so 20 reversed External completions can hide a valid 21st (DF10, low, Story 7.2 logic) [apps/backend/src/modules/economy/application/starter-points.coordinator.ts] — deferred: not an Epic 6 AC; needs 20 Admin reversals for one user.
- [x] [Review][Defer] A disputed but unreversed External completion still counts for activation after 48 h (DF11, low, Story 7.2/8.5) [apps/backend/src/modules/economy/application/starter-points.coordinator.ts] — deferred: already recorded (`deferred-work.md`, Story 7.2 entry on the review window); no dispute→attempt link until Story 8.5.

---

## Dev Notes
- **Idempotency Keys:**
  - Grant starter points: `starter-grant:${userId}`
  - Unlock starter points: `starter-unlock:${userId}`
  - Expire starter points: `starter-expiry:${userId}`
- **Account Classes Involved:**
  - `SYSTEM_ISSUANCE`: System account emitting starter points.
  - `FROZEN`: User account holding locked starter points (non-spendable).
  - `USER_AVAILABLE`: User account holding spendable points.
  - `SYSTEM_SINK`: System account absorbing voided/expired points.
- **Onboarding Conditions for Unlock (FR-6, FR-7, FR-8):**
  - Demographic survey completed: `DemographicsService.getProfile(userId).isComplete === true` (checks age, gender, location).
  - Marketplace survey completed: at least 1 completed survey response (`status: VALIDATED` or attempt `status: COMPLETED`).
  - Window: within 30 days of user `createdAt`.
- **Expiry Rules (FR-5):**
  - Triggered after 30 days (`30 * 24 * 60 * 60 * 1000` ms) from user registration.
  - Points in `FROZEN` account voided to `SYSTEM_SINK`.
  - In-app notification created (`WARNING`).

---

## Dev Agent Record

### Agent Model Used
Claude Opus 5.5 (claude-opus-5-5) — completed Task 6 and regression hardening; Tasks 1–5 were implemented in a previous session.

### Implementation Plan
- Starter points move through three idempotent ledger journals: `starter-grant:${userId}` (`SYSTEM_ISSUANCE` → `FROZEN`), `starter-unlock:${userId}` (`FROZEN` → `USER_AVAILABLE`) and `starter-expiry:${userId}` (`FROZEN` → `SYSTEM_SINK`).
- `StarterPointsCoordinator` owns the eligibility rules and talks to persistence through the `StarterPointsUserDataProvider` port (Prisma adapter in production, in-memory adapter for tests).
- Registration (password and Google OAuth), demographic completion, and internal survey submission call the coordinator through optional injection, so modules that do not import Economy keep working.

### Debug Log References
- Baseline full e2e run: 4 suites / 12 tests failing (`auth`, `google-oauth`, `single-session`, `marketplace-feed`). Root cause: the registration grant and demographics unlock hooks reached `PrismaLedgerRepository` / `PrismaStarterPointsDataProvider` while those suites only mocked `PrismaService` (`Cannot read properties of undefined (reading 'findUnique')`).
- Lint baseline: 86 prettier problems plus one unused `adminCsrfToken` in the starter-points e2e spec, all inside Story 5.5 / 6.5 files.

### Completion Notes List
- Added `InMemoryStarterPointsDataProvider` and wired it, together with `InMemoryLedgerRepository`, into the four regressed e2e suites. All 23 e2e suites now pass (3 Postgres-gated ledger tests remain skipped by design via `RUN_LEDGER_POSTGRES_E2E`).
- Hardened `StarterPointsController`: `POST /unlock` now requires `CsrfGuard`, and `POST /expire` requires `RolesGuard` + `CsrfGuard` + `JsonOnlyGuard`, matching the mutation-endpoint convention from Story 1.6. The e2e spec sends `x-csrf-token` + `Origin`, and the controller unit spec overrides `CsrfGuard`.
- Applied prettier fixes (eslint `--fix`) to the Story 5.5 / 6.5 backend files. No behavioural changes.
- Verification (2026-09-26): schemas 158/158, backend unit 719/719, backend e2e 196 passed / 3 skipped, frontend 43/43, `npm run typecheck` clean, `npm run lint` clean.
- Starter-points endpoints are not yet consumed by the frontend; the mock-first respondent journey models the Frozen → Available unlock locally.
- Code review 2026-09-26: applied P10 (self-healing `ensureStarterGrant` on register/login/Google login/status/unlock) and P15 (bounded, cursor-paged expiry sweep); 6 findings deferred (DF2, DF7–DF11), no decisions. Behaviour changes: registration no longer fails when the grant fails, `GET /economy/starter-points/status` may write a missing grant, `POST /economy/starter-points/expire` accepts `limit`/`after` and returns `nextCursor`. Verification: schemas 343, backend unit 1183, backend e2e 275 passed / 3 skipped (30 suites), frontend 173, typecheck + lint clean.

### File List
- `packages/schemas/src/economy/starter-points.schema.ts` (new)
- `packages/schemas/src/economy/starter-points.schema.spec.ts` (new)
- `packages/schemas/src/economy/index.ts` (modified)
- `apps/backend/src/modules/economy/application/ledger.service.ts` (modified)
- `apps/backend/src/modules/economy/application/ledger.service.spec.ts` (modified)
- `apps/backend/src/modules/economy/application/starter-points.coordinator.ts` (new)
- `apps/backend/src/modules/economy/application/starter-points.coordinator.spec.ts` (new)
- `apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.ts` (new)
- `apps/backend/src/modules/economy/infrastructure/in-memory-starter-points-data-provider.ts` (new)
- `apps/backend/src/modules/economy/presentation/starter-points.controller.ts` (new)
- `apps/backend/src/modules/economy/presentation/starter-points.controller.spec.ts` (new)
- `apps/backend/src/modules/economy/economy.module.ts` (modified)
- `apps/backend/src/modules/auth/application/auth.service.ts` (modified)
- `apps/backend/src/modules/auth/application/auth.service.spec.ts` (modified)
- `apps/backend/src/modules/auth/application/google-oauth.service.ts` (modified)
- `apps/backend/src/modules/auth/application/google-oauth.service.spec.ts` (modified)
- `apps/backend/src/modules/auth/auth.module.ts` (modified)
- `apps/backend/src/modules/users/application/demographics.service.ts` (modified)
- `apps/backend/src/modules/users/application/demographics.service.spec.ts` (modified)
- `apps/backend/src/modules/users/users.module.ts` (modified)
- `apps/backend/src/modules/participation/application/participation.service.ts` (modified)
- `apps/backend/src/modules/participation/application/participation.service.spec.ts` (modified)
- `apps/backend/src/modules/participation/participation.module.ts` (modified)
- `apps/backend/test/starter-points.e2e-spec.ts` (new)
- `apps/backend/test/auth.e2e-spec.ts` (modified)
- `apps/backend/test/google-oauth.e2e-spec.ts` (modified)
- `apps/backend/test/single-session.e2e-spec.ts` (modified)
- `apps/backend/test/marketplace-feed.e2e-spec.ts` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- Code review 2026-09-26 (P10/P15, modified): `packages/schemas/src/economy/starter-points.schema.ts` (+ spec), `apps/backend/src/modules/economy/application/starter-points.coordinator.ts` (+ spec), `apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.ts` (+ spec), `apps/backend/src/modules/economy/infrastructure/in-memory-starter-points-data-provider.ts`, `apps/backend/src/modules/economy/presentation/starter-points.controller.ts` (+ spec), `apps/backend/src/modules/auth/application/auth.service.ts` (+ spec), `apps/backend/src/modules/auth/application/google-oauth.service.ts` (+ spec), `apps/backend/test/starter-points.e2e-spec.ts`, `apps/backend/src/modules/participation/application/participation.service.spec.ts`, `_bmad-output/implementation-artifacts/deferred-work.md`

### Change Log
- 2026-09-24: Implemented Tasks 1–5 (schemas, ledger operations, coordinator, lifecycle hooks, controller).
- 2026-09-26: Completed Task 6: fixed 12 e2e regressions caused by the new lifecycle hooks, added CSRF protection to the starter-points mutation endpoints, cleaned lint, and ran full monorepo verification. Status → review.
- 2026-09-26: Code review 2026-09-26: 0 decisions, 2 patches applied (P10 self-healing starter grant, P15 bounded expiry sweep), 6 deferred (DF2, DF7–DF11). Status → `done`.
