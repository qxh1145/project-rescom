---
baseline_commit: 117a03a
---

# Story 12.7: Rewards Schema, Catalog & Code Inventory API

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Developer,
I want the Rewards module, data model, and Admin catalog API,
so that the catalog and code inventory are durable and consistent.

## Acceptance Criteria

1. **Ownership and tables.** Given PRD Open Question 25 is answered (planning defaults, see Open points), when the Rewards module and migrations are added, then Rewards owns `Voucher`, `VoucherPriceVersion` (append-only), `VoucherCode`, `FlashSale`, `FlashSaleItem`, `RedemptionQuote`, `Redemption` (append-only) and `CodeIssueReport` (AD-24, AD-16). Only the Rewards module reads/writes them.
2. **DB constraints.** The database enforces `remaining >= 0`, unique `(voucherId, code)`, unique `VoucherCode.redemptionId`, and RESTRICT delete on vouchers with redemptions (BR-04, BR-14, BR-15, BR-24).
3. **Admin API.** The Admin API supports create, edit, pause, hide, archive, CSV code import with dedup, and stock adjustment within the unissued, unreserved portion (BR-06). Every change is audited (FR-ADD-13).
4. **Price versions.** A price change writes a new price version and never rewrites a past redemption (BR-12). The BR-13 deviation rule follows the Open Question 23 decision (planning default: warning + audit record, no second Admin).
5. **User catalog.** User catalog endpoints return effective price, status and server time, and match the Story 12.1 contracts (`voucher-catalog.schema.ts`).
6. **Migrations.** The full migration chain applies from an empty database and from the previous snapshot.

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.7 (FR-68, FR-70, FR-72, FR-ADD-13; BR-04, BR-06, BR-12–BR-16, BR-24; AD-16, AD-24).

## Tasks / Subtasks

- [x] **Task 1: Prisma schema + migration** (AC: 1, 2, 6)
  - [x] 1.1 Add enums and 9 models (list in "Data model" below) to `apps/backend/prisma/schema.prisma`, `@@map` snake_case plural, `@map` snake_case columns, uuid PK `@db.Uuid` (same style as `TopUpRequest`, `LedgerAccount`).
  - [x] 1.2 One migration `apps/backend/prisma/migrations/20261013120000_rewards_catalog_schema/migration.sql` (timestamp after `20261009110000_form_is_official`). Every DDL unconditional, no `to_regclass` guard (see `migration-chain.spec.ts`).
  - [x] 1.3 CHECK constraints and triggers Prisma cannot express go **both** in the migration and in `prisma/sql/post-push-invariants.sql`, and the invariants section of `20260927040000_reconcile_db_push_tables` must stay textually identical (a unit test enforces this: read how it compares and keep the markers). Prefer a **new** migration for the new objects and append the same text to `post-push-invariants.sql`; check `migration-chain.spec.ts` to see whether the reconcile-equality test covers later migrations before editing the reconcile file.
  - [x] 1.4 Seed the 6 brands (`highlands`, `lotteria`, `phuc-long`, `kfc`, `gong-cha`, `the-coffee-house`; names as in `apps/frontend/my-app/mocks/data/rewards.ts` `brands`) with `INSERT … ON CONFLICT DO NOTHING` in the migration (reference data, not demo data).
  - [x] 1.5 Update `test/migration-chain.prisma.e2e-spec.ts` / `migration-chain.spec.ts` expectations for the new objects.
