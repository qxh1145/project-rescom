---
baseline_commit: 3b19942fd5df5df60afb8cced9a45f785a541ab0
---

# Story 12.6: Admin Flash Sale & Rewards Statistics

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want to schedule and monitor Flash Sales and see redemption statistics,
so that I can run promotions safely and measure them.

## Acceptance Criteria

1. **Create/validate.** Given an Admin, when they create a Flash Sale, then the form validates overlap, Flash price below the regular price, and quota within unreserved stock, and it previews the result with the User Portal `FlashSaleCard` (Figma page 26, `139:170`, FR-73).
2. **Monitoring.** Monitoring shows all five program states (Scheduled, Upcoming, Active, Sold out, Ended) with sold/quota counts (Figma `138:8`).
3. **End early.** "Kết thúc sớm" requires a confirmation dialog that explains that unsold quota returns to stock and the price returns to regular (Figma `139:493`).
4. **Statistics.** The statistics dashboard (Figma page 27 `140:2`) shows 5 KPIs, redemptions by day, redemptions by brand, and Flash Sale performance; the usage rate is labelled as self-reported.

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.6 (FR-73; BR-05, BR-17, BR-18, BR-19, BR-02, BR-21; Open Questions 23 and 26 planning defaults). FE + MSW mock only; backend is Stories 12.7 (catalog) and 12.9 (Flash lifecycle).

## Tasks / Subtasks

- [x] **Task 1: Contract additions (`packages/schemas/src/rewards/rewards-admin.schema.ts`, additive only)** (AC: 1–4)
  - [x] 1.1 The 12.1 schemas `adminFlashSaleInputSchema`, `adminFlashSaleSchema`, `adminFlashSaleStatusSchema`, `rewardsStatsQuerySchema`, `rewardsStatsSchema` already exist and are tested: **do not re-create or break them**. Extend them with optional/defaulted fields so the existing spec cases still pass:
    - `adminFlashSaleInputSchema` + `title: z.string().trim().min(1).max(60)` (required; Figma "Flash trưa 13/10"; update the existing spec fixtures) and `rules: z.object({ requireRecentSurvey: z.boolean().default(true), remindBefore10m: z.boolean().default(true), blockFlagged: z.boolean().default(true) }).default({})`. "Chỉ tài khoản đã kích hoạt" is always on (BR-02, shown as a disabled toggle, not a field). Add `.refine` duration ≤ 6 h on `endsAt` (Figma 26b "Tối đa 6 giờ").
    - `adminFlashSaleSchema` + `title`, `createdBy: { id, name }`, `rules` (same shape, all required), `remindCount: count`, `endReason: adminFlashEndReasonSchema.nullable()`, `succeededCount: count`, `participants: count`, `failures: z.object({ SOLD_OUT: count, INSUFFICIENT_POINTS: count, OTHER: count })`, `afterTopUp: z.object({ count, rate: ratio, flagged: count })` (Figma `146:4127` "Đổi trong 24 giờ sau khi nạp"), and per item an `adminFlashSaleItemSchema = flashSaleItemSchema-shaped + { unsold: count, pointsSpent: count, perMinute: z.number().nonnegative(), soldOutAt: instant.nullable(), regularPoints: positive }`. Server derives these; the client only formats them.
  - [x] 1.2 `adminFlashEndReasonSchema = z.enum(["WRONG_PRICE","STOCK_ISSUE","PARTNER_REQUEST","OTHER"])`; `adminFlashEndRequestSchema = z.object({ reason, note: z.string().trim().max(200).optional() }).refine(v => v.reason !== "OTHER" || !!v.note, { path: ["note"] })`.
  - [x] 1.3 `adminFlashSaleListSchema = z.object({ items: z.array(adminFlashSaleSchema), summary: z.object({ active: count, upcoming: count, scheduled: count, soldOut: count, ended: count }), serverTime: instant })` (header "1 đang diễn ra · 1 sắp diễn ra"; `upcoming` counts SCHEDULED + UPCOMING). Query: `adminFlashSaleListQuerySchema = z.object({ status: adminFlashSaleStatusSchema.optional() })`.
  - [x] 1.4 `adminFlashSaleCreatedSchema = z.object({ flashSale: adminFlashSaleSchema })` (create/edit/end response).
  - [x] 1.5 Export inferred types (`AdminFlashSaleDto`, `AdminFlashSaleInputDto`, `AdminFlashSaleListDto`, `AdminFlashEndRequestDto`, …). Names stay `adminFlash*`/`rewardsStats*` (never bare `reward*`).
  - [x] 1.6 Spec cases in `rewards-admin.schema.spec.ts`: each new/extended schema accepts a valid payload and rejects an invalid one (duration > 6 h, empty title, `OTHER` without note, unknown status filter); existing cases kept.
