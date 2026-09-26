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
  - "apps/backend/src/modules/economy/application/ledger.service.ts"
  - "apps/backend/src/modules/forms/application/forms-escrow.coordinator.ts"
  - "apps/backend/src/modules/participation/application/participation.service.ts"
---

# Story 6.4: Respondent Point Credit & Pending Logic

Status: done

## Story

As a Respondent,
I want my points credited according to the survey type,
So that I receive instant rewards for internal surveys and pending rewards for external ones.

## Acceptance Criteria

### AC1 — Shared Schemas & Types for Respondent Reward Settlement (`packages/schemas`, FR-24, FR-29)
**Given** survey completion reward triggers
**When** validating or executing reward credit operations
**Then**:
1. Defines Zod schemas and TypeScript DTOs:
   - `creditInternalRewardSchema` / `CreditInternalRewardInput`: `{ responseId: string (uuid), publisherId: string (uuid), respondentId: string (uuid) | null, amount: number (> 0), policyMode?: 'SHADOW' | 'ADVISORY' | 'ENFORCED' (default: 'SHADOW') }`
   - `creditPendingRewardSchema` / `CreditPendingRewardInput`: `{ attemptId: string (uuid), publisherId: string (uuid), respondentId: string (uuid), amount: number (> 0) }`
   - `releasePendingRewardSchema` / `ReleasePendingRewardInput`: `{ attemptId: string (uuid), respondentId: string (uuid), amount: number (> 0) }`
   - `disputeHoldSchema` / `DisputeHoldInput`: `{ caseId: string (uuid), attemptId: string (uuid), respondentId: string (uuid), amount: number (> 0) }`
   - `resolveDisputeHoldSchema` / `ResolveDisputeHoldInput`: `{ caseId: string (uuid), respondentId: string (uuid), publisherId: string (uuid), amount: number (> 0), outcome: 'RELEASE_TO_RESPONDENT' | 'REFUND_TO_PUBLISHER' }`
   - `rewardSettlementResultSchema` / `RewardSettlementResultDto`: `{ status: 'SETTLED' | 'HELD_IN_INTEGRITY' | 'PENDING' | 'SKIPPED_GUEST', journalId: string | null, amount: number, targetAccountClass: LedgerAccountClass | null, settledAt: string }`
2. All schemas export parse and validate functions with comprehensive unit tests in `packages/schemas`.

### AC2 — Internal Survey Instant Reward Settlement (`apps/backend`, FR-29, AD-16)
**Given** a validated internal survey submission
**When** `LedgerService.creditInternalReward` is invoked
**Then**:
1. If `respondentId` is null (Guest submission), no ledger transfer is executed, returning `{ status: 'SKIPPED_GUEST', journalId: null, amount: 0, targetAccountClass: null }`.
2. Fast-path idempotency check keyed by `internal-reward:${responseId}`.
3. If `policyMode === 'SHADOW'` or `'ADVISORY'`:
   - Atomically transfers `amount` from Publisher's `ESCROW` account to Respondent's `USER_AVAILABLE` account under double-entry ledger rules (sum of entries = 0).
   - Journal description: `Survey reward credit: ${responseId}`.
   - Returns `{ status: 'SETTLED', journalId, amount, targetAccountClass: 'USER_AVAILABLE' }`.
4. If `policyMode === 'ENFORCED'`:
   - Atomically transfers `amount` from Publisher's `ESCROW` account to Respondent's `INTEGRITY_HOLD` account.
   - Idempotency key: `integrity-hold:${responseId}`.
   - Returns `{ status: 'HELD_IN_INTEGRITY', journalId, amount, targetAccountClass: 'INTEGRITY_HOLD' }`.
5. If Publisher's `ESCROW` balance is less than `amount`, throws `InsufficientEscrowBalanceException`.