- [x] **Task 2: Shared contracts (`packages/schemas/src/rewards/`, additive only)** (AC: 3, 4, 5)
  - [x] 2.1 Add `rewards-admin-audit.schema.ts`: `rewardsAdminAuditEventPayloadSchema` (`schemaVersion: 1`, `auditCategory: 'REWARDS_ADMIN_ACTION'`, `action` enum, `voucherId`, `adminId`, `before`/`after` summary, `correlationId`, `occurredAt`) — model on `survey-moderation.schema.ts` / `top-up.schema.ts`. Export from `rewards/index.ts` (names must not start with `reward*` — 12.1 collision rule; use `rewardsAdmin…` is fine, it is plural-`rewards`).
  - [x] 2.2 Additive optional `sharedCode` on `adminVoucherInputSchema` (see Open points #3). Add error code constants for the Admin API (`REWARDS_ADMIN_ERROR_CODES`, list in "Error codes").
  - [x] 2.3 Keep `*.spec.ts` green; add cases for new schemas. **Do not change existing field names/shapes** — the FE mocks are bound to them.
- [x] **Task 3: Domain + application (no Nest/Prisma imports; `test/architecture.spec.ts` enforces)** (AC: 2, 3, 4, 5)
  - [x] 3.1 `domain/`: `voucher.entity.ts` (state machine ACTIVE↔PAUSED→ARCHIVED, visibility, stock counters), `voucher-price.ts` (pure `effectivePrice(voucher, activeFlashItem)` Flash > promo > base; `discountPercent` identical to `voucherDiscountPercent`), `voucher-availability.ts` (pure status: AVAILABLE/SOLD_OUT/EXPIRED/PAUSED for users, ACTIVE/PAUSED/SOLD_OUT/EXPIRED/HIDDEN/ARCHIVED for Admin), `stock.ts` (pure `stockAdjustmentDecision`, `importCodesDecision`). Port the logic from `apps/frontend/my-app/mocks/data/rewards-rules.ts` (it is the executable spec) — same function semantics, same error codes.
  - [x] 3.2 `application/ports/`: `voucher-repository.port.ts`, `voucher-code-repository.port.ts`, `flash-sale-read.port.ts` (read-only here; 12.9 owns writes), `wallet-balance.port.ts` (see Data/ports), `rewards.constants.ts`. Symbols named `*_PORT`.
  - [x] 3.3 `application/rewards-admin-catalog.service.ts`: create, update (PUT), patch state/visibility, change price, adjust stock, import codes (VALIDATE/COMMIT), list, detail, brands. Each mutation runs under `UnitOfWorkPort.run('rewards-admin:{voucherId}:{action}', …)`, re-verifies live Admin capability via `ADMIN_CAPABILITY_PORT` (like `SurveyModerationService`), and appends an audit Outbox event in the same transaction (idempotencyKey `admin-audit:rewards:{voucherId}:{correlationId}`).
  - [x] 3.4 `application/rewards-catalog.service.ts`: user list (filters, sort, pagination, `affordable`), detail, Flash list; compute effective price/status from DB rows at the injected `Clock` (never client time). Return `serverTime` and `viewer {available, pending}`.
  - [x] 3.5 Domain exceptions in `application/exceptions/` (class + `code` like `moderation` exceptions) and map them in `src/common/http/http-exception.filter.ts` (see "Error codes").
- [x] **Task 4: Infrastructure** (AC: 1, 2, 3, 5)
  - [x] 4.1 `infrastructure/prisma-voucher.repository.ts`, `prisma-voucher-code.repository.ts`, `prisma-flash-sale-read.repository.ts`; join the ambient transaction exactly as `PrismaSurveyModerationRepository` / `prisma-unit-of-work.ts` do (do not open a second transaction).
  - [x] 4.2 In-memory twins (`in-memory-*.repository.ts`) for unit/e2e (non-Prisma) tests, with the same contract tests (`*.repositories.spec.ts` pattern from moderation: run one suite against both).
  - [x] 4.3 Stock mutations are single conditional `UPDATE … WHERE stock_remaining + :delta >= 0` (or `SELECT … FOR UPDATE` on the voucher row) — never read-modify-write in JS. Code import inserts with `createMany({ skipDuplicates: false })` inside the UoW and maps unique violation (`P2002`) to the per-code report.
  - [x] 4.4 Wallet balance adapter in **Economy** (not Rewards): small read-only `WalletBalancePort` implementation that returns `{ available, pending }` without creating accounts (do **not** call `LedgerService.getWallet`, it creates missing accounts on read). Rewards depends only on the port.
- [x] **Task 5: Presentation + module wiring** (AC: 3, 5)
  - [x] 5.1 `presentation/rewards-catalog.controller.ts`: `@Controller(['rewards', 'api/rewards'])`, `SessionAuthGuard`; `GET vouchers`, `GET vouchers/:id`, `GET flash-sales`.
  - [x] 5.2 `presentation/admin-rewards-vouchers.controller.ts`: `@Controller(['admin/rewards', 'api/admin/rewards'])`, `SessionAuthGuard, RolesGuard, CsrfGuard(writes), JsonOnlyGuard`, `@Roles('ADMIN')`; routes in "API surface". Query/body via `ZodValidationPipe` with the shared schemas (`VALIDATION_ERROR`).
  - [x] 5.3 `rewards.module.ts` (imports `PrismaModule, AuthModule`, Economy port provider); register in `src/app.module.ts`. `test/architecture.spec.ts` requires both route prefixes.
  - [x] 5.4 `Cache-Control: no-store` on Admin GETs and on the user list/detail (price and stock are time-sensitive).
- [x] **Task 6: Tests** (AC: 1–6)
  - [x] 6.1 Unit: domain (price precedence, status table, stock decision, import dedup), services with in-memory repos + `FixedClock` + `PassThroughUnitOfWork`; audit event emitted exactly once per mutation, never on rejected command.
  - [x] 6.2 Controller specs: guards, validation errors, envelope, both prefixes.
  - [x] 6.3 PostgreSQL e2e (`test/rewards-catalog.prisma.e2e-spec.ts`, pattern `moderation.prisma.e2e-spec.ts` / `financial-pg-harness.ts`): constraint violations (`remaining < 0`, duplicate `(voucherId, code)`, duplicate `redemptionId`, voucher delete with a redemption → RESTRICT), `VoucherPriceVersion`/`Redemption` UPDATE/DELETE rejected by trigger, concurrent stock adjustments never go below committed stock, concurrent identical code imports → one wins, no partial commit, migration applies on empty DB and on previous snapshot.
  - [x] 6.4 e2e (in-memory app, pattern `survey-moderation.e2e-spec.ts`): Admin 401/403/CSRF, full voucher lifecycle, user catalog shapes parsed with the **FE schemas** (`voucherCatalogSchema`, `voucherDetailResponseSchema`, `flashSaleListSchema`, `adminVoucher*Schema`) so contract drift fails here.
- [x] **Task 7: Verification**
  - [x] 7.1 `npm run prisma:validate`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` in `apps/backend`; `npm test` in `packages/schemas`; targeted `npm run test:e2e -- rewards`.
  - [x] 7.2 `prisma migrate deploy` on an empty scratch DB and on a DB at the previous migration; record output.
  - [x] 7.3 Frontend untouched: `node --test tests/*.test.mjs` in `apps/frontend/my-app` must still pass (schemas are shared).

### Review Findings

- [x] [Review][Decision] BRAND_NOT_FOUND / REDEMPTION_WINDOW_ENDED error shape — Spec "Error codes" says 400 `VALIDATION_ERROR` with per-field `details` `{path, code}` (mirrors mock `rewards-rules.ts:154-155`) but also lists 404 `BRAND_NOT_FOUND` "if a route-level lookup". Service/filter return top-level `code` BRAND_NOT_FOUND (404) / REDEMPTION_WINDOW_ENDED (400) with empty `details`; FE 12.11 flip would not see field errors. Options: (a) mirror mock: 400 VALIDATION_ERROR + details array (recommended, zero FE change); (b) keep 404 and adapt FE in 12.11. [rewards-admin-catalog.service.ts:278,334,344; http-exception.filter.ts:605-620] — resolved (a): filter maps BRAND_NOT_FOUND / REDEMPTION_WINDOW_ENDED / new SHARED_CODE_REQUIRED to 400 VALIDATION_ERROR with `details:[{path,code}]`
- [x] [Review][Patch] Non-UUID / array `x-correlation-id` → ZodError 500 after mutation; validate header in controller, fall back to generated UUID [admin-rewards-vouchers.controller.ts:77-176, rewards-admin-catalog.service.ts:163-190]
- [x] [Review][Patch] Reused `x-correlation-id` on same voucher → outbox idempotencyKey P2002 → 500 on every mutation; make audit key unique per mutation (e.g. add action + generated suffix) [rewards-admin-catalog.service.ts:171-190]
- [x] [Review][Patch] `importCodes` COMMIT catch swallows any P2002 (incl. audit-key collision) and returns `committed:false`; only translate when re-read shows real `alreadyStored`, else rethrow [rewards-admin-catalog.service.ts:525-541]
- [x] [Review][Patch] `removeAvailable` ignores affected-row count; drift between stockTotal and codes, FK RESTRICT → 500; assert count or throw `STOCK_EXCEEDS_CODES` [prisma-voucher-code.repository.ts:27-34]
- [x] [Review][Patch] `SHARED_FLAG_LOCKED` bypassed for shared vouchers (`hasIssued` counts voucher_codes only); also check `redemptions` / `stockRemaining < stockTotal` [prisma-voucher-code.repository.ts:36-42, rewards-admin-catalog.service.ts:335-339]
- [x] [Review][Patch] PUT toggling `isSharedCode` true without `sharedCode` → permanently SOLD_OUT; false keeps stale sharedCode; validate/clear [rewards-admin-catalog.service.ts:335-352]
- [x] [Review][Patch] BEST_DEAL sort lacks "then newest" tiebreak (gotcha 6) [rewards-catalog.service.ts:116]
- [x] [Review][Patch] BR-13 `deviation:true` audit flag not written on `create` [rewards-admin-catalog.service.ts:317]
- [x] [Review][Patch] `GET /rewards/flash-sales` missing `Cache-Control: no-store` (Task 5.4) [rewards-catalog.controller.ts]
- [x] [Review][Patch] PG e2e does not exercise production paths (raw SQL instead of `adjustStock`/`importCodes`), no TRUNCATE-trigger test, no previous-snapshot migration test (Task 6.3) [rewards-catalog.prisma.e2e-spec.ts]
- [x] [Review][Patch] No controller specs (Task 6.2 checked): guards, validation, both prefixes, 409 paths (`SHARED_CODE_VOUCHER`, `STOCK_EXCEEDS_CODES`, `SHARED_FLAG_LOCKED`)
- [x] [Review][Patch] `migration-chain.spec.ts` weakened to `startsWith`+name checks; `post-push-invariants.sql` lacks `voucher_brands` seed so db-push envs return BRAND_NOT_FOUND [migration-chain.spec.ts, post-push-invariants.sql]
- [x] [Review][Patch] Missing index `redemptions(voucher_id, created_at)` for admin detail query [migration.sql:208-212]
- [x] [Review][Patch] Dev Agent Record lacks user-catalog activation decision and Open points #1/#5 confirmations [story file]
- [x] [Review][Defer] User catalog loads all vouchers/flash sales then filters in memory — deferred, volume low for pilot [prisma-voucher.repository.ts, prisma-flash-sale-read.repository.ts]
- [x] [Review][Defer] Price history `changedBy.name` hardcoded 'Admin' — deferred to 12.11 integration [prisma-voucher.repository.ts]
- [x] [Review][Defer] Flash price > promo / `flashPoints >= basePoints` shown in catalog but filtered in flash list; `issued` can go negative when flashReserved > issued; large `createMany` param limit — deferred to 12.9 (flash writes owner)

## Dev Notes

### Scope boundaries (read first)

- **In:** schema + migrations for all eight Rewards aggregates (plus brand reference table); Admin catalog API (vouchers, price, stock, codes, brands); user read APIs (voucher list/detail, Flash list); audit Outbox events; shared audit/error contracts; tests.
- **Out (other stories — do not build):**
  - Quote and redeem endpoints, `RedeemVoucher` transaction, per-user limits, eligibility, Economy `SpendPoints` call: **12.8**. 12.7 creates the `RedemptionQuote` and `Redemption` tables but writes no rows.
  - Flash Sale write API (create/edit/end), start/end jobs, quota reservation, `(flashItemId, userId)` uniqueness: **12.9**. 12.7 creates `FlashSale`/`FlashSaleItem` and only **reads** them for effective price and `flashReserved`.
  - My vouchers, history, use/undo, code-issue reports, reminders: **12.10** (`CodeIssueReport` table only here).
  - Admin Flash list/monitor and `GET /admin/rewards/stats`: not assigned to 12.7. Epic 12.9 mentions "Admin Flash API"; **no story explicitly owns `/admin/rewards/stats`** while 12.11 says the statistics API backs the dashboard — flag to Quan (Open point #6), do not build here.
  - Feature flag, load test, FE de-mocking: **12.11**. FE stays on MSW; do not edit `apps/frontend`.
  - Partner-API code issuance, image upload (image is a URL string), second-Admin approval.
- **Gates:** FR-ADD-13 audit applies to every Admin write. Rewards must not write Ledger rows (AD-24); in 12.7 it does not touch Economy except the read port.

### Data model (target; names use the architecture ownership map)

Conventions: snake_case columns/tables, uuid PKs, `created_at/updated_at`, timestamps `timestamp(3)` default Prisma mapping. Enums: `VoucherCategory {COFFEE TEA CHICKEN_BURGER BAKERY_DESSERT}` (matches `VOUCHER_CATEGORIES`), `VoucherState {ACTIVE PAUSED ARCHIVED}`, `RedemptionStatus {SUCCEEDED FAILED REFUNDED}`, `CodeIssueStatus {OPEN REPLACED REFUNDED REJECTED}`, `CodeIssueReason {CODE_INVALID CODE_ALREADY_USED STORE_REFUSED OTHER}`, `VoucherPriceSource {BASE PROMO FLASH}`. Avoid Prisma model names beginning with `Reward` (existing survey-reward concepts); use `Voucher*`, `FlashSale*`, `Redemption*`, `CodeIssueReport`.

| Model | Key columns / constraints |
|---|---|
| `VoucherBrand` (`voucher_brands`) | `id text PK` (slug `^[a-z0-9-]{2,40}$`), `name`. Reference data, admin API lists only. |
| `Voucher` | `title`, `brandId` FK RESTRICT, `category`, `valueVnd int>0`, `basePoints int>0`, `promoPoints int?` (`< basePoints`), `priceVersion int ≥1` (current), `stockTotal int ≥0`, `stockRemaining int ≥0` (CHECK; regular unreserved stock, excludes Flash quota), `state`, `isVisible bool`, `isSharedCode bool`, `sharedCode text?`, `redeemStartsAt`, `redeemEndsAt`, `codeExpiresAt`, `description text?`, `whereToUse text?`, `terms text[]`, `howToUse text[]`, `imageUrl text?`, `createdById`. CHECKs: `redeem_ends_at > redeem_starts_at`, `code_expires_at >= redeem_ends_at + interval '7 days'` (BR-16 / `REWARDS_CODE_EXPIRY_MIN_DAYS`), `promo_points IS NULL OR promo_points < base_points`, `stock_remaining <= stock_total`. Index `(state, is_visible)`, `(brand_id)`, `(category)`. |
| `VoucherPriceVersion` | `voucherId` FK RESTRICT, `version`, `basePoints`, `promoPoints?`, `effectiveFrom`, `changedById`; `UNIQUE (voucher_id, version)`. **Append-only** trigger (reject UPDATE/DELETE/TRUNCATE) — copy the mechanism from `20260924120000_harden_double_entry_ledger`. Version 1 written on create in the same transaction. |
| `VoucherCode` | `voucherId` FK RESTRICT, `code`, `redemptionId uuid? UNIQUE` FK → `Redemption`, `createdAt`. `UNIQUE (voucher_id, code)`. Available = `redemptionId IS NULL`. Index `(voucher_id) WHERE redemption_id IS NULL` (partial; claim query in 12.8). Shared-code vouchers have **no** `VoucherCode` rows (code lives in `Voucher.sharedCode`). |
| `FlashSale` | `code` unique (`FS-YYYY-X`), `title`, `startsAt`, `endsAt`, `endedEarlyAt?`, `endReason?`, `rules jsonb`, `createdById`, `settledAt?`. CHECK `ends_at > starts_at`. 12.9 owns writes. |
| `FlashSaleItem` | `flashSaleId` FK, `voucherId` FK RESTRICT, `flashPoints>0`, `quota>0`, `sold ≥0`, `perUserCap ≥1`, `soldOutAt?`. `UNIQUE (flash_sale_id, voucher_id)`; CHECK `sold <= quota`. |
| `RedemptionQuote` | `userId`, `voucherId`, `flashSaleItemId?`, `priceVersion`, `pricePoints`, `priceSource`, `expiresAt`, `createdAt`. Index `(user_id, voucher_id)`, `(expires_at)`. |
| `Redemption` | `userId`, `voucherId` FK RESTRICT, `voucherCodeId?`, `flashSaleItemId?`, `quoteId?`, `idempotencyKey`, `status`, `pricePoints`, `priceSource`, `priceVersion`, `journalId?` (Economy-owned id, no FK across contexts), `failureCode?`, `reference text UNIQUE` (`RDM-YYYY-XXXX`), `createdAt`. `UNIQUE (user_id, idempotency_key)`. **Append-only** trigger (refunds are new rows, `RFD-` reference). Columns may be extended by 12.8 with additive migrations. |
| `CodeIssueReport` | `redemptionId` FK RESTRICT, `reason`, `note?`, `status`, `replacementCodeId?`, `refundJournalId?`, `resolvedById?`, `createdAt`, `resolvedAt?`. Partial unique: one `OPEN` per redemption. |

RESTRICT delete: `Voucher` ← `Redemption`, `VoucherCode`, `FlashSaleItem`, `VoucherPriceVersion`; no cascade anywhere in Rewards. Archived vouchers are the only "delete".

### Business rules → where they land

| Rule | Behaviour in this story |
|---|---|
| BR-04 / BR-14 | `stock_remaining >= 0` CHECK; stock changes are conditional single-statement updates |
| BR-06 | Stock adjustment allowed only within `issued + flashReserved ≤ newTotal`; for non-shared vouchers `newTotal` cannot exceed available code count and cannot grow without codes (`STOCK_INCREASE_NEEDS_CODES`, `STOCK_EXCEEDS_CODES`, `STOCK_BELOW_COMMITTED`) — port `stockAdjustmentDecision` |
| BR-12 | Price change bumps `Voucher.priceVersion`, inserts `VoucherPriceVersion`; past redemptions keep their own `pricePoints/priceVersion` |
| BR-13 | `priceDeviationPercent = round((basePoints / (valueVnd / POINT_VND_RATE) − 1) × 1000) / 10`; deviation > 20 % is returned as data; **warning + audit flag (`deviation: true` in the audit payload), never a block** (OQ-23 default; second-Admin approval not built) |
| BR-15 / BR-24 | Unique `(voucherId, code)`; voucher with redemptions can never be deleted |
| BR-16 | `codeExpiresAt ≥ redeemEndsAt + 7 d` (schema refine + DB CHECK) |
| FR-ADD-13 | One audit Outbox event per successful Admin mutation, same transaction |
| Effective price | Flash (active, `sold < quota`, `[start,end)`, not ended early) > promo > base; computed server-side at `Clock.now()` |
| Status | Port `voucherAvailability`, `effectiveStatus`, `adminVoucherStatus` verbatim; the user list never exposes HIDDEN/ARCHIVED vouchers, Admin does |

### Admin derived fields (must match `adminVoucherSchema`)

- `stock.flashReserved` = Σ `(quota − sold)` over Flash items of programs not ended (`now < endsAt` and not ended early). `stock.issued = total − remaining − flashReserved`. `stock.codesAvailable` = count of unassigned `VoucherCode` (shared-code voucher: `sharedCode ? 1 : 0`, status logic treats shared vouchers as having codes). The schema refine `remaining === total − issued − flashReserved` must hold for every row — assert it in a test.
- `status` is a server field (12.5 review lesson); `lowStock` = `remaining > 0 && remaining ≤ 10 % of total` as in the mock; `summary.activeFlashSales` counts programs active now.
- `priceHistory` newest-last as in the mock; `redemptions` (max 50, newest first) come from `Redemption` rows, `userLabel = '#' + last 4 chars of userId upper-cased`, kind from status. Empty until 12.8.

### API surface (route literals are the FE mock contract — keep exact)

User (SessionAuthGuard, activated-user rule: follow `MarketplaceController`, read-only so a missing activation returns the same data as the mock, record the decision):
- `GET /rewards/vouchers` (`voucherCatalogQuerySchema` → `voucherCatalogSchema`)
- `GET /rewards/vouchers/:id` (→ `voucherDetailResponseSchema`; 404 `VOUCHER_NOT_FOUND` for missing/hidden/archived)
- `GET /rewards/flash-sales` (→ `flashSaleListSchema`; active + upcoming + ended within the last 1 day, same window as mock `flashSalesAt`)

Admin (`@Roles('ADMIN')`, CSRF on writes):
- `GET /admin/rewards/vouchers` (`adminVoucherListQuerySchema` → `adminVoucherListSchema`)
- `POST /admin/rewards/vouchers` (`adminVoucherInputSchema` → `adminVoucherCreatedSchema`, 201)
- `GET /admin/rewards/vouchers/:id` (→ `adminVoucherDetailSchema`)
- `PUT /admin/rewards/vouchers/:id` (full input → `adminVoucherCreatedSchema`; ignores `basePoints`/`promoPoints` — price only via the price route, as mock; rejects `isSharedCode` flip after any code issued: 409 `SHARED_FLAG_LOCKED`)
- `PATCH /admin/rewards/vouchers/:id` (`adminVoucherStatePatchSchema`)
- `POST /admin/rewards/vouchers/:id/price` (`adminVoucherPriceChangeSchema`)
- `POST /admin/rewards/vouchers/:id/stock` (`adminStockAdjustmentSchema`)
- `POST /admin/rewards/vouchers/:id/codes` (`adminCodeImportRequestSchema` → `adminCodeImportResultSchema`)
- `GET /admin/rewards/brands` (→ `adminVoucherBrandListSchema`)

All responses use the standard envelope (`createSuccessEnvelope`). Admin writes: no `Idempotency-Key` (12.6 rule); retries are safe because state transitions are idempotent (PATCH same state → no new audit event).

### Error codes (HTTP via `http-exception.filter.ts`)

400 `VALIDATION_ERROR` (Zod; per-field `details` array `{path, code}` for `BRAND_NOT_FOUND`, `REDEMPTION_WINDOW_ENDED`) · 403 `REWARDS_ADMIN_CAPABILITY_REQUIRED` · 404 `VOUCHER_NOT_FOUND`, `BRAND_NOT_FOUND` (if a route-level lookup) · 409 `VOUCHER_ARCHIVED` (any write on archived), `SHARED_FLAG_LOCKED`, `SHARED_CODE_VOUCHER` (code import on shared voucher), `STOCK_BELOW_COMMITTED` (`details.minimum`), `STOCK_INCREASE_NEEDS_CODES`, `STOCK_EXCEEDS_CODES`. Names, statuses and `details` shapes come from `mocks/data/rewards-rules.ts` + `rewards-admin.ts` handlers: **read both and mirror them**, so Story 12.11 can flip FE routes off the mock with no UI change.

### Code import semantics (`importCodesDecision`)

- Codes trimmed; duplicates inside the file → `duplicatesInFile`; codes already stored → `alreadyStored`; **either list non-empty ⇒ `accepted = 0`, nothing committed** (all-or-nothing), `committed:false`.
- `mode: VALIDATE` never writes. `mode: COMMIT` with no conflicts inserts all codes, `stockTotal += n`, `stockRemaining += n` in one transaction, then audit event; `committed:true`.
- Dedup scope is **per voucher** (matches `UNIQUE (voucher_id, code)`, AC2). The mock dedups across every voucher's pool; backend deliberately narrower — a code string reused by another brand is legal. Record in Completion Notes.
- Race: two concurrent COMMITs with the same code → one gets `P2002`; translate to the normal `alreadyStored` report (re-run the decision after rollback), never a 500.
- Do not log, audit-dump or echo code values beyond the import response; audit payload carries counts only (codes are bearer secrets).

### Architecture rules that bind this story

- AD-16: Rewards writes only its tables; Economy/Identity reached through ports; no other module imports Rewards repositories. Consider adding an architecture-spec check like the Notifications one only if cheap; otherwise rely on directory convention.
- AD-24 lock order Voucher → FlashSaleItem → VoucherCode → ledger. 12.7 mutations lock only the Voucher row (`SELECT … FOR UPDATE`) — never lock a FlashSaleItem or ledger account here.
- `test/architecture.spec.ts`: `domain/` and `application/` must not match `@nestjs/`, `@prisma/client`, `express`, `bcrypt`, `google-auth-library`, **or the word "adapter" (case-insensitive)** — avoid it in comments and names.
- Two route prefixes per controller (`['x','api/x']`), exactly.
- Clock: inject `CLOCK` (`common/time/clock.ts`); never call `new Date()` in domain/application logic that decides status or price.
- Time zone: windows are `[start, end)` instants (UTC in DB). Vietnam (UTC+7, no DST) matters only for display/stat bucketing — nothing in 12.7 buckets by day.
- Money: Points are integers; no floats in prices (`discountPercent` is the only rounding, `Math.round`, identical to the shared helper — import `voucherDiscountPercent` from `@rescom/schemas` rather than re-implementing in the entity if the layering allows).

### Existing code to reuse (do not reinvent)

| Need | Use |
|---|---|
| Executable spec of rules and payloads | `apps/frontend/my-app/mocks/data/rewards-rules.ts`, `mocks/data/rewards.ts` (`adminRow`, `adminVouchersOf`, `adminVoucherDetailOf`, `catalogOf`, `voucherOf`, `flashSalesAt`), `mocks/handlers/rewards-admin.ts`, `mocks/handlers/rewards.ts` |
| Contracts | `packages/schemas/src/rewards/{voucher-catalog,rewards-admin,redemption}.schema.ts`; `POINT_VND_RATE` (`economy/top-up.schema.ts`); `MAX_PAGINATION_OFFSET` |
| Module skeleton to copy | `modules/moderation/*` (service with `UnitOfWorkPort`, `ADMIN_CAPABILITY_PORT`, Outbox audit event, Prisma + in-memory repos, controller guards, exceptions) |
| Admin controller pattern | `admin-moderation.controller.ts`, `admin-fraud-log.controller.ts` (`Cache-Control: no-store`) |
| Unit of Work | `common/database/unit-of-work.port.ts`, `prisma-unit-of-work.ts` (ambient tx, `afterCommit`) |
| Append-only trigger SQL | `20260924120000_harden_double_entry_ledger/migration.sql` |
| PG test harness | `test/fixtures/financial-pg-harness.ts`, `moderation.prisma.e2e-spec.ts`, `migration-chain.prisma.e2e-spec.ts` |
| Envelope / pipes | `common/http/{response.envelope,zod-validation.pipe,parse-uuid.pipe,json-only.guard}.ts` |

### Files (new unless marked UPDATE)

```
apps/backend/prisma/schema.prisma                                  UPDATE
apps/backend/prisma/migrations/<ts>_rewards_catalog_schema/migration.sql
apps/backend/prisma/sql/post-push-invariants.sql                   UPDATE (if new CHECK/trigger/partial index)
apps/backend/src/app.module.ts                                     UPDATE (register RewardsModule)
apps/backend/src/common/http/http-exception.filter.ts              UPDATE (+ its spec)
apps/backend/src/modules/rewards/rewards.module.ts
apps/backend/src/modules/rewards/domain/*.ts (+ .spec.ts)
apps/backend/src/modules/rewards/application/{rewards-admin-catalog.service,rewards-catalog.service}.ts (+ specs)
apps/backend/src/modules/rewards/application/ports/*.ts
apps/backend/src/modules/rewards/application/exceptions/rewards.exceptions.ts
apps/backend/src/modules/rewards/infrastructure/{prisma,in-memory}-*.repository.ts (+ shared contract spec)
apps/backend/src/modules/rewards/presentation/{rewards-catalog,admin-rewards-vouchers}.controller.ts (+ specs)
apps/backend/src/modules/economy/infrastructure/prisma-wallet-balance.reader.ts (+ in-memory twin; provide in EconomyModule, export token)
apps/backend/test/rewards-catalog.e2e-spec.ts, rewards-catalog.prisma.e2e-spec.ts
apps/backend/test/migration-chain*.ts                              UPDATE
packages/schemas/src/rewards/rewards-admin-audit.schema.ts (+ spec); rewards/index.ts UPDATE; rewards-admin.schema.ts UPDATE (+ spec)
```

### Gotchas checklist

1. **`getWallet` creates accounts** — it is a write on a GET. Use a dedicated read port for `viewer {available, pending}`; viewer without accounts is `{0,0}`.
2. **Prisma 6.0.0**: no partial/CHECK support in `schema.prisma`; declare them only in SQL and re-assert in `post-push-invariants.sql`, or `prisma db push` environments miss them.
3. **Reconcile-equality test**: do not edit the reconcile migration casually; add a new migration and append identical text to the invariants file — then check what `migration-chain.spec.ts` asserts about later migrations.
4. `description`/`whereToUse` are required (`min(1)`) in `voucherDetailSchema` but not in `adminVoucherInputSchema`. When the columns are null, derive: `description = title`, `whereToUse = 'Áp dụng tại hệ thống cửa hàng ' + brand.name` (documented fallback; Open point #4). Never return an empty string — the FE parse would fail.
5. `terms`/`howToUse`: on PUT the mock keeps the previous list when the input list is empty; mirror that (empty array ⇒ unchanged) or the FE edit form silently wipes content.
6. User list `affordable` is per viewer (`viewer.available ≥ price.points`); `affordable` filter and `sort=BEST_DEAL` (largest `discountPercent`, then newest) must be deterministic (`id` tiebreaker) so pagination is stable. Read the mock `catalogOf` for the exact sort keys.
7. A Flash-sold-out voucher with remaining regular stock must show `status: AVAILABLE` at regular price (`effectiveStatus`), and a sold-out regular stock with active Flash and `codesAvailable > 0` stays AVAILABLE — port exactly.
8. `flash` summary on a list item is non-null only while that Flash item is active; `sold ≤ quota` is a schema refine.
9. Archived vouchers: all writes → 409 `VOUCHER_ARCHIVED`; reads still work for Admin; user catalog hides them.
10. `PUT` must not allow shortening `redeemEndsAt` into the past (`REDEMPTION_WINDOW_ENDED`) unless unchanged; `brandId` must exist (`BRAND_NOT_FOUND`).
11. Audit events are atomic with the mutation: if the Outbox insert fails, the mutation rolls back. A rejected command emits nothing.
12. Backend is deployed to production from `main` (Vercel is FE only; VPS compose service `backend`). The new routes ship un-flagged until 12.11; Admin routes are Admin-only and user routes return an empty catalog, so this is acceptable, but do **not** seed demo vouchers in a migration.
13. `rtk`/hooks rewrite shell commands; use quoted globs (`--include='*.ts'`) in zsh.
14. Prisma enums vs Zod: keep one source of truth for `VOUCHER_CATEGORIES` — add a test that Prisma enum values equal the Zod list.

### Testing standards

- Backend: jest (`npm test` builds `@rescom/schemas` first); co-located `*.spec.ts`; e2e in `apps/backend/test/*.e2e-spec.ts` (in-memory) and `*.prisma.e2e-spec.ts` (real PostgreSQL via the harness; read how it is skipped/enabled locally before running).
- Prove concurrency with real PostgreSQL, not mocks (AD-24 is about row locks): two parallel stock adjustments, two parallel identical imports.
- Contract tests parse real HTTP responses with the shared Zod schemas.
- No `test.skip`/`.only`, no placeholder tests.

### Project Structure Notes

- Module path `apps/backend/src/modules/rewards/{domain,application,infrastructure,presentation}` — matches `moderation`/`economy` layout.
- Repo has stale directory `packages/schemas/src/rewards/` only for contracts; keep file naming `*.schema.ts` + `*.schema.spec.ts`.
- The cross-module read adapter lives in Economy because Economy owns the ledger tables (AD-16).

### Previous story intelligence (12.1–12.6, all FE + MSW; 12.6 merged in PR #23)

- Everything Rewards so far is mock: the mock rules files are the executable spec, and every contract is tagged `ASSUMED API CONTRACT: backend Stories 12.7–12.10 must match or update these schemas.` Prefer matching; if a change is unavoidable, make it **additive**, update the schema + mock + FE caller in the same PR only if trivial, otherwise record it for 12.11.
- 12.5 review lessons relevant to the API: status is a server field; join by id; distinguish 404 from network errors; 409 conflict bodies must carry `details` the UI can show (`minimum`, `conflicts`).
- 12.5 deviations that the backend must resolve: BR-13 warning only (no second Admin), image is a URL, **no shared-code value field** (Open point #3).
- Mock deviations to remember: mock reserves Flash quota at create and settles lazily; production reserves at start (12.9). 12.7 only reads, so `flashReserved` in 12.7 reflects `FlashSaleItem` rows whatever 12.9 decides to do about timing — compute from rows, not from a timing assumption.

### Git intelligence

- `117a03a` Merge PR #23 (12.6), `8b621d1` 12.6 implementation, `3b19942` PR #22 (12.5). Recent work touched only `apps/frontend/my-app` and `packages/schemas/src/rewards`. Backend last changed by IR/11.x stories: scheduler, outbox, product tours, `20261009110000_form_is_official` (latest migration), official surveys. Expect `schema.prisma` and `app.module.ts` to be hot files: rebase on `origin/develop` before editing.

### Latest tech information

- No new runtime dependency. Prisma 6.0.0 (`@prisma/client` pinned), NestJS 10, Zod 3.24, Jest 29. Use `Prisma.TransactionClient` via the ambient UoW; raw SQL through `$queryRaw`/`$executeRaw` tagged templates (parameterised) for the conditional stock update and `FOR UPDATE`.

### Open points for the dev agent to confirm with Quan (do not block; solo owner)

1. **OQ-25 gate:** no recorded answer exists in the PRD. Planning defaults adopted: CSV import without partner API; code expiry ≥ 7 days after the redemption window; no refund for expired unused vouchers; faulty-code resolution 1 business day; self-marked "used" with 24 h undo. Quan to record the confirmation (owner = Quan) before merging.
2. **OQ-23 (BR-13):** warning + audit, no second Admin (default). Backend returns `priceDeviationPercent`; threshold 20 %.
3. **Shared-code vouchers:** contract has `isSharedCode` but no field for the shared code (12.5 deviation). Plan: additive optional `sharedCode` (regex `^[A-Za-z0-9-]{4,64}$`, nullable) on `adminVoucherInputSchema`, stored on `Voucher`, never returned in Admin list/detail (only in a ticket after redemption, 12.10). A shared voucher without `sharedCode` shows SOLD_OUT-equivalent availability. Alternative: single `VoucherCode` row per shared voucher — rejected because `UNIQUE redemptionId` forbids sharing.
4. **Description/where-to-use** columns are not in the Admin input: fallbacks above; add to the input later if Quan wants editable copy.
5. **Dedup scope** per voucher vs mock cross-voucher.
6. **Missing owner for `GET /admin/rewards/stats` and Admin Flash read/monitor endpoints** (mock routes `GET /admin/rewards/flash-sales[/:id]`, `/stats`). Suggest adding them explicitly to 12.9 (Flash) and 12.11 (stats) acceptance criteria.
7. Rewards backend routes have no feature flag until 12.11.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 intro, Stories 12.1, 12.5, 12.7, 12.8, 12.9, 12.11]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-13.md` FR-68–FR-75, BR-01–BR-24, Open Questions 23–26]
- [Source: `_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md` §5 non-goal amendment, Open Questions 23–26 (lines ~107–110 of proposal, ~1153 of PRD)]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` AD-16, AD-24, Module and Durable-State Ownership Map (Rewards row)]
- [Source: `_bmad-output/implementation-artifacts/12-1-rewards-contracts-msw-mock-domain.md`, `12-5-admin-voucher-catalog-codes.md`, `12-6-admin-flash-sale-rewards-stats.md`]
- [Source: `packages/schemas/src/rewards/{voucher-catalog,rewards-admin,redemption}.schema.ts`]
- [Source: `apps/frontend/my-app/mocks/data/{rewards,rewards-rules}.ts`, `mocks/handlers/{rewards,rewards-admin}.ts`, `lib/admin/rewards-vouchers-service.ts`]
- [Source: `apps/backend/src/modules/moderation/**`, `apps/backend/src/common/database/{unit-of-work.port,prisma-unit-of-work}.ts`, `apps/backend/test/{architecture.spec,migration-chain.spec}.ts`, `apps/backend/prisma/migrations/20260924120000_harden_double_entry_ledger`]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (Thinking) & Gemini 3.8 Flash (BMAD Dev Subagent Team)

### Debug Log References

- Task 1: Migration 20261013120000_rewards_catalog_schema created, checked against duplicate indexes, validated via prisma:validate and migration-chain.spec.ts.
- Task 2: Shared audit and admin contract additions verified with 7 unit tests in @rescom/schemas.
- Task 3: Pure domain rules ported and verified against frontend mock specs; services wired with UnitOfWorkPort, lock, clock, and atomic outbox audit.
- Task 4: Prisma & in-memory twin repositories created. Read-only wallet reader provided in EconomyModule.
- Task 5: Presentation controllers created with dual-prefix routing, SessionAuthGuard, RolesGuard, and CsrfGuard. Exceptions mapped in HttpExceptionFilter.
- Task 6: Postgres e2e passed with 5 test scenarios + in-memory HTTP e2e with 3 scenarios.
- Task 7: Frontend route-diff / contract-callsites reconciled for Phase 2 deferred routes (all 886 FE tests pass).

### Completion Notes List

- Database models and migrations added for Voucher, VoucherPriceVersion, VoucherCode, FlashSale, FlashSaleItem, RedemptionQuote, Redemption, CodeIssueReport, VoucherBrand with append-only triggers and CHECK constraints.
- Admin catalog API implemented (list, detail, create, put, patch, price, stock, codes, brands) with outbox audit events and capability checks.
- User catalog API implemented (list with pagination/filter/affordable, detail, flash-sales) using server time and wallet balance reader.
- Concurrency uses row-level locks (`FOR UPDATE`) and conditional UPDATE; PostgreSQL e2e tests written against the production repositories/service but NOT executed locally (no Postgres on :5433) — run `npm run test:e2e -- rewards-catalog.prisma migration-chain.prisma` before merge.
- Code review fixes (2026-10-14): audit idempotencyKey is now `admin-audit:rewards:{voucherId}:{correlationId}:{eventId}` (unique per mutation; non-UUID `x-correlation-id` replaced by a generated UUID); `BRAND_NOT_FOUND`/`REDEMPTION_WINDOW_ENDED`/`SHARED_CODE_REQUIRED` return 400 `VALIDATION_ERROR` with `details:[{path,code}]`; `removeAvailable` returns removed rows; shared flag locked when `stockTotal > 0` or any code issued; index `redemptions(voucher_id, created_at DESC)` added; `voucher_brands` seed added to post-push invariants.
- User catalog activation: `SessionAuthGuard` only (any authenticated role), `Cache-Control: no-store` on all three GETs; no feature flag until 12.11 (Open point #7).
- Open points #1 (OQ-25 planning defaults) and #5 (per-voucher dedup scope) adopted as planned; Quan (solo owner) to record confirmation before merge.
- Code dedup scope enforced per voucher; code import race returns report cleanly on P2002 after rollback.

### File List

- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20261013120000_rewards_catalog_schema/migration.sql`
- `apps/backend/prisma/sql/post-push-invariants.sql`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/common/http/http-exception.filter.rewards.spec.ts`
- `apps/backend/src/modules/economy/economy.module.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-wallet-balance.reader.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-wallet-balance.reader.ts`
- `apps/backend/src/modules/economy/infrastructure/wallet-balance.reader.spec.ts`
- `apps/backend/src/modules/rewards/rewards.module.ts`
- `apps/backend/src/modules/rewards/domain/voucher.entity.ts`
- `apps/backend/src/modules/rewards/domain/voucher-price.ts`
- `apps/backend/src/modules/rewards/domain/voucher-availability.ts`
- `apps/backend/src/modules/rewards/domain/stock.ts`
- `apps/backend/src/modules/rewards/domain/rewards-domain.spec.ts`
- `apps/backend/src/modules/rewards/application/ports/voucher-repository.port.ts`
- `apps/backend/src/modules/rewards/application/ports/voucher-code-repository.port.ts`
- `apps/backend/src/modules/rewards/application/ports/flash-sale-read.port.ts`
- `apps/backend/src/modules/rewards/application/ports/wallet-balance.port.ts`
- `apps/backend/src/modules/rewards/application/ports/rewards.constants.ts`
- `apps/backend/src/modules/rewards/application/exceptions/rewards.exceptions.ts`
- `apps/backend/src/modules/rewards/application/rewards-admin-catalog.service.ts`
- `apps/backend/src/modules/rewards/application/rewards-catalog.service.ts`
- `apps/backend/src/modules/rewards/application/rewards-services.spec.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-voucher.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/in-memory-voucher.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-voucher-code.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/in-memory-voucher-code.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-flash-sale-read.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/in-memory-flash-sale-read.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/rewards.repositories.spec.ts`
- `apps/backend/src/modules/rewards/presentation/rewards-catalog.controller.ts`
- `apps/backend/src/modules/rewards/presentation/admin-rewards-vouchers.controller.ts`
- `apps/backend/test/rewards-catalog.e2e-spec.ts`
- `apps/backend/test/rewards-catalog.prisma.e2e-spec.ts`
- `apps/backend/test/migration-chain.spec.ts`
- `packages/schemas/src/rewards/rewards-admin-audit.schema.ts`
- `packages/schemas/src/rewards/rewards-admin-audit.schema.spec.ts`
- `packages/schemas/src/rewards/rewards-admin.schema.ts`
- `packages/schemas/src/rewards/rewards-admin-contract-additions.spec.ts`
- `packages/schemas/src/rewards/index.ts`
- `apps/frontend/my-app/tests/route-diff.test.mjs`
- `apps/frontend/my-app/tests/contract-callsites.test.mjs`
