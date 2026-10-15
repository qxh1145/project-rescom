---
baseline_commit: 3c3fa84
---
# Story 13.3: Top-Up Checkout, User Cancel & Enable Guard

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a User,
I want to start a PayOS top-up for an exact amount and cancel it if I change my mind,
so that I can pay by QR without waiting for an Admin.

## Acceptance Criteria

1. **Given** `PAYOS_ENABLED=true` and no manual `PENDING` row existed at startup, **When** the user posts a checkout amount, **Then** amounts below 10,000, above 5,000,000, or not a multiple of 200 VNĐ are rejected with a field error before any payOS call (FR-34).
2. **And** the server computes Points = amount ÷ 200; any client-supplied Points value is ignored.
3. **And** the `PROCESSING` row commits before `paymentRequests.create`; on success `paymentLinkId` is stored and `checkoutUrl` returned; on create failure the row moves to `CANCELLED` and the user sees a retryable error (AD-25).
4. **And** a second checkout while one is `PROCESSING` returns 409 with the existing top-up id.
5. **And** the owner can cancel their `PROCESSING` top-up: payOS cancel is called through the port, the row becomes `CANCELLED`, the user notification is written to the Outbox, and a new checkout is allowed at once; cancelling another user's top-up returns 404 (FR-76).
6. **And** if the payOS cancel call fails or times out, the row still becomes `CANCELLED` locally, the failure is logged, and a later full payment is credited through the existing late-payment path (FR-35, AD-25).
7. **And** checkout is limited per user (5 checkouts per 10 minutes, configurable); excess requests return 429 before any payOS call (NFR-7).
8. **And** if any `MANUAL` `PENDING` row exists at startup, the process still starts with PayOS effectively off (checkout closed, manual submission open), raises an Admin alert and an error log, and turns PayOS on only after a restart with no `PENDING` rows (FR-79, AD-25).
9. **And** with PayOS effectively off, checkout returns 404/feature-disabled and the manual flow behaves exactly as before.
10. **And** a pre-deploy script prints the count of `MANUAL` `PENDING` rows and exits non-zero when any exist.

## Tasks / Subtasks

- [x] Task 0: Branch (memory rule) — already created: `feat/13-3-top-up-checkout-user-cancel-enable-guard` from `origin/develop` (3c3fa84, 13.2 merged), upstream unset. Verify with `git status --short --branch` before the first edit.
- [x] Task 1: Migration + Prisma (AC: 3, 5) — `apps/backend/prisma/migrations/20261018100000_top_up_payos_checkout/migration.sql` + `schema.prisma`
  - [x] `ALTER TABLE "top_up_requests" ADD COLUMN "checkout_url" TEXT;` → Prisma `checkoutUrl String? @map("checkout_url")` next to `paymentLinkId`. Needed so the 409 / `GET :id` response can offer "Tiếp tục thanh toán" (UX-DR-P4) without calling payOS. Never treat it as payment proof.
  - [x] `ALTER TYPE "NotificationType" ADD VALUE 'TOPUP_CANCELLED';` (pattern: `20261016100000_rewards_my_vouchers_code_issues`) → append `TOPUP_CANCELLED` at the **end** of Prisma `enum NotificationType` and of `NOTIFICATION_TYPES` in `packages/schemas/src/notifications/notification.schema.ts` (append-only; parity spec `notification-type.parity.spec.ts` enforces equality). Do **not** add it to `EMAIL_NOTIFICATION_TYPES` (PRD emails only Successful/Refunded/Refund Rejected).
  - [x] Frontend type safety: `apps/frontend/my-app/lib/notifications/notification-presentation.ts` has exhaustive `Record<NotificationType, …>` maps (l.21, l.88). Add `TOPUP_CANCELLED: { icon: "bank", tone: "amber", href: "/wallet" }` and title `"Giao dịch nạp Điểm đã huỷ"` so the FE typecheck stays green. Nothing else on the FE (screens = 13.7).
  - [x] No other schema change (13.1 already has `orderCode`, `paymentLinkId`, `expiresAt`, `cancelledAt`, CHECKs, partial unique index `top_up_requests_one_processing_per_user`, sequence `top_up_order_code_seq`).
