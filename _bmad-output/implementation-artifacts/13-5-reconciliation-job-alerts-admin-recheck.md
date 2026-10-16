# Story 13.5: Reconciliation Job, Alerts & Admin Re-Check

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want lost confirmations recovered automatically and on demand,
so that no paid top-up stays uncredited and no expired one stays open.

## Acceptance Criteria

1. **Given** the Economy scheduler with AD-17 lease/fencing, **When** the job runs every minute, **Then** it checks `PROCESSING` rows, unresolved `AMOUNT_MISMATCH` rows, and rows `EXPIRED` or `CANCELLED` within the last 24 hours against payOS GET, and applies the AD-25 mapping through `CreditTopUp` (NFR-32).
2. **And** a `PROCESSING` row past `expiresAt` (local clock) becomes `EXPIRED`, with a best-effort payOS cancel and a user notification.
3. **And** this story introduces the server-only config key `TOPUP_REFUND_MAILBOX`. It is validated at startup when PayOS is used, and Story 13.10 reuses it for refund emails.
4. **And** an Admin alert (in-app notification, email to `TOPUP_REFUND_MAILBOX`, Sentry) fires once per condition. The conditions are:
   - uncredited 30 minutes after a verified payment;
   - `AMOUNT_MISMATCH` unresolved 3 business days after `paidAt`;
   - repeated provider failure.
5. **And** business days are Monday–Friday in `Asia/Ho_Chi_Minh` with no holiday calendar. They are implemented in one shared helper, with tests across a weekend.
6. **And** Admin `RecheckTopUp` on any `PAYOS` row runs the same GET + mapping + `CreditTopUp` path on demand. It is idempotent, is audited, and returns credited / still unpaid / mismatch.
7. **And** two job instances never process the same row concurrently, proven by a lease test. A job racing a webhook still credits once.

### Clarifications baked into this story

These were resolved from the docs during story creation; see Dev Notes → Decisions for why.

- **C1 (AC 1, 2)**: an expired `PROCESSING` row is **GET first, then expire**, because a paid row must credit, not expire.
  - If the GET returns CREDIT or AMOUNT_MISMATCH, apply it.
  - If the GET fails or returns NO_CHANGE / CANCELLED / EXPIRED, mark the row `EXPIRED` locally, then make a best-effort `cancelPayment`.
  - A not-yet-expired `PROCESSING` row whose provider status is `CANCELLED`/`FAILED`/`EXPIRED` moves to `CANCELLED`/`EXPIRED` (AD-25 table, last row).
- **C2 (AC 1)**: the 24-hour window anchor is `cancelledAt` for `CANCELLED` and `expiresAt` for `EXPIRED`. `AMOUNT_MISMATCH` rows have no window and stay in scope until 13.9 resolves them.
- **C3 (AC 1, 13.4 deferral)**: **cumulative mismatch refresh**. An `AMOUNT_MISMATCH` row whose provider `amountPaid` changed gets a new `amountPaidVnd` and a new user notice. `paidAt` is **kept** (it is the first payment and the SLA anchor). If the new cumulative amount equals `amountVnd`, the existing CREDIT path applies (13.4 already allows `AMOUNT_MISMATCH → SUCCESSFUL`).
- **C4 (AC 4)**: "once per condition" is enforced by the **Outbox unique `idempotencyKey`**. Each alert is one `ECONOMY_TOPUP_ADMIN_ALERT` Outbox event, and its handler fans out to the in-app notification, the email and Sentry.
- **C5 (AC 4)**: the alert condition set includes the 13.2/13.4 deferral: **paid amount on a cancelled/expired/failed link**, meaning the provider effect is `CANCELLED`/`EXPIRED` with `facts.amountPaidVnd > 0` (deferred-work.md l.463). It is decided and is not new scope.
- **C6 (AC 4)**: "repeated provider failure" means **3 consecutive job runs in which the job attempted at least one payOS call and every attempt failed**. Recheck failures do not count. There is one alert per failure episode, and any successful call ends the episode. Owner confirmed.
- **C7 (AC 4)**: Sentry. The backend has **no Sentry SDK**, and Story 11.4 (observability) is backlog. The "Sentry" leg is a structured `logger.error` with a stable tag, `payos-admin-alert`, which 11.4's Sentry integration will capture. Do **not** add `@sentry/node` in this story. Owner confirmed.
- **C8 (AC 2)**: the expiry notification reuses `NotificationType` `TOPUP_CANCELLED`, with an "expired" message. It needs no Prisma enum migration and no FE parity change. Owner confirmed.

## Tasks / Subtasks

