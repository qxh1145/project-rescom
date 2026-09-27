---
baseline_commit: 378e4a71ff125fb1acf6ee18291fc298ae56bf94
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "_bmad-output/implementation-artifacts/6-1-double-entry-ledger-core-idempotency.md"
  - "_bmad-output/implementation-artifacts/6-2-wallet-balance-aggregation-presentation.md"
  - "apps/backend/src/modules/economy/application/ledger.service.ts"
  - "apps/backend/src/modules/forms/application/forms.service.ts"
---

# Story 6.3: Escrow Lock, Release & Refund

Status: done

## Story

As a Publisher,
I want to lock points in Escrow when publishing a survey and get refunded for unused quotas,
So that respondents are guaranteed payment but I don't lose points if the survey ends early.

## Acceptance Criteria

### AC1 — Point Reward Pricing Table & Duration Validation (`packages/schemas`, FR-14)
**Given** a survey configuration with estimated completion time
**When** validating or calculating the reward per response
**Then**:
1. Enforces point reward bounds based on duration:
   - `< 5 min`: 5–10 Points
   - `5–10 min`: 10–20 Points
   - `10–15 min`: 15–25 Points
   - `> 15 min`: 20–40 Points
2. If `rewardPerResponse` is below the band minimum, validation fails with `PricingRewardBelowMinimumException` / validation error suggesting the valid minimum reward for that duration.
3. Exposes utility `getRewardPricingRange(durationMinutes: number): { min: number; max: number; suggested: number }` and schema `rewardPricingSchema`.

### AC2 — Internal Form Pricing Discount (20%) & Cost Calculation (`packages/schemas`, FR-19)
**Given** survey publishing parameters (type, expectedCompletions, rewardPerResponse, estimatedDurationMinutes)
**When** calculating total escrow cost
**Then**:
1. For Internal surveys (`type === 'INTERNAL'`), applies a 20% discount per response:
   - `effectiveRewardPerResponse = Math.round(rewardPerResponse * 0.8)`
2. For External surveys (`type === 'EXTERNAL'`), no discount applies:
   - `effectiveRewardPerResponse = rewardPerResponse`
3. Total cost = `expectedCompletions * effectiveRewardPerResponse`.
4. Exposes `calculateEscrowCost(...)` and `escrowCalculationResultSchema` returning comparison metadata:
   - `baseCost`: `expectedCompletions * rewardPerResponse`
   - `effectiveCost`: `expectedCompletions * effectiveRewardPerResponse`
   - `discountAmount`: `baseCost - effectiveCost`
   - `discountPercent`: `20` for internal, `0` for external
   - `effectiveRewardPerResponse`: integer

### AC3 — Escrow Lock on Form Publish (`apps/backend`, FR-15, AD-16)
**Given** a survey ready to publish and an authenticated Publisher
**When** the Publisher confirms publish / payment
**Then**:
1. Calculates total escrow cost based on AC2. Free internal surveys (0 points) require 0 escrow.
2. Checks Publisher's available points in `USER_AVAILABLE` ledger account.
3. If Available Balance < total escrow cost:
   - Blocks publishing and throws `InsufficientEscrowBalanceException` (HTTP 400/409, code `INSUFFICIENT_ESCROW_BALANCE`) detailing required points versus currently available points.
4. Atomically under coordinated Unit of Work:
   - Posts Economy journal transferring `totalCost` points from Publisher's `USER_AVAILABLE` to `ESCROW` account.
   - Stable journal idempotency key: `publish:${formVersionId}`.
   - Journal description: `Escrow lock for survey publish: ${formTitle}`.
   - Form transitions to `ESCROW_LOCKED` or `PUBLISHED` and version marked published.
   - Failure rolls back both the ledger transaction and the form publication.

### AC4 — Escrow Refund on Survey Close (`apps/backend`, FR-32, AD-16)
**Given** a published or escrow-locked survey with remaining unused completions
**When** the survey is closed manually or via expiration
**Then**:
1. Determines unused completions: `unusedCompletions = Math.max(0, form.expectedCompletions - completedResponsesCount)`.
2. Computes refund amount: `refundAmount = unusedCompletions * effectiveRewardPerResponse`.
3. If `refundAmount > 0`:
   - Posts Economy journal transferring `refundAmount` points from Publisher's `ESCROW` to `USER_AVAILABLE` account.
   - Stable journal idempotency key: `close-refund:${formId}:${versionNumber}`.
   - Journal description: `Escrow refund on survey close: ${formTitle} (${unusedCompletions} unused slots)`.
