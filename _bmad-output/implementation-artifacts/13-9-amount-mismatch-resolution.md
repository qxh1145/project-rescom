---
baseline_commit: d8da885
---
# Story 13.9: Amount Mismatch Resolution

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want to resolve payments whose amount differs from the request,
so that the user gets either fair Points or their money back.

## Acceptance Criteria

1. **"Cần xử lý" tab.** Given the Figma page 30 frame `188:1260`, when the Admin opens `/admin/top-ups?tab=action`, a third tab "Cần xử lý" (between "Giao dịch PayOS" and "Lịch sử thủ công (cũ)"; "Yêu cầu hoàn tiền" stays unrendered until 13.12) shows a pill badge = open mismatches + open uncredited alerts. The tab lists:
   - **Uncredited > 30 min** (top section): a red banner "{n} giao dịch đã thanh toán nhưng chưa cộng Điểm sau 30 phút" with "#{orderCode} · PayOS báo thanh toán {HH:mm}, đã {m} phút. Kiểm tra webhook trước khi cộng thủ công.", and a red-tinted row (Loại "Chưa cộng Điểm > 30 phút" / "Đã thanh toán {HH:mm}", Hạn xử lý "Xử lý ngay" / "Cảnh báo sau 30 phút") whose action "Đồng bộ lại" calls the existing 13.5 recheck (UX-DR-P11).
   - **Amount mismatches**: rows with Loại chip "Sai số tiền" + "Chênh {±diff}đ", Giao dịch (`orderCode`), Người dùng, "Yêu cầu / thực nhận" `{amountVnd} / {amountPaidVnd}` + "Nếu cộng theo thực nhận: {floor(amountPaidVnd/200)} Điểm", and Hạn xử lý "Còn {n} ngày làm việc" / "Hạn {dd/MM HH:mm}"; once `now ≥ resolveDueAt` the line becomes a red "Quá hạn" chip and the row is tinted. Sorted by `resolveDueAt` ascending. Action "Xử lý" opens the B3 drawer. Footnote: "Hạn xử lý giao dịch sai số tiền: 3 ngày làm việc kể từ lúc nhận tiền." (UX-DR-P11, P13).
   - `resolveDueAt = addBusinessDays(paidAt, 3)` (Mon–Fri, `Asia/Ho_Chi_Minh`, no holidays, FR-35), computed by the server with the same helper the 13.5 SLA alert uses.
2. **B3 drawer.** Given frames `189:2145` (credit) / `189:2296` (manual refund), the drawer shows title "Giao dịch #{orderCode}", status chip + "Sai số tiền" chip + countdown chip, subtitle "{user} · {email} · thanh toán {dd/MM HH:mm}", the deadline line "Hạn: 3 ngày làm việc kể từ lúc nhận tiền · {dd/MM/yyyy HH:mm} (còn {n} ngày làm việc | Quá hạn)", cards "Yêu cầu {amountVnd} · {points} Điểm" and "Thực nhận {amountPaidVnd} · Chênh {±diff}đ", and a facts table (Mã PayOS = `providerReference`, Tài khoản người trả = "{bankName} · •••• {last4}" or "Chưa có thông tin", Nội dung CK = the payOS description). Section "CÁCH XỬ LÝ" is a radio pair:
   - "Cộng Điểm theo số thực nhận" — "Cộng floor({amountPaidVnd} ÷ 200) = {p} Điểm vào Khả dụng. Giao dịch chuyển sang Thành công." + "User sẽ nhận {p} Điểm"; footer primary "Cộng {p} Điểm". Disabled with an explanation when `p < 1`.
   - "Đã hoàn tiền thủ công" — "Bạn đã trả lại {amountPaidVnd}đ ngoài hệ thống. Không cộng Điểm; giao dịch đóng lại." + required textarea "Ghi chú * bắt buộc" (1–500 chars after trim); footer primary "Xác nhận đã hoàn tiền" disabled until the note is valid.
   - Footer secondary "Để sau" closes the drawer. Busy state blocks close and double submit (UX-DR-P13).
3. **Credit resolution.** "Cộng Điểm theo số thực nhận" runs `ResolveTopUpMismatch` (`topup-mismatch:{topUpId}`): in one transaction it locks the `TopUpRequest` row `FOR UPDATE`, requires `status = AMOUNT_MISMATCH` and `amountPaidVnd` = the value the Admin saw, posts journal `SYSTEM_CLEARING → USER_AVAILABLE` for floor(`amountPaidVnd` ÷ 200) with idempotency key `topup-mismatch:{topUpId}`, sets `SUCCESSFUL` + `journalId` + `pointsCredited` + resolution fields, writes the user notification event and the admin-audit event to the Outbox. The in-app user notification states the credited Points (the `TOPUP_SUCCESS` email keeps its fixed body; amended 2026-10-16 in code review, Owner Quan) and, when `amountPaidVnd % 200 > 0`, that the remainder below 200 VNĐ is not converted (FR-35).
4. **Manual refund resolution.** "Đã hoàn tiền thủ công" requires the note, moves the row to `MANUAL_REFUNDED` with no journal, stores the note, writes the user notification (new type `TOPUP_REFUNDED`, emailed per FR-57 "Refunded") and the admin-audit event in the same transaction. The note is never sent to the user.
5. **Identifiable credit.** The mismatch credit journal is identified by its idempotency key prefix `topup-mismatch:` via one exported helper/constant (`topUpMismatchKey`, `TOP_UP_MISMATCH_JOURNAL_KEY_PREFIX`) so Story 13.10 can exclude it from refund eligibility (FR-77, AD-26). The prefix must not match the existing `topup-mismatch-record:` / `topup-mismatch-notice:` keys (the trailing `:` makes them distinct; a test asserts it).
6. **Idempotent, audited, credit-once.** Both actions write one `AdminTopUpMismatchResolved` audit event. A retry of the same action on an already-resolved row returns `200 { replayed: true }` with no second journal, notification, or audit. A different action on a resolved row, a row no longer in `AMOUNT_MISMATCH` (e.g. payOS later reported the full amount and `CreditTopUp` credited it), or a stale `expectedAmountPaidVnd` returns `409`. A concurrent provider `PAID` full-amount result (webhook / reconcile / recheck through `CreditTopUp`) and an Admin resolution credit at most once in total, proven by a Prisma concurrency test. Only an ADMIN with live ADMIN/ACTIVE capability can resolve, and never their own top-up.
7. **States + mobile.** The tab has loading, empty ("Không có giao dịch cần xử lý"), and error states in the 13.8 style; at 390 px rows become cards and the drawer is full-width with no horizontal page scroll.

