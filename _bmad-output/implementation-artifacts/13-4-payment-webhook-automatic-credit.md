# Story 13.4: Payment Webhook & Automatic Credit

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a User,
I want my Points credited the moment PayOS confirms payment,
so that I can use them without waiting.

## Acceptance Criteria

1. **Given** a `PAYOS` top-up and a payOS webhook delivered to `app.rescom.io.vn/api/...` (proxied with the edge key; no cookie, explicit CSRF opt-out, no per-IP throttling) (AD-25), **When** the webhook arrives, **Then** an invalid signature returns 401 and changes nothing; a valid but unknown or duplicate `orderCode` (including the `confirm-webhook` probe) returns 200 with no effect; a processing failure returns 5xx (NFR-31).
2. **And** a valid `code`/`data.code` = `"00"` triggers a server-side GET for the authoritative `amountPaid` and status; `returnUrl` parameters are never treated as proof.
3. **And** a valid signature with `code` or `data.code` ≠ `"00"` returns 200, changes nothing, and is logged; reconciliation (Story 13.5) remains the recovery path.
4. **And** `CreditTopUp` (`topup-credit:{topUpId}`) locks the row `FOR UPDATE`, compare-and-sets the status, writes provider facts and `counterAccount*`, posts `SYSTEM_CLEARING → USER_AVAILABLE` for `amountVnd / 200`, sets `pointsCredited`, and writes the user notification and the user email (top-up Successful) to the Outbox in one transaction (FR-35, FR-57).
5. **And** a full payment on a local `CANCELLED` or `EXPIRED` row still credits and moves it to `SUCCESSFUL` with a notification.
6. **And** `PAID` with another amount or `UNDERPAID` moves the row to `AMOUNT_MISMATCH` with cumulative `amountPaidVnd`, credits nothing, and notifies the user.
7. **And** concurrent and repeated deliveries credit at most once, proven by a concurrency test of two webhooks plus a direct `CreditTopUp` call; `ReverseJournal` on a top-up credit journal is rejected.

## Tasks / Subtasks

