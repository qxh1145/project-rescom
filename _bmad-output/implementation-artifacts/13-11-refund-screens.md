---
baseline_commit: edbac15
---
# Story 13.11: Refund Screens

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a User,
I want a clear refund form and status,
so that I know what will happen to my Points and money.

## Acceptance Criteria

1. **Refund section on the detail (A4).** Given a PayOS top-up opened at `/wallet/top-up/:id` (Figma `184:2338` desktop / `184:1767` mobile), when `status = SUCCESSFUL` or `refund.request != null`, a "Hoàn tiền" card renders (desktop: right column next to info table + timeline; mobile: below the timeline). It is driven only by the server DTO (`refundDeadline`, `refund.canRequest`, `refund.unavailableReason`, `refund.request`):
   - `canRequest = true` → copy "Bạn có thể yêu cầu hoàn {amount} đến {HH:mm} ngày {dd/MM/yyyy}, nếu chưa tiêu Điểm nào kể từ lúc nạp. Tiền hoàn về đúng tài khoản đã thanh toán ({bank} · {accountNumber}). Mỗi giao dịch chỉ gửi 1 lần." (when `refund.destination` is unverified: "…về đúng tài khoản đã thanh toán; Admin sẽ xác minh qua email trước khi chuyển."), a countdown chip "Còn N giờ" / "Còn N phút" computed from the server `refundDeadline` (re-evaluated every 60 s), and CTA "Yêu cầu hoàn tiền" (UX-DR-P6, P23).
   - When the countdown reaches 0 on the client, the CTA disables at once and shows the `DEADLINE_PASSED` copy; the server stays the authority (a late submit gets 409 and the page reloads).
   - `canRequest = false` and no request → the CTA is not offered and the card shows the reason (copy in Dev Notes "Unavailable copy"): `DEADLINE_PASSED` (Figma `184:2899`), `MISMATCH_CREDITED`, `WITHDRAWN`, `ALREADY_REQUESTED`. `NOT_SUCCESSFUL` renders no card (Processing/Cancelled/Expired/Mismatch/Manual-refunded keep the 13.7 screens unchanged).
   - Legacy manual: the manual top-up detail (`TransferScreen` for an `APPROVED` manual row) shows a read-only "Hoàn tiền" card with the `LEGACY_MANUAL` copy (Figma `184:3002`). Nothing else changes on manual screens.
2. **Refund form (A4 form, A4 unverified).** "Yêu cầu hoàn tiền" expands the form in the same card (Figma `184:2443`, `196:3588`). It shows a read-only locked block from `refund.destination`: "Tài khoản nhận hoàn tiền" (bank glyph placeholder, `{bankName ?? "Mã ngân hàng " + bankId} · {accountNumber}` — **full number, not masked** (Owner decision 2026-10-16), holder name) with the caption "Tiền được hoàn về đúng tài khoản đã thanh toán. Không thể đổi tài khoản nhận.", plus a read-only line with the session email. If the destination is unverified (see Dev Notes "Destination before submit"), the account block is replaced by the amber notice "Chưa lấy được thông tin tài khoản đã thanh toán. Admin sẽ liên hệ qua email {email} để xác minh trước khi hoàn tiền." and submitting stays allowed (UX-DR-P7).
   - The user only picks a reason (4 radio cards in order: Nạp nhầm số tiền · Nạp nhầm tài khoản Rescom · Không còn nhu cầu dùng Điểm · Lý do khác → `WRONG_AMOUNT|WRONG_ACCOUNT|NO_LONGER_NEEDED|OTHER`) and writes a note (required for every reason, trimmed 1–300, counter "N/300", hint "Bắt buộc với mọi lý do · tối đa 300 ký tự.").
   - Info callout: "Nếu hợp lệ, {points} Điểm sẽ bị giữ và không thể sử dụng cho tới khi Admin xử lý (tối đa 3 ngày làm việc). Chỉ hợp lệ nếu bạn chưa tiêu Điểm nào kể từ lúc nạp."
   - Buttons "Huỷ" (collapses the form, keeps nothing) and "Gửi yêu cầu".
   - Validation (Figma `184:2755`), only for reason and note: no reason → "Chọn một lý do hoàn tiền."; empty/whitespace note → "Nhập ghi chú cho Admin (tối đa 300 ký tự)."; > 300 → "Tối đa 300 ký tự — hãy rút gọn N ký tự." Errors use `aria-describedby` + `role="alert"`; focus moves to the first invalid field. A server `VALIDATION_ERROR` maps to the same slots.
3. **Confirm dialog (A5).** A valid "Gửi yêu cầu" opens a dialog (Figma `186:2339`, submitting `186:2554`): title "Gửi yêu cầu hoàn {amount}?", subtitle "Giao dịch #{orderCode} · nạp {dd/MM HH:mm}", rows: hold explanation ("Nếu hợp lệ, {points} Điểm chuyển sang “Giữ chờ hoàn tiền” và không dùng được cho tới khi Admin xử lý (tối đa 3 ngày làm việc)."), destination ("Hoàn {amount} về {bank} · {accountNumber} — đúng tài khoản đã thanh toán lần nạp này." or, unverified, "Admin sẽ xác minh tài khoản nhận qua email {email} trước khi chuyển."), the once-only warning ("Mỗi giao dịch chỉ gửi 1 lần. Nếu bị từ chối, bạn không gửi lại được."), and "Lý do: {label}." Buttons "Huỷ" / "Gửi yêu cầu". While submitting the button shows loading and the line "Đang kiểm tra điều kiện và gửi yêu cầu… Không đóng cửa sổ."; the dialog is not dismissible and the submit cannot double-fire (UX-DR-P8).
4. **Result (A6).** On 200 `{ request }`, the page shows the result view (Figma `186:2756` / `186:2897`; in-page state on the same route, no URL change):
   - `ELIGIBLE`: shield mascot, chip "Đang yêu cầu hoàn tiền", title "Đã gửi yêu cầu hoàn tiền", "{points} Điểm đang được giữ chờ hoàn tiền.", rows Mã giao dịch · Số tiền hoàn · Điểm đang giữ · Hoàn về tài khoản đã thanh toán (or "Admin xác minh qua email") · Dự kiến xử lý "Trước {dd/MM/yyyy}", footnote "3 ngày làm việc. Khả dụng còn {available} Điểm. Nếu Admin từ chối, {points} Điểm sẽ trả lại Khả dụng." Buttons "Xem giao dịch" (back to the detail, now in A7) and "Về ví".
   - `NOT_ELIGIBLE`: confused mascot, title "Đã ghi nhận yêu cầu", body per `ineligibleReason` (Dev Notes "Ineligible copy"), rows Mã giao dịch · Điểm đang giữ "0 Điểm (không giữ)" · Dự kiến phản hồi "Trước {date}", footnote "Số dư của bạn không thay đổi." The `SPENT_SINCE_TOP_UP` copy states that a voucher redemption that later failed and was compensated still counts as spending (UX-DR-P8, P25).
   - After a 200, the session (header Points chip) and the top-up DTO are refreshed.
