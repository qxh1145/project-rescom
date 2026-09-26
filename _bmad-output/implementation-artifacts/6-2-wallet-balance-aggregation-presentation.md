---
baseline_commit: a40a63c202dfab9d3bac0b818eb5287211e1070d
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "_bmad-output/implementation-artifacts/6-1-double-entry-ledger-core-idempotency.md"
  - "packages/schemas/src/economy/index.ts"
  - "apps/backend/src/modules/economy/application/ledger.service.ts"
---

# Story 6.2: Wallet Balance Aggregation & Presentation

Status: done

## Story

As a User,
I want to view my current point balances,
So that I know how much I can spend or withdraw.

## Acceptance Criteria

### AC1 — Wallet Contracts & Shared Schemas (`packages/schemas`)
**Given** the shared schema package
**When** defining wallet balance and transaction contracts
**Then**:
1. `walletBalanceSchema` validates:
   - `available`: integer (points in `USER_AVAILABLE`)
   - `pending`: integer (points in `PENDING`)
   - `escrow`: integer (points in `ESCROW`)
   - `frozen`: integer (points in `FROZEN`)
   - `integrityHold`: integer (points in `INTEGRITY_HOLD`)
   - `total`: integer (sum of all 5 balances)
2. `walletTransactionItemSchema` validates historical ledger entries:
   - `id`: string UUID
   - `journalId`: string UUID
   - `amount`: integer (signed)
   - `accountClass`: `LedgerAccountClass`
   - `description`: string nullable
   - `idempotencyKey`: string
   - `createdAt`: ISO date string
   - `reversesJournalId`: string UUID nullable
3. `walletDetailsSchema` validates the complete wallet payload:
   - `balance`: `walletBalanceSchema`
   - `transactions`: array of `walletTransactionItemSchema`
   - `accounts`: array of `ledgerAccountSchema`
4. TypeScript DTO types are exported from `@rescom/schemas`.

### AC2 — Backend Balance Aggregation & Transaction Query (`apps/backend`)
**Given** an authenticated user requesting their wallet
**When** the backend aggregates wallet information
**Then**:
1. Ensures all 5 user account classes (`USER_AVAILABLE`, `PENDING`, `FROZEN`, `ESCROW`, `INTEGRITY_HOLD`) exist for the user, initializing any missing accounts with balance 0.
2. Derives the balances from the authoritative ledger projection rows:
   - `available = USER_AVAILABLE.balance`
   - `pending = PENDING.balance`
   - `escrow = ESCROW.balance`
   - `frozen = FROZEN.balance`
   - `integrityHold = INTEGRITY_HOLD.balance`
   - `total = available + pending + escrow + frozen + integrityHold`
3. Retrieves historical transactions for the user's accounts, ordered by `createdAt` descending, mapping each entry with its parent journal description, idempotencyKey, and accountClass.
4. Supports both `InMemoryLedgerRepository` and `PrismaLedgerRepository`.

### AC3 — Wallet API Presentation (`apps/backend`)
**Given** an authenticated user
**When** requesting `GET /api/economy/wallet` (or alias `GET /economy/wallet`)
**Then**:
1. Requires authenticated session (`SessionAuthGuard`).
2. Returns HTTP 200 with standard response envelope containing `WalletDetailsDto`.
3. Unauthenticated requests are rejected with HTTP 401.

### AC4 — Frontend Wallet Dashboard UI (`apps/frontend/my-app`)
**Given** an authenticated user navigating to `/wallet`
**When** the page loads
**Then**:
1. Fetches wallet details from `/api/economy/wallet`.
2. Clearly displays 5 distinct balance cards (FR-31):
   - **Available Balance**: spendable points highlighted with prominent visual weight.
   - **Pending Balance**: points awaiting external survey release (48h).
   - **Escrowed Points**: points locked in active survey publishing quotas.
   - **Frozen Points**: starter onboarding points awaiting unlocking tasks.
   - **Integrity Hold**: points held during automated or manual review.
3. Provides an explanatory guide for each balance type, explicitly clarifying spendable vs held points (FR-31).
4. Displays a comprehensive transaction history list:
   - Formatted date & relative time.
   - Balance category tag / badge.
   - Transaction description / purpose.
   - Color-coded signed amount (+ green for credits, - red for debits).
5. Handles loading state with skeletons and error state with retry.
6. Displays empty state when no transactions exist.
7. Adds navigation link to `/wallet` in top navigation bars across Marketplace and Forms.

### AC5 — Comprehensive Test Coverage
**Given** test suites across workspaces
**When** running unit, integration, and E2E tests
**Then**:
1. Schemas unit tests verify wallet balance calculation and validation.
2. Backend unit tests cover `getWallet` with multiple accounts and transaction history ordering.
3. E2E tests in `apps/backend/test/ledger.e2e-spec.ts` verify `GET /economy/wallet`.
4. All workspace tests and production builds pass with zero errors.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Schemas for Wallet (`packages/schemas`)** (AC: 1)
  - [x] 1.1 Create `packages/schemas/src/economy/wallet.schema.ts` defining `walletBalanceSchema`, `walletTransactionItemSchema`, `walletDetailsSchema`, and DTO types.
  - [x] 1.2 Export from `packages/schemas/src/economy/index.ts` and `packages/schemas/src/index.ts`.
  - [x] 1.3 Add unit tests in `packages/schemas/src/economy/wallet.schema.spec.ts`.

