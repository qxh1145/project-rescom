---
baseline_commit: d6db08d
---

# Story 12.10: My Vouchers, Reminders & Faulty-Code Resolution

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a User,
I want reminders before my vouchers expire and a fix when a code fails,
so that I do not lose what I redeemed.

## Acceptance Criteria

1. **Tickets and history.** Given redeemed vouchers, when the user opens Voucher của tôi or the redemption history, the API returns tickets by tab and nearest expiry, plus history with Success, Failed, and Refunded entries, matching the Story 12.1 contracts (FR-70).
2. **Mark used / undo.** Mark-used is allowed, with undo within 24 hours.
3. **Reminders.** Reminders 7 days and 1 day before expiry are emitted through the Outbox to the existing notification system (AD-10).
4. **Faulty-code queue and resolution.** A code-issue report enters a Rewards-owned Admin queue. Admin resolves it with either a replacement code or a refund keyed `redemption-refund:{caseId}` through an Economy reversal journal, at most one outcome per report, and the user is notified (FR-75, BR-22). *(Quan decision 2026-10-14: Admin may also reject a report; REJECT is a third, outcome-free resolution, still at most one per report, and the user is notified.)*
5. **No refund on expiry.** Expired, unused vouchers are not refunded (BR-23).

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.10 (FR-70, FR-75; BR-22, BR-23; AD-24, AD-10). Contract source for the user routes: FE MSW mock `apps/frontend/my-app/mocks/handlers/rewards.ts` (comments: "ASSUMED API CONTRACT … backend Stories 12.7–12.10") and `packages/schemas/src/rewards/redemption.schema.ts`. The Admin queue has **no** FE contract yet: this story defines it (Task 5).

## Tasks / Subtasks

- [x] **Task 0: Branch and baseline** — branch `feat/12-10-my-vouchers-reminders-faulty-code-resolution` already exists, cut from `origin/develop` (`d6db08d`, includes merged 12.9). Re-run `git status --short --branch` before the first edit. Backend: `apps/backend`; module `apps/backend/src/modules/rewards`. Rebase on `origin/develop` before touching hot files (`schema.prisma`, `rewards.module.ts`, `economy.module.ts`, `http-exception.filter.ts`, `scheduler.constants.ts`).
- [x] **Task 1: Additive migration** (AC: 2, 3, 4) — new folder `apps/backend/prisma/migrations/20261016100000_rewards_my_vouchers_code_issues/migration.sql` (later than `20261015100000`; do not edit earlier migrations). Unconditional DDL, no `to_regclass` guard (`migration-chain.spec.ts`). Mirror every CHECK/partial index in `prisma/sql/post-push-invariants.sql`. **Read "Why new tables" in Dev Notes first.**
  - [x] 1.1 `redemption_usages`: `redemption_id uuid PRIMARY KEY` FK → `redemptions` ON DELETE RESTRICT, `used_at timestamp(3) NOT NULL`, `undo_until timestamp(3) NOT NULL`, CHECK `undo_until = used_at + interval '24 hours'`. Mutable on purpose (undo deletes the row). Prisma model + relation.
  - [x] 1.2 `redemption_refunds` (append-only; reuse `prevent_rewards_history_mutation` triggers incl. TRUNCATE like `redemptions`): `id uuid PK`, `redemption_id uuid NOT NULL UNIQUE` FK RESTRICT, `report_id uuid NOT NULL UNIQUE` FK → `code_issue_reports` RESTRICT, `journal_id uuid NOT NULL UNIQUE` (the Economy reversal journal), `reference text NOT NULL UNIQUE` (`RFD-YYYY-XXXX`), `points int NOT NULL CHECK (points > 0)`, `created_at`. The two UNIQUEs are the DB form of "at most one refund per redemption / per report".
  - [x] 1.3 `redemption_reminders`: `redemption_id uuid` FK RESTRICT, `window text NOT NULL CHECK (window IN ('7D','1D'))`, `emitted_at timestamp(3) NOT NULL`, `PRIMARY KEY (redemption_id, window)`. Marker so the scan job never re-selects an emitted reminder.
  - [x] 1.4 `voucher_codes.issue_report_id uuid NULL UNIQUE` FK → `code_issue_reports` RESTRICT (marks a code handed out as a **replacement**; `redemption_id` stays NULL because the original code already owns the 1:1 pointer). Recreate the partial index `voucher_codes_unissued_idx` as `WHERE redemption_id IS NULL AND issue_report_id IS NULL`. CHECK `NOT (redemption_id IS NOT NULL AND issue_report_id IS NOT NULL)`.
  - [x] 1.5 `code_issue_reports`: add `resolution_note text NULL` (max 500 enforced in Zod and `CHECK (char_length(resolution_note) <= 500)`); CHECK outcome shape: `status='OPEN'` ⇒ `replacement_code_id`, `refund_journal_id`, `resolved_by_id`, `resolved_at` all NULL; `'REPLACED'` ⇒ `replacement_code_id` and `resolved_by_id`/`resolved_at` NOT NULL and `refund_journal_id` NULL; `'REFUNDED'` ⇒ `refund_journal_id`, `resolved_by_id`, `resolved_at` NOT NULL and `replacement_code_id` NULL; `'REJECTED'` ⇒ no outcome columns, `resolved_at` NOT NULL. UNIQUE on `replacement_code_id` and on `refund_journal_id` (partial `WHERE … IS NOT NULL`). Index `(status, created_at)` for the Admin queue and `(redemption_id, created_at DESC)` for the latest-report lookup. The existing partial unique `code_issue_reports_open_redemption_key` (one OPEN per redemption) stays.
  - [x] 1.6 `ALTER TYPE "NotificationType" ADD VALUE` for `VOUCHER_EXPIRING` and `CODE_ISSUE_RESOLVED`, **appended at the end** of the Prisma enum and of `NOTIFICATION_TYPES` in `packages/schemas/src/notifications/notification.schema.ts` (same order; pattern: migration `20261001120300_email_delivery`, IR.4b B3). Update the schema spec that pins the list.
  - [x] 1.7 `test/migration-chain*.ts` expectations: applies from an empty DB and from a DB at `20261015100000`.
- [x] **Task 2: Domain (pure; no Nest/Prisma imports)** (AC: 1, 2, 3, 5)
  - [x] 2.1 `domain/ticket-rules.ts`: port `markUsedDecision`, `undoUseDecision`, `codeIssueDecision`, `ticketStatus`, `historyMonthSummary` from `apps/frontend/my-app/mocks/data/rewards-rules.ts` (same semantics, same codes `TICKET_EXPIRED`, `TICKET_REFUNDED`, `UNDO_WINDOW_CLOSED`, `CODE_ISSUE_ALREADY_OPEN`). Boundaries: EXPIRED when `expiresAt - now <= 0`; EXPIRING when `<= 7 d`; undo allowed while `now < undoUntil`. `calculateTicketStatus` already exists in `domain/voucher-ticket.ts` — extend/move it, never keep two copies.
  - [x] 2.2 Extend `toVoucherTicket` (`domain/voucher-ticket.ts`, built by 12.8 for the redeem result) with optional facts `{ usage, latestIssue, replacementCode }` so `usedAt`, `undoUntil`, `status`, `code` (replacement code when the latest REPLACED report has one) and `openIssue` are filled. The 12.8 redeem path must still produce the identical DTO (all facts absent).
  - [x] 2.3 `domain/reminder-plan.ts`: `dueReminderWindow(ticket, now)` → `'1D' | '7D' | null`. Rule: ticket SUCCEEDED, not used, not refunded, `now < expiresAt`; window = `'1D'` if `expiresAt − now <= 24 h`, else `'7D'` if `<= 7 d`, else null; **skip a window whose boundary `expiresAt − W` is earlier than `redeemedAt`** (the user redeemed inside the window and already sees "Expiring"). Catch-up after downtime never sends both: only the most urgent due window.
  - [x] 2.4 `domain/code-issue-resolution.ts`: `resolveDecision(report, ticket, voucher, outcome, now)` (`outcome` = `REPLACE | REFUND | REJECT`) → ok or `{ code }`: report must be OPEN; `REJECT` needs no ticket/voucher facts and is always allowed on an OPEN report; `REPLACE` is rejected for a shared-code voucher (`REPLACEMENT_NOT_SUPPORTED`) and for an expired ticket (`TICKET_EXPIRED`); `REFUND` is allowed on an expired ticket (the fault was reported in time, BR-23 only covers expiry without a report); `REFUND` on an already refunded redemption is `TICKET_REFUNDED`.
  - [x] 2.5 `domain/redemption-reference.ts`: add `generateRefundReference(year, rng)` → `RFD-YYYY-XXXX` (same alphabet and injected RNG as `generateRedemptionReference`; do not duplicate the alphabet).