### AC3 — Integrity Hold Release & Fail-Open Command (`apps/backend`, AD-14, AD-16)
**Given** points held in `INTEGRITY_HOLD` for an enforced survey
**When** an integrity assessment completes or governance deadline expires
**Then**:
1. `LedgerService.releaseIntegrityHold`:
   - Transfers `amount` from Respondent's `INTEGRITY_HOLD` to `USER_AVAILABLE`.
   - Idempotency key: `integrity-decision:${decisionId}`.
2. `LedgerService.failOpenIntegrityHold`:
   - Terminal scoring failure or deadline expiration executes fail-open release to ensure points are never stranded (AD-14).
   - Idempotency key: `integrity-fail-open:${responseId}`.
   - Transfers from `INTEGRITY_HOLD` to `USER_AVAILABLE`.

### AC4 — External Survey Pending Reward Settlement (`apps/backend`, FR-24, AD-16)
**Given** a validated external survey completion (verified completion code + time barrier)
**When** `LedgerService.creditPendingReward` is invoked
**Then**:
1. Atomically transfers `amount` from Publisher's `ESCROW` account to Respondent's `PENDING` account.
2. Idempotency key: `external-completion:${attemptId}`.
3. Journal description: `Pending survey reward for external completion: ${attemptId}`.
4. Fast-path idempotency check: repeated calls with identical parameters return the existing journal.
5. Returns `{ status: 'PENDING', journalId, amount, targetAccountClass: 'PENDING' }`.

### AC5 — 48-Hour Pending Reward Release & Dispute Lock (`apps/backend`, FR-24, AD-16)
**Given** points credited to Respondent's `PENDING` account from an external survey
**When** the 48-hour dispute period elapses or a dispute is raised
**Then**:
1. `LedgerService.releasePendingReward`:
   - Checks if a locked dispute hold exists for `attemptId`. If dispute is active, throws `DisputeHoldActiveException` and halts release.
   - Transfers `amount` from Respondent's `PENDING` account to Respondent's `USER_AVAILABLE` account.
   - Idempotency key: `release-pending:${attemptId}`.
   - Description: `Matured pending survey reward release: ${attemptId}`.
2. `LedgerService.placeDisputeHold`:
   - Idempotency key: `external-dispute:${caseId}`.
   - Moves `amount` from Respondent's `PENDING` to `INTEGRITY_HOLD` (or sets locked dispute flag).
3. `LedgerService.resolveDisputeHold`:
   - If outcome is `'RELEASE_TO_RESPONDENT'`, transfers `amount` from `INTEGRITY_HOLD` to Respondent's `USER_AVAILABLE` (`dispute-resolution:${caseId}:release`).
   - If outcome is `'REFUND_TO_PUBLISHER'`, transfers `amount` from `INTEGRITY_HOLD` back to Publisher's `ESCROW` or `USER_AVAILABLE` (`dispute-resolution:${caseId}:refund`).

### AC6 — Reward Settlement Coordinator (`apps/backend`, AD-16)
**Given** survey completion events
**When** coordinating settlement across survey types
**Then**:
1. Implements `RewardSettlementCoordinator` in `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts`.
2. Coordinates internal submission settlement: handles guest check, policy evaluation, and `creditInternalReward`.
3. Coordinates external attempt settlement: handles quota and `creditPendingReward`.
4. Exposes `releaseMaturedPendingRewards(cutoffDate: Date)` to scan and release external attempts completed >= 48 hours ago without active dispute holds.

### AC7 — Presentation Endpoints & Wire-Up (`apps/backend`, FR-24, FR-29)
**Given** authenticated requests and admin/scheduled worker triggers
**When** invoking reward settlement endpoints
**Then**:
1. Adds `POST /economy/rewards/internal/:responseId` for internal reward processing.
2. Adds `POST /economy/rewards/external/:attemptId` for external pending reward processing.
3. Adds `POST /economy/rewards/release-pending/:attemptId` for manual or worker release of matured pending points.
4. Registers `RewardSettlementCoordinator` in `EconomyModule`.
5. Updates `HttpExceptionFilter` to map `DisputeHoldActiveException` to HTTP 409 Conflict.