- [x] **Task 2: Backend Wallet Aggregation & Querying (`apps/backend`)** (AC: 2)
  - [x] 2.1 Update `LedgerRepositoryPort` in `apps/backend/src/modules/economy/application/ports/ledger-repository.port.ts` to add `findTransactionsByUserId(userId, limit, offset)`.
  - [x] 2.2 Implement `findTransactionsByUserId` in `InMemoryLedgerRepository`.
  - [x] 2.3 Implement `findTransactionsByUserId` in `PrismaLedgerRepository`.
  - [x] 2.4 Implement `getWallet(userId)` in `LedgerService` with auto-provisioning of all 5 user account classes.
  - [x] 2.5 Author unit tests for wallet aggregation in `apps/backend/src/modules/economy/application/ledger.service.spec.ts`.

- [x] **Task 3: Backend Wallet Controller & E2E Tests (`apps/backend`)** (AC: 3)
  - [x] 3.1 Add `GET wallet` endpoint in `LedgerController` (`apps/backend/src/modules/economy/presentation/ledger.controller.ts`).
  - [x] 3.2 Update `ledger.controller.spec.ts` with wallet endpoint tests.
  - [x] 3.3 Add E2E test cases for `GET /economy/wallet` in `apps/backend/test/ledger.e2e-spec.ts`.

- [x] **Task 4: Frontend Wallet Dashboard UI (`apps/frontend/my-app`)** (AC: 4)
  - [x] 4.1 Create `apps/frontend/my-app/app/wallet/wallet-api.ts` with `fetchWalletDetails()`.
  - [x] 4.2 Create `apps/frontend/my-app/app/wallet/page.tsx` with balance cards, balance explainer, and transaction history table.
  - [x] 4.3 Add navigation links to `/wallet` in `apps/frontend/my-app/app/marketplace/page.tsx` and `apps/frontend/my-app/app/forms/page.tsx`.

- [x] **Task 5: Verification & Full Suite Validation** (AC: 5)
  - [x] 5.1 Run all tests across workspaces (`packages/schemas`, `apps/backend`, `apps/frontend/my-app`).
  - [x] 5.2 Verify production builds for backend and frontend.

---

## Dev Notes
- **FR-31 Compliance:**
  The wallet dashboard is the single source of financial presentation for users. It presents the complete breakdown of points across all five account classes (`Available`, `Pending`, `Escrow`, `Frozen`, `Integrity Hold`) and immutable ledger history.
- **Auto-provisioning:**
  A user may register without immediately having all 5 account types created. When `getWallet` is called, any missing account classes for that user are seamlessly initialized to 0 balance, ensuring predictable response structures without null checks in the frontend.
- **Clean Architecture Boundary:**
  `LedgerService` remains a pure application service in `src/modules/economy/application/` without `@nestjs/*` or `@prisma/*` imports, conforming to boundary test rules.

---

## Dev Agent Record

### Implementation Plan
1. **Task 1: Shared Schemas** (`packages/schemas/src/economy/`)
   - Define `walletBalanceSchema`, `walletTransactionItemSchema`, `walletDetailsSchema`, and helper `calculateWalletTotal`.
   - Export schemas and DTO types in `@rescom/schemas`.
   - Add unit test suite in `packages/schemas/src/economy/wallet.schema.spec.ts`.
2. **Task 2: Backend Wallet Aggregation & Querying** (`apps/backend`)
   - Add `findTransactionsByUserId` to `LedgerRepositoryPort`.
   - Implement `findTransactionsByUserId` in `InMemoryLedgerRepository` (with deterministic insertion index tie-breaking) and `PrismaLedgerRepository`.
   - Implement `getWallet` in `LedgerService` with auto-provisioning of all 5 user account classes (`USER_AVAILABLE`, `PENDING`, `FROZEN`, `ESCROW`, `INTEGRITY_HOLD`).
   - Add unit tests in `apps/backend/src/modules/economy/application/ledger.service.spec.ts`.
3. **Task 3: Backend Presentation & Tests** (`apps/backend`)
   - Add `@Get('wallet')` to `LedgerController` with `SessionAuthGuard`.
   - Add unit tests in `ledger.controller.spec.ts`.
   - Add E2E tests in `test/ledger.e2e-spec.ts`.
4. **Task 4: Frontend Wallet Dashboard UI** (`apps/frontend/my-app`)
   - Create `apps/frontend/my-app/app/wallet/wallet-api.ts` with error handling.
   - Create `apps/frontend/my-app/app/wallet/page.tsx` with total balance summary, 5 balance category cards, FR-31 balance type guide, and transaction history table with account filter.
   - Add "My Wallet" navigation links in `/marketplace` and `/forms`.
   - Add frontend unit tests in `tests/wallet-api.test.mjs`.