## Tasks / Subtasks

- [x] **Task 0: Preconditions** (memory rule: one branch per story).
  - [x] `git status --short --branch` → `feat/13-9-amount-mismatch-resolution`, created 2026-10-16 from `origin/develop` `d8da885` (13.8 merged, PR #42), upstream unset. Push with `git push -u origin feat/13-9-amount-mismatch-resolution`.
  - [x] Not gated by Story 13.6 (only 13.10–13.12 are). UI gate: B1 `188:1260` and B3 `189:2145`/`189:2296` were re-read via Figma MCP on 2026-10-16 (see Dev Notes "Figma").
- [x] **Task 1: Shared contracts** (AC: 1–6) — `packages/schemas/src/economy/payos-top-up.schema.ts`, `economy/top-up.schema.ts`, `common/business-days.ts`, `notifications/*` (+ specs; export via indexes).
  - [x] `topUpMismatchKey = (id) => \`topup-mismatch:${id}\`` and `TOP_UP_MISMATCH_JOURNAL_KEY_PREFIX = 'topup-mismatch:'`. Spec: `topUpMismatchNoticeKey(...)` and `'topup-mismatch-record:x'` do **not** start with the prefix.
  - [x] `payosTransferContent(orderCode) = \`RC${String(orderCode).slice(-7)}\``; make `payos-payment-provider.adapter.ts:56` use it (same output; adapter spec stays green).
  - [x] `business-days.ts`: add `businessDaysUntil(now: Date, due: Date): number` = smallest `n ≥ 0` with `addBusinessDays(now, n) >= due` (0 when overdue). Spec: Fri 17:00 → Wed 17:00 = 3; weekend start; due already passed = 0.
  - [x] `TOP_UP_MISMATCH_SLA_BUSINESS_DAYS = 3`; replace the literal `3` in `payos-reconcile.job.ts:167,294`.
  - [x] `resolveTopUpMismatchSchema` (`.strict()` body): discriminated union on `action`: `{ action: 'CREDIT', expectedAmountPaidVnd: int>0 }` | `{ action: 'MANUAL_REFUND', expectedAmountPaidVnd: int>0, note: string trim 1–500 }`. `TOP_UP_MISMATCH_NOTE_MAX = 500`.
  - [x] `resolveTopUpMismatchResultSchema` = `{ topUpId, status: 'SUCCESSFUL'|'MANUAL_REFUNDED', pointsCredited: int|null, replayed: boolean }`.
  - [x] `adminPayosMismatchSchema` (`.strict()`) = `adminPayosTopUpSchema` fields + `resolveDueAt` (ISO), `providerReference: string|null`, `transferContent`, `counterAccountBankName: string|null`, `counterAccountLast4: string|null`. **Never** the full number or holder name.
  - [x] `adminPayosUncreditedSchema` (`.strict()`) = `{ topUpId, orderCode, userId, userEmail|null, amountVnd, amountPaidVnd|null, status, paidAt: ISO|null, alertedAt: ISO }`.
  - [x] `adminTopUpActionRequiredSchema` = `{ uncredited: adminPayosUncreditedSchema[], mismatches: adminPayosMismatchSchema[] }` (each capped at `TOP_UP_ACTION_REQUIRED_MAX = 100`, `ponytail:` paging if queues grow).
  - [x] `adminTopUpTabCountsSchema` gains `actionRequired: int≥0` (13.12 adds its key later).
  - [x] `topUpAdminAlertEventSchema` gains optional `paidAt: datetime` (backward compatible; old rows lack it).
  - [x] `topUpStatusChangedEventSchema.status` adds `MANUAL_REFUNDED`; add optional `resolution: z.enum(['ADMIN_CREDIT','ADMIN_REFUND'])` and optional `remainderVnd: int≥0`.
  - [x] `payosRecheckResultSchema.result` adds `REFUNDED` (row is `MANUAL_REFUNDED`); `topUpRecheckAuditEventPayloadSchema.result` adds `REFUNDED` too.
  - [x] `TOP_UP_AUDIT_EVENT_TYPES.MISMATCH_RESOLVED = 'AdminTopUpMismatchResolved'` + `topUpMismatchAuditEventPayloadSchema` = `{ schemaVersion: 1, action: 'TOPUP_MISMATCH_RESOLVED', auditCategory: 'MODERATION_ADMIN_ACTION', topUpId, adminId, resolution: 'CREDIT'|'MANUAL_REFUND', amountVnd, amountPaidVnd, pointsCredited: int|null, noteLength: int|null, correlationId: nullable, occurredAt }` (note text stays in the row, not the audit payload — it may hold bank details).
  - [x] `NOTIFICATION_TYPES`: **append** `TOPUP_REFUNDED` (never reorder); add it to the email-type list in `notifications/email-delivery.schema.ts`.
- [x] **Task 2: DB** (AC: 4, 6).
  - [x] Prisma `TopUpRequest`: `resolutionNote String? @map("resolution_note") @db.VarChar(500)`. Reuse `adminId`, `reviewedAt`, `correlationId` for the resolving Admin/time/correlation (comment the field docs: "approval, rejection, or mismatch resolution").
  - [x] `NotificationType` enum: `TOPUP_REFUNDED`.
  - [x] One migration `apps/backend/prisma/migrations/20261020100000_top_up_mismatch_resolution/migration.sql` (`ALTER TYPE "NotificationType" ADD VALUE 'TOPUP_REFUNDED'` modeled on `20261019100000_notification_type_topup_amount_mismatch`, `ALTER TABLE top_up_requests ADD COLUMN resolution_note varchar(500)`). Mirror in `prisma/sql/post-push-invariants.sql` if that file lists columns/enums it checks. Run `migration-chain.spec.ts` and `notification-type.parity.spec.ts`.
- [x] **Task 3: Ledger + repository** (AC: 3–6) — `apps/backend/src/modules/economy`.
  - [x] `ledger.service.ts`: `creditMismatchTopUp({ topUpId, userId, points, orderCode, amountPaidVnd })` next to `creditPayosTopUp` (l.2286): same accounts, key `topUpMismatchKey(topUpId)`, description `PayOS mismatch credit: order N (P points from X VND)`, rejects `points <= 0`.
  - [x] Port `payos-top-up-repository.port.ts` + `prisma-payos-top-up.repository.ts` + `in-memory-payos-top-up.repository.ts`:
    - `resolveMismatch(id, { status: 'SUCCESSFUL'|'MANUAL_REFUNDED', expectedAmountPaidVnd, journalId?, pointsCredited?, adminId, note|null, correlationId|null, resolvedAt }, statusEvent, auditEvent)` → `{ changed }`: `updateMany where { id, channel: 'PAYOS', status: 'AMOUNT_MISMATCH', amountPaidVnd: expected }`; sets status, `journalId`/`pointsCredited` (credit only), `adminId`, `reviewedAt`, `correlationId`, `resolutionNote`; **does not** touch `paidAt`, `amountPaidVnd`, `providerReference`, `counterAccount*` (unlike `transition()` l.312, which rewrites `paidAt`). On change, create both Outbox rows in the same `runInTransaction`.
    - `listActionRequired({ limit })` → mismatches: `channel PAYOS, status AMOUNT_MISMATCH`, explicit `select` incl. `providerReference`, `counterAccountBankName`, `counterAccountNumber` (mapped to last 4 **inside the repository**; the full number never leaves it) + `user.email`; uncredited: Outbox rows `eventType = ECONOMY_TOPUP_ADMIN_ALERT`, `idempotencyKey startsWith 'topup-alert:UNCREDITED_AFTER_PAYMENT:'`, joined on `aggregateId = top_up_requests.id` where status `NOT IN (SUCCESSFUL, MANUAL_REFUNDED, AMOUNT_MISMATCH)` (a row that became a mismatch shows in the mismatch list only). `alertedAt = outbox.createdAt`, `paidAt = payload.paidAt ?? row.paidAt ?? null`.
    - `countActionRequired()` for the tab badge (same predicates).
  - [x] `payos-reconcile.job.ts` 4a: pass `paidAt: paidInstant.toISOString()` in the UNCREDITED alert details; `TopUpAdminAlerts.raise` forwards `details.paidAt`.
- [x] **Task 4: `ResolveTopUpMismatch` service** (AC: 3–6) — `payos-top-up.service.ts` (`resolveMismatch(topUpId, input, { adminId, correlationId })`).
  - [x] Parse with the shared schema. Live capability: reuse the legacy pattern in `top-up.service.ts` `lockForReview` (l.~310: `adminCapability.findCurrentCapability`, ADMIN/ACTIVE else `TopUpAdminCapabilityRequiredException`, self-review forbidden → same exception class used there). Inject the capability port into `PayosTopUpService` in `economy.module.ts`.
  - [x] `unitOfWork.run(topUpMismatchKey(id), …)` → `repository.lockForUpdate(id)` (same lock order as `creditTopUp` l.414: row → ledger accounts). Then:
    - row missing / not `PAYOS` → 404 `TOPUP_NOT_FOUND`.
    - status `SUCCESSFUL` with `journal.idempotencyKey = topUpMismatchKey(id)` and action `CREDIT`, or `MANUAL_REFUNDED` and action `MANUAL_REFUND` → return `{ replayed: true }` (no writes).
    - any other non-`AMOUNT_MISMATCH` status → 409 `TOPUP_MISMATCH_ALREADY_RESOLVED` `{ status }`.
    - `amountPaidVnd !== expectedAmountPaidVnd` → 409 `TOPUP_MISMATCH_AMOUNT_CHANGED` `{ amountPaidVnd }` (payOS refreshed the cumulative amount while the drawer was open, 13.5 C3 refresh).
    - CREDIT with `floor(amountPaidVnd/200) < 1` → 409 `TOPUP_MISMATCH_NOTHING_TO_CREDIT`.
    - CREDIT: `ledgerService.creditMismatchTopUp` → `resolveMismatch(SUCCESSFUL, journalId, pointsCredited)`; MANUAL_REFUND: `resolveMismatch(MANUAL_REFUNDED, note)`. `changed = false` after the lock means a bug → throw (rolls back the journal).
  - [x] Status event via the existing `event()` helper (l.386) with key `topUpMismatchKey(id)`, `points` = credited Points (0 for refund), `amountPaidVnd`, `resolution`, `remainderVnd = amountPaidVnd % 200`. Audit event modeled on recheck's `audit(...)` closure (l.~594), key `admin-audit:topup-mismatch:${id}`, payload parsed with `topUpMismatchAuditEventPayloadSchema`.
  - [x] Add exceptions in `application/exceptions/economy.exceptions.ts` with `readonly code` + HTTP status on the class, like `TOPUP_EXPORT_TOO_LARGE` (l.292); no filter change needed (check `http-exception.filter.spec.ts` for any code allowlist).
  - [x] `recheck()` (l.~660): map `MANUAL_REFUNDED` → `REFUNDED` (was `MISMATCH`).
  - [x] `listActionRequired()` / `tabCounts()`: compute `resolveDueAt = addBusinessDays(paidAt, TOP_UP_MISMATCH_SLA_BUSINESS_DAYS)` (paidAt is always set on a mismatch row; if null, log and use `createdAt`), sort mismatches by it, add `actionRequired` to counts.
- [x] **Task 5: Notifications** (AC: 3, 4).
  - [x] `top-up-notification.handler.ts`: `SUCCESSFUL` + `resolution: 'ADMIN_CREDIT'` → `TOPUP_SUCCESS` "Admin đã cộng {points} Điểm cho giao dịch nạp mã {orderCode} theo số tiền thực nhận {amountPaidVnd} VNĐ." + (remainder > 0) " {remainderVnd} VNĐ lẻ dưới 200 VNĐ không được quy đổi thành Điểm."; `MANUAL_REFUNDED` → `TOPUP_REFUNDED` "Giao dịch nạp mã {orderCode} đã được hoàn {amountPaidVnd} VNĐ về tài khoản đã thanh toán. Không có Điểm nào được cộng." (copy `ASSUMED`). Keep all existing branches byte-identical (spec snapshots).
  - [x] `email-templates.ts`: `TOPUP_REFUNDED` case "Rescom: Giao dịch nạp điểm đã được hoàn tiền" (fixed body, wallet link). `TOPUP_SUCCESS` email body unchanged.
  - [x] FE `lib/notifications/notification-presentation.ts`: `TOPUP_REFUNDED` icon `refund`, tone `teal`, href `/wallet`, label "Đã hoàn tiền nạp Điểm".
- [x] **Task 6: Controller** (AC: 1, 3, 4, 6) — `presentation/admin-top-up.controller.ts`.
  - [x] `GET action-required` (`no-store`) → `adminTopUpActionRequiredSchema`; declared with the other static routes **above** `:id` routes.
  - [x] `POST :id/resolve-mismatch`: `CsrfGuard, JsonOnlyGuard`, `@HttpCode(200)`, `ParseUUIDPipe`, `ZodValidationPipe(resolveTopUpMismatchSchema, 'VALIDATION_ERROR', 'body')`, `x-correlation-id`, `@CurrentUser()` — copy `reject` (l.132-150).
- [x] **Task 7: FE service + pure rules** (AC: 1–7) — `apps/frontend/my-app/lib/admin/`.
  - [x] `payos-top-up-admin-service.ts`: `getAdminTopUpActionRequired(signal)`, `resolveTopUpMismatch(id, body)`.
  - [x] `payos-top-up-mismatch.ts` (pure, `node --test`): `mismatchPreview(amountPaidVnd)` → `{ points, remainderVnd, canCredit }`; `diffVnd(row)`; `mismatchSla(row, now)` → `{ overdue, line: "Còn n ngày làm việc" | "Quá hạn", dueLabel: "Hạn dd/MM HH:mm" }` using `businessDaysUntil` from `@rescom/schemas` (do **not** copy `rewards-code-issues-view.ts` `slaDueAt`, it has an 08:00–17:00 window and 1 day); `uncreditedBanner(items, now)`; `noteState(note)`; `resolveToast(result)`.
  - [x] `payos-top-up-admin-messages.ts`: `TOPUP_MISMATCH_AMOUNT_CHANGED` ("Số tiền thực nhận vừa thay đổi. Đã tải lại — kiểm tra rồi xử lý lại."), `TOPUP_MISMATCH_ALREADY_RESOLVED` ("Giao dịch đã được xử lý (có thể payOS vừa xác nhận đủ tiền)."), `TOPUP_MISMATCH_NOTHING_TO_CREDIT`, `TOPUP_ADMIN_CAPABILITY_REQUIRED` (reuse the legacy code string), 403.
- [x] **Task 8: FE screen** (AC: 1, 2, 7) — `app/(signed-in)/(admin)/admin/top-ups/components/`.
  - [x] `TopUpConsoleScreen.tsx`: `?tab=payos|action|manual`; counts include `actionRequired`; resolve/recheck bump `revision`.
  - [x] `TopUpTabs.tsx`: generalise to `tabs.length` (remove the `% 2` and `End = 1` literals, fix ArrowLeft to `(index - 1 + n) % n`).
  - [x] `ActionRequiredPanel.tsx`: banner + uncredited rows ("Đồng bộ lại" → `recheckPayosTopUp`, `recheckToast`, toast with `REFUNDED` case) + mismatch table/cards; states.
  - [x] `MismatchDrawer.tsx`: reuse `Dialog` drawer classes from `PayosTopUpDrawer.tsx:19` and its toast-inside-drawer slot; radio pair, `Textarea` note, footer "Để sau" + primary; `useRef` double-submit guard like `code-issues/components/ResolveCodeIssueDialog.tsx`. On `TOPUP_MISMATCH_AMOUNT_CHANGED` reload the list and keep the drawer open on the fresh row; on `ALREADY_RESOLVED` close and reload.
  - [x] `lib/wallet/top-up-history.ts` `recheckToast`/chip vocabulary: reuse `topUpChip`; "Sai số tiền" is the B1/B3 Loại chip (local to the console).
- [x] **Task 9: MSW** — `mocks/handlers/admin-payos-top-ups.ts`, `mocks/data/admin-payos-top-ups.ts`, `mocks/data/top-up.ts`.
  - [x] Seed mismatch rows with `amountPaidVnd ≠ amountVnd` (Figma: 50.000/49.000 overdue, 100.000/98.000 with 2 business days left, one with `amountPaidVnd = 150` → cannot credit) and one stale paid-uncredited `PROCESSING` row + alert (> 30 min). Today `adminPayosRows()` sets `amountPaidVnd = amountVnd` for every paid row — fix for mismatches. Bump `SCHEMA_VERSION` in `mocks/db/store.ts` (12 → 13) if `MockPayosTopUp` gains fields.
  - [x] Routes `GET /admin/top-ups/action-required`, `POST /admin/top-ups/:id/resolve-mismatch` (CSRF, replay, 409 codes, credit via the mock ledger); counts gain `actionRequired`; recheck returns `REFUNDED` for `MANUAL_REFUNDED`. Run `tests/route-diff.test.mjs`.
- [x] **Task 10: Tests**
  - [x] Schemas: key prefix distinctness, `businessDaysUntil`, resolve body union (note trim/length, missing note on refund), strict mismatch DTO keys (no `counterAccountNumber`/`counterAccountName`), event/alert/audit schema additions.
  - [x] Backend unit (`payos-top-up-mismatch.service.spec.ts` or extend `payos-top-up.service.spec.ts`): credit floor (49_000 → 245, remainder 0; 98_100 → 490, remainder 100), refund no journal, replay both actions, cross-action 409, stale amount 409, nothing-to-credit 409, non-PAYOS 404, capability/self 403, audit + status events written once with the right keys, recheck `REFUNDED`, list sorting + overdue boundary, uncredited join excludes credited/mismatch rows. Notification handler: new branches + unchanged old messages. In-memory repo mirrors the Prisma semantics.
  - [x] Backend Prisma e2e `apps/backend/test/top-up-payos-mismatch.prisma.e2e-spec.ts`: (a) `Promise.all` of `resolveMismatch(CREDIT)` and `applySnapshot` with a full-amount `CREDIT` snapshot → exactly one journal among `topup-credit:{id}` / `topup-mismatch:{id}`, `pointsCredited` matches the winner, USER_AVAILABLE balance credited once; (b) two concurrent CREDIT resolves → one journal, one audit; (c) refund then provider full payment → stays `MANUAL_REFUNDED`, no journal. Model on `top-up-payos-reconcile.prisma.e2e-spec.ts:146-211`.
  - [x] Backend HTTP e2e `apps/backend/test/top-up-payos-mismatch.e2e-spec.ts`: 401/403 (PUBLISHER, RESPONDENT, no CSRF), 400 bad body, action-required body never contains the full `counterAccountNumber` or `counterAccountName` string, tab counts.
  - [x] FE `tests/admin-top-ups-mismatch.test.mjs`: `mismatchPreview`, `mismatchSla` (overdue edge, weekend), `uncreditedBanner`, `noteState`, messages, service schema parsing. Existing `admin-top-ups.test.mjs` and `admin-top-ups-console.test.mjs` pass (update the tab-count fixture for the new key).
  - [x] Run: `npm test --workspace @rescom/schemas`; backend `npm test --workspace backend -- top-up ledger notification`, `npm run test:e2e --workspace backend -- top-up migration notification`, `npm run build --workspace backend`; FE `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` in `apps/frontend/my-app`.
  - [x] Visual check in mock mode at 1440 and 390 vs `188:1260`, `189:2145`, `189:2296`: tab, overdue row, uncredited banner + "Đồng bộ lại" toast, both drawer modes, disabled credit (`p < 1`), note validation, stale-amount 409 path.

### Review Findings

- [x] [Review][Decision] RESOLVED 2026-10-16 (Owner Quan: amend AC3 to match code; emails stay fixed-body) — AC3 vs Task 5 contradiction on the `TOPUP_SUCCESS` email — AC3 says the email states credited Points + the sub-200 VNĐ remainder; Task 5 says the email body stays unchanged. Emails are one fixed body per type (`renderNotificationEmail(type, context)`), so the code follows Task 5: the admin-credit email says generic "Nạp điểm thành công", and the `TOPUP_REFUNDED` email has no amount. Choose: amend AC3 to match the code, or parametrize the email templates.
- [x] [Review][Patch] Task 10 backend unit tests marked done but missing: non-ADMIN / inactive capability → 403 (only self-review is asserted), audit key `admin-audit:topup-mismatch:{id}`, `listActionRequired` sort by `resolveDueAt` + overdue boundary, uncredited join excluding mismatch rows, recheck `REFUNDED` result, notification handler old branches unchanged [apps/backend/src/modules/economy/application/payos-top-up-mismatch.service.spec.ts:139]
- [x] [Review][Patch] Credit radio stays selectable when `p < 1`, and the drawer defaults to CREDIT, so a 150đ row opens on a disabled primary button (AC2: option disabled with explanation) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/MismatchDrawer.tsx:13]
- [x] [Review][Patch] Deadline line prints "(quá hạn)" lowercase via `sla.line.toLowerCase()`; AC2 says "Quá hạn" [apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/MismatchDrawer.tsx:30]
- [x] [Review][Patch] MSW seed has no mismatch row with 2 business days left (Task 9: 100.000/98.000 "Còn 2 ngày làm việc"); all non-overdue rows have ~3 days [apps/frontend/my-app/mocks/data/admin-payos-top-ups.ts:31]
- [x] [Review][Defer] Action-required lists capped at 100 per queue while the tab badge counts all rows; null-`paidAt` mismatch rows sort last (`paidAt asc`) and are cut first [apps/backend/src/modules/economy/infrastructure/prisma-payos-top-up.repository.ts:175] — deferred, known `ponytail:` ceiling (not pre-existing)

