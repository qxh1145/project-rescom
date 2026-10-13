# Story 12.2: Voucher Marketplace, Filters & Detail

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a User,
I want to browse vouchers and Flash Sales and see whether I can afford each one,
so that I can choose what to redeem with my Points.

## Acceptance Criteria

1. **Marketplace page.** Given a signed-in user, when they open Đổi quà (under the Ví điểm tab on mobile, or the fourth top-bar item on desktop), then the page shows the Available Balance card ("Dùng được cả điểm nạp. N điểm chờ duyệt chưa được tính."), search, category chips, the Flash Sale strip with a Countdown, and the voucher list, matching Figma page 21 at 390 px and 1440 px (FR-68).
2. **Filters and sort.** The filter opens as a bottom sheet on mobile and a 264 px left column on desktop. It has category, brand, point range, "Chỉ voucher đang giảm giá", and "Chỉ voucher tôi đủ điểm đổi", plus a sort control.
3. **States.** Loading (skeleton, no layout shift), Empty (with suggestions) and Error (retry; "Điểm và voucher của bạn vẫn an toàn") are implemented.
4. **Detail.** Voucher detail (page 22) shows the Enough, Not enough (suggests both surveys and top-up) and Sold out states. It shows the regular price when the Flash quota is sold out but regular stock remains.
5. **Countdown and status text.** Countdown uses server time from the API. It announces to screen readers only when the minute changes. Status is always shown as text, and progress bars always show numbers.
6. **Components and tokens.** New components VoucherCard (Row/Tile × Default/Sale/Sold out/Expired), FlashSaleCard (Upcoming/Active/Ended/Sold out), Countdown, Toggle and SegmentedControl reuse existing tokens. `color/sale/*` is added as an alias to the existing red. Touch targets are at least 44 px, including chips.

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.2 (FR-68, FR-71, BR-01, BR-17).

## Tasks / Subtasks