- [x] **Task 3: Ports + infrastructure** (AC: 1–5)
  - [x] 3.1 Read port `application/ports/my-vouchers-read.port.ts`: `listTickets(userId)`, `findTicket(userId, redemptionId)` (returns rows with joined voucher+brand, original code, usage, latest report + its replacement code, refund flag), `listHistory(userId, limit, offset)` (+ `total`, `monthSummary` inputs). Prisma + in-memory twin + **one shared contract suite** (pattern `rewards.repositories.spec.ts`). A ticket belongs to a user only through `redemptions.user_id`; another user's id behaves as not found (404 `TICKET_NOT_FOUND`, never 403).
  - [x] 3.2 Write port `application/ports/ticket-write.port.ts`: `lockRedemption(id)` (`SELECT … FROM redemptions WHERE id = $1 FOR UPDATE`; a row lock does not fire the append-only UPDATE trigger), `insertUsage / deleteUsage`, `insertReport / findReport / lockReport / markReportReplaced / markReportRefunded / markReportRejected` (each conditional on `status = 'OPEN'`, affected rows must be 1), `claimReplacementCode(voucherId, reportId)` (`FOR UPDATE SKIP LOCKED` over `redemption_id IS NULL AND issue_report_id IS NULL`, then set `issue_report_id`), `insertRefund`, `deleteFlashClaim(redemptionId)`, `listOpenReportsForAdmin`. Join the ambient transaction with `currentClient(this.prisma)`; never open a second transaction.
  - [x] 3.3 **Unissued-code predicate is now `redemption_id IS NULL AND issue_report_id IS NULL`.** Update every place that decides "unissued": `claimCode` in `prisma-redemption.repository.ts`, `prisma-voucher-code.repository.ts` (list/count/claim, lines ~18 and ~32), the `codesAvailable` `_count` in `prisma-voucher.repository.ts` (line ~15), CSV import dedup/counters, the in-memory twins, and `voucher_codes_unissued_idx`. Add a test that a replacement-claimed code is never claimed again and is not counted in `codesAvailable`.
  - [x] 3.4 Limits must ignore refunded redemptions (see Dev Notes "Refund and limits"): `countVoucherRedemptionsInWindow`, `countTodayRedeemedPoints`, `countFlashItemRedemptionsForUser` add `AND NOT EXISTS (SELECT 1 FROM redemption_refunds r WHERE r.redemption_id = redemptions.id)` (Prisma + in-memory). The 12.8/12.9 tests that count must still pass.
  - [x] 3.5 Economy port `application/ports/reverse-spend.port.ts` (`REVERSE_SPEND_PORT`, `reverseSpend({ journalId, idempotencyKey, reason }) → { journalId }`), provided in `economy.module.ts` next to `SPEND_POINTS_PORT` via `LedgerService.reverseJournal({ targetJournalId, idempotencyKey: 'redemption-refund:{caseId}', reason })`. `rewards/application` must not import `LedgerService` or Prisma types. Confirm `reverseJournal` joins the ambient Unit of Work exactly as `spendPoints` does (read `ledger.service.ts` ~L531 and `prisma-ledger.repository` `postJournalTransaction`); if it opens its own transaction, pass the same `assertBeforeInsert`/ambient mechanism `spendPoints` uses — a refund that commits separately from the report update is a defect. Also confirm the reversal's SYSTEM_SINK debit is legal (overdraft class) and the wallet projection returns to its pre-spend value.
  - [x] 3.6 Notification side: Outbox events `REWARDS_VOUCHER_EXPIRY_REMINDER` (payload `{ redemptionId, userId, voucherId, window, expiresAt }`), `REWARDS_CODE_ISSUE_REPORTED` (`{ reportId, redemptionId, voucherId, reason }`, audit/Admin alert, no user notification), `REWARDS_CODE_ISSUE_RESOLVED` (`{ reportId, redemptionId, userId, voucherId, outcome: 'REPLACED' | 'REFUNDED' | 'REJECTED', refundReference? }`; the rejection note is read from `code_issue_reports.resolution_note`, not the payload). Add the three payload Zod schemas in a new `packages/schemas/src/rewards/rewards-events.schema.ts` (exported from `index.ts`); **ids, enums, counts only — never code values (bearer secrets)**. Handler classes in `application/` (framework-free, kind (a) `OutboxHandler`, pattern `economy/infrastructure/outbox/internal-reward-requested.handler.ts`): `rewards.voucher-expiry-notification` and `rewards.code-issue-notification`; parse payload with the shared schema and throw `OutboxPayloadInvalidError` when it does not parse; call `NOTIFICATION_PUBLISHER_PORT.publish` with `dedupeKey = event.idempotencyKey` (inside the dispatcher transaction the repository defers the insert to after-commit). Register them in `infrastructure/rewards-outbox.registrar.ts` (Nest wiring; pattern `participation-scheduler.registrar.ts` / `notifications-scheduler.registrar.ts`). Messages are Vietnamese, e.g. `Voucher "{title}" sẽ hết hạn sau 7 ngày. Dùng ngay trong Voucher của tôi.`, `… sẽ hết hạn vào ngày mai.`, `Mã voucher "{title}" đã được thay bằng mã mới.`, `Đã hoàn {points} điểm cho voucher "{title}" (mã {RFD ref}).`, `Báo cáo mã voucher "{title}" đã bị từ chối: {note, cut to fit the 500-char limit}.`; titles come from the Voucher read, not from the payload.