5. **Status views (A7).** The detail renders the refund state from `refund.request` (Figma `186:3346`, `186:3700`, `186:3467`, `186:3583`): the header chip and the "Hoàn tiền" card follow the status, and the timeline appends the refund steps.
   - `REQUESTED` + `ELIGIBLE`: "Đang chờ Admin chuyển khoản", "{points} Điểm đang được giữ và không dùng được cho tới khi có kết quả.", rows Lý do · Hoàn về tài khoản đã thanh toán · Chủ tài khoản · Điểm đang giữ · Hạn xử lý "{dd/MM/yyyy} · còn N ngày làm việc" ("Quá hạn" when past).
   - `REQUESTED` + `NOT_ELIGIBLE`: "Không đủ điều kiện hoàn tiền", the ineligible copy, "Admin sẽ phản hồi trước {date}.", Điểm đang giữ "0 Điểm", destination row.
   - `REFUNDED`: "Đã hoàn {amount} về tài khoản của bạn", "Tiền đã chuyển về {bank} · {accountNumber}{ lúc {bankTransferredAt}}. {points} Điểm đang giữ đã bị trừ.", rows Số Điểm đã trừ "−{points} Điểm" and Mã chuyển khoản / time **only when present** (UX-DR-P17).
   - `REJECTED`: "Yêu cầu hoàn tiền bị từ chối", "{points} Điểm đã trả lại Khả dụng. Mỗi giao dịch chỉ gửi yêu cầu 1 lần nên không gửi lại được." (hold-less variant: "Không có Điểm nào bị giữ."), "Lý do của Admin" quote **when present**, Thời điểm when present.
   - `WITHDRAWN`: header chip back to "Thành công" (FR-77), card "Bạn đã rút yêu cầu hoàn tiền lúc {withdrawnAt}. Giao dịch này không thể yêu cầu hoàn tiền nữa." (+ "{points} Điểm đã trở lại Khả dụng." when it was eligible) — `ASSUMED (design)`, no Figma frame.
6. **Withdraw.** `REQUESTED` (eligible or not) shows "Rút yêu cầu" (danger-outline). It opens a confirm dialog: "Rút yêu cầu hoàn tiền?" / "Sau khi rút, giao dịch này không thể gửi yêu cầu hoàn tiền lại." (+ "{points} Điểm sẽ trở lại Khả dụng." when eligible) with "Đóng" / "Rút yêu cầu" (loading "Đang rút…"). 200 (including `replayed: true`) → refresh the DTO and session, show the `WITHDRAWN` view (UX-DR-P18). `ASSUMED (design)` — no Figma frame.
7. **Conflict + errors.** Submit or withdraw conflict:
   - `409 REFUND_ALREADY_RESOLVED` → message "Yêu cầu đã được xử lý" then reload the top-up DTO (UX-DR-P25).
   - `409 TOPUP_REFUND_ALREADY_REQUESTED` → "Giao dịch này đã có yêu cầu hoàn tiền." then reload (13.10 D7: submit is not replay-safe).
   - `409 TOPUP_REFUND_NOT_ALLOWED` → reason copy from `details.reason` (same table as AC 1) then reload.
   - `404 TOPUP_NOT_FOUND` / `TOPUP_REFUND_NOT_FOUND` → the existing not-found state / reload.
   - `400 VALIDATION_ERROR` → field errors (AC 2); network/5xx → retryable `Alert` inside the dialog, form input kept.
8. **Chips + history.** `topUpChip` gains the refund variants of UX-DR-P1: Refund Requested "Đang yêu cầu hoàn tiền" (teal, `refund`), Refunded "Đã hoàn tiền" (dark teal, existing MANUAL_REFUNDED look), Refund Rejected "Từ chối hoàn tiền" (danger, `x-circle`). The chip comes from the refund request status when one exists (`REQUESTED|REFUNDED|REJECTED`), else from the top-up status (`WITHDRAWN` → Successful). The wallet top-up history (`/wallet`) uses the same rule.
9. **Notifications.** The bell dropdown and `/notifications` render `TOPUP_REFUND_REQUESTED`, `TOPUP_REFUND_WITHDRAWN`, and `TOPUP_REFUNDED` with the right title, icon and tone (already mapped by 13.9/13.10; verify and test). Refund rejected renders once 13.12 adds its type (see Dev Notes D4). The target stays `/wallet` (the notification DTO carries no top-up id).
10. **Insufficient-Points messages (UX-DR-P19).** When an insufficient-Points error carries `details.refundHoldPoints > 0`, the message adds "{N} Điểm đang giữ chờ hoàn tiền.": publish (`publishErrorMessage`), reopen (`formActionErrorMessage`), the create-survey wizard (`createSurveyErrorMessage`, same escrow code), and voucher quote/redeem (`redeemErrorView` `INSUFFICIENT_POINTS`, as an extra row "Đang giữ chờ hoàn tiền" + the sentence). Without the field (or ≤ 0) every message is byte-identical to today.
11. **Responsive + states.** Every new view ships Desktop 1440 and Mobile 390 and keeps the 13.7 loading / not-found / error states (Figma `184:3092`…`184:3215`). Mock mode (MSW) supports every state above.

## Tasks / Subtasks