## Dev Notes

### Scope boundary (read first)

In scope: "Cần xử lý" tab (mismatches + uncredited > 30 min alerts), B3 drawer, `ResolveTopUpMismatch` (credit / manual refund), its audit + user notifications, `TOPUP_REFUNDED` type + email, mismatch key helper for 13.10, recheck `REFUNDED` result. **Out of scope:** "Yêu cầu hoàn tiền" tab, B2 drawer, refund entity/hold (13.10–13.12); B4 banner (13.13); `PAID_ON_CLOSED_LINK` alerts in the tab (money received on a cancelled link; stays an Admin notification, Owner-confirmed); the drawer "AUDIT TRAIL" list and the "Phát hiện" row (see Decision D3); the sidebar "Nạp điểm" badge (stays manual PENDING, Decision D4); refund eligibility logic itself (13.10 consumes the prefix).

### Figma (verified 2026-10-16 via Figma MCP, file `mkudD5Ngi5RPyIAVxCcxXi`, page 30 `178:3`)

- `188:1260` "B1 · Cần xử lý": tab order PayOS 128 · Yêu cầu hoàn tiền 3 · **Cần xử lý 3** · Lịch sử thủ công (cũ) 46. Red alert banner; table columns Loại / Giao dịch / Người dùng / Yêu cầu / thực nhận / Hạn xử lý / action. Row 1 uncredited (pink row, "Đồng bộ lại" outlined button). Row 2 mismatch overdue (pink row, red "Quá hạn" chip, "Hạn 14/10 10:20", filled "Xử lý"). Row 3 mismatch "Còn 2 ngày làm việc" (amber text) "Hạn 19/10 09:41". Footnote line under the table.
- `189:2145` B3 credit (drawer `189:2214`, 560 px, right): header chips "Đang xử lý" (Figma admin vocabulary — reuse 13.7 `topUpChip`, as 13.8 did) + "Sai số tiền" + "Còn 2 ngày làm việc"; deadline info box; two amount cards (grey "Yêu cầu", amber "Thực nhận"); facts table Mã PayOS "PO-88174930 · VietQR", Tài khoản người trả "MB Bank · •••• 2210", Nội dung CK "RESCOM 2610140877", Phát hiện "14/10/2026 09:46 · webhook PayOS"; "CÁCH XỬ LÝ" radio cards (selected = green border + tint) with "User sẽ nhận 490 Điểm"; AUDIT TRAIL; footer "Để sau" text button + green "Cộng 490 Điểm ✓".
- `189:2296` B3 manual refund (drawer `189:2365`): second radio selected, "Ghi chú * bắt buộc" textarea inside the card, footer "Xác nhận đã hoàn tiền ✓".
- Figma "Nội dung CK RESCOM {orderCode}" differs from what payOS really receives (`RC{last7}`, adapter l.56): show the real value. Figma "· VietQR" suffix: drop (we do not store the method).
- No mobile frame for B3 / Cần xử lý → minimal mobile per 13.8 (cards, full-width drawer).

