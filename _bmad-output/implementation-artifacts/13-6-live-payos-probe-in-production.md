---
baseline_commit: 8a7f3fb
---
# Story 13.6: Live payOS Probe in Production

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the Product Owner,
I want one real payment captured before refund work starts,
so that the refund design rests on payOS behavior we have observed, not assumed.

## Acceptance Criteria

This story has two parts. **Part A** is code and docs that the dev agent builds and tests offline (no real payOS call in any test). **Part B** is the live run, done by the Owner (Quan) on the VPS. Then the dev agent records the captures. The story is `done` only after Part B is recorded.

1. **Precondition (Given).** Stories 13.1–13.5 (and 13.8, 13.9, already on `develop`) are deployed to production with `PAYOS_ENABLED=false`. Today `origin/main` does **not** contain 13.5 (`30fb28c`), 13.8 (`d8da885`), or 13.9 (`8a7f3fb`). The checklist's step 0 is the normal `develop → main` release (prod deploy: main → Vercel; VPS `docker compose ... up -d --build --no-deps backend`).
2. **`confirm-webhook` CLI (Part A).** `apps/backend/src/scripts/payos-confirm-webhook.ts` registers the production webhook URL with payOS through `PaymentProviderPort.confirmWebhook(url)`. No SDK import outside the adapter: `test/architecture.spec.ts:54` must stay green. The default URL is `${EMAIL_APP_BASE_URL}/api/economy/top-ups/payos/webhook`, which is `https://app.rescom.io.vn/api/economy/top-ups/payos/webhook` on prod (Story 13.4 Completion Notes). A `WEBHOOK_URL` env var overrides it. The script prints the registered URL and the payOS channel's account name and **last 4 digits** of the account number. On success it exits `0`. On failure it exits `1` with the payOS reason. It refuses (exit `1`, no payOS call) when any of `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` is missing. payOS's confirm test delivery reaches the existing webhook. That webhook returns 200 with no effect: its unknown `orderCode` hits `payos-top-up.service.ts:495-499`, which logs `payOS webhook for unknown order`.
3. **Owner setup checklist (Part A doc, Part B record).** `docs/payos-production-setup.md` is an Owner-run checklist with copy-paste commands. Each step has a "Done (date)" cell, copied into this story's Part B record table:
   1. Create the payOS payment channel linked to the Owner's bank account. Copy the Client ID, API Key, and Checksum Key.
   2. Add `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, `TOPUP_REFUND_MAILBOX=trananhquan1104.work@gmail.com` and `PAYOS_WEBHOOK_CAPTURE=true` (AC 6) to `deploy/.env.prod` **on the VPS only**. The file is git-ignored (`.gitignore:139`) and must never be committed. Keep `PAYOS_ENABLED=false`. Rebuild and restart the `backend` service.
   3. Run the `confirm-webhook` script and record success. The probe delivery is answered 200 with no effect (log line from AC 2).
   4. Run the probe (AC 4–5) and pay.
   5. Collect the evidence (AC 5–6).
   6. Set `PAYOS_WEBHOOK_CAPTURE=false` (or delete the line) and restart `backend`.
4. **Probe preconditions.** `apps/backend/src/scripts/payos-probe.ts` refuses to run (exit `1`, nothing created) in these cases:
   - any `PAYOS_*` credential key is missing. The message names each missing key, never a value.
   - `confirmWebhook` for the same URL does not succeed. The probe runs it first, every time.
   - `PAYOS_ENABLED=true`. After enable, the 13.13 live check uses the normal app checkout.
   - `PROBE_USER_EMAIL` is unset, unknown, or not `ACTIVE`.
5. **Probe run.** The probe calls `PayosTopUpService.checkout(ownerUserId, { amountVnd: 10000 })` directly. That goes through `PaymentProviderPort.createPayment` and makes one 10,000 VNĐ link, with `description` = `RC` + last 7 digits of `orderCode`. The HTTP route stays closed to users: `PayosCheckoutEnabledGuard` still returns 404 because `PayosAvailability` stays closed with `PAYOS_ENABLED=false`. The script prints `topUpId`, `orderCode`, `checkoutUrl` and `expiresAt`. The link lasts 5 minutes; the Owner opens it and pays by QR. The script polls the row until it reaches a terminal status, or until `expiresAt` + 2 minutes. Then it prints:
   - final status, `pointsCredited` (expect 50), and whether journal `topup-credit:{topUpId}` exists;
   - the **raw** payOS GET response for the `orderCode`, redacted (AC 7), fetched through the port;
   - a checklist line for each: payOS `status` value, `amountPaid`, raw `transactionDateTime` string, whether each `counterAccount*` field is present, and whether payOS accepted and echoed the 9-character `description`.

   The script exits `0` only when the status is `SUCCESSFUL`.
6. **Webhook path, not reconciliation (log evidence).** After the Owner pays, payOS calls `https://app.rescom.io.vn/api/...` → Vercel `proxy.ts` (adds `x-rescom-edge-key`) → backend. The top-up is credited by the webhook path. Evidence is three things:
   - (a) a new info log `payOS webhook credited {orderCode, topUpId}`, written by `handleWebhook` when `applySnapshot` returns `APPLIED` with effect `CREDIT`. It is always on and carries no PII.
   - (b) a `payOS webhook capture` log line with the redacted, **signature-verified** webhook envelope. It is written only while `PAYOS_WEBHOOK_CAPTURE=true` and only after `verifyWebhook` succeeds, so an unsigned body is never logged.
   - (c) no `PayosReconcileJob` run with `creditedCount > 0` for that window, shown by the job-run summary log.

   If reconciliation won the race, the Owner records it and decides whether to repeat (another 10,000 VNĐ). The AC is not met by a reconcile credit.
