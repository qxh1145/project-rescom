---
baseline_commit: 04a6213
---
# Story 13.12: Admin Refund Resolution

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want to review and resolve refund requests within the SLA,
so that users are refunded correctly and the ledger stays balanced.

## Acceptance Criteria

1. **"Yêu cầu hoàn tiền" tab (B1).** Given the Figma frame B1 refunds `188:1025`, when the Admin opens `/admin/top-ups?tab=refunds`, a tab "Yêu cầu hoàn tiền" sits second (order: Giao dịch PayOS · Yêu cầu hoàn tiền · Cần xử lý · Lịch sử thủ công (cũ)) with a count badge = open (`REQUESTED`) requests. The tab lists requests with columns Người dùng (name/email) · Giao dịch (orderCode, "{amount} · {points} Điểm") · Gửi lúc · Kết luận (verdict chip "Hợp lệ" green / "Không hợp lệ" amber + short reason) · Điểm giữ · Hạn SLA ("Còn N ngày" / "Quá hạn" + "Hạn dd/MM"; an overdue row has the red background), plus a destination-unverified marker. Filters: search by code or email, verdict (Tất cả kết luận / Hợp lệ / Không hợp lệ), status (Đang mở default / Đã xử lý / Tất cả). Open rows sort by due date ascending ("Gần hạn trước"); resolved rows by `resolvedAt` desc. Paging as 13.8 (page size 10). Loading / empty / error states as the 13.8 tab (UX-DR-P11).
2. **SLA + one-time overdue alert.** `dueAt = addBusinessDays(createdAt, 3)` (Mon–Fri `Asia/Ho_Chi_Minh`, shared helper), computed by the server and returned in the DTO. The reconciliation job (every minute) raises alert condition `REFUND_SLA_BREACHED` with subject `requestId` once per request (Outbox key `topup-alert:REFUND_SLA_BREACHED:{requestId}`) for each `REQUESTED` request with `dueAt <= now`: in-app WARNING to active admins + email to `TOPUP_REFUND_MAILBOX` (FR-78).
3. **B2 drawer.** Clicking a row (or deep link `?tab=refunds&request={requestId}`, the shape the 13.10 mailbox email already uses) opens the drawer (Figma `189:905` eligible, `189:1128` not eligible, `198:2186` unverified; mobile `190:2297`, `198:2546`):
   - Header "Yêu cầu hoàn tiền #{orderCode}", refund status chip, SLA chip, "{name} · {email} · gửi {dd/MM HH:mm}".
   - Verdict card: "Hợp lệ · đang giữ {points} Điểm" + "User chưa tiêu Điểm nào kể từ lúc nạp ({paidAt}). {points} Điểm đã chuyển sang Giữ chờ hoàn tiền." or "Không hợp lệ · không giữ Điểm" + the ineligible explanation per `ineligibleReason` (Dev Notes copy).
   - GIAO DỊCH GỐC: Mã giao dịch, Số tiền, Số Điểm, Thanh toán lúc, Mã PayOS (`providerReference` when present).
   - TÀI KHOẢN NHẬN (TÀI KHOẢN GỐC TỪ PAYOS), verified: Ngân hàng, Số tài khoản (**full number**), Chủ tài khoản, Số tiền chuyển, Nội dung CK = `RESCOM HOAN {orderCode}`, each with a Copy button, and the caption "Tài khoản đã thanh toán lần nạp này. Chỉ chuyển hoàn về tài khoản này." Unverified: amber block "PayOS không trả thông tin tài khoản đã thanh toán" / "Liên hệ user qua email trước khi chuyển khoản. Chỉ chuyển sau khi xác minh đúng tài khoản đã dùng để thanh toán. Đối chiếu tên chủ tài khoản trên sao kê ngân hàng." + the user email + "Copy email"; any partial facts (bankId, number) shown below as "chưa xác minh".
   - LÝ DO CỦA USER: reason label + quoted note.
   - AUDIT TRAIL derived from the request row (Dev Notes "Audit trail").
   - Resolved requests show the outcome (Đã hoàn tiền / Từ chối + reason / Đã rút) and no resolve actions (UX-DR-P12).
4. **Mark Refunded (`ResolveTopUpRefund` REFUNDED).** "Đánh dấu Đã hoàn tiền" is enabled only for a `REQUESTED` request with a hold (`eligibility = ELIGIBLE`, `holdJournalId` set); otherwise disabled with hint "Chỉ bật khi Điểm đang bị giữ". Its dialog (Figma `189:1357`, copy amended per UX-DR-P22, Dev Notes) states "Đánh dấu trước, rồi chuyển khoản", the destination, that {points} held Points are removed and that it cannot be undone, with optional "Mã giao dịch ngân hàng" and "Thời điểm chuyển" fields. For an unverified destination the dialog requires the checkbox "Tôi đã xác minh tài khoản nhận với user qua email" (server-enforced, Decision D3). Confirm runs `ResolveTopUpRefund` REFUNDED: one journal `REFUND_HOLD → SYSTEM_CLEARING` for `points`, key `topup-refund-resolve:{requestId}`, linked to the top-up by `topUpJournalId`, **never** `reversesJournalId` (AD-1, AD-26, UX-DR-P22).
5. **Bank transfer facts.** `TopUpRefundRequest` gains optional `bankTransferReference` (trim 1–100) and `bankTransferredAt`. They can be given in the mark dialog or set once later from the drawer ("Thêm mã chuyển khoản") on a `REFUNDED` request: a second set → 409 `REFUND_BANK_TRANSFER_ALREADY_RECORDED` (an identical replay → 200 `replayed`). `bankTransferredAt` must not be in the future (+5 min skew) nor before the request `createdAt`. The user DTO then returns them (13.11 A7 already renders them) (UX-DR-P17).
6. **Reject.** "Từ chối" opens a dialog (Figma `189:1884` held, `189:1621` hold-less) with a required reason (trim 1–500, counter "N/500", "User sẽ thấy nội dung này trong thông báo và trên giao dịch."). Held: "{points} Điểm đang giữ sẽ trả lại Khả dụng của user." and resolve posts `REFUND_HOLD → USER_AVAILABLE` (same `topup-refund-resolve:{requestId}` key). Hold-less: checkbox "Tôi đã chuyển trả tiền thủ công" ("Chỉ dùng cho yêu cầu không giữ Điểm: ghi nhận đã trả tiền ngoài hệ thống, không trừ Điểm của user.") stored as `manualTransferRecorded = true`, no journal; the checkbox on a held request → 400 `VALIDATION_ERROR`. Footer: "Mỗi giao dịch chỉ gửi yêu cầu 1 lần; sau khi từ chối, user không gửi lại được."
7. **Exclusive terminal transition.** Resolve and withdraw lock in the same order (TopUpRequest row → TopUpRefundRequest row → ledger accounts ascending) and compare-and-set from `REQUESTED`. Withdrawal and resolution of the same request cannot both succeed: the loser gets 409 `REFUND_ALREADY_RESOLVED` (withdraw already does on REFUNDED/REJECTED; resolve does on WITHDRAWN or a different terminal decision). Same-decision replay → 200 `replayed: true`, no writes. Proven by a Prisma concurrency test (withdraw ‖ REFUNDED, withdraw ‖ REJECTED, REFUNDED ‖ REJECTED).
8. **Side effects.** Every resolution, in the same transaction: user notification event (`ECONOMY_TOPUP_REFUND_CHANGED`, status widened to `REFUNDED|REJECTED`) → in-app + email: REFUNDED → `TOPUP_REFUNDED`, REJECTED → new `TOPUP_REFUND_REJECTED` (appended to `NOTIFICATION_TYPES` and `EMAIL_NOTIFICATION_TYPES`); the Moderation admin-audit event (`auditCategory: MODERATION_ADMIN_ACTION`, reason length only, never the account number). Requires the admin capability (role ADMIN + ACTIVE) and refuses the admin's own request (`TOPUP_SELF_REVIEW_FORBIDDEN`). No balance goes negative. Works when the user is LOCKED/banned (no user-status check; a ban never touches `REFUND_HOLD`) (FR-57, FR-78).
9. **CSV.** The 13.8 export (`POST /admin/top-ups/payos/export`) appends columns `refundStatus`, `refundResolvedAt`, `bankTransferReference` (empty when no request); still no account number and still audit-logged (FR-78, UX-DR-P20).
10. **Point history.** The user's history labels the `REFUND_HOLD → SYSTEM_CLEARING` journal "Hoàn tiền nạp Điểm" with a link to `/wallet/top-up/{topUpId}`; the REJECTED release (`topup-refund-resolve:` journal crediting `USER_AVAILABLE`) reuses "Hoàn lại từ giữ chờ hoàn tiền" (FR-31). Admin transactions view mirrors the labels.
11. **Responsive + mock.** Desktop 1440 per Figma; minimal mobile (390) list + detail per `190:2230` / `190:2297` (cards, actions in a sticky footer, no CSV on mobile, no horizontal page scroll). MSW supports every state above.

## Tasks / Subtasks