4. Atomically marks form `CLOSED`. If either operation fails, both roll back.

### AC5 — Survey Reopen with Additional Quota (`apps/backend`, FR-33)
**Given** a closed survey
**When** the Publisher reopens the survey with additional sample quota (`additionalCompletions > 0`)
**Then**:
1. Calculates additional escrow cost: `additionalCompletions * effectiveRewardPerResponse`.
2. Verifies Publisher has sufficient Available Balance for the additional cost.
3. Atomically under coordinated Unit of Work:
   - Posts Economy journal transferring additional cost from Publisher's `USER_AVAILABLE` to `ESCROW` with idempotency key `reopen-escrow:${formId}:${reopenVersionNumber}`.
   - Updates `expectedCompletions = existingExpected + additionalCompletions`.
   - Transitions form status back to `PUBLISHED` (or `ESCROW_LOCKED`).
   - All prior responses and version history remain preserved.

### AC6 — Clean Architecture & Module Boundary Isolation
**Given** the backend modular architecture
**When** orchestrating financial flows between Research (Forms) and Economy
**Then**:
1. Research and Economy remain separate bounded contexts per AD-16.
2. `FormsEscrowCoordinator` coordinates the atomic workflow without leaking private ORM details between modules.
3. In-memory repositories support unit testing for both modules.
4. Prisma repositories execute atomically inside PostgreSQL transactions.

### AC7 — Comprehensive Test Coverage
**Given** the test suites across schemas and backend
**When** running automated tests
**Then**:
1. Schemas tests verify duration pricing tables, minimum/maximum validation, 20% discount calculations, and reopen schemas.
2. Unit tests verify:
   - Successful escrow lock on publish with correct double-entry journal
   - Insufficient balance rejection with clear required vs available error
   - Zero-cost survey publish bypass
   - Idempotent publish retry
   - Partial refund calculation and execution on survey close
   - Zero-refund close when all quotas were fulfilled
   - Survey reopen with additional quota and escrow lock
3. Integration / E2E tests verify the complete publish-lock and close-refund endpoints.
4. All existing tests pass with zero regressions.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Schemas for Pricing Table & Escrow Calculation (`packages/schemas`)** (AC: 1, 2, 5)
  - [x] 1.1 Create `packages/schemas/src/economy/pricing.schema.ts` defining duration bands, `getRewardPricingRange`, `validateRewardPricing`, and pricing error types.
  - [x] 1.2 Create `packages/schemas/src/economy/escrow.schema.ts` defining `calculateEscrowCost`, `escrowCostCalculationSchema`, `reopenSurveySchema`, and DTO types.
  - [x] 1.3 Export new schemas from `packages/schemas/src/economy/index.ts` and `packages/schemas/src/index.ts`.
  - [x] 1.4 Author comprehensive unit tests in `packages/schemas/src/economy/pricing.schema.spec.ts` and `packages/schemas/src/economy/escrow.schema.spec.ts`.

- [x] **Task 2: Economy Module Escrow Operations (`apps/backend`)** (AC: 3, 4, 5, 6)
  - [x] 2.1 Add escrow operations to `LedgerService` (`reserveEscrow`, `refundUnusedEscrow`, `reopenEscrow`).
  - [x] 2.2 Define domain exceptions `InsufficientEscrowBalanceException` in `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`.
  - [x] 2.3 Author unit tests in `apps/backend/src/modules/economy/application/ledger.service.spec.ts` covering escrow reservation, refund, and reopen.

- [x] **Task 3: Research Escrow Coordinator & Form Lifecycle Integration (`apps/backend`)** (AC: 3, 4, 5, 6)
  - [x] 3.1 Create `FormsEscrowCoordinator` in `apps/backend/src/modules/forms/application/forms-escrow.coordinator.ts` to orchestrate publish+lock and close+refund.
  - [x] 3.2 Add response count queries to `FormRepositoryPort`, `InMemoryFormRepository`, and `PrismaFormRepository` to compute fulfilled quotas.
  - [x] 3.3 Integrate `FormsEscrowCoordinator` into `FormsService` for `publishForm` and `closeForm`, plus new `reopenForm` method.
  - [x] 3.4 Author unit tests in `apps/backend/src/modules/forms/application/forms-escrow.coordinator.spec.ts` and update `forms.service.spec.ts`.