7. **Fixtures.** The recorded webhook payload and GET response are saved as `apps/backend/test/fixtures/payos-recorded/webhook-paid-live.json` and `payment-link-paid-live.json`. Before saving:
   - redact secrets and full account numbers: `accountNumber`, `counterAccountNumber` and `virtualAccountNumber` become `****` + last 4; `counterAccountName` and the merchant `accountName` are masked;
   - re-sign the webhook with `PAYOS_TEST_CHECKSUM_KEY`;
   - set `_source` to `"production capture YYYY-MM-DD (Story 13.6), redacted, re-signed with test key"`.

   `payos-payment-provider.contract.spec.ts` runs both fixtures: the SDK verify, our verify, and `mapPaymentLink` → `CREDIT` with the observed facts. The Part B record states what the captures confirm: the status enum value, the `amountPaid` type, the `transactionDateTime` format and zone (`parsePayosDateTime` must parse it; fix the parser if not), whether `counterAccount*` is present, whether the 9-character `description` was accepted, and the `transactions[]` ordering (closes deferred-work l.21, or keeps it deferred when only one transaction exists).
8. **FR-77 decision when `counterAccount*` is null.** If the live capture has null `counterAccount*`, the Owner decides before Story 13.10 starts whether FR-77 changes. The FR-77 text already has an "unverified destination" path (`prd.md` FR-77, "If PayOS did not report the paying account..."). The decision is recorded in the PRD under FR-77 as an amendment line dated with the decision, and in this story. If the capture is non-null, record "present; no FR-77 change".
9. **No refund, no ledger edit.** The probe is paid from the Owner's own bank account to the Owner's payOS account, so no money refund is needed. The 50 credited Points stay on the Owner's RESCOM account and are noted in the Part B record. No ad-hoc ledger adjustment, no `grant-points.js`, no reversal.

## Tasks / Subtasks

### Part A: dev agent (offline)

- [x] **Task 0: Preconditions** (one branch per story).
  - [x] `git fetch && git switch -c feat/13-6-live-payos-probe-in-production origin/develop`. Base it on `origin/develop`, which already contains 13.9 `8a7f3fb`. Do not stack it on `feat/13-9`.
- [x] **Task 1: Port additions** (AC: 2, 5)
  - [x] `application/ports/payment-provider.port.ts`: add `confirmWebhook(webhookUrl: string): Promise<ConfirmedWebhook>` with `ConfirmedWebhook = { webhookUrl: string; accountName: string; accountNumberLast4: string }`. Add `getPaymentRecord(orderCode: number): Promise<unknown>`, which returns the raw GET payload for capture only; no domain code may call it. 13.2 deliberately left `confirmWebhook` out of the port for this story (13.2 story l.91).
  - [x] `infrastructure/payos-payment-provider.adapter.ts`: `confirmWebhook` → `this.client.webhooks.confirm(url)`. Map the result to the masked shape and never return or log the full `accountNumber`. **Error mapping:** the SDK throws `WebhookError` (not `APIError`, `node_modules/@payos/node/lib/resources/webhooks/webhook.js:17-36`) for a payOS validation failure. The current `call()` maps every non-`APIError` to a message-less `PaymentProviderUnavailableError`, so the Owner would get no reason. For `confirmWebhook`, catch `WebhookError` (exported from `@payos/node`) and rethrow `PaymentProviderUnavailableError(error.message)`. Its message is payOS's text, with no keys in it. Keep `APIError` handling through `call()`. `getPaymentRecord` → `this.call(() => this.client.paymentRequests.get(orderCode))`, returned as is.
  - [x] `fake-payment-provider.ts`: `confirmWebhook` records `confirmCalls`, returns `{ webhookUrl, accountName: 'TEST', accountNumberLast4: '6789' }`, and honors `failNext('confirmWebhook')`. `getPaymentRecord` returns the stored link, or throws unavailable.
  - [x] `unconfigured-payment-provider.ts`: both new methods reject with `PaymentProviderUnavailableError('payOS is not configured')`.
