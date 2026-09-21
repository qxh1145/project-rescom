---
baseline_commit: a40a63c202dfab9d3bac0b818eb5287211e1070d
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "apps/backend/prisma/schema.prisma"
---

# Story 6.1: Double-Entry Ledger Core & Idempotency

Status: review

## Story

As a System Architect,
I want all point movements to be recorded in a double-entry ledger database,
So that point balances are strictly auditable and immune to race conditions or lost data.

## Acceptance Criteria

### AC1 — Shared Ledger Schemas & Validation Contracts (`packages/schemas`)
**Given** the shared schema package
**When** defining ledger account, journal, and entry contracts
**Then**:
1. `ledgerAccountClassSchema` defines: `'USER_AVAILABLE' | 'PENDING' | 'FROZEN' | 'ESCROW' | 'INTEGRITY_HOLD' | 'SYSTEM_ISSUANCE' | 'SYSTEM_SINK' | 'SYSTEM_CLEARING'`.
2. `ledgerAccountSchema` validates account representation:
   - `id`: string UUID
   - `userId`: string UUID nullable (null for system accounts)
   - `accountClass`: `LedgerAccountClass`
   - `currency`: string (default `'POINTS'`)
   - `balance`: integer
   - `createdAt`: ISO date string
   - `updatedAt`: ISO date string
3. `postJournalInputSchema` validates financial journal commands:
   - `idempotencyKey`: string (min 1, max 255)
   - `description`: string optional
   - `entries`: array of entries with min 2 items, where each entry has `accountId` (UUID) and `amount` (integer, non-zero)
   - Enforces zero-sum invariant across entries: `sum(entries.map(e => e.amount)) === 0`.
4. `reverseJournalInputSchema` validates reversal commands:
   - `targetJournalId`: string UUID
   - `idempotencyKey`: string optional (defaults to deterministic key `reversal:{targetJournalId}`)
   - `reason`: string optional
5. TypeScript DTO types are exported from `@rescom/schemas`.

### AC2 — Overdraft Protection & Ascending Lock Order (`apps/backend`)
**Given** any point movement execution
**When** posting entries to ledger accounts
**Then**:
1. User accounts (`USER_AVAILABLE`, `PENDING`, `FROZEN`, `ESCROW`, `INTEGRITY_HOLD`) cannot overdraft: `balance + delta >= 0` is strictly enforced.
2. Only configured system accounts (`SYSTEM_ISSUANCE`, `SYSTEM_SINK`, `SYSTEM_CLEARING`) may carry the opposite/negative balance.
3. If an account would overdraft, rejects with `InsufficientBalanceException` (HTTP 400/409, `INSUFFICIENT_BALANCE`).
4. Deadlock prevention: Posting locks affected account balance rows in strictly **ascending account-ID order** (`accountIds.sort()`), checks sufficiency, appends entries, and updates the denormalized balance projection in the same database transaction.

### AC3 — Idempotency & Replay Protection (`apps/backend`)
**Given** a financial transaction command with an `idempotencyKey`
**When** processing the posting request
**Then**:
1. If a journal with the given `idempotencyKey` already exists:
   - Verifies whether the existing journal's command matches (same accounts, amounts, description).
   - If compatible: returns the existing journal without inserting duplicate entries (safe idempotent retry).
   - If incompatible (same key used with conflicting payload): rejects with `IdempotencyConflictException` (HTTP 409, `IDEMPOTENCY_CONFLICT`).
2. Concurrent race requests with the same `idempotencyKey` are safely handled via database unique constraint on `idempotency_key`.

### AC4 — Append-Only Immutability & One-Time Exact Reversal (`apps/backend`)
**Given** posted journals and entries
**When** audited or corrected
**Then**:
1. Posted records are append-only: no UPDATE or DELETE on `ledger_journals` or `ledger_entries`.
2. Each journal can be reversed at most once through a unique `reversesJournalId` journal that exactly negates its entries (`-amount` for each original entry).
3. If attempting to reverse an already-reversed journal, rejects with `JournalAlreadyReversedException` (HTTP 409, `JOURNAL_ALREADY_REVERSED`).
4. If attempting to reverse a non-existent journal, rejects with `JournalNotFoundException` (HTTP 404, `JOURNAL_NOT_FOUND`).
5. Reversal of a reversal forms a non-branching chain (`reversesJournalId` points to the prior reversal journal).

### AC5 — Balance Derivability & Ledger Integrity (`apps/backend`)
**Given** the financial ledger
**When** computing or auditing balances
**Then**:
1. Entries are the ultimate financial authority: account balance is derivable by summing all `LedgerEntry` amounts for that account (`sumEntriesByAccountId`).
2. Provides `verifyAccountBalance` to compare the denormalized projection with the calculated sum from entries.
3. Provides `reconcileAccountBalance` to repair any projection drift if ever encountered.
4. Provides `verifyLedgerIntegrity` verifying system-wide zero-sum balance ($\sum \text{amount} = 0$).

