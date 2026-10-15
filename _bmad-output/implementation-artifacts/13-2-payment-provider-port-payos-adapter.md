---
baseline_commit: ec1d7b8175f93ecaaecc2c75051e26175e6d90c3
---
# Story 13.2: PaymentProviderPort & payOS Adapter

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Developer,
I want one Economy adapter behind `PaymentProviderPort`,
so that the payOS SDK never leaks into the domain and every test runs without real money.

## Acceptance Criteria

1. **Given** `@payos/node` 2.x is added to the backend only, **When** the adapter is implemented, **Then** `PaymentProviderPort` exposes create, get, cancel, and verify-webhook, and only the Economy infrastructure adapter imports `@payos/node` (enforced by a lint/boundary rule) (AD-25, AD-10).
2. **And** create sends `orderCode`, exact `amount`, `description` = `RC` + last 7 digits of `orderCode` (≤ 9 characters), `returnUrl`, `cancelUrl`, `expiredAt` = now + 5 minutes, with SDK `maxRetries: 0`.
3. **And** the adapter maps payOS statuses to local effects exactly as the AD-25 table (`PAID` full / other amount / `UNDERPAID` / `PENDING` / `PROCESSING` / `CANCELLED` / `EXPIRED` / `FAILED`), and extracts `amountPaid`, `transactionDateTime` (parsed `Asia/Ho_Chi_Minh`, stored UTC), and `counterAccount*` (first non-null wins).
4. **And** `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` are read from server-only config, validated at startup when used, and never logged or sent to the client (NFR-31).
5. **And** a fake adapter and HMAC-signed fixture webhooks are available to tests; contract tests run against recorded payOS payloads, including null `counterAccount*`.

## Tasks / Subtasks

- [x] Task 1: Dependency (AC: 1)
  - [x] `npm install @payos/node@2.0.5 --save-exact --workspace backend` (pin exact: the SDK has no `engines` field and mapping/signature behavior below was read from 2.0.5). Only `apps/backend/package.json` + root `package-lock.json` change. Never add it to `apps/frontend/*` or `packages/*`.
- [x] Task 2: Port (AC: 1, 3) — `apps/backend/src/modules/economy/application/ports/payment-provider.port.ts`
  - [x] `export const PAYMENT_PROVIDER_PORT = Symbol('PAYMENT_PROVIDER_PORT');` + `interface PaymentProviderPort` (shape in Dev Notes "Port contract"). Plain TS types only, no SDK types.
  - [x] Port-level errors in the same file: `PaymentProviderSignatureError` (invalid webhook) and `PaymentProviderUnavailableError` (network/timeout/HTTP error/payOS `code ≠ "00"`; carries provider `code`/`desc` when present, never the request body or keys).
  - [x] **Do not write the word "adapter" anywhere in this file, not even in comments** — `test/architecture.spec.ts` matches `/adapter/i` against the full text of every non-spec file in `domain/` and `application/` (see Dev Notes "Boundary rule").