- [x] **Task 0: Preconditions**
  - [x] `git status --short --branch` → `feat/13-11-refund-screens` (created 2026-10-16 from `origin/develop` `edbac15`, 13.10 PR #47 merged, upstream unset). Push later with `git push -u origin feat/13-11-refund-screens`.
  - [x] UI gate (epics l.169): designer fix pass landed — Figma page 29 now has the paying-account destination and the unverified frames `196:3461`/`196:3588`. Frames re-read via Figma MCP on 2026-10-16 (Dev Notes "Figma").
- [x] **Task 1: Contract (shared schemas)** (AC 1–5; Decisions D1, D2, D7)
  - [x] `packages/schemas/src/economy/top-up-refund.schema.ts` `userTopUpRefundRequestSchema`: add **optional** `resolvedAt`, `rejectionReason`, `bankTransferReference`, `bankTransferredAt` (each `.nullable().optional()`; datetime for the two times, string ≤ 500 for the reason, ≤ 100 for the reference). Keep `.strict()`. The 13.10 backend does not emit them, so its responses still parse; 13.12 populates them.
  - [x] New `userTopUpRefundDestinationViewSchema = userTopUpRefundDestinationSchema.extend({ accountNumber: z.string().nullable() }).strict()` (keeps `last4`). Use it for `userTopUpRefundRequestSchema.destination` **only**. `topUpRefundAdminNoticePayloadSchema.destination` keeps the last-4 `userTopUpRefundDestinationSchema` — the full number never enters the Outbox (13.10 guardrail unchanged).
  - [x] `payos-top-up.schema.ts` `payosTopUpSchema.refund`: add `destination: userTopUpRefundDestinationViewSchema.nullable()` — the paying account of the top-up, so A4/A5 can show it before submit.
  - [x] Specs: 13.10-shaped payload (no resolution fields) parses; payload with them parses; `accountNumber` required-nullable on the view schema; admin-notice schema still rejects an `accountNumber` key.
- [x] **Task 1b: Backend — unmask the owner's account on user routes** (Decision D7; small, FE-blocking)
  - [x] Read paths that build the user DTO: `infrastructure/prisma-payos-top-up.repository.ts:75` (`maskLast4`), `infrastructure/in-memory-payos-top-up.repository.ts:~572-589`, `application/top-up-refund.service.ts:~371-388` (`toUserRefundDto`), `application/payos-top-up.service.ts:~143` (`counterAccountLast4`) and `dto()` (~l.974), `ports/payos-top-up-repository.port.ts:72`. Pass the stored `counterAccountNumber` through as `accountNumber` (plus `last4` as today) for the **owner's** refund request summary and for the new `refund.destination`.
  - [x] `refund.destination` = from the top-up row's `counterAccount*` for `PAYOS` `SUCCESSFUL` rows (null when all four are null), `verified` with the 13.10 rule (bankId && number && holder name). For other statuses: null.
  - [x] Unchanged: Outbox payloads, admin-notice/mailbox email (last 4), logs (never log the number), list/other users (404 as today).
  - [x] Tests: invert `apps/backend/test/top-up-refund.e2e-spec.ts:280-311` ("never leaks …") into: owner GET/list/submit/withdraw responses carry `accountNumber` = stored value; another user gets 404; the Outbox admin-notice payload and the mailbox email body contain only the last 4 (keep those assertions). Service spec for `refund.destination` (null counter account, probe shape bankId+number without holder → `verified:false`, full → `verified:true`).
  - [x] PRD: add an "Amendment 2026-10-16 (Owner decision, Story 13.11)" note under FR-77 (`prds/prd-project-rescom-2026-08-08/prd.md` after l.627): the user sees the full paying account number on their own top-up; Outbox, mailbox email and logs keep last 4.
  - [x] Run backend `npm test --workspace backend -- top-up`, `npm run test:e2e --workspace backend -- top-up-refund`, `npm run build --workspace backend`.
- [x] **Task 2: Service + messages** (AC 3, 4, 6, 7)
  - [x] `lib/wallet/payos-top-up-service.ts`: `requestPayosRefund(id, body: SubmitTopUpRefundInput, signal?)` → `POST /economy/top-ups/payos/${encodeURIComponent(id)}/refund-request` (schema `topUpRefundResultSchema`), `withdrawPayosRefund(id, signal?)` → `POST …/refund-request/withdraw` with `body: {}`. Validate the body with `submitTopUpRefundSchema.parse` before sending. Same `apiRequest` pattern as `cancelPayosTopUp`.
  - [x] `lib/wallet/payos-top-up-messages.ts`: `payosRefundErrorMessage(error)` → `{ message, reload: boolean, fieldErrors?: { reason?, note? } }` per AC 7, following the existing `isApiError` / `kind === "network"` / `code` order. `details.reason` via a safe reader (no casts on `unknown`).
- [x] **Task 3: Pure refund rules** — new `lib/wallet/top-up-refund.ts` (node-testable, `.ts` relative imports) (AC 1–6, 8)
  - [x] `REFUND_REASON_OPTIONS` (value + label in Figma order), `refundReasonLabel(reason)`.
  - [x] `refundSectionView(topUp, now)` → `{ kind: "hidden" } | { kind: "available", deadline, countdown } | { kind: "unavailable", reason } | { kind: "request", request }`. `hidden` for `NOT_SUCCESSFUL` without a request; `available` only when `refund.canRequest && now < refundDeadline`; a client-side passed deadline → `unavailable DEADLINE_PASSED`.
  - [x] `refundCountdownLabel(deadline, now)` → "Còn N giờ" (≥ 1 h, floor) / "Còn N phút" (< 1 h, ceil, min 1) / null when passed.
  - [x] `validateRefundForm({ reason, note })` → `{ ok, value } | { ok: false, errors }` with the AC 2 copy; uses `TOP_UP_REFUND_NOTE_MAX`; counts characters after trim.
  - [x] `refundDestinationLabel(destination)` → `{ verified, bank, accountNumber, holder }` (full number, Owner decision D7); `bank = bankName ?? (bankId ? "Mã ngân hàng " + bankId : "Ngân hàng")`. Shown as verified only when `verified && accountNumber`. Source: `refund.destination` before submit, `refund.request.destination` after.
  - [x] `refundDueDate(submittedAt)` = `addBusinessDays(submittedAt, 3)` and `refundDueLabel(submittedAt, now)` ("còn N ngày làm việc" / "Quá hạn") using `addBusinessDays` / `businessDaysUntil` from `@rescom/schemas` (`common/business-days.ts`, already used by `lib/admin/payos-top-up-mismatch.ts`). Never re-implement business days.
  - [x] `refundUnavailableCopy(reason, ctx)` and `ineligibleCopy(reason)` (Dev Notes copy tables).
  - [x] `refundTimelineSteps(request)` → steps appended to `payosTimeline` output (Gửi yêu cầu hoàn tiền + verdict detail; then Chờ Admin chuyển khoản / Admin đã chuyển khoản hoàn tiền / Admin từ chối hoàn tiền / Đã rút yêu cầu). Keep `payosTimeline` unchanged; compose in the screen.
  - [x] `lib/wallet/top-up-history.ts`: `topUpChip(status, channel, refundStatus?)` adds the 3 refund variants (AC 8); `mapPayosToHistory` passes `refund.request?.status`. Existing calls without the third argument behave exactly as today.
- [x] **Task 4: Detail screen** — `app/(signed-in)/(focus)/wallet/top-up/components/` (AC 1–7, 11)
  - [x] New `RefundSection.tsx` (card: available / unavailable / form / status views), `RefundForm.tsx` (radio cards via `Radio variant="card"` + `radio-group-keys.ts` arrow-key handling as other radio groups do; `Textarea` with `maxLength`/counter), `RefundConfirmDialog.tsx` and `WithdrawRefundDialog.tsx` (model on the cancel dialog in `PayosTopUpScreen.tsx`: `Dialog` + `Alert tone="danger"` + `Button loading`; `dismissible={false}` while submitting), `RefundResult.tsx` (A6). Keep each file focused; no new UI primitives (no Callout component exists — reuse the `rounded-xl bg-slate-50 border border-line p-3 text-caption` notice style or `Alert tone="info"`; amber notice = the existing amber tokens used by the Processing banner).
  - [x] `PayosTopUpScreen.tsx`: render `RefundSection` when `refundSectionView(...).kind !== "hidden"`. Desktop A4 layout = two columns (detail left, "Hoàn tiền" card right, ~`lg:grid-cols-[1fr_384px]`) — widen the `TopUpFrame` `width` only on this branch; mobile stacks. Header chip uses `topUpChip(status, "PAYOS", refund.request?.status)`. The 13.7 SUCCESSFUL hero/mascot block, polling, cancel and other states stay as they are.
  - [x] After a submit/withdraw 200 or a reload-class error: `recheck()` from `usePayosPolling` (verify it fetches even on terminal status; if not, add a `reload` that does, without restarting the poll loop) and `refreshSession()`. Result view (A6) is local state cleared by "Xem giao dịch". Available balance for the A6 footnote: `getWalletBalance()` after the submit (pattern already in this screen).
  - [x] Countdown: one `setInterval(60_000)` in `RefundSection`, cleared on unmount; no polling of the API for it.
  - [x] `TransferScreen.tsx`: for an `APPROVED` manual row, a read-only "Hoàn tiền" card with the `LEGACY_MANUAL` copy. Nothing else.
- [x] **Task 5: Insufficient-Points messages** (AC 10)
  - [x] One helper `refundHoldPointsFrom(details: unknown): number` (returns 0 unless a positive integer) + `refundHoldSentence(n)` → `"{formatPoints(n)} Điểm đang giữ chờ hoàn tiền."` in a shared module (e.g. `lib/wallet/refund-hold.ts`).
  - [x] `lib/forms/builder-messages.ts` `publishErrorMessage` (codes `INSUFFICIENT_BALANCE`, `INSUFFICIENT_ESCROW_BALANCE`), `lib/forms/manage-messages.ts` `formActionErrorMessage` (same codes; also used by close/edit/delete dialogs — append only for those codes), `lib/forms/create-messages.ts` `createSurveyErrorMessage`: append `" " + refundHoldSentence(n)` when n > 0.
  - [x] `lib/rewards/redeem-flow.ts` `redeemErrorView` `INSUFFICIENT_POINTS`: when `details.refundHoldPoints > 0`, add row `{ label: "Đang giữ chờ hoàn tiền", value: "{N} điểm" }` and append the sentence to the body. Rows/body unchanged otherwise (existing `rewards-redeem.test.mjs:51-54` must pass untouched).
  - [x] Check whether `use-google-form-wizard.ts:222` (`setServerShortfall(true)`) shows a shortfall message that should also carry the sentence; if it renders its own copy, pass the number through; if not, leave it and note it.
- [x] **Task 6: MSW** (AC 11) — `mocks/data/top-up.ts`, `mocks/handlers/top-up.ts`, `mocks/db/store.ts`, rewards/forms mocks
  - [x] Widen `MockPayosTopUp.refund.request` to the user request DTO (+ store the mock-only full state needed to answer). Seeds for the mock user (times relative to seed time): SUCCESSFUL paid 1 h ago, verified destination (Vietcombank `970436`, fake holder `TRAN THI A`, fake number `0123456789` — never real data, repo is public); SUCCESSFUL unverified (bankId `970422`, holder null, bankName null, fake number present — 13.6 probe shape); SUCCESSFUL paid 30 h ago (DEADLINE_PASSED); SUCCESSFUL mismatch-credited (MISMATCH_CREDITED); REQUESTED ELIGIBLE; REQUESTED NOT_ELIGIBLE (`SPENT_SINCE_TOP_UP`); WITHDRAWN; REFUNDED with `bankTransferReference` + `bankTransferredAt`; REJECTED with `rejectionReason`. Wallet seed `refundHold` = sum of eligible REQUESTED points, `available` consistent.
  - [x] Handlers (each `http.post(apiUrl("…"), …` on **one line** — `tests/route-diff.test.mjs` parser): `POST /economy/top-ups/payos/:id/refund-request` (zod-validate body → 400 `VALIDATION_ERROR`; owner + refusal rules and codes exactly as 13.10 AC 6; eligible moves Points available→refundHold in the mock wallet and adds a `topup-refund-hold:` mock ledger entry; scenario switch `refund-not-eligible` returns NOT_ELIGIBLE) and `POST …/refund-request/withdraw` (13.10 AC 7 incl. `replayed`, release entry `topup-refund-withdraw:`, 409 `REFUND_ALREADY_RESOLVED` on REFUNDED/REJECTED). `toUserTopUpDto` derives `refund.canRequest/unavailableReason` with the 13.10 precedence (NOT_SUCCESSFUL, MISMATCH_CREDITED, WITHDRAWN, ALREADY_REQUESTED, DEADLINE_PASSED). No allowlist entry (backend serves both routes).
  - [x] Insufficient mocks: add `refundHoldPoints` to `INSUFFICIENT_*` details when the mock wallet `refundHold > 0` (`mocks/handlers/forms-builder.ts:145`, `mocks/handlers/forms-create.ts:161`, `mocks/data/rewards-rules.ts:66,75`, `mocks/data/rewards.ts:249`).
  - [x] Bump `SCHEMA_VERSION` in `mocks/db/store.ts` 14 → 15 with a comment.
- [x] **Task 7: Tests** (`apps/frontend/my-app/tests/*.test.mjs`, `node --test`; every bullet needs a real assertion — 13.9/13.10 reviews caught ticked-but-untested bullets)
  - [x] `top-up-refund.test.mjs`: `refundSectionView` for each `unavailableReason`, `hidden` for non-successful, `available`, client deadline passed (−1 ms / exact); countdown labels (25 h, 23 h 59 m → "Còn 23 giờ", 59 m, 30 s → "Còn 1 phút", passed → null); validator (no reason, "", "   ", 1, 300, 301 → "hãy rút gọn 1 ký tự", trims); destination labels (verified, bankName null + bankId, holder null, number null → unverified; label shows the full number); due date across a weekend (submitted Fri → Wed) and "Quá hạn"; ineligible/unavailable copy present for every enum value (exhaustive over the schema enums); timeline steps per status.
  - [x] `top-up-history.test.mjs`: 3 refund chip variants, WITHDRAWN → Successful, old two-arg calls unchanged.
  - [x] `payos-top-up-service.test.mjs`: both refund calls (path, method, CSRF header like cancel, body validated, result parsed), `payosRefundErrorMessage` for each code in AC 7 incl. `details.reason` and `VALIDATION_ERROR` field mapping, network.
  - [x] Insufficient messages: `form-builder-messages.test.mjs`, `forms-manage.test.mjs`, `forms-create.test.mjs`, `rewards-redeem.test.mjs` — with `refundHoldPoints: 250` the sentence/row appears; with it absent, 0, negative or a string the output equals today's.
  - [x] Notifications (`notification-center.test.mjs` or `notifications.test.mjs`): the 3 refund types render title/icon/tone/href.
  - [x] `schemas`: `top-up-refund.schema.spec.ts` optional-field cases (Task 1).
  - [x] Mock: `tests/route-diff.test.mjs` passes; one mock test (pattern `rewards-mock.test.mjs`) for submit eligible → wallet moved, resubmit → 409 `TOPUP_REFUND_ALREADY_REQUESTED`, withdraw → replay 200 `replayed: true` (`top-up-refund-mock.test.mjs`).
  - [x] `no-direct-url-state.test.mjs` / `no-direct-mocks.test.mjs`: include the new component files.
  - [x] Run: `npm test --workspace @rescom/schemas`; in `apps/frontend/my-app`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Backend: the Task 1b runs.
  - [x] Visual check in mock mode at 1440 and 390 against the Figma frames listed in Dev Notes (A4 default/form/validation/>24h/manual/unverified, A5 dialog/submitting, A6 eligible/not eligible, A7 ×4, WITHDRAWN, withdraw dialog, conflict toast, one insufficient message per surface). Record deviations in Completion Notes.

### Review Findings

Code review 2026-10-17 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, uncommitted diff vs edbac15).

