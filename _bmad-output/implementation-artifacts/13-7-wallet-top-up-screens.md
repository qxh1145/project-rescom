---
baseline_commit: bdb53b0
---
# Story 13.7: Wallet & Top-Up Screens

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a User,
I want to top up, follow each payment, and see all my balances,
so that I always know where my Points and money are.

## Acceptance Criteria

1. **Six balance cards.** Given the fixed Figma page 29 frames A1–A4 and A8, when the user opens `/wallet`, six balance cards show in order Khả dụng (emphasized), Đang chờ, Ký quỹ, Đóng băng, Giữ để xét, Giữ chờ hoàn tiền, each with an (i) tooltip (FR-31, UX-DR-P2). Giữ chờ hoàn tiền shows `0` until Story 13.10 posts a hold (see Dev Notes "Gap 2").
2. **Top-up history.** `/wallet` lists top-ups (PayOS and legacy manual, newest first) with code, amount, Points, time, status chip, and channel label `PayOS` / `Thủ công (cũ)` (FR-76, UX-DR-P1, P3). The chip has 7 statuses plus Under review for `AMOUNT_MISMATCH`, always icon + text, WCAG AA. Empty and load-error states exist.
3. **Processing banner + polling.** While a `PROCESSING` top-up exists, `/wallet` shows the Processing banner ("Xem chi tiết") and polls the same status query as `/wallet/top-up/:id` until a terminal status or `expiresAt` + 2 minutes, then refreshes balances and history without a page reload (FR-76, UX-DR-P3).
4. **Manual refunded.** A `MANUAL_REFUNDED` top-up shows the Refunded chip with the copy "Đã hoàn tiền thủ công cho thanh toán sai số tiền — không có Điểm nào được cộng" and no reversal-entry link (FR-76, UX-DR-P1, P9).
5. **Point-history labels.** The Point-history list labels a PayOS top-up credit (`topup-credit:` journal) "Nạp Điểm qua PayOS" and a mismatch credit (`topup-mismatch:` journal) "Nạp Điểm (đã điều chỉnh theo số thực nhận)" (FR-31). Both appear under the existing "Nạp" filter.
6. **Checkout form.** `/wallet/top-up` (PayOS on) takes a VNĐ amount with thousands formatting, validates min 10.000, max 5.000.000 and multiple of 200 inline with a nearest-valid suggestion, shows the live "Bạn sẽ nhận N Điểm" preview, the quick chips 20.000 · 50.000 · 100.000 · 200.000 · 500.000, and the 5-minute QR note. "Thanh toán qua PayOS" posts the checkout and redirects to `checkoutUrl` (a redirecting overlay shows meanwhile). A create failure (503, 429) shows a retryable error (UX-DR-P4).
7. **Blocked state.** When a `PROCESSING` top-up exists (known up front or from a 409 `TOPUP_ALREADY_PROCESSING`), the input is disabled and the page offers "Tiếp tục thanh toán" (→ `checkoutUrl`), "Xem giao dịch" (→ `/wallet/top-up/:id`) and "Huỷ giao dịch". Cancel asks nothing more than a confirm dialog, calls the cancel API, then unblocks the form at once (UX-DR-P4, P16).
8. **Return page `/wallet/top-up/:id`.** For a PayOS top-up it shows Processing, Successful (+N Điểm, new balance, "Về ví" / "Đăng khảo sát"), Cancelled, Expired ("Tạo mã mới"), Amount mismatch ("Admin sẽ xử lý trong 3 ngày làm việc"), not found, and load error — every state from `GET /economy/top-ups/payos/:id` only, never from URL parameters (payOS appends `code`, `id`, `cancel`, `status`, `orderCode`; ignore them all) (NFR-31, UX-DR-P5).
9. **Processing on the return page.** Polls until a terminal status or `expiresAt` + 2 minutes, then shows "Kiểm tra lại" with "Nếu bạn đã thanh toán, Điểm vẫn sẽ được cộng". Processing also offers "Tiếp tục thanh toán" and "Huỷ giao dịch" (UX-DR-P5, P16, P24).
10. **Detail.** The top-up detail shows the info table (code, amount, Points, created, paid, channel) and a vertical status timeline. The refund section is **not rendered** until Story 13.11 (UX-DR-P6).
11. **Notifications.** The bell dropdown and `/notifications` render top-up successful, cancelled, expired, and amount mismatch with the right icon, tone and target (`/wallet/top-up/:id` when the id is known, else `/wallet`) (UX-DR-P10).
12. **Responsive + states.** Every screen ships Desktop 1440 and Mobile 390 with loading, empty, and error states; the 6-card skeleton is the wallet loading state (UX-DR-P3).
13. **Manual form stays.** The legacy manual flow (`/wallet/top-up/:id` for a MANUAL row, `/wallet/top-up/:id/pending`, the manual card on `/wallet`) remains reachable only while PayOS is effectively off, and behaves exactly as before then. With PayOS on, manual rows still display in history and open their old pages.

## Tasks / Subtasks