### Decisions taken in this story (D3–D5 + closed-link scope confirmed by Owner Quan 2026-10-16; D1, D2, D6, D7 defaults)

- **D1 — stale-preview guard.** The body carries `expectedAmountPaidVnd`; the repository CAS includes it. 13.5's C3 refresh can grow `amountPaidVnd` on a mismatch row at any minute, so the Admin must never credit a number they did not see.
- **D2 — uncredited source.** There is no column for "paid but uncredited" (the credit failed atomically, so the row is still `PROCESSING`/`CANCELLED`/`EXPIRED` with no provider facts). The source of truth is the 13.5 Outbox alert `topup-alert:UNCREDITED_AFTER_PAYMENT:{topUpId}` (one per top-up, never pruned), filtered by the row's live status. "Đồng bộ lại" = existing recheck; there is no manual credit for these rows (money proof must come from payOS).
- **D3 — no audit trail / "Phát hiện" in the drawer.** Neither the mismatch detection time nor its source is stored; building a timeline from Outbox rows is extra scope that no AC asks for. Drawer shows `paidAt` instead. Recorded Figma deviation.
- **D4 — sidebar badge unchanged.** The "Nạp điểm" nav badge stays the manual PENDING count (13.8 D6). Figma shows 6 (refund 3 + action 3); revisit in 13.12/13.13 when manual PENDING disappears.
- **D5 — paying account masked** to bank name + last 4 (Figma). The full number stays for the 13.12 refund drawer; for a mismatch refund the Admin uses the incoming transfer in the bank/payOS statement (Mã PayOS + amount + time identify it).
- **D6 — note storage.** New `resolution_note` column (not `rejection_reason`, which means a manual rejection). Not in the audit payload, not in the user notification.
- **D7 — replay vs conflict.** Same action on an already-resolved row = 200 `replayed` (safe double-click/retry); different outcome = 409. Mirrors legacy `rejectTopUp`.