- [x] **Task 1: Additive contract fields for page 22** (AC: 1, 4)
  - [x] 1.1 In `packages/schemas/src/rewards/voucher-catalog.schema.ts`, extend `voucherDetailSchema` with `description: z.string().min(1).max(1000)` and `whereToUse: z.string().min(1).max(300)` ("Nơi áp dụng"). Extend `flashSaleItemSchema` with `category: voucherCategorySchema` (FlashSaleCard needs the category glyph, and the strip can't rely on the filtered catalog). Mark both changes `// ASSUMED API CONTRACT (Story 12.2, additive)`. Add nothing else.
  - [x] 1.2 Update the fixtures in `voucher-catalog.schema.spec.ts` (detail and Flash item) and add one invalid case for each new field (empty `description`, unknown `category`).
  - [x] 1.3 Mock: in `mocks/data/rewards.ts`, give each seeded voucher its `description`, `whereToUse` and real `terms` (Dev Notes → Seed copy), return them from `voucherOf`, and add `category: v.category` to each item in `flashSalesAt`. Bump `SCHEMA_VERSION` in `mocks/db/store.ts` from 5 to 6 with the comment line `6: Voucher detail copy + Flash item category (Story 12.2).`
  - [x] 1.4 `npm --prefix packages/schemas test && npm --prefix packages/schemas run typecheck` pass. The existing `tests/rewards-mock.test.mjs` "every seeded entity parses" test must still pass with the new fields.
- [x] **Task 2: Rewards client `lib/rewards/`** (AC: 1, 4, 5)
  - [x] 2.1 `lib/rewards/rewards-service.ts` follows `lib/wallet/top-up-service.ts`: `listVouchers(query, signal?)` → `GET /rewards/vouchers?…` with `voucherCatalogSchema`; `getVoucher(id, signal?)` → `GET /rewards/vouchers/${id}` with `voucherDetailResponseSchema`; `listFlashSales(signal?)` → `GET /rewards/flash-sales` with `flashSaleListSchema`. Each function starts with a `PILOT_BUILD` guard that rejects with `ApiError({ kind: "http", status: 404, code: "REWARDS_DISABLED", … })`. The guard is required: `tests/pilot-scope.test.mjs` treats the literal `"/rewards/…"` as a link to the hidden `/rewards` route, and it also keeps a pilot build from calling a mock-only route. Head the file with `// ASSUMED API CONTRACT: Story 12.1 mock routes; backend Stories 12.7-12.10.`
  - [x] 2.2 `lib/rewards/catalog-query.ts` (pure, like `lib/marketplace/marketplace-query.ts`): `RewardsFilters` type, `DEFAULT_REWARDS_FILTERS`, `parseRewardsParams(URLSearchParams)` (it never throws, drops invalid values and returns defaults), `serializeRewardsParams(filters, current)` (it omits defaults and keeps unknown params such as `msw`), `toCatalogQuery(filters)` → the query string for `listVouchers`, `activeFilterCount(filters)` (category + brand + points + 2 toggles; sort and search don't count), and `POINT_RANGES` = `[{ id: "lt100", label: "Dưới 100", maxPoints: 99 }, { id: "100-200", label: "100–200", minPoints: 100, maxPoints: 200 }, { id: "gt200", label: "Trên 200", minPoints: 201 }]`. URL keys: `q`, `category` (csv), `brand` (csv), `points` (range id), `sale=1`, `afford=1`, `sort`.
  - [x] 2.3 `lib/rewards/server-clock.ts` (pure): `serverOffset(serverTimeIso, receivedAtMs)`; `remaining(endsAtIso, nowMs)` → `{ totalSeconds, hh, mm, ss }`, clamped at 0; `countdownMinuteKey(totalSeconds)` = `Math.ceil(totalSeconds / 60)`; `countdownAnnouncement(totalSeconds, kind: "ends" | "starts")` → "Flash Sale kết thúc sau 2 giờ 15 phút" / "… bắt đầu sau …" / "Flash Sale đã kết thúc". It is only re-rendered when the minute key changes (AC 5).
  - [x] 2.4 `lib/rewards/voucher-display.ts` (pure, the copy lives here so it can be tested): `CATEGORY_LABELS` (Cà phê · Trà & trà sữa · Gà rán & burger · Bánh & tráng miệng), `CATEGORY_GLYPH` (COFFEE → `coffee`, TEA → `cup-soda`, CHICKEN_BURGER → `drumstick`, BAKERY_DESSERT → `coffee`, matching Figma 21 TCH), `SORT_LABELS`, `brandInitials(brand)` (HL, LT, PL, KFC, GC, TCH; see Dev Notes), `VOUCHER_LOW_STOCK = 10`, `voucherCardState(item)` → `"default" | "sale" | "soldOut" | "expired" | "paused"`, `voucherMetaLine(item)`, `flashItemOrder`, `detailStockLine(voucher)`, `detailExpiryLine(voucher)`, `howToGetCodeLine(isSharedCode)`, `shortfall(price, available)`, and `suggestedTopUp(shortfall)` (the smallest `TOP_UP_PACKAGES` entry ≥ shortfall, else the shortfall rounded up to `TOP_UP_STEP_POINTS`). The copy table is in Dev Notes → Copy. Dates use `lib/format/date-time.ts` (Vietnam time), and points use `formatPoints`.
- [x] **Task 3: Tokens, icons and primitives** (AC: 6)
  - [x] 3.1 In `app/globals.css` `@theme inline`, add only `--color-sale-bg: var(--color-danger-soft);` and `--color-sale-text: var(--color-danger);`, with the comment `/* Figma 20 (140:4346): color/sale/* alias red; only for discount % and struck prices, never for errors. */`. Add no new primitive. Before writing, check the Figma variables of `Tag/Giảm giá` (`116:3`) with `get_variable_defs`. If `red/600` is not `#b42318`, alias the closest existing danger token and record the delta in Completion Notes.
  - [x] 3.2 Export the missing icons from Figma page 20 (`113:13`) into `public/icons/` as 24 px stroke SVGs, in the same format as the existing files: `ticket`, `zap`, `qr-code`, `map-pin`, `coffee`, `cup-soda`, `drumstick`. `info`, `calendar`, `chevron-right`, `chevron-down`, `search`, `sliders`, `alert-circle`, `x` and `bell` already exist. Reuse the existing `public/brand/mascots/{points,search,offline}.svg`.
  - [x] 3.3 `components/ui/Toggle.tsx` (Figma `116:28`, 44×26 track): a `<button role="switch" aria-checked>` with a visible label prop, or `aria-labelledby`. The hit area is ≥ 44×44 (padding or a wrapping label row). Use the primary track when on and `bg-line-strong` when off. Under reduced motion there is no transition.
  - [x] 3.4 SegmentedControl **already exists** (`components/ui/SegmentedControl.tsx`). Do not create a second one. Compare it with Figma `128:224` (350×46, 3 segments). If the visual differs, add a variant instead of forking. Pages 21 and 22 don't use it. Story 12.4 (tabs) is its first Rewards consumer, so this story only verifies that it matches.
  - [x] 3.5 Chips: reuse `components/ui/ToggleChip.tsx` with `size="lg"` (h-11 = 44 px) for category, brand, point-range and sort chips. Figma draws them at 40 px, but AC 6 requires 44 px touch targets.
- [x] **Task 4: Rewards components `app/(signed-in)/(app)/rewards/components/`** (AC: 1, 5, 6)
  - [x] 4.1 `VoucherThumb.tsx` (Figma `116:29`): a category-tint square with the category glyph and a brand-initials badge. If `imageUrl` is set, show it instead (`<img>` with `alt=""`, because the title is adjacent). Tints: COFFEE `tone-amber-bg`; TEA `tone-green-bg`; CHICKEN_BURGER `tone-blue-bg` for Lotteria, `danger-soft` for KFC (Figma draws the tint per brand); BAKERY_DESSERT `tone-teal-bg`. Keep the tint table in `voucher-display.ts`.
  - [x] 4.2 `VoucherCard.tsx` with `layout: "row" | "tile"` and the state from `voucherCardState`. The whole card is one `<Link href={`/rewards/${id}`}>` with an accessible name of brand + title + price + status text. Sale: `-N%` uses `bg-sale-bg text-sale-text`, and the struck base price uses `line-through`. Sold out and expired: muted surface, and the status text in a `Tag` ("Hết hàng" danger tone, "Hết hạn đổi" neutral tone). Paused: a "Tạm dừng" tag, still clickable (FR-68: listed, redeem disabled). Row is used on mobile (350 wide) and Tile in the 4-column desktop grid (252 wide). Match Figma `117:160`.
  - [x] 4.3 `FlashSaleCard.tsx` (Figma `118:180`) for Flash item states `UPCOMING | ACTIVE | SOLD_OUT | ENDED`. Active: `ProgressBar` plus "Đã đổi {sold}/{quota}" and "Còn {n}", with "Đổi ngay" as a `ButtonLink` to `/rewards/{voucherId}` (Story 12.3 decides whether it opens the confirmation directly). Sold out: a full bar, "Đã đổi {quota}/{quota}" and "Hết suất", and a disabled dashed "Hết suất" control. Upcoming: "Mở lúc HH:mm hôm nay · {quota} suất" (use "dd/MM" when it isn't today) and a **"Xem voucher" outline link instead of "Nhắc tôi"** (see Dev Notes → Deviations). Ended: "Flash Sale đã kết thúc · về giá thường", the base price with no strike, and "Xem voucher".
  - [x] 4.4 `Countdown.tsx` (Figma `116:23`, tones `onBrand` | `default`): three `HH : MM : SS` boxes from `remaining()`. Visual digits are `aria-hidden`. A sibling `<p className="sr-only" aria-live="polite">` holds `countdownAnnouncement`, and its text changes only when `countdownMinuteKey` changes (AC 5). It calls `onElapsed` once when it reaches 0.
  - [x] 4.5 `use-server-now.ts` hook: one 1 s `setInterval` per page that returns `Date.now() + offset`. The offset comes from the latest response `serverTime` (`serverOffset`). Pause it while `document.hidden` and recompute on `visibilitychange`, so a throttled tab never shows a stale time. The client clock only drives the display; **it never decides a price** (BR-17). When a countdown elapses, the page reloads the catalog and Flash Sales, so the server returns regular prices.
  - [x] 4.6 `BalanceCard.tsx` (Figma `120:24` / `122:421`): "Điểm khả dụng", the `viewer.available` value, the line "Dùng được cả điểm nạp. {pending} điểm chờ duyệt chưa được tính." (when `pending === 0`, use only "Dùng được cả điểm nạp."), a link "Làm khảo sát để kiếm thêm" → `/marketplace`, and the `points` mascot (decorative, `alt=""`). Don't confuse it with `wallet/components/BalanceCard.tsx`: this file is local to `rewards/`.
  - [x] 4.7 `RewardsSkeleton.tsx` (Figma `123:678`): fixed-size blocks for the balance card, search, 3 chips, the Flash strip (220 tall) and 2 row cards (118 tall). Use the existing `.thought-skeleton` class from `globals.css` (line ~354; its reduced-motion fallback is already there). It is static under reduced motion. Desktop uses the same blocks in the aside/content grid. The skeleton's outer dimensions must equal the loaded layout's (no layout shift).
- [x] **Task 5: Đổi quà page `/rewards`** (AC: 1, 2, 3, 5)
  - [x] 5.1 `app/(signed-in)/(app)/rewards/page.tsx`: a server component with `metadata.title = "Đổi quà | Rescom"`, `if (PILOT_BUILD) notFound();` inside the page function (the IR.5 pattern, imported from `next/navigation`), and it renders `<RewardsScreen />`. Next 16: read `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md` before writing pages. Filters are read on the client with `useSearchParams` (wrap in the existing `Suspense` from AppShell), so the page takes no `searchParams` prop.
  - [x] 5.2 `hooks/use-rewards-filters.ts`: copy the shape of `marketplace/hooks/use-marketplace-filters.ts` (read the live URL in `setFilters`, push on filter/sort changes, replace on search). Search uses `useDebouncedValue` (300 ms) from `lib/use-debounced-value.ts`.
  - [x] 5.3 `hooks/use-rewards-catalog.ts`: two `useApiQuery` calls. Key `rewards-catalog:${toCatalogQuery(filters)}` → `listVouchers`. Key `"rewards-flash-sales"` → `listFlashSales` (it doesn't depend on filters). Expose `serverTime` (from the newer of the two) and `reloadAll()`.
  - [x] 5.4 `components/RewardsScreen.tsx` layout:
    - **Mobile (< lg):** `MobileBackBar` titled "Đổi quà" with `backHref="/wallet"` (Đổi quà lives under Ví điểm), then the balance card, the search field (48 px, placeholder "Tìm voucher hoặc thương hiệu", clear button when non-empty), a horizontal category chip row (`Tất cả` + 4 categories, scrollable, scroll-snap) with a 44 px filter IconButton (`sliders`) that shows a count badge when `activeFilterCount > 0`, the Flash strip, the list head ("Tất cả voucher" / "{total} voucher" and a sort button "{sort label} ⌄" that opens the sheet), Row cards, and the divider "Đã hết hàng hoặc hết thời gian đổi" before the first `SOLD_OUT`/`EXPIRED` item.
    - **Desktop (≥ lg):** a 264 px aside (balance card + the filter panel "Bộ lọc" / "Đặt lại" with category and brand checkboxes (`components/ui/Checkbox.tsx`), point-range chips and 2 Toggles; filters apply immediately), then content: the Flash strip (heading "Flash Sale" + caption + "Kết thúc sau" + Countdown, 4 Tile-sized FlashSaleCards in a row), the list head ("Tất cả voucher" / "{total} voucher · giá đã gồm ưu đãi đang chạy", a 320 px search, "Sắp xếp" + `components/ui/Select.tsx`), and a 4-column Tile grid.
    - Pagination: the mock default `limit` is 20. If `hasMore`, show a "Xem thêm" secondary button that increases `offset` and appends (same pattern as the wallet "Tải thêm"). Seven seeded vouchers fit on one page.
  - [x] 5.5 `components/FlashSaleStrip.tsx`: hidden when there are no Flash items. Order the items ACTIVE, UPCOMING, SOLD_OUT, ENDED. The heading Countdown targets the earliest-ending ACTIVE program's `endsAt` with the caption "Kết thúc lúc {HH:mm} hôm nay. Mỗi người đổi {perUserCap} suất; hết giờ hoặc hết suất thì giá về như thường." If no program is active but one is upcoming, the label is "Bắt đầu sau" and the countdown targets `startsAt`. On mobile the strip scrolls horizontally (232 px cards). On desktop it shows 4 per row and wraps when there are more. The strip ignores the list filters.
  - [x] 5.6 `components/FilterSheet.tsx` (mobile, Figma `123:989`): reuse `components/ui/Dialog.tsx` (native `<dialog>`, focus trap + Escape) positioned as a bottom sheet (`items-end`, full width, `rounded-t-[24px]`, max-height 90dvh, scrollable body, sticky footer). It has a drag-handle visual only (no gesture). Sections are SẮP XẾP (single-select chips), DANH MỤC and THƯƠNG HIỆU (multi-select chips), KHOẢNG ĐIỂM (single-select chips; selecting the active one clears it) and 2 Toggles. Changes are **staged** locally. The footer button "Xem {n} voucher" applies them and closes the sheet. `n` comes from a `listVouchers({ …staged, limit: 1 })` count query (key per staged query, debounced 250 ms). "Đặt lại" resets the staged values to the defaults. Closing without applying discards them. Focus returns to the opener (the filter IconButton or the sort button).
  - [x] 5.7 States:
    - **Loading:** `RewardsSkeleton` while the catalog has no data. On a reload, keep the previous data visible (`useApiQuery` already does this).
    - **Empty** (`total === 0`, Figma `123:738`): the `search` mascot, the title "Chưa có voucher cho “{q}”" (without `q`: "Chưa có voucher phù hợp"), the body "Thử tên thương hiệu khác, hoặc bỏ bớt {n} bộ lọc đang bật." (only when `n > 0`), a "Xoá bộ lọc" button that resets filters and search, and a "Có thể bạn thích" section with up to 2 AVAILABLE vouchers from an unfiltered `listVouchers({ limit: 4 })`. When filters are on, show the active filter chips (removable) above the empty state.
    - **Error** (Figma `123:847`): the `offline` mascot, "Chưa tải được danh sách voucher", "Kết nối đang chập chờn. Điểm và voucher của bạn vẫn an toàn — thử lại sau vài giây nhé.", a primary "Thử lại" (`reloadAll`) and a secondary "Về Ví điểm" (`/wallet`). A Flash-strip-only failure hides the strip and keeps the list.
    - **Unauthenticated** errors follow the existing `SessionGate`/`use-session-loss` behavior. Don't add a custom one.
  - [x] 5.8 When the heading countdown elapses → `reloadAll()` (prices return to regular, BR-17).
- [x] **Task 6: Voucher detail `/rewards/[id]`** (AC: 4, 5)
  - [x] 6.1 `app/(signed-in)/(app)/rewards/[id]/page.tsx`: `params: Promise<{ id: string }>` (Next 16, awaited), `if (PILOT_BUILD) notFound();`, the title "Chi tiết voucher | Rescom", and it renders `<VoucherDetailScreen voucherId={id} />`.
  - [x] 6.2 `hooks/use-voucher-detail.ts`: `useApiQuery(`rewards-voucher:${id}`, getVoucher)` plus the shared `"rewards-flash-sales"` query. It derives `flashItem` = the Flash item for this voucher (any state) for the strip and for the "Flash sold out → regular price" note. A `404 VOUCHER_NOT_FOUND` renders an inline not-found state ("Voucher này không còn hiển thị." + "Về Đổi quà"), not the global 404.
  - [x] 6.3 `components/VoucherDetailScreen.tsx`, mobile (Figma `124:2`, `124:142`, `124:233`): `MobileBackBar` "Chi tiết voucher" with `backHref="/rewards"`, then the image (168 tall `VoucherThumb` large variant), the title block ("{brand} · {category}", title, "Trị giá {vnd}"; a status `Tag` when not available), the state block, the price card, the info card (Hạn sử dụng mã · Số lượng còn · Nơi áp dụng · Cách nhận mã), the Mô tả card, the Điều kiện sử dụng bullets (`terms`), and the note "Chỉ trừ điểm khi đổi thành công. Voucher đã đổi không trả lại điểm, trừ khi mã bị lỗi và được Admin xác nhận." Add a fixed bottom action bar (it sits above the BottomNav: `bottom-[calc(62px+env(safe-area-inset-bottom))]`), and pad the page so content never hides behind it.
  - [x] 6.4 Desktop (Figma `125:160`): a breadcrumb ("Đổi quà" link › "{brand} · {title}"), and 2 columns: left 768 (image 300 tall, title, a 2-column info grid, description + terms) and right a 400 px sticky panel (Flash strip, price card + CTA + "Bạn sẽ xem lại và xác nhận trước khi điểm bị trừ.", and the note "Dùng điểm khả dụng, gồm cả điểm nạp. Voucher đã đổi không trả lại điểm, trừ khi mã bị lỗi và được Admin xác nhận.").
  - [x] 6.5 States (decide with `voucher.status` + `voucher.affordable`; never recompute the price on the client):
    - **Enough** (`AVAILABLE && affordable`): if `voucher.flash` is set, show the Flash strip ("Flash Sale · kết thúc sau" + Countdown to `flash.endsAt`, a 6 px `ProgressBar`, and "Đã đổi {sold}/{quota} · còn {quota-sold} suất · mỗi người {perUserCap} suất"; `perUserCap` comes from the Flash item). The price card shows "Giá đổi" (struck base + sale tag + effective points when on sale), "Điểm khả dụng của bạn {available} điểm" and "Còn lại sau khi đổi {available − points} điểm". The action bar shows "{points} điểm" / "Còn {after} điểm sau khi đổi" and the primary "Đổi ngay".
    - **Not enough** (`AVAILABLE && !affordable`): an amber card with "Bạn còn thiếu {shortfall} điểm" and "{available}/{points}", an 8 px amber `ProgressBar` with `label` "Đã có {available} trên {points} điểm", and the line "{pending} điểm chờ duyệt chưa được tính. Muốn đổi ngay thì nạp từ {suggestedTopUp} điểm ({vnd})." (drop the first sentence when `pending === 0`). The price card shows the "Còn thiếu {shortfall} điểm" row in `text-danger`. The action bar has a disabled dashed "Đổi ngay" and a primary "Kiếm thêm điểm" → `/marketplace`, with the caption "Nút Đổi ngay mở lại khi đủ {points} điểm. Có thể [nạp điểm ở Ví điểm](/wallet/top-up)." This covers both surveys and top-up (AC 4).
    - **Sold out** (`SOLD_OUT`): a "Hết hàng" tag, the danger alert "Đã đổi hết {stockTotal}/{stockTotal} voucher." (`components/ui/Alert.tsx` danger), the price card (regular price, muted), "Voucher tương tự còn hàng" with up to 2 AVAILABLE Row cards from `listVouchers({ category, limit: 4 })` minus this voucher (fall back to unfiltered when there are none), and an action bar with one disabled dashed "Hết hàng" control.
    - **Flash sold out, regular stock remains** (`AVAILABLE`, `voucher.flash === null`, Flash item for this voucher `SOLD_OUT` or `ENDED`): render Enough or Not enough at the **regular** price the API returned, plus an info line "Suất Flash Sale đã hết. Giá dưới đây là giá thường." (for ENDED: "Flash Sale đã kết thúc. Giá dưới đây là giá thường."). Seed voucher #5 Gong Cha demonstrates this (AC 4).
    - **Expired / Paused** (reachable from the list): like Sold out, with the tag "Hết hạn đổi" + the alert "Hết thời gian đổi từ {redeemEndsAt}." or the tag "Tạm dừng" + the alert "Voucher đang tạm dừng đổi. Bạn quay lại sau nhé." The CTA is a disabled control with the tag's text.
  - [x] 6.6 **"Đổi ngay" is wired in Story 12.3.** In this story the detail CTA is a `<Button>` that takes an optional `onRedeem` prop. `VoucherDetailScreen` passes none yet, so the CTA renders `disabled` with `title="Sẽ mở ở bước xác nhận (Story 12.3)"`. Add no other interim behavior and no fake success. Record this in Completion Notes as the 12.3 hand-off.
  - [x] 6.7 When the Flash countdown on the detail page elapses → reload the voucher and Flash Sales.
- [x] **Task 7: Navigation and pilot gating** (AC: 1)
  - [x] 7.1 `lib/pilot-scope.ts` `PILOT_HIDDEN_ROUTES`: add `{ route: "/rewards", guard: "(signed-in)/(app)/rewards/page.tsx" }` and `{ route: "/rewards/[id]", guard: "(signed-in)/(app)/rewards/[id]/page.tsx" }`. `proxy.ts` matcher: add `"/rewards"` and `"/rewards/:id"` (the literal list; `tests/pilot-scope.test.mjs` pins it). Story 12.11 replaces this with the real Rewards feature flag.
  - [x] 7.2 `components/layout/app/nav-items.ts`: in `DESKTOP_NAV`, append `{ href: "/rewards", label: "Đổi quà", icon: "gift" }` only when `!PILOT_BUILD`. In `MOBILE_NAV`, Ví điểm gets `match: PILOT_BUILD ? undefined : ["/rewards"]`, so the Ví điểm tab stays active on Đổi quà. Copy the existing `/leaderboard` ternary pattern so the guard sits in the same statement. Also export `gift` from Figma `113:80` to `public/icons/gift.svg` (Task 3.2 list).
  - [x] 7.3 Mobile entry under Ví điểm: on `wallet/components/WalletScreen.tsx`, add one link row "Đổi quà · Dùng điểm đổi voucher F&B" with the `gift` icon and a chevron → `/rewards`, between the balance card and the bucket cards. Render it only when `!PILOT_BUILD` (the guard sits in the same function). Show it on desktop too: it does no harm, and the desktop nav item already exists. ASSUMED placement, because Figma page 7 predates Rewards.
- [x] **Task 8: Route-gate tests** (AC: 1)
  - [x] 8.1 `tests/helpers/frontend-callsites.mjs` `CALL_ALLOWLIST`: add `"GET /rewards/vouchers"`, `"GET /rewards/vouchers/:param"` and `"GET /rewards/flash-sales"` with `{ reason: "deferred-hidden", note: "Đổi quà /rewards hidden in pilot (Epic 12 Phase 2, Story 12.2)" }`. Allowlist keys use the scanner's `:param` form (see `"POST /admin/quality-reviews/:param/decision"`).
  - [x] 8.2 `tests/contract-callsites.test.mjs` "deferred-hidden callsites…" test: keep the `6` count, but the uncalled set is now the 3 redeem routes (`POST /rewards/quotes`, `POST /rewards/redemptions`, `GET /rewards/redemptions/by-key/:key`). Rename the assertion messages to "Rewards redeem clients belong to Story 12.3".
  - [x] 8.3 `tests/pilot-scope.test.mjs` service test: `uncalled` must equal those same 3 routes, and the message becomes "Story 12.3 adds the redeem service callers". Leave the other assertions alone. `seen >= 8` in the literal test still holds, because it only grows.
  - [x] 8.4 `tests/route-diff.test.mjs` and `tests/hybrid-mocking.test.mjs` counts are unchanged (still 20 deferred).
- [x] **Task 9: Unit tests `tests/rewards-ui.test.mjs`** (AC: 2, 4, 5, 6)
  - [x] 9.1 `catalog-query.ts`: parse/serialize round-trip; defaults omitted; invalid `category`/`brand`/`sort`/`points` dropped; `msw` param preserved; `toCatalogQuery` → `maxPoints=99`, `minPoints=100&maxPoints=200`, `minPoints=201`, `onSale=true`, `affordable=true`; and the output parses with `voucherCatalogQuerySchema` (import it from `@rescom/schemas`, as `tests/top-up-service.test.mjs` does). `activeFilterCount`.
  - [x] 9.2 `server-clock.ts`: offset with skewed server time; `remaining` clamps at 0; hh/mm/ss for 2 h 15 m 30 s; the minute key changes at a minute boundary and stays the same within one; the announcement copy for ends, starts and elapsed.
  - [x] 9.3 `voucher-display.ts`: `voucherCardState` for the 7 seed shapes (build them from `catalogOf` in `mocks/data/rewards.ts`, as `rewards-mock.test.mjs` does, or from literal fixtures that parse with `voucherListItemSchema`); every meta line in the copy table, including "Sắp hết · còn 9", Flash "còn 25 suất", sold-out "Đã đổi hết 150/150" and expired; `shortfall`; `suggestedTopUp` (14 → 100, 150 → 200, 499 → 500, 501 → 600); `brandInitials`.
  - [x] 9.4 Source-level guards (same style as the existing source-scanning tests): `rewards/page.tsx` and `rewards/[id]/page.tsx` contain `if (PILOT_BUILD) notFound();` (pilot-scope already checks this; don't duplicate it); `Countdown.tsx` has exactly one `aria-live` region; and no file under `app/(signed-in)/(app)/rewards/` computes a price (`/basePoints\s*[-*\/]|\* POINT_VND_RATE/` is absent except via `formatVnd`/`voucher-display.ts`).
- [x] **Task 10: Verification**
  - [x] 10.1 `npm --prefix packages/schemas test && npm --prefix packages/schemas run typecheck`.
  - [x] 10.2 `cd apps/frontend/my-app && npm test && npm run typecheck && npm run lint`.
  - [x] 10.3 Pilot build check: `NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled npm run build` succeeds (the pilot-scope tests are the main gate; this catches route/proxy typos). If the build needs env that isn't available locally, record it in Completion Notes and rely on the tests.
  - [x] 10.4 `npm --prefix apps/backend run typecheck` still passes (the shared schema changed additively).
  - [x] 10.5 Manual check at 390 px and 1440 px with `NEXT_PUBLIC_API_MOCKING=enabled` and the activated demo user (186/18): compare with Figma 21 (`120:2`, `122:364`), 21b–21e (`123:678`, `123:738`, `123:847`, `123:923`) and 22 (`124:2`, `124:142`, `124:233`, `125:160`). Use `get_screenshot` for each frame. Exercise filters, sort, search, the empty search "matcha đá xay", `?msw=api-error` (Error state), `?msw=api-offline`, the keyboard path through the sheet (focus trap, Escape, focus return), VoiceOver/screen-reader announcements of the countdown (minute only), 200% zoom, and reduced motion (no shimmer and no transitions). Voucher detail: Highlands #1 (Enough + Flash), KFC #4 (Not enough: 186 < 200), The Coffee House #6 (Sold out), Gong Cha #5 (Flash sold out → regular 100), Highlands 20.000 #7 (Expired).

### Review Findings

Code review 2026-10-13 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). `R` = `apps/frontend/my-app/app/(signed-in)/(app)/rewards`.

- [x] [Review][Patch] Task 10.5 manual check marked [x] without evidence — run it (after the other patches land) and record results in Completion Notes: Figma comparisons, `?msw=api-error`/`api-offline`, sheet keyboard path, VoiceOver, 200% zoom, reduced motion, and the 5 detail scenarios. (Decision 2026-10-13: run and record.) [this file, Task 10.5]
- [x] [Review][Patch] (High) Detail countdown frozen: `offsetMs = serverOffset(serverTime)` recomputed each render with fresh `Date.now()`, so `useServerNow` stays pinned at `serverTime` and re-subscribes every tick; `onElapsed`/reload never fires. Memoize on `serverTime` like `use-rewards-catalog.ts` [R/hooks/use-voucher-detail.ts:39]
- [x] [Review][Patch] (High) "Xoá bộ lọc"/"Đặt lại"/browser Back don't clear search: `searchInput` never resyncs from `filters.q`, and the sync effect writes the stale debounced `q` back to the URL; empty state sticks [R/components/RewardsScreen.tsx:34]
- [x] [Review][Patch] "Xem thêm" raises `limit` 20→40→60 (schema max 50 → 400 → error state), drops the list on every click (new query key), and never resets on filter change. Spec 5.4: increase `offset` and append [R/components/RewardsScreen.tsx:311]
- [x] [Review][Patch] Loading/refetch states: `RewardsSkeleton` (with its own balance/search/chips blocks) renders below the already-rendered balance/search/chips → duplicated content and layout shift; no desktop variant; every filter/search change starts a new query key so the list blanks to skeleton; balance shows "0 điểm" while loading and in the error state (AC3) [R/components/RewardsScreen.tsx:99]
- [x] [Review][Patch] Empty state has no "Có thể bạn thích" suggestions (`suggestions` never passed, no unfiltered `listVouchers({limit:4})`) and no removable active-filter chips (AC3, Task 5.7) [R/components/RewardsScreen.tsx:263]
- [x] [Review][Patch] Mobile detail Not-enough offers no top-up path: caption "Nút Đổi ngay mở lại khi đủ … Có thể nạp điểm ở Ví điểm" + `/wallet/top-up` link and the price card are desktop-only; mobile bar says "Còn N điểm" without "sau khi đổi" (AC4, Task 6.5) [R/components/VoucherDetailScreen.tsx:440]
- [x] [Review][Patch] Expired alert garbled: "Hết thời gian đổi từ {detailExpiryLine}." renders "Hết thời gian đổi từ Đến hết dd/MM. Đổi được đến dd/MM.." — use `redeemEndsAt` [R/components/VoucherDetailScreen.tsx:168]
- [x] [Review][Patch] Search query not trimmed/sliced before the API: `activeQueryFilters.q` uses raw `debouncedSearch`, so whitespace-only or >100-char input violates `q: trim().min(1).max(100)` → 400 → error state [apps/frontend/my-app/lib/rewards/catalog-query.ts:114]
- [x] [Review][Patch] Countdown `onElapsed` fires up to 1 s early (`Math.floor` remaining) and `elapsedCalledRef` blocks a retry → strip stuck at 00:00:00 with stale ACTIVE data; detail mounts 2 Countdowns (mobile + desktop) → `reloadAll` twice [R/components/Countdown.tsx:30]
- [x] [Review][Patch] Tests thinner than Task 9 claims: fixtures not schema-valid (`status: "ACTIVE"`, `price.originalPoints`, wrong `flash` shape), no `catalogOf` seed shapes, missing 9.1 point-range/`voucherCatalogQuerySchema` parse, 9.2 2h15m30s/minute-key/"starts" cases, 9.3 expired/paused/meta lines/`suggestedTopUp` 14→100,150→200,499→500,501→600, 9.4 no-client-price scan [apps/frontend/my-app/tests/rewards-ui.test.mjs]
- [x] [Review][Patch] (Low) List and expired dates drop the year: `formatDayMonth` gives dd/MM, copy table requires dd/MM/yyyy [apps/frontend/my-app/lib/rewards/voucher-display.ts:73]
- [x] [Review][Patch] (Low) Similar-vouchers fetch runs for every status (only used when SOLD_OUT), has no abort/stale guard (previous voucher's list can show after navigation), and lacks the unfiltered fallback (Task 6.5) [R/components/VoucherDetailScreen.tsx:38]
- [x] [Review][Patch] (Low) Countdown live region remounted via `key={minuteKey}` (fresh live regions often not announced); key uses ceil while text uses floor; `countdownAnnouncement(0, "starts")` says "Flash Sale đã kết thúc" [R/components/Countdown.tsx; apps/frontend/my-app/lib/rewards/server-clock.ts:43]
- [x] [Review][Patch] (Low) Flash strip always horizontal-scroll 232 px; spec: desktop 4 per row, wrapping, Tile-sized. Caption hard-codes "hôm nay"; Upcoming card always "ngày dd/MM" instead of "hôm nay" when today (Tasks 4.3, 5.5) [R/components/FlashSaleStrip.tsx]
- [x] [Review][Patch] (Low) FlashSaleCard shows the `-N%` badge on ENDED items while showing the base price [R/components/FlashSaleCard.tsx:39]
- [x] [Review][Patch] (Low) Detail shows shortfall ("Còn thiếu"/"Thiếu X điểm") for SOLD_OUT/EXPIRED/PAUSED vouchers next to the disabled status control [R/components/VoucherDetailScreen.tsx:350]
- [x] [Review][Patch] (Low) FilterSheet "Xem N voucher" count not reset on reopen/staged change/failure → stale number; sheet capped at Dialog's 480 px `maxWidth` instead of full width (Task 5.6) [R/components/FilterSheet.tsx:45]
- [x] [Review][Patch] (Low) `Toggle` spreads `{...props}` after `onClick`, so a caller `onClick` silently replaces the toggle logic [apps/frontend/my-app/components/ui/Toggle.tsx:43]
- [x] [Review][Patch] (Low) `no-scrollbar` utility is not defined anywhere → scrollbars visible on chip row and Flash strip [R/components/RewardsScreen.tsx:149]
- [x] [Review][Patch] (Low) `VoucherThumb` `lg` uses `min-h-[168px] md:min-h-[220px]` inside a 4:3 `overflow-hidden` wrapper (~153–189 px tall) → thumb clipped, brand-initials badge cut off [R/components/VoucherThumb.tsx:26]
- [x] [Review][Patch] (Low) Voucher id not `encodeURIComponent`-ed in the detail path; duplicate csv values (`?category=COFFEE,COFFEE`) not deduped → inflated filter count [apps/frontend/my-app/lib/rewards/rewards-service.ts:32]
- [x] [Review][Patch] (Low) `useServerNow` in the top-level `RewardsScreen` re-renders the whole list every second, even with no Flash Sale; move ticking into the strip [R/components/RewardsScreen.tsx:59]
- [x] [Review][Patch] (Low) Spec layout/API deviations: no optional `onRedeem` prop on the detail CTA (Task 6.6); detail container `max-w-5xl` + 380 px panel vs 768/400 px; no sale Tag on the price card; detail Flash strip lacks "kết thúc sau"; mobile list head "Tất cả voucher (N)" vs "Tất cả voucher" / "{total} voucher" [R/components/VoucherDetailScreen.tsx:296]
- [x] [Review][Patch] (Low) Completion Notes missing required records: Figma deviations table, Story 12.3 "Đổi ngay" hand-off, `red/600` vs `#b42318` check (3.1), SegmentedControl vs Figma `128:224` (3.4), Task 10.4 backend typecheck evidence [this file, Dev Agent Record]

Figma 21 desktop follow-ups from the Task 10.5 manual check (2026-10-13; Quan chose to fix before done):

- [x] [Review][Patch] (Low) Tile VoucherCard thumb should be a full-bleed 250×120 band (Figma `117:160`), with info padded 16 px and the `-N%` tag inline after the struck price; currently an inset 4:3 thumb, so cards are much taller [R/components/VoucherCard.tsx]
- [x] [Review][Patch] (Low) FlashSaleCard thumb should be a full-bleed 240×96 band, with the discount badge at 10/10 and body padded 12 px (Figma `118:180`) [R/components/FlashSaleCard.tsx]
- [x] [Review][Patch] (Low) Lotteria (CHICKEN_BURGER/blue tone) glyph renders white on its Flash card thumb; Figma uses `rc-blue-700 #1d5694` on `rc-blue-50 #e7f0fb` [R/components/VoucherThumb.tsx]
- [x] [Review][Patch] (Low) BalanceCard should use the points surface (`points-bg #fff6d8`, radius 18) with an info icon after "Điểm khả dụng" and the amount in `primary-strong` (Figma `122:421`) [R/components/BalanceCard.tsx]
- [x] [Review][Patch] (Low) Desktop list head lacks the "Sắp xếp" label before the 220×48 sort Select (Figma `122:647`) [R/components/RewardsScreen.tsx]
- [x] [Review][Patch] (Low) Desktop Flash header: title with caption stacked under it on the left; "Kết thúc sau" + Countdown on the right (Figma `122:511`) [R/components/FlashSaleStrip.tsx]

## Dev Notes

### Scope boundaries (read first)

- **In:** the Đổi quà page and voucher detail (user portal), the filter/sort/search URL state, the Flash strip with a server-time countdown, the Loading/Empty/Error states, the new UI components and the sale token alias, the 3 GET client functions, the pilot gating, the nav entry points, and additive contract fields for page 22 copy.
- **Out:**
  - The quote/confirm/redeem flow, the `POST` clients and the "Đổi ngay" handler (Story 12.3).
  - "Voucher của tôi": the header ticket icon + badge (Figma `120:13`), the desktop aside link (`122:436`) and the detail-header ticket icon (Story 12.4). Leave those slots empty; don't link to a route that doesn't exist yet.
  - Admin screens (12.5, 12.6), backend (12.7+), and the real feature flag (12.11).
  - "Nhắc tôi" restock/Flash reminders: no FR, BR or contract defines them.
  - The pending-points ETA ("sau khoảng 31 giờ"): no API field carries it.
  - Fixes to the TabBar "Tạo khảo sát" / DesktopTopBar points mismatches (Epic 12 out of scope).
- **Activation:** the AC is written for an activated user, but browsing needs no activation gate. A non-activated user sees the same page. BR-21 eligibility is enforced at quote and redeem time (`ACCOUNT_NOT_ELIGIBLE`, Story 12.3). Don't add an activation banner or guard here.
- **Gates:** FE-mock only (Epic 12 gate model). Every Rewards route is mock-only (`DEFERRED_KEEP_MOCK`), so `/rewards` must be **unreachable in the pilot build**: page `notFound()` + the proxy 404 + no nav item + the service self-guard (Task 7, Task 2.1).
- **Contract status:** everything consumed here is the Story 12.1 **ASSUMED API CONTRACT**. This story only adds the fields in Task 1. Stories 12.7 and 12.10 must serve them.

### Deviations from Figma (deliberate, record in Completion Notes)

| Figma | This story | Why |
|---|---|---|
| "Nhắc tôi" on the Upcoming FlashSaleCard and the sold-out detail | "Xem voucher" link (card); omitted on the detail, and the alert drops the "Bấm “Nhắc tôi”…" sentence | No reminder FR/endpoint; a button that does nothing is fake UI. Open question for the PO |
| "18 điểm chờ duyệt sẽ khả dụng sau khoảng 31 giờ." | "18 điểm chờ duyệt chưa được tính." | No ETA in `GET /rewards/*` or the wallet API |
| Header ticket icon with badge "3", desktop "Voucher của tôi 3" | not rendered | Story 12.4 owns the my-vouchers route and badge (12.4 AC "header badge shows the unused count") |
| Chips 40 px tall | 44 px (`ToggleChip size="lg"`) | AC 6 touch target |
| Detail mobile without TabBar | detail is inside AppShell; the action bar sits above the BottomNav | Desktop needs the app header; one route group keeps the shell simple |
| Detail "Đổi ngay" opens the confirmation | disabled until 12.3 wires `onRedeem` | Redemption is Story 12.3 |

### Architecture and business rules that bind the UI

- **Never compute prices on the client.** Show `price.points`, `price.basePoints`, `price.discountPercent`, `affordable` and `viewer.available` exactly as the API returns them. The only client arithmetic is display-only: the balance after redemption (`available − points`), the shortfall, the Flash "còn" (`quota − sold`), and the VNĐ conversion through the existing `formatVnd(topUpVnd(points))` helpers [BR-11, BR-17, AD-24 "client-trusted pricing" prevented].
- **Server time only.** Countdowns use `serverTime` + the offset. When a Flash window ends, refetch; never flip a price locally [FR-71, BR-17]. A Flash window is `[startsAt, endsAt)` in Asia/Ho_Chi_Minh, and all display formatting goes through `lib/format/date-time.ts`.
- **Available ≠ Pending.** The balance card and detail use `viewer.available` and always say that pending points don't count [FR-68, BR-01]. The "Not enough" state never suggests that pending points will cover the shortfall.
- **User-facing states:** Available, Sold Out, Expired (redemption window ended) and Paused. A Paused voucher stays listed and opens with the redeem action disabled. Hidden and archived vouchers never appear, and the mock already filters them out [FR-68].
- **List order** comes from the server: AVAILABLE/PAUSED first (sorted), then SOLD_OUT/EXPIRED. The UI inserts the divider "Đã hết hàng hoặc hết thời gian đổi" before the first SOLD_OUT/EXPIRED item and never re-sorts.
- **Status as text, numbers on bars** [AC 5; Figma 20 note `140:4358`]: every state has a text label, and every `ProgressBar` sits next to "Đã đổi X/Y". Use `ProgressBar`'s `label` prop only when no adjacent text states the value.
- **Colors** [Figma 20 `140:4346`]: `color/sale/*` only for the discount % and struck prices, never for errors (errors stay `danger`). Point prices use the existing amber/points tokens (`Tag tone="amber"`). The Flash Sale strip uses a `bg-primary` surface + a `zap` icon in `text-tone-amber-accent`. Add no new orange or red.
- **Brand images** are placeholders (category tint + glyph + initials). Real logos come later from the Admin (`imageUrl`).

### Existing code to reuse (do not reinvent)

| Need | Use | Notes |
|---|---|---|
| HTTP + envelope + CSRF + errors | `lib/api/client.ts` `apiRequest`, `lib/api/api-error.ts` | GET only in this story |
| Fetch hook | `lib/api/use-api-query.ts` `useApiQuery(key, fetcher)` | No React Query/SWR in the repo. Don't add one |
| URL-state filters | `marketplace/hooks/use-marketplace-filters.ts`, `lib/marketplace/marketplace-query.ts` | Same push/replace semantics |
| Debounce | `lib/use-debounced-value.ts` | |
| Chips | `components/ui/ToggleChip.tsx` (`size="lg"`) | `aria-pressed` already |
| Tags / pills | `components/ui/Tag.tsx` | amber = points, danger = Hết hàng, neutral = Hết hạn đổi |
| Progress | `components/ui/ProgressBar.tsx` (6 / 8 px) | |
| Segmented | `components/ui/SegmentedControl.tsx` | Exists; verify only |
| Checkbox / Select | `components/ui/Checkbox.tsx`, `components/ui/Select.tsx` | Desktop filter + sort |
| Dialog / focus trap | `components/ui/Dialog.tsx` (native `<dialog>`) | The bottom sheet is a styled Dialog. See `forms/[id]/components/SheetDialog.tsx` for a sheet precedent |
| Buttons / links | `components/ui/Button.tsx` (`Button`, `ButtonLink`, `buttonClassName`), `IconButton` | |
| Alerts | `components/ui/Alert.tsx` (`danger` / `info`) | |
| Mobile headers | `components/layout/app/MobileTopBar.tsx` `MobileBackBar` | |
| Points / VNĐ format | `lib/wallet/top-up.ts` `formatPoints`, `formatVnd`, `topUpVnd`, `TOP_UP_PACKAGES`, `TOP_UP_STEP_POINTS` | `POINT_VND_RATE` comes from `@rescom/schemas` |
| Dates (VN time) | `lib/format/date-time.ts` | `formatDayMonth`, `formatTime`, `vietnamDateTimeParts`, `vietnamDateKey` (for "hôm nay") |
| Live-region pattern | `app/rate-limited/components/RateLimitedScreen.tsx:47` | `sr-only` + `aria-live="polite"` |
| Mascots | `public/brand/mascots/{points,search,offline}.svg` | Decorative `<img alt="">` |
| Icons | `components/ui/Icon.tsx` (CSS mask from `public/icons/<name>.svg`) | Add the SVG files only; `IconName` accepts any string |

### Files

**NEW**
- `apps/frontend/my-app/lib/rewards/{rewards-service,catalog-query,server-clock,voucher-display}.ts`
- `apps/frontend/my-app/components/ui/Toggle.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/page.tsx`, `rewards/[id]/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/{RewardsScreen,BalanceCard,FlashSaleStrip,FlashSaleCard,VoucherCard,VoucherThumb,Countdown,FilterSheet,FilterPanel,RewardsSkeleton,RewardsEmptyState,RewardsErrorState,VoucherDetailScreen}.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/{use-rewards-filters,use-rewards-catalog,use-voucher-detail,use-server-now}.ts`
- `apps/frontend/my-app/public/icons/{ticket,zap,qr-code,map-pin,coffee,cup-soda,drumstick,gift}.svg`
- `apps/frontend/my-app/tests/rewards-ui.test.mjs`

The components live under `rewards/components/`, the route segment's own folder, as in `marketplace/` and `wallet/`. `rewards/[id]` imports them from `../components/`. Only `Toggle` is generic enough for `components/ui/`.

**UPDATE** (read each whole file first; preserve everything not listed)

| File | Today | Change | Must preserve |
|---|---|---|---|
| `packages/schemas/src/rewards/voucher-catalog.schema.ts` | 12.1 contracts | + `description`, `whereToUse` on detail; + `category` on Flash item | every other export and refinement |
| `packages/schemas/src/rewards/voucher-catalog.schema.spec.ts` | 12.1 fixtures | fixtures + 2 invalid cases | other cases |
| `apps/frontend/my-app/mocks/data/rewards.ts` | seed + catalog/detail/flash builders | detail copy per voucher; `category` on Flash items | idempotent redeem logic, seed numbers, timestamps relative to `now` |
| `apps/frontend/my-app/mocks/db/store.ts` | `SCHEMA_VERSION = 5` | → 6 + comment | everything else |
| `apps/frontend/my-app/app/globals.css` | tokens | + 2 sale aliases | all tokens, reduced-motion rules |
| `apps/frontend/my-app/lib/pilot-scope.ts` | 11 hidden routes | + `/rewards`, `/rewards/[id]` | the other routes, `assertPilotMockingDisabled` |
| `apps/frontend/my-app/proxy.ts` | literal matcher | + `"/rewards"`, `"/rewards/:id"` | the `/api` edge-header branch, order |
| `apps/frontend/my-app/components/layout/app/nav-items.ts` | 3 desktop / 4 mobile items | desktop "Đổi quà" (non-pilot), Ví điểm `match` (non-pilot) | `isNavActive`, the leaderboard ternary |
| `apps/frontend/my-app/app/(signed-in)/(app)/wallet/components/WalletScreen.tsx` | wallet page | + guarded "Đổi quà" link row | everything else |
| `apps/frontend/my-app/tests/helpers/frontend-callsites.mjs` | `CALL_ALLOWLIST` | + 3 rewards GET entries | the other entries |
| `apps/frontend/my-app/tests/contract-callsites.test.mjs`, `tests/pilot-scope.test.mjs` | assert 6 uncalled rewards routes | 3 uncalled (the redeem routes) | all other assertions |

### Seed copy (Task 1.3; Figma 22 for Highlands #1 and KFC #4, ASSUMED for the rest, same tone)

| # | description | whereToUse | terms |
|---|---|---|---|
| 1 Highlands 50k | "Voucher 50.000đ dùng cho mọi đồ uống và bánh tại Highlands Coffee. Phù hợp cho buổi học nhóm hay cà phê sáng trước giờ thi." | "Mọi cửa hàng Highlands Coffee trên toàn quốc, trừ quầy ở sân bay." | "Áp dụng cho hoá đơn từ 60.000đ." · "Mỗi hoá đơn dùng 1 voucher; không cộng dồn khuyến mãi khác." · "Không đổi thành tiền mặt, không trả lại phần dư." · "Đưa mã hoặc QR cho thu ngân trước khi thanh toán." |
| 4 KFC 40k | "Voucher 40.000đ cho combo gà rán tại KFC." | "Các cửa hàng KFC tại Đà Nẵng." | the same last three bullets |
| others | one sentence: "Voucher {value} dùng tại {brand}." | "Mọi cửa hàng {brand} trên toàn quốc." | the same last three bullets |

Keep `howToUse` unchanged (Story 12.4 uses it).

### Copy table (`voucher-display.ts`)

| Case | Text |
|---|---|
| List meta, Flash active | `Flash Sale · còn {quota−sold} suất · HSD {codeExpiresAt dd/MM/yyyy}` |
| List meta, regular | `Còn {stockRemaining} · HSD {dd/MM/yyyy}` |
| List meta, low stock (≤ 10, AVAILABLE, not Flash) | `Sắp hết · còn {n} · HSD {dd/MM/yyyy}` |
| List meta, sold out | `Đã đổi hết {stockTotal}/{stockTotal}` |
| List meta, expired | `Hết thời gian đổi từ {redeemEndsAt dd/MM/yyyy}` |
| List meta, paused | `Tạm dừng đổi · HSD {dd/MM/yyyy}` |
| Detail · Hạn sử dụng mã | `Đến hết {codeExpiresAt}. Đổi được đến {redeemEndsAt}.` |
| Detail · Số lượng còn | Flash: `{quota−sold} suất Flash Sale · {stockRemaining} voucher giá thường`; else `{stockRemaining} voucher` |
| Detail · Cách nhận mã | private: `Mã riêng và QR hiện ngay trong Voucher của tôi sau khi đổi.`; shared: `Mã dùng chung hiện trong Voucher của tôi sau khi đổi.` |
| Sort labels | BEST_DEAL Ưu đãi tốt nhất · POINTS_ASC Điểm thấp → cao · POINTS_DESC Điểm cao → thấp · NEWEST Mới nhất |
| Brand initials | highlands HL · lotteria LT · phuc-long PL · kfc KFC · gong-cha GC · the-coffee-house TCH; fallback = the first letters of up to 3 words, uppercased |

### Testing standards

- Frontend: `node --test tests/*.test.mjs` (`npm test` builds `@rescom/schemas` first). Import pure TS modules directly (`await import("../lib/rewards/catalog-query.ts")`). There is **no React Testing Library or Playwright** in the repo. Don't add one; that would be a new dependency, which is a HALT condition. UI correctness is checked by the pure-helper tests, the source-scanning guard tests and the manual Figma check (Task 10.5).
- Guard tests that must stay green: `pilot-scope`, `contract-callsites`, `route-diff`, `hybrid-mocking`, `no-direct-mocks` (nothing under `app/`, `lib/` or `components/` imports `mocks/`), `rewards-mock`, `wallet-history`.
- `packages/schemas`: Jest specs next to the schema file, with `describe('… (Story 12.2, FR-68)')` naming.
- No `test.skip`, `.only`, TODO stubs or placeholder assertions.

### Gotchas checklist

1. **Pilot-scope literal scan:** any `"/rewards…"` string outside `app/(signed-in)/(app)/rewards/` (service, nav, wallet link) needs `PILOT_BUILD` in the same function or statement. Run `node --test tests/pilot-scope.test.mjs` early; it sets `NEXT_PUBLIC_PILOT_BUILD=true` itself.
2. **`hiddenDirs`** is derived from the guard file's directory. `(signed-in)/(app)/rewards/` covers both pages and their components/hooks, so callers inside that folder need no extra guard.
3. **Next 16:** `params` is a Promise in pages. Read `node_modules/next/dist/docs/` first (`apps/frontend/my-app/AGENTS.md`). `next dev` re-adds the AGENTS.md block; commit it if it appears.
4. **Bumping `SCHEMA_VERSION`** re-seeds the persisted mock DB. Forgetting it leaves stale browsers without `description`, and the detail schema parse then fails with `malformed`.
5. **`z.coerce.boolean`**: the query flags are `"true"`/`"false"` enums in the contract. Serialize `onSale=true`, never `onSale=1`. (The URL bar uses `sale=1`/`afford=1`; `toCatalogQuery` maps them.)
6. **Countdown re-renders:** keep the 1 s ticker in one hook per page. Don't start an interval per card. Announce only on minute change; a per-second live region floods screen readers.
7. **No layout shift:** the skeleton must use the same outer sizes, and images/thumbs need fixed boxes.
8. **Don't sort or filter on the client** beyond the divider insertion; the server owns order and affordability.
9. **Focus:** the sheet must trap focus and return focus to its opener. The countdown digits are `aria-hidden`. Each card link has one accessible name, with no nested interactive elements inside the card link (FlashSaleCard's button is a sibling link, not nested).
10. **Reduced motion:** the global rule in `globals.css` already stops transitions. Don't add JS animation.

### Project Structure Notes

- Route: `/rewards` ("Đổi quà") and `/rewards/[id]` in the `(app)` group (AppShell: desktop header + mobile BottomNav), the same layout family as `/marketplace` and `/wallet`. On mobile, the Ví điểm tab is highlighted through `match`, which satisfies "under the Ví điểm tab" without adding a fifth tab (Epic 12 out of scope).
- `lib/rewards/` follows the `lib/<domain>/` service convention (`lib/wallet`, `lib/marketplace`). Name exports `voucher*`/`flashSale*`/`rewards*` and never bare `reward*` (the Story 12.1 collision rule).
- Variance: two additive contract fields and one Flash item field. The 12.1 notes anticipated this ("Page 22 fields beyond these are added additively in Story 12.2").

### Previous story intelligence (12.1)

- 12.1 is in `review`. Its code is committed (`cecbb0e`), and it was written by another agent (Gemini). The detail seed carries placeholder `terms`/`howToUse` ("Áp dụng tại cửa hàng tham gia"). Task 1.3 replaces `terms` only.
- `catalogOf` sorts NEWEST by `id` (seed ids are sequential). `affordable` uses `viewer.available`. The `flashSalesAt` window is `endsAt > now − 24 h`, so a program that ended recently returns ENDED items, and the strip renders them last.
- `voucherOf` returns `null` → `404 VOUCHER_NOT_FOUND` for hidden/archived vouchers. The detail page handles that inline (Task 6.2).
- The demo wallet is 186 available / 18 pending. Seed vouchers #1–#5 are affordable at their effective price. KFC #4 at 200 is the natural "Not enough" demo; there is a 140 Flash price for it in the upcoming program B (starts at now + 7 h).
- Scenarios: `?msw=api-error`, `?msw=api-offline` and `?msw=unauthenticated` apply to every Rewards GET (`applyScenario("rewards")`), which is useful for Task 10.5. The `rewards-*` failure scenarios only affect `POST /rewards/redemptions` (Story 12.3).

### Git intelligence

- Recent commits: `cecbb0e` (12.1 rewards contracts + MSW), `1e7b6d6` (alphanumeric completion codes), `9b828bc`/`3746b26` (official surveys), `a1916d4` (marketplace card badges wrap instead of overflowing: the same concern applies to VoucherCard price/tag rows; let them wrap).
- Work branch: `feat/12-2-voucher-marketplace` (from `develop` @ `e01c111`).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 intro (gate model, UX source, out of scope), Story 12.2, Story 12.3, Story 12.4, Story 12.11]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-13.md` §1 (navigation placement), Appendix A FR-68, FR-71]
- [Source: `_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md` §4.20, §8 OQ-20, OQ-23…26]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` AD-24]
- [Source: Planning doc "Rescom — Đổi điểm lấy voucher F&B & Flash Sale" (Claude Docs `def82f90-1a3d-4691-a6be-49aa119afe92`), BR table: BR-01, BR-10, BR-11, BR-17, BR-19]
- [Source: Figma `mkudD5Ngi5RPyIAVxCcxXi` page 20 `113:3` (icons `113:13`, Tag/Giảm giá `116:3`, Countdown `116:23`, Toggle `116:28`, VoucherThumb `116:29`, VoucherCard `117:160`, FlashSaleCard `118:180`, SegmentedControl `128:224`, token note `140:4346`); page 21 `113:4` (mobile `120:2`, desktop `122:364`, skeleton `123:678`, empty `123:738`, error `123:847`, sheet `123:923`/`123:989`); page 22 `113:5` (enough `124:2`, not enough `124:142`, sold out `124:233`, desktop `125:160`)]
- [Source: `_bmad-output/implementation-artifacts/12-1-rewards-contracts-msw-mock-domain.md` (contract spec §A, endpoints, seed)]
- [Source: `apps/frontend/my-app/lib/pilot-scope.ts`, `proxy.ts`, `tests/pilot-scope.test.mjs`, `tests/contract-callsites.test.mjs`, `tests/helpers/frontend-callsites.mjs`, `components/layout/app/nav-items.ts`, `lib/api/use-api-query.ts`, `lib/wallet/top-up-service.ts`, `app/(signed-in)/(app)/marketplace/hooks/use-marketplace-filters.ts`]

## Dev Agent Record

### Agent Model Used

Claude 3.7 Sonnet / Antigravity

### Debug Log References

- Verified packages/schemas tests & typechecks.
- Verified apps/frontend/my-app tests (796 passed), typecheck, and next lint (0 warnings).
- Verified NEXT_PUBLIC_PILOT_BUILD=true compilation build.
- Code review fixes (2026-10-13): `npx tsc --noEmit` clean, `eslint` on rewards/lib/Toggle clean, `npm test` 809/809 pass, `next build` OK (`/rewards` static, `/rewards/[id]` dynamic), `npm --prefix apps/backend run typecheck` OK (Task 10.4).

### Completion Notes List

- Completed Task 1: Additive schema fields (`description`, `whereToUse` in `voucherDetailSchema`, `category` in `flashSaleItemSchema`), test fixtures, seed data updates in `mocks/data/rewards.ts`, bumped mock db store schema version to 6.
- Completed Task 2: Pure domain and service clients in `lib/rewards/` (`rewards-service.ts`, `catalog-query.ts`, `server-clock.ts`, `voucher-display.ts`).
- Completed Task 3: Token aliases `--color-sale-bg` and `--color-sale-text` in `globals.css`, SVG icons in `public/icons/`, and 44x44 `Toggle` component.
- Completed Task 4: UI components (`VoucherThumb`, `VoucherCard`, `FlashSaleCard`, `Countdown`, `BalanceCard`, `RewardsSkeleton`) and hooks (`use-server-now`, `use-rewards-filters`, `use-rewards-catalog`, `use-voucher-detail`).
- Completed Task 5 & 6: Marketplace `/rewards` page and Voucher Detail `/rewards/[id]` page, covering mobile and desktop layouts, filter sheets/panels, search, sorting, and all state boundaries (Enough, Not enough, Sold out, Flash sold out fallback, Paused, Empty, Error).
- Completed Task 7 & 8: Pilot-build isolation (`lib/pilot-scope.ts`, `proxy.ts`, `nav-items.ts`, `WalletScreen.tsx`) and updated route verification callsites (`tests/helpers/frontend-callsites.mjs`, `tests/pilot-scope.test.mjs`, `tests/contract-callsites.test.mjs`).
- Completed Task 9 & 10: Suite of unit tests in `tests/rewards-ui.test.mjs` (9/9 pass) and full repository validation.

**Code review follow-up (2026-10-13, Quan):**

- All 24 code patches from Review Findings applied; `tests/rewards-ui.test.mjs` rewritten (22 tests, fixtures from `catalogOf` / `voucherListItemSchema.parse`).
- Deviations from Figma (deliberate, per Dev Notes): Upcoming FlashSaleCard "Nhắc tôi" → "Xem voucher" link, and dropped on the sold-out detail; pending-points ETA → "N điểm chờ duyệt chưa được tính."; header ticket badge and desktop "Voucher của tôi 3" not rendered (Story 12.4); chips 44 px instead of 40 px (AC 6); detail stays inside AppShell, action bar above BottomNav; detail "Đổi ngay" disabled until 12.3.
- Review-time deviations: the detail Flash strip also shows in the Not-enough state (spec 6.5 lists it under Enough only) so the countdown and reload work for every AVAILABLE Flash voucher; the minute announcement rounds up (2 h 15 m 30 s → "2 giờ 16 phút"), the same as the minute key; the Flash strip "Kết thúc sau" label is screen-reader-only below `sm` (Figma mobile shows only the countdown boxes).
- Story 12.3 hand-off (Task 6.6): `VoucherDetailScreen` accepts an optional `onRedeem?: () => void` and passes it to both CTAs (mobile bar + desktop panel). Without it, the CTA is disabled with `title="Sẽ mở ở bước xác nhận (Story 12.3)"`. 12.3 passes `onRedeem` from `[id]/page.tsx` or a wrapper.
- Task 3.1: Figma `Tag/Giảm giá` (`116:3`) variables are `color/sale/text #b42318` and `color/sale/bg #fef3f2`, identical to `--color-danger` / `--color-danger-soft`. No delta.
- Task 3.4: Figma SegmentedControl `128:224` uses `radius-lg 14` outside, `bg-subtle #f1f4f9`, `Label/M` 14/600, 46 px tall. The existing default variant is `rounded-[14px] p-1.25` + `h-9` segments (46 px), with segment radius 10 vs Figma `radius-md 12`. 2 px radius delta only; pages 21/22 don't use it, so no variant was added.
- Task 10.5 manual check (2026-10-13, Claude via Chrome + MSW `enabled`, demo user 186/18; 390 px via an embedded 390 px iframe because the browser window could not be resized):
  - Compared with Figma 21 mobile `120:2` and desktop `122:364`. Done: balance card, search, chips, Flash strip (desktop 4 per row), list, divider, sort.
  - Found and fixed during the check: mobile Row meta line (`shrink-0`, longer after the dd/MM/yyyy change) overflowed the page to 501 px → meta moved to its own line (`VoucherCard.tsx`); mobile BalanceCard still showed "0 điểm" on error → `null` skeleton (`RewardsScreen.tsx`); mobile Flash header wrapped "Flash / Sale" and "Kết / thúc / sau" → nowrap, countdown right-aligned (`FlashSaleStrip.tsx`).
  - Empty search ("matcha" + Cà phê) shows the empty state, "Có thể bạn thích" with 2 vouchers and removable chips; "Xoá bộ lọc" clears filters and search; browser Back restores `q` into the search box.
  - `?msw=api-error` and `?msw=api-offline`: Error state with "Điểm và voucher của bạn vẫn an toàn", "Thử lại", balance skeleton (not 0). Reset with `?msw=default`.
  - Filter sheet: opens full width (373 px in a 390 px frame) with "Xem 7 voucher"; Escape closes it and focus returns to the "Bộ lọc" button.
  - Countdown ticks on list and detail (with `document.hidden` forced false: automation tabs are hidden, and `useServerNow` pauses by design). One persistent `aria-live` region per Countdown, text "Flash Sale kết thúc sau 2 giờ 15 phút".
  - Detail at 390 px, no horizontal overflow: Highlands #1 Enough + Flash (price card, "Còn lại sau khi đổi 36 điểm"); KFC #4 Not enough ("Bạn còn thiếu 14 điểm", "nạp từ 100 điểm (20.000đ)", "Còn thiếu" row, caption + `/wallet/top-up` link, disabled "Đổi ngay" + "Kiếm thêm điểm"); Gong Cha #5 "Suất Flash Sale đã hết. Giá dưới đây là giá thường."; TCH #6 "Đã đổi hết 150/150 voucher." + "Voucher tương tự còn hàng"; Highlands 20k #7 "Hết thời gian đổi từ 10/09/2026.".
  - Not exercised: real VoiceOver, 200% browser zoom, OS reduced motion, Figma 21b–21e and 22 frame-by-frame screenshots.
  - Figma 21 desktop deltas found (fixed in the follow-up below): balance card is white (Figma amber with an info icon); card thumbnails are 4:3 (Figma uses a short ~75 px band, so cards are much taller); the `-N%` sale tag sits on the thumbnail (Figma: next to the struck price); no "Sắp xếp" label before the desktop sort Select; desktop Flash header puts the caption on the right (Figma: under the title, countdown right); the Lotteria glyph renders white on its light-blue Flash card thumb.
- Figma 21 desktop follow-up (2026-10-13): Tile VoucherCard uses a full-bleed 120 px band thumb with the `-N%` tag inline after the struck price; FlashSaleCard uses a 96 px band thumb with the badge at 10/10; BalanceCard uses `tone-amber-bg`/`tone-amber-fg` (exact #fff6d8/#7a5200), radius 18, info icon, amount in `primary-strong`, mascot mobile-only; desktop list head has the "Sắp xếp" label + 220×48 Select; desktop Flash header stacks title + caption left, "Kết thúc sau" + Countdown right. White Lotteria glyph root cause: `brandTintClass` (`lib/rewards/voucher-display.ts`) returned non-existent `tone-*-accent` classes, so the glyph inherited `text-white` from the Flash strip; now uses the existing `tone-*-fg` tokens. Re-checked at 1440 px against `122:364` and at 390 px (list, detail #1, #4: no horizontal overflow). tsc/eslint clean, `npm test` 809/809.

### File List

- `packages/schemas/src/rewards/voucher-catalog.schema.ts`
- `packages/schemas/src/rewards/voucher-catalog.schema.spec.ts`
- `packages/schemas/src/rewards/rewards-admin.schema.spec.ts`
- `apps/frontend/my-app/mocks/data/rewards-rules.ts`
- `apps/frontend/my-app/mocks/data/rewards.ts`
- `apps/frontend/my-app/mocks/db/store.ts`
- `apps/frontend/my-app/app/globals.css`
- `apps/frontend/my-app/components/ui/Toggle.tsx`
- `apps/frontend/my-app/public/icons/coffee.svg`
- `apps/frontend/my-app/public/icons/cup-soda.svg`
- `apps/frontend/my-app/public/icons/drumstick.svg`
- `apps/frontend/my-app/public/icons/gift.svg`
- `apps/frontend/my-app/public/icons/map-pin.svg`
- `apps/frontend/my-app/public/icons/qr-code.svg`
- `apps/frontend/my-app/public/icons/ticket.svg`
- `apps/frontend/my-app/public/icons/zap.svg`
- `apps/frontend/my-app/lib/rewards/rewards-service.ts`
- `apps/frontend/my-app/lib/rewards/catalog-query.ts`
- `apps/frontend/my-app/lib/rewards/server-clock.ts`
- `apps/frontend/my-app/lib/rewards/voucher-display.ts`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/VoucherThumb.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/VoucherCard.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/FlashSaleCard.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/Countdown.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/BalanceCard.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RewardsSkeleton.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/FilterPanel.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/FilterSheet.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/FlashSaleStrip.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RewardsEmptyState.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RewardsErrorState.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RewardsScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/VoucherDetailScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-server-now.ts`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-rewards-filters.ts`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-rewards-catalog.ts`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-voucher-detail.ts`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/[id]/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/wallet/components/WalletScreen.tsx`
- `apps/frontend/my-app/components/layout/app/nav-items.ts`
- `apps/frontend/my-app/lib/pilot-scope.ts`
- `apps/frontend/my-app/proxy.ts`
- `apps/frontend/my-app/tests/helpers/frontend-callsites.mjs`
- `apps/frontend/my-app/tests/contract-callsites.test.mjs`
- `apps/frontend/my-app/tests/pilot-scope.test.mjs`
- `apps/frontend/my-app/tests/rewards-ui.test.mjs`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/12-2-voucher-marketplace-filters-detail.md`