- [x] **Task 0: Preconditions**
  - [x] `git status --short --branch` → `feat/13-12-admin-refund-resolution` (created 2026-10-17 from `origin/develop` `04a6213`, 13.11 PR #48 merged, upstream unset). Push later with `git push -u origin feat/13-12-admin-refund-resolution`.
  - [x] UI gate satisfied: Figma page 30 B1 refunds + B2 frames re-read via Figma MCP on 2026-10-17 (Dev Notes "Figma").
- [x] **Task 1: Shared contracts** — `packages/schemas/src/economy/` (+ specs, `index.ts` exports) (AC 1–9)
  - [x] `top-up-refund.schema.ts`:
    - `TOP_UP_REFUND_SLA_BUSINESS_DAYS = 3`; `TOP_UP_REFUND_REJECTION_REASON_MAX = 500`; `TOP_UP_REFUND_BANK_REFERENCE_MAX = 100` (13.11 user schema already uses 500/100 — make those use the constants).
    - `resolveTopUpRefundSchema` = `z.discriminatedUnion('decision', [ { decision: 'REFUNDED', destinationConfirmed: z.boolean().optional(), bankTransferReference: trim 1–100 optional, bankTransferredAt: datetime optional }.strict(), { decision: 'REJECTED', reason: trim 1–500, manualTransferRecorded: z.boolean().default(false) }.strict() ])`.
    - `recordTopUpRefundBankTransferSchema` (`.strict()`): `{ bankTransferReference?: trim 1–100, bankTransferredAt?: datetime }` refined "at least one".
    - Admin DTOs: `adminTopUpRefundListItemSchema` `{ id, topUpId, orderCode, userId, userEmail|null, userName|null, amountVnd, points, status, eligibility, ineligibleReason|null, reason, destinationVerified, heldPoints (points when hold else 0), submittedAt, dueAt, overdue, resolvedAt|null }`; `adminTopUpRefundDetailSchema` = list item + `{ note, paidAt, providerReference|null, destination: { bankId, bankName, holderName, accountNumber (full), verified }, rejectionReason|null, manualTransferRecorded, bankTransferReference|null, bankTransferredAt|null, bankTransferRecordedAt|null, withdrawnAt|null, resolvedBy: { id, email|null }|null, holdJournalId|null, resolveJournalId|null }`; list query `{ status: 'OPEN'|'RESOLVED'|'ALL' = 'OPEN', verdict: 'ALL'|'ELIGIBLE'|'NOT_ELIGIBLE' = 'ALL', q?: trim ≤ 100, page ≥ 1 }`; list response `{ items, total, page, pageSize }`; resolve/bank-transfer result `{ request: adminTopUpRefundDetailSchema, replayed }`.
    - Widen `topUpRefundChangedPayloadSchema.status` to `REQUESTED|WITHDRAWN|REFUNDED|REJECTED` and add optional `rejectionReason` (≤ 500). **Keep `schemaVersion: 1`** (additive) and leave `topUpRefundAdminNoticePayloadSchema` at `REQUESTED|WITHDRAWN` (no admin notice on resolution).
  - [x] `payos-top-up.schema.ts`: `topUpAdminAlertConditionSchema` + `REFUND_SLA_BREACHED`; alert event gains optional `refundRequestId`; `adminTopUpTabCountsSchema` + `refunds`.
  - [x] `top-up.schema.ts:175` `TOP_UP_AUDIT_EVENT_TYPES` + `REFUND_RESOLVED: 'AdminTopUpRefundResolved'`, `REFUND_BANK_TRANSFER_RECORDED: 'AdminTopUpRefundBankTransferRecorded'`.
  - [x] `notifications/notification.schema.ts`: **append** `TOPUP_REFUND_REJECTED` (never reorder); `email-delivery.schema.ts` `EMAIL_NOTIFICATION_TYPES` + `TOPUP_REFUND_REJECTED`.
  - [x] Specs: discriminated union (REFUNDED with/without bank facts, REJECTED reason 0/1/500/501/whitespace, unknown key, `manualTransferRecorded` default), bank-transfer "at least one", payload widening (13.10-shaped payload still parses), admin detail allows full `accountNumber` while `topUpRefundAdminNoticePayloadSchema` still rejects it, notification append order.
- [x] **Task 2: DB** (AC 4–8)
  - [x] Prisma `TopUpRefundRequest` (`schema.prisma:1091`): add `rejectionReason String? @db.VarChar(500)`, `manualTransferRecorded Boolean @default(false)`, `resolvedByAdminId String? @db.Uuid` (relation → `User`, Restrict, back-relation on `User`), `resolveJournalId String? @unique @db.Uuid` (relation → `LedgerJournal` "TopUpRefundResolveJournal", back-relation), `bankTransferReference String? @db.VarChar(100)`, `bankTransferredAt DateTime?`, `bankTransferRecordedAt DateTime?`. `resolvedAt` already exists. `NotificationType` + `TOPUP_REFUND_REJECTED`. **Declare the relations in `schema.prisma`** (13.10 review lesson: FKs only in SQL = drift).
  - [x] Migrations after `20261021100000_top_up_refund_request`: `20261022090000_notification_type_topup_refund_rejected` (enum ADD VALUE alone, model `20261019100000_…`) and `20261022100000_top_up_refund_resolution` (columns, FKs, unique index, CHECKs).
  - [x] CHECKs in the migration **and** `prisma/sql/post-push-invariants.sql` (refund block added by 13.10, same idempotent DO-block style): `…_resolved_check` `(status IN ('REFUNDED','REJECTED')) = (resolved_at IS NOT NULL AND resolved_by_admin_id IS NOT NULL)`; `…_refunded_check` `status <> 'REFUNDED' OR (hold_journal_id IS NOT NULL AND resolve_journal_id IS NOT NULL)`; `…_rejected_check` `(status = 'REJECTED') = (rejection_reason IS NOT NULL)` and `char_length(btrim(rejection_reason)) BETWEEN 1 AND 500`; `…_manual_transfer_check` `NOT manual_transfer_recorded OR (status = 'REJECTED' AND hold_journal_id IS NULL)`; `…_bank_transfer_check` `(bank_transfer_reference IS NULL AND bank_transferred_at IS NULL) OR status = 'REFUNDED'` and `(bank_transfer_recorded_at IS NULL) = (bank_transfer_reference IS NULL AND bank_transferred_at IS NULL)`; `…_resolve_journal_check` `resolve_journal_id IS NULL OR status IN ('REFUNDED','REJECTED')`. Withdraw keeps `release_journal_id`; resolve uses `resolve_journal_id` (both never set together — add `release_journal_id IS NULL OR resolve_journal_id IS NULL`).
  - [x] Run `migration-chain.prisma.e2e-spec.ts`, `notification-type.parity.spec.ts`.
- [x] **Task 3: Ledger** — `ledger.service.ts` (AC 4, 6, 10)
  - [x] `refundTopUpRefundHold({ requestId, userId, points, topUpId, orderCode })` (template `releaseTopUpRefundHold` :2699): `getOrCreateAccount(userId,'REFUND_HOLD')` + `getOrCreateAccount(null,'SYSTEM_CLEARING')` before locks; key `topUpRefundResolveKey(requestId)`; entries REFUND_HOLD −points, SYSTEM_CLEARING +points; description `Top-up refund: order {orderCode} · top-up {topUpId}` (FE parses the UUID for the history link, AC 10); fast-path replay with `assertReplayCompatible(existing, entries, 'exact')`. REFUND_HOLD is non-overdraftable, so a missing hold throws `InsufficientBalanceException` (bug guard; the service checks first).
  - [x] REJECTED with hold: call the existing `releaseTopUpRefundHold({ …, key: topUpRefundResolveKey(requestId) })` (13.10 designed the `key` param for this).
  - [x] `spend-journals.completeness.spec.ts`: add `refundTopUpRefundHold` to the exercised methods (it does not debit `USER_AVAILABLE`; `topup-refund-resolve:` is already NON_SPEND, `domain/spend-journals.ts:20`). `reverseJournal` already refuses the resolve prefix (`ledger.service.ts:565-576`) — add a test if none covers it.
- [x] **Task 4: Repository** — port `payos-top-up-repository.port.ts`, `prisma-payos-top-up.repository.ts`, `in-memory-payos-top-up.repository.ts` (AC 1–9)
  - [x] `TopUpRefundRow` (port :15) gains the Task 2 fields.
  - [x] `findRefundRequestById(id)` (unlocked, for `topUpId`), `lockRefundRequestById(id)` (`SELECT … FOR UPDATE`; resolve locks the top-up row first via `lockTopUpForRefund(topUpId)`, then this).
  - [x] `resolveRefundRequest(id, { status, resolvedAt, resolvedByAdminId, resolveJournalId|null, rejectionReason|null, manualTransferRecorded, bankTransferReference|null, bankTransferredAt|null, bankTransferRecordedAt|null }, events[])` — `updateMany where { id, status: 'REQUESTED' }` CAS + `outboxEvent.createMany` in one `runInTransaction` → `{ changed }`.
  - [x] `recordRefundBankTransfer(id, { bankTransferReference|null, bankTransferredAt|null, recordedAt }, events[])` — CAS `where { id, status: 'REFUNDED', bankTransferRecordedAt: null }`.
  - [x] `listRefundRequestsForAdmin({ status, verdict, q, page, pageSize, now })` (join top-up for `orderCode`/`paidAt`/`providerReference`, user for email/name; `q` matches orderCode (digits) or email `ILIKE`); open sort: `createdAt asc` (= due asc, business days are monotonic); resolved: `resolvedAt desc`; returns `{ items, total }`. `findRefundRequestForAdmin(id)` (detail incl. resolver email). **Full account number only in these admin reads.**
  - [x] `countOpenRefundRequests()`; `listOverdueRefundCandidates(cutoff)` = `REQUESTED` with `createdAt <= now − 3 days` (calendar prefilter; the service filters with `addBusinessDays`) — `ponytail:` comment: full scan of open rows, fine at pilot volume (index `[status, createdAt]` exists).
  - [x] `listForExport` row type (port :221) + both repos: left join refund → `refundStatus`, `refundResolvedAt`, `bankTransferReference`.
  - [x] In-memory repo mirrors CAS semantics and joins.
- [x] **Task 5: Service** — new `application/admin-top-up-refund.service.ts` (keep `top-up-refund.service.ts` user-side; register in `economy.module.ts`) (AC 1–8)
  - [x] `list(query, now)` / `get(id)` → admin DTOs; `dueAt = addBusinessDays(createdAt, TOP_UP_REFUND_SLA_BUSINESS_DAYS)`, `overdue = status === 'REQUESTED' && now >= dueAt`.
  - [x] `resolve(requestId, rawBody, { adminId, correlationId })` — template `payos-top-up.service.ts resolveMismatch` :182-300:
    1. `resolveTopUpRefundSchema.parse`; `findRefundRequestById` → none → 404 `TOPUP_REFUND_NOT_FOUND`.
    2. `unitOfWork.run(topUpRefundResolveKey(requestId), …)`: `lockTopUpForRefund(topUpId)` → `lockRefundRequestById(requestId)` (lock order AC 7).
    3. Admin capability (`adminCapability.findCurrentCapability`) → `TOPUP_ADMIN_CAPABILITY_REQUIRED`; `row.userId === adminId` → `TOPUP_SELF_REVIEW_FORBIDDEN`.
    4. Status: same terminal decision → 200 `{ replayed: true }` (no writes; ignore differing bank facts — use the bank-transfer route); `WITHDRAWN` or other terminal → 409 `REFUND_ALREADY_RESOLVED`.
    5. REFUNDED: no hold → 409 `REFUND_NOT_HELD`; `!destinationVerified && destinationConfirmed !== true` → 409 `REFUND_DESTINATION_UNCONFIRMED`; validate `bankTransferredAt` (AC 5) → 400 `VALIDATION_ERROR`; `ledgerService.refundTopUpRefundHold(...)`.
    6. REJECTED: `manualTransferRecorded && holdJournalId` → 400 `VALIDATION_ERROR`; hold → `releaseTopUpRefundHold({ key: topUpRefundResolveKey })`; no hold → no journal.
    7. Events: user `TOP_UP_REFUND_CHANGED` (key `topup-refund-notice:{id}:{STATUS}`, aggregateVersion 3) with `rejectionReason` on REJECTED; audit (key `admin-audit:topup-refund:{id}`, `REFUND_RESOLVED`, payload `{ auditCategory: 'MODERATION_ADMIN_ACTION', action: 'TOPUP_REFUND_RESOLVED', decision, requestId, topUpId, adminId, correlationId, occurredAt, reasonLength, manualTransferRecorded, destinationConfirmed }`).
    8. `resolveRefundRequest` CAS; `changed=false` after the lock = bug → throw. Return `{ request: get(id), replayed: false }`.
  - [x] `recordBankTransfer(requestId, rawBody, ctx)`: same lock order + capability check (self-review check too); status ≠ REFUNDED → 409 `REFUND_NOT_REFUNDED`; already recorded: identical → 200 replayed, else 409 `REFUND_BANK_TRANSFER_ALREADY_RECORDED`; validate time; CAS + audit (`admin-audit:topup-refund-bank:{id}`, `REFUND_BANK_TRANSFER_RECORDED`, no reference text in the payload).
  - [x] `tabCounts` (`payos-top-up.service.ts:174`) gains `refunds: countOpenRefundRequests()`.
  - [x] `exportForAdmin` (:302-373) adds the 3 columns (AC 9; times `+07:00` like `paidAt`).
  - [x] `top-up-refund.service.ts` `toUserRefundDto` (:370): map `resolvedAt`, `rejectionReason`, `bankTransferReference`, `bankTransferredAt` (13.11 D1 optional fields — now filled).
  - [x] Exceptions (`economy.exceptions.ts`, `readonly code` + status, 13.9 pattern; check `http-exception.filter.ts` mapping): `REFUND_NOT_HELD` 409, `REFUND_DESTINATION_UNCONFIRMED` 409, `REFUND_NOT_REFUNDED` 409, `REFUND_BANK_TRANSFER_ALREADY_RECORDED` 409. Reuse `RefundAlreadyResolvedException` (:349), `TOPUP_REFUND_NOT_FOUND`, capability/self-review exceptions.
- [x] **Task 6: Controller** — `presentation/admin-top-up.controller.ts` (`@Controller(['admin/top-ups','api/admin/top-ups'])`, `SessionAuthGuard, RolesGuard`, `@Roles('ADMIN')`) (AC 1–6)
  - [x] `GET refunds` (query via `ZodValidationPipe`, `Cache-Control: no-store`), `GET refunds/:requestId` (`ParseUUIDPipe`), `POST refunds/:requestId/resolve` and `POST refunds/:requestId/bank-transfer` (`@HttpCode(200)`, `CsrfGuard, JsonOnlyGuard`, `x-correlation-id`, `createSuccessEnvelope(schema.parse(...))`). Declare the static `refunds` routes **before** any `:id` route so `refunds` is not captured as a top-up id. Not gated by `PAYOS_ENABLED`.
- [x] **Task 7: Notifications + alert** (AC 2, 8)
  - [x] `application/top-up-refund-notification.handler.ts`: add `REFUNDED` → `TOPUP_REFUNDED` "Đã hoàn {amount} cho giao dịch nạp mã {orderCode} về tài khoản đã thanh toán. {points} Điểm đang giữ đã bị trừ." and `REJECTED` → `TOPUP_REFUND_REJECTED` "Yêu cầu hoàn tiền cho giao dịch nạp mã {orderCode} bị từ chối. Lý do: {rejectionReason}." + (held) " {points} Điểm đã trở lại Khả dụng." (`ASSUMED (design)`). Existing branches byte-identical.
  - [x] `notifications/application/email-templates.ts:91` `TOPUP_REFUNDED`: today's body is mismatch-specific ("…hoàn tiền thủ công. Không có Điểm nào được cộng."). Make it generic for both producers: "Giao dịch nạp điểm của bạn đã được hoàn tiền về tài khoản đã thanh toán. Chi tiết (số tiền, Điểm) có trong Ví Rescom." (Decision D5). Add `TOPUP_REFUND_REJECTED`: subject "Rescom: Yêu cầu hoàn tiền bị từ chối", body "Yêu cầu hoàn tiền nạp điểm của bạn đã bị từ chối. Lý do và số dư cập nhật có trong Ví Rescom." + support sentence + wallet link. Update the template spec.
  - [x] Alert: `infrastructure/jobs/payos-reconcile.job.ts` — new step after the mismatch SLA step (:165-180 pattern): `listOverdueRefundCandidates`, keep `addBusinessDays(createdAt,3) <= now`, `alerts.raise('REFUND_SLA_BREACHED', requestId, { topUpId, orderCode, amountVnd, refundRequestId })`. `top-up-admin-alert.handler.ts renderMessage` (:47-62) adds "Yêu cầu hoàn tiền #{orderCode} quá hạn 3 ngày làm việc — xử lý tại /admin/top-ups?tab=refunds&request={requestId}." A failure in this step must not stop the reconcile steps (isolate like the other steps).
- [x] **Task 8: FE contract + lib** — `apps/frontend/my-app/lib/admin/` (AC 1–6)
  - [x] `payos-top-up-admin-service.ts`: `listAdminTopUpRefunds(query)`, `getAdminTopUpRefund(id)`, `resolveAdminTopUpRefund(id, body)` (`resolveTopUpRefundSchema.parse` first), `recordAdminTopUpRefundBankTransfer(id, body)`; `apiRequest` + schema as the existing functions (CSRF is automatic).
  - [x] New pure `lib/admin/payos-top-up-refund.ts`: `refundSla(row, now)` → `{ overdue, line: "Quá hạn"|"Còn N ngày", dueLabel: "Hạn dd/MM" }` (model `mismatchSla` in `payos-top-up-mismatch.ts`, use `businessDaysUntil`); `verdictChip(row)` (Hợp lệ green / Không hợp lệ amber); `verdictShortReason(row)` (Dev Notes copy); `verdictExplanation(detail)`; `refundTransferContent(orderCode)` = `RESCOM HOAN {orderCode}`; `auditTrail(detail)` (Dev Notes); `rejectReasonState(text)` (trim, counter, max 500, copy "Nhập lý do từ chối — user sẽ thấy nội dung này."); `bankTransferState(input, now)`; `refundStatusChip(status, eligibility)` (reuse `topUpChip`'s refund variants from `lib/wallet/top-up-history.ts`). Reuse `refundReasonLabel` (`lib/wallet/top-up-refund.ts:26`), `formatVietnamDateTime`/`formatVietnamDate` (:184/:198); **never** re-implement business days.
  - [x] `payos-top-up-admin-messages.ts` `payosAdminErrorMessage`: add `REFUND_ALREADY_RESOLVED` "Yêu cầu đã được xử lý" (+ reload), `REFUND_NOT_HELD`, `REFUND_DESTINATION_UNCONFIRMED`, `REFUND_NOT_REFUNDED`, `REFUND_BANK_TRANSFER_ALREADY_RECORDED`, `TOPUP_REFUND_NOT_FOUND`, `TOPUP_SELF_REVIEW_FORBIDDEN` (fixed Vietnamese copy, no raw server message).
- [x] **Task 9: FE screens** — `app/(signed-in)/(admin)/admin/top-ups/components/` (AC 1, 3–6, 11)
  - [x] `TopUpTabs.tsx`: `ConsoleTab` + `"refunds"` (second), badge `counts.refunds`; `TopUpConsoleScreen.tsx` tab parse + render branch (keep `?id=` legacy param and `select()` behavior).
  - [x] New `RefundRequestsPanel.tsx` (model `ActionRequiredPanel.tsx` + `PayosTopUpsPanel.tsx` filters/pager): reads `request` query param on mount to open the drawer (fetch detail by id; 404 → toast "Không tìm thấy yêu cầu"), clears it on close via `router.replace`; reloads list + counts (`onChanged`) after each action.
  - [x] New `RefundDrawer.tsx` (drawer = `Dialog` `className="ml-auto mr-0 h-dvh max-h-dvh rounded-none p-5"` `width={560}`, `dismissible={!busy}`, `key={selected?.id}`; toasts rendered **inside** the dialog — 13.8 top-layer gotcha), sticky footer "Từ chối" (outline + x) / "Đánh dấu Đã hoàn tiền" (filled + check), "Thêm mã chuyển khoản" on REFUNDED without facts. Copy buttons: `IconButton icon="copy"` + `copyTextToClipboard` (`lib/clipboard.ts:18`), toast "Đã sao chép" / failure; no new CopyButton primitive.
  - [x] New `MarkRefundedDialog.tsx`, `RejectRefundDialog.tsx`, `BankTransferDialog.tsx` (model `RejectTopUpDialog.tsx`; `Dialog`, `Textarea` with counter, `Checkbox`, native `<input type="datetime-local">` for the time — no picker dependency; unique `labelledBy` ids; `Button loading`; non-dismissible while submitting; errors in an `Alert` inside the dialog).
  - [x] On `REFUND_ALREADY_RESOLVED`: close dialogs, show "Yêu cầu đã được xử lý", reload detail + list (UX-DR-P25).
  - [x] Mobile (< md): rows → cards (name, "{orderCode} · {amount}", "giữ N Điểm" / short reason, SLA), drawer full-width, footer actions sticky, CSV hidden with the note "Mobile chỉ để xem và xử lý nhanh. Bảng đầy đủ, bộ lọc và xuất CSV dùng trên desktop."
- [x] **Task 10: FE history + notifications** (AC 8, 10)
  - [x] `lib/wallet/wallet-history.ts`: new kind `TOP_UP_REFUND` ("Hoàn tiền nạp Điểm", direction out). `topup-refund-resolve:` journals: if the user's `USER_AVAILABLE` is credited → `TOP_UP_REFUND_RELEASE` (existing label), else `TOP_UP_REFUND`. Implement in `historyKindOf` / grouping (the prefix alone is ambiguous). Expose `topUpHref` = `/wallet/top-up/{uuid}` parsed from the description `· top-up {uuid}` (strict UUID regex; null when absent) and render it as a link in the history row component (find where `notesOf`/rows render; keep other rows unchanged).
  - [x] Mirrors: `mocks/data/economy-rules.ts` (union :26-27, switch :254/259, key builder :332-335), `mocks/data/economy.ts:389-434` helpers, `lib/admin/admin-transactions.ts:151-152`.
  - [x] `lib/notifications/notification-presentation.ts`: `TOPUP_REFUND_REJECTED` { icon `x-circle`, tone danger, href `/wallet` }, title "Yêu cầu hoàn tiền bị từ chối" (both maps — parity test `notification-center.test.mjs:80`).
- [x] **Task 11: MSW** (AC 11)
  - [x] `mocks/handlers/admin-payos-top-ups.ts`: `GET /admin/top-ups/refunds`, `GET /admin/top-ups/refunds/:requestId`, `POST …/:requestId/resolve`, `POST …/:requestId/bank-transfer` (each `http.<m>(apiUrl("…"), …` on **one line** — `tests/route-diff.test.mjs`); same rules/codes as the backend; resolve updates the shared mock top-up refund state (so the user's A7 view in mock mode reflects it) and the mock wallet (REFUNDED: refundHold −points; REJECTED held: refundHold → available) and adds `topup-refund-resolve:` mock ledger entries. `topUpTabCounts` (`mocks/data/admin-payos-top-ups.ts:60`) + `refunds`. Export mock (:74) gains the 3 columns.
  - [x] Seeds: the 13.11 refund rows (`mocks/data/top-up.ts` ~283–376) + 3 open requests for other fake users matching Figma (eligible overdue, not eligible due in 1 day, eligible unverified) — fake names/numbers only (repo is public). Bump `SCHEMA_VERSION` (`mocks/db/store.ts:33`) 15 → 16 with a comment.
- [x] **Task 12: Tests** (every bullet needs a real assertion — 13.9/13.10 reviews caught ticked-but-untested bullets)
  - [x] Schemas (Task 1 specs).
  - [x] Backend unit `admin-top-up-refund.service.spec.ts`: REFUNDED (journal key/entries/description, events ×2, CAS fields), REFUNDED on hold-less → `REFUND_NOT_HELD`, unverified without/with `destinationConfirmed`, REJECTED held (release via resolve key) / hold-less / hold-less + manual / held + manual → 400, replay same decision → `replayed` no writes, different decision → 409, WITHDRAWN → 409, capability + self-review, 404, bank transfer set once / replay / conflict / non-REFUNDED / future time / before createdAt, list filters + sort + `dueAt`/`overdue` across a weekend, detail full number, LOCKED user resolves, `toUserRefundDto` maps the 4 fields, CSV columns. Notification handler REFUNDED/REJECTED copy; email template both types; alert handler message; reconcile job raises once (second run no new Outbox row) and skips non-overdue/resolved.
  - [x] Prisma e2e `test/top-up-refund-resolution.prisma.e2e-spec.ts` (harness `test/fixtures/financial-pg-harness.ts`, model `top-up-refund.prisma.e2e-spec.ts`): races withdraw ‖ REFUNDED, withdraw ‖ REJECTED, REFUNDED ‖ REJECTED, each repeated N times → exactly one terminal state, one journal, the loser 409 `REFUND_ALREADY_RESOLVED`, balances non-negative, wallet `refundHold` back to 0; CHECKs reject REFUNDED without `resolve_journal_id` and bank facts on REJECTED.
  - [x] HTTP e2e `test/top-up-refund.e2e-spec.ts`: 401, non-admin 403, no CSRF 403, 400 bodies (unknown decision, reason 501, extra key, manual on held), 404, full account number present on admin detail and absent from the user notification/audit Outbox payloads, works with `PAYOS_ENABLED=false`, `refunds` static route not captured by `:id`.
  - [x] FE `tests/admin-top-ups-refunds.test.mjs`: `refundSla` (weekend, overdue), verdict chip/short reason, audit trail order, reject/bank state validators, error messages per code; extend `admin-top-ups-console.test.mjs` (tab order + `refunds` badge), `wallet-history*.test.mjs` (refund vs release split, href parse, no href without UUID), `notification-center.test.mjs`, a mock test (`tests/admin-top-up-refund-mock.test.mjs`): resolve REFUNDED → user DTO REFUNDED + wallet moved, withdraw after resolve → 409, bank transfer twice → 409; `route-diff.test.mjs`; `no-direct-mocks` / `no-direct-url-state` include the new components.
  - [x] Regression: 13.10/13.11 suites (`top-up-refund*.e2e-spec.ts`, `top-up-refund.service.spec.ts`, FE `top-up-refund*.test.mjs`), 13.8/13.9 admin suites, `spend-journals.completeness.spec.ts`.
  - [x] Run: `npm test --workspace @rescom/schemas`; backend `npm test --workspace backend -- top-up ledger notification spend`, `npm run test:e2e --workspace backend -- top-up migration notification`, `npm run build --workspace backend`; FE in `apps/frontend/my-app`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
  - [x] Visual check in mock mode (playwright-cli on the running dev server; port 3100 per memory) at 1440 and 390 against the Dev Notes frames: tab default/overdue/empty/error, drawer eligible / not eligible / unverified / resolved, 3 dialogs incl. validation, bank-transfer add, conflict toast, user A7 Refunded/Rejected after an admin action, history label + link. Record deviations in Completion Notes.

### Review Findings

Code review 2026-10-17, chunk 1/2: backend + schemas + migrations (frontend + MSW pending a second run). Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor (all completed). 12 dismissed.

All 17 patches applied 2026-10-17 (uncommitted). Verified: schemas 695/695, backend unit (top-up ledger notification spend reconcile) 458/458, backend build, HTTP e2e `top-up-refund.e2e-spec.ts` 12/12, FE typecheck + 979/979 tests. **Not run:** Prisma e2e `top-up-refund-resolution.prisma.e2e-spec.ts` + migration e2e (Docker/Postgres :5433 down) — new concurrency/CHECK cases unexecuted. Extra: `tests/hybrid-mocking.test.mjs` stand-in re-exports `findMockUserById`.

- [x] [Review][Patch] (high) REJECTED with `manualTransferRecorded=true` on a held request is not refused → hits `manual_transfer_check` CHECK → 500 after hold release; AC6 requires 400 `VALIDATION_ERROR` before any posting [apps/backend/src/modules/economy/application/admin-top-up-refund.service.ts:206]
- [x] [Review][Patch] (high) `bankTransferredAt` never bounded (future > now+5 min, before request `createdAt`) in resolve and bank-transfer → must 400 `VALIDATION_ERROR` (AC5, Task 5.5/5.7) [apps/backend/src/modules/economy/application/admin-top-up-refund.service.ts:196]
- [x] [Review][Patch] (medium) `REFUND_DESTINATION_UNCONFIRMED` thrown for verified destinations too; rule is `!destinationVerified && destinationConfirmed !== true`, `REFUND_NOT_HELD` checked first, audit records the real `destinationConfirmed` (AC4, D3, Task 5.5) [apps/backend/src/modules/economy/application/admin-top-up-refund.service.ts:179]
- [x] [Review][Patch] (medium) `recordBankTransfer`: identical replay must return 200 `{ request, replayed: true }`, response shape must be `{ request, replayed }`, lock TopUp row before refund row, self-review/already-recorded checks inside the lock (AC5, AC7, API section; update e2e + FE service) [apps/backend/src/modules/economy/application/admin-top-up-refund.service.ts:307]
- [x] [Review][Patch] (medium) Audit payloads leak free text and never dedupe: REJECTED audit stores full `reason` (spec: `reasonLength`), bank-transfer audit stores reference text; keys append random `this.id()` instead of `admin-audit:topup-refund:{id}` / `admin-audit:topup-refund-bank:{id}`; field `requestId` (AC8, Task 5.7/5.8) [apps/backend/src/modules/economy/application/admin-top-up-refund.service.ts:254]
- [x] [Review][Patch] (medium) CSV header `refundBankReference` → `bankTransferReference` (AC9; MSW mock already uses `bankTransferReference`) [apps/backend/src/modules/economy/application/payos-top-up.service.ts:369]
- [x] [Review][Patch] (medium) Numeric `q` up to 100 digits → `parseInt` beyond Int4 `orderCode` → Prisma 500; only use the orderCode branch when ≤ 2147483647 [apps/backend/src/modules/economy/infrastructure/prisma-payos-top-up.repository.ts:1180]
- [x] [Review][Patch] (medium) `status=RESOLVED` ordered `resolvedAt desc`: WITHDRAWN rows (resolved_at NULL) sort first in Postgres; in-memory puts them last → use `nulls: 'last'` (or coalesce with `withdrawnAt`) in both repos [apps/backend/src/modules/economy/infrastructure/prisma-payos-top-up.repository.ts:1196]
- [x] [Review][Patch] (medium) Prisma concurrency/e2e coverage short of AC7/Task 12: missing withdraw ‖ REJECTED, REFUNDED ‖ REJECTED, CHECK-constraint assertions, held+manual → 400 against real DB, HTTP 401/403/no-CSRF/400/404/`PAYOS_ENABLED=false`, full account number absent from Outbox [apps/backend/test/top-up-refund-resolution.prisma.e2e-spec.ts]
- [x] [Review][Patch] (low) List page size 20 → 10 (AC1, API `pageSize: 10`) [apps/backend/src/modules/economy/application/admin-top-up-refund.service.ts:81]
- [x] [Review][Patch] (low) SLA: `overdue` uses `now > dueAt` while job uses `>=` → use `>=` everywhere (AC2, Task 5) [apps/backend/src/modules/economy/application/admin-top-up-refund.service.ts:420]
- [x] [Review][Patch] (low) `listOverdueRefundCandidates(ctx.now)` cutoff is a no-op → pass `now − 3 days` (Task 4) [apps/backend/src/modules/economy/infrastructure/jobs/payos-reconcile.job.ts]
- [x] [Review][Patch] (low) One failing `raiseAlert` aborts the rest of the refund SLA sweep → per-candidate try/catch [apps/backend/src/modules/economy/infrastructure/jobs/payos-reconcile.job.ts]
- [x] [Review][Patch] (low) `REFUND_SLA_BREACHED` message lacks the deep link "xử lý tại /admin/top-ups?tab=refunds&request={requestId}" (Task 7) [apps/backend/src/modules/economy/infrastructure/top-up-admin-alert.handler.ts]
- [x] [Review][Patch] (low) User event `aggregateVersion` 2 → 3 (Task 5.7) [apps/backend/src/modules/economy/application/admin-top-up-refund.service.ts:233]
- [x] [Review][Patch] (low) `orderCode` null handled three ways (`?? 0`, `?? undefined`, `!`); assert non-null once after lock and reuse [apps/backend/src/modules/economy/application/admin-top-up-refund.service.ts:239]
- [x] [Review][Patch] (low) `page` query param has no upper bound → huge `skip` → 500; add `.max(10_000)` [packages/schemas/src/economy/top-up-refund.schema.ts]

Code review 2026-10-17, chunk 2/2: frontend + MSW. Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor (all completed). 12 dismissed. Note: Completion Notes claim a Figma visual check, but the drawer/list/dialogs do not match AC1/AC3/AC4/AC6/AC11 copy or sections.

- [x] [Review][Decision] (resolved 2026-10-17 by Quan: re-run dev-story for Tasks 9–11; the chunk-2 patches below are its action items) FE UI broadly deviates from spec — Drawer lacks verdict card, SLA chip + header line, GIAO DỊCH GỐC (incl. `providerReference`), spec TÀI KHOẢN NHẬN block (copy buttons for every field, `RESCOM HOAN {orderCode}`, caption), unverified amber block + Copy email, AUDIT TRAIL, resolved-outcome copy; list columns/chips/SLA text/red overdue row/unverified marker/filter labels/footer/"Gần hạn trước"/CSV differ (AC1); Mark/Reject dialog copy per D4/AC6 missing (N/500 counter, footer, "không hoàn tác được"); no mobile cards + sticky footer (AC11). Helpers `auditTrail`, `verdictChip`, `verdictExplanation`, `refundSla`, `refundTransferContent`, `rejectReasonState`, `bankTransferState` exist but are unused. Choose: re-run dev-story for Tasks 9–11 (UI rework against Figma) vs patch in this review.
- [x] [Review][Patch] (high) Deep link `?tab=refunds&request={id}` not implemented: open drawer on load, 404 toast + drop param, write/remove param on open/close (AC3, Task 9) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx]
- [x] [Review][Patch] (high) Dialog state (confirm checkbox, reason, bank ref, time) survives close and carries to another request → `key={selected.id}` / reset on open and after submit [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/MarkRefundedDialog.tsx]
- [x] [Review][Patch] (high) "Đánh dấu Đã hoàn tiền" enabled for hold-less requests (always 409 `REFUND_NOT_HELD`) → disable with hint "Chỉ bật khi Điểm đang bị giữ"; confirm checkbox only for unverified destination, D4 wording (AC4, D3) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundDrawer.tsx]
- [x] [Review][Patch] (high) Reject dialog shows manual-transfer checkbox on held requests (backend 400) and claims points return using `item.points` on hold-less → checkbox only when `heldPoints === 0`, release text only when `heldPoints > 0`, spec copy (AC6) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RejectRefundDialog.tsx]
- [x] [Review][Patch] (high) Wallet history labels the REJECTED release (`topup-refund-resolve:` crediting `USER_AVAILABLE`) as "Hoàn tiền nạp Điểm"/out → classify by entries ("Hoàn lại từ giữ chờ hoàn tiền"); add `/wallet/top-up/{topUpId}` link from `· top-up {uuid}`; tests (AC10) [apps/frontend/my-app/lib/wallet/wallet-history.ts:95]
- [x] [Review][Patch] (medium) 409/404 on resolve/bank-transfer only toast: refetch detail + list, close dialog, `onChanged()`; 404 closes drawer (UX-DR-P25) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx]
- [x] [Review][Patch] (medium) Page size 20 → 10 in panel and MSW handler (AC1) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx:28]
- [x] [Review][Patch] (medium) Empty search sends `q=undefined` (`String(undefined)`) → drop undefined entries before `URLSearchParams` [apps/frontend/my-app/lib/admin/payos-top-up-admin-service.ts:47]
- [x] [Review][Patch] (medium) MSW resolve diverges from backend: no `REFUND_NOT_HELD`, same-decision returns 409 not `replayed`, held+manual accepted (should 400), no `bankTransferredAt` bounds, no self-review 403, `bankTransferRecordedAt` not set when facts given at resolve [apps/frontend/my-app/mocks/handlers/admin-payos-top-ups.ts]
- [x] [Review][Patch] (medium) MSW payout/release not tied to this request's hold: `min(refundHold, points)` can consume another request's hold; NOT_ELIGIBLE REFUNDED writes `-points` row [apps/frontend/my-app/mocks/data/economy.ts]
- [x] [Review][Patch] (medium) MSW list: RESOLVED excludes WITHDRAWN, sort always `submittedAt desc` (spec: open due asc, resolved `resolvedAt desc` nulls last), overdue `>` vs `>=` [apps/frontend/my-app/mocks/data/admin-payos-top-ups.ts]
- [x] [Review][Patch] (medium) MSW seeds miss Figma states (3 open: eligible overdue, not-eligible due in 1 day, eligible unverified); detail masks account number `****last4` and never sets `holdJournalId`/`resolvedBy` [apps/frontend/my-app/mocks/data/admin-payos-top-ups.ts]
- [x] [Review][Patch] (medium) Toasts render in the panel behind the modal top layer (13.8 gotcha); dialogs have no inline error `Alert` [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx]
- [x] [Review][Patch] (medium) Copy uses raw `navigator.clipboard.writeText` without await/catch, shows "Đã chép" on failure → reuse `copyTextToClipboard` + toast [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundDrawer.tsx:41]
- [x] [Review][Patch] (medium) Dialogs skip client validation (`bankTransferState`): future / before `submittedAt` / blank ref only fail server-side; invalid `datetime-local` → `toISOString()` RangeError [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/BankTransferDialog.tsx]
- [x] [Review][Patch] (medium) Detail fetch has no stale guard (fast row A→B shows wrong request, actions target it); manual `loadList()` calls discard the abort → stale list overwrite [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx]
- [x] [Review][Patch] (low) Bank-transfer button shows "Cập nhật mã chuyển khoản" after facts recorded (always 409) → show "Thêm mã chuyển khoản" only when REFUNDED without facts (AC5) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundDrawer.tsx]
- [x] [Review][Patch] (low) Page empties after resolve on page N → empty state with hidden pager; step back to last page [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx]
- [x] [Review][Patch] (low) Copy drift: `TOPUP_REFUND_REJECTED` icon `x-circle`; `REFUND_ALREADY_RESOLVED` message "Yêu cầu đã được xử lý"; remove duplicate `computeRefundSla` (uses `>`) [apps/frontend/my-app/lib/admin/payos-top-up-refund.ts]
- [x] [Review][Patch] (low) a11y: dialog `<label>`s not bound to inputs, filter buttons lack `aria-pressed` [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RejectRefundDialog.tsx]
- [x] [Review][Patch] (low) Tests: no coverage for deep link, dialog rules, history REJECTED split/href, MSW NOT_HELD/replay/bounds; spec filename `tests/admin-top-ups-refunds.test.mjs` [apps/frontend/my-app/tests/admin-payos-refunds.test.mjs]