### Current state of files touched (read each before editing)

- `packages/schemas/src/economy/payos-top-up.schema.ts` — keys l.13-17, `topUpStatusChangedEventSchema` l.93 (status enum lacks `MANUAL_REFUNDED`), alert schema l.115-124, `topUpAlertKey` l.126, `payosRecheckResultSchema` l.132, admin DTOs l.147-175 (`.strict()`; `adminTopUpTabCountsSchema` `{payos, manual}`).
- `packages/schemas/src/common/business-days.ts` — `addBusinessDays` (weekend start rolls to Monday 00:00, then keeps time of day). Exported from `@rescom/schemas`; FE can import it (13.8 imports schemas already).
- `payos-top-up.service.ts` — `applySnapshot` l.352, `creditTopUp` l.414 (lock → CAS allowed `PROCESSING|CANCELLED|EXPIRED|AMOUNT_MISMATCH` + `amountPaid === amountVnd` → `creditPayosTopUp` → `markSuccessful`), `recordMismatch` l.460, `event()` l.386, `recheck` l.585-679 (MANUAL_REFUNDED→MISMATCH at l.662), `listForAdmin` l.85, `tabCounts`, export l.~138. `handleWebhook` l.337 already ignores `SUCCESSFUL`/`MANUAL_REFUNDED`. Preserve all of it.
- `prisma-payos-top-up.repository.ts` — `lockForUpdate` l.302 (`SELECT … FOR UPDATE`), `transition` l.312 (overwrites `paidAt` — do not reuse for resolution), `markAmountMismatch` l.394 (C3 refresh keeps `paidAt`), `enqueueAdminAlert` l.569, `recordAdminAudit` l.594. `runInTransaction` joins the ambient UoW transaction (that is how `creditTopUp` keeps lock + journal + CAS atomic).
- `ledger.service.ts` — `postJournal` l.446 (idempotent by key; conflicting params → `IdempotencyConflictException`), `creditPayosTopUp` l.2286.
- `top-up.service.ts` — legacy `rejectTopUp` l.263-304 + `lockForReview` l.310 (capability + self-review rule, replay semantics) = template for D7 and capability.
- `payos-reconcile.job.ts` — SLA alert l.165-172 and l.289-312, UNCREDITED alert l.252-270.
- `top-up-notification.handler.ts` l.1-48 — status → type/message; `dedupeKey = event.idempotencyKey`, so the resolution event key `topup-mismatch:{id}` must differ from `topup-credit:{id}` (it does).
- `admin-top-up.controller.ts` — static routes `payos`, `tab-counts`, `payos/export` at l.55-108, then `:id/approve|reject|recheck`. Class guards `SessionAuthGuard, RolesGuard, @Roles('ADMIN')`.
- FE `admin/top-ups/components/` — `TopUpConsoleScreen` (tab param, counts, `revision`), `TopUpTabs` (2-tab literals), `PayosTopUpsPanel`, `PayosTopUpDrawer` (toasts render inside the drawer — modal `<dialog>` top layer), `ManualTopUpsPanel` (untouched). `components/ui/Toasts.tsx` (`actionLabel`, success/info auto-dismiss). `lib/admin/payos-top-up-admin*.ts`.