- [ ] Task 0: Branch (memory rule) — 13.4 builds on 13.3 code (repository, `ECONOMY_TOPUP_STATUS_CHANGED` event, notification handler), and 13.3 is merged into `develop` (PR #38, `a269ea4`). Branch `feat/13-4-payment-webhook-automatic-credit` was created from `origin/develop` `a269ea4` on 2026-10-15. Before the first edit run `git status --short --branch` and confirm you are on that branch.
- [ ] Task 1: Shared contract (AC: 4, 6) — `packages/schemas/src/economy/payos-top-up.schema.ts` (created by 13.3; extend, don't fork)
  - [ ] Widen `topUpStatusChangedEventSchema.status` from `z.enum(['CANCELLED'])` to `z.enum(['CANCELLED','SUCCESSFUL','AMOUNT_MISMATCH'])`; add optional `amountPaidVnd: z.number().int().nonnegative().optional()` (used by the mismatch notice). Keep `schemaVersion: 1` and the one event type `ECONOMY_TOPUP_STATUS_CHANGED` (EXPIRED joins in 13.5).
  - [ ] Key helpers beside `topUpCancelKey`: `topUpCreditKey(id) = 'topup-credit:' + id` (this is **both** the ledger journal key and the Outbox/notification dedupe key, mirroring how `topup-approval:` is used today) and `topUpMismatchNoticeKey(id, amountPaidVnd) = \`topup-mismatch-notice:${id}:${amountPaidVnd}\``. **Do not** use `topup-mismatch:{id}` — AD-25 reserves it for the Admin `ResolveTopUpMismatch` journal (Story 13.9).
  - [ ] Webhook envelope is validated by the adapter's `verifyWebhook` (13.2), not by a new Zod schema; do not duplicate it.
  - [ ] Append `TOPUP_AMOUNT_MISMATCH` at the **end** of `NOTIFICATION_TYPES` in `packages/schemas/src/notifications/notification.schema.ts` (after 13.3's `TOPUP_CANCELLED`) and of Prisma `enum NotificationType` (migration `ALTER TYPE "NotificationType" ADD VALUE 'TOPUP_AMOUNT_MISMATCH';`, pattern `20261016100000_rewards_my_vouchers_code_issues`). Not in `EMAIL_NOTIFICATION_TYPES` (PRD emails only Successful/Refunded/Refund Rejected). Parity spec `notification-type.parity.spec.ts` enforces equality. FE exhaustive maps in `apps/frontend/my-app/lib/notifications/notification-presentation.ts` get `TOPUP_AMOUNT_MISMATCH: { icon: "bank", tone: "amber", href: "/wallet" }` + title `"Nạp Điểm cần kiểm tra"` so FE typecheck stays green. `TOPUP_SUCCESS` already exists and already emails.
  - [ ] Add `"topup-credit:"` to `ADMIN_LEDGER_FILTER_KEY_PREFIXES["top-up"]` (`packages/schemas/src/admin/admin-ledger.schema.ts:29`) so PayOS credits show under the Admin ledger "Nạp điểm" segment; extend its spec.
- [ ] Task 2: Ledger credit + reversal guard (AC: 4, 7) — `application/ledger.service.ts`
  - [ ] `creditPayosTopUp({ topUpId, userId, points, orderCode })`: clone of `creditApprovedTopUp` (l.2283-2308) with `idempotencyKey: topUpCreditKey(topUpId)`, description `PayOS top-up credit: order ${orderCode} (${points} points)`, entries `SYSTEM_CLEARING −points` / `USER_AVAILABLE +points`. Same positive-integer guard. Do not edit `creditApprovedTopUp`.
  - [ ] Reject `reverseJournal` when the **target** journal's `idempotencyKey` starts with `topup-credit:` → throw `InvalidLedgerOperationException('Top-up credit journals cannot be reversed; use the refund flow.')`. Put the check right after the target lookup (before idempotency/reversal lookups). Also reject when the target is itself a reversal chain rooted at a top-up credit (the credit has no reversal so only the direct case exists; one prefix check on the target is enough). Leave legacy `topup-approval:` behavior unchanged (out of scope, no PRD ask).
  - [ ] `ledger.service.spec.ts`: credit posts once, replay returns same journal, different amount under same key → conflict (existing `postJournal` behavior), reversal rejected with a clear message.
- [ ] Task 3: Repository (AC: 4, 5, 6, 7) — extend the 13.3 `PayosTopUpRepositoryPort` + `prisma-payos-top-up.repository.ts` + `in-memory-payos-top-up.repository.ts`
  - [ ] `findByOrderCode(orderCode): Promise<PayosTopUp | null>` (PAYOS only; include `paymentLinkId`, `amountVnd`, `points`, `status`, `userId`). Plain read, no lock.
  - [ ] `lockForUpdate(id): Promise<PayosTopUp | null>` — `SELECT id FROM top_up_requests WHERE id = $1::uuid AND channel = 'PAYOS' FOR UPDATE` inside the caller's UoW, then read (pattern `prisma-top-up.repository.ts:findByIdForUpdate`). Lock order: TopUpRequest row first, ledger accounts after (AD-25).
  - [ ] `markSuccessful(id, { journalId, pointsCredited, facts, verifiedAt }, outboxEvent)`: one `updateMany WHERE id AND channel='PAYOS' AND status IN ('PROCESSING','CANCELLED','EXPIRED','AMOUNT_MISMATCH')` setting `status 'SUCCESSFUL'`, `journalId`, `pointsCredited`, `amountPaidVnd = facts.amountPaidVnd`, `providerReference`, `paidAt = facts.paidAt ?? verifiedAt`, and each `counterAccount*` as **first non-null wins** (keep the existing column value when already set; set from `facts` only when the column is null). `cancelledAt` is left untouched (audit). Count 0 → return `{ changed: false }` (no Outbox row). Count 1 → `tx.outboxEvent.create` (shape `prisma-top-up.repository.ts:163-178`) in the same transaction → `{ changed: true }`.
  - [ ] `markAmountMismatch(id, { facts, verifiedAt }, outboxEvent)`: CAS `status IN ('PROCESSING','CANCELLED','EXPIRED')` → `AMOUNT_MISMATCH`, `amountPaidVnd = facts.amountPaidVnd` (the cumulative provider value), `providerReference`, `paidAt = facts.paidAt ?? verifiedAt`, counter facts first-non-null-wins. No journal, `pointsCredited` stays null. Outbox event same tx. A row already `AMOUNT_MISMATCH` or `SUCCESSFUL` → `{ changed: false }` (cumulative refresh and mismatch→credit by Admin are 13.5/13.9).
  - [ ] In-memory implementation mirrors every rule above, including the CAS status sets and first-non-null counter facts.
- [ ] Task 4: Service (AC: 2–7) — `application/payos-top-up.service.ts` (extend 13.3's `PayosTopUpService`, or a sibling `PayosCreditService` if the class gets large; plain class, no `@nestjs/*`, no word "adapter" in `application/`)
  - [ ] New deps go into the existing `options` object (13.3 constructor `payos-top-up.service.ts:28`): `unitOfWork: UnitOfWorkPort` (`PassThroughUnitOfWork` in specs), `ledgerService`. Widen `logger: Pick<Console, 'warn'>` to `Pick<Console, 'log' | 'warn'>`. Update the factory in `economy.module.ts` (~l.169 `inject: [PAYOS_TOP_UP_REPOSITORY_PORT, PAYMENT_PROVIDER_PORT, EnvService]`) to inject the UoW and `LedgerService` too.
  - [ ] `handleWebhook(rawBody: unknown): Promise<{ outcome: 'IGNORED' | 'APPLIED' }>`:
    1. `provider.verifyWebhook(rawBody)` — throws `PaymentProviderSignatureError` for bad signature **or** malformed envelope → let it propagate (controller → 401). Nothing else runs before this succeeds (no DB read).
    2. `findByOrderCode(verified.orderCode)`; null → `logger.log('payOS webhook for unknown order', { orderCode })`, return `IGNORED` (this covers the `confirm-webhook` probe, whose orderCode is not a row). Row has `paymentLinkId` set and ≠ `verified.paymentLinkId` → `logger.warn`, `IGNORED` (a mismatched link is not our payment). `paymentLinkId` null (create outcome unknown, row was cancelled) is accepted.
    3. `verified.code !== '00' || verified.dataCode !== '00'` → `logger.log('payOS webhook non-success code', { orderCode, code, dataCode })`, `IGNORED`. Never credit from the webhook body: `amountVnd` in the body is only a hint.
    4. **Outside any transaction** (no lock across HTTP, AD-16): `snapshot = await provider.getPayment(orderCode, row.amountVnd)`. It throws `PaymentProviderUnavailableError` → propagate (controller → 503; payOS retries, reconciliation recovers).
    5. `applySnapshot(row, snapshot)` (below).
  - [ ] `applySnapshot(topUpId, snapshot)` — public, reused verbatim by 13.5 reconciliation and `RecheckTopUp`; map `snapshot.effect`:
    - `CREDIT` → `creditTopUp`.
    - `AMOUNT_MISMATCH` → `recordMismatch`.
    - `NO_CHANGE` → log, `IGNORED` (payOS may lag a `00` webhook; reconciliation recovers).
    - `CANCELLED` / `EXPIRED` → `IGNORED`, **but** if `snapshot.facts.amountPaidVnd > 0` `logger.warn('payOS reports paid amount on a cancelled/expired link', { orderCode, providerStatus })` (the 13.2 deferral; 13.5 turns this into an alert — do not invent an alert here).
  - [ ] `creditTopUp(topUpId, snapshot)`: `unitOfWork.run(topUpCreditKey(id), async () => { row = lockForUpdate(id); if !row → IGNORED; if row.status === 'SUCCESSFUL' → return replay (no-op); if status ∉ {PROCESSING, CANCELLED, EXPIRED, AMOUNT_MISMATCH} → IGNORED (MANUAL_REFUNDED etc.); journal = ledgerService.creditPayosTopUp({ topUpId, userId, points: row.amountVnd / POINT_VND_RATE, orderCode }); res = markSuccessful(…, outboxEvent); if (!res.changed) → IGNORED })`.
    - Outbox event: `{ id: uuid, idempotencyKey: topUpCreditKey(id), eventType: TOP_UP_STATUS_CHANGED_EVENT_TYPE, producer: 'economy-service', aggregateType: 'TopUpRequest', aggregateId: id, aggregateVersion: 3, payload: { schemaVersion: 1, topUpId, userId, orderCode, amountVnd, points, status: 'SUCCESSFUL', occurredAt } }`. (13.3 cancel uses version 2; one transition per row after PROCESSING except late payment, which is the only second one and has its own idempotency key, so versions do not collide.)
    - Points = `row.amountVnd / 200` — **never** `facts.amountPaidVnd / 200` and never the webhook amount. `CREDIT` already means `amountPaid === row.amountVnd` (adapter `mapPaymentLink`).
    - No `unitOfWork` swallow: any throw rolls the whole transaction back and propagates → 5xx.
  - [ ] `recordMismatch(topUpId, snapshot)`: `unitOfWork.run(\`topup-mismatch-record:${id}\`, …)` → lock → `markAmountMismatch` with event `{ …, status: 'AMOUNT_MISMATCH', amountPaidVnd: facts.amountPaidVnd }`, event `idempotencyKey: topUpMismatchNoticeKey(id, facts.amountPaidVnd)`. Row not in {PROCESSING, CANCELLED, EXPIRED} → `IGNORED`.
  - [ ] Logging: ids, `orderCode`, provider `code`, status only. Never the raw body, `signature`, `counterAccount*` (account numbers are PII/financial), `checkoutUrl`, or keys (NFR-31).
- [ ] Task 5: Notification handler (AC: 4, 6) — extend 13.3's `application/top-up-notification.handler.ts`
  - [ ] Branch on `event.status`: `CANCELLED` (unchanged); `SUCCESSFUL` → publish `{ userId, type: 'TOPUP_SUCCESS', message: \`Nạp ${vnd} VNĐ thành công: ${points} Điểm đã được cộng vào số dư Khả dụng.\`, dedupeKey: event.idempotencyKey }`; `AMOUNT_MISMATCH` → `{ type: 'TOPUP_AMOUNT_MISMATCH', message: \`Giao dịch nạp ${vnd} VNĐ (mã ${orderCode}) nhận ${paid} VNĐ, khác số tiền yêu cầu. Chưa có Điểm nào được cộng; Admin sẽ xem xét trong 3 ngày làm việc.\`, dedupeKey }`. Format VNĐ with `vi-VN` grouping.
  - [ ] **Email:** the notification repository already writes the `NotificationEmailRequested` Outbox row in the same transaction as the notification for any `isEmailNotificationType` (`prisma-notification.repository.ts:71-95`), so `TOPUP_SUCCESS` emails with no extra code. But the template `email-templates.ts:91-100` says "Yêu cầu nạp điểm của bạn **đã được duyệt**", which is wrong for PayOS. Change that one paragraph to channel-neutral copy ("Điểm đã được cộng vào số dư Khả dụng của bạn.") and update `email-templates.spec.ts`; leave subject/heading/link. Manual approvals keep working with the neutral text.
  - [ ] Atomicity: credit + Outbox event commit together in `creditTopUp` (the AC); the notification row and its email request are created when the dispatcher runs the handler inside its own transaction (kind (a)), and are replay-safe via `(userId, dedupeKey)`. A crash between credit and dispatch loses nothing — the event row is durable.
  - [ ] Do **not** also call `notificationPublisher.publish` from the service (would duplicate `TOPUP_SUCCESS` under a different dedupe key).
- [ ] Task 6: Webhook controller (AC: 1–3) — `presentation/payos-webhook.controller.ts`
  - [ ] `@Controller(['economy/top-ups/payos', 'api/economy/top-ups/payos'])` with **only** `@Post('webhook')`, `@HttpCode(200)`. Resulting public URL: `https://app.rescom.io.vn/api/economy/top-ups/payos/webhook` (Next rewrites `/api/:path*` → backend `/:path*`, `next.config.ts:14-18`, so the backend sees `/economy/top-ups/payos/webhook`). **This is the URL 13.6 registers** with `confirm-webhook`; state it in Completion Notes. Separate from 13.3's `payos-top-up.controller.ts`: that class is `@UseGuards(SessionAuthGuard)` at class level and must stay session-only.
  - [ ] No `SessionAuthGuard`, no `CsrfGuard` (explicit opt-out: put a comment `// signature is the only auth; no cookie, no CSRF`), no `PayosCheckoutEnabledGuard` (webhook is never flag-gated, AD-25), no `@Public()` needed unless the global auth requires it (`AppThrottlerGuard` is the only `APP_GUARD`; verify).
  - [ ] `@SkipThrottle({ default: true, auth: true })` (pattern `common/system/health.controller.ts:32`): the throttler tracks by IP and every request arrives from the Vercel proxy; payOS retries must not 429. Add an e2e that fires > the default limit of webhooks and still gets 200.
  - [ ] `@UseGuards(JsonOnlyGuard)` is acceptable (payOS posts `application/json`); body is taken as `@Body() body: unknown` — **no** `ZodValidationPipe` and no `ValidationPipe`, because the signature must be checked on exactly what was sent and a validation 400 would be a retry storm. Malformed body → adapter signature error → 401.
  - [ ] Map: `PaymentProviderSignatureError` → 401 `PAYOS_WEBHOOK_SIGNATURE_INVALID` (body message generic, no detail); `IGNORED`/`APPLIED` → 200 `{ received: true }`; `PaymentProviderUnavailableError` and any other error → 5xx (let Nest's 500 / the filter's 503 mapping stand; never swallow). Add the two mappings to `common/http/http-exception.filter.ts` near the top-up block, with spec; no provider text in messages.
  - [ ] Register controller in `economy.module.ts`; the service dependency is the already-bound `PayosTopUpService`. Webhook works with `PAYOS_ENABLED=false` (13.3 left adapter wiring ungated). When payOS keys are missing, `PAYMENT_PROVIDER_PORT` (~l.228) binds `UnconfiguredPaymentProvider`, whose `verifyWebhook` rejects with `PaymentProviderUnavailableError` → 503. That is correct (no checksum key = cannot verify); assert it in the e2e.
  - [ ] Ingress facts to **verify, not change**: `proxy.ts` already adds `x-rescom-edge-key` to any `/api/*` request and drops forged `x-rescom-*`; Caddy rule unchanged (AD-23). The webhook carries no `Origin`; `CsrfGuard`'s `requireOrigin` therefore must not be on this route.
- [ ] Task 7: Tests
  - [ ] `application/payos-top-up.service.spec.ts` (extend; in-memory repo + `FakePaymentProvider` + in-memory ledger; `FakePaymentProvider.setPayment` seeds the GET answer; build signed bodies with `payosDataSignature` from `infrastructure/payos-mapping.ts`): valid `00` webhook + GET `PAID` full → row `SUCCESSFUL`, `pointsCredited = amountVnd/200`, one journal `topup-credit:{id}` `SYSTEM_CLEARING → USER_AVAILABLE`, provider facts + `counterAccount*` stored (and `null` counter account stays null), one Outbox event; webhook body `amount` ≠ row amount but GET says full → credits by row amount; bad signature / tampered `amount` / non-object / missing `signature` → `PaymentProviderSignatureError`, repo untouched, `getCalls` zero; unknown `orderCode` → `IGNORED`, no GET; link id mismatch → `IGNORED`; `code='01'` or `data.code='01'` → `IGNORED`, no GET; GET `PENDING` → `IGNORED`; GET throws → rejects, row unchanged; late payment on `CANCELLED` and on `EXPIRED` → `SUCCESSFUL` + event; `PAID` other amount and `UNDERPAID` → `AMOUNT_MISMATCH` with cumulative `amountPaidVnd`, no journal, `pointsCredited` null, event with `topup-mismatch-notice:{id}:{amount}` key; GET `CANCELLED`/`EXPIRED` with `amountPaid > 0` → no change + warn; row already `SUCCESSFUL` → no second journal/event; row `AMOUNT_MISMATCH` + GET full `PAID` → `SUCCESSFUL`; `MANUAL_REFUNDED` row → ignored.
  - [ ] `application/top-up-notification.handler.spec.ts` (extend): `SUCCESSFUL` → `TOPUP_SUCCESS` with dedupe = `topup-credit:{id}`; `AMOUNT_MISMATCH` → `TOPUP_AMOUNT_MISMATCH`; invalid payload → `OutboxPayloadInvalidError`.
  - [ ] `test/top-up-payos-webhook.e2e-spec.ts` (HTTP, in-memory repos, `overrideProvider(PAYMENT_PROVIDER_PORT).useValue(fake)`; pattern `test/top-up.e2e-spec.ts`): signed valid body → 200 and Wallet balance credited once; replay of the same body → 200, balance unchanged; wrong signature → 401; unknown order (probe-like) → 200; works with **no cookie and no CSRF header and no Origin**; works at both `/economy/top-ups/payos/webhook` and `/api/economy/top-ups/payos/webhook`; works with `PayosAvailability` closed; 100+ sequential webhooks are not throttled; provider `getPayment` failure → 503.
  - [ ] `test/top-up-payos-webhook.prisma.e2e-spec.ts` (real DB, `test/fixtures/financial-pg-harness`, pattern `test/top-up-payos-schema.prisma.e2e-spec.ts`; skipped without the harness, required in CI via `requireDb`): **concurrency** — `Promise.all([webhook, webhook, creditTopUp direct])` on one `PROCESSING` row → exactly one `journals` row with key `topup-credit:{id}`, user `USER_AVAILABLE` +points exactly once, one `ECONOMY_TOPUP_STATUS_CHANGED` Outbox row, one `SUCCESSFUL`; late payment on a `CANCELLED` row credits once; mismatch writes no journal; `reverseJournal` on the credit journal rejects; Outbox event is rolled back when the ledger post fails (simulate by pre-creating a conflicting journal).
  - [ ] Dispatch round-trip (in-memory outbox registry or the existing dispatcher test util): event → handler → notification created; for `TOPUP_SUCCESS` an email-request is produced (assert via the notifications in-memory repo / email delivery test double).
  - [ ] Regression: `top-up.service.spec.ts`, `top-up.e2e-spec.ts`, `prisma-top-up.repository.spec.ts`, `notification-type.parity.spec.ts`, `email-templates.spec.ts`, `admin-ledger.schema` spec, `test/architecture.spec.ts` (no `@nestjs`/`@payos`/"adapter" in new `application/` code), `http-exception.filter.spec.ts`, 13.3 checkout/cancel specs.
  - [ ] Run: `npm test --workspace backend -- payos top-up ledger notification email architecture http-exception`; full `npm test --workspace backend`; `npm run test:e2e --workspace backend -- top-up`; `npm run build --workspace backend`; `npm run lint --workspace backend`; `npm test --workspace @rescom/schemas`; FE typecheck/build in `apps/frontend/my-app` (only the presentation map changed).

## Dev Notes

### Scope boundary (read first)

13.4 delivers the webhook endpoint, the verified GET-then-credit path (`CreditTopUp`), the mismatch recording path, late-payment crediting, the credit-journal reversal ban, and the success/mismatch notices (+ success email). Out of scope:
- Reconciliation job, `PROCESSING → EXPIRED`, admin alerts, `TOPUP_REFUND_MAILBOX`, `RecheckTopUp`, cumulative-mismatch refresh, alerting on `amountPaid > 0` for cancelled/expired links → **13.5** (it reuses `applySnapshot` unchanged; keep that method transport-agnostic).
- `confirm-webhook` CLI, setup checklist, live fixtures → **13.6** (it needs the URL fixed here).
- `ResolveTopUpMismatch` (Admin credit/refund of a mismatch, key `topup-mismatch:{id}`) → **13.9**. Do not build a mismatch→credit Admin path.
- Wallet/Admin screens → **13.7/13.8**. Refund hold/withdrawal → **13.10**.
- The cancel path (13.3) is unchanged; a user who cancelled and then pays still lands here through the `CANCELLED → SUCCESSFUL` branch.

### Flow (AD-25 Single credit path)

```
POST /economy/top-ups/payos/webhook   (via app.rescom.io.vn/api/..., edge key added by proxy.ts)
 ├ no session / CSRF / throttle; JSON body as-is
 ├ provider.verifyWebhook(body)        → bad signature / malformed → 401, nothing else runs
 ├ findByOrderCode                     → unknown (probe) or linkId mismatch → 200 no-op
 ├ code / data.code != "00"            → 200 no-op + log
 ├ provider.getPayment(orderCode, row.amountVnd)   (outside any tx; failure → 5xx)
 └ applySnapshot(effect)
     CREDIT           → tx: lock row FOR UPDATE → CAS {PROCESSING,CANCELLED,EXPIRED,AMOUNT_MISMATCH}→SUCCESSFUL
                           + ledger SYSTEM_CLEARING→USER_AVAILABLE (topup-credit:{id}) + Outbox ECONOMY_TOPUP_STATUS_CHANGED
     AMOUNT_MISMATCH  → tx: lock → CAS {PROCESSING,CANCELLED,EXPIRED}→AMOUNT_MISMATCH + Outbox (no journal)
     NO_CHANGE / CANCELLED / EXPIRED → 200 no-op
```

Lock order: `TopUpRequest` row → ledger accounts (ascending id, handled inside `postJournal`). Never hold the row lock across the payOS GET.

### Contracts you call (13.2, `application/ports/payment-provider.port.ts`, `infrastructure/payos-mapping.ts`)

- `verifyWebhook(body)` → `{ orderCode, paymentLinkId, code, dataCode, amountVnd, facts }`; throws `PaymentProviderSignatureError` for bad HMAC **and** any malformed envelope. HMAC is over `data` with sorted keys (`payosDataSignature`), constant-time compare. Webhook-body `facts` come from `data` only; the credit uses the GET snapshot's `facts`, not the webhook's.
- `getPayment(orderCode, expectedAmountVnd)` → `{ effect: 'CREDIT'|'AMOUNT_MISMATCH'|'NO_CHANGE'|'CANCELLED'|'EXPIRED', providerStatus, facts }`. `facts.paidAt` is `transactionDateTime` parsed as `Asia/Ho_Chi_Minh` → UTC (null when payOS sent none → use verification time). Throws `PaymentProviderUnavailableError`.
- `FakePaymentProvider.setPayment(orderCode, { orderCode, status, amountPaid, transactions })` drives tests; `failNext('getPayment' | 'verifyWebhook')`. Add call recording for `getPayment` to the fake only if missing (small, test-only).
- The raw payOS webhook envelope shape (`code`, `desc`, `success`, `data{ orderCode, amount, description, accountNumber, reference, transactionDateTime, currency, paymentLinkId, code, desc, counterAccount* }`, `signature`) is covered by the 13.2 contract spec (`payos-payment-provider.contract.spec.ts`); reuse its fixture builders.

### Current state of files touched

- `application/ledger.service.ts` — `creditApprovedTopUp` (l.2283) is the template; `reverseJournal` (l.531) has no top-up-specific rule today. Journal key prefixes are plain strings; `ADMIN_LEDGER_FILTER_KEY_PREFIXES` `"top-up": ["topup-approval:"]` must gain `topup-credit:` or PayOS credits fall into "Tất cả" only.
- `application/top-up.service.ts` — manual `approveTopUp` (l.214) shows the UoW + lock + journal + CAS + Outbox shape. **Unchanged**; the manual repository filters `channel: 'MANUAL'` everywhere, so PayOS rows are invisible to it. The manual notice is a direct `publish` after commit; the PayOS notice goes through the Outbox on purpose (AD-25: "Every transition … writes its user notification to the Outbox in the same transaction").
- `application/top-up-notification.handler.ts` + `economy-scheduler.registrar.ts` handler registration — created by 13.3 for `CANCELLED`; extend, don't re-register.
- `common/security/app-throttler.guard.ts` — tracks `req.ip` when there is no valid cookie; behind the Vercel proxy that is a shared IP, hence `@SkipThrottle`. `security.module.ts` defines `default` and `auth` throttlers; skip both.
- `presentation/payos-top-up.controller.ts` (13.3) — session-guarded; do **not** add the webhook there.
- `notifications/application/email-templates.ts` l.91-100 — manual-approval wording to neutralize.
- `common/http/http-exception.filter.ts` — instanceof chain; maps **neither** provider error today (13.3 catches `PaymentProviderUnavailableError` inside the service and logs `error.providerCode`). Add `PaymentProviderSignatureError` → 401 and `PaymentProviderUnavailableError` → 503, generic messages only.

### Guardrails

- Never credit from the webhook body, the `returnUrl`, or any client call. The only proof is a verified signature **plus** a server-side GET whose effect is `CREDIT`.
- Idempotency is layered: advisory ordering by row lock, status CAS (`updateMany` count 0 = no-op), unique `journalId`, unique ledger `idempotencyKey`, and unique `(userId, dedupeKey)` on notifications. The concurrency test must hit the real DB; the in-memory repo cannot prove it.
- Status CAS never moves `SUCCESSFUL` or `MANUAL_REFUNDED`; `AMOUNT_MISMATCH` only moves to `SUCCESSFUL` here via a **full** verified payment.
- First-non-null-wins for `counterAccount*` is a per-column rule (AD-25), not all-or-nothing; the paying account facts feed refunds (13.10), so never overwrite a stored value.
- Webhook must not 4xx on anything except a bad signature: payOS treats non-2xx as failure and retries; unknown/duplicate/non-`00` are all 200. A genuine processing failure is 5xx so payOS retries and reconciliation covers the rest.
- No raw body, signature, account numbers, or keys in logs, Sentry breadcrumbs, or error messages.
- `application/` files: no `@nestjs/*`, `@prisma/client`, `@payos/*`, and not the word "adapter" even in comments (`test/architecture.spec.ts:7-15`).
- Points are integers; `amountVnd / 200` is exact (DB CHECK `amount * 200 = amount_vnd`). `pointsCredited` CHECK requires `> 0`.
- The 13.1 `channel_shape_check` only requires `order_code` and `expires_at` for PAYOS; nothing forces `paid_at`/`journal_id`, so the status flip and the facts are written in one `UPDATE` — keep them together.
- `payos-top-up.controller.ts` guard order from 13.3 is unaffected, but confirm `GET /economy/top-ups/payos/availability` and `/:id` do not shadow `POST /…/webhook` (different method, literal path first).

### Previous story intelligence

- **13.3** (done, merged PR #38 `a269ea4`): introduces `PayosTopUpRepositoryPort` (`createProcessing`, `attachPaymentLink`, `markCancelled`, `findOwned`, `countManualPending`), `ECONOMY_TOPUP_STATUS_CHANGED` / `topUpStatusChangedEventSchema` (explicitly "13.4/13.5 widen the `status` enum — keep it one event type"), `topUpCancelKey` (`packages/schemas/src/economy/payos-top-up.schema.ts:8`; `topUpCreditKey`/`topUpMismatchNoticeKey` do **not** exist yet — Task 1 adds them), the Outbox handler + registrar hook, `TOPUP_CANCELLED`, the `PayosAvailability` flag, and `PaymentProviderPort` binding **not gated on `PAYOS_ENABLED`** (so the webhook works with the flag off). If a name differs after 13.3 review, follow 13.3's merged code, not this text.
- **13.2** (done): the deferrals handed forward — `paymentFacts` uses the last `transactions[]` element for `providerReference`/`paidAt` (verify ordering in 13.6, no action here); `CANCELLED`/`FAILED`/`EXPIRED` map to no-credit **even if `amountPaid > 0`** (decided by Quan 2026-10-15) → this story only warns, 13.5 alerts/routes to the refund mailbox. Review lesson: one shared helper, no logic duplicated between fake and real adapter; test the selection paths.
- **13.1** (done): CHECKs and the one-`PROCESSING`-per-user index; the credit path never touches that index except by leaving `PROCESSING`.
- Both: fill "Agent Model Used" in the Dev Agent Record.

### Git intelligence

Recent: `bdb53b0` 13.3 (checkout, cancel, enable guard, first `ECONOMY_TOPUP_STATUS_CHANGED` producer, cancel event `aggregateVersion: 2` at `payos-top-up.service.ts:153`), `7ecb9ea` 13.2 (port, adapter, fake, config), `0b84f30` 13.1 (schema). Pattern: story branch → one feature commit → PR merge into `develop`; backend-only stories add Jest specs next to code, DB-backed specs under `test/*.prisma.e2e-spec.ts`. No new dependency is needed for 13.4.

### Testing standards

- Jest unit specs co-located; HTTP e2e in `test/*.e2e-spec.ts` with in-memory repos; DB-backed in `test/*.prisma.e2e-spec.ts` (skipped when the financial PG harness is unavailable, required in CI via `requireDb`).
- **No test calls real payOS** (no sandbox; real money). Always override `PAYMENT_PROVIDER_PORT` with `FakePaymentProvider`; sign fixture webhooks with the test checksum key.

### Project Structure Notes

- New/changed backend files: `application/ledger.service.ts` (+spec), `application/payos-top-up.service.ts` (+spec), `application/top-up-notification.handler.ts` (+spec), `application/ports/payos-top-up-repository.port.ts`, `infrastructure/prisma-payos-top-up.repository.ts`, `infrastructure/in-memory-payos-top-up.repository.ts`, `presentation/payos-webhook.controller.ts`, `economy.module.ts`, `common/http/http-exception.filter.ts` (+spec), `notifications/application/email-templates.ts` (+spec); migration `<timestamp>_notification_type_topup_amount_mismatch` (after 13.3's `20261018100000`, e.g. `20261019100000`); schemas `payos-top-up.schema.ts`, `notification.schema.ts`, `admin-ledger.schema.ts`; Prisma `schema.prisma` enum; FE `notification-presentation.ts`.
- Naming follows `prisma-*`, `in-memory-*`, `*.port.ts`, `*.controller.ts`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.4] (l.1839-1855), Epic 13 intro (l.1781-1783)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-25] — Single credit path, Proof and mapping table, Webhook HTTP results, Webhook ingress, state diagram (l.212-280)
- [Source: .../solution-design.md#PayOS Top-Up and Refund Flows] (l.295-370)
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md] FR-35, FR-57, FR-76, NFR-31
- [Source: _bmad-output/implementation-artifacts/13-3-top-up-checkout-user-cancel-enable-guard.md], [13-2-payment-provider-port-payos-adapter.md], [13-1-top-up-schema-for-payos.md], `deferred-work.md` (13.2 section)
- Code: `economy/application/top-up.service.ts:214` (approve template), `ledger.service.ts:2283`, `payos-mapping.ts`, `apps/frontend/my-app/proxy.ts`, `next.config.ts:14-18`, `common/security/app-throttler.guard.ts`

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
