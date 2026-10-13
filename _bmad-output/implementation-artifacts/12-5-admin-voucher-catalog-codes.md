---
baseline_commit: 7904252c24eb4360378cee3aca2bdcc749efffaf
---
# Story 12.5: Admin Voucher Catalog & Codes

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want to create vouchers, upload codes, and manage stock and price,
so that the catalog stays accurate and never oversells.

## Acceptance Criteria

1. **List.** Given an Admin in the Admin console, when they open Voucher (new sidebar entry), then the list shows each voucher's status, stock, price and visibility toggle, plus an action menu with pause, hide and archive (Figma page 25 `134:8`, FR-72).
2. **Create/edit.** Create/edit shows a live VoucherCard preview and field-level validation (code expiry at least 7 days after the redemption window, shared-code flag) (Figma `135:208`).
3. **CSV upload.** CSV upload reports in-file duplicates and already-stored codes before saving.
4. **Stock and price.** Stock adjustment cannot go below issued plus Flash-reserved units, and a price change shows that it applies only to future redemptions.
5. **Detail.** Voucher detail shows stock, price history and redemption history (Figma `136:425`).

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.5 (FR-72; BR-04, BR-06, BR-10, BR-12, BR-13, BR-14, BR-15, BR-16; Open Question 23 planning default for BR-13). FE + MSW mock only; backend is Story 12.7.

## Tasks / Subtasks

- [x] **Task 1: Contract additions (`packages/schemas/src/rewards/rewards-admin.schema.ts`, additive)** (AC: 1–5)
  - [x] 1.1 `adminVoucherListSchema = z.object({ items: z.array(adminVoucherSchema), summary: z.object({ total, active, paused, soldOut, expired, hidden, archived, lowStock: z.array({ voucherId, label }) , codesAvailable, flashReserved, activeFlashSales }), serverTime })`. `lowStock` = remaining ≤ 10 % of total and > 0 (Figma "Sắp hết (≤ 10%)").
  - [x] 1.2 `adminVoucherListQuerySchema = { filter: z.enum(["ALL","ACTIVE","PAUSED","SOLD_OUT","EXPIRED","HIDDEN"]).default("ALL"), q: string trim 1..100 optional }`. Filters are derived (see Dev Notes → Derived status).
  - [x] 1.3 `adminVoucherStatePatchSchema = z.object({ state: adminVoucherStateSchema.optional(), isVisible: z.boolean().optional() }).refine(v => v.state !== undefined || v.isVisible !== undefined)` (pause = `state: PAUSED`, resume = `ACTIVE`, archive = `ARCHIVED`, hide/show = `isVisible`).
  - [x] 1.4 `adminVoucherBrandListSchema = z.object({ items: z.array(voucherBrandSchema) })`.
  - [x] 1.5 `adminVoucherDetailSchema` stays as is. Add `adminVoucherCreatedSchema = z.object({ voucher: adminVoucherSchema })` (create/edit/patch/price/stock response; the detail page re-reads the detail).
  - [x] 1.6 Export inferred types (`AdminVoucherListDto`, `AdminVoucherStatePatchDto`, …) next to the existing ones in `index.ts` re-exports. Names stay `adminVoucher*`/`rewardsStats*` (never bare `reward*`).
  - [x] 1.7 Spec cases in `rewards-admin.schema.spec.ts`: each new schema accepts a valid payload and rejects the invalid one; list `summary` keys; empty patch rejected. Keep existing cases.