- [x] **Task 2: Mock domain (rules + data + handlers)** (AC: 1–4)
  - [x] 2.1 `mocks/data/rewards-rules.ts` — pure rules (no state, time passed in), each unit tested:
    - `adminFlashStatus(flash, now)` → `SCHEDULED | UPCOMING | ACTIVE | SOLD_OUT | ENDED`. Priority: ENDED (`now >= endsAt` or `endedEarlyAt`), UPCOMING/SCHEDULED when `now < startsAt` (UPCOMING = starts within 24 h and is therefore shown to users as "Sắp diễn ra"; SCHEDULED = later; planning-default assumption, record it), SOLD_OUT when every item `sold >= quota`, else ACTIVE. Must agree with the per-item `state` that `flashSalesAt` already computes (reuse the same time comparison; do not fork it).
    - `flashConflicts(input, vouchers, flashes, now, selfId?)` → `{ path, code, details }[]` for the server-only rules: `FLASH_PRICE_NOT_BELOW_REGULAR` (path `items.N.flashPoints`; regular = `promoPoints ?? basePoints`, details carry that value), `FLASH_QUOTA_EXCEEDS_STOCK` (path `items.N.quota`; allowed = `v.stockRemaining` + own previous quota when editing; details carry `available`), `FLASH_OVERLAP` (path `items.N.voucherId`; another non-ended flash with the same voucher and `[start,end)` intersecting; ended-early flashes count only until `endedEarlyAt`; details carry the conflicting `code`), `FLASH_STARTS_IN_PAST` (create/edit only when `startsAt <= now`), `VOUCHER_NOT_FLASHABLE` (voucher not `ACTIVE`, hidden, archived, or window ended before `endsAt`, or shared-code with 0 stock), `FLASH_QUOTA_BELOW_SOLD` (edit).
    - `flashProgress(flash, now)` → per item `{ perMinute, etaAt | null, soldOutAt | null }`: `perMinute = sold / max(1, minutes since startsAt)` rounded to 1 decimal; `etaAt` only for ACTIVE items with `perMinute > 0`; copy uses "dự kiến hết lúc HH:mm" only when `etaAt < endsAt`, else "có thể còn dư 0–N suất" (Figma `138:156`, `138:179`).
    - `endEarlyDecision(flash, now)` → ok with `{ returned: Σ(quota − sold), items }` when status is ACTIVE; `409 FLASH_NOT_ACTIVE` otherwise; `409 FLASH_ALREADY_ENDED` for ENDED.
    - `statsRange(query, now)` and `bucketByVietnamDay(instants)` → day keys in Asia/Ho_Chi_Minh (UTC+7, no DST).
  - [x] 2.2 `mocks/data/rewards.ts`:
    - Extend `FlashInventory` (in `rewards-rules.ts`) with `title`, `createdBy`, `rules`, `remindCount`, `endReason`, `settledAt: string | null`, `failures`, `afterTopUp`, `participants`. Seed the three current programs from Figma page 26 (FS-1013-A active, FS-1013-B upcoming, FS-1020 scheduled) **and the two ended ones** (FS-1006, FS-0928, `settledAt` set) so the list and the statistics have history. Existing user-facing seed (12.2–12.4 tests) must keep working: `flashSalesAt` only lists flashes with `endsAt > now − 1 day`, so the old ones must not leak into the user strip.
    - `adminFlashSalesOf(query, now)`, `createAdminFlashSale(input, admin, now)`, `updateAdminFlashSale(id, input, now)` (only while `now < startsAt`; else 409 `FLASH_ALREADY_STARTED`), `endAdminFlashSale(id, request, now)`, `rewardsStatsOf(query, now)`. All return `{ ok:true, result } | { ok:false, status, code, details }` and mutate with **one** `rewardsCatalog.update` per call (pattern of `redeemVoucherQuote`).
    - **Quota reservation (mock deviation from BR-05):** the mock reserves at create (`stockRemaining -= quota` per item; this is what `adminStockOf` already assumes for non-ended flashes), returns `quota − sold` on early end and on **lazy settlement**: `adminFlashSalesOf`/`flashSalesAt` callers do not mutate; instead a small `settleEndedFlashes(state, now)` runs inside the admin write functions and in `adminFlashSalesOf`'s single update only when some flash has `now >= endsAt && !settledAt` (return unsold, set `settledAt`). Real exactly-once jobs are Story 12.9. After every function the identity `issued ≥ 0` and `codesAvailable` sync from 12.5 must still hold (run `adminStockOf` over all vouchers in tests).
    - `endAdminFlashSale`: sets `endedEarlyAt = now`, `endReason`, returns unsold quota, `settledAt = now`. An open 12.3 quote with a FLASH price then redeems to `PRICE_CHANGED` through the existing `decideRedemption` (the price version/source differs); do not special-case it, **prove it in a test**. Past tickets/history keep the Flash price (BR-12 style).
    - `rewardsStatsOf`: bucket by Vietnam day. Because the mock has only a few real tickets, build the series from a deterministic **seeded baseline** (`statsBaseline`: ~30 days of per-day, per-voucher counts and points, with Flash days at 2.5–5× the ordinary average as in Figma `140:137`) **plus live tickets**: every distinct `reference` across `rewardsState.users[*].tickets` with `redeemedAt` later than the baseline's `seededAt` (dedupe, the demo user's seed is cloned under two keys). This keeps the dashboard reacting to Story 12.3 redemptions without touching `redeemVoucherQuote`. KPIs: `activeVouchers` from `adminVoucherStatus` (reuse), `redemptions.avgPerRegularDay` over days without a Flash program, `pointsSpent.vndEquivalent = points × POINT_VND_RATE`, `redemptionRate = redeemed / offered` (offered = Σ stockTotal opened in range incl. Flash quota; seed so the identity from Figma "1.397 lượt / 1.870 suất" is illustrative, not required), `topVoucher` by count with `share`, `selfReportedUsageRate` = used tickets / issued tickets (seeded constant blended with live tickets; label it self-reported in the UI). Refunded redemptions are excluded from counts and points (Figma "Cách tính").
    - Bump `SCHEMA_VERSION` 8 → 9 in `mocks/db/store.ts` (catalog shape changed).
  - [x] 2.3 `mocks/handlers/rewards-admin.ts` (existing file from 12.5; add handlers, keep the exported array and guards). Every handler: `applyScenario("admin")`, `requireMockAdmin()` (or the hybrid admin the 12.5 handlers already use), CSRF via `missingCsrf` on writes, Zod parse, `ok()/fail()` envelope. Routes (6):

    | Route | Body / query | Response |
    |---|---|---|
    | `GET /admin/rewards/flash-sales` | `adminFlashSaleListQuerySchema` | `adminFlashSaleListSchema` |
    | `POST /admin/rewards/flash-sales` | `adminFlashSaleInputSchema` | 201 `{ flashSale }` |
    | `GET /admin/rewards/flash-sales/:id` | — | `{ flashSale }` (edit page load) |
    | `PUT /admin/rewards/flash-sales/:id` | `adminFlashSaleInputSchema` | `{ flashSale }` |
    | `POST /admin/rewards/flash-sales/:id/end` | `adminFlashEndRequestSchema` | `{ flashSale }` |
    | `GET /admin/rewards/stats` | `rewardsStatsQuerySchema` (`from`, `to`) | `rewardsStatsSchema` |

    Validation → `400 VALIDATION_ERROR` with `details: error.format()` (form maps paths to fields); rule conflicts from `flashConflicts` → `409` with the first conflict's `code` and `details.conflicts` (all of them, so the form can mark every row). Unknown id → `404 FLASH_SALE_NOT_FOUND`. Mark each handler `// ASSUMED API CONTRACT: …` and list its error codes.
  - [x] 2.4 `mocks/route-allowlist.ts`: add the 6 routes to `DEFERRED_KEEP_MOCK` (count 35 → 41) with reason "rewards admin, Epic 12 (Phase 2; backend Stories 12.7-12.10)".
  - [x] 2.5 Update gate counts 35 → 41 in `tests/route-diff.test.mjs` (~line 103-106) and `tests/hybrid-mocking.test.mjs` (~line 131: title and number). Read both files first. Confirm hybrid mode accepts the admin identity for the new handlers exactly like the 12.5 ones.
- [x] **Task 3: Client service + callsite gates** (AC: 1–4)
  - [x] 3.1 `lib/admin/rewards-flash-service.ts` (new; same shape as `rewards-vouchers-service.ts`): one function per route using `apiRequest` + shared Zod schemas, each self-gating `if (PILOT_BUILD) throw new Error(...)`. Route literals live only inside those guarded functions (pilot literal scan).
  - [x] 3.2 `tests/helpers/frontend-callsites.mjs`: add 6 `CALL_ALLOWLIST` entries (`:param` format). `contract-callsites` and `route-diff` are strict equality: every deferred route needs a caller.
- [x] **Task 4: Pure view logic `lib/admin/rewards-flash-view.ts` and `lib/admin/rewards-stats-view.ts`** (AC: 1–4)
  - [x] 4.1 `flashStatusView(status)` → `{ label, tone }`: "Đang diễn ra", "Sắp diễn ra", "Hẹn lịch", "Hết suất", "Đã kết thúc". Status always as text (never colour alone).
  - [x] 4.2 `flashRowView(flash, now)` → `{ title: "FS-1013-A · Flash trưa 13/10", subtitle ("3 voucher · tạo bởi Admin Hùng" | "312 người đã bấm Nhắc tôi" | "Kết thúc đúng giờ, dư 28 suất" | "Hết suất sau 38 phút" | "Kết thúc sớm · {lý do}"), windowLabel ("13/10 12:00 – 15:00"), soldLabel ("173/230"), soldRatio, vouchersLabel ("HL 50k · LT 25k · GC 20k": brand initials + value in k), actions }`. Dates via `lib/format/date-time.ts`; points via `formatPoints`.
  - [x] 4.3 `monitorItemView(item, flash, now)` → price line ("150 điểm" + struck regular "250"), "75/100 suất", progress ratio, footnote from `flashProgress` ("Tốc độ 1,9 suất/phút · dự kiến hết lúc 13:15" | "Hết suất lúc 12:41 · đã về giá thường 100"), badge "Hết suất" when sold out. `monitorTotals(flash)` → five items from Figma `138:208`: "173/230 suất", "19.070 điểm", participants, "21 · hết suất 14, thiếu điểm 7", "9 lượt · 5% · đã gắn cờ 1".
  - [x] 4.4 `flashFormErrors(zodIssues, conflicts)` → `Record<fieldPath, message>` with the Vietnamese messages from Dev Notes → Field messages. Pure, unit tested.
  - [x] 4.5 `previewFlashItem(row, voucher, state, startsAt)` → a `FlashSaleItemDto` built from a form row, so the **existing** `FlashSaleCard` renders it (no copy of the card). Rows with errors are skipped in the preview (Figma `139:492`). `discountPercent` via the shared `discountPercent`.
  - [x] 4.6 `endEarlyCopy(flash)` → the four dialog bullets of Figma `139:673` from payload fields (`regularPoints`, `unsold`, `succeededCount`): "Giá N voucher đang chạy về giá thường ngay (Highlands 250, Lotteria 125).", "57 suất chưa đổi (25 + 32) trả về kho giá thường.", "Người đang ở bước xác nhận sẽ thấy “Giá vừa thay đổi”; không ai bị trừ sai giá.", "173 giao dịch đã thành công giữ nguyên giá Flash." Items already sold out are omitted from the first two bullets. Display-only: no stock arithmetic beyond joining server numbers.
  - [x] 4.7 Stats: `statsKpiView(stats)` → 5 cards (Figma `140:116`…`140:132`): "5/7" + "1 hết hàng · 1 hết hạn đổi"; "1.397" + "30 ngày · trung bình 36 lượt/ngày thường"; "233.170" + "≈ 46,6 triệu đ theo tỷ giá 200đ"; "74,7%" + "1.397 lượt / 1.870 suất mở bán"; "Phổ biến nhất · Highlands 50k" + "412 lượt" + "29,5% tổng lượt đổi trong kỳ". `usageRateNote(stats)` → "Tỷ lệ dùng (người dùng tự báo): N%" shown with the text "tự báo"; it is never shown as a KPI without that label.
  - [x] 4.8 `dailyChartData(stats)` → `{ date, label ("14/09"), count, isFlash, flashCodes }[]` (Recharts data), `dailyChartSummary(stats)` → headline "Ngày có Flash Sale có lượt đổi gấp 2,5–5 lần ngày thường" computed from the data (min/max ratio of Flash days to `avgPerRegularDay`; fall back to "Chưa có ngày Flash Sale trong kỳ"), footnote "Trung bình ngày thường N lượt. {today} tính đến HH:mm, Flash Sale vẫn đang chạy." only when a Flash program is active today. `brandRowsView(stats)` → rows sorted by redemptions desc with bar ratio, "85.500 điểm", "82%". `flashPerformanceView(stats)` → cards "FS-1013-A · 13/10", "75% bán", items label, "173/230 suất · đang diễn ra · 19.070 điểm" / "…· hết suất sau 38 phút · …".
  - [x] 4.9 `STATS_RANGES` = Select options for the header: "7 ngày qua", "30 ngày qua" (default), "90 ngày qua", "Tháng này"; `rangeToQuery(key, now)` → `{ from, to }` in Vietnam dates, ≤ 366 days.