- [x] [Review][Patch] (Decision resolved by Owner: `.optional()`) Deploy-order compatibility — FE parses strictly; new required `refund.destination` and `request.destination.accountNumber` break an FE-first rollout (Vercel auto, BE manual). Make both `.optional()`; FE treats missing as null [packages/schemas/src/economy/payos-top-up.schema.ts:69, top-up-refund.schema.ts:67]
- [x] [Review][Patch] (Decision resolved by Owner: revert) Manual APPROVED flow changed beyond "nothing else changes" (AC 1) — revert the `TransferScreen` hunk (keep the redirect); the LEGACY_MANUAL card lives only in `PendingScreen`, where APPROVED rows land. Recorded deviation: spec named `TransferScreen` [TransferScreen.tsx:96]
- [x] [Review][Patch] Confirm dialog stays open after a reload-class 409 (`TOPUP_REFUND_ALREADY_REQUESTED` / `TOPUP_REFUND_NOT_ALLOWED`); retry hits 409 again over a view that already changed — close dialog and form when `parsed.reload` [RefundSection.tsx:107]
- [x] [Review][Patch] Withdraw dialog stays open after `REFUND_ALREADY_RESOLVED` — close it when `parsed.reload` [RefundSection.tsx:129]
- [x] [Review][Patch] Stale `submitError` shows again when the confirm dialog is reopened — clear it on close [RefundSection.tsx:447]
- [x] [Review][Patch] 60 s tick past the deadline unmounts the open form (typed note lost) while the confirm dialog stays mounted and can still submit — close form/dialog when `view.kind !== "available"` [RefundSection.tsx:56]
- [x] [Review][Patch] A6 "Khả dụng còn X Điểm" uses the pre-hold balance until the refetch lands (and keeps it if the refetch fails) — reset `newBalance` to null before refetching [PayosTopUpScreen.tsx:395]
- [x] [Review][Patch] A7 REFUNDED prints `{bank} · {accountNumber}` without a null/verified guard ("MBBank · ") [RefundSection.tsx:336]
- [x] [Review][Patch] A6 NOT_ELIGIBLE shows an extra destination row; AC 4 lists only Mã giao dịch · Điểm đang giữ · Dự kiến phản hồi [RefundResult.tsx:123]
- [x] [Review][Patch] Date copy: A4 renders "đến 14:30 17/10/2026" (AC 1 wants "đến {HH:mm} ngày {dd/MM/yyyy}"); A5 subtitle renders full date with year (AC 3 wants "nạp {dd/MM HH:mm}") [RefundSection.tsx:177, RefundConfirmDialog.tsx:48]
- [x] [Review][Patch] A7 REQUESTED label "Hoàn về tài khoản" should be "Hoàn về tài khoản đã thanh toán" (AC 5) [RefundSection.tsx:241]
- [x] [Review][Patch] Server field error stays visible while the user edits that field (server errors spread last) — clear the key on edit [RefundForm.tsx:46]
- [x] [Review][Patch] Error fallback echoes raw server `error.message` (English) for `VALIDATION_ERROR` and unknown codes; any 404 maps to "Không tìm thấy giao dịch này" + reload — use fixed Vietnamese copy, restrict 404 mapping to the known codes [payos-top-up-messages.ts:176,186]
- [x] [Review][Patch] Submit/withdraw do not pass an `AbortSignal` (Guardrail "abort in-flight requests on unmount") [RefundSection.tsx:91,122]
- [x] [Review][Patch] Mock withdraw clamps `refundHold` at 0 but still credits full `points` to `available` (mints Điểm when hold < points) [mocks/data/economy.ts:427]
- [x] [Review][Patch] Task 5 last bullet not recorded: `use-google-form-wizard.ts:223` `setServerShortfall(true)` is a boolean with its own copy — note the decision in Completion Notes [13-11-refund-screens.md Completion Notes]