### API contract (after this story)

ADMIN only, session cookie, under `/admin/top-ups` (also `/api/admin/top-ups`):
- `GET /action-required` → `{ uncredited[], mismatches[] }`.
- `GET /tab-counts` → `{ payos, manual, actionRequired }`.
- `POST /:id/resolve-mismatch` (CSRF, JSON) `{ action: 'CREDIT', expectedAmountPaidVnd }` | `{ action: 'MANUAL_REFUND', expectedAmountPaidVnd, note }` → `{ topUpId, status, pointsCredited, replayed }`; 400 `VALIDATION_ERROR`; 403 capability/self; 404 `TOPUP_NOT_FOUND`; 409 `TOPUP_MISMATCH_ALREADY_RESOLVED` | `TOPUP_MISMATCH_AMOUNT_CHANGED` | `TOPUP_MISMATCH_NOTHING_TO_CREDIT`.
- `POST /:id/recheck` result enum gains `REFUNDED`.

### Guardrails

- **Credit once.** The two credit keys (`topup-credit:` vs `topup-mismatch:`) do not dedupe each other at the ledger; the guarantee is the row `FOR UPDATE` + status CAS in the same transaction as the journal. Never post the journal outside that transaction or before the lock. The unique `journalId` column is the second backstop.
- **AD-25:** `ReverseJournal` is forbidden on top-up credit journals; resolution never reverses anything.
- **PII:** full `counterAccountNumber`/`counterAccountName` never leave the repository on 13.9 routes; tests assert it. The note may contain bank data → only in the row.
- **Never flag-gated** (AD-25): resolution works with `PAYOS_ENABLED=false`.
- **Append-only enums:** `NOTIFICATION_TYPES` order is fixed; parity test with Prisma.
- **No money in FE:** the preview is display-only; the server recomputes floor.
- **Do not break** 13.4/13.5 e2e (webhook, reconcile, recheck races), 13.8 console tests, legacy manual review.