Code review 2026-10-17, re-review of FE rework (Tasks 9–11 + chunk-2 items): frontend + MSW only; backend fixes not re-reviewed yet. Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor (all completed). 7 dismissed.

- [x] [Review][Patch] (high) Drawer status chip calls `topUpChip(item.status, "PAYOS")` with a refund status → REQUESTED/REJECTED/WITHDRAWN render the raw enum; use `refundStatusBadge` [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundDrawer.tsx:82]
- [x] [Review][Patch] (high) Closing the drawer reopens it: `closeDetail` nulls `selected` but `requestParam` is still the old id until `router.replace` commits → deep-link effect calls `openDetail(requestParam)` again (also after 404 paths); guard with a closing ref or derive from the URL only [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx:178]
- [x] [Review][Patch] (medium) Server errors on resolve/reject/bank-transfer toast and close the dialog, discarding typed reason/reference; Task 9 requires an `Alert` inside the dialog, close only on `REFUND_ALREADY_RESOLVED`/404 (UX-DR-P25) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx:205]
- [x] [Review][Patch] (medium) `refundSla` ignores status → REFUNDED/REJECTED/WITHDRAWN past `dueAt` show red "Quá hạn" in list + drawer while row bg uses `row.overdue`; only REQUESTED can be overdue, add test [apps/frontend/my-app/lib/admin/payos-top-up-refund.ts:115]
- [x] [Review][Patch] (medium) MSW seeded REQUESTED/ELIGIBLE requests have no matching `wallet.refundHold` (fallback seed users) → resolve flips status with no ledger/wallet effect, `REFUND_NOT_HELD` never returned; seed holds or refuse like the backend [apps/frontend/my-app/mocks/handlers/admin-payos-top-ups.ts:904]
- [x] [Review][Patch] (medium) MSW bank-transfer handler lacks `bankTransferredAt` bounds (future > now+5 min, before `submittedAt`) and `TOPUP_SELF_REVIEW_FORBIDDEN` 403 (AC5, chunk-2 MSW item) [apps/frontend/my-app/mocks/handlers/admin-payos-top-ups.ts:183]
- [x] [Review][Patch] (medium) Ticked test items still untested: deep link open/404/close, dialog rules (manual checkbox only hold-less, confirm only unverified, Mark disabled hold-less), MSW bank-transfer bounds [apps/frontend/my-app/tests/admin-top-ups-refunds.test.mjs]
- [x] [Review][Patch] (low) Verdict card "Hợp lệ · đang giữ {points} Điểm" still shown after REFUNDED/REJECTED (AC3 outcome copy) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundDrawer.tsx:143]
- [x] [Review][Patch] (low) Any detail fetch failure (network/5xx) shows "Không tìm thấy yêu cầu" and strips `?request=`; only do that on 404 [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx:151]
- [x] [Review][Patch] (low) `?request=` survives tab switch (`select` only deletes `id` for payos) → returning to refunds reopens a stale drawer [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/TopUpConsoleScreen.tsx:19]
- [x] [Review][Patch] (low) CSV `from` = `new Date(y,0,1).toISOString()` in UTC+7 gives Dec 31 of previous year; `to` is UTC date — build both as local `yyyy-MM-dd` [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx:286]
- [x] [Review][Patch] (low) MSW `heldPoints` = `points` for REFUNDED and 0 only by status, not actual hold → "Điểm giữ" wrong after resolution [apps/frontend/my-app/mocks/data/admin-payos-top-ups.ts:223]
- [x] [Review][Patch] (low) MSW resolve note `#{orderCode} · top-up …` does not match backend `order {orderCode}` → history regex `/order (\d+)/` misses, row shows generic label [apps/frontend/my-app/mocks/data/economy.ts:470]
- [x] [Review][Patch] (low) Mobile layout switches at `lg`, spec says `< md` (Task 9, AC11) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx:402]
- [x] [Review][Patch] (low) Disabled-Mark hint "Chỉ bật khi Điểm đang bị giữ" is hover-only (`group-hover`), invisible on touch/keyboard (AC4) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundDrawer.tsx:387]
- [x] [Review][Patch] (low) `dueLabel` uses `formatShortDateTime` → "Hạn dd/MM HH:mm", spec "Hạn dd/MM" (AC1, Task 9) [apps/frontend/my-app/lib/admin/payos-top-up-refund.ts:129]
- [x] [Review][Patch] (low) Copy controls are text buttons "Chép"/"Copy email", spec `IconButton icon="copy"` (Task 9) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundDrawer.tsx:211]
- [x] [Review][Patch] (low) Mark dialog falls back to "Người dùng"/"—" for missing holder/number on unverified destinations; drawer drops `bankId`-only facts (D4, AC3) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/MarkRefundedDialog.tsx:48]
- [x] [Review][Patch] (low) Search sent untrimmed → whitespace-only query returns empty list [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx:76]

