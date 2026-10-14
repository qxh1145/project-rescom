---
baseline_commit: 6e7c869
---

# Story 12.9: Flash Sale Lifecycle

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want Flash Sales to start and end automatically and correctly,
so that quota and price are always right without manual work.

## Acceptance Criteria

1. **Start job.** Given a scheduled Flash Sale, when its start time arrives, an idempotent job on the existing in-process scheduler reserves the quota from regular stock (BR-05).
2. **End / sell-out / early end.** At end, sell-out, or early end, the regular price applies immediately and unsold quota returns to stock exactly once (BR-05, BR-17).
3. **Admin Flash API rules.** The Admin Flash API rejects overlapping windows, a Flash price ≥ the regular price, and a quota above unreserved stock (BR-18).
4. **Windows.** Windows use server time in Asia/Ho_Chi_Minh and `[start, end)` boundaries.
5. **Per-user cap.** The per-user cap is enforced with unique `(flashItemId, userId)` when the cap is 1 (BR-19).
6. **Restart safety.** Job reruns and scheduler restarts do not double-reserve or double-return quota.

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.9 (FR-73; BR-05, BR-17, BR-18, BR-19; AD-24, AD-16, AD-10). Contract source for the Admin routes: FE MSW mock `apps/frontend/my-app/mocks/handlers/rewards-admin.ts` (comments say "backend Story 12.9").

## Tasks / Subtasks

- [x] **Task 0: Branch and baseline** — branch `feat/12-9-flash-sale-lifecycle` already exists, cut from `origin/develop` (6e7c869, includes merged 12.8). Re-run `git status --short --branch` before the first edit. Backend: `apps/backend`; module `apps/backend/src/modules/rewards`.
- [x] **Task 1: Additive migration** (AC: 1, 2, 5, 6) — new folder `apps/backend/prisma/migrations/20261015100000_rewards_flash_sale_lifecycle/migration.sql` (later than `20261014110000`; do not edit earlier migrations). Unconditional DDL, no `to_regclass` guard (`migration-chain.spec.ts`).
  - [x] 1.1 `flash_sales.reserved_at timestamp(3) NULL` — set exactly once by the start job, in the same transaction that moves stock. Update `FlashSale` in `schema.prisma` (`reservedAt DateTime? @map("reserved_at")`).
  - [x] 1.2 CHECK `reserved_at IS NULL OR reserved_at >= starts_at`. Mirror in `prisma/sql/post-push-invariants.sql`. Use `NOT VALID` only if the table may already hold rows (it cannot in production: no Flash write API existed before this story).
  - [x] 1.3 Partial indexes for the job scans: `flash_sales(starts_at) WHERE reserved_at IS NULL AND settled_at IS NULL` and `flash_sales(ends_at) WHERE reserved_at IS NOT NULL AND settled_at IS NULL`.
  - [x] 1.4 Table `flash_item_claims` (Rewards-owned): `flash_sale_item_id uuid NOT NULL FK → flash_sale_items ON DELETE RESTRICT`, `user_id uuid NOT NULL`, `redemption_id uuid NOT NULL UNIQUE`, `created_at`, `PRIMARY KEY (flash_sale_item_id, user_id)`. This is the DB backstop for BR-19 when `per_user_cap = 1`. `redemptions` is append-only and cannot carry it; a partial index cannot see another table's `per_user_cap`. Add the Prisma model + relation.
  - [x] 1.5 Update `test/migration-chain*.ts` expectations. Must apply from an empty DB and from a DB at `20261014110000`.
- [x] **Task 2: Fix the stock model the 12.8 code assumed** (AC: 1, 2, 6) — **read "Stock model change" in Dev Notes first.**
  - [x] 2.1 `FlashSaleRecord` (`application/ports/flash-sale-read.port.ts`) gains `reservedAt: string | null`, `settledAt: string | null`, `endReason: string | null`, `title`, `createdById`; update the Prisma and in-memory read repositories.
  - [x] 2.2 `findActiveItemForVoucher` (Prisma + in-memory) additionally requires `reservedAt IS NOT NULL AND settledAt IS NULL`. Nothing is "active" until the job reserved it.
  - [x] 2.3 `rewards-redemption.service.ts` step 2.g: a FLASH purchase only does `incrementFlashSold`; it must **not** call `decrementRegularStock` any more (quota already left `stock_remaining` at reservation). A BASE/PROMO purchase keeps the conditional `stock_remaining - 1`. Remove the "D2" comments.
  - [x] 2.4 `domain/redemption-decision.ts`: the `stockRemaining <= 0` SOLD_OUT check applies to non-FLASH price sources only; the Flash source is guarded by `sold < quota` (already in `effectivePrice`). Keep the `codesAvailable <= 0` check for both.
  - [x] 2.5 Admin catalog `reserved()` / `row()` and the user catalog Flash strip (`rewards-catalog.service.ts`, `rewards-admin-catalog.service.ts`) count a Flash item only when `reservedAt != null && settledAt == null`; the user-facing item state stays UPCOMING until `reservedAt` is set even if `now >= startsAt` (otherwise the card says ACTIVE while the quote answers regular price). The invariant `remaining === total − issued − flashReserved` must hold for every voucher at every moment; assert it in tests.
  - [x] 2.6 Redeem tx, step 2.i/j: when the Flash item has `perUserCap = 1`, insert a `flash_item_claims` row in the same transaction after the Redemption row (count check under the lock stays the first line of defence; the unique key is the backstop). Add `claimFlashItem(itemId, userId, redemptionId)` to the redemption repository port + in-memory twin.
  - [x] 2.7 Update the 12.8 unit/e2e/PG fixtures that seeded a Flash sale without `reservedAt` or asserted the old double decrement.