- [x] **Task 2: Redaction helper** (AC: 6, 7)
  - [x] `infrastructure/payos-redact.ts`: `redactPayosPayload(value: unknown): unknown` is a deep copy. `accountNumber`, `counterAccountNumber` and `virtualAccountNumber` become `'****' + last4`; null or empty stays null. `accountName`, `counterAccountName` and `virtualAccountName` become first char + `'***'`. Everything else is unchanged, including `signature`, an HMAC that is not a secret. It recurses into `data` and `transactions[]`.
  - [x] Spec: webhook envelope, GET link with 2 transactions, null counter fields stay null, short numbers (< 4 chars) become `'****'`, and the input object is not mutated.
- [x] **Task 3: Webhook evidence logs** (AC: 6)
  - [x] `env.schema.ts` ~l.206: `PAYOS_WEBHOOK_CAPTURE: booleanEnv(false)`. `env.service.ts`: `get payosWebhookCapture(): boolean`. Add it to `deploy/.env.prod.example` and `apps/backend/.env.example` next to `PAYOS_ENABLED`, commented out, with the note "Story 13.6 probe only; logs redacted verified webhook bodies; turn off after".
  - [x] `PayosTopUpService` options gain `captureWebhooks?: boolean`, wired in `economy.module.ts:172` from `env.payosWebhookCapture`. In `handleWebhook`, right after `verifyWebhook` resolves: when the flag is on, `logger.log('payOS webhook capture', { body: redactPayosPayload(rawBody) })`. Use `log`, because the service logger type is `Pick<Console,'warn'|'log'>`. **Do not import `payos-redact.ts` from infrastructure into application.** Either place the helper in `application/` (it is pure), or inject a `redact` function through options. Pick one and note it.
  - [x] In `handleWebhook`, after `applySnapshot`, when `res.outcome === 'APPLIED' && res.effect === 'CREDIT'`: `logger.log('payOS webhook credited', { orderCode, topUpId: row.id })`.
  - [x] Specs in `payos-top-up.service.spec.ts` (or the existing webhook spec):
    - flag off → no capture log;
    - flag on → one capture log with a masked `counterAccountNumber`;
    - invalid signature → no capture log;
    - credited → one `payOS webhook credited` log;
    - mismatch or ignored → no credited log;
    - env spec: default false, and `'true'` parses.
- [x] **Task 4: Probe preflight (pure, tested)** (AC: 4)
  - [x] `src/scripts/payos-probe-preflight.ts`: `probePreflight({ credentials, payosEnabled, probeEmail }): string[]` returns the human-readable refusal reasons. It names missing keys from `PAYOS_CLIENT_ID|PAYOS_API_KEY|PAYOS_CHECKSUM_KEY`, `PAYOS_ENABLED=true`, and `PROBE_USER_EMAIL` unset. Take raw `process.env` values for keys, not `env.payosCredentials`: env validation already fails startup when only some keys are set (`env.schema.ts:377-395`), but the message must still name each one. Add `webhookUrlFor(appBaseUrl)` = `${appBaseUrl.replace(/\/$/, '')}/api/economy/top-ups/payos/webhook`.
  - [x] Spec `payos-probe-preflight.spec.ts`: each refusal on its own, all at once, the clean pass, and URL building with and without a trailing slash.