Code review 2026-10-17, re-review of BE fixes (chunk 1 after 17 patches): backend + schemas + migrations. Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor (all completed). 6 dismissed (unreachable `orderCode` null — refunds are PayOS-only; `TOPUP_REFUNDED` email text still correct for MANUAL_REFUNDED; admin free text in notification is plain text; `tabCounts.refunds` `.default(0)`; capability/self-review check order — `userId` immutable, no race; hard-coded copy nits).

- [x] [Review][Patch] (medium) (decided 2026-10-17 by Quan: option 2 → 409 `REFUND_ALREADY_RESOLVED` on any differing field) Idempotent replay ignores a different payload: REFUNDED replayed with other `bankTransferReference`/`bankTransferredAt`, or REJECTED replayed with other `reason`/`manualTransferRecorded`, returns 200 `replayed:true` and silently drops the new values. Options: (a) keep, document replay = status-only; (b) 409 `REFUND_ALREADY_RESOLVED` on any differing field (as `recordBankTransfer` does) [apps/backend/src/modules/economy/application/admin-top-up-refund.service.ts:166]
- [x] [Review][Patch] (medium) REJECTED notification says "N Điểm đã trở lại Khả dụng" from `eligibility==='ELIGIBLE' && points>0` although no release posts when `holdJournalId` is null (spec tests that state); add `holdReleased`/`heldPoints` to `topUpRefundChangedPayloadSchema`, set it in the service event, key the suffix on it (WITHDRAWN branch too) [apps/backend/src/modules/economy/application/top-up-refund-notification.handler.ts:46]
- [x] [Review][Patch] (medium) Task 12 ticked bullets without assertions: CSV `bankTransferReference` column, list weekend `dueAt`/`overdue`, LOCKED user resolves, `toUserRefundDto` 4 fields, notification handler REFUNDED/REJECTED copy (no handler spec), reconcile "skips resolved"; HTTP e2e 400s (unknown decision, reason 501, extra key, held+manual) [apps/backend/src/modules/economy/application/admin-top-up-refund.service.spec.ts] — DONE 2026-10-17: LOCKED case covered in Prisma e2e (10/10).
- [x] [Review][Patch] (medium) Prisma e2e weaker than AC7/Task 12 and **still never run** (Postgres down): races run once not N times, withdraw ‖ REFUNDED asserts `[200,409]` without loser code `REFUND_ALREADY_RESOLVED`, no `refundHold`→0 assertion, no CHECK test for REFUNDED without `resolve_journal_id`. Run with Docker up before `done` [apps/backend/test/top-up-refund-resolution.prisma.e2e-spec.ts:3148] — edits applied 2026-10-17 (races x5, loser code, refundHold→0, CHECK test) but NOT RUN: Postgres :5433 down. RUN 2026-10-17 on Postgres: resolution 9/9, top-up-refund.prisma + migration-chain pass (25).
- [x] [Review][Patch] (low) Notification copy deviates from Task 7: REFUNDED must read "Đã hoàn {amount} cho giao dịch nạp mã {orderCode} về tài khoản đã thanh toán. {points} Điểm đang giữ đã bị trừ."; REJECTED "bị từ chối" [apps/backend/src/modules/economy/application/top-up-refund-notification.handler.ts:58]
- [x] [Review][Patch] (low) Overdue sweep: no `take`/`orderBy`; hard-coded `3 * 24 * 60 * 60 * 1000` duplicates the SLA constant → derive from `TOP_UP_REFUND_SLA_BUSINESS_DAYS`, cap batch [apps/backend/src/modules/economy/infrastructure/jobs/payos-reconcile.job.ts:372]
- [x] [Review][Patch] (low) `REFUND_SLA_BREACHED` message can render `request=undefined` (`refundRequestId` optional) → guard, omit the param [apps/backend/src/modules/economy/infrastructure/top-up-admin-alert.handler.ts]
- [x] [Review][Patch] (low) `(topUp as any)?.providerReference` in in-memory repo → add field to `TopUpRowForRefund` [apps/backend/src/modules/economy/infrastructure/in-memory-payos-top-up.repository.ts:2145]
- [x] [Review][Patch] (low) `heldPoints = holdJournalId ? points : 0` stays > 0 after REFUNDED/REJECTED (hold consumed/released) — "Điểm giữ" wrong; align with FE item above (derive from status REQUESTED + hold) [apps/backend/src/modules/economy/infrastructure/prisma-payos-top-up.repository.ts]