## Dev Notes

### Scope boundary (read first)

FE story + contract widening + one small backend read change (Task 1b: owner sees the full paying account, `refund.destination`). In scope: the refund card/form/confirm/result/status/withdraw on `/wallet/top-up/:id`, legacy-manual refund copy, refund chip variants (detail + wallet history), refund notifications check, the "N Điểm đang giữ chờ hoàn tiền" sentence, MSW for all of it.

Out of scope → **13.12**: admin "Yêu cầu hoàn tiền" tab + B2 drawer, `ResolveTopUpRefund`, DB columns and backend population of `resolvedAt`/`rejectionReason`/`bankTransferReference`/`bankTransferredAt`, the `TOPUP_REFUND_REJECTED` notification type (if 13.12 adds one) and its FE map entry, the "Hoàn tiền nạp Điểm" history label and the "Bút toán đảo" link. Official bank/PayOS logos → 13.13 (UX-DR-P15; use the `bank` icon + a text badge as the placeholder). No backend change beyond Task 1b (read DTO only; no command, DB or Outbox change).

### API (VERIFIED from 13.10 code + story; re-read `presentation/payos-top-up.controller.ts` before coding)

- `GET /economy/top-ups/payos/:id` and list → `payosTopUpSchema` with `refundDeadline: datetime|null` and `refund: { canRequest, unavailableReason|null, request: userTopUpRefundRequestSchema|null }`. After Task 1b: owner routes carry the full `accountNumber` (13.10 masked it to last 4).
- `POST /economy/top-ups/payos/:id/refund-request` body `{ reason, note }` (`.strict()`, note trimmed 1–300) → 200 `{ request, replayed: false }`. Errors: 404 `TOPUP_NOT_FOUND`; 409 `TOPUP_REFUND_NOT_ALLOWED` `details.reason ∈ DEADLINE_PASSED|LEGACY_MANUAL|NOT_SUCCESSFUL|MISMATCH_CREDITED`; 409 `TOPUP_REFUND_ALREADY_REQUESTED` (also on a retry after success and after withdrawal); 400 `VALIDATION_ERROR`; 401/403 CSRF.
- `POST …/refund-request/withdraw` → 200 `{ request, replayed }` (`replayed: true` when already WITHDRAWN); 404 `TOPUP_REFUND_NOT_FOUND`; 409 `REFUND_ALREADY_RESOLVED` (REFUNDED/REJECTED).
- Neither route is flag-gated (works with `PAYOS_ENABLED=false`).
- `destination.verified` = bankId && full number && holder name present (13.10 D3). `last4` may be non-null while unverified (probe: number present, holder null).
- `unavailableReason` precedence (server): NOT_SUCCESSFUL, MISMATCH_CREDITED, WITHDRAWN, ALREADY_REQUESTED, DEADLINE_PASSED.

### Destination before submit

13.10 returned no destination before a request existed and only last 4 after. Owner decision 2026-10-16 (D2 → option b, D7): Task 1b adds `refund.destination` (full number) to the top-up DTO, and the request summary carries `accountNumber` too. A4/A5/A6/A7 show `{bank} · {accountNumber}` + holder; unverified (`verified:false`) shows the amber email notice instead of the account block (the number may still exist — probe case — but is not presented as the confirmed destination).

### Unavailable copy (`ASSUMED (design)` except where Figma quotes it)

