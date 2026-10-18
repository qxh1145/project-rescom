---
baseline_commit: d52ad2943994efa2f02a54831e3a783c65dfd35c
---

# Story 14.4: Ledger Operations Panel

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want to run the ledger operator fallbacks from the console,
so that I can repair a stuck reward or check balances without curl.

## Acceptance Criteria

1. **Given** the existing Admin-only routes in `ledger.controller.ts` and `admin-reward-redrive.controller.ts`, **when** the Admin opens `/admin/transactions`, **then** the screen shows two tabs, "Sổ giao dịch" (the current Figma 11f content, unchanged) and "Vận hành" (new). Default tab is "Sổ giao dịch". The tabs use `role="tablist"`/`tab`/`tabpanel` with arrow-key roving focus (pattern: `disputes/components/DisputeTabs.tsx`). No deep link.
2. "Kiểm tra toàn vẹn sổ cái" runs `GET /economy/integrity` on click (not on tab open) and shows: the zero-sum result (`totalSystemBalance`, `isZeroSum`) and the list of drifted accounts. Each drifted account shows short code of its owner (`shortCodeOf(userId)` from `lib/admin/users-view.ts:7`, or "Hệ thống" when `userId` is null), its account class label, projected balance, calculated balance, and two actions: "Kiểm tra số dư" (`GET /economy/accounts/:id/balance`, shows `projectedBalance`, `calculatedBalance`, `isConsistent`) and "Đối soát" (`POST /economy/accounts/:id/reconcile`, shows `priorBalance → correctedBalance`). When `isZeroSum` is false, an alert says the entries themselves do not sum to zero and reconcile cannot fix it. Empty drift list → "Không có tài khoản nào lệch số dư."
3. **Decision D1 (default, see Dev Notes):** `GET /economy/integrity` gains additive `driftedAccounts` (accounts whose `balance` ≠ sum of their entries, max 100, ordered by `accountId`) and `driftedAccountsTruncated: boolean`. Read-only; no migration. A shared schema `ledgerIntegrityReportSchema` describes the report.
4. "Chạy lại trả thưởng" has a kind selector — "Bài trả lời (Internal)" / "Lượt làm (External)" — and one ID input. The ID must be a UUID (inline error, nothing sent otherwise). It calls `POST /economy/rewards/internal/:responseId` or `POST /economy/rewards/external/:attemptId` with an empty JSON body `{}`. The result shows settlement status (Vietnamese label), amount, target account class, journal ID, and `settledAt`. A `null` External result (settlement unavailable) shows "Chưa có kết quả trả thưởng."
5. "Giải phóng Điểm chờ đã đủ 48 giờ" has an optional limit input (integer 1–500; empty = server default 100) and calls `POST /economy/rewards/release-matured` with `{}` or `{ limit }`. The result shows `processed`, `releasedCount`, `disputedCount`, `failedCount`, `cutoffDate`, and `hasMore`. When `hasMore` is true, "Chạy tiếp" re-runs with `after = nextCursor` and the same limit (it needs the same confirm).
6. Every mutating action (Đối soát, Chạy lại trả thưởng, Giải phóng / Chạy tiếp) opens a confirm `Dialog` that names its effect (copy in Dev Notes). Confirm sends the request with CSRF (`apiRequest` does this for non-GET). The action button and the dialog confirm are disabled / `loading` while running, and a double click sends one request (ref guard, like `use-missing-code-resolution.ts`). The dialog cannot be dismissed while busy.
7. 400 / 403 / 404 / 409 codes are shown in Vietnamese (table in Dev Notes); an unknown code falls back to a generic message; network errors use the shared network copy. Session loss redirects (`useSessionLossRedirect`).
8. Every mutating route writes an audit event (**Decision D2, default:** a row in `identity_audit_logs` through `IDENTITY_AUDIT_PORT`, so it shows in the 14.3 viewer): `LEDGER_ACCOUNT_RECONCILED`, `REWARD_REDRIVEN`, `PENDING_REWARDS_RELEASED`, actor = acting Admin, `outcome: 'SUCCESS'`, metadata per Dev Notes. Written after the operation succeeds; a refused operation writes nothing. Backend touch is limited to these audit writes plus the D1 read.
9. The 14.3 viewer knows the new actions: `AUDIT_ACTION_LABELS` gains the three labels, and its info note mentions ledger operations.
10. A new `docs/ledger-operations-runbook.md` describes when to use each operation and links to `/admin/transactions` → "Vận hành"; the existing `docs/payos-production-runbook.md` §7 links to it.
11. MSW: handlers for the six routes answer in `enabled` mock mode with shared-schema-parsed data; `tests/admin-contract.test.mjs` covers 401/403 and the response shapes; `tests/route-diff.test.mjs` passes unchanged (the backend serves every route); `tests/contract-callsites.test.mjs` passes (each FE-called path has a backend e2e call — `POST /economy/accounts/:id/reconcile` has none today, so add it).
12. Non-Admins never see the tab content (the admin shell already gates `/admin/*`; the backend returns 403).

## Tasks / Subtasks