### AC6 — Economy Module & Clean Architecture
**Given** the backend architecture
**When** integrating the Economy module
**Then**:
1. `LedgerService` lives in `modules/economy/application` as a pure TypeScript class without framework imports (`@nestjs/common`).
2. Repositories implement `LedgerRepositoryPort` (`PrismaLedgerRepository` and `InMemoryLedgerRepository`).
3. Domain exceptions are mapped to clean error envelopes in `HttpExceptionFilter`.
4. `EconomyModule` is registered in `app.module.ts` and exports `LedgerService` and `LEDGER_REPOSITORY_PORT`.

### AC7 — Comprehensive Test Coverage
**Given** unit and integration/E2E test suites
**When** running tests
**Then**:
1. Schemas unit tests verify valid and unbalanced journal inputs, zero-sum rule, account classes.
2. `LedgerService` unit tests cover:
   - Successful multi-legged transfers (equal and opposite zero-sum entries)
   - Rejection of unbalanced journals
   - Overdraft rejection on user accounts
   - Allowance of negative balance on system issuance accounts
   - Idempotent retry with identical payload returns existing journal
   - Conflict detection on same idempotencyKey with different payload
   - Exact reversal generation and one-time constraint enforcement
   - Reversal chain (reversing a reversal)
   - Account balance derivation and ledger-wide zero-sum check
3. E2E integration tests in `apps/backend/test/ledger.e2e-spec.ts`.
4. All workspace tests pass.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Schemas for Economy & Ledger (`packages/schemas`)** (AC: 1)
  - [x] 1.1 Create `packages/schemas/src/economy/ledger-account.schema.ts` defining `ledgerAccountClassSchema`, `ledgerAccountSchema`, and `createAccountInputSchema`.
  - [x] 1.2 Create `packages/schemas/src/economy/ledger-entry.schema.ts` defining `ledgerEntrySchema` and `postEntryInputSchema`.
  - [x] 1.3 Create `packages/schemas/src/economy/ledger-journal.schema.ts` defining `ledgerJournalSchema`, `postJournalInputSchema` (with zero-sum refinement), and `reverseJournalInputSchema`.
  - [x] 1.4 Create `packages/schemas/src/economy/index.ts` and export from `packages/schemas/src/index.ts`.
  - [x] 1.5 Add unit tests in `packages/schemas/src/economy/ledger.schema.spec.ts`.

- [x] **Task 2: Backend Domain & Repository Ports (`apps/backend`)** (AC: 2, 4, 5, 6)
  - [x] 2.1 Create domain entities in `apps/backend/src/modules/economy/domain/`:
    - `ledger-account.entity.ts` (with `canOverdraft()`, `wouldOverdraft()`, `applyDelta()`)
    - `ledger-entry.entity.ts`
    - `ledger-journal.entity.ts` (with `isBalanced()`)
  - [x] 2.2 Define `LedgerRepositoryPort` in `apps/backend/src/modules/economy/application/ports/ledger-repository.port.ts`.
  - [x] 2.3 Define domain exceptions in `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`.
  - [x] 2.4 Register exceptions in `apps/backend/src/common/http/http-exception.filter.ts`.

- [x] **Task 3: Backend Application Service (`apps/backend`)** (AC: 2, 3, 4, 5)
  - [x] 3.1 Implement pure `LedgerService` in `apps/backend/src/modules/economy/application/ledger.service.ts`:
    - `getOrCreateAccount` for user and system accounts
    - `postJournal` with zero-sum validation, idempotency check, ascending lock ordering, overdraft check, balance update
    - `reverseJournal` with one-time reversal check, exact negation entries, non-branching chain
    - `transfer` convenience method
    - `verifyAccountBalance`, `reconcileAccountBalance`, `verifyLedgerIntegrity`
  - [x] 3.2 Author unit test suite in `apps/backend/src/modules/economy/application/ledger.service.spec.ts`.

- [x] **Task 4: Infrastructure Repositories & Database Migration (`apps/backend`)** (AC: 2, 3, 4, 5)
  - [x] 4.1 Implement `InMemoryLedgerRepository` in `apps/backend/src/modules/economy/infrastructure/in-memory-ledger.repository.ts`.
  - [x] 4.2 Implement `PrismaLedgerRepository` in `apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts` with PostgreSQL ascending row-locking and atomic transaction.
  - [x] 4.3 Create migration `apps/backend/prisma/migrations/20260917153000_double_entry_ledger/migration.sql` for ledger tables and indexes.