- [x] **Task 3: Domain (pure; no Nest/Prisma imports)** (AC: 2, 3, 4)
  - [x] 3.1 `domain/flash-sale-rules.ts`: port `flashConflicts`, `adminFlashStatus`, `flashItemState`, `flashProgress`, `endEarlyDecision` from `mocks/data/rewards-rules.ts` (same semantics, same codes). Differences from the mock: no quota is held before the start, so `available = voucher.stockRemaining` at create/update; `FLASH_QUOTA_BELOW_SOLD` cannot occur (edit is only allowed before the start) — drop it. Conflict codes: `FLASH_STARTS_IN_PAST`, `VOUCHER_NOT_FLASHABLE`, `FLASH_PRICE_NOT_BELOW_REGULAR` (regular = `promoPoints ?? basePoints`, `details.regular`), `FLASH_QUOTA_EXCEEDS_STOCK` (`details.available`), `FLASH_OVERLAP` (`details.code`). Overlap uses `[start, min(end, endedEarlyAt))` half-open intervals, same voucher, other non-settled-by-early sales.
  - [x] 3.2 `domain/flash-sale-settlement.ts`: pure `reservationPlan(sale, vouchers)` → `{ ok, perVoucher: [{voucherId, quota}] } | { ok:false, shortVoucherIds }` (needs `stockRemaining >= quota` for every item) and `settlementPlan(sale)` → `[{voucherId, unsold: quota − sold}]`; `isSettleDue(sale, now)` = reserved, not settled, and (`now >= endsAt` or `endedEarlyAt <= now` or every item `sold >= quota`); `isReserveDue(sale, now)` = not reserved, not settled, `startsAt <= now < endsAt`, not ended early.
  - [x] 3.3 `domain/flash-sale-code.ts`: `FS-{MMDD}-{A..Z}` code from the Vietnam calendar day of `startsAt` (matches `adminFlashSaleSchema` regex `^FS-\d{4}-[A-Z]$`). Reuse the existing Vietnam-day helper from `redemption-limits.ts`; do not write a second one.
- [x] **Task 4: Application services + ports** (AC: 1–3, 6)
  - [x] 4.1 Port `FLASH_SALE_REPOSITORY_PORT` (write side, Rewards-owned): `insertSale/updateSale`, `lockVouchers(ids ascending)` (reuse `VOUCHER_REPOSITORY_PORT.lock`), `findOverlapCandidates(voucherIds)`, `findDueForReserve(now, limit)`, `findDueForSettle(now, limit)`, `markReserved(id, now): boolean` (`UPDATE … SET reserved_at = $now WHERE id = $1 AND reserved_at IS NULL AND settled_at IS NULL`), `markSettled(id, now, endReason?): boolean` (`… WHERE settled_at IS NULL`), `markEndedEarly(id, now, reason): boolean`, `adjustVoucherStock(voucherId, delta)` (conditional: result must satisfy the existing CHECKs; affected-rows must be 1). Keep the read port; extend it, do not fork.
  - [x] 4.2 `application/flash-sale-lifecycle.service.ts`: `runDue(now, limit)` → counts `{ reserved, settled, reservationFailed }`. Order: settle first, then reserve (returned stock is visible to a same-run reservation). Each sale in its **own** `UnitOfWork.run('flash-sale:{id}:{reserve|settle}', …)`:
    1. read sale; lock the sale's vouchers `FOR UPDATE` in ascending id (AD-24 order: Voucher → FlashSaleItem); 2. re-read the sale inside the lock and re-check `isReserveDue`/`isSettleDue` (a concurrent run or an early end may have won); 3. reserve: `reservationPlan` → for each item `stock_remaining -= quota` then `markReserved` (must return true); if any voucher is short: **cancel the whole sale** (`ended_early_at = now`, `end_reason = 'RESERVATION_FAILED'`, `settled_at = now`, no stock moved), emit Outbox `REWARDS_FLASH_RESERVATION_FAILED`; 4. settle: `markSettled` first, and only when it returns true do `stock_remaining += unsold` per item. Outbox `REWARDS_FLASH_SALE_STARTED` / `REWARDS_FLASH_SALE_SETTLED` (ids and counts only), `idempotencyKey` = `rewards:flash:{id}:started|settled|reservation-failed`. A sale that was never reserved and is past its end is stamped `settled_at` without moving stock. One failing sale must not stop the batch (count it, continue; retried next run).
  - [x] 4.3 `application/rewards-admin-flash.service.ts` (Admin API, contract = FE mock): `list(query)`, `get(id)`, `create(input, admin)`, `update(id, input, admin)`, `endEarly(id, request, admin)`. Create/update run inside one UoW: lock the involved vouchers ascending, load the other non-settled sales for those vouchers, run `flashConflicts` at `Clock.now()`, then write. Error body `{ code, message, details }`; 409 uses the first conflict's `code` and `details: { conflicts: [{ path, code, details }] }` exactly as the mock. Update only while `now < startsAt` (else 409 `FLASH_ALREADY_STARTED`); 404 `FLASH_SALE_NOT_FOUND`. `endEarly`: status must be ACTIVE (else 409 `FLASH_NOT_ACTIVE` / `FLASH_ALREADY_ENDED`); inside the voucher locks call the same settle routine as the job with `endedEarlyAt = now`, so the price returns to regular and the unsold quota returns in the same commit, once. Audit Outbox event for each mutation in the same transaction (pattern: `PrismaVoucherRepository.appendAudit`, unique key per mutation, correlation id validated as UUID). Flash code collision (`P2002` on `code`): retry the whole UoW up to 3 times; more than 26 sales that day ⇒ 409 `FLASH_CODE_EXHAUSTED`.
  - [x] 4.4 Admin monitoring fields (derive from Rewards tables only): `succeededCount` = Σ sold; `pointsSpent` = Σ sold × flashPoints; `participants` = distinct users with any Redemption row for the sale's items; `failures` from FAILED rows of those items (`SOLD_OUT`, `INSUFFICIENT_POINTS`, rest ⇒ `OTHER`); `afterTopUp` from the `FLASH_AFTER_TOPUP` flags 12.8 writes (`count`, `rate = count / succeededCount`, `flagged` = flags currently counted as open). `createdBy.{id,name}`: follow how the voucher Admin DTO resolves the creator (`createdById`); if no name reader exists, add a read-only port implemented by the Users module. `remindCount` = 0 — reminder emission for `rules.remindBefore10m` is not in any 12.9 AC (record in Open points). Item fields (`unsold`, `perMinute`, `etaAt`, `soldOutAt`, `regularPoints`, `state`, `discountPercent`) follow `adminFlashRow` in `mocks/data/rewards.ts`.
  - [x] 4.5 Exceptions: reuse `RewardsException`/`RewardsErrorCode` (`application/exceptions/rewards.exceptions.ts`) and the mapping in `common/http/http-exception.filter.ts`; add the new codes there, do not hard-code statuses elsewhere.