- [x] Task 1: Shared schemas (AC: 2, 3, 4, 5)
  - [x] 1.1 In `packages/schemas/src/economy/ledger-account.schema.ts` (or a new `ledger-ops.schema.ts` re-exported from `economy/index.ts`) add strict schemas: `ledgerDriftedAccountSchema = { accountId: uuid, userId: uuid|null, accountClass: ledgerAccountClassSchema, projectedBalance: int, calculatedBalance: int }`, `ledgerIntegrityReportSchema = { totalSystemBalance: int, isZeroSum: boolean, driftedAccounts: array(ledgerDriftedAccountSchema), driftedAccountsTruncated: boolean }`, `accountBalanceVerificationSchema = { accountId, projectedBalance, calculatedBalance, isConsistent }`, `accountReconciliationResultSchema = { accountId, priorBalance, correctedBalance }`. Export `LEDGER_DRIFT_REPORT_LIMIT = 100` and the inferred types.
  - [x] 1.2 In `packages/schemas/src/economy/reward.schema.ts` add strict `maturedReleaseSummarySchema = { processed, releasedCount, disputedCount, failedCount: nonnegative ints, hasMore: boolean, nextCursor: string|null, cutoffDate: datetime }` and its type. `rewardSettlementResultSchema` already exists — reuse it.
  - [x] 1.3 Spec tests next to the existing ones (`ledger.schema.spec.ts`, `reward.schema.spec.ts`): valid parse, extra key rejected. `cd packages/schemas && npm run build`.
- [x] Task 2: Backend D1 — drifted accounts in the integrity report (AC: 3)
  - [x] 2.1 `LedgerRepositoryPort` gains `findDriftedAccounts(limit: number): Promise<LedgerDriftedAccount[]>`.
  - [x] 2.2 Prisma: one raw query — `SELECT a.id, a.user_id, a.account_class, a.balance, COALESCE(SUM(e.amount), 0)::int AS calculated FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id GROUP BY a.id HAVING a.balance <> COALESCE(SUM(e.amount), 0) ORDER BY a.id LIMIT ${limit + 1}` (`limit + 1` to compute `truncated`). Use `this.client` like `sumAllEntries`. In-memory repo: same logic over `accounts` / `entries`.
  - [x] 2.3 `LedgerService.verifyLedgerIntegrity()` adds `driftedAccounts` (first 100) and `driftedAccountsTruncated`; `LedgerIntegrityReport` type = the shared schema's type.
  - [x] 2.4 Tests: `ledger.service.spec.ts` (or the existing integrity test) — no drift → `[]`; a manually skewed in-memory account → listed with both balances; `ledger.e2e-spec.ts` "audits entire ledger…" also asserts `driftedAccounts` is an array and the body parses with `ledgerIntegrityReportSchema`.
- [x] Task 3: Backend D2 — audit writes (AC: 8)
  - [x] 3.1 `auth/application/ports/identity-audit.port.ts`: add `'LEDGER_ACCOUNT_RECONCILED' | 'REWARD_REDRIVEN' | 'PENDING_REWARDS_RELEASED'` to `IdentityAuditAction` with a `// Story 14.4` comment.
  - [x] 3.2 `ledger.controller.ts`: inject `@Inject(IDENTITY_AUDIT_PORT) audit: IdentityAuditPort` (see Dev Notes "Constructor"); `reconcileAccount` and `releaseMaturedPendingRewards` take `@CurrentUser()` and, after the service returns, `await this.audit.append({ action, userId: user.id, outcome: 'SUCCESS', metadata })`.
  - [x] 3.3 `admin-reward-redrive.controller.ts`: inject the port, take `@CurrentUser()`, append `REWARD_REDRIVEN` after both re-drives (`kind: 'INTERNAL' | 'EXTERNAL'`).
  - [x] 3.4 Unit specs: `ledger.controller.spec.ts` and `admin-reward-redrive.controller.spec.ts` — audit appended once with the right action / metadata on success; not appended when the service throws. Update the existing `new LedgerController(...)` / `new AdminRewardRedriveController(...)` calls.
  - [x] 3.5 E2E: `test/ledger.e2e-spec.ts` — new `POST /economy/accounts/:id/reconcile` test (Admin + CSRF → 200 with `priorBalance` / `correctedBalance`; non-Admin → 403; unknown uuid → 404 `ACCOUNT_NOT_FOUND`) asserting one `LEDGER_ACCOUNT_RECONCILED` record in the overridden `auditRepo`. `test/reward-settlement.e2e-spec.ts` — assert `REWARD_REDRIVEN` and `PENDING_REWARDS_RELEASED` records on the existing success paths (both specs already override `IDENTITY_AUDIT_PORT`).
