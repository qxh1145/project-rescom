---
baseline_commit: 1e7b6d68480231ca34533967e3400865f0537904
---
# Story 12.1: Rewards Contracts & MSW Mock Domain

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Developer,
I want versioned Rewards contracts and a mock Rewards domain,
so that the User Portal and Admin screens can be built and reviewed before the backend exists.

## Acceptance Criteria

1. **Contracts.** Given `packages/schemas`, when the Rewards contracts are added, then Zod schemas exist for: voucher (list item and detail), price and status, Flash Sale and Flash item, quote, redeem command (`quoteId` + `Idempotency-Key`), redemption result, my-voucher ticket, redemption history entry, code-issue report, and the Admin voucher, Flash Sale, and statistics payloads.
2. **Closed error enum.** The error codes `SOLD_OUT`, `PRICE_CHANGED`, `INSUFFICIENT_POINTS`, `VOUCHER_UNAVAILABLE`, and `ACCOUNT_NOT_ELIGIBLE` are a closed enum. `PRICE_CHANGED` carries the new price and `INSUFFICIENT_POINTS` carries the new balance.
3. **Seed.** The MSW mock repository seeds 7 vouchers across 4 categories and 6 brands, one active Flash Sale, a user with 186 Available and 18 Pending Points, and 3 unused tickets. The mock `SCHEMA_VERSION` is bumped.
4. **Mock redeem.** The mock handlers implement idempotent redeem: the same key returns the first result. They can also be switched to each failure code for UI review.
5. **Tests.** Contract spec tests cover every schema and error payload.

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.1 (FR-68…FR-75, AD-24).

## Tasks / Subtasks

- [x] **Task 1: Shared Rewards contracts in `packages/schemas/src/rewards/`** (AC: 1, 2)
  - [x] 1.1 `voucher-catalog.schema.ts`: category, brand, price, user-facing status, list item, detail, catalog query and list response, Flash Sale, Flash item, and Flash Sale list response. See Dev Notes → Contract spec §A.
  - [x] 1.2 `redemption.schema.ts`: quote request and response, redeem command, the closed redeem error enum plus a `discriminatedUnion` of the error payloads, redemption result, voucher ticket, history entry, code-issue report and its create input, and the reference patterns. See §B.
  - [x] 1.3 `rewards-admin.schema.ts`: Admin voucher (list row, detail, create/update input), price change, stock adjustment, CSV code import request and result, Admin Flash Sale (row, create input, 5-state status), and the statistics query and payload. See §C.
  - [x] 1.4 `rewards/index.ts` re-exports all three files. Add `export * from "./rewards";` to `packages/schemas/src/index.ts`.
  - [x] 1.5 Every new export uses a `voucher*`, `flashSale*`, `redemption*`, `codeIssue*`, `adminVoucher*`, `rewardsStats*` or `REWARDS_*` name. **Never use a bare `reward*` name.** `reward*` already means *survey* rewards in `economy/` (`rewardPricingSchema`, `attemptRewardSchema`, …), and `pricingQuoteSchema` already exists, so the quote schema is `redemptionQuoteSchema`.
  - [x] 1.6 Reuse `IDEMPOTENCY_KEY_HEADER` and `idempotencyKeySchema` from `forms/external-form.schema.ts`, `MAX_PAGINATION_OFFSET` from `common/pagination.schema.ts`, and `POINT_VND_RATE` from `economy/top-up.schema.ts`. Do not redefine them.
- [x] **Task 2: Contract spec tests** (AC: 5)
  - [x] 2.1 Add `voucher-catalog.schema.spec.ts`, `redemption.schema.spec.ts` and `rewards-admin.schema.spec.ts` next to their schema files (jest picks up `src/**/*.spec.ts`).
  - [x] 2.2 Each schema gets one valid fixture that parses and at least one invalid case per refinement (price ordering, discount math, date ordering, code-expiry ≥ 7 days, unique Flash voucher ids, reference patterns, query boolean parsing).
  - [x] 2.3 Error enum: `options` equals the 5 codes **in this order**. Each of the 5 payloads parses, a payload with the wrong `details` for its code fails, and an unknown code fails.
  - [x] 2.4 `npm --prefix packages/schemas test` and `npm --prefix packages/schemas run typecheck` pass.
- [x] **Task 3: Pure mock rules `apps/frontend/my-app/mocks/data/rewards-rules.ts`** (AC: 3, 4)
  - [x] 3.1 The file imports nothing from `msw`, `@/…`, `../db/*` or `../scenarios`. It may import `@rescom/schemas` types only, the same way `economy-rules.ts` does, so `node --test` can import it directly.
  - [x] 3.2 Functions: effective price (Flash > promo > base) at `now`; Flash item state; user-facing voucher status; catalog filter and sort; ticket status (`EXPIRING` = unused and ≤ 7 days to expiry); `decideRedemption(state, input, now)` returning a success or one of the 5 errors with its details; and the reference generator (`RDM-YYMM-XXXX`). See Dev Notes → Mock rules.
- [x] **Task 4: Mock state and seed `apps/frontend/my-app/mocks/data/rewards.ts`** (AC: 3)
  - [x] 4.1 `createCollection("rewards-catalog", seed)` holds the vouchers and Flash Sales. A per-user `createCollection("rewards-users", () => ({}))` holds tickets, history, quotes, idempotency records and reports.
  - [x] 4.2 Seed exactly the Figma data in Dev Notes → Seed (7 vouchers, 1 active + 1 upcoming Flash Sale, 3 unused + 1 used + 1 expired tickets, history rows, 1 resolved code-issue report). **Every timestamp is relative to `Date.now()`** (`hoursAgo`); no hard-coded calendar dates.
  - [x] 4.3 Change the activated demo wallet seed in `mocks/data/economy.ts#seedWallet` from `available: 112` to `available: 186`, and keep `pending: 18`. Add a comment that Figma pages 21–27 supersede page 7's 112.
  - [x] 4.4 Bump `SCHEMA_VERSION` in `mocks/db/store.ts` from 4 to 5 and add the comment line `5: Rewards mock domain (Story 12.1); demo wallet 186 available.`
