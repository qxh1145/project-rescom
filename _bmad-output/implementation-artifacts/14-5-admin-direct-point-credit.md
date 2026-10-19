---
baseline_commit: 859b1ef
---

# Story 14.5: Admin Direct Point Credit

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want to credit Points directly to a user,
so that I can compensate users or fix support cases without a raw ledger journal.

## Acceptance Criteria

1. **Credit route.** `POST /admin/users/:id/point-credits` (Session, Roles `ADMIN`, `CsrfGuard`, `JsonOnlyGuard`, `ParseUUIDPipe`, strict zod body `{ amount, reason, idempotencyKey }`) posts one journal `SYSTEM_ISSUANCE (−amount) → USER_AVAILABLE (+amount)` of the target user with idempotency key `admin-credit:{idempotencyKey}` and `description = reason` (trimmed). Response `200` with `adminPointCreditSchema` (`{ journalId, userId, amount, reason, createdAt, replayed }`). (FR-80, FR-ADD-11)
2. **Replay.** Same `idempotencyKey` + same target + same amount → `200` with the existing journal and `replayed: true`; no second journal, no second audit row, no second notification. Same key with a different target or amount → `409 IDEMPOTENCY_CONFLICT` (existing mapping). A concurrent duplicate that loses the insert race returns `409 LEDGER_COMMAND_IN_PROGRESS` (existing); its retry replays.
3. **Validation.** `amount`: integer ≥ 1, no business cap (schema upper bound = PostgreSQL `INT4` max `2_147_483_647`, a storage bound only). `reason`: trimmed, 10–500 characters. `idempotencyKey`: UUID. Extra keys → `400 VALIDATION_ERROR`.
4. **Refusals, nothing posted.** Live capability re-check (`ADMIN_CAPABILITY_PORT.findCurrentCapability(actorId)` must be `ADMIN` + `ACTIVE`, else `403` — reuse/clone `TopUpAdminCapabilityRequiredException` semantics as a new `AdminPointCreditCapabilityRequiredException` code `ADMIN_CAPABILITY_REQUIRED` if no generic one exists). Target = actor → `403 ADMIN_SELF_CREDIT_FORBIDDEN`. Target missing → `404 USER_NOT_FOUND` (existing `UserNotFoundException`). Target status `LOCKED` → `409 USER_BANNED` (Decision D3). Refusal writes no journal, no audit, no Outbox row.
5. **One transaction.** Journal, identity audit row `ADMIN_POINTS_CREDITED` (actor, target, amount, reason, journalId) and Outbox notification event commit in one `UNIT_OF_WORK_PORT.run('admin-credit:{key}', …)` (FR-57, FR-ADD-13). A failure in any of them rolls back all three (Decision D1).
6. **Notification.** The Outbox event is delivered by a new handler that publishes an in-app notification of new type `ADMIN_POINTS_CREDITED` (Decision D2) with message `"Bạn được Admin cộng {formatted amount} Điểm vào số dư Khả dụng. Lý do: {reason}"` (truncate to `NOTIFICATION_MESSAGE_MAX_LENGTH`), `dedupeKey = event.idempotencyKey`.
7. **Admin list.** New `GET /admin/users/:id/point-credits` (Session, Roles `ADMIN`, `ParseUUIDPipe`) returns `{ items: AdminPointCreditListItem[] }`, newest first, max 50: `{ journalId, amount, reason, createdAt, reversed, reversalJournalId, reversedAt }`. Unknown user → `200 { items: [] }`.
8. **Admin panel.** `/admin/users` detail panel gains a "Cộng Điểm" section (amount + reason + button) and a "Điểm đã cộng" list with "Hoàn tác" per non-reversed item. Submit opens a confirm dialog; when `amount > 5,000` the dialog also requires re-typing the amount and keeps "Cộng Điểm" disabled until it matches. Double-click sends one request (ref guard). The key is generated once per dialog opening with `randomUuid()` (`lib/random-uuid.ts`), reused on retry of the same payload, reset on close / success. Success: info notice "Đã cộng {n} Điểm cho #ABCD.", form cleared, detail (balance) and list reloaded. The section is hidden for the acting Admin's own row and disabled (with hint) when the user is `LOCKED`.
9. **Undo.** "Hoàn tác" opens a dialog with a required reason (10–500) and calls existing `POST /economy/journals/:id/reverse` with `{ reason }`. Backend: when the target journal key starts with `admin-credit:`, a missing / blank / <10-char reason → `400 VALIDATION_ERROR` (other journals keep today's optional reason). Available going negative → existing `409 INSUFFICIENT_BALANCE`; already reversed → existing `409 JOURNAL_ALREADY_REVERSED`. Both shown in Vietnamese. After success the list shows the item as "Đã hoàn tác" and the detail reloads.
10. **Reversal audit.** The reverse route appends identity audit `LEDGER_JOURNAL_REVERSED` (actor, `metadata: { targetJournalId, reversalJournalId, reason, adminCredit: boolean }`) after success (same after-success pattern as Story 14.4 D2). Refusals write nothing.
11. **User history.** In the user's wallet history the journal is labelled "Điểm cộng từ Admin" and its note shows the reason (`entry.description`). The admin `/admin/transactions` journal table labels it "Điểm cộng từ Admin" too.
12. **Ledger invariants.** `LedgerService.creditAdminPoints` is added to the `COMMANDS` table of `spend-journals.completeness.spec.ts` (credits `USER_AVAILABLE`, not a spend; `admin-credit:` is NOT added to `USER_AVAILABLE_DEBIT_JOURNALS`). The integrity check stays zero-sum after credit and after reversal (asserted in e2e).
13. **No debit, generic route unchanged.** No debit action. `POST /economy/journals` is untouched; `POST /economy/journals/:id/reverse` changes only per AC 9–10.
14. **Audit viewer.** `AUDIT_ACTION_LABELS` gains `ADMIN_POINTS_CREDITED` "Cộng Điểm thủ công" and `LEDGER_JOURNAL_REVERSED` "Hoàn tác giao dịch sổ cái"; the 14.3 info note mentions "cộng Điểm thủ công".
15. **Contract tests.** MSW handlers for the two new routes and for `POST /economy/journals/:id/reverse` (enabled mock mode, shared-schema parsed). `tests/route-diff.test.mjs` passes unchanged (backend serves all three), `tests/contract-callsites.test.mjs` passes (backend e2e calls each FE-called path — reverse already has `ledger.e2e-spec.ts` coverage; check), `tests/admin-contract.test.mjs` covers 401/403 for the new routes.

## Tasks / Subtasks

- [x] Task 1: Shared schemas (AC: 1, 3, 7)
  - [x] 1.1 `packages/schemas/src/users/admin-users.schema.ts` (where the lock-reason schema lives; re-export via its index): `ADMIN_POINT_CREDIT_REASON_MIN = 10`, `ADMIN_POINT_CREDIT_REASON_MAX = 500`, `ADMIN_POINT_CREDIT_CONFIRM_THRESHOLD = 5000`, `ADMIN_POINT_CREDIT_MAX_AMOUNT = 2_147_483_647`, `ADMIN_CREDIT_KEY_PREFIX = 'admin-credit:'`; strict `createAdminPointCreditSchema = { amount: int().min(1).max(MAX), reason: string().trim().min(10).max(500), idempotencyKey: string().uuid() }`; strict `adminPointCreditSchema` (AC 1 shape, `createdAt` datetime); strict `adminPointCreditListItemSchema` + `adminPointCreditListSchema = { items: array }`; `ADMIN_POINTS_CREDITED_EVENT_TYPE = 'AdminPointsCredited'` + strict `adminPointsCreditedPayloadSchema = { journalId, userId, amount, reason, actorId }`.
  - [x] 1.2 `packages/schemas/src/notifications/notification.schema.ts`: append `'ADMIN_POINTS_CREDITED'` at the END of `NOTIFICATION_TYPES` (order must match Prisma).
  - [x] 1.3 Spec tests (valid, extra key, reason 9/501 chars after trim, amount 0 / 1.5 / max+1, non-uuid key). `cd packages/schemas && npm run build && npm test`.
- [x] Task 2: Migration + notification type (AC: 6)
  - [x] 2.1 `apps/backend/prisma/schema.prisma` `enum NotificationType`: append `ADMIN_POINTS_CREDITED` with a `/// Story 14.5` comment. New migration `prisma/migrations/20261024100000_admin_point_credit/migration.sql`: `ALTER TYPE "NotificationType" ADD VALUE 'ADMIN_POINTS_CREDITED';` (copy the header style of `20261023100000_missing_code_resolution`). `npx prisma generate`.
  - [x] 2.2 Update `notification-type.parity.spec.ts` (it asserts the tail order).
  - [x] 2.3 FE `lib/notifications/notification-presentation.ts`: add the type to both exhaustive maps — `NOTIFICATION_PRESENTATION` (`:21`, icon/tone like `TOPUP_SUCCESS`) and `NOTIFICATION_TITLES` (`:95`, "Điểm cộng từ Admin"); check the email templates switch (`notifications/application/email-templates.ts`, `email-delivery.handler.ts`) for an exhaustive per-type map and add the case if needed (in-app only is fine — no email).
- [x] Task 3: Ledger (AC: 1, 2, 12)
  - [x] 3.1 `LedgerService.creditAdminPoints({ userId, amount, reason, idempotencyKey })` next to `grantStarterPoints` / `creditApprovedTopUp` (`ledger.service.ts:~2168, ~2385`): `getOrCreateAccount(null,'SYSTEM_ISSUANCE')`, `getOrCreateAccount(userId,'USER_AVAILABLE')`, `postJournal({ idempotencyKey: ADMIN_CREDIT_KEY_PREFIX + idempotencyKey, description: reason, entries: [−amount issuance, +amount available] })`. Returns the journal (existing `postJournal` replay returns the existing compatible journal; incompatible → `IdempotencyConflictException`).
  - [x] 3.2 Add `LedgerService.findAdminCreditJournal(idempotencyKey)` (non-posting, add to `NON_POSTING_METHODS`) or reuse `ledgerRepo.findJournalByIdempotencyKey` from the service — needed for replay detection in Task 4 BEFORE posting (Dev Notes "Replay").
  - [x] 3.3 `LedgerRepositoryPort.findAdminCreditsForUser(userId, limit)` + Prisma (one query: journals with key `LIKE 'admin-credit:%'` having an entry on the user's `USER_AVAILABLE` account, left join the reversal journal via `reverses_journal_id`, `ORDER BY created_at DESC, id DESC LIMIT`) + in-memory twin. Expose through `LedgerService.listAdminCredits(userId)` (limit 50; add to `NON_POSTING_METHODS`).
  - [x] 3.4 `reverseJournal` (`ledger.service.ts:538`): after loading the target, if `target.idempotencyKey.startsWith(ADMIN_CREDIT_KEY_PREFIX)` and `(reason?.trim().length ?? 0) < 10` → throw a 400 `VALIDATION_ERROR` (reuse the existing validation exception used by the filter; check `economy.exceptions.ts`). Reason > 500 is already refused by `reverseJournalInputSchema`.
  - [x] 3.5 `spend-journals.completeness.spec.ts`: add `creditAdminPoints` to `COMMANDS`; new non-posting methods to `NON_POSTING_METHODS`. Unit tests in `ledger.service.spec.ts`: credit posts balanced journal; replay returns same id; incompatible replay 409; reversal of admin credit without reason 400; with reason OK; second reversal 409 `JOURNAL_ALREADY_REVERSED`; reversal after spending → `InsufficientBalanceException`.
- [x] Task 4: Credit service, Outbox, audit (AC: 1, 2, 4, 5, 6)
  - [x] 4.1 `PrismaIdentityAuditRepository.append` (`auth/infrastructure/prisma-identity-audit.repository.ts:18`): write through `currentClient(this.prisma)` so it joins an ambient Unit of Work (Decision D1). Outside a UoW behaviour is unchanged. Grep every `append(` caller and confirm none runs inside a UoW today (record the check in Completion Notes).
  - [x] 4.2 New `economy/application/admin-point-credit.service.ts` (`AdminPointCreditService`, deps: `LedgerService`, `ADMIN_CAPABILITY_PORT`, `UNIT_OF_WORK_PORT`, `IDENTITY_AUDIT_PORT`, new `ADMIN_POINT_CREDIT_OUTBOX_PORT`). `credit(actorId, targetUserId, input)` inside `unitOfWork.run('admin-credit:'+key, …)` in this order: (a) actor capability; (b) self → 403; (c) existing journal by key → if compatible (same user USER_AVAILABLE entry + amount) return `replayed: true`, else `IdempotencyConflictException`; (d) `findCurrentCapability(targetUserId)` → null 404 / `LOCKED` 409; (e) `creditAdminPoints`; (f) `audit.append({ action: 'ADMIN_POINTS_CREDITED', userId: actorId, targetUserId, outcome: 'SUCCESS', errorCode: null, metadata: { journalId, amount, reason } })`; (g) outbox port `enqueueCredited(...)`.
  - [x] 4.3 Outbox port + Prisma adapter (`economy/infrastructure/prisma-admin-point-credit-outbox.ts`, `runInTransaction` + `tx.outboxEvent.create`, field set copied from `prisma-top-up.repository.ts:163`): `idempotencyKey = 'admin-points-credited:' + journalId`, `eventType = ADMIN_POINTS_CREDITED_EVENT_TYPE`, `aggregateType 'LedgerJournal'`, `aggregateId journalId`, payload parsed with the shared schema. In-memory twin for unit tests.
  - [x] 4.4 `economy/application/admin-points-credited-notification.handler.ts` (copy `top-up-refund-notification.handler.ts` structure), registered where `TopUpRefundNotificationHandler` is (`economy.module.ts:281` + its scheduler registrar).
  - [x] 4.5 Exceptions in `economy/application/exceptions/`: `AdminSelfCreditForbiddenException` (`ADMIN_SELF_CREDIT_FORBIDDEN`), `UserBannedException` (`USER_BANNED`), capability exception if needed; branches in `common/http/http-exception.filter.ts` (403 / 409) + cases in `http-exception.filter.spec.ts`.
  - [x] 4.6 `identity-audit.port.ts`: add `'ADMIN_POINTS_CREDITED' | 'LEDGER_JOURNAL_REVERSED'` with `// Story 14.5`.
  - [x] 4.7 Unit spec `admin-point-credit.service.spec.ts` with in-memory ledger + `PassThroughUnitOfWork`: every refusal posts nothing / audits nothing / enqueues nothing; replay enqueues nothing; happy path one of each.
- [x] Task 5: Controllers (AC: 1, 7, 10)
  - [x] 5.1 New `economy/presentation/admin-point-credits.controller.ts`, `@Controller(['admin/users', 'api/admin/users'])`, class `@UseGuards(SessionAuthGuard, RolesGuard) @Roles('ADMIN')`: `@Post(':id/point-credits') @HttpCode(200) @UseGuards(JsonOnlyGuard, CsrfGuard) @UsePipes(new ZodValidationPipe(createAdminPointCreditSchema,'VALIDATION_ERROR','body'))` and `@Get(':id/point-credits')`. Register in `EconomyModule.controllers` (keeps the admin module free of economy wiring; `AdminUsersController` keeps its routes). Use the exact decorator style `tests/helpers/backend-routes.mjs` parses.
  - [x] 5.2 `ledger.controller.ts` reverse route: take `@CurrentUser()`, after success `await this.audit.append({ action: 'LEDGER_JOURNAL_REVERSED', … })` (port already injected in 14.4). Update `ledger.controller.spec.ts`.
  - [x] 5.3 E2E: new `test/admin-point-credits.e2e-spec.ts` (copy setup of `test/ledger.e2e-spec.ts` / `admin-audit-logs.e2e-spec.ts`, override `IDENTITY_AUDIT_PORT` with `InMemoryIdentityAuditRepository`): 200 credit + wallet Available +amount + audit row + integrity zero-sum; replay 200 `replayed: true` same journalId, balance unchanged; different amount same key 409; self 403; LOCKED target 409 `USER_BANNED`; non-admin 403; no CSRF 403; extra key 400; reason 9 chars 400; GET list shows item; reverse without reason 400, with reason 200 + `LEDGER_JOURNAL_REVERSED` audit + list `reversed: true` + integrity zero-sum; second reverse 409.
  - [x] 5.4 Prisma e2e (`*.prisma.e2e-spec.ts`, default DB `rescom_financial_test` on :5433): one test proving atomicity — force the outbox insert to fail (e.g. pre-insert a row with the same outbox `idempotencyKey`) → no journal and no audit row persisted. Also confirms the migration applies.
- [x] Task 6: FE service, view, messages (AC: 8, 9, 11, 14)
  - [x] 6.1 `lib/admin/users-service.ts`: `creditAdminUserPoints(userId, body)` (POST, schema `adminPointCreditSchema`), `listAdminUserPointCredits(userId, signal?)` (GET), `reverseAdminPointCredit(journalId, reason)` (`POST /economy/journals/${encodeURIComponent(id)}/reverse`, body `{ reason }`; response schema = the existing journal schema the backend returns — check `ledger.controller.ts` reverse return and `packages/schemas/src/economy/ledger-journal.schema.ts`). Literal template paths (contract-callsites parser). Update the header VERIFIED list.
  - [x] 6.2 `lib/admin/users-view.ts`: `parseCreditAmount(raw)` (trim, strip `.`/`,`/spaces, `/^\d+$/`, safe int, 1..MAX → `{ amount } | { error }`; copy `parseRedriveId`/`parseReleaseLimit` shape from `ledger-ops-view.ts:31-49`), `creditReasonError(reason)` (reuse `lockReasonError` logic — generalise it rather than duplicate), `needsRetypeConfirm(amount)` (`> ADMIN_POINT_CREDIT_CONFIRM_THRESHOLD`), `retypeMatches(raw, amount)`.
  - [x] 6.3 `lib/admin/users-messages.ts`: extend the action union with `"credit" | "reverse"` and codes (Dev Notes "Errors").
  - [x] 6.4 `lib/wallet/wallet-history.ts`: `HistoryKind` += `"ADMIN_CREDIT"`; `KEY_PREFIXES` += `["admin-credit:", "ADMIN_CREDIT"]`; `TITLES.ADMIN_CREDIT = "Điểm cộng từ Admin"`; `notesOf` case → `{ note: "Lý do: " + description, shortNote: description }` (empty description → empty note). `lib/admin/admin-transactions.ts` `TITLES.ADMIN_CREDIT = "Điểm cộng từ Admin"` (+ `relatedFallback` / implied source = "Hệ thống" if the switch needs it).
  - [x] 6.5 `lib/admin/audit-log-view.ts` labels (AC 14); `AuditLogScreen.tsx` info note.
  - [x] 6.6 Tests: `tests/admin-users.test.mjs` (parse/retype/reason/service bodies/messages), `tests/wallet-history.test.mjs` (admin-credit row title + note; its reversal stays `REVERSAL`), `tests/admin-audit-log-view.test.mjs`.
- [x] Task 7: MSW (AC: 15)
  - [x] 7.1 `mocks/data/admin-users.ts`: per-user credit store; credit raises the mock `balance.available`; key replay returns the same record; self (mock admin id) 403; LOCKED 409 `USER_BANNED`.
  - [x] 7.2 `mocks/handlers/admin-users.ts`: `POST` + `GET` `/admin/users/:id/point-credits` (one-line `http.<method>(apiUrl("…")`, `applyScenario("admin")`, `requireMockAdmin()`, `missingCsrf`, body parsed with `createAdminPointCreditSchema` → 400). Reverse handler `POST /economy/journals/:id/reverse` (in the economy/admin-transactions handler file that owns `/economy/*`): known mock credit → mark reversed, decrease balance (409 `INSUFFICIENT_BALANCE` if it would go negative), second time 409 `JOURNAL_ALREADY_REVERSED`, missing reason for a credit 400.
  - [x] 7.3 `tests/admin-contract.test.mjs`: GET route in `ROUTES`, POST routes in the mutating 401/403 loop, one flow test (credit → list → reverse → reverse again 409).
- [x] Task 8: Panel UI (AC: 8, 9)
  - [x] 8.1 `admin/users/hooks/use-point-credits.ts`: list query (`useApiQuery("admin:user:<id>:credits", …)`), `credit` / `reverse` actions with `busy`, `error`, ref guard (`use-ledger-ops.ts:61` pattern), key ref (`CancelAttemptDialog.tsx:27-43` pattern), session loss → `refresh()` like `use-user-actions.ts`. On success: `reloadDetail()` (from `use-admin-users.ts`) + list reload.
  - [x] 8.2 `components/PointCreditSection.tsx` (rendered in `UserDetailPanel.tsx` as a new `border-t border-line-subtle pt-4` block after the role block): `TextField` amount (`inputMode="numeric"`, `endSlot="Điểm"`), `Textarea` reason (`maxLength` 500 → built-in counter), primary "Cộng Điểm"; list rows: `formatPoints(amount)` Điểm · `formatDayMonthTime(createdAt)` · reason (clamped) · `Tag` "Đã hoàn tác" or `Button size="sm" variant="outline"` "Hoàn tác".
  - [x] 8.3 `components/PointCreditDialog.tsx` + `ReverseCreditDialog.tsx` (structure of `ConfirmUserActionDialog.tsx`; `dismissible={!busy}`, own `labelledBy` ids; retype `TextField` with `aria-invalid`/`aria-describedby`).
  - [x] 8.4 Hidden for own row (`actor.id === user.id`); disabled with hint when `user.status === "LOCKED"`.
- [x] Task 9: Docs + verification (AC: all)
  - [x] 9.1 `docs/ledger-operations-runbook.md`: short "Cộng Điểm thủ công / Hoàn tác" section (when, audit names, known refund risk).
  - [x] 9.2 `cd packages/schemas && npm run build && npm test`; backend `npx jest src/modules/economy src/modules/auth src/modules/notifications src/common/http`, the new e2e + `ledger.e2e-spec.ts`, the Prisma e2e, then full `npx jest`; eslint + prettier on changed files; `npx tsc --noEmit`.
  - [x] 9.3 `cd apps/frontend/my-app && npm test && npm run typecheck && npm run lint`.
  - [x] 9.4 Manual (MSW, mock admin): credit 100 → notice + balance; credit 6000 → retype mismatch keeps button disabled, match → success; LOCKED user disabled; own row hidden; "Hoàn tác" without reason inline error, with reason → "Đã hoàn tác"; wallet history (respondent mock) shows "Điểm cộng từ Admin" + reason.

### Review Findings

_Code review 2026-10-19 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 0 decision-needed, 9 patch, 0 defer, 17 dismissed._

- [x] [Review][Patch] Failed credits-list load renders the empty state "Chưa có lần cộng Điểm nào."; `queryError` from `use-point-credits.ts:91` is never shown, so the admin may credit again with a fresh key (double credit) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/users/components/PointCreditSection.tsx:157]
- [x] [Review][Patch] Replayed reversal (same `reversal:{id}` key + same reason → service returns the existing journal) appends a second `LEDGER_JOURNAL_REVERSED` audit row; audit only when the reversal was newly posted (AC 2/10 intent) [apps/backend/src/modules/economy/presentation/ledger.controller.ts:86]
- [x] [Review][Patch] ReverseCreditDialog keeps the previous reason after a successful reversal: success sets `reverseTarget` to null without `close()`, the dialog stays mounted, next "Hoàn tác" opens pre-filled [apps/frontend/my-app/app/(signed-in)/(admin)/admin/users/components/PointCreditSection.tsx:84]
- [x] [Review][Patch] Replay branch calls `getOrCreateAccount(targetUserId, 'USER_AVAILABLE')` (a write) before target validation; use a read-only account lookup for the compatibility check [apps/backend/src/modules/economy/application/admin-point-credit.service.ts:67]
- [x] [Review][Patch] Prisma atomicity test stubs `enqueueCredited` with `mockRejectedValueOnce` instead of forcing the real outbox insert to fail (Task 5.4: pre-insert a row with key `admin-points-credited:{journalId}`), so it does not prove `PrismaAdminPointCreditOutbox` joins the ambient tx [apps/backend/test/admin-point-credits.prisma.e2e-spec.ts:144]
- [x] [Review][Patch] Prettier regressions: `prettier --check` fails on 12 changed/new backend files (clean at HEAD); Task 9.2 marked done [apps/backend/src/modules/economy/application/ledger.service.ts]
- [x] [Review][Patch] Hard-coded `'admin-credit:'` literal instead of `ADMIN_CREDIT_KEY_PREFIX` [apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts:639, in-memory-ledger.repository.ts:554]
- [x] [Review][Patch] Dead FE error key `ADMIN_POINT_CREDIT_CAPABILITY_REQUIRED` — backend emits `ADMIN_CAPABILITY_REQUIRED` (economy.exceptions.ts:439); verify the actual code maps to the intended copy and drop the dead key [apps/frontend/my-app/lib/admin/users-messages.ts:34]
- [x] [Review][Patch] Missing tests asked by Task 3.5 / AC 7: unit "reversal after replayed credit"; e2e "GET point-credits for unknown user → 200 `{ items: [] }`" [apps/backend/src/modules/economy/application/ledger.service.spec.ts]

## Dev Notes

### Scope boundary (read first)

- Backend: 2 new admin routes, reverse-route tweaks (reason rule for admin credits + audit), one additive enum migration, one Outbox handler. No change to `POST /economy/journals`, to top-up/refund logic, or to `/admin/ledger/journals` filters (an admin credit shows under "Tất cả" there; no new bucket).
- No Figma (Epic 14 D3). Reuse `TextField`, `Textarea`, `Button`, `Alert`, `Tag`, `Dialog`, `StatCard` from `components/ui` and the panel's existing patterns.
- No debit, no batch credit, no credit to Pending, no pagination of the credits list (newest 50; `ponytail:` comment naming the ceiling).

### Owner decisions already made (sprint-change-proposal-2026-10-18 Addendum A)

D5 destination `USER_AVAILABLE` from `SYSTEM_ISSUANCE`; D6 no hard cap, >5,000 re-type; D7 credit only, undo = journal reverse. Defaults: self-credit forbidden, banned users refused, reason 10–500, dedicated route.

### Story decisions (D1, D2 confirmed by Quan 2026-10-19; D3–D5 defaults)

- **D1 — atomic audit in `identity_audit_logs` (confirmed).** AC 5 needs journal + audit + notification in one transaction, and the 14.3 viewer only reads `identity_audit_logs`. `PrismaIdentityAuditRepository.append` today writes with `this.prisma` (not tx-aware). Default: switch it to `currentClient(this.prisma)` (one line, `common/database/prisma-unit-of-work.ts:118`) so it joins the ambient UoW. Precedent for writing that table in a tx: `prisma-user-admin-transaction.adapter.ts:95`. Alternative B: Outbox `admin-audit:*` event like top-up — atomic but invisible in the viewer (14.3 D1).
- **D2 — new notification type `ADMIN_POINTS_CREDITED` (confirmed)** (additive `ALTER TYPE … ADD VALUE` migration + schema list + parity spec). No existing type fits (`REWARD_EARNED` = survey reward, `TOPUP_SUCCESS` = top-up). Alternative: reuse `TOPUP_SUCCESS`, no migration, misleading icon/copy.
- **D3 — "banned" = `UserStatus.LOCKED`.** There is no BANNED status (`schema.prisma:19` `ACTIVE | LOCKED`). The code stays `USER_BANNED` as the AC says.
- **D4 — reverse audit for every reversal.** PRD FR-80 "every credit and reversal is audited". The reverse route has no audit today; appending after success for all reversals is simpler than special-casing admin credits and matches 14.4 D2.
- **D5 — reason required only for `admin-credit:` reversals** (AC 9). Other callers of the generic reverse route keep optional reason.

### Replay (AC 2) — order matters

Inside a UoW a duplicate-key insert aborts the PostgreSQL transaction (`isInAmbientTransaction`, Epic 6 review P14) and the Outbox `idempotencyKey` is unique too. So check the existing journal by key FIRST and return early; never call the outbox/audit on replay. Compatibility = same target user's `USER_AVAILABLE` entry and same amount (reason difference is ignored — first write wins). `unitOfWork.run` key is a label, not a lock: two concurrent first requests → loser gets `ConcurrentLedgerCommandException` (409 `LEDGER_COMMAND_IN_PROGRESS`); FE retry with the same key replays.

### Backend facts (verified)

- No journal type column: the "type" is the idempotency-key prefix (`LedgerJournal`: id, idempotencyKey, description, reversesJournalId, createdAt — `schema.prisma:635-657`). No migration for the journal type. Reason lives in `description` (max 500) and `GET /economy/wallet` already returns it to the user.
- Posting: `LedgerService.postJournal` `ledger.service.ts:451`; accounts `getOrCreateAccount` `:287`; locks ascending `prisma-ledger.repository.ts:309-348`; `postJournalTransaction` uses `runInTransaction` (joins UoW).
- Reverse: `ledger.controller.ts:~70-85` (`RolesGuard, CsrfGuard, JsonOnlyGuard`, `ParseUUIDPipe`, no zod pipe); `reverseJournalInputSchema` (`packages/schemas/src/economy/ledger-journal.schema.ts:40-50`, reason optional ≤500, key defaults to `reversal:{id}`); service `ledger.service.ts:538-673` (top-up keys refused; `JOURNAL_ALREADY_REVERSED` 409; negative Available → `InsufficientBalanceException` 409). A reversal's key is `reversal:{id}`, never `admin-credit:` — the FE list must derive "reversed" from the reversal link, not the key.
- Capability: `ADMIN_CAPABILITY_PORT.findCurrentCapability(userId)` → `{ role, status } | null` with a share lock in the UoW (`economy/application/ports/admin-capability.port.ts`); usable for the target too. Pattern `top-up.service.ts:~310-330`.
- Outbox write pattern: `prisma-top-up.repository.ts:141-184`; handler pattern `top-up-refund-notification.handler.ts`; publisher `notifications/application/ports/notification-publisher.port.ts:31` (idempotent per `(userId, dedupeKey)`).
- `EconomyModule` is `@Global`, imports `AuthModule` (`IDENTITY_AUDIT_PORT`) and `PrismaModule` (`UNIT_OF_WORK_PORT`).
- Known accepted risk (Addendum A): admin-credited Points are fungible in Available, so a top-up refund check (`placeTopUpRefundHold`, `ledger.service.ts:~2605-2685`, `Available ≥ points` + `hasSpendSince`) can be satisfied by an admin credit. Do not change the refund logic; mention it in the runbook. Also: a reversal fails with `INSUFFICIENT_BALANCE` once the user spent the credit — expected, undo is "never below zero".

### Frontend facts (verified)

- `/admin/users`: `UsersScreen.tsx` → `UsersTable` + `UserDetailPanel.tsx` (inline section, `key={selected.id}` resets state per user). Hooks `use-admin-users.ts` (`reloadDetail`, `applyUpdate`), `use-user-actions.ts` (no ref guard today — add one in the new hook, do not refactor the old one). Dialog `ConfirmUserActionDialog.tsx` (fixed `labelledBy` — give new dialogs their own ids).
- Admin users service is real backend (VERIFIED header `lib/admin/users-service.ts:6-26`); `balance` is optional in the view schema — after credit, reload the detail, do not compute locally.
- No FE caller of the reverse route exists yet; no MSW handler either.
- Idempotency key: `randomUuid()` from `lib/random-uuid.ts` (falls back without `crypto.randomUUID` on http LAN). If the Admin edits amount/reason after a failed attempt, generate a new key (otherwise the replay would silently return the first payload / 409).
- Wallet history kinds: `lib/wallet/wallet-history.ts` (`HistoryKind` 26-44, `KEY_PREFIXES` 83-104, `TITLES` ~140-158, `notesOf` ~190-236); admin `lib/admin/admin-transactions.ts` `TITLES` ~125-143 is `Record<HistoryKind,…>` — exhaustive, must add the key or typecheck fails.
- Helpers: `formatPoints` (`lib/wallet/top-up.ts:34`), `shortCodeOf` / `formatDayMonthTime` / `lockReasonError` / `LOCK_REASON_MIN|MAX` (`lib/admin/users-view.ts`).

### Copy

- Section "Cộng Điểm"; amount label "Số Điểm", reason label "Lý do (10–500 ký tự)"; button "Cộng Điểm". Hint when LOCKED: "Không thể cộng Điểm cho tài khoản đang bị khoá."
- Confirm: title "Cộng {n} Điểm cho #ABCD?", body "Điểm được cộng ngay vào số dư Khả dụng và người dùng sẽ nhận thông báo kèm lý do. Muốn hoàn tác, dùng \"Hoàn tác\" trong danh sách bên dưới." Retype (>5,000): label "Nhập lại số Điểm để xác nhận", mismatch error "Số Điểm nhập lại không khớp." Confirm "Cộng Điểm", busy "Đang cộng…".
- List heading "Điểm đã cộng"; empty "Chưa có lần cộng Điểm nào."; reversed tag "Đã hoàn tác".
- Reverse dialog: title "Hoàn tác {n} Điểm đã cộng?", body "Hệ thống tạo bút toán đảo, trừ {n} Điểm khỏi số dư Khả dụng của người dùng. Không thực hiện được nếu người dùng đã dùng số Điểm này.", reason label "Lý do hoàn tác", confirm "Hoàn tác".
- Inline: amount "Nhập số nguyên dương." ; reason via the generalised `lockReasonError` copy.

### Errors (`userActionErrorMessage` for `credit` / `reverse`)

| Code | Message |
|---|---|
| `ADMIN_SELF_CREDIT_FORBIDDEN` | "Bạn không thể tự cộng Điểm cho tài khoản của mình." |
| `USER_BANNED` | "Tài khoản này đang bị khoá nên không thể cộng Điểm." |
| `USER_NOT_FOUND` | existing copy |
| `IDEMPOTENCY_CONFLICT` | "Yêu cầu này đã được gửi với nội dung khác. Đóng hộp thoại và thử lại." |
| `LEDGER_COMMAND_IN_PROGRESS` | "Một thao tác khác trên sổ cái đang chạy. Thử lại sau vài giây." |
| `ADMIN_CAPABILITY_REQUIRED` / 403 | "Tài khoản của bạn không có quyền cộng Điểm." |
| `INSUFFICIENT_BALANCE` (reverse) | "Người dùng đã dùng một phần số Điểm này nên không thể hoàn tác." |
| `JOURNAL_ALREADY_REVERSED` | "Khoản cộng Điểm này đã được hoàn tác." |
| `JOURNAL_NOT_FOUND` | "Không tìm thấy giao dịch này." |
| `VALIDATION_ERROR` | "Dữ liệu gửi lên không hợp lệ." |
| network / 429 / other | existing shared copy in `users-messages.ts` |

### Guardrails

- FE never sends anything but `{ amount, reason, idempotencyKey }`; server derives accounts.
- `apiRequest` only; no `mocks/` import in app code; one-line `http.<method>(apiUrl("…")` in handlers; backend route must land with the MSW handler (route-diff gate `MOCK_ONLY: 3, DEFERRED_KEEP_MOCK: 14` stays unchanged).
- `contract-callsites`: every FE-called path needs a backend e2e call — Task 5.3 covers both new paths; reverse is called in `ledger.e2e-spec.ts` (verify, else add).
- A11y: inputs labelled, `aria-invalid` + `aria-describedby` on errors, result notices `aria-live="polite"`, dialogs `labelledBy`.
- Repo is public: demo ids/names only in mocks and docs.
- Migration: additive enum only; `ADD VALUE` cannot run inside a transaction block in older PG — copy the exact form used by the 14.1 migration.

### Previous story intelligence (14.1–14.4)

- 14.1: money command = UoW + Outbox in one tx; respondent notice through an Outbox handler; double-submit ref guard; dialog not dismissible while busy; Prisma e2e defaults to `rescom_financial_test` :5433, no env var.
- 14.2: `contract-callsites` fails until a backend e2e calls the FE path.
- 14.3: viewer = `identity_audit_logs` only; masked metadata keys (`password`, `secret`, `tokenhash`, `accountno`, `accountnumber` suffixes) — `reason`/`amount` are fine.
- 14.4: audit after success via `IDENTITY_AUDIT_PORT` in controllers; `LedgerController` already injects the port; a templated path the callsite scanner cannot resolve must be a literal per call; unit test ids must differ (account vs owner) to catch label bugs.
- Pre-existing failures not caused here: `rewards-admin-flash-domain` "stats: daily fills" (clock), `rewards-flash.prisma.e2e:144`, prettier on `admin-missing-code-reports.service.spec.ts`.

### Git intelligence

- Branch `feat/14-5-admin-direct-point-credit` from `origin/develop` `859b1ef` (PR #60 / 14.4 merged).
- Follow 14.4 (`eb157a1`) layout: shared schema → backend → `lib/admin` service/view/messages → MSW + contract test → screen.

### Latest tech information

- No new libraries. Next 16.3 (read `node_modules/next/dist/docs/` per `apps/frontend/my-app/AGENTS.md`), React 19.2, zod 3.25, msw 2.15, NestJS + Prisma unchanged. PostgreSQL `ALTER TYPE … ADD VALUE` is not usable in the same transaction that uses the new value — keep the migration single-statement.

### Project Structure Notes

- New BE: `economy/application/admin-point-credit.service.ts` (+spec), `economy/application/admin-points-credited-notification.handler.ts` (+spec), `economy/application/ports/admin-point-credit-outbox.port.ts`, `economy/infrastructure/prisma-admin-point-credit-outbox.ts` (+ in-memory), `economy/presentation/admin-point-credits.controller.ts` (+spec), exceptions, `prisma/migrations/20261024100000_admin_point_credit/`, `test/admin-point-credits.e2e-spec.ts`, one `*.prisma.e2e-spec.ts`.
- New FE: `admin/users/hooks/use-point-credits.ts`, `admin/users/components/{PointCreditSection,PointCreditDialog,ReverseCreditDialog}.tsx`.
- Modified: shared `users/admin-users.schema.ts`, `notifications/notification.schema.ts`; BE `schema.prisma`, `ledger.service.ts` (+spec), ledger repo port/prisma/in-memory, `spend-journals.completeness.spec.ts`, `ledger.controller.ts` (+spec), `identity-audit.port.ts`, `prisma-identity-audit.repository.ts`, `economy.module.ts`, `http-exception.filter.ts` (+spec), `notification-type.parity.spec.ts`; FE `users-service.ts`, `users-view.ts`, `users-messages.ts`, `UserDetailPanel.tsx`, `wallet-history.ts`, `admin-transactions.ts`, `audit-log-view.ts`, `AuditLogScreen.tsx`, `notification-presentation.ts`, MSW data/handlers, tests; `docs/ledger-operations-runbook.md`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 14.5]
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#FR-80]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-18.md#Addendum A]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-1, #AD-16, #Consistency Conventions]
- [Source: apps/backend/src/modules/economy/application/ledger.service.ts:287,451,538-673,~2168,~2385,~2605]
- [Source: apps/backend/src/modules/economy/application/top-up.service.ts:~214-330]
- [Source: apps/backend/src/modules/economy/infrastructure/prisma-top-up.repository.ts:141-184]
- [Source: apps/backend/src/modules/economy/application/top-up-refund-notification.handler.ts]
- [Source: apps/backend/src/modules/economy/application/spend-journals.completeness.spec.ts]
- [Source: apps/backend/src/modules/auth/infrastructure/prisma-identity-audit.repository.ts]
- [Source: apps/backend/src/common/database/prisma-unit-of-work.ts]
- [Source: apps/frontend/my-app/app/(signed-in)/(admin)/admin/users/components/UserDetailPanel.tsx]
- [Source: apps/frontend/my-app/lib/wallet/wallet-history.ts]
- [Source: _bmad-output/implementation-artifacts/14-4-ledger-operations-panel.md]

## Dev Agent Record

### Agent Model Used
Gemini 3.8 Flash (High)

### Debug Log References

### Completion Notes List

- Implemented Task 1: schemas & constants in `admin-users.schema.ts` and `notification.schema.ts` with 100% tests passing (53 suites, 719 tests).
- Implemented Task 2: prisma migration `20261024100000_admin_point_credit` adding `ADMIN_POINTS_CREDITED` to NotificationType enum, verified parity spec, updated FE notification presentation mapping.
- Implemented Task 3: `LedgerService.creditAdminPoints`, `findAdminCreditJournal`, `listAdminCredits`, and `findJournalById`. Updated `reverseJournal` to enforce minimum 10 characters for `admin-credit:` reversals. Updated `spend-journals.completeness.spec.ts` and `ledger.service.spec.ts`.
- Implemented Task 4: `AdminPointCreditService` with UoW atomicity, `PrismaIdentityAuditRepository.append` using `currentClient(this.prisma)` within ambient UoW (verified no prior callers ran inside a UoW), outbox port and prisma adapter, notification handler `AdminPointsCreditedNotificationHandler`, exceptions and HTTP filter mappings for 403 `ADMIN_SELF_CREDIT_FORBIDDEN` and 409 `USER_BANNED`.
- Implemented Task 5: `AdminPointCreditsController` with envelope wrapping, `LedgerController.reverseJournal` emitting audit `LEDGER_JOURNAL_REVERSED`. Comprehensive e2e test suite `test/admin-point-credits.e2e-spec.ts` (13 tests) and real PostgreSQL UoW rollback test `test/admin-point-credits.prisma.e2e-spec.ts`.
- Implemented Task 6: Frontend service functions `creditAdminUserPoints`, `listAdminUserPointCredits`, `reverseAdminPointCredit`, validation view helpers in `users-view.ts`, action error mapping in `users-messages.ts`, wallet history kind `ADMIN_CREDIT` ("Điểm cộng từ Admin"), and audit log labels `ADMIN_POINTS_CREDITED` / `LEDGER_JOURNAL_REVERSED`.
- Implemented Task 7: MSW data store & handlers for `POST/GET /admin/users/:id/point-credits` and `POST /economy/journals/:id/reverse`. Full contract test flow in `admin-contract.test.mjs`, verified `route-diff.test.mjs` and `contract-callsites.test.mjs`.
- Implemented Task 8: `usePointCredits` hook, `PointCreditDialog`, `ReverseCreditDialog`, and `PointCreditSection` mounted in `UserDetailPanel`. Properly hidden for self and disabled for locked users.
- Implemented Task 9: Updated `docs/ledger-operations-runbook.md` with manual point credits and reversal guidance, including fungibility risk. Verified all test suites in schemas, backend, and frontend.

### File List

- `packages/schemas/src/users/admin-users.schema.ts`
- `packages/schemas/src/users/admin-users.schema.spec.ts`
- `packages/schemas/src/notifications/notification.schema.ts`
- `packages/schemas/src/notifications/notification.schema.spec.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20261024100000_admin_point_credit/migration.sql`
- `apps/backend/src/modules/notifications/infrastructure/notification-type.parity.spec.ts`
- `apps/backend/src/modules/economy/application/ports/ledger-repository.port.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-ledger.repository.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-ledger.repository.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts`
- `apps/backend/src/modules/economy/application/ledger.service.spec.ts`
- `apps/backend/src/modules/economy/application/spend-journals.completeness.spec.ts`
- `apps/backend/src/modules/auth/infrastructure/prisma-identity-audit.repository.ts`
- `apps/backend/src/modules/auth/application/ports/identity-audit.port.ts`
- `apps/backend/src/modules/economy/application/exceptions/economy.exceptions.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/common/http/http-exception.filter.spec.ts`
- `apps/backend/src/modules/economy/application/ports/admin-point-credit-outbox.port.ts`
- `apps/backend/src/modules/economy/infrastructure/in-memory-admin-point-credit-outbox.ts`
- `apps/backend/src/modules/economy/infrastructure/prisma-admin-point-credit-outbox.ts`
- `apps/backend/src/modules/economy/application/admin-points-credited-notification.handler.ts`
- `apps/backend/src/modules/economy/application/admin-points-credited-notification.handler.spec.ts`
- `apps/backend/src/modules/economy/application/admin-point-credit.service.ts`
- `apps/backend/src/modules/economy/application/admin-point-credit.service.spec.ts`
- `apps/backend/src/modules/economy/presentation/admin-point-credits.controller.ts`
- `apps/backend/src/modules/economy/presentation/admin-point-credits.controller.spec.ts`
- `apps/backend/src/modules/economy/presentation/ledger.controller.ts`
- `apps/backend/src/modules/economy/presentation/ledger.controller.spec.ts`
- `apps/backend/src/modules/economy/economy.module.ts`
- `apps/backend/src/modules/economy/infrastructure/economy-scheduler.registrar.ts`
- `apps/backend/test/admin-point-credits.e2e-spec.ts`
- `apps/backend/test/admin-point-credits.prisma.e2e-spec.ts`
- `apps/backend/test/fixtures/financial-pg-harness.ts`
- `apps/frontend/my-app/lib/notifications/notification-presentation.ts`
- `apps/frontend/my-app/lib/admin/users-service.ts`
- `apps/frontend/my-app/lib/admin/users-view.ts`
- `apps/frontend/my-app/lib/admin/users-messages.ts`
- `apps/frontend/my-app/lib/wallet/wallet-history.ts`
- `apps/frontend/my-app/lib/admin/admin-transactions.ts`
- `apps/frontend/my-app/lib/admin/audit-log-view.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/audit-log/components/AuditLogScreen.tsx`
- `apps/frontend/my-app/mocks/data/admin-users.ts`
- `apps/frontend/my-app/mocks/handlers/admin-users.ts`
- `apps/frontend/my-app/mocks/handlers/admin-transactions.ts`
- `apps/frontend/my-app/tests/admin-contract.test.mjs`
- `apps/frontend/my-app/tests/admin-users.test.mjs`
- `apps/frontend/my-app/tests/wallet-history.test.mjs`
- `apps/frontend/my-app/tests/admin-audit-log-view.test.mjs`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/users/hooks/use-point-credits.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/users/components/PointCreditDialog.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/users/components/ReverseCreditDialog.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/users/components/PointCreditSection.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/users/components/UserDetailPanel.tsx`
- `docs/ledger-operations-runbook.md`
- `_bmad-output/implementation-artifacts/14-5-admin-direct-point-credit.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