### AC8 — End-to-End & Regression Verification
**Given** the complete suite of tests
**When** running verification across all workspaces
**Then**:
1. All unit tests for schemas, ledger service, and coordinator pass 100%.
2. End-to-end tests in `apps/backend/test/reward-settlement.e2e-spec.ts` pass 100%.
3. Full test suites for `@rescom/schemas`, `backend`, and `frontend` pass with zero regressions.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Schemas & DTOs in `@rescom/schemas`** (AC: 1)
  - [x] 1.1 Create `packages/schemas/src/economy/reward.schema.ts` with Zod schemas and DTO types (`creditInternalRewardSchema`, `creditPendingRewardSchema`, `releasePendingRewardSchema`, `disputeHoldSchema`, `resolveDisputeHoldSchema`, `rewardSettlementResultSchema`).
  - [x] 1.2 Export new schemas from `packages/schemas/src/economy/index.ts` and `packages/schemas/src/index.ts`.
  - [x] 1.3 Author unit tests in `packages/schemas/src/economy/reward.schema.spec.ts`.

- [x] **Task 2: Ledger Service Settlement Operations in `apps/backend`** (AC: 2, 3, 4, 5)
  - [x] 2.1 Add `DisputeHoldActiveException` to `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`.
  - [x] 2.2 Implement `creditInternalReward` in `LedgerService` with `SHADOW`/`ADVISORY` (instant Available) and `ENFORCED` (Integrity Hold) logic, plus guest skipping.
  - [x] 2.3 Implement `releaseIntegrityHold` and `failOpenIntegrityHold` in `LedgerService`.
  - [x] 2.4 Implement `creditPendingReward` in `LedgerService` for external surveys (`ESCROW` -> `PENDING`).
  - [x] 2.5 Implement `releasePendingReward`, `placeDisputeHold`, and `resolveDisputeHold` in `LedgerService`.
  - [x] 2.6 Author comprehensive unit tests in `apps/backend/src/modules/economy/application/ledger.service.spec.ts`.

- [x] **Task 3: Reward Settlement Coordinator in `apps/backend`** (AC: 6)
  - [x] 3.1 Create `RewardSettlementCoordinator` in `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts`.
  - [x] 3.2 Implement `settleInternalReward`, `settleExternalReward`, and `releaseMaturedPendingRewards`.
  - [x] 3.3 Author unit tests in `apps/backend/src/modules/economy/application/reward-settlement.coordinator.spec.ts`.

- [x] **Task 4: Presentation Endpoints & Wire-Up in `apps/backend`** (AC: 7)
  - [x] 4.1 Update `LedgerController` with endpoints for internal reward, external pending credit, and pending release.
  - [x] 4.2 Register `RewardSettlementCoordinator` in `EconomyModule` and export for consumption.
  - [x] 4.3 Update `HttpExceptionFilter` with status mapping for `DisputeHoldActiveException`.
  - [x] 4.4 Author controller tests in `apps/backend/src/modules/economy/presentation/ledger.controller.spec.ts`.

- [x] **Task 5: End-to-End & Regression Verification** (AC: 8)
  - [x] 5.1 Author E2E tests in `apps/backend/test/reward-settlement.e2e-spec.ts`.
  - [x] 5.2 Run full test suite across `@rescom/schemas`, `backend`, and `frontend` to ensure 0 regressions.

### Review Findings

_Epic 6 code review of 2026-09-26 (triage IDs D/P/DF in brackets); findings of Stories 6.3–6.6 were triaged together and this list holds the ones that belong to 6.4._