- [x] **Task 4: Presentation Endpoints & Wire-up (`apps/backend`)** (AC: 3, 4, 5)
  - [x] 4.1 Update `FormsController` with `reopenForm` endpoint (`POST /forms/:id/reopen`) and pricing quote endpoint (`GET /forms/:id/pricing-quote`).
  - [x] 4.2 Register coordinator and update module dependencies in `FormsModule` and `EconomyModule`.
  - [x] 4.3 Update `HttpExceptionFilter` for `InsufficientEscrowBalanceException` status and response payload with `availableBalance` and `requiredAmount`.

- [x] **Task 5: End-to-End & Regression Testing** (AC: 7)
  - [x] 5.1 Add E2E tests in `apps/backend/test/forms-escrow.e2e-spec.ts` testing publish lock, insufficient balance, close refund, and reopen.
  - [x] 5.2 Run all tests across workspaces (`@rescom/schemas`, `backend`, `frontend`) and ensure 100% pass rate.

### Review Findings

_Epic 6 code review of 2026-09-26 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, triage IDs D/P/DF in brackets). Findings of Stories 6.3–6.6 were triaged together; this list holds the ones that belong to 6.3. Dismissed as noise across the epic: 6._

- [x] [Review][Decision] Who funds the 20% Internal discount? (D1, high, shared with Story 6.4) — Publish locks `expectedCompletions × round(0.8 × reward)` (AC2), but every Internal payout debits the full `rewardPerResponse` from the Publisher's pooled Escrow (and the Outbox `rewardAmount` / Marketplace show the full reward). After ~80% of the quota the payout fails with `INSUFFICIENT_ESCROW_BALANCE` (the submission still succeeds since P5 and the reward stays "pending settlement") or silently drains another survey's Escrow. Nothing in the PRD/architecture says who absorbs the discount. Options: (A) Respondent receives the effective reward (`round(0.8 × reward)`; Marketplace/respond page/reward DTOs/notifications must show the effective amount; Internal surveys pay Respondents less); (B) platform subsidy — one balanced journal per payout (ESCROW −effective, SYSTEM_ISSUANCE −(reward − effective), Respondent +reward) with the same keys, no UI change, the platform mints ~20% of each Internal reward (points are not redeemable for cash); (C) lock the full reward (`effective = reward`) and reinterpret FR-19 as an 80% pricing band — changes AC2 and couples to D2. **Triage recommendation: B.** Not implemented (this is the decision). The review patches use one helper, `escrowDrawPerCompletion(form)` in `packages/schemas/src/economy/escrow.schema.ts` (= `effectiveRewardPerResponse`, correct for A and B; switch it to `rewardPerResponse` if C), for reservations, refunds and re-publication shortfalls; after the decision, update `RewardSettlementCoordinator.settleInternalReward` / `LedgerService.creditInternalReward` (3-entry journal for B), the Outbox `rewardAmount` semantics, and add a unit test paying 100% of a quota (Escrow ends at exactly 0) plus an e2e paying every slot of an Internal survey. [apps/backend/src/modules/economy/application/ledger.service.ts:948] — **Resolved 2026-09-26:** option B (platform subsidy) accepted by Quan; `LedgerService.creditInternalReward` now posts ONE balanced journal under the same `internal-reward:` / `integrity-hold:` key — ESCROW −`escrowDrawPerCompletion` (round(0.8 × reward), what publish reserved), SYSTEM_ISSUANCE −the discount, Respondent +the full advertised reward — via the new `internalRewardFunding` helper next to `escrowDrawPerCompletion` (publish, close refund, re-publication shortfall, reopen and payout all use the one draw helper); the Outbox `rewardAmount` is documented as the advertised gross reward; tests: coordinator unit test paying 100% of an Internal quota (form Escrow exactly 0, other survey untouched, close refunds 0), ledger journal-shape/replay tests, `forms-escrow` e2e paying every slot through real submissions.
- [x] [Review][Decision] Enforcing the FR-14 pricing bands (D2, medium) — `getRewardPricingRange` / `validateRewardPricing` / `rewardPricingSchema` exist but nothing uses them and `PricingRewardBelowMinimumException` does not exist (AC1.2, Task 1.1 is only partly met): forms have no estimated-duration field anywhere (schema, Prisma, UI), and FR-14's "minimum 5 points" conflicts with AC3.1's free (0-point) Internal surveys. Options: (a) add `estimatedDurationMinutes` to the Form (draft/external/publish schemas, drift-tolerant Prisma column, builder/wizard UI), validate the band (min and max) at **publish** with a new `PricingRewardBelowMinimumException` (400 `PRICING_REWARD_OUT_OF_BAND`, details `{min,max,suggested}`) and return the band in `getPricingQuote`; (b) derive the duration (question count for Internal, Publisher field for External); (c) defer FR-14 enforcement to a follow-up story and mark AC1.2/Task 1.1 partial. **Triage recommendation: (a)**, publish-time only, keeping the 0-point Internal exemption (PO to confirm) and asking the PO whether the band maximum (40) replaces the current 10,000 cap; if D1 = C the Internal band is 80% of the External band. [packages/schemas/src/economy/pricing.schema.ts:1] — **Resolved 2026-09-26:** option (a) accepted by Quan; new optional `Form.estimatedDurationMinutes` (1..1440, drift-tolerant migration `20260926233000_form_estimated_duration_minutes`) in the draft/External/publish schemas, builder input and External wizard; the FR-14 band (min AND max) is enforced at publish only (`publishForm`, External `autoPublish`) with new 400 `PRICING_REWARD_OUT_OF_BAND` (`PricingRewardOutOfBandException`, details `{min,max,suggested}`) and 422 `ESTIMATED_DURATION_REQUIRED`; 0-point Internal surveys stay exempt; `getPricingQuote` returns `pricingBand` + `bandCheck`. Embedded sub-question default recorded: the band maximum (40 for > 15 min) applies at publish for rewarded surveys; the 10,000-point schema cap stays the hard input limit for drafts.
- [x] [Review][Patch] Close/reopen idempotency keys repeat across cycles, so a second refund is swallowed and a second reopen is unfunded (P3, high) — fixed: new persisted `Form.closeCount` (`close_count INT NOT NULL DEFAULT 0`, drift-tolerant migration `20260926220000_form_close_count`) incremented by `FormEntity.transitionTo('CLOSED')` inside the same conditional update (close and moderation rejection); keys are now `close-refund:{formId}:c{closeCount}` and `reopen-escrow:{formId}:c{closeCount}` (the `c` prefix never collides with the legacy `{versionNumber}` keys); the Unit-of-Work labels match; the moderation audit event now takes the posted refund key from the refund result. Tests: coordinator, `forms.service` and `forms-escrow` e2e close→reopen→close→reopen→close. [apps/backend/src/modules/forms/application/forms-escrow.coordinator.ts:143]
- [x] [Review][Patch] The close refund does not compute the form's own remaining Escrow — External completions ignored, double counting after reopen, Escrow stranded by re-publication, guest slots, legacy forms (P4, high) — fixed: `LedgerService.getFormEscrowPosition` derives `reserved` (`publish:` of every version + `reopen-escrow:*`), `refunded` (`close-refund:*`, legacy keys included) and `consumed` (Escrow debits of `internal-reward:` / `integrity-hold:` / `external-completion:` payouts, reversed journals excluded) with new batched repository lookups (`findJournalsByIdempotencyKeys` chunked by 1,000, `findJournalsByIdempotencyKeyPrefix`, `findReversalJournalsFor`); `FormRepositoryPort.listRewardableCompletions` (new `listCompletionRefsForForm` in `common/database/completion-counts.ts`, which reuses Epic 4's `countCompletionsByFormIds` so the quota and the refund share one completion definition) returns the non-guest settleable responses and COMPLETED External attempts; refund = `max(0, reserved − refunded − consumed − owed)` where `owed` = rewardable completions without a payout journal × `escrowDrawPerCompletion`; publish reserves only the shortfall (a re-publication carries the earlier Escrow over); a replayed close returns its original journal; the pooled-balance cap stays as a safety net and now logs a warning. `countCompletedResponses` was removed. Tests pay real rewards (coordinator spec, `forms-escrow` e2e). [apps/backend/src/modules/economy/application/ledger.service.ts:697]
- [x] [Review][Patch] A completion after close is paid from pooled Escrow (P6, medium) — fixed: `verifyExternalCompletionCode` rejects a non-PUBLISHED form / unpublished pinned version with `SURVEY_NOT_AVAILABLE` before the code check (no try burned; the COMPLETED replay still returns its original result), and both completion transactions read the form under `SELECT status FROM forms … FOR SHARE` (External returns the new `FORM_NOT_OPEN` outcome, the Internal submission rolls back), so close's conditional UPDATE serializes with in-flight completions. Tests: service unit, Prisma repository (mocked tx), `forms-escrow` e2e verify-after-close. [apps/backend/src/modules/participation/application/participation.service.ts:721]
- [x] [Review][Patch] Ledger reads inside a Unit of Work bypass the ambient transaction (P7, medium) — fixed: `currentClient(prisma)` in `prisma-unit-of-work.ts`; every `PrismaLedgerRepository` read and the form reads used inside Units of Work (`findById`, `findAllVersions`, `listRewardableCompletions`) join the ambient transaction; `createAccount` uses `createMany({ skipDuplicates: true })` (ON CONFLICT DO NOTHING on the NULLS NOT DISTINCT unique index) and re-selects on the same client. Tests: `prisma-unit-of-work.spec.ts`, new `prisma-ledger.repository.spec.ts`. [apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts:38]
- [x] [Review][Patch] Reopen has no upper bound and bypasses the 100,000-completion cap (P12, low) — fixed: `reopenSurveySchema.additionalCompletions` `.max(100_000)` (`MAX_EXPECTED_COMPLETIONS`), `reopenForm` rejects totals above 100,000 with `FormValidationException`, and `postJournal` maps schema failures other than the balance rules to `InvalidLedgerOperationException` (no more `JOURNAL_UNBALANCED` for an out-of-range amount). [packages/schemas/src/economy/escrow.schema.ts:90]
- [x] [Review][Patch] An Admin can reopen another user's survey and spend that Publisher's Available points (P13, low) — fixed: `reopenForm` is owner-only (`FormForbiddenException` for everyone else, Admins included); Admin publish-on-behalf is unchanged. [apps/backend/src/modules/forms/application/forms.service.ts:904]
- [x] [Review][Patch] A concurrent duplicate journal inside a shared Unit of Work aborts the transaction and `postJournal` "converges" into it → 500 (P14, low) — fixed: `isInAmbientTransaction()`; a P2002 inside a caller's Unit of Work now raises `ConcurrentLedgerCommandException` (409 `LEDGER_COMMAND_IN_PROGRESS`, retryable) instead of converging; standalone postings keep the converge path. [apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts:221]
- [x] [Review][Patch] The refund journal description differs from AC4.3 (P16, low) — fixed: `Escrow refund on survey close: ${formTitle} (${unusedCompletions} unused slots)`; the unused slots are the open quota capped by what the Escrow still funds; refund replays compare accounts only (P8), so old journals still replay. [apps/backend/src/modules/economy/application/ledger.service.ts:786]
- [x] [Review][Defer] Row locks, `FOR UPDATE`/`FOR SHARE`, advisory locks and Unit-of-Work rollback are never exercised against PostgreSQL (DF5, medium, also Stories 6.4/6.6) [apps/backend/test/forms-escrow.e2e-spec.ts] — deferred: needs the Postgres test container (`deferred-work.md` 1.1/1.2/6.6/8.1 entries); in-memory doubles cannot prove rollback. New mocked-transaction specs cover the P6/P7/P14 SQL paths.
- [x] [Review][Defer] No refund on survey expiration and no Publisher notification of the refund amount (DF6, low) [apps/backend/src/modules/forms/application/forms.service.ts:624] — deferred: the Form has no deadline field (data-model/product work); the refund notification is FR-32, not in the 6.3/Epic AC as written (`ESCROW_RELEASED` exists for a later producer).