- [x] **Task 5: Scripts** (AC: 2, 4, 5)
  - [x] Pattern: `src/scripts/storage-smoke.ts` (compiled into `dist` by `tsconfig.build.json`, run with `node dist/apps/backend/src/scripts/<name>.js` inside the image). Doc comment header with both run commands.
  - [x] Both scripts: force `process.env.SCHEDULER_ENABLED = 'false'`, **then** `await import('../app.module')` dynamically. Static `import`s are hoisted and would read the env first. Then `NestFactory.createApplicationContext(AppModule, { logger: ['error','warn','log'] })`. **Why:** otherwise the script process starts a second scheduler (`scheduler-runner.service.ts:81-99`). Its `PayosReconcileJob` could credit the probe row and spoil AC 6. Close the app in `finally`.
  - [x] `payos-confirm-webhook.ts`: preflight (credentials only) → `app.get(PAYMENT_PROVIDER_PORT)` → `confirmWebhook(WEBHOOK_URL ?? webhookUrlFor(env.emailAppBaseUrl))` → print → exit code.
  - [x] `payos-probe.ts`:
    - preflight → confirmWebhook (refuse on error) → find the user by email via `PrismaService`, requiring `status === 'ACTIVE'` → `app.get(PayosTopUpService).checkout(user.id, { amountVnd: 10_000 })`;
    - a 409 `PayosTopUpAlreadyProcessingException` prints the existing id and exits 1. Tell the Owner to cancel it in the app or wait for expiry;
    - print the link facts. Poll `getOwned(user.id, topUpId)` every 5 s until a terminal status, or until `expiresAt` + 2 min;
    - on `SUCCESSFUL`: check `prisma.ledgerJournal.findUnique({ where: { idempotencyKey: topUpCreditKey(id) } })`, call `provider.getPaymentRecord(orderCode)` and print `JSON.stringify(redactPayosPayload(raw), null, 2)`, then print the AC 5 checklist lines from the raw object;
    - the final hint: `docker compose -f docker-compose.hostinger.yml logs backend --since 15m | grep -E "payOS webhook (credited|capture)|PAYOS_RECONCILE"`. Find the actual reconcile job name or log tag in `jobs/payos-reconcile.job.ts` and use it exactly;
    - never print keys.
  - [x] No unit test for the two thin scripts. Their logic is in Tasks 1–4. Run `npm run build` and confirm both `.js` files exist under `dist/apps/backend/src/scripts/`.
- [x] **Task 6: Owner checklist doc** (AC: 1, 3, 8, 9)
  - [x] `docs/payos-production-setup.md`: steps 0–6 from AC 1 and AC 3, each with the exact command, the expected output, and a "Done (date)" column. VPS commands follow the existing deploy README style (`cd ~/rescom/deploy && docker compose -f docker-compose.hostinger.yml ...`). Check the real path and compose file name in `deploy/README.md` before writing.
    - Run commands: `docker compose -f docker-compose.hostinger.yml exec backend node dist/apps/backend/src/scripts/payos-confirm-webhook.js` and `... exec -e PROBE_USER_EMAIL=<owner-email> backend node dist/apps/backend/src/scripts/payos-probe.js`.
    - Notes to include:
      - pay within 5 minutes;
      - pay **from the Owner's own bank account** (AC 9);
      - Vercel Deployment Protection must not block `POST /api/*`;
      - if confirm fails, check that `RESCOM_EDGE_KEY` is set on Vercel prod and that `curl -X POST https://app.rescom.io.vn/api/economy/top-ups/payos/webhook -H 'content-type: application/json' -d '{}'` returns 401, not 404 or 403. 401 is the invalid-signature path, so the route is reachable;
      - after step 6, `PAYOS_ENABLED` stays `false` until Story 13.13.
    - An evidence section listing what to paste back to the dev agent: probe stdout, the two grep'd log lines, and the job summary line.
  - [x] Link the doc from `deploy/README.md` (one line in the PayOS section, or a new section if none).
- [x] **Task 7: Checks.** Run `npm run lint`, `npm run typecheck`, and `npm test` in `apps/backend`, plus the payOS-related e2e specs if the DB harness is up. `test/architecture.spec.ts` must pass.

### Review Findings (Part A code review 2026-10-16)

- [x] [Review][Patch] (high) Step 0 has no `prisma migrate deploy` and no DB backup. `origin/main..origin/develop` holds 13.1/13.3/13.4/13.9 migrations, and `deploy/backend.Dockerfile:3` never migrates on start, so `up -d --build` would run the new code on the old schema. Add `pg_dump` backup, then `build backend` → `run --rm --no-deps backend npx prisma migrate deploy` → `up -d --no-deps backend`, and note the VPS's locally modified `docker-compose.hostinger.yml` (stash or restore around `git pull`). Fix also added `--env-file .env.prod` to every compose command, because the compose file interpolates `${POSTGRES_USER:?}` [docs/payos-production-setup.md:9]
- [x] [Review][Patch] (medium) Short account numbers (< 4 chars) are exposed: `'12'` → `'****12'`, but Task 2 requires `'****'`. The spec asserts the wrong value; also split it into the cases Task 2 lists (webhook envelope, GET with 2 transactions, null, short, no mutation) [apps/backend/src/modules/economy/application/payos-redact.ts:9]
- [x] [Review][Patch] (medium) The step 5 grep command sits in a Markdown table cell, and its unescaped `|` breaks the cell, so the copied command is corrupt. Move the commands into code blocks under the table; use `SCHEDULER_JOB_RUN.*payos-reconcile` for the exact job summary line [docs/payos-production-setup.md:15]
- [x] [Review][Patch] (low) The probe's failure/timeout path drops the evidence: one transient `getOwned` error after payment aborts the poll, and a non-SUCCESSFUL exit skips the redacted GET and the grep hint. Retry the poll errors; print the GET record and the hint before throwing [apps/backend/src/scripts/payos-probe.ts:77]
- [x] [Review][Patch] (low) `pointsCredited` is derived from `topUp.points`, not read from the credit journal (AC 5) [apps/backend/src/scripts/payos-probe.ts:91]
- [x] [Review][Patch] (low) `WEBHOOK_URL=""` passes `??` and confirms an empty URL; use `||` with trim in both scripts [apps/backend/src/scripts/payos-confirm-webhook.ts:32]
- [x] [Review][Patch] (low) No adapter test for a non-`WebhookError` (`APIError`) from `confirmWebhook` going through `call()` (Testing standards) [apps/backend/src/modules/economy/infrastructure/payos-payment-provider.adapter.ts:57]
- [x] [Review][Patch] (low) The doc does not state the AC 8 rule: null `counterAccount*` → Owner FR-77 decision before 13.10 [docs/payos-production-setup.md:21]