- [x] [Review][Decision] Who funds the 20% Internal discount? (D1, high, shared with Story 6.3 — full options and recommendation there) — Escrow locks `round(0.8 × reward)` per slot but `creditInternalReward` pays the full `rewardPerResponse` from the pooled Escrow, so Internal payouts fail (or drain other surveys) after ~80% of the quota. Options: (A) Respondent receives the effective reward; (B) platform subsidy via a 3-entry journal (ESCROW −effective, SYSTEM_ISSUANCE −difference, Respondent +reward) — **triage recommendation**; (C) lock the full reward. The internal payout amount and journal shape were intentionally **not** changed (that is the decision); since P5 a failed payout no longer fails the submission and can be re-driven once funded. [apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts:75] — **Resolved 2026-09-26:** option B (platform subsidy) accepted by Quan; `creditInternalReward` posts one balanced journal under the unchanged `internal-reward:{responseId}` / `integrity-hold:{responseId}` key (ESCROW −round(0.8 × reward) = `escrowDrawPerCompletion`, SYSTEM_ISSUANCE −the rest, Respondent +the full reward via `internalRewardFunding`); the Escrow balance check uses the draw; the Outbox `rewardAmount` is the advertised gross reward (schema/port docs); idempotent replays still return the single journal (ledger, coordinator and `forms-escrow` e2e tests).
- [x] [Review][Patch] Any logged-in user could move any Publisher's Escrow through the reward-credit endpoints (P1, high) — fixed: `POST /economy/rewards/internal/:responseId` and `/external/:attemptId` moved to the Participation-owned `AdminRewardRedriveController` (same paths, both prefixes): `ADMIN` only (`RolesGuard`), `CsrfGuard` + `JsonOnlyGuard`, strict empty body (`rewardRedriveRequestSchema`); every parameter is derived server-side — `ParticipationService.redriveInternalReward` (non-guest SUBMITTED/VALIDATED response + the pinned `internal-reward:{responseId}` Outbox payload) and `redriveExternalReward` (COMPLETED attempt of an EXTERNAL form: publisher and reward from the form, respondent from the attempt); both are idempotent and return a posted settlement as is. The body-driven handlers were removed from `LedgerController`. Tests: controller spec (Admin-only metadata, strict body), service unit tests (404/409/guest/pinned amount), rewritten `reward-settlement.e2e-spec.ts` (Respondent/Publisher 403, Admin random id 404, pinned amount paid once, replay same journal). [apps/backend/src/modules/participation/presentation/admin-reward-redrive.controller.ts:1]
- [x] [Review][Patch] Pending release had no server-side 48 h maturity, used a client-supplied dispute flag and amount, and had no cutoff scan (P2, high) — fixed: `LedgerService.releasePendingReward({ attemptId, respondentId?, amount? })` loads the `external-completion:{attemptId}` credit (missing → 404 `PENDING_CREDIT_NOT_FOUND`, reversed → refused), derives the owner and amount from it (another respondent → 403 `PENDING_REWARD_FORBIDDEN`, other amount → 409), and requires `credit.createdAt ≤ now − 48 h` on an injectable ledger clock (`PENDING_REWARD_NOT_MATURED`, 409 with `maturesAt`); the dispute check is server-side through the new `ExternalDisputeHoldQueryPort` (Phase-1 default `NoExternalDisputeHolds`, Story 8.5 must bind a real one); the endpoint body is `{}` (an Admin may name the expected respondent); `releaseMaturedPendingRewards({ cutoffDate?, limit? })` now scans `findMaturedPendingCredits` (oldest first, not released, not reversed) with the cutoff clamped to now − 48 h, limit 1..500 (default 100), per-item isolation and `hasMore`, exposed as the Admin/worker trigger `POST /economy/rewards/release-matured`. The Story 7.2 activation check and the `REWARD_RELEASED` notification use the credited respondent from the journal. Tests: ledger, coordinator, controller, notifications e2e, reward-settlement e2e (immediate release 409, clock-shifted release, scan). [apps/backend/src/modules/economy/application/ledger.service.ts:1249]
- [x] [Review][Patch] Internal reward settled after the submission committed with no retry, so a failed payout was lost for good (P5, high) — fixed: the post-commit settlement is wrapped (warning log without balances, `reward: null`, 200) and the Story 7.2 unlock check still runs; `ParticipationRepositoryPort.findInternalRewardRequest` reads the pinned Outbox payload; the owner's VALIDATED/SUBMITTED replay re-drives non-fatally and returns the pinned `policyMode`; the Admin re-drive (P1) reuses the same command. An Outbox consumer is still not implemented (no worker infrastructure — DF1 note). [apps/backend/src/modules/participation/application/participation.service.ts:570]
- [x] [Review][Patch] Idempotency fast paths returned any journal with the key and echoed the caller's amount (P8, medium, also Stories 6.3/6.5) — fixed: `assertReplayCompatible` compares the multiset of `accountId:amount` (not the description) for reserve, reopen, Internal/Pending credit, Pending release and starter grant/unlock, and the account pair only for the balance-capped refund and starter expiry; a mismatch is `IdempotencyConflictException`; reward DTOs report the posted journal amount. Replays and re-drives read an existing settlement first, so an edited form reward never makes a replay conflict. [apps/backend/src/modules/economy/application/ledger.service.ts:1715]
- [x] [Review][Patch] The same Internal response could be rewarded twice by switching `policyMode` (P9, low) — fixed: `creditInternalReward` refuses when the sibling key (`internal-reward:` ↔ `integrity-hold:`) exists. [apps/backend/src/modules/economy/application/ledger.service.ts:948]
- [x] [Review][Patch] Escrow insufficiency errors leaked the Publisher's Escrow balance to Respondents; the race path lost the `INSUFFICIENT_ESCROW_BALANCE` contract (P11, low, also 6.3 AC3.3) — fixed: new Respondent-safe `SurveyRewardUnavailableException` (409 `SURVEY_REWARD_UNAVAILABLE`, no details) for Escrow shortfalls in External completion/replay; `reserveEscrow`/`reopenEscrow` rethrow a locked-check failure as `InsufficientEscrowBalanceException` with a re-read Available balance (Publisher-facing); the Prisma overdraft message is generic. [apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts:221]
- [x] [Review][Patch] Assertions that could not fail and e2e tests that encoded the vulnerable behaviour (P17, low, also 6.3 AC7) — fixed: `toBeDefined()` on nullable journal ids replaced by exact/`not.toBeNull()` checks; the echo-the-flag dispute tests replaced by server-side port tests; `reward-settlement.e2e-spec.ts` rewritten (no self-crediting Respondent); `notifications.e2e-spec.ts` seeds Pending through `LedgerService.creditPendingReward`, releases at +48 h on an injected clock and its CSRF test targets a real notification; `forms-escrow.e2e-spec.ts` uses real completions and paid rewards plus close→reopen→close and verify-after-close scenarios. [apps/backend/test/reward-settlement.e2e-spec.ts:1]
- [x] [Review][Defer] Nothing calls `releaseMaturedPendingRewards` on a schedule (DF1, medium) [apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts:222] — deferred: needs the AD-5/AD-17 worker and leased scheduling infrastructure (see `deferred-work.md`, Story 9.6 entry). P2 provides server-enforced maturity, the cutoff scan and the Admin/worker trigger `POST /economy/rewards/release-matured`, and Respondents can release their own matured credits.
- [x] [Review][Defer] ENFORCED Integrity Hold release, fail-open deadline and incident are not wired (DF3, low) [apps/backend/src/modules/economy/application/ledger.service.ts:758] — deferred: ENFORCED cannot be reached in Phase 1 (nothing writes `scoring_policies`; Epic 10 is Phase 2). Wire the fail-open deadline with Epic 10.
- [x] [Review][Defer] Dispute/integrity commands have unsafe keys and no per-attempt state (`dispute-resolution:{caseId}:release` and `:refund` can both post; `integrity-decision:` + `integrity-fail-open:` can double-release; `placeDisputeHold` does not check the credit/release state; several cases per attempt) (DF4, low) [apps/backend/src/modules/economy/application/ledger.service.ts:969] — deferred: the keys follow AC5/AD-16 as written and the methods have no callers (Story 8.5 disputes and Epic 10 are Phase 2); add mutual-exclusion guards when they are wired.
- [x] [Review][Defer] Reward settlement locking/rollback never exercised against PostgreSQL (DF5, medium) [apps/backend/test/reward-settlement.e2e-spec.ts] — deferred with Story 6.3 (Postgres test container).