- [x] Task 4: FE service, messages, view helpers (AC: 2, 4, 5, 7)
  - [x] 4.1 New `apps/frontend/my-app/lib/admin/ledger-ops-service.ts` ("VERIFIED" header like `transactions-service.ts`): `getLedgerIntegrity(signal?)`, `getAccountBalance(accountId)`, `reconcileAccount(accountId)` (`method: "POST"`, no body), `redriveReward(kind, id)` (`method: "POST"`, `body: {}`, schema `rewardSettlementResultSchema.nullable()`), `releaseMaturedRewards({ limit?, after? })` (`method: "POST"`, body without undefined keys). Path ids through `encodeURIComponent`.
  - [x] 4.2 New `lib/admin/ledger-ops-view.ts` (pure): `parseRedriveId(raw)` (trim + `z.string().uuid()` → `{ id } | { error }`), `parseReleaseLimit(raw)` (empty → `undefined`; integer 1–`MATURED_PENDING_RELEASE_MAX_LIMIT` else error), `settlementStatusLabel(status)`, `accountClassLabel(cls)` (reuse the class → label map in `lib/admin/admin-transactions.ts:105`, export it if needed; do not duplicate), confirm copy builders.
  - [x] 4.3 New `lib/admin/ledger-ops-messages.ts`: `ledgerOpsErrorMessage(error)` per the Dev Notes table.
  - [x] 4.4 Tests `tests/admin-ledger-ops.test.mjs`: id/limit parsing (empty, non-uuid, 0, 501, 1.5, " 20 "), labels incl. unknown status, every mapped error code + network + 403 + fallback.
- [x] Task 5: MSW + contract test (AC: 11)
  - [x] 5.1 `mocks/data/admin-transactions.ts`: a tiny ops store — one seeded drifted user account (owner = a demo user id from `mocks/data/admin-users.ts`), reconcile fixes it (second integrity run shows no drift), a seeded matured-credit count for release-matured. Re-drive: a known demo response / attempt id returns `SETTLED` / `PENDING`, others 404 (`RESPONSE_NOT_FOUND` / `SURVEY_NOT_AVAILABLE`).
  - [x] 5.2 `mocks/handlers/admin-transactions.ts`: six handlers, each `http.<method>(apiUrl("…")` on one line; `applyScenario("admin")`, `requireMockAdmin()`; POST bodies parsed with `rewardRedriveRequestSchema` / `releaseMaturedPendingRewardsSchema` → 400 `VALIDATION_ERROR`; responses `.parse()`d with the Task 1 schemas.
  - [x] 5.3 `tests/admin-contract.test.mjs`: add the GET routes to `ROUTES` (401/403 loop) and a test "Ledger ops: integrity, balance, reconcile, re-drive, release" covering shapes, reconcile clearing drift, unknown id 404, `{ limit: 501 }` 400, and a non-empty re-drive body 400.
  - [x] 5.4 `node --test tests/route-diff.test.mjs tests/contract-callsites.test.mjs` pass.
- [x] Task 6: Screen (AC: 1, 2, 4, 5, 6, 12)
  - [x] 6.1 `transactions/components/TransactionsTabs.tsx` ("Sổ giao dịch" / "Vận hành", copy `DisputeTabs` mechanics) and `TransactionsScreen.tsx`: tab state; the current body moves unchanged into the "Sổ giao dịch" panel; the ledger hook keeps running only for that panel (do not refetch journals when switching to "Vận hành" and back — keep the hook mounted at screen level as today).
  - [x] 6.2 `transactions/components/LedgerOpsPanel.tsx`: three cards (`rounded-[22px] border border-line bg-surface` like the journal section) — Integrity (+ drift table with per-row actions and inline per-row results), Re-drive (kind `SegmentedControl`, `TextField`, result block), Release (limit `TextField`, result block, "Chạy tiếp").
  - [x] 6.3 `transactions/hooks/use-ledger-ops.ts`: one pending action at a time (`{ kind, …params } | null`), `busy`, ref guard, per-action result/error state, `useSessionLossRedirect`. Integrity uses a manual trigger (not `useApiQuery` on mount); after a successful reconcile, re-run integrity once.
  - [x] 6.4 `transactions/components/ConfirmOpDialog.tsx` (copy `disputes/components/ConfirmDecisionDialog.tsx` structure, no note block).
- [x] Task 7: Audit viewer + docs (AC: 9, 10)
  - [x] 7.1 `lib/admin/audit-log-view.ts` `AUDIT_ACTION_LABELS`: add the three actions (labels in Dev Notes); mock seed `mocks/data/admin-audit-logs.ts` gains one row of each; `AuditLogScreen.tsx:161` info note adds "vận hành sổ cái (đối soát, chạy lại trả thưởng, giải phóng Điểm chờ)" to the list of what is shown.
  - [x] 7.2 New `docs/ledger-operations-runbook.md` (Vietnamese, like the payOS runbook): purpose, when to run each op, what it changes, idempotency, audit action names, link to the panel; add a one-line link from `docs/payos-production-runbook.md` §7.