## Dev Notes

### Scope boundary (read first)

In scope: admin refund list/detail/resolve/bank-transfer API + screens, the overdue alert, user notifications + emails for Refunded/Rejected, CSV refund columns, the "Hoàn tiền nạp Điểm" history label, filling the 13.11 optional resolution fields.

Out of scope: B4 banner, manual-flow retirement, official bank/PayOS logos, prod-enable checklist and refund drill → **13.13**. No change to the user refund form/submit/withdraw (13.10/13.11) except `toUserRefundDto` mapping. Sidebar "Nạp điểm" badge stays the legacy PENDING count (13.8 D6 / 13.9 precedent). No "Admin X · mở yêu cầu" view events (Figma shows one; we do not log reads).

### Decisions taken in this story (defaults; Owner may override — see Questions)

- **D1 — one resolve endpoint, keyed by request id.** `POST /admin/top-ups/refunds/:requestId/resolve` with a `decision` discriminated union; bank facts via `…/bank-transfer`. Request id matches the 13.10 mailbox link (`?tab=refunds&request={requestId}`).
- **D2 — generic verdict reasons.** The API has no spend-journal detail (13.11 D3), so the list/drawer say "Đã dùng Điểm sau khi nạp" instead of Figma's "Đổi voucher 14:05, sau khi nạp 13:52". Adding a "first spend after credit" lookup is possible later (ledger query by entries, like `hasSpendSince`).
- **D3 — unverified destination needs an explicit confirmation** (AD-26 "requires confirming the account with the user by email before REFUNDED"): dialog checkbox + server-side `destinationConfirmed: true` check (409 `REFUND_DESTINATION_UNCONFIRMED`), recorded in the audit payload.
- **D4 — mark-dialog copy follows UX-DR-P22 / AD-26, not the Figma text.** Figma `189:1579` says "Xác nhận bạn đã chuyển khoản…" (transfer first); the rule is mark first, then transfer. Use: title "Đánh dấu Đã hoàn {amount}?", rows "Đánh dấu trước, rồi chuyển khoản {amount} về {bank} {accountNumber} · {holder}." · "Sẽ trừ {points} Điểm đang giữ của user (bút toán hoàn tiền nạp Điểm)." · "User nhận thông báo “Đã hoàn tiền”. Không hoàn tác được." · fields "Mã giao dịch ngân hàng · không bắt buộc" (hint "Giúp đối soát khi user hỏi lại. Có thể thêm sau, 1 lần.") and "Thời điểm chuyển · không bắt buộc" (Figma has only the reference field; P17 asks for both).
- **D5 — reuse `TOPUP_REFUNDED`** for refund payouts (same "Đã hoàn tiền" meaning as the 13.9 manual mismatch refund) with a generic email body; add only `TOPUP_REFUND_REJECTED`. In-app messages carry the specifics.
- **D6 — status filter** (Đang mở default / Đã xử lý / Tất cả): Figma shows only open rows, but resolved requests must stay reachable to add the bank reference later and for audit.
- **D7 — audit trail derived from the row** (no new audit table/query): Figma's "Admin Hùng · mở yêu cầu" (read event) is omitted; resolver shown by email (13.8: no admin display name in DTOs).
- **D8 — history link via description.** The journal description carries `· top-up {topUpId}`; the FE parses the UUID for `/wallet/top-up/{id}`. No ledger schema change.