5. **Task 5: Verification & Builds**
   - Run unit tests across all workspaces: 88 passing in `@rescom/schemas`, 610 passing in `backend`, 27 passing in `apps/frontend/my-app`.
   - Run `apps/backend` build and `apps/frontend/my-app` Next.js production build.

### Completion Notes
- All 88 tests in `@rescom/schemas` passed.
- All 610 unit/integration tests across 62 test suites in `apps/backend` passed.
- All 11 ledger E2E tests in `test/ledger.e2e-spec.ts` passed.
- All 27 tests in `apps/frontend/my-app` passed.
- Clean Architecture boundary validation (`test/architecture.spec.ts`) passed with zero violations.
- Production builds for both `backend` and `apps/frontend/my-app` succeeded with zero errors.

---

## File List
- `_bmad-output/implementation-artifacts/6-2-wallet-balance-aggregation-presentation.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/schemas/src/economy/wallet.schema.ts`
- `packages/schemas/src/economy/wallet.schema.spec.ts`
- `packages/schemas/src/economy/index.ts`
- `apps/backend/src/modules/economy/application/ports/ledger-repository.port.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-ledger.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts`
- `apps/backend/src/modules/economy/application/ledger.service.spec.ts`
- `apps/backend/src/modules/economy/presentation/ledger.controller.ts`
- `apps/backend/src/modules/economy/presentation/ledger.controller.spec.ts`
- `apps/backend/test/ledger.e2e-spec.ts`
- `apps/frontend/my-app/app/wallet/wallet-api.ts`
- `apps/frontend/my-app/app/wallet/page.tsx`
- `apps/frontend/my-app/app/marketplace/page.tsx`
### Review Findings

#### Patches
- [x] [Review][Patch] Enforce non-negative bounds and balance sum coherence in `walletBalanceSchema` [packages/schemas/src/economy/wallet.schema.ts:4]
- [x] [Review][Patch] Make `reversesJournalId` strictly nullable without optional modifier per AC1.2 [packages/schemas/src/economy/wallet.schema.ts:23]
- [x] [Review][Patch] Reuse `calculateWalletTotal` in `LedgerService.getWallet` instead of duplicate arithmetic [apps/backend/src/modules/economy/application/ledger.service.ts:131]
- [x] [Review][Patch] Eliminate N+1 sequential account check queries by querying existing user accounts once upfront and auto-provisioning missing classes [apps/backend/src/modules/economy/application/ledger.service.ts:114]
- [x] [Review][Patch] Add deterministic secondary tie-breaker `{ id: 'desc' }` to transaction query in `PrismaLedgerRepository` [apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts:243]
- [x] [Review][Patch] Guard negative offset and bounds check entity lookups in `InMemoryLedgerRepository` [apps/backend/src/modules/economy/infrastructure/in-memory-ledger.repository.ts:213]
- [x] [Review][Patch] Replace loose `any` casts with typed Prisma client interfaces in `PrismaLedgerRepository` [apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts:49]
- [x] [Review][Patch] Mount dual routes `@Controller(['economy', 'api/economy'])` on backend `LedgerController` to satisfy AC3 direct URL routing [apps/backend/src/modules/economy/presentation/ledger.controller.ts:28]
- [x] [Review][Patch] Add pagination parameters (`limit`, `offset`) to `getWallet` in service and controller with safe defaults [apps/backend/src/modules/economy/presentation/ledger.controller.ts:61]
- [x] [Review][Patch] Add E2E test verifying non-zero balances and transaction history in `apps/backend/test/ledger.e2e-spec.ts` [apps/backend/test/ledger.e2e-spec.ts:366]
- [x] [Review][Patch] Implement relative time formatting and complete 5-tier explanations in Frontend Wallet UI [apps/frontend/my-app/app/wallet/page.tsx:260]
- [x] [Review][Patch] Add safe schema validation, AbortSignal support, accessible table semantics, and neutral zero-amount formatting in Frontend Wallet [apps/frontend/my-app/app/wallet/wallet-api.ts:3]

#### Deferred Items
- [x] [Review][Defer] Add composite indexes on `ledger_accounts(user_id)` and `ledger_entries(account_id, created_at)` [apps/backend/prisma/schema.prisma:409] — deferred, pre-existing schema structure from Story 6.1 requiring database migration.
- [x] [Review][Defer] Add compound unique constraint `@@unique([userId, accountClass, currency])` on `LedgerAccount` [apps/backend/prisma/schema.prisma:422] — deferred, pre-existing schema structure from Story 6.1 requiring database migration.

---

## Change Log
- 2026-09-23: Implemented Story 6.2 Wallet Balance Aggregation & Presentation per BMAD dev-story workflow. All acceptance criteria AC1-AC5 implemented and verified. Status moved to `review`.
- 2026-09-24: BMAD adversarial code review completed. 12 patch items identified, 2 pre-existing schema items deferred, 1 item dismissed.
- 2026-09-24: All 12 code review patches applied and verified across unit/E2E test suites and Next.js production builds. Story status moved to `done`.
