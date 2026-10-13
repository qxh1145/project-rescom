---
baseline_commit: 54f10670f8f8a98ea02612263d99869b9a260452
---
# Story 12.4: My Vouchers, Code/QR & History

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a User,
I want to see my vouchers and use their codes at the counter,
so that I can actually claim what I redeemed.

## Acceptance Criteria

1. **My vouchers list.** Given a user with redeemed vouchers, when they open Voucher của tôi, then tickets (VoucherTicket: Unused, Expiring, Used, Expired) appear in Unused, Used and Expired tabs, sorted by nearest expiry, with an Empty state (Figma page 24, FR-70).
2. **Ticket.** Opening a ticket shows the code, a QR code, a copy action, store instructions and the expiry.
3. **Mark used.** The user can mark a ticket as used and undo it within 24 hours.
4. **Faulty code.** "Báo mã lỗi" creates a code-issue report and shows its status (FR-75).
5. **History.** Redemption history shows Success, Failed and Refunded entries.
6. **Badge.** The header badge shows the unused count.

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.4 (FR-70, FR-75; BR-10, BR-22, BR-23; Open Question 25 planning defaults: 24 h undo, 1 business day faulty-code resolution).

## Tasks / Subtasks

- [x] **Task 1: Contract additions (`packages/schemas/src/rewards/redemption.schema.ts`, additive)** (AC: 1–6)
  - [x] 1.1 `voucherTicketSchema`: add `category: voucherCategorySchema` (import it from `./voucher-catalog.schema`). The ticket needs it for `VoucherThumb` (category glyph). `redemptionResultSchema.ticket` inherits it.
  - [x] 1.2 Add `voucherTicketResponseSchema = z.object({ ticket: voucherTicketSchema, serverTime: instant })` (detail, mark-used and undo responses).
  - [x] 1.3 Add `redemptionHistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), offset: z.coerce.number().int().min(0).max(MAX_PAGINATION_OFFSET).default(0) })` (import `MAX_PAGINATION_OFFSET` from `../common/pagination.schema`, as `voucher-catalog.schema.ts` does).
  - [x] 1.4 `redemptionHistoryListSchema`: add `monthSummary: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), pointsSpent: z.number().int(), voucherCount: z.number().int() })`. Semantics (document in a one-line comment): the current Asia/Ho_Chi_Minh month at server time; `pointsSpent` = Σ|points| of SUCCEEDED rows − Σ points of REFUNDED rows created in that month; `voucherCount` = #SUCCEEDED − #REFUNDED in that month. Both may be ≤ 0 (a refund of last month's redemption). Figma 24c "Tháng 10/2026 · Đã dùng 375 điểm cho 3 voucher".
  - [x] 1.5 Add `export const VOUCHER_TICKET_ERROR_CODES = ["TICKET_NOT_FOUND", "TICKET_EXPIRED", "UNDO_WINDOW_CLOSED", "CODE_ISSUE_ALREADY_OPEN", "TICKET_REFUNDED"] as const;` (TICKET_REFUNDED added in review) (ASSUMED API CONTRACT; HTTP 404 for the first, 409 for the others). No envelope schema: these carry no details.
  - [x] 1.6 Type exports: `VoucherTicketStatus`, `VoucherTicketListDto`, `VoucherTicketResponseDto`, `RedemptionHistoryEntryDto`, `RedemptionHistoryListDto`, `RedemptionHistoryQuery`, `CodeIssueReason`, `CodeIssueStatus`, `CodeIssueReportDto`, `CreateCodeIssueReportDto`, `VoucherTicketErrorCode`. Same one-line style as the existing type block.
  - [x] 1.7 `redemption.schema.spec.ts`: update the ticket fixture (+ `category`) and the history-list fixture (+ `monthSummary`); add cases: `voucherTicketResponseSchema` parses; `monthSummary.month` rejects `"2026-13"`; `pointsSpent` accepts a negative int; `redemptionHistoryQuerySchema` defaults `{ limit: 20, offset: 0 }` and rejects `limit=51`.
  - [x] 1.8 `npm --prefix packages/schemas test && npm --prefix packages/schemas run typecheck`.
