---
baseline_commit: d241be89b3490c0c19aee54940791fdb37f0a2b7
---
# Story 12.3: Confirm & Redemption Result

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a User,
I want to confirm the exact price before Points are deducted and get a clear result,
so that I never lose Points by mistake.

## Acceptance Criteria

1. **Quote and confirmation.** Given a voucher the user can redeem, when they tap Đổi ngay, then a quote is requested and a confirmation opens (bottom sheet on mobile, dialog on desktop) showing the locked price, the balance after redemption, and the Flash price end time (Figma page 23, FR-69).
2. **Idempotency and lock.** One idempotency key is created when the confirmation opens. The confirm button locks after the first tap. Resubmitting returns the first result.
3. **Success.** Success shows the ticket summary, the balance counting down in 400 ms, and a mascot with light confetti in 600 ms. All motion is disabled under reduced motion.
4. **Errors.** `SOLD_OUT`, `PRICE_CHANGED` (shows the new price and asks to confirm again) and `INSUFFICIENT_POINTS` (shows the new balance) have their own screens. `VOUCHER_UNAVAILABLE` and `ACCOUNT_NOT_ELIGIBLE` use the shared error sheet. Every error says "bạn chưa bị trừ điểm" and offers one next action.
5. **Network loss.** On network loss the client polls by idempotency key 3 times (after 2, 4 and 8 seconds), then shows "Đang kiểm tra kết quả".
6. **Focus.** The confirmation traps focus and returns focus to Đổi ngay when closed.

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.3 (FR-69, FR-74, BR-02, BR-07, BR-08, BR-09, BR-17, BR-21; AD-24).

## Tasks / Subtasks

- [x] **Task 1: Contract types (type-only, additive)** (AC: 1, 2, 4)
  - [x] 1.1 In `packages/schemas/src/rewards/redemption.schema.ts`, add `export type` lines only: `RedemptionQuoteDto`, `RedemptionResultDto`, `RedemptionErrorDto`, `RedemptionErrorCode`, `AccountNotEligibleReason`, `VoucherTicketDto` (`z.infer` of the existing schemas). Change no schema. Match the `VoucherCatalogDto` style in `voucher-catalog.schema.ts:40-54`.
  - [x] 1.2 `npm --prefix packages/schemas test && npm --prefix packages/schemas run typecheck` pass.
- [x] **Task 2: Redeem client functions** (AC: 1, 2, 5)
  - [x] 2.1 In `lib/rewards/rewards-service.ts`, add three functions after `listFlashSales`. Each starts with `if (PILOT_BUILD) rejectPilot();` (required by `tests/pilot-scope.test.mjs` `SERVICE_SELF_GATE`):
    - `createRedemptionQuote(voucherId, signal?)` → `apiRequest("/rewards/quotes", { method: "POST", body: { voucherId }, schema: redemptionQuoteSchema, signal })`.
    - `redeemVoucher(quoteId, idempotencyKey, signal?)` → `apiRequest("/rewards/redemptions", { method: "POST", body: { quoteId }, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }, schema: redemptionResultSchema, signal })`. Same header pattern as `lib/participation/external-service.ts:84`.
    - `getRedemptionByKey(idempotencyKey, signal?)` → `GET /rewards/redemptions/by-key/${encodeURIComponent(idempotencyKey)}` with `redemptionResultSchema`.
    - CSRF is automatic for POST (`apiRequest`). Don't add it by hand.
  - [x] 2.2 `tests/helpers/frontend-callsites.mjs` `CALL_ALLOWLIST`: add `"POST /rewards/quotes"`, `"POST /rewards/redemptions"` and `"GET /rewards/redemptions/by-key/:param"` with `{ reason: "deferred-hidden", note: "Đổi quà redeem hidden in pilot (Epic 12 Phase 2, Story 12.3)" }`.
  - [x] 2.3 `tests/contract-callsites.test.mjs` "deferred-hidden callsites…" test: every deferred route now has a caller. Delete `uncalledRewards` and the second assertion, assert `[...hidden].sort()` deep-equals `deferred.sort()`, and rename the test to "deferred-hidden callsites match deferred mock routes".
  - [x] 2.4 `tests/pilot-scope.test.mjs` (~line 118): `expectedUncalled` becomes `[]`, and the message becomes "Every deferred route has a self-gated frontend service caller". Leave the other assertions alone.
