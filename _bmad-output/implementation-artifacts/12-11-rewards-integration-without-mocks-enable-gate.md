---
baseline_commit: 45983a3
---

# Story 12.11: Rewards Integration Without Mocks & Enable Gate

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the Product Owner,
I want Rewards proven end to end on the real stack before it is enabled,
so that the pilot economy is not put at risk.

## Acceptance Criteria

1. **Mock-off journeys.** Given Stories 12.1–12.10, 12.12, and 12.13 are done, when Rewards journeys run with mocks disabled, then browse, redeem (success and every failure code), my vouchers, faulty-code resolution (user report and Admin queue), Admin catalog, Flash Sale, and statistics pass against the real backend.
2. **Statistics API.** The statistics API backs the Admin dashboard (`GET /admin/rewards/stats`, response parsed by `rewardsStatsSchema`).
3. **Flash load test.** A load test of concurrent redemptions on one Flash voucher at start time records p95 latency and confirms no oversell and no double charge on the pilot VPS profile.
4. **Feature flag and enable gate.** Rewards sits behind a feature flag that is off by default. Production enable requires the PRD Open Question 24 decision (accounting and tax) to be recorded. The Ví điểm copy says that Points are never withdrawn as cash.

Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 → Story 12.11 (FR-68…FR-75, AD-24). Sprint change proposal 2026-10-13 §4–5 (success criteria: "The Flash load test records p95 latency and shows zero oversell"; "Rewards stays behind a flag that is off by default until 11.5 is done and OQ-24 is recorded").

**Definition of done for this story:** the flag exists and is **off** everywhere by default, the gate is enforced in code, and the evidence pack exists. Turning the flag **on in production** is an owner action after Story 11.5 and the OQ-24 decision, outside this story. Do not enable it in `deploy/.env.prod` or in Vercel.

## Gate status at story creation (2026-10-14, `origin/develop` @ 45983a3)

| Precondition | State | Blocks |
|---|---|---|
| 12.1 Rewards contracts & MSW | `review` | AC 1 sign-off |
| 12.6 Admin Flash Sale & stats (FE mock) | `in-progress` (Task 8.2 browser check partial) | Part B, AC 1 |
| 12.12 Admin code-issue queue contract & MSW | `backlog` | Part D (code-issue de-mock), AC 1 |
| 12.13 Admin code-issue queue screen | `backlog`, needs a new Figma page first | Part D, AC 1 |
| 11.5 Pilot launch readiness | `backlog` | production enable only (not this story) |
| PRD OQ-24 accounting/tax | unanswered | production enable only; Part A enforces it |

Parts A, B, C, and E1 can be built now. Part D and the final evidence (E2–E4) need 12.12 and 12.13 done. See Task 0.

## Tasks / Subtasks