- [x] **Task 2: Mock domain (rules + data + handlers)** (AC: 1–5)
  - [x] 2.1 `mocks/data/rewards-rules.ts` (pure, time injected, no mutation):
    - `markUsedDecision(ticket, now)` → `{ ok: false, status: 409, code: "TICKET_EXPIRED" }` when `ticketStatus(ticket, now) === "EXPIRED"`; `{ ok: true, changed: false }` when already used (keeps the first `usedAt`); else `{ ok: true, changed: true, usedAt: iso(now), undoUntil: iso(now + 24 h) }`.
    - `undoUseDecision(ticket, now)` → unchanged when not used; `409 UNDO_WINDOW_CLOSED` when `now >= Date.parse(undoUntil)`; else `{ changed: true }` (caller clears `usedAt`/`undoUntil`, status recomputed by `ticketStatus`).
    - `codeIssueDecision(ticket, now)` → `409 TICKET_EXPIRED` when the recomputed status is EXPIRED; `409 CODE_ISSUE_ALREADY_OPEN` when `openIssue?.status === "OPEN"`; else ok.
    - `historyMonthSummary(rows, now)` → the Task 1.4 numbers for the Vietnam month of `now` (month key = `new Date(now + 7 h).toISOString().slice(0, 7)`; same for each row's `createdAt`).
  - [x] 2.2 `mocks/data/rewards.ts`:
    - Seed: add `category: v.category` to every seeded ticket and to the ticket built in `redeemVoucherQuote`; add `category` to `TicketRow`.
    - Seed `howToUse` per voucher with the Figma 24b steps: `["Gọi món như bình thường" + (terms include the 60.000đ rule ? ", hoá đơn từ 60.000đ." : "."), "Trước khi thanh toán, đưa QR hoặc đọc mã cho thu ngân.", "Thu ngân quét mã, trừ {valueVnd vi-VN}đ vào hoá đơn."]`. (Voucher detail on page 22 shows the same list; that's intended.)
    - New exported functions, each reading `rewardsState` once and writing with **one** `rewardsState.update` (same discipline as `redeemVoucherQuote`): `ticketsOf(userId, now)` (recompute every `status` with `ticketStatus(…, now)`; drop tickets whose `openIssue?.status === "REFUNDED"` (BR-22, refunded vouchers leave the list; 12.1 seed note); sort by `expiresAt` ascending; `{ items, total, serverTime }`), `ticketOf(userId, ticketId, now)` (refunded tickets **are** returned here, so a deep link still explains what happened), `markTicketUsed`, `undoTicketUse`, `reportCodeIssue(userId, ticketId, input, now)` (creates an `OPEN` `IssueRow` with `note: input.note?.trim() || null`, sets `ticket.openIssue = { id, status: "OPEN" }`, returns the report), `historyOf(userId, query, now)` (slice `offset..offset+limit`, `total`, `hasMore`, `monthSummary`).
    - No Admin resolution here (Story 12.5 queue UI, 12.10 backend). Reports stay `OPEN` in the mock.
  - [x] 2.3 `mocks/db/store.ts`: `SCHEMA_VERSION` 6 → 7 (seed shape changed) with a one-line history comment, like the previous bumps.
  - [x] 2.4 `mocks/handlers/rewards.ts`: add 6 handlers in the existing style (`applyScenario("rewards")` first, `userOfRequest`, `missingCsrf` on every POST, `safeParse` inputs, `respond`/`ok`/`fail`), each preceded by an `// ASSUMED API CONTRACT:` comment:
    | Route | Success | Errors |
    |---|---|---|
    | `GET /rewards/my-vouchers` | 200 `voucherTicketListSchema` | — |
    | `GET /rewards/my-vouchers/:id` | 200 `voucherTicketResponseSchema` | 404 `TICKET_NOT_FOUND` |
    | `POST /rewards/my-vouchers/:id/use` | 200 `voucherTicketResponseSchema` (idempotent: already used → current ticket) | 404, 409 `TICKET_EXPIRED` |
    | `POST /rewards/my-vouchers/:id/undo-use` | 200 `voucherTicketResponseSchema` (idempotent: not used → current ticket) | 404, 409 `UNDO_WINDOW_CLOSED` |
    | `POST /rewards/my-vouchers/:id/issues` body `createCodeIssueReportSchema` | 201 `codeIssueReportSchema` | 400 `VALIDATION_ERROR`, 404, 409 `TICKET_EXPIRED` / `CODE_ISSUE_ALREADY_OPEN` |
    | `GET /rewards/redemptions?limit&offset` | 200 `redemptionHistoryListSchema` | 400 `VALIDATION_ERROR` |
    MSW matches `/rewards/my-vouchers/:id` and `/rewards/redemptions/by-key/:key` independently of the GET history route; keep `GET /rewards/redemptions` as its own handler (no conflict with `POST /rewards/redemptions`).
  - [x] 2.5 `mocks/route-allowlist.ts`: add the 6 routes to `DEFERRED_KEEP_MOCK` with the existing reason string (`"rewards, Epic 12 (Phase 2; backend Stories 12.7-12.10)"`). Key format follows lines 39–44 (`"POST /rewards/my-vouchers/:id/use"`).
  - [x] 2.6 Counts 20 → 26: `tests/route-diff.test.mjs` (gate-G title and `DEFERRED_KEEP_MOCK: 26`) and `tests/hybrid-mocking.test.mjs` (title and `assert.equal(deferred.length, 26)`).
  - [x] 2.7 `tests/hybrid-mocking.test.mjs`: add one test next to the rewards test (line ~238), same helpers: list parses with `voucherTicketListSchema` and contains the 3 unused seed tickets; `use` without CSRF → 403; `use` → `USED` + `undoUntil`; `use` again → same `usedAt`; `undo-use` → back to `UNUSED`/`EXPIRING`; `issues` → 201 `OPEN`; second `issues` → 409 `CODE_ISSUE_ALREADY_OPEN`; `GET /rewards/redemptions?limit=2` parses, `hasMore === true`.
- [x] **Task 3: Client service + callsite gates** (AC: 1–5)
  - [x] 3.1 `lib/rewards/rewards-service.ts`: add `listMyVouchers(signal?)`, `getMyVoucher(ticketId, signal?)`, `markVoucherUsed(ticketId, signal?)`, `undoVoucherUse(ticketId, signal?)`, `reportCodeIssue(ticketId, input: CreateCodeIssueReportDto, signal?)`, `listRedemptionHistory(offset = 0, signal?)` (`limit` = exported `REDEMPTION_HISTORY_PAGE_SIZE = 20`). Every function starts with `if (PILOT_BUILD) rejectPilot();`; ids go through `encodeURIComponent`; POSTs use `method: "POST"` (CSRF is automatic in `apiRequest`); each passes its response schema.
  - [x] 3.2 `tests/helpers/frontend-callsites.mjs` `CALL_ALLOWLIST`: the 6 routes as `deferred-hidden` with note `"Voucher của tôi hidden in pilot (Epic 12 Phase 2, Story 12.4)"`. Use the `:param` form the helper expects (see the 12.3 entries: `"GET /rewards/vouchers/:param"`).
  - [x] 3.3 Run `node --test tests/contract-callsites.test.mjs tests/pilot-scope.test.mjs` early: after 12.3 both assert every deferred route has a caller, so all 6 must be called.
- [x] **Task 4: Pure view logic `lib/rewards/my-vouchers.ts`** (AC: 1–6)
  - [x] 4.1 `type VoucherTab = "unused" | "used" | "expired"`; `ticketTab(status)` (UNUSED/EXPIRING → unused); `ticketsByTab(items)` → `Record<VoucherTab, VoucherTicketDto[]>` sorted: unused by `expiresAt` asc (AC 1 "nearest expiry"), used by `usedAt` desc, expired by `expiresAt` desc. `unusedCount(items)` (the badge, AC 6). `parseVoucherTab(value: string | null)` → default `"unused"`.
  - [x] 4.2 `ticketTagView(ticket, nowMs)` → `{ tone, label }`: EXPIRING → danger "Còn {n} ngày" (`n = max(1, ceil((expiresAt − now)/day))`); UNUSED → green "Chưa dùng"; USED → neutral "Đã dùng"; EXPIRED → neutral "Hết hạn".
  - [x] 4.3 `ticketMetaLine(ticket, nowMs)`: UNUSED/EXPIRING "HSD {dd/MM/yyyy} · đổi hôm nay" (same Vietnam date via `vietnamDateKey`) or "· đổi ngày {dd/MM}"; USED "Đã dùng {dd/MM HH:mm}"; EXPIRED "Hết hạn {dd/MM/yyyy}". Use `lib/format/date-time.ts` + `formatFullDate`; no new date code.
  - [x] 4.4 `expiringNotice(items)` → `null` or "{n} voucher hết hạn trong 7 ngày. Rescom sẽ nhắc lại trước 1 ngày." (n = EXPIRING count); `myVouchersSubtitle(items)` → "{u} voucher chưa dùng" + (" · {n} voucher hết hạn trong 7 ngày" when n > 0) (desktop subtitle).
  - [x] 4.5 `canUndo(ticket, nowMs)` = USED && `undoUntil` && now < undoUntil; `undoLine(ticket)` → "Bạn có thể hoàn tác đến {HH:mm dd/MM}."; `canReportIssue(ticket)` = status !== EXPIRED && openIssue?.status not in {OPEN, REFUNDED}.
  - [x] 4.6 `CODE_ISSUE_REASON_LABELS: Record<CodeIssueReason, string>`: CODE_INVALID "Thu ngân báo mã không hợp lệ", CODE_ALREADY_USED "Mã báo đã được dùng", STORE_REFUSED "Cửa hàng không nhận voucher", OTHER "Lý do khác". `codeIssueStatusView(status)` → `{ tone, title, body }`: OPEN amber "Đang xử lý báo lỗi" / "Admin xử lý trong 1 ngày làm việc: đổi mã mới hoặc trả lại điểm."; REPLACED green "Đã đổi mã mới" / "Mã bên trên là mã mới, dùng như bình thường."; REFUNDED blue "Đã hoàn điểm" / "Điểm đã được trả lại vào Ví điểm. Voucher này không dùng được nữa."; REJECTED neutral "Mã vẫn dùng được" / "Admin đã kiểm tra, mã vẫn hợp lệ. Nếu cửa hàng vẫn từ chối, báo lại nhé."
  - [x] 4.7 `ticketActionErrorMessage(error: unknown)`: `ApiError` code TICKET_EXPIRED "Voucher đã hết hạn nên không đánh dấu hay báo lỗi được nữa."; UNDO_WINDOW_CLOSED "Đã quá 24 giờ nên không hoàn tác được nữa."; CODE_ISSUE_ALREADY_OPEN "Mã này đang được xử lý báo lỗi. Admin sẽ phản hồi trong 1 ngày làm việc."; anything else "Chưa lưu được. Thử lại nhé."
  - [x] 4.8 History: `historyRowView(entry)` → `{ icon, iconTone, title: "{brand} · {formatVnd(value)}", desktopTitle (+ " (Flash)" when `isFlash`), subline, points (signed: "−150", "0", "+200"; use the real minus sign U+2212 like Figma), pointsTone, status, statusTone }`. SUCCEEDED: `check`, green, "Thành công", subline "{Flash Sale · }{dd/MM HH:mm} · {reference}". FAILED: `x`, danger, "Thất bại · không trừ", subline "{Flash Sale · }{dd/MM HH:mm} · {note ?? FAILURE_SHORT[failureCode]}" with `FAILURE_SHORT` = SOLD_OUT "hết suất"/"hết hàng" (`isFlash`), PRICE_CHANGED "giá đã đổi", INSUFFICIENT_POINTS "không đủ điểm", VOUCHER_UNAVAILABLE "voucher tạm dừng", ACCOUNT_NOT_ELIGIBLE "chưa đủ điều kiện". REFUNDED: refund icon (Task 6.1), blue, "Đã hoàn điểm", subline "{dd/MM HH:mm} · {note ?? reference}". `monthSummaryLine(summary)` → `{ month: "Tháng 10/2026", line: "Đã dùng 375 điểm cho 3 voucher" }`, or line "Tháng này bạn chưa đổi voucher nào." when `voucherCount <= 0 && pointsSpent <= 0`.
  - [x] 4.9 `qrModules(text)` → `{ size, path }` using `encode(text, { ecc: "M", border: 0 })` from `uqr`; `path` is one SVG path string (`M{x} {y}h1v1h-1z` per dark module). No `dangerouslySetInnerHTML` anywhere.
  - [x] 4.10 Imports inside `lib/rewards/` use relative `.ts` paths (`../api/api-error.ts`) so `node --test` loads them; **no route literal** in this file (pilot-scope literal scan; hrefs live in the hidden `rewards/` dir).
- [x] **Task 5: Dependency `uqr`** (AC: 2)
  - [x] 5.1 Approved by Quan (2026-10-13): `uqr@^0.1.3` (MIT, zero dependencies, ESM, TS types). Add it to `apps/frontend/my-app` `dependencies`. The repo has **two** lockfiles (root workspace `package-lock.json` and `apps/frontend/my-app/package-lock.json`); both must resolve `uqr`. Check how `recharts` appears in both and follow that (for example `npm install uqr@^0.1.3 -w my-app` at the root, then `npm install --package-lock-only` inside `apps/frontend/my-app`). No other new dependency (that would be a HALT).
- [x] **Task 6: UI components (`app/(signed-in)/(app)/rewards/components/`)** (AC: 1–6)
  - [x] 6.1 Icons: export `Icon/history` and `Icon/refund` from Figma page 20 (`113:3`) into `public/icons/history.svg` and `public/icons/refund.svg`, same monochrome mask format as the existing icons. Fallback if the export fails: `clock` and `undo` (record it).
  - [x] 6.2 `VoucherTicketCard.tsx` (Figma `VoucherTicket`, instances `129:32`, `130:255`): a `Link` (whole card, ≥ 44 px target) with a left stub (`VoucherThumb size="sm"` on the brand tint, dashed divider, two notch circles at the divider top/bottom) and a body: brand (caption), "Voucher {formatVnd}" (bold), `ticketMetaLine`, the `Tag` from `ticketTagView` top-right, and the CTA text "Xem mã & QR" + `chevron-right` (USED/EXPIRED: "Xem lại mã" / "Xem chi tiết"). Props: `ticket`, `nowMs`, `href`. Status is always text (Tag), never color alone.
  - [x] 6.3 `VoucherQr.tsx`: `<svg role="img" aria-label="Mã QR của voucher" viewBox="0 0 {size} {size}" shape-rendering="crispEdges">` with the `qrModules` path, inside the white 226 px frame (200 px code, 13 px quiet zone, radius 16, `border-line`). Memoize on `code`.
  - [x] 6.4 `CodeIssueSheet.tsx`: `Dialog` with the 12.3 bottom-sheet-on-mobile classes (`width={480}`, `className="max-lg:mb-0 max-lg:w-full max-lg:rounded-b-none"`, drag handle `lg:hidden`). Title "Báo mã lỗi", subtitle "Admin xử lý trong 1 ngày làm việc: đổi mã mới hoặc trả lại điểm." A radio group of the 4 reasons (`components/ui/Radio.tsx`; none preselected), a `Textarea` "Mô tả thêm (không bắt buộc)" max 500 (counter), required (min 1 trimmed char) only when the reason is OTHER. Primary "Gửi báo lỗi" (`loading`, disabled until valid), text button "Huỷ". `dismissible={!submitting}`. Submit → `reportCodeIssue` → `onReported(report)`; an error shows `ticketActionErrorMessage` inline (`role="alert"`) and, for 409, also calls `onReload()`. Initial focus on the first radio; focus returns to "Báo mã lỗi" on close (`Dialog` does this when the opener keeps focus; verify).
  - [x] 6.5 `RedemptionHistory.tsx` (one component, two layouts):
    - Summary: mobile amber card (`bg-tone-amber-tint`): `month` (amber caption) + `line` (bold) — Figma `129:252`. Desktop card header: "Lịch sử đổi điểm" + right "Tháng 10: 375 điểm · 3 voucher" (amber) — Figma `130:331`.
    - Mobile list (Figma `129:256`): bordered card, rows with the 40 px tinted icon square, title (2 lines max), subline, right-aligned points (bold) + status text.
    - Desktop table (`lg:` only, Figma `130:334`): a real `<table>` with `<th scope="col">` Thời gian / Voucher / Mã giao dịch / Điểm / Trạng thái; status is a `Tag` (green "Thành công", danger "Thất bại · {short}", blue "Đã hoàn · {note short}") — use `historyRowView`.
    - Footer note: mobile "Lịch sử không sửa hay xoá được. Giao dịch đổi quà cũng hiện ở Ví điểm, mục Chi. Hoàn điểm là một giao dịch riêng, không xoá giao dịch gốc."; desktop "Lịch sử không sửa hay xoá được. Hoàn điểm là một giao dịch riêng (RFD-…) trỏ về giao dịch gốc."
    - Loading skeleton rows (no layout shift), Error (inline "Chưa tải được lịch sử." + "Thử lại"), Empty "Chưa có giao dịch đổi quà nào.", and "Xem thêm" (`Button variant="secondary"`, `loading`, failure text) when `hasMore`.
  - [x] 6.6 `MyVouchersScreen.tsx` (Figma 24 `129:2`, empty `129:309`, desktop `130:228`):
    - Mobile: `MobileBackBar title="Voucher của tôi" backHref="/rewards" action={<IconLink href="/rewards/history" icon="history" label="Lịch sử đổi điểm" />}` (desktop hides it; history is on the page).
    - Desktop: `h1` "Voucher của tôi" + `myVouchersSubtitle`; two columns `lg:grid-cols-[560px_1fr] gap-6`: tickets left, `<RedemptionHistory layout="desktop" />` right (card, `rounded-[20px]`).
    - `SegmentedControl variant="bordered" fullWidth label="Lọc voucher"` with "Chưa dùng ({n})", "Đã dùng ({n})", "Hết hạn ({n})". The tab lives in the URL (`?tab=used|expired`, `router.replace`, `scroll: false`) so Back from a ticket returns to the same tab; mirror `hooks/use-rewards-filters.ts`.
    - Unused tab: the `expiringNotice` box (danger tint, `clock` icon; plain text, **not** `role="alert"`) above the list.
    - List: `VoucherTicketCard`s, gap 12; mobile only: the "Lịch sử đổi điểm" link row (`history` icon, `chevron-right`) after the list (Figma `129:129`).
    - Empty, no tickets at all (Figma 24d): `search` mascot, "Bạn chưa có voucher nào", "Bạn đang có {available} điểm khả dụng, đủ đổi {n} voucher. Xem ngay nhé!" (when `n === 0`: "Làm khảo sát để kiếm thêm điểm rồi quay lại đổi quà nhé."), `ButtonLink` "Đổi quà ngay" → `/rewards`. `available`/`n` come from `listVouchers("affordable=true&limit=50")` fetched **only** while this state shows (the `suggestionsQuery` pattern in `RewardsScreen.tsx:108`): `viewer.available` and the count of items with `status === "AVAILABLE"` (the `affordable` filter alone also counts expired vouchers; with the seed that would say 5, Figma says 4). `// ponytail:` note: first 50 only.
    - Empty for one tab while others have tickets: short text in the list area: unused "Bạn không còn voucher chưa dùng.", used "Chưa có voucher nào được đánh dấu đã dùng.", expired "Không có voucher hết hạn."
    - Loading: 3 ticket skeletons at the final size (125 px); Error: `RewardsErrorState` with a new optional `title` prop ("Chưa tải được voucher của bạn"; default stays the 12.2 copy).
    - `nowMs`: `Date.now() + serverOffset(data.serverTime)` memoized on `data` (12.2 lesson: never a fresh `Date.now()` per render).
  - [x] 6.7 `VoucherTicketScreen.tsx` (Figma 24b `129:178`; no desktop frame → the same column centered at `max-w-[480px]`):
    - `MobileBackBar title="Dùng voucher" backHref="/rewards/my-vouchers"`; desktop: a back `Link` "Voucher của tôi" + `h1` "Dùng voucher".
    - Code card: brand header on the brand tint (`VoucherThumb`, brand, "Voucher {value}"); `VoucherQr`; the code (`font-mono`, 24 px, bold, letter-spaced, `select-all`); `Button variant="outline"` "Sao chép mã" with the `copy` icon → `copyTextToClipboard(ticket.code)`, polite `sr-only` "Đã sao chép mã" / visible `CLIPBOARD_COPY_FAILED_MESSAGE` (same pattern as `RedemptionSuccess`); caption "Dùng đến hết {formatFullDate(expiresAt)}." (shared code: prefix "Mã dùng chung. ").
    - EXPIRED: QR and code dimmed (`opacity-40`, `aria-hidden` on the QR), a neutral notice "Voucher đã hết hạn ngày {date}. Voucher hết hạn không được hoàn điểm." (BR-23); no copy, mark-used or report actions.
    - "Cách dùng tại cửa hàng": `howToUse` as numbered steps (green 24 px number circles) — Figma `129:213`.
    - Issue status: when `openIssue`, a `codeIssueStatusView` box (`role="status"`) above the actions. A ticket whose issue is REFUNDED shows only that box + the code dimmed (no actions).
    - Actions (UNUSED/EXPIRING): primary `Button` "Đánh dấu đã dùng" (`check` icon, full width, `loading`) → `markVoucherUsed` → `setData` with the returned ticket; on success move focus to the status line and announce "Đã đánh dấu đã dùng". USED: neutral status line "Đã dùng lúc {HH:mm dd/MM}" + (when `canUndo`) `Button variant="secondary"` "Hoàn tác" + `undoLine`. Then the text button "Báo mã lỗi" (`flag` icon) when `canReportIssue` → `CodeIssueSheet`; on `onReported`, `reload()` the ticket.
    - Footnote (Figma `129:242`): "“Đánh dấu đã dùng” chỉ để bạn dễ theo dõi, có thể hoàn tác trong 24 giờ. Mã lỗi được Admin xử lý trong 1 ngày làm việc: đổi mã mới hoặc trả lại điểm."
    - Action errors: `ticketActionErrorMessage` inline (`role="alert"`); on a 409 also `reload()` so the page shows the server's state. Buttons are disabled while a request runs (no double submit).
    - 404 `TICKET_NOT_FOUND`: "Không tìm thấy voucher" + `ButtonLink` "Về Voucher của tôi". Other load errors: `RewardsErrorState` with the Task 6.6 title.
    - Data: `useApiQuery(\`rewards-ticket:${ticketId}\`, …getMyVoucher)`; `nowMs` from `serverTime` as in 6.6 (undo window).
  - [x] 6.8 `RedemptionHistoryScreen.tsx`: `MobileBackBar title="Lịch sử đổi điểm" backHref="/rewards/my-vouchers"`, desktop `h1` + `<RedemptionHistory layout="desktop" />` full width (`max-w-[960px]`); mobile `<RedemptionHistory layout="mobile" />`. (`RedemptionHistory` may render both layouts with `lg:hidden`/`hidden lg:block` instead of a prop; pick the shorter.)
  - [x] 6.9 Hooks: `hooks/use-my-vouchers.ts` (`useApiQuery("rewards-my-vouchers", listMyVouchers)` + memoized `byTab`, `unused`, `nowMs`), `hooks/use-redemption-history.ts` (first page via `useApiQuery`, "Xem thêm" via `listRedemptionHistory(items.length)`, append, `loadingMore`, `loadMoreFailed`; mirror `use-rewards-catalog.ts` `loadMore`; abort on unmount).
- [x] **Task 7: Routes + pilot hiding** (AC: 1, 2, 5)
  - [x] 7.1 Pages (server components, `metadata` titles, `if (PILOT_BUILD) notFound();` inside the default export, same shape as `rewards/[id]/page.tsx`):
    - `app/(signed-in)/(app)/rewards/my-vouchers/page.tsx` → `MyVouchersScreen` ("Voucher của tôi | Rescom")
    - `app/(signed-in)/(app)/rewards/my-vouchers/[ticketId]/page.tsx` → `VoucherTicketScreen ticketId` ("Dùng voucher | Rescom"; `params: Promise<{ ticketId: string }>`)
    - `app/(signed-in)/(app)/rewards/history/page.tsx` → `RedemptionHistoryScreen` ("Lịch sử đổi điểm | Rescom")
    Static segments `my-vouchers` and `history` win over the sibling dynamic `rewards/[id]`; confirm in `node_modules/next/dist/docs/` (Next 16) before relying on it, and check in the browser that `/rewards/history` doesn't render the voucher detail.
  - [x] 7.2 `lib/pilot-scope.ts` `PILOT_HIDDEN_ROUTES`: add `/rewards/my-vouchers`, `/rewards/my-vouchers/[ticketId]`, `/rewards/history` with their guard files. `proxy.ts` matcher: add `"/rewards/my-vouchers"`, `"/rewards/my-vouchers/:ticketId"`, `"/rewards/history"` (the test compares the two lists exactly after normalizing).
- [x] **Task 8: Entry points (badge + 12.3 hand-off)** (AC: 2, 6)
  - [x] 8.1 `RewardsScreen.tsx` mobile header (Figma `120:13`): `MobileBackBar … action={…}` = an `IconLink href="/rewards/my-vouchers" icon="ticket"` with the count bubble (`bg-primary`, `h-5 min-w-5`, `text-[11px] font-bold text-white`, `-top-1 -right-1`; the same look as the filter count at lines 226–228; hidden when 0, "99+" above 99). Label: "Voucher của tôi, {n} chưa dùng" (or "Voucher của tôi" when 0), so the number is announced. Data: `useMyVouchers()`; while loading or on error show the icon without a bubble (never block the marketplace).
  - [x] 8.2 `RewardsScreen.tsx` desktop aside (Figma `122:436`), between `BalanceCard` and `FilterPanel`: a 50 px card link: `ticket` icon, "Voucher của tôi", the count (bold, hidden when 0), `chevron-right`.
  - [x] 8.3 `RedemptionSuccess.tsx` (12.3 deviations "12.4 adds these entry points"): replace the inline ticket summary card with `VoucherTicketCard` (`href` → `/rewards/my-vouchers/{ticket.id}`, `category` now from `ticket.category`, so drop the `voucher.category` use if nothing else needs it). Actions: primary `ButtonLink` "Dùng voucher ngay" → `/rewards/my-vouchers/{ticket.id}`; secondary "Tiếp tục đổi quà" → `/rewards` (check order and styles against Figma 23c `126:286` with `get_screenshot`).
  - [x] 8.4 `RedeemSheet.tsx` checking view, exhausted state only (Figma 23g "Mở Voucher của tôi"): add a text link "Mở Voucher của tôi" → `/rewards/my-vouchers` next to "Đóng". **Not** while polling (12.3 review: closing is blocked until the 3 polls finish).
- [x] **Task 9: Tests `tests/rewards-my-vouchers.test.mjs`** (AC: 1–6)
  - [x] 9.1 Pure lib (`await import("../lib/rewards/my-vouchers.ts")`): `ticketsByTab` grouping + the three sort orders (build tickets with shuffled dates); `unusedCount` = UNUSED + EXPIRING; `parseVoucherTab` default; `ticketTagView` "Còn 7 ngày" for now+7 d−1 h, "Còn 1 ngày" for now+2 h; `ticketMetaLine` "đổi hôm nay" vs "đổi ngày dd/MM" (a time near Vietnam midnight, UTC 17:00, so a UTC-date bug fails); `expiringNotice`/`myVouchersSubtitle`; `canUndo` true at undoUntil−1 ms, false at undoUntil; `canReportIssue` for EXPIRED, OPEN, REFUNDED, REJECTED; every `codeIssueStatusView` status has title + body; `ticketActionErrorMessage` for each code + fallback; `historyRowView` for SUCCEEDED (−150, "Thành công"), FAILED (0, "Thất bại · không trừ", Flash SOLD_OUT → "hết suất" when `note` is null), REFUNDED (+200); minus sign is U+2212; `monthSummaryLine` 375/3 and the ≤ 0 sentence; `qrModules("HLRC-7K2M-9QXA").size` equals `encode(...).size` and the path has one `h1v1h-1z` per dark module. Source guard: `lib/rewards/my-vouchers.ts` contains no `"/rewards` literal.
  - [x] 9.2 Mock rules (`await import("../mocks/data/rewards-rules.ts")`): `markUsedDecision` (expired → TICKET_EXPIRED; used → unchanged, same `usedAt`; unused → `undoUntil = usedAt + 24 h`); `undoUseDecision` (inside window → changed; at `undoUntil` → UNDO_WINDOW_CLOSED; not used → unchanged); `codeIssueDecision` (expired, open, ok); `historyMonthSummary` on Figma-like rows gives 375 / 3 and ignores last month's rows; a row at UTC 17:30 on the last day of the month counts in the **next** Vietnam month.
  - [x] 9.3 Every seeded ticket (demo user) parses with `voucherTicketSchema` and has `category`; `ticketsOf` drops a ticket whose `openIssue.status === "REFUNDED"` and `ticketOf` still returns it. (Follow `rewards-mock.test.mjs` for importing the mock data module and resetting the collection.)
  - [x] 9.4 No `test.skip`, `.only`, TODO stubs or placeholder assertions. No React Testing Library / Playwright (not installed; adding one is a HALT).
- [x] **Task 10: Verification**
  - [x] 10.1 `npm --prefix packages/schemas test && npm --prefix packages/schemas run typecheck`; `npm --prefix apps/backend run typecheck`.
  - [x] 10.2 `cd apps/frontend/my-app && npm test && npx tsc --noEmit && npm run lint`. Guard tests that must stay green: `pilot-scope`, `contract-callsites`, `route-diff`, `hybrid-mocking`, `no-direct-mocks`, `rewards-mock`, `rewards-ui`, `rewards-redeem`, `wallet-history`.
  - [x] 10.3 `NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled npm run build` succeeds (and `uqr` bundles).
  - [x] 10.4 Manual check (`NEXT_PUBLIC_API_MOCKING=enabled`, demo user 186/18; Claude in Chrome; 390 px via a same-origin iframe if the window can't be resized; force `document.hidden=false` as in 12.2) against Figma 24 (`129:2`, `129:178`, `129:243`, `129:309`, `130:228`) with `get_screenshot`:
    - `/rewards`: mobile header ticket icon shows 3; desktop aside "Voucher của tôi 3".
    - `/rewards/my-vouchers`: tabs "Chưa dùng (3) / Đã dùng (1) / Hết hạn (1)", order Gong Cha (Còn 7 ngày) → Highlands → Lotteria, expiring notice, desktop two columns with the history table.
    - Ticket Highlands: QR scans to `HLRC-7K2M-9QXA` (phone camera or any QR reader on the screenshot), copy works, steps render. Mark used → tab counts 2/2/1 after Back, badge 2; Hoàn tác → 3/1/1. Expired ticket: no actions, dimmed code.
    - Báo mã lỗi: OTHER without a note keeps "Gửi báo lỗi" disabled; submit CODE_INVALID → OPEN status box, button gone; a second report via the API returns 409 (covered by the hybrid test).
    - `/rewards/history` mobile + desktop: summary, SUCCEEDED/FAILED/REFUNDED rows, "Xem thêm" absent with the 8 seed rows (page size 20).
    - Redeem Lotteria from `/rewards/2…` → success shows the ticket card and "Dùng voucher ngay" opens its code page; `/rewards/my-vouchers` lists it.
    - Empty state: clear the demo user's tickets (devtools: `localStorage` mock store, or a fresh hybrid user) → 24d copy with "đủ đổi 4 voucher".
    - Keyboard: tabs with arrows, card links, sheet focus trap/Escape/focus return; screen reader names for the badge link and the QR.
    - Record results and any Figma delta in Completion Notes, including what was not exercised.

## Dev Notes

### Scope boundaries (read first)

- **In:** Voucher của tôi (list, tabs, empty, expiring notice), the ticket page (code, QR, copy, steps, expiry, mark used + 24 h undo, code-issue report + its status), redemption history (mobile page + desktop column/table), the unused-count badge on Đổi quà, the 12.3 hand-off links, the mock routes and rules for all of it, and additive contract changes.
- **Out:**
  - Expiry reminders (7 days / 1 day) and their notifications: Story 12.10 (backend). The UI only shows the "Rescom sẽ nhắc lại trước 1 ngày" copy.
  - Admin queue and resolution of reports (replacement code / refund): Stories 12.5 (UI) and 12.10 (backend). Mock reports stay OPEN.
  - Linking a history row to its wallet ledger entry (FR-70 "each links to its ledger entry"): the wallet page has no deep link target; `journalId` is kept in the contract. Record as a deviation.
  - Screen brightness (Figma 24b "Màn hình tự tăng độ sáng khi mở mã"): the web can't control brightness; drop that sentence.
  - The voucher terms footnote on 24b ("Không đổi thành tiền mặt; …"): the ticket contract has no `terms`; drop it (deviation).
  - Any backend (12.7–12.10) and the real feature flag (12.11).
- **Gates:** FE-mock only, behind `PILOT_BUILD` (service self-gate + page guard + proxy 404).
- **Contract status:** extends the Story 12.1 **ASSUMED API CONTRACT**. The additions (Task 1) are additive; the only changed shapes are `voucherTicketSchema` (+`category`) and `redemptionHistoryListSchema` (+`monthSummary`), both unused by the backend today. Story 12.10 must implement them.

### Contract and mock behaviour

| Call | Response | Mock rule |
|---|---|---|
| `GET /rewards/my-vouchers` | `voucherTicketListSchema` | status recomputed at `now`; REFUNDED-issue tickets dropped; sorted `expiresAt` asc |
| `GET /rewards/my-vouchers/:id` | `voucherTicketResponseSchema` | 404 `TICKET_NOT_FOUND` (other users' tickets too) |
| `POST …/:id/use` | same | expired → 409; idempotent |
| `POST …/:id/undo-use` | same | `now >= undoUntil` → 409 `UNDO_WINDOW_CLOSED`; idempotent |
| `POST …/:id/issues` | 201 `codeIssueReportSchema` | expired → 409 `TICKET_EXPIRED`; open report → 409 `CODE_ISSUE_ALREADY_OPEN` |
| `GET /rewards/redemptions?limit&offset` | `redemptionHistoryListSchema` | newest first; `monthSummary` for the Vietnam month |

- Ticket statuses are computed by the server at `serverTime` (`EXPIRING` = unused and ≤ 7 days left; `ticketStatus` in `rewards-rules.ts`). The client never recomputes a status; it uses server time only for display (days left, "hôm nay", undo window).
- Mark used is a user convenience flag (Figma 24b footnote, OQ-25 default), not a money operation: no `Idempotency-Key`, idempotent by state. CSRF still applies (POST).
- Seed (12.1): demo user tickets Gong Cha `RDM-2610-1MZ4` (EXPIRING), Highlands `RDM-2610-8F2K` (Flash), Lotteria `RDM-2610-3QK7`, Phúc Long `RDM-2609-2PLB` (USED 18 days ago → undo closed), Highlands 20k `RDM-2608-6HCX` (EXPIRED); history 8 rows incl. FAILED `RDM-2610-4KF1` (KFC Flash SOLD_OUT, note "Flash Sale · hết suất") and REFUNDED `RFD-2610-7HC2`; one REFUNDED report on a ticket that is not in the list. Mock users: `user-active-002` and the hybrid member `…d001`.

### Architecture rules that bind the UI

- **No client-side money logic.** Points shown in history and the month summary come from the server. The empty-state "đủ đổi N voucher" counts the server's `affordable` + `AVAILABLE` flags; it never compares prices.
- **Refund is a separate transaction** (BR-22, AD-24 reversal journal): history shows the original SUCCEEDED row and a separate REFUNDED row; nothing is edited or removed.
- **Expired unused vouchers are not refunded** (BR-23): no report/refund action on EXPIRED tickets.
- **Redeemed vouchers stay visible** even if the catalog voucher is hidden/archived (BR-10): the ticket page reads only the ticket, never `/rewards/vouchers/:id`.
- **Server time** for "today", days left and the undo window (`serverOffset`, `lib/format/date-time.ts` Vietnam helpers).
- **Status as text**: tags and status lines always have words; the QR has an accessible name; the code is real text (selectable, copyable).

### Existing code to reuse (do not reinvent)

| Need | Use |
|---|---|
| HTTP, CSRF, errors | `lib/api/client.ts` `apiRequest`; `lib/api/api-error.ts` `ApiError`, `isApiError` |
| Queries, reload, local update | `lib/api/use-api-query.ts` `useApiQuery` (`data`, `error`, `loading`, `reload`, `setData`) |
| Load more | `rewards/hooks/use-rewards-catalog.ts` `loadMore`; wallet `TransactionHistory.tsx` `LoadMore` |
| Server clock | `lib/rewards/server-clock.ts` `serverOffset` |
| Dates/format | `lib/format/date-time.ts` (`formatTime`, `formatDayMonth`, `formatShortDateTime`, `vietnamDateKey`, `vietnamDateTimeParts`); `lib/rewards/voucher-display.ts` (`formatFullDate`, `formatPoints`, `formatVnd`, `brandTintClass`) |
| Header with action | `components/layout/app/MobileTopBar.tsx` `MobileBackBar` (`action`, `backHref`) |
| Icon link | `components/ui/IconButton.tsx` exports `IconLink` (`href`, `icon`, `label`, `children` for the badge) |
| Tabs | `components/ui/SegmentedControl.tsx` (`variant="bordered"`, `fullWidth`, radio-group keyboard model) |
| Tag, Button/ButtonLink, Dialog, Radio, Textarea, Spinner | `components/ui/*` |
| Sheet styling | 12.3 `RedeemSheet.tsx` (Dialog className + handle) |
| Thumb | `rewards/components/VoucherThumb.tsx` (`brand`, `category`, `size="sm"`) |
| Clipboard + announce | `lib/clipboard.ts` `copyTextToClipboard`, `CLIPBOARD_COPY_FAILED_MESSAGE`; pattern in `RedemptionSuccess.tsx` |
| Error / empty states | `RewardsErrorState.tsx` (+ optional `title`), mascots `public/brand/mascots/search.svg`, `offline.svg` |
| Icons | existing: `ticket`, `copy`, `flag`, `check`, `x`, `clock`, `chevron-right`, `chevron-left`, `undo`, `qr-code`; new: `history`, `refund` (Task 6.1) |

### Files

**NEW**
- `apps/frontend/my-app/lib/rewards/my-vouchers.ts`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/my-vouchers/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/my-vouchers/[ticketId]/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/history/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/{MyVouchersScreen,VoucherTicketCard,VoucherTicketScreen,VoucherQr,CodeIssueSheet,RedemptionHistory,RedemptionHistoryScreen}.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/{use-my-vouchers,use-redemption-history}.ts`
- `apps/frontend/my-app/public/icons/{history,refund}.svg`
- `apps/frontend/my-app/tests/rewards-my-vouchers.test.mjs`

**UPDATE** (read each whole file first; preserve everything not listed)

| File | Today | Change | Must preserve |
|---|---|---|---|
| `packages/schemas/src/rewards/redemption.schema.ts` | 12.1 schemas + 12.3 type exports | Task 1 additions | every existing schema/refinement |
| `packages/schemas/src/rewards/redemption.schema.spec.ts` | 12.1 cases | fixtures + new cases | existing cases |
| `apps/frontend/my-app/mocks/data/rewards-rules.ts` | pricing/redeem rules, `ticketStatus` | + 4 pure rules | existing rules |
| `apps/frontend/my-app/mocks/data/rewards.ts` | seed, quote/redeem/by-key | + `category`, `howToUse` seed, 6 functions | redeem/idempotency behavior, one update per collection |
| `apps/frontend/my-app/mocks/handlers/rewards.ts` | 6 routes | + 6 routes | existing handlers, scenario handling |
| `apps/frontend/my-app/mocks/route-allowlist.ts` | DEFERRED_KEEP_MOCK 20 | 26 | other entries |
| `apps/frontend/my-app/mocks/db/store.ts` | `SCHEMA_VERSION = 6` | 7 | everything else |
| `apps/frontend/my-app/lib/rewards/rewards-service.ts` | 6 functions | + 6 | pilot guard, existing functions |
| `apps/frontend/my-app/lib/pilot-scope.ts`, `proxy.ts` | 13 hidden routes | + 3 | order/comments |
| `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RewardsScreen.tsx` | no Voucher của tôi entry | header badge + desktop aside link | search/filter/pagination behavior |
| `…/rewards/components/RewardsErrorState.tsx` | fixed title | optional `title` prop | default copy |
| `…/rewards/components/RedemptionSuccess.tsx` | inline ticket card, 1 action | `VoucherTicketCard` + "Dùng voucher ngay" | tween, confetti, focus, copy reference |
| `…/rewards/components/RedeemSheet.tsx` | exhausted: Kiểm tra lại + Đóng | + "Mở Voucher của tôi" link | polling close block, everything else |
| `apps/frontend/my-app/tests/helpers/frontend-callsites.mjs` | 6 rewards entries | + 6 | others |
| `apps/frontend/my-app/tests/route-diff.test.mjs`, `tests/hybrid-mocking.test.mjs` | count 20 | 26 (+ hybrid test, Task 2.7) | other tests |
| `apps/frontend/my-app/package.json` + both lockfiles | no QR lib | + `uqr` | — |

Split a component only if it passes ~300 lines.

### Deviations from Figma (deliberate, record in Completion Notes)

| Figma | This story | Why |
|---|---|---|
| 24b "Màn hình tự tăng độ sáng khi mở mã" | dropped | browsers can't change brightness |
| 24b terms line under the steps | dropped | the ticket contract has no `terms`; the voucher may be archived (BR-10) |
| No "Báo mã lỗi" sheet frame | `CodeIssueSheet` in the 12.3 sheet style | AC 4 needs it; reasons from the 12.1 enum |
| No Used / Expired / undo / issue-status frames | states built from page 24 tokens | AC 3 and AC 4 need them |
| Desktop history status "Thất bại · hết suất", mobile "Thất bại · không trừ" | the reason goes in the subline/Tag per `historyRowView` | one helper for both layouts |
| History row → ledger link (FR-70) | not linked | no wallet deep-link target |
| 24b without TabBar | the `(app)` layout keeps the BottomNav | layout is shared; no new layout in this story |

### Gotchas checklist

1. **Pilot literal scan** (`tests/pilot-scope.test.mjs`): `/rewards…` literals are allowed only inside the hidden `app/(signed-in)/(app)/rewards/` dir or in a function that checks `PILOT_BUILD`. `lib/rewards/my-vouchers.ts` holds no route literal. `lib/rewards/rewards-service.ts` literals are guarded per function.
2. **Every deferred route needs a caller** (12.3 changed both callsite tests to strict equality). Add the service function, the `CALL_ALLOWLIST` entry and the `DEFERRED_KEEP_MOCK` entry together.
3. **Route literal format differs**: allowlist/handlers use `:id`, `CALL_ALLOWLIST` uses `:param`, pilot routes use `[ticketId]`, the proxy uses `:ticketId`.
4. **`useApiQuery` clears `data` on a new key**; the ticket page keys on `ticketId` only, so `setData` after an action keeps the page stable.
5. **Hooks before early returns** in every screen (loading/error/not-found returns).
6. **Mobile header badge must not block the marketplace**: a failed `listMyVouchers` hides the bubble; it never shows `RewardsErrorState` on `/rewards`.
7. **`apiRequest` throws `AbortError` on abort** — treat as "stop", not as an error message.
8. **Vietnam dates**: use the helpers; tests include a UTC-17:00 case.
9. **Next 16**: three new `page.tsx` files; read the routing doc in `node_modules/next/dist/docs/` first (static vs dynamic sibling precedence, async `params`).
10. **Mock persistence**: the seed shape changed → bump `SCHEMA_VERSION`, or old localStorage data lacks `category` and fails the schema parse.
11. **`?msw=` scenarios persist in localStorage** until `?msw=default` (12.2 note); `rewards-*` scenarios only force redeem errors, not the new routes, but `api-error`/`api-offline` hit every Rewards route — use them for the error states.

### Testing standards

- `node --test tests/*.test.mjs` (`npm test` builds `@rescom/schemas` first). Import pure TS directly. Mock data/rules are importable the same way (`rewards-mock.test.mjs`).
- Components are covered by the pure helpers, the hybrid handler test and the manual check (Task 10.4).

### Project Structure Notes

- Routes under the existing hidden `rewards/` folder; components in `rewards/components/`, hooks in `rewards/hooks/`, pure logic in `lib/rewards/`.
- Exports use `voucher*` / `redemption*` / `codeIssue*` / `myVoucher*` names, never bare `reward*` (12.1 collision rule).

### Previous story intelligence (12.3, done; PR #19 open, not merged)

- This branch (`feat/12-4-my-vouchers-code-qr-history`) was created from `feat/12-3-confirm-redemption-result` @ `54f1067` because PR #19 is not merged into `develop` yet. Rebase onto `origin/develop` after #19 merges.
- 12.3 left the hand-off: no "Dùng voucher ngay" / "Xem mã & QR" / "Mở Voucher của tôi" until this story (Task 8.3, 8.4).
- 12.3 code style in `rewards/`: compact JSX, Dialog-based sheet, pure helpers in `lib/rewards/*.ts` with relative imports, source-guard tests.
- 12.3 review lessons: format numbers with `formatPoints`; a click may not focus the button on Safari/Firefox macOS (don't rely on `document.activeElement` as the opener); test the exact copy/code, not just existence.
- 12.2 lessons: memoize anything derived from `serverTime`; don't remount live regions with `key`; abort/stale-guard effect fetches; record the manual check honestly.
- Automation-browser notes: hidden tabs pause timers (force `document.hidden=false`), the window can't be resized (390 px via an injected same-origin iframe), frames render only during screenshots.

### Git intelligence

- `54f1067` Story 12.3 (redeem flow, `RedemptionSuccess`, `RedeemSheet`, `redeem-flow.ts`, callsite test strictness); `3c5b142` Story 12.2 (marketplace, detail, `SegmentedControl`/`Toggle`/`Countdown`, `use-rewards-*` hooks); `cecbb0e` Story 12.1 (contracts, MSW domain, seed tickets/history/report, route allowlist).

### Latest tech information

- `uqr` 0.1.3 (npm, MIT, zero dependencies, ESM, tree-shakable): `encode(text, { ecc, border })` → `{ data: boolean[][], size, version }`. Render the matrix ourselves as one SVG path; don't use `renderSVG` + `innerHTML`.
- Next 16.3 / React 19.2 per `package.json`; read `node_modules/next/dist/docs/` before adding pages (project `AGENTS.md`).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 intro, Story 12.4, Story 12.5 (Admin queue), Story 12.10 (backend for this story)]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-13.md` FR-70, FR-75, Open Question 25; BR-10, BR-22, BR-23]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` AD-24 (refund via reversal journal)]
- [Source: `_bmad-output/implementation-artifacts/12-1-rewards-contracts-msw-mock-domain.md` §B contract table (ticket, history, code-issue), Seed (tickets/history/report)]
- [Source: `_bmad-output/implementation-artifacts/12-3-confirm-redemption-result.md` Deviations (12.4 entry points), Review Findings, Gotchas]
- [Source: Figma `mkudD5Ngi5RPyIAVxCcxXi` page 24 `113:7`: list `129:2`, ticket/code `129:178`, history `129:243`, empty `129:309`, desktop `130:228`; page 21 `113:4`: mobile header badge `120:13`, desktop aside link `122:436`; page 23 `113:6`: success `126:286`, checking `127:653`; page 20 `113:3`: `VoucherTicket`, `Icon/history`, `Icon/refund`]
- [Source: `apps/frontend/my-app/mocks/data/rewards.ts`, `mocks/data/rewards-rules.ts`, `mocks/handlers/rewards.ts`, `mocks/route-allowlist.ts`, `lib/pilot-scope.ts`, `proxy.ts`, `tests/pilot-scope.test.mjs`, `tests/contract-callsites.test.mjs`, `tests/helpers/frontend-callsites.mjs`]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (lead: story, review, browser check, fixes) + 2 executor subagents on Claude Sonnet 5.5 (data layer: Tasks 1–3, 5, 9.2–9.3; UI layer: Tasks 4, 6–8, 9.1).

### Debug Log References

- `npm --prefix packages/schemas test` 630 passed; `run typecheck` clean. `npm --prefix apps/backend run typecheck` clean.
- `apps/frontend/my-app`: `npm test` 832/832; `npx tsc --noEmit` clean; `npm run lint` clean; `NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled npm run build` succeeded (`/rewards/history`, `/rewards/my-vouchers` static; `/rewards/my-vouchers/[ticketId]` dynamic next to `/rewards/[id]`).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- QR dependency decision (Quan, 2026-10-13): `uqr@^0.1.3`.
- Implemented: contract additions (ticket `category`, `voucherTicketResponseSchema`, `redemptionHistoryQuerySchema`, `monthSummary`, `VOUCHER_TICKET_ERROR_CODES`, types); 6 mock routes + 4 pure rules; 6 self-gated service functions; `lib/rewards/my-vouchers.ts`; Voucher của tôi (tabs in `?tab=`, expiring notice, empty state), ticket page (QR via `uqr` rendered as one SVG path, copy, steps, mark used/undo, code-issue sheet + status), history (mobile list, desktop table, month summary, load more); header badge + desktop aside link; 12.3 hand-off ("Dùng voucher ngay", ticket card on success, "Mở Voucher của tôi" when polling is exhausted); 3 pilot-hidden routes in `PILOT_HIDDEN_ROUTES` and `proxy.ts`.
- Fixed during the browser check: (1) the mock session gives the demo account (minh.le) a generated id, so the 12.1 seed keyed `user-active-002` never reached it and Voucher của tôi was empty; added `claimDemoRewards(user)` (same email rule as `seedWallet`), called from the handlers' `userOfRequest`, with a test. (2) Desktop history table wrapped time/reference cells; added `whitespace-nowrap`. (3) Desktop aside link announced "Voucher của tôi3"; the count now reads ", 3 chưa dùng" to screen readers.
- Deviations from spec: `nowMs` = `Date.parse(serverTime)` memoized on the response (lint `react-hooks/purity` forbids `Date.now()` in `useMemo`; the server enforces the undo window). Root `package-lock.json` unchanged: the root workspace resolves `apps/frontend`, not `my-app`, and `recharts` is likewise only in `apps/frontend/my-app/package-lock.json`. `historyRowView` strips a leading "Flash Sale · " from the FAILED note (seed note already contains it). `RedemptionHistory` renders both layouts with CSS (no `layout` prop), so mobile My Vouchers also fetches page 1 of history once. The empty state shows "Xem các voucher đang có để đổi nhé." until the affordable query returns.
- Figma deltas (in addition to Dev Notes → Deviations): 24d shows the tabs with "(0)" counts and a full-width "Đổi quà ngay"; the build hides the tabs in the no-tickets state and uses an auto-width button. The VoucherTicket notch circles are not visible at 1× (stub + tint render).
- Manual check 10.4 (Claude in Chrome, `NEXT_PUBLIC_API_MOCKING=enabled`, minh.le 186/18, 921 px window = mobile layout, desktop via a 1440 px same-origin iframe): `/rewards` badge 3 with label "Voucher của tôi, 3 chưa dùng"; desktop aside "Voucher của tôi 3"; list order Gong Cha (Còn 7 ngày) → Highlands (đổi hôm nay) → Lotteria, notice, tabs 3/1/1; desktop two columns + table, month summary "375 điểm · 3 voucher" matches Figma; Highlands QR decoded with the browser `BarcodeDetector` to `HLRC-7K2M-9QXA`; mark used → "Đã dùng lúc … · Hoàn tác đến …", API status USED; Hoàn tác → back to unused; Báo mã lỗi: OTHER without note keeps "Gửi báo lỗi" disabled, CODE_INVALID → "Đang xử lý báo lỗi" box and the button disappears; expired ticket dimmed, BR-23 notice, no actions; `/rewards/history` mobile shows 8 rows (SUCCEEDED/FAILED/REFUNDED) and no "Xem thêm"; redeem Lotteria (mock) → success shows the ticket card + "Dùng voucher ngay" → its code page (`LOTT-1000-2000`); `?tab=used` restores the Used tab; empty state (tickets cleared in the mock store, then restored) "Bạn đang có 96 điểm khả dụng, đủ đổi 1 voucher"; no console errors.
- Not exercised: a phone-camera scan (decoded in-browser instead); keyboard arrows on the tabs, sheet Escape and focus return to "Báo mã lỗi"; the 409 reload paths in the UI (covered by the hybrid test at API level); "Mở Voucher của tôi" in the exhausted checking state; `api-error`/`api-offline` error states of the new pages; reduced motion (no new motion added).

### File List

- `_bmad-output/implementation-artifacts/12-4-my-vouchers-code-qr-history.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/schemas/src/rewards/redemption.schema.ts`
- `packages/schemas/src/rewards/redemption.schema.spec.ts`
- `apps/frontend/my-app/package.json`
- `apps/frontend/my-app/package-lock.json`
- `apps/frontend/my-app/proxy.ts`
- `apps/frontend/my-app/lib/pilot-scope.ts`
- `apps/frontend/my-app/lib/rewards/rewards-service.ts`
- `apps/frontend/my-app/lib/rewards/my-vouchers.ts` (new)
- `apps/frontend/my-app/mocks/data/rewards-rules.ts`
- `apps/frontend/my-app/mocks/data/rewards.ts`
- `apps/frontend/my-app/mocks/db/store.ts`
- `apps/frontend/my-app/mocks/handlers/rewards.ts`
- `apps/frontend/my-app/mocks/route-allowlist.ts`
- `apps/frontend/my-app/public/icons/history.svg` (new)
- `apps/frontend/my-app/public/icons/refund.svg` (new)
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/my-vouchers/page.tsx` (new)
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/my-vouchers/[ticketId]/page.tsx` (new)
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/history/page.tsx` (new)
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/CodeIssueSheet.tsx` (new)
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/MyVouchersScreen.tsx` (new)
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RedemptionHistory.tsx` (new)
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RedemptionHistoryScreen.tsx` (new)
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/VoucherQr.tsx` (new)
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/VoucherTicketCard.tsx` (new)
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/VoucherTicketScreen.tsx` (new)
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RedeemSheet.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RedemptionSuccess.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RewardsErrorState.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/RewardsScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/components/VoucherDetailScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-my-vouchers.ts` (new)
- `apps/frontend/my-app/app/(signed-in)/(app)/rewards/hooks/use-redemption-history.ts` (new)
- `apps/frontend/my-app/tests/rewards-my-vouchers.test.mjs` (new)
- `apps/frontend/my-app/tests/helpers/frontend-callsites.mjs`
- `apps/frontend/my-app/tests/hybrid-mocking.test.mjs`
- `apps/frontend/my-app/tests/route-diff.test.mjs`

### Change Log

- 2026-10-13: Story created (ready-for-dev).
- 2026-10-13: Implemented Story 12.4 (contracts, mock routes/rules, service, My Vouchers, ticket code/QR, mark used/undo, code-issue report, history, badge, 12.3 hand-off); added `uqr`. Browser check run; fixed demo-user seed claim, desktop table wrapping and the aside link label. `npm test` 832/832, tsc, lint, pilot build pass. Status → review.
- 2026-10-13: Code review fixes (7 of 10 findings). QR has a 4-module quiet zone and whole-pixel modules. `TICKET_NOT_FOUND` and new 409 `TICKET_REFUNDED` have copy; the mock rejects mark used, undo and report on a refunded ticket (`VOUCHER_TICKET_ERROR_CODES` extended). Ticket page and My Vouchers use the ticking `useServerNow` clock, so Hoàn tác hides when the undo window closes. Empty FAILED notes fall back to the short reason. The month summary clamps negative values. The desktop history panel mounts only at lg. Deferred: marketplace badge fetches the full ticket list (backend should return a count), `claimDemoRewards` duplicates the demo-account predicate, `howToUse` sniffs `terms` text. `npm test` 833/833, schemas 630/630, tsc, lint pass.
- 2026-10-13: PR #20 merged into develop. Status → done.