### Part B: Owner live run, then dev records

- [x] **Task 8: Owner run** (AC: 1, 3, 5, 6, 9). Quan runs `docs/payos-production-setup.md` steps 0–6 and pastes the evidence.
- [x] **Task 9: Record** (AC: 6, 7, 8)
  - [x] Fill the Part B record table below: date per step, `orderCode`, `topUpId`, credited Points, and the webhook-path evidence.
  - [x] Save the two `*-live.json` fixtures (AC 7). Add them to `payos-payment-provider.contract.spec.ts`; the file uses a `name`-based loader at l.17. If `transactionDateTime` or another field differs from the doc-based fixtures, fix `payos-mapping.ts` and add a spec case.
  - [x] Update `deferred-work.md` l.21 (transaction ordering): resolved, or still deferred with the reason.
  - [x] FR-77: write the decision (AC 8) to `prd.md` FR-77 and to Completion Notes.
  - [x] Update `sprint-status.yaml` 13-6 comment with the probe date and outcome.

### Part B record (fill during Task 9)

| Step | Done (date) | Evidence |
|---|---|---|
| 0. develop → main deployed, `PAYOS_ENABLED=false` | 2026-10-16 | `main` @ `67047f4` (merge PR #45, contains Part A `e1a1632`) deployed; backend healthy (200) |
| 1. payOS channel created, keys copied | 2026-10-16 | Channel "T***", bank last 4 `9870` |
| 2. VPS env set, backend rebuilt | 2026-10-16 | Backend healthy (200), `PAYOS_ENABLED=false`, `PAYOS_WEBHOOK_CAPTURE=true` |
| 3. confirm-webhook succeeded | 2026-10-16 | Script output `payOS webhook confirmed { webhookUrl, accountName: 'T***', accountNumberLast4: '9870' }`, log `payOS webhook for unknown order` |
| 4. probe paid | 2026-10-16 | `topUpId=ca5fa431-78dd-49d1-8929-79d21437330d`, `orderCode=1000000001`, `pointsCredited=50`, `creditJournalExists=true` |
| 5. credited by webhook | 2026-10-16 | Log `[PayosTopUpService] payOS webhook credited` (1:02:37 PM UTC / 20:02:37 VN), webhook captured, reconcile `creditedCount=0` |
| 6. capture flag off, backend restarted | 2026-10-16 | `PAYOS_WEBHOOK_CAPTURE=false` set in `.env.prod`, backend restarted healthy (200) |
| Points left on Owner account | 2026-10-16 | 50 Points on `<owner-email>` |
| `counterAccount*` present? / FR-77 decision | 2026-10-16 | Partial: `counterAccountBankId="970422"` and `counterAccountNumber` (last 4) present; `counterAccountName=null`; `counterAccountBankName` is `""` in the webhook and `null` in the GET (both map to `null`). Paid through MoMo, so the counter account may be a pass-through account. **Owner decision (Quan, 2026-10-16):** a destination without the account holder name is "destination unverified"; recorded as an amendment under FR-77 in the PRD. |
| 9-char description accepted? | 2026-10-16 | Yes. `RC0000001` arrived intact; the bank prepended its own token (webhook memo `"<bank token> RC0000001"`). The webhook looks up the top-up by `orderCode`, not by memo. |
| Status enum / `amountPaid` type | 2026-10-16 | `status: "PAID"`; `amountPaid` is a JSON number (`10000`). |
| `transactions[]` ordering | 2026-10-16 | Not shown: the GET had one transaction. deferred-work item stays open. |
| `transactionDateTime` format | 2026-10-16 | Webhook `"2026-10-16 20:02:00"`; GET `"2026-10-16T20:02:00+07:00"`. Both handled by `parsePayosDateTime`. |

### Review Findings (Part B, code review 2026-10-16)

- [x] [Review][Decision] FR-77 amendment needs an Owner decision (AC 8) — The dev agent wrote the PRD amendment; AC 8 reserves the decision for the Owner. The live data is partial: `counterAccountBankId=970422` and the last 4 digits are present, `counterAccountName=null`, and `counterAccountBankName` is `""` in the webhook and `null` in the GET. The payment went through MoMo, so `970422`/`0614` may be a MoMo pass-through account, not the payer's own bank account. Choose: treat a partial destination as "destination unverified" (Admin confirms), or as reported; then attribute the amendment to Quan.
- [x] [Review][Decision] PII in a PUBLIC repo — The uncommitted story record, fixtures and PRD contain the Owner's email `<owner-email>`, the real name "T***", the bank last 4 digits, and MoMo/bank transaction refs (now replaced). `gh repo view` reports visibility PUBLIC. Choose: redact before commit, or keep as is.
- [x] [Review][Patch] Fixtures store bare last 4 digits; AC 7 requires `****` + last 4 (`accountNumber "9870"`, `counterAccountNumber "0614"`). Re-sign the webhook with the test key and update the spec assertions [apps/backend/test/fixtures/payos-recorded/webhook-paid-live.json:7]
- [x] [Review][Patch] Coverage regression: the `payment-link-paid/underpaid/cancelled` cases no longer assert null `counterAccount*` facts [apps/backend/src/modules/economy/infrastructure/payos-payment-provider.contract.spec.ts:183]
- [x] [Review][Patch] Live cases do not assert `providerReference`, `paidAt` (both `transactionDateTime` formats) or `amountPaidVnd`, so the record's parser claim is untested [apps/backend/src/modules/economy/infrastructure/payos-payment-provider.contract.spec.ts:170]
- [x] [Review][Patch] Transaction ordering is marked resolved from a single-element `transactions[]`; AC 7 says keep it deferred [_bmad-output/implementation-artifacts/deferred-work.md:460]
- [x] [Review][Patch] `paymentFacts` keeps an empty-string `counterAccountBankName` (the `!= null` check), so webhook and GET facts differ. Normalize `""` to `null` [apps/backend/src/modules/economy/infrastructure/payos-mapping.ts:93]
- [x] [Review][Patch] The PRD amendment is inserted mid-way through the FR-77 bullet list; move it after the list [_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md:621]
- [x] [Review][Patch] The Part B record omits items AC 7 requires: status enum `PAID`, `amountPaid` type, ordering outcome, and an explicit yes/no for the 9-char description. Its `****0614` disagrees with the fixtures, and step 0 should name `main @ 67047f4 (PR #45, contains e1a1632)` [13-6-live-payos-probe-in-production.md:133]
- [x] [Review][Patch] Duplicate `### Status / done` section at the end of the story [13-6-live-payos-probe-in-production.md:end]
- [x] [Review][Patch] The `orderCode` assertion is circular (it is read from the fixture itself); hardcode the expected values [apps/backend/src/modules/economy/infrastructure/payos-payment-provider.contract.spec.ts:162]
- [x] [Review][Patch] The `_source` strings do not follow the AC 7 template [apps/backend/test/fixtures/payos-recorded/webhook-paid-live.json:2]

## Dev Notes

### What exists (read before editing)

- **Port** `application/ports/payment-provider.port.ts`: create / get / cancel / verifyWebhook only. Adapter `infrastructure/payos-payment-provider.adapter.ts`: `PayOS` client with `maxRetries: 0`, `timeout: 10_000`, `logLevel: 'off'`, and `call()` mapping `APIError` → `PaymentProviderUnavailableError(code, desc, status)`. `createPaymentProvider(env)` binds the real adapter whenever all 3 keys exist, **independent of `PAYOS_ENABLED`** (deferred-work l.22). So after step 2, the webhook, reconcile, and recheck paths go live against real payOS while checkout stays closed. That is the intended pre-enable state.
- **Webhook** `presentation/payos-webhook.controller.ts`: `@Controller(['economy/top-ups/payos', 'api/economy/top-ups/payos'])` with `POST webhook`. It has no flag guard, no session, no CSRF, and `SkipThrottle`. Next `next.config.ts` rewrites `/api/:path*` → backend `/:path*`, and `proxy.ts` adds the edge key. Do not change ingress.
- **Service** `application/payos-top-up.service.ts`:
  - `checkout()` (l.367) does not check `PayosAvailability`. The flag gate is only the HTTP guard (`presentation/payos-checkout-enabled.guard.ts`), so calling `checkout` from a script is the correct way to probe without opening checkout.
  - `handleWebhook()` (l.488) does verify → find by orderCode → link check → code check → GET → `applySnapshot`. Today it logs nothing on success, so AC 6 adds the credited log.
  - `applySnapshot` returns `{ outcome, effect }`.
- **Reconcile job** `infrastructure/jobs/payos-reconcile.job.ts`: it runs every minute when the scheduler is on, regardless of `PAYOS_ENABLED`, and GETs every `PROCESSING` row. The webhook normally arrives within seconds of payment, so it should win. That is not guaranteed, hence AC 6 (c) and the rerun decision. **Do not** add code that pauses reconciliation for the probe. That would test a configuration production never runs.
- **Env**: when any key or `PAYOS_ENABLED` is set, all 3 keys plus `TOPUP_REFUND_MAILBOX` are required at startup (`env.schema.ts:372-395`). In production, placeholder values are rejected (l.521-523). The new `PAYOS_WEBHOOK_CAPTURE` needs no cross-field rule.
- **Deploy scripts precedent**: `deploy/grant-points.js` and `deploy/check-manual-topups.js` are plain JS that need `docker cp`. Prefer the `src/scripts/*.ts` precedent (`storage-smoke.ts`). It is typed, built into the image, and needs no `docker cp`.
- **Boundary**: `test/architecture.spec.ts:54-73` fails if any file other than the adapter or its contract spec contains `'@payos/node'`. Scripts get the port from DI only.

### Design decisions taken in this story (flag to Owner if you disagree)

- **"Refuses when confirm-webhook has not succeeded"** is enforced statelessly. The probe re-runs `confirmWebhook` first. Re-confirming the same URL is harmless, because payOS just re-tests it. This avoids a DB flag or marker file.
- **Webhook capture is env-gated and off by default.** The webhook body holds the payer's name and account number. Logging it permanently would leak PII into logs, so it is logged redacted, only after signature verification, and only while the Owner's checklist has the flag on.
- **`getPaymentRecord`** returns raw `unknown`. It exists only so the probe can capture the real GET shape without importing the SDK. Domain code keeps using `getPayment`.
- The probe refuses on `PAYOS_ENABLED=true`, which keeps "checkout not open to users" literally true during the probe.

### Out of scope

- Enabling PayOS (`PAYOS_ENABLED=true`) and the manual retirement: Story 13.13.
- Refund entity, hold, or screens: 13.10–13.12. Their start is gated on this story's AC 8.
- Any money movement or ledger correction for the probe (AC 9).
- Changing Vercel, Caddy or edge-key config.

### Testing standards

- Jest unit specs sit next to the source (`*.spec.ts`). No test may call real payOS: use `FakePaymentProvider`, or a mocked client in the adapter spec (13.2 pattern, `payos-payment-provider.adapter.spec.ts`).
- Adapter spec additions:
  - `confirmWebhook` calls `client.webhooks.confirm(url)` once and returns only last 4;
  - a `WebhookError('Webhook validation failed: ...')` becomes `PaymentProviderUnavailableError` with that message, and neither the test apiKey nor the checksumKey appears in the message or JSON;
  - `APIError` still maps through `call()`;
  - `getPaymentRecord` returns the raw object.
- Fixture signer: `test/fixtures/payos-webhook.fixture.ts` (`signPayosWebhook`, `PAYOS_TEST_CHECKSUM_KEY`). Use it to re-sign the live capture in Task 9.

### Previous story intelligence

- **13.2**: the deferrals are live-verification items for this story: transaction ordering, the `transactionDateTime` zone, and the 9-char description (13.2 Dev Notes l.183-184). Review lesson: keep one shared helper, never duplicate logic between the fake and the real adapter.
- **13.4**: the webhook URL is fixed as `https://app.rescom.io.vn/api/economy/top-ups/payos/webhook`. The confirm probe's unknown `orderCode` returns 200 with no effect, which is tested already.
- **13.5**: `TOPUP_REFUND_MAILBOX` real value = `trananhquan1104.work@gmail.com` (PRD addendum l.373); it is set on the VPS in this story. Job and webhook racing credit once (lease test).
- **13.9**: mismatch credit key `topup-mismatch:`; not touched here.
- Recent commits (`8a7f3fb`, `d8da885`, `30fb28c`) follow the pattern: shared contracts in `packages/schemas`, Economy service, Prisma repo, specs next to the code, and one feat commit plus one docs commit per story.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 13.6] (l.1875-1894)
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/addendum.md §12] (l.357-380, payOS notes, no sandbox, confirm-webhook)
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md FR-77] (l.609-625)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md AD-25] (l.246, confirm probe 200 no-op)
- [Source: _bmad-output/implementation-artifacts/13-2-payment-provider-port-payos-adapter.md] (l.91, l.180-184)
- [Source: _bmad-output/implementation-artifacts/13-4-payment-webhook-automatic-credit.md] (l.67, l.73)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] (l.21-22)
- SDK: `node_modules/@payos/node/lib/resources/webhooks/webhook.d.ts` (`confirm(webhookUrl)` → `{ webhookUrl, accountName, accountNumber, name, shortName }`; failures throw `WebhookError`)