- `DEADLINE_PASSED`: "Đã quá 24 giờ kể từ lúc nạp ({dd/MM/yyyy HH:mm}), giao dịch này không thể hoàn tiền." (Figma `184:2899`, time = `paidAt`)
- `LEGACY_MANUAL`: "Giao dịch nạp thủ công cũ (chuyển khoản + Admin duyệt) đã ngừng và không hoàn tiền được. Giao dịch chỉ còn để tra cứu." (Figma `184:3002`)
- `MISMATCH_CREDITED`: "Giao dịch này đã được cộng Điểm theo số tiền thực nhận nên không thể yêu cầu hoàn tiền trong ứng dụng. Phần lẻ dưới 200đ không được quy đổi." (UX-DR-P23)
- `WITHDRAWN`: "Bạn đã rút yêu cầu hoàn tiền. Giao dịch này không thể yêu cầu hoàn tiền nữa." (only when no request object is returned; normally the A7 WITHDRAWN view covers it)
- `ALREADY_REQUESTED`: "Giao dịch này đã có yêu cầu hoàn tiền."
- `NOT_SUCCESSFUL`: no card.

### Ineligible copy

- `SPENT_SINCE_TOP_UP`: "Đã ghi nhận yêu cầu nhưng không đủ điều kiện hoàn tiền vì bạn đã sử dụng Điểm (đăng/mở lại khảo sát hoặc đổi voucher) sau khi nạp. Một lần đổi voucher thất bại đã được hoàn Điểm vẫn được tính là đã sử dụng. Admin sẽ phản hồi." (UX-DR-P25)
- `INSUFFICIENT_AVAILABLE`: "Đã ghi nhận yêu cầu nhưng không đủ điều kiện hoàn tiền vì Điểm khả dụng hiện ít hơn số Điểm của giao dịch. Admin sẽ phản hồi."

Figma A6/A7 not-eligible name the exact spend ("Đổi voucher · 14:25 · −150", "voucher Highlands 50.000đ"). The API does not expose the spend journal; do **not** query wallet history to guess it. Recorded deviation (D3).

### Figma (verified 2026-10-16 via Figma MCP, file `mkudD5Ngi5RPyIAVxCcxXi`, page 29 `178:2`)

- A4 desktop: default eligible `184:2338` (two columns; right card "Hoàn tiền" + teal chip "Còn 23 giờ" + outlined CTA "Yêu cầu hoàn tiền" with refund icon), form `184:2443`, validation `184:2755`, > 24 h `184:2899`, manual `184:3002`, loading `184:3092`, not found `184:3152`, error `184:3215`, unverified `196:3588`. Mobile: `184:1767`, `184:1847`, `184:2015`, `184:2086`, `184:2164`, `184:2228`, `184:2261`, `184:2297`, `196:3461`.
- A5 confirm `186:2339` / `186:2263`, submitting `186:2554` / `186:2474` (dialog rows with lock / card / alert / info icons; buttons "Huỷ" outline + "Gửi yêu cầu" filled green).
- A6 eligible `186:2756` / `186:2694` (shield mascot, "Xem giao dịch" filled + "Về ví" outlined), not eligible `186:2897` / `186:2834` (confused mascot).
- A7 desktop requested `186:3346`, refunded `186:3467`, rejected `186:3583`, requested–not eligible `186:3700`; mobile `186:2980`, `186:3075`, `186:3166`, `186:3260`. A7 frames have **no** "Rút yêu cầu" button and there is **no** Withdrawn frame (UX-DR-P18 came from the addendum) → epics text wins, `ASSUMED (design)`.
- A8 notifications page `187:3167` (refund requested "Đã gửi yêu cầu hoàn tiền", refunded "Đã hoàn 50.000đ cho giao dịch #…", rejected "Yêu cầu hoàn tiền bị từ chối"). Message text comes from the backend; FE maps type → title/icon/tone only.
- Rules frame `191:3079`: note over-limit copy "Tối đa 300 ký tự — hãy rút gọn N ký tự."; Refund Hold tooltip; sample data (Lan, 2610150142, Vietcombank •••• 4567 — Figma masks; product now shows the full number per D7). Use fake names/numbers in mocks (repo is public).
- Figma "Kênh PayOS · VietQR": keep 13.7's channel label (we do not store the method). Figma Refunded "Bút toán đảo JRN-…" / "Người xử lý": not available → omitted (13.12).

### Decisions taken in this story (defaults; Owner may override — see Questions)

- **D1 — optional resolution fields in the user DTO now.** `resolvedAt`, `rejectionReason`, `bankTransferReference`, `bankTransferredAt` are added as optional to the shared schema so the A7 Refunded/Rejected views are complete and mock-testable; 13.12 fills them from the backend. Views render each only when present.
- **D2 — destination before submit** via backend `refund.destination` (Owner 2026-10-16).
- **D7 — full account number to the owner** on user routes and screens (Owner 2026-10-16: "số tài khoản ngân hàng không cần ẩn, hiện full"). Outbox payloads, mailbox email and logs stay last 4; PRD FR-77 amended in Task 1b.
- **D3 — generic ineligible copy** instead of the specific spend line.
- **D4 — notifications:** no new type here; target stays `/wallet`; refund-rejected rendering ships with 13.12's type.
- **D5 — due date** = `addBusinessDays(submittedAt, 3)` client-side, display only (Mon–Fri `Asia/Ho_Chi_Minh`, no holidays, same helper as 13.5/13.9).
- **D6 — withdraw UI** placed on the A7 REQUESTED card (danger-outline), copy `ASSUMED (design)`.

### Current state of files touched (read each before editing)

- `PayosTopUpScreen.tsx` (407 l.) — `TopUpFrame width={720}`, `desktopHeader` = `TopUpStatusChip(topUpChip(status,"PAYOS"))`; status card (SUCCESSFUL block ~l.163: mascot `points`, "Nạp thành công +N Điểm!", "Số dư mới" from `getWalletBalance()`, "Về ví" / "Đăng khảo sát"); info `<dl>` rows; timeline from `payosTimeline(topUp)`; cancel `Dialog` (template for the new dialogs; handles `TOPUP_NOT_CANCELLABLE` → close + `recheck()`). `usePayosPolling(id, initial, onTerminal)` → `{ topUp, state, recheck }`, polls only PROCESSING. Preserve all 13.7 behavior.
- `TopUpRouter.tsx` — PayOS first, 404/400 → manual `TransferScreen`. Unchanged.
- `TransferScreen.tsx` — manual detail; `paymentInstructions` only for PENDING (l.93). Add only the LEGACY_MANUAL card for APPROVED.
- `lib/wallet/payos-top-up-service.ts` (no refund functions), `payos-top-up-messages.ts` (`isApiError`, network → `NETWORK_ERROR_MESSAGE`, code/status mapping), `payos-top-up.ts` (`payosTimeline` takes a `Pick` without `refund` — leave it), `top-up-history.ts` (`topUpChip(status, channel)` l.~42-76, `MANUAL_REFUNDED_COPY`, `mapPayosToHistory`).
- `components/wallet/TopUpStatusChip.tsx` — `{label, icon, tone}`, tones amber|green|grey|teal|danger. If "dark teal" needs a tone, reuse what MANUAL_REFUNDED uses.
- `components/ui`: `Dialog(open,onClose,labelledBy,role?,width?,dismissible?)`, `Alert(tone: danger|info)`, `Button(variant primary|secondary|outline|ghost|danger|danger-outline, loading, loadingLabel)`, `Radio(label, description?, variant plain|card)`, `Textarea(id,label?,hint?,error?,maxLength?,value)` (built-in counter when `maxLength`; it may set the native attribute, which makes the > 300 message reachable only via programmatic input — keep the validator anyway). `Icon name` = `/public/icons/<name>.svg` (missing names fail silently): use `refund`, `bank`, `clock`, `lock`, `alert-circle`, `info`, `x-circle`, `check` — verify each file exists.
- `lib/notifications/notification-presentation.ts` l.28-30 (`TOPUP_REFUNDED` teal, `TOPUP_REFUND_REQUESTED` amber, `TOPUP_REFUND_WITHDRAWN` neutral, href `/wallet`), titles l.98-100. `notificationSchema` has no target/metadata field.
- Insufficient: `lib/forms/builder-messages.ts:35-36,52`, `lib/forms/manage-messages.ts:42-43,79-92`, `lib/forms/create-messages.ts:54-56,95-100`, `lib/rewards/redeem-flow.ts:42-45` (`RedeemRow {label,value,danger?}`), `lib/api/api-error.ts:19` (`details: unknown`). Backend: escrow details `{availableBalance, requiredAmount, refundHoldPoints?}` (`http-exception.filter.ts:573-580`); rewards `{required, available, refundHoldPoints?}` (`packages/schemas/src/rewards/redemption.schema.ts:20`, typed).
- MSW: `mocks/db/store.ts:32` `SCHEMA_VERSION = 14`; `mocks/data/top-up.ts:164` `MockPayosTopUp.refund.request: null`; `mocks/handlers/top-up.ts` `toUserTopUpDto` ~l.200 (defaults refund fields); no refund handlers.

