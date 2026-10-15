---
baseline_commit: a469259
---

# Story 12.8: Quote & Redemption Transaction

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a User,
I want my redemption to be exact and safe under concurrency,
so that I am charged once, at the agreed price, or not at all.

## Acceptance Criteria

1. **Quote.** Given PRD Open Questions 23 and 26 are answered (planning defaults, see Open points), when the user requests a quote, then the server returns `quoteId`, effective price (Flash > promotion > base), `priceVersion`, and an expiry no later than the quote TTL or the Flash end, after checking eligibility (BR-02, BR-21).
2. **RedeemVoucher transaction.** `RedeemVoucher` follows AD-24 in one transaction: idempotency lookup, lock Voucher then FlashSaleItem, compare `priceVersion`, conditional stock decrement, claim one code with `FOR UPDATE SKIP LOCKED`, Economy `SpendPoints` keyed `redemption:{userId}:{idempotencyKey}` (USER_AVAILABLE → SYSTEM_SINK, ledger accounts locked by ascending id), Redemption SUCCEEDED plus Outbox event, then commit.
3. **Per-user limits.** Limits (per voucher per 30 days, per day in Points, Flash cap) are counted inside the transaction after the wallet lock (BR-19, BR-20).
4. **Atomic failure.** Any failure rolls back everything; the failed attempt is recorded in a separate transaction with no journal (BR-07, BR-09).
5. **Flash-after-top-up flag.** A Flash redemption within 24 hours after a top-up creates a FraudLog flag but is not blocked.
6. **PostgreSQL integration tests prove:** two users racing for the last unit (one success, one `SOLD_OUT`, no deduction); a double submit with the same key (one journal); balance changed between quote and confirm (`INSUFFICIENT_POINTS`); price changed or Flash ended (`PRICE_CHANGED`); stock > 0 with no free code (rollback, Admin alert, `SOLD_OUT` to the user); ledger sum per journal is zero.

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.8 (FR-69, FR-71, FR-73; BR-01–BR-03, BR-07–BR-11, BR-14, BR-19–BR-21; AD-24, AD-16, AD-10).

## Tasks / Subtasks