- [x] Task 8: Verification (AC: all)
  - [x] 8.1 `cd packages/schemas && npm run build && npm test`.
  - [x] 8.2 `cd apps/backend && npx jest src/modules/economy src/modules/participation/presentation src/modules/auth`, then the two e2e specs with the repo's e2e config (check `package.json` scripts), then full `npx jest`; eslint + prettier on changed files.
  - [x] 8.3 `cd apps/frontend/my-app && npm test` (incl. route-diff, contract-callsites, no-direct-mocks, pilot-scope), `npm run typecheck`, `npm run lint`.
  - [x] 8.4 Manual (MSW default mode, mock admin): `/admin/transactions` → "Vận hành": integrity shows the seeded drift → "Kiểm tra số dư" → "Đối soát" (confirm) → integrity clean; re-drive a bad uuid (inline error) / unknown id (404 copy) / demo id (result); release with limit 501 (inline error), then 10 (result, "Chạy tiếp" if `hasMore`); "Sổ giao dịch" tab unchanged.

### Review Findings

- [x] [Review][Patch] Disable row actions while background integrity check is loading [apps/frontend/my-app/app/(signed-in)/(admin)/admin/transactions/components/LedgerOpsPanel.tsx:58]
- [x] [Review][Patch] Add unique index to reconciled list item React keys [apps/frontend/my-app/app/(signed-in)/(admin)/admin/transactions/components/LedgerOpsPanel.tsx:183]
- [x] [Review][Patch] Reset previous redrive outcome when target switches or ID input changes [apps/frontend/my-app/app/(signed-in)/(admin)/admin/transactions/hooks/use-ledger-ops.ts:206]
- [x] [Review][Patch] Format point amounts with formatPoints in reconcile confirm dialog copy [apps/frontend/my-app/lib/admin/ledger-ops-view.ts:83]
- [x] [Review][Patch] Add missing 401/403 coverage for all mutating ops routes in contract tests [apps/frontend/my-app/tests/admin-contract.test.mjs:386]
- [x] [Review][Dismiss] Clamp limit in findDriftedAccounts queries [apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts:490] — dismissed: only caller (ledger.service.ts:2058) passes constant LEDGER_DRIFT_REPORT_LIMIT + 1; no untrusted input reaches it

## Dev Notes

### Scope boundary (read first)

- No new route, no migration, no new dependency. Backend changes: (a) D1 read (`driftedAccounts` on `GET /economy/integrity`), (b) D2 audit appends on the four mutating routes, (c) tests. Do not touch the settlement / release / reconcile logic.
- No Figma frame (sprint-change-proposal-2026-10-18 D3, D4: ledger ops are a tab, not a nav item). Build from `AdminPage`, `SegmentedControl`, `TextField`, `Button`, `Alert`, `Dialog`, `Tag`.
- Not in scope: `POST /economy/journals` and `POST /economy/journals/:id/reverse` (generic journal tools; 14.5 uses reverse), `POST /economy/rewards/release-pending/:attemptId` (single release), `cutoffDate` input on release-matured, searching accounts by user.

### Decision D1 — the integrity report flags no accounts today (confirmed by Quan 2026-10-19: Option A)

The epic AC says "each account it flags offers Kiểm tra số dư / Đối soát", but `LedgerService.verifyLedgerIntegrity()` (`economy/application/ledger.service.ts:2061`) returns only `{ totalSystemBalance, isZeroSum }` — the sum of **all entries**. It never compares an account's denormalised `balance` with its entries, so it cannot flag any account, and reconcile repairs exactly that per-account drift. Account IDs are also not visible anywhere in the admin UI.

- **Option A (default in this story):** add `driftedAccounts` + `driftedAccountsTruncated` to the report (one read-only `GROUP BY … HAVING` query, Task 2). Smallest change that makes the AC literally true.
- **Option B:** keep the backend as is; "Vận hành" gets a free account-ID input for "Kiểm tra số dư" / "Đối soát", and integrity shows only zero-sum. FE only, but the Admin has no way to find an account ID.

### Decision D2 — where the audit event goes (confirmed by Quan 2026-10-19: Option A)

None of the four mutating routes writes an audit today (verified: `reconcileAccountBalance`, `redriveInternalReward` / `redriveExternalReward`, `releaseMaturedPendingRewards` have no audit or Outbox write).

- **Option A (default):** `IDENTITY_AUDIT_PORT.append(...)` → `identity_audit_logs`. Precedent: the other operator fallback, `OUTBOX_EVENT_REDRIVEN` (`common/scheduler/outbox/prisma-outbox-claim.repository.ts:292`). Shows in the 14.3 viewer immediately. Written after success, not in the operation's transaction: if the append fails, the route returns 500 although the operation committed; every op is idempotent / safe to re-run, so the retry writes the audit (accepted, note in runbook).
- **Option B:** an `admin-audit:*` Outbox event like the money audits (`top-up.service.ts:382`, `participation.service.ts:1996`). Consistent with those, but invisible in the viewer (14.3 D1) and needs a repository write in each module's transaction.

`AuthModule` exports `IDENTITY_AUDIT_PORT` (`auth.module.ts:265`); `EconomyModule` and `ParticipationModule` already import `AuthModule`.

### Backend contract (existing, verified in code)