### Guardrails

- **Server is the only truth** for eligibility, deadline, and status. The client countdown may only *disable* the CTA early; it never enables anything. No refund state from URL params or `localStorage`.
- **PII:** the full account number is shown only to the top-up owner (D7). It never goes into Outbox payloads, the mailbox email, logs, analytics, `localStorage`, or error messages. Mock/test data uses fake numbers and names; no real data (repo is public).
- **No double submit:** disable + loading on the dialog button; ignore a second click; abort in-flight requests on unmount.
- **Accessibility:** radio cards keyboard-operable (arrow keys), errors announced, dialogs trap and return focus, countdown chip not announced every minute (no `aria-live` on it).
- **Do not break:** 13.7 return/poll/cancel flows, manual screens, wallet history labels (13.10), notification map, existing insufficient-Points copy when the field is absent, `rewards-redeem` existing assertions.
- **Units:** `amountVnd` (VNĐ) vs `points`; refund amount shown = `request.amountVnd` after submit, `topUp.amountVnd` before (they are equal for an eligible SUCCESSFUL PayOS top-up; mismatch-credited rows are not refundable).
- **Mock layer:** screens call services only (`no-direct-mocks.test.mjs`); `.ts` extensions on relative imports in `lib/` (Node type stripping in tests).

### Previous story intelligence

- **13.10** (merged `edbac15`): API above; D7 submit not replay-safe → FE reloads on `TOPUP_REFUND_ALREADY_REQUESTED`; withdraw replay-safe. Added `TOPUP_REFUND_REQUESTED`/`_WITHDRAWN` FE map entries and history labels "Giữ chờ hoàn tiền" / "Hoàn lại từ giữ chờ hoàn tiền" — do not redo. Review lesson: every ticked test bullet must have an assertion.
- **13.9**: `TOPUP_REFUNDED` notification + `MANUAL_REFUNDED` chip ("Đã hoàn tiền", teal); business-day UI helper usage in `lib/admin/payos-top-up-mismatch.ts`; `error.name === "ZodError"` instead of `instanceof` across the schemas package (13.8).
- **13.7**: polling hygiene (one loop, abort on unmount), `isSafeCheckoutUrl`, `TopUpFrame`, chip component shared with admin; review caught missing states and duplicate ids — give each dialog a unique `labelledBy` id.
- **13.6**: live probe shape (bankId `970422`, number present, holder null, bankName null) → unverified case must look right.

### Git intelligence

`edbac15` merge PR #47 (13.10), `d440e60` 13.10 + 13.9 fixes, `4c2e792` merge PR #46. FE pattern: pure module in `lib/wallet/*.ts` + service + messages, components under the route's `components/`, tests `tests/<feature>.test.mjs` with `node --test`, MSW handler + data pair, `SCHEMA_VERSION` bump on mock shape change.

### Latest tech information

No new library. Reuse `Intl`/existing formatters (`formatVnd`, `formatPoints`, date formatters used by `PayosTopUpScreen`) with `Asia/Ho_Chi_Minh` display as the existing screens do.

### Project Structure Notes

- New: `lib/wallet/top-up-refund.ts`, `lib/wallet/refund-hold.ts`, `components/RefundSection.tsx`, `RefundForm.tsx`, `RefundConfirmDialog.tsx`, `WithdrawRefundDialog.tsx`, `RefundResult.tsx` (under `app/(signed-in)/(focus)/wallet/top-up/components/`), `tests/top-up-refund.test.mjs`.
- Changed: `packages/schemas/src/economy/top-up-refund.schema.ts` (+spec), `lib/wallet/{payos-top-up-service,payos-top-up-messages,top-up-history}.ts`, `PayosTopUpScreen.tsx`, `TransferScreen.tsx`, `lib/forms/{builder,manage,create}-messages.ts`, `lib/rewards/redeem-flow.ts`, MSW top-up/forms/rewards mocks + store, tests listed in Task 7.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.11] (l.1969-1984); UX-DR-P1, P6–P10, P15, P17–P19, P23, P25 (l.171-195); Story 13.12 (l.1986-2004)
- [Source: prds/prd-project-rescom-2026-08-08/prd.md] FR-77 (l.609-627 incl. Owner amendment), FR-78 (l.629-644), FR-31 (l.535)
- [Source: architecture ARCHITECTURE-SPINE.md] AD-26 (l.282-308)
- [Source: _bmad-output/implementation-artifacts/13-10-refund-request-refund-hold-withdrawal.md] AC 6, 7, 8, 10; D3, D7
- [Source: _bmad-output/implementation-artifacts/13-7-wallet-top-up-screens.md] screen structure + review findings
- [Source: packages/schemas/src/economy/top-up-refund.schema.ts], [packages/schemas/src/common/business-days.ts]

### Owner decisions (confirmed by Owner Quan 2026-10-16)

1. D2 + D7: show the paying account before submit, **unmasked** — the user sees the full account number (Task 1b). Outbox/mailbox/logs keep last 4.
2. D1 approved: 4 optional resolution fields in the user DTO now; 13.12 fills them.
3. D6 approved: "Rút yêu cầu" danger-outline on the A7 REQUESTED card + confirm dialog.

## Dev Agent Record

### Agent Model Used

Gemini 2.5 Pro (Antigravity)

### Debug Log References