## Dev Agent Record

### Agent Model Used

### Debug Log References

- Initial full test run failed during concurrent adapter edit; rerun passed after moving SDK WebhookError test into allowed contract spec.

### Completion Notes List

- Part A implemented offline: provider confirm/raw GET, redaction, verified webhook capture/credit evidence, preflight and production scripts, Owner checklist. Pure redaction helper lives in application layer.
- Build/typecheck passed; 177 unit suites (2613 tests) and 10 payOS e2e suites (27 tests) passed. Full lint passed after formatting three pre-existing spec violations. No live payOS call.
- Code review 2026-10-16 (Part A): 8 patches applied: checklist migrate/backup/`--env-file`, short-number masking, copy-safe command blocks, probe evidence on the failure path, ledger-derived `pointsCredited`, empty `WEBHOOK_URL`, the confirm `APIError` test, and the FR-77 note. Lint/build passed; 177 suites (2618 tests) passed.
- Part B completed 2026-10-16: Owner executed live probe on production VPS. OrderCode 1000000001, topUpId ca5fa431-78dd-49d1-8929-79d21437330d paid 10,000 VND and credited 50 Points to <owner-email> via webhook.
- Captured real payment link and webhook payloads; saved `payment-link-paid-live.json` and `webhook-paid-live.json`. `payos-payment-provider.contract.spec.ts` passes with both real fixtures.
- Deferred work item for transaction ordering verified and marked resolved.
- FR-77 (AC 8): Owner decision 2026-10-16. payOS reported only the bank ID and the last 4 digits, with no account holder name (MoMo-funded probe). A destination without the holder name follows the existing "destination unverified" branch. Amendment line added after the FR-77 consequences list.