- [ ] **Task 0: Branch** (memory rule).
  - Branch `feat/13-5-reconciliation-job-alerts-admin-recheck` was created on 2026-10-15 from `origin/develop` `8c05738`, which already contains 13.4 (PR #39).
  - It lives in the worktree `~/HocTap/Vibecode/project-rescom-13-5`, because the main checkout holds uncommitted 13.7 work.
  - Before the first edit, run `git status --short --branch` in that worktree.
  - Upstream: run `git branch --unset-upstream` if `git status` shows `origin/develop` tracking.
- [ ] **Task 1: Shared contract** (AC: 2, 4, 5, 6). Work in `packages/schemas/src/`.
  - [ ] Change `economy/payos-top-up.schema.ts`:
    - Widen `topUpStatusChangedEventSchema.status` to `['CANCELLED','SUCCESSFUL','AMOUNT_MISMATCH','EXPIRED']`. Keep one event type and `schemaVersion: 1`.
    - Add the key helper `topUpExpireKey(id) = 'topup-expire:' + id`.
  - [ ] In the same file, add the admin alert contract:
    - `TOP_UP_ADMIN_ALERT_EVENT_TYPE = 'ECONOMY_TOPUP_ADMIN_ALERT'`.
    - `topUpAdminAlertConditionSchema = z.enum(['UNCREDITED_AFTER_PAYMENT','MISMATCH_SLA_BREACHED','PAID_ON_CLOSED_LINK','PROVIDER_FAILURE'])`.
    - `topUpAdminAlertEventSchema` = `{ schemaVersion: 1, condition, topUpId?: uuid, orderCode?: int, amountVnd?: int, amountPaidVnd?: int, occurredAt }`. It carries no `userId`, email or account data, because the alert goes to a mailbox.
    - `topUpAlertKey(condition, subject) = \`topup-alert:${condition}:${subject}\``. The subject is `topUpId` for row conditions and the episode start ISO for `PROVIDER_FAILURE`.
  - [ ] Add the recheck contract:
    - `payosRecheckResultSchema = z.object({ topUpId: uuid, result: z.enum(['CREDITED','STILL_UNPAID','MISMATCH']), status: payosTopUpStatusSchema, amountPaidVnd: z.number().int().nonnegative().nullable() })`, plus its type export.
    - The 13.8 toast maps `result` 1:1 (UX-DR-P21).
  - [ ] Add the recheck audit to `economy/top-up.schema.ts` next to `TOP_UP_AUDIT_EVENT_TYPES`:
    - Add `RECHECKED: 'AdminTopUpRechecked'`.
    - Add the payload schema `topUpRecheckAuditEventPayloadSchema`: `{ schemaVersion: 1, action: 'TOPUP_RECHECKED', auditCategory: 'MODERATION_ADMIN_ACTION', topUpId, adminId, orderCode, result: 'CREDITED'|'STILL_UNPAID'|'MISMATCH'|'PROVIDER_UNAVAILABLE', statusBefore, statusAfter, correlationId: nullable, occurredAt }`.
    - Mirror the existing `topUpAdminAuditEventPayloadSchema` style.
  - [ ] Add a new file, `common/business-days.ts`, and export it from `common/index.ts`. Put it in shared schemas because FR-78 (13.10/13.11) and FE SLA display reuse it.
    - Signature: `addBusinessDays(start: Date, days: number): Date`.
    - Use a fixed UTC+7 offset. Vietnam has no DST; write a one-line comment saying so.
    - Convert `start` to local wall time. If it falls on Sat/Sun, roll forward to the next Monday 00:00 local.
    - Then step `days` local days, skipping Sat/Sun, and keep the local time of day.
    - Return UTC.
    - Add `isBusinessDay(date)` only if the implementation needs it. Do not add holiday calendars or any library (`date-fns-tz` is not installed; do not add it).
  - [ ] Tests:
    - `business-days.spec.ts` covers:
      - Mon 10:00 + 3 = Thu 10:00;
      - Thu 10:00 + 3 = Tue 10:00 (crosses a weekend);
      - Fri 23:30 local + 1 = Mon 23:30;
      - Sat 15:00 + 3 = Thu 00:00 (Sat rolls to Mon 00:00, then +3 business days).
      - a UTC instant that is already Saturday in UTC+7 (e.g. Fri 18:00Z).
    - Extend the schema spec for the widened enum, the alert event and the recheck result.
- [ ] **Task 2: Config** (AC: 3). Work in `apps/backend/src/common/config/`.
  - [ ] In `env.schema.ts`, add `TOPUP_REFUND_MAILBOX: z.string().trim().email().optional()` next to the `PAYOS_*` keys (~l.206-211).
  - [ ] In the existing `superRefine` (~l.369-385), require it whenever PayOS is used: `PAYOS_ENABLED=true` **or** any `PAYOS_*` credential set. Use the same path/message style as the credential check.
  - [ ] In `env.service.ts`, add the getter `topUpRefundMailbox: string | null`.
  - [ ] Never log the value with secrets. It is not secret, so the placeholder-secret check (l.512) does not apply.
  - [ ] Add the key with a placeholder comment to `deploy/.env.prod.example` (or whichever `deploy/*.example` lists `PAYOS_*`, grep to find it) and to `apps/backend/.env.example` if it lists `PAYOS_*`. Do not touch real env files. Story 13.6 sets the real value on the VPS (`trananhquan1104.work@gmail.com`, PRD addendum l.373).
  - [ ] Add an `env.schema.spec.ts` case: PayOS keys set without the mailbox fail validation; with the mailbox they pass; neither set passes.
- [ ] **Task 3: Repository** (AC: 1, 2, 6). Extend `application/ports/payos-top-up-repository.port.ts`, `infrastructure/prisma-payos-top-up.repository.ts` and `infrastructure/in-memory-payos-top-up.repository.ts`.
  - [ ] `listReconcileCandidates({ now, after?: string, limit }): Promise<PayosTopUp[]>`. It returns PAYOS rows where:
    - `status = 'PROCESSING'`, or
    - `status = 'AMOUNT_MISMATCH'`, or
    - `status = 'CANCELLED' AND cancelled_at >= now - 24h`, or
    - `status = 'EXPIRED' AND expires_at >= now - 24h`.
    - Order by `id` with a keyset `id > after` and `take limit`.
    - Use the existing `[channel,status,createdAt]` index and do not add a new one.
    - Plain read, no lock.
  - [ ] `findPayosById(id): Promise<PayosTopUp | null>`. Admin scope, PAYOS only; `findOwned` stays user-scoped.
  - [ ] `markExpired(id, now, outboxEvent): Promise<{ changed: boolean }>`:
    - CAS `PROCESSING → EXPIRED` through the existing `transition()` helper.
    - Do not set `cancelledAt`.
    - Write the Outbox event in the same transaction.
  - [ ] Widen `markAmountMismatch` for C3:
    - The CAS allows `PROCESSING|CANCELLED|EXPIRED` as today, **or** `AMOUNT_MISMATCH AND amount_paid_vnd <> :newAmount`.
    - On the refresh branch, update `amountPaidVnd`, `providerReference` and `counterAccount*` (still first-non-null-wins) and **keep `paidAt`**.
    - Implement it as a second guarded `updateMany` inside the same transaction, or a raw `UPDATE ... WHERE`. Keep it one status-guarded statement per branch. Count 0 → `{ changed: false }`.
  - [ ] `markCancelled` exists from 13.3 and transitions from PROCESSING only. Reuse it for C1's provider-CANCELLED case, passing a system reason. Do not fork it.
  - [ ] `enqueueAdminAlert(event): Promise<{ created: boolean }>`:
    - Insert one Outbox row and ignore a duplicate `idempotencyKey`, using Prisma `createMany({ data:[...], skipDuplicates: true })` or `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`.
    - `outbox_events.idempotency_key` is already `@unique` (schema.prisma ~l.598). This is the once-per-condition guarantee.
  - [ ] `recordAdminAudit(event)`: plain Outbox insert of the recheck audit event, same shape as `top-up.service.ts:352-394`.
    - Audit events have no consumer. The Outbox row **is** the audit record (AD-16, as for `AdminTopUpApproved`), and unhandled event types stay `PENDING` by design (`outbox-claim.repository.ts:26`).
  - [ ] The in-memory twin mirrors every rule: the C3 refresh CAS, `paidAt` kept, the duplicate alert key ignored.
- [ ] **Task 4: Service changes** (AC: 1, 2, 6). Work in `application/payos-top-up.service.ts` (plain class, no `@nestjs/*`, no word "adapter" anywhere in `application/`; see `test/architecture.spec.ts`).
  - [ ] Change `applySnapshot` to return the effect it saw, so callers can derive results without re-reading. Widen it to `{ outcome: 'IGNORED'|'APPLIED', effect: ProviderPaymentEffect }`. Update the 13.4 callers and specs (`handleWebhook` only reads `outcome`).
    - Leave the 13.4 `logger.warn` for paid closed links in place. The job raises the alert (Task 5), not `applySnapshot`, so webhook behavior is unchanged.
  - [ ] `recordMismatch`: keep the lock key `topup-mismatch-record:{id}` and the event key `topUpMismatchNoticeKey(id, amountPaidVnd)`. Its allowed set now includes `AMOUNT_MISMATCH` when the amount differs (C3). The new amount gives a new key, so the user gets a new notice; the same amount gives `{changed:false}` and `IGNORED`.
  - [ ] Add `expireTopUp(topUpId, now)`:
    - `unitOfWork.run(topUpExpireKey(id), …)` → `lockForUpdate` → status must be `PROCESSING` and `expiresAt <= now`, else `IGNORED`.
    - Then `markExpired` with the event `{ status: 'EXPIRED', idempotencyKey: topUpExpireKey(id), aggregateVersion: 2 }`. It is terminal and the alternative to cancel (version 2, like 13.3's cancel), and late credit stays version 3.
    - Return `APPLIED|IGNORED`.
  - [ ] Add `closeFromProvider(topUpId, effect: 'CANCELLED'|'EXPIRED', now)` for C1's not-yet-expired case:
    - CANCELLED → `markCancelled` with the existing `topUpCancelKey` event.
    - EXPIRED → `expireTopUp`, skipping the `expiresAt` check because the provider is authoritative.
    - Only from `PROCESSING`; otherwise `IGNORED`.
  - [ ] Add `recheck({ topUpId, adminId, correlationId }): Promise<PayosRecheckResult>`:
    1. `findPayosById`; null or not PAYOS → throw the existing not-found exception (404).
    2. `snapshot = await provider.getPayment(row.orderCode, row.amountVnd)` outside any transaction. Run it for **every** status, including SUCCESSFUL (AC "any PAYOS row"). `applySnapshot` is already a safe no-op there.
    3. On `PaymentProviderUnavailableError`: write the audit with `result: 'PROVIDER_UNAVAILABLE'`, then rethrow (controller → 503 retryable).
    4. `orderCode` mismatch → warn and treat it as unavailable.
    5. `applySnapshot(row.id, snapshot)`. It does **not** expire or close rows; that is the job's job.
    6. Re-read the row and derive `result`: `SUCCESSFUL` → `CREDITED`; `AMOUNT_MISMATCH` or `MANUAL_REFUNDED` → `MISMATCH`; anything else → `STILL_UNPAID`.
    7. `recordAdminAudit` with `statusBefore`/`statusAfter` and an idempotency key `admin-audit:topup-recheck:${id}:${uuid}`. Each recheck is its own audit row. It is idempotent in money terms (layered 13.4 keys), not in audit rows.
    8. Return `{ topUpId, result, status, amountPaidVnd }`.
  - [ ] The admin's live capability is enforced by `RolesGuard` at the controller. Recheck moves money only through `CreditTopUp`, which never needs admin identity, so no extra capability re-check inside the transaction is needed. Note this in the code with one line.
- [ ] **Task 5: Reconciliation job** (AC: 1, 2, 4, 7). Add a new file, `infrastructure/jobs/payos-reconcile.job.ts`; it is infrastructure, like `starter-expiry.job.ts`.
  - [ ] Add constants to `common/scheduler/scheduler.constants.ts`:
    ```ts
    PAYOS_RECONCILE_JOB = { name: 'payos-reconcile', intervalMs: 60_000, leaseTtlMs: 60_000, batchSize: 50 }
    ```
    - `maxBatches` defaults to 4 per run, i.e. at most 200 GETs per minute.
    - `// ponytail: id-cursor sweep; add per-row lastCheckedAt priority if candidates routinely exceed 200/min.`
  - [ ] `class PayosReconcileJob implements ScheduledJob`. Constructor: `(service: Pick<PayosTopUpService, 'applySnapshot'|'expireTopUp'|'closeFromProvider'>, repository, provider: PaymentProviderPort, alerts: TopUpAdminAlerts, maxBatches)`.
    - Keep `this.cursor` across runs exactly as `StarterExpiryJob` does. It resets to `undefined` when a sweep ends (`hasMore=false`).
    - Before every batch after the first, check `ctx.shouldContinue()`, and also **before each row's provider call** (cheap CAS renew). A lost lease stops the job immediately (AD-17, AC 7).
  - [ ] Per row (try/catch per row; one failure never stops the batch):
    1. `snapshot = provider.getPayment(row.orderCode, row.amountVnd)`.
       - If it throws `PaymentProviderUnavailableError`: count `providerFailed`.
       - If the row is `PROCESSING` and `expiresAt <= ctx.now`, still `expireTopUp` (C1) and make a best-effort cancel.
       - `continue`.
    2. If the row is `PROCESSING`:
       - CREDIT / AMOUNT_MISMATCH → `applySnapshot`.
       - CANCELLED / EXPIRED → `closeFromProvider`.
       - NO_CHANGE and `expiresAt <= ctx.now` → `expireTopUp`, then `provider.cancelPayment(orderCode, 'Hết hạn').catch(log)` **after** the commit (best effort; never inside the transaction).
       - NO_CHANGE and not expired → nothing.
    3. Otherwise (`CANCELLED`/`EXPIRED`/`AMOUNT_MISMATCH`) → `applySnapshot` (late payment credits; C3 refresh).
    4. Alerts (Task 6), evaluated after step 2/3 with the snapshot and the post-apply outcome:
       - `UNCREDITED_AFTER_PAYMENT`: `snapshot.effect === 'CREDIT'`, the row did not reach `SUCCESSFUL` (outcome IGNORED or the call threw), and `ctx.now - (snapshot.facts.paidAt ?? row.paidAt) >= 30 min`. A thrown credit (ledger/DB error) also counts `failed`.
       - `PAID_ON_CLOSED_LINK` (C5): `effect ∈ {CANCELLED, EXPIRED}` and `facts.amountPaidVnd > 0`.
       - `MISMATCH_SLA_BREACHED`: the row, after apply, is `AMOUNT_MISMATCH`, has `paidAt`, and `ctx.now >= addBusinessDays(paidAt, 3)`. Evaluate it even if the GET failed: it needs no provider data, so do it before the `continue` in step 1.
  - [ ] Provider-failure episode (C6):
    - Instance fields `consecutiveAllFailedRuns` and `episodeStartedAt`.
    - At the end of a run with `providerAttempted > 0 && providerFailed === providerAttempted`, increment it. When it reaches 3, call `alerts.raise('PROVIDER_FAILURE', episodeStartedAt.toISOString())`. The key dedupes the repeat calls.
    - Any successful provider call resets both fields.
    - `// ponytail: in-memory episode counter; a restart may re-alert once, acceptable for one VPS instance.`
  - [ ] Summary counts only, no ids (AD-18): `scannedCount, creditedCount, mismatchCount, expiredCount, closedCount, providerFailedCount, failedCount, alertsRaisedCount`.
    - Call `assertNotAllFailed(this.name, failedCount + providerFailedCount, scannedCount)` so the runner backs off when payOS is fully down.
    - No candidates → `SUCCEEDED` with zero calls. The job must make **zero** provider calls when there are no PAYOS rows; prod today has none, and `UnconfiguredPaymentProvider` throws.
  - [ ] **Not flag-gated**: do not read `PAYOS_ENABLED` (AD-25 l.267; epics runbook l.2020: "flag off closes checkout while webhook and reconciliation keep running"). The runner's `SCHEDULER_ENABLED` is the only on/off.
  - [ ] Register it in `infrastructure/economy-scheduler.registrar.ts` with `this.jobs?.register(new PayosReconcileJob(...))`, next to `StarterExpiryJob`. Inject what it needs through the registrar constructor.
- [ ] **Task 6: Admin alerts** (AC: 4).
  - [ ] Add `TopUpAdminAlerts` as a small application class or function, `raise(condition, subject, details)`. It builds the `ECONOMY_TOPUP_ADMIN_ALERT` event with `idempotencyKey = topUpAlertKey(condition, subject)` and calls `repository.enqueueAdminAlert`. The return value says whether it was created; count `alertsRaisedCount` only when created.
  - [ ] Add a new Outbox handler, `infrastructure/top-up-admin-alert.handler.ts`, for event type `ECONOMY_TOPUP_ADMIN_ALERT`. Register it in `EconomySchedulerRegistrar` beside `TopUpNotificationHandler`. Model it on `top-up-notification.handler.ts` (parse with the schema first; a bad payload is a permanent failure). It runs three legs, independently, and must be idempotent on retry:
    1. **In-app**: `ADMIN_CAPABILITY_PORT.listActiveAdminIds()`, then `NOTIFICATION_PUBLISHER_PORT.publish({ userId, type: 'WARNING', message, dedupeKey: event.idempotencyKey })` per admin, with a `.catch` per admin. This is the pattern in `payos-enable-guard.ts:23-69`. `(userId, dedupeKey)` uniqueness makes retries safe.
    2. **Email**: `EMAIL_SENDER_PORT.send({ to: env.topUpRefundMailbox, subject, text, html, idempotencyKey: event.idempotencyKey })`. `NotificationsModule` exports it (`notifications.module.ts:124`).
       - The result is `ACCEPTED|RETRYABLE|PERMANENT|AMBIGUOUS|SKIPPED`; `send` never throws.
       - `RETRYABLE` → throw so the Outbox retries (legs 1 and 3 are idempotent).
       - `PERMANENT`/`AMBIGUOUS` → `logger.error`, no retry (avoid a double email).
       - Mailbox null (PayOS not configured, local dev) → skip the email leg with a warn.
    3. **Sentry leg (C7)**: `logger.error('payos-admin-alert', { condition, topUpId, orderCode })`. Ids only, never `counterAccount*`, names or emails.
  - [ ] Messages are Vietnamese, plain and short, without account numbers. Examples:
    - `UNCREDITED_AFTER_PAYMENT`: "Nạp Điểm #<orderCode> đã thanh toán nhưng chưa được cộng Điểm sau 30 phút. Kiểm tra lại với payOS."
    - `MISMATCH_SLA_BREACHED`: "Nạp Điểm #<orderCode> lệch số tiền chưa được xử lý quá 3 ngày làm việc."
    - `PAID_ON_CLOSED_LINK`: "payOS báo đã nhận tiền cho Nạp Điểm #<orderCode> đã huỷ/hết hạn. Kiểm tra và hoàn tiền nếu cần."
    - `PROVIDER_FAILURE`: "Không kết nối được payOS trong nhiều lần đối soát liên tiếp."
  - [ ] Extend `top-up-notification.handler.ts` for `EXPIRED`: type `TOPUP_CANCELLED` (C8), message "Yêu cầu nạp <amount> VNĐ đã hết hạn thanh toán. Nếu bạn đã thanh toán, Điểm vẫn sẽ được cộng.", dedupe = `event.idempotencyKey`. Do not register a second handler.
- [ ] **Task 7: Admin endpoint** (AC: 6). Work in `presentation/admin-top-up.controller.ts`.
  - [ ] Add `POST :id/recheck` with `CsrfGuard`; the class already has `SessionAuthGuard, RolesGuard, @Roles('ADMIN')`.
    - Validate `id` as a uuid with the existing param pipe pattern.
    - `correlationId` comes from the `x-correlation-id` header, as for approve/reject.
    - Call `payosTopUpService.recheck` and return `createSuccessEnvelope(result)`.
    - Validate the response with `payosRecheckResultSchema` in the spec.
  - [ ] Error mapping:
    - not found / manual row → 404;
    - `PaymentProviderUnavailableError` → 503 with a retryable error code. Reuse the 13.3 checkout mapping for provider-down; grep `PaymentProviderUnavailableError` in `presentation/`.
  - [ ] No per-IP throttle; it is admin-only. Do not change the manual approve/reject endpoints or the queue (13.8/13.13).
- [ ] **Task 8: Tests** (AC: all). Use Jest specs beside the code, in-memory e2e in `test/*.e2e-spec.ts`, and DB e2e in `test/*.prisma.e2e-spec.ts` with `requireDb`. Never call real payOS.
  - [ ] `payos-reconcile.job.spec.ts` (use `testJobContext`, `FakePaymentProvider`, `InMemoryPayosTopUpRepository`, `FixedClock`):
    - PROCESSING + PAID full → SUCCESSFUL.
    - PROCESSING past `expiresAt` + PENDING → EXPIRED, then one `cancelCalls` entry after the transition, and an EXPIRED event.
    - PROCESSING past `expiresAt` + GET throws → still EXPIRED.
    - PROCESSING past `expiresAt` + PAID → SUCCESSFUL, **not** EXPIRED.
    - PROCESSING not expired + provider CANCELLED → CANCELLED.
    - CANCELLED 23h ago + PAID → SUCCESSFUL; CANCELLED 25h ago is not scanned (zero GETs).
    - AMOUNT_MISMATCH + larger UNDERPAID → refreshed `amountPaidVnd`, `paidAt` unchanged, new notice; same amount → no new event.
    - AMOUNT_MISMATCH + PAID full → SUCCESSFUL.
    - No candidates → zero provider calls.
    - Lease lost (`testJobContext(now,[false])`) → stops before the next row.
    - Cursor carries across runs and resets at the end.
    - Each alert condition raises exactly once across two runs: UNCREDITED (force `creditTopUp` to throw, `paidAt` 31 min ago; 29 min → no alert), PAID_ON_CLOSED_LINK, MISMATCH_SLA (`FixedClock` across a weekend), PROVIDER_FAILURE (3 all-failed runs → 1 alert; a 4th → still 1; success then 3 more → new episode alert).
    - Does not read `PAYOS_ENABLED`.
  - [ ] AC 7 lease test, `payos-reconcile.lease.spec.ts`:
    - Two `SchedulerRunnerService` instances share one `InMemoryJobLeaseRepository` and the same job class. Each has its own instance; the fake provider is shared.
    - `Promise.all([runnerA.runJobOnce('payos-reconcile'), runnerB.runJobOnce('payos-reconcile')])`.
    - Assert each candidate `orderCode` got exactly one `getPayment` call.
    - Follow `scheduler-runner.service.spec.ts` T2 (:282) for runner construction.
  - [ ] AC 7 race, `test/top-up-payos-reconcile.prisma.e2e-spec.ts` (real Postgres):
    - Run `Promise.all([job.run(ctx), service.handleWebhook(signedBody), service.recheck(...)])` on a PAID row.
    - Assert exactly one `ledgerJournal` with key `topup-credit:{id}`, one `topup-credit:` Outbox event, and the row SUCCESSFUL with the correct `pointsCredited`.
    - Also: a duplicate alert key gives one Outbox row (`ON CONFLICT`); `markExpired` CAS loses to a concurrent credit (the row ends SUCCESSFUL); the mismatch refresh keeps `paidAt`.
    - Copy the setup from `test/top-up-payos-webhook.prisma.e2e-spec.ts:116-148`.
  - [ ] `top-up-admin-alert.handler.spec.ts`:
    - fan-out to N admins with the same dedupeKey;
    - one admin publish failing does not stop the others;
    - email RETRYABLE → throws; PERMANENT → no throw plus an error log;
    - mailbox null → email skipped;
    - logs contain no PII.
  - [ ] `test/top-up-payos-recheck.e2e-spec.ts` (in-memory HTTP):
    - ADMIN → 200 for each result (CREDITED / STILL_UNPAID / MISMATCH);
    - a repeat recheck on SUCCESSFUL → CREDITED with no second journal;
    - an audit Outbox row per call, including PROVIDER_UNAVAILABLE → 503;
    - USER role → 403; no CSRF → 403; manual row or unknown id → 404.
  - [ ] `payos-top-up.service.spec.ts`: `expireTopUp`, `closeFromProvider`, the `recheck` result derivation, and `applySnapshot` returning its effect.
  - [ ] `top-up-notification.handler.spec.ts`: EXPIRED → `TOPUP_CANCELLED` with the expired message.
  - [ ] `economy-scheduler.spec.ts`: the registrar registers `payos-reconcile` and the alert handler.
  - [ ] Final run, from the worktree root:
    - backend `npm test`, `npm run test:e2e`, the prisma e2e suites with DB env, `npm run lint`, `npm run build`;
    - `packages/schemas` tests;
    - FE `tsc --noEmit` (the schema widening must not break FE exhaustive switches on status).
    - Record the counts. 13.4's baseline was backend 167 suites / 2532 tests and schemas 47 / 647.

### Review Findings

Code review 2026-10-16 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, uncommitted worktree diff vs 8c05738). 4 dismissed: holiday calendar (AC5 says none), AMOUNT_MISMATCH no age cap (C2 by design), nested `runInTransaction` in `markAmountMismatch` (joins ambient tx), `addBusinessDays` Invalid Date (internal Dates only).

- [x] [Review][Patch] (Decision resolved 2026-10-16: follow C1 — expired row → `expireTopUp` + best-effort cancel + expiry notice; non-expired → `closeFromProvider`) Expired PROCESSING row + provider CANCELLED/EXPIRED — C1 (l.32) says mark `EXPIRED` locally + best-effort cancel + expiry notice; Task 5 step 2 (l.151) routes any provider CANCELLED/EXPIRED to `closeFromProvider`. Code follows Task 5, so an expired-and-cancelled row ends `CANCELLED` with the "cancelled" notice.
- [x] [Review][Patch] (Decision resolved 2026-10-16: add result `'FAILED'` to recheck audit enum; audit FAILED on `applySnapshot` throw and orderCode mismatch, then rethrow; orderCode mismatch → 500 not 503) Recheck audit on non-provider failures — `applySnapshot` throwing leaves no audit row (AC6 "is audited"); orderCode mismatch is audited as `PROVIDER_UNAVAILABLE` and returns 503. Result enum has no failure/anomaly value.
- [x] [Review][Patch] MISMATCH_SLA_BREACHED fires on a row credited in the same run: 4c checks stale `row.status === 'AMOUNT_MISMATCH'`; use post-apply status only (spec l.158) [apps/backend/src/modules/economy/infrastructure/jobs/payos-reconcile.job.ts:372]
- [x] [Review][Patch] SLA anchor slides: 4c uses `snapshot.facts.paidAt ?? row.paidAt` (latest txn time); C3 says stored first `paidAt` is the anchor — use `row.paidAt ?? snapshot.facts.paidAt` [payos-reconcile.job.ts:376]
- [x] [Review][Patch] UNCREDITED_AFTER_PAYMENT false positive when `IGNORED` because a concurrent webhook/recheck already credited — re-read row and skip alert if `SUCCESSFUL` [payos-reconcile.job.ts:307]
- [x] [Review][Patch] UNCREDITED_AFTER_PAYMENT never raised when PAID snapshot has null `paidAt` and row `paidAt` null — fall back to `row.createdAt` [payos-reconcile.job.ts:311]
- [x] [Review][Patch] Best-effort `cancelPayment` runs even when `expireTopUp` lost the CAS race (row may be credited) — gate on applied outcome, both sites [payos-reconcile.job.ts:159,268]
- [x] [Review][Patch] Alert handler leg 1 (in-app) failures are swallowed; outbox marks done and dedupe key blocks re-fire — throw `TopUpAdminAlertRetryableError` after legs 2/3 when leg 1 failed (notifications dedupe on key, email idempotent) [apps/backend/src/modules/economy/infrastructure/top-up-admin-alert.handler.ts:79]
- [x] [Review][Patch] Recheck stores raw `x-correlation-id` header while `topUpRecheckAuditEventPayloadSchema.correlationId` requires UUID — store null when not a UUID [apps/backend/src/modules/economy/application/payos-top-up.service.ts:491]
- [x] [Review][Patch] Missing `payos-top-up.service.spec.ts` coverage for `expireTopUp`, `closeFromProvider`, `recheck` result derivation, `applySnapshot` effect (Task 8 l.231) [apps/backend/src/modules/economy/application/payos-top-up.service.spec.ts]
- [x] [Review][Patch] Job defines its own loose `PayosReconcileService` (bare-string outcomes, optional `effect`, `boolean | {created}` alerts) instead of `Pick<PayosTopUpService, ...>` (Task 5 l.141); mocks pass against a contract the real service lacks [payos-reconcile.job.ts:~20-60]
- [x] [Review][Patch] Non-`PaymentProviderUnavailableError` from `getPayment` counts as attempted but not failed, so an all-failed run never advances the C6 episode [payos-reconcile.job.ts:204]
- [x] [Review][Patch] Vacuous test "Does not read PAYOS_ENABLED" asserts undefined props only [apps/backend/src/modules/economy/infrastructure/jobs/payos-reconcile.job.spec.ts]
- [x] [Review][Patch] Unused `packages/schemas/src/common/index.ts` (root index exports `./common/business-days` directly) + stray blank line in `deploy/.env.prod.example` [packages/schemas/src/common/index.ts]

## Dev Notes

### Scope boundary (do / don't)

- **Do**:
  - the reconcile job, expiry, C3 refresh, alerts and the alert handler;
  - `TOPUP_REFUND_MAILBOX`;
  - the business-day helper;
  - the admin recheck endpoint and its audit;
  - the EXPIRED event and notification.
- **Don't**:
  - Admin mismatch → credit or refund. That is `ResolveTopUpMismatch` with the `topup-mismatch:{id}` journal, 13.9. **Never use that key here.**
  - The refund 3-business-day alert (13.10/13.12). It only reuses `addBusinessDays`.
  - Admin console UI and toast (13.8).
  - User "Kiểm tra lại" (13.7 calls the user GET).
  - The `confirm-webhook` script and the live probe (13.6).
  - Removing the manual flow (13.13).
  - Adding a Sentry SDK (11.4).
  - Changing `paymentFacts` transaction ordering (13.6 verifies it; deferred-work l.460).

### Current state of files being modified (read before editing)

- `application/payos-top-up.service.ts` (371 lines, 13.3+13.4):
  - `checkout` :54; `cancel` :132 (best-effort provider cancel, then `markCancelled` with `topUpCancelKey`, version 2); `handleWebhook` :175; `applySnapshot` :216 (returns `{outcome}` only; logs a warn for paid closed links); `event()` helper :240 (status union `SUCCESSFUL|AMOUNT_MISMATCH`, version 3; widen it or add a sibling for EXPIRED with version 2); `creditTopUp` :270-315; `recordMismatch` :316.
  - `creditTopUp` already allows `{PROCESSING, CANCELLED, EXPIRED, AMOUNT_MISMATCH}` and requires `snapshot.orderCode === row.orderCode` and `facts.amountPaidVnd === row.amountVnd`. **Preserve this.** Points = `row.amountVnd / 200`, never provider amounts.
  - `handleWebhook` skips the GET for SUCCESSFUL/MANUAL_REFUNDED rows. Keep that for the webhook; `recheck` deliberately does not skip it.
- `infrastructure/prisma-payos-top-up.repository.ts`:
  - `transition()` :192 is a status-guarded `updateMany` plus `outboxEvent.create` in one transaction. Reuse it for `markExpired`.
  - `markAmountMismatch` :272 allows `['PROCESSING','CANCELLED','EXPIRED']`; widen it for C3 only.
  - `amountPaidVnd` is overwritten from `facts` (:222). There is no DB write-once trigger, only a `>= 0` CHECK (`post-push-invariants.sql:453`).
- `application/top-up-notification.handler.ts` :12-46 maps SUCCESSFUL → `TOPUP_SUCCESS`, AMOUNT_MISMATCH → `TOPUP_AMOUNT_MISMATCH`, else → `TOPUP_CANCELLED`. EXPIRED falls into the else branch already; add the distinct message.
- `infrastructure/economy-scheduler.registrar.ts` :16-31 registers `PendingReleaseJob`, `StarterExpiryJob` and the `TopUpNotificationHandler`. `jobs`/`handlers` are `@Optional()`; keep that.
- `presentation/admin-top-up.controller.ts` :35-91: `@Controller(['admin/top-ups','api/admin/top-ups'])`, session + roles guards, CSRF on mutations, and the `createSuccessEnvelope` + `x-correlation-id` pattern.
- `common/config/env.schema.ts`: PAYOS keys at :206-211 and the PAYOS `superRefine` at :369-385.
- **Must preserve**:
  - webhook behavior and status codes (13.4 ACs);
  - checkout/cancel/enable guard (13.3);
  - manual top-up approve/reject untouched;
  - 13.4's concurrency test still green;
  - the FE build (status/notification enums).

### Decisions (why)

- **C1, GET before expire**: AD-25 says "PAID full amount → credit, also from CANCELLED/EXPIRED (late payment wins)". Expiring first would still credit later, but it would send the user a misleading "expired" notice for money they paid. If the provider is down, expire anyway. The local clock is authoritative for AC 2, the one-PROCESSING-per-user index must release, and the next run (within 24h) re-checks the EXPIRED row.
- **Best-effort cancel after commit**: never hold a DB transaction across HTTP (13.4 guardrail, AD-16). A failed cancel is logged only. If the user then pays the dead link, the late-payment path credits it.
- **C3**: payOS `amountPaid` is cumulative per link (AD-25 table). `paidAt` stays the first payment so the 3-business-day SLA doesn't slide. The notice key includes the amount, so each distinct amount notifies once.
- **C4, Outbox as the alert dedupe**: the unique `idempotency_key` already exists, retries come free, and the email has no other uniqueness. Rejected options: a new alert table (more schema), and the 13.3 daily notification dedupe (not "once per condition", and it gives the email no gate).
- **Sentry (C7)**: AC 4 names Sentry, but there is no SDK and 11.4 is backlog. A tagged error log is the minimum honest step. Record it as an AC deviation in Completion Notes unless the Owner decides otherwise.
- **Recheck idempotency**: money safety comes from 13.4's layers (row lock, CAS, unique journal key, unique ledger key, unique notification dedupe). Recheck adds no new money path.

### Architecture compliance

- AD-25 (`architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md:212-280`) covers the mapping table, the single credit path, lock order (TopUpRequest → ledger accounts), "never flag-gated" (l.267), and "every transition writes its notification to the Outbox in the same transaction" (l.263).
- AD-17 (l.168-171): use the `scheduler_job_leases` owner+fencing lease via `ScheduledJob`/`SchedulerRunnerService` only, never `setInterval` in the job. PostgreSQL is the sole claim authority.
- AD-18: job summaries carry counts only, no user ids.
- AD-10/AD-16: Outbox events are written in the transaction, and external calls happen outside transactions.
- NFR-31 (logs): never log the raw body, signature, keys, `counterAccount*`, `checkoutUrl` or the mailbox together with secrets.
- Boundary rule: `test/architecture.spec.ts:7-15`. `application/` must not import `@nestjs/*`, `@prisma/client` or `@payos/*`, and must not contain the text "adapter".

### Library / framework

- No new dependencies. Use NestJS (existing), Prisma (existing), Zod in `@rescom/schemas`, and Jest.
- `@payos/node` 2.0.5 stays confined to the 13.2 adapter. Reuse `PaymentProviderPort.getPayment`/`cancelPayment`; the adapter already sets `maxRetries: 0` and its own logger.
- payOS GET `GET /v2/payment-requests/{orderCode}` returns status, `amountPaid` (cumulative), `amountRemaining` and `transactions[]` (PRD addendum §12 l.360-379). No sandbox exists, so tests use `FakePaymentProvider` (`setPayment`, `failNext('getPayment'|'cancelPayment')`, `cancelCalls`).

### File structure

New files:
- `apps/backend/src/modules/economy/infrastructure/jobs/payos-reconcile.job.ts` (+ `.spec.ts`, `payos-reconcile.lease.spec.ts`)
- `apps/backend/src/modules/economy/infrastructure/top-up-admin-alert.handler.ts` (+ spec)
- `apps/backend/src/modules/economy/application/top-up-admin-alerts.ts`. It is small; put it inline in the service file if that keeps things simpler.
- `packages/schemas/src/common/business-days.ts` (+ spec)
- `apps/backend/test/top-up-payos-recheck.e2e-spec.ts`, `apps/backend/test/top-up-payos-reconcile.prisma.e2e-spec.ts`

Updated files:
- `packages/schemas/src/economy/payos-top-up.schema.ts`, `economy/top-up.schema.ts`, `common/index.ts`
- `apps/backend/src/common/config/env.schema.ts`, `env.service.ts`, `common/scheduler/scheduler.constants.ts`
- economy `application/payos-top-up.service.ts`, `application/ports/payos-top-up-repository.port.ts`, `application/top-up-notification.handler.ts`
- `infrastructure/prisma-payos-top-up.repository.ts`, `in-memory-payos-top-up.repository.ts`, `economy-scheduler.registrar.ts`
- `presentation/admin-top-up.controller.ts`, `economy.module.ts` (factory inject list)
- the deploy env example

**No Prisma migration** is expected: no new enum value (C8), no new column or index. If you find you need one, stop and flag it. The next timestamp would be `20261020100000_*`, and you would mirror it into `post-push-invariants.sql`.

### Testing standards

- Specs sit beside the code. The concurrency/race proof must hit real Postgres (the in-memory repo cannot prove locks).
- Scripts (`apps/backend/package.json`): `npm test`, `npm run test:e2e` (`--runInBand`), `npm run lint`.
- Prisma e2e specs need the DB URL env; see the `requireDb` helper and `test/top-up-payos-webhook.prisma.e2e-spec.ts` for the variable name.
- A local DB with an old 13.1 migration checksum needs `prisma:db-push`, which applies the invariants. See the memory note on `rescom_financial_test`.

### Previous story intelligence (13.3, 13.4)

- 13.4 left these to 13.5 (`13-4-...md:94-101`): reconciliation, PROCESSING→EXPIRED, alerts, `TOPUP_REFUND_MAILBOX`, `RecheckTopUp`, cumulative-mismatch refresh, and alerting on paid closed links. It says "reuses `applySnapshot` unchanged; keep that method transport-agnostic". This story widens only its return type.
- 13.3: a PROCESSING row past expiry stays PROCESSING until 13.5, and it **blocks the user's next checkout** through the partial unique index. Expiry is the user-visible fix here.
- 13.3: a create timeout marks the row CANCELLED, keeps its `orderCode`, and never retries create. The job finds such rows by `orderCode` (deferred-work l.462).
- 13.2 review lesson: one shared helper, no logic duplicated between fake and real.
- 13.4 review patches: warn on an uncreditable verified payment, NO_CHANGE log, skip the GET for SUCCESSFUL/MANUAL_REFUNDED in the webhook.
- Commit pattern: one spec commit plus one feature commit per story branch, then a PR to `develop`.

### Git intelligence

- `8c05738` merges PR #39 (13.4: `e733c45` code, `0552463` spec).
- `a269ea4` is 13.3. `3c3fa84` is 13.2.
- All Epic 13 work is in `apps/backend/src/modules/economy/**`, `packages/schemas/src/economy/**`, and `apps/backend/test/top-up-payos-*.e2e-spec.ts`.

### Owner decisions (Quan, 2026-10-15)

- C7: the Sentry leg is a tagged `logger.error`, and the SDK is left to 11.4. Record this as an AC 4 deviation in Completion Notes.
- C8: the expiry notice reuses `TOPUP_CANCELLED`. No new enum.
- C6: "repeated provider failure" = 3 consecutive all-failed runs.

### Project Structure Notes

- The job lives under `modules/economy/infrastructure/jobs/`, like `starter-expiry.job.ts`. Constants go in `common/scheduler/scheduler.constants.ts`, and the business-day helper goes in shared `@rescom/schemas` `common/`.
- No conflicts with the unified structure.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.5 (l.1857-1873)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-25 (l.212-280), #AD-17 (l.168-171)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md#PayOS flows (l.330-370)]
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#FR-35 (l.585-598), #NFR-32 (l.1292), #NFR-31 (l.1282)]
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/addendum.md#§12 (l.360-379)]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-15.md (l.97-101, TOPUP_REFUND_MAILBOX)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md (l.460-463)]
- [Source: _bmad-output/implementation-artifacts/13-4-payment-webhook-automatic-credit.md#Scope boundary]
- [Source: apps/backend/src/common/scheduler/scheduled-job.ts, scheduler-runner.service.ts, scheduler-runner.service.spec.ts (T2 :282)]
- [Source: apps/backend/src/modules/economy/infrastructure/payos-enable-guard.ts:23-69 (admin fan-out pattern)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created (2026-10-15).

### File List