- [x] **Task 5: UI (desktop-only, admin console)** (AC: 1–4)
  - [x] 5.1 Sidebar `components/layout/admin/admin-nav.ts`: add `{ href: "/admin/flash-sales", label: "Flash Sale", icon: "zap" }` and `{ href: "/admin/voucher-stats", label: "Thống kê voucher", icon: "bar-chart" }` (check `components/ui/Icon` for the real icon names; add an icon only if none fits) after "Voucher", each in the same `PILOT_BUILD ? [] : [...]` spread. Order per Figma AdminSidebar: Voucher, Flash Sale, Thống kê voucher.
  - [x] 5.2 `app/(signed-in)/(admin)/admin/flash-sales/page.tsx` → `components/FlashSalesScreen.tsx` (`AdminPage title="Flash Sale"`, meta "1 đang diễn ra · 1 sắp diễn ra" from `summary`, action primary Button "Tạo Flash Sale" → `/admin/flash-sales/new`). Parts: `ActiveFlashPanel` (Figma `138:105`: header with status Tag, title, rule line "12:00 – 15:00 · mỗi người 1 suất mỗi voucher · chỉ tài khoản đã kích hoạt", "Kết thúc sau" + `Countdown` reused from the rewards components using **server time**, danger button "Kết thúc sớm"; the voucher monitor cards; the totals row) shown when a program is ACTIVE or SOLD_OUT-within-window; `FlashSalesTable` (columns per Figma head `138:223`: Chương trình, Thời gian, Đã đổi / số suất with a `ProgressBar` and numbers, Voucher, Trạng thái, actions); row actions menu (follow the 12.5 `VoucherActionsMenu` pattern, no menu library): Xem trước (opens the preview dialog), Sửa (only SCHEDULED/UPCOMING), Kết thúc sớm (only ACTIVE). Empty ("Chưa có Flash Sale nào" + Tạo Flash Sale), skeleton without layout shift, error with retry.
  - [x] 5.3 `EndEarlyDialog` (`components/ui/Dialog.tsx`, traps focus, returns focus to the trigger): title "Kết thúc sớm FS-1013-A?", the four bullets from `endEarlyCopy`, `Select` "Lý do" (4 options), `Textarea`/`TextField` "Ghi chú" (required for "Khác"), buttons "Huỷ" and danger "Kết thúc sớm". Confirm locks after the first click; on 409 `FLASH_NOT_ACTIVE`/`FLASH_ALREADY_ENDED` show an inline Alert and reload the list (the program changed under the Admin).
  - [x] 5.4 `flash-sales/new/page.tsx` and `flash-sales/[id]/edit/page.tsx` (async `params`) → `components/FlashSaleFormScreen.tsx`. Header: "Tạo Flash Sale", breadcrumb "Flash Sale › FS-1020", buttons per Figma `139:155/160/165` (Huỷ, Lưu nháp is **not** in the contract → omit; "Lên lịch"/"Lưu" primary). Sections as Figma `139:259`: **Chương trình** (title, start, end `datetime-local` interpreted in Asia/Ho_Chi_Minh through the Vietnam helpers; helper "Tối đa 6 giờ. Không trùng giờ với Flash Sale khác có cùng voucher."), **Voucher tham gia** (picker from `GET /admin/rewards/vouchers` (12.5 service) limited to flashable vouchers; per row: remove, flash price, quota, per-user cap `Select` default 1; row caption "Giá thường 150 điểm · còn 104 mã chưa giữ"), **Điều kiện & thông báo** (four toggles: "Chỉ tài khoản đã kích hoạt" disabled and on, "Chỉ người đã làm ≥ 1 khảo sát trong 30 ngày", "Báo trước 10 phút cho người bấm Nhắc tôi", "Chặn tài khoản đang bị gắn cờ FraudLog"), and the info row "Khi kết thúc" (Figma `139:383`). Right column `FlashPreviewPanel`: title "Xem trước trên User Portal", device switch Mobile/Desktop and state switch Sắp diễn ra/Đang diễn ra, a scaled mobile frame with the `Countdown` header and the **real** `FlashSaleCard` per valid row, plus the Figma note. Field-level errors from the shared `adminFlashSaleInputSchema` (client validation imports it from `@rescom/schemas`, never a copy) and from the server 409 `details.conflicts` mapped by `flashFormErrors`. Submit once; double-click guarded.
  - [x] 5.5 12.5 follow-up: in `voucherActionsOf` (`lib/admin/rewards-vouchers-view.ts`) add the "Tạo Flash Sale" item (not for ARCHIVED) linking to `/admin/flash-sales/new?voucherId={id}`, which preselects that voucher; update the 12.5 view test. This is the "no dead links" item 12.5 deferred; the route now exists.
  - [x] 5.6 `app/(signed-in)/(admin)/admin/voucher-stats/page.tsx` → `components/VoucherStatsScreen.tsx` (`AdminPage title="Thống kê voucher"`, meta "Cập nhật 13/10/2026 13:00" from `updatedAt` via Vietnam helpers, header `Select` of `STATS_RANGES`). Parts: `StatsKpis` (5 cards), `DailyRedemptionsChart` (Recharts bar chart, already a dependency from the survey analytics screens: follow their wrapper and theming; Flash days use the sale colour token, regular days the neutral one, legend "Ngày có Flash Sale" / "Ngày thường", y-axis grid 0/100/200 style, value label on peak bars, tooltip "28/09 · 128 lượt" + "FS-0928: 100 suất Flash, hết sau 38 phút"), `FlashPerformanceList`, `BrandBreakdown` (table with inline bars, columns Thương hiệu, Lượt đổi, Điểm đã tiêu, Đã bán / mở bán), `DefinitionsCard` ("Cách tính" five bullets, Figma `140:274`). **Accessibility:** the chart has a text/table alternative (visually hidden `<table>` or `aria-label` summary with the headline and peak days); colour is never the only Flash marker (legend text + tooltip text). Loading skeleton, empty ("Chưa có lượt đổi trong kỳ"), error with retry.
  - [x] 5.7 Hooks in `flash-sales/hooks/use-admin-flash-sales.ts` and `voucher-stats/hooks/use-rewards-stats.ts` built on `useApiQuery` (same style as `vouchers/hooks/*`). Server time for the Countdown comes from `serverTime` of the list payload through `lib/rewards/server-clock` (the client clock never decides a price or a state; poll the list every 30 s while a program is ACTIVE/UPCOMING and refetch immediately on `onElapsed`).