### Previous story intelligence (13.8, merged PR #42 `d8da885`)

- Tabs live in the URL (`?tab=`), counts fetched separately, `onChanged` bumps `revision` to reload list + badges.
- Review lessons: abort stale requests; clamp pager after an action; store error time (no `new Date()` in render); toasts inside modal drawers; mock admin login needs typed input; FE `instanceof ZodError` fails for `@rescom/schemas` errors → check `error.name === "ZodError"`; 390 px: `grid-cols-[minmax(0,1fr)]`.
- MSW SW responses cannot be delayed by Playwright `page.route` → loading state is checked by code, not screenshot.
- Tests are `node:test` over pure `lib/` modules; handlers importing `@/` cannot be unit-tested.

### Previous story intelligence (13.5, merged PR #41)

- C3: mismatch refresh updates `amountPaidVnd` but keeps the first `paidAt` → SLA anchor is stable (use stored `paidAt`).
- Alerts are once-per-key Outbox rows; recheck writes an audit row on every call (also on 503); FE never auto-retries recheck.
- One unreproduced flake in "serializes reconcile job, webhook, and admin recheck" — if it shows up again in this story's run, note it, do not mask it.

### Git intelligence

`d8da885` merge 13.8 (admin console), `30fb28c` 13.5 (reconcile + recheck), `8c05738` 13.4 (webhook + `CreditTopUp`). Pattern: shared schema → port + both repos → service → controller → e2e; FE service + pure rules + messages in `lib/`, components under the route folder, MSW handler + data.

### Project Structure Notes

- New BE: migration `20261020100000_top_up_mismatch_resolution`, `apps/backend/test/top-up-payos-mismatch{.prisma,}.e2e-spec.ts`.
- New FE: `lib/admin/payos-top-up-mismatch.ts`, `admin/top-ups/components/{ActionRequiredPanel,MismatchDrawer}.tsx`, `tests/admin-top-ups-mismatch.test.mjs`.
- Changed: schemas (payos-top-up, top-up, business-days, notification, email-delivery + specs), prisma schema, ledger service, economy port/repos/service/controller/exceptions/module, reconcile job, alert raiser, notification handler, email templates, http-exception filter, payOS adapter (description helper), FE console screen/tabs, services/messages, notification presentation, MSW.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.9] (l.1934-1947); UX-DR-P11, P13 (l.181, 183)
- [Source: prds/prd-project-rescom-2026-08-08/prd.md#FR-35] (l.585-599), FR-76 (l.601-607), FR-77 (l.609-618)
- [Source: architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-25] (l.212-280, credit commands l.226-231, state diagram l.270-280), AD-26 eligibility (l.289-296), command table (l.345)
- [Source: _bmad-output/implementation-artifacts/13-8-admin-top-up-console.md] (D6, review findings), `13-5-reconciliation-job-alerts-admin-recheck.md` (C3, alerts)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] l.471 (`TOPUP_AMOUNT_MISMATCH` type, now present)
- Figma `mkudD5Ngi5RPyIAVxCcxXi` frames `188:1260`, `189:2145` (`189:2214`), `189:2296` (`189:2365`)