- [x] Task 3: payOS implementation (AC: 1, 2, 3, 4) — `apps/backend/src/modules/economy/infrastructure/payos-payment-provider.adapter.ts`
  - [x] The only file in `src/` that imports `@payos/node`. Constructor builds `new PayOS({ clientId, apiKey, checksumKey, maxRetries: 0, timeout: 10_000, logLevel: 'off', logger: null })` from explicit values (never rely on the SDK's own `process.env` read). Pass `baseURL: 'https://api-merchant.payos.vn'` explicitly so a stray `PAYOS_BASE_URL` env cannot redirect calls.
  - [x] `createPayment`: description `` `RC${String(orderCode).slice(-7)}` ``; `expiredAt: Math.floor(input.expiresAt.getTime() / 1000)` (Unix **seconds**, Int32); `amount: input.amountVnd`; also pass per-request `{ maxRetries: 0 }` on create (belt and braces — AD-10 adapter rule, create is not idempotent). Returns `{ paymentLinkId, checkoutUrl }`.
  - [x] `getPayment(orderCode, expectedAmountVnd)`: `paymentRequests.get(orderCode)` (pass a **number** → orderCode lookup) → `mapPaymentLink(link, expectedAmountVnd)` (pure, exported for unit tests).
  - [x] `cancelPayment(orderCode, reason?)`: `paymentRequests.cancel(orderCode, reason)`; resolve `void`. Callers (13.3/13.5) decide what a failure means — just throw `PaymentProviderUnavailableError`.
  - [x] `verifyWebhook(body: unknown)`: shape-check (object with string `signature`, object `data` with numeric `orderCode`), recompute HMAC with the shared `payosDataSignature()` (Task 4) and compare with `crypto.timingSafeEqual` on equal-length buffers (the SDK's `webhooks.verify` uses `!==`; this repo already uses `timingSafeEqual` in `src/common/security/storage-capability.ts`). Invalid → `PaymentProviderSignatureError`. Valid → `VerifiedPaymentWebhook` (Dev Notes).
  - [x] Wrap every SDK call: map `APIError`/`ConnectionError`/`ConnectionTimeoutError`/`InvalidSignatureError` → `PaymentProviderUnavailableError` with `providerCode`/`providerDesc`/`httpStatus` only. Never include `err.headers`, request options, or the client in the error/log.
- [x] Task 4: Shared pure helpers (AC: 3, 5) — `apps/backend/src/modules/economy/infrastructure/payos-mapping.ts`
  - [x] `payosDataSignature(data: Record<string, unknown>, checksumKey: string): string` — exact SDK algorithm (Dev Notes "Signature"). Used by the adapter's verify and by the test fixture signer (one implementation; contract test cross-checks it against the SDK's own `webhooks.verify`).
  - [x] `parsePayosDateTime(s: string | null | undefined): Date | null` — `YYYY-MM-DD HH:mm:ss` → `new Date(\`${date}T${time}+07:00\`)`; string already carrying `Z`/`±hh:mm` → `Date` as-is; anything else or invalid → `null` (13.4 then falls back to verification time per AD-25).
  - [x] `mapPaymentLink(link, expectedAmountVnd): ProviderPaymentSnapshot` implementing the AD-25 table (Dev Notes "Mapping").
  - [x] `firstNonNull` for each `counterAccount*` field independently, across `transactions[]` in array order.
- [x] Task 5: Fake + unconfigured implementations (AC: 5) — `apps/backend/src/modules/economy/infrastructure/`
  - [x] `fake-payment-provider.ts` — `FakePaymentProvider implements PaymentProviderPort`, in-memory, deterministic: records `createPayment`/`cancelPayment` calls; `setPayment(orderCode, PaymentLinkLike)` lets a test script what `getPayment` returns (routes through the real `mapPaymentLink`); `failNext(method)` makes the next call throw `PaymentProviderUnavailableError`; `verifyWebhook` uses the real `payosDataSignature` with the fake's checksum key. Tests only (pattern: `storage/infrastructure/in-memory-object-storage.service.ts`).
  - [x] `unconfigured-payment-provider.ts` — every method throws `PaymentProviderUnavailableError('payOS is not configured')`. Bound when keys are absent (dev/test/prod-before-13.6), so nothing ever pretends a payment happened.
- [x] Task 6: Config (AC: 4) — `src/common/config/env.schema.ts`, `env.service.ts`
  - [x] Add `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`: `z.string().trim().min(1).optional()` (same style as `REWARDS_ACCOUNTING_DECISION_REF`, ~l.206).
  - [x] Add `PAYOS_ENABLED: booleanEnv(false)` next to `REWARDS_ENABLED` (~l.205). **Only the key + validation here**; checkout gating, the manual-`PENDING` startup guard, and every consumer of the flag are Story 13.3.
  - [x] `superRefine` (all environments, not just production): if any of the three keys is set, all three must be set; if `PAYOS_ENABLED` is true, all three must be set. In production also reject `isPlaceholderSecret(...)` values for the three keys (existing helper, ~l.74–82). Error messages name the key, never echo the value.
  - [x] `EnvService`: `get payosEnabled(): boolean` and `get payosCredentials(): { clientId; apiKey; checksumKey } | null` (null unless all three set). No other getter exposes them.
  - [x] Update `src/common/config/env.service.spec.ts` (existing env validation spec) for: none set → ok; partial set → error on the missing key; `PAYOS_ENABLED=true` without keys → error; prod placeholder → error.
- [x] Task 7: Module wiring (AC: 1, 5) — `src/modules/economy/economy.module.ts`
  - [x] `{ provide: PAYMENT_PROVIDER_PORT, useFactory: (env: EnvService) => createPaymentProvider(env), inject: [EnvService] }` with `createPaymentProvider` exported from `infrastructure/payos-payment-provider.adapter.ts` (pattern: `createEmailSender` in `notifications/notifications.module.ts:33-46`): credentials present → `PayosPaymentProvider`; else `UnconfiguredPaymentProvider`. **Never** select `FakePaymentProvider` from env — tests override the token (`overrideProvider(PAYMENT_PROVIDER_PORT).useValue(fake)`).
  - [x] Export `PAYMENT_PROVIDER_PORT` from the module only if 13.3+ need it outside Economy (they don't — Economy owns checkout/webhook/reconciliation; leave unexported).
  - [x] No consumer of the port in this story (checkout = 13.3, webhook = 13.4, reconciliation = 13.5).
- [x] Task 8: Boundary rule (AC: 1) — `apps/backend/test/architecture.spec.ts`
  - [x] Add `/@payos\//` to `forbiddenPatternsInDomainAndApplication`.
  - [x] Add a new `it('only the Economy payOS adapter imports @payos/node (Story 13.2 AC1)')`: walk all `.ts` under `src/` (include specs — a spec importing the SDK is a leak too, except the contract spec below), allowlist exactly `modules/economy/infrastructure/payos-payment-provider.adapter.ts` and `modules/economy/infrastructure/payos-payment-provider.contract.spec.ts`; assert no other file matches `/['"]@payos\/node['"]/`. Also assert `@payos/node` is absent from every `package.json` except `apps/backend/package.json` (pattern: the `@google-cloud/*` test at ~l.180).
- [x] Task 9: Fixtures + tests (AC: 2, 3, 5)
  - [x] `apps/backend/test/fixtures/payos-webhook.fixture.ts` (TS-builder convention of `test/fixtures/`): `PAYOS_TEST_CHECKSUM_KEY`, `buildPayosWebhookData(overrides)`, `signPayosWebhook(data, key)` → full `{ code, desc, success, data, signature }` envelope via `payosDataSignature`, and `buildPaymentLink(overrides)` for GET payloads.
  - [x] Recorded payloads: `apps/backend/test/fixtures/payos-recorded/` JSON — `webhook-paid.json`, `webhook-paid-null-counter-account.json`, `payment-link-paid.json`, `payment-link-underpaid.json`, `payment-link-cancelled.json`. Source them from the payOS docs samples (https://payos.vn/docs/api/, webhook sample) and the 2.0.5 type shapes, re-signed with the test key, with a `_source` field naming the origin. **Story 13.6 replaces/adds real production captures** — record that in Completion Notes.
  - [x] `infrastructure/payos-mapping.spec.ts` (unit): every row of the mapping table incl. `PAID` with `amountPaid > amountVnd`, `PAID` with `amountPaid < amountVnd`, `UNDERPAID`, `FAILED`; `parsePayosDateTime('2026-10-15 23:30:00')` → `2026-10-15T16:30:00.000Z`; date crossing midnight UTC; ISO-with-offset passthrough; garbage → null; counterAccount first-non-null per field across 2 transactions; description for orderCode `1000000000` → `RC0000000` and `1234567890` → `RC4567890` (length 9).
  - [x] `infrastructure/payos-payment-provider.adapter.spec.ts` (unit, SDK mocked by injecting a fake client or `jest.mock('@payos/node')`): create sends the exact body (orderCode, amount, description, returnUrl, cancelUrl, `expiredAt` in seconds) and `{ maxRetries: 0 }`; client constructed with `maxRetries: 0`, `logLevel: 'off'`; SDK `APIError` with `code '231'` → `PaymentProviderUnavailableError` whose `message`/JSON contains neither apiKey nor checksumKey (assert by string search for the test key values); `ConnectionTimeoutError` → unavailable; `verifyWebhook` rejects tampered `amount`, wrong key, missing signature, non-object body, and accepts the fixture.
  - [x] `infrastructure/payos-payment-provider.contract.spec.ts`: for every recorded webhook fixture, the SDK's own `new PayOS({ checksumKey: PAYOS_TEST_CHECKSUM_KEY, ... }).webhooks.verify(fixture)` resolves (proves our signer = payOS algorithm), and our `verifyWebhook` accepts it; a one-field tamper fails both. Recorded GET fixtures go through `mapPaymentLink` to the expected effect, including the null-`counterAccount*` case (all four facts `null`, effect still `CREDIT`).
  - [x] `fake-payment-provider.spec.ts`: scripted `getPayment`, `failNext`, call recording.
  - [x] Run: `npm test --workspace backend -- payos payment-provider architecture env`; full `npm test --workspace backend`; `npm run build --workspace backend`; `npm run lint --workspace backend`.
- [x] Task 10: Env examples (AC: 4)
  - [x] `apps/backend/.env.example` near `REWARDS_ENABLED` (~l.164): `PAYOS_ENABLED=false` and commented `# PAYOS_CLIENT_ID=`, `# PAYOS_API_KEY=`, `# PAYOS_CHECKSUM_KEY=` with a one-line note "payOS has no sandbox; leave unset outside production (Story 13.6 sets them on the VPS)".
  - [x] `deploy/.env.prod.example` near `REWARDS_ENABLED=false` (~l.92): same keys, `PAYOS_ENABLED=false`, secrets commented out (do **not** use `CHANGE_ME` placeholders — a set-but-placeholder key fails prod startup by design). Never touch `deploy/.env.prod`.

### Review Findings

- [x] [Review][Patch] Webhook verification duplicated in fake and adapter; fake has no try/catch, so `data` with an array holding `null` throws `TypeError` instead of `PaymentProviderSignatureError` — extract one `verifyPayosWebhook(body, checksumKey)` into `payos-mapping.ts` [apps/backend/src/modules/economy/infrastructure/fake-payment-provider.ts:57]
- [x] [Review][Patch] Dead branch in `call()`: SDK error-class branch throws the same error as the fall-through [apps/backend/src/modules/economy/infrastructure/payos-payment-provider.adapter.ts:59]
- [x] [Review][Patch] `parsePayosDateTime` ISO branch accepts impossible dates (`2026-02-30T10:00:00Z` rolls over to 2026-03-02) — validate the calendar date for ISO input too [apps/backend/src/modules/economy/infrastructure/payos-mapping.ts:55]
- [x] [Review][Patch] Adapter `getPayment`/`cancelPayment` and `createPaymentProvider` selection (credentials → payOS, none → unconfigured) have no tests [apps/backend/src/modules/economy/infrastructure/payos-payment-provider.adapter.spec.ts]
- [x] [Review][Defer] Money received on a closed link maps to CANCELLED/EXPIRED (`CANCELLED`/`FAILED`/`EXPIRED` with `amountPaid > 0`) [apps/backend/src/modules/economy/infrastructure/payos-mapping.ts:104] — deferred to 13.5: kept per AD-25; 13.5 must alert when `facts.amountPaidVnd > 0` on these effects
- [x] [Review][Defer] `paymentFacts` treats the last array element as the latest transaction; confirm payOS ordering with real captures [apps/backend/src/modules/economy/infrastructure/payos-mapping.ts:76] — deferred to 13.6
- [x] [Review][Defer] `PAYOS_ENABLED` does not gate adapter wiring; credentials alone bind the live client [apps/backend/src/modules/economy/infrastructure/payos-payment-provider.adapter.ts:148] — deferred to 13.3 (gating in scope there)
- [x] [Review][Defer] Timeout/connection error on `createPayment` is outcome-unknown (link may exist at payOS) but surfaces as plain `PaymentProviderUnavailableError` [apps/backend/src/modules/economy/infrastructure/payos-payment-provider.adapter.ts:68] — deferred to 13.3/13.5 (caller must reconcile by orderCode, not retry blindly)

## Dev Notes

### Scope boundary (read first)

13.2 delivers the port, the payOS implementation, the fake, config and tests — **no caller**. Out of scope:
- Checkout endpoint, user cancel, rate limit, `nextval('top_up_order_code_seq')`, `PAYOS_ENABLED` gating and the manual-`PENDING` startup guard → **13.3**.
- Webhook controller/route, CSRF opt-out, throttler skip, `code`/`data.code` = `"00"` decision, `CreditTopUp`, extending `prisma-account-funding.reader.ts` to `SUCCESSFUL`/`paidAt` → **13.4**.
- Reconciliation job, `TOPUP_REFUND_MAILBOX`, alerts, `RecheckTopUp` → **13.5**.
- `confirm-webhook` CLI, real payload capture → **13.6**. Do **not** add `confirmWebhook` to the port now (13.6 adds it; the epic AC lists exactly create/get/cancel/verify).
- No Prisma schema/migration change. No `@rescom/schemas`/frontend change.

### Port contract (application layer, plain types)

```ts
export const PAYMENT_PROVIDER_PORT = Symbol('PAYMENT_PROVIDER_PORT');

export interface CreatePaymentInput {
  orderCode: number;        // from top_up_order_code_seq (13.3), >= 1_000_000_000
  amountVnd: number;        // exact TopUpRequest.amountVnd
  returnUrl: string;        // 13.3 builds /wallet/top-up/:id on the frontend origin
  cancelUrl: string;
  expiresAt: Date;          // TopUpRequest.expiresAt (row committed first, AD-25) = now + 5 min
}
export interface CreatedPayment { paymentLinkId: string; checkoutUrl: string }

export type ProviderPaymentEffect =
  | 'CREDIT'           // PAID and amountPaid === expectedAmountVnd
  | 'AMOUNT_MISMATCH'  // PAID with other amount, or UNDERPAID
  | 'NO_CHANGE'        // PENDING, PROCESSING
  | 'CANCELLED'        // CANCELLED, FAILED  (no credit; a PROCESSING row moves to CANCELLED)
  | 'EXPIRED';         // EXPIRED            (no credit; a PROCESSING row moves to EXPIRED)

export interface ProviderPaymentFacts {
  amountPaidVnd: number;               // cumulative amountPaid
  providerReference: string | null;    // reference of the latest transaction
  paidAt: Date | null;                 // latest transaction's transactionDateTime, UTC
  counterAccountBankId: string | null; // each: first non-null across transactions
  counterAccountBankName: string | null;
  counterAccountName: string | null;
  counterAccountNumber: string | null;
}
export interface ProviderPaymentSnapshot {
  orderCode: number;
  providerStatus: string;              // raw payOS status, for logs/audit only
  effect: ProviderPaymentEffect;
  facts: ProviderPaymentFacts;
}

export interface VerifiedPaymentWebhook {
  orderCode: number;
  paymentLinkId: string;
  code: string;            // envelope code
  dataCode: string;        // data.code — 13.4 requires both === '00'
  amountVnd: number;       // data.amount (informational; 13.4 trusts GET amountPaid)
  facts: ProviderPaymentFacts; // from data (reference, transactionDateTime, counterAccount*)
}

export interface PaymentProviderPort {
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  getPayment(orderCode: number, expectedAmountVnd: number): Promise<ProviderPaymentSnapshot>;
  cancelPayment(orderCode: number, reason?: string): Promise<void>;
  verifyWebhook(body: unknown): Promise<VerifiedPaymentWebhook>; // throws PaymentProviderSignatureError
}
```

Why the mapping sits behind the port: AD-25 says "the adapter maps", and 13.4/13.5 (`CreditTopUp` in `application/`) may not import `infrastructure/`. Passing `expectedAmountVnd` keeps the full-vs-other decision in one place. The port does **not** decide state transitions (e.g. `CANCELLED → SUCCESSFUL` late payment) — that is `CreditTopUp`'s CAS in 13.4.

### Mapping (AD-25 table, @payos/node 2.0.5 `PaymentLinkStatus`)

`'PENDING' | 'CANCELLED' | 'UNDERPAID' | 'PAID' | 'EXPIRED' | 'PROCESSING' | 'FAILED'`

| payOS `status` | condition | `effect` |
| --- | --- | --- |
| `PAID` | `amountPaid === expectedAmountVnd` | `CREDIT` |
| `PAID` | otherwise (over or under) | `AMOUNT_MISMATCH` |
| `UNDERPAID` | — | `AMOUNT_MISMATCH` |
| `PENDING`, `PROCESSING` | — | `NO_CHANGE` |
| `CANCELLED`, `FAILED` | — | `CANCELLED` |
| `EXPIRED` | — | `EXPIRED` |
| anything else | — | throw `PaymentProviderUnavailableError` (unknown status must not credit or close) |

`amountPaidVnd` = `link.amountPaid` (cumulative). Note: `PaymentLink.id` is the paymentLinkId.

### Signature (from 2.0.5 `lib/crypto/node-crypto.js`, verified by reading the tarball)

HMAC-SHA256, key = checksum key, lowercase hex, over `data` only (not the envelope):
1. Sort `data`'s top-level keys with default JS `.sort()`; drop keys whose value is `undefined`.
2. Array value → `JSON.stringify(value.map(sortKeysOneLevel))`.
3. `null`, `undefined`, `'null'`, `'undefined'` → `''`.
4. Else `String(value)`. Join `key=value` with `&`, no URL-encoding.

Create-request signature (`amount=…&cancelUrl=…&description=…&orderCode=…&returnUrl=…`) is computed by the SDK — do not hand-roll it. The SDK also verifies the create-response signature and throws `InvalidSignatureError` on mismatch.

### SDK facts (@payos/node 2.0.5, published 2026-03-05, ISC, CJS, zero runtime deps)

- `import { PayOS, APIError, ConnectionError, ConnectionTimeoutError, InvalidSignatureError, WebhookError } from '@payos/node'` — CJS `main`, works with the NestJS CommonJS build. Needs Node 20+ (repo: Node ≥ 22, global `fetch` ok).
- **Defaults to override:** `maxRetries` = **2** (retries 408/429/5xx/network, *including POST create* — no idempotency key → duplicate-order risk), `timeout` = 60 000 ms, logger = `console` at `warn`, and it auto-reads `PAYOS_CLIENT_ID`/`PAYOS_API_KEY`/`PAYOS_CHECKSUM_KEY`/`PAYOS_BASE_URL`/`PAYOS_PARTNER_CODE`/`PAYOS_LOG` from `process.env`. Pass every value explicitly and `logLevel: 'off'`.
- Methods: `paymentRequests.create(data, opts?)`, `paymentRequests.get(orderCode: number | paymentLinkId: string, opts?)`, `paymentRequests.cancel(id, cancellationReason?, opts?)`, `webhooks.verify(webhook)` (async, signature only — does **not** check `code`), `webhooks.confirm(url)` (13.6). Per-request opts: `{ maxRetries, timeout, signal, headers }`.
- payOS business errors come back HTTP 200 `{ code ≠ '00', desc, data: null }` → SDK throws plain `APIError` (`status` 200, `.code`, `.desc`), never retried. Duplicate orderCode text: "Đơn thanh toán đã tồn tại" (code undocumented — don't hard-code it).
- `expiredAt`: Unix timestamp Int32 → seconds.
- `description`: ≤ 9 chars for bank accounts not linked via payOS (docs); `RC` + 7 digits = 9. 13.6 confirms acceptance in production.
- `transactionDateTime`: docs sample `"2023-02-04 18:25:00"`, timezone undocumented → treat as `+07:00` (AD-25); 13.6 confirms.
- `Transaction`: `reference, amount, accountNumber, description, transactionDateTime, virtualAccountName|null, virtualAccountNumber|null, counterAccountBankId|null, counterAccountBankName|null, counterAccountName|null, counterAccountNumber|null`. `WebhookData`: `orderCode, amount, description, accountNumber, reference, transactionDateTime, currency, paymentLinkId, code, desc, counterAccount*?|null, virtualAccount*?|null`.

### Boundary rule (critical gotcha)

`apps/backend/test/architecture.spec.ts:7-15` tests the **whole text** of every non-spec `.ts` in `modules/*/domain` and `modules/*/application` against `/adapter/i`, `@nestjs/`, `@prisma/client`, etc. So `payment-provider.port.ts` must not contain "adapter" or `@nestjs` even in comments, and `PAYMENT_PROVIDER_PORT` must be a plain `Symbol` (no `@Injectable`). There is no ESLint `no-restricted-imports` in `apps/backend/.eslintrc.js`; the architecture spec **is** the project's boundary rule (it runs in `npm test` via `jest.config.js` `testRegex`). Extending it satisfies AC1's "lint/boundary rule".

### Secrets (NFR-31)

- No logger redaction exists in `src/common` — secrets stay safe only because nothing logs them. The adapter must never log the client, options, request body with signature, or `err.headers`.
- Keys are only reachable via `EnvService.payosCredentials`; no controller/DTO/health endpoint exposes them (check `health` and any config-dump endpoint stays unchanged).
- Startup validation is in `env.schema.ts` `superRefine` (runs at boot via the config module) — "validated at startup when used" = any key set or `PAYOS_ENABLED=true`.

### Current state of files touched

- `economy.module.ts` — binds ports with `{ provide: X_PORT, useClass }` (e.g. `TOP_UP_REPOSITORY_PORT` ~l.179), factories with `inject` (~l.114-124), null objects with `useValue` (~l.131). Add one provider; change nothing else.
- `env.schema.ts` — Zod; `REWARDS_ENABLED: booleanEnv(false)` l.205, `REWARDS_ACCOUNTING_DECISION_REF` l.206; `superRefine` from l.363 (`isProduction` l.364; Rewards check l.418); placeholder secrets l.455-500. `env.service.ts` getters ~l.76-82.
- `test/architecture.spec.ts` — forbidden list l.7-15; `@google-cloud` portability test ~l.180 is the template for the new test.
- `top-up.service.ts`, `prisma-top-up.repository.ts` — manual flow; **untouched** in 13.2.

### Previous story intelligence (13.1, done, merged ec1d7b8)

- `TopUpRequest` already has `channel`, `orderCode` (int4, sequence from 1e9 → always 10 digits, JS-safe), `paymentLinkId` (unique), `expiresAt`, `amountPaidVnd`, `providerReference`, `paidAt`, `counterAccount*` (all nullable). Port field names mirror these columns 1:1 so 13.4 can write facts without renaming.
- `amount * 200 = amount_vnd` CHECK exists for PAYOS rows; `amountVnd` is the value sent to payOS.
- Review lesson: fill "Agent Model Used" in the Dev Agent Record.

### Testing standards

- Jest, co-located `*.spec.ts` under `src/`; `test/architecture.spec.ts` runs in the unit suite. No DB or HTTP needed for this story — no `*.prisma.e2e-spec.ts`.
- **No test may call the real payOS API** (no sandbox; real calls move real money). Mock the SDK client in adapter specs; the contract spec uses only the SDK's offline `webhooks.verify`.
- Build/lint: `npm run build --workspace backend`, `npm run lint --workspace backend`.

### Project Structure Notes

- New files: `application/ports/payment-provider.port.ts`; `infrastructure/payos-payment-provider.adapter.ts`, `payos-mapping.ts`, `fake-payment-provider.ts`, `unconfigured-payment-provider.ts` (+ specs); `test/fixtures/payos-webhook.fixture.ts`, `test/fixtures/payos-recorded/*.json`.
- Naming follows existing `prisma-*.ts` / `in-memory-*.ts` / `*.port.ts` conventions in `modules/economy`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.2] (l.1802–1816)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-25] (l.212–280: mapping table, Adapter and SDK, secrets), #AD-7 (l.118), #AD-10 (l.133, adapter retry rule), Stack (l.380)
- [Source: .../solution-design.md#PayOS Top-Up and Refund Flows] (l.295–370, slice 2, "Testing without a sandbox")
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md] FR-34 (l.571), FR-35 (l.585), NFR-31 (l.1282)
- [Source: .../addendum.md#12. PayOS Integration Notes] (l.358–385)
- [Source: _bmad-output/implementation-artifacts/13-1-top-up-schema-for-payos.md]
- [Source: @payos/node 2.0.5 tarball `lib/client.d.ts`, `lib/crypto/node-crypto.js`, `lib/resources/v2/payment-requests/*`, `lib/resources/webhooks/webhook.*`; https://github.com/payOSHQ/payos-lib-node; https://payos.vn/docs/api/]

## Dev Agent Record

### Agent Model Used

Gemini 3.8 Flash (Medium)

### Debug Log References

- `npm test --workspace backend -- payos payment-provider architecture env --runInBand`: 6 suites, 105 tests passed.
- `npm test --workspace backend -- --runInBand`: 164 suites, 2509 tests passed.
- `npm run build --workspace backend` and `npm run lint --workspace backend`: passed (existing TypeScript parser compatibility warning).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Added pinned payOS SDK, SDK-free port, safe provider mapping, HMAC verification, deterministic fake and unconfigured fallback; no payment caller added.
- Validated startup credentials, protected backend-only imports, documented inactive configuration.
- Fixture payloads normalized from payOS documentation and SDK types; Story 13.6 must add or replace with real production captures.
- SDK normalizes `logger: null` internally; `logLevel: off` prevents output.

### File List

- `apps/backend/package.json`
- `package-lock.json`
- `apps/backend/src/modules/economy/application/ports/payment-provider.port.ts`
- `apps/backend/src/modules/economy/infrastructure/payos-payment-provider.adapter.ts`
- `apps/backend/src/modules/economy/infrastructure/payos-mapping.ts`
- `apps/backend/src/modules/economy/infrastructure/fake-payment-provider.ts`
- `apps/backend/src/modules/economy/infrastructure/unconfigured-payment-provider.ts`
- `apps/backend/src/modules/economy/infrastructure/payos-payment-provider.adapter.spec.ts`
- `apps/backend/src/modules/economy/infrastructure/payos-payment-provider.contract.spec.ts`
- `apps/backend/src/modules/economy/infrastructure/payos-mapping.spec.ts`
- `apps/backend/src/modules/economy/infrastructure/fake-payment-provider.spec.ts`
- `apps/backend/src/common/config/env.schema.ts`
- `apps/backend/src/common/config/env.service.ts`
- `apps/backend/src/common/config/env.service.spec.ts`
- `apps/backend/src/modules/economy/economy.module.ts`
- `apps/backend/test/architecture.spec.ts`
- `apps/backend/test/fixtures/payos-webhook.fixture.ts`
- `apps/backend/.env.example`
- `deploy/.env.prod.example`
- `_bmad-output/implementation-artifacts/13-2-payment-provider-port-payos-adapter.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/backend/test/fixtures/payos-recorded/webhook-paid.json`
- `apps/backend/test/fixtures/payos-recorded/webhook-paid-null-counter-account.json`
- `apps/backend/test/fixtures/payos-recorded/payment-link-paid.json`
- `apps/backend/test/fixtures/payos-recorded/payment-link-underpaid.json`
- `apps/backend/test/fixtures/payos-recorded/payment-link-cancelled.json`

### Change Log

- 2026-10-15: Implemented Story 13.2 payment port, payOS provider, offline fixtures and tests; validated full backend suite.