- [x] **Task 6: Pilot hiding** (AC: 1, 4)
  - [x] 6.1 Add 4 routes to `lib/pilot-scope.ts` `PILOT_HIDDEN_ROUTES` (`/admin/flash-sales`, `/admin/flash-sales/new`, `/admin/flash-sales/[id]/edit`, `/admin/voucher-stats`; guard = each `page.tsx` calling `notFound()` when `PILOT_BUILD`) and the matching `proxy.ts` entries (`/admin/flash-sales`, `/admin/flash-sales/new`, `/admin/flash-sales/:id/edit`, `/admin/voucher-stats`). Follow exactly how `/admin/vouchers…` was done in 12.5 in all three places.
- [x] **Task 7: Tests** (AC: 1–4) — `node:test`, import pure TS directly (see `rewards-admin-vouchers.test.mjs`, `rewards-mock.test.mjs`); new files `tests/rewards-admin-flash.test.mjs` and `tests/rewards-admin-flash-view.test.mjs`:
  - [x] 7.1 Rules: `adminFlashStatus` table (all five states + boundary at exactly `startsAt`/`endsAt`, `endedEarlyAt` before `endsAt`, SOLD_OUT while in window); `flashConflicts` each code, overlap at the touching boundary (`end == other start` is **not** an overlap, half-open `[start,end)`), edit ignoring own quota, ended-early flash not blocking a later program; `flashProgress` ETA vs "còn dư" branch; `endEarlyDecision`.
  - [x] 7.2 Mock domain: create reserves stock (`adminStockOf` identity and `issued ≥ 0` hold for **all** vouchers after create/update/end/settle); update after start → 409; end early returns exactly `Σ(quota − sold)`, sets `endedEarlyAt`, the user price falls back (`effectiveVoucherPrice` source ≠ FLASH), a previously created FLASH quote then redeems to `PRICE_CHANGED` and no points are deducted, existing tickets keep their price; ending twice → 409; lazy settlement returns unsold quota exactly once (call the list twice); the user `flashSalesAt` still lists the same active/upcoming programs as before this story.
  - [x] 7.3 Stats: bucket by Vietnam day around midnight (23:30 UTC+7 vs 00:30), refunded rows excluded, live ticket after `seededAt` raises the day count and `topVoucher` share, range > 366 days rejected by the schema, empty range returns zeros without `NaN`/division by zero (`redemptionRate`, `avgPerRegularDay`, `share`).
  - [x] 7.4 View logic: `flashRowView` subtitles for all five states, `endEarlyCopy` exact text, `flashFormErrors` maps `items.0.flashPoints`/`quota`/`voucherId`/`endsAt` and conflict details, `previewFlashItem` skips invalid rows and matches `flashSaleItemSchema`, `dailyChartSummary` fallback, `usageRateNote` contains "tự báo", `rangeToQuery` Vietnam dates.
  - [x] 7.5 Handler/route checks (hybrid-style, as in 12.5): non-admin → 403, no session → 401, missing CSRF on a write → 403/`CSRF`, invalid body → 400 with `details`, rule conflict → 409 with `details.conflicts`, unknown id → 404.
  - [x] 7.6 Source-guard test: `lib/admin/rewards-flash-service.ts` has `PILOT_BUILD` in every exported function; no component imports from `mocks/`; `FlashSaleFormScreen` imports `FlashSaleCard` from the rewards components (no duplicate card).
- [x] **Task 8: Verification**
  - [x] 8.1 `npm test` in `apps/frontend/my-app` (builds `@rescom/schemas` first), the schemas jest suite, `npm run lint` and `npx tsc --noEmit`; full run stays green (route-diff, hybrid-mocking, no-direct-mocks, contract-callsites, pilot-scope, and the existing `rewards-*` and `rewards-admin-vouchers*` tests).
  - [x] 8.2 Manual browser check with MSW (`NEXT_PUBLIC_API_MOCKING=enabled`, admin mock user): list with all five states, create with an overlapping voucher (error on the row), price ≥ regular (error), quota above stock (error), clean create and the live preview in both device and both state modes, edit before start, end early (dialog text, reason required for "Khác"), then open the user Đổi quà page and confirm the strip/price returned to regular; stats page range switch, chart tooltip, definitions. Record the result honestly, including what was not checked.
  - [x] 8.3 Pilot build check: with `NEXT_PUBLIC_PILOT_BUILD=true` the sidebar has no Flash Sale / Thống kê voucher entries and the four routes are 404.

### Review Findings

_Code review 2026-10-13 (Blind Hunter, Edge Case Hunter, Acceptance Auditor; severity rated by lead after reading code)._