### API (new)

- `GET /admin/top-ups/refunds?status=OPEN|RESOLVED|ALL&verdict=ALL|ELIGIBLE|NOT_ELIGIBLE&q=&page=` → `{ items, total, page, pageSize: 10 }`.
- `GET /admin/top-ups/refunds/:requestId` → detail (full account number — admin only).
- `POST /admin/top-ups/refunds/:requestId/resolve` → `{ request, replayed }`. Errors: 404 `TOPUP_REFUND_NOT_FOUND`; 409 `REFUND_ALREADY_RESOLVED` | `REFUND_NOT_HELD` | `REFUND_DESTINATION_UNCONFIRMED`; 403 `TOPUP_ADMIN_CAPABILITY_REQUIRED` | `TOPUP_SELF_REVIEW_FORBIDDEN`; 400 `VALIDATION_ERROR`.
- `POST /admin/top-ups/refunds/:requestId/bank-transfer` → `{ request, replayed }`. Errors: 409 `REFUND_NOT_REFUNDED` | `REFUND_BANK_TRANSFER_ALREADY_RECORDED`, plus the above.
- `GET /admin/top-ups/tab-counts` → adds `refunds`.

### Copy

- Short reason (list): ELIGIBLE "Chưa tiêu Điểm sau khi nạp"; `SPENT_SINCE_TOP_UP` "Đã dùng Điểm sau khi nạp"; `INSUFFICIENT_AVAILABLE` "Khả dụng ít hơn số Điểm nạp".
- Verdict explanation (drawer): ELIGIBLE (Figma) "User chưa tiêu Điểm nào kể từ lúc nạp ({paidAt dd/MM HH:mm}). {points} Điểm đã chuyển sang Giữ chờ hoàn tiền."; `SPENT_SINCE_TOP_UP` "User đã dùng Điểm (đăng/mở lại khảo sát hoặc đổi voucher) sau khi nạp, kể cả lần đổi voucher thất bại đã được hoàn Điểm. Không có Điểm nào bị giữ."; `INSUFFICIENT_AVAILABLE` "Lúc gửi, Điểm khả dụng ít hơn {points} Điểm của giao dịch. Không có Điểm nào bị giữ."
- Resolved outcome: REFUNDED "Đã đánh dấu hoàn tiền lúc {resolvedAt} · {points} Điểm đã trừ" (+ "Mã CK {ref} · chuyển lúc {time}" when present); REJECTED "Đã từ chối lúc {resolvedAt}" + quoted reason (+ "Đã chuyển trả tiền thủ công" when `manualTransferRecorded`); WITHDRAWN "User đã rút yêu cầu lúc {withdrawnAt}".
- All `ASSUMED (design)` except the Figma-quoted lines.