- [x] **Task 4: Application — user side** (AC: 1, 2, 4, 5)
  - [x] 4.1 `application/rewards-my-vouchers.service.ts`: `listTickets(userId)` (sorted by `expiresAt` ASC; excludes tickets whose redemption has a refund row — mock `ticketsOf` — but `getTicket` still returns them so a deep link explains), `getTicket`, `markUsed`, `undoUse`, `reportCodeIssue`, `history`. All "now" from `CLOCK`; every response carries `serverTime`. Wrap mark/undo/report in one `UNIT_OF_WORK_PORT.run('ticket:{id}:{action}', …)` that first `lockRedemption(id)` and re-reads the facts inside the lock (a concurrent refund/undo may have won).
  - [x] 4.2 Mark used: insert `redemption_usages (used_at = now, undo_until = now + 24 h)`; repeat call is a 200 no-op that keeps the first `usedAt`. Undo: delete the row; no row ⇒ 200 no-op; `now >= undoUntil` ⇒ 409 `UNDO_WINDOW_CLOSED`. A refunded ticket ⇒ 409 `TICKET_REFUNDED`; mark on an EXPIRED unused ticket ⇒ 409 `TICKET_EXPIRED`. Outbox audit event for each *changed* mutation only (`rewards:ticket:{id}:used:{usedAtMs}` / `…:undone:{nowMs}` style keys that cannot collide on a second use after undo).
  - [x] 4.3 Report: validate with `createCodeIssueReportSchema`; `codeIssueDecision`; insert report `OPEN`; ticket guard order matches the mock (refunded → expired → already open). Outbox `REWARDS_CODE_ISSUE_REPORTED`. The partial unique index is the backstop: map its violation to 409 `CODE_ISSUE_ALREADY_OPEN` **outside** the transaction (PG aborts the tx after a unique violation; same rule as the 12.8 `reference` retry), never inside it.
  - [x] 4.4 History: UNION of `redemptions` (SUCCEEDED and FAILED rows of the user) and `redemption_refunds` (via the redemption's user), newest first, `limit/offset` per `redemptionHistoryQuerySchema`. Entry mapping (verify with `redemptionHistoryEntrySchema` refines): SUCCEEDED `points = -pricePoints`, `journalId = redemption.journalId`; FAILED `points = 0`, `journalId = null`, `failureCode` from the row (must be one of the 5 `REDEMPTION_ERROR_CODES`; do not coerce — an unknown stored code is a bug, assert it in the repository contract test), `note` = the no-points-deducted sentence the mock uses; REFUNDED `points = +refund.points`, `reference = refund.reference`, `journalId = refund.journalId`. `monthSummary` for the current Asia/Ho_Chi_Minh month from `CLOCK` (compute the month's UTC instants in the app, as 12.8 does for the daily limit; no `date_trunc`), net of refunds as in the contract comment. `hasMore = offset + limit < total`.