- [x] [Review][Patch] (resolved decision: fix seed) Seed flashes 101/102 `settledAt: null` but seed vouchers' `stockRemaining` may not exclude their quotas; `settleEndedFlashes`/`endAdminFlashSale` add back `quota - sold`, so ending a seed flash may credit stock never reserved (domain test locks this in). Reduce seed `stockRemaining` by the flash quotas (keep end/settle logic) and update the domain test. [mocks/data/rewards.ts:75-77,459,510]
- [x] [Review][Patch] (high) 30s poll never fires: effect deps include `query` (new object each render from `useApiQuery`) and `setNow` re-renders every 1s, so both intervals reset each tick. Depend on `query.reload` + `hasLive` boolean. [flash-sales/components/FlashSalesScreen.tsx:34]
- [x] [Review][Patch] (high) `now` starts at 0 and the timer starts only for ACTIVE/UPCOMING: SOLD_OUT-only live panel freezes at epoch 0 (garbage Countdown, never ends); first second of any load also uses 0. Init `now` from `serverTime`/`Date.now()`, include SOLD_OUT in timer condition. [FlashSalesScreen.tsx:24,32]
- [x] [Review][Patch] (high) AC2 monitor panel not as specified: `monitorItemView`/`monitorTotals` unused; live panel lacks price line with struck regular price, "Hết suất" badge, speed/ETA footnote, totals row. Wire the views in; remove duplicated action matrix (`actions`) or use it. [FlashSalesScreen.tsx:56, lib/admin/rewards-flash-view.ts:25-39]
- [x] [Review][Patch] (high) ETA computed on client; `adminFlashRow` drops `etaAt` and schema has no field. Return server `etaAt`/`soldOutAt` and render it. [lib/admin/rewards-flash-view.ts:26-28, mocks/data/rewards.ts adminFlashRow]
- [x] [Review][Patch] (medium) `monitorTotals` failure string wrong: prints "SOLD_OUT · hết suất INSUFFICIENT_POINTS, thiếu điểm". Spec: "total · hết suất N, thiếu điểm M". Add test. [lib/admin/rewards-flash-view.ts:36]
- [x] [Review][Patch] (medium) Create form requests `GET /admin/rewards/flash-sales/new` (404 every visit); pass `key: null` when no id. Also tell 404 from network error on edit page, and handle 409 `FLASH_ALREADY_STARTED`/404 with reload + Admin message (12.5 lesson); non-field failures currently show only "Kiểm tra các trường". [flash-sales/hooks/use-admin-flash-sales.ts, components/FlashSaleFormScreen.tsx]
- [x] [Review][Patch] (medium) `soldOutAt` fabricated as `min(now, endsAt)` and `perMinute` decays after end; store/derive real sell-out time. [mocks/data/rewards-rules.ts:~126-130]
- [x] [Review][Patch] (medium) `soldOutAfterMinutes` = full window, set only while status SOLD_OUT (missing after it ends). Use real sell-out time. [mocks/data/rewards.ts:564]
- [x] [Review][Patch] (medium) `flashPerformanceView` labels UPCOMING/SCHEDULED flashes "đã kết thúc"; same-day upcoming flash also flagged as Flash day and excluded from regular-day average. [lib/admin/rewards-stats-view.ts, mocks/data/rewards.ts rewardsStatsOf]
- [x] [Review][Patch] (medium) Stats: `statsSeededAt = Date.now()` at module load → persisted live tickets from before a reload drop out; baseline dates freeze at load. Persist/stabilise seed time. [mocks/data/rewards.ts:530,541]
- [x] [Review][Patch] (medium) KPI math deviates: `offered = count + ceil(count*0.3)` (fake constant rate); `selfReportedUsageRate` denominator double-counts live tickets; `points * 200` hard-coded instead of `POINT_VND_RATE`. [mocks/data/rewards.ts:555,569,571]
- [x] [Review][Patch] (medium) `daily` omits zero-count days (chart gaps, inflated `avgPerRegularDay`, wrong `dailyChartSummary`); fill all days in range. [mocks/data/rewards.ts rewardsStatsOf]
- [x] [Review][Patch] (medium) `flashRowView` subtitle: raw enum "Kết thúc sớm · WRONG_PRICE" (map to Vietnamese labels, share with REASONS); SOLD_OUT should read "Hết suất sau N phút". [lib/admin/rewards-flash-view.ts:~42]
- [x] [Review][Patch] (medium) Create rejects false `FLASH_QUOTA_EXCEEDS_STOCK` because ended-but-unsettled flash still holds quota until a list/mutation runs; settle before conflict check. `GET` handlers mutating store (`adminFlashSalesOf`) is mock-only side effect. [mocks/data/rewards.ts:~215-234]
- [x] [Review][Patch] (medium) `flashFormErrors`: same-key conflicts overwrite each other; empty `startsAt` shows "phải ở tương lai"; duplicate-voucher refine shows "Chọn ít nhất một voucher"; item Zod messages in English. [lib/admin/rewards-flash-view.ts:~46-62]
- [x] [Review][Patch] (low) Seed flash metadata all zero (remindCount/participants/failures/afterTopUp/endReason) so UPCOMING subtitle reads "0 người đã bấm Nhắc tôi" and ended history empty; seed realistic values. [mocks/data/rewards.ts:26]
- [x] [Review][Patch] (low) Flash code suffix `flashes.length % 26` can duplicate a code; derive from per-day count with uniqueness check. [mocks/data/rewards.ts:497]
- [x] [Review][Patch] (low) Schema `endsAt > startsAt` string compare misses mixed `Z`/`.000Z`; compare `Date.parse`. `statsRange` returns inverted range when `from` is in the future. [packages/schemas/src/rewards/rewards-admin.schema.ts, mocks/data/rewards-rules.ts statsRange]
- [x] [Review][Patch] (low) Stats UI: KPI detail drops range ("30 ngày · trung bình …"); footnote misses flash crossing midnight; tooltip should read "FS-0928: 100 suất Flash, hết sau 38 phút"; hard-coded hex colours (`#e5e7eb`, `#f97316`, `#a3a3a3`) → tokens/dark mode. [lib/admin/rewards-stats-view.ts, voucher-stats/components/VoucherStatsScreen.tsx]
- [x] [Review][Patch] (low) Form UI deviations: voucher caption placeholder "tồn kho từ máy chủ" instead of "còn N mã chưa giữ"; per-user cap free input vs `Select` default 1; native checkboxes vs `Toggle`; "Kết thúc sớm" confirm not danger variant. [FlashSaleFormScreen.tsx, FlashSalesScreen.tsx]
- [x] [Review][Patch] (medium) Tests missing per Task 7: flashProgress branches, `FLASH_STARTS_IN_PAST`/`VOUCHER_NOT_FLASHABLE`/`FLASH_QUOTA_BELOW_SOLD`, stock identity across create/update/end/settle, stats (refund exclusion, live ticket, empty range), all five `flashRowView` states, exact `endEarlyCopy`, `previewFlashItem` vs schema, 409 `details.conflicts` hybrid test, source-guard test (7.6), valid-create/update/end hybrid tests.
- [x] [Review][Patch] (medium) Verification evidence missing: no `npx tsc --noEmit` result (8.1); manual browser check (8.2) and pilot build check (8.3) not done. _2026-10-13 patch pass: `npx tsc --noEmit` done and green (item 8.1 evidence below); 8.2 manual browser check and 8.3 pilot build NOT done, so this item stays open._

_Dismissed as noise/handled: Zod `.default({})` on zod 3 OK; chart colours dark-mode already counted above; component decomposition (Dev Notes allow merging). Dismissed: 3._

## Dev Notes

### Scope boundaries (read first)

- **In:** Admin Flash Sale list + live monitoring of the active program, create/edit form with validation and the User Portal `FlashSaleCard` preview, early end with confirmation, the statistics dashboard (5 KPIs, redemptions by day, by brand, Flash performance, definitions), two sidebar entries, six mock routes and rules, additive contract changes, pilot hiding, the "Tạo Flash Sale" menu item deferred by 12.5.
- **Out:**
  - Exactly-once start/end jobs, real quota reservation at start, DB uniqueness for `(flashItemId, userId)`: Story 12.9 backend. The mock reserves at create and settles lazily (documented deviation).
  - Per-user cap enforcement, eligibility rules (BR-02 survey in 30 days, BR-21 FraudLog) as redemption checks: Stories 12.8/12.9. This story only stores the toggles in the program (`rules`).
  - "Nhắc tôi" button/reminder delivery and the 10-minute notification: user side is later (12.10); `remindCount` is a seeded number displayed read-only.
  - Draft saving ("Bản nháp", Figma `138:287`), cancelling a not-started program, duplicate program: not in the ACs or the contract. A not-started program is edited, not deleted (record as an open point).
  - Audit log writes (FR-ADD-13) and second-Admin approval: backend 12.7/12.9.
  - CSV/PDF export of statistics: the Figma header has a button (`140:104`); check its label in the screenshot and, only if it is an export, implement a client-side CSV of the `daily` and `byBrand` rows from the payload; otherwise omit it. Record the decision.
  - Any backend and the feature flag (Story 12.11).
- **Gates:** FE-mock only, behind `PILOT_BUILD` (service self-gate + page guard + proxy 404 + nav spread).
- **Contract status:** extends the Story 12.1 **ASSUMED API CONTRACT** (`rewards-admin.schema.ts`) the same way 12.5 did. Story 12.7/12.9 must implement it.

### Business rules → where they land

| Rule | Behaviour in this story |
|---|---|
| BR-17 | Window is `[start, end)` server time in Asia/Ho_Chi_Minh; when it ends, sells out or is ended early the regular price returns immediately (`effectiveVoucherPrice` already does this; do not duplicate it) |
| BR-05 | Quota is taken from regular stock; unsold quota returns on end/early end exactly once (mock: reserve at create, return in `settleEndedFlashes`/early end) |
| BR-18 | Overlap (same voucher, intersecting windows), Flash price < regular, quota ≤ unreserved stock; all three are server rules in `flashConflicts` and are shown per row |
| BR-19 | `perUserCap` per item, default 1, stored and displayed ("mỗi người 1 suất mỗi voucher"); enforcement is backend |
| BR-02 / BR-21 | Stored as `rules` toggles; "activated only" always on |
| Server time | Countdown and every state shown to the Admin come from `serverTime`; the client clock never decides |

### Derived status and copy

- Program status comes from the server payload (`status`); the client never re-derives it. Item badges: "Hết suất" when `sold >= quota`.
- Planning-default assumptions to record in Completion Notes: UPCOMING = starts within 24 h, SCHEDULED = later; regular price for the "Flash below regular" check = `promoPoints ?? basePoints`; max duration 6 h (from Figma helper text); end reasons list is an assumption.
- Numbers on the dashboard use `formatPoints`/`formatVnd` from `lib/rewards/voucher-display.ts`; Vietnamese number format with `.` thousands and `,` decimal (`74,7%`).

### Field messages (Vietnamese, per `flashFormErrors`)

| Path / code | Message |
|---|---|
| `title` | "Nhập tên chương trình (tối đa 60 ký tự)." |
| `startsAt` / `FLASH_STARTS_IN_PAST` | "Giờ bắt đầu phải ở tương lai." |
| `endsAt` (before start) | "Giờ kết thúc phải sau giờ bắt đầu." |
| `endsAt` (> 6 h) | "Flash Sale dài tối đa 6 giờ." |
| `items` (empty) | "Chọn ít nhất một voucher." |
| `items.N.flashPoints` / `FLASH_PRICE_NOT_BELOW_REGULAR` | "Giá Flash phải thấp hơn giá hiện tại ({n} điểm)." |
| `items.N.quota` / `FLASH_QUOTA_EXCEEDS_STOCK` | "Tối đa {available} suất chưa giữ." |
| `items.N.quota` / `FLASH_QUOTA_BELOW_SOLD` | "Không thể thấp hơn {sold} suất đã đổi." |
| `items.N.voucherId` / `FLASH_OVERLAP` | "Trùng giờ với {code}." |
| `items.N.voucherId` / `VOUCHER_NOT_FLASHABLE` | "Voucher này không thể đưa vào Flash Sale." |
| unknown path | the Zod message |