- `npm test --workspace @rescom/schemas`: 51 passed, 683 tests passed.
- `npm run typecheck` in `apps/frontend/my-app`: passed with 0 errors.
- `npm run lint` in `apps/frontend/my-app`: passed with 0 errors, 5 warnings.
- `npm test` in `apps/frontend/my-app`: 968 tests passed (0 failed).
- `npm run build` in `apps/frontend/my-app`: Next.js Turbopack production build succeeded (53/53 static & dynamic routes).
- `npm test --workspace backend -- top-up`: 12 suites passed, 130 tests passed.
- `npm run test:e2e --workspace backend -- top-up-refund`: 2 suites passed, 15 tests passed.

### Completion Notes List

- Implemented Story 13.11 according to all acceptance criteria and Owner decisions D1, D2, D6, D7.
- Contract widened (`userTopUpRefundDestinationViewSchema` with `accountNumber: z.string().nullable()`, optional resolution fields on `userTopUpRefundRequestSchema`, `refund.destination` on `payosTopUpSchema`).
- Backend read pass-through: owner routes unmask paying account number; Outbox, mailbox email and logs preserve 4-digit masking. PRD FR-77 updated with owner amendment.
- Frontend pure rules & service: `top-up-refund.ts` (section view derivation, countdown, validation, due date with business days, timeline steps), `top-up-history.ts` (3 refund chip variants), `payos-top-up-service.ts` (`requestPayosRefund`, `withdrawPayosRefund`), `payos-top-up-messages.ts` (AC 7 error mappings).
- Detail screens & UI components: `RefundSection.tsx`, `RefundForm.tsx`, `RefundConfirmDialog.tsx`, `WithdrawRefundDialog.tsx`, `RefundResult.tsx`. Desktop 2-column layout (1080px frame) in `TopUpFrame.tsx` and `PayosTopUpScreen.tsx`; mobile stack layout. Read-only legacy manual card in `PendingScreen.tsx` (code review 2026-10-17: the `TransferScreen` card was reverted because `TransferScreen` redirects APPROVED rows to the status page; deviation from the spec's file name, Owner approved).
- Insufficient-points notice: helper `refund-hold.ts` added; builder, manage, create messages and rewards redeem flow append `"{N} Điểm đang giữ chờ hoàn tiền."` when `details.refundHoldPoints > 0`.
- MSW mocking: `SCHEMA_VERSION` bumped to 15, `holdTopUpRefund` and `withdrawTopUpRefund` added to mock economy, seeded 9 refund-state rows for demo user, endpoints for refund request and withdrawal, route-diff verified.
- Tests: `top-up-refund.test.mjs` (12 tests), `top-up-refund-mock.test.mjs` (5 tests), `payos-top-up-service.test.mjs`, `top-up-history.test.mjs`, `form-builder-messages.test.mjs`, `forms-manage.test.mjs`, `forms-create.test.mjs`, `rewards-redeem.test.mjs`, `route-diff.test.mjs`, `no-direct-url-state.test.mjs`, `no-direct-mocks.test.mjs`.

- Task 5 last bullet: `use-google-form-wizard.ts:223` `setServerShortfall(true)` is a boolean that renders the wizard's own shortfall copy; it carries no details, so it was left unchanged.
- Code review 2026-10-17 fixes: `refund.destination` and `destination.accountNumber` made `.optional()` (FE-before-BE rollout); conflict 409s close the dialog, show the copy on the card and reload; stale dialog errors cleared on close; confirm dialog closes when the view stops being `available`; submit/withdraw abort on unmount; A6 balance reset before refetch; A6 NOT_ELIGIBLE destination row removed; A4/A5 date copy per spec; REFUNDED destination guarded; server field errors clear on edit; fixed Vietnamese copy for validation/unknown errors, 404 mapping limited to known codes; mock withdraw releases only the held amount.
- Pre-existing failure (not 13.11): `tests/rewards-admin-flash-domain.test.mjs:163` "stats: daily fills every day…" also fails on clean HEAD edbac15.

### File List

- `packages/schemas/src/economy/top-up-refund.schema.ts`
- `packages/schemas/src/economy/top-up-refund.schema.spec.ts`
- `packages/schemas/src/economy/payos-top-up.schema.ts`
- `packages/schemas/src/economy/payos-top-up.schema.spec.ts`
- `_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md`
- `apps/backend/src/modules/economy/application/ports/payos-top-up-repository.port.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-payos-top-up.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-payos-top-up.repository.ts`
- `apps/backend/src/modules/economy/application/top-up-refund.service.ts`
- `apps/backend/src/modules/economy/application/top-up-refund.service.spec.ts`
- `apps/backend/src/modules/economy/application/payos-top-up.service.ts`
- `apps/backend/src/modules/economy/application/payos-top-up.service.spec.ts`
- `apps/backend/src/modules/economy/presentation/payos-top-up.controller.ts`
- `apps/backend/test/top-up-refund.e2e-spec.ts`
- `apps/frontend/my-app/lib/wallet/payos-top-up-service.ts`
- `apps/frontend/my-app/lib/wallet/payos-top-up-messages.ts`
- `apps/frontend/my-app/lib/wallet/top-up-refund.ts`
- `apps/frontend/my-app/lib/wallet/top-up-history.ts`
- `apps/frontend/my-app/lib/wallet/refund-hold.ts`
- `apps/frontend/my-app/lib/forms/builder-messages.ts`
- `apps/frontend/my-app/lib/forms/manage-messages.ts`
- `apps/frontend/my-app/lib/forms/create-messages.ts`
- `apps/frontend/my-app/lib/rewards/redeem-flow.ts`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/TopUpFrame.tsx`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/PayosTopUpScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/PendingScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/RefundSection.tsx`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/RefundForm.tsx`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/RefundConfirmDialog.tsx`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/WithdrawRefundDialog.tsx`
- `apps/frontend/my-app/app/(signed-in)/(focus)/wallet/top-up/components/RefundResult.tsx`
- `apps/frontend/my-app/mocks/db/store.ts`
- `apps/frontend/my-app/mocks/data/economy.ts`
- `apps/frontend/my-app/mocks/data/top-up.ts`
- `apps/frontend/my-app/mocks/handlers/top-up.ts`
- `apps/frontend/my-app/mocks/handlers/forms-builder.ts`
- `apps/frontend/my-app/mocks/handlers/forms-create.ts`
- `apps/frontend/my-app/mocks/data/rewards-rules.ts`
- `apps/frontend/my-app/mocks/data/rewards.ts`
- `apps/frontend/my-app/mocks/handlers/rewards.ts`
- `apps/frontend/my-app/mocks/scenarios.ts`
- `apps/frontend/my-app/tests/top-up-refund.test.mjs`
- `apps/frontend/my-app/tests/top-up-refund-mock.test.mjs`
- `apps/frontend/my-app/tests/top-up-history.test.mjs`
- `apps/frontend/my-app/tests/payos-top-up-service.test.mjs`
- `apps/frontend/my-app/tests/form-builder-messages.test.mjs`
- `apps/frontend/my-app/tests/forms-manage.test.mjs`
- `apps/frontend/my-app/tests/forms-create.test.mjs`
- `apps/frontend/my-app/tests/rewards-redeem.test.mjs`
- `_bmad-output/implementation-artifacts/13-11-refund-screens.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