| Route | Guards | Body | Returns (`data`) | Errors |
|---|---|---|---|---|
| `GET /economy/integrity` | Session, Roles ADMIN | — | `{ totalSystemBalance, isZeroSum }` (+ D1 fields) | 401, 403 |
| `GET /economy/accounts/:id/balance` | Session, Roles ADMIN, `ParseUUIDPipe` | — | `{ accountId, projectedBalance, calculatedBalance, isConsistent }` | 400 `VALIDATION_ERROR`, 404 `ACCOUNT_NOT_FOUND` |
| `POST /economy/accounts/:id/reconcile` | + CSRF (no JsonOnly) | none | `{ accountId, priorBalance, correctedBalance }` (row lock `FOR UPDATE`, updates only on drift) | 404 `ACCOUNT_NOT_FOUND` |
| `POST /economy/rewards/internal/:responseId` | Session, Roles ADMIN, CSRF, JsonOnly | strict `{}` (`rewardRedriveRequestSchema`) | `RewardSettlementResultDto` (`result.reward`) | 404 `RESPONSE_NOT_FOUND`; 409 `REWARD_NOT_SETTLEABLE` (not SUBMITTED/VALIDATED, no reward request); 409 `INSUFFICIENT_ESCROW_BALANCE` / `LEDGER_COMMAND_IN_PROGRESS`; guest → 200 `SKIPPED_GUEST` |
| `POST /economy/rewards/external/:attemptId` | same | strict `{}` | `RewardSettlementResultDto \| null` | 404 `SURVEY_NOT_AVAILABLE`; 409 `REWARD_NOT_SETTLEABLE` (not COMPLETED); 400 `ATTEMPT_NOT_EXTERNAL`; 409 `SURVEY_REWARD_UNAVAILABLE` |
| `POST /economy/rewards/release-matured` | Session, Roles ADMIN, CSRF, JsonOnly | strict `{ cutoffDate?, after?, limit? 1–500 }` | `MaturedReleaseSummary` `{ processed, releasedCount, disputedCount, failedCount, hasMore, nextCursor, cutoffDate }` | 400 `VALIDATION_ERROR`, 400 `INVALID_LEDGER_OPERATION` (bad cursor) |

Status mapping: `common/http/http-exception.filter.ts:381,430,438,563,584,592`. Both controllers are mounted at `economy…` and `api/economy…`. Every route is idempotent or safe to re-run (`participation.service.ts:1464-1556`; `reward-settlement.coordinator.ts:337`). The `pending-release` scheduler runs the same scan; only the Admin route is audited.

### Audit metadata (D2)

| Action | Metadata |
|---|---|
| `LEDGER_ACCOUNT_RECONCILED` | `accountId`, `priorBalance`, `correctedBalance`, `changed` (`prior !== corrected`) |
| `REWARD_REDRIVEN` | `kind` (`INTERNAL`/`EXTERNAL`), `responseId` or `attemptId`, `status` (or `null`), `journalId`, `amount` |
| `PENDING_REWARDS_RELEASED` | `limit` (requested or `null`), `after` present (boolean), `processed`, `releasedCount`, `disputedCount`, `failedCount`, `hasMore` |

No PII, no balances of other parties beyond what the route returns. `targetUserId` stays null (no user lookup).

### Constructor (D2)

- `LedgerController(ledgerService, coordinator?)` is constructed directly in `ledger.controller.spec.ts:27,147,260`. Add the audit port as an `@Inject(IDENTITY_AUDIT_PORT)` parameter before the optional `coordinator` (and update the three spec call sites), or as an `@Optional()` last param — keep Nest DI and the specs both working; check `economy.module.ts` (the controller is in `controllers`, deps resolved by Nest).
- `AdminRewardRedriveController(participationService)` — spec at `admin-reward-redrive.controller.spec.ts:35`.
- `@CurrentUser()` from `auth/presentation/decorators` (already imported in `ledger.controller.ts`).

### Copy

Tabs: "Sổ giao dịch", "Vận hành". Cards: "Kiểm tra toàn vẹn sổ cái" (button "Chạy kiểm tra"), "Chạy lại trả thưởng", "Giải phóng Điểm chờ đã đủ 48 giờ".

Confirm dialogs:
- Đối soát: title "Đối soát tài khoản #ABCD?", body "Số dư hiển thị sẽ được tính lại bằng tổng các bút toán (hiện {projected} → {calculated} Điểm). Không tạo bút toán mới." Confirm "Đối soát".
- Chạy lại trả thưởng: "Chạy lại trả thưởng cho {bài trả lời|lượt làm} #ABCD?" / "Nếu chưa có khoản thưởng, hệ thống sẽ trả từ Ký quỹ của khảo sát; nếu đã có, chỉ trả về kết quả cũ. Không trả hai lần." Confirm "Chạy lại".
- Giải phóng: "Giải phóng Điểm chờ đã đủ 48 giờ?" / "Tối đa {limit|100} khoản thưởng đang chờ quá 48 giờ sẽ được chuyển sang Khả dụng. Khoản đang bị khiếu nại được giữ lại." Confirm "Giải phóng".