### Architecture rules that bind the UI

- **No client-side money or stock logic.** Stock, reserved, sold, unsold, status, ETA, KPIs and every conflict come from the server payload (mock functions play the server). The client formats, joins and previews only.
- **Authoritative validation = shared schema.** The form imports `adminFlashSaleInputSchema` and `adminFlashEndRequestSchema` from `@rescom/schemas`.
- **Preview uses the real component.** `FlashSaleCard` (and `Countdown`) from `app/(signed-in)/(app)/rewards/components/` are imported as-is; adapt data, not the component. If the admin console cannot import across route groups cleanly, move nothing: import by the `@/app/...` path like other cross-feature imports, and mention it in Completion Notes.
- **Destructive action needs a confirm dialog with the effect stated** (early end). Creating/editing needs no dialog.
- **Idempotency:** admin writes, no `Idempotency-Key`; CSRF on all writes. Early end is safe to retry: second call returns 409 `FLASH_ALREADY_ENDED`, which the UI treats as "already ended", not as a failure.
- **Admin-only, desktop-only:** `(admin)` route group + `SessionGate requireAdmin` protect the pages; mock handlers use the same guard as 12.5.
- **Accessibility:** real `<th scope>`, progress bars always show the numbers, status as text, dialogs trap focus and return it to the trigger, toggles are labelled switches, errors reach the field via `aria-describedby`, the chart has a text alternative, Countdown announces only on minute change (already built into `Countdown`).

### Existing code to reuse (do not reinvent)

| Need | Use |
|---|---|
| Admin frame/header | `components/layout/admin/AdminShell.tsx`, `AdminPage.tsx`, `admin-nav.ts` |
| Admin screens as pattern | `app/(signed-in)/(admin)/admin/vouchers/*` (12.5: `VouchersScreen`, `VoucherFormScreen`, hooks), `users/*`, `top-ups/*` |
| Handlers | `mocks/handlers/rewards-admin.ts` (12.5) incl. its guard helpers; `mocks/envelope.ts` `ok`, `fail`, `missingCsrf`; `mocks/scenarios.ts` |
| Mock data/rules | `mocks/data/rewards.ts` (`rewardsCatalog`, `rewardsState`, `flashSalesAt`, `adminVouchersOf`), `mocks/data/rewards-rules.ts` (`effectiveVoucherPrice`, `adminStockOf`, `adminVoucherStatus`, `decideRedemption`, `discountPercent`) |
| Service/HTTP | `lib/admin/rewards-vouchers-service.ts` (pattern, and the voucher list for the picker), `lib/api/client.ts`, `lib/api/use-api-query.ts` |
| Server clock | `lib/rewards/server-clock.ts` |
| User components | `rewards/components/{FlashSaleCard,Countdown,VoucherThumb}.tsx` |
| UI primitives | `components/ui/{Button,Dialog,Toggle,SegmentedControl,Chip,Tag,TextField,Textarea,Select,Alert,ProgressBar,Spinner,Icon}` |
| Dates | `lib/format/date-time.ts` (Vietnam helpers: `formatDayMonth`, `formatTime`, `vietnamDateKey`) |
| Charts | `recharts` (^3.10.1, used by the survey analytics screens: reuse their chart wrapper/tokens and accessibility approach) |
| Rate/consts | `POINT_VND_RATE` from `@rescom/schemas` |

### Files

**NEW**
- `apps/frontend/my-app/lib/admin/rewards-flash-service.ts`, `rewards-flash-view.ts`, `rewards-stats-view.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/flash-sales/{page.tsx,new/page.tsx,[id]/edit/page.tsx}`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/flash-sales/components/{FlashSalesScreen,ActiveFlashPanel,FlashSalesTable,EndEarlyDialog,FlashSaleFormScreen,FlashPreviewPanel}.tsx` (merge small ones; split past ~300 lines)
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/flash-sales/hooks/use-admin-flash-sales.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/voucher-stats/{page.tsx,components/{VoucherStatsScreen,StatsKpis,DailyRedemptionsChart,FlashPerformanceList,BrandBreakdown,DefinitionsCard}.tsx,hooks/use-rewards-stats.ts}`
- `apps/frontend/my-app/tests/rewards-admin-flash.test.mjs`, `tests/rewards-admin-flash-view.test.mjs`

**UPDATE** (read each whole file first; preserve everything not listed)

| File | Today | Change | Must preserve |
|---|---|---|---|
| `packages/schemas/src/rewards/rewards-admin.schema.ts` + `.spec.ts` | 12.1 flash/stats schemas + 12.5 voucher schemas | Task 1 additions | every existing schema/refinement and spec case (fixtures gain `title`) |
| `apps/frontend/my-app/mocks/data/rewards-rules.ts` | pricing/redeem/ticket/admin-voucher rules; `FlashInventory` | `FlashInventory` fields + 5 pure rules | all existing rules and their tests |
| `apps/frontend/my-app/mocks/data/rewards.ts` | seed (flashes FS-1013-A/B), user flows, 12.5 admin functions | seed flashes + 2 ended, `statsBaseline`, 5 admin functions, lazy settlement | redeem/idempotency behaviour, one update per collection, `flashSalesAt` output for the user strip, stock identity |
| `apps/frontend/my-app/mocks/db/store.ts` | `SCHEMA_VERSION = 8` | 9 | everything else |
| `apps/frontend/my-app/mocks/handlers/rewards-admin.ts` | 9 voucher routes | + 6 routes | existing handlers and guards |
| `apps/frontend/my-app/mocks/route-allowlist.ts` | DEFERRED_KEEP_MOCK 35 | 41 | other entries |
| `apps/frontend/my-app/components/layout/admin/admin-nav.ts` | Voucher entry | + Flash Sale, Thống kê voucher (pilot-hidden) | queue badges, quality/voucher spreads |
| `apps/frontend/my-app/lib/pilot-scope.ts`, `proxy.ts` | hidden routes incl. `/admin/vouchers…` | + 4 | order/comments |
| `apps/frontend/my-app/lib/admin/rewards-vouchers-view.ts` + its test | `voucherActionsOf` (no Flash item) | + "Tạo Flash Sale" | all other actions, archived rule |
| `apps/frontend/my-app/tests/helpers/frontend-callsites.mjs` | rewards entries | + 6 | others |
| `apps/frontend/my-app/tests/route-diff.test.mjs`, `tests/hybrid-mocking.test.mjs` | counts 35 | 41 | other tests |

### Deviations from Figma (deliberate, record in Completion Notes)

| Figma | This story | Why |
|---|---|---|
| 26 row "Bản nháp · chưa xem trước" | status SCHEDULED, subtitle "Hẹn lịch · tạo bởi {name}" | no draft concept in the contract |
| 26b header buttons beyond Huỷ/Lên lịch | only Huỷ and primary save | drafts not in contract |
| 26c exact bullet numbers (57 = 25 + 32, 173 successes) | same copy, numbers from the mock payload | seeded numbers; Figma ones are illustrative |
| 26 "312 người đã bấm Nhắc tôi", 27 sample numbers (1.397, 233.170…) | seeded values; stats are baseline + live tickets | no reminder feature or real history in the mock |
| 26 "Đổi trong 24 giờ sau khi nạp" (`146:4127`) | seeded `afterTopUp`, read-only | needs Economy data; backend 12.9 |
| BR-05 reserve at start | reserve at create | no scheduler in the mock |
| 27 header button `140:104` | decided at implementation (export or omitted) | label not verified in metadata |

### Gotchas checklist