### Owner decisions (confirmed by Owner Quan 2026-10-16)

1. D3 confirmed: no drawer AUDIT TRAIL and no "Phát hiện" row; show `paidAt`.
2. D4 confirmed: sidebar "Nạp điểm" badge unchanged (manual PENDING only).
3. D5 confirmed: paying account masked to bank name + last 4.
4. `PAID_ON_CLOSED_LINK` stays out of "Cần xử lý" (Admin notification only); revisit later.

## Dev Agent Record

### Agent Model Used

Gemini 3.8 Flash (Medium); gates + visual check completed by Claude Opus 5.5

### Debug Log References

- Full frontend regression: 944/944 passing. Backend unit: 371/371; backend broad e2e: 66/66; bounded-queue Prisma e2e: 4/4. Schema: 669 passing; migration chain: 17/17.
- 2026-10-16 re-run (Claude): schemas 669/669; backend unit 371/371; backend build OK; backend e2e `top-up migration notification` 13 suites / 67 tests pass (incl. mismatch Prisma concurrency); FE typecheck OK, lint 0 errors (3 pre-existing warnings in unrelated tests), `npm test` 944/944, `npm run build` OK.
- Visual check (playwright-cli, mock mode, 1440 + 390): tab + badge, uncredited banner/row, "Đồng bộ lại" toast, overdue row, both drawer modes, disabled credit for 150đ, note validation (blank/whitespace disabled), refund + credit success (badge 4→3→1), stale-amount 409 (drawer stays open on fresh 49.600đ / 248 Điểm), 390 px no horizontal scroll.
- Backend project lint reports pre-existing `src/common/http/csv.spec.ts:19` formatting issue; changed files lint clean.

### Completion Notes List

- Shared contracts, database migration, transactional mismatch credit/refund, alerts, notifications, Admin API, frontend action queue/drawer, and mocks implemented.
- Resolution uses row lock and status/amount CAS within ledger transaction. API masks paying account; audit excludes note text.
- Visual-check fixes: drawer is now full-width below `sm` (`max-sm:w-full`, was 358 px at 390); table "Quá hạn" is now a red chip (AC1), was red text.
- Known deviation: drawer subtitle shows email only (admin DTO has no user display name).
- Branch verified; not pushed (Owner pushes with `git push -u origin feat/13-9-amount-mismatch-resolution`).

### File List

- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`
- `apps/backend/src/modules/economy/application/ledger.service.spec.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts`
- `apps/backend/src/modules/economy/application/payos-top-up-admin.service.spec.ts`
- `apps/backend/src/modules/economy/application/payos-top-up.service.ts`
- `apps/backend/src/modules/economy/application/ports/payos-top-up-repository.port.ts`
- `apps/backend/src/modules/economy/application/top-up-admin-alerts.ts`
- `apps/backend/src/modules/economy/application/top-up-notification.handler.spec.ts`
- `apps/backend/src/modules/economy/application/top-up-notification.handler.ts`
- `apps/backend/src/modules/economy/economy.module.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-payos-top-up.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/jobs/payos-reconcile.job.ts`
- `apps/backend/src/modules/economy/infrastructure/payos-payment-provider.adapter.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-payos-top-up.repository.ts`
- `apps/backend/src/modules/economy/presentation/admin-top-up.controller.ts`
- `apps/backend/src/modules/notifications/application/email-templates.ts`
- `apps/backend/src/modules/notifications/infrastructure/notification-type.parity.spec.ts`
- `apps/backend/test/migration-chain.prisma.e2e-spec.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/TopUpConsoleScreen.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/TopUpTabs.tsx`
- `apps/frontend/my-app/lib/admin/payos-top-up-admin-messages.ts`
- `apps/frontend/my-app/lib/admin/payos-top-up-admin-service.ts`
- `apps/frontend/my-app/lib/admin/payos-top-up-admin.ts`
- `apps/frontend/my-app/lib/notifications/notification-presentation.ts`
- `apps/frontend/my-app/mocks/data/admin-payos-top-ups.ts`
- `apps/frontend/my-app/mocks/data/top-up.ts`
- `apps/frontend/my-app/mocks/db/store.ts`
- `apps/frontend/my-app/mocks/handlers/admin-payos-top-ups.ts`
- `packages/schemas/src/common/business-days.spec.ts`
- `packages/schemas/src/common/business-days.ts`
- `packages/schemas/src/economy/payos-top-up.schema.ts`
- `packages/schemas/src/economy/top-up.schema.ts`
- `packages/schemas/src/notifications/email-delivery.schema.spec.ts`
- `packages/schemas/src/notifications/email-delivery.schema.ts`
- `packages/schemas/src/notifications/notification.schema.spec.ts`
- `packages/schemas/src/notifications/notification.schema.ts`
- `apps/backend/prisma/migrations/20261020100000_top_up_mismatch_resolution/migration.sql`
- `apps/backend/src/modules/economy/application/payos-top-up-mismatch.service.spec.ts`
- `apps/backend/test/top-up-payos-mismatch.e2e-spec.ts`
- `apps/backend/test/top-up-payos-mismatch.prisma.e2e-spec.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/ActionRequiredPanel.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/top-ups/components/MismatchDrawer.tsx`
- `apps/frontend/my-app/lib/admin/payos-top-up-mismatch.ts`
- `apps/frontend/my-app/tests/admin-top-ups-mismatch.test.mjs`
- `packages/schemas/src/economy/payos-top-up-mismatch.schema.spec.ts`

### Change Log

- 2026-10-16: Implemented amount-mismatch resolution across contracts, backend, and frontend; added automated coverage. Visual gate pending.
- 2026-10-16: Quality gates re-run green; visual check done; fixed mobile drawer width and overdue chip. Status → review.