---

## Dev Notes
- **Idempotency Keys (ARCHITECTURE-SPINE, AD-16):**
  - Internal survey reward: `internal-reward:${responseId}`
  - Integrity hold: `integrity-hold:${responseId}`
  - Integrity decision release: `integrity-decision:${decisionId}`
  - Integrity fail-open release: `integrity-fail-open:${responseId}`
  - External completion pending reward: `external-completion:${attemptId}`
  - Release pending reward: `release-pending:${attemptId}`
  - Dispute hold: `external-dispute:${caseId}`
  - Dispute release: `dispute-resolution:${caseId}:release`
  - Dispute refund: `dispute-resolution:${caseId}:refund`
- **Account Classes:**
  - `ESCROW`: Publisher's escrow account where locked survey points reside.
  - `USER_AVAILABLE`: Spendable points for users (instant internal reward destination).
  - `PENDING`: Unmatured points for external survey completions (held for 48h dispute window).
  - `INTEGRITY_HOLD`: Non-spendable hold for enforced policy or disputed claims.
- **Maturity Duration:**
  - 48 hours (`48 * 60 * 60 * 1000` ms) per FR-24.
- **Code review 2026-09-26 — API changes (P1/P2):**
  - `POST /economy/rewards/internal/:responseId` and `/external/:attemptId` are Admin-only re-drives with an empty body; they settle from the committed completion (pinned Internal reward request, COMPLETED External attempt + its form). They now live in `participation/presentation/admin-reward-redrive.controller.ts`.
  - `POST /economy/rewards/release-pending/:attemptId` takes `{}` (Admin: optional `respondentId`). Owner, amount and the 48-hour maturity come from the `external-completion:{attemptId}` journal; `isDisputeHoldLocked` and `amount` are no longer accepted (400). New codes: `PENDING_REWARD_NOT_MATURED` (409, `details.maturesAt`), `PENDING_CREDIT_NOT_FOUND` (404), `PENDING_REWARD_FORBIDDEN` (403).
  - New Admin/worker trigger `POST /economy/rewards/release-matured` (`{ cutoffDate?, limit? }`, cutoff clamped to now − 48 h, limit 1..500).
  - Dispute holds are checked through `EXTERNAL_DISPUTE_HOLD_QUERY_PORT` (Phase 1: none exist; Story 8.5 must bind a real implementation).
  - Known limits of the scan: a credit whose release keeps failing stays at the head of the queue (Phase 1 has no failure mode besides corruption), and a reversed-then-reinstated credit is skipped by the scan but can be released individually.