Settlement status: `SETTLED` "Đã cộng vào Khả dụng", `PENDING` "Đang chờ 48 giờ", `HELD_IN_INTEGRITY` "Đang tạm giữ kiểm tra", `SKIPPED_GUEST` "Bỏ qua — lượt làm của khách"; unknown → raw code.

Audit labels (14.3 viewer): `LEDGER_ACCOUNT_RECONCILED` "Đối soát tài khoản sổ cái", `REWARD_REDRIVEN` "Chạy lại trả thưởng", `PENDING_REWARDS_RELEASED` "Giải phóng Điểm chờ 48 giờ".

Errors (`ledgerOpsErrorMessage`):

| Code / case | Message |
|---|---|
| network | shared network copy (as `transactions-messages.ts`) |
| 403 | "Tài khoản của bạn không có quyền thực hiện thao tác vận hành." |
| `ACCOUNT_NOT_FOUND` | "Không tìm thấy tài khoản sổ cái này." |
| `RESPONSE_NOT_FOUND` | "Không tìm thấy bài trả lời với mã này." |
| `SURVEY_NOT_AVAILABLE` | "Không tìm thấy lượt làm hoặc khảo sát với mã này." |
| `ATTEMPT_NOT_EXTERNAL` | "Lượt làm này không thuộc khảo sát Google Forms." |
| `REWARD_NOT_SETTLEABLE` | "Mục này chưa đủ điều kiện trả thưởng (chưa nộp / chưa hoàn thành hoặc không có yêu cầu thưởng)." |
| `SURVEY_REWARD_UNAVAILABLE`, `INSUFFICIENT_ESCROW_BALANCE` | "Ký quỹ của khảo sát không đủ để trả thưởng." |
| `LEDGER_COMMAND_IN_PROGRESS` | "Một thao tác khác trên sổ cái đang chạy. Thử lại sau vài giây." |
| `INVALID_LEDGER_OPERATION` | "Không tiếp tục được lượt trước. Chạy lại từ đầu." |
| `VALIDATION_ERROR` | "Dữ liệu gửi lên không hợp lệ." |
| other | "Thao tác chưa thực hiện được. Vui lòng thử lại." |

### Current state of files touched

- `transactions/components/TransactionsScreen.tsx` (103 lines): `AdminPage` + summary cards + journal section; `useAdminTransactions()` at screen level. Preserve every behaviour (filters, period, "Tải thêm", errors); tests in `tests/admin-transactions.test.mjs` must stay green.
- `lib/admin/transactions-service.ts` / `transactions-messages.ts`: read-only journal service + copy; do not mix ops into them — new files.
- `mocks/handlers/admin-transactions.ts`: two GET handlers with `applyScenario("admin")` + `requireMockAdmin()`; add the six there (already registered in `mocks/handlers/index.ts`).
- `ledger.controller.ts`, `admin-reward-redrive.controller.ts`: see contract table; keep route prefixes, guards, pipes, `HttpCode`.
- `audit-log-view.ts` (`AUDIT_ACTION_LABELS` line 10), `AuditLogScreen.tsx:161` (info note).

### Guardrails

- `apiRequest` only; never import `mocks/` from app code (`no-direct-mocks.test.mjs`). Validate with shared schemas; read limits from `@rescom/schemas` (`MATURED_PENDING_RELEASE_MAX_LIMIT`), do not hard-code 500.
- `contract-callsites.test.mjs`: every FE-called path needs a backend e2e call. Already called: integrity, balance (`ledger.e2e-spec.ts:463,477`), internal/external re-drive, release-matured (`reward-settlement.e2e-spec.ts:329-536`). Missing: reconcile → Task 3.5.
- In MSW handlers keep each `http.<method>(apiUrl("…")` on one line (route-diff parser).
- Money moves: the FE never sends amounts, publisher or respondent — only the id (server derives everything, Epic 6 review P1).
- A11y: tabs per AC 1; inputs labelled, inline errors via `aria-invalid` + `aria-describedby` (14.3 review patch); result blocks `aria-live="polite"`; dialog `labelledBy`.
- Repo is public: demo ids only in mocks; no real data in the runbook.

### Previous story intelligence (14.1–14.3)

- 14.1 review: double-submit guard (ref) and no dismiss while busy — required here (AC 6).
- 14.2: `contract-callsites` failed until a backend e2e called the route (reconcile here).
- 14.3: `identity_audit_logs` is what the viewer shows; Outbox `admin-audit:*` rows never appear (D1=A there) — basis of this story's D2 default. Review asked for `aria-invalid`/`aria-describedby` on inputs and a retry on error states.
- Pre-existing: `admin-missing-code-reports.service.spec.ts` fails prettier; `rewards-flash.prisma.e2e:144` fails on develop — not caused by this story.

### Git intelligence