1. **Do not break the user Flash flow.** The admin writes mutate the same `rewardsCatalog` the 12.2/12.3 pages read. After seeding old/ended flashes, `flashSalesAt` must still return the same user-facing strip (active + upcoming + recently ended within 1 day). Run the existing `rewards-*` tests first.
2. **Stock identity:** creating a flash lowers `stockRemaining`; `adminStockOf` already adds non-ended flash quota back as `flashReserved`, so `issued` must not change by a create. If it does, the formula or the seed is inconsistent: fix the seed numbers or the reservation, not the 12.5 formula. `codesAvailable` must stay in sync.
3. **Existing flash seed uses `now`-relative times** (`FS-1013-A` started 3 h ago). Stats' "today" and the Figma "13/10 13:00" are illustrative; build the baseline relative to `Date.now()` and aligned to Vietnam day boundaries, and never hardcode 2026 dates.
4. **Pilot literal scan** (`tests/pilot-scope.test.mjs`): `/admin/flash-sales…`, `/admin/voucher-stats` and `/admin/rewards/flash-sales|stats` literals are allowed only inside their hidden dirs, inside functions that check `PILOT_BUILD`, or in `admin-nav.ts`/`pilot-scope.ts`/`proxy.ts` as the tests allow. Read the test before adding the nav entries; the 12.5 "Tạo Flash Sale" link literal lives in the hidden vouchers dir, so build it there or in a guarded helper.
5. **Every deferred route needs a caller** (strict equality in `route-diff`/`contract-callsites`): service function, `CALL_ALLOWLIST` entry and `DEFERRED_KEEP_MOCK` entry together. `GET /admin/rewards/flash-sales/:id` needs a caller too (the edit page).
6. **Route literal format differs:** allowlist/handlers `:id`, `CALL_ALLOWLIST` `:param`, pilot routes `[id]`, proxy `:id`.
7. **Mock persistence:** catalog shape changed → bump `SCHEMA_VERSION` or old localStorage fails parsing.
8. **Half-open windows:** `[start, end)` everywhere (touching programs are allowed); test the boundary.
9. **Time zones:** `datetime-local` values are Vietnam local time; convert with the Vietnam helpers to ISO instants (UTC+7, no DST); test a value near midnight; day buckets in stats use the same helper.
10. **Hooks before early returns**; abort/stale-guard effect fetches (treat `AbortError` as "stop"); memoize anything derived from server time; a polling interval must be cleaned up and paused when `document.hidden`.
11. **Next 16:** new `page.tsx` files use async `params` (`params: Promise<{ id: string }>`); read `node_modules/next/dist/docs/` routing notes first (static `new` vs dynamic `[id]/edit`).
12. **Recharts + React 19 / SSR:** render the chart in a client component with a fixed-height container (`ResponsiveContainer` needs a sized parent) and no layout shift between skeleton and chart; copy the survey analytics setup instead of tuning a new one.
13. **Scenarios:** `?msw=<scenario>` persists in localStorage; use `api-error`/`api-offline` to check error states, then `?msw=default`.
14. **Admin mock user:** `admin@rescom.vn` (see `mocks/db/session.ts`, `admin-users.test.mjs`); non-admin gets 403.
15. **Quote after early end:** the existing `decideRedemption` is the only place that produces `PRICE_CHANGED`; verify with a real quote created before the early end, do not add a Flash-specific branch.

### Testing standards

- `node --test tests/*.test.mjs` (`npm test` builds `@rescom/schemas` first). Import pure TS directly; mock data/rules are importable like `rewards-mock.test.mjs`. Reset the store between cases with the helper used there.
- Schemas: jest `src/**/*.spec.ts`.
- Components are covered by pure helpers, handler tests and the manual check (Task 8.2); no new test framework.

### Project Structure Notes

- Admin pages follow `app/(signed-in)/(admin)/admin/<section>/{page.tsx,components,hooks}`; services in `lib/admin/`; pure view logic in `lib/admin/*-view.ts`; admin rewards mock handlers stay in `mocks/handlers/rewards-admin.ts`.
- Exports use `adminFlash*` / `rewardsStats*` names, never bare `reward*` (12.1 collision rule).

### Previous story intelligence (12.5, done on branch `feat/12-5-admin-voucher-catalog-codes`; 12.4 merged via PR #20)

- Same pipeline: schema additions → rules → data → handlers → allowlist → service → view logic → UI → tests. 12.5 took DEFERRED_KEEP_MOCK 26 → 35, `SCHEMA_VERSION` 7 → 8, put pure rules in `mocks/data/rewards-rules.ts`, view logic in `lib/admin/*-view.ts`, and verified by a Safari MSW walkthrough.
- 12.5 review lessons to apply here: derive row status from the **server** field, not the client (add `status` to the payload; done in Task 1); do not match by title/brand workarounds, join by id; show 404 separately from network/500 errors on detail/edit pages; handle `409` conflicts by reloading and telling the Admin; `vietnamIso` must tolerate seconds (use the shared helper); form must surface errors for **every** field with `aria-describedby`; avoid a hand-written menu that ignores the pure `...ActionsOf` function; keep a failed multi-step save from being retried blindly (here a single call, so just guard double submit); test exact copy, not just existence; compute totals over the full set, not a truncated list.
- 12.5 state at the time of writing: its code is **uncommitted on the working tree** (modified files in `git status`) while `sprint-status.yaml` already says `done`. Commit/merge 12.5 and branch 12.6 from the updated `origin/develop` (`feat/12-6-admin-flash-sale-rewards-stats`) before implementing, because 12.6 edits the same files (`rewards-admin.ts`, `rewards.ts`, `rewards-rules.ts`, `admin-nav.ts`, `pilot-scope.ts`, `proxy.ts`, allowlist, callsites, the two gate tests).
- Code style in the Rewards mock files is compact (long lines, destructuring); match it in `rewards-rules.ts`/`rewards.ts`; admin UI files follow the more conventional style of the existing admin screens.

### Git intelligence

- `7904252` PR #20 (12.4); `b047c21` 12.4 implementation; `54f1067`/`53a9ba5` 12.3 (quote/redeem, callsite strictness); `d241be8` PR #18 (12.2); earlier `3c5b142` 12.2, `cecbb0e` 12.1 (contracts, mock domain, allowlist, flash seed). 12.5's work is not yet in history (uncommitted).

### Latest tech information

- No new dependency. Charts use the existing `recharts` ^3.10.1; Next 16.3 / React 19.2 / Zod per `package.json`; read `node_modules/next/dist/docs/` before adding pages (project `AGENTS.md`).

### Open points for the dev agent to confirm with Quan (do not block)

- Whether a not-started Flash Sale needs a "Huỷ chương trình" action (not in ACs; assumed edit-only).
- Planning defaults recorded here: UPCOMING within 24 h, 6 h maximum duration, regular price = `promoPoints ?? basePoints`, end-reason list.
- Whether the stats header button is an export (verify in Figma `140:104`).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 intro, Story 12.6, 12.7 and 12.9 (backend for this story)]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-13.md` FR-73, FR-72; BR-02, BR-05, BR-17–BR-19, BR-21; Open Questions 23 and 26]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` AD-24]
- [Source: `_bmad-output/implementation-artifacts/12-5-admin-voucher-catalog-codes.md` (patterns, review findings, deferred items)]
- [Source: `_bmad-output/implementation-artifacts/12-1-rewards-contracts-msw-mock-domain.md` §C `rewards-admin.schema.ts`, Seed]
- [Source: Figma `mkudD5Ngi5RPyIAVxCcxXi` page 26 `113:9`: monitor/list `138:8` (active panel `138:105`, totals `138:208`, table `138:221`), create + preview `139:170` (form `139:259`, preview `139:389`), end-early dialog `139:493` (dialog `139:668`); page 27 `140:2` (KPI `140:115`, daily chart `140:137`, Flash performance `140:197`, brand table `140:225`, definitions `140:274`); page 20 `113:3` AdminSidebar, FlashSaleCard, Countdown, Badge]
- [Source: `apps/frontend/my-app/mocks/data/rewards.ts`, `mocks/data/rewards-rules.ts`, `mocks/handlers/rewards-admin.ts`, `mocks/route-allowlist.ts`, `components/layout/admin/admin-nav.ts`, `lib/pilot-scope.ts`, `proxy.ts`, `tests/pilot-scope.test.mjs`, `tests/contract-callsites.test.mjs`, `tests/helpers/frontend-callsites.mjs`, `tests/route-diff.test.mjs`, `tests/hybrid-mocking.test.mjs`, `app/(signed-in)/(app)/rewards/components/{FlashSaleCard,Countdown}.tsx`]