- [x] **Task 3: Pure flow logic `lib/rewards/redeem-flow.ts`** (AC: 2, 3, 4, 5)
  - [x] 3.1 `REDEEM_POLL_DELAYS_MS = [2000, 4000, 8000] as const` (the wait before poll 1, 2, 3).
  - [x] 3.2 `classifyRedeemFailure(error: unknown)` →
    - `{ kind: "rejected", error: RedemptionErrorDto }` when it is an `ApiError` of kind `http` whose `{ code, message, details }` parses with `redemptionErrorSchema`.
    - `{ kind: "unknown" }` when the outcome can't be known: `ApiError` kind `network` or `malformed`, or `status >= 500`. **Only these start polling.** A 4xx is always a definitive "not charged".
    - `{ kind: "failed", code }` for everything else (for example `404 VOUCHER_NOT_FOUND`, `404 QUOTE_NOT_FOUND`, `400 VALIDATION_ERROR`, a domain code whose details don't parse, or a non-`ApiError`).
  - [x] 3.3 `pollRedemptionByKey({ fetchByKey, sleep, onAttempt, signal, delays = REDEEM_POLL_DELAYS_MS })` (injected deps, so it is unit-tested without timers). For each delay: `await sleep(ms, signal)`, call `onAttempt(n)` (1-based), then `fetchByKey(signal)`. A result → `{ kind: "succeeded", result }`. A failure classified `rejected` → `{ kind: "rejected", error }`. `404 REDEMPTION_NOT_FOUND`, `unknown` and `failed` → next attempt. After the last attempt → `{ kind: "unresolved" }`. An abort stops it without resolving.
  - [x] 3.4 `redeemErrorView(error, ctx)` → `{ mascot, title, body, rows, primary, secondary }`, where `ctx = { priceSource: "BASE" | "PROMO" | "FLASH" | null; availableBefore: number }`. `primary` and `secondary` are `{ label, target }`, where `target` is `"close" | "requote" | "rewards" | "rewardsCategory" | "marketplace" | "topUp" | "wallet" | "activation"`. **No route literal lives in `lib/`**: `RedeemErrorView` (inside the hidden `rewards/` dir) maps targets to hrefs (Gotcha 5). The copy is in Dev Notes → Error copy. Also add `failedView(kind: "failed" | "quoteNetwork")` for the generic sheet.
  - [x] 3.5 `confirmPriceLabel(source)`: FLASH "Giá Flash Sale", PROMO "Giá ưu đãi", BASE "Giá đổi". `flashEndsLine(flashEndsAt, nowMs)`: "Giá Flash áp dụng đến {HH:mm}. Sau giờ đó cần xác nhận lại với giá mới." Use `formatTime`, and add " {dd/MM}" after the time when the Vietnam date isn't today (`vietnamDateKey`).
  - [x] 3.6 `tweenValue(from, to, elapsedMs, durationMs)`: ease-out (`1 - (1 - t)^3`), rounds to an integer, returns `from` at 0 and exactly `to` at or after `durationMs`.
  - [x] 3.7 `shouldSubmitRequote(shownPoints, quote)`: `quote.price.points === shownPoints` (see Task 4.4).
  - [x] 3.8 Imports inside `lib/rewards/` use relative `.ts` paths (`../api/api-error.ts`), the same as `rewards-service.ts`, so `node --test` can load them. No `@/` aliases in `lib/`.
- [x] **Task 4: Flow hook `rewards/hooks/use-redeem-flow.ts`** (AC: 1, 2, 4, 5, 6)
  - [x] 4.1 State: a discriminated union `phase` = `closed | quoting | confirm | submitting | checking | success | rejected | failed`. Keep `quote` (once known), `idempotencyKey`, `pollAttempt` (0–3), `pollExhausted`, `result`, `error` and `failedKind`. Use `useReducer` or `useState`, whichever is shorter.
  - [x] 4.2 `open()`: store `document.activeElement` as the opener, create a **new** key with `randomUuid()` (`lib/random-uuid.ts`), go to `quoting`, and call `createRedemptionQuote(voucherId)`. Success → `confirm`. Failure → `classifyRedeemFailure`: `rejected` → `rejected` (an error found at quote time, e.g. `INSUFFICIENT_POINTS`, `SOLD_OUT`); otherwise → `failed` (`quoteNetwork` for `unknown`, because nothing is committed by a quote).
  - [x] 4.3 `confirm()`: a `useRef` boolean guard is set **synchronously** before anything else. A second call while it's set returns immediately (a double click lands before React re-renders). Go to `submitting`, then `redeemVoucher(quote.quoteId, idempotencyKey)`. Success → `success`. Failure → classify: `rejected` → `rejected`; `failed` → `failed`; `unknown` → `checking` and start `pollRedemptionByKey` (sleep = `setTimeout` that rejects on abort; `onAttempt` sets `pollAttempt`). Poll outcomes: `succeeded` → `success`, `rejected` → `rejected`, `unresolved` → stay in `checking` with `pollExhausted = true`. Reset the guard only when the phase leaves `submitting`/`checking`.
  - [x] 4.4 `requote()` (PRICE_CHANGED "Đổi với giá {n} điểm", and "Thử lại" on the generic sheet): create a **new** key and fetch a new quote. If the trigger was PRICE_CHANGED and `shouldSubmitRequote(error.details.price.points, newQuote)`, call `confirm()` with the new quote and key at once (the user already agreed to that price). Otherwise show `confirm` with the new quote so the user sees the server's current price. Never reuse a key with a different `quoteId`: the mock and AD-24 treat that as `IDEMPOTENCY_KEY_CONFLICT`.
  - [x] 4.5 `recheck()` (the "Kiểm tra lại" button after `pollExhausted`): resubmit `redeemVoucher` with the **same** `quoteId` and the **same** key. The server replays the first result if the first request committed, or processes it now if the first request never arrived (AC 2). Handle the outcome exactly like `confirm()`, including polling again on `unknown`.
  - [x] 4.6 `close()`: allowed in every phase except `submitting`. Abort any in-flight request or poll. If the phase was not `quoting`/`confirm`, call the detail `reloadAll()` so the page shows the server's new state. Then focus the stored opener in `requestAnimationFrame` if it is still connected; otherwise focus the first visible enabled "Đổi ngay" (`[data-redeem-cta]`). AC 6.
  - [x] 4.7 On `success` and on an `INSUFFICIENT_POINTS` rejection, call `useSession().refresh()` (`lib/session/SessionProvider.tsx`) so the header `PointsChip` shows the new balance.
  - [x] 4.8 Abort everything on unmount (`AbortController` + `clearTimeout`). No `setState` after unmount.
- [x] **Task 5: Redeem sheet UI `rewards/components/RedeemSheet.tsx` (+ `RedeemErrorView.tsx`)** (AC: 1, 2, 4, 5, 6)
  - [x] 5.1 Container: `components/ui/Dialog.tsx` (native `<dialog>`: focus trap, Escape, backdrop) with `width={480}` and `className="max-lg:mb-0 max-lg:w-full max-lg:rounded-b-none"`. That is the bottom-sheet-on-mobile / dialog-on-desktop pattern of `forms/[id]/components/SheetDialog.tsx`. Don't move or import `SheetDialog`: it requires a title header, but the error views have a mascot and a centered title. `open={phase !== "closed" && phase !== "success"}`. `dismissible={phase !== "submitting"}`. `labelledBy` = the visible title id of the current view. Mobile: drag-handle visual (`h-1.25 w-10 rounded-full bg-line`, `lg:hidden`, `aria-hidden`). Desktop confirm view: an `IconButton icon="x" label="Đóng"` in the header (Figma 23h); hide it on mobile.
  - [x] 5.2 **Quoting:** the confirm layout with `thought-skeleton` blocks at the final sizes (thumb row, price box ~150 px, 3 bullet lines, button 48 px). Title and subtitle are real text. `aria-busy="true"` on the body.
  - [x] 5.3 **Confirm** (Figma 23a `126:81`, desktop 23h `127:792`):
    - Title "Xác nhận đổi voucher", subtitle "Kiểm tra lại trước khi trừ điểm."
    - Voucher row: `VoucherThumb` (existing, small), brand name, "{title} · {formatVnd(valueVnd)}". Tags from `quote.price`: FLASH → a `bg-primary text-white` pill with the `zap` icon + "Flash Sale", plus the sale tag "-{discountPercent}%" (`bg-sale-bg text-sale-text`). PROMO → the sale tag only. BASE → none.
    - Price box (`bg-subtle`, radius 16): `confirmPriceLabel` + "{quote.price.points} điểm" (`text-tone-amber-fg`, bold); "Điểm khả dụng hiện có" + `quote.balance.available`; divider; "Còn lại sau khi đổi" + `quote.balance.after` (bold, larger). **All three numbers come from the quote.** Don't compute them from the detail.
    - Bullets (16 px icons, `text-caption`): `check` "Mã và QR có ngay trong Voucher của tôi." (shared code: "Mã dùng chung có ngay trong Voucher của tôi."); `calendar` "Dùng được đến hết {formatFullDate(voucher.codeExpiresAt)}."; `alert-circle` "Đã đổi thì không trả lại điểm, trừ khi mã bị lỗi."
    - FLASH only: an amber note (`bg-tone-amber-tint`, `clock` icon) with `flashEndsLine(quote.flashEndsAt, nowMs)`.
    - Actions: primary `Button` "Xác nhận đổi · {points} điểm" (full width on mobile; right-aligned on desktop) and a text button "Để sau" (close). Initial focus goes to the primary button (`autoFocus`).
  - [x] 5.4 **Submitting** (Figma 23b `126:234`): same layout. The primary is `loading` with `loadingLabel="Đang đổi…"` (`Button` already renders the spinner and `aria-busy`). An info box (`bg-tone-blue-bg`, `Spinner`, `role="status"`): "Đang giữ voucher và trừ điểm… Vui lòng không tắt ứng dụng." "Để sau" is disabled. The dialog is not dismissible.
  - [x] 5.5 **Checking** (Figma 23g `127:653`): `wait` mascot, title "Đang kiểm tra kết quả", body "Mạng bị gián đoạn khi đang đổi. Rescom tự kiểm tra lại giao dịch. Bạn sẽ không bị trừ điểm 2 lần." A step list in a `bg-subtle` box: `check` "Đã gửi yêu cầu đổi"; `Spinner` "Đang xác nhận với hệ thống (lần {pollAttempt}/3)" (attempt 0 shows "lần 1/3"); `ticket` "Nếu thành công, voucher hiện trong Voucher của tôi". When `pollExhausted`: the second step becomes `alert-circle` "Chưa nhận được kết quả sau 3 lần kiểm tra.", and the actions are primary "Kiểm tra lại" (`recheck`) + text "Đóng". While polling, the only action is "Đóng". Wrap the step text in `role="status"` so each attempt is announced once.
  - [x] 5.6 **Rejected / failed** → `RedeemErrorView` renders `redeemErrorView(...)` / `failedView(...)`: the mascot (`<img alt="" width=96 height=96>`), a centered title, the body, optional rows in a `bg-subtle` box (numbers right-aligned; a `danger` row for "Còn thiếu"), a primary and a secondary action. Map `target` here: `close`/`requote` → `Button` calling the flow; `rewards` → `/rewards`; `rewardsCategory` → `/rewards?category=${voucher.category}`; `marketplace` → `/marketplace`; `topUp` → `/wallet/top-up`; `wallet` → `/wallet`; `activation` → `MARKETPLACE_ACTIVATION_PATH` (`lib/onboarding.ts`). Primary is `ButtonLink`/`Button` `variant="primary"`; secondary is a text button/link. Figma 23d `127:287`, 23e `127:407`, 23f `127:530`. For PRICE_CHANGED, the "Giá đổi" row shows the old price struck (`line-through text-ink-muted`) → `arrow-right` → the new price in `text-tone-amber-fg`.
  - [x] 5.7 Every error/failed view's primary action gets initial focus.
- [x] **Task 6: Success view `rewards/components/RedemptionSuccess.tsx`** (AC: 3)
  - [x] 6.1 Rendered by `VoucherDetailScreen` **instead of** the detail content when `phase === "success"` (Figma 23c `126:286` is a full screen, not a sheet). Mobile: full height, content at the top, actions pinned at the bottom above the BottomNav (`bottom-[calc(62px+env(safe-area-inset-bottom))]`, the same offset as the detail action bar). Desktop (no Figma frame): the same content centered in a `max-w-[480px]` column.
  - [x] 6.2 Content: the `cheer` mascot (`public/brand/mascots/cheer.svg`, 160 px) with confetti; `<h1 tabIndex={-1}>` "Đổi thành công!", focused on mount; the body "Voucher đã nằm trong Voucher của tôi. Dùng trước {formatFullDate(ticket.expiresAt)} nhé."; a ticket summary card (Figma `VoucherTicket` instance `126:315`: left tint stub with `VoucherThumb`, brand, "Voucher {formatVnd(valueVnd)}", "HSD {dd/MM/yyyy} · còn {n} ngày", and a status `Tag`: UNUSED "Chưa dùng" (green), EXPIRING "Sắp hết hạn" (amber)); a summary box: "Đã trừ" `{pointsSpent} điểm`, "Điểm khả dụng còn lại" `{balanceAfter} điểm` (animated), "Mã giao dịch" `{reference}` + an `IconButton icon="copy" label="Sao chép mã giao dịch"` using `copyTextToClipboard` (`lib/clipboard.ts`), and a polite `sr-only` "Đã sao chép" after a copy.
  - [x] 6.3 Actions: primary `ButtonLink` "Tiếp tục đổi quà" → `/rewards`. "Dùng voucher ngay" and "Xem mã & QR" are **not rendered**: they open Voucher của tôi, which Story 12.4 creates (Dev Notes → Deviations). Don't link to a route that doesn't exist yet.
  - [x] 6.4 Balance countdown: a `useTweenedNumber(from = quote.balance.available, to = result.balanceAfter, 400)` hook (rAF + `tweenValue`). When `useReducedMotion()` (`components/analytics/use-reduced-motion.ts`, reuse it, don't copy it) is true, it returns `to` at once. The animated digits are `aria-hidden`; a sibling `sr-only` holds the final value, so screen readers never hear the intermediate numbers.
  - [x] 6.5 Confetti: 8–10 small absolutely positioned `<span aria-hidden>` dots around the mascot (brand tokens: primary, amber, teal, sale-text), one CSS `@keyframes redeem-confetti` in `globals.css` (600 ms, fall + fade, `forwards`), and a mascot pop-in (`scale .9 → 1`, 600 ms). Add `@media (prefers-reduced-motion: reduce) { .redeem-confetti { display: none; } .redeem-pop { animation: none; } }` next to the existing reduced-motion blocks. The global rule shortens durations, but the dots would still be visible, so hide them explicitly.
- [x] **Task 7: Wire the detail page** (AC: 1, 6)
  - [x] 7.1 `VoucherDetailScreen.tsx`: call `useRedeemFlow({ voucherId, reloadAll })`. **Delete** the `onRedeem` prop, `REDEEM_PENDING_TITLE` and the disabled branch of `renderRedeemButton`. Both "Đổi ngay" buttons (mobile bar + desktop panel) call `flow.open` and carry `data-redeem-cta`. Render `<RedeemSheet …/>` once, at the end of the screen. When `flow.phase === "success"`, return `<RedemptionSuccess …/>` instead of the detail markup (keep the hooks above every early return).
  - [x] 7.2 `[id]/page.tsx` is unchanged (it never passed `onRedeem`).
  - [x] 7.3 Flash "Đổi ngay" on `FlashSaleCard` keeps linking to `/rewards/{voucherId}`; the confirmation opens from the detail. Record this as the 12.2 open decision.
- [x] **Task 8: Tests `tests/rewards-redeem.test.mjs`** (AC: 2, 3, 4, 5)
  - [x] 8.1 `classifyRedeemFailure`: build each of the 5 domain errors as an `ApiError` from the **mock's own outputs**: call `forcedError(code, voucher, flashes, 186, now)` from `mocks/data/rewards-rules.ts` on a seeded voucher (as `rewards-mock.test.mjs` does) and wrap it like `apiRequest` does (`kind: "http"`, status from `REDEMPTION_ERROR_HTTP_STATUS`). Each → `rejected` with the same code. Network → `unknown`. Malformed → `unknown`. 503 → `unknown`. 404 `VOUCHER_NOT_FOUND` → `failed`. 409 `SOLD_OUT` with broken details → `failed`. A plain `Error` → `failed`.
  - [x] 8.2 `pollRedemptionByKey` with a fake `sleep` that records the delays: it asserts `[2000, 4000, 8000]`; succeeds on attempt 2 (stops early, `onAttempt` saw 1, 2); returns `rejected` when the fetch throws a domain error; returns `unresolved` after three 404 `REDEMPTION_NOT_FOUND` / network failures; an aborted signal stops it.
  - [x] 8.3 `redeemErrorView`: for every code (and every `ACCOUNT_NOT_ELIGIBLE` reason, and both `VOUCHER_UNAVAILABLE` statuses in use), the body matches `/bạn chưa bị trừ điểm/i` and there is exactly one primary action; `failedView` too. INSUFFICIENT_POINTS: `availableBefore` 186, details `{ required: 150, available: 120 }` → body mentions 66, rows "150 điểm" / "120 điểm" / "30 điểm"; with `availableBefore` ≤ available, the generic sentence. SOLD_OUT FLASH vs BASE titles; `regularStockRemaining > 0` → primary target `close` "Xem giá thường"; `0` → target `rewardsCategory`. PRICE_CHANGED rows show old → new and the primary label "Đổi với giá 150 điểm" with target `requote`. Also assert `lib/rewards/redeem-flow.ts` source contains no `"/rewards` literal.
  - [x] 8.4 `tweenValue` (0 ms → from, 400 ms → to, the midpoint lies between them and is an integer, a count-up works too); `confirmPriceLabel`; `flashEndsLine` same day vs another day; `shouldSubmitRequote`.
  - [x] 8.5 Source guards: `use-redeem-flow.ts` imports `randomUuid` and calls it only inside `open`/`requote` (not in `confirm`/`recheck`); `RedeemSheet.tsx` passes `dismissible` to `Dialog`; the existing 12.2 `rewards-ui` price-scan test still passes.
- [x] **Task 9: Verification**
  - [x] 9.1 `npm --prefix packages/schemas test && npm --prefix packages/schemas run typecheck`.
  - [x] 9.2 `cd apps/frontend/my-app && npm test && npx tsc --noEmit && npm run lint`. The guard tests `pilot-scope`, `contract-callsites`, `route-diff`, `hybrid-mocking`, `no-direct-mocks`, `rewards-mock`, `rewards-ui` and `wallet-history` stay green.
  - [x] 9.3 `NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled npm run build` succeeds.
  - [x] 9.4 `npm --prefix apps/backend run typecheck` passes (shared package changed, type-only).
  - [x] 9.5 Manual check with `NEXT_PUBLIC_API_MOCKING=enabled` and the demo user (186/18), at 390 px and 1440 px against Figma 23a–23h (use `get_screenshot` on `126:2`, `126:155`, `126:286`, `127:208`, `127:328`, `127:451`, `127:574`, `127:703`):
    - Highlands #1 (Flash 150): confirm shows 150 / 186 / 36 and "Giá Flash áp dụng đến HH:mm"; double-click the confirm button → one redemption (wallet history gains exactly one "Đổi voucher" row); the success countdown 186 → 36; the header PointsChip updates; "Tiếp tục đổi quà".
    - `?msw=rewards-sold-out`, `rewards-price-changed`, `rewards-insufficient-points`, `rewards-voucher-unavailable`, `rewards-account-not-eligible`: each screen, its copy, its primary action, and the balance unchanged afterwards. Reset with `?msw=default`.
    - `?msw=rewards-redeem-lost`: the checking view appears, attempt 1 finds the committed result → success; the wallet is charged once.
    - `?msw=api-offline` after the quote loads (switch the scenario in devtools between quote and confirm, or open the sheet first): 3 attempts → the exhausted state; "Kiểm tra lại" with the scenario reset → the result.
    - Keyboard: Tab stays inside the sheet; Escape closes it (not while submitting); focus returns to Đổi ngay. Reduced motion (DevTools emulation): no confetti, no pop-in, the balance shows the final value immediately.
    - Record the results and any Figma delta in Completion Notes.

### Review Findings

- [x] [Review][Patch] Block close while polling (Decision resolved by Quan 2026-10-13: deviation from spec 4.6): in `checking` with `!pollExhausted`, the dialog is not dismissible, `close()` returns early and "Đóng" is hidden; close is allowed again after `pollExhausted`. Reopen would otherwise mint a new key while the first POST may still commit [apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-redeem-flow.ts:460]
- [x] [Review][Patch] Error-view numbers skip `formatPoints` (Dev Notes → Error copy) [apps/frontend/my-app/lib/rewards/redeem-flow.ts:507]
- [x] [Review][Patch] `close()` from `checking` reloads the detail but not the session balance; header PointsChip stays stale if the redemption committed [apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-redeem-flow.ts:463]
- [x] [Review][Patch] Opener stored as `<body>` when the click doesn't focus the button (Safari/Firefox macOS), so focus never returns to Đổi ngay (AC 6) [apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-redeem-flow.ts:425]
- [x] [Review][Patch] Tests weaker than Task 8.1/8.3: assert the classified code equals the input code; assert the FLASH SOLD_OUT title [apps/frontend/my-app/tests/rewards-redeem.test.mjs:575]
- [x] [Review][Defer] Recheck re-POST + non-domain 4xx after an ambiguous attempt reports "chưa bị trừ điểm" [apps/frontend/my-app/lib/rewards/redeem-flow.ts:485] — deferred, depends on Story 12.8 replay contract
- [x] [Review][Defer] No request timeout; hung POST traps the non-dismissible sheet [apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-redeem-flow.ts:402] — deferred, pre-existing (`apiRequest`)
- [x] [Review][Defer] Native dialog closes on repeated Esc despite `dismissible=false`, desyncing from `open` [apps/frontend/my-app/components/ui/Dialog.tsx:34] — deferred, pre-existing (shared Dialog)
- [x] [Review][Defer] Unmount mid-submit drops the outcome and session refresh [apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-redeem-flow.ts:393] — deferred, spec 4.8 mandates abort; server idempotency covers the charge
- [x] [Review][Defer] Expiry-only PRICE_CHANGED shows identical old → new price [apps/frontend/my-app/lib/rewards/redeem-flow.ts:517] — deferred, contract carries no reason

## Dev Notes

### Scope boundaries (read first)

- **In:** the quote → confirm → redeem flow on the voucher detail, the sheet/dialog with its confirm, submitting, checking and error views, the success view, polling by key, the 3 redeem client functions, the test-gate updates for those routes, and type-only contract exports.
- **Out:**
  - Voucher của tôi, ticket code/QR and the "Dùng voucher ngay" / "Xem mã & QR" / "Mở Voucher của tôi" buttons (Story 12.4).
  - Any backend (12.7–12.10) and the real feature flag (12.11).
  - Opening the confirmation straight from the Flash strip card (it links to the detail; see Task 7.3).
  - Client-side quote-expiry timers: the server answers `PRICE_CHANGED` for a stale quote, and the UI handles that.
- **Gates:** FE-mock only. Every call stays behind `PILOT_BUILD` (service self-gate + the `/rewards` route already 404s in the pilot build).
- **Contract status:** consumes the Story 12.1 **ASSUMED API CONTRACT** unchanged (`redemption.schema.ts`). Only type aliases are added.

### Contract and mock behaviour this flow depends on

| Call | Mock (`mocks/handlers/rewards.ts`) | Notes |
|---|---|---|
| `POST /rewards/quotes` `{ voucherId }` → 201 `RedemptionQuote` | `createVoucherQuote` | Can fail at quote time: 409 `SOLD_OUT`/`VOUCHER_UNAVAILABLE`/`INSUFFICIENT_POINTS`, 404 `VOUCHER_NOT_FOUND`. TTL = min(now + 5 min, Flash end). `balance.after === balance.available − price.points` is enforced by the schema |
| `POST /rewards/redemptions` `{ quoteId }` + `Idempotency-Key` → 201 `RedemptionResult` | `redeemVoucherQuote` | The key is per user. The same key + same `quoteId` → the stored first response (success **or** failure) is replayed. The same key + another `quoteId` → 409 `IDEMPOTENCY_KEY_CONFLICT`. Failures are stored too. The wallet is debited only on a non-replayed success |
| `GET /rewards/redemptions/by-key/:key` → 201 result / the stored error envelope / 404 `REDEMPTION_NOT_FOUND` | `redemptionByKey` | Used only for polling |
| Scenarios | `?msw=rewards-sold-out` … `rewards-account-not-eligible` force that code on POST redemptions (the quote still succeeds); `rewards-redeem-lost` commits and then drops the response (`HttpResponse.error()`); `api-error`/`api-offline` hit every Rewards route | `forcedError` builds real details. `PRICE_CHANGED` forced keeps the same points with `priceVersion + 1`, so a requote auto-submits and fails again while the scenario is on. That is expected |

`ApiError` (`lib/api/api-error.ts`) carries `kind`, `status`, `code`, `message` and `details` from the envelope. Rebuild `{ code, message, details }` and `safeParse` it with `redemptionErrorSchema`. Never trust `details` without the parse.

### Idempotency rules (AD-24, BR-08)

- One key per quote. A key is created in `open()` and `requote()`, never in `confirm()` or `recheck()`.
- `confirm()` and `recheck()` send the **same** key with the **same** `quoteId`, so a lost response, a double tap or a retry can never charge twice.
- After `PRICE_CHANGED` the old quote is stale, so a new quote needs a new key (reusing it would be `IDEMPOTENCY_KEY_CONFLICT`). The AC's "one key when the confirmation opens" holds per confirmation; a requote is a new confirmation.
- The confirm button has two locks: a synchronous `useRef` guard (it stops a double click before re-render) and `loading`/`disabled` (visual and AT). The sheet is not dismissible while submitting.
- Polling starts only when the result is unknown (network, 5xx, malformed). A 4xx is definitive. Never poll after it and never claim success without a parsed `RedemptionResult`.

### Error copy (`redeemErrorView`; Figma 23d/e/f; the shared sheet has no frame, same layout)

Every body ends with a sentence containing "bạn chưa bị trừ điểm" (case-insensitive). Numbers use `formatPoints`. Paths in the Primary/Secondary columns are what `RedeemErrorView` maps each `target` to; `redeem-flow.ts` returns only the target name.

| Case | Mascot | Title | Body | Rows | Primary | Secondary |
|---|---|---|---|---|---|---|
| SOLD_OUT, `priceSource` FLASH | `sad.svg` | Vừa hết suất Flash Sale | "Suất cuối đã có người đổi trong lúc bạn xác nhận. Bạn chưa bị trừ điểm nào." (+ " Voucher vẫn còn ở giá thường." when `regularStockRemaining > 0`) | Điểm khả dụng · "{availableBefore} điểm (không đổi)" | `regularStockRemaining > 0`: "Xem giá thường" (`close`, the page reloads with the server's regular price); else "Xem voucher tương tự" → `/rewards?category={category}` | "Đóng" |
| SOLD_OUT, otherwise | `sad.svg` | Voucher vừa hết hàng | "Voucher cuối đã có người đổi trong lúc bạn xác nhận. Bạn chưa bị trừ điểm nào." | same | "Xem voucher tương tự" → `/rewards?category={category}` | "Đóng" |
| PRICE_CHANGED | `surprise.svg` | Giá vừa thay đổi | FLASH: "Flash Sale vừa kết thúc hoặc hết suất nên giá đã đổi. Bạn chưa bị trừ điểm." Else: "Giá voucher vừa được cập nhật. Bạn chưa bị trừ điểm." | Giá đổi · old ~~{quote points}~~ → {details.price.points}; "Còn lại sau khi đổi" {availableBefore − new} (or a danger "Còn thiếu {new − availableBefore}" when negative) | "Đổi với giá {new} điểm" (`requote`) | "Huỷ" |
| INSUFFICIENT_POINTS | `confused.png` (only a PNG exists) | Điểm khả dụng vừa thay đổi | `availableBefore > available`: "Một giao dịch khác vừa dùng {availableBefore − available} điểm khả dụng của bạn. Voucher này chưa được đổi và bạn chưa bị trừ điểm." Else: "Điểm khả dụng của bạn không đủ để đổi voucher này. Bạn chưa bị trừ điểm." | Voucher cần {required}; Bạn đang có {available}; Còn thiếu {required − available} (danger) | "Làm khảo sát kiếm thêm" → `/marketplace` | "Nạp điểm" → `/wallet/top-up` |
| VOUCHER_UNAVAILABLE `PAUSED` | `sad.svg` | Voucher đang tạm dừng đổi | "Voucher này vừa được tạm dừng. Bạn chưa bị trừ điểm." | — | "Xem voucher khác" → `/rewards` | "Đóng" |
| VOUCHER_UNAVAILABLE `EXPIRED` | `sad.svg` | Voucher đã hết thời gian đổi | "Thời gian đổi voucher này vừa kết thúc. Bạn chưa bị trừ điểm." | — | same | "Đóng" |
| VOUCHER_UNAVAILABLE `HIDDEN`/`ARCHIVED` | `sad.svg` | Voucher không còn được đổi | "Voucher này vừa được gỡ khỏi Đổi quà. Bạn chưa bị trừ điểm." | — | same | "Đóng" |
| ACCOUNT_NOT_ELIGIBLE (title for all reasons: "Chưa đổi được voucher này") | `shield.svg` | ↓ | reason sentence + " Bạn chưa bị trừ điểm." | — | per reason ↓ | "Đóng" |
| · `ACCOUNT_NOT_ACTIVATED` | | | "Tài khoản cần được kích hoạt trước khi đổi voucher." | | "Kích hoạt tài khoản" → `MARKETPLACE_ACTIVATION_PATH` (`lib/onboarding.ts`) | |
| · `ACCOUNT_LOCKED` | | | "Tài khoản đang bị khoá nên chưa đổi được voucher." | | "Về Ví điểm" → `/wallet` | |
| · `FRAUD_FLAGGED` | | | "Tài khoản đang được kiểm tra nên chưa đổi được voucher Flash Sale. Bạn vẫn đổi được voucher giá thường." | | "Xem voucher khác" → `/rewards` | |
| · `NO_RECENT_SURVEY` | | | "Flash Sale dành cho người đã làm ít nhất 1 khảo sát trong 30 ngày qua." | | "Làm khảo sát" → `/marketplace` | |
| · `VOUCHER_LIMIT_REACHED` | | | "Bạn đã đổi voucher này đủ số lần cho phép trong 30 ngày." | | "Xem voucher khác" → `/rewards` | |
| · `DAILY_LIMIT_REACHED` | | | "Hôm nay bạn đã đổi đủ số điểm cho phép. Quay lại vào ngày mai nhé." | | "Xem voucher khác" → `/rewards` | |
| · `FLASH_LIMIT_REACHED` | | | "Bạn đã dùng hết suất Flash Sale của mình cho voucher này." | | "Xem voucher khác" → `/rewards` | |
| `failed` (non-domain 4xx) | `offline.svg` | Chưa đổi được voucher | "Có lỗi khi xác nhận giao dịch. Bạn chưa bị trừ điểm." | — | "Thử lại" (`requote`) | "Đóng" |
| `quoteNetwork` (quote got no response) | `offline.svg` | Chưa tải được giá đổi | "Kết nối đang chập chờn. Bạn chưa bị trừ điểm." | — | "Thử lại" (`requote`) | "Đóng" |

`availableBefore` = `quote.balance.available` when a quote exists, else the detail's `viewer.available`. The PRICE_CHANGED and INSUFFICIENT subtraction is display-only, the same rule as 12.2 ("balance after", "shortfall"). Prices themselves always come from the server.

### Deviations from Figma (deliberate, record in Completion Notes)

| Figma | This story | Why |
|---|---|---|
| 23b/23g show the reference "RDM-2610-8F2K" while processing and while checking | no reference in those views | The reference exists only in the server's response. The client has only the idempotency key, which isn't user-facing |
| 23b small caption "Nút bị khoá ngay khi bấm lần đầu…" | not rendered | It describes the behavior for reviewers; the behavior itself is implemented (Task 4.3) |
| 23c "Dùng voucher ngay", ticket "Xem mã & QR"; 23g "Mở Voucher của tôi" | not rendered; 23g exhausted state offers "Kiểm tra lại" | Voucher của tôi is Story 12.4. 12.4 adds these entry points |
| 23d row "Giá thường của voucher này 250 điểm" | dropped; "Xem giá thường" closes and reloads the detail | The client can't know the regular price (promo vs base) without the server; never compute prices client-side |
| 23f body names the reason ("Khuyến mãi … đã kết thúc lúc 12:00") | generic FLASH / non-FLASH sentence | `PRICE_CHANGED.details` carries only the new price |
| 23e mascot `confused` | `confused.png` | No SVG exists in `public/brand/mascots/` |
| Success desktop | no frame; mobile layout centered at 480 px | Figma has only the 390 px frame |
| 23g "Đóng" while checking | hidden and not dismissible until the 3 polls are exhausted | Code review 2026-10-13 (Quan): closing then reopening mints a new key while the first POST may still commit |

### Architecture rules that bind the UI

- **Never compute a price or a resulting balance for a decision.** The confirm view shows `quote.price.points`, `quote.balance.available` and `quote.balance.after`. Success shows `result.pointsSpent` and `result.balanceAfter` [AD-24 "client-trusted pricing" prevented; BR-17].
- **Points are deducted only on a parsed success.** Every error copy says "bạn chưa bị trừ điểm", which is true only because of the classify rules above. Don't show that sentence for an `unknown` outcome: the checking view says "Bạn sẽ không bị trừ điểm 2 lần" instead [BR-07, BR-09].
- **Server time.** The Flash end line uses `quote.flashEndsAt` formatted in Vietnam time (`lib/format/date-time.ts`). The detail's `useServerNow` already provides `nowMs` for the "today" check.
- **Status as text.** Every state has a text title; spinners always sit next to text.

### Existing code to reuse (do not reinvent)

| Need | Use |
|---|---|
| HTTP, CSRF, `Idempotency-Key` header | `lib/api/client.ts` `apiRequest` (`headers` option); `IDEMPOTENCY_KEY_HEADER` from `@rescom/schemas` |
| Errors | `lib/api/api-error.ts` `ApiError`, `isApiError` |
| UUID key | `lib/random-uuid.ts` `randomUuid()` (works over a LAN IP too) |
| Modal + focus trap + Escape | `components/ui/Dialog.tsx` (`dismissible`, `labelledBy`, `width`) |
| Sheet styling precedent | `app/(signed-in)/(app)/forms/[id]/components/SheetDialog.tsx` (className + handle) |
| Buttons, busy state | `components/ui/Button.tsx` (`loading`, `loadingLabel`, `ButtonLink`), `IconButton`, `Spinner` |
| Tags | `components/ui/Tag.tsx` |
| Thumb | `rewards/components/VoucherThumb.tsx` |
| Format | `lib/rewards/voucher-display.ts` (`formatPoints`, `formatVnd`, `formatFullDate`), `lib/format/date-time.ts` (`formatTime`, `vietnamDateKey`) |
| Clipboard | `lib/clipboard.ts` `copyTextToClipboard` |
| Reduced motion | `components/analytics/use-reduced-motion.ts` `useReducedMotion` (server snapshot = true, so SSR shows final values) |
| Header balance refresh | `useSession().refresh()` (`lib/session/SessionProvider.tsx`) |
| Mascots | `public/brand/mascots/{cheer,sad,surprise,wait,shield,offline}.svg`, `confused.png` |
| Icons | `check`, `calendar`, `alert-circle`, `clock`, `zap`, `ticket`, `copy`, `arrow-right`, `x` all exist in `public/icons/` |

### Files

**NEW**
- `apps/frontend/my-app/lib/rewards/redeem-flow.ts`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-redeem-flow.ts`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/{RedeemSheet,RedeemErrorView,RedemptionSuccess}.tsx`
- `apps/frontend/my-app/tests/rewards-redeem.test.mjs`

A `useTweenedNumber` hook may live inside `RedemptionSuccess.tsx` (one consumer). Don't create more files than these unless a file passes ~300 lines.

**UPDATE** (read each whole file first; preserve everything not listed)

| File | Today | Change | Must preserve |
|---|---|---|---|
| `packages/schemas/src/rewards/redemption.schema.ts` | 12.1 schemas, no type exports | + 6 `export type` lines | every schema and refinement |
| `apps/frontend/my-app/lib/rewards/rewards-service.ts` | 3 GET functions + `rejectPilot` | + 3 redeem functions | the header comment, pilot guard, existing functions |
| `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/VoucherDetailScreen.tsx` | detail; `onRedeem?` prop, disabled CTA | wire `useRedeemFlow`, delete `onRedeem`/`REDEEM_PENDING_TITLE`, render the sheet + success | all 12.2 states, similar-vouchers effect, Flash strip, countdown reload, layout |
| `apps/frontend/my-app/app/globals.css` | tokens + keyframes | + `redeem-confetti`/`redeem-pop` keyframes and their reduced-motion block | everything else |
| `apps/frontend/my-app/tests/helpers/frontend-callsites.mjs` | 3 rewards GET entries | + 3 redeem entries | others |
| `apps/frontend/my-app/tests/contract-callsites.test.mjs` | `uncalledRewards` = 3 routes | no uncalled routes | other tests |
| `apps/frontend/my-app/tests/pilot-scope.test.mjs` | `expectedUncalled` = 3 routes | `[]` | other assertions, `services.size >= 12` |

### Testing standards

- Frontend: `node --test tests/*.test.mjs` (`npm test` builds `@rescom/schemas` first). Import pure TS directly (`await import("../lib/rewards/redeem-flow.ts")`). The mock rules can be imported the same way (`../mocks/data/rewards-rules.ts`), as `rewards-mock.test.mjs` does. There is **no React Testing Library or Playwright**; don't add one (a new dependency is a HALT condition). The hook and components are covered by the pure helpers, the source guards and the manual check (Task 9.5).
- `rewards-mock.test.mjs` already proves the mock's idempotent replay and stock-once behavior; don't duplicate it.
- No `test.skip`, `.only`, TODO stubs or placeholder assertions.

### Gotchas checklist

1. **Hooks before early returns** in `VoucherDetailScreen`: it already returns early for loading/error/not-found. Put `useRedeemFlow` at the top with the other hooks.
2. **Two "Đổi ngay" buttons** exist (mobile bar + desktop panel, one hidden by CSS). Focus return must target the one that opened the sheet (stored opener), with `[data-redeem-cta]` visible-match as the fallback.
3. **`Dialog` renders children only while `open`.** Switching views inside an open dialog is fine; closing unmounts the content, so abort requests in `close()`, not in a child effect.
4. **`labelledBy` changes per view.** Use stable ids per view (`redeem-confirm-title`, `redeem-error-title`, `redeem-checking-title`).
5. **Pilot-scope literal scan** (`tests/pilot-scope.test.mjs` "no pilot-visible link…", scans `app`, `components`, `lib` except the hidden `rewards/` dir): any `"/rewards…"` literal there without `PILOT_BUILD` in the same function fails. The `"/rewards/quotes"`… service strings are fine (guarded in the same function). `lib/rewards/redeem-flow.ts` must hold **no** route literal; it returns `target` names, and `RedeemErrorView` maps them to hrefs. Run `node --test tests/pilot-scope.test.mjs` early.
6. **`setTimeout` sleeps** must reject on abort and be cleared on unmount; a poll must never resolve after `close()`.
7. **Reduced motion:** the global rule in `globals.css:199` shortens animations but leaves final frames visible; hide the confetti explicitly (Task 6.5). The JS tween checks `useReducedMotion()`.
8. **`apiRequest` throws `AbortError` (not `ApiError`) on abort.** Treat it as "stop", never as `failed`/`unknown`.
9. **Next 16:** no new route or page in this story. Read `node_modules/next/dist/docs/` only if you touch `page.tsx`.

### Project Structure Notes

- The flow lives on the existing `/rewards/[id]` route; no new route (the success view is a state, not a page, because the result exists only in memory).
- Components stay in `rewards/components/`, hooks in `rewards/hooks/`, pure logic in `lib/rewards/`, matching 12.2. Exports use `redemption*`/`redeem*`/`voucher*` names, never bare `reward*` (12.1 collision rule).

### Previous story intelligence (12.2, done; merged to `develop` as PR #18)

- 12.2 left the hand-off: `VoucherDetailScreen` had `onRedeem?: () => void`, and without it the CTA is disabled with a `title`. This story replaces that prop with the internal hook (Task 7.1).
- 12.2 review lessons that apply here: memoize anything derived from `serverTime` (a fresh `Date.now()` per render froze the countdown); don't remount live regions with `key` (fresh live regions are often not announced); abort/stale-guard every effect fetch; Completion Notes must record the manual check honestly, including what was not exercised.
- `useServerNow` pauses while `document.hidden` (automation tabs are hidden: force `document.hidden` false in the manual check, as 12.2 did).
- The demo wallet is 186 available / 18 pending. Highlands #1 (Flash 150 → after 36), Lotteria #2 (Flash 90), Phúc Long #3 (promo 120), Gong Cha #5 (Flash sold out → 100 regular). KFC #4 (200) is not affordable, so its Đổi ngay is disabled and the sheet can't open there; use `?msw=rewards-insufficient-points` on an affordable voucher to see that screen.

### Git intelligence

- Branch: `feat/12-3-confirm-redemption-result`, created from `origin/develop` @ `d241be8` (12.2 merged).
- Recent: `3c5b142` (12.2 marketplace + detail), `e01c111` (domain/Hostinger), `cecbb0e` (12.1 contracts + MSW, including the redeem mock and scenarios this story drives).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 intro, Story 12.3, Story 12.4 (Voucher của tôi scope), Story 12.8 (backend redeem transaction)]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-13.md` FR-69 (one key per confirmation, BR-08; failure rollback BR-09; failed attempt recorded BR-07), FR-74 (BR-02, BR-21)]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` AD-24, Cross-Context Financial Workflow Map "Redeem voucher"]
- [Source: Figma `mkudD5Ngi5RPyIAVxCcxXi` page 23 `113:6`: 23a confirm sheet `126:2`/`126:81`, 23b submitting `126:155`/`126:234`, 23c success `126:286`, 23d sold out `127:208`/`127:287`, 23e balance changed `127:328`/`127:407`, 23f price changed `127:451`/`127:530`, 23g checking `127:574`/`127:653`, 23h desktop dialog `127:703`/`127:792`]
- [Source: `packages/schemas/src/rewards/redemption.schema.ts`; `apps/frontend/my-app/mocks/handlers/rewards.ts`; `mocks/data/rewards.ts` (`createVoucherQuote`, `redeemVoucherQuote`, `redemptionByKey`); `mocks/data/rewards-rules.ts` (`decideRedemption`, `forcedError`); `mocks/scenarios.ts` rewards scenarios]
- [Source: `_bmad-output/implementation-artifacts/12-2-voucher-marketplace-filters-detail.md` (hand-off, review findings, manual-check method)]

## Dev Agent Record

### Agent Model Used

Antigravity (subagent implementation)

### Debug Log References

- `npm --prefix packages/schemas test && npm --prefix packages/schemas run typecheck`: 630 tests passed.
- `npm --prefix apps/backend run typecheck`: passed.
- `apps/frontend/my-app`: `npm test` 814 tests passed; `npx tsc --noEmit`, `npm run lint`, pilot `npm run build` passed.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Implemented typed redeem API calls, idempotency key lifecycle, server-validated quote, 2/4/8-second by-key polling and definitive error handling; quote/current price and server balances remain authoritative.
- Added responsive confirmation/error/checking dialog and full-page success with reduced-motion support; linked detail CTA. Flash card still opens the detail; Story 12.4 buttons/routes remain absent. Figma deviations follow Dev Notes (no reference before server response, no 12.4 links, no invented regular price).
- Automated tests passed: schemas 630, frontend 814, backend typecheck, frontend lint/typecheck, pilot build. The insufficient-points mock uses available=100 for its 150-point voucher: using 186 would produce schema-invalid forced details.
- Manual verification 9.5 **not exercised** in the first session (no browser).
- 2026-10-13 manual check 9.5 (Claude in Chrome, `NEXT_PUBLIC_API_MOCKING=enabled`, demo user minh.le 186/18; 1554 px desktop window, 390 px via a same-origin iframe because the automation window could not be resized):
  - Highlands #1: quoting skeleton → confirm 150 / 186 / 36 + "Giá Flash áp dụng đến HH:mm". Double-click confirm → exactly one `POST /rewards/redemptions`, wallet 186 → 36 with one `redemption:<key>` ledger row; success countdown ends at 36, focus on "Đổi thành công!", header PointsChip 36.
  - Keyboard: initial focus on the primary; Tab ×5 stays inside the dialog; Escape closes; focus returns to the opening "Đổi ngay" (`data-redeem-cta`). `aria-labelledby` matches the visible title per view.
  - `rewards-sold-out` (Flash, regular stock > 0 → "Xem giá thường"), `rewards-price-changed` (old → new row; requote fetched a new quote and auto-submitted with a new key → PRICE_CHANGED again as expected, no IDEMPOTENCY_KEY_CONFLICT), `rewards-voucher-unavailable` (PAUSED), `rewards-account-not-eligible` (ACCOUNT_LOCKED → "Về Ví điểm"): correct copy, primary focused, balance unchanged at 186.
  - `api-offline` switched after the quote: checking view, 3 by-key polls with the same key, exhausted state with "Kiểm tra lại"; scenario reset → "Kiểm tra lại" resubmitted the same key → success, one −150 ledger row with that key.
  - `rewards-redeem-lost` at 390 px: bottom sheet with handle → checking (lần 1/3) → success; charged once.
  - Fixed during the check (approved by Quan): (1) `rewards-insufficient-points` showed the generic "Chưa đổi được voucher" because the 12.1 mock `forcedError` returned the real balance (186 ≥ 150), which fails the `available < required` refine; the mock now caps `available` at `price − 1` and the 12.3 test uses 186. Re-checked: dedicated screen 150 / 149 / thiếu 1, "chưa bị trừ điểm". (2) The confirm-view close `IconButton` was visible on mobile (`hidden` lost to the component's `inline-flex`); now `max-lg:hidden`, re-checked at 390 px. (3) The success sticky CTA wrapper drew a white band (`bg-surface`); removed, re-checked.
  - Not exercised: reduced-motion emulation (no DevTools emulation in this tool; code path verified: confetti not rendered and tween returns the final value when `useReducedMotion()`, plus the CSS `prefers-reduced-motion` block); Figma `get_screenshot` side-by-side comparison; Escape while submitting (submit resolves too fast to catch; guarded by `dismissible={!busy}` and `close()` ignoring `submitting`).
  - Test-environment note: the automation tab renders frames only while a screenshot is taken, so `<dialog>` `close` events and rAF were delayed until a screenshot; not reproducible in a visible tab and not a code defect.
  - After the fixes: `npm test` 814/814, `npx tsc --noEmit` and `npm run lint` clean. Pilot build not re-run after the three-line fix (className/mock/test only).

### File List

- `_bmad-output/implementation-artifacts/12-3-confirm-redemption-result.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/schemas/src/rewards/redemption.schema.ts`
- `apps/frontend/my-app/lib/rewards/rewards-service.ts`
- `apps/frontend/my-app/lib/rewards/redeem-flow.ts`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-redeem-flow.ts`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RedeemSheet.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RedeemErrorView.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RedemptionSuccess.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/VoucherDetailScreen.tsx`
- `apps/frontend/my-app/app/globals.css`
- `apps/frontend/my-app/tests/rewards-redeem.test.mjs`
- `apps/frontend/my-app/tests/helpers/frontend-callsites.mjs`
- `apps/frontend/my-app/tests/contract-callsites.test.mjs`
- `apps/frontend/my-app/tests/pilot-scope.test.mjs`
- `apps/frontend/my-app/mocks/data/rewards-rules.ts`

### Change Log

- 2026-10-13: Implemented Story 12.3 frontend redemption flow and automated verification; manual visual/browser verification pending.
- 2026-10-13: Manual check 9.5 run in Chrome; fixed forced INSUFFICIENT_POINTS mock details, mobile close button visibility and the success CTA band. Status → review.
- 2026-10-13: Code review: 5 patches applied (formatPoints in error views, session refresh on close from checking, opener ignores `<body>`, close blocked while polling, tighter tests); 5 deferred. `npm test` 814/814, `tsc --noEmit` and eslint clean. Manual browser re-check of the polling close block not run. Status → done.