- [x] Task 2: Shared contract (AC: 1, 2, 4, 5) — new `packages/schemas/src/economy/payos-top-up.schema.ts`, export from `economy/index.ts`
  - [x] Constants: `PAYOS_TOP_UP_MIN_VND = 10_000`, `PAYOS_TOP_UP_MAX_VND = 5_000_000`, `PAYOS_TOP_UP_EXPIRY_MS = 5 * 60_000`; reuse existing `POINT_VND_RATE` (200) from `top-up.schema.ts` — do not redefine it.
  - [x] `payosCheckoutSchema = z.object({ amountVnd: z.number().int().min(MIN).max(MAX).refine(v => v % POINT_VND_RATE === 0, …) })` — **not** `.strict()` (default strip), so a client `points`/`amount` key is dropped, not rejected (AC2). Error messages name the bound. Field name `amountVnd` (the manual schema's `amount` means Points — never mix them).
  - [x] `payosTopUpStatusSchema = z.enum(['PROCESSING','SUCCESSFUL','CANCELLED','EXPIRED','AMOUNT_MISMATCH','MANUAL_REFUNDED'])` (channel CHECK from 13.1).
  - [x] `payosTopUpSchema` (owner DTO): `id`, `orderCode`, `amountVnd`, `points`, `status`, `checkoutUrl` (string | null; **null unless status is `PROCESSING`**), `expiresAt`, `cancelledAt`, `paidAt`, `createdAt` (ISO strings / null). No `counterAccount*`, no `paymentLinkId`, no provider facts beyond `paidAt` (refund/masking rules are 13.10/13.11).
  - [x] `payosCheckoutResultSchema = { topUp: payosTopUpSchema, checkoutUrl: string }`.
  - [x] `payosAvailabilitySchema = { payosEnabled: boolean }` (13.7 needs it to decide manual form vs checkout).
  - [x] Outbox payload `topUpStatusChangedEventSchema` (schemaVersion 1): `{ topUpId, userId, orderCode, amountVnd, points, status: z.enum(['CANCELLED']), occurredAt }` + `TOP_UP_STATUS_CHANGED_EVENT_TYPE = 'ECONOMY_TOPUP_STATUS_CHANGED'`. 13.4/13.5 widen the `status` enum (SUCCESSFUL/EXPIRED/AMOUNT_MISMATCH) — keep it one event type.
  - [x] Key helpers next to `topUpApprovalKey`: `topUpCancelKey(id) = 'topup-cancel:' + id`.
  - [x] Spec `payos-top-up.schema.spec.ts`: 9,999 / 10,000 / 5,000,000 / 5,000,200 / 10,100 (not ×200) / 10.5 / `"10000"` string; `{ amountVnd: 10000, points: 999999 }` parses to `{ amountVnd: 10000 }`.
- [x] Task 3: Availability state (AC: 8, 9) — `apps/backend/src/modules/economy/application/payos-availability.ts`
  - [x] Plain class (no Nest decorators — `test/architecture.spec.ts` forbids `@nestjs/` in `application/`): `isCheckoutOpen(): boolean` (default **false**) and `open()`. One instance per process; no runtime toggle API (B4 is read-only; no UI toggle).
  - [x] `infrastructure/payos-enable-guard.ts` — `@Injectable() implements OnApplicationBootstrap` (runs after Prisma `onModuleInit` connected):
    - `env.payosEnabled === false` → stay closed, no log noise.
    - true → `count = repository.countManualPending()` (global, all users). `count === 0` → `availability.open()` + `logger.log('PayOS checkout enabled')`. `count > 0` → stay closed, `logger.error(\`PAYOS_ENABLED=true but ${count} manual PENDING top-up(s) exist; PayOS stays off until a restart with none\`)`, and publish one `WARNING` notification to every ACTIVE ADMIN (`adminCapability.listActiveAdminIds()`, new port method, Task 6) with message `"PayOS chưa bật: còn N yêu cầu nạp thủ công đang chờ duyệt. Duyệt/từ chối hết rồi khởi động lại backend."`, dedupe key `payos-enable-blocked:{YYYY-MM-DD UTC}` (a crash loop does not spam).
    - If the count query itself throws, stay closed and `logger.error` — **never** crash startup (AD-25 2026-10-15 amendment: refusing startup takes prod down).
    - The decision is made once per process; resolving the PENDING rows later does **not** open checkout until restart (AC8). Do not re-check per request.
  - [x] `presentation/payos-checkout-enabled.guard.ts` — `if (!availability.isCheckoutOpen()) throw new NotFoundException();` (pattern: `rewards/presentation/rewards-enabled.guard.ts`).
  - [x] Manual submission off when PayOS is effectively on (AD-25 "Flag on turns checkout on and manual submission off"): guard **only** `POST /economy/top-ups` (manual create) with the inverse check → 404 when `isCheckoutOpen()`. `GET` list and Admin approve/reject (`admin-top-up.controller.ts`) stay untouched (AD-25: approve/reject stays until no PENDING; 13.13 retires UI).
- [x] Task 4: Repository (AC: 3, 4, 5, 7) — `application/ports/payos-top-up-repository.port.ts` + `infrastructure/prisma-payos-top-up.repository.ts` + `infrastructure/in-memory-payos-top-up.repository.ts`
  - [x] Separate port from the manual `TopUpRepositoryPort` (its `toEntity` throws on non-MANUAL rows and every query filters `channel: 'MANUAL'` — leave it unchanged). Plain read type `PayosTopUp` in the port (fields of Task 2's DTO + `userId`, `paymentLinkId`); no entity class needed.
  - [x] `createProcessing({ id, userId, amountVnd, points, expiresAt, createdAt }, { limit, windowMs, now })` → `{ outcome: 'CREATED', topUp } | { outcome: 'ALREADY_PROCESSING', topUp } | { outcome: 'RATE_LIMITED', retryAfterSeconds }`, all in one `runInTransaction`:
    1. `pg_advisory_xact_lock(hashtext('top-up:' || userId))` — **same key** as manual `createPending` (`prisma-top-up.repository.ts:37`) so manual and PayOS creations for a user serialise.
    2. Existing `PROCESSING` PAYOS row for the user → `ALREADY_PROCESSING` (checked first, so "Tiếp tục thanh toán" works even when rate-limited).
    3. Count PAYOS rows of the user with `createdAt > now - windowMs`; `>= limit` → `RATE_LIMITED`, `retryAfterSeconds = ceil((oldestInWindow.createdAt + windowMs - now)/1000)`, min 1. The row count **is** the checkout count (every allowed checkout inserts a row, including create-failed ones) → correct across replicas, no counter store.
    4. `SELECT nextval('top_up_order_code_seq')::int` then `tx.topUpRequest.create({ channel: 'PAYOS', status: 'PROCESSING', amount: points, amountVnd, orderCode, expiresAt, transferReference: null, … })`.
    5. Backstop: P2002 whose `meta.target` mentions `user_id` or `top_up_requests_one_processing_per_user` → re-read and return `ALREADY_PROCESSING` (never 500).
  - [x] `attachPaymentLink(id, { paymentLinkId, checkoutUrl })` → `UPDATE … WHERE id AND channel='PAYOS' AND payment_link_id IS NULL`; returns the row (status may already be `CANCELLED` if the user cancelled mid-create).
  - [x] `markCancelled(id, cancelledAt, outboxEvent | null)` → one transaction: `updateMany WHERE id AND channel='PAYOS' AND status='PROCESSING'` set `CANCELLED`, `cancelledAt`; if count 1 and `outboxEvent` given, `tx.outboxEvent.create` (shape: `prisma-top-up.repository.ts:163-178`); returns `{ changed: boolean, topUp }`.
  - [x] `findOwned(id, userId)` (PAYOS only; other user's / MANUAL / unknown → null).
  - [x] `countManualPending()` → `count({ where: { channel: 'MANUAL', status: 'PENDING' } })`.
  - [x] In-memory implementation mirrors the same rules (used by service spec and HTTP e2e). Bind `{ provide: PAYOS_TOP_UP_REPOSITORY_PORT, useClass: PrismaPayosTopUpRepository }` in `economy.module.ts`.
- [x] Task 5: Service (AC: 1–7) — `application/payos-top-up.service.ts` (`PayosTopUpService`, plain class, factory-wired like `TopUpService` in `economy.module.ts`)
  - [x] Deps: payos repo, `PaymentProviderPort` (`PAYMENT_PROVIDER_PORT`, already bound by 13.2), `appBaseUrl: string` (= `env.emailAppBaseUrl`, the frontend origin without trailing slash), checkout limit/window, `logger`, `now`, `generateId`.
  - [x] `checkout(userId, input)`: parse with `payosCheckoutSchema` (throw `InvalidTopUpRequestException` → 400 like the manual flow, but controller pipe already rejects; keep the service parse for non-HTTP callers). `points = amountVnd / POINT_VND_RATE`. `expiresAt = now + PAYOS_TOP_UP_EXPIRY_MS`. `createProcessing` →
    - `ALREADY_PROCESSING` → throw `PayosTopUpAlreadyProcessingException(topUp.id, topUp.checkoutUrl)` → 409 `TOPUP_ALREADY_PROCESSING`, `details: { topUpId, checkoutUrl }`.
    - `RATE_LIMITED` → throw `PayosCheckoutRateLimitedException(retryAfterSeconds)` → 429 `TOPUP_CHECKOUT_RATE_LIMITED` + `Retry-After` (filter sets it via `retryAfterSeconds`, pattern l.374-381).
    - `CREATED` → **after the transaction committed** call `provider.createPayment({ orderCode, amountVnd, returnUrl: \`${base}/wallet/top-up/${id}\`, cancelUrl: same URL, expiresAt })`. Never inside a DB transaction (no lock across HTTP).
    - create throws (any error, incl. timeout = outcome unknown) → `markCancelled(id, now, null)` (**no** notification — FR-76 exception), `logger.warn` with `topUpId`, `orderCode`, `providerCode` only (no URLs with tokens, no error headers), throw `PayosCheckoutUnavailableException` → 503 `TOPUP_PROVIDER_UNAVAILABLE` (retryable). If the link was in fact created, a later full payment still credits via the CANCELLED late-payment path (13.4/13.5 reconcile by `orderCode`) — this resolves the 13.2 deferral; do **not** retry create.
    - success → `attachPaymentLink`; if the returned row is no longer `PROCESSING` (user cancelled mid-create) return it with `checkoutUrl` but the DTO shows its real status; else return `{ topUp, checkoutUrl }` (201).
  - [x] `cancel(userId, topUpId)`: `findOwned` → null → `PayosTopUpNotFoundException` (404, same code for "not yours" and "unknown" — no existence leak). Status `CANCELLED` → return as-is (idempotent 200). Other non-`PROCESSING` → `PayosTopUpNotCancellableException(currentStatus)` 409 `TOPUP_NOT_CANCELLABLE`.
    - `PROCESSING` → `provider.cancelPayment(orderCode, 'Người dùng huỷ')` **outside** any transaction; on throw `logger.warn('payOS cancel failed', { topUpId, orderCode, providerCode })` and continue (AC6).
    - Then `markCancelled(id, now, event)` with outbox event `{ id: uuid, idempotencyKey: topUpCancelKey(id), eventType: TOP_UP_STATUS_CHANGED_EVENT_TYPE, producer: 'economy-service', aggregateType: 'TopUpRequest', aggregateId: id, aggregateVersion: 2, payload }`.
    - `changed === false` (webhook credited or reconciliation expired it in between) → return the current row (no error; the DTO shows the real status).
  - [x] `getOwned(userId, id)` → DTO or 404 (backs `/wallet/top-up/:id`; status comes only from the DB, never from return params — NFR-31).
  - [x] DTO mapping: `checkoutUrl` only while `PROCESSING`.
- [x] Task 6: Admin ids for the startup alert (AC: 8) — `application/ports/admin-capability.port.ts`, `infrastructure/prisma-admin-capability.repository.ts`, `in-memory-admin-capability.repository.ts`
  - [x] Add `listActiveAdminIds(): Promise<string[]>` (`user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })`). No lock (read-only, outside any UoW).
- [x] Task 7: Outbox notification handler (AC: 5) — `application/top-up-notification.handler.ts`
  - [x] Copy the shape of `rewards/application/code-issue-notification.handler.ts`: `name = 'economy.top-up-notification'`, `eventType = TOP_UP_STATUS_CHANGED_EVENT_TYPE`, `schemaVersions = [1]`, parse with `topUpStatusChangedEventSchema` (invalid → `OutboxPayloadInvalidError`), publish `{ userId, type: 'TOPUP_CANCELLED', message: \`Giao dịch nạp ${vnd} VNĐ (mã ${orderCode}) đã được huỷ. Không có Điểm nào thay đổi.\`, dedupeKey: event.idempotencyKey }`. Format VNĐ with `vi-VN` grouping (10.000).
  - [x] Register it: add `@Optional() private readonly handlers?: OutboxHandlerRegistry` to `EconomySchedulerRegistrar` and `this.handlers?.register(...)` in `onModuleInit` (pattern: `rewards/infrastructure/rewards-outbox.registrar.ts`). Provide the handler via factory with `NOTIFICATION_PUBLISHER_PORT`.
  - [x] Why the Outbox and not a direct `publish`: `NotificationPublisherPort` inside a UoW only defers to `afterCommit` (best-effort, E9-D3); the AC requires the Outbox, and this event type is the one 13.4/13.5 reuse.
- [x] Task 8: Controller (AC: 1, 4, 5, 7, 9) — `presentation/payos-top-up.controller.ts`, `@Controller(['economy/top-ups/payos', 'api/economy/top-ups/payos'])`, `@UseGuards(SessionAuthGuard)` (same dual-prefix convention as `top-up.controller.ts:31`)
  - [x] `GET availability` → `{ payosEnabled: availability.isCheckoutOpen() }` (**not** behind the checkout guard).
  - [x] `POST /` (201) — `@UseGuards(PayosCheckoutEnabledGuard, CsrfGuard, JsonOnlyGuard)`, body `ZodValidationPipe(payosCheckoutSchema)` (400 `VALIDATION_ERROR` with `details` = Zod `format()` → field error on `amountVnd`). Guard order: 404 when closed must win over validation, so the guard runs before the pipe (Nest runs guards before pipes — keep it a guard, not a service check).
  - [x] `GET :id` (`@Param('id', ParseUUIDPipe)` from `common/http/parse-uuid.pipe`, as in `admin-top-up.controller.ts:62`) → owner DTO. **Not** flag-gated (users must see/cancel in-flight rows after an emergency disable).
  - [x] `POST :id/cancel` (200) — `CsrfGuard, JsonOnlyGuard`; **not** flag-gated (AD-25: only checkout is gated).
  - [x] Register controller + `PayosAvailability` (`useValue: new PayosAvailability()` singleton) + `PayosEnableGuard` + guards in `economy.module.ts`. Do not export the payment port.
- [x] Task 9: Exceptions + HTTP mapping — `application/exceptions/economy.exceptions.ts`, `common/http/http-exception.filter.ts` (+ its spec)
  - [x] `PayosTopUpAlreadyProcessingException` 409 `TOPUP_ALREADY_PROCESSING` details `{ topUpId, checkoutUrl }`; `PayosCheckoutRateLimitedException` 429 `TOPUP_CHECKOUT_RATE_LIMITED` details `{ retryAfterSeconds }` + header; `PayosCheckoutUnavailableException` 503 `TOPUP_PROVIDER_UNAVAILABLE`; `PayosTopUpNotFoundException` 404 `TOPUP_NOT_FOUND` (or reuse `TopUpRequestNotFoundException` — its code/message are already generic; prefer reuse); `PayosTopUpNotCancellableException` 409 `TOPUP_NOT_CANCELLABLE` details `{ currentStatus }`. Messages never include provider text, keys, or URLs.
- [x] Task 10: Config (AC: 7) — `env.schema.ts`, `env.service.ts`, `env.service.spec.ts`, `.env.example`, `deploy/.env.prod.example`
  - [x] `PAYOS_CHECKOUT_LIMIT: z.coerce.number().int().min(1).default(5)`, `PAYOS_CHECKOUT_WINDOW_SECONDS: z.coerce.number().int().min(60).default(600)` next to `PAYOS_ENABLED` (l.206); follow the participation-limit style (l.155-180). Getters `payosCheckoutLimit`, `payosCheckoutWindowSeconds`. Document both commented with defaults in the two example env files. Never touch `deploy/.env.prod`.
- [x] Task 11: Pre-deploy check (AC: 10) — `deploy/check-manual-topups.js`
  - [x] Plain Node + `@prisma/client` only (no Nest boot, no `dist` import): `SELECT count(*)::int AS n FROM top_up_requests WHERE status = 'PENDING'` via `$queryRaw` (raw SQL so it also runs against a pre-13.1 Prisma client in the **currently deployed** container; `PENDING` exists only for `MANUAL` rows by the 13.1 CHECK). Print `Manual PENDING top-ups: N`; `process.exit(N > 0 ? 1 : 0)`; DB error → print message, exit 2.
  - [x] Header comment with the run command in the `grant-points.js` style: `docker cp deploy/check-manual-topups.js rescom-backend-1:/app/apps/backend/` + `docker exec -w /app/apps/backend rescom-backend-1 node check-manual-topups.js`. Add one line to `deploy/README.md` under the deploy steps: run it before deploying with `PAYOS_ENABLED=true`.
- [x] Task 12: Tests
  - [x] `application/payos-top-up.service.spec.ts` (in-memory repo + `FakePaymentProvider` from 13.2): Points = amount/200 and `points` input ignored; row exists in repo with `PROCESSING` **before** `createPayment` is invoked (assert inside a fake hook); create success stores link and returns `checkoutUrl`, `returnUrl`/`cancelUrl` = `${base}/wallet/top-up/${id}`, `expiresAt` = now+5m; `failNext('createPayment')` → row `CANCELLED`, no outbox event, 503 exception; second checkout → 409 with id + checkoutUrl; 6th checkout in 10 min (incl. one create-failed) → 429 with retryAfter, and `createPayment` call count unchanged; window passes → allowed; cancel → `cancelPayment` called, row `CANCELLED`, one outbox event with key `topup-cancel:{id}`, new checkout allowed at once; `failNext('cancelPayment')` → still `CANCELLED` + warn logged; cancel of other user's row → 404 and no provider call; cancel twice → idempotent, one event; cancel on `SUCCESSFUL` → 409.
  - [x] `infrastructure/payos-enable-guard.spec.ts`: flag off → closed, no count query; flag on + 0 pending → open; flag on + 4 pending → closed + `logger.error` + one `WARNING` per active admin with the daily dedupe key; count throws → closed, no throw.
  - [x] `application/top-up-notification.handler.spec.ts`: valid payload → publish `TOPUP_CANCELLED` with dedupe = idempotencyKey; invalid → `OutboxPayloadInvalidError`.
  - [x] `test/top-up-payos-checkout.e2e-spec.ts` (HTTP, in-memory repos, `overrideProvider(PAYMENT_PROVIDER_PORT).useValue(new FakePaymentProvider(...))`, pattern `test/top-up.e2e-spec.ts`): with checkout open — 400 field error for 9,999 / 10,100 / 5,000,200, 201 checkout, 409, cancel 200, other-user cancel 404, missing CSRF 403; with `PayosAvailability` closed — `POST /economy/top-ups/payos` 404 and manual `POST /economy/top-ups` 201 exactly as before; with it open — manual create 404; `GET availability` reflects state.
  - [x] `test/top-up-payos-checkout.prisma.e2e-spec.ts` (real DB, harness `test/fixtures/financial-pg-harness`, pattern `test/top-up-payos-schema.prisma.e2e-spec.ts`): two concurrent `createProcessing` for one user → exactly one `CREATED`, the other `ALREADY_PROCESSING` (no 500); rate-limit count across 5 rows; `markCancelled` + outbox row commit together and a second call changes nothing; `countManualPending` counts only `MANUAL` `PENDING`.
  - [x] Regression: `top-up.service.spec.ts`, `top-up.e2e-spec.ts`, `prisma-top-up.repository.spec.ts`, `notification-type.parity.spec.ts`, `test/architecture.spec.ts` (no `@nestjs`/`@payos`/"adapter" text in new `application/` files), `http-exception.filter.spec.ts`.
  - [x] Run: `npm test --workspace backend -- payos top-up notification architecture env http-exception`; full `npm test --workspace backend`; `npm run test:e2e --workspace backend -- top-up`; `npm run build --workspace backend`; `npm run lint --workspace backend`; `npm test --workspace @rescom/schemas`; FE typecheck/build in `apps/frontend/my-app` (only the presentation map changed).

### Review Findings

- [x] [Review][Patch] attachPaymentLink (or markCancelled in the create-fail catch) throwing after createPayment leaves an orphan PROCESSING row with no checkoutUrl and returns 500 instead of 503; the one-per-user index blocks checkout until manual cancel [apps/backend/src/modules/economy/application/payos-top-up.service.ts:84]
- [x] [Review][Patch] Enable guard: one admin publish failure stops the remaining alerts and is logged as "enable check failed"; the caught error is discarded [apps/backend/src/modules/economy/infrastructure/payos-enable-guard.ts:49]
- [x] [Review][Patch] Enable guard spec does not assert logger.error (pending>0 and count throws), and the dedupe-key date is computed from the test's wall clock (flaky across UTC midnight) [apps/backend/src/modules/economy/infrastructure/payos-enable-guard.spec.ts:32]
- [x] [Review][Defer] P2002 backstop matches meta.target with a regex; an unmatched shape (index name / undefined target) surfaces as 500 instead of ALREADY_PROCESSING. The advisory lock makes this path rare [apps/backend/src/modules/economy/infrastructure/prisma-payos-top-up.repository.ts:105] — deferred, low risk (advisory lock serialises)

## Dev Notes

### Scope boundary (read first)

13.3 delivers checkout, user cancel, the owner status read, the effective-enable guard, the pre-deploy script, and the first `ECONOMY_TOPUP_STATUS_CHANGED` producer. Out of scope:
- Webhook, `CreditTopUp`, late-payment crediting of `CANCELLED`/`EXPIRED` rows, `TOPUP_SUCCESS` for PayOS → **13.4**. 13.3 only guarantees the row ends `CANCELLED` with `orderCode` intact so 13.4/13.5 can find it.
- Expiry (`PROCESSING` past `expiresAt` → `EXPIRED`), reconciliation, `TOPUP_REFUND_MAILBOX`, alert emails/Sentry, `RecheckTopUp` → **13.5**. A `PROCESSING` row past expiry stays `PROCESSING` until 13.5 ships; the one-per-user index then blocks a new checkout until the user cancels — acceptable because prod keeps `PAYOS_ENABLED=false` until 13.13.
- Unified Wallet history list (manual + PayOS) and all screens → **13.7**. Admin console/B4 chip → **13.8/13.13**.
- Do **not** gate adapter wiring on `PAYOS_ENABLED` (13.2 deferral, decided here): webhook, reconciliation, cancel and the 13.6 probe must work with the flag off; only checkout is gated (AD-25 "Webhook, reconciliation, mismatch and refund commands are never flag-gated"). Record this resolution in Completion Notes and mark both 13.2 deferrals in `deferred-work.md` (l.461-462) as resolved by 13.3.

### Flow (AD-25 Checkout, solution-design.md l.299-330)

```
POST /economy/top-ups/payos {amountVnd}
 ├ PayosCheckoutEnabledGuard → 404 when effectively off
 ├ CsrfGuard, JsonOnlyGuard, Zod pipe → 400 field error (no provider call)
 ├ tx: advisory lock top-up:{userId} → 409 existing PROCESSING → 429 window → nextval → INSERT PROCESSING  (commit)
 ├ provider.createPayment (maxRetries 0, outside tx)
 │   ├ throws → CAS PROCESSING→CANCELLED (no notification) → 503 retryable
 │   └ ok → store paymentLinkId + checkoutUrl → 201 {topUp, checkoutUrl}
POST /economy/top-ups/payos/:id/cancel
 ├ owner check (404) → status check (CANCELLED idempotent / other 409)
 ├ provider.cancelPayment (outside tx; failure logged, ignored)
 └ tx: CAS PROCESSING→CANCELLED + Outbox ECONOMY_TOPUP_STATUS_CHANGED (topup-cancel:{id})
```

### Port contract you call (13.2, `application/ports/payment-provider.port.ts`)

`createPayment({ orderCode, amountVnd, returnUrl, cancelUrl, expiresAt }) → { paymentLinkId, checkoutUrl }`; `cancelPayment(orderCode, reason?) → void`. Both throw `PaymentProviderUnavailableError` (carries `providerCode`/`providerDesc`/`httpStatus` only). With no credentials the bound implementation is `UnconfiguredPaymentProvider` (every call throws) → checkout ends `CANCELLED` + 503, which is the correct behavior if someone sets `PAYOS_ENABLED=true` without keys (env validation already rejects that, 13.2). The adapter builds `description = RC + last 7 digits` and `expiredAt` seconds — do not duplicate that logic. Tests use `FakePaymentProvider` (`infrastructure/fake-payment-provider.ts`: call recording, `failNext(method)`).

### Current state of files touched

- `presentation/top-up.controller.ts` — manual create/list; add only the inverse guard on `create`. `application/top-up.service.ts`, `prisma-top-up.repository.ts` — manual flow, **unchanged** (manual `amount` = Points, `pointsToVnd`; PayOS input is VND).
- `economy.module.ts` — factories with `inject` + optional `NOTIFICATION_PUBLISHER_PORT`; `PAYMENT_PROVIDER_PORT` bound at ~l.170 via `createPaymentProvider(env)`. Add providers; change nothing else.
- `infrastructure/economy-scheduler.registrar.ts` — registers jobs only; add the optional `OutboxHandlerRegistry` and register the handler.
- `common/http/http-exception.filter.ts` — big `instanceof` chain; add the new exceptions near the top-up block (~l.563-591). `retryAfterSeconds` variable already drives `Retry-After`.
- `common/config/env.schema.ts` — `PAYOS_*` keys l.206-209, `superRefine` PayOS block ~l.366-380 (unchanged).
- `admin-capability.port.ts` — single method today; add one.
- Notifications: `NotificationPublisherPort.publish` never throws, dedupes on `(userId, dedupeKey)`; inside a UoW the Prisma repo defers the insert to `afterCommit`. The Outbox handler runs inside the dispatcher's transaction (kind (a), `common/scheduler/outbox/outbox-handler.ts`).

### Guardrails

- AD-16/AD-25 lock rule: never hold a DB transaction or row lock across a payOS HTTP call.
- Status changes are compare-and-set (`WHERE status='PROCESSING' AND channel='PAYOS'`); zero rows = someone else won → return current state, not an error.
- `returnUrl` query params are never proof; `GET :id` reads the DB only (NFR-31).
- Never log `checkoutUrl`, request bodies, provider headers, or keys. Log ids, `orderCode`, provider `code` only.
- `application/` files: no `@nestjs/*`, `@prisma/client`, `@payos/*`, and not the word "adapter" even in comments (`test/architecture.spec.ts:7-15`).
- Points are integers: `amountVnd / 200` is exact because of the ×200 rule; DB CHECK `amount * 200 = amount_vnd` will reject any mismatch.
- `orderCode` is `int4` from the sequence (≥ 1,000,000,000, JS-safe); read `nextval(...)::int`.

### Previous story intelligence

- 13.2 (done, PR #37 → 3c3fa84): port/adapter/fake/unconfigured; env keys + `payosEnabled`/`payosCredentials` getters; boundary rule in `test/architecture.spec.ts`. Deferred to 13.3: flag gating of adapter wiring (resolved: do not gate, see Scope) and outcome-unknown create timeout (resolved: row `CANCELLED`, reconcile by `orderCode` in 13.4/13.5, never blind retry). Review lesson: single shared helper instead of duplicated logic between fake and real; test the selection paths.
- 13.1 (done, PR #36): schema + CHECKs + partial unique index; integration test proves a second `PROCESSING` insert fails at the DB — reuse its harness for the new prisma e2e.
- Both stories: fill "Agent Model Used" in the Dev Agent Record.

### Testing standards

- Jest unit specs co-located under `src/`; HTTP e2e in `test/*.e2e-spec.ts` with in-memory repos; DB-backed in `test/*.prisma.e2e-spec.ts` (skipped when the financial PG harness is unavailable, required in CI via `requireDb`).
- **No test calls real payOS** (no sandbox; real money). Always override `PAYMENT_PROVIDER_PORT` with `FakePaymentProvider`.

### Project Structure Notes

- New backend files: `application/payos-top-up.service.ts`, `application/payos-availability.ts`, `application/top-up-notification.handler.ts`, `application/ports/payos-top-up-repository.port.ts`, `infrastructure/prisma-payos-top-up.repository.ts`, `infrastructure/in-memory-payos-top-up.repository.ts`, `infrastructure/payos-enable-guard.ts`, `presentation/payos-top-up.controller.ts`, `presentation/payos-checkout-enabled.guard.ts` (+ specs); migration `20261018100000_top_up_payos_checkout`; `deploy/check-manual-topups.js`; `packages/schemas/src/economy/payos-top-up.schema.ts`.
- Naming follows `prisma-*`, `in-memory-*`, `*.port.ts`, `*-enabled.guard.ts` conventions.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.3] (l.1818-1837), Epic 13 intro (l.1781-1783), UX-DR-P4/P10/P16 (l.174, 180, 185)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-25] (l.212-280: Checkout, Enable flag, state diagram)
- [Source: .../solution-design.md#PayOS Top-Up and Refund Flows] (l.295-370)
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md] FR-34 (l.571), FR-35 (l.585), FR-76 (l.600), FR-79 (l.645), NFR-7 (l.1278), NFR-31 (l.1282)
- [Source: .../addendum.md#12. PayOS Integration Notes] (l.358)
- [Source: _bmad-output/implementation-artifacts/13-2-payment-provider-port-payos-adapter.md], [13-1-top-up-schema-for-payos.md], `deferred-work.md` l.461-462

## Dev Agent Record

### Agent Model Used

inherit (Antigravity)

### Debug Log References

- Applied 20261018100000 migration to financial test database; verified real Prisma concurrent insert, CAS + outbox, rate window.
- `npm test --workspace backend -- --runInBand`: 167 suites, 2524 tests passed.
- `npm run test:e2e --workspace backend -- top-up`: 4 suites, 21 tests passed.
- `npm test --workspace @rescom/schemas`: 47 suites, 646 tests passed.
- Backend build, typecheck, lint, Prisma validate, frontend typecheck/build, `node --check deploy/check-manual-topups.js`: passed.

### Completion Notes List

- Delivered PayOS checkout, owned status read, user cancellation, startup manual-pending guard, atomic outbox cancellation notification and pre-deploy check. Manual create disabled only while checkout is effectively open.
- Payment provider wiring remains independent of `PAYOS_ENABLED`; only checkout is gated, preserving cancel/webhook/reconciliation/probe access. Create timeouts mark row `CANCELLED`, retain `orderCode`, and never blindly retry; 13.4/13.5 handle late payment.
- No real payOS calls in tests; `FakePaymentProvider` used. New DB integration verifies advisory-lock serialization, five-row rate window, atomic cancellation/outbox.

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- `_bmad-output/implementation-artifacts/13-3-top-up-checkout-user-cancel-enable-guard.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/backend/.env.example`
- `apps/backend/prisma/migrations/20261018100000_top_up_payos_checkout/migration.sql`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/common/config/env.schema.ts`
- `apps/backend/src/common/config/env.service.spec.ts`
- `apps/backend/src/common/config/env.service.ts`
- `apps/backend/src/common/http/http-exception.filter.spec.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`
- `apps/backend/src/modules/economy/application/payos-availability.ts`
- `apps/backend/src/modules/economy/application/payos-top-up.service.spec.ts`
- `apps/backend/src/modules/economy/application/payos-top-up.service.ts`
- `apps/backend/src/modules/economy/application/ports/admin-capability.port.ts`
- `apps/backend/src/modules/economy/application/ports/payos-top-up-repository.port.ts`
- `apps/backend/src/modules/economy/application/top-up-notification.handler.spec.ts`
- `apps/backend/src/modules/economy/application/top-up-notification.handler.ts`
- `apps/backend/src/modules/economy/economy.module.ts`
- `apps/backend/src/modules/economy/infrastructure/economy-scheduler.registrar.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-admin-capability.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-payos-top-up.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/payos-enable-guard.spec.ts`
- `apps/backend/src/modules/economy/infrastructure/payos-enable-guard.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-admin-capability.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-payos-top-up.repository.ts`
- `apps/backend/src/modules/economy/presentation/payos-checkout-enabled.guard.ts`
- `apps/backend/src/modules/economy/presentation/payos-top-up.controller.ts`
- `apps/backend/src/modules/economy/presentation/top-up.controller.spec.ts`
- `apps/backend/src/modules/economy/presentation/top-up.controller.ts`
- `apps/backend/src/modules/notifications/infrastructure/notification-type.parity.spec.ts`
- `apps/backend/src/modules/rewards/application/rewards-my-vouchers.service.spec.ts`
- `apps/backend/src/modules/rewards/application/rewards-services.spec.ts`
- `apps/backend/test/rewards-catalog.prisma.e2e-spec.ts`
- `apps/backend/test/top-up-payos-checkout.e2e-spec.ts`
- `apps/backend/test/top-up-payos-checkout.prisma.e2e-spec.ts`
- `apps/frontend/my-app/lib/notifications/notification-presentation.ts`
- `deploy/.env.prod.example`
- `deploy/README.md`
- `deploy/check-manual-topups.js`
- `packages/schemas/src/economy/index.ts`
- `packages/schemas/src/economy/payos-top-up.schema.spec.ts`
- `packages/schemas/src/economy/payos-top-up.schema.ts`
- `packages/schemas/src/notifications/notification.schema.spec.ts`
- `packages/schemas/src/notifications/notification.schema.ts`

### Change Log

- 2026-10-15: Story 13.3 checkout/cancel/guard/notification/schema/deploy implementation and regression tests.