## Dev Agent Record

### Agent Model Used

- Antigravity (shared-workspace subagents for UI, services/view logic, and mock handlers).

### Debug Log References

- Patch pass 2026-10-13: `npx tsc --noEmit` clean; `npm test` (apps/frontend/my-app) 886 passed, 0 failed; `npm run lint` 0 errors, 1 pre-existing-style false-positive warning (`pathToFileURL` used only inside a loader string in `tests/rewards-admin-flash.test.mjs`); schemas jest 44 suites, 631 passed.

- Frontend test: `/tmp/rescom-12-6-frontend-test.log` (867 passed).
- Schema Jest: `/tmp/rescom-12-6-schemas.log` (44 suites, 631 passed).
- Frontend lint: `/tmp/rescom-12-6-lint.log`.

### Completion Notes List

- Review patch pass 2026-10-13 (all `[Review][Patch]` items except the open verification item):
  - Seed: every unsettled seed program (101, 102 and also 103) is now carved out of regular `stockRemaining`; voucher 5 (9 left, quota 50) grows `stockTotal` by the quota instead of going negative. `SCHEMA_VERSION` 10. Domain test pins the numbers (80/10/84/12, voucher 5 total 130) and that ending a seed program returns exactly `quota - sold`.
  - Contract: `adminFlashSaleItemSchema.etaAt`; `endsAt > startsAt` compares `Date.parse`. Real sell-out time stored per item (`soldOutAt`, set on the redeem that reaches the quota; seeded for the sold-out items), `flashProgress` stops the rate at sell-out/early end/window end; ETA and `soldOutAt` come from the payload and the client only formats.
  - Stats: baseline slides with `now`, live tickets use the persisted catalog `statsSeededAt`; `daily` is zero-filled over the range; `offered` = stock of vouchers whose window overlaps the range (capped so rate <= 1); usage rate denominator fixed; `POINT_VND_RATE`; upcoming programs neither mark a Flash day nor appear in performance; `soldOutAfterMinutes` from real times; `statsRange` clamps an inverted range.
  - Mock: ended programs settle before create/update/end conflict checks (`settledCatalog`); the GET list still settles lazily (mock-only write, commented); Flash code letter is unique per start day.
  - UI: list screen now uses `monitorItemView`/`monitorTotals`/`row.actions`, polls every 30 s through stable `reload`, clock initialised from `Date.now()` and offset by `serverTime`; SOLD_OUT programs render the live panel; create form no longer requests `/flash-sales/new`; 404 vs network on edit; 409 `FLASH_ALREADY_STARTED`/404 handled; voucher caption "còn N mã chưa giữ"; per-user cap `Select` (1-5, default 1); `Toggle`s; danger confirm button; chart uses analytics tokens (no hex), custom tooltip with "FS-0928-A: 100 suất Flash, hết sau 38 phút", KPI detail keeps the range, footnote covers programs crossing midnight.
  - View logic: end-reason labels shared (`FLASH_END_REASONS`), SOLD_OUT/ENDED sold-out subtitle "Hết suất sau N phút", `monitorTotals` string "21 · hết suất 14, thiếu điểm 7", `flashFormErrors` keeps multiple messages per field and speaks Vietnamese for empty dates, duplicate vouchers and item fields. `flashRowView`, `monitorItemView` and `previewFlashItem` dropped their unused time/start parameters.
  - Not done: Task 8.2 manual browser check and 8.3 pilot build (no browser run, no `next build` in this pass); the pilot scan is only covered by the static `pilot-scope` test.

- Implemented additive schemas, six deferred mock endpoints, quota reservation/settlement, Vietnam-day statistics, admin services/views, Flash Sale and statistics pages, pilot guards, and voucher create-Flash link. No backend changes or new dependencies.
- Mock reserves stock at creation and lazily settles ended sales; production scheduling remains Story 12.9. UPCOMING means within 24 hours, regular price is `promoPoints ?? basePoints`, maximum window is 6 hours; end reasons remain planning defaults.
- Existing User Portal card powers preview. Draft/cancel, notification delivery, eligibility enforcement, export, and production jobs omitted per story scope; Figma header export label could not be verified.
- Automated frontend and schema suites passed; manual browser walkthrough (Task 8.2) not performed because no browser integration or installed Playwright was available. Keep story `in-progress` until that check and pilot 404/nav verification are completed.

### File List

- `packages/schemas/src/rewards/rewards-admin.schema.ts`, `rewards-admin.schema.spec.ts`
- `apps/frontend/my-app/mocks/data/rewards-rules.ts`, `rewards.ts`, `mocks/db/store.ts`, `mocks/handlers/rewards-admin.ts`, `mocks/route-allowlist.ts`
- `apps/frontend/my-app/lib/admin/rewards-flash-service.ts`, `rewards-flash-view.ts`, `rewards-stats-view.ts`, `rewards-vouchers-view.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/flash-sales/**`, `admin/voucher-stats/**`, `admin/vouchers/components/VouchersScreen.tsx`
- `apps/frontend/my-app/components/layout/admin/admin-nav.ts`, `lib/pilot-scope.ts`, `proxy.ts`
- `apps/frontend/my-app/tests/rewards-admin-flash-domain.test.mjs`, `rewards-admin-flash.test.mjs`, `rewards-admin-flash-view.test.mjs`, `rewards-admin-vouchers-view.test.mjs`, `hybrid-mocking.test.mjs`, `route-diff.test.mjs`, `helpers/frontend-callsites.mjs`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`, this story.

### Change Log

- 2026-10-13: Story created (ready-for-dev).
- 2026-10-13: Implemented FE + MSW scope; pending manual browser and pilot verification before review.
- 2026-10-13: Applied review patches (see Completion Notes); 8.2 manual and 8.3 pilot build still open.
- 2026-10-15: Close-out: re-verified on develop, ticked tasks, status → review.

### Review verification 2026-10-13 (8.2 / 8.3)

- 8.3 done: `NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled next build` passes; `next start`: `/admin/flash-sales`, `/admin/flash-sales/new`, `/admin/flash-sales/abc/edit`, `/admin/voucher-stats` → 404 while `/admin`, `/admin/surveys`, `/admin/top-ups` → 200. Sidebar entries gated by `PILOT_BUILD` in `admin-nav.ts` (static test only, not eyeballed).
- 8.2 partial (Chrome automation, 452px viewport, mock admin): verified five-state list, live panel (struck regular price, speed/ETA, totals), no `GET /flash-sales/new` on create, errors `Trùng giờ với FS-1013-B.` / `Giá Flash phải thấp hơn giá hiện tại (200 điểm).` / `Tối đa 12 suất chưa giữ.`, `FlashSaleCard` preview. Found and fixed a hydration error (`<div>`/`<p>` inside `<p>` around `Countdown`, `FlashSalesScreen.tsx`).
- NOT checked: valid create + edit, end-early confirm and user-side price return, `/admin/voucher-stats`, countdown ticking (stayed `02:15:02` across minutes in the automation tab, ~3 min off wall clock; `document.hidden` gate suspected, unconfirmed). Quan to check these in a visible tab.
- After the `<p>`→`<div>` fix: `tsc --noEmit` 0 errors, `npm test` 886/886.

- 8.2 completed: Quan manually verified valid create/edit, end-early + user-side price return, `/admin/voucher-stats`, countdown ticking in a visible tab — all passed (2026-10-13; recorded in `e6dedbd`, which never reached develop).

### Close-out 2026-10-15

- Story code shipped via PR #23 (`8b621d1`); task checkboxes were never ticked and the status commit `e6dedbd` stayed on the old branch. Re-verified on `origin/develop` `14909f6` (includes 12.7–12.13): `npm test` 904/904, `npx tsc --noEmit` 0 errors, `npm run lint` 0 errors (1 known warning), schemas jest 46 suites / 635 passed. Tasks 1–8 ticked on that evidence; status → review.