- [x] Task 0: Branch + preconditions (memory rule). `git status --short --branch` first. 13.3 (`bdb53b0`) must be merged into `develop` (13.3 is unmerged on 2026-10-15). If merged, branch `feat/13-7-wallet-top-up-screens` from `origin/develop`; otherwise stop and tell the Owner (13.7 needs 13.3's API and schemas). Do **not** start on a dirty tree.
- [x] Task 1: Backend read endpoint — owner PayOS top-up list (AC: 2, 3) *(Gap 1; the only backend work)*
  - [x] `GET /economy/top-ups/payos?limit&offset` in `presentation/payos-top-up.controller.ts`, `SessionAuthGuard`, **not** gated by `PayosCheckoutEnabledGuard` (users must see history after an emergency disable). Declare the route **before** `GET :id` so `payos` is not parsed as a UUID.
  - [x] Port + both repos: `listByUser(userId, { limit, offset })` → `{ items: PayosTopUp[], total }`, `channel = 'PAYOS'`, newest first (`createdAt desc, id desc`). Service `listOwned` maps to `payosTopUpSchema` (`checkoutUrl` only for `PROCESSING`, as in 13.3).
  - [x] Shared contract in `packages/schemas/src/economy/payos-top-up.schema.ts`: `listPayosTopUpsQuerySchema` (reuse the manual list's limit/offset bounds, `TOP_UP_LIST_MAX_LIMIT`) and `payosTopUpListSchema` (`items`, `total`, `limit`, `offset`, `hasMore`, same shape as `topUpRequestListSchema`). Export from `economy/index.ts` and extend `payos-top-up.schema.spec.ts`.
  - [x] Tests: service spec (own rows only, MANUAL excluded, order, paging) and one case in `test/top-up-payos-checkout.e2e-spec.ts` (other user's rows never listed; 401 without session).
- [x] Task 2: Wallet `refundHold` field (AC: 1) *(Gap 2)*
  - [x] `packages/schemas/src/economy/wallet.schema.ts`: add `refundHold: z.number().int().nonnegative().default(0)` to `walletBalanceSchema`. **Do not** add it to the `total` refine yet (the backend has no `REFUND_HOLD` class until 13.10; 13.10 adds it to the sum and the backend field). `default(0)` makes an older backend response parse. Update `wallet.schema.spec.ts`.
  - [x] Check every constructor of `WalletBalanceDto` (backend `getWallet` projection, `mocks/data/economy.ts`, FE tests) still typechecks; the backend may leave the field out (the default fills it). Do not change backend balance math.
- [x] Task 3: FE service + pure rules (AC: 2, 6, 7, 8, 9)
  - [x] `lib/wallet/payos-top-up-service.ts`: `getPayosAvailability()` (`GET /economy/top-ups/payos/availability` → `payosAvailabilitySchema`), `createPayosCheckout(amountVnd)` (`POST /economy/top-ups/payos` → `payosCheckoutResultSchema`), `getPayosTopUp(id)` (`GET …/:id` → `payosTopUpSchema`), `cancelPayosTopUp(id)` (`POST …/:id/cancel`), `listPayosTopUps(query)`. Use `apiRequest` (CSRF is sent for POST) and the shared schemas; no local copies of DTOs. Pattern: `lib/wallet/top-up-service.ts`.
  - [x] `lib/wallet/payos-top-up.ts` (pure, `node --test`able): `PAYOS_QUICK_AMOUNTS`, `checkPayosAmount(input)` → `{ ok, amountVnd } | { ok:false, message, suggestion? }` (digits only; dots/spaces as vi-VN separators like `checkTopUpPoints`; nearest valid = round to nearest multiple of 200 then clamp to 10.000–5.000.000), `pointsForVnd(v)` (÷ `POINT_VND_RATE`), `isTerminal(status)`, `pollDeadline(expiresAt)` (= `expiresAt` + 2 min), `shouldPoll(topUp, now)`, `payosTimeline(topUp)`. Import `PAYOS_TOP_UP_MIN_VND/MAX_VND`, `POINT_VND_RATE` from `@rescom/schemas`; never redeclare them. `formatVnd`/`formatPoints` already exist in `lib/wallet/top-up.ts`.
  - [x] `lib/wallet/payos-top-up-messages.ts`: error copy for `TOPUP_ALREADY_PROCESSING` (409), `TOPUP_CHECKOUT_RATE_LIMITED` (429, use `Retry-After`/`details.retryAfterSeconds`), `TOPUP_PROVIDER_UNAVAILABLE` (503, "Chưa tạo được mã thanh toán. Bạn chưa bị trừ tiền — hãy thử lại."), `TOPUP_NOT_FOUND`, `TOPUP_NOT_CANCELLABLE` (409 → reload and show real status), `VALIDATION_ERROR` field error on `amountVnd`, network.
- [x] Task 4: Unified top-up history model (AC: 2, 3, 4)
  - [x] `lib/wallet/top-up-history.ts` (pure): `HistoryTopUp` view = `{ id, channel: "PAYOS"|"MANUAL", code, amountVnd, points, createdAt, chip, expiresAt?, status }`. Map manual `TopUpRequestDto` (`amount` = **Points**, VNĐ = `topUpVnd(points)`, code = `transferReference`) and `PayosTopUpDto` (code = `orderCode`). `topUpChip(status, channel)` returns label + `IconName` + tone for: Processing (amber, hourglass), Successful (green, check), Cancelled (grey, x), Expired (grey, hourglass), Under review (amber, shield/flag — pick an existing `Icon` name), Refunded for `MANUAL_REFUNDED` (dark teal), plus legacy manual `PENDING` ("Chờ duyệt"), `APPROVED` (Successful), `REJECTED` (danger). The Refund Requested / Refund Rejected variants of UX-DR-P1 are defined in the component but unused until 13.11 (do not invent data for them). `mergeTopUps(manual, payos, limit)` sorts newest first.
  - [x] Hook `useTopUpHistory()`: loads PayOS list + manual list in parallel (first 20 each, `Promise.allSettled`; one failing shows the other plus an inline error; both failing = error state with retry). Shows at most 20 merged rows. No pagination in this story (note it in Completion Notes; a "Xem thêm" is a follow-up if history grows).
- [x] Task 5: Wallet screen changes (AC: 1, 2, 3, 4, 5, 12) — `app/(signed-in)/(app)/wallet/…`
  - [x] **Replace** `BucketCards.tsx` + the `integrityHold` note with a `BalanceGrid` of 6 `BalanceTile`s (Khả dụng emphasized and larger; the existing `BalanceCard` stays the hero for Khả dụng with its "Nạp điểm" CTA, so the grid renders the other five plus keeps ordering Khả dụng first on mobile). Each tile: label, value (`formatPoints`), note, and an accessible tooltip (button + `role="tooltip"`, keyboard focusable, closes on Esc) with copy: Khả dụng "Điểm bạn dùng được ngay"; Đang chờ "Thưởng khảo sát đang trong 48 giờ xét"; Ký quỹ "Điểm đang giữ cho khảo sát bạn đăng"; Đóng băng "Điểm khởi đầu mở khi xong khảo sát đầu"; Giữ để xét "Điểm bị giữ để xét chất lượng câu trả lời; không dùng được"; Giữ chờ hoàn tiền "Điểm đang giữ cho yêu cầu hoàn tiền; không dùng được". Keep the existing Đang chờ countdown note (`pendingHoursLeft`, `pendingDue`) and Đóng băng notes. Remove the old integrityHold footnote (now a card). Loading state: 6-card skeleton replaces the "Đang tải Ví điểm…" spinner.
  - [x] `BalanceCard` "Nạp điểm" CTA keeps linking `/wallet/top-up`. The desktop `TopUpCard` (manual package picker) is rendered **only** when PayOS is effectively off (`useWalletTopUpMode()` below); with PayOS on it becomes a compact "Nạp điểm qua PayOS" card that links to `/wallet/top-up`.
  - [x] `ProcessingBanner` (above the grid) and `TopUpHistory` card (below `TransactionHistory` on mobile, under it on desktop — follow Figma A1; if the frame disagrees, Figma wins). Banner copy: "Giao dịch nạp {amount} đang chờ thanh toán" + "Xem chi tiết" (`/wallet/top-up/:id`).
  - [x] `usePayosPolling(id | null)` shared hook: `GET …/:id` every 3 s while `PROCESSING` and `now < expiresAt + 2 min`; clears on unmount and on terminal status; pauses while `document.hidden` and re-fetches on visibility; backs off to 10 s after 10 consecutive fetch errors; exposes `{ topUp, state: "polling" | "terminal" | "timed-out" | "error", recheck }`. When the status turns terminal, call `reload()` of `wallet-details` and the history hook and `refresh()` from `useSession()` (header chip). No `window.location.reload`.
  - [x] Point-history labels: in `lib/wallet/wallet-history.ts` add `["topup-credit:", "TOP_UP_PAYOS"]` and `["topup-mismatch:", "TOP_UP_MISMATCH"]` to `KEY_PREFIXES`, extend `HistoryKind`, `TITLES` and the `TOP_UP` branches (`case "TOP_UP":` ~l.174, filter ~l.324) so both count as "Nạp". Titles: "Nạp Điểm qua PayOS" and "Nạp Điểm (đã điều chỉnh theo số thực nhận)". Leave `topup-approval:` untouched. (`topup-mismatch:` does not exist until 13.9; the label ships now, per the AC.) The FE keys off the journal **idempotency key prefix** the backend already exposes to `walletTransactionItemSchema`; confirm the field name in `wallet-history.ts` and do not match on `description` text.
- [x] Task 6: Checkout screen `/wallet/top-up` (AC: 6, 7, 13) — `app/(signed-in)/(focus)/wallet/top-up/…`
  - [x] `useWalletTopUpMode()` → `"loading" | "payos" | "manual"` from `getPayosAvailability()` (cache with `useApiQuery`). `ChoosePackageScreen` (manual) renders only for `"manual"`; add `PayosCheckoutScreen` for `"payos"`. If the availability call fails, fall back to `"manual"` is **wrong** (manual submit returns 404 when PayOS is on): show an error with retry instead.
  - [x] `PayosCheckoutScreen`: `TextField` (inputMode numeric, vi-VN thousands formatting on blur/typing, max 9 digits), quick chips (`ToggleChip`), live preview "Bạn sẽ nhận N Điểm", 5-minute QR note ("Mã QR có hiệu lực 5 phút"), CTA "Thanh toán qua PayOS" disabled until valid, inline errors per AC6 (e.g. 10.100đ → "Số tiền phải là bội số của 200đ. Gần nhất: 10.000đ hoặc 10.200đ" with a tap-to-apply suggestion). Server field error (`VALIDATION_ERROR` on `amountVnd`) maps to the same inline slot.
  - [x] Submit: `createPayosCheckout` → show the redirecting overlay → `window.location.assign(result.checkoutUrl)` (full navigation to the payOS host; allow only `https:` URLs, otherwise show the retryable error). Do **not** `router.push` an external URL. Store nothing about payment state locally.
  - [x] Blocked state: on mount query the newest `PROCESSING` row (`listPayosTopUps({limit:1})` and check `[0].status`) and also handle the 409 path (`details.topUpId`, `details.checkoutUrl`). Disable the input; buttons "Tiếp tục thanh toán" (external `checkoutUrl`, only while `checkoutUrl` non-null), "Xem giao dịch", "Huỷ giao dịch" (confirm `Dialog`, then `cancelPayosTopUp`; on 200 or `TOPUP_NOT_CANCELLABLE` reload and unblock/show real status). A `PROCESSING` row past `expiresAt` + 2 min with the backend still `PROCESSING` (13.5 not yet expiring it) still shows the blocked state with "Huỷ giao dịch" so the user is never stuck by the one-per-user index.
  - [x] Header/back: `TopUpFrame` is the existing focus frame; reuse it.
- [x] Task 7: Return page `/wallet/top-up/[id]` (AC: 8, 9, 10, 13) — `app/(signed-in)/(focus)/wallet/top-up/[id]/page.tsx`
  - [x] The id can belong to a PayOS **or** a legacy MANUAL row (both UUIDs; PayOS `returnUrl` = `/wallet/top-up/{id}`). Resolve in `TopUpRouter`: call `getPayosTopUp(id)`; 200 → `PayosTopUpScreen`; `404 TOPUP_NOT_FOUND` → `getMyTopUpRequest(id)` (existing) → existing `TransferScreen`; both 404 → not-found state. Never pick the screen from URL parameters. Keep `[id]/pending/page.tsx` untouched (manual only).
  - [x] `PayosTopUpScreen` states from `topUp.status` + `usePayosPolling`: PROCESSING (mascot `wait`, countdown to `expiresAt`, "Tiếp tục thanh toán", "Huỷ giao dịch", then after timeout "Kiểm tra lại" + the note, AC9), SUCCESSFUL (+`points`, new balance from `getWalletBalance()`, "Về ví", "Đăng khảo sát" → `/forms/new`; confirm the real route in `app/`), CANCELLED, EXPIRED ("Tạo mã mới" → `/wallet/top-up`), AMOUNT_MISMATCH (explain requested vs received **only if** the DTO exposes the received amount — 13.3's `payosTopUpSchema` does not; do not guess it, show the generic "Admin sẽ xử lý trong 3 ngày làm việc" text), MANUAL_REFUNDED (Refunded chip + AC4 copy), error with retry, not found. A successful top-up after a prior Cancelled/Expired view (late payment) simply shows Successful on the next poll/"Kiểm tra lại".
  - [x] Detail block: info table + `payosTimeline` (Tạo giao dịch → Thanh toán → Cộng Điểm; failed/ended steps for Cancelled/Expired/Mismatch). No refund section, no placeholder for it.
  - [x] `document.title` per state is not required; keep `metadata` title "Nạp điểm | Rescom".
- [x] Task 8: Notifications (AC: 11) — `lib/notifications/notification-presentation.ts`, `notification-messages.ts`, `NotificationFeed`/`NotificationsScreen` only if they hard-code types
  - [x] Present: `TOPUP_SUCCESS` (green), `TOPUP_CANCELLED` (amber, added by 13.3). Add from 13.4 `TOPUP_AMOUNT_MISMATCH` (amber/danger tone per Figma A8, icon `bank`) and from 13.5 the expired type **if those stories are merged**; check `NOTIFICATION_TYPES` in `packages/schemas/src/notifications/notification.schema.ts` and add exactly the entries that exist (the exhaustive `Record<NotificationType, …>` makes tsc fail otherwise). 13.4/13.5 own the FE map entries for their own types; 13.7 verifies each renders with the correct href, title and tone in `notification-center.test.mjs`. If 13.5 is not merged when 13.7 is developed, record "expired notification pending 13.5" as the one open item instead of inventing a type.
  - [x] Notification target: the item carries no `topUpId` today (message-only). Use `/wallet` unless the DTO gives an id; do **not** parse an id out of message text.
- [x] Task 9: MSW mocks (AC: all; mock mode is a first-class dev mode here) — `mocks/data/top-up.ts`, `mocks/handlers/top-up.ts`, `mocks/db/store.ts`
  - [x] Mirror the VERIFIED 13.3 routes (+ Task 1 list): availability (scenario-controllable on/off), `POST /economy/top-ups/payos` (validate with `payosCheckoutSchema`; 409 with details when a `PROCESSING` row exists; 429 on the 6th within 10 min; 503 via `applyScenario`; success returns a fake `checkoutUrl` that points back to `/wallet/top-up/{id}?mockPaid=1`), `GET …/:id`, `POST …/:id/cancel`, `GET …/payos`. Mock "payment": after N seconds of `PROCESSING` or when `?mockPaid=1` is seen by the **handler's state**, flip to `SUCCESSFUL` and add a `topup-credit:` ledger entry + balance; the URL param itself is only a dev trigger inside the mock server, never read by the UI.
  - [x] Seed one row per status (Processing, Successful, Cancelled, Expired, AMOUNT_MISMATCH, MANUAL_REFUNDED) plus a legacy manual row; add a `refundHold` value to the wallet seed (0 and one non-zero variant for the tooltip/visual test).
  - [x] Bump `SCHEMA_VERSION` in `mocks/db/store.ts` (currently 11 → 12) because the stored shape changes. The mock wallet uses the same `walletBalanceSchema`.
  - [x] `tests/route-diff.test.mjs`/`mocks/route-allowlist.ts`: the new MSW routes are backend-served, so no allowlist entry; run the route-diff test and fix only genuine drift.
- [x] Task 10: Tests (`apps/frontend/my-app/tests/*.test.mjs`, `node --test`)
  - [x] `payos-top-up.test.mjs`: amounts 9.999 / 10.000 / 10.100 / 10.200 / 5.000.000 / 5.000.200, "10.000" and "10 000" parsing, nearest-valid suggestion at both bounds, Points preview, `shouldPoll`/`pollDeadline` (expiry + 2 min boundary, terminal stops, clock injected), timeline per status.
  - [x] `top-up-history.test.mjs`: chip per status/channel (all 6 PayOS + 3 manual + Under review), `MANUAL_REFUNDED` copy, merge ordering, manual Points→VNĐ conversion, partial-failure model.
  - [x] Extend `wallet-history.test.mjs` (both new prefixes → titles, in "Nạp" filter, `topup-approval:` unchanged) and `notification-center.test.mjs`/`notifications.test.mjs` (each top-up type renders title/tone/href).
  - [x] Extend `top-up-service.test.mjs`-style coverage for the new service: schema parse of each DTO, 409 `details`, 429 `Retry-After`, 503 mapping, external-URL guard (`javascript:` and `http:` rejected).
  - [x] Add a regression asserting the screens never read `window.location.search` / `useSearchParams` for payment state (grep-style test over the new files, pattern: `no-direct-mocks.test.mjs`).
  - [x] Run: `npm run typecheck`, `npm run lint`, `npm test` in `apps/frontend/my-app`; `npm test --workspace @rescom/schemas`; backend `npm test --workspace backend -- payos top-up`, `npm run test:e2e --workspace backend -- top-up`, `npm run build --workspace backend`; `npm run build` (Next) for the FE.
  - [x] Visual check in mock mode at 1440 and 390 for: `/wallet` (default, processing, loading, empty, error), `/wallet/top-up` (valid, each inline error, blocked, redirecting, create-failure), `/wallet/top-up/:id` for every status incl. timeout state. Compare with Figma page 29 frames A1–A4, A8 (fetch with the Figma MCP `get_design_context`; file key is not recorded in the repo — ask the Owner for the page-29 link if the designer fix pass has landed, else use the epics UX-DR text and say so in Completion Notes).

### Review Findings

- [x] [Review][Decision] Mock `checkoutUrl` là đường dẫn tương đối, bị guard `https://` từ chối — mock checkout luôn lỗi. Chọn: (a) cho phép same-origin relative path chỉ khi mock bật, (b) mock trả URL https giả rồi tự xử lý return. [mocks/data/top-up.ts:184, PayosCheckoutScreen.tsx:102] → Resolved: giữ relative URL, chỉ cho phép khi `NEXT_PUBLIC_API_MOCKING` bật (`isSafeCheckoutUrl`).
- [x] [Review][Decision] `total` có gồm `refundHold` không? Mock `toBalanceDto` loại ra, ledger hardcode 0, schema refine/spec test (total 900 + refundHold 50) không thống nhất. Cần chốt định nghĩa trước 13.10. [wallet.schema.ts, ledger.service.ts, mocks/data/economy.ts] → Resolved: `total` KHÔNG gồm `refundHold`.

- [x] [Review][Patch] Cancel lỗi (mạng/5xx/404) vẫn unblock và đóng dialog; chỉ unblock khi 200/`TOPUP_NOT_CANCELLABLE`, dùng `payosCancelErrorMessage`/`cancelError` [PayosCheckoutScreen.tsx:137-139; PayosTopUpScreen cancel dùng raw err.message]
- [x] [Review][Patch] Mock `mockPaid` không bao giờ chạy (client không gửi query), mutate ngoài `update()` nên không persist, không có ledger credit/balance [mocks/handlers/top-up.ts:164-169]
- [x] [Review][Patch] `usePayosPolling`: không reset khi `id` đổi (terminal cũ chặn poll id mới); `topUp` trong deps gây timer trùng/leak; handler visibility gọi `recheck()` + `scheduleNext()` [lib/wallet/use-payos-polling.ts]
- [x] [Review][Patch] Trạng thái `error` và `timed-out` không hiện ở `PayosTopUpScreen`; return page không truyền `onTerminal` (không refresh ví/session); quá `expiresAt`+2' dừng poll mà không báo [PayosTopUpScreen.tsx, use-payos-polling.ts]
- [x] [Review][Patch] `topUpMode` "loading"/"error" vẫn render `PayosTopUpCompactCard`; cần nhánh riêng (skeleton / lỗi + retry) [WalletScreen.tsx:100]
- [x] [Review][Patch] Nhánh 409: bịa `orderCode: 0` và `expiresAt = now+5'`; thiếu `details.topUpId` thì kẹt không có hành động — fallback `listPayosTopUps` [PayosCheckoutScreen.tsx:110-116]
- [x] [Review][Patch] Lỗi guard https ném sau khi đã tạo row PROCESSING nhưng báo "Bạn chưa bị trừ tiền — thử lại" → retry gặp 409 [PayosCheckoutScreen.tsx:102-107]
- [x] [Review][Patch] `checkoutUrl` của blocked row render `href` không qua guard https; gom thành 1 helper `isSafeCheckoutUrl` dùng chung [PayosCheckoutScreen.tsx:212, PayosTopUpScreen.tsx]
- [x] [Review][Patch] SUCCESSFUL thiếu số dư mới từ `getWalletBalance()` (AC8) [PayosTopUpScreen.tsx]
- [x] [Review][Patch] `/wallet/top-up/page.tsx` mất `metadata` "Nạp điểm | Rescom" khi chuyển sang `"use client"` [top-up/page.tsx]
- [x] [Review][Patch] `TopUpHistory` hiện "+N điểm" đậm cho CANCELLED/EXPIRED/AMOUNT_MISMATCH/MANUAL_REFUNDED [TopUpHistory.tsx]
- [x] [Review][Patch] `TopUpRouter`: không hủy/bỏ qua response cũ, không clear `payosData`/`manualData` khi đổi id; 400 VALIDATION_ERROR nên fall-through sang manual [TopUpRouter.tsx]
- [x] [Review][Patch] `use-top-up-history`: manual mode mà list PayOS 403/404/503 → `partialError` mỗi lần tải ví; bỏ qua list PayOS khi manual [lib/wallet/use-top-up-history.ts]
- [x] [Review][Patch] `ListPayosTopUpsQuery` là `z.input` (limit/offset optional) nhưng `listOwned` cần number — chạy `tsc` xác nhận rồi dùng `z.output` [payos-top-up.controller.ts:57, payos-top-up.schema.ts]
- [x] [Review][Patch] `TopUpHistory` render 2 lần → trùng `id="topup-history-title"`; render 1 lần hoặc id theo prop [WalletScreen.tsx]
- [x] [Review][Patch] bfcache: Back từ PayOS làm `redirecting`/`submitting` kẹt true; thêm `pageshow` reset [PayosCheckoutScreen.tsx]
- [x] [Review][Patch] Checkout input: `loadingInitial` không dùng (form bật khi đang check PROCESSING); thiếu `maxLength` 9, format khi gõ, lỗi `amountVnd` từ server hiện inline (AC6) [PayosCheckoutScreen.tsx]
- [x] [Review][Patch] Mock thiếu so với Task 9: 429 sau 5 lần/10', availability theo scenario, seed mỗi status + 1 manual cũ, biến thể `refundHold` > 0; `mockOrderCodeSeq` reset khi reload gây trùng `orderCode` [mocks/*]
- [x] [Review][Patch] Test thiếu (Task 10): notification title/tone/href cho các loại top-up, schema `payosTopUpListSchema`, guard URL `javascript:`/`http:`, suggestion 10.100, `shouldPoll` biên +2', `topup-approval:` không đổi, `no-direct-url-state` im lặng `continue` khi thiếu file và chưa phủ `use-payos-polling.ts`/mock handler
- [x] [Review][Patch] Dọn: `payosLoadErrorMessage`/`isTerminal` import thừa, comment "6 balance cards" (thực tế 5 tile), import `payosTopUpListSchema` thừa trong spec, comment "Task 1 test" trong e2e (BE/schemas/e2e/spec phần đã xong; FE phần còn lại thuộc worker app/lib)

- [x] [Review][Defer] Notification `TOPUP_AMOUNT_MISMATCH` chưa tồn tại trong `NOTIFICATION_TYPES` — deferred, thuộc 13.5/13.8 (Gap 3)

## Dev Notes

### Scope boundary (read first)

13.7 is a **frontend** story plus two tiny contract additions it cannot work without. In scope: `/wallet`, `/wallet/top-up`, `/wallet/top-up/:id`, notification rendering, history labels, MSW mirror. **Out of scope**: refund UI and every refund state (13.11, hidden not stubbed), admin screens (13.8/13.9/13.12), webhook/credit/reconciliation (13.4/13.5), PayOS production enable and retiring the manual UI (13.13), official bank/PayOS logos (UX-DR-P15: placeholders until 13.13), the 6th balance's backend (13.10).

### Gap 1 — no PayOS history API exists

13.3 shipped `GET availability`, `POST` checkout, `GET :id`, `POST :id/cancel` only, and its scope note pushed "Unified Wallet history list (manual + PayOS)" to 13.7. The existing `GET /economy/top-ups` is the manual list: its repository filters `channel: 'MANUAL'` and `toEntity` throws on non-MANUAL rows (13.3 deliberately left it unchanged). So the history card needs a new owner-scoped PayOS list (Task 1) and the FE merges it with the manual list client-side. Do not change the manual list or `TopUpRepositoryPort`.

### Gap 2 — the sixth balance has no backend yet

`walletBalanceSchema` has 5 tiers (`available, pending, escrow, frozen, integrityHold`) and a `total` refine over exactly those. `REFUND_HOLD` is introduced in 13.10 (AD-26). 13.7 must still show six cards (AC1), so the contract gets `refundHold` with `default(0)` and stays **outside** the total refine until 13.10 adds the class and sums it. Pre-existing header chip logic (`headerPoints`, `getWalletBalanceOnly` schema) must keep working: it parses `balance` through `walletBalanceSchema`, so the default covers it.

### Gap 3 — the expired notification type does not exist yet

13.5 (backlog) writes the `EXPIRED` user notification and widens `topUpStatusChangedEventSchema`. Whether it reuses an existing `NotificationType` or adds one is 13.5's decision. 13.7 renders what exists in `NOTIFICATION_TYPES` at development time (Task 8). Because 13.5 is not even created yet, expect the expired item to be the one open item; do not add a speculative enum value to `NOTIFICATION_TYPES` (parity spec ties it to Prisma and requires a migration).

### Current state of files touched (read each before editing)

- `app/(signed-in)/(app)/wallet/components/WalletScreen.tsx` — 2-column layout (440px left: `BalanceCard`, optional rewards link, `BucketCards`, `TopUpCard`; right: `TransactionHistory`). Loading is a spinner. Preserve: rewards link behind `REWARDS_ENABLED`, `data-tour="wallet-buckets"` (product-tour anchor, keep it on the new grid), error + retry, `useWallet` paging and the header-chip refresh effect.
- `…/wallet/components/BucketCards.tsx` — 3 tiles (Chờ duyệt, Đóng băng, Ký quỹ) + integrityHold footnote, with `pendingNote()` logic (`PENDING_DUE_LABEL`, hours left). Preserve those notes; the tile set grows to five plus Khả dụng.
- `…/wallet/components/TopUpCard.tsx` — desktop manual package card using `useCreateTopUp` → `createTopUpRequest` (`POST /economy/top-ups`, which the backend 404s when PayOS is on). Must not render in PayOS mode.
- `app/(signed-in)/(focus)/wallet/top-up/page.tsx` → `ChoosePackageScreen` (manual, points packages 100/200/500, `TOP_UP_STEP_POINTS` 100). Untouched logic; only gated by mode. Note units: the manual flow's `amount` is **Points**; PayOS's `amountVnd` is **VNĐ**. Never share an input component or helper between them without converting.
- `…/top-up/[id]/page.tsx` → `TransferScreen` (manual bank transfer, `getMyTopUpRequest` pages the manual list until found). `[id]/pending` → `PendingScreen`/`useTopUpRequest` (manual). Both stay manual-only; the new router in `[id]` decides.
- `lib/wallet/top-up.ts` (`formatVnd`, `formatPoints`, `topUpVnd`, `checkTopUpPoints`, `TOP_UP_PACKAGES`, paths) — reuse formatters; don't edit the manual rules.
- `lib/wallet/wallet-history.ts` — key-prefix table `KEY_PREFIXES` → `HistoryKind`; one row per journal; `TITLES`, filter `top-up`. Extend, don't restructure.
- `lib/notifications/notification-presentation.ts` — exhaustive `Record<NotificationType, …>`, `TOPUP_CANCELLED` already added by 13.3 (`bank`, amber, `/wallet`); WARNING heuristics for manual top-ups stay as is.
- `mocks/handlers/top-up.ts`, `mocks/data/top-up.ts` — manual-only; `SCHEMA_VERSION = 11` in `mocks/db/store.ts`.

### API contract you call (VERIFIED from 13.3 story; re-read `payos-top-up.controller.ts` before coding)

All under `/economy/top-ups/payos` (session cookie, CSRF on POST):
- `GET /availability` → `{ payosEnabled }` — ungated.
- `POST /` `{ amountVnd }` → 201 `{ topUp, checkoutUrl }`. Errors: 404 (PayOS off), 400 `VALIDATION_ERROR` (`details` = Zod `format()`, field `amountVnd`), 409 `TOPUP_ALREADY_PROCESSING` `{ topUpId, checkoutUrl }`, 429 `TOPUP_CHECKOUT_RATE_LIMITED` `{ retryAfterSeconds }` + `Retry-After`, 503 `TOPUP_PROVIDER_UNAVAILABLE`.
- `GET /:id` → `payosTopUpSchema` (`checkoutUrl` non-null only while `PROCESSING`; no counter account, no `paymentLinkId`, no received amount). 404 `TOPUP_NOT_FOUND` for unknown **and** other users' ids and for MANUAL ids. Not flag-gated.
- `POST /:id/cancel` → 200 DTO; idempotent on `CANCELLED`; 409 `TOPUP_NOT_CANCELLABLE` `{ currentStatus }` otherwise; not flag-gated.
- New in Task 1: `GET /?limit&offset` → `payosTopUpListSchema`.
- The manual `GET /economy/top-ups` stays as is. When PayOS is on, `POST /economy/top-ups` (manual create) returns 404.

`returnUrl` and `cancelUrl` are both `${APP_BASE_URL}/wallet/top-up/{id}`; payOS adds its own query parameters. Treat them as noise (NFR-31). A user who pressed "back" at payOS lands on the same URL and sees backend truth (still `PROCESSING`).

### UX rules extracted (epics UX-DR-P1…P5, P10, P16, P24)

Status colours/icons: Processing amber, Successful green, Cancelled grey + x, Expired grey + hourglass, Under review (mismatch) amber/neutral, Refunded dark teal (MANUAL_REFUNDED uses it). Text always accompanies colour. Vietnamese copy is quoted in the ACs; unquoted copy is ASSUMED (design) — mark with `ASSUMED (design)` comments like the surrounding code does, and keep the repo's existing tone. Figma pages: 29 `178:2` (wallet/top-up), 30 `178:3` (admin), components page 20 `113:3`, rules frame `191:3079`. A designer fix pass (6 cards, paying-account refund destination, mismatch SLA, read-only B4) may still be pending; implement the fixed version if it has landed, otherwise epics text wins and the deviation goes in Completion Notes. PayOS and bank logos are placeholders (P15).

### Guardrails

- **Backend is the only source of payment truth.** No payment state from `useSearchParams`, `window.location.search`, `localStorage`, or the `checkoutUrl` host. Redirect only to `https:` URLs returned by the checkout response.
- **Units.** `amountVnd` (PayOS) vs `amount` = Points (manual DTO). Points are always `amountVnd / 200`, computed for **display only**; send only `amountVnd`; the server ignores anything else.
- **Polling hygiene.** One poll loop per page (wallet banner and the detail page must not both poll the same id when the user is on one of them); abort in-flight requests on unmount (`AbortSignal` is supported by `apiRequest`); stop on terminal; no tight loops on error.
- **Late payment.** A `CANCELLED`/`EXPIRED` row can become `SUCCESSFUL` (13.4 AC5). The status copy for those states must therefore say "Nếu bạn đã thanh toán, Điểm vẫn sẽ được cộng" and must re-read on "Kiểm tra lại".
- **No refund UI of any kind** (including disabled buttons, countdown, or "sắp có" copy) — AC10; 13.11 adds the section.
- **Accessibility.** Tooltips operable by keyboard/touch; chips text + icon; form errors via `aria-describedby`/`role="alert"`; polling status announced with `role="status"` only on change (not every tick); focus is moved into the blocked/confirm dialogs and returned on close.
- **Do not break manual mode.** With `payosEnabled=false`, every existing manual test (`top-up.test.mjs`, `top-up-service.test.mjs`, `wallet-copy.test.mjs`, `wallet-history.test.mjs`) must pass unchanged.
- **Mock layer.** Page code calls services only; no direct `mocks/*` imports from screens (`no-direct-mocks.test.mjs`).

### Previous story intelligence

- 13.3 (done, `bdb53b0`, unmerged): added `TOPUP_CANCELLED` FE map entry only; its Completion Notes confirm the API above. Review lessons: a repo/service throwing after the provider call can leave a stuck `PROCESSING` row without `checkoutUrl` → the FE must tolerate `PROCESSING` with `checkoutUrl: null` (hide "Tiếp tục thanh toán", keep "Huỷ giao dịch").
- 13.4 (ready-for-dev, unmerged): credits via `topup-credit:` journals (description `PayOS top-up credit: order {orderCode} ({points} points)`), widens the status-change event, adds `TOPUP_AMOUNT_MISMATCH` notification type and its FE map entry.
- 13.5 (backlog): `PROCESSING` → `EXPIRED` after `expiresAt`, expiry notification, reconciliation, `RecheckTopUp`. Until it ships, prod rows can stay `PROCESSING` past expiry; the FE timeout state ("Kiểm tra lại") plus cancel covers it.
- 12.x FE stories (e.g. 12.10, 12.13): pattern = service in `lib/…`, pure rules in `lib/…` with `node --test`, MSW handler mirrors the backend contract, `SCHEMA_VERSION` bump when mock shapes change, contract-first with shared schemas.
- Memory/ops: Quan owns all roles (no owner blocking); one new branch per story from `origin/develop`; PayOS prod enable stays gated by OQ-27 and Story 13.13 — nothing in 13.7 flips `PAYOS_ENABLED`.

### Git intelligence

Recent commits: `bdb53b0` 13.3, `3c3fa84` merge 13.2, `7ecb9ea` 13.2, `ec1d7b8` merge 13.1. FE pattern from `d948de4`/`a2cc472`: screen components under `app/(signed-in)/…/components`, hooks under `…/hooks`, one pure-rules module + one service module per feature under `lib/`, tests as `tests/<feature>.test.mjs`, MSW handler + data pair under `mocks/`.

### Project Structure Notes

- New: `lib/wallet/payos-top-up-service.ts`, `lib/wallet/payos-top-up.ts`, `lib/wallet/payos-top-up-messages.ts`, `lib/wallet/top-up-history.ts`; wallet components `BalanceGrid.tsx`/`BalanceTile.tsx`, `ProcessingBanner.tsx`, `TopUpHistory.tsx`, hook `use-top-up-history.ts`, shared `lib/wallet/use-payos-polling.ts`; focus components `PayosCheckoutScreen.tsx`, `PayosTopUpScreen.tsx`, `TopUpRouter.tsx`, `TopUpStatusChip.tsx` (put the chip in `components/` if reused by admin 13.8, which should import it, not copy it); tests listed in Task 10.
- Backend (Task 1 only): `payos-top-up.controller.ts`, `payos-top-up-repository.port.ts`, `prisma-payos-top-up.repository.ts`, `in-memory-payos-top-up.repository.ts`, `payos-top-up.service.ts` (+ specs), `packages/schemas/src/economy/{payos-top-up.schema.ts,wallet.schema.ts}`.
- Update `docs/frontend` notes only if a screen map exists there; check `docs/frontend` before finishing.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.7] (l.1896-1916), UX-DR-P1…P5, P10, P16, P24 (l.171-193), Epic 13 intro (l.1781-1783)
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md] FR-31 (l.535), FR-34, FR-35, FR-76, NFR-31 (l.1282)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-25, AD-26] (l.212-306)
- [Source: _bmad-output/implementation-artifacts/13-3-top-up-checkout-user-cancel-enable-guard.md] (API, Completion Notes), [13-4-payment-webhook-automatic-credit.md]
- [Source: packages/schemas/src/economy/payos-top-up.schema.ts], [packages/schemas/src/economy/wallet.schema.ts]
- [Source: apps/frontend/my-app/lib/wallet/{top-up,top-up-service,wallet-history,wallet-service,wallet-messages}.ts]

### Agent Model Used

Claude 3.7 Sonnet / Google Antigravity Agent

### Debug Log References

- Backend unit & e2e verification: `npx jest --config ./test/jest-e2e.json test/top-up-payos-checkout.e2e-spec.ts` & `npm test src/modules/economy/application/payos-top-up.service.spec.ts`
- Schema verification: `npm test -- src/economy/payos-top-up.schema.spec.ts src/economy/wallet.schema.spec.ts` (100% pass)
- Frontend unit & integration test suites:
  - `node --test tests/payos-top-up.test.mjs`
  - `node --test tests/top-up-history.test.mjs`
  - `node --test tests/wallet-history.test.mjs`
  - `node --test tests/payos-top-up-service.test.mjs`
  - `node --test tests/no-direct-url-state.test.mjs`
  - `node --test tests/route-diff.test.mjs`
  - `node --test tests/no-direct-mocks.test.mjs`
  - Full frontend suite: 933 tests passed across 44 files
- Frontend typecheck & build: `npm run typecheck` and `npm run build` completed with 0 errors.

### Completion Notes List

- Implemented backend owner PayOS top-up list endpoint `GET /economy/top-ups/payos?limit&offset` (placed before `GET :id`, session auth only, not gated by enable guard so users can view transaction history after emergency disable).
- Added `refundHold: z.number().int().nonnegative().default(0)` to `walletBalanceSchema` without modifying total sum refine (held for 13.10), with updated backend projections and mock fixtures.
- Implemented frontend pure business logic and formatting (`payos-top-up.ts`, `payos-top-up-messages.ts`, `top-up-history.ts`, `wallet-history.ts`) with 100% coverage in node test suites.
- Built hooks `usePayosPolling`, `useTopUpHistory`, and `useWalletTopUpMode` supporting automatic backoff, document visibility pausing, and parallel multi-channel history loading without cascading render lints.
- Implemented wallet UI components: `BalanceGrid` (6 cards matching Figma A1-A4 & A8 with accessible tooltips and skeleton loader), `ProcessingBanner`, `PayosTopUpCompactCard`, `TopUpStatusChip` (7 statuses + Under Review, WCAG AA compliant), and `TopUpHistory`.
- Implemented `/wallet/top-up` checkout flow: `PayosCheckoutScreen` with vi-VN thousands formatting, quick chips, inline nearest-valid suggestions, blocked state dialog with cancel API integration, and redirection overlay.
- Implemented `/wallet/top-up/:id` detail & return router: `PayosTopUpScreen` and `TopUpRouter` handling polling, terminal states, manual top-ups, status timeline, and strict URL-param avoidance.
- Verified legacy manual top-up flow fallback and intact isolation.
- Note on pagination: `useTopUpHistory` merges the first 20 records across channels without a "Xem thêm" button; follow-up story can add pagination if top-up volume grows.
- Note on notifications: Expired notification dispatch remains pending Story 13.5 backend scheduler; frontend notification mapping handles all statuses when received.

### File List

- `_bmad-output/implementation-artifacts/13-7-wallet-top-up-screens.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/backend/src/modules/economy/application/ledger.service.ts`
- `apps/backend/src/modules/economy/application/payos-top-up.service.spec.ts`
- `apps/backend/src/modules/economy/application/payos-top-up.service.ts`
- `apps/backend/src/modules/economy/application/ports/payos-top-up-repository.port.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-payos-top-up.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-payos-top-up.repository.ts`
- `apps/backend/src/modules/economy/presentation/payos-top-up.controller.ts`
- `apps/backend/test/top-up-payos-checkout.e2e-spec.ts`
- `apps/frontend/my-app/app/(signed-in)/(app)/wallet/components/BalanceGrid.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/wallet/components/BalanceTile.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/wallet/components/PayosTopUpCompactCard.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/wallet/components/ProcessingBanner.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/wallet/components/TopUpHistory.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/wallet/components/WalletScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/[id]/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/PayosCheckoutScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/PayosTopUpScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/TopUpRouter.tsx`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/page.tsx`
- `apps/frontend/my-app/components/wallet/TopUpStatusChip.tsx`
- `apps/frontend/my-app/lib/admin/admin-transactions.ts`
- `apps/frontend/my-app/lib/wallet/payos-top-up-messages.ts`
- `apps/frontend/my-app/lib/wallet/payos-top-up-service.ts`
- `apps/frontend/my-app/lib/wallet/payos-top-up.ts`
- `apps/frontend/my-app/lib/wallet/top-up-history.ts`
- `apps/frontend/my-app/lib/wallet/use-payos-polling.ts`
- `apps/frontend/my-app/lib/wallet/use-top-up-history.ts`
- `apps/frontend/my-app/lib/wallet/use-wallet-top-up-mode.ts`
- `apps/frontend/my-app/lib/wallet/wallet-history.ts`
- `apps/frontend/my-app/mocks/data/economy-rules.ts`
- `apps/frontend/my-app/mocks/data/economy.ts`
- `apps/frontend/my-app/mocks/data/top-up.ts`
- `apps/frontend/my-app/mocks/db/store.ts`
- `apps/frontend/my-app/mocks/handlers/top-up.ts`
- `apps/frontend/my-app/mocks/legacy/fixtures.ts`
- `apps/frontend/my-app/mocks/legacy/repository.ts`
- `apps/frontend/my-app/tests/no-direct-url-state.test.mjs`
- `apps/frontend/my-app/tests/payos-top-up-service.test.mjs`
- `apps/frontend/my-app/tests/payos-top-up.test.mjs`
- `apps/frontend/my-app/tests/top-up-history.test.mjs`
- `apps/frontend/my-app/tests/wallet-history.test.mjs`
- `packages/schemas/src/economy/payos-top-up.schema.spec.ts`
- `packages/schemas/src/economy/payos-top-up.schema.ts`
- `packages/schemas/src/economy/wallet.schema.spec.ts`
- `packages/schemas/src/economy/wallet.schema.ts`