- [x] **Task 2: Mock domain (rules + data + handlers)** (AC: 1–5)
  - [x] 2.1 `mocks/data/rewards-rules.ts` — add pure rules (no state, time passed in), each unit tested:
    - `adminStockOf(v, flashes, now)` → `{ total, issued, flashReserved, remaining, codesAvailable }` with `remaining = v.stockRemaining`, `flashReserved = Σ (quota − sold)` over items of flashes that are not ended (`now < endsAt` and not `endedEarlyAt`), `issued = total − remaining − flashReserved`. Must satisfy the schema refine and `issued ≥ 0` for every seeded voucher (adjust the seed numbers, not the formula, if one does not).
    - `adminVoucherStatus(v, flashes, now)` → `"ACTIVE" | "PAUSED" | "SOLD_OUT" | "EXPIRED" | "HIDDEN" | "ARCHIVED"` for the list filter and the status Tag (priority: ARCHIVED, HIDDEN (`!isVisible`), PAUSED, EXPIRED (`now >= redeemEndsAt`), SOLD_OUT (remaining 0 or no codes), ACTIVE). Reuse `voucherAvailability` instead of copying its conditions.
    - `priceDeviationPercent(valueVnd, basePoints)` → `round((basePoints / (valueVnd / POINT_VND_RATE) − 1) × 100, 1)`; import `POINT_VND_RATE` from `@rescom/schemas`.
    - `validateVoucherInput(input, existing?)` → `{ path, code }[]` for the server-only rules the Zod schema does not cover: `codeExpiresAt >= redeemEndsAt + 7 days` is already in the schema; add "brand exists", "edit may not shorten `redeemEndsAt` below now", "shared-code flag cannot change once any code was issued" (BR-14).
    - `stockAdjustmentDecision(v, stock, nextTotal)` → `{ ok:false, status:409, code:"STOCK_BELOW_COMMITTED", details:{ minimum: issued + flashReserved } }` when `nextTotal < issued + flashReserved`; `{ ok:false, status:409, code:"STOCK_INCREASE_NEEDS_CODES" }` when `nextTotal > total` and `!v.isSharedCode` (individual stock grows only by importing codes); `{ ok:false, 409, "STOCK_EXCEEDS_CODES" }` when reducing would require removing more unissued codes than exist; else ok with `removeCodes = total − nextTotal`.
    - `importCodesDecision(codes, stored)` → `{ duplicatesInFile, alreadyStored, accepted }`. Compare **case-sensitively after trim**; `duplicatesInFile` lists each repeated code once; `accepted = received − duplicates − alreadyStored` only when both lists are empty (BR-15 rejects the whole file); else `accepted: 0` and `committed: false`.
  - [x] 2.2 `mocks/data/rewards.ts`:
    - Add `priceHistory: Record<voucherId, {version, basePoints, promoPoints, effectiveFrom, changedBy}[]>` to the catalog collection state; seed one version per voucher (`changedBy: { id, name: "Admin Hùng" }`, `effectiveFrom` = `redeemStartsAt`). Bump `SCHEMA_VERSION` 7 → 8 in `mocks/db/store.ts`.
    - Admin functions (all return `{ ok:true, result } | { ok:false, status, code, details }`, mutate with **one** `rewardsCatalog.update` per call, like `redeemVoucherQuote`): `adminVouchersOf(query, now)`, `adminVoucherDetailOf(id, now)`, `createAdminVoucher(input, admin, now)`, `updateAdminVoucher(id, input, now)`, `patchAdminVoucherState(id, patch, now)`, `changeAdminVoucherPrice(id, change, admin, now)`, `adjustAdminVoucherStock(id, adjustment, now)`, `importAdminVoucherCodes(id, request, now)`, `adminBrands()`.
    - Behaviours: create → `state: ACTIVE`, `isVisible: true`, `priceVersion: 1`, empty `codePools[id]`, `stockTotal/Remaining: 0` (stock arrives with the code import or, for shared codes, with the first stock adjustment), `description/whereToUse` empty strings; new id via `mockId()`. Edit changes title/brand/category/value/dates/terms/howToUse/image/shared flag but **not** prices (prices go through `changeAdminVoucherPrice`; the edit form's price fields call it when changed). A price change appends a `priceHistory` entry, increments `priceVersion` (so open 12.3 quotes get `PRICE_CHANGED`), and does **not** touch existing tickets or history (BR-12). `COMMIT` import appends codes to `codePools[id]`, adds `accepted` to `stockTotal`, `stockRemaining` and `codesAvailable` (individual codes only; a shared-code voucher rejects import with 409 `SHARED_CODE_VOUCHER`). `VALIDATE` returns the same result with `committed: false` and changes nothing. Stock decrease removes `removeCodes` codes from the **end** of the pool, lowers `stockTotal` and `stockRemaining`. Archive is allowed for any voucher; no delete route exists (BR-24: vouchers with redemptions are hidden/archived, never deleted).
    - Detail `redemptions`: join `rewardsState.users[*].tickets` by `voucherId`, dedupe by `reference` (the demo user's seed is cloned under two keys), newest first, max 50; `userLabel` = `"#" + last 4 chars of the user key uppercased`; `kind` from the matching history row. Unknown voucher → 404 `VOUCHER_NOT_FOUND`.
    - `priceDeviationPercent` on every admin row comes from the rule above. BR-13 default (OQ-23 planning default): **warning only**, no second-Admin gate; the save succeeds.
  - [x] 2.3 `mocks/handlers/rewards-admin.ts` (new file, exported array; register in `mocks/handlers/index.ts` next to the other admin handlers). Every handler: `applyScenario("admin")`, `requireMockAdmin()` (from `./admin`), CSRF via `missingCsrf` on writes, Zod parse of the body, `ok()/fail()` envelope. Routes (9):

    | Route | Body / query | Response |
    |---|---|---|
    | `GET /admin/rewards/vouchers` | `adminVoucherListQuerySchema` | `adminVoucherListSchema` |
    | `POST /admin/rewards/vouchers` | `adminVoucherInputSchema` | 201 `{ voucher }` |
    | `GET /admin/rewards/vouchers/:id` | — | `adminVoucherDetailSchema` |
    | `PUT /admin/rewards/vouchers/:id` | `adminVoucherInputSchema` | `{ voucher }` |
    | `PATCH /admin/rewards/vouchers/:id` | `adminVoucherStatePatchSchema` | `{ voucher }` |
    | `POST /admin/rewards/vouchers/:id/price` | `adminVoucherPriceChangeSchema` | `{ voucher }` |
    | `POST /admin/rewards/vouchers/:id/stock` | `adminStockAdjustmentSchema` | `{ voucher }` |
    | `POST /admin/rewards/vouchers/:id/codes` | `adminCodeImportRequestSchema` | `adminCodeImportResultSchema` |
    | `GET /admin/rewards/brands` | — | `adminVoucherBrandListSchema` |

    Validation errors → `400 VALIDATION_ERROR` with `details: error.format()` (the form maps `path`s to fields). Mark each handler `// ASSUMED API CONTRACT: …`, listing its error codes.
  - [x] 2.4 `mocks/route-allowlist.ts`: add the 9 routes to `DEFERRED_KEEP_MOCK` (count 26 → 35) with the same reason string style as the user routes ("rewards admin, Epic 12 (Phase 2; backend Stories 12.7-12.10)").
  - [x] 2.5 Update gate counts 26 → 35 in `tests/route-diff.test.mjs` and `tests/hybrid-mocking.test.mjs` (`hybrid-mocking.test.mjs` asserts "exactly the 26 DEFERRED_KEEP_MOCK handlers, once each" at line ~131-134: update the title and the number; read both files first). In hybrid mode the user is a real backend session, so `requireMockAdmin()` (mock session) would answer 401: check `mocks/hybrid.ts` and, if needed, make the admin handlers accept the hybrid admin the way `rewards.ts` uses `HYBRID_MEMBER`; if hybrid has no admin identity, add a `HYBRID_ADMIN` there and test it in the hybrid test.
- [x] **Task 3: Client service + callsite gates** (AC: 1–5)
  - [x] 3.1 `lib/admin/rewards-vouchers-service.ts` (new; pattern: `lib/admin/users-service.ts`): one function per route using `apiRequest` + the shared Zod schemas. Each function self-gates `if (PILOT_BUILD) throw new Error(...)` exactly like `lib/rewards/rewards-service.ts`. Route literals live only inside those guarded functions (pilot literal scan).
  - [x] 3.2 `tests/helpers/frontend-callsites.mjs`: add 9 `CALL_ALLOWLIST` entries (`:param` format). `contract-callsites` and `route-diff` are strict equality: every DEFERRED route needs a caller.
- [x] **Task 4: Pure view logic `lib/admin/rewards-vouchers-view.ts`** (AC: 1–4)
  - [x] 4.1 `voucherRowView(voucher, now)` → `{ statusLabel, statusTone, stockLabel ("88/500"), reservedLabel ("giữ 25 cho Flash"), priceLabel, priceNote ("Flash 150 · đến 15:00" / "KM 120 · đến 15/10" / null), windowLabel ("01/09 – 30/11"), canToggleVisibility }`. Vietnam dates through `lib/format/date-time.ts`. Reuse `formatPoints`/`formatVnd` from `lib/rewards/voucher-display.ts`.
  - [x] 4.2 `STATUS_FILTERS` (label + key + count from `summary`): "Tất cả N", "Đang phân phối N", "Tạm ngừng N", "Hết hàng N", "Hết hạn N", "Ẩn N".
  - [x] 4.3 `voucherActionsOf(voucher)` → which menu items exist: Sửa thông tin, Điều chỉnh giá điểm, Điều chỉnh tồn kho, Xem lịch sử đổi, Tạo Flash Sale (link target is Story 12.6's page; render disabled with the text "Có trong Story 12.6" is **not** allowed — hide it until 12.6 ships a route), Tạm ngừng/Tiếp tục phân phối, Ẩn/Hiện, Lưu trữ. Archived vouchers offer only "Xem lịch sử đổi".
  - [x] 4.4 `voucherFormErrors(zodIssues)` → `Record<fieldPath, message>` with the Vietnamese messages from Dev Notes → Field messages. Pure, so it is unit tested.
  - [x] 4.5 `parseCodeCsv(text)` → `{ codes: string[]; skippedHeader: boolean; invalid: { line, value }[] }`. Split on `\r?\n`, take the first column (split on `,` or `;`), trim, drop empty lines, skip line 1 only when it fails the code regex **and** equals `code` case-insensitively ("code"/"mã"). Lines failing `/^[A-Za-z0-9-]{4,64}$/` go to `invalid` (shown, blocks save). Strip a UTF-8 BOM. Reject > 5000 codes with the schema limit message.
  - [x] 4.6 `deviationWarning(valueVnd, basePoints)` → `null` when |deviation| ≤ 20 %, else `"Giá điểm lệch {n}% so với giá trị ÷ 200đ — cần kiểm tra trước khi lưu."` (warning, not a block).
  - [x] 4.7 `suggestedPoints(valueVnd)` → `Math.round(valueVnd / POINT_VND_RATE)`.
  - [x] 4.8 `preCheckItems(form, csvResult, now)` → the four "Kiểm tra trước khi lưu" rows from Figma `135:500` (price matches rate, N valid codes with no duplicates, code expiry margin, publish time), each `{ tone: "ok" | "warn", text }`.
- [x] **Task 5: UI (desktop-only, under `app/(signed-in)/(admin)/admin/vouchers/`)** (AC: 1–5)
  - [x] 5.1 Sidebar: add `{ href: "/admin/vouchers", label: "Voucher", icon: "ticket" }` to `ADMIN_NAV` after "Giao dịch", wrapped in the same `PILOT_BUILD ? [] : [...]` spread used for `/admin/quality`. Icon `ticket` already exists. The Flash Sale and Thống kê voucher entries are Story 12.6.
  - [x] 5.2 `vouchers/page.tsx` → `components/VouchersScreen.tsx` (`AdminPage title="Voucher"`, meta "N voucher · M đang phân phối", action = primary Button "Tạo voucher" → `/admin/vouchers/new`). Parts: `VoucherStats` (3 cards: Đang phân phối, Sắp hết (≤ 10%), Mã chưa phát; Figma `134:105`), `VoucherFilters` (status chips as `SegmentedControl` or `Chip`, search box), `VouchersTable` (columns per Figma head `134:143`: voucher + brand, Giá trị, Giá điểm (+ note), Tồn kho, Đã đổi, Thời gian đổi, Trạng thái, Hiển thị, actions), `VoucherActionsMenu` (kebab menu; follow `UsersTable`'s row actions or `Dialog`-based popover that already exists, do not add a menu library), footnote text from Figma ("Hiển thị = có trong danh sách Đổi quà. Tạm ngừng = vẫn hiện nhưng khoá nút Đổi… Voucher đã có người đổi không xoá được, chỉ ẩn.").
  - [x] 5.3 Visibility `Toggle` calls `PATCH { isVisible }` optimistically with rollback on error; pause/resume/archive go through a `ConfirmVoucherActionDialog` (copy states the effect: pause locks Đổi, hide removes from Đổi quà, archive is final and keeps issued tickets valid per BR-10). Archive requires the dialog; pause/hide/show do not.
  - [x] 5.4 `vouchers/new/page.tsx` and `vouchers/[id]/edit/page.tsx` → `components/VoucherFormScreen.tsx` (sections as Figma `135:297`: Thông tin chung, Giá trị & giá điểm, Thời gian & số lượng, Cách phát mã, Điều kiện & nơi áp dụng; right column `VoucherPreview` = live `VoucherCard` (Tile and Row variants from Story 12.2, imported as is) + `PreCheckPanel`). Field-level errors from the Zod issues through `voucherFormErrors`; client validation uses the **same** `adminVoucherInputSchema` from `@rescom/schemas`, never a copy.
    - Code section: radio "Mã riêng cho từng người (khuyên dùng)" with `<input type="file" accept=".csv,text/csv,text/plain">`; the file is read with `File.text()`, parsed by `parseCodeCsv`, then sent with `mode: "VALIDATE"`; show `received / accepted / duplicatesInFile / alreadyStored` (list at most 20 codes, then "và N mã khác") and **block Save** until both lists are empty and `invalid` is empty. Radio "Mã dùng chung" shows the code field + the extra confirm checkbox (Figma: "phải nhập số lượng phát và xác nhận lại"); in this story shared mode stores only the flag (`isSharedCode: true`) and the stock is set later via the stock dialog (no shared code value field exists in the contract — see Deviations).
    - Save flow on create: `POST vouchers` → on success `POST codes` with `COMMIT` (if CSV) → navigate to `/admin/vouchers/{id}`. If the second call fails, stay on the edit page of the created voucher with an error Alert ("Voucher đã tạo, chưa nạp được mã. Tải lại file để thử lại.") — never create a second voucher on retry.
    - Edit: price fields call the price endpoint only when they changed, after the `PriceChangeNotice` ("Giá mới chỉ áp dụng cho lượt đổi sau khi lưu; các voucher đã đổi giữ giá cũ.").
    - Image: text field for an `https://` URL (optional). Upload is out of scope (see Deviations).
  - [x] 5.5 `vouchers/[id]/page.tsx` → `components/VoucherDetailScreen.tsx` (Figma `136:425`): 3 stat cards (Còn/tổng, Điểm đã tiêu, Báo mã lỗi), `RedemptionHistoryTable` (Thời gian, Người dùng, Giá áp dụng, Mã đã phát) + footnote, right column `PriceCard` (current price, active promo/Flash, price history list, button "Điều chỉnh giá điểm" → `PriceDialog`) and `StockCard` (Tổng mã đã nạp, Đã phát, Đang giữ cho Flash Sale, Còn bán giá thường, "Điều chỉnh tồn kho" → `StockDialog` with the helper "Chỉ thu hồi được mã chưa phát và không đang giữ cho Flash Sale (tối đa N). Tồn kho không thể âm."; "Nạp thêm mã" → `CodeImportDialog` reusing the CSV widget). 409 `STOCK_BELOW_COMMITTED` shows the minimum from `details`.
    - "Điểm đã tiêu" and "Báo mã lỗi" cards: points = Σ detail `redemptions[].points` for `SUCCEEDED` minus refunds; the Báo mã lỗi card shows only what the mock exposes. If no source exists, show "—" and record it in the Completion Notes (the code-issue queue is Story 12.10).
  - [x] 5.6 States everywhere: skeleton on load (no layout shift), empty list ("Chưa có voucher nào" + Tạo voucher), error with retry (reuse the admin error pattern from `UsersScreen`/`TopUpsScreen`), 404 detail ("Không tìm thấy voucher").
  - [x] 5.7 Hooks in `vouchers/hooks/` (`use-admin-vouchers.ts`, `use-admin-voucher.ts`) built on `useApiQuery`, same style as `users/hooks/use-admin-users.ts`.
- [x] **Task 6: Pilot hiding** (AC: 1)
  - [x] 6.1 Add 4 routes to `lib/pilot-scope.ts` `PILOT_HIDDEN_ROUTES` (`/admin/vouchers`, `/admin/vouchers/new`, `/admin/vouchers/[id]`, `/admin/vouchers/[id]/edit`; guard = each `page.tsx`, which calls `notFound()` when `PILOT_BUILD`) and the matching entries in `proxy.ts` (`/admin/vouchers`, `/admin/vouchers/new`, `/admin/vouchers/:id`, `/admin/vouchers/:id/edit`). Follow how `/admin/quality` is done in all three places.
- [x] **Task 7: Tests `tests/rewards-admin-vouchers.test.mjs`** (AC: 1–5) — `node:test`, import pure TS directly (see `rewards-mock.test.mjs`, `admin-users.test.mjs`):
  - [x] 7.1 Rules: `adminStockOf` refine holds for all seeded vouchers; `adminVoucherStatus` priority table; `priceDeviationPercent` (250 for 50.000đ → 0; 400 for 50.000đ → 60); `stockAdjustmentDecision` (below committed, increase on individual, exceeds codes, ok); `importCodesDecision` (in-file duplicate listed once, already-stored, both → `accepted: 0`, clean → accepted).
  - [x] 7.2 Mock domain through the data functions (with a fresh store; reset helper as in `rewards-mock.test.mjs`): create → import COMMIT → stock/codes counters; a later user redemption (12.3 functions) consumes a code and `issued` rises; price change bumps `priceVersion`, appends history and a pre-change quote yields `PRICE_CHANGED`; archive hides it from `catalogOf`; PAUSED stays listed but not redeemable; stock decrease removes codes from the pool end; shared-code import → 409.
  - [x] 7.3 View logic: `parseCodeCsv` (BOM, header, CRLF, `;`, blank lines, invalid line, > 5000); `voucherRowView` labels; `voucherFormErrors` maps `codeExpiresAt` and `promoPoints` issues to fields; `deviationWarning` boundary at exactly 20 %; `preCheckItems`.
  - [x] 7.4 Handler/route checks (hybrid-style, as in the 12.4 handler test): non-admin → 403, no session → 401, missing CSRF on a write → 403/`CSRF`, invalid body → 400 with `details`.
  - [x] 7.5 Source-guard test: `lib/admin/rewards-vouchers-service.ts` has `PILOT_BUILD` in every exported function; no component imports from `mocks/`.
- [x] **Task 8: Verification**
  - [x] 8.1 `npm test` in `apps/frontend/my-app` (builds `@rescom/schemas` first) and the schemas jest suite for the new specs; `npm run lint` and `npx tsc --noEmit`; full run must stay green (route-diff, hybrid-mocking, no-direct-mocks, contract-callsites, pilot-scope).
  - [x] 8.2 Manual check in the browser with MSW (`NEXT_PUBLIC_API_MOCKING=enabled`, sign in as an admin mock user): list + filters + toggle, create with a CSV containing a duplicate, then the clean file, edit price, stock dialog both error and success, detail history. Record the result honestly, including what was not checked.
  - [x] 8.3 Pilot build check: with `NEXT_PUBLIC_PILOT_BUILD=true` the sidebar has no Voucher entry and `/admin/vouchers` is a 404.

### Review Findings

- [x] [Review][Patch] (quyết: bỏ qua kiểm tra mã khi `isSharedCode`) Voucher mã dùng chung: mock luôn `codesAvailable=0` nên luôn SOLD_OUT, không giảm được tồn kho (`STOCK_EXCEEDS_CODES`), form sửa bắt tick xác nhận lại — cần chốt ngữ nghĩa tồn kho shared (bỏ qua check mã khi `isSharedCode`?) [mocks/data/rewards-rules.ts:90, mocks/data/rewards.ts:211] (AC4, BR-06)
- [x] [Review][Patch] (quyết: thêm `status` vào `adminVoucherSchema`, row/Tag dùng status server) Trạng thái dòng danh sách: `voucherRowView` tự suy ra, lệch `adminVoucherStatus` của filter (shared/hết mã); không có `status` trong contract, cũng không dùng Tag (statusTone bị bỏ) — thêm `status` vào `adminVoucherSchema` hay đồng bộ phía client? [lib/admin/rewards-vouchers-view.ts:11-16, apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VouchersScreen.tsx] (AC1)
- [x] [Review][Patch] (quyết: bỏ nhánh orphan, chỉ ghép theo ticket/`voucherId`) Lịch sử đổi ghép theo brand/value/title (workaround seed mồ côi) thay vì `voucherId`; voucher trùng tên nhận lịch sử lẫn nhau — giữ hay bỏ nhánh orphan? [mocks/data/rewards.ts:adminVoucherDetailOf] (Task 2.2)
- [x] [Review][Patch] Tạo mới: nạp mã lỗi → `router.replace` sang trang sửa làm mất Alert "Voucher đã tạo, chưa nạp được mã" [apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherFormScreen.tsx:submit] (AC3, Task 5.4)
- [x] [Review][Patch] Lưu sửa gồm PUT + giá + import không báo bước nào đã lưu; bấm lại lặp PUT/import [apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherFormScreen.tsx:submit]
- [x] [Review][Patch] Chọn CSV rồi đổi sang mã dùng chung: `csv` không bị xoá, submit vẫn import mã vào voucher shared [apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherFormScreen.tsx:blocked/submit]
- [x] [Review][Patch] Sửa voucher đã hết hạn đổi bị `REDEMPTION_WINDOW_ENDED` dù không đổi `redeemEndsAt` — chỉ lỗi khi giá trị thay đổi [mocks/data/rewards-rules.ts:83]
- [x] [Review][Patch] Form không hiển thị lỗi `brandId`/`imageUrl`/`terms`/`howToUse`, không nối `aria-describedby`, không map `details` 400 từ server [apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherFormScreen.tsx] (AC2, Task 4.4)
- [x] [Review][Patch] PriceDialog không validate bằng `adminVoucherPriceChangeSchema` (promo<base, reason≥5) và không cảnh báo lệch giá BR-13 [apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherDetailScreen.tsx]
- [x] [Review][Patch] `overrides` của nút Hiển thị không bao giờ xoá; `error` không reset [apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VouchersScreen.tsx]
- [x] [Review][Patch] Detail/form báo "Không tìm thấy voucher" cho mọi lỗi (mạng/500), không tách 404 [apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherDetailScreen.tsx, VoucherFormScreen.tsx] (Task 5.6)
- [x] [Review][Patch] `vietnamIso` ném RangeError khi giá trị có giây; `initial` tính `new Date()` lúc load module [apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherFormScreen.tsx:17-20]
- [x] [Review][Patch] "Điểm đã tiêu" tính trên redemptions đã cắt 50 dòng → ghi rõ phạm vi hoặc tính tổng thật [apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherDetailScreen.tsx]
- [x] [Review][Patch] Menu thao tác viết tay, không dùng `voucherActionsOf`; nhánh `"hide"` chết; `priceNote` thiếu giờ kết thúc Flash (phần Flash chưa làm: admin row contract không có `endsAt` của Flash; menu/Tag/nhánh chết đã sửa) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VouchersScreen.tsx, lib/admin/rewards-vouchers-view.ts:15] (Task 4.1/4.3/5.2)
- [x] [Review][Patch] `parseCodeCsv` chỉ bỏ header ở index 0 (dòng trống trước "code" → "code" thành mã hợp lệ); `preCheckItems` báo mã "không hợp lệ" khi sửa không có CSV; thiếu AuditNote BR-13; preview trống trước khi chọn brand [lib/admin/rewards-vouchers-view.ts, apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherFormScreen.tsx]
- [x] [Review][Patch] Detail dùng `toLocaleString("vi-VN")` thay `lib/format/date-time.ts` [apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherDetailScreen.tsx] (Gotcha 11)
- [x] [Review][Patch] Test thiếu ca: `priceDeviationPercent` 250→0 và 400→60, archive ẩn khỏi `catalogOf`, mã bị bỏ ở cuối pool khi giảm tồn kho [tests/rewards-admin-vouchers.test.mjs] (Task 7)
- [x] [Review][Defer] PUT edit gửi `terms/howToUse/imageUrl` rỗng, mock che bằng fallback; backend 12.7 PUT thay thế toàn bộ sẽ xoá dữ liệu — deferred, deviation đã ghi trong spec, xử lý khi contract detail trả các trường này [apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherFormScreen.tsx, mocks/data/rewards.ts:updateAdminVoucher]
- [x] [Review][Defer] Tìm kiếm danh sách không debounce, cache key dùng `q` chưa trim — deferred, tối ưu sau [use-admin-vouchers.ts]

## Dev Notes

### Scope boundaries (read first)

- **In:** the Admin voucher list, create/edit form with live preview and pre-save checks, CSV code import (validate + commit), price change, stock adjustment, state actions (pause, hide, archive), voucher detail (stock, price history, redemption history), the sidebar entry, mock routes and rules, additive contract changes, pilot hiding.
- **Out:**
  - Flash Sale management and the statistics dashboard: Story 12.6 (the "Tạo Flash Sale" menu item and the other two sidebar entries wait for it).
  - Code-issue queue and its resolution (replacement code / refund): Story 12.10 (backend). The detail "Báo mã lỗi" card is read-only and shows what exists.
  - Audit log writes (FR-ADD-13), second-Admin approval, real code storage, DB constraints: Story 12.7 backend.
  - Image upload (Figma `135:322` shows an uploader): the contract has `imageUrl` only; no storage route is in scope. Text URL field instead.
  - A shared-code value field: `adminVoucherInputSchema` has `isSharedCode` but no code value (Figma has a code field "HLRESCOM50"). See Deviations.
  - Any backend and the feature flag (Story 12.11).
- **Gates:** FE-mock only, behind `PILOT_BUILD` (service self-gate + page guard + proxy 404 + nav spread).
- **Contract status:** extends the Story 12.1 **ASSUMED API CONTRACT** (`rewards-admin.schema.ts`). Task 1 only adds schemas; existing schemas are unchanged. Story 12.7 must implement them. The 12.1 admin schemas are already there and tested (`rewards-admin.schema.spec.ts`).

### Contract and mock behaviour

| Topic | Rule |
|---|---|
| Stock identity | `remaining = total − issued − flashReserved` (schema refine). `adminStockOf` derives `issued`; the mock never stores it. |
| Stock decrease (BR-06) | allowed down to `issued + flashReserved`; removes unissued codes from the pool end; `STOCK_BELOW_COMMITTED` carries `details.minimum`. |
| Stock increase | individual codes: only by CSV import (`STOCK_INCREASE_NEEDS_CODES`); shared-code voucher: by `POST …/stock`. |
| CSV (BR-15) | whole file rejected if it has in-file duplicates or codes already stored; `VALIDATE` never mutates; `COMMIT` with problems returns `committed: false` and mutates nothing. |
| Shared code (BR-14) | flag cannot change after the first redemption (`SHARED_FLAG_LOCKED`); a shared voucher cannot import individual codes. |
| Price change (BR-12) | new `priceVersion` + history entry; tickets/history/quotes of past redemptions keep their price. |
| BR-13 | deviation > 20 % from `valueVnd ÷ 200` shows a warning and an `AuditNote` line in the pre-check; save is allowed (OQ-23 planning default). |
| Code expiry (BR-16) | `codeExpiresAt ≥ redeemEndsAt + 7 days` — already in `adminVoucherInputSchema`; the form shows the schema's message on `codeExpiresAt`. |
| No delete (BR-24) | no DELETE route; archive is the end state. |

- Error codes added by this story (all `409` unless noted): `STOCK_BELOW_COMMITTED`, `STOCK_INCREASE_NEEDS_CODES`, `STOCK_EXCEEDS_CODES`, `SHARED_CODE_VOUCHER`, `SHARED_FLAG_LOCKED`, `VOUCHER_ARCHIVED` (any edit/price/stock/import on an archived voucher), plus `400 VALIDATION_ERROR` and `404 VOUCHER_NOT_FOUND`. Document them in the handler comments.

### Derived status (list filter and Tag)

`ARCHIVED` is excluded from every filter except "Tất cả" (shown with a muted "Lưu trữ" Tag, no actions but history). Filter keys map: ACTIVE → "Đang phân phối", PAUSED → "Tạm ngừng", SOLD_OUT → "Hết hàng", EXPIRED → "Hết hạn", HIDDEN → "Ẩn". Status Tags always carry text (never colour alone); stock numbers always accompany any bar.

### Field messages (Vietnamese, per `voucherFormErrors`)

| Path | Message |
|---|---|
| `title` | "Nhập tên voucher (tối đa 80 ký tự)." |
| `brandId` | "Chọn thương hiệu." |
| `valueVnd` / `basePoints` | "Nhập số nguyên lớn hơn 0." |
| `promoPoints` | "Giá khuyến mãi phải thấp hơn giá điểm thường." |
| `redeemEndsAt` | "Ngày kết thúc phải sau ngày bắt đầu." |
| `codeExpiresAt` | "Hạn dùng mã phải sau ngày kết thúc đổi ít nhất 7 ngày." |
| `terms` / `howToUse` | "Tối đa 10 dòng." |
| `imageUrl` | "Nhập đường dẫn https hợp lệ." |
| unknown path | the Zod message |

### Architecture rules that bind the UI

- **No client-side money or stock logic.** Stock, issued, reserved, deviation, status and the minimum allowed total come from the server payload. The client only formats (the pre-check "suggested points" and the 20 % warning are advisory and recomputed by the server as `priceDeviationPercent`).
- **Authoritative validation = shared schema.** The form imports `adminVoucherInputSchema`, `adminStockAdjustmentSchema`, `adminVoucherPriceChangeSchema`, `adminCodeImportRequestSchema` from `@rescom/schemas`.
- **Admin-only:** the route group `(admin)` + `SessionGate requireAdmin` already protects the pages; mock handlers use `requireMockAdmin()`. Admin pages are desktop-only (like the other admin screens): no mobile layout.
- **Destructive/irreversible actions need a confirm dialog with the effect stated** (archive). Pause/hide are reversible and toggle directly.
- **Idempotency:** price/stock/import are admin writes, not money operations; no `Idempotency-Key`. CSRF applies to all writes.
- **No overselling (BR-04):** nothing in the UI lets `remaining` go below zero; the server rule is mirrored in the mock and enforced by the tests in 7.2.
- **Accessibility:** table with real `<th scope>`, kebab buttons labelled with the voucher title, the toggle is a labelled switch, dialogs trap focus and return it to the trigger (use `components/ui/Dialog.tsx`), errors are announced via the field's `aria-describedby`.

### Existing code to reuse (do not reinvent)

| Need | Use |
|---|---|
| Admin frame + header | `components/layout/admin/AdminShell.tsx`, `AdminPage.tsx`, `admin-nav.ts` |
| Admin handler guard | `mocks/handlers/admin.ts` `requireMockAdmin`; `mocks/envelope.ts` `ok`, `fail`, `missingCsrf`, `unauthorized`; `mocks/scenarios.ts` `applyScenario("admin")` |
| Admin list/screen pattern | `app/(signed-in)/(admin)/admin/users/*` (`UsersScreen`, `UsersTable`, `use-admin-users.ts`), `top-ups/*`; services in `lib/admin/*-service.ts` |
| HTTP, queries | `lib/api/client.ts` `apiRequest`, `lib/api/api-error.ts`, `lib/api/use-api-query.ts` |
| Voucher visuals | `rewards/components/VoucherCard.tsx` (Row/Tile), `VoucherThumb.tsx`; `lib/rewards/voucher-display.ts` (`formatPoints`, `formatVnd`, `formatFullDate`) |
| UI primitives | `components/ui/{Button,Dialog,Toggle,SegmentedControl,Chip,Tag,TextField,Textarea,Select,Radio,Checkbox,Alert,Spinner,Icon}` |
| Dates | `lib/format/date-time.ts` Vietnam helpers |
| Mock data/state | `mocks/data/rewards.ts` (`rewardsCatalog`, `rewardsState`, `claimDemoRewards`), `mocks/data/rewards-rules.ts`, `mocks/db/store.ts` `createCollection`, `mockId` |
| Rate constant | `POINT_VND_RATE` from `@rescom/schemas` |
| Schemas | everything already in `rewards-admin.schema.ts`: `adminVoucherInputSchema`, `adminVoucherSchema`, `adminVoucherDetailSchema`, `adminVoucherPriceChangeSchema`, `adminStockAdjustmentSchema`, `adminCodeImportRequestSchema`/`ResultSchema`, `REWARDS_CODE_EXPIRY_MIN_DAYS` |

Check `rewards/components/` for the exact `VoucherCard` props before using it in the preview; if it needs a `price`/`status`-shaped object, build it from the form values with a small `previewListItem(form)` helper in the view file (no duplicate card component).

### Files

**NEW**
- `apps/frontend/my-app/mocks/handlers/rewards-admin.ts`
- `apps/frontend/my-app/lib/admin/rewards-vouchers-service.ts`
- `apps/frontend/my-app/lib/admin/rewards-vouchers-view.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/new/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/[id]/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/[id]/edit/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/{VouchersScreen,VoucherStats,VoucherFilters,VouchersTable,VoucherActionsMenu,ConfirmVoucherActionDialog,VoucherFormScreen,VoucherPreview,PreCheckPanel,CodeUpload,VoucherDetailScreen,RedemptionHistoryTable,PriceCard,StockCard,PriceDialog,StockDialog,CodeImportDialog}.tsx` (split further only past ~300 lines; merge small ones if they stay tiny)
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/hooks/{use-admin-vouchers,use-admin-voucher}.ts`
- `apps/frontend/my-app/tests/rewards-admin-vouchers.test.mjs`

**UPDATE** (read each whole file first; preserve everything not listed)

| File | Today | Change | Must preserve |
|---|---|---|---|
| `packages/schemas/src/rewards/rewards-admin.schema.ts` | 12.1 admin schemas | Task 1 additions | every existing schema/refinement |
| `packages/schemas/src/rewards/rewards-admin.schema.spec.ts` | 12.1 cases | + new cases | existing cases |
| `packages/schemas/src/rewards/index.ts` (and package `index.ts` if it lists exports) | re-exports | nothing if `export *`; else add names | — |
| `apps/frontend/my-app/mocks/data/rewards-rules.ts` | pricing/redeem/ticket rules | + 6 pure rules | existing rules |
| `apps/frontend/my-app/mocks/data/rewards.ts` | seed, user flows | `priceHistory` seed + 9 admin functions | redeem/idempotency behaviour, one update per collection, `codePools` shape |
| `apps/frontend/my-app/mocks/handlers/index.ts` | handler list | register `rewardsAdminHandlers` | order/comments |
| `apps/frontend/my-app/mocks/db/store.ts` | `SCHEMA_VERSION = 7` | 8 | everything else |
| `apps/frontend/my-app/mocks/route-allowlist.ts` | DEFERRED_KEEP_MOCK 26 | 35 | other entries |
| `apps/frontend/my-app/components/layout/admin/admin-nav.ts` | 8 entries | + Voucher (pilot-hidden) | queue badges, quality spread |
| `apps/frontend/my-app/lib/pilot-scope.ts`, `proxy.ts` | 16 hidden routes | + 4 | order/comments |
| `apps/frontend/my-app/tests/helpers/frontend-callsites.mjs` | rewards user entries | + 9 | others |
| `apps/frontend/my-app/tests/route-diff.test.mjs`, `tests/hybrid-mocking.test.mjs` | counts 26 | 35 | other tests |

### Deviations from Figma (deliberate, record in Completion Notes)

| Figma | This story | Why |
|---|---|---|
| 25b "Lệch quá 20% sẽ cần Admin thứ hai duyệt" | warning + audit note, save allowed | OQ-23 planning default with one pilot Admin; second-Admin approval needs backend (12.7) |
| 25b image uploader | https URL text field | contract has `imageUrl` only; no storage route in scope |
| 25b shared-code value field "HLRESCOM50" | flag only | contract has no shared code value; stock set by the stock dialog |
| 25b "Tự hiện lúc 08:00 ngày …" publish row | derived from `redeemStartsAt` | there is no separate publish time in the contract |
| Figma sample numbers (500 total, 88 left…) | mock seed numbers (300 total for Highlands …) | seed from Story 12.1 stays; Figma numbers are illustrative |
| 25 menu "Tạo Flash Sale" | omitted until Story 12.6 adds the route | no dead links |
| 25c "Báo mã lỗi" card | read-only, "—" if no source | queue is Story 12.10 |

### Gotchas checklist

1. **Pilot literal scan** (`tests/pilot-scope.test.mjs`): `/admin/vouchers…` and `/admin/rewards…` literals are allowed only inside the hidden dir `app/(signed-in)/(admin)/admin/vouchers/`, inside functions that check `PILOT_BUILD`, or in `admin-nav.ts`/`pilot-scope.ts`/`proxy.ts` as the tests allow. Read the test before adding the nav entry.
2. **Every deferred route needs a caller** (strict equality in `route-diff`/`contract-callsites`): add service function, `CALL_ALLOWLIST` entry and `DEFERRED_KEEP_MOCK` entry together.
3. **Route literal format differs**: allowlist/handlers `:id`, `CALL_ALLOWLIST` `:param`, pilot routes `[id]`, proxy `:id`.
4. **Mock persistence**: the catalog shape changed (`priceHistory`) → bump `SCHEMA_VERSION`, or old localStorage lacks it and fails parsing.
5. **User catalog must keep working**: admin writes mutate the same `rewardsCatalog` the 12.2/12.3 pages read. A new voucher with `stockRemaining: 0` must show as `SOLD_OUT`/not listed correctly; run the existing `rewards-mock` and `rewards-*` tests after the change.
6. **`codePools` and `codesAvailable` must stay in sync** (`codesAvailable = pool.length` after every import, stock decrease and redemption).
7. **Seed `issued` must be ≥ 0** under `adminStockOf` for all 7 vouchers (the Coffee House voucher has `stockRemaining: 0`; the expired one has an `ends` in the past). Verify before relying on the formula.
8. **Hooks before early returns** in every screen. **Abort/stale-guard** effect fetches; treat `AbortError` as "stop".
9. **File input**: reset `input.value` after reading so choosing the same file twice re-triggers `onChange`; read via `File.text()`; never upload the raw file to the server (the contract carries parsed codes).
10. **Next 16**: four new `page.tsx` files with async `params` (`params: Promise<{ id: string }>`); read `node_modules/next/dist/docs/` routing notes first (static `new` vs dynamic `[id]` sibling precedence).
11. **Dates**: form inputs use `<input type="datetime-local">` or date inputs interpreted in Asia/Ho_Chi_Minh; convert with the Vietnam helpers to ISO instants (UTC+7, no DST). Test a value near midnight.
12. **Scenarios**: `?msw=<scenario>` persists in localStorage; `api-error`/`api-offline` hit the admin routes too — use them to check the error states, then `?msw=default`.
13. **Admin mock user**: pick the existing admin mock account (see `mocks/db/session.ts` and `admin-users.test.mjs`); a non-admin gets 403 from `requireMockAdmin`.

### Testing standards

- `node --test tests/*.test.mjs` (`npm test` builds `@rescom/schemas` first). Import pure TS directly; mock data/rules are importable like `rewards-mock.test.mjs`.
- Schemas: jest `src/**/*.spec.ts`.
- Components are covered by pure helpers, handler tests and the manual check (Task 8.2); no new test framework.

### Project Structure Notes

- Admin pages follow `app/(signed-in)/(admin)/admin/<section>/{page.tsx,components,hooks}`; services in `lib/admin/`; pure view logic in `lib/admin/*-view.ts`; admin mock handlers in `mocks/handlers/admin-*.ts` — this story names its file `rewards-admin.ts` to sit beside `rewards.ts`; keep it in `mocks/handlers/`.
- Exports use `adminVoucher*` / `voucher*` names, never bare `reward*` (12.1 collision rule).

### Previous story intelligence (12.4, done, merged via PR #20)

- Same pattern of work: schema additions → rules → data → handlers → allowlist → service → view logic → UI → tests. 12.4 added 6 routes (DEFERRED_KEEP_MOCK 20 → 26), bumped `SCHEMA_VERSION` to 7, and kept pure logic in `lib/rewards/*.ts` with relative imports and source-guard tests.
- Lessons: per-user mock seeds must key by email for the demo user (`claimDemoRewards`); format numbers with `formatPoints`; test exact copy not only existence; memoize anything derived from server time; the automation browser reports `document.hidden=true` (force `hidden=false` for live countdowns, not needed here), and the window can't be resized (admin is desktop-only, so the default width is fine).
- 12.1 note: "all new schema exports avoid `reward*` names"; admin schemas already exist, do not re-create them.
- Code style in the Rewards mock files is compact (long lines, destructuring). Match it in `rewards-rules.ts`/`rewards.ts`; admin UI files follow the more conventional style of the existing admin screens.

### Git intelligence

- `65043da` chore(sprint) mark 12.4 done; `7904252` PR #20 merge; `b047c21` 12.4 implementation (my vouchers, ticket page, QR via `uqr`, history; 6 mock routes); `53a9ba5`/`54f1067` 12.3 (quote/redeem flow, callsite test strictness); `3c5b142` 12.2 (marketplace, `VoucherCard` etc.); `cecbb0e` 12.1 (contracts, mock domain, allowlist).
- This branch `feat/12-5-admin-voucher-catalog-codes` is created from `origin/develop` @ `7904252` (12.1–12.4 all merged).

### Latest tech information

- No new dependency. CSV is parsed with ~30 lines of local code (single column of codes; no CSV library): a library would add weight for a one-column file. Next 16.3 / React 19.2 / Zod per `package.json`; read `node_modules/next/dist/docs/` before adding pages (project `AGENTS.md`).

### Open points for the dev agent to confirm with Quan (do not block)

- Shared-code value storage (contract change) before Story 12.7.
- Whether the Admin list should show archived vouchers under "Tất cả" (assumed yes).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 intro, Story 12.5, 12.6, 12.7 (backend for this story), 12.10]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-13.md` FR-72; BR-04, BR-06, BR-10, BR-12–BR-16, BR-24; Open Questions 23 and 25]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` AD-24, AD-16]
- [Source: `_bmad-output/implementation-artifacts/12-1-rewards-contracts-msw-mock-domain.md` §C `rewards-admin.schema.ts`, Seed]
- [Source: `_bmad-output/implementation-artifacts/12-4-my-vouchers-code-qr-history.md` Gotchas, Existing code to reuse]
- [Source: Figma `mkudD5Ngi5RPyIAVxCcxXi` page 25 `113:8`: list `134:8` (stats `134:105`, table `134:122`, toolbar `134:123`, rows `134:162…`), create `135:208` (form `135:297`, preview `135:441`, pre-check `135:500`), detail `136:425` (history `136:531`, price `136:595`, stock `136:616`); page 20 `113:3` AdminSidebar, VoucherCard]
- [Source: `apps/frontend/my-app/mocks/data/rewards.ts`, `mocks/data/rewards-rules.ts`, `mocks/handlers/rewards.ts`, `mocks/handlers/admin.ts`, `mocks/route-allowlist.ts`, `components/layout/admin/admin-nav.ts`, `lib/pilot-scope.ts`, `proxy.ts`, `tests/pilot-scope.test.mjs`, `tests/contract-callsites.test.mjs`, `tests/helpers/frontend-callsites.mjs`, `tests/route-diff.test.mjs`, `tests/hybrid-mocking.test.mjs`]

## Dev Agent Record

### Agent Model Used

### Debug Log References

- 2026-10-13: Full frontend test 850/850; schemas Jest 4/4; frontend lint/typecheck pass. Pilot production build passes with `NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled`; HTTP `/admin/vouchers` returns 404; sidebar entry excluded by `PILOT_BUILD`.
- 2026-10-13: Safari 27 WebDriver on existing localhost:3000 MSW-enabled dev server: signed in `admin@rescom.vn`; list 7 seed vouchers, SOLD_OUT filter 1, Phúc Long search 1, visibility toggle hidden then restored; duplicate CSV `WALK-125-A` rejected before create, clean 3-code CSV created voucher with stock 3/3; price 250→260 appended v2; stock increase to 4 rejected without codes, decrease to 2 succeeded; seeded The Coffee House detail shows two history rows (redeem/refund). Code-issued cells show “—” because detail DTO lacks code. Created demo voucher retained in browser mock storage.

### Completion Notes List

- FE + MSW only: admin voucher contracts, inventory/code import, price history, nine mock routes, guarded client, list/form/detail, pilot route/nav hiding.
- Create CSV verifies in-file duplicates before POST; stored-code collisions verified after voucher creation because import endpoint needs voucher ID. Failed import keeps created ID and retry link.
- Shared-code flag can be saved and stock adjusted, but shared voucher remains sold out until Story 12.7 defines shared-code value storage; issuing undefined code prohibited. Edit screen disables terms/how-to/image changes because detail DTO omits them; mock preserves stored values.
- Detail code-issue card and issued-code cells display “—”: detail contract exposes neither. Figma deviations: no second-admin approval (warning only), https URL instead of upload, no shared-code value, publish from redeemStartsAt, seed stock instead of Figma numbers, Flash Sale action deferred to 12.6.
- Safari MSW walkthrough, automated gates, and pilot-build HTTP check pass; story ready for review.

### File List

- `packages/schemas/src/rewards/rewards-admin.schema.ts`
- `packages/schemas/src/rewards/rewards-admin.schema.spec.ts`
- `apps/frontend/my-app/mocks/data/rewards-rules.ts`
- `apps/frontend/my-app/mocks/data/rewards.ts`
- `apps/frontend/my-app/mocks/db/store.ts`
- `apps/frontend/my-app/mocks/handlers/rewards-admin.ts`
- `apps/frontend/my-app/mocks/handlers/index.ts`
- `apps/frontend/my-app/mocks/route-allowlist.ts`
- `apps/frontend/my-app/lib/admin/rewards-vouchers-service.ts`
- `apps/frontend/my-app/lib/admin/rewards-vouchers-view.ts`
- `apps/frontend/my-app/components/layout/admin/admin-nav.ts`
- `apps/frontend/my-app/lib/pilot-scope.ts`
- `apps/frontend/my-app/proxy.ts`
- `apps/frontend/my-app/tests/helpers/frontend-callsites.mjs`
- `apps/frontend/my-app/tests/hybrid-mocking.test.mjs`
- `apps/frontend/my-app/tests/route-diff.test.mjs`
- `apps/frontend/my-app/tests/rewards-admin-vouchers.test.mjs`
- `apps/frontend/my-app/tests/rewards-admin-vouchers-view.test.mjs`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/[id]/edit/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/[id]/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherDetailScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VoucherFormScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VouchersScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/hooks/use-admin-voucher.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/hooks/use-admin-vouchers.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/new/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/page.tsx`

### Change Log

- 2026-10-13: Implemented FE/MSW voucher admin slice; automated gates, pilot HTTP, Safari MSW walkthrough pass; moved to review.

- 2026-10-13: Story created (ready-for-dev) on `feat/12-5-admin-voucher-catalog-codes` from `origin/develop`.