- [ ] **Task 0: Branch, baseline, and dependency gate** (AC: all)
  - [ ] 0.1 Branch `feat/12-11-rewards-integration-without-mocks-enable-gate` exists, cut from `origin/develop` @ `45983a3` (12.10 merged, PR #27), upstream unset. Re-run `git status --short --branch` and `git fetch` before the first edit; rebase onto `origin/develop` if 12.12/12.13 merged since.
  - [ ] 0.2 Read `sprint-status.yaml`. If 12.12 or 12.13 is not `done`, build Parts A, B, C, and E1 only, leave Part D and E2–E4 unchecked, and set this story to `in-progress` with a Completion Note naming the blocker. Never mark AC 1 met with a mocked code-issue screen.
  - [ ] 0.3 If 12.12 added `GET/GET :id/POST :id/resolve /admin/rewards/code-issues` to `DEFERRED_KEEP_MOCK`, the count is 44, not 41. Use the real count in every assertion below.

### Part A — Feature flag and enable gate (AC 4)

- [ ] **Task 1: Backend flag `REWARDS_ENABLED`** (AC: 4)
  - [ ] 1.1 `apps/backend/src/common/config/env.schema.ts`: add `REWARDS_ENABLED: booleanEnv(false)` and `REWARDS_ACCOUNTING_DECISION_REF: z.string().trim().min(1).optional()` beside `SCHEDULER_ENABLED` (~line 203), with a comment naming Story 12.11 and PRD OQ-24.
  - [ ] 1.2 Production refine (same `superRefine` block as `SCHEDULER_ENABLED`, ~line 413): when `NODE_ENV=production` and `REWARDS_ENABLED=true` and `REWARDS_ACCOUNTING_DECISION_REF` is empty, add an issue on `REWARDS_ACCOUNTING_DECISION_REF` with the message "REWARDS_ACCOUNTING_DECISION_REF is required to enable Rewards in production: record the PRD Open Question 24 accounting/tax decision". This is the mechanical "production enable requires OQ-24" gate.
  - [ ] 1.3 `env.service.ts`: getters `rewardsEnabled` and `rewardsAccountingDecisionRef`, same style as `schedulerEnabled` (~line 72).
  - [ ] 1.4 New `apps/backend/src/modules/rewards/presentation/rewards-enabled.guard.ts`: `CanActivate` that throws `NotFoundException` when `!env.rewardsEnabled`. Apply it **first** in the class-level `@UseGuards(...)` of all six Rewards controllers (`rewards-catalog`, `rewards-redemption`, `rewards-my-vouchers`, `admin-rewards-vouchers`, `admin-rewards-flash-sales`, `admin-rewards-code-issues`) and of the new stats controller (Task 4). Off means 404 for everyone, even unauthenticated callers, so the API does not reveal the feature. Use the existing 404 error body shape from `http-exception.filter.ts` (do not invent a new code).
  - [ ] 1.5 `rewards-scheduler.registrar.ts`: register `FlashSaleLifecycleJob` and `VoucherReminderJob` only when `env.rewardsEnabled`. Keep `rewards-outbox.registrar.ts` handlers registered: already-written Outbox events must still drain.
  - [ ] 1.6 `apps/backend/test/setup-e2e.ts`: set `process.env.REWARDS_ENABLED ??= 'true'` so the existing Rewards e2e and PG suites keep passing. Add one e2e case that boots with `REWARDS_ENABLED=false` and asserts 404 on one user route and one Admin route, including with a valid admin session.
  - [ ] 1.7 Env spec (the spec that covers `SCHEDULER_ENABLED` production refusal, IR.5 E3.1): production + `REWARDS_ENABLED=true` without the ref ⇒ error; with the ref ⇒ ok; production + `REWARDS_ENABLED=false` ⇒ ok; default is `false`.
  - [ ] 1.8 `apps/backend/.env.example` and `deploy/.env.prod.example`: `REWARDS_ENABLED=false` and a commented `# REWARDS_ACCOUNTING_DECISION_REF=` explaining OQ-24. **Do not edit `deploy/.env.prod`** (live secrets; owner file).

- [ ] **Task 2: Frontend flag `NEXT_PUBLIC_REWARDS_ENABLED`** (AC: 4)
  - [ ] 2.1 `apps/frontend/my-app/lib/pilot-scope.ts`: add `export const REWARDS_ENABLED = (process.env.NEXT_PUBLIC_REWARDS_ENABLED ?? "").trim().toLowerCase() === "true";` next to `PILOT_BUILD` (same parsing). Build-time, off by default, independent of `PILOT_BUILD`.
  - [ ] 2.2 Split the Rewards entries out of `PILOT_HIDDEN_ROUTES` into a new exported `REWARDS_ROUTES` list with the same `{ route, guard }` shape: `/rewards`, `/rewards/[id]`, `/rewards/my-vouchers`, `/rewards/my-vouchers/[ticketId]`, `/rewards/history`, `/admin/vouchers` (+ `/new`, `/[id]`, `/[id]/edit`), `/admin/flash-sales` (+ `/new`, `/[id]/edit`), `/admin/voucher-stats`, and the 12.13 code-issue route(s). Every guard page uses `if (!REWARDS_ENABLED) notFound();` instead of `PILOT_BUILD`.
  - [ ] 2.3 Replace every Rewards use of `PILOT_BUILD` with `!REWARDS_ENABLED` (18 files today: the 13 Rewards `page.tsx` guards, `lib/rewards/rewards-service.ts` `rejectPilot()`, `lib/admin/rewards-flash-service.ts`, `lib/admin/rewards-vouchers-service.ts`, `lib/admin/rewards-vouchers-view.ts:44`, `WalletScreen.tsx`), plus `components/layout/app/nav-items.ts:17,23` and `components/layout/admin/admin-nav.ts:24` (the Rewards spread). Find them with `grep -rln PILOT_BUILD app components lib`. Do **not** touch non-Rewards `PILOT_BUILD` uses.
  - [ ] 2.4 `proxy.ts`: today it returns early when `!PILOT_BUILD`. Rewrite Rewards routes to `/_pilot-hidden` when `!REWARDS_ENABLED`, independent of `PILOT_BUILD`; keep the existing pilot behaviour for the rest. Add the matcher entries if the matcher list is explicit.
  - [ ] 2.5 `tests/pilot-scope.test.mjs`: the guard check for `REWARDS_ROUTES` must find `REWARDS_ENABLED` in the guarding branch (same strictness as the IR.5 B2 check for `PILOT_BUILD`); the link sweep must treat `REWARDS_ROUTES` as hidden when the flag is off. Add a test that `REWARDS_ENABLED` is false when the env var is unset.
  - [ ] 2.6 `.env.example`: document `NEXT_PUBLIC_REWARDS_ENABLED` (off by default; local Rewards work needs `=true` in `.env.local`). `deploy/frontend.Dockerfile`: add `ARG`/`ENV NEXT_PUBLIC_REWARDS_ENABLED=` like `NEXT_PUBLIC_PILOT_BUILD` (lines 14–16). Production frontend is Vercel: do not set the variable there.
  - [ ] 2.7 Pilot bundle check (`scripts/check-pilot-bundle.mjs`) stays green with `NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled` and the flag unset.

- [ ] **Task 3: Ví điểm copy** (AC: 4)
  - [ ] 3.1 Add one line to the wallet screen (`app/(signed-in)/(app)/wallet/components/BalanceCard.tsx` under the balance, or `WalletScreen.tsx` if the card has no free slot): **"Điểm chỉ dùng trong Rescom, không bao giờ rút ra thành tiền mặt."** Show it always, flag on or off: the statement is true in both cases. Use existing text tokens (`text-body-sm text-ink-muted` or the class used by the nearby helper text).
  - [ ] 3.2 The final wording is part of the OQ-24 decision. Record this copy as the proposed wording in the evidence pack; if Quan changes it, change only the string.
  - [ ] 3.3 Update the wallet node test that renders or asserts wallet copy, if one exists; otherwise add one assertion in the nearest wallet test.

### Part B — Statistics API (AC 2)

- [ ] **Task 4: `GET /admin/rewards/stats`** (AC: 2)
  - [ ] 4.1 New `presentation/admin-rewards-stats.controller.ts`, mounted at `admin/rewards` and `api/admin/rewards` like the other Admin controllers; class guards `RewardsEnabledGuard, SessionAuthGuard, RolesGuard` with `@Roles('ADMIN')` (copy from `admin-rewards-flash-sales.controller.ts:35`). Query via `ZodValidationPipe(rewardsStatsQuerySchema)`; response `Cache-Control: no-store`. Read-only GET: no CSRF guard.
  - [ ] 4.2 New `application/rewards-admin-stats.service.ts` + `infrastructure/prisma-rewards-stats.repository.ts` (port in `application/ports/`). Contract: `rewardsStatsSchema` in `packages/schemas/src/rewards/rewards-admin.schema.ts:66`; **do not change the schema** (the 12.6 FE screen consumes it). Definitions must match the 12.6 mock `rewardsStatsOf` (`apps/frontend/my-app/mocks/data/rewards.ts:543`) and the "Cách tính" card (`VoucherStatsScreen.tsx:37`), with no seeded baseline:
    - Counted redemption = `redemptions.status='SUCCEEDED'` with **no** `redemption_refunds` row. Day key = `created_at` in Asia/Ho_Chi_Minh (UTC+7, no DST); reuse `getVietnamCalendarDayRange` (`domain/redemption-limits.ts:50`) or SQL `(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`.
    - `range`: the query `from`/`to` (Vietnam days, inclusive). `updatedAt`: server now.
    - `daily`: one row for **every** day in range (zero-filled), `flashSaleCodes` = codes of Flash Sales with `starts_at <= now` whose start day is that day.
    - `kpis.redemptions.count` = counted redemptions in range; `avgPerRegularDay` = mean count over days with no Flash code (0 when none).
    - `kpis.pointsSpent.points` = Σ `price_points` of counted redemptions; `vndEquivalent = points × 200` (reuse the existing rate constant if Rewards backend has one; otherwise a named constant).
    - `kpis.activeVouchers`: counts by `adminVoucherStatus` (`domain/voucher-availability.ts:27`) over non-archived vouchers (match the mock: `total` = all vouchers the Admin list shows).
    - `kpis.redemptionRate`: `offered` = Σ `stock_total` of non-archived vouchers whose redeem window overlaps the range, floored at `redeemed`; `rate = redeemed/offered` (0 when offered is 0).
    - `kpis.topVoucher`: voucher with most counted redemptions (`label` = title, `share = count/total`), `null` when none.
    - `kpis.selfReportedUsageRate` = counted redemptions in range with a `redemption_usages` row ÷ counted redemptions (0 when none, capped at 1). Never present it as verified data (FE already labels it).
    - `byBrand`: per brand, `redemptions`, `pointsSpent`, `soldRatio = redemptions / Σ max(count, stock_total)` over its vouchers with redemptions (mock line 575).
    - `flashSales`: Flash Sales started (`starts_at <= now`) with start day in range: `code`, `startsAt`, `itemsLabel` = "Brand 50k · …" from items, `sold`/`quota` sums, `status` via `adminFlashStatus` (`domain/flash-sale-rules.ts:51`), `pointsSpent` (reuse what `rewards-admin-flash.service.ts` already computes for detail), `soldOutAfterMinutes` = minutes from start to the latest `sold_out_at` when every item sold out, else `null`.
  - [ ] 4.3 Aggregate in SQL (one or a few grouped queries, parameterised `$queryRaw`); do not load all redemptions into memory. Check that `redemptions` has an index usable for `created_at` range scans; the existing one is `(voucher_id, created_at DESC)`. If the plan needs it, add an additive migration with `CREATE INDEX` on `(status, created_at)` and mirror it in `prisma/sql/post-push-invariants.sql` (later timestamp than the 12.10 migration `20261016100000`). Do not add the index without an `EXPLAIN` showing the need.
  - [ ] 4.4 Every value entering the DTO is an integer ≥ 0 or a ratio in [0,1]; no `NaN` on empty ranges. Parse the DTO with `rewardsStatsSchema` in the service spec.
  - [ ] 4.5 Tests: domain/service spec with the in-memory repo (empty range, refunded excluded, Vietnam midnight 23:30 vs 00:30 UTC+7, Flash day excluded from regular average, upcoming Flash not counted, topVoucher share); controller e2e in a new `test/rewards-stats.e2e-spec.ts` (401, 403 non-admin, 400 bad range > 366 days, 404 when flag off, both prefixes, `no-store`, body parsed with `rewardsStatsSchema`) using **literal supertest paths** (the contract matrix only detects literals); one PG e2e in `test/rewards-stats.prisma.e2e-spec.ts` seeding redemptions + a refund + a usage row across a Vietnam midnight and asserting the numbers.

### Part C — Frontend off MSW for Rewards (AC 1, 2)

- [ ] **Task 5: Remove Rewards from the deferred-mock lists** (AC: 1)
  - [ ] 5.1 `apps/frontend/my-app/mocks/route-allowlist.ts:39-65`: delete the 27 Rewards entries of `DEFERRED_KEEP_MOCK` (plus the 3 code-issue entries from 12.12 when Part D runs). The remaining count is 14 (the Epic 3/7/8/10 entries). **Keep** the MSW Rewards handlers in `mocks/handlers/rewards*.ts`: `NEXT_PUBLIC_API_MOCKING=enabled` (full mock, local demo) still needs them; in `hybrid` the routes now go to the real backend.
  - [ ] 5.2 `tests/helpers/frontend-callsites.mjs` `CALL_ALLOWLIST`: delete every `"Epic 12 Phase 2"` entry (now served by the backend; the contract test requires it).
  - [ ] 5.3 `tests/route-diff.test.mjs:88-110`: delete the `deferredRewards` exemption set and its "until 12.11" condition; gate G (`:120`) becomes `{ MOCK_ONLY: 3, DEFERRED_KEEP_MOCK: 14, PLANNED: 0, REMOVE: 0 }`.
  - [ ] 5.4 `tests/contract-callsites.test.mjs:35-45, 63-72`: delete the `deferredRewards` and `deferredRewardsAdmin` exemptions. The six Admin voucher routes then need a backend e2e with a **literal** supertest path: add calls in `test/rewards-catalog.e2e-spec.ts` that the parser in `tests/helpers/backend-routes.mjs:106` (`backendSpecCoverage`) reads: a string or template literal such as `.get(\`/admin/rewards/vouchers/${id}\`)` (`${…}` becomes `:param`). String concatenation (`'/admin/…/' + id`) and the dynamic `write(method, path)` helper are not detected.
  - [ ] 5.5 `tests/hybrid-mocking.test.mjs:131`: `deferred.length` 41 → 14.
  - [ ] 5.6 Regenerate the matrix: `node apps/frontend/my-app/scripts/contract-matrix.mjs` → write it to `_bmad-output/implementation-artifacts/12-11-evidence/contract-matrix.md` (do not overwrite the IR.5 one). Expect 0 unmatched, 0 Rewards allowlisted.
  - [ ] 5.7 Hybrid mock-session helpers that only fed Rewards mocks (`claimDemoRewards`, Rewards parts of `seedWallet` in `mocks/hybrid.ts` or `mocks/data/*`) stay for full-mock mode. Remove only code that the hybrid path can no longer reach and that a test proves dead; otherwise leave it.

- [ ] **Task 6: Real-backend behaviour gaps the mocks hid** (AC: 1)
  - [ ] 6.1 Run the Rewards screens against the real backend (hybrid off, flag on) and fix only contract mismatches the shared Zod parse reveals. The MSW handlers parse payloads with the same schemas, so mismatches should be rare; any found is a bug in the backend DTO or the FE call, fix it where the contract is wrong and record it.
  - [ ] 6.2 Known MSW-only behaviours to re-check: `?msw=<scenario>` failure switches do not exist on the real stack (produce each failure with real data in the journey, Task 8); the demo wallet seed (186/18) does not exist (use real balances); per-user limits are now real (BR-19/20), so repeated manual redemptions hit `ACCOUNT_NOT_ELIGIBLE`/limits; the countdown uses `serverTime` from real payloads.

### Part D — Admin code-issue queue de-mock (AC 1) — needs 12.12 + 12.13 done

- [ ] **Task 7: Code-issue routes off MSW** (AC: 1)
  - [ ] 7.1 Remove `GET /admin/rewards/code-issues`, `GET /admin/rewards/code-issues/:id`, `POST /admin/rewards/code-issues/:id/resolve` from `DEFERRED_KEEP_MOCK` and `CALL_ALLOWLIST`; update the counts in Task 5.3/5.5 if 12.12 added them.
  - [ ] 7.2 Add the 12.13 route(s) to `REWARDS_ROUTES` (Task 2.2) with the `REWARDS_ENABLED` guard, and the sidebar entry under the Rewards spread.
  - [ ] 7.3 Confirm the 12.13 screen against the real backend: REPLACE, REFUND (with `RFD-` reference), REJECT (note required), already-resolved (`CODE_ISSUE_ALREADY_RESOLVED`), `canReplace=false` with reason. No Admin payload shows a code value.

### Part E — Load test and evidence (AC 1, 3)

- [ ] **Task 8: Mock-off journey script** (AC: 1, 2)
  - [ ] 8.1 New `scripts/rewards-journey.mjs`, modelled on `scripts/ir5-journey.mjs` (Node stdlib `fetch`, `Actor` cookie jar + CSRF, Prisma only for setup and final SQL checks, refuses a DB name not ending in `_check`/`_test`, never writes passwords/cookies/tokens/codes to the report). Reuse its `Actor` class by copying or extracting it to `scripts/lib/actor.mjs` only if both scripts then import it (prefer the extract; no third copy).
  - [ ] 8.2 Stack: docker compose `postgres` (scratch DB `rescom_rewards_check`, migrated with `prisma migrate deploy`), backend with `REWARDS_ENABLED=true SCHEDULER_ENABLED=true` (lifecycle job must reserve/settle on time; tick 1–5 s), frontend pilot build `NEXT_PUBLIC_PILOT_BUILD=true NEXT_PUBLIC_API_MOCKING=disabled NEXT_PUBLIC_REWARDS_ENABLED=true`, every call through the frontend's same-origin `/api` rewrite.
  - [ ] 8.3 Steps (each recorded with request, status, key ids, duration):
    - Admin: create voucher(s) with brand/category, import a CSV of codes (one in-file duplicate rejected), price change (new `priceVersion`), stock adjust (below issued+reserved rejected), pause/hide; settings read.
    - Admin Flash: create (overlap rejected, price ≥ regular rejected, quota > unreserved rejected), wait for start, monitor (sold/quota), end early.
    - User browse: list with filters, detail, flash list; balance from `/economy/wallet` (or the wallet route the FE uses).
    - Redeem success: quote → redeem with `Idempotency-Key` → replay same key returns the same result → `GET /rewards/redemptions/by-key/:key`.
    - Every failure code with real data: `SOLD_OUT` (last unit taken / Flash quota exhausted), `PRICE_CHANGED` (Admin price change between quote and confirm), `INSUFFICIENT_POINTS` (balance spent between quote and confirm, e.g. a second redemption), `VOUCHER_UNAVAILABLE` (Admin pauses after quote), `ACCOUNT_NOT_ELIGIBLE` (Flash with `requireRecentSurvey` and a user without a completed survey, or a per-user limit). Assert each response says no Points were deducted (wallet unchanged).
    - My vouchers: list by tab, detail with code, use, undo, history with Success/Failed/Refunded.
    - Faulty code (Part D): user reports → Admin queue lists it → REPLACE on one, REFUND on another (user wallet back, history REFUNDED), REJECT with note on a third → user notifications exist.
    - Stats: `GET /admin/rewards/stats` for the run's day; counts match the run (refunded excluded).
    - Flag-off sweep: restart with both flags off; every `REWARDS_ROUTES` page returns 404 and one user + one Admin API route return 404; wallet shows the cash copy.
  - [ ] 8.4 Final SQL checks: every journal sums to zero; each SUCCEEDED redemption has exactly one journal keyed `redemption:{key}`; each refund exactly one `redemption-refund:{caseId}` journal; `stock_total = stock_remaining + flash reserved + issued` per voucher (the 12.10 identity); each code assigned at most once.
  - [ ] 8.5 Output `_bmad-output/implementation-artifacts/12-11-evidence/rewards-journey-report.{json,md}`; exit 1 on any failed step.
  - [ ] 8.6 Browser pass (manual, honest): open each Rewards screen at 390 px and 1440 px against the real stack (the 12.2 gotchas apply: automation tabs report `document.hidden=true`, so force `hidden=false` to see countdowns; check widths with an injected fixed iframe). Record what was and was not checked.

- [ ] **Task 9: Flash load test** (AC: 3)
  - [ ] 9.1 New `scripts/rewards-flash-load.mjs` (Node stdlib only, **no new dependency**; `Promise.all` over `fetch` with a start barrier). Same scratch-DB guard as 8.1.
  - [ ] 9.2 Pilot VPS profile: 2 vCPU, 7.8 GiB RAM, one API replica with the in-process scheduler (`11-2-hostinger-vps-pilot-infrastructure-provisioning.md:24`, `11-2-hostinger-evidence/00-read-only-inventory.md:18`). Run backend **and** Postgres under that budget on the same host: `docker compose` with `cpus: "2"` / `mem_limit` overrides, or `docker run --cpus=2 --memory=7.8g` for the backend image (`deploy/backend.Dockerfile`). **Never run against the production VPS database.** Running on the VPS itself against a scratch stack is the owner's call (Open point 2).
  - [ ] 9.3 Setup: N = 300 users (register via API with `AUTH_RATE_LIMIT_MAX_REQUESTS` raised in the scratch env, as IR.5 did, or create users + sessions with Prisma; record which), each funded with enough Available Points through a balanced journal (reuse the `deploy/grant-points.js` approach: `SYSTEM_ISSUANCE → USER_AVAILABLE`, keyed per run). One voucher, one Flash Sale with one item, `quota = 100`, `perUserCap = 1`, `requireRecentSurvey=false` (the BR-02 rule is not under test), starting at T+90 s.
  - [ ] 9.4 At start: every user quotes, then redeems with its own key, all released at the same instant. Also: 20 users resend the same key twice concurrently (double-submit). Record per-request latency for quote and redeem.
  - [ ] 9.5 Assert after the run (SQL): SUCCEEDED Flash redemptions = `quota` exactly (100) and `flash_sale_items.sold = 100`; others `SOLD_OUT` (or regular-price success only if the client asked again, which the script must not do); no user has two SUCCEEDED redemptions for the item; one journal per success, each zero-sum; Σ wallet debits = Σ success prices; losers' wallets unchanged; stock identity holds; no code assigned twice; double-submit pairs produce one result.
  - [ ] 9.6 Report `12-11-evidence/rewards-flash-load-report.{json,md}`: N, quota, hardware profile (`nproc`, memory limit, Docker limits), p50/p95/p99/max for quote and redeem, error counts by code, the invariant results. p95 has no pass/fail target (PRD OQ-22 owns SLOs); compare it with NFR-1 (500 ms) as information only.

- [ ] **Task 10: Evidence pack and verification** (AC: all)
  - [ ] 10.1 `_bmad-output/implementation-artifacts/12-11-evidence/12-11-evidence-<date>.md`: commit SHA, environment, exact commands and raw counts (backend unit, e2e, PG suites with 0 skipped, FE node tests, typecheck, lint, pilot build + bundle check), contract matrix, journey report, load report, flag-off sweep, the gate table above with current states, the OQ-24 status ("not recorded — production enable blocked"), and open owner items.
  - [ ] 10.2 Backend (`apps/backend`): `npm run prisma:validate`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run test:e2e -- rewards` and `migration-chain.prisma` with `FINANCIAL_TEST_DATABASE_URL` set (use a fresh scratch DB; 12.10 found cumulative data in `rescom_financial_test` breaks Flash suites). `npm test` in `packages/schemas`.
  - [ ] 10.3 Frontend (`apps/frontend/my-app`): `npm test` (node tests), `npm run typecheck`, `npm run lint`; pilot build with the flag unset + `node scripts/check-pilot-bundle.mjs`.
  - [ ] 10.4 Update the PRD OQ-24 entry only if Quan records a decision during this story; otherwise leave it and note it as the open production gate.

## Dev Notes

### Scope boundaries (read first)

- **In:** backend + frontend feature flag (off by default), production OQ-24 env gate, Ví điểm cash copy, `GET /admin/rewards/stats`, removing Rewards from `DEFERRED_KEEP_MOCK` and the "until 12.11" test exemptions, real-backend fixes found by the Zod parse, mock-off journey script, Flash load test, evidence pack.
- **Out:** enabling the flag in production or Vercel (owner action after 11.5 + OQ-24); the Admin code-issue FE contract/screen (12.12/12.13); the "10 minutes before Flash start" reminder (`rules.remindBefore10m`, no AC owns it); email reminders; partner-API codes; a general feature-flag service (one env flag per side is enough); load tests of anything except one Flash voucher at start; Redis/queues (sprint change proposal: "No Redis or queue"; the stock row lock serialises redemptions).
- **Do not:** change any `packages/schemas` Rewards schema (all consumers are built); change the 12.8 redeem transaction order; add load-test dependencies (k6, autocannon, artillery: none in the repo today); delete the MSW Rewards handlers.

### Current state (verified 2026-10-14 at 45983a3)

- **Backend routes** (all mounted at `x` and `api/x`): user catalog `rewards-catalog.controller.ts` (GET vouchers, vouchers/:id, flash-sales); quote/redeem `rewards-redemption.controller.ts` (POST quotes, POST redemptions, GET redemptions/by-key/:key); my vouchers `rewards-my-vouchers.controller.ts` (GET my-vouchers, :id, POST :id/use, :id/undo-use, :id/issues, GET redemptions); Admin `admin-rewards-vouchers.controller.ts` (vouchers CRUD, price, stock, codes, brands, settings), `admin-rewards-flash-sales.controller.ts` (list, create, get, put, end), `admin-rewards-code-issues.controller.ts` (list, get, resolve). **No stats route exists.** No Rewards flag exists; `RewardsModule` is imported unconditionally in `app.module.ts:43`.
- **Frontend:** `NEXT_PUBLIC_API_MOCKING` = `enabled` | `hybrid` | `disabled` (`lib/api/config.ts:17-18`); hybrid serves only `DEFERRED_KEEP_MOCK` routes (`mocks/handlers/index.ts:73`). `DEFERRED_KEEP_MOCK` has 41 entries (`mocks/route-allowlist.ts:23-66`): 14 non-Rewards + 27 Rewards. Rewards is hidden today only by `PILOT_BUILD` (13 page guards, 3 services, nav). Production is a pilot build, so after this story Rewards is hidden in production by `REWARDS_ENABLED=false`, not by `PILOT_BUILD`.
- **Clients:** `lib/rewards/rewards-service.ts` (12 user calls), `lib/admin/rewards-vouchers-service.ts`, `lib/admin/rewards-flash-service.ts` (incl. `GET /admin/rewards/stats?from&to` → `rewardsStatsSchema`, line 38). All parse with the shared Zod schemas.
- **Wallet:** `app/(signed-in)/(app)/wallet/components/{WalletScreen,BalanceCard,BucketCards}.tsx`; no cash-withdrawal copy today.
- **Tests that pin counts/exemptions:** `tests/route-diff.test.mjs:88-128`, `tests/contract-callsites.test.mjs:35-72`, `tests/hybrid-mocking.test.mjs:131`, `tests/pilot-scope.test.mjs`.

### Architecture guardrails

- AD-24: Rewards never writes the ledger; spends and refunds only through Economy commands. The stats query is read-only and may read `redemptions`, `redemption_refunds`, `redemption_usages`, `vouchers`, `flash_sales`, `flash_sale_items`, but not ledger tables.
- AD-5 amendment / AD-23: one API replica owns the in-process scheduler (`SCHEDULER_ENABLED=true` in production). The flag must not break that refine; it only skips the two Rewards jobs.
- Env validation is the place for production refusals (pattern: `SCHEDULER_ENABLED`, `PARTICIPATION_RATE_LIMIT_POLICY_VERSION` in `env.schema.ts:395-440`).
- 404 when off (not 403): the API does not reveal a disabled feature, the same rule as own-ticket lookups (12.10 gotcha 6).

### Gotchas checklist

1. `setup-e2e.ts` sets `REWARDS_ENABLED` for tests; unit specs that build `EnvService` directly need the value too. Grep `schedulerEnabled` in specs to see how env is faked.
2. `PILOT_BUILD` is also used by non-Rewards code. Change only the Rewards uses (Task 2.3 list).
3. `NEXT_PUBLIC_*` values are inlined at build time: a flag change needs a rebuild/redeploy; tests read `process.env` at import, so set it before importing `pilot-scope.ts`.
4. Removing an allowlist entry without a backend route fails gate G. `GET /admin/rewards/stats` must ship (Part B) before its entry is removed.
5. The contract matrix only sees literal supertest paths; add literal calls for the six Admin voucher routes (see the `ponytail:` comment in `contract-callsites.test.mjs:65`).
6. The Flash lifecycle job reserves the quota at start; the load test must wait until `flash_sales.reserved_at` is set before releasing the barrier, or early requests see regular price/`PRICE_CHANGED`.
7. Per-user throttles on quotes/redemptions key by session user; 300 distinct users avoid them. Do not raise production throttle values for the test; set only scratch env values and record them.
8. Vietnam day boundaries: `[start, end)` and UTC+7; a redemption at 23:59:59.999 local belongs to that day.
9. Use a fresh scratch DB per PG run (12.10 lesson).
10. `rtk`/hooks rewrite shell commands; quote globs in zsh.

### Testing standards

- Backend jest, co-located `*.spec.ts`, e2e in `apps/backend/test`. Money-path and concurrency proven on real PostgreSQL with `Promise.all` over production service calls and durable-state assertions. Parse real HTTP responses with shared Zod schemas. No `test.skip`/`.only`, no placeholder tests; PG suites must report 0 skipped in the evidence pack.
- Frontend: node test runner (`node --test tests/*.test.mjs` via `npm test`), no Playwright in `my-app`.

### Project Structure Notes

- New: `apps/backend/src/modules/rewards/presentation/{rewards-enabled.guard,admin-rewards-stats.controller}.ts`, `application/rewards-admin-stats.service.ts` (+ spec), `application/ports/rewards-stats-read.port.ts`, `infrastructure/{prisma,in-memory}-rewards-stats.repository.ts`, `test/rewards-stats.e2e-spec.ts`, `test/rewards-stats.prisma.e2e-spec.ts`, `scripts/rewards-journey.mjs`, `scripts/rewards-flash-load.mjs`, optional `scripts/lib/actor.mjs`, `_bmad-output/implementation-artifacts/12-11-evidence/`. Optional migration only if 4.3 proves the index is needed.
- Changed: `env.schema.ts` (+ env spec), `env.service.ts`, six Rewards controllers (guard), `rewards-scheduler.registrar.ts`, `rewards.module.ts` (new providers/controller), `test/setup-e2e.ts`, `test/rewards-catalog.e2e-spec.ts` (literal paths), `.env.example` (backend + frontend), `deploy/.env.prod.example`, `deploy/frontend.Dockerfile`; frontend `lib/pilot-scope.ts`, `proxy.ts`, Rewards pages/services/nav (Task 2.3), wallet component, `mocks/route-allowlist.ts`, `tests/{route-diff,contract-callsites,hybrid-mocking,pilot-scope}.test.mjs`, `tests/helpers/frontend-callsites.mjs`; `sprint-status.yaml`.
- Shared hot files (one owner each, rebase first): `env.schema.ts`, `rewards.module.ts`, `mocks/route-allowlist.ts`, `lib/pilot-scope.ts`.

### Previous story intelligence

- **12.10** (merged 45983a3): full e2e failures came from cumulative data in `rescom_financial_test`; a fresh DB passed. Review found claims of tests not written, `ZodError` from unvalidated DB values in DTOs, JS-side pagination; apply: validate every DB value before the DTO (stats!), aggregate in SQL, write every test the task list names. Its Dev Agent Record logs point to an external tool's temp folder; for this story record commands and outputs in the evidence pack inside the repo.
- **12.9:** authorize on every method; re-read inside locks; count and log per-item job failures; keep the diff inside the story.
- **12.6:** the stats screen and its mock define the numbers (`rewardsStatsOf`, "Cách tính"); review fixed zero-day gaps, refunded exclusion, and upcoming Flash counted as Flash day — the backend must not reintroduce them.
- **12.2/12.4 gotchas:** automation Chrome tabs report `document.hidden=true` (force false for countdowns); window cannot be resized (use an injected fixed iframe for 390/1440 px); `?msw=<scenario>` persists in localStorage until `?msw=default`.
- **IR.5:** the journey-script, contract-matrix, bundle-check, and evidence-pack patterns used here; `AUTH_RATE_LIMIT_MAX_REQUESTS` raised only on the scratch stack.

### Git intelligence

- `45983a3` Merge PR #27 (12.10), `cece1db` 12.10 implementation, `d6db08d` PR #26 (12.9), `b64da7f` 12.9, `6e7c869` PR #25 (12.8). Latest migration `20261016100000_rewards_my_vouchers_code_issues`. Rewards files are touched by every Epic 12 backend story; 12.12/12.13 will touch `route-allowlist.ts`, `admin-nav.ts`, and `pilot-scope.ts` — rebase before Part D.

### Latest tech information

- No new dependency. Next.js in `my-app` has breaking changes vs. training data: read `node_modules/next/dist/docs/` before changing `proxy.ts` (it is the renamed middleware). Prisma 6.0.0, NestJS 10, Zod 3.24, Jest 29, PostgreSQL 15, Node `fetch` (undici) for scripts. Use `performance.now()` for latency; compute percentiles by sorting the samples (nearest-rank).

### Open points for the dev agent to confirm with Quan (do not block; solo owner)

1. **RESOLVED (Quan, 2026-10-14): dependency order is 12.12 → 12.13 → 12.11.** Do not start dev on this story until 12.12 and 12.13 are `done` (12.13 needs its Figma page first). Then build all Parts in order; Task 0.2's partial path is a fallback only.
2. **Where the load test runs.** Default: local Docker limited to 2 vCPU / 7.8 GiB with a scratch DB. Alternative: the Hostinger VPS against a separate scratch compose project during a quiet window. Never the production DB.
3. **Load size.** Default N = 300 users, quota 100, cap 1 (Figma example "100 suất Flash"). Change if the pilot user count suggests otherwise.
4. **Ví điểm wording.** Proposed: "Điểm chỉ dùng trong Rescom, không bao giờ rút ra thành tiền mặt." Final wording belongs to the OQ-24 decision.
5. **`REWARDS_ACCOUNTING_DECISION_REF` format.** Default: free text (a date + document link). Make it stricter only if Quan wants.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` § Epic 12 intro, Stories 12.6, 12.10, 12.12, 12.13, 12.11]
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-13.md` §4 Story 12.11, §5 success criteria, risk "Flash load at 12:00"]
- [Source: `_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md` §4.20 FR-68…FR-75, §5 Non-Goals amendment 2026-10-13, §8 OQ-22, OQ-24]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` AD-24, AD-5 amendment (in-process scheduler), module table "Rewards"]
- [Source: `_bmad-output/implementation-artifacts/ir-5-launch-domain-closure-local-integration-gate.md` Parts A, B, D, E, F; `ir-5-g3/` evidence pack]
- [Source: `_bmad-output/implementation-artifacts/12-6-admin-flash-sale-rewards-stats.md` Tasks 1, 4.7–4.8, 5.6, review findings]
- [Source: `_bmad-output/implementation-artifacts/12-10-my-vouchers-reminders-faulty-code-resolution.md` Dev Notes, review findings, Completion Notes]
- [Source: `_bmad-output/implementation-artifacts/11-2-hostinger-vps-pilot-infrastructure-provisioning.md:24` (2 vCPU, 7.8 GiB)]
- [Source: `apps/backend/src/common/config/env.schema.ts:195-210, 395-440`; `env.service.ts:72`; `apps/backend/src/modules/rewards/**`; `apps/backend/test/setup-e2e.ts`]
- [Source: `apps/frontend/my-app/{lib/pilot-scope.ts, proxy.ts, mocks/route-allowlist.ts, mocks/data/rewards.ts:543, lib/rewards/rewards-service.ts, lib/admin/rewards-flash-service.ts, tests/route-diff.test.mjs, tests/contract-callsites.test.mjs, tests/hybrid-mocking.test.mjs, tests/helpers/frontend-callsites.mjs}`; `packages/schemas/src/rewards/rewards-admin.schema.ts:48,65-66`]
- [Source: `scripts/ir5-journey.mjs`, `deploy/grant-points.js`, `deploy/frontend.Dockerfile:14-16`]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