### Audit trail (D7)

Ordered by time from the row: `createdAt` "{user name/email} · gửi yêu cầu hoàn tiền"; `createdAt` "Hệ thống · kết luận Hợp lệ, giữ {points} Điểm" / "Hệ thống · kết luận Không hợp lệ: {short reason}"; unverified → `createdAt` "Hệ thống · PayOS không trả tài khoản người trả; cần xác minh qua email"; `withdrawnAt` "User · rút yêu cầu"; `resolvedAt` "Admin {email} · đánh dấu Đã hoàn tiền" / "· từ chối"; `bankTransferRecordedAt` "Admin · thêm mã chuyển khoản". Figma shows the hold journal as "HOLD-2610150142"; we have no such code — omit.

### Figma (verified 2026-10-17 via Figma MCP, file `mkudD5Ngi5RPyIAVxCcxXi`, page 30 `178:3`)

- B1 refunds tab `188:1025` (content `188:1114`): search, "Tất cả kết luận", "Gần hạn trước", "Xuất CSV" (the 13.8 export; keep it on this tab too), columns as AC 1, footer "Hiển thị 1–3 trong 3 yêu cầu đang mở · SLA 3 ngày làm việc, quá hạn nền đỏ", pager.
- B2 drawer 560 px right: eligible `189:905` (drawer `189:1019`), not eligible `189:1128`, unverified `198:2186`; mark dialog `189:1357` (`189:1579`), reject hold-less `189:1621` (`189:1850`, checkbox), reject held with error `189:1884` (`189:2106`).
- Mobile: list `190:2230` (tabs as pills "Hoàn tiền · 3 / Cần xử lý · 3 / PayOS · 128 / Thủ công (cũ)"), detail `190:2297`, unverified `198:2546`.
- Sample data (Lan, 2610150142, Vietcombank 0071001234567) is fake design data; still use our own fake values in mocks.

### Current state of files touched (read each before editing)

- Backend economy (`apps/backend/src/modules/economy/`): `application/top-up-refund.service.ts` (submit :50, withdraw :235 — already throws `RefundAlreadyResolvedException` on REFUNDED/REJECTED :264, `toUserRefundDto` :370 maps no resolution fields), `application/payos-top-up.service.ts` (`listActionRequired` :136, `tabCounts` :174, `resolveMismatch` :182-300 = command template, `exportForAdmin` :302-373), `application/ledger.service.ts` (`placeTopUpRefundHold` :2606, `releaseTopUpRefundHold` :2699, `creditPayosTopUp` :2326 = SYSTEM_CLEARING usage, `reverseJournal` refusal :565-576), `application/ports/payos-top-up-repository.port.ts` (`TopUpRefundRow` :15, export row :221, `recordAdminAudit` :279, `lockTopUpForRefund` :282, `lockRefundRequestByTopUp` :283, `withdrawRefundRequest` :317), both repos, `application/top-up-admin-alerts.ts`, `application/top-up-refund-notification.handler.ts` (REQUESTED :30, WITHDRAWN :42), `infrastructure/top-up-admin-alert.handler.ts` (`renderMessage` :47-62), `infrastructure/jobs/payos-reconcile.job.ts` (mismatch SLA :165-180, :298-325), `economy-scheduler.registrar.ts`, `presentation/admin-top-up.controller.ts` (:46-48 guards; routes :56-171), `application/exceptions/economy.exceptions.ts` (:349), `common/http/http-exception.filter.ts` (:589), `common/http/csv.ts`.
- Notifications: `notifications/application/email-templates.ts:91` (`TOPUP_REFUNDED` mismatch copy), `packages/schemas/src/notifications/{notification,email-delivery}.schema.ts`, `notification-type.parity.spec.ts`.
- Schemas: `packages/schemas/src/economy/top-up-refund.schema.ts` (payload status enums `REQUESTED|WITHDRAWN`; keys :101-107), `payos-top-up.schema.ts` (alert conditions :130, alert event :139, `topUpAlertKey` :150, mismatch SLA const :17, export max :221), `top-up.schema.ts:175`, `common/business-days.ts` (`addBusinessDays` :11, `businessDaysUntil` :60).
- Prisma: `TopUpRefundRequest` `schema.prisma:1091-1125`, `TopUpRefundStatus` :241 (already has REFUNDED/REJECTED), `NotificationType` tail :193, `LedgerAccountClass` :287; last migration `20261021100000_top_up_refund_request`.
- FE: `admin/top-ups/components/{TopUpConsoleScreen,TopUpTabs,PayosTopUpsPanel,ActionRequiredPanel,MismatchDrawer,PayosTopUpDrawer,RejectTopUpDialog}.tsx`, `lib/admin/{payos-top-up-admin-service,payos-top-up-admin-messages,payos-top-up-mismatch,payos-top-up-admin}.ts`, `lib/wallet/{wallet-history,top-up-refund,top-up-history}.ts`, `lib/notifications/notification-presentation.ts`, `lib/clipboard.ts`, `components/ui/{Dialog,Toasts}.tsx`, `components/wallet/TopUpStatusChip.tsx`, MSW `mocks/handlers/admin-payos-top-ups.ts`, `mocks/data/{admin-payos-top-ups,top-up,economy,economy-rules}.ts`, `mocks/db/store.ts`.

### Guardrails

- **Lock order (AD-24/25/26):** TopUpRequest row → TopUpRefundRequest row → ledger accounts ascending. Create REFUND_HOLD / SYSTEM_CLEARING / USER_AVAILABLE accounts before any lock. Resolve and withdraw must use this exact order or the race test deadlocks instead of 409.
- **AD-1:** the refund journal never sets `reversesJournalId`; `ReverseJournal` keeps refusing refund keys.
- **One key per request:** `topup-refund-resolve:{requestId}` is used for exactly one journal (REFUNDED payout or REJECTED release), so a REFUNDED ‖ REJECTED race cannot post twice; the CAS decides the winner.
- **PII (repo is public):** full account number only in admin detail DTO + admin screens. Outbox payloads (user + audit), emails, logs, CSV: no account number; audit carries reason length, not text. Fake data in fixtures/mocks.
- **Never flag-gated** (`PAYOS_ENABLED=false` still resolves).
- **Append-only enums** (`NOTIFICATION_TYPES` ↔ Prisma parity; FE presentation parity).
- **Do not break:** 13.10 submit/withdraw + mailbox, 13.11 user screens (they already render REFUNDED/REJECTED from optional fields), 13.9 `TOPUP_REFUNDED` in-app message for manual mismatch refunds (only the email body becomes generic), 13.8 CSV existing columns/order (append only), 13.5 reconcile steps, wallet total (refundHold excluded).

### Previous story intelligence

- **13.11** (merged `04a6213`): user A7 renders REFUNDED/REJECTED with `resolvedAt`, `rejectionReason`, `bankTransferReference`, `bankTransferredAt` when present (`.optional()` in the schema for FE-first deploys — keep optional). Review lessons: close dialogs on reload-class 409s, clear stale errors, abort on unmount, fixed Vietnamese copy (no raw server messages), dates exactly as specified.
- **13.10**: lock order + CAS + Outbox in one `runInTransaction`; `releaseTopUpRefundHold` takes `key` for this story; mailbox link already `/admin/top-ups?tab=refunds&request={requestId}`; review lessons: declare FKs in `schema.prisma`, no N+1 in lists, run reads inside the ambient UoW transaction, every ticked test bullet needs an assertion.
- **13.9**: admin command template (capability, self-review, replay 200 vs conflict 409, audit payload without free text), drawer + toasts inside the dialog, `mismatchSla` UI helper.
- **13.8**: tab/badge wiring, export audit before CSV build, `error.name === "ZodError"` across the schemas package, MSW cannot be delayed (loading state not capturable), admin mock login needs typed input.
- **Pre-existing failures (not this story):** `rewards-flash.prisma.e2e-spec.ts:144`, FE `rewards-admin-flash-domain.test.mjs:163`; one unreproduced 13.5 flake "serializes reconcile job, webhook, and admin recheck".

### Git intelligence

`04a6213` merge PR #48 (13.11), `aabf2d2` 13.11, `edbac15` merge PR #47 (13.10), `d440e60` 13.10 + 13.9 fixes. Pattern: schemas → Prisma + migration + invariants → ledger → port + both repos → service → controller → handlers/job → e2e; FE pure `lib/` module + service + messages → components → MSW → `node --test`.

### Latest tech information

