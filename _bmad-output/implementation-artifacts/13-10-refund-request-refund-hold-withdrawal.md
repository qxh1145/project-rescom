---
baseline_commit: 4c2e792
---
# Story 13.10: Refund Request, Refund Hold & Withdrawal

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a User,
I want to request a refund of a mistaken top-up within 24 hours,
so that I get my money back to the account I paid from.

## Acceptance Criteria

1. **Entity + ledger class.** Given a `PAYOS` `SUCCESSFUL` top-up not credited through mismatch resolution, when its owner submits a refund request before `refundDeadline` = `paidAt` + 24 h (server clock, exclusive: accepted only while `now < refundDeadline`), Economy creates one `TopUpRefundRequest` (unique `topUpId`, `topUpJournalId` = the top-up's credit journal, `reason` from the fixed list, `note` 1–300 chars after trim, snapshot of the top-up's `counterAccount*`, `destinationVerified`), and `LedgerAccountClass.REFUND_HOLD` exists (no overdraft) (AD-26).
   - `destinationVerified = counterAccountBankId != null && counterAccountNumber != null && counterAccountName != null` (Owner amendment 2026-10-16 under FR-77: no holder name ⇒ unverified). Submission is never blocked by an unverified destination.
2. **Eligibility.** The request is `ELIGIBLE` only if, evaluated under the ledger account locks, Available ≥ `pointsCredited` **and** no spend journal follows the top-up credit journal. Eligible posts `USER_AVAILABLE → REFUND_HOLD` for `pointsCredited` with key `topup-refund-hold:{requestId}`. Not eligible stores `ineligibleReason` (`SPENT_SINCE_TOP_UP` | `INSUFFICIENT_AVAILABLE`) and posts no journal (FR-77, FR-78).
3. **Spend classification.** Spend journals are defined by one named Economy constant: a journal that debits the user's `USER_AVAILABLE` into `ESCROW` (publish `publish:`, reopen `reopen-escrow:`) or `SYSTEM_SINK` (voucher redemption `redemption:`). Every known journal key prefix that debits `USER_AVAILABLE` is classified `SPEND` or `NON_SPEND` in that constant; a completeness test fails when a `LedgerService` posting command produces a `USER_AVAILABLE` debit whose prefix is unclassified. Complaint/dispute reversals and the refund-hold/withdraw journals are `NON_SPEND`. A later escrow refund or redemption refund does not cancel a spend (AD-26).
4. **Atomic with spending.** Submission locks `TopUpRequest` row → (new) `TopUpRefundRequest` → ledger accounts by ascending id (AD-24/AD-25 lock order). A concurrent publish or voucher redemption either completes first (request becomes `NOT_ELIGIBLE`) or fails with insufficient Available, proven by a Prisma concurrency test for both.
5. **Same-transaction Outbox.** Request row, hold journal (if any), the user notification event, and the admin/mailbox event commit in one transaction. The mailbox email goes to `TOPUP_REFUND_MAILBOX` with the account number masked to its last 4 digits and a link to the Admin Panel.
6. **Refusals.** A second request for the same top-up (any status, including `WITHDRAWN`) → 409 `TOPUP_REFUND_ALREADY_REQUESTED`; after the deadline → 409 `TOPUP_REFUND_NOT_ALLOWED` `{ reason: 'DEADLINE_PASSED' }`; legacy `MANUAL` or non-`SUCCESSFUL` → 409 `TOPUP_REFUND_NOT_ALLOWED` `{ reason: 'LEGACY_MANUAL' | 'NOT_SUCCESSFUL' }`; mismatch-credited → 409 `TOPUP_REFUND_NOT_ALLOWED` `{ reason: 'MISMATCH_CREDITED' }`; another user's top-up → 404 `TOPUP_NOT_FOUND`. None of these writes anything.
7. **Withdrawal.** `WithdrawTopUpRefund` (`topup-refund-withdraw:{requestId}`, owner only, same lock order) moves a `REQUESTED` request to terminal `WITHDRAWN`, posts `REFUND_HOLD → USER_AVAILABLE` for the held amount only if a hold exists, and writes user + Admin notifications to the Outbox. Retrying on an already-`WITHDRAWN` request → `200 { replayed: true }` with no writes; on `REFUNDED`/`REJECTED` (13.12) → 409 `REFUND_ALREADY_RESOLVED`. Resubmission after withdrawal is refused (AC 6).
8. **Insufficient-Points payloads.** When the user has a Refund Hold > 0, the insufficient-Points error `details` in publish and reopen (`INSUFFICIENT_ESCROW_BALANCE`) and voucher quote/redemption (`INSUFFICIENT_POINTS`) carry `refundHoldPoints: N`; the field is absent when the hold is 0. Story 13.11 renders the message (UX-DR-P19). Epic 6 and Epic 12 regression suites pass.
9. **Wallet + history.** `GET` wallet `balance.refundHold` returns the real `REFUND_HOLD` balance (still excluded from `total`, 13.7 decision). Point history labels the hold "Giữ chờ hoàn tiền" and its release by withdrawal "Hoàn lại từ giữ chờ hoàn tiền" (FR-31); the release label is keyed so 13.12's rejection release can reuse it.
10. **Read API for 13.11.** The user top-up DTO (`GET /economy/top-ups/payos/:id` and list) adds `refundDeadline` (ISO or null) and `refund` = `{ canRequest, unavailableReason, request }` where `request` is the user's refund request summary (status, eligibility, ineligibleReason, reason, points, amountVnd, destination masked: bankId, bankName, holder name, last 4, `destinationVerified`, submittedAt, withdrawnAt) or null. The full account number never leaves the repository on user routes.

## Tasks / Subtasks