- Branch `feat/14-4-ledger-operations-panel` from `origin/develop` `d52ad29` (PR #59 / 14.3 merged).
- 14.3 (`670e56a`) layout: service / view / messages in `lib/admin`, MSW data + handlers, `node --test` view tests, contract test extension. Follow it.

### Latest tech information

- No new libraries. Next 16.3 (read `node_modules/next/dist/docs/` per `apps/frontend/my-app/AGENTS.md` before using unfamiliar APIs), React 19.2, zod 3.25, msw 2.15; NestJS + Prisma backend unchanged. Prisma `$queryRaw` returns `bigint` for `SUM` — cast `::int` in SQL (entries are `Int`).

### Project Structure Notes

- New FE: `transactions/components/{TransactionsTabs,LedgerOpsPanel,ConfirmOpDialog}.tsx`, `transactions/hooks/use-ledger-ops.ts`, `lib/admin/{ledger-ops-service,ledger-ops-view,ledger-ops-messages}.ts`, `tests/admin-ledger-ops.test.mjs`.
- New docs: `docs/ledger-operations-runbook.md`.
- Modified: `packages/schemas/src/economy/{ledger-account|ledger-ops,reward}.schema.ts` (+ specs, index), `ledger.service.ts`, `ports/ledger-repository.port.ts`, `prisma-ledger.repository.ts`, `in-memory-ledger.repository.ts`, `ledger.controller.ts` (+ spec), `admin-reward-redrive.controller.ts` (+ spec), `identity-audit.port.ts`, `test/ledger.e2e-spec.ts`, `test/reward-settlement.e2e-spec.ts`, `TransactionsScreen.tsx`, `mocks/data/admin-transactions.ts`, `mocks/handlers/admin-transactions.ts`, `mocks/data/admin-audit-logs.ts`, `tests/admin-contract.test.mjs`, `lib/admin/audit-log-view.ts`, `AuditLogScreen.tsx`, `docs/payos-production-runbook.md`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 14.4]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-18.md — gap 4, D3, D4]
- [Source: apps/backend/src/modules/economy/presentation/ledger.controller.ts:100-185]
- [Source: apps/backend/src/modules/participation/presentation/admin-reward-redrive.controller.ts]
- [Source: apps/backend/src/modules/economy/application/ledger.service.ts:2036-2067]
- [Source: apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts:75-90,337-418]
- [Source: apps/backend/src/modules/participation/application/participation.service.ts:1464-1556]
- [Source: apps/backend/src/common/http/http-exception.filter.ts]
- [Source: apps/backend/src/modules/auth/application/ports/identity-audit.port.ts]
- [Source: apps/backend/src/common/scheduler/outbox/prisma-outbox-claim.repository.ts:292]
- [Source: packages/schemas/src/economy/reward.schema.ts:99-162]
- [Source: apps/frontend/my-app/app/(signed-in)/(admin)/admin/disputes/components/{DisputeTabs,ConfirmDecisionDialog}.tsx, hooks/use-missing-code-resolution.ts]
- [Source: _bmad-output/implementation-artifacts/14-3-admin-audit-log-viewer.md]

## Dev Agent Record

### Agent Model Used

- Lead: claude-opus-5-5 (schemas, integration, fixes, manual check); executors: claude-sonnet (backend Tasks 2–3, frontend Tasks 4–7)

### Debug Log References