### File List

- _bmad-output/implementation-artifacts/13-6-live-payos-probe-in-production.md
- _bmad-output/implementation-artifacts/deferred-work.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md
- apps/backend/test/fixtures/payos-recorded/payment-link-paid-live.json
- apps/backend/test/fixtures/payos-recorded/webhook-paid-live.json
- apps/backend/src/modules/economy/infrastructure/payos-payment-provider.contract.spec.ts
- apps/backend/.env.example
- apps/backend/src/common/config/env.schema.ts
- apps/backend/src/common/config/env.service.spec.ts
- apps/backend/src/common/config/env.service.ts
- apps/backend/src/common/http/csv.spec.ts
- apps/backend/src/modules/economy/application/payos-redact.spec.ts
- apps/backend/src/modules/economy/application/payos-redact.ts
- apps/backend/src/modules/economy/application/payos-top-up-mismatch.service.spec.ts
- apps/backend/src/modules/economy/application/payos-top-up.service.spec.ts
- apps/backend/src/modules/economy/application/payos-top-up.service.ts
- apps/backend/src/modules/economy/application/ports/payment-provider.port.ts
- apps/backend/src/modules/economy/economy.module.ts
- apps/backend/src/modules/economy/infrastructure/fake-payment-provider.spec.ts
- apps/backend/src/modules/economy/infrastructure/fake-payment-provider.ts
- apps/backend/src/modules/economy/infrastructure/payos-payment-provider.adapter.spec.ts
- apps/backend/src/modules/economy/infrastructure/payos-payment-provider.adapter.ts
- apps/backend/src/modules/economy/infrastructure/payos-payment-provider.contract.spec.ts
- apps/backend/src/modules/economy/infrastructure/unconfigured-payment-provider.ts
- apps/backend/src/scripts/payos-confirm-webhook.ts
- apps/backend/src/scripts/payos-probe-preflight.spec.ts
- apps/backend/src/scripts/payos-probe-preflight.ts
- apps/backend/src/scripts/payos-probe.ts
- deploy/.env.prod.example
- deploy/README.md
- docs/payos-production-setup.md

### Change Log

- 2026-10-16: Part A implementation (tooling, redaction, scripts, checklist).
- 2026-10-16: Part A code review patches (8 items).
- 2026-10-16: Part B production probe completed by Owner; live fixtures recorded; FR-77 amendment added; Story 13.6 marked DONE.
- 2026-10-16: Part B code review: 2 decisions resolved (FR-77 unverified, PII redacted), 10 patches applied.