---

## Dev Notes
- **Pricing Bands (FR-14):**
  - `< 5 min`: 5–10 Points
  - `5–10 min`: 10–20 Points
  - `10–15 min`: 15–25 Points
  - `> 15 min`: 20–40 Points
- **20% Internal Discount (FR-19):**
  - Internal forms calculate cost per response as `Math.round(rewardPerResponse * 0.8)`.
- **Escrow Invariant (FR-15, FR-32):**
  - Total escrow = `expectedCompletions * effectiveRewardPerResponse`.
  - Lock moves from `USER_AVAILABLE` to `ESCROW`.
  - Refund on close moves unused points from `ESCROW` to `USER_AVAILABLE`.
  - Idempotency keys must follow ARCHITECTURE-SPINE conventions: `publish:${formVersionId}`, `close-refund:${formId}:${versionNumber}`, `reopen-escrow:${formId}:${reopenVersionNumber}`.
- **Code review 2026-09-26 — key deviation (P3):** AC4.3/AC5.3 keyed close and reopen by the FormVersion number, but reopening keeps the version, so every close/reopen cycle collided (second refund swallowed, second reopen unfunded). Keys are now `close-refund:${formId}:c${closeCount}` and `reopen-escrow:${formId}:c${closeCount}` (`Form.closeCount` = times the survey entered CLOSED). This keeps AD-16's `close-refund:{formId}:{closeVersion}` shape; the `c` prefix never collides with legacy `{versionNumber}` journals, which are still counted by the per-form Escrow position.
- **Code review 2026-09-26 — per-form Escrow position (P4):** one ESCROW account is pooled per Publisher, so the refund/re-publication math is derived from the form's own journals (reserved − refunded − consumed − owed), not from `expected − completed` × reward or the pooled balance. The per-completion draw is `escrowDrawPerCompletion(form)` (decision D1).
- **Decision E6-D1 (2026-09-26, option B — platform subsidy):** an Internal payout credits the full advertised `rewardPerResponse` in ONE balanced journal: ESCROW −`round(0.8 × reward)` (exactly what publish reserved per slot), SYSTEM_ISSUANCE −the rest (omitted when rounding makes it 0), Respondent +reward (`internalRewardFunding` in `escrow.schema.ts`). Escrow invariant: paying 100% of an Internal quota leaves that form's Escrow at exactly 0. Points are not redeemable for cash (FR-34), so the minted ~20% is a contained policy cost.
- **Decision E6-D2 (2026-09-26, option (a)):** `Form.estimatedDurationMinutes` (optional, whole minutes 1..1440) picks the FR-14 band; the band (min AND max) is enforced when a survey is published (`publishForm`, External `autoPublish`) — never on drafts, never re-checked at moderation approval. Free (0-point) Internal surveys are exempt (AC3.1); every other survey needs a duration (422 `ESTIMATED_DURATION_REQUIRED`) and an in-band reward (400 `PRICING_REWARD_OUT_OF_BAND`, `{min,max,suggested}` — this is AC1.2's `PricingRewardBelowMinimumException`, named for both bounds). Sub-question default: the band maximum (40) applies at publish; the 10,000 schema cap remains the draft input limit. Legacy rows already queued/published are not re-priced.

---

## Dev Agent Record

### Implementation Plan
1. Task 1: Create shared schemas for pricing table (FR-14) and escrow calculation (FR-19, FR-33) in `packages/schemas`.
2. Task 2: Implement `reserveEscrow`, `refundUnusedEscrow`, and `reopenEscrow` in `LedgerService` with `InsufficientEscrowBalanceException`.
3. Task 3: Implement `FormsEscrowCoordinator` in `apps/backend/src/modules/forms` and update `FormRepositoryPort` with `countCompletedResponses`.
4. Task 4: Integrate coordinator into `FormsService` (`publishForm`, `closeForm`, `reopenForm`, `getPricingQuote`) and add endpoints to `FormsController`.
5. Task 5: Author integration and E2E tests and verify all test suites across workspaces.

### Completion Notes
- All 106 schema tests in `@rescom/schemas` passed across 9 test suites.
- All 635 unit/integration tests in `apps/backend` passed across 63 test suites.
- All 28 frontend tests passed.
- E2E tests in `test/forms-escrow.e2e-spec.ts` and `test/ledger.e2e-spec.ts` passed completely.
- TypeScript typecheck and Next.js / NestJS production builds completed with 0 errors.
- Code review 2026-09-26: applied P3, P4, P6, P7, P12, P13, P14, P16 (per-close keys via `Form.closeCount`, per-form Escrow position with shortfall-only re-publication, completions blocked after close under a form row lock, ledger reads joining the ambient Unit of Work, reopen cap, owner-only reopen, retryable concurrent-duplicate error, AC4.3 refund text); decisions D1 (who funds the 20% Internal discount) and D2 (FR-14 pricing bands) await the user, so the story stays `in-progress`. Verification: schemas 343, backend unit 1183 (93 suites), backend e2e 275 passed / 3 skipped (30 suites), frontend 173, typecheck + lint clean, `prisma validate` clean.
- Decision follow-up 2026-09-26 (E6-D1 option B, E6-D2 option (a), accepted by Quan): platform-subsidised Internal payouts (3-entry journal, one draw helper) and publish-time FR-14 band enforcement with the new `estimatedDurationMinutes` Form field (schemas, Prisma + migration, builder and External wizard UI, pricing quote band). Existing fixtures that published rewarded surveys without a duration (or, in one case, with an out-of-band reward of 50) were given deliberate in-band durations/rewards. Verification: schemas 388 (23 suites), backend unit 1409 (98 suites), backend e2e 290 passed / 3 skipped (30 suites), frontend 230, typecheck + lint clean, `prisma validate` clean.

---

## File List
- `_bmad-output/implementation-artifacts/6-3-escrow-lock-release-refund.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/schemas/src/economy/pricing.schema.ts`
- `packages/schemas/src/economy/pricing.schema.spec.ts`
- `packages/schemas/src/economy/escrow.schema.ts`
- `packages/schemas/src/economy/escrow.schema.spec.ts`
- `packages/schemas/src/economy/index.ts`
- `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts`
- `apps/backend/src/modules/economy/application/ledger.service.spec.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/modules/forms/application/ports/form-repository.port.ts`
- `apps/backend/src/modules/forms/infrastructure/in-memory-form.repository.ts`
- `apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts`
- `apps/backend/src/modules/forms/application/forms-escrow.coordinator.ts`
- `apps/backend/src/modules/forms/application/forms-escrow.coordinator.spec.ts`
- `apps/backend/src/modules/forms/application/forms.service.ts`
- `apps/backend/src/modules/forms/application/forms.service.spec.ts`
- `apps/backend/src/modules/forms/presentation/forms.controller.ts`
- `apps/backend/src/modules/forms/presentation/forms.controller.spec.ts`
- `apps/backend/src/modules/forms/forms.module.ts`
- `apps/backend/test/forms-escrow.e2e-spec.ts`
- Code review 2026-09-26 (P3/P4/P6/P7/P12/P13/P14/P16):
  - `apps/backend/prisma/schema.prisma` (`Form.closeCount`)
  - `apps/backend/prisma/migrations/20260926220000_form_close_count/migration.sql` (new)
  - `apps/backend/src/common/database/prisma-unit-of-work.ts` (+ spec)
  - `apps/backend/src/common/database/completion-counts.ts` (+ new `completion-counts.spec.ts`)
  - `apps/backend/src/common/http/http-exception.filter.ts` (+ spec)
  - `apps/backend/src/modules/economy/application/ledger.service.ts` (+ spec)
  - `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`
  - `apps/backend/src/modules/economy/application/ports/ledger-repository.port.ts`
  - `apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts` (+ new `prisma-ledger.repository.spec.ts`)
  - `apps/backend/src/modules/economy/infrastructure/in-memory-ledger.repository.ts`
  - `apps/backend/src/modules/economy/economy.module.ts`
  - `apps/backend/src/modules/forms/domain/form.entity.ts`
  - `apps/backend/src/modules/forms/application/forms-escrow.coordinator.ts` (+ spec)
  - `apps/backend/src/modules/forms/application/forms.service.ts` (+ spec)
  - `apps/backend/src/modules/forms/application/form-moderation.commands.ts` (+ spec)
  - `apps/backend/src/modules/forms/application/ports/form-repository.port.ts`
  - `apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts`
  - `apps/backend/src/modules/forms/infrastructure/in-memory-form.repository.ts`
  - `apps/backend/src/modules/moderation/application/survey-moderation.service.ts` (+ spec, `survey-moderation.repositories.spec.ts`)
  - `apps/backend/src/modules/participation/application/participation.service.ts` (+ spec)
  - `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts`
  - `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts` (+ new spec)
  - `apps/backend/src/modules/participation/infrastructure/in-memory-participation.repository.ts`
  - `packages/schemas/src/economy/escrow.schema.ts` (+ spec)
  - `apps/backend/test/forms-escrow.e2e-spec.ts`, `apps/backend/test/survey-moderation.e2e-spec.ts`
  - `_bmad-output/implementation-artifacts/deferred-work.md`
- Decision follow-up 2026-09-26 (E6-D1, E6-D2):
  - `packages/schemas/src/economy/escrow.schema.ts` (+ spec: `internalRewardFunding`)
  - `packages/schemas/src/economy/pricing.schema.ts` (+ spec: `estimatedDurationMinutesSchema`, `checkPublishRewardBand`, `PricingQuoteDto`)
  - `packages/schemas/src/forms/form-draft.schema.ts`, `packages/schemas/src/forms/external-form.schema.ts`, `packages/schemas/src/forms/form-publish.schema.ts`, `packages/schemas/src/forms/internal-submission.schema.ts`
  - `apps/backend/prisma/schema.prisma` (`Form.estimatedDurationMinutes`)
  - `apps/backend/prisma/migrations/20260926233000_form_estimated_duration_minutes/migration.sql` (new)
  - `apps/backend/src/modules/economy/application/ledger.service.ts` (+ spec), `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts`
  - `apps/backend/src/modules/forms/domain/form.entity.ts`, `apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts` (+ spec)
  - `apps/backend/src/modules/forms/application/form-publishability.ts`, `apps/backend/src/modules/forms/application/forms.service.ts` (+ spec), `apps/backend/src/modules/forms/application/forms-escrow.coordinator.spec.ts`
  - `apps/backend/src/modules/forms/application/exceptions/form.exceptions.ts`, `apps/backend/src/common/http/http-exception.filter.ts` (+ spec)
  - `apps/backend/src/modules/forms/presentation/forms.controller.spec.ts`, `apps/backend/src/modules/moderation/application/survey-moderation.service.spec.ts`
  - `apps/backend/src/modules/participation/application/participation.service.ts`, `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts`
  - `apps/backend/test/forms-escrow.e2e-spec.ts`, `apps/backend/test/forms-publish.e2e-spec.ts`, `apps/backend/test/survey-moderation.e2e-spec.ts`, `apps/backend/test/reward-settlement.e2e-spec.ts`
  - `apps/frontend/my-app/app/forms/pricing-band.ts` (new), `apps/frontend/my-app/tests/pricing-band.test.mjs` (new)
  - `apps/frontend/my-app/app/forms/[id]/edit/page.tsx`, `apps/frontend/my-app/app/forms/[id]/edit/PublishConfirmationModal.tsx`, `apps/frontend/my-app/app/forms/components/CreateExternalSurveyModal.tsx`
  - `_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, `_bmad-output/implementation-artifacts/deferred-work.md`

---

## Change Log
- 2026-09-24: Implemented Story 6.3 Escrow Lock, Release & Refund (FR-14, FR-15, FR-19, FR-32, FR-33) per BMAD dev-story workflow. All acceptance criteria AC1-AC7 implemented and verified. Status moved to `review`.
- 2026-09-26: Code review 2026-09-26: 2 decisions open (D1, D2), 8 patches applied (P3, P4, P6, P7, P12, P13, P14, P16), 2 deferred (DF5, DF6); `Form.closeCount` migration added. Status → `in-progress` until D1/D2 are decided.
- 2026-09-26: Decision follow-up 2026-09-26: E6-D1 → option B (platform subsidy: Internal payouts credit the full reward in one journal, Escrow pays the reserved 80%, SYSTEM_ISSUANCE the rest); E6-D2 → option (a) (`Form.estimatedDurationMinutes` + migration `20260926233000_form_estimated_duration_minutes`, FR-14 band min/max enforced at publish with 400 `PRICING_REWARD_OUT_OF_BAND`, 0-point Internal exempt, band in the pricing quote, builder + wizard UI). No unchecked decision/patch items remain → Status `done`.