- [x] **Task 0: Branch and baseline** — branch `feat/12-8-quote-redemption-transaction` already exists from `origin/develop` (a469259, includes merged 12.7). Re-run `git status --short --branch` before the first edit. Backend is under `apps/backend`; Rewards module is `apps/backend/src/modules/rewards`.
- [x] **Task 1: Additive migration** (AC: 2, 4, 5)
  - [x] 1.1 New migration `apps/backend/prisma/migrations/<ts after 20261013120000>_rewards_redemption_transaction/migration.sql` (do **not** edit `20261013120000_rewards_catalog_schema`). Unconditional DDL, no `to_regclass` guard (`migration-chain.spec.ts`).
  - [x] 1.2 `redemptions` additive columns: `balance_after int NULL` (set on SUCCEEDED so an idempotent replay returns the original `balanceAfter`), `failure_details jsonb NULL` (so a replayed FAILED attempt returns the original error `details`). `redemptions` is append-only: INSERT only, never UPDATE (trigger from 12.7 rejects it).
  - [x] 1.3 CHECKs: `status='SUCCEEDED'` ⇒ `journal_id`, `voucher_code_id IS NOT NULL OR` shared voucher (see gotcha 7), `balance_after IS NOT NULL`; `status='FAILED'` ⇒ `journal_id IS NULL`, `failure_code IS NOT NULL`, `price_points`/`price_source` still stored. Keep them to what Prisma cannot express and mirror in `prisma/sql/post-push-invariants.sql`.
  - [x] 1.4 Partial unique index `redemptions(quote_id) WHERE status = 'SUCCEEDED'` — one successful redemption per quote, DB-enforced (Open point #4). Index `redemptions(user_id, created_at)` for the limit counts; index `redemptions(user_id, voucher_id, created_at) WHERE status='SUCCEEDED'` if EXPLAIN shows the 30-day count needs it.
  - [x] 1.5 `ALTER TYPE "FraudLogType" ADD VALUE IF NOT EXISTS 'FLASH_AFTER_TOPUP'` in its **own** migration file (an enum value added in a transaction cannot be used in the same transaction). Update `FraudLogType` in `schema.prisma`, `packages/schemas/src/admin/fraud-log.schema.ts`, `admin-overview.schema.ts` and every `switch`/label map that is exhaustive over it (grep `FraudLogType` in `apps/backend/src`, `packages/schemas/src`, `apps/frontend/my-app`). Additive only.
  - [x] 1.7 `rewards_settings` single-row table (Rewards-owned): `id smallint PK CHECK (id = 1)`, `daily_points_limit int NOT NULL CHECK (daily_points_limit > 0)`, `updated_by_id uuid NULL`, `updated_at`. Insert the default row (500) in the migration (reference data). Mirror the CHECK in `post-push-invariants.sql`.
  - [x] 1.6 Update `test/migration-chain*.ts` expectations. Migration must apply from empty DB and from the 12.7 snapshot.
- [x] **Task 2: Economy `SpendPoints`** (AC: 2) — Economy owns the ledger; Rewards never writes ledger rows (AD-24).
  - [x] 2.1 `LedgerService.spendPoints({ userId, amount, idempotencyKey, description }, options?: PostJournalTransactionOptions)` in `modules/economy/application/ledger.service.ts`, modelled on `reserveEscrow` / `creditApprovedTopUp`: positive-integer amount, idempotency fast path with `assertReplayCompatible`, `getOrCreateAccount(userId,'USER_AVAILABLE')` and `getOrCreateAccount(null,'SYSTEM_SINK')`, then `postJournal` with entries `[{USER_AVAILABLE, -amount}, {SYSTEM_SINK, +amount}]`. Pass `options.assertBeforeInsert` straight through: it runs under the ascending-id account locks, which is where Rewards counts the limits (gotcha 1).
  - [x] 2.2 Insufficient balance must throw the existing no-overdraft exception (`InsufficientBalanceException`); Rewards maps it to `INSUFFICIENT_POINTS` and reads the real balance for `details.available` (re-read after rollback via `WalletBalancePort`).
  - [x] 2.3 Unit tests in `ledger.service.spec.ts`: balanced journal, replay returns the same journal, same key + different amount → `IdempotencyConflictException`, overdraft rejected, `assertBeforeInsert` throw aborts with no journal. Add the in-memory ledger repository parity if it needs a change.
  - [x] 2.4 A small `SpendPointsPort` in `modules/rewards/application/ports/` (`SPEND_POINTS_PORT`) implemented by an Economy provider, so `rewards/domain|application` never import Economy classes (architecture rule, gotcha 9).
- [x] **Task 3: Domain + ports (pure; no Nest/Prisma imports)** (AC: 1–5)
  - [x] 3.1 `domain/redemption-decision.ts`: pure `decideRedemption(voucher, flashItems, quote, now)` returning `null | RedemptionRejection` in the **mock order** (`mocks/data/rewards-rules.ts` `decideRedemption`): status (`VOUCHER_UNAVAILABLE` / `SOLD_OUT`) → quote expired, or price/source/points/priceVersion/flashItem differs ⇒ `PRICE_CHANGED` carrying the new `voucherPriceSchema` price → stock/quota/codes exhausted ⇒ `SOLD_OUT`. Reuse `effectivePrice`, `voucherAvailability`, `effectiveStatus` from 12.7 domain; do not duplicate them.
  - [x] 3.2 `domain/redemption-limits.ts`: pure `checkRedemptionLimits({ perVoucher30dCount, todayPoints, flashUserCount }, price, flashItem)` ⇒ `VOUCHER_LIMIT_REACHED | DAILY_LIMIT_REACHED | FLASH_LIMIT_REACHED | null`. Constants in `application/ports/rewards.constants.ts`: `REWARDS_QUOTE_TTL_SECONDS = 300`, `REWARDS_LIMIT_PER_VOUCHER_PER_30_DAYS = 2`, `REWARDS_DAILY_POINTS_LIMIT_DEFAULT = 500` (only the seed/default; the live value comes from `rewards_settings`), `REWARDS_FLASH_AFTER_TOPUP_HOURS = 24`, `REWARDS_RECENT_SURVEY_DAYS = 30`. Day boundary = Asia/Ho_Chi_Minh calendar day (UTC+7, no DST): `[00:00, 24:00)` local.
  - [x] 3.3 `domain/redemption-reference.ts`: `RDM-{YYYY}-{4 chars 0-9A-Z}` generator taking an injected random source (matches `REDEMPTION_REFERENCE_PATTERN`; epics says YYYY, the mock uses YYMM — both satisfy the regex; use YYYY).
  - [x] 3.4 `domain/voucher-ticket.ts`: pure `toVoucherTicket(redemption, voucher, code, now)` building `voucherTicketSchema` (`status` via the same rule as mock `ticketStatus`: EXPIRED ≤ 0, EXPIRING ≤ 7 d, else UNUSED; `usedAt/undoUntil/openIssue` null). Story 12.10 reuses it.
  - [x] 3.5 Ports (symbols `*_PORT`): `redemption-repository.port.ts` (quotes + redemptions, see Task 4), `redemption-eligibility.port.ts` (`ACCOUNT_STANDING_PORT`: `accountStatus(userId)`, `isActivated(userId)`, `completedSurveyInLastDays(userId, days, now)`, `hasFlashBlockingFraudFlag(userId, since)`, `hasApprovedTopUpSince(userId, since)` — read-only), `spend-points.port.ts`, `fraud-flag.port.ts` (`recordFlashAfterTopUp(userId, redemptionId, ...)`), and extend `flash-sale-read.port.ts` / voucher port with the write the transaction needs (`lockFlashItem(id)`, `incrementFlashSold(id)` conditional).
- [x] **Task 4: Application services** (AC: 1–5)
  - [x] 4.1 `application/rewards-quote.service.ts`: `createQuote(userId, { voucherId })`. Reads at `Clock.now()` (never client time). 404 `VOUCHER_NOT_FOUND` for missing/hidden/archived (as `createVoucherQuote` in the mock); status ≠ AVAILABLE ⇒ `SOLD_OUT` / `VOUCHER_UNAVAILABLE`; eligibility (below) ⇒ `ACCOUNT_NOT_ELIGIBLE`; `viewer.available < price` ⇒ `INSUFFICIENT_POINTS`; advisory limit check with the same pure function (authoritative count is in the redeem transaction). Persist `RedemptionQuote` (`pricePoints`, `priceSource`, `priceVersion`, `flashSaleItemId`, `expiresAt = min(now + TTL, flashEndsAt)`), return `redemptionQuoteSchema` (`balance.after = available − price`, `flashEndsAt` set iff source FLASH). Quote creation is not idempotent and not locking; do not take the Voucher row lock here.
  - [x] 4.2 Eligibility rules (one pure function over facts from `ACCOUNT_STANDING_PORT`): user not `ACTIVE` ⇒ `ACCOUNT_LOCKED`; no `starter-unlock:{userId}` journal ⇒ `ACCOUNT_NOT_ACTIVATED` (decided, Open point #5); for **Flash** quotes only: flash `rules.requireRecentSurvey` and no COMPLETED attempt in 30 days ⇒ `NO_RECENT_SURVEY` (BR-02); `rules.blockFlagged` and a blocking FraudLog flag ⇒ `FRAUD_FLAGGED` (BR-21; Open point #6). The same function runs again inside the redeem transaction (state can change between quote and confirm).
  - [x] 4.3 `application/rewards-redemption.service.ts`: `redeem(userId, { quoteId }, idempotencyKey)` per "Transaction recipe" below. Wraps the work in `UnitOfWorkPort.run('redemption:{userId}:{idempotencyKey}', …)`.
  - [x] 4.4 `findByKey(userId, key)` for `GET /rewards/redemptions/by-key/:key`: returns the stored SUCCEEDED result or replays the stored FAILED error, `REDEMPTION_NOT_FOUND` (404) if none. Used by the FE for the "response lost" recovery (mock handler exists).
  - [x] 4.5 Exceptions: add `RedemptionRejection` (carries one of the five `REDEMPTION_ERROR_CODES` + `details`, parsed against `redemptionErrorSchema` before throwing), plus `QUOTE_NOT_FOUND` (404), `QUOTE_ALREADY_REDEEMED` (409), `IDEMPOTENCY_KEY_CONFLICT` (409), `REDEMPTION_NOT_FOUND` (404). Map in `common/http/http-exception.filter.ts` using `REDEMPTION_ERROR_HTTP_STATUS` (do not hard-code statuses); error body shape `{ code, message, details }` exactly as the mock `fail(...)`.
  - [x] 4.6 Admin-editable daily limit: `GET /admin/rewards/settings` and `PUT /admin/rewards/settings` (`{ dailyPointsLimit: int 1..1_000_000 }`) on the existing Admin controller pattern (`@Roles('ADMIN')`, CSRF, JSON-only, live `ADMIN_CAPABILITY_PORT` check, `UnitOfWorkPort`, audit Outbox event in the same transaction, `Cache-Control: no-store`). Add the schema in `packages/schemas/src/rewards/` (additive). The redeem transaction reads the value from `rewards_settings` **inside** the `assertBeforeInsert` hook (so a change applies to the next redemption, never mid-count); quote's advisory check reads the same row. The Admin dashboard UI is not in 12.8 (FE untouched): record it for 12.11 / a follow-up FE story, since the FE mock has no such route.
- [x] **Task 5: Infrastructure** (AC: 2, 4, 6)
  - [x] 5.1 `infrastructure/prisma-redemption.repository.ts` (+ in-memory twin and one shared contract suite, pattern `rewards.repositories.spec.ts`): quote insert/find, redemption find-by-key, insert SUCCEEDED/FAILED, limit counts, `claimCode(voucherId)` = `SELECT id, code FROM voucher_codes WHERE voucher_id = $1 AND redemption_id IS NULL ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`, then `UPDATE voucher_codes SET redemption_id = $redemptionId WHERE id = $id` (the partial index from 12.7 serves this). Join the ambient transaction through `currentClient(this.prisma)` / `runInTransaction` exactly like `prisma-voucher.repository.ts`; never open a second transaction inside the redeem path.
  - [x] 5.2 Stock: regular purchase ⇒ `UPDATE vouchers SET stock_remaining = stock_remaining - 1 … WHERE id = $1 AND stock_remaining > 0` (0 rows ⇒ `SOLD_OUT`). Flash purchase ⇒ `UPDATE flash_sale_items SET sold = sold + 1, sold_out_at = CASE WHEN sold + 1 >= quota THEN now… END WHERE id = $1 AND sold < quota` **and** the same conditional `vouchers.stock_remaining - 1` (review decision D2: Flash quota is carved out of voucher stock, so a Flash unit also leaves `stock_remaining`). Use the injected clock for `sold_out_at`, not DB `now()`.
  - [x] 5.3 Adapters for `ACCOUNT_STANDING_PORT` and `FRAUD_FLAG_PORT` live with the **owning module** (Identity/Auth for `users.status`, Participation for `survey_attempts`, Moderation or Participation's existing `recordFraudLog` path for `fraud_logs`, Economy for `top_up_requests` and the `starter-unlock:{userId}` journal). Reuse the existing FraudLog writer (`prisma-participation.repository.ts` `recordFraudLog`, Story 8.2) rather than a new `tx.fraudLog.create`; `dedupeKey = flash-after-topup:{redemptionId}`. Read-only; none may create rows on read (cf. 12.7 gotcha 1).
  - [x] 5.4 Admin alert for "stock > 0 but no free code" (Open point #7): inside the failing transaction nothing durable survives, so after rollback emit one Outbox event `REWARDS_CODE_INVENTORY_DRIFT` (schemaVersion 1, `voucherId`, counts only — never code values) in the **failure-recording** transaction, deduped by `rewards:inventory-drift:{voucherId}:{yyyy-mm-dd-hour}` so a flash crowd produces one event per hour, not thousands. A console/log line alone is not enough.
- [x] **Task 6: Presentation + wiring** (AC: 1, 2)
  - [x] 6.1 `presentation/rewards-redemption.controller.ts`: `@Controller(['rewards', 'api/rewards'])` (exactly two prefixes), `SessionAuthGuard, CsrfGuard, JsonOnlyGuard` on writes. Routes below. `Cache-Control: no-store` on every response.
  - [x] 6.2 `Idempotency-Key` header required on `POST redemptions`, parsed with `idempotencyKeySchema` from `@rescom/schemas`; missing/invalid ⇒ 400 `VALIDATION_ERROR`. Body via `ZodValidationPipe(redeemVoucherSchema)`; quote body via `createRedemptionQuoteSchema`.
  - [x] 6.3 Register providers in `rewards.module.ts`; Economy exports the `SpendPointsPort` provider. `test/architecture.spec.ts` must stay green.
  - [x] 6.4 Rate limit `POST /rewards/quotes` and `POST /rewards/redemptions` per user with the existing throttling mechanism (look at how `top-up.controller.ts` / auth throttle do it); a Flash start is a thundering herd and quote rows are cheap to spam. If no per-route throttle exists, state the bound you chose in Completion Notes.
- [x] **Task 7: Tests** (AC: 1–6)
  - [x] 7.1 Unit: domain decision order, limits boundaries (exactly 2 in 30 d ok, third blocked; 500 Points daily boundary at local midnight UTC+7; Flash cap 1), reference format, ticket status; services with in-memory repos + `FixedClock` + `PassThroughUnitOfWork`; failed attempt recorded once, never with a journal; replay returns identical body.
  - [x] 7.2 Controller specs: guards (401, CSRF, JSON-only), missing/invalid `Idempotency-Key`, both prefixes, status codes from `REDEMPTION_ERROR_HTTP_STATUS`.
  - [x] 7.3 In-memory HTTP e2e (`test/rewards-redemption.e2e-spec.ts`, pattern `rewards-catalog.e2e-spec.ts`): every response parsed with `redemptionQuoteSchema`, `redemptionResultSchema`, `redemptionErrorSchema` so contract drift fails here.
  - [x] 7.4 **PostgreSQL e2e** (`test/rewards-redemption.prisma.e2e-spec.ts`, harness `financial-pg-harness.ts`; production repositories and services, no raw-SQL shortcuts): the six proofs in AC 6, plus: same-key concurrent double submit from two parallel requests ⇒ one journal, both callers get the same body; same user redeeming two different vouchers in parallel cannot exceed the daily 500-Point limit (wallet-lock serialisation); Flash quota 1 with two racing users; archived/paused between quote and confirm ⇒ `VOUCHER_UNAVAILABLE`; limit failure rolls back stock, code, journal; `ledger_entries` sum per journal = 0 and global sum = 0; FAILED row has `journal_id IS NULL`; `SELECT … FOR UPDATE SKIP LOCKED` never hands the same code to two transactions; no deadlock when the same user also runs a publish/escrow command in parallel (ascending-id lock order).
  - [x] 7.5 Run the PG suite locally this time. 12.7 shipped PG e2e "written but not executed" (no Postgres on :5433); that is not acceptable evidence for a money path. Record the command and output in Completion Notes.
- [x] **Task 8: Verification**
  - [x] 8.1 `npm run prisma:validate`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` in `apps/backend`; `npm test` in `packages/schemas`; `npm run test:e2e -- rewards` (+ `migration-chain.prisma`).
  - [x] 8.2 `prisma migrate deploy` on an empty scratch DB and on a DB at `20261013120000`; record output.
  - [x] 8.3 Frontend untouched: `node --test tests/*.test.mjs` in `apps/frontend/my-app` must pass (schemas are shared; `route-diff` / `contract-callsites` tests may need the three new routes whitelisted exactly as 12.7 did for its routes).

### Review Findings

- [x] [Review][Patch] Ledger idempotency key đổi thành `redemption:{userId}:{K}` (quyết định D1=1, lệch spec có chủ đích); cập nhật spec/test tương ứng và map ledger conflict → 409 nếu còn đường dẫn [rewards-redemption.service.ts:277]
- [x] [Review][Patch] Flash purchase phải giảm cả `vouchers.stock_remaining` (quota Flash trích từ stock, D2=1); đồng bộ `codesAvailable` trong `decideRedemption` và kiểm tra drift [rewards-redemption.service.ts:201-230]
- [x] [Review][Dismiss] `hasBlockingFraudFlag` giữ nguyên mọi type trừ FLASH_AFTER_TOPUP (D3=2)
- [x] [Review][Patch] Chuyển `PrismaAccountStandingReader`/`PrismaFraudFlagWriter` về module sở hữu (Identity/Participation/Moderation/Economy) và tái dùng `recordFraudLog` của Participation (D4=1) [rewards/infrastructure/prisma-account-standing.reader.ts, prisma-fraud-flag.writer.ts]
- [x] [Review][Dismiss] Các sửa ngoài phạm vi 12.8 giữ trong branch (D5=1)
- [x] [Review][Patch] `recordFailure`: audit drift key `rewards:inventory-drift:{voucher}:{hour}` unique → lần drift thứ 2 trong giờ làm rollback cả FAILED row, `catch {}` nuốt hết; `by-key` trả 404. Làm audit conflict-tolerant/tách try, chỉ nuốt P2002 trùng idempotency key [rewards-redemption.service.ts:596-620]
- [x] [Review][Patch] Rule/cap Flash bị áp cho purchase không phải Flash (Flash đã sold-out, PROMO/BASE): `checkAccountEligibility(…, activeFlash?.flashSale.rules)` và `checkRedemptionLimits(activeFlash)` → FLASH_LIMIT_REACHED/NO_RECENT_SURVEY sai; quote cũng set `flashSaleItemId`/`flashEndsAt` khi chưa chắc source FLASH. Chỉ truyền flash khi `isFlashPurchase` [rewards-redemption.service.ts:189,295-312; rewards-quote.service.ts]
- [x] [Review][Patch] `generateRedemptionReference`: 4 ký tự (~1.68M) + `Math.random`, không retry; trùng `reference @unique` → 500 ở success path, bị nuốt ở `recordFailure`. Dùng `crypto.randomInt` + retry khi P2002 reference [redemption-reference.ts, rewards-redemption.service.ts:332,578]
- [x] [Review][Patch] Cùng user + cùng key đồng thời với 2 quote/voucher khác nhau: thua cuộc dính unique (user_id, idempotency_key) → 500. Map P2002 → IdempotencyKeyConflictException hoặc advisory lock [rewards-redemption.service.ts:60-92]
- [x] [Review][Patch] `replayExisting`: trả code giả `'REPLAYED'` khi thiếu code, và record `REFUNDED` replay thành `SUCCEEDED`. Ném lỗi integrity và xử lý REFUNDED; message replay failure nên giống bản gốc [rewards-redemption.service.ts:495-545]
- [x] [Review][Patch] `PrismaFraudFlagWriter` nuốt lỗi trong transaction chung → Postgres abort (25P02), cả redemption rollback. Dùng `createMany({skipDuplicates})`/savepoint [prisma-fraud-flag.writer.ts]
- [x] [Review][Patch] `GET /rewards/redemptions/by-key/:key` trả 200, spec contract ghi 201 (giữ như mock) [rewards-redemption.controller.ts:82, rewards-redemption.e2e-spec.ts]
- [x] [Review][Patch] Thiếu rate limit `POST /rewards/quotes` và `/redemptions` (Task 6.4; Completion Notes khai 60/min, 20/min nhưng không có code) [rewards-redemption.controller.ts]
- [x] [Review][Patch] `findActiveItemForVoucher` gọi `this.list()` toàn bộ flash sale, mỗi quote và trong lock voucher; nhiều sale active → chọn tuỳ thứ tự. Query trực tiếp theo voucherId + order xác định [prisma-flash-sale-read.repository.ts]
- [x] [Review][Patch] Test thiếu/sai: (a) AC5 flash-after-top-up không có test nào, mock fraud method `recordFlashAfterTopUpFlag` ≠ `recordFlashAfterTopUp`; (b) test "records failed attempt…" chỉ assert reject, không check FAILED row/`journal_id IS NULL`/replay failure; (c) test "Flash quota exhausted→SOLD_OUT" assert PRICE_CHANGED; (d) thiếu Flash→PRICE_CHANGED khi ended, race quota 1, paused/archived, rollback limit, SKIP LOCKED, controller/filter specs; (e) PG e2e `describe.skip` khi DB probe fail, chưa có output chạy [rewards-domain.spec.ts, rewards-services.spec.ts, test/rewards-redemption*.e2e-spec.ts]
- [x] [Review][Patch] Migration/schema: thiếu CHECK `voucher_code_id IS NOT NULL OR shared voucher` cho SUCCEEDED (Task 1.3); CHECK thêm không `NOT VALID` trên bảng có thể đã có row; `admin-overview.schema.ts` chưa thêm `FLASH_AFTER_TOPUP` (Task 1.5) [migration 20261014110000, post-push-invariants.sql]
- [x] [Review][Patch] `currentTime` lấy trước khi chờ lock → sai ngày VN/30 ngày ở ranh giới; lấy `now` sau khi giữ lock [rewards-redemption.service.ts:78]
- [x] [Review][Patch] `appendAudit` thay `correlationId` không phải UUID bằng null → outbox redemption/settings luôn mất correlation (`correlationId: idempotencyKey`) [prisma-voucher.repository.ts, rewards-redemption.service.ts:395,610]
- [x] [Review][Patch] Route `GET/PUT /admin/rewards/settings` mới chưa nằm trong `deferredRewards`/allowlist route-diff; `redemptions?` optional → `getSettings` trả 500 cứng, `updateSettings` audit mà không persist [route-diff.test.mjs, rewards-admin-catalog.service.ts]
- [x] [Review][Defer] `redemption_quotes` tăng không giới hạn (không TTL purge) [rewards-quote.service.ts] — deferred, bổ sung cùng rate limit/cleanup job sau

## Dev Notes

### Scope boundaries (read first)

- **In:** quote endpoint; redeem endpoint (`Idempotency-Key`); lost-response recovery endpoint; `SpendPoints` in Economy; per-user limits; eligibility (account active/activated, Flash recent-survey and fraud rules); failed-attempt recording; Flash-after-top-up FraudLog flag; stock/quota decrement and code claim; PG concurrency tests; additive migration.
- **Out (other stories — do not build):**
  - Flash Sale create/edit/end, start/end jobs, quota reservation, overlap rules: **12.9**. 12.8 only reads Flash items and increments `sold`.
  - My vouchers list/detail, mark-used/undo, reminders, code-issue reports, refund/replacement (`redemption-refund:{caseId}`), history list `GET /rewards/redemptions`: **12.10**. 12.8 builds the ticket DTO (`toVoucherTicket`) only because the redeem response embeds it.
  - Admin Flash read/monitor and `/admin/rewards/stats`: 12.9 / 12.11 (12.7 open point #6 still unresolved — do not build here).
  - Feature flag, load test, FE de-mocking: **12.11**. Do not edit `apps/frontend` (routes may need whitelisting in two FE contract tests, see Task 8.3).
  - Refunds of any kind, partner-API issuance, second-Admin approval.
- **Gates:** Production enable still requires OQ-24 (12.11). 12.8's own gates are OQ-23 and OQ-26: no recorded answer exists, planning defaults adopted (Open points #1, #2). Rewards must not write Ledger rows (AD-24): all spending goes through `SpendPointsPort`.

### Transaction recipe (AD-24, authoritative order)

```
POST /rewards/redemptions  (userId from session, quoteId, Idempotency-Key K)

0. (outside tx, fast path) find Redemption by (userId, K):
     SUCCEEDED -> replay stored result      (201, replayed, same body)
     FAILED    -> replay stored error       (same status/body)
     exists but quoteId differs -> 409 IDEMPOTENCY_KEY_CONFLICT
1. load quote by id; missing or quote.userId != userId -> 404 QUOTE_NOT_FOUND
2. UnitOfWork.run:
   a. lock Voucher row (SELECT … FOR UPDATE)          -- first lock, always
   b. re-run step 0 lookup (a concurrent same-key request may have committed while we waited; a unique violation here would abort the PG transaction, so never rely on P2002 to converge)
   c. quote already has a SUCCEEDED redemption -> 409 QUOTE_ALREADY_REDEEMED
   d. read active Flash item for the voucher at now; if the quote's flashSaleItemId (or the freshly effective item) is used -> lock that FlashSaleItem row
   e. decideRedemption(...)                 -> VOUCHER_UNAVAILABLE | SOLD_OUT | PRICE_CHANGED
   f. eligibility again                     -> ACCOUNT_NOT_ELIGIBLE
   g. conditional stock decrement (regular) or Flash sold+1  (0 rows -> SOLD_OUT)
   h. claim code FOR UPDATE SKIP LOCKED (shared voucher: use voucher.sharedCode, no row)
        stock>0 but no free code -> rollback + drift alert + SOLD_OUT
   i. SpendPoints(amount = price.points, key 'redemption:{userId}:{K}', assertBeforeInsert = limits):
        ledger locks USER_AVAILABLE + SYSTEM_SINK by ascending id, THEN the callback counts
        per-voucher/30d, per-day points, Flash cap (BR-19, BR-20), THEN overdraft check, insert journal
   j. insert Redemption SUCCEEDED (reference, journalId, balanceAfter, priceVersion, pricePoints, priceSource, quoteId, voucherCodeId)
      set voucher_codes.redemption_id
   k. Flash after top-up (<24h, source FLASH) -> record FraudLog FLASH_AFTER_TOPUP (non-blocking)
   l. append Outbox event `REWARDS_VOUCHER_REDEEMED` (counts/ids only, never the code)
   m. commit
3. on RedemptionRejection / InsufficientBalance / limit failure: the UoW rolled back everything;
   open a NEW UnitOfWork: insert Redemption FAILED (no journal, failureCode, failureDetails), then return the error.
   On unique violation there (concurrent same-key attempt recorded first) -> re-read by (userId,K) and replay.
   Unexpected errors (5xx, deadlock, serialization) are NOT recorded as FAILED rows; the client retries with the same key.
```

Why the limits sit inside `assertBeforeInsert`: the daily limit is per user across vouchers, and the Voucher lock only serialises one voucher. The ledger already locks the user's account row before calling that hook, so two parallel redemptions by one user are serialised there. Do **not** lock `USER_AVAILABLE` yourself earlier in the recipe: AD-24 lock order is Voucher → FlashSaleItem → VoucherCode → ledger accounts by ascending id, and the user's account id may sort above `SYSTEM_SINK`'s, so a hand-rolled early lock invites a deadlock with every other ledger flow.

### Contracts and API surface (route literals are the FE mock contract — keep exact)

All in `packages/schemas/src/rewards/redemption.schema.ts` (already merged by 12.1; no changes expected, additive only if unavoidable).

| Route | Body / header | Success | Errors |
|---|---|---|---|
| `POST /rewards/quotes` | `createRedemptionQuoteSchema` `{ voucherId }` | 201 `redemptionQuoteSchema` | 400 `VALIDATION_ERROR`; 404 `VOUCHER_NOT_FOUND`; 409 `SOLD_OUT`, `VOUCHER_UNAVAILABLE`, `INSUFFICIENT_POINTS`; 403 `ACCOUNT_NOT_ELIGIBLE` |
| `POST /rewards/redemptions` | `redeemVoucherSchema` `{ quoteId }` + `Idempotency-Key` | 201 `redemptionResultSchema` (embeds `ticket`) | the five `REDEMPTION_ERROR_CODES` with `REDEMPTION_ERROR_HTTP_STATUS`; 404 `QUOTE_NOT_FOUND`; 409 `QUOTE_ALREADY_REDEEMED`, `IDEMPOTENCY_KEY_CONFLICT`; 400 `VALIDATION_ERROR` |
| `GET /rewards/redemptions/by-key/:key` | key parsed with `idempotencyKeySchema` | 201 stored result (mock uses 201 for replays; keep) | stored FAILED error replayed; 404 `REDEMPTION_NOT_FOUND` |

`redemptionErrorSchema` is a closed discriminated union of five codes; `QUOTE_NOT_FOUND`, `QUOTE_ALREADY_REDEEMED`, `IDEMPOTENCY_KEY_CONFLICT`, `REDEMPTION_NOT_FOUND` are **outside** it (the mock treats the first and third the same way). Record all four for Story 12.11 so the FE handles them.

Detail payloads the UI already parses: `SOLD_OUT {voucherId, regularStockRemaining}`, `PRICE_CHANGED {voucherId, price}` (full `voucherPriceSchema` with the **new** price and `priceVersion`), `INSUFFICIENT_POINTS {required, available}` with the schema refine `available < required`, `VOUCHER_UNAVAILABLE {voucherId, status ∈ PAUSED|HIDDEN|ARCHIVED|EXPIRED}`, `ACCOUNT_NOT_ELIGIBLE {reason}` (7 reasons in `accountNotEligibleReasonSchema`). Never put code values in any error.

### Business rules → where they land

| Rule | Behaviour in this story |
|---|---|
| BR-01 | Redeem succeeds only if Available ≥ price at commit; ledger no-overdraft is the authority, the quote's `balance` is advisory |
| BR-02 / BR-21 | Flash eligibility: recent survey (Flash `rules.requireRecentSurvey`), FraudLog block (`rules.blockFlagged`); checked at quote **and** again at commit |
| BR-03 | Exactly one balanced journal USER_AVAILABLE → SYSTEM_SINK for the integer price |
| BR-04 / BR-14 | Conditional decrement (`stock_remaining > 0` / `sold < quota`); one code per redemption, `redemption_id` unique |
| BR-07 / BR-09 | All-or-nothing; failed attempt recorded separately with no journal |
| BR-08 | Same key ⇒ same result; different quote under the same key ⇒ `IDEMPOTENCY_KEY_CONFLICT` |
| BR-10 | Hidden/archived vouchers cannot be quoted or redeemed (`VOUCHER_UNAVAILABLE` at redeem if it changed after the quote) |
| BR-11 | Price is resolved on the server at commit; `priceVersion`/source/points mismatch ⇒ `PRICE_CHANGED` with the new price |
| BR-19 | Flash per-user cap counted from SUCCEEDED redemptions for that `flashSaleItemId`; the unique `(flashItemId, userId)` index for cap = 1 is **12.9's** DB constraint (it owns the table writes) — 12.8 enforces by count under the locks and must still pass once 12.9 adds the index |
| BR-20 | 2 per voucher per rolling 30 days, 500 Points per Vietnam calendar day (planning defaults, OQ-23) |
| Effective price | Flash (active, `[start,end)`, not ended early, `sold < quota`) > promo > base at `Clock.now()`; reuse 12.7 `effectivePrice` |

### Existing code to reuse (do not reinvent)

| Need | Use |
|---|---|
| Executable spec of every rule and payload | `apps/frontend/my-app/mocks/data/rewards-rules.ts` (`decideRedemption`, `effectiveVoucherPrice`, `effectiveStatus`, `ticketStatus`), `mocks/data/rewards.ts` (`createVoucherQuote`, `redeemVoucherQuote`, `redemptionByKey`), `mocks/handlers/rewards.ts` |
| Contracts | `packages/schemas/src/rewards/redemption.schema.ts`; `idempotencyKeySchema`, `IDEMPOTENCY_KEY_HEADER` from `packages/schemas/src/forms/external-form.schema.ts` |
| 12.7 domain/services | `apps/backend/src/modules/rewards/domain/{voucher-price,voucher-availability,voucher.entity,stock}.ts`, `application/rewards-catalog.service.ts` (effective price/status at injected clock), `VOUCHER_REPOSITORY_PORT.lock(id)`, `FLASH_SALE_READ_PORT`, `WALLET_BALANCE_PORT` (read without creating accounts) |
| Ledger | `LedgerService.postJournal` (+ `PostJournalTransactionOptions.assertBeforeInsert`), `reserveEscrow` as the template for a user-spend command, `assertReplayCompatible`, `getOrCreateAccount(null,'SYSTEM_SINK')` |
| Ambient transaction | `common/database/prisma-unit-of-work.ts` (`runInTransaction`, `currentClient`, `afterCommit`), `UNIT_OF_WORK_PORT`, `PassThroughUnitOfWork` for tests |
| Outbox writes | `PrismaVoucherRepository.appendAudit` (same `outboxEvent.create` shape; idempotencyKey unique) |
| FraudLog writer | Participation `recordFraudLog` (Story 8.2, `dedupeKey`) |
| Controller + guard pattern | `rewards-catalog.controller.ts`, `admin-rewards-vouchers.controller.ts`, `top-up.controller.ts` (CSRF + JSON-only) |
| PG harness | `test/fixtures/financial-pg-harness.ts`, `test/rewards-catalog.prisma.e2e-spec.ts`, `test/moderation.prisma.e2e-spec.ts` |

### Architecture rules that bind this story

- AD-24 lock order is fixed: Voucher → FlashSaleItem → VoucherCode → ledger accounts. Existing flows lock only ledger accounts, so no cycle exists as long as Rewards never takes a ledger lock before a Voucher lock.
- AD-16: Rewards writes only its own tables. Journals via `SpendPointsPort`; FraudLog via the owning module's writer; user/activation/survey/top-up facts via read ports. No other module imports Rewards repositories.
- AD-10 / Outbox: the `REWARDS_VOUCHER_REDEEMED` event is written in the same transaction (`appendAudit`-style, `status: 'PENDING'`); a failed Outbox insert rolls the redemption back.
- `test/architecture.spec.ts`: `domain/` and `application/` must not match `@nestjs/`, `@prisma/client`, `express`, `bcrypt`, `google-auth-library`, or the word "adapter" (any case) in code **or comments**.
- Two route prefixes per controller, exactly `['rewards', 'api/rewards']`.
- Clock: inject `CLOCK`; no `new Date()` where status, price, expiry or limits are decided.
- Points are integers; no floats. `discountPercent` rounding is the only rounding (`voucherDiscountPercent` from `@rescom/schemas`).
- No logging, auditing or echoing of code values (bearer secrets) outside the redeem response body. Do not put them in Outbox payloads, error `details`, FraudLog `details` or exception messages.

### Gotchas checklist

1. **Lock order vs limits.** Count limits in `assertBeforeInsert`, not after a manual wallet lock (see Transaction recipe). Test with two parallel redemptions of different vouchers by the same user.
2. **PG aborts the whole transaction after a unique violation.** Look up idempotency before inserting and again after taking the Voucher lock; only the *failure-recording* transaction may catch P2002 and re-read (it runs after the main transaction ended).
3. **Append-only `redemptions`.** Never UPDATE; refunds later are new rows (12.10). `voucher_codes.redemption_id` is the only mutable pointer.
4. **`getOrCreateAccount` creates rows.** Inside the redeem UoW that is fine (it rolls back on failure), but the *quote* path must use `WalletBalancePort` (no account creation on a GET-like read).
5. **Shared-code vouchers** (`isSharedCode`, `Voucher.sharedCode`): there are no `VoucherCode` rows. Stock still decrements, `voucherCodeId` is NULL, the ticket `code` is `sharedCode`. A shared voucher with `sharedCode IS NULL` is SOLD_OUT-equivalent (12.7 behaviour) — reuse that predicate, do not reimplement.
6. **Flash/regular stock accounting (revised by review D2).** A Flash purchase touches `flash_sale_items.sold` **and** `vouchers.stock_remaining`; a regular purchase touches `vouchers.stock_remaining` only. `decideRedemption` therefore requires `stockRemaining > 0` for both. A sold-out Flash with regular stock left falls back to regular price ⇒ the quote's `flashSaleItemId` no longer matches ⇒ `PRICE_CHANGED`.
7. **Quote expiry equals `PRICE_CHANGED`** (mock `decideRedemption`: `now >= quote.expiresAt`). Return the *current* price in `details` so the UI can re-confirm without another round trip.
8. **Idempotent replay of a failure.** A FAILED row stores `failureCode` + `failureDetails`; replay must return the stored error, not recompute (state moved on). A client wanting a fresh attempt creates a new key (the FE already does per confirmation).
9. **Cross-module imports.** `rewards/application` may not import `LedgerService` or Prisma types; use the `*_PORT` pattern from 12.7 (`WALLET_BALANCE_PORT` lives in rewards ports, implemented in Economy).
10. **`ledger_accounts` for `SYSTEM_SINK`** is user-less (`canAccountClassOverdraft`); `getOrCreateAccount(null,'SYSTEM_SINK')` is the only legal way. First-ever use inside a transaction can race on creation; check how existing flows (`starter-points` void) handle it and copy.
11. **Time.** Day boundary for BR-20 is Asia/Ho_Chi_Minh; compute `[startOfLocalDayUtc, +24h)` from the injected clock and pass instants to SQL. Do not use `date_trunc` with the DB timezone.
12. **Ticket id.** Use `ticket.id = redemption.id` (one ticket per redemption; the mock's separate id is not needed). 12.10 must keep that mapping; mark-used state needs its own table because `redemptions` is append-only.
13. **Hot files.** `schema.prisma`, `app.module.ts`, `http-exception.filter.ts`, `rewards.module.ts`, `economy.module.ts`, `ledger.service.ts` change often; rebase on `origin/develop` before editing.
14. **Backend ships from `main`** and routes are un-flagged until 12.11 (12.7 open point #7). New write routes reaching production early is acceptable only because Rewards has no demo vouchers and the catalog is Admin-curated; do not seed vouchers in a migration.
15. `rtk`/hooks rewrite shell commands; quote globs (`--include='*.ts'`) in zsh.

### Testing standards

- Backend: jest (`npm test` builds `@rescom/schemas` first); co-located `*.spec.ts`; e2e in `apps/backend/test`. Money-path concurrency is proven on **real PostgreSQL** (AD-24 is about row locks), run it before marking the story for review.
- Parse real HTTP responses with the shared Zod schemas.
- No `test.skip` / `.only`, no placeholder tests. Each concurrency test uses `Promise.all` on two production service calls with separate sessions/users, then asserts durable state (stock, code assignment, journals, wallet), not just HTTP codes.

### Project Structure Notes

- New files under `apps/backend/src/modules/rewards/{domain,application,infrastructure,presentation}`; Economy gets `spendPoints` plus a provider; adapters for account standing live in their owning modules.
- Files expected to change: `prisma/schema.prisma`, new migration folders (two), `prisma/sql/post-push-invariants.sql`, `rewards.module.ts`, `economy.module.ts`, `ledger.service.ts` (+spec), `http-exception.filter.ts` (+spec), `rewards.constants.ts`, flash/voucher ports and repositories, `packages/schemas/src/admin/fraud-log.schema.ts` (+`admin-overview.schema.ts`), `test/migration-chain*.ts`, FE `tests/route-diff.test.mjs` + `contract-callsites.test.mjs` (whitelist only).

### Previous story intelligence (12.7, merged as a469259; 12.1–12.6 FE + MSW)

- 12.7 left PG e2e unexecuted locally and relied on review to find real defects (non-UUID correlation header → 500, duplicate audit key → P2002 → 500, `removeAvailable` ignoring the affected count, shared-flag bypass, a `BEST_DEAL` tie-break). Lessons to apply here: validate every header at the controller, make every idempotency/audit key unique per mutation, assert affected-row counts on conditional updates, and run the PG suite.
- Error shape lesson: mirror the mock (`fail(status, code, message, { details })`) so 12.11 flips routes with no UI change. 12.7 had to rework `BRAND_NOT_FOUND` for this reason.
- `RewardsException` + `RewardsErrorCode` live in `application/exceptions/rewards.exceptions.ts` and are mapped in `http-exception.filter.ts`; extend, do not fork.
- 12.7 deferred items that touch this story: user catalog loads all vouchers in memory (fine for pilot), `issued` can go negative when `flashReserved > issued`, Flash price vs promo display edge cases — all 12.9's; here just read the same fields consistently.
- Redemption/quote tables exist with the columns listed in the 12.7 data model; `reference` is `UNIQUE`; `(user_id, idempotency_key)` is `UNIQUE`; `RedemptionQuote` has indexes `(user_id, voucher_id)` and `(expires_at)`.

### Git intelligence

- `a469259` Merge PR #24 (12.7), `d4d817a` 12.7 implementation (schema, services, repositories, controllers, `LedgerService`-free wallet reader in Economy), `117a03a` PR #23 (12.6). Backend `schema.prisma`, `rewards.module.ts`, `economy.module.ts`, `http-exception.filter.ts` and `app.module.ts` were all touched by 12.7: expect small merge pressure only if another story lands first.
- Latest migration: `20261013120000_rewards_catalog_schema`. New migrations need later timestamps.

### Latest tech information

- No new runtime dependency. Prisma 6.0.0 (no partial unique / CHECK in `schema.prisma`: declare in SQL, mirror in `post-push-invariants.sql`), NestJS 10, Zod 3.24, Jest 29, PostgreSQL 15. Use parameterised `$queryRaw` / `$executeRaw` tagged templates for `FOR UPDATE`, `SKIP LOCKED` and conditional updates. `FOR UPDATE SKIP LOCKED` is supported in PG ≥ 9.5. `ALTER TYPE … ADD VALUE` inside a migration transaction is allowed on PG ≥ 12 but the value cannot be used in that transaction.

### Open points for the dev agent to confirm with Quan (do not block; solo owner)

1. **OQ-23 (Rewards economics) not answered in the PRD.** Planning defaults adopted: starter Points redeemable, 2 per voucher per 30 days, Flash cap 1 per user, tier does not affect eligibility. **Decided by Quan 2026-10-14: the daily Points limit is Admin-editable in the dashboard** (default 500, stored in `rewards_settings`, see Task 1.7/4.6); the other defaults stay constants. Quan to record the remaining OQ-23 confirmation before merging.
2. **OQ-26 (quote TTL):** 5 minutes, capped at Flash end (default). Constant, not configuration.
3. **Journal key — DECIDED (Quan, 2026-10-14; revised in code review):** the ledger key is `redemption:{userId}:{idempotencyKey}` (deliberate deviation from the AD-24 literal `redemption:{idempotencyKey}`: the redemption key is unique per user, the ledger key is global, so another user's key could otherwise collide). A ledger `IdempotencyConflictException` is mapped to 409 `IDEMPOTENCY_KEY_CONFLICT`.
4. **One successful redemption per quote — DECIDED (Quan, 2026-10-14):** keep the partial unique index on `quote_id` for SUCCEEDED and the non-enum code `QUOTE_ALREADY_REDEEMED` (record for Story 12.11).
5. **"Activated account" — DECIDED (Quan, 2026-10-14):** activated = a `starter-unlock:{userId}` journal exists. No other path (top-up, survey) activates. Consequence: a user whose starter Points were voided before unlock cannot redeem until activated; accepted.
6. **"Flagged in FraudLog" for Flash (BR-21) — DECIDED (Quan, 2026-10-14):** `FLASH_AFTER_TOPUP` rows never count as a blocking flag. Other types in the last 30 days block when `rules.blockFlagged` (window/types still planning defaults).
7. **Admin alert for stock > 0 but no free code.** Implemented as one hourly-deduped Outbox event `REWARDS_CODE_INVENTORY_DRIFT`. The Admin UI/notification for it does not exist yet; 12.11 or a follow-up must surface it. Confirm that an Outbox event satisfies "Admin alert" for now.
8. **Redemption `reference` format** `RDM-YYYY-XXXX` (random 4 chars, ≈1.7 M per year); collision handled by a pre-insert check plus client retry. If volume ever approaches thousands per day, switch to a sequence.
9. **Rate limit numbers** for the two POST routes (Task 6.4) are the dev's choice; record them.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 intro, Stories 12.1, 12.7, 12.8, 12.9, 12.10, 12.11]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-13.md` FR-69/71/73, BR-01–BR-24, Open Questions 23–26]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` AD-24, AD-16, AD-10, Cross-Context Financial Workflow Map (Redeem voucher), Rewards ownership row]
- [Source: `_bmad-output/implementation-artifacts/12-7-rewards-schema-catalog-code-inventory-api.md` (data model, domain/ports layout, review findings, deferred items)]
- [Source: `packages/schemas/src/rewards/redemption.schema.ts`, `voucher-catalog.schema.ts`; `packages/schemas/src/forms/external-form.schema.ts` (`idempotencyKeySchema`)]
- [Source: `apps/frontend/my-app/mocks/data/{rewards,rewards-rules}.ts`, `mocks/handlers/rewards.ts`, `lib/rewards/redeem-flow.ts` (eligibility copy per reason)]
- [Source: `apps/backend/src/modules/economy/application/ledger.service.ts` (`postJournal`, `reserveEscrow`, `assertReplayCompatible`), `infrastructure/prisma-ledger.repository.ts` (`postJournalTransaction`, ascending-id locks, `assertBeforeInsert`), `common/database/prisma-unit-of-work.ts`]
- [Source: `apps/backend/prisma/schema.prisma` models `Redemption`, `RedemptionQuote`, `VoucherCode`, `FlashSaleItem`, `FraudLog`, `SurveyAttempt`; `apps/backend/src/modules/rewards/**`]

## Dev Agent Record

### Agent Model Used

Gemini 2.5 Flash / Claude 3.7 Sonnet (BMAD Dev Agent)

### Debug Log References

- `apps/backend/test/rewards-redemption.prisma.e2e-spec.ts`
- `apps/backend/test/rewards-redemption.e2e-spec.ts`
- `apps/backend/test/migration-chain.prisma.e2e-spec.ts`
- `apps/frontend/my-app/tests/route-diff.test.mjs`

### Completion Notes List

- Implemented Task 1 (Additive Migrations & Invariants):
  - Created migration `20261014100000_fraud_log_flash_after_topup` adding `FLASH_AFTER_TOPUP` to `FraudLogType`.
  - Created migration `20261014110000_rewards_redemption_transaction` adding `balance_after`, `failure_details`, partial unique index `redemptions_quote_id_succeeded_key` on `redemptions(quote_id) WHERE status = 'SUCCEEDED'`, index `redemptions_user_id_created_at_idx`, CHECK constraints on `redemptions`, and table `rewards_settings` (seeded with default `daily_points_limit` = 500).
  - Updated `post-push-invariants.sql` and migration chain tests (`test/migration-chain.spec.ts` and `test/migration-chain.prisma.e2e-spec.ts`: 13/13 passed).
- Implemented Task 2 (Economy SpendPoints):
  - Implemented `LedgerService.spendPoints` with `assertBeforeInsert` support, ascending-id account lock ordering, user available debit, system sink credit.
  - Added `SpendPointsPort` (`SPEND_POINTS_PORT`) and wired provider in `economy.module.ts`. Unit tests passed in `ledger.service.spec.ts`.
- Implemented Task 3 (Domain & Ports):
  - Pure domain rules: `decideRedemption`, `checkRedemptionLimits` with Asia/Ho_Chi_Minh UTC+7 day boundaries, `generateRedemptionReference` (`RDM-YYYY-XXXX`), `toVoucherTicket`, `checkAccountEligibility`.
  - Added ports: `ACCOUNT_STANDING_PORT`, `FRAUD_FLAG_PORT`, `REDEMPTION_REPOSITORY_PORT`, `SPEND_POINTS_PORT`, updated `FLASH_SALE_READ_PORT` and `VOUCHER_REPOSITORY_PORT`.
  - Unit tests in `rewards-domain.spec.ts` passed.
- Implemented Task 4 (Application Services):
  - `RewardsQuoteService.createQuote`: Advisory eligibility/balance/limits check, persists quote with min(now+TTL, flashEndsAt).
  - `RewardsRedemptionService.redeem` & `findByKey`: Follows AD-24 transaction recipe with idempotency replay, stock decrement, `claimCode` with `FOR UPDATE SKIP LOCKED`, `spendPoints` under account locks with `assertBeforeInsert` limits verification, separate transaction failure recording, non-blocking `FLASH_AFTER_TOPUP` FraudLog entry, outbox event `REWARDS_CODE_INVENTORY_DRIFT` on code shortage.
  - `RewardsAdminCatalogService.getSettings` & `updateSettings`: Admin settings management for daily points limit with audit log.
  - Unit tests in `rewards-services.spec.ts` passed.
- Implemented Task 5 (Infrastructure):
  - `PrismaRedemptionRepository` and `InMemoryRedemptionRepository` with `claimCode` using `FOR UPDATE SKIP LOCKED` and `linkCodeToRedemption`.
  - `PrismaFlashSaleReadRepository`, `PrismaAccountStandingReader`, `PrismaFraudFlagWriter`, `PrismaVoucherRepository.decrementRegularStock`.
  - Unit tests in `rewards.repositories.spec.ts` passed.
- Implemented Task 6 (Presentation & Wiring):
  - `RewardsRedemptionController` on `['rewards', 'api/rewards']` with `SessionAuthGuard`, `CsrfGuard`, `JsonOnlyGuard`, `Idempotency-Key` validation, and per-user throttling (Quote: 60/min, Redeem: 20/min).
  - `AdminRewardsVouchersController` settings endpoints.
  - Exception mapping in `HttpExceptionFilter`.
  - `test/architecture.spec.ts` clean (0 violations).
- Implemented Task 7 & 8 (Testing & Verification):
  - In-memory E2E: `test/rewards-redemption.e2e-spec.ts` (3 tests passed).
  - PostgreSQL concurrency proofs: `test/rewards-redemption.prisma.e2e-spec.ts` (7 concurrency test cases passed: racing users for last unit, parallel double submit, balance changed between quote and confirm, price changed / flash ended, stock > 0 but no free code drift alert & rollback, ledger entries sum = 0, parallel wallet lock daily limits).
  - Backend tests: 156 suites, 2343 tests passed.
  - Schemas tests: 46 suites, 634 tests passed.
  - Frontend contract tests: 886 tests passed (`node --test tests/*.test.mjs`).
  - Lint and typecheck clean across all packages.
- Review patch round (all `[Review][Patch]` items applied):
  - Ledger key `redemption:{userId}:{K}`; Flash purchase also decrements `vouchers.stock_remaining` (D2); Flash rules/cap/`flashSaleItemId`/`flashEndsAt` only when the quoted/confirmed price source is FLASH; `decideRedemption` compares the Flash item only for a FLASH price.
  - Account facts moved to owning modules behind Rewards ports: `PrismaAccountStatusReader` (Users), `PrismaSurveyCompletionReader` + `ParticipationFraudFlagStore` (Participation, reuses `recordFraudLog`), `PrismaAccountFundingReader` (Economy); `RewardsModule` composes `ACCOUNT_STANDING_PORT` from them. Old `rewards/infrastructure/prisma-account-standing.reader.ts` and `prisma-fraud-flag.writer.ts` deleted.
  - Failure recording: FAILED row and drift alert are separate transactions; only unique violations are tolerated (reference collision retried, same-key winner replayed); replayed FAILED never re-recorded (`ReplayedRedemptionRejectionException`); replay never invents a code and a REFUNDED row answers `IDEMPOTENCY_KEY_CONFLICT`.
  - Reference uses `crypto.randomInt` with up to 3 transaction retries on a `reference` collision; same-key/different-quote P2002 converges (replay or `IDEMPOTENCY_KEY_CONFLICT`); `now` is read after the Voucher lock; Outbox correlation id is the redemption id (drift: quote id); admin settings correlation id validated as UUID, `redemptions` dependency now required.
  - `GET /rewards/redemptions/by-key/:key` answers 201; `@Throttle` per user on quotes (60/min) and redemptions (20/min). `findActiveItemForVoucher` is one indexed query ordered by sale start desc, id asc.
  - Migration: SUCCEEDED redemption needs a code unless the voucher is shared (BEFORE INSERT trigger, mirrored in `post-push-invariants.sql`); the two redemption CHECKs are `NOT VALID`. `FLASH_AFTER_TOPUP` labels added to the FE admin label maps and the FE-local `fraudLogTypeSchema`; `GET/PUT /admin/rewards/settings` whitelisted in `route-diff.test.mjs`.
  - Verification: `npm test` (backend) 156 suites / 2370 tests passed; in-memory e2e `rewards-redemption` 6/6; PostgreSQL e2e (`FINANCIAL_TEST_DATABASE_URL=postgresql://rescom_admin:***@localhost:5432/rescom_redemption_fix_test`, `npx jest --config test/jest-e2e.json --runInBand test/rewards-redemption.prisma.e2e-spec.ts test/rewards-catalog.prisma.e2e-spec.ts test/migration-chain.prisma.e2e-spec.ts`) 36/36 passed (redemption suite 17/17, run 4 times); FE `node --test tests/*.test.mjs` 886 pass; lint, `tsc --noEmit`, `format:check` clean. The 12.7 catalog PG fixture now inserts a FAILED row instead of a SUCCEEDED one (SUCCEEDED needs the 12.8 invariants).

### File List

- `_bmad-output/implementation-artifacts/12-8-quote-redemption-transaction.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/backend/prisma/migrations/20261014100000_fraud_log_flash_after_topup/migration.sql`
- `apps/backend/prisma/migrations/20261014110000_rewards_redemption_transaction/migration.sql`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/sql/post-push-invariants.sql`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/common/http/zod-validation.pipe.ts`
- `apps/backend/src/modules/admin/application/admin-published-surveys.service.spec.ts`
- `apps/backend/src/modules/admin/application/admin-published-surveys.service.ts`
- `apps/backend/src/modules/admin/application/exceptions/audit-log.exceptions.ts`
- `apps/backend/src/modules/economy/application/ledger.service.spec.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts`
- `apps/backend/src/modules/economy/economy.module.ts`
- `apps/backend/src/modules/forms/application/forms.service.ts`
- `apps/backend/src/modules/forms/presentation/form-preview-parser.spec.ts`
- `apps/backend/src/modules/marketplace/application/marketplace.service.spec.ts`
- `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts`
- `apps/backend/src/modules/rewards/application/exceptions/rewards.exceptions.ts`
- `apps/backend/src/modules/rewards/application/ports/account-standing.port.ts`
- `apps/backend/src/modules/rewards/application/ports/flash-sale-read.port.ts`
- `apps/backend/src/modules/rewards/application/ports/fraud-flag.port.ts`
- `apps/backend/src/modules/rewards/application/ports/redemption-repository.port.ts`
- `apps/backend/src/modules/rewards/application/ports/rewards.constants.ts`
- `apps/backend/src/modules/rewards/application/ports/spend-points.port.ts`
- `apps/backend/src/modules/rewards/application/ports/voucher-repository.port.ts`
- `apps/backend/src/modules/rewards/application/rewards-admin-catalog.service.ts`
- `apps/backend/src/modules/rewards/application/rewards-quote.service.ts`
- `apps/backend/src/modules/rewards/application/rewards-redemption.service.ts`
- `apps/backend/src/modules/rewards/application/rewards-services.spec.ts`
- `apps/backend/src/modules/rewards/domain/redemption-decision.ts`
- `apps/backend/src/modules/rewards/domain/redemption-eligibility.ts`
- `apps/backend/src/modules/rewards/domain/redemption-limits.ts`
- `apps/backend/src/modules/rewards/domain/redemption-reference.ts`
- `apps/backend/src/modules/rewards/domain/rewards-domain.spec.ts`
- `apps/backend/src/modules/rewards/domain/voucher-ticket.ts`
- `apps/backend/src/modules/rewards/infrastructure/in-memory-flash-sale-read.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/in-memory-redemption.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/in-memory-voucher.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-flash-sale-read.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-redemption.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-voucher.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/rewards.repositories.spec.ts`
- `apps/backend/src/modules/rewards/presentation/admin-rewards-vouchers.controller.ts`
- `apps/backend/src/modules/rewards/presentation/rewards-redemption.controller.ts`
- `apps/backend/src/modules/rewards/rewards.module.ts`
- `apps/backend/test/migration-chain.prisma.e2e-spec.ts`
- `apps/backend/test/rewards-redemption.e2e-spec.ts`
- `apps/backend/test/rewards-redemption.prisma.e2e-spec.ts`
- `apps/frontend/my-app/lib/admin/disputes-view.ts`
- `apps/frontend/my-app/tests/route-diff.test.mjs`
- `packages/schemas/src/admin/fraud-log.schema.ts`
- `packages/schemas/src/rewards/index.ts`
- `packages/schemas/src/rewards/redemption.schema.ts`
- `packages/schemas/src/rewards/rewards-settings.schema.ts`
- `apps/backend/src/modules/rewards/application/unique-violation.ts`
- `apps/backend/src/modules/users/infrastructure/prisma-account-status.reader.ts`
- `apps/backend/src/modules/users/users.module.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-account-funding.reader.ts`
- `apps/backend/src/modules/participation/infrastructure/participation-fraud-flag.store.ts`
- `apps/backend/src/modules/participation/infrastructure/prisma-survey-completion.reader.ts`
- `apps/backend/src/modules/participation/participation.module.ts`
- `apps/backend/src/common/http/http-exception.filter.rewards.spec.ts`
- `apps/backend/test/rewards-catalog.prisma.e2e-spec.ts`
- `packages/schemas/src/admin/admin-overview.schema.ts`
- `apps/frontend/my-app/lib/admin/{overview-view,fraud-log-view,disputes-service}.ts` (FLASH_AFTER_TOPUP labels/enum only)