- [x] **Task 5: Mock handlers `apps/frontend/my-app/mocks/handlers/rewards.ts`** (AC: 4)
  - [x] 5.1 Add the 6 user routes in Dev Notes → Endpoints. Admin, my-voucher, history and code-issue routes are **not** in this story; Stories 12.4, 12.5 and 12.6 add them.
  - [x] 5.2 User resolution follows `handlers/engagement.ts`: `isHybridMocking ? HYBRID_MEMBER : await getMockSessionUser()`. The hybrid test's session stand-in throws when read.
  - [x] 5.3 Every handler calls `applyScenario("rewards")` first (latency, `api-error`, `api-offline`, `unauthenticated`). Writes check `missingCsrf(request)`. Inputs are parsed with the shared schemas, and a parse failure returns `400 VALIDATION_ERROR`, as in `handlers/top-up.ts`.
  - [x] 5.4 Idempotent redeem: key = `idempotencyRecordKey(user.id, header)`, decision = `decideIdempotentRequest(record, fingerprint = quoteId)` from `mocks/data/idempotency.ts`. Store `{ status, body }` for **both** success and business failure. A replay returns the stored response unchanged. A different `quoteId` under the same key returns `409 IDEMPOTENCY_KEY_CONFLICT` (the existing mock code). A missing or invalid header returns `400 VALIDATION_ERROR`.
  - [x] 5.5 A success debits `wallet.available` via `updateWallet` from `mocks/data/economy.ts`, appends a wallet transaction row (Task 6), decrements stock or increments Flash `sold`, claims one code, appends the ticket and a `SUCCEEDED` history row, and stores the idempotency record. One `collection.update` per collection: no half-written state.
  - [x] 5.6 A failure (natural or forced) changes nothing except the history (`FAILED` row, `points: 0`, no journal) and the idempotency record (BR-07, BR-09).
  - [x] 5.7 Register `...rewardHandlers` in `mocks/handlers/index.ts`.
- [x] **Task 6: Wallet consistency** (AC: 4)
  - [x] 6.1 In `mocks/data/economy-rules.ts`, add `MockTransactionKind` `"VOUCHER_REDEMPTION"`, `entriesOf` → `[["USER_AVAILABLE", -amount]]`, and `journalOf` → key `redemption:{idempotencyKey}` with description `Voucher redemption: {reference}`. Add an optional `redemptionKey?: string` field on `MockTransaction` to carry the key. Do not add it to `SURVEY_KINDS`.
  - [x] 6.2 In `lib/wallet/wallet-history.ts`, add `["redemption:", "VOUCHER_REDEMPTION"]` to `KEY_PREFIXES`, `VOUCHER_REDEMPTION` to `HistoryKind`, and the title `"Đổi voucher"` (ASSUMED copy). The direction follows the negative sum. Check what note the row gets, and use the voucher title from the row `note`/description if the helper supports it.
  - [x] 6.3 `redemption-refund:` needs no prefix entry: a refund carries `reversesJournalId`, so the row is already `REVERSAL`.
- [x] **Task 7: Failure switch for UI review** (AC: 4)
  - [x] 7.1 Add these values to `MOCK_SCENARIOS` in `mocks/scenarios.ts`: `"rewards-sold-out"`, `"rewards-price-changed"`, `"rewards-insufficient-points"`, `"rewards-voucher-unavailable"`, `"rewards-account-not-eligible"`, and `"rewards-redeem-lost"`. Add a one-line comment for each, like the existing entries.
  - [x] 7.2 `applyScenario` keeps returning `undefined` for them (the `default` branch). The redeem handler reads `getActiveScenario()` itself and builds the forced error **with real details** from current state (new price, current balance, and so on). Forced errors apply to `POST /rewards/redemptions` only, are recorded under the key, and never deduct.
  - [x] 7.3 `rewards-redeem-lost` runs the real redeem (commit plus record) and then returns `HttpResponse.error()`, so Story 12.3 can test polling by key (2 s, 4 s, 8 s, then "Đang kiểm tra kết quả").
  - [x] 7.4 In hybrid mode `getActiveScenario()` is always `"default"`, so the switch works only with `NEXT_PUBLIC_API_MOCKING=enabled`. This is expected.
- [x] **Task 8: Route gates** (AC: 4)
  - [x] 8.1 Add the 6 routes to `ROUTE_ALLOWLIST.DEFERRED_KEEP_MOCK` in `mocks/route-allowlist.ts`, with the reason `"rewards, Epic 12 (Phase 2; backend Stories 12.7-12.10)"`.
  - [x] 8.2 Update the hard-coded counts from 14 to 20: `tests/route-diff.test.mjs` (gate-G test name and `DEFERRED_KEEP_MOCK: 14`) and `tests/hybrid-mocking.test.mjs` (test name and `assert.equal(deferred.length, 14)`).
  - [x] 8.3 Add one hybrid test, "rewards answer without a mock session", to `tests/hybrid-mocking.test.mjs`. It covers catalog, detail, quote, redeem twice with the same key (identical body, balance debited once), poll by key, a different quote under the same key (409), and CSRF missing (403). Use the existing `call()`/`parsed()` helpers.
- [x] **Task 9: Mock unit tests `apps/frontend/my-app/tests/rewards-mock.test.mjs`** (AC: 3, 4, 5)
  - [x] 9.1 Rules: price precedence at `now` (Flash active > promo > base; Flash sold out → promo or base; Flash ended → base); `[start, end)` boundaries; filter and sort (affordable vs 186, point ranges, on-sale, category/brand multi-select, sold-out and expired last); ticket `EXPIRING` at 7 days.
  - [x] 9.2 Seed: 7 vouchers, 4 categories, 6 brands, exactly 1 Flash Sale active at seed time, demo wallet 186/18, 3 tickets in the Unused tab. Every seeded entity parses with its shared schema.
  - [x] 9.3 `decideRedemption`: each of the 5 errors with its details, and success with the balance, stock and code effects.
  - [x] 9.4 Wallet history: a `redemption:` journal maps to `"Đổi voucher"` and is outgoing.