- **Decision E6-D1 (2026-09-26, option B — platform subsidy):** the Internal payout credits the advertised `rewardPerResponse` in full (Marketplace, reward DTOs and notifications unchanged). Journal (one per response, same keys): ESCROW −`round(0.8 × reward)`, SYSTEM_ISSUANCE −`reward − round(0.8 × reward)` (entry omitted when 0), target account (USER_AVAILABLE, or INTEGRITY_HOLD under ENFORCED) +reward. The Outbox `InternalRewardRequested.rewardAmount` is that gross reward; the Escrow share is derived with `internalRewardFunding(rewardAmount)`. Integrity-hold releases move the full held reward unchanged.

---

## Dev Agent Record

### Implementation Plan
1. Task 1: Create shared schemas and types in `packages/schemas/src/economy/reward.schema.ts` and test them.
2. Task 2: Implement `creditInternalReward`, `releaseIntegrityHold`, `failOpenIntegrityHold`, `creditPendingReward`, `releasePendingReward`, `placeDisputeHold`, `resolveDisputeHold` in `LedgerService`, plus new exception.
3. Task 3: Implement `RewardSettlementCoordinator` in `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts`.
4. Task 4: Add reward settlement endpoints to `LedgerController`, register in `EconomyModule`, update exception filter.
5. Task 5: Add E2E tests in `apps/backend/test/reward-settlement.e2e-spec.ts` and verify all tests pass.