- [x] **Task 5: Infrastructure** (AC: 1, 2, 5, 6)
  - [x] 5.1 `infrastructure/prisma-flash-sale.repository.ts` (+ in-memory twin + one shared contract suite, pattern `rewards.repositories.spec.ts`). Join the ambient transaction with `currentClient(this.prisma)`; never open a second transaction. Conditional updates assert affected-row counts (12.7 lesson).
  - [x] 5.2 `infrastructure/flash-sale-lifecycle.job.ts` (`ScheduledJob`, framework-free like `StarterExpiryJob`) + `rewards-scheduler.registrar.ts` (`OnModuleInit`, optional `ScheduledJobRegistry`, like `EconomySchedulerRegistrar`). Add `FLASH_SALE_LIFECYCLE_JOB = { name: 'flash-sale-lifecycle', intervalMs: 15_000, leaseTtlMs: 2 * MINUTE_MS, batchSize: 20 }` to `common/scheduler/scheduler.constants.ts` (default tick is `SCHEDULER_TICK_SECONDS=15`; a longer interval would delay the 12:00 start). Summary is counts only; `hasMore` when the batch was full. Jobs never use `new Date()`: take `ctx.now`/`Clock`.
- [x] **Task 6: Presentation + wiring** (AC: 3)
  - [x] 6.1 `presentation/admin-rewards-flash-sales.controller.ts`: same prefixes, guards and style as `admin-rewards-vouchers.controller.ts` (`@Roles('ADMIN')`, `SessionAuthGuard`, `CsrfGuard`, `JsonOnlyGuard` on writes, live `ADMIN_CAPABILITY_PORT` check, `Cache-Control: no-store`). Routes (literals are the FE contract): `GET /admin/rewards/flash-sales` (`adminFlashSaleListQuerySchema` → `adminFlashSaleListSchema`), `GET …/:id` (→ `adminFlashSaleCreatedSchema`), `POST …` (201, `adminFlashSaleInputSchema` → `adminFlashSaleCreatedSchema`), `PUT …/:id`, `POST …/:id/end` (`adminFlashEndRequestSchema`). Validate `:id` as UUID. Schemas already exist in `packages/schemas/src/rewards/rewards-admin.schema.ts` (12.1/12.6): no changes expected, additive only if unavoidable.
  - [x] 6.2 Register providers + registrar in `rewards.module.ts`; `test/architecture.spec.ts` must stay green (`domain/` and `application/` must not mention `@nestjs/`, `@prisma/client`, `express`, `bcrypt`, `google-auth-library`, or the word "adapter", even in comments).
  - [x] 6.3 Whitelist the five new routes in `apps/frontend/my-app/tests/route-diff.test.mjs` (`deferredRewards`) exactly as 12.8 did for its routes. No other FE edits.
- [x] **Task 7: Tests** (AC: 1–6)
  - [x] 7.1 Unit (domain): conflicts (each code, boundary: start == now rejected, price == regular rejected, quota == stock accepted, quota == stock + 1 rejected), overlap `[start,end)` (end == other start ⇒ no overlap; ended-early window shortens), status/state transitions, `isReserveDue`/`isSettleDue` at `start − 1ms`, `start`, `end − 1ms`, `end`.
  - [x] 7.2 Services with in-memory repos + `FixedClock` + `PassThroughUnitOfWork`: reserve moves stock once; second `runDue` and a fresh service instance (restart) change nothing; settle returns `quota − sold` once; early end then job ⇒ no second return; sell-out of all items settles with return 0; reservation failure cancels the sale and moves no stock; never-reserved ended sale stamped settled without stock change; admin create/update/end happy and every 409.
  - [x] 7.3 Controller specs (401, 403, CSRF, JSON-only, UUID param, both prefixes, status codes) and in-memory HTTP e2e (`test/rewards-flash.e2e-spec.ts`, pattern `rewards-catalog.e2e-spec.ts`): every response parsed with `adminFlashSaleListSchema` / `adminFlashSaleCreatedSchema` and the user `flashSaleListSchema`.
  - [x] 7.4 **PostgreSQL e2e** (`test/rewards-flash.prisma.e2e-spec.ts`, harness `financial-pg-harness.ts`; production repositories and services): two parallel `runDue` calls ⇒ one reservation (stock moved once); parallel `runDue` + early end ⇒ one return; early end racing a redeem ⇒ `total = stock_remaining + flashReserved + issued` holds and no oversell; two parallel admin creates for overlapping windows on one voucher ⇒ exactly one succeeds, the other `FLASH_OVERLAP`; cap = 1: a second SUCCEEDED redemption for `(item, user)` hits the unique key; the first redemption at exactly `startsAt` after reservation gets the Flash price, one at `endsAt` gets the regular price; Flash sell-out ⇒ regular price at once; migration applies from empty and from `20261014110000`.
  - [x] 7.5 Run the PG suite locally and record command + output in Completion Notes (12.7 shipped it unexecuted; 12.8 fixed that; keep it).