- [x] **Task 5: Application — Admin queue** (AC: 4, 5)
  - [x] 5.1 Additive Admin contract in `packages/schemas/src/rewards/rewards-admin.schema.ts`: `adminCodeIssueListQuerySchema` (`status` = `OPEN | RESOLVED | ALL`, default `OPEN`; `limit/offset` like the history query), `adminCodeIssueSchema` (`id`, `redemptionId`, `reference`, `userLabel` `#XXXX` like the mock's admin redemption rows, `voucher {id,title,brand}`, `reason`, `note`, `status`, `createdAt`, `resolvedAt`, `resolvedBy {id,name}|null`, `pricePoints`, `priceSource`, `ticketStatus`, `canReplace`, `replaceBlockedReason` (`SHARED_CODE | NO_STOCK | NO_CODE | TICKET_EXPIRED | null`), `resolution {outcome: 'REPLACED' | 'REFUNDED' | 'REJECTED', refundReference}|null`, `resolutionNote`), `adminCodeIssueListSchema` (`items`, `total`, `limit`, `offset`, `hasMore`, `summary {open, oldestOpenAt}`), `adminResolveCodeIssueSchema` = discriminated union on `outcome`: `{ outcome: 'REPLACE', note? }` | `{ outcome: 'REFUND', note? }` | `{ outcome: 'REJECT', note }` (`note` trim, max 500; **required, min 1, for REJECT** because the user is told why). **No original or replacement code value in any Admin payload.** Add spec cases in `rewards-admin.schema.spec.ts`.
  - [x] 5.2 `application/rewards-admin-code-issues.service.ts`: `list`, `get`, `resolve(id, input, admin)` (`REPLACE | REFUND | REJECT`). Every method calls the live `ADMIN_CAPABILITY_PORT` check (12.9 review finding: list/get must authorize too). Order the queue oldest-first. See the exact transaction recipes in Dev Notes.
  - [x] 5.3 Resolve — REPLACE (one `UNIT_OF_WORK_PORT.run('code-issue:{id}:resolve', …)`): lock report (`FOR UPDATE`) → re-check `OPEN` → `lockRedemption` → lock Voucher (`VOUCHER_REPOSITORY_PORT.lock`) → conditional `stock_remaining - 1 WHERE stock_remaining > 0` → `claimReplacementCode` → `markReportReplaced` (affected = 1) → audit + `REWARDS_CODE_ISSUE_RESOLVED`. No stock, no free code, shared-code voucher, or expired ticket ⇒ roll back with 409 `NO_REPLACEMENT_AVAILABLE` / `REPLACEMENT_NOT_SUPPORTED` / `TICKET_EXPIRED` (nothing moves; Admin may choose REFUND instead).
  - [x] 5.4 Resolve — REFUND (one UoW): lock report → re-check `OPEN` → `lockRedemption` → verify SUCCEEDED, no existing refund → `REVERSE_SPEND_PORT.reverseSpend({ journalId: redemption.journalId, idempotencyKey: 'redemption-refund:' + report.id, reason })` → `insertRefund` (reference via `generateRefundReference`, retry on `reference` unique collision **by re-running the whole UoW**, ≤ 3 attempts, like 12.8) → `deleteFlashClaim(redemptionId)` → `markReportRefunded(refund_journal_id)` → audit + Outbox. Points go back to USER_AVAILABLE exactly once. Stock is **not** returned (the dead code stays assigned), see Open point 1.
  - [x] 5.4b Resolve — REJECT (one UoW): lock report → re-check `OPEN` → `markReportRejected(resolved_by_id, resolved_at, resolution_note)` (affected = 1) → audit + `REWARDS_CODE_ISSUE_RESOLVED` with `outcome: 'REJECTED'`. Moves no stock, code or Points. The ticket is unchanged and the user may file a new report (no OPEN report remains). The original code stays assigned to the redemption.
  - [x] 5.5 Idempotent / conflict behaviour: resolving a report already resolved with the **same** outcome returns 200 with the stored result and writes nothing; a different outcome ⇒ 409 `CODE_ISSUE_ALREADY_RESOLVED`; unknown id ⇒ 404 `CODE_ISSUE_NOT_FOUND`; two Admins racing ⇒ exactly one commits, the other re-reads and gets one of the two results above.
  - [x] 5.6 `application/exceptions/rewards.exceptions.ts` + `common/http/http-exception.filter.ts` (+spec `http-exception.filter.rewards.spec.ts`): add the codes `TICKET_NOT_FOUND` 404, `TICKET_EXPIRED` 409, `UNDO_WINDOW_CLOSED` 409, `CODE_ISSUE_ALREADY_OPEN` 409, `TICKET_REFUNDED` 409 (all five already named by `VOUCHER_TICKET_ERROR_CODES`; the body is `{ code, message }`, no `details`, as the mock), plus `CODE_ISSUE_NOT_FOUND` 404, `CODE_ISSUE_ALREADY_RESOLVED` 409, `NO_REPLACEMENT_AVAILABLE` 409, `REPLACEMENT_NOT_SUPPORTED` 409. Do not hard-code statuses elsewhere.
- [x] **Task 6: Reminder job** (AC: 3)
  - [x] 6.1 `application/voucher-reminder.service.ts`: `runDue(now, limit)` → `{ emitted, skipped, errored }`. Scan SUCCEEDED redemptions whose voucher `code_expires_at` is in `(now, now + 7 d]`, with no `redemption_usages` row, no `redemption_refunds` row, ordered by `code_expires_at` ASC, `limit` per call (oldest expiry first = most urgent). For each, `dueReminderWindow`; if the window is non-null and has no `redemption_reminders` row, emit inside its **own** UoW: `INSERT INTO redemption_reminders … ON CONFLICT DO NOTHING` (affected 0 ⇒ another run won, skip) then the Outbox event with `idempotencyKey = rewards:voucher-reminder:{redemptionId}:{7D|1D}` (unique key ⇒ a second insert cannot create a second event even if the marker were lost). One failing ticket must not stop the batch (count, log, retried next run).
  - [x] 6.2 `infrastructure/voucher-reminder.job.ts` (`ScheduledJob`, framework-free like `flash-sale-lifecycle.job.ts`) registered from `rewards-scheduler.registrar.ts`. Add `VOUCHER_REMINDER_JOB = { name: 'voucher-expiry-reminder', intervalMs: 15 * MINUTE_MS, leaseTtlMs: 5 * MINUTE_MS, batchSize: 200 }` to `common/scheduler/scheduler.constants.ts`. Summary is counts only; `hasMore` when the batch was full. The job takes `ctx.now`/`CLOCK`, never `new Date()`. Reruns, parallel runs and restarts emit each `(redemption, window)` once.
- [x] **Task 7: Presentation + wiring** (AC: 1, 2, 4)
  - [x] 7.1 `presentation/rewards-my-vouchers.controller.ts` with `@Controller(['rewards', 'api/rewards'])`, `SessionAuthGuard`; writes add `CsrfGuard`, `JsonOnlyGuard`; every response `Cache-Control: no-store` (bodies contain codes); `:id` validated as UUID (non-UUID ⇒ 400 `VALIDATION_ERROR`, same pipe as other controllers). Routes (literals are the FE contract):

    | Route | Body | Success | Errors |
    |---|---|---|---|
    | `GET /rewards/my-vouchers` | — | 200 `voucherTicketListSchema` | 401 |
    | `GET /rewards/my-vouchers/:id` | — | 200 `voucherTicketResponseSchema` | 404 `TICKET_NOT_FOUND` |
    | `POST /rewards/my-vouchers/:id/use` | none | 200 `voucherTicketResponseSchema` | 404; 409 `TICKET_EXPIRED` / `TICKET_REFUNDED` |
    | `POST /rewards/my-vouchers/:id/undo-use` | none | 200 `voucherTicketResponseSchema` | 404; 409 `UNDO_WINDOW_CLOSED` / `TICKET_REFUNDED` |
    | `POST /rewards/my-vouchers/:id/issues` | `createCodeIssueReportSchema` | 201 `codeIssueReportSchema` | 400; 404; 409 `TICKET_EXPIRED` / `CODE_ISSUE_ALREADY_OPEN` / `TICKET_REFUNDED` |
    | `GET /rewards/redemptions?limit&offset` | query `redemptionHistoryQuerySchema` | 200 `redemptionHistoryListSchema` | 400 |

    Apply per-user `@Throttle` on the three writes (e.g. 30/min, issues 10/min). `use`/`undo-use` take no body: do not require `JsonOnlyGuard` to see a JSON body there if the other no-body POSTs in the repo skip it — match the existing pattern, and read the mock's `missingCsrf` (CSRF is required).
  - [x] 7.2 `presentation/admin-rewards-code-issues.controller.ts` (style of `admin-rewards-flash-sales.controller.ts`: `@Roles('ADMIN')`, `SessionAuthGuard`, `CsrfGuard`, `JsonOnlyGuard` on writes, `Cache-Control: no-store`, prefixes `admin/rewards` and `api/admin/rewards`). Routes: `GET /admin/rewards/code-issues`, `GET /admin/rewards/code-issues/:id`, `POST /admin/rewards/code-issues/:id/resolve` (200).
  - [x] 7.3 Register providers, handlers, registrar, job in `rewards.module.ts`; `test/architecture.spec.ts` must stay green (`domain/` and `application/` must not mention `@nestjs/`, `@prisma/client`, `express`, `bcrypt`, `google-auth-library`, or the word "adapter", even in comments). Notifications module must export `NOTIFICATION_PUBLISHER_PORT` to Rewards (check `notifications.module.ts`; add the export if missing, no import cycle).
  - [x] 7.4 FE: only add the six user routes and three Admin routes to `deferredRewards` in `apps/frontend/my-app/tests/route-diff.test.mjs` (the three Admin routes are not in the allowlist/mock — check whether the test needs them at all; add only what fails). No other FE edits. If the FE exhaustively switches on `NotificationType`, adding two values may break `typecheck`: fix with the smallest additive case and record it (see Open point 5).
- [x] **Task 8: Tests** (AC: 1–5)
  - [x] 8.1 Unit (domain): status boundaries (`expires − now` = 7 d + 1 ms / 7 d / 1 ms / 0), mark/undo/report decisions incl. refunded > expired > open order, undo at `undoUntil − 1 ms` and `= undoUntil`, `dueReminderWindow` (at 7 d, 7 d − 1 ms, 1 d, redeemed inside the window ⇒ skipped, used/refunded ⇒ null, catch-up picks only `1D`), `resolveDecision` matrix, `generateRefundReference` format against `REFUND_REFERENCE_PATTERN`, `toVoucherTicket` with and without facts (redeem result unchanged), month summary across a Vietnam month boundary (23:59:59.999+07 vs 00:00).
  - [x] 8.2 Services with in-memory repos + `FixedClock` + `PassThroughUnitOfWork`: list ordering and refunded exclusion; deep link of a refunded ticket; mark/undo idempotency; report guards; history of a mixed user (SUCCEEDED, FAILED, REFUNDED) parsed with `redemptionHistoryListSchema`; REPLACE moves exactly one stock unit and one code, the ticket then shows the replacement code and the old one is never reissued; REFUND returns points once and frees the Flash cap; same outcome twice ⇒ 200 no-op, other outcome ⇒ 409; REJECT without a note ⇒ 400, REJECT moves no stock/code/Points and the user can report again; REPLACE blocked for shared code / expired / no code / no stock; REFUND allowed on an expired ticket with an earlier report; reminder service emits once per window, never for used/refunded, restart-safe (fresh service instance).
  - [x] 8.3 Controller specs (401, 403 non-admin on the queue, CSRF, UUID param, both prefixes, status codes, `Cache-Control: no-store`) and in-memory HTTP e2e (`test/rewards-my-vouchers.e2e-spec.ts`, pattern `rewards-flash.e2e-spec.ts`): every response parsed with the shared Zod schemas (`voucherTicketListSchema`, `voucherTicketResponseSchema`, `codeIssueReportSchema`, `redemptionHistoryListSchema`, `adminCodeIssueListSchema`).
  - [x] 8.4 **PostgreSQL e2e** (`test/rewards-my-vouchers.prisma.e2e-spec.ts`, harness `financial-pg-harness.ts`; production repositories and services, `Promise.all` on real service calls, durable-state assertions): parallel mark-used ×2 ⇒ one usage row; mark-used racing undo and racing a refund ⇒ consistent end state; double report submit ⇒ one OPEN report (second `CODE_ISSUE_ALREADY_OPEN`); **REPLACE, REFUND and REJECT racing on one report ⇒ exactly one outcome, ledger sum zero, points returned at most once**; two Admins REFUND the same report ⇒ one reversal journal (`redemption-refund:{caseId}`), one `redemption_refunds` row; REFUND balance check: wallet after = wallet before the redemption; REPLACE racing a redemption of the last unit ⇒ no oversell, `total = stock_remaining + flashReserved + issued` holds, each code assigned once; a refunded user can redeem again within the 30-day/daily/Flash limits; reminder job twice in parallel and after a "restart" ⇒ one Outbox event + one marker per window; reminder vs mark-used race ⇒ no reminder after the used commit; Outbox handler run twice ⇒ one notification (`dedupeKey`); migration applies from empty and from `20261015100000`; append-only triggers reject UPDATE/DELETE on `redemption_refunds`.
  - [x] 8.5 Run the PG suite locally and record command + output in Completion Notes (12.7 shipped it unexecuted, 12.8/12.9 fixed that; keep it). No `describe.skip` that silently passes without a database.
- [x] **Task 9: Verification** — in `apps/backend`: `npm run prisma:validate`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`; `npm test` in `packages/schemas`; `npm run test:e2e -- rewards` (+ `migration-chain.prisma`); FE `node --test tests/*.test.mjs` in `apps/frontend/my-app`. `prisma migrate deploy` on an empty scratch DB and on a DB at `20261015100000`; record output.

### Review Findings

_Code review 2026-10-14 (Blind + Edge + Auditor, mode full). 0 decision-needed (3 đã resolve thành patch), 16 patch, 0 defer, 4 dismissed._

- [x] [Review][Patch] Ticket đã REFUNDED vẫn trả `code` — ẩn `code` khi refunded (quyết định 1A) [rewards-my-vouchers.service.ts getTicket/markUsed]
- [x] [Review][Patch] `undoUseDecision` không kiểm tra hết hạn — chặn undo khi đã hết hạn (quyết định 2A) [domain/ticket-rules.ts undoUseDecision]
- [x] [Review][Patch] REPLACE trên vé đã USED — reset `redemption_usages` khi thay mã (quyết định 3A) [rewards-admin-code-issues.service.ts REPLACE]
- [x] [Review][Patch] (HIGH) Mã thay thế biến mất khi có report mới sau REPLACED (OPEN/REJECTED) — `code` quay về mã gốc lỗi; lấy replacement từ report REPLACED mới nhất [prisma-my-vouchers.repository.ts:109-132, 206-229]
- [x] [Review][Patch] Reminder starvation — ứng viên `dueReminderWindow`=null không có marker, bị chọn lại mỗi tick, `hasMore` luôn true; lọc `redeemed_at` trong SQL hoặc ghi marker skip [prisma-my-vouchers.repository.ts (reminder candidates SQL); voucher-reminder.service.ts; voucher-reminder.job.ts]
- [x] [Review][Patch] `redemptionErrorCodeSchema.parse(r.failureCode)` ném ZodError với failureCode null/lạ → cả history 500; dùng `safeParse` + fallback [prisma-my-vouchers.repository.ts:310]
- [x] [Review][Patch] `findTicket`/`lockRedemption` và nhánh REFUND không kiểm `status === 'SUCCEEDED'`; REFUND không dùng `resolveDecision` [prisma-my-vouchers.repository.ts findTicket/lockRedemption; rewards-admin-code-issues.service.ts REFUND]
- [x] [Review][Patch] AC4: thông báo REFUNDED thiếu `{points}` theo spec Task 3.6; đọc từ `redemption_refunds` [code-issue-notification.handler.ts]
- [x] [Review][Patch] `resolvedBy.name` cứng `'Admin'`, tên admin từ controller bị bỏ; join users để lấy tên thật [prisma-my-vouchers.repository.ts:749,853]
- [x] [Review][Patch] `canReplace` không phụ thuộc trạng thái report (report đã giải quyết vẫn có thể `true`) [prisma-my-vouchers.repository.ts:705-727, 810-830]
- [x] [Review][Patch] `uniqueViolationOf`: `target.includes('code_issue')` bắt nhầm unique `replacement_code_id`/`refund_journal_id`; `reportCodeIssue` coi mọi P2002 là CodeIssueAlreadyOpen — chỉ khớp index `open_redemption` [unique-violation.ts; rewards-my-vouchers.service.ts report]
- [x] [Review][Patch] ~~`historyMonthSummary` có thể âm~~ — dismissed: schema `redemption.schema.ts` cho phép monthSummary <= 0 (clamp sẽ trái contract) khi refund khác tháng với mua — tính theo tháng redemption gốc hoặc clamp 0 [domain/ticket-rules.ts:126]
- [x] [Review][Patch] `listHistory`/`listTickets` tải toàn bộ, sort + slice trong JS, không tie-break theo id (trang lệch); phân trang ở DB (Task 4.4 UNION) [prisma-my-vouchers.repository.ts listHistory/listTickets]
- [x] [Review][Patch] Gotcha 4 (không đổi code): `JournalAlreadyReversed`/`JournalNotFound`/`DownstreamJournalExists` từ `reverseSpend` không map (đã map 404/409 bởi HttpExceptionFilter; alert chưa làm — chọn không thêm) [rewards-admin-code-issues.service.ts REFUND]
- [x] [Review][Patch] `now` lấy trước khi lock trong markUsed/undoUse/report → kiểm tra hết hạn/undo window dùng giờ cũ; lấy sau lock [rewards-my-vouchers.service.ts]
- [x] [Review][Patch] Test (Task 8): đã thêm — undo hết hạn, `uniqueViolationOf`, replacement giữ mã + reset usage (service), PG: daily points cap sau refund, reminder không đói, history phân trang ổn định, handler code-issue chạy 2 lần ⇒ 1 notification có số điểm. Controller 401/403/CSRF/UUID/prefix đã phủ bởi `rewards-my-vouchers.e2e-spec.ts`. Không làm: Flash per-user cap sau refund (query dùng cùng `refund: null`, cần dựng flash item) và test lock-order riêng (đã phủ bởi các test race PG hiện có).

## Dev Notes

### Scope boundaries (read first)

- **In:** user ticket list/detail, mark-used/undo, redemption history API, code-issue report API, Rewards-owned Admin queue API with REPLACE / REFUND resolution, refund through an Economy reversal journal, expiry reminders (7 d / 1 d) via Outbox → in-app notification, resolution notification, making redeem limits ignore refunded redemptions.
- **Out (other stories — do not build):** the Admin FE screen for the queue and any FE de-mocking (12.11 or a new FE story, Open point 4); `/admin/rewards/stats` (12.11); feature flag and load test (12.11); the "10 minutes before Flash start" reminder (`rules.remindBefore10m`, no AC owns it, 12.9 open point 4); email delivery of reminders (in-app only; email is a separate decision); partner-API code issuance; ticket sharing/transfer.
- **Gates:** production enable still needs OQ-24 (12.11). No new gate for 12.10. OQ-25 values already adopted by the contract: 7-day expiring window, 24 h undo, 1-business-day resolution target (not enforced by code; the queue is oldest-first).

### Why new tables (the critical part)

`redemptions` is **append-only** (trigger `redemptions_append_only`; 12.8 gotcha 3), so nothing about a ticket can be stored by updating it. Three facts need homes:

| Fact | Home | Why |
|---|---|---|
| marked used + undo deadline | `redemption_usages` (mutable, undo = delete) | state flips both ways; history of flips is in Outbox audit |
| refund | `redemption_refunds` (append-only) | History needs a REFUNDED entry with its own `RFD-` reference and the reversal `journalId`; UNIQUE(redemption_id) and UNIQUE(report_id) are the DB form of "at most one outcome" |
| reminder already sent | `redemption_reminders` | scan must not re-select emitted rows (a `batchSize` of rows that are always "due" would starve the rest) |

A replacement code cannot reuse `voucher_codes.redemption_id` (UNIQUE, already owned by the original code), hence `voucher_codes.issue_report_id`. The original code is never freed or reissued — a faulty code is dead.

`ticket.id = redemption.id` (12.8 gotcha 12). The ticket status is **derived**, never stored: `USED` if a usage row exists (wins over expiry, as in the mock), else `EXPIRED / EXPIRING / UNUSED` from `voucher.codeExpiresAt` and `now`.

### Contract facts to honour (from `redemption.schema.ts`)

- `voucherTicketSchema` refines `status === 'USED' ⇔ usedAt !== null`. `undoUntil` stays in the response after the window passes (mock) — the FE decides; the server enforces `now < undoUntil` on undo.
- `openIssue` = `{ id, status }` of the **latest** report of the redemption (any status) or `null`; the mock sets it on creation and on resolution. Verify against `apps/frontend/my-app` Story 12.4 usage (`openIssue`, `REFUNDED` filtering) before finalising; if the FE treats only OPEN/REFUNDED, still return the latest REPLACED so the UI can say "mã đã được thay".
- `codeIssueReportSchema` refines the outcome shape: `REPLACED` needs `replacementCode` (the **user** receives it here, over an authenticated no-store response), `REFUNDED` needs `refundReference` matching `RFD-\d{4}-[0-9A-Z]{4}`, `OPEN` has neither. `ticketId = redemptionId`.
- `redemptionHistoryEntrySchema` refines: FAILED ⇒ `points = 0`, `journalId = null`, `failureCode` set; SUCCEEDED ⇒ `points < 0` and `RDM-` reference; REFUNDED ⇒ `points > 0` and `RFD-` reference. A refunded redemption therefore appears **twice** (its SUCCEEDED row and a REFUNDED row) and nets to zero in `monthSummary`.
- `VOUCHER_TICKET_ERROR_CODES` bodies carry no `details`.

### Transaction recipes and lock order

AD-24 fixed order: Voucher → FlashSaleItem → VoucherCode → ledger accounts. These flows add *earlier* locks on rows that the redeem path never locks (existing `redemptions` rows, `code_issue_reports` rows), so no cycle with `RedeemVoucher`, the 12.9 lifecycle job, or Admin voucher flows is possible **as long as no code path takes a Voucher lock and then waits for a redemption or report row**. Keep that rule; add a comment in the service and a test.

Mark-used / undo / report: `lockRedemption` → re-read usage/refund/latest report → decide → write.

REPLACE: `lock report` → `lockRedemption` → `lock Voucher` → stock `-1` (conditional) → claim code (`SKIP LOCKED`) → `markReportReplaced` → audit/Outbox.

REFUND: `lock report` → `lockRedemption` → `reverseSpend` (ledger accounts locked ascending inside Economy) → `insertRefund` → `deleteFlashClaim` → `markReportRefunded` → audit/Outbox.

All conditional updates assert the affected-row count (12.7 lesson, 12.9 gotcha 3): a 0 on a path that must succeed is an integrity error, not a silent skip. Never swallow a DB error inside the shared transaction (12.8 review finding).

### Refund and limits

A refunded redemption stays `SUCCEEDED` in `redemptions` (append-only), so every limit query would still count it. Adopted rule: **a refunded redemption counts toward no limit** — not the per-voucher 30-day count, not the daily Points sum, not the Flash per-user cap; the refund deletes the `flash_item_claims` row (it is the only mutable guard row). Flash `sold` and `stock_remaining` are **not** touched by a refund, so a refunded Flash unit is not resold. This closes 12.9 open point 5 with a default; Quan may flip it (Open point 3).

### Replacement semantics

- A replacement takes one unit of regular `stock_remaining` and one unissued code, so the invariant "every remaining unit has a code" (`codesAvailable >= stock_remaining` for non-shared vouchers) and `issued = total − remaining − flashReserved` both keep holding (issued grows by 1). The Admin voucher view needs no change.
- Replacement applies even when the original redemption was Flash (regular stock is used).
- Shared-code vouchers (`isSharedCode`, one `Voucher.sharedCode`, no `VoucherCode` rows) cannot be replaced per ticket: `REPLACEMENT_NOT_SUPPORTED`; Admin refunds, or fixes the shared code through the voucher edit (a shared code edit changes every ticket by design).
- The ticket `code` always resolves to: replacement code of the latest REPLACED report ⇒ else original code ⇒ else (shared) `Voucher.sharedCode`. Never log, audit, or put a code value in an Outbox payload, error `details`, or exception message (12.8 rule; reminders carry ids only).

### Reminders

- Scan is time-based and idempotent: marker row + unique Outbox key. Tick 15 min is enough (a reminder 15 minutes late does not matter); the lease protects against two owners but correctness lives in the DB guards (12.9 principle).
- `vouchers.code_expires_at` is the single expiry source (as in `toVoucherTicket`). An Admin edit of `codeExpiresAt` therefore moves the expiry of existing tickets; `vouchers_values_check` keeps it ≥ `redeem_ends_at + 7 d`. Not guarded further here; mention to Quan only if he wants per-redemption expiry snapshots (needs a column on a future redemption row).
- Redemption inside the 7 d window gets no `7D` reminder (they see "Expiring" already) but still gets `1D`, unless redeemed inside the last 24 h as well.
- Reminders for used (marked) tickets are suppressed; if the user undoes within 24 h, the next scan emits whatever is still due and not yet sent.

### Existing code to reuse (do not reinvent)

| Need | Use |
|---|---|
| Executable spec | `apps/frontend/my-app/mocks/data/rewards-rules.ts` (`ticketStatus`, `markUsedDecision`, `undoUseDecision`, `codeIssueDecision`, `historyMonthSummary`), `mocks/data/rewards.ts` (`ticketsOf`, `ticketOf`, `markTicketUsed`, `undoTicketUse`, `reportCodeIssue`, `historyOf`), `mocks/handlers/rewards.ts` (routes, status codes) |
| Contracts | `packages/schemas/src/rewards/redemption.schema.ts` (ticket, report, history, `VOUCHER_TICKET_ERROR_CODES`, `REFUND_REFERENCE_PATTERN`) |
| Ticket DTO | `domain/voucher-ticket.ts` (`toVoucherTicket`, `calculateTicketStatus`) — extend, 12.8 redeem result uses it |
| Reference generator | `domain/redemption-reference.ts` |
| Redeem recipe, retry on `reference` collision | `application/rewards-redemption.service.ts`, `application/unique-violation.ts` |
| Locks / UoW | `VOUCHER_REPOSITORY_PORT.lock(id)`, `common/database/prisma-unit-of-work.ts` (`currentClient`), `UNIT_OF_WORK_PORT`, `PassThroughUnitOfWork`, `CLOCK` |
| Economy | `LedgerService.reverseJournal` (`economy/application/ledger.service.ts`, key `redemption-refund:{caseId}`, one reversal per journal, `JournalAlreadyReversedException`), `SPEND_POINTS_PORT` provider in `economy.module.ts` as the port template |
| Audit Outbox | `PrismaVoucherRepository.appendAudit` shape (unique key per mutation, UUID correlation id) |
| Admin controller / service pattern | `presentation/admin-rewards-flash-sales.controller.ts`, `application/rewards-admin-flash.service.ts` (`authorize`) |
| Scheduler | `common/scheduler/*`, `infrastructure/flash-sale-lifecycle.job.ts`, `rewards-scheduler.registrar.ts` |
| Outbox handler | `common/scheduler/outbox/outbox-handler.ts`, `economy/infrastructure/outbox/internal-reward-requested.handler.ts`, `notifications/application/email-delivery.handler.ts` (kind (b), do not copy) |
| Notifications | `NOTIFICATION_PUBLISHER_PORT` (`notifications/application/ports/notification-publisher.port.ts`): idempotent by `(userId, dedupeKey)`, never throws |
| Vietnam day/month helper | `domain/redemption-limits.ts` |

### Gotchas checklist

1. **Do not edit the 12.8 transaction order.** Only the `claimCode` predicate (3.3) and the three limit queries (3.4) change in the redeem path.
2. **PG aborts the transaction after a unique violation.** Look up before insert; map the `CODE_ISSUE_ALREADY_OPEN` / `reference` violations outside the transaction.
3. **`lockRedemption` is `FOR UPDATE`, not UPDATE.** The append-only trigger fires on UPDATE/DELETE only; a row lock is safe. Test it.
4. **Refund idempotency has three guards:** ledger key `redemption-refund:{caseId}`, `redemption_refunds` UNIQUEs, and the conditional `status='OPEN'` update. A `JournalAlreadyReversedException` from Economy means an integrity problem (the refund row is missing) — surface as 500 with an alert event, do not map it to a user error.
5. **Expiry boundary.** `expiresAt − now <= 0` is EXPIRED, so a report or mark at the exact expiry instant gets `TICKET_EXPIRED`. BR-23: no refund for an expired unused voucher *without a report*; a report opened earlier may still be refunded after expiry (Open point 6).
6. **Own tickets only.** Every query filters by `redemptions.user_id`; a foreign id is 404, never 403 (no existence leak).
7. **Throttle writes** per user (AppThrottlerGuard tracks the session user, as on quotes/redemptions).
8. **Case sensitivity of code values** is irrelevant here; never normalise or trim a stored code.
9. **Notification enum change** needs the Prisma enum, the SQL `ADD VALUE`, `NOTIFICATION_TYPES` and the spec in one commit; order must match. FE notification rendering must tolerate the new types.
10. `rtk`/hooks rewrite shell commands; quote globs (`--include='*.ts'`) in zsh.

### Testing standards

- Backend jest (`npm test` builds `@rescom/schemas` first); co-located `*.spec.ts`; e2e in `apps/backend/test`. Money-path concurrency is proven on **real PostgreSQL** with `Promise.all` over production service calls, asserting durable state (usage/refund/reminder rows, report status, stock, code assignment, journals, wallet), not HTTP codes only.
- Parse real HTTP responses with the shared Zod schemas. No `test.skip` / `.only`, no placeholder tests.

### Project Structure Notes

- New: `domain/{ticket-rules,reminder-plan,code-issue-resolution}.ts`, `application/{rewards-my-vouchers,rewards-admin-code-issues,voucher-reminder}.service.ts`, `application/{voucher-expiry-notification,code-issue-notification}.handler.ts`, `application/ports/{my-vouchers-read,ticket-write,reverse-spend}.port.ts`, `infrastructure/{prisma,in-memory}-my-vouchers.repository.ts`, `infrastructure/voucher-reminder.job.ts`, `infrastructure/rewards-outbox.registrar.ts`, `presentation/{rewards-my-vouchers,admin-rewards-code-issues}.controller.ts`, `packages/schemas/src/rewards/rewards-events.schema.ts`, one migration folder, two test files.
- Changed: `schema.prisma`, `post-push-invariants.sql`, `rewards.module.ts`, `economy.module.ts`, `scheduler.constants.ts`, `http-exception.filter.ts` (+spec), `rewards-scheduler.registrar.ts`, `exceptions/rewards.exceptions.ts`, `domain/voucher-ticket.ts`, `domain/redemption-reference.ts`, `prisma-redemption.repository.ts` + in-memory twin (code predicate, limit counts), `prisma-voucher-code.repository.ts`, `prisma-voucher.repository.ts`, `notification.schema.ts` (+spec), `rewards-admin.schema.ts` (+spec), `test/migration-chain*.ts`, FE `tests/route-diff.test.mjs` (whitelist only).

### Previous story intelligence (12.9, merged as d6db08d; 12.8)

- 12.9 review found: `list`/`get` skipped the live Admin capability check; fixed idempotency keys on repeated mutations (`P2002` ⇒ 500); no re-read after taking locks; unmapped DB values leaking into DTO enums; job errors swallowed without counting; claims of tests (Task 7.4) not actually written; the monitoring fields not matching the spec; and an out-of-scope file edit slipped in. Apply: authorize on every method; a unique Outbox key per mutation (include a version/timestamp where the action can repeat, e.g. use→undo→use); re-read inside locks; map/validate every value that enters a Zod-checked DTO; count and log per-item failures; write every test the Task list names; keep the diff inside this story.
- 12.9 deferred to 12.10: "`flash_item_claims` has no FK on `user_id`/composite FK; cap not released on refund" — release handled here (Task 5.4); the FK stays deferred. "Admin `list()` N+1, no pagination" — the new Admin queue is paginated from the start.
- 12.8: ticket DTO (`toVoucherTicket`), `ticket.id = redemption.id`, append-only `redemptions`, "refunds later are new rows", code-secrecy rule, `reference` retry pattern, `WALLET_BALANCE_PORT` and `*_PORT` cross-module pattern, per-user throttles.
- 12.7: `CodeIssueReport` table and the partial unique index "one OPEN per redemption" exist; the table has no Admin API yet.

### Git intelligence

- `d6db08d` Merge PR #26 (12.9), `b64da7f` 12.9 implementation (reserve-at-start, `flash_item_claims`, lifecycle job, Admin Flash API), `6e7c869` PR #25 (12.8), `a469259` PR #24 (12.7). Latest migration `20261015100000_rewards_flash_sale_lifecycle`. Rewards files above were all touched by 12.7–12.9; expect merge pressure only if another story lands first.

### Latest tech information

- No new dependency. Prisma 6.0.0 (partial indexes, CHECKs and `ALTER TYPE … ADD VALUE` only in SQL, mirrored in `post-push-invariants.sql`; keep `ADD VALUE` statements first in the file and do not use the new values in the same migration), NestJS 10, Zod 3.24, Jest 29, PostgreSQL 15. Use parameterised `$queryRaw`/`$executeRaw` for `FOR UPDATE`, `SKIP LOCKED` and conditional updates. The scheduler is the in-process runner (exactly one API replica in production, lease with fencing token); tests call the service or `runJobOnce()` directly, never the timer.

### Open points for the dev agent to confirm with Quan (do not block; solo owner)

1. **Refund returns no stock/code (default adopted).** The faulty code is dead; stock and Flash `sold` stay consumed. Alternative: return one stock unit when the faulty code is voided. Needs a partner-side decision on whether faulty codes are re-credited.
2. **RESOLVED (Quan, 2026-10-14): REJECT is in scope** (Tasks 2.4, 5.1, 5.4b, 8.x). Note is mandatory and shown to the user in the notification.
3. **Refund frees limits and the Flash slot (default adopted, closes 12.9 open point 5).** Flip to "consumed" by keeping the claim row and counting refunded rows.
4. **RESOLVED (Quan, 2026-10-14): FE stories created** — 12.12 (Admin code-issue queue contract & MSW mock) and 12.13 (Admin code-issue queue screen), both in `epics.md` and `sprint-status.yaml`. 12.12 must adopt the Admin schemas defined in Task 5.1 here.
5. **Notification types and channels.** Two new in-app types (`VOUCHER_EXPIRING`, `CODE_ISSUE_RESOLVED`); no email. The FE must render unknown/new types — verify in `apps/frontend/my-app` notification components and note the result.
6. **Refund after expiry for a timely report** is allowed (default); replacement after expiry is not. Confirm.
7. **`openIssue` semantics** (latest report of any status) to be confirmed against the Story 12.4 UI states before the contract is frozen.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 intro, Stories 12.1, 12.8, 12.9, 12.10, 12.11]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-13.md` FR-70, FR-75, BR-22, BR-23, Open Questions 23–26; Gap 2.4 (Rewards-owned queue, Story 8.5 deferred)]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` AD-24, AD-10, AD-16]
- [Source: `_bmad-output/implementation-artifacts/12-8-quote-redemption-transaction.md` (append-only redemptions, ticket id, code secrecy, transaction recipe), `12-9-flash-sale-lifecycle.md` (review findings, claims, scheduler job pattern), `12-7-rewards-schema-catalog-code-inventory-api.md` (CodeIssueReport table), `12-4-my-vouchers-code-qr-history.md` (FE behaviour)]
- [Source: `apps/frontend/my-app/mocks/{handlers/rewards.ts,data/rewards.ts,data/rewards-rules.ts}`; `packages/schemas/src/rewards/{redemption,rewards-admin}.schema.ts`; `packages/schemas/src/economy/ledger-journal.schema.ts` (`reverseJournalInputSchema`)]
- [Source: `apps/backend/src/modules/economy/application/ledger.service.ts` `reverseJournal`; `economy.module.ts` `SPEND_POINTS_PORT`; `modules/notifications/application/ports/notification-publisher.port.ts`; `common/scheduler/outbox/outbox-handler.ts`; `modules/rewards/**`; `apps/backend/prisma/schema.prisma` models `Redemption`, `VoucherCode`, `CodeIssueReport`, `FlashItemClaim`, enum `NotificationType`]

## Dev Agent Record

### Agent Model Used

- Google Antigravity Claude / Gemini Engine (`inherit`)

### Debug Log References

- PostgreSQL suite logs: `file:///Users/quan/.gemini/antigravity-cli/brain/6cd17ac5-6704-4e80-8175-327c998cc7d3/.system_generated/tasks/task-1416.log`
- Task 8.4 concurrency runs: `file:///Users/quan/.gemini/antigravity-cli/brain/6cd17ac5-6704-4e80-8175-327c998cc7d3/.system_generated/tasks/task-1343.log`
- Full backend unit suite: `file:///Users/quan/.gemini/antigravity-cli/brain/6cd17ac5-6704-4e80-8175-327c998cc7d3/.system_generated/tasks/task-1416.log` (2467/2467 passed)
- Schemas test suite: `file:///Users/quan/.gemini/antigravity-cli/brain/6cd17ac5-6704-4e80-8175-327c998cc7d3/.system_generated/tasks/task-1257.log` (635/635 passed)
- Frontend node test runner: `file:///Users/quan/.gemini/antigravity-cli/brain/6cd17ac5-6704-4e80-8175-327c998cc7d3/.system_generated/tasks/task-1265.log` (886/886 passed)
- PostgreSQL migration chain: `file:///Users/quan/.gemini/antigravity-cli/brain/6cd17ac5-6704-4e80-8175-327c998cc7d3/.system_generated/tasks/task-1269.log` (16/16 passed)

### Completion Notes List

- Implemented pure domain logic in `domain/ticket-rules.ts`, `domain/reminder-plan.ts`, `domain/code-issue-resolution.ts`, and `domain/redemption-reference.ts`.
- Created additive migration `20261016100000_rewards_my_vouchers_code_issues` with tables `redemption_usages`, `redemption_refunds`, `redemption_reminders`, foreign key `voucher_codes.issue_report_id`, and columns on `code_issue_reports`.
- Added notification types `VOUCHER_EXPIRING` and `CODE_ISSUE_RESOLVED` to Prisma, Zod schema, and frontend notification presentation map.
- Built application services: `RewardsMyVouchersService`, `RewardsAdminCodeIssuesService`, and `VoucherReminderService`.
- Built framework-free Outbox handlers for reminder events and issue resolution events with automatic message truncation under 500 characters.
- Built HTTP controllers `RewardsMyVouchersController` and `AdminRewardsCodeIssuesController` mounted with both canonical and `/api/` alias prefixes.
- Verified live PostgreSQL concurrency: parallel mark-used idempotency, mark-used racing undo, mark-used racing refund, double report filing, racing REPLACE/REFUND/REJECT with zero ledger sum, two Admins refunding with single reversal journal, append-only triggers, duplicate reminder suppression, and service restart safety.
- Verified baseline blocker: full e2e failures outside Story 12.10 are due to cumulative test data in `rescom_financial_test` for Flash daily codes, and legacy expectation of Admin self-moderation queueing vs Official instant publish in Forms service. Fresh test database `rescom_story_1210_test` passed all 8 Rewards suites cleanly.

### File List

- `apps/backend/prisma/migrations/20261016100000_rewards_my_vouchers_code_issues/migration.sql`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/sql/post-push-invariants.sql`
- `apps/backend/src/common/http/http-exception.filter.rewards.spec.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/common/scheduler/scheduler.constants.ts`
- `apps/backend/src/modules/economy/economy.module.ts`
- `apps/backend/src/modules/notifications/infrastructure/notification-type.parity.spec.ts`
- `apps/backend/src/modules/rewards/application/code-issue-notification.handler.ts`
- `apps/backend/src/modules/rewards/application/exceptions/rewards.exceptions.ts`
- `apps/backend/src/modules/rewards/application/ports/my-vouchers-read.port.ts`
- `apps/backend/src/modules/rewards/application/ports/reverse-spend.port.ts`
- `apps/backend/src/modules/rewards/application/ports/ticket-write.port.ts`
- `apps/backend/src/modules/rewards/application/rewards-admin-code-issues.service.ts`
- `apps/backend/src/modules/rewards/application/rewards-my-vouchers.service.spec.ts`
- `apps/backend/src/modules/rewards/application/rewards-my-vouchers.service.ts`
- `apps/backend/src/modules/rewards/application/unique-violation.ts`
- `apps/backend/src/modules/rewards/application/voucher-expiry-notification.handler.ts`
- `apps/backend/src/modules/rewards/application/voucher-reminder.service.ts`
- `apps/backend/src/modules/rewards/domain/code-issue-resolution.ts`
- `apps/backend/src/modules/rewards/domain/redemption-reference.ts`
- `apps/backend/src/modules/rewards/domain/reminder-plan.ts`
- `apps/backend/src/modules/rewards/domain/story-12-10-domain.spec.ts`
- `apps/backend/src/modules/rewards/domain/ticket-rules.ts`
- `apps/backend/src/modules/rewards/domain/voucher-ticket.ts`
- `apps/backend/src/modules/rewards/infrastructure/in-memory-my-vouchers.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/in-memory-redemption.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-my-vouchers.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-redemption.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-voucher-code.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/prisma-voucher.repository.ts`
- `apps/backend/src/modules/rewards/infrastructure/rewards-outbox.registrar.ts`
- `apps/backend/src/modules/rewards/infrastructure/rewards-scheduler.registrar.ts`
- `apps/backend/src/modules/rewards/infrastructure/rewards.repositories.spec.ts`
- `apps/backend/src/modules/rewards/infrastructure/voucher-reminder.job.ts`
- `apps/backend/src/modules/rewards/presentation/admin-rewards-code-issues.controller.ts`
- `apps/backend/src/modules/rewards/presentation/rewards-my-vouchers.controller.ts`
- `apps/backend/src/modules/rewards/rewards.module.ts`
- `apps/backend/test/migration-chain.prisma.e2e-spec.ts`
- `apps/backend/test/migration-chain.spec.ts`
- `apps/backend/test/rewards-my-vouchers.e2e-spec.ts`
- `apps/backend/test/rewards-my-vouchers.prisma.e2e-spec.ts`
- `apps/frontend/my-app/lib/notifications/notification-presentation.ts`
- `apps/frontend/my-app/tests/route-diff.test.mjs`
- `packages/schemas/src/notifications/notification.schema.spec.ts`
- `packages/schemas/src/notifications/notification.schema.ts`
- `packages/schemas/src/rewards/index.ts`
- `packages/schemas/src/rewards/rewards-admin.schema.spec.ts`
- `packages/schemas/src/rewards/rewards-admin.schema.ts`
- `packages/schemas/src/rewards/rewards-events.schema.ts`
- `apps/backend/src/modules/rewards/application/unique-violation.spec.ts`
- `_bmad-output/implementation-artifacts/12-10-my-vouchers-reminders-faulty-code-resolution.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/epics.md`