### Completion Notes List
- Implemented Zod schemas and TypeScript DTOs in `packages/schemas/src/economy/reward.schema.ts` for internal rewards, external pending rewards, pending release, dispute holds, and dispute resolution.
- Added `DisputeHoldActiveException` and mapped it to HTTP 409 Conflict in `HttpExceptionFilter`.
- Added `creditInternalReward`, `releaseIntegrityHold`, `failOpenIntegrityHold`, `creditPendingReward`, `releasePendingReward`, `placeDisputeHold`, and `resolveDisputeHold` methods to `LedgerService` with fast-path idempotency, double-entry verification, and atomic balance updates.
- Implemented `RewardSettlementCoordinator` coordinating internal survey completions (guest skip, shadow/advisory instant credit, enforced hold), external completions (pending reward credit), and matured pending batch releases (48-hour threshold, dispute hold lock check).
- Wired `RewardSettlementCoordinator` into `EconomyModule` and added reward endpoints (`POST /economy/rewards/internal/:responseId`, `POST /economy/rewards/external/:attemptId`, `POST /economy/rewards/release-pending/:attemptId`) to `LedgerController`.
- Created comprehensive E2E tests in `apps/backend/test/reward-settlement.e2e-spec.ts` validating internal instant settlement, guest skip, escrow balance checks, external pending credits, dispute blocks, and matured pending release.
- Fixed mock setup in `apps/backend/test/forms-publish.e2e-spec.ts` and `apps/backend/test/participation-submission.e2e-spec.ts` for clean test runs.
- Resolved pre-existing React 19 ESLint issues in `apps/frontend/my-app/app/forms/hooks/useSurveyOfflineCache.ts`.
- All 844 unit tests pass across schemas, backend, and frontend with 0 errors and 0 lint warnings. Production build succeeds across all workspaces.
- Code review 2026-09-26: applied P1, P2, P5, P8, P9, P11, P17 (Admin-only server-derived reward re-drives, journal-derived 48 h Pending release with server-side dispute port and bounded scan, non-fatal post-commit settlement with re-drive, replay-compatibility checks, cross-mode double-reward guard, Respondent-safe Escrow errors, tightened tests); decision D1 awaits the user, so the story stays `in-progress`. Verification: schemas 343, backend unit 1183, backend e2e 275 passed / 3 skipped (30 suites), frontend 173, typecheck + lint clean.
- Decision follow-up 2026-09-26 (E6-D1 option B, accepted by Quan): platform-subsidised Internal payouts in one 3-entry journal; ledger spec expectations updated deliberately (Escrow now drops by the reserved 80%), new journal-shape, zero-subsidy, draw-based balance check and single-journal replay tests; `reward-settlement` e2e Escrow expectations updated (Internal 40 → Escrow −32). Verification: schemas 388 (23 suites), backend unit 1409 (98 suites), backend e2e 290 passed / 3 skipped (30 suites), frontend 230, typecheck + lint clean, `prisma validate` clean.