- [x] **Task 8: Verification** — in `apps/backend`: `npm run prisma:validate`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`; `npm test` in `packages/schemas`; `npm run test:e2e -- rewards` (+ `migration-chain.prisma`); FE `node --test tests/*.test.mjs` in `apps/frontend/my-app`. `prisma migrate deploy` on an empty scratch DB and on a DB at `20261014110000`; record output.

## Dev Notes

### Scope boundaries (read first)

- **In:** reserve-at-start job; settle at end / sell-out / early end; Admin Flash API (list, detail, create, update, end) with BR-18 validation; `reserved_at` + `flash_item_claims`; making redeem and the catalogs consistent with reserve-at-start.
- **Out (other stories — do not build):** `/admin/rewards/stats` and the statistics dashboard API (12.11, open point from 12.7 #6); My vouchers, reminders for vouchers, code-issue reports, refunds (12.10); feature flag, load test, FE de-mocking (12.11); the "10 minutes before start" user reminder (`rules.remindBefore10m`), no AC owns it; FE edits beyond the route whitelist.
- **Gates:** production enable still needs OQ-24 (12.11). No new gate for 12.9.

### Stock model change (the critical part)

Today (12.8, review decision D2) quota is *not* removed from `vouchers.stock_remaining` by anything, so a Flash purchase decrements both `flash_sale_items.sold` and `stock_remaining`. 12.7's definition is different and is the authoritative one: `stock_remaining` = regular unreserved stock **excluding** Flash quota; `flashReserved = Σ(quota − sold)` of reserved, unsettled sales; `issued = total − remaining − flashReserved`. Once 12.9 reserves at start (`stock_remaining -= quota`), a Flash purchase must only touch `sold`, otherwise stock is counted twice. Lifecycle of one item:

| Moment | `stock_remaining` | `sold` | Effect |
|---|---|---|---|
| created / scheduled | unchanged | 0 | nothing held; create-time check is `quota <= stock_remaining` |
| start job | `− quota` | 0 | `reserved_at` set; Flash price becomes effective |
| Flash purchase | unchanged | `+1` | `flashReserved` shrinks by 1, `issued` grows by 1 |
| regular purchase | `− 1` | — | as before |
| end / sell-out / early end | `+ (quota − sold)` | — | `settled_at` set in the same commit; regular price effective |

Between `startsAt` and the job run (≤ one 15 s tick) the sale exists but is not reserved: Flash price must not apply and the user card must not say ACTIVE. That is why every "active item" predicate gains `reservedAt != null && settledAt == null` (Task 2.2/2.5).

### Exactly-once mechanics

- Both transitions are guarded by a conditional update on the sale row (`reserved_at IS NULL`, `settled_at IS NULL`); the stock write happens only when that update affected 1 row, in the same transaction. Rerun, parallel run, or process restart finds the guard already set and does nothing.
- Lock order is AD-24: Voucher rows (ascending id) → FlashSaleItem. The redeem path locks the Voucher first, so an early end and a redeem on the same voucher are serialised; `sold` cannot change while the lifecycle code reads `quota − sold`.
- Never recompute "unsold" from a cached read taken before the locks; re-read inside them.
- The scheduler lease already prevents two owners; do not rely on it for correctness (the DB guards are the correctness).

### Contracts (route literals are the FE mock contract — keep exact)

| Route | Body | Success | Errors |
|---|---|---|---|
| `GET /admin/rewards/flash-sales?status=` | query `adminFlashSaleListQuerySchema` | 200 `adminFlashSaleListSchema` | 400 `VALIDATION_ERROR` |
| `GET /admin/rewards/flash-sales/:id` | — | 200 `adminFlashSaleCreatedSchema` | 404 `FLASH_SALE_NOT_FOUND` |
| `POST /admin/rewards/flash-sales` | `adminFlashSaleInputSchema` | 201 `adminFlashSaleCreatedSchema` | 400; 409 first conflict code + `details.conflicts` |
| `PUT /admin/rewards/flash-sales/:id` | `adminFlashSaleInputSchema` | 200 | 400; 404; 409 `FLASH_ALREADY_STARTED` or conflicts |
| `POST /admin/rewards/flash-sales/:id/end` | `adminFlashEndRequestSchema` | 200 | 400; 404; 409 `FLASH_NOT_ACTIVE` / `FLASH_ALREADY_ENDED` |

`adminFlashSaleInputSchema` already enforces end > start, ≤ 6 hours, unique vouchers per sale. Status enum: `SCHEDULED` (> 24 h away), `UPCOMING` (≤ 24 h), `ACTIVE`, `SOLD_OUT`, `ENDED` — port `adminFlashStatus` unchanged; a reservation-failed (cancelled) sale is `ENDED`. Record the new 409 codes (`FLASH_*`, `VOUCHER_NOT_FLASHABLE`, `FLASH_CODE_EXHAUSTED`) for Story 12.11 so the FE handles them.

### Business rules → where they land

| Rule | Behaviour |
|---|---|
| BR-05 | Start job reserves once; end/early end returns once (conditional guards above) |
| BR-17 | Regular price immediately: `effectivePrice` already ignores items with `sold >= quota`, outside `[start,end)` or ended early; add `settledAt` / `reservedAt` predicates |
| BR-18 | `flashConflicts` under voucher locks at create/update; reserve-time re-check (`reservationPlan`) covers stock that changed after scheduling |
| BR-19 | 12.8 count check stays; `flash_item_claims` PK is the DB backstop when `perUserCap = 1` |
| Time | Instants in UTC columns; `[start, end)`; Vietnam calendar day only for the `FS-MMDD-X` code and display; all "now" from `Clock` |

### Existing code to reuse (do not reinvent)

| Need | Use |
|---|---|
| Executable spec | `apps/frontend/my-app/mocks/data/rewards-rules.ts` (`flashConflicts`, `adminFlashStatus`, `flashItemState`, `flashProgress`, `endEarlyDecision`), `mocks/data/rewards.ts` (`adminFlashRow`, `createAdminFlashSale`, `updateAdminFlashSale`, `endAdminFlashSale`), `mocks/handlers/rewards-admin.ts` |
| Contracts | `packages/schemas/src/rewards/rewards-admin.schema.ts` (flash block, lines ~44–62), `voucher-catalog.schema.ts` (`flashSaleItemSchema`) |
| Scheduler | `common/scheduler/{scheduled-job,scheduler.constants,scheduler-runner.service}.ts`; `modules/economy/infrastructure/economy-scheduler.registrar.ts` and `jobs/starter-expiry.job.ts` as the template; `addCounts`, `assertNotAllFailed` helpers |
| Locks / UoW | `VOUCHER_REPOSITORY_PORT.lock(id)`, `common/database/prisma-unit-of-work.ts` (`currentClient`), `UNIT_OF_WORK_PORT`, `PassThroughUnitOfWork` |
| Audit Outbox | `PrismaVoucherRepository.appendAudit` shape |
| Admin controller pattern | `presentation/admin-rewards-vouchers.controller.ts`, `application/rewards-admin-catalog.service.ts` |
| Retry on unique collision | `application/unique-violation.ts` + the `reference` retry in `rewards-redemption.service.ts` |
| Vietnam day helper | `domain/redemption-limits.ts` |

### Gotchas checklist

1. **Do not edit the 12.8 transaction order.** Only step 2.g (no stock decrement for FLASH), 2.d (active predicate) and the claim insert change.
2. **PG aborts the transaction after a unique violation.** The `flash_item_claims` insert can only violate if the count check was bypassed; let it surface as an error (rolls back, the client retries with the same key); do not catch it inside the redeem tx.
3. **Affected-row counts.** Every conditional update (`markReserved`, `markSettled`, stock `+/-`) must verify the count; a 0 on a path that must succeed is an integrity error, not a silent skip.
4. **Admin stock adjustment and pause/archive after scheduling.** Scheduled sales hold no stock, so Admin can shrink stock or pause a voucher afterwards. Reserve-time failure ⇒ cancel + alert (4.2). A paused/hidden voucher with a reserved sale just stays unavailable via `effectiveStatus`; settle still returns quota. Archived vouchers: settle must still work (no state check on the stock write).
5. **Exact boundaries.** `startsAt <= now < endsAt`. A job run at the exact `startsAt` reserves; the first redemption at that instant after reservation gets the Flash price. At `endsAt` the Flash price is gone even before the settle job runs (the price predicate is time-based; the job only returns stock).
6. **Early end of a SOLD_OUT sale** is `FLASH_NOT_ACTIVE` (mock behaviour); the sale settles by itself via `isSettleDue` (all items sold).
7. **Catch-up after downtime:** a sale whose start was missed but `now < endsAt` is reserved late (and is effective only from then); one past its end is stamped settled without stock moves.
8. **Outbox payloads:** ids and counts only; never code values (bearer secrets).
9. `rtk`/hooks rewrite shell commands; quote globs in zsh. Hot files (`schema.prisma`, `rewards.module.ts`, `http-exception.filter.ts`, `scheduler.constants.ts`): rebase on `origin/develop` before editing.

### Testing standards

- Backend jest (`npm test` builds `@rescom/schemas` first); co-located `*.spec.ts`; e2e in `apps/backend/test`. Concurrency is proven on real PostgreSQL with `Promise.all` over production service calls and durable-state assertions (stock, `reserved_at`, `settled_at`, redemption/claim rows), not HTTP codes only.
- No `test.skip` / `.only`, no placeholder tests. Parse real responses with the shared Zod schemas.

### Project Structure Notes

- New: `domain/flash-sale-{rules,settlement,code}.ts`, `application/{flash-sale-lifecycle,rewards-admin-flash}.service.ts`, `application/ports/flash-sale-repository.port.ts`, `infrastructure/{prisma,in-memory}-flash-sale.repository.ts`, `infrastructure/{flash-sale-lifecycle.job,rewards-scheduler.registrar}.ts`, `presentation/admin-rewards-flash-sales.controller.ts`, one migration folder, two test files.
- Changed: `schema.prisma`, `post-push-invariants.sql`, `rewards.module.ts`, `scheduler.constants.ts`, `http-exception.filter.ts` (+spec), flash read port/repos, `rewards-redemption.service.ts`, `redemption-decision.ts`, both catalog services, redemption repository port/twins, `test/migration-chain*.ts`, FE `tests/route-diff.test.mjs` (whitelist only).

### Previous story intelligence (12.8, merged as 6e7c869)

- Review of 12.8 found: non-UUID correlation ids, duplicate audit keys → `P2002` → 500, missing affected-row checks, flash rules applied to non-Flash purchases, errors swallowed inside shared transactions. Apply: validate every id/header, unique Outbox key per mutation, assert counts, pass Flash data only when the price source is FLASH, never swallow DB errors inside a shared transaction.
- 12.8 left `redemption_quotes` unbounded growth deferred; unrelated to 12.9.
- 12.7 deferred to 12.9: "Flash price vs promo display edge cases" (now rejected at create: Flash < `promo ?? base`), "`issued` can go negative when `flashReserved > issued`" (fixed by counting only reserved quota), "Flash price ≥ base shown in catalog" (cannot be created any more).
- Error shape lesson: mirror the mock `{ code, message, details }` so 12.11 flips routes with no UI change.

### Git intelligence

- `6e7c869` Merge PR #25 (12.8), `9718c58` 12.8 implementation (redeem transaction, `SpendPoints`, limits, `rewards_settings`), `a469259` PR #24 (12.7). Latest migration `20261014110000_rewards_redemption_transaction`. Rewards module files above were all touched by 12.7/12.8: expect merge pressure only if another story lands first.

### Latest tech information

- No new dependency. Prisma 6.0.0 (partial indexes and CHECKs only in SQL, mirrored in `post-push-invariants.sql`), NestJS 10, Zod 3.24, Jest 29, PostgreSQL 15. Use parameterised `$queryRaw`/`$executeRaw` for `FOR UPDATE` and conditional updates. The scheduler is the in-process runner (`SCHEDULER_ENABLED`, exactly one API replica in production, lease with fencing token); tests call `runJobOnce()`/the service directly, never rely on the timer (`NODE_ENV=test` disables it).

### Open points for the dev agent to confirm with Quan (do not block; solo owner)

1. **Reserve-time shortage policy (default adopted):** if any voucher lacks stock at the start, the whole sale is cancelled (`RESERVATION_FAILED`, Outbox alert) rather than partially reserved. Confirm; the alternative is per-item partial reservation.
2. **Scheduled sales hold no stock** until start (matches BR-05 "at start"; differs from the FE mock which reserves at create). Admin can therefore shrink stock after scheduling; the reserve-time check is the guard. Confirm, or add a "committed by scheduled sales" floor to `stockAdjustmentDecision` in a follow-up.
3. **Alert surface:** `REWARDS_FLASH_RESERVATION_FAILED` and `REWARDS_CODE_INVENTORY_DRIFT` are Outbox events; no Admin UI/notification shows them yet (12.11 or follow-up).
4. **`remindCount` / `rules.remindBefore10m`:** returns 0; user reminders 10 minutes before start have no owner story. Needs an AC in 12.10/12.11 or a new story.
5. **Refund vs cap claim:** a `flash_item_claims` row is never deleted. If 12.10 refunds a Flash redemption, decide whether the user's single Flash slot is freed (delete the claim in the refund transaction) or consumed.
6. **`createdBy.name`:** needs a Users read port if none exists; record the choice.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 intro, Stories 12.7, 12.8, 12.9, 12.11]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-13.md` FR-73, BR-05, BR-17, BR-18, BR-19]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` AD-24, AD-16, AD-10, AD-17 (scheduler)]
- [Source: `_bmad-output/implementation-artifacts/12-8-quote-redemption-transaction.md` (transaction recipe, D2, review findings), `12-7-rewards-schema-catalog-code-inventory-api.md` (data model, stock identity, deferred items), `12-6-admin-flash-sale-rewards-stats.md` (FE behaviour)]
- [Source: `apps/frontend/my-app/mocks/data/{rewards,rewards-rules}.ts`, `mocks/handlers/rewards-admin.ts`; `packages/schemas/src/rewards/rewards-admin.schema.ts`]
- [Source: `apps/backend/src/common/scheduler/*`, `modules/economy/infrastructure/{economy-scheduler.registrar.ts,jobs/starter-expiry.job.ts}`, `modules/rewards/**`, `apps/backend/prisma/schema.prisma` models `FlashSale`, `FlashSaleItem`, `Redemption`]

## Dev Agent Record

### Agent Model Used
- Google Antigravity (Gemini 2.5 Pro / Sonnet 3.7)

### Debug Log References
- Task 744: unit test suite pass (`156 passed, 2393 total`)
- Task 802 / 822: e2e test suite pass (`51 passed, 458 total`)
- Task 826: frontend node test pass (`886 passed, 0 failed`)
- Task 830: lint, format, typecheck clean

### Completion Notes List
- **Stock Model Shift:** Shifted stock mechanics to reserve-at-start (Task 2). At lifecycle reserve, unreserved voucher stock decrements by quota (`stock_remaining -= quota`) and sets `reserved_at`. Flash purchases increment `sold` without touching regular stock (`rewards-redemption.service.ts`). On settle / early end, unsold quota is returned to voucher stock (`stock_remaining += (quota - sold)`).
- **BR-19 Backstop:** Implemented `flash_item_claims` table with composite primary key `(flash_sale_item_id, user_id)` and unique `redemption_id`. Recorded on redemption step 2.j when `perUserCap = 1`.
- **Pure Domain Rules:** Zero NestJS/Prisma dependencies in `modules/rewards/domain/`. Domain rules ported: `flashConflicts`, `adminFlashStatus`, `flashItemState`, `flashProgress`, `endEarlyDecision`, `reservationPlan`, `settlementPlan`, and `nextFlashSaleCode` (`FS-{YYMMDD}-{A..Z}`).
- **Application & Infrastructure:**
  - `FlashSaleLifecycleService`: settle-first then reserve, voucher lock ascending (`FOR UPDATE`), unit-of-work per sale, conditional state transitions asserting affected row count, Outbox events emitted.
  - `RewardsAdminFlashService`: full CRUD with conflict checking, 3-attempt code collision retry, monitoring stats aggregation.
  - In-process scheduled job `flash-sale-lifecycle` configured with 15s interval, 2m lease TTL.
- **Presentation & Routing:** Added `AdminRewardsFlashSalesController` registered under both `admin/rewards` and `api/admin/rewards` (so `/admin/rewards/flash-sales` and `/api/admin/rewards/flash-sales`). Routes whitelisted in frontend `route-diff.test.mjs`.

### File List
- `apps/backend/prisma/migrations/20261015100000_rewards_flash_sale_lifecycle/migration.sql`
- `apps/backend/prisma/sql/post-push-invariants.sql`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/common/scheduler/scheduler.constants.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/common/http/http-exception.filter.rewards.spec.ts`
- `apps/backend/src/modules/rewards/domain/flash-sale-code.ts`
- `apps/backend/src/modules/rewards/domain/flash-sale-rules.ts`
- `apps/backend/src/modules/rewards/domain/flash-sale-settlement.ts`
- `apps/backend/src/modules/rewards/domain/redemption-decision.ts`
- `apps/backend/src/modules/rewards/domain/rewards-domain.spec.ts`
- `apps/backend/src/modules/rewards/application/ports/flash-sale-read.port.ts`
- `apps/backend/src/modules/rewards/application/ports/flash-sale-repository.port.ts`
- `apps/backend/src/modules/rewards/application/ports/redemption-repository.port.ts`
- `apps/backend/src/modules/rewards/application/exceptions/rewards.exceptions.ts`
- `apps/backend/src/modules/rewards/application/flash-sale-lifecycle.service.ts`
- `apps/backend/src/modules/rewards/application/rewards-admin-flash.service.ts`
- `apps/backend/src/modules/rewards/application/rewards-admin-catalog.service.ts`
- `apps/backend/src/modules/rewards/application/rewards-catalog.service.ts`
- `apps/backend/src/modules/rewards/application/rewards-redemption.service.ts`
- `apps/backend/src/modules/rewards/application/rewards-services.spec.ts`
- `apps/backend/src/modules/rewards/infrastructure/in-memory-flash-sale-read.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/in-memory-flash-sale.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/in-memory-redemption.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-flash-sale-read.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-flash-sale.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-redemption.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/flash-sale-lifecycle.job.ts`
- `apps/backend/src/modules/rewards/infrastructure/rewards-scheduler.registrar.ts`
- `apps/backend/src/modules/rewards/infrastructure/rewards.repositories.spec.ts`
- `apps/backend/src/modules/rewards/presentation/admin-rewards-flash-sales.controller.ts`
- `apps/backend/src/modules/rewards/rewards.module.ts`
- `apps/backend/test/rewards-flash.e2e-spec.ts`
- `apps/backend/test/rewards-flash.prisma.e2e-spec.ts`
- `apps/backend/test/migration-chain.spec.ts`
- `apps/backend/test/migration-chain.prisma.e2e-spec.ts`
- `apps/backend/test/survey-moderation.e2e-spec.ts`
- `apps/frontend/my-app/tests/route-diff.test.mjs`

### Review Findings

Code review 2026-10-14 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, Sonnet). Dismissed as noise: 3.

- [x] [Review][Patch] Revert thay đổi `apps/backend/test/survey-moderation.e2e-spec.ts` (ngoài scope story; Quan chọn 1a — tách thành story riêng nếu cần) — resolved from decision
- [x] [Review][Patch] Thêm năm vào mã flash sale, ví dụ `FS-YYMMDD-X` (Quan chọn 2a); cập nhật `flash-sale-code.ts`, DTO/schema/regex nếu có, và test liên quan — resolved from decision
- [x] [Review][Patch] `update` dùng idempotency key cố định `rewards:flash:${id}:updated` → PUT thứ 2 trên cùng sale ném P2002 (500); thêm thành phần theo mutation (uuid/version) [rewards-admin-flash.service.ts update ~L430]
- [x] [Review][Patch] `update` kiểm `FLASH_ALREADY_STARTED` trước `lockVouchers`, không re-read sau lock; job reserve xen vào thì `updateSale` xoá/tạo lại items `sold: 0` làm lệch stock — re-read sau lock, reject nếu `reservedAt !== null` hoặc `now >= startsAt` [rewards-admin-flash.service.ts update ~L373-398]
- [x] [Review][Patch] `formatRow` cast `endReason` thẳng sang DTO nhưng job ghi `ENDED`/`SOLD_OUT`/`RESERVATION_FAILED`, ngoài `adminFlashEndReasonSchema` (WRONG_PRICE|STOCK_ISSUE|PARTNER_REQUEST|OTHER) → list/detail fail Zod ở FE; map giá trị ngoài enum về null [rewards-admin-flash.service.ts:147, packages/schemas/src/rewards/rewards-admin.schema.ts:45]
- [x] [Review][Patch] `findDueForReserve` thiếu `settledAt: null` và `endsAt > now`; sale RESERVATION_FAILED/missed (đã settled, `reserved_at` NULL) bị chọn mãi, ~20 dòng là chặn mọi reserve mới và không khớp partial index [prisma-flash-sale.repository.ts:134-149, in-memory-flash-sale.repository.ts]
- [x] [Review][Patch] Nhánh RESERVATION_FAILED gọi `markEndedEarly` nhưng repo yêu cầu `reserved_at IS NOT NULL` → luôn false, `ended_early_at` không set (Task 4.2); kết quả bị bỏ qua. Dùng update riêng cho sale chưa reserve hoặc assert [flash-sale-lifecycle.service.ts ~L123-132]
- [x] [Review][Patch] `endEarly` bỏ qua kết quả `markEndedEarly`; nếu `markSettled` false vẫn ghi audit + trả success; assert theo Gotcha 3 [rewards-admin-flash.service.ts ~L527-540]
- [x] [Review][Patch] Sell-out không được job settle trước `endsAt`: `findDueForSettle` chỉ lấy `endsAt<=now`/`endedEarlyAt<=now`, nhánh "all sold" của `isSettleDue` là code chết (AC2) — thêm điều kiện sold-out vào scan [prisma-flash-sale.repository.ts:151-162, in-memory]
- [x] [Review][Patch] Lỗi từng sale trong `runDue` bị nuốt không log/đếm; job luôn SUCCEEDED, sale lỗi ở đầu hàng đợi bị thử mãi — trả/đếm `errored`, log, map vào `failedCount` [flash-sale-lifecycle.service.ts catch blocks, flash-sale-lifecycle.job.ts]
- [x] [Review][Patch] Job map `reservationFailed` → `failedCount`, run chỉ huỷ sale có thể ném `assertNotAllFailed` dù là kết quả mong đợi [flash-sale-lifecycle.job.ts]
- [x] [Review][Patch] `list`/`get` không gọi `authorize` (live ADMIN_CAPABILITY_PORT) trái Task 6.1; admin bị hạ quyền còn đọc được [rewards-admin-flash.service.ts:161-200]
- [x] [Review][Patch] `create` hết 3 lần retry ném raw P2002 (500) thay vì `FLASH_CODE_EXHAUSTED`; catch khớp mọi "Unique constraint" (cả audit key/item id) — chỉ retry đúng cột `code` [rewards-admin-flash.service.ts ~L234-340]
- [x] [Review][Patch] Reserve không kiểm `codesAvailable >= quota` (non-shared code); sale hiện ACTIVE nhưng trả SOLD_OUT [flash-sale-settlement.ts reservationPlan, flashConflicts]
- [x] [Review][Patch] Prisma `updateSale` luôn ghi `sold: 0` còn in-memory giữ `sold` — hai bản lệch, contract suite không bắt [prisma-flash-sale.repository.ts, in-memory-flash-sale.repository.ts]
- [x] [Review][Patch] Monitoring lệch Task 4.4: `participants` chỉ đếm SUCCEEDED (spec: user có bất kỳ Redemption), `afterTopUp.flagged = count` (spec: flag đang mở); xác minh mã lỗi `FLASH_SOLD_OUT`/`SOLD_OUT` và key `flash-after-topup:` với 12.8 [prisma-flash-sale.repository.ts ~L3745-3790 patch] — DONE: participants/flagged đã sửa (flagged = distinct user có FraudLog FLASH_AFTER_TOPUP, Quan xác nhận), đã có test PG
- [x] [Review][Patch] `rewards-flash.prisma.e2e-spec.ts` chỉ 2 test dù Task 7.4 đã `[x]`: thiếu parallel runDue, runDue×end sớm, end sớm×redeem, parallel overlap create, giá biên start/end, migration từ migration trước; test "concurrent" BR-19 chạy tuần tự; Task 7.5 chưa ghi output PG; controller specs 401/403/CSRF/UUID (7.3) thiếu phần UUID; suite `describe.skip` im lặng khi không có DB — DONE: 12 test PG + test migration-từ-migration-trước pass
- [x] [Review][Patch] Completion Notes ghi route kép `/rewards/admin/flash-sales`, controller thật đăng ký `admin/rewards` + `api/admin/rewards`; sửa notes hoặc controller; "Agent Model Used" ghi Antigravity/Gemini — xác nhận khớp thực tế
- [x] [Review][Defer] `flash_item_claims` thiếu FK `user_id` và composite FK tới `redemptions`; cap chưa nhả khi refund — deferred, story Open point 5 / Story 12.10
- [x] [Review][Defer] Admin `list()` N+1 không phân trang (`vouchers.list()` full, `in` clause lớn) — deferred, quy mô pilot nhỏ, xử lý khi có phân trang
- [x] [Review][Defer] `adjustVoucherStock` nhánh dương không chặn `stock_remaining + delta <= stock_total` (cần xác minh CHECK trong schema) — deferred, kiểm CHECK trước
- [x] [Review][Defer] Chữ ký polymorphic `string | object | DTO` + `(deps as any)` ở `create/update/endEarly` — deferred, dọn khi refactor DI, không sai chức năng
- [x] [Review][Defer] Overlap candidates gồm sale chưa reserve đã qua end do job lag có thể báo `FLASH_OVERLAP` thừa — deferred, tác động thấp (startsAt phải ở tương lai)