- `ledger.e2e-spec.ts` › `GET /economy/wallet` › "returns complete wallet aggregate" fails (expects 5 accounts, gets 6 with `REFUND_HOLD`). It fails the same way on baseline d52ad29 (checked with `apps/backend` stashed), so it is not caused by this story.
- `tests/rewards-admin-flash-domain.test.mjs` › "stats: daily fills every day, flash days only for started programs" failed when run just after midnight on 2026-10-19. It fails the same way on baseline (checked with `apps/frontend` stashed), so it depends on the clock and is not caused by this story.
- Drift SQL was run against Postgres `rescom_financial_test` (2,749 accounts) inside a transaction that skewed one account and was then rolled back. It returned exactly that account with `calculated` as an int.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- D1 = Option A and D2 = Option A were implemented. Quan said "continue" instead of answering the decision prompt, so both are still open for him to confirm in review.
- Task 1: added `packages/schemas/src/economy/ledger-ops.schema.ts` (integrity report with drifted accounts, balance verification, reconciliation result) and `maturedReleaseSummarySchema` in `reward.schema.ts`. All tests for both are in one new `ledger-ops.schema.spec.ts`; the story suggested two spec files. 712/712 pass.
- Task 2: `findDriftedAccounts(limit)` on the port, the Prisma repo (raw `GROUP BY … HAVING`, `::int`) and the in-memory repo. The service asks for 101 rows, keeps 100 and sets `driftedAccountsTruncated`; the story put the `+1` in the SQL instead. The local result interfaces now re-export the shared types.
- Task 3: three new `IdentityAuditAction` values. The audit is appended only after success, by `ledger.controller.ts` (reconcile, release-matured) and `admin-reward-redrive.controller.ts` (both re-drives; idempotent replays are audited too, since each call is an operator action). New reconcile e2e: 200 + audit + drift cleared, 403, and 404 `ACCOUNT_NOT_FOUND`, each with no audit on refusal. Re-drive and release audits are asserted in `reward-settlement.e2e-spec.ts`.
- Task 4–6: "Vận hành" tab on `/admin/transactions`. Both panels stay mounted (the inactive one is `hidden`), so the journal hook does not refetch. `redriveReward` makes one `apiRequest` per literal path, because the contract-callsites scanner cannot resolve a templated path. The input validation copy is new; the story gave none: "Mã không hợp lệ. Mã phải có dạng UUID." and "Nhập số nguyên từ 1 đến 500, hoặc để trống."
- Task 5: six MSW handlers with a mock ops store (one drifted account, 14 matured credits); `admin-contract.test.mjs` is extended. route-diff and contract-callsites pass.
- Task 7: three audit labels, three seed rows and a new info note in the 14.3 viewer; new `docs/ledger-operations-runbook.md`, linked from payOS runbook §7.
- Lead fix after the manual check: the reconcile confirm title and result line showed the account-id short code (#1404), while the row showed the owner (#7F3A). Both now use "owner · class" (e.g. "#7F3A · Khả dụng"). The unit test used the same UUID for account and owner, which hid the bug; it now uses distinct ids.
- Task 8.4 manual check, run in MSW mode in Chrome against the existing dev server on :3001:
  - Integrity showed the seeded drift.
  - Kiểm tra số dư showed "lệch".
  - Đối soát asked for confirmation, then the integrity check re-ran with no drift left.
  - Re-drive rejected a bad ID inline, showed the 404 copy for an unknown ID, and showed the result for the demo ID.
  - Release rejected limit 501 inline; limit 10 showed the summary and "Chạy tiếp".
  - The "Sổ giao dịch" tab is unchanged.
- Verification:
  - Schemas: 712/712.
  - Backend unit: 185 suites, 2763/2763.
  - e2e `ledger` + `reward-settlement`: 29 pass, 3 Postgres-only skipped, 1 known failure.
  - FE `npm test`: 1020/1021, with the clock-dependent failure above.
  - FE typecheck clean; eslint clean on changed files; backend tsc, eslint and prettier clean on changed files.
  - Not run: the `*.prisma.e2e` suites. The full backend e2e suite was started but stopped after 10 minutes.

### File List

- packages/schemas/src/economy/ledger-ops.schema.ts (new)
- packages/schemas/src/economy/ledger-ops.schema.spec.ts (new)
- packages/schemas/src/economy/reward.schema.ts
- packages/schemas/src/economy/index.ts
- apps/backend/src/modules/auth/application/ports/identity-audit.port.ts
- apps/backend/src/modules/economy/application/ledger.service.ts
- apps/backend/src/modules/economy/application/ledger.service.spec.ts
- apps/backend/src/modules/economy/application/ports/ledger-repository.port.ts
- apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts
- apps/backend/src/modules/economy/infrastructure/in-memory-ledger.repository.ts
- apps/backend/src/modules/economy/presentation/ledger.controller.ts
- apps/backend/src/modules/economy/presentation/ledger.controller.spec.ts
- apps/backend/src/modules/participation/presentation/admin-reward-redrive.controller.ts
- apps/backend/src/modules/participation/presentation/admin-reward-redrive.controller.spec.ts
- apps/backend/test/ledger.e2e-spec.ts
- apps/backend/test/reward-settlement.e2e-spec.ts
- apps/frontend/my-app/app/(signed-in)/(admin)/admin/transactions/components/TransactionsScreen.tsx
- apps/frontend/my-app/app/(signed-in)/(admin)/admin/transactions/components/TransactionsTabs.tsx (new)
- apps/frontend/my-app/app/(signed-in)/(admin)/admin/transactions/components/LedgerOpsPanel.tsx (new)
- apps/frontend/my-app/app/(signed-in)/(admin)/admin/transactions/components/ConfirmOpDialog.tsx (new)
- apps/frontend/my-app/app/(signed-in)/(admin)/admin/transactions/hooks/use-ledger-ops.ts (new)
- apps/frontend/my-app/lib/admin/ledger-ops-service.ts (new)
- apps/frontend/my-app/lib/admin/ledger-ops-view.ts (new)
- apps/frontend/my-app/lib/admin/ledger-ops-messages.ts (new)
- apps/frontend/my-app/tests/admin-ledger-ops.test.mjs (new)
- apps/frontend/my-app/tests/admin-contract.test.mjs
- apps/frontend/my-app/mocks/data/admin-transactions.ts
- apps/frontend/my-app/mocks/handlers/admin-transactions.ts
- apps/frontend/my-app/mocks/data/admin-audit-logs.ts
- apps/frontend/my-app/lib/admin/audit-log-view.ts
- apps/frontend/my-app/app/(signed-in)/(admin)/admin/audit-log/components/AuditLogScreen.tsx
- docs/ledger-operations-runbook.md (new)
- docs/payos-production-runbook.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-10-18: Story created (create-story), status ready-for-dev.
- 2026-10-19: Implemented (dev-story). Added the integrity drift report (D1=A), audit on the four operator routes (D2=A), the "Vận hành" tab with MSW and contract coverage, audit-viewer labels and the runbook. Status review.