- [x] **Task 0: Preconditions**
  - [x] `git status --short --branch` → `feat/13-10-refund-request-refund-hold-withdrawal` (created 2026-10-16 from `origin/develop` `4c2e792`, PR #46 merged, upstream unset). Push later with `git push -u origin feat/13-10-refund-request-refund-hold-withdrawal`.
  - [x] Gate satisfied: Story 13.6 AC 8 recorded the `counterAccount*` result and the Owner FR-77 amendment (PRD `prd.md` l.627). No Figma gate (backend + label-only FE).
- [x] **Task 1: Shared contracts** (AC 1, 2, 6, 7, 8, 10) — `packages/schemas/src/economy/` (+ specs, export via `index.ts`).
  - [x] New `top-up-refund.schema.ts`:
    - `TOP_UP_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000`; `topUpRefundDeadline(paidAt: Date): Date`.
    - `TOP_UP_REFUND_NOTE_MAX = 300`; `topUpRefundReasonSchema = z.enum(['WRONG_AMOUNT','WRONG_ACCOUNT','NO_LONGER_NEEDED','OTHER'])` (UI copy in 13.11: Nạp nhầm số tiền · Nạp nhầm tài khoản Rescom · Không còn nhu cầu dùng Điểm · Lý do khác).
    - `topUpRefundStatusSchema = z.enum(['REQUESTED','WITHDRAWN','REFUNDED','REJECTED'])` (the last two are written only by 13.12; declared now to avoid a second enum migration).
    - `topUpRefundEligibilitySchema = z.enum(['ELIGIBLE','NOT_ELIGIBLE'])`; `topUpRefundIneligibleReasonSchema = z.enum(['SPENT_SINCE_TOP_UP','INSUFFICIENT_AVAILABLE'])`.
    - `topUpRefundUnavailableReasonSchema = z.enum(['NOT_SUCCESSFUL','LEGACY_MANUAL','DEADLINE_PASSED','MISMATCH_CREDITED','ALREADY_REQUESTED','WITHDRAWN'])`.
    - `submitTopUpRefundSchema` (`.strict()`): `{ reason, note: string trim 1–300 }`.
    - `userTopUpRefundRequestSchema` (`.strict()`): `{ id, status, eligibility, ineligibleReason|null, reason, points, amountVnd, destination: { bankId|null, bankName|null, holderName|null, last4|null, verified: boolean }, submittedAt, withdrawnAt|null }` — **no** note echo is needed but allowed; **never** the full account number.
    - `topUpRefundResultSchema` = `{ request: userTopUpRefundRequestSchema, replayed: boolean }`.
    - Keys: `topUpRefundHoldKey = (id) => \`topup-refund-hold:${id}\``, `topUpRefundWithdrawKey = (id) => \`topup-refund-withdraw:${id}\``, `topUpRefundResolveKey = (id) => \`topup-refund-resolve:${id}\`` (13.12 uses it; exported now so the classification constant can list it). Spec: none of them starts with `topup-credit:` / `topup-mismatch:`.
    - Events: `TOP_UP_REFUND_CHANGED_EVENT_TYPE = 'ECONOMY_TOPUP_REFUND_CHANGED'` (user notification) and `TOP_UP_REFUND_ADMIN_NOTICE_EVENT_TYPE = 'ECONOMY_TOPUP_REFUND_ADMIN_NOTICE'` (admin in-app + mailbox email), each with a `schemaVersion: 1` payload schema: `{ requestId, topUpId, userId, orderCode, status: 'REQUESTED'|'WITHDRAWN', eligibility, ineligibleReason|null, points, amountVnd, occurredAt }`; the admin notice adds `userEmail|null`, `reason`, `note`, `destination: { bankId|null, bankName|null, holderName|null, last4|null, verified }` (last 4 only — the full number never enters the Outbox).
  - [x] `payos-top-up.schema.ts` `payosTopUpSchema` (l.47): add `refundDeadline: datetime|null` and `refund: { canRequest: boolean, unavailableReason: topUpRefundUnavailableReasonSchema|null, request: userTopUpRefundRequestSchema|null }`. Keep the schema `.strict()` if it is; update FE mocks in the same story (Task 9).
  - [x] `ledger-account.schema.ts`: add `REFUND_HOLD` to `ledgerAccountClassSchema` and to `NON_OVERDRAFTABLE_ACCOUNT_CLASSES`; `canAccountClassOverdraft('REFUND_HOLD') === false` (spec).
  - [x] `wallet.schema.ts`: `refundHold` stays as is (already `int ≥ 0 default 0`); total formula unchanged.
  - [x] `notifications/notification.schema.ts` `NOTIFICATION_TYPES`: **append** `TOPUP_REFUND_REQUESTED`, `TOPUP_REFUND_WITHDRAWN` (never reorder). Do **not** add them to the email-type list in `email-delivery.schema.ts` (FR-57 emails the user only for Successful, Refunded, Rejected).
  - [x] Rewards: `rewards/redemption.schema.ts` (and quote schema if separate): `INSUFFICIENT_POINTS` details gain optional `refundHoldPoints: int > 0`. Spec next to `redemption.schema.spec.ts:10`.
- [x] **Task 2: DB** (AC 1, 2, 7).
  - [x] Prisma: `LedgerAccountClass` + `REFUND_HOLD`; `NotificationType` + `TOPUP_REFUND_REQUESTED`, `TOPUP_REFUND_WITHDRAWN`; enums `TopUpRefundStatus`, `TopUpRefundEligibility`, `TopUpRefundIneligibleReason`, `TopUpRefundReason`.
  - [x] Model `TopUpRefundRequest` → table `top_up_refund_requests`: `id uuid`, `topUpId @unique` (FK `top_up_requests`, Restrict), `userId` (FK users, Restrict), `topUpJournalId uuid` (FK `ledger_journals`, Restrict), `holdJournalId uuid? @unique`, `releaseJournalId uuid? @unique`, `status`, `eligibility`, `ineligibleReason?`, `reason`, `note varchar(300)`, `points Int`, `amountVnd Int`, `counterAccountBankId?`, `counterAccountBankName?`, `counterAccountName?`, `counterAccountNumber?`, `destinationVerified Boolean`, `withdrawnAt?`, `resolvedAt?` (13.12), `correlationId?`, `createdAt` (= submission time), `updatedAt`; index `[status, createdAt]`, `[userId, createdAt]`. Relation field on `TopUpRequest` (`refundRequest TopUpRefundRequest?`). 13.12 adds `bankTransferReference`, `bankTransferredAt`, admin/resolution fields — do not add them here.
  - [x] Migration `apps/backend/prisma/migrations/20261021100000_top_up_refund_request/migration.sql` (must sort after `20261020100000_top_up_mismatch_resolution`): `ALTER TYPE "LedgerAccountClass" ADD VALUE 'REFUND_HOLD'`, the two `NotificationType` values (model on `20261019100000_notification_type_topup_amount_mismatch`), `CREATE TYPE` ×4, `CREATE TABLE`, FKs, indexes. If Postgres refuses using a just-added enum value in the same transaction, split into two migrations like earlier enum migrations did.
  - [x] `prisma/sql/post-push-invariants.sql` (top-up block l.437-457, same idempotent `IF NOT EXISTS (pg_constraint)` DO-block style): `top_up_refund_requests_note_check` (`char_length(btrim(note)) BETWEEN 1 AND 300`), `..._points_check` (`points > 0`), `..._eligibility_check` (`(eligibility = 'ELIGIBLE') = (hold_journal_id IS NOT NULL)` and `(eligibility = 'NOT_ELIGIBLE') = (ineligible_reason IS NOT NULL)`), `..._withdrawn_check` (`(status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL)`), `..._release_check` (`release_journal_id IS NULL OR hold_journal_id IS NOT NULL`). Put the same CHECKs in the migration. Grep the file for any list of account classes (e.g. a "user classes need user_id" CHECK) and add `REFUND_HOLD` where user classes are listed.
  - [x] Run `migration-chain.prisma.e2e-spec.ts` and `notification-type.parity.spec.ts`.
- [x] **Task 3: Ledger** (AC 2, 3, 4, 7, 9) — `apps/backend/src/modules/economy/application/ledger.service.ts`.
  - [x] New `domain/spend-journals.ts` (pure, no Nest/Prisma imports — `test/architecture.spec.ts`):
    - `SPEND_DESTINATION_CLASSES = ['ESCROW','SYSTEM_SINK'] as const` — the eligibility rule (AD-26 "debits USER_AVAILABLE into ESCROW or SYSTEM_SINK").
    - `USER_AVAILABLE_DEBIT_JOURNALS: Record<prefix, 'SPEND'|'NON_SPEND'>` = `publish:` SPEND, `reopen-escrow:` SPEND, `redemption:` SPEND, `topup-refund-hold:` NON_SPEND, plus every other prefix the completeness test discovers (reversal keys of credit journals, dispute/complaint reversals → NON_SPEND).
    - `isSpendJournal(entries)` = has a negative entry on the user's `USER_AVAILABLE` and a positive entry on an account whose class ∈ `SPEND_DESTINATION_CLASSES`.
  - [x] Eligibility query **by entries, not by key prefix** (so an Admin raw `postJournal` into `SYSTEM_SINK` also counts): `ledgerRepo.hasSpendSince(userId, since: Date): Promise<boolean>` on both Prisma (`ledger_entries` of the user's USER_AVAILABLE with `amount < 0` joined to an entry of the same journal on an ESCROW/SYSTEM_SINK account, `journal.created_at >= since`) and in-memory repos.
  - [x] **Ordering guard (Decision D1).** `ledger_journals.created_at` is the JS `postedAt` taken *before* the account locks (ledger.service.ts l.~493), so a spend that started before the credit but committed after it can carry an earlier timestamp. Use `since = creditJournal.createdAt - SPEND_ORDER_SKEW_MS` with `SPEND_ORDER_SKEW_MS = 15_000` (> Prisma interactive `maxWait 2 s + timeout 5 s`, `prisma-unit-of-work.ts:7`). Mark with a `ponytail:` comment: conservative (a spend up to 15 s before the credit also counts), upgrade path = a monotonic journal sequence column.
  - [x] `placeTopUpRefundHold({ requestId, userId, points, creditJournalCreatedAt })` → `{ outcome: 'HELD', journalId } | { outcome: 'NOT_ELIGIBLE', reason }`:
    - `getOrCreateAccount(userId, 'REFUND_HOLD')` and USER_AVAILABLE **before** any lock (AD-26 "created before locking").
    - `postJournal({ key: topUpRefundHoldKey(requestId), entries: USER_AVAILABLE -points, REFUND_HOLD +points, description: 'Top-up refund hold: order N' }, { assertBeforeInsert })` — `assertBeforeInsert` runs under the account `FOR UPDATE` locks and throws a local `RefundSpendDetected` when `hasSpendSince(...)`. The locked balance check throws `InsufficientBalanceException` when Available < points.
    - Catch exactly those two → `NOT_ELIGIBLE` (`SPENT_SINCE_TOP_UP` / `INSUFFICIENT_AVAILABLE`). Both are JS throws (no SQL error), so the ambient transaction stays usable and the account locks stay held until commit; **prove it** with the Prisma e2e (the NOT_ELIGIBLE row must commit). If `postJournalTransaction` turns out to open its own savepoint/nested tx that rolls back the caller, stop and restructure (lock accounts explicitly, evaluate, then post) instead of swallowing a poisoned tx.
    - Check the spend rule first, then balance, so a user who spent and still has enough Available gets `SPENT_SINCE_TOP_UP` (FR-78 wording).
  - [x] `releaseTopUpRefundHold({ requestId, userId, points, key })` → posts `REFUND_HOLD → USER_AVAILABLE` (`topUpRefundWithdrawKey` here; 13.12 passes `topUpRefundResolveKey`), description `Top-up refund hold release: order N`. Use `assertReplayCompatible` semantics like `creditPayosTopUp` (l.~2293).
  - [x] `getWallet()` (l.~346-398): add `REFUND_HOLD` to the user account class list and return its balance as `refundHold` (remove the "13.10 adds" comment); `calculateWalletTotal` unchanged. `prisma-wallet-balance.reader.ts` (used by rewards `deps.wallet.getBalance`) gains `refundHold`.
  - [x] `reverseJournal` (l.535): also refuse `topup-refund-hold:` / `topup-refund-withdraw:` / `topup-refund-resolve:` keys (only the refund flow moves them), same message style as the top-up credit guard.
- [x] **Task 4: Repository + service** (AC 1, 2, 4–7, 10) — `payos-top-up-repository.port.ts`, `prisma-payos-top-up.repository.ts`, `in-memory-payos-top-up.repository.ts`, `payos-top-up.service.ts` (or a new `top-up-refund.service.ts` in `application/` if `payos-top-up.service.ts` grows past readability; register in `economy.module.ts`).
  - [x] Repo: `lockRefundRequestByTopUp(topUpId)` (`SELECT … FOR UPDATE` on `top_up_refund_requests`, null when absent), `createRefundRequest(data, events[])` (insert + `tx.outboxEvent.createMany` in the same `runInTransaction`; P2002 on `top_up_id` → `TopUpRefundAlreadyRequestedException`), `withdrawRefundRequest(id, { releaseJournalId|null, withdrawnAt }, events[])` (`updateMany where { id, status: 'REQUESTED' }` CAS → `{ changed }`), `findRefundRequestsByTopUpIds(ids)` for the DTO, and `findCreditJournal(journalId)` (or reuse ledger repo) for `createdAt` + `idempotencyKey`. Mask `counterAccountNumber` to last 4 **inside the repository** for every user-route read (13.9 pattern).
  - [x] `submitRefund(topUpId, body, { userId, correlationId })`: parse with `submitTopUpRefundSchema`; `unitOfWork.run(\`topup-refund-submit:${topUpId}\`, …)`:
    1. `repository.lockForUpdate(topUpId)` (l.468) — row missing or `userId ≠ caller` → 404 `TOPUP_NOT_FOUND`.
    2. `channel MANUAL` → `LEGACY_MANUAL`; status ≠ `SUCCESSFUL` → `NOT_SUCCESSFUL`; credit journal key starts with `TOP_UP_MISMATCH_JOURNAL_KEY_PREFIX` (13.9) → `MISMATCH_CREDITED`; `now >= topUpRefundDeadline(paidAt)` → `DEADLINE_PASSED` (all 409 `TOPUP_REFUND_NOT_ALLOWED`). `paidAt` or `journalId` null on a SUCCESSFUL PAYOS row = data bug → throw (500), log.
    3. `lockRefundRequestByTopUp` → exists → 409 `TOPUP_REFUND_ALREADY_REQUESTED`.
    4. `requestId = randomUUID()`; `ledgerService.placeTopUpRefundHold(...)` with `points = pointsCredited`.
    5. `createRefundRequest` with snapshot (`counterAccount*` copied as stored), `destinationVerified` (AC 1), `amountVnd = amountPaidVnd`, verdict, journal id, plus 2 Outbox events: user (`TOP_UP_REFUND_CHANGED`, key `topup-refund-notice:{requestId}:REQUESTED`) and admin notice (key `topup-refund-admin:{requestId}:REQUESTED`).
    6. Return `{ request, replayed: false }`.
  - [x] `withdrawRefund(topUpId, { userId, correlationId })`: `unitOfWork.run(topUpRefundWithdrawKey(...))` → lock top-up row (owner check → 404) → lock refund request (none → 404 `TOPUP_REFUND_NOT_FOUND`) → `WITHDRAWN` → `{ replayed: true }`; `REFUNDED`/`REJECTED` → 409 `REFUND_ALREADY_RESOLVED`; `REQUESTED` → `releaseTopUpRefundHold` if `holdJournalId` → `withdrawRefundRequest` CAS (`changed=false` after the lock = bug → throw) + events (`…:WITHDRAWN` keys).
  - [x] `dto()` (~l.890) / `getOwned` / `listOwned`: add `refundDeadline` (`SUCCESSFUL` PAYOS with `paidAt` → ISO, else null) and `refund` (`canRequest` + first matching `unavailableReason` in this order: NOT_SUCCESSFUL, MISMATCH_CREDITED, WITHDRAWN, ALREADY_REQUESTED, DEADLINE_PASSED; `request` summary). List: one batched `findRefundRequestsByTopUpIds`, no N+1.
  - [x] Exceptions in `application/exceptions/economy.exceptions.ts` with `readonly code` + HTTP status on the class (13.9 pattern, `TOPUP_EXPORT_TOO_LARGE`): `TOPUP_REFUND_NOT_ALLOWED` (409, `details.reason`), `TOPUP_REFUND_ALREADY_REQUESTED` (409), `TOPUP_REFUND_NOT_FOUND` (404), `REFUND_ALREADY_RESOLVED` (409). Check `http-exception.filter.spec.ts` for a code allowlist.
- [x] **Task 5: Insufficient-Points payloads** (AC 8).
  - [x] `InsufficientEscrowBalanceException` (`economy.exceptions.ts:23`) gains optional `refundHoldPoints`; `reserveEscrow` (l.835), `reopenEscrow` (l.1187) and `postPublisherEscrowLock` (l.1254) read the user's REFUND_HOLD balance when they build it; `http-exception.filter.ts:558-575` adds `refundHoldPoints` to `details` only when > 0.
  - [x] Rewards: `rewards-quote.service.ts:158` and `rewards-redemption.service.ts:86-107` add `refundHoldPoints` to the `INSUFFICIENT_POINTS` `details` when > 0 (from the widened wallet reader). Keep `required`/`available` unchanged.
- [x] **Task 6: Notifications + mailbox** (AC 5, 7).
  - [x] User: a handler for `ECONOMY_TOPUP_REFUND_CHANGED` (extend `top-up-notification.handler.ts` with a second registered handler class, or a new `top-up-refund-notification.handler.ts` — the Outbox dispatches by `eventType`). `REQUESTED` + `ELIGIBLE` → `TOPUP_REFUND_REQUESTED` "Đã gửi yêu cầu hoàn tiền cho giao dịch nạp mã {orderCode}. {points} Điểm đang được giữ chờ hoàn tiền; Admin xử lý trong 3 ngày làm việc."; `REQUESTED` + `NOT_ELIGIBLE` → same type "Đã ghi nhận yêu cầu hoàn tiền cho giao dịch nạp mã {orderCode}, nhưng yêu cầu không đủ điều kiện vì Điểm đã được sử dụng sau khi nạp. Không có Điểm nào bị giữ."; `WITHDRAWN` → `TOPUP_REFUND_WITHDRAWN` "Bạn đã rút yêu cầu hoàn tiền cho giao dịch nạp mã {orderCode}." + (hold) " {points} Điểm đã trở lại Khả dụng." (copy `ASSUMED (design)`). `dedupeKey = event idempotencyKey`. Keep existing branches byte-identical.
  - [x] Admin: new `top-up-refund-admin-notice.handler.ts` modeled on `infrastructure/top-up-admin-alert.handler.ts` (`runsOutsideTransaction = true`, leg 1 in-app to active admins, leg 2 email to `getRefundMailbox()`, retryable error class, skip+log the email leg when the mailbox is null). Email subject `Rescom: Yêu cầu hoàn tiền #{orderCode}` / `Rescom: Đã rút yêu cầu hoàn tiền #{orderCode}`; body: orderCode, user email, amount VNĐ, Points, verdict + reason, user reason + note, destination "{bankName ?? bankId} · {holderName ?? 'Chưa có tên chủ tài khoản'} · •••• {last4}" + "Chưa xác minh — xác nhận với người dùng qua email trước khi chuyển" when unverified, submitted time (Asia/Ho_Chi_Minh), link `${env.emailAppBaseUrl}/admin/top-ups?tab=refunds&request={requestId}` (the tab ships in 13.12; the link must already be this shape). Wire in `economy.module.ts` next to :209-216.
  - [x] FE `lib/notifications/notification-presentation.ts`: `TOPUP_REFUND_REQUESTED` (icon `refund`, tone `amber`, href `/wallet/top-up/{topUpId}` if the payload carries it, else `/wallet`, label "Yêu cầu hoàn tiền"), `TOPUP_REFUND_WITHDRAWN` (tone neutral, label "Đã rút yêu cầu hoàn tiền"). Notifications must render without 13.11.
- [x] **Task 7: Controller** (AC 6, 7, 10) — `presentation/payos-top-up.controller.ts`.
  - [x] `POST :id/refund-request` and `POST :id/refund-request/withdraw`: copy the `cancel` route (`CsrfGuard, JsonOnlyGuard`, `@HttpCode(200)`, `ParseUUIDPipe`, `ZodValidationPipe(submitTopUpRefundSchema, 'VALIDATION_ERROR', 'body')` on submit, `x-correlation-id`, `@CurrentUser()`), `createSuccessEnvelope(topUpRefundResultSchema.parse(...))`. **Not** gated by `PayosCheckoutEnabledGuard` / `PAYOS_ENABLED` (AD-25: post-payment flows always work).
- [x] **Task 8: FE point-history labels** (AC 9) — `apps/frontend/my-app/lib/wallet/wallet-history.ts`.
  - [x] `HistoryKind` + `KEY_PREFIXES` (l.75): `["topup-refund-hold:","TOP_UP_REFUND_HOLD"]`, `["topup-refund-withdraw:","TOP_UP_REFUND_RELEASE"]` (13.12 adds `topup-refund-resolve:` and splits release vs refund by entries); `TITLES`: "Giữ chờ hoàn tiền" / "Hoàn lại từ giữ chờ hoàn tiền"; `ZERO_NET_DIRECTION` / `notesOf` so the hold reads as Available out and the release as Available in. Mirror in `mocks/data/economy-rules.ts:25` and `lib/admin/admin-transactions.ts:148`.
  - [x] Confirm `wallet/components/BalanceGrid.tsx:26,63` reads `balance.refundHold` from the API (no hard-coded 0); drop the "until 13.10" note.
- [x] **Task 9: MSW** — `mocks/data/top-up.ts`, `mocks/handlers/*top-up*`, wallet mock.
  - [x] Mock PayOS top-ups gain `refundDeadline` + `refund` (default `{ canRequest: true|false, unavailableReason, request: null }`) so schema parsing passes; bump `SCHEMA_VERSION` in `mocks/db/store.ts` if `MockPayosTopUp` gains fields. Mock refund routes are **13.11's** job; add them here only if a test needs them. Run `tests/route-diff.test.mjs` (it may flag the two new backend routes as missing in MSW — add minimal handlers returning the documented shapes if it does).
- [x] **Task 10: Tests**
  - [x] Schemas: deadline helper (exclusive edge: `paidAt + 24h - 1ms` allowed, `paidAt + 24h` refused is the service's job — helper returns the instant), note trim/length (0, 1, 300, 301, whitespace), reason enum, strict DTO has no `counterAccountNumber`, key prefix distinctness, `REFUND_HOLD` non-overdraft, rewards details optional field, notification type append order.
  - [x] **Completeness test** `apps/backend/src/modules/economy/application/spend-journals.completeness.spec.ts`: run every public posting command of `LedgerService` on the in-memory ledger (table of `[methodName, invoke]`), collect journals with a negative USER_AVAILABLE entry, and assert each key prefix ∈ `USER_AVAILABLE_DEBIT_JOURNALS` and that `isSpendJournal` agrees with its SPEND/NON_SPEND label. A guard asserts `Object.getOwnPropertyNames(LedgerService.prototype)` ⊆ (exercised ∪ explicit `NON_POSTING_METHODS`), so a new posting method fails the test until classified. Include `reverseJournal` of a dispute/complaint payout (NON_SPEND).
  - [x] Backend unit (`top-up-refund.service.spec.ts`): eligible hold (journal key, amounts, events ×2, `destinationVerified` true/false incl. name-null probe shape), NOT_ELIGIBLE spend (publish after credit), NOT_ELIGIBLE spend + still-enough Available → `SPENT_SINCE_TOP_UP`, NOT_ELIGIBLE insufficient, redemption that was later refunded still counts, escrow close-refund does not count, every refusal of AC 6 writes nothing, deadline boundary (−1 ms ok / exact refused), withdraw with/without hold, withdraw replay, withdraw on REFUNDED → 409, resubmit after withdraw → 409, other user → 404, DTO `refund.unavailableReason` order, mailbox email body has last 4 only + link, handler skips email leg when mailbox null. In-memory repo mirrors Prisma semantics.
  - [x] Prisma e2e `apps/backend/test/top-up-refund.prisma.e2e-spec.ts` (model on `top-up-payos-reconcile.prisma.e2e-spec.ts:127-211`, harness `test/fixtures/financial-pg-harness.ts`): (a) `Promise.all([submitRefund, reserveEscrow(publish for the same user using the top-up Points)])` repeated N times → every run ends with exactly one of {request ELIGIBLE + publish failed INSUFFICIENT_ESCROW_BALANCE} or {publish succeeded + request NOT_ELIGIBLE}; balances non-negative; (b) same with `spendPoints` (redemption); (c) two concurrent submits → one request, one hold journal, one 409; (d) concurrent withdraw ×2 → one release journal; (e) NOT_ELIGIBLE path commits the request row (proves the ambient tx survives the caught throw); (f) CHECK constraints reject an ELIGIBLE row without `hold_journal_id`.
  - [x] HTTP e2e `apps/backend/test/top-up-refund.e2e-spec.ts`: 401, no CSRF 403, 400 bad body (note 301, unknown reason, extra key), 404 other user, response never contains a full account number, works with `PAYOS_ENABLED=false`.
  - [x] Regression (AC 8): Epic 6 `financial-publisher.prisma.e2e-spec.ts` + forms escrow specs and Epic 12 `rewards-redemption.prisma.e2e-spec.ts`, `rewards-flash.prisma.e2e-spec.ts` pass; add one assertion each that `refundHoldPoints` appears only when a hold exists.
  - [x] FE `tests/wallet-history*.test.mjs`: the two new labels and directions; notification presentation for the two new types.
  - [x] Run: `npm test --workspace @rescom/schemas`; backend `npm test --workspace backend -- top-up ledger notification rewards forms`, `npm run test:e2e --workspace backend -- top-up migration notification financial rewards`, `npm run build --workspace backend`; FE `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` in `apps/frontend/my-app`.

### Review Findings

Code review 2026-10-16 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, Sonnet). 0 decision-needed, 7 patch (all applied 2026-10-16), 1 defer, 12 dismissed.

- [x] [Review][Patch] Admin mailbox HTML interpolates unescaped user/provider text (`note`, `userEmail`, `holderName`, `bankName`) — markup/fake links injectable into the finance mailbox email (AC 5). Use `escapeHtml` from `notifications/application/email-templates.ts`; also render `reason`/`ineligibleReason` as Vietnamese labels, not raw enum codes [apps/backend/src/modules/economy/infrastructure/top-up-refund-admin-notice.handler.ts:152]
- [x] [Review][Patch] AC 4 proof incomplete: no Prisma race vs `spendPoints` (redemption) — Task 10 (b); the publish race runs once and accepts either branch instead of N repetitions asserting exactly one of the two outcomes — Task 10 (a) [apps/backend/test/top-up-refund.prisma.e2e-spec.ts:242]
- [x] [Review][Patch] No deterministic Prisma test that a NOT_ELIGIBLE request row commits (ambient tx survives the caught throw) — Task 10 (e), Task 3 "prove it" [apps/backend/test/top-up-refund.prisma.e2e-spec.ts]
- [x] [Review][Patch] Ticked test bullets without assertions: HTTP e2e "extra key" 400 (schema is `.strict()`, untested); `reverseJournal` refusal of `topup-refund-hold:`/`-withdraw:`/`-resolve:` untested; AC 8 regression assertions for `refundHoldPoints` (reopen, voucher quote/redemption, absent at hold 0) not added to Epic 6/12 suites; FE `wallet-history` + notification-presentation tests missing (Task 10) [apps/backend/test/top-up-refund.e2e-spec.ts:202]
- [x] [Review][Patch] Completeness test does not invoke most posting methods — `EXERCISED_OR_KNOWN_POSTING_METHODS` whitelists them, so a new USER_AVAILABLE debit prefix on those paths passes (AC 3 / Task 10 completeness) [apps/backend/src/modules/economy/application/spend-journals.completeness.spec.ts:191]
- [x] [Review][Patch] `listOwned` reads the credit journal once per row (`Promise.all` of `findCreditJournal`) — spec requires batched lookup, no N+1 (Task 4) [apps/backend/src/modules/economy/application/payos-top-up.service.ts:910]
- [x] [Review][Patch] Migration adds FKs `top_up_journal_id`/`hold_journal_id`/`release_journal_id` → `ledger_journals` that `schema.prisma` does not declare — `db push` path lacks them and `migrate diff` reports drift; declare the relations (with back-relations) or move the FKs into `post-push-invariants.sql`. Also Task 8 mirror in `mocks/data/economy-rules.ts` (`MockTransactionKind` has no refund hold/release) not done [apps/backend/prisma/schema.prisma:1087]
- [x] [Review][Defer] `rewards-flash.prisma.e2e-spec.ts` › "lifecycle job reserves quota at start … returns unsold quota on settle" fails (`settleRun.settled` 0) [apps/backend/test/rewards-flash.prisma.e2e-spec.ts:144] — deferred, pre-existing (fails identically on clean HEAD 4c2e792)

Review cycle 2 (2026-10-16): 0 decision-needed, 7 patch (all applied 2026-10-16), 0 defer, 5 dismissed.

- [x] [Review][Patch] `PayosTopUpService.dto` returns `canRequest: true` when `paidAt` is null on `SUCCESSFUL` top-up [apps/backend/src/modules/economy/application/payos-top-up.service.ts:974]
- [x] [Review][Patch] `placeTopUpRefundHold` missing `assertReplayCompatible` on fast-path idempotency replay [apps/backend/src/modules/economy/application/ledger.service.ts:2632]
- [x] [Review][Patch] `TopUpRefundService.submitRefund` checks channel before status, conflicting with `dto` precedence [apps/backend/src/modules/economy/application/top-up-refund.service.ts:66]
- [x] [Review][Patch] `submitRefund` and `withdrawRefund` omit `orderCode` when invoking ledger hold/release [apps/backend/src/modules/economy/application/top-up-refund.service.ts:113]
- [x] [Review][Patch] `findCreditJournal`, `findCreditJournalKeysByIds`, and `getUserEmail` execute outside ambient unit-of-work transaction [apps/backend/src/modules/economy/infrastructure/prisma-payos-top-up.repository.ts:999]
- [x] [Review][Patch] Admin withdrawal mailbox email states `"Đủ điều kiện (đã giữ Điểm)"` after hold was already released [apps/backend/src/modules/economy/infrastructure/top-up-refund-admin-notice.handler.ts:145]
- [x] [Review][Patch] `submitRefund` duplicates manual DTO mapping instead of using `toUserRefundDto` [apps/backend/src/modules/economy/application/top-up-refund.service.ts:227]

## Dev Notes

### Scope boundary (read first)

In scope: `TopUpRefundRequest` + `REFUND_HOLD`, submit (eligibility + hold), withdraw, spend classification + completeness test, user/admin notifications + mailbox email, `refundHoldPoints` in insufficient-Points errors, real `refundHold` wallet balance, two history labels, read fields for 13.11.

Out of scope: every refund **screen** (form, confirm dialog, result, status views, countdown, disabled reasons, the "N Điểm đang giữ chờ hoàn tiền" message) → **13.11**. `ResolveTopUpRefund` (REFUNDED/REJECTED), `bankTransferReference`/`bankTransferredAt`, Admin "Yêu cầu hoàn tiền" tab + B2 drawer, admin refund API, 3-business-day overdue alert job, user emails for Refunded/Rejected, CSV refund columns, "Hoàn tiền nạp Điểm" history label → **13.12**. Bank-id → bank-name lookup / bank logos → 13.11 (P15 placeholders). Do not touch the top-up `TopUpStatus` enum: a refund lives on its own entity; the top-up row stays `SUCCESSFUL` (PRD FR-77 "the top-up shows Successful again" is a display rule for 13.11).

### Decisions taken in this story (defaults; Owner may override — see Questions)

- **D1 — spend ordering skew.** Journal `createdAt` is taken before locks, so eligibility looks back `SPEND_ORDER_SKEW_MS = 15 s` before the credit journal. Errs toward NOT_ELIGIBLE (the Admin can still refund manually via 13.12's hold-less reject note path); never toward holding spent Points.
- **D2 — spend by entries.** The eligibility query detects spends by account flow (USER_AVAILABLE → ESCROW/SYSTEM_SINK), which also catches Admin raw journals; the key-prefix table exists for the completeness test and history labels.
- **D3 — `destinationVerified`** requires bank id + number + holder name (Owner amendment: the live MoMo probe had no holder name and an empty bank name).
- **D4 — status enum includes 13.12 values** (`REFUNDED`, `REJECTED`) now, unused until 13.12, to avoid a second Postgres enum migration.
- **D5 — routes keyed by top-up id** (`/economy/top-ups/payos/:id/refund-request[/withdraw]`), since there is at most one request per top-up.
- **D6 — mailbox gets both submit and withdraw** emails (the Admin works from that mailbox); user refund-requested/withdrawn are in-app only (FR-57 email list unchanged).
- **D7 — submit is not replay-safe by design:** a retry after success returns 409 `TOPUP_REFUND_ALREADY_REQUESTED`; 13.11 reloads the detail on that code. Withdraw is replay-safe (200 `replayed`).

### Current state of files touched (read each before editing)

- `apps/backend/prisma/schema.prisma` — `NotificationType` l.173 (ends `TOPUP_AMOUNT_MISMATCH`, `TOPUP_REFUNDED`), `TopUpStatus` l.222, `LedgerAccountClass` l.261 (no REFUND_HOLD), `LedgerAccount` l.580 (denormalized `balance`, unique userId+class+currency, NULLS NOT DISTINCT rebuilt in invariants l.200-216), `LedgerJournal` l.597 (`idempotencyKey @unique`, `reversesJournalId`; **no journal-type column** — type = key prefix), `OutboxEvent` l.875, `TopUpRequest` l.1012 (`journalId @unique`, `pointsCredited`, `amountPaidVnd`, `paidAt`, `counterAccount*`; no refund fields).
- `prisma/sql/post-push-invariants.sql` l.437-457 — top-up CHECKs and the one-PROCESSING unique index. Enum values are **not** mirrored there.
- `ledger.service.ts` — `getOrCreateAccount` l.287, `getWallet` l.346 (`refundHold: 0` placeholder l.398), `postJournal` l.448 (idempotent fast path, `IdempotencyConflictException` on mismatched replay, `options.assertBeforeInsert` runs under locks; `postedAt` taken at l.~493), `reverseJournal` l.535 (refuses `topup-credit:`/`topup-mismatch:`), `transfer` l.807, `reserveEscrow` l.835 (unlocked pre-check, then `postPublisherEscrowLock` l.1254 converts locked `InsufficientBalanceException`), `reopenEscrow` l.1187, dispute hold l.1781/l.1908 (credit USER_AVAILABLE), `creditPayosTopUp` l.2293, `creditMismatchTopUp` l.2318, `spendPoints` l.2385 (`redemption:{userId}:{key}`), `assertReplayCompatible` l.2447.
- `infrastructure/prisma-ledger.repository.ts` `postJournalTransaction` l.305 — sum = 0, distinct account ids ascending `SELECT … FOR UPDATE`, `assertBeforeInsert`, non-system overdraft → `InsufficientBalanceException('Insufficient balance for ledger posting.')` (l.380-390, generic message on purpose, Epic 6 review P11 — keep it generic; amounts go only into `details`). In-memory twin `in-memory-ledger.repository.ts:292`.
- `payos-top-up.service.ts` — `resolveMismatch` l.176 (13.9 command template), `checkout` l.369, `cancel` l.447, `creditTopUp` l.603, `getOwned` l.868, `listOwned` l.873, `dto()` ~l.890. `prisma-payos-top-up.repository.ts` — `resolveMismatch` l.275 (CAS + `createMany` events l.309), `lockForUpdate` l.468, outbox inserts l.438-450/523/618/715, `enqueueAdminAlert` l.735, `recordAdminAudit` l.762. `runInTransaction` joins the ambient UoW transaction.
- `presentation/payos-top-up.controller.ts` — `@Controller(['economy/top-ups/payos','api/economy/top-ups/payos'])`, `SessionAuthGuard`; `cancel` route is the template.
- `infrastructure/top-up-admin-alert.handler.ts` — two-leg handler (in-app WARNING to active admins via `AdminCapabilityPort` + `NotificationPublisherPort`, email via `EmailSenderPort` to `getRefundMailbox()`), `runsOutsideTransaction = true`. `application/top-up-notification.handler.ts` — status event → user notification.
- `common/config/env.service.ts` — `topUpRefundMailbox` l.107, `emailAppBaseUrl` l.141; `env.schema.ts` `TOPUP_REFUND_MAILBOX` l.213 (required when PayOS configured, l.388).
- `economy.exceptions.ts` — `InsufficientBalanceException` l.12, `InsufficientEscrowBalanceException` l.23 (`availableBalance`, `requiredAmount`). `common/http/http-exception.filter.ts` l.558-575 maps them to 409 with `details` for escrow only.
- Rewards — `rewards-quote.service.ts:158` (`INSUFFICIENT_POINTS` `{required, available}`), `rewards-redemption.service.ts:86-107` (locked failure → `INSUFFICIENT_POINTS`, `recordFailure`), ports `SPEND_POINTS_PORT` / `REVERSE_SPEND_PORT` at `economy.module.ts:105-121`, error codes `rewards.exceptions.ts:19,58`.
- FE — `lib/wallet/wallet-history.ts` (`HistoryKind` l.23, `KEY_PREFIXES` l.75, `ZERO_NET_DIRECTION` l.106, `TITLES` l.117), `mocks/data/economy-rules.ts:25`, `lib/admin/admin-transactions.ts:148`, `wallet/components/BalanceGrid.tsx:26,63`, `lib/notifications/notification-presentation.ts`.

### Guardrails

- **Lock order (AD-24/25/26):** `TopUpRequest` row → `TopUpRefundRequest` row → ledger accounts ascending (inside `postJournalTransaction`). Create the REFUND_HOLD account before any lock. Never lock ledger accounts first.
- **Eligibility only under the account locks** (`assertBeforeInsert` + the locked balance check). An unlocked pre-check may short-circuit a refusal but never decides ELIGIBLE.
- **AD-1:** hold/release are ordinary journals; never set `reversesJournalId`; `ReverseJournal` refuses refund keys and top-up credits.
- **No balance goes negative**; REFUND_HOLD is non-overdraftable. A user ban never touches REFUND_HOLD.
- **PII (repo is public):** full `counterAccountNumber` stays in DB rows; DTOs, Outbox payloads, logs, and the mailbox email carry last 4 only. Test fixtures use `****`+last4 and `T***` names. Never commit a real email/bank ref.
- **Never flag-gated:** submit/withdraw work with `PAYOS_ENABLED=false`.
- **Append-only enums** (`NOTIFICATION_TYPES` parity test with Prisma).
- **Do not break:** 13.4/13.5/13.9 races (webhook, reconcile, recheck, mismatch), Epic 6 escrow, Epic 12 redemption + flash sale, wallet total (refundHold excluded), legacy manual review.

### Previous story intelligence

- **13.9** (`d8da885`…, done): command shape = `unitOfWork.run(key)` → `lockForUpdate` → CAS `updateMany` + Outbox `createMany` in one `runInTransaction`; replay 200 vs conflict 409; exceptions carry `code` + status; PII masked inside the repository; `TOP_UP_MISMATCH_JOURNAL_KEY_PREFIX` + `topUpMismatchKey` exported from `@rescom/schemas` for this story. Review lesson: tasks ticked without tests were caught — every Task 10 bullet needs a real assertion. Emails are one fixed body per type (`renderNotificationEmail`), so parametrized mailbox mail belongs in the admin-notice handler (it builds its own subject/body like the alert handler).
- **13.6** (done): live probe paid via MoMo: `counterAccountBankId="970422"`, `counterAccountNumber` present, `counterAccountName=null`, bank name `""` → normalized to `null` (`payos-mapping.ts:93`). Fixtures `test/fixtures/payos-recorded/{webhook-paid-live,payment-link-paid-live}.json` (redacted via `application/payos-redact.ts`). Reuse them for a realistic "unverified destination" case. Probe top-up `orderCode 1000000001` holds 50 Points on the Owner account — do not touch prod data.
- **13.5:** one unreproduced flake in "serializes reconcile job, webhook, and admin recheck" — note it if seen, don't mask.
- **13.8:** FE `instanceof ZodError` fails across the schemas package → check `error.name === "ZodError"`.

### Git intelligence

`4c2e792` merge PR #46 (13.6 Part B record), `6ac3766`, `59f676e`, `e1a1632` (13.6 tooling: `confirmWebhook`, `getPaymentRecord`, redaction), `fdd64c5` merge PR #43 / `8a7f3fb` (13.9 mismatch resolution). Pattern: shared schema → Prisma + migration + invariants → ledger → port + both repos → service → controller → handlers → e2e; FE `lib/` pure modules + `node:test`.

### Latest tech information

No new library. Postgres `ALTER TYPE … ADD VALUE` cannot be used in the same transaction that adds it (PG ≥ 12 allows the ADD inside a tx but not using the value before commit) — keep the CHECKs that reference new enum values in a later statement/migration if the chain fails. Prisma interactive tx defaults in `prisma-unit-of-work.ts` (maxWait 2 s, timeout 5 s) drive D1.

### Project Structure Notes

- New BE: `domain/spend-journals.ts`, `application/top-up-refund.service.ts` (optional split), `infrastructure/top-up-refund-admin-notice.handler.ts`, migration `20261021100000_top_up_refund_request`, `test/top-up-refund{.prisma,}.e2e-spec.ts`, completeness spec.
- New schemas: `packages/schemas/src/economy/top-up-refund.schema.ts` (+ spec).
- Changed: prisma schema + invariants, ledger service + both ledger repos + wallet reader, payos port/repos/service/controller/exceptions/module, notification handler, http-exception filter, forms escrow + rewards quote/redemption details, schemas (payos-top-up, ledger-account, notification, rewards redemption), FE wallet-history + economy-rules mock + admin-transactions + notification presentation + BalanceGrid + top-up mocks.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.10] (l.1949-1967); UX-DR-P6..P9, P17..P19, P23, P25 (l.171-195); Stories 13.11 (l.1969), 13.12 (l.1986)
- [Source: prds/prd-project-rescom-2026-08-08/prd.md] Refund Hold glossary l.195, FR-31 l.535, FR-77 l.609-625 + Owner amendment l.627, FR-78 l.629-644, UJ-6 l.153-155; addendum §12 l.374-375
- [Source: architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md] AD-24 l.207-210, AD-25 lock order l.226, AD-26 l.282-308, idempotency table l.346; solution-design.md PayOS flows l.295-362
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-15.md] l.66, 100, 125-130; implementation-readiness-report-2026-10-15.md l.78, 111, 159, 167
- [Source: _bmad-output/implementation-artifacts/13-6-live-payos-probe-in-production.md] l.52, 141-145; `13-9-amount-mismatch-resolution.md` (AC 5, Dev Notes)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] l.236 (dispute reversal policy), l.430-454 (redemption refunds), l.463

### Owner decisions (confirmed by Owner Quan 2026-10-16)

1. D1 confirmed: 15 s look-back before the credit journal for spends (no sequence column now).
2. D6 confirmed: mailbox is emailed on submit and on withdrawal.
3. Account number: store the full `counterAccountNumber` as payOS reports it (snapshot onto `TopUpRefundRequest` unmasked). Only the Admin sees it in full (13.12 B2 drawer with copy button, UX-DR-P12). User DTOs, Outbox payloads, logs, and the mailbox email carry last 4 only (FR-77 unchanged). The 13.6 "(last 4)" wording refers to the redacted fixtures, not the stored value.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