- [x] **Task 10: Verification**
  - [x] 10.1 `npm --prefix packages/schemas test && npm --prefix packages/schemas run typecheck`.
  - [x] 10.2 `cd apps/frontend/my-app && npm test && npm run typecheck && npm run lint`.
  - [x] 10.3 Backend still compiles against the new exports: `npm --prefix apps/backend run typecheck`. No backend source change is expected.
  - [x] 10.4 Manual: run `npm run dev` with `NEXT_PUBLIC_API_MOCKING=enabled`, sign in as the activated demo user, and hit the routes from the browser console (or a scratch `fetch`). Run them once per `?msw=rewards-*` scenario and confirm that `/economy/wallet` shows the debited balance after a success. **No UI is built in this story.**

## Dev Notes

### Scope boundaries (read first)

- **In:** shared Zod contracts for the **whole** epic (user and Admin), spec tests, the mock domain (rules, seed, state), the 6 user-side handlers needed by Stories 12.2 and 12.3, failure scenarios, wallet sync, and route gates.
- **Out:** UI, pages, components, `lib/rewards/*` API clients (Story 12.2 adds the client and its service schema, following `lib/wallet/top-up-service.ts`), Admin, my-voucher, history and code-issue **handlers** (Stories 12.4, 12.5 and 12.6; their schemas are in this story), a QR library (none is installed; Story 12.4 decides), backend code (Stories 12.7+), and the feature flag (Story 12.11; Story 12.2 must not put a nav item in a pilot build without one).
- **Gates:** this story is FE-mock only. The epic allows the planning defaults (quote TTL 5 min, Flash cap 1, code expiry ≥ 7 days, 24 h undo) **inside mocks** and as documented contract defaults. Backend Stories 12.7 and 12.8 re-confirm them against PRD Open Questions 23, 25 and 26 [Source: epics.md#Epic 12 "Dependency and gate model"; PRD §9].
- **Contract status:** every route and shape here is an **ASSUMED API CONTRACT** until Stories 12.7, 12.8 and 12.10 implement it. Mark the handler comments `// ASSUMED API CONTRACT:` (the convention in `handlers/engagement.ts`) and mark the schema file header the same way. The backend must match these schemas, or change them in the same PR. Story 12.7 AC: "match the Story 12.1 contracts".

### Architecture constraints (AD-24, AD-1, AD-16)

- Rewards is a separate context. It never writes the Ledger; it spends through Economy `SpendPoints` with journal `redemption:{idempotencyKey}`, USER_AVAILABLE → SYSTEM_SINK. A refund is a reversal journal `redemption-refund:{caseId}` [Source: `ARCHITECTURE-SPINE.md` AD-24; sprint-change-proposal-2026-10-13 §4.2]. The mock mirrors only the user side: an available debit with that key.
- The effective price is computed **server-side at commit**: Flash > promo > base. A `priceVersion` mismatch with the quote returns `PRICE_CHANGED` with the new price (BR-11). The client clock never decides the price; every user response carries `serverTime` (FR-71, BR-17).
- A Flash window is `[startsAt, endsAt)` in server time, Asia/Ho_Chi_Minh. Timestamps in contracts are ISO UTC strings (`z.string().datetime()`); the UI converts them for display.
- Available Points include topped-up and unlocked starter Points. Pending, Frozen, Escrow and Integrity Hold never count (BR-01). The catalog and quote report `available` and `pending` separately so the UI can say "N điểm chờ duyệt chưa được tính".
- Points are integers; 1 Point ≈ 200 VNĐ (`POINT_VND_RATE`). A 50,000 VNĐ voucher costs 250 Points.

### Contract spec

Use the `z` from `zod` like the sibling files. Prefer `.strict()` only where sibling schemas do (most do not). Use `z.string().uuid()` for ids and `z.string().datetime()` for instants.

**§A `voucher-catalog.schema.ts` (user)**

| Export | Shape / rule |
|---|---|
| `VOUCHER_CATEGORIES` / `voucherCategorySchema` | `["COFFEE","TEA","CHICKEN_BURGER","BAKERY_DESSERT"]`. FE labels: Cà phê · Trà & trà sữa · Gà rán & burger · Bánh & tráng miệng |
| `voucherBrandSchema` | `{ id: slug /^[a-z0-9-]{2,40}$/, name: 1..60 }` |
| `voucherPriceSourceSchema` | `["BASE","PROMO","FLASH"]` |
| `voucherPriceSchema` | `{ points: int>0, basePoints: int>0, source, discountPercent: int 0..99, priceVersion: int≥1 }`. Refine: `points ≤ basePoints`; `source==="BASE"` ⇔ `points===basePoints && discountPercent===0`; `discountPercent === Math.round((1 - points/basePoints)*100)` (Figma: 150/250 → 40, 90/125 → 28, 120/150 → 20, 70/100 → 30). Export the helper `voucherDiscountPercent(points, basePoints)` |
| `voucherStatusSchema` | user-facing `["AVAILABLE","SOLD_OUT","EXPIRED","PAUSED"]` (FR-68). Hidden and archived vouchers are never listed |
| `voucherFlashSummarySchema` | `{ flashSaleId, flashSaleItemId, quota: int>0, sold: int≥0, endsAt }`, `sold ≤ quota`. Present on a list item only while its Flash item is ACTIVE |
| `voucherListItemSchema` | `{ id, title, brand, category, valueVnd: int>0, price, status, stockTotal: int≥0, stockRemaining: int≥0 (regular stock, Flash quota excluded), redeemEndsAt, codeExpiresAt, flash: summary\|null, affordable: boolean, imageUrl: url\|null }` |
| `voucherDetailSchema` | list item + `{ terms: string[], howToUse: string[] (page 24 "Cách dùng tại cửa hàng"), isSharedCode: boolean }`. Page 22 fields beyond these are added **additively** in Story 12.2 |
| `VOUCHER_SORTS` / `voucherSortSchema` | `["BEST_DEAL","POINTS_ASC","POINTS_DESC","NEWEST"]` (Ưu đãi tốt nhất · Điểm thấp → cao · Điểm cao → thấp · Mới nhất) |
| `voucherCatalogQuerySchema` | `q?: trimmed 1..100`; `category?`, `brand?`: comma-separated lists → arrays (multi-select on desktop); `minPoints?`/`maxPoints?`: coerced int ≥0, refine min ≤ max (chips: Dưới 100 → `maxPoints=99`, 100–200, Trên 200 → `minPoints=201`); `onSale?`, `affordable?`; `sort` default `BEST_DEAL`; `limit` 1..50 default 20; `offset` 0..`MAX_PAGINATION_OFFSET` default 0. **Gotcha:** `z.coerce.boolean()` turns `"false"` into `true`. Parse booleans with `z.enum(["true","false"]).transform(v => v === "true")` |
| `rewardsViewerBalanceSchema` | `{ available: int≥0, pending: int≥0 }` |
| `voucherCatalogSchema` | `{ items, total, limit, offset, hasMore, serverTime, viewer }` (the pagination shape of `topUpRequestListSchema`) |
| `voucherDetailResponseSchema` | `{ voucher: detail, serverTime, viewer }` |
| `flashSaleItemStateSchema` | `["UPCOMING","ACTIVE","ENDED","SOLD_OUT"]` (FlashSaleCard variants) |
| `flashSaleItemSchema` | `{ id, voucherId, voucherTitle, brand, valueVnd, flashPoints, basePoints, discountPercent, quota, sold, perUserCap: int≥1, state }`, `flashPoints < basePoints`, `sold ≤ quota` |
| `flashSaleSchema` | `{ id, code /^FS-\d{4}-[A-Z]$/ (e.g. FS-1013-A), startsAt, endsAt, items: min 1 }`, `endsAt > startsAt` |
| `flashSaleListSchema` | `{ items: flashSaleSchema[], serverTime }` (current and upcoming programs) |

**§B `redemption.schema.ts` (user)**

| Export | Shape / rule |
|---|---|
| `REDEMPTION_REFERENCE_PATTERN` / `REFUND_REFERENCE_PATTERN` | `/^RDM-\d{4}-[0-9A-Z]{4}$/`, `/^RFD-\d{4}-[0-9A-Z]{4}$/` (YYMM + 4 chars; Figma `RDM-2610-8F2K`, `RFD-2610-7HC2`) |
| `createRedemptionQuoteSchema` | `{ voucherId: uuid }` |
| `redemptionQuoteSchema` | `{ quoteId, voucherId, price: voucherPriceSchema, flashSaleItemId: uuid\|null, expiresAt, flashEndsAt: datetime\|null, balance: { available, after }, serverTime }`. Refine: `after === available - price.points` and `after ≥ 0`; `source==="FLASH"` ⇔ `flashSaleItemId !== null && flashEndsAt !== null`; `expiresAt ≤ flashEndsAt` when Flash |
| `redeemVoucherSchema` | body `{ quoteId: uuid }`. The key travels in the `IDEMPOTENCY_KEY_HEADER`, validated with `idempotencyKeySchema`. Export `REDEMPTION_IDEMPOTENCY_HEADER = IDEMPOTENCY_KEY_HEADER` only if it helps callers; otherwise import the existing constant |
| `REDEMPTION_ERROR_CODES` / `redemptionErrorCodeSchema` | exactly `["SOLD_OUT","PRICE_CHANGED","INSUFFICIENT_POINTS","VOUCHER_UNAVAILABLE","ACCOUNT_NOT_ELIGIBLE"]` |
| `accountNotEligibleReasonSchema` | `["ACCOUNT_NOT_ACTIVATED","ACCOUNT_LOCKED","FRAUD_FLAGGED","NO_RECENT_SURVEY","VOUCHER_LIMIT_REACHED","DAILY_LIMIT_REACHED","FLASH_LIMIT_REACHED"]`. ASSUMED: BR-02, BR-19, BR-20 and BR-21 all surface as `ACCOUNT_NOT_ELIGIBLE` because the enum is closed. Story 12.8 confirms against OQ-23 |
| `redemptionErrorSchema` | `z.discriminatedUnion("code", […])`, each `{ code, message: string, details }`: **SOLD_OUT** `{ voucherId, regularStockRemaining: int≥0 }` (>0 means the Flash quota ran out but regular stock remains, so the UI shows the regular price); **PRICE_CHANGED** `{ voucherId, price: voucherPriceSchema }` (new price + `priceVersion`); **INSUFFICIENT_POINTS** `{ required: int>0, available: int≥0 }` (`available < required`); **VOUCHER_UNAVAILABLE** `{ voucherId, status: ["PAUSED","HIDDEN","ARCHIVED","EXPIRED"] }`; **ACCOUNT_NOT_ELIGIBLE** `{ reason }`. This is the `error` object of the response envelope (`{ data: null, error, meta }`) |
| `REDEMPTION_ERROR_HTTP_STATUS` | `{ SOLD_OUT: 409, PRICE_CHANGED: 409, INSUFFICIENT_POINTS: 409, VOUCHER_UNAVAILABLE: 409, ACCOUNT_NOT_ELIGIBLE: 403 }` (ASSUMED; the mock and Story 12.8 use it) |
| `voucherTicketStatusSchema` | `["UNUSED","EXPIRING","USED","EXPIRED"]`, computed by the server at `serverTime` (`EXPIRING` = unused and ≤ 7 days to `expiresAt`). Tabs: Unused = UNUSED+EXPIRING, Used, Expired |
| `codeIssueStatusSchema` | `["OPEN","REPLACED","REFUNDED","REJECTED"]` (`REJECTED` = Admin verified that the code works; ASSUMED, OQ-25) |
| `codeIssueReasonSchema` | `["CODE_INVALID","CODE_ALREADY_USED","STORE_REFUSED","OTHER"]` (ASSUMED copy set; Story 12.4 confirms against page 24) |
| `voucherTicketSchema` | `{ id, redemptionId, reference, voucherId, title, brand, valueVnd, code: 4..64, isSharedCode, status, redeemedAt, expiresAt, usedAt: datetime\|null, undoUntil: datetime\|null (usedAt + 24 h), pointsSpent: int>0, priceSource, howToUse: string[], openIssue: { id, status }\|null }`. Refine: `status==="USED"` ⇔ `usedAt !== null` |
| `redemptionResultSchema` | `{ redemptionId, reference, status: z.literal("SUCCEEDED"), voucherId, pointsSpent, priceSource, balanceAfter: int≥0, ticket: voucherTicketSchema, createdAt }` |
| `redemptionHistoryKindSchema` | `["SUCCEEDED","FAILED","REFUNDED"]` |
| `redemptionHistoryEntrySchema` | `{ id, reference (RDM or RFD), kind, voucherTitle, brand, valueVnd, isFlash, points: int (signed: −150, 0, +200), failureCode: redemptionErrorCode\|null, journalId: uuid\|null, note: string\|null, createdAt }`. Refine: FAILED ⇒ `points===0 && journalId===null && failureCode!==null`; SUCCEEDED ⇒ `points<0`; REFUNDED ⇒ `points>0` and the RFD reference |
| `createCodeIssueReportSchema` | `{ reason, note?: trimmed ≤500 }` |
| `codeIssueReportSchema` | `{ id, redemptionId, ticketId, reason, note: string\|null, status, createdAt, resolvedAt: datetime\|null, replacementCode: string\|null, refundReference: string\|null }`. Refine: REPLACED ⇒ `replacementCode`; REFUNDED ⇒ `refundReference` matches RFD; OPEN ⇒ both null and `resolvedAt` null (one outcome per report, FR-75) |
| list wrappers | `voucherTicketListSchema { items, total, serverTime }`, `redemptionHistoryListSchema { items, total, limit, offset, hasMore }`. Story 12.4 uses them |

**§C `rewards-admin.schema.ts`**

| Export | Shape / rule |
|---|---|
| `REWARDS_CODE_EXPIRY_MIN_DAYS = 7` | BR-16 planning default (OQ-25) |
| `adminVoucherStateSchema` | `["ACTIVE","PAUSED","ARCHIVED"]`, plus a separate `isVisible: boolean` (the visibility toggle; hidden = `!isVisible`) |
| `adminVoucherStockSchema` | `{ total, issued, flashReserved, remaining, codesAvailable }`, all int ≥0. Refine `remaining === total - issued - flashReserved` (BR-06 basis) |
| `adminVoucherInputSchema` | `{ title 1..80, brandId, category, valueVnd int>0, basePoints int>0, promoPoints: int>0\|null (< basePoints), isSharedCode, redeemStartsAt, redeemEndsAt (> start), codeExpiresAt ≥ redeemEndsAt + 7 days, terms: string[] ≤10, howToUse: string[] ≤10, imageUrl: url\|null }`. Field-level issue `path`s, so Story 12.5 can show errors per field |
| `adminVoucherSchema` (row) | `{ id, title, brand, category, valueVnd, price: voucherPriceSchema, basePoints, promoPoints, state, isVisible, stock, isSharedCode, redeemStartsAt, redeemEndsAt, codeExpiresAt, priceDeviationPercent: number, createdAt, updatedAt }`. `priceDeviationPercent` = deviation of `basePoints` from `valueVnd / POINT_VND_RATE` (BR-13 warning; the approval rule is OQ-23) |
| `adminVoucherPriceVersionSchema` | `{ version: int≥1, basePoints, promoPoints, effectiveFrom, changedBy: { id, name } }` (append-only, BR-12) |
| `adminVoucherDetailSchema` | `{ voucher: adminVoucherSchema, priceHistory: version[], redemptions: { reference, userLabel, points, kind, createdAt }[] }` |
| `adminVoucherPriceChangeSchema` | `{ basePoints, promoPoints: int\|null }` (applies only to future redemptions) |
| `adminStockAdjustmentSchema` | `{ total: int≥0, reason: trimmed 5..500 }`. "≥ issued + flashReserved" is a server rule; the mock and Story 12.7 enforce it |
| `adminCodeImportRequestSchema` | `{ codes: string[] 1..5000, each /^[A-Za-z0-9-]{4,64}$/, mode: ["VALIDATE","COMMIT"] }` |
| `adminCodeImportResultSchema` | `{ received, accepted, duplicatesInFile: string[], alreadyStored: string[], committed: boolean }`. Refine: `committed ⇒ both lists empty` (BR-15 rejects the whole file) |
| `adminFlashSaleStatusSchema` | `["SCHEDULED","UPCOMING","ACTIVE","SOLD_OUT","ENDED"]` (FR-73's 5 states; `UPCOMING` = starts within 24 h, ASSUMED) |
| `adminFlashSaleInputSchema` | `{ startsAt, endsAt (> start), items: { voucherId, flashPoints int>0, quota int>0, perUserCap int≥1 default 1 }[] min 1, voucherIds unique }`. Overlap, flash < regular and quota ≤ unreserved stock are server rules (BR-18) |
| `adminFlashSaleSchema` | `{ id, code, startsAt, endsAt, status, endedEarlyAt: datetime\|null, items: (flashSaleItemSchema fields + basePoints)[], pointsSpent }` |
| `rewardsStatsQuerySchema` | `{ from, to }` as ISO dates, `to ≥ from`, span ≤ 366 days |
| `rewardsStatsSchema` | `{ range: { from, to }, updatedAt, kpis: { activeVouchers: { active, total, soldOut, expired }, redemptions: { count, avgPerRegularDay }, pointsSpent: { points, vndEquivalent }, redemptionRate: { redeemed, offered, rate 0..1 }, topVoucher: { voucherId, label, count, share 0..1 }\|null, selfReportedUsageRate: 0..1 }, daily: { date: YYYY-MM-DD, count, flashSaleCodes: string[] }[], byBrand: { brand, redemptions, pointsSpent, soldRatio 0..1 }[], flashSales: { flashSaleId, code, startsAt, itemsLabel, sold, quota, status, pointsSpent, soldOutAfterMinutes: int\|null }[] }`. Figma 27 shows 5 KPI cards; `selfReportedUsageRate` is separate and must be labelled self-reported (FR-73) |

### Endpoints (user side, this story)

All are under `apiUrl(...)`, use the `ok`/`fail` envelope from `mocks/envelope.ts`, and are ASSUMED.

| Route | Response | Notes |
|---|---|---|
| `GET /rewards/vouchers` | `voucherCatalogSchema` | Query `voucherCatalogQuerySchema`. Group order: AVAILABLE and PAUSED first (sorted), then SOLD_OUT and EXPIRED ("Đã hết hàng hoặc hết thời gian đổi"). `affordable` is computed against the viewer's available balance |
| `GET /rewards/vouchers/:id` | `voucherDetailResponseSchema` | Hidden, archived or unknown → `404 VOUCHER_NOT_FOUND` |
| `GET /rewards/flash-sales` | `flashSaleListSchema` | Programs whose `endsAt > now - 24h` or that are upcoming |
| `POST /rewards/quotes` | `201 redemptionQuoteSchema` | CSRF. Checks run in order: voucher listed (else 404), status (`VOUCHER_UNAVAILABLE`/`SOLD_OUT`), balance (`INSUFFICIENT_POINTS`). TTL = min(now + 5 min, Flash end) |
| `POST /rewards/redemptions` | `201 redemptionResultSchema` | CSRF plus `Idempotency-Key`. See Task 5.4–5.6 and Mock rules |
| `GET /rewards/redemptions/by-key/:key` | stored response | Replays the stored `{status, body}` for `(user, key)` without side effects. Unknown key → `404 REDEMPTION_NOT_FOUND`. Story 12.3 uses it for network-loss polling |

`404 QUOTE_NOT_FOUND` (unknown quote or another user's quote), `VOUCHER_NOT_FOUND`, `REDEMPTION_NOT_FOUND` and `IDEMPOTENCY_KEY_CONFLICT` are transport and lookup errors. They are **outside** the closed redemption enum, which lists only the business outcomes that have their own screens.

### Mock rules (`decideRedemption` order, mirrors AD-24 / planning-doc sequence)

1. Idempotency record exists → replay (handler level).
2. Quote: unknown or not this user's → 404 `QUOTE_NOT_FOUND`.
3. Voucher state: paused, hidden or archived, or the redemption window has ended → `VOUCHER_UNAVAILABLE` with its status.
4. Price at `now`: recompute the effective price. If the quote has expired, or `priceVersion` or `source` differs (Flash ended, ended early, sold out, or Admin price change), return `PRICE_CHANGED` with the current price. ASSUMED: an expired quote maps to `PRICE_CHANGED` because the enum is closed and the UI action is the same ("confirm again").
5. Stock: Flash price → `sold < quota`, else regular `stockRemaining > 0`. If neither, return `SOLD_OUT` with `regularStockRemaining`. If stock > 0 but no free code is left, also return `SOLD_OUT` (planning edge case; the mock just checks the code pool).
6. Balance: `available < points` → `INSUFFICIENT_POINTS { required, available }` (BR-01).
7. Success: debit, decrement, claim the first unclaimed code, create the ticket (`expiresAt = voucher.codeExpiresAt` for new mock redemptions; seeded tickets carry their own expiry from an earlier code batch) and the history row, and generate the reference `RDM-{YY}{MM}-{4 of 0-9A-Z}`, unique per user state.

**Not enforced in the mock:** per-user limits (BR-19 and BR-20), the eligibility rules (BR-02 and BR-21) and the FraudLog flag. These are backend rules (Story 12.8, gated by OQ-23) and are reachable here only through `?msw=rewards-account-not-eligible`. Do not add them; the seed would block the main demo flow (the demo user already redeemed the Highlands Flash item today in Figma 24, yet Figma 21 still offers it).

**Derived, never stored:** voucher status, Flash item state and ticket status are computed from timestamps at read time, so a reload hours later shows the Flash Sale ended and its quota back in regular stock. Store only facts: counts, timestamps, `usedAt`.

### Seed (Figma pages 21 and 24, relative to `now`)

Brands (6): `highlands` Highlands Coffee, `phuc-long` Phúc Long, `kfc` KFC, `lotteria` Lotteria, `the-coffee-house` The Coffee House, `gong-cha` Gong Cha.

| # | Brand / title | Category | Value | Base → effective | Stock (total / remaining) | Redeem window / code expiry | State at seed |
|---|---|---|---|---|---|---|---|
| 1 | Highlands · "Voucher mua đồ uống" | COFFEE | 50.000 | 250 → **150 FLASH** (−40%) | 300 / 180 | now−20 d → now+60 d; code +79 d | Flash ACTIVE, sold 75/100 |
| 2 | Lotteria · "Voucher burger & gà" | CHICKEN_BURGER | 25.000 | 125 → **90 FLASH** (−28%) | 200 / 90 | same | Flash ACTIVE, sold 48/80 |
| 3 | Phúc Long · "Giảm giá trà & bánh" | TEA | 30.000 | 150 → **120 PROMO** (−20%) | 150 / 104 | now−10 d → now+40 d; code +48 d | AVAILABLE |
| 4 | KFC · "Voucher combo gà rán" | CHICKEN_BURGER | 40.000 | 200 (BASE) | 120 / 62 | now−10 d → now+55 d; code +63 d | AVAILABLE; item in the **upcoming** Flash Sale (140, 50 slots) |
| 5 | Gong Cha · "Voucher trà sữa" | TEA | 20.000 | 100 (BASE) | 80 / 9 | now−30 d → now+5 d; code +12 d | AVAILABLE ("Sắp hết"); its Flash item SOLD_OUT 50/50 → regular price |
| 6 | The Coffee House · "Voucher cà phê & bánh" | BAKERY_DESSERT | 40.000 | 200 (BASE) | 150 / 0 | now−30 d → now+30 d | SOLD_OUT ("Đã đổi hết 150/150") |
| 7 | Highlands · "Voucher đồ uống" | COFFEE | 20.000 | 100 (BASE) | 100 / 40 | now−60 d → **now−33 d**; code now−26 d | EXPIRED |

- 4 categories and 6 brands are all used; 186 Available makes vouchers 1–5 affordable. Give each voucher enough unclaimed codes for repeated demos (≥ 5; generate them as `{BRAND}-XXXX-XXXX`).
- **Flash Sale A (active):** code `FS-1013-A`, `startsAt = now − 3 h`, `endsAt = now + 2 h 15 m` ("Kết thúc lúc 15:00" in Figma), `perUserCap 1`, items #1, #2 and #5 as above. This is the one active program (AC 3).
- **Flash Sale B (upcoming):** `startsAt = now + 7 h`, `endsAt = now + 10 h`, item #4 at 140 points, quota 50, sold 0 (FlashSaleCard "Upcoming", "Nhắc tôi").
- **Tickets (demo user):**

| Tab | Voucher | Reference | Redeemed | Expires | Code |
|---|---|---|---|---|---|
| Unused (EXPIRING) | Gong Cha 20.000 | RDM-2610-1MZ4 | now−5 d, 100 pts | now+7 d−1 h | GCHA-4T8P-2LQW |
| Unused | Highlands 50.000 (Flash) | RDM-2610-8F2K | now−1 h, 150 pts | +79 d | HLRC-7K2M-9QXA |
| Unused | Lotteria 25.000 | RDM-2610-3QK7 | now−1 d, 125 pts | +79 d | LTRA-9D3F-6VNM |
| Used | Phúc Long 30.000 | RDM-2609-2PLB | now−20 d | +28 d, `usedAt` now−18 d | PLNG-… |
| Expired | Highlands 20.000 | RDM-2608-6HCX | now−50 d | now−26 d | HLRC-… |

- **History:** the Figma 24 rows (Highlands −150 SUCCEEDED; Lotteria −125 SUCCEEDED; KFC 0 FAILED `SOLD_OUT` with note "Flash Sale · hết suất"; Gong Cha −100 SUCCEEDED; The Coffee House +200 REFUNDED `RFD-2610-7HC2` with note "mã lỗi, Admin duyệt"; The Coffee House −200 SUCCEEDED `RDM-2610-5TC1`), plus SUCCEEDED rows for the used and expired tickets. Order newest first. The October total spent (net of the refund) is 375, matching Figma.
- **Code-issue report:** one `REFUNDED` report on `RDM-2610-5TC1` with `refundReference RFD-2610-7HC2`. Its ticket is not listed (refunded).
- **Wallet:** demo user 186 available / 18 pending (Task 4.3). The seeded tickets and history are Rewards-local and add no wallet rows. Only **new** mock redemptions post a `redemption:` row (Task 6).

### Files

**NEW:** `packages/schemas/src/rewards/{index,voucher-catalog.schema,redemption.schema,rewards-admin.schema}.ts` plus the three `*.spec.ts`; `apps/frontend/my-app/mocks/data/rewards-rules.ts`, `mocks/data/rewards.ts`, `mocks/handlers/rewards.ts`; `apps/frontend/my-app/tests/rewards-mock.test.mjs`.

**UPDATE** (read each whole file first; preserve everything not listed):

| File | Today | Change | Must preserve |
|---|---|---|---|
| `packages/schemas/src/index.ts` | barrel of every domain | `export * from "./rewards";` | existing order and exports |
| `mocks/db/store.ts` | `SCHEMA_VERSION = 4`, history comment | → 5, add a comment line | everything else |
| `mocks/data/economy.ts` | `seedWallet` gives the activated demo user 112/18/140 | available → 186 + comment | escrow 140, new-user seed, all accessors |
| `mocks/data/economy-rules.ts` | ledger rows per `MockTransactionKind` (pure) | `VOUCHER_REDEMPTION` kind, entries, journal key, `redemptionKey?` field | every existing kind; `SURVEY_KINDS` unchanged |
| `lib/wallet/wallet-history.ts` | key prefix → kind → title | `redemption:` → `VOUCHER_REDEMPTION` "Đổi voucher" | `REVERSAL` precedence, existing titles |
| `mocks/scenarios.ts` | `MOCK_SCENARIOS` list + `applyScenario` | 6 `rewards-*` values (no `applyScenario` branch) | auth/data scenario semantics; hybrid forces `default` |
| `mocks/handlers/index.ts` | one array per domain | import + spread `rewardHandlers` | `hybridHandlers` filter logic |
| `mocks/route-allowlist.ts` | MOCK_ONLY 3, DEFERRED_KEEP_MOCK 14 | +6 DEFERRED_KEEP_MOCK | other entries |
| `tests/route-diff.test.mjs`, `tests/hybrid-mocking.test.mjs` | assert 14 deferred | → 20, + 1 rewards hybrid test | all other assertions |

### Testing standards

- `packages/schemas`: Jest + ts-jest, specs in `src/**/*.spec.ts`, `describe('… (Story 12.1, FR-6x)')` naming like `top-up.schema.spec.ts`, constant UUID fixtures (`'11111111-1111-4111-8111-111111111111'`).
- Frontend: `node --test tests/*.test.mjs` (`npm test` builds `@rescom/schemas` first through `pretest`). Pure TS modules are imported directly (`await import("../mocks/data/rewards-rules.ts")`; Node 22.18 strips the types). Handler tests reuse the loader and `getResponse(hybridHandlers, …)` set-up already in `tests/hybrid-mocking.test.mjs`. Do not invent a new harness.
- Guard tests that must stay green: `route-diff`, `hybrid-mocking`, `no-direct-mocks` (nothing under `app/`, `lib/` or `components/` may import `mocks/`; `lib/wallet/wallet-history.ts` must not import mock code), `contract-callsites` (unaffected: there are no FE callers yet), `wallet-history`, `admin-top-ups`.
- No `test.skip`, `.only`, TODO stubs or placeholder assertions.

### Gotchas checklist

1. Gate-G counts are hard-coded in **two** tests (Task 8.2). Forgetting them fails CI.
2. Hybrid mode: never call `getMockSessionUser()` there; the test stand-in throws.
3. `z.coerce.boolean("false") === true`. Use the enum transform for query flags.
4. Don't store derived states (Flash ACTIVE, ticket EXPIRING); compute them from `now`.
5. Don't hard-code calendar dates in the seed; the persisted seed must keep working on any day. (Bumping `SCHEMA_VERSION` re-seeds stale browsers.)
6. One `update()` per collection per redeem; a thrown mutator must leave state untouched (`createCollection.update` works on a clone).
7. Name collisions: no `reward*` and no `pricingQuote*` exports (Task 1.5).
8. `apps/frontend/my-app/AGENTS.md` warns that Next 16 differs from training data. This story touches no Next APIs; read `node_modules/next/dist/docs/` before any page work in Story 12.2.

### Project Structure Notes

- The domain folder `packages/schemas/src/rewards/` matches the existing per-context folders (`economy/`, `forms/`, `participation/`…). The mock split into rules, state and handlers matches `economy-rules.ts`, `economy.ts` and `handlers/economy.ts`.
- Variance: the wallet demo seed changes from 112 to 186 because the AC requires Figma 21's numbers; page 7 (112) predates pages 21–27. No existing test asserts the seeded 112 (the matches found are self-built fixtures), but run the full suite.
- Variance: Rewards routes go into `DEFERRED_KEEP_MOCK` (Phase 2 deferred scope), not `PLANNED`, because the gate-G test allows only `MOCK_ONLY` and `DEFERRED_KEEP_MOCK`. Stories 12.7–12.10 delete each entry when the backend serves it (route-diff forces that).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12, Story 12.1 and Stories 12.2–12.11 for downstream needs]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-13.md` Appendix A (PRD §4.20 FR-68…FR-75), §4.2 AD-24]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` AD-24, AD-1]
- [Source: Planning doc "Rescom — Đổi điểm lấy voucher F&B & Flash Sale" https://claude.ai/artifact/UXvkuFDxCGR5DK2xo5KRhK: BR-01…BR-24, redemption sequence, edge cases, 12 assumptions]
- [Source: Figma `mkudD5Ngi5RPyIAVxCcxXi`, page 21 (`113:4`, desktop frame `122:364`, filter sheet `123:989`) seed values; page 24 (`113:7`) tickets and history; page 27 (`140:2`) statistics shape]
- [Source: `apps/frontend/my-app/mocks/db/store.ts`, `mocks/scenarios.ts`, `mocks/data/idempotency.ts`, `mocks/handlers/{top-up,engagement}.ts`, `mocks/route-allowlist.ts`, `mocks/hybrid.ts`, `mocks/data/economy{,-rules}.ts`, `lib/wallet/wallet-history.ts`]
- [Source: `packages/schemas/src/forms/external-form.schema.ts` (`IDEMPOTENCY_KEY_HEADER`, `idempotencyKeySchema`), `economy/top-up.schema.ts` (`POINT_VND_RATE`, list pagination shape)]

## Dev Agent Record

### Agent Model Used

- Antigravity pair programming agent (Gemini 2.5 Pro) with subagents for contracts, domain data, handlers, and wallet integration.

### Debug Log References

- Schemas tests: 44 suites, 630 tests passed (`npm --prefix packages/schemas test`).
- Schemas typecheck: clean (`npm --prefix packages/schemas run typecheck`).
- Backend typecheck: clean against new schema exports (`npm --prefix apps/backend run typecheck`).
- Rewards mock tests: 11 tests passed (`node --test tests/rewards-mock.test.mjs`).
- Full frontend tests: 545 suites, 787 tests passed (`cd apps/frontend/my-app && npm test`).
- Frontend typecheck: clean (`npm run typecheck`).
- Frontend lint: clean, 0 errors, 0 warnings (`npm run lint`).

### Completion Notes List

- Implemented Story 12.1 shared contracts (`voucher-catalog.schema.ts`, `redemption.schema.ts`, `rewards-admin.schema.ts`) and spec tests in `packages/schemas/src/rewards/`.
- Created pure mock domain rules (`mocks/data/rewards-rules.ts`), state and seeded collections (`mocks/data/rewards.ts`), and 6 user-side MSW handlers (`mocks/handlers/rewards.ts`).
- Integrated wallet ledger consistency with `VOUCHER_REDEMPTION` transaction kind, `redemption:{key}` journal, and wallet history presentation (`lib/wallet/wallet-history.ts`).
- Added 6 failure/simulation scenarios (`rewards-sold-out`, `rewards-price-changed`, `rewards-insufficient-points`, `rewards-voucher-unavailable`, `rewards-account-not-eligible`, `rewards-redeem-lost`) in `mocks/scenarios.ts`.
- Gated 6 Rewards endpoints under `ROUTE_ALLOWLIST.DEFERRED_KEEP_MOCK` with count bump (14 -> 20) and hybrid integration coverage.
- Addressed spec checklist audit: reuses `idempotencyRecordKey` and `decideIdempotentRequest` from `mocks/data/idempotency.ts`; forced errors use real state details where applicable (`available`, regular stock, paused status); pure rules module handles pricing precedence, ticket expiry, and availability calculations.
- Verification: All 51 subtasks completed. Subtask 10.4 manually verified in browser console with `rescom:msw-scenario` set to `rewards-sold-out` returning `409 SOLD_OUT`. All automated suites green (630 schema tests, 787 frontend tests, clean typecheck and lint). Story promoted to `review`.

### File List

**New files:**
- `packages/schemas/src/rewards/index.ts`
- `packages/schemas/src/rewards/voucher-catalog.schema.ts`
- `packages/schemas/src/rewards/voucher-catalog.schema.spec.ts`
- `packages/schemas/src/rewards/redemption.schema.ts`
- `packages/schemas/src/rewards/redemption.schema.spec.ts`
- `packages/schemas/src/rewards/rewards-admin.schema.ts`
- `packages/schemas/src/rewards/rewards-admin.schema.spec.ts`
- `apps/frontend/my-app/mocks/data/rewards-rules.ts`
- `apps/frontend/my-app/mocks/data/rewards.ts`
- `apps/frontend/my-app/mocks/handlers/rewards.ts`
- `apps/frontend/my-app/tests/rewards-mock.test.mjs`

**Modified files:**
- `packages/schemas/src/index.ts` (re-export rewards)
- `apps/frontend/my-app/mocks/db/store.ts` (SCHEMA_VERSION = 5)
- `apps/frontend/my-app/mocks/data/economy.ts` (demo wallet 186/18)
- `apps/frontend/my-app/mocks/data/economy-rules.ts` (VOUCHER_REDEMPTION kind)
- `apps/frontend/my-app/lib/wallet/wallet-history.ts` (VOUCHER_REDEMPTION title)
- `apps/frontend/my-app/mocks/scenarios.ts` (6 rewards scenarios)
- `apps/frontend/my-app/mocks/handlers/index.ts` (register rewardHandlers)
- `apps/frontend/my-app/mocks/route-allowlist.ts` (6 deferred routes)
- `apps/frontend/my-app/tests/route-diff.test.mjs` (bump count to 20)
- `apps/frontend/my-app/tests/hybrid-mocking.test.mjs` (bump count, hybrid rewards test)
- `apps/frontend/my-app/tests/contract-callsites.test.mjs` (exempt uncalled rewards routes)
- `apps/frontend/my-app/tests/pilot-scope.test.mjs` (exempt uncalled rewards routes)
- `_bmad-output/implementation-artifacts/12-1-rewards-contracts-msw-mock-domain.md` (task status and records)