No new library. Postgres `ALTER TYPE … ADD VALUE` goes in its own migration (13.10 split `…_enums` / `…_request`). Native `datetime-local` gives local time without zone: convert as `Asia/Ho_Chi_Minh` (+07:00) before sending ISO.

### Project Structure Notes

- New BE: `application/admin-top-up-refund.service.ts` (+ spec), migrations `20261022090000_notification_type_topup_refund_rejected`, `20261022100000_top_up_refund_resolution`, `test/top-up-refund-resolution.prisma.e2e-spec.ts`, `test/top-up-refund-admin.e2e-spec.ts`.
- New FE: `lib/admin/payos-top-up-refund.ts`, `admin/top-ups/components/{RefundRequestsPanel,RefundDrawer,MarkRefundedDialog,RejectRefundDialog,BankTransferDialog}.tsx`, `tests/admin-top-ups-refunds.test.mjs`.
- Changed: listed in "Current state of files touched".

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.12] (l.1986-2004); UX-DR-P11, P12, P17, P20, P22, P25 (l.171-195)
- [Source: prds/prd-project-rescom-2026-08-08/prd.md] FR-78 (l.631-647), FR-77 + amendments (l.609-629), FR-57, FR-31
- [Source: architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md] AD-26 (l.282-308); solution-design.md PayOS flows (l.295-370)
- [Source: _bmad-output/implementation-artifacts/13-10-refund-request-refund-hold-withdrawal.md], [13-11-refund-screens.md], [13-9-amount-mismatch-resolution.md], [13-8-admin-top-up-console.md]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] l.481-485 (pre-existing flash failure)

### Owner decisions (confirmed by Owner Quan 2026-10-17)

1. D2: generic verdict reason (no spend lookup).
2. D3: unverified destination requires the checkbox, server-enforced (`REFUND_DESTINATION_UNCONFIRMED`).
3. D5: reuse `TOPUP_REFUNDED` with a generic email body; add only `TOPUP_REFUND_REJECTED`.
4. D4: mark-dialog copy follows AD-26 ("mark first, then transfer") + optional transfer-time field.

## Dev Agent Record

### Agent Model Used

Gemini 2.5 Pro (Antigravity pair programmer)

### Debug Log References

- Task 12: Verified Prisma migration chain `test/migration-chain.prisma.e2e-spec.ts` with updated `NotificationType` enum assertion.
- Task 12: Concurrency races verified in `test/top-up-refund-resolution.prisma.e2e-spec.ts` (terminal locks & idempotency).
- Task 12: Admin HTTP e2e routes verified in `test/top-up-refund.e2e-spec.ts`.
- Task 12: MSW lifecycle verified in `apps/frontend/my-app/tests/admin-top-up-refund-mock.test.mjs`.

### Completion Notes List

- All Acceptance Criteria AC 1–11 delivered.
- Database: added Prisma migrations for `TOPUP_REFUND_REJECTED` and `TopUpRefundRequest` resolution fields (`rejectionReason`, `manualTransferRecorded`, `resolvedByAdminId`, `resolveJournalId`, `bankTransferReference`, `bankTransferredAt`, `bankTransferRecordedAt`).
- Invariant CHECK constraints added to migration and `post-push-invariants.sql`.
- Ledger: implemented `refundTopUpRefundHold` with `REFUND_HOLD → SYSTEM_CLEARING` journal and idempotency replay assertion.
- Repository: port, in-memory, and Prisma implementations of admin refund listing, detail with unmasked account numbers, CAS resolution, bank transfer recording, overdue candidate prefilter, and export columns.
- Service & Controller: implemented `AdminTopUpRefundService` and admin routes with capability, self-review guard, CAS status transitions, and audit events.
- Notifications & Alerts: notification handler for `REFUNDED` and `REJECTED`, generic `TOPUP_REFUNDED` and new `TOPUP_REFUND_REJECTED` email templates, and reconcile job `REFUND_SLA_BREACHED` alert.
- Code Review Chunk 2/2 Frontend & MSW Alignment applied:
  - AC 1 / AC 11: Page size 10, deep link synchronization with `?tab=refunds&request={id}`, stale-guarded detail and list fetches with auto-close drawer and toast on 404.
  - AC 3 / AC 4 / AC 6 / D3 / D4 / D7: Rebuilt RefundDrawer with verdict card, original transaction details, unmasked bank account with copy, unverified amber warning block with copy email, audit trail, outcome banner, and action buttons.
  - Behavioral Bug 1: Deep link sync on drawer open/close and 404 error handling.
  - Behavioral Bug 2: Dialog state reset on open / item change without cascading effect renders (using React 19 render-time key tracking & conditional mounting).
  - Behavioral Bug 3: Mark Refunded button enabled ONLY when `heldPoints > 0` (`ELIGIBLE` with held points); disabled otherwise with hint "Chỉ bật khi Điểm đang bị giữ".
  - Behavioral Bug 4: Reject dialog shows manual-transfer checkbox ONLY when `heldPoints === 0`; claims points returned ONLY when `heldPoints > 0`.
  - Behavioral Bug 5: Wallet history inspects journal entries and classifies `topup-refund-resolve:` into `TOP_UP_REFUND_RELEASE` ("Hoàn lại từ giữ chờ hoàn tiền") when `USER_AVAILABLE` is credited vs `TOP_UP_REFUND` ("Hoàn tiền nạp Điểm") when debited, with `topUpHref` (`/wallet/top-up/{id}`).
  - MSW mocks & handlers: Page size 10, sorting, replay 200 guard, `REFUND_NOT_HELD` 409 guard, held+manual 400 guard, `bankTransferredAt` bounds guard, self-review 403 guard, sets `bankTransferRecordedAt`.
  - Tests: 40 tests across `admin-top-ups-refunds.test.mjs`, `admin-top-up-refund-mock.test.mjs`, `wallet-history.test.mjs`. Full frontend test suite: 985 pass, 0 fail. Next.js build clean. Eslint 0 errors, typecheck 0 errors.
- Clean verification: typecheck passes across `@rescom/schemas`, `backend`, `my-app`; schemas unit tests pass (51/51 suites, 695/695 tests); backend tests pass (27/27 suites, 439/439 tests, 18/18 migration-chain, e2e suites); frontend tests pass (985/985 tests); Next.js production build succeeds.

### File List

- `packages/schemas/src/economy/payos-top-up.schema.ts`
- `packages/schemas/src/economy/top-up-refund.schema.ts`
- `packages/schemas/src/economy/top-up-refund.schema.spec.ts`
- `packages/schemas/src/economy/top-up.schema.ts`
- `packages/schemas/src/notifications/notification.schema.ts`
- `packages/schemas/src/notifications/notification.schema.spec.ts`
- `packages/schemas/src/notifications/email-delivery.schema.ts`
- `packages/schemas/src/notifications/email-delivery.schema.spec.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20261022090000_notification_type_topup_refund_rejected/migration.sql`
- `apps/backend/prisma/migrations/20261022100000_top_up_refund_resolution/migration.sql`
- `apps/backend/prisma/sql/post-push-invariants.sql`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/modules/economy/economy.module.ts`
- `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`
- `apps/backend/src/modules/economy/application/ports/payos-top-up-repository.port.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-payos-top-up.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-payos-top-up.repository.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts`
- `apps/backend/src/modules/economy/application/spend-journals.completeness.spec.ts`
- `apps/backend/src/modules/economy/application/payos-top-up.service.ts`
- `apps/backend/src/modules/economy/application/top-up-refund.service.ts`
- `apps/backend/src/modules/economy/application/admin-top-up-refund.service.ts`
- `apps/backend/src/modules/economy/application/admin-top-up-refund.service.spec.ts`
- `apps/backend/src/modules/economy/presentation/admin-top-up.controller.ts`
- `apps/backend/src/modules/economy/presentation/top-up.controller.spec.ts`
- `apps/backend/src/modules/economy/application/top-up-refund-notification.handler.ts`
- `apps/backend/src/modules/economy/application/top-up-admin-alerts.ts`
- `apps/backend/src/modules/economy/infrastructure/top-up-admin-alert.handler.ts`
- `apps/backend/src/modules/economy/infrastructure/top-up-admin-alert.handler.spec.ts`
- `apps/backend/src/modules/economy/infrastructure/jobs/payos-reconcile.job.ts`
- `apps/backend/src/modules/economy/infrastructure/jobs/payos-reconcile.job.spec.ts`
- `apps/backend/src/modules/notifications/application/email-templates.ts`
- `apps/backend/src/modules/notifications/application/email-templates.spec.ts`
- `apps/backend/src/modules/notifications/infrastructure/notification-type.parity.spec.ts`
- `apps/backend/test/migration-chain.prisma.e2e-spec.ts`
- `apps/backend/test/top-up-refund.e2e-spec.ts`
- `apps/backend/test/top-up-refund-resolution.prisma.e2e-spec.ts`
- `apps/frontend/my-app/lib/admin/payos-top-up-admin-service.ts`
- `apps/frontend/my-app/lib/admin/payos-top-up-admin-messages.ts`
- `apps/frontend/my-app/lib/admin/payos-top-up-refund.ts`
- `apps/frontend/my-app/lib/admin/admin-transactions.ts`
- `apps/frontend/my-app/lib/wallet/wallet-history.ts`
- `apps/frontend/my-app/lib/notifications/notification-presentation.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/TopUpTabs.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/TopUpConsoleScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundRequestsPanel.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RefundDrawer.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/MarkRefundedDialog.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/RejectRefundDialog.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/BankTransferDialog.tsx`
- `apps/frontend/my-app/mocks/db/session.ts`
- `apps/frontend/my-app/mocks/db/store.ts`
- `apps/frontend/my-app/mocks/data/economy-rules.ts`
- `apps/frontend/my-app/mocks/data/economy.ts`
- `apps/frontend/my-app/mocks/data/top-up.ts`
- `apps/frontend/my-app/mocks/data/admin-payos-top-ups.ts`
- `apps/frontend/my-app/mocks/handlers/admin-payos-top-ups.ts`
- `apps/frontend/my-app/tests/admin-top-ups-refunds.test.mjs`
- `apps/frontend/my-app/tests/admin-top-ups-console.test.mjs`
- `apps/frontend/my-app/tests/admin-top-up-refund-mock.test.mjs`
- `apps/frontend/my-app/tests/wallet-history.test.mjs`
- `_bmad-output/implementation-artifacts/13-12-admin-refund-resolution.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