### File List
- `packages/schemas/src/economy/reward.schema.ts`
- `packages/schemas/src/economy/reward.schema.spec.ts`
- `packages/schemas/src/economy/index.ts`
- `packages/schemas/src/economy/ledger-journal.schema.ts`
- `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts`
- `apps/backend/src/modules/economy/application/ledger.service.spec.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-ledger.repository.ts`
- `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts`
- `apps/backend/src/modules/economy/application/reward-settlement.coordinator.spec.ts`
- `apps/backend/src/modules/economy/economy.module.ts`
- `apps/backend/src/modules/economy/presentation/ledger.controller.ts`
- `apps/backend/src/modules/economy/presentation/ledger.controller.spec.ts`
- `apps/backend/test/reward-settlement.e2e-spec.ts`
- `apps/backend/test/forms-publish.e2e-spec.ts`
- `apps/backend/test/participation-submission.e2e-spec.ts`
- `apps/frontend/my-app/app/forms/hooks/useSurveyOfflineCache.ts`
- `apps/frontend/my-app/app/forms/[id]/respond/page.tsx`
- `apps/frontend/my-app/app/forms/hooks/telemetry-buffer.mjs`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/6-4-respondent-point-credit-pending-logic.md`
- Code review 2026-09-26 (P1/P2/P5/P8/P9/P11/P17):
  - `packages/schemas/src/economy/reward.schema.ts` (+ spec: `releasePendingRewardRequestSchema`, `releaseMaturedPendingRewardsSchema`, `rewardRedriveRequestSchema`)
  - `apps/backend/src/modules/economy/application/ledger.service.ts` (+ spec)
  - `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts` (+ spec)
  - `apps/backend/src/modules/economy/application/ports/external-dispute-hold-query.port.ts` (new)
  - `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`
  - `apps/backend/src/modules/economy/presentation/ledger.controller.ts` (+ spec)
  - `apps/backend/src/modules/economy/economy.module.ts`
  - `apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts`, `in-memory-ledger.repository.ts`
  - `apps/backend/src/modules/participation/presentation/admin-reward-redrive.controller.ts` (new, + spec)
  - `apps/backend/src/modules/participation/participation.module.ts`
  - `apps/backend/src/modules/participation/application/participation.service.ts` (+ spec)
  - `apps/backend/src/modules/participation/application/exceptions/participation.exceptions.ts`
  - `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts`
  - `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts` (+ new spec), `in-memory-participation.repository.ts`
  - `apps/backend/src/common/http/http-exception.filter.ts` (+ spec)
  - `apps/backend/test/reward-settlement.e2e-spec.ts`, `apps/backend/test/notifications.e2e-spec.ts`
- Decision follow-up 2026-09-26 (E6-D1):
  - `packages/schemas/src/economy/escrow.schema.ts` (+ spec: `internalRewardFunding`), `packages/schemas/src/forms/internal-submission.schema.ts` (Outbox `rewardAmount` semantics)
  - `apps/backend/src/modules/economy/application/ledger.service.ts` (+ spec), `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts`
  - `apps/backend/src/modules/participation/application/participation.service.ts`, `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts`
  - `apps/backend/src/modules/forms/application/forms-escrow.coordinator.spec.ts`
  - `apps/backend/test/forms-escrow.e2e-spec.ts`, `apps/backend/test/reward-settlement.e2e-spec.ts`
  - `_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log
- 2026-09-24: Story 6.4 implemented, validated via unit and E2E suites. Status transitioned to `review`.
- 2026-09-26: Code review 2026-09-26: 1 decision open (D1, shared with 6.3), 7 patches applied (P1, P2, P5, P8, P9, P11, P17), 4 deferred (DF1, DF3, DF4, DF5). Reward credit endpoints are Admin-only re-drives; Pending releases are journal-derived and 48 h-gated. Status → `in-progress` until D1 is decided.
- 2026-09-26: Decision follow-up 2026-09-26: E6-D1 → option B (platform subsidy): Internal payouts credit the full reward in one balanced journal (Escrow −reserved 80%, SYSTEM_ISSUANCE −20%, Respondent +100%) under the existing keys; Outbox `rewardAmount` documented as the gross reward. No unchecked decision/patch items remain → Status `done`.