- [x] **Task 5: Presentation Layer, Module Wire-up & E2E Integration Tests (`apps/backend`)** (AC: 6, 7)
  - [x] 5.1 Implement `LedgerController` in `apps/backend/src/modules/economy/presentation/ledger.controller.ts`.
  - [x] 5.2 Implement `EconomyModule` in `apps/backend/src/modules/economy/economy.module.ts` and register in `apps/backend/src/app.module.ts`.
  - [x] 5.3 Author controller tests and E2E integration test in `apps/backend/test/ledger.e2e-spec.ts`.
  - [x] 5.4 Run all tests across workspaces and verify clean builds.

---

## Dev Notes
- **Ascending Row-Locking (Deadlock Prevention):**
  When multiple accounts are involved in a transaction, accounts must always be locked in sorted ascending order by account ID. This guarantees no circular wait conditions occur during concurrent transfers.
- **Zero-Sum Balance Invariant:**
  Every journal must have $\sum \text{amount} = 0$. User accounts can never have `balance < 0`. System issuance account balances track minted points (negative).
- **Clean Architecture Boundary:**
  `LedgerService` is a pure application service without NestJS decorators or framework dependencies.

---

## Dev Agent Record

### Implementation Plan
1. **Task 1: Shared Schemas** (`packages/schemas/src/economy/`)
   - Define account classes, ledger account, ledger entry, balanced post journal schema, and reverse journal schema.
   - Enforce zero-sum refinement on `postJournalInputSchema`.
   - Export schemas and types from `@rescom/schemas`.
   - Add unit test suite `ledger.schema.spec.ts`.
2. **Task 2: Backend Domain & Repository Ports** (`apps/backend`)
   - Create `LedgerAccountEntity`, `LedgerJournalEntity`, `LedgerEntryEntity`.
   - Define `LedgerRepositoryPort` symbol and interface.
   - Create domain exceptions and map to error envelopes in `HttpExceptionFilter`.
3. **Task 3: Pure Application Service** (`apps/backend`)
   - Implement pure `LedgerService` with zero-sum check, idempotency replay, overdraft prevention, ascending order locking, and one-time reversals.
   - Author comprehensive unit test suite in `ledger.service.spec.ts`.
4. **Task 4: Repositories & Database Migration**
   - Implement `InMemoryLedgerRepository` for fast in-memory execution and testing.
   - Implement `PrismaLedgerRepository` with PostgreSQL `SELECT ... FOR UPDATE` ascending lock order and Prisma interactive transaction.
   - Add SQL migration `20260917153000_double_entry_ledger/migration.sql`.
5. **Task 5: Controller, Module Wire-up & E2E Tests**
   - Implement `LedgerController` with endpoints for posting journals, reversals, balances, and ledger integrity.
   - Wire `EconomyModule` into `AppModule`.
   - Author E2E integration test in `apps/backend/test/ledger.e2e-spec.ts`.
   - Run tests and builds across all workspaces.

### Completion Notes
- All 81 schema tests in `@rescom/schemas` passed.
- All 606 unit/integration tests across 62 test suites in `apps/backend` passed.
- Clean Architecture boundary validation passed with zero violations.
- E2E integration tests in `test/ledger.e2e-spec.ts` verified double-entry posting, zero-sum checking, user overdraft protection, identical idempotent replay, conflict detection, exact negation reversals, and balance derivability.
- `apps/backend` and `apps/frontend/my-app` production builds passed with zero errors.

---

## File List
- `_bmad-output/implementation-artifacts/6-1-double-entry-ledger-core-idempotency.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/schemas/src/economy/ledger-account.schema.ts`
- `packages/schemas/src/economy/ledger-entry.schema.ts`
- `packages/schemas/src/economy/ledger-journal.schema.ts`
- `packages/schemas/src/economy/index.ts`
- `packages/schemas/src/economy/ledger.schema.spec.ts`
- `packages/schemas/src/index.ts`
- `apps/backend/src/modules/economy/domain/ledger-account.entity.ts`
- `apps/backend/src/modules/economy/domain/ledger-entry.entity.ts`
- `apps/backend/src/modules/economy/domain/ledger-journal.entity.ts`
- `apps/backend/src/modules/economy/application/ports/ledger-repository.port.ts`
- `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts`
- `apps/backend/src/modules/economy/application/ledger.service.spec.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-ledger.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts`
- `apps/backend/src/modules/economy/presentation/ledger.controller.ts`
- `apps/backend/src/modules/economy/presentation/ledger.controller.spec.ts`
- `apps/backend/src/modules/economy/economy.module.ts`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/prisma/migrations/20260917153000_double_entry_ledger/migration.sql`
- `apps/backend/test/ledger.e2e-spec.ts`

---

## Change Log
- 2026-09-17: Implemented Story 6.1 Double-Entry Ledger Core & Idempotency per BMAD dev-story workflow. All acceptance criteria AC1-AC7 implemented and verified. Status moved to `review`.
