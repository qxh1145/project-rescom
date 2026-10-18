---
baseline_commit: 7a3c1c7
---

# Story 14.3: Admin Audit Log Viewer

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want to read the Audit Log in the console,
so that I can trace who changed what without database access.

## Acceptance Criteria

1. **Given** `GET /admin/audit-logs` and `GET /admin/audit-logs/:id` (Story 1.5), **when** the Admin opens `/admin/audit-log` (new nav item "Nhật ký thao tác", icon `history`, placed directly after "FraudLog"), **then** a paginated table lists time, action, actor, target user, and outcome, newest first (FR-ADD-13).
2. Filters map 1:1 to `listAuditLogsQuerySchema`: action (select of known actions + "Tất cả hành động"), actor (`userId`), target user (`targetUserId`), outcome (`SUCCESS` / `FAILURE` / all), and a date range ("Từ ngày" / "Đến ngày", Vietnam calendar days → `startDate = <d>T00:00:00+07:00`, `endDate = <d>T23:59:59.999+07:00`). An actor/target value that is not a full UUID, or a "Từ ngày" after "Đến ngày", shows an inline error and is not sent. Changing any filter returns to page 1.
3. Pagination uses the backend `page` / `limit` / `totalPages` ("Trang x/y", "Trước" / "Sau", same pattern as `UsersTable`); the total count is shown above the table. Page size 50.
4. The read DTO gains additive `actor` and `targetUser` fields, each `{ id, displayName } | null` (null when the corresponding id is null), resolved in one batch per request through the existing `UserProfileRepositoryPort.findDisplayLabels`; `userId` and `targetUserId` stay in the DTO unchanged. `displayName` is the trimmed label or `null`. The shared `auditLogItemSchema` (strict) gains both fields as `.nullable().optional()`.
5. The table shows the actor and target as display name + short code (`shortCodeOf`), falling back to the short code alone; "Hệ thống" when the id is null. Action shows a Vietnamese label with the raw code underneath; an unknown action shows the raw code only. Outcome shows a `Tag` ("Thành công" / "Thất bại").
6. A row (keyboard and mouse) opens a detail drawer (`Dialog` drawer pattern of `CodeIssueDrawer`) that loads `GET /admin/audit-logs/:id` and shows: time (full date + time), action label + code, outcome, actor and target (name, short code, full id, link `/admin/users?id=<id>`), `errorCode` (or "Không có"), and `metadata` as formatted JSON (`JSON.stringify(value, null, 2)` in a `<pre>`; "Không có" when null). A 404 shows "Không tìm thấy bản ghi" with "Đóng".
7. **Metadata masking.** Before release the audit writers were checked (table in Dev Notes): none of them stores passwords, tokens, OTPs, or full bank account numbers today. As defence in depth the read DTO masks, recursively in objects and arrays, the value of any key whose name matches the deny list in Dev Notes (`"[ĐÃ ẨN]"`), and keeps the last 4 digits of bank-account keys (`"••••1234"`). Masking is applied in the presentation mapping (list and detail), never on write; the stored row is unchanged. A unit test covers each deny-list key, nesting, arrays, a non-matching opaque id key (`tokenId`, `sessionId` stay visible), and `null` / array metadata.
8. Non-Admins get 403 (existing `RolesGuard`, message "Tài khoản này không có quyền quản trị."); empty ("Không có bản ghi nào khớp bộ lọc."), loading (5 skeleton rows), and error (`Alert` + "Thử lại") states follow the FraudLog screen. The screen shows the "Chỉ đọc · không sửa, không xoá" chip like FraudLog.
9. An MSW handler pair serves both routes from a seeded mock store using the shared schemas (401 no session, 403 non-Admin `FORBIDDEN_RESOURCE`, 400 `VALIDATION_ERROR` on a bad query, 404 `AUDIT_LOG_NOT_FOUND`, newest first, every filter applied). `tests/admin-contract.test.mjs` covers it. `tests/route-diff.test.mjs` passes with `ROUTE_ALLOWLIST` counts unchanged (`MOCK_ONLY: 3, DEFERRED_KEEP_MOCK: 14`).
10. Backend unit + e2e tests cover the new DTO fields (labels resolved, null ids, profile without name) and masking; existing audit-log tests stay green. No migration, no new route, no write-path change.

## Tasks / Subtasks

- [x] Task 1: Shared schema (AC: 4)
  - [x] 1.1 In `packages/schemas/src/admin/audit-logs.schema.ts` add `auditLogUserRefSchema = z.object({ id: z.string().uuid(), displayName: z.string().nullable() }).strict()` and add `actor: auditLogUserRefSchema.nullable().optional()`, `targetUser: auditLogUserRefSchema.nullable().optional()` to `auditLogItemSchema`.
  - [x] 1.2 Export the data-level schemas the FE `apiRequest` needs (it parses `payload.data`): `auditLogPageSchema` (the current `data` object: `{ items, pagination }`) and `auditLogDetailSchema` (`{ auditLog }`). Rebuild `paginatedAuditLogsResponseSchema` / `auditLogDetailResponseSchema` from them so there is one definition. Export types `AuditLogPage`, `AuditLogUserRef`. Export constants `AUDIT_LOG_PAGE_SIZE = 50`. `packages/schemas/src/index.ts` already re-exports the file — check it picks up the new names.
- [x] Task 2: Backend read DTO (AC: 4, 7, 10)
  - [x] 2.1 New pure `apps/backend/src/modules/admin/application/audit-metadata-mask.ts` exporting `maskAuditMetadata(metadata)` (deny list + bank rule from Dev Notes; recursive; returns a new value, never mutates the frozen entity metadata) + `audit-metadata-mask.spec.ts`.
  - [x] 2.2 `AuditLogService` gains a second constructor dependency `profiles: Pick<UserProfileRepositoryPort, 'findDisplayLabels'>` (same `Pick` style as `AdminMissingCodeReportsService`). Add a method `displayLabels(logs: AuditLog[]): Promise<Map<string, string | null>>` that collects distinct non-null `userId` / `targetUserId` and calls `findDisplayLabels` once (skip the call when there are none).
  - [x] 2.3 `admin.module.ts`: wire the factory `(auditLogRepository, profiles) => new AuditLogService(auditLogRepository, profiles)` with `inject: [AUDIT_LOG_REPOSITORY_PORT, USER_PROFILE_REPOSITORY_PORT]` (the token is already imported and used for `AdminMissingCodeReportsService`).
  - [x] 2.4 `admin-audit-logs.controller.ts`: `toAuditLogResponse(log, labels)` adds `actor` / `targetUser` (`{ id, displayName: labels.get(id)?.trim() || null }` or `null`) and returns `metadata: maskAuditMetadata(log.metadata)`. List and detail both call `displayLabels`.
  - [x] 2.5 Tests: update `audit-log.service.spec.ts` (labels batched once, empty → no call), `admin-audit-logs.controller.spec.ts` (fields present, schema parse still passes, masked metadata), and `apps/backend/test/admin-audit-logs.e2e-spec.ts` (override `USER_PROFILE_REPOSITORY_PORT` with `InMemoryUserProfileRepository`, or the AppModule falls back to Prisma on the stubbed `mockPrisma`; assert `actor.displayName` on a list item and on `GET /admin/audit-logs/:id`).
- [x] Task 3: FE service + view helpers (AC: 2, 3, 5, 6, 8)
  - [x] 3.1 New `apps/frontend/my-app/lib/admin/audit-log-service.ts`: `listAuditLogs(query, signal?)` → `apiRequest(\`/admin/audit-logs?${auditLogSearch(query)}\`, { schema: auditLogPageSchema, signal })`; `getAuditLog(id, signal?)` → `/admin/audit-logs/${encodeURIComponent(id)}` with `auditLogDetailSchema`, returning `.auditLog`. Header comment: "VERIFIED" contract note like `fraud-log-service.ts`.
  - [x] 3.2 New `apps/frontend/my-app/lib/admin/audit-log-view.ts` (pure, no React): `AUDIT_ACTION_LABELS` (table in Dev Notes), `AUDIT_ACTION_OPTIONS`, `AUDIT_OUTCOME_OPTIONS`, `auditActionLabel(code)`, `auditUserLabel(ref, id)` ("Tên · #ABCD" / "#ABCD" / "Hệ thống"), `auditLogSearch(query)` (omits empty values; always sets `page` and `limit`), `parseAuditFilters(raw)` → `{ query } | { errors: { userId?, targetUserId?, dateRange? } }` (UUID via `z.string().uuid()`; date → `+07:00` bounds per AC 2), `auditMetadataText(metadata)`, `auditLogLoadErrorMessage(error)` (FraudLog mapping with "Nhật ký thao tác" wording).
  - [x] 3.3 Tests `apps/frontend/my-app/tests/admin-audit-log-view.test.mjs`: search string (empty filters omitted, page/limit present), UUID errors, date bounds and from > to, labels incl. unknown action and null actor, metadata text for object / array / null, error messages (network, 403, 404, other).
- [x] Task 4: Mock store + MSW handlers + contract test (AC: 9)
  - [x] 4.1 New `apps/frontend/my-app/mocks/data/admin-audit-logs.ts`: ~30 seeded rows newest first across `LOGIN_SUCCESS`, `LOGIN_FAILURE` (`errorCode`), `USER_ROLE_CHANGED`, `USER_STATUS_CHANGED`, `SURVEY_PINNED`, `OUTBOX_EVENT_REDRIVEN`, `PASSWORD_RESET_COMPLETED`, using ids from `mocks/data/admin-users.ts` (some rows with a null actor). Metadata shapes copy the real writers (Dev Notes table) — no secrets in seed data.
  - [x] 4.2 New `apps/frontend/my-app/mocks/handlers/admin-audit-logs.ts`: `http.get(apiUrl("/admin/audit-logs"), …)` and `http.get(apiUrl("/admin/audit-logs/:id"), …)` (each `http.get(apiUrl("…")` on one line; route-diff parses it). `applyScenario("admin")`, `requireMockAdmin()`, query via `listAuditLogsQuerySchema.safeParse` → 400 `VALIDATION_ERROR` with `details`; filter + `createdAt desc` + page slice; `actor` / `targetUser` from `listMockAdminUsers()`; non-UUID or unknown id → 404 `AUDIT_LOG_NOT_FOUND`. Register in `mocks/handlers/index.ts` next to `adminFraudLogHandlers`.
  - [x] 4.3 Extend `apps/frontend/my-app/tests/admin-contract.test.mjs`: import the handlers into `handlers`, add `/admin/audit-logs` to `ROUTES` (401/403 loop), and a test "Audit log: shared query and page, filters, detail, 404" (page parses with `auditLogPageSchema`, newest first, each filter narrows, detail parses with `auditLogDetailSchema`, unknown uuid 404, `?page=0` 400).
  - [x] 4.4 Run `node --test tests/route-diff.test.mjs`: must pass unchanged (backend already serves both routes).
- [x] Task 5: Screen (AC: 1–3, 5, 6, 8)
  - [x] 5.1 `components/layout/admin/admin-nav.ts`: add `{ href: "/admin/audit-log", label: "Nhật ký thao tác", icon: "history" }` after FraudLog.
  - [x] 5.2 New `app/(signed-in)/(admin)/admin/audit-log/page.tsx` (`metadata.title = "Nhật ký thao tác | Rescom Admin"`, renders `<AuditLogScreen />`).
  - [x] 5.3 New `.../audit-log/hooks/use-audit-log.ts`: filter state (raw inputs), `parseAuditFilters`, page state reset on filter change, debounced text inputs (`useDebouncedValue`, 300 ms), `useApiQuery(key, signal => listAuditLogs(query, signal))` only when filters are valid, `useSessionLossRedirect`. Mirror `use-fraud-log.ts`.
  - [x] 5.4 New `.../audit-log/components/AuditLogScreen.tsx` (FraudLog layout: `AdminPage` + read-only chip, filter row, error `Alert` + "Thử lại", table card, pager), `AuditLogTable.tsx` (FraudLog table classes; columns Thời gian / Hành động / Người thực hiện / Người bị tác động / Kết quả; row is a `<button>` or has `onClick` + `onKeyDown` Enter/Space + `tabIndex=0`), `AuditLogDrawer.tsx` (detail per AC 6; `useApiQuery(\`admin:audit-log:${id}\`, …)`).
- [x] Task 6: Verification (AC: all)
  - [x] 6.1 `cd packages/schemas && npm run build` (FE `pretest` also builds it).
  - [x] 6.2 `cd apps/backend && npx jest src/modules/admin` and `npx jest --config test/jest-e2e.json test/admin-audit-logs.e2e-spec.ts` (use the repo's e2e jest config; check `package.json` scripts), then full `npx jest`; eslint + prettier on changed files.
  - [x] 6.3 `cd apps/frontend/my-app && npm test` (full suite incl. route-diff, contract-callsites, no-direct-mocks, pilot-scope), `npm run typecheck`, `npm run lint`.
  - [x] 6.4 Manual (MSW default mode, mock admin): open `/admin/audit-log`, try each filter, page forward/back, open a row, check JSON and a 404 (edit the URL id in devtools not needed — the contract test covers it).

### Review Findings

- [x] [Review][Patch] Metadata deny-list exact-match only (Decision resolved by Quan 2026-10-18: add suffix rule) — also mask normalized keys ending in `password`, `secret`, `tokenhash`, and bank keys ending in `accountno` / `accountnumber`; keep opaque ids (`tokenId`, `sessionId`, …) visible; extend spec test [apps/backend/src/modules/admin/application/audit-metadata-mask.ts:50]
- [x] [Review][Patch] Drawer error state has no "Thử lại" (Dev Notes, 14.1 intelligence: "show error + retry, keep list row data"); call `detail.reload` [apps/frontend/my-app/app/(signed-in)/(admin)/admin/audit-log/components/AuditLogDrawer.tsx:72]
- [x] [Review][Patch] Contract test does not exercise `userId` / `targetUserId` filters and does not assert that filters narrow the unfiltered list (AC 9, Task 4.3) [apps/frontend/my-app/tests/admin-contract.test.mjs:268]
- [x] [Review][Patch] Backend tests miss `actor: null` / `targetUser: null` for null ids and a label-map miss (`displayName: null`) on the DTO (AC 10) [apps/backend/src/modules/admin/presentation/admin-audit-logs.controller.spec.ts:54]
- [x] [Review][Patch] Weak assertions: `actor !== undefined` also passes for `null`; e2e `userRoleLog` from `.find()` has no existence check (fails with TypeError) [apps/frontend/my-app/tests/admin-contract.test.mjs:277, apps/backend/test/admin-audit-logs.e2e-spec.ts:235]
- [x] [Review][Patch] Date filter has no `YYYY-MM-DD` shape check: a 5+-digit year from `<input type=date>` builds a query the backend `datetime({offset:true})` rejects (generic error + useless retry), and `start > end` string compare breaks on unequal year lengths [apps/frontend/my-app/lib/admin/audit-log-view.ts:117]
- [x] [Review][Patch] Filter errors not linked to inputs: add `aria-invalid` + `aria-describedby` on the UUID and date inputs (pattern: `FlashSaleFormScreen.tsx:75`) [apps/frontend/my-app/app/(signed-in)/(admin)/admin/audit-log/components/AuditLogScreen.tsx:53]
- [x] [Review][Defer] Load error / invalid filter also renders "Không có bản ghi nào khớp bộ lọc." under the Alert [apps/frontend/my-app/app/(signed-in)/(admin)/admin/audit-log/components/AuditLogTable.tsx:68] — deferred, same pattern as FraudLog screen
- [x] [Review][Defer] `<tr role="button">` overrides row semantics for screen readers [apps/frontend/my-app/app/(signed-in)/(admin)/admin/audit-log/components/AuditLogTable.tsx:87] — deferred, spec-allowed row pattern
- [x] [Review][Defer] `findDisplayLabels` failure turns list/detail into 500 although labels are cosmetic [apps/backend/src/modules/admin/presentation/admin-audit-logs.controller.ts:91] — deferred, same DB failing; degrade-to-null if seen
- [x] [Review][Defer] Detail drawer has no session-loss redirect on 401 [apps/frontend/my-app/app/(signed-in)/(admin)/admin/audit-log/components/AuditLogDrawer.tsx:27] — deferred, consistent with other admin drawers (CodeIssueDrawer)
- [x] [Review][Defer] `findMany` orders by `createdAt` only, no `id` tie-break; equal timestamps can repeat/skip across pages [apps/backend/src/modules/admin/infrastructure/prisma-audit-log.repository.ts:84] — deferred, pre-existing

## Dev Notes

### Scope boundary (read first)

- Backend change is **read-side only**: shared schema fields, controller mapping, `AuditLogService` dependency, masking helper, tests. No migration, no new route, no change to any audit writer, no change to `identity_audit_logs` rows.
- No Figma frame (sprint-change-proposal-2026-10-18 decision D3). Build from `AdminPage`, `Select`, `TextField`/`fieldClassName`, `Tag`, `Alert`, `Button`, `Dialog`, `IconButton`. No new dependency.
- No search by `#code` / name / email for actor and target: the backend query takes exact UUIDs only, and adding search is out of scope. Admins get the UUID from `/admin/users` or from the drawer.
- No deep link (`?userId=`) and no link from `UserDetailPanel` — add when asked.

### Decision D1 — which audit trail the viewer shows (Owner chose Option A, 2026-10-18)

`GET /admin/audit-logs` reads **only** the `identity_audit_logs` table. Most Admin money / moderation actions are **not** in that table. They are Outbox events (`outbox_events`) with no consumer, so they stay `PENDING` forever and are never copied into `identity_audit_logs`:

| Outbox `eventType` | Producer |
|---|---|
| `AdminTopUpApproved`, `AdminTopUpRejected` | `economy/application/top-up.service.ts:382` |
| `AdminTopUpRechecked`, `AdminTopUpMismatchResolved`, `AdminTopUpExported` | `economy/application/payos-top-up.service.ts:262,332,817` |
| `AdminTopUpRefundResolved`, `AdminTopUpRefundBankTransferRecorded` | `economy/application/admin-top-up-refund.service.ts:309,432` |
| `AdminSurveyApproved`, `AdminSurveyRejected` | `moderation/application/survey-moderation.service.ts:426` |
| `AdminMissingCodeReportResolved` | `participation/application/participation.service.ts:2032` (Story 14.1) |
| Voucher actions (`eventType = action`), `REWARDS_SETTINGS_UPDATED` | `rewards/application/rewards-admin-catalog.service.ts:195,594` (producer `rewards-admin-catalog`) |

**Default in this story (Option A):** the viewer shows `identity_audit_logs` as the epic AC states. A one-line info note under the filters says: "Nhật ký này gồm đăng nhập, phân quyền, khoá tài khoản, ghim khảo sát và chạy lại Outbox. Thao tác nạp/hoàn điểm, duyệt khảo sát và voucher chưa hiển thị ở đây." The gap is recorded for a follow-up story.

**Option B (if the Owner chooses it, scope becomes Medium):** one Outbox projection handler per event type above that inserts an `identity_audit_logs` row (action = a stable `SCREAMING_SNAKE` name, `userId` = the payload admin id — `adminId` / `updatedById` / `resolvedBy` depending on the payload — `metadata` = payload minus PII). Because those events are still `PENDING`, registering the handlers back-fills history automatically. Not in this story unless D1 changes.

### Backend contract (existing, verified in code)

| | |
|---|---|
| Controller | `apps/backend/src/modules/admin/presentation/admin-audit-logs.controller.ts` — `@Controller(['admin/audit-logs','api/admin/audit-logs'])`, `SessionAuthGuard`, `RolesGuard`, `@Roles('ADMIN')` → 401 / 403 `FORBIDDEN_RESOURCE` |
| `GET /admin/audit-logs` | query `listAuditLogsQuerySchema` (strict; `page` 1..100000 default 1, `limit` 1..100 default 20, `action` exact match after trim, `userId`, `targetUserId` UUID, `outcome`, `startDate`/`endDate` ISO with offset, start ≤ end) → 400 `VALIDATION_ERROR`; returns `data: { items, pagination: { page, limit, total, totalPages } }`, `createdAt desc` |
| `GET /admin/audit-logs/:id` | `ParseUUIDPipe` → 400 on bad id; `AuditLogNotFoundException` code `AUDIT_LOG_NOT_FOUND` → 404 (mapped by `http-exception.filter.ts`; verify the status there); returns `data: { auditLog }` |
| Service | `admin/application/audit-log.service.ts` — thin pass-through to `AuditLogRepositoryPort` |
| Repository | `admin/infrastructure/prisma-audit-log.repository.ts` — `identityAuditLog.findMany` + `count` in one `$transaction`; indexes on `userId`, `action`, `createdAt`, `(targetUserId, createdAt)` |
| Label port | `users/application/ports/user-profile.repository.port.ts#findDisplayLabels(userIds)` → `Map<id, string \| null>`, one entry per requested id; Prisma impl one `userProfile.findMany` |
| Pattern to copy | `admin/application/admin-missing-code-reports.service.ts:41-61` (distinct ids → one `findDisplayLabels` → `displayName: names.get(id)?.trim() \|\| null`) |

`AuditLog` entity freezes a shallow copy of `metadata`; the mask must build new objects, not mutate.

### Actions written to `identity_audit_logs` (non-test code)

| Action | Writer | Vietnamese label |
|---|---|---|
| `LOGIN_SUCCESS` | auth session | Đăng nhập |
| `LOGIN_FAILURE` | auth | Đăng nhập thất bại |
| `LOGOUT` | auth session | Đăng xuất |
| `SESSION_REPLACED` | auth session | Phiên bị thay thế |
| `REFRESH_ROTATED` | auth session | Làm mới phiên |
| `REFRESH_REUSE_SUSPECTED` | auth session | Nghi dùng lại phiên cũ |
| `REFRESH_REUSE_REVOKED` | auth session | Thu hồi phiên do dùng lại |
| `OAUTH_INTENT_REJECTED` | auth Google OAuth | Từ chối đăng nhập Google |
| `OAUTH_INTENT_REPLAYED` | auth Google OAuth | Lặp lại đăng nhập Google |
| `IDENTITY_LINKED` | auth Google OAuth | Liên kết Google |
| `IDENTITY_UNLINKED` | auth Google OAuth | Huỷ liên kết Google |
| `PASSWORD_RESET_REQUESTED` | password reset | Yêu cầu đặt lại mật khẩu |
| `PASSWORD_RESET_COMPLETED` | password reset | Đặt lại mật khẩu |
| `USER_STATUS_CHANGED` | users admin (`user-admin.service.ts`) | Đổi trạng thái tài khoản |
| `USER_ROLE_CHANGED` | users admin | Đổi vai trò |
| `OUTBOX_EVENT_REDRIVEN` | `prisma-outbox-claim.repository.ts:292` | Chạy lại sự kiện Outbox |
| `SURVEY_PINNED` / `SURVEY_UNPINNED` | `admin-published-surveys.service.ts:64` | Ghim / Bỏ ghim khảo sát |

Source of truth for auth actions: `auth/application/ports/identity-audit.port.ts` `IdentityAuditAction`. The FE list is a display map only; an unknown action still renders (raw code) and is still filterable by typing nothing (select "Tất cả").

### Metadata check (AC 7)

Checked 2026-10-18 on every non-test writer. **Result: no password or hash, access/refresh/reset token or hash, OTP, OAuth code/state/id_token, cookie value, email, or bank account number is written today.**

| Action | Metadata keys | errorCode |
|---|---|---|
| `SESSION_REPLACED` | `sessionId`, `sessionVersion` | — |
| `REFRESH_ROTATED`, `LOGOUT` | none | — |
| `REFRESH_REUSE_REVOKED` | none | `AUTH_SESSION_REVOKED` |
| `REFRESH_REUSE_SUSPECTED` | `sessionId`, `credentialId` (public half of the refresh cookie; the secret is never logged) | `AUTH_INVALID_CSRF_TOKEN` |
| `PASSWORD_RESET_REQUESTED` / `_COMPLETED` | `tokenId` (= `password_reset_tokens.id` row id, not the token), `revokedSessions` | — |
| `IDENTITY_LINKED` / `IDENTITY_UNLINKED`, `LOGIN_SUCCESS` | `provider` (failures: none) | on failure |
| `OAUTH_INTENT_REJECTED` / `_REPLAYED` | `reason` (enum like `MISSING_COOKIE`) or `intentId`, `isReplay` | `AUTH_INVALID_OAUTH_INTENT` |
| `LOGIN_FAILURE` | `flowType` or none | yes |
| `USER_STATUS_CHANGED` | `ipAddress`, `userAgent`, `reason?` (Admin free text 10–500), `previousStatus`, `newStatus`, `changed`, `noOp?`, `changeId` | on failure |
| `USER_ROLE_CHANGED` | `ipAddress`, `userAgent`, `previousRole`, `newRole`, `changed`, `noOp?` | on failure |
| `OUTBOX_EVENT_REDRIVEN` | `eventId` | — |
| `SURVEY_PINNED` / `_UNPINNED` | `formId` | — |
| seed script (`scripts/seed.ts:395`) | `source: 'go-live-seed'` | — |

`ipAddress` / `userAgent` on the two admin actions are the **acting Admin's** request data (`admin-users.controller.ts:110-113, 140-143`), and `reason` is the Admin's own lock reason; they stay visible to Admins (not in the deny list). The generic `append` paths take `metadata as any`, so a future writer could add any key — that is why the mask exists.

**Deny list (case-insensitive exact key match, after removing `_` and `-`):** `password`, `passwordhash`, `newpassword`, `token`, `accesstoken`, `refreshtoken`, `idtoken`, `resettoken`, `tokenhash`, `secret`, `otp`, `code` is **not** in the list (it is used for non-secret codes), `cookie`, `authorization`. Bank rule: keys `accountnumber`, `bankaccount`, `bankaccountnumber` → keep last 4 digits (`"••••" + digits.slice(-4)`, or `"[ĐÃ ẨN]"` when fewer than 4 digits). Opaque ids (`tokenId`, `sessionId`, `intentId`, `changeId`, `eventId`, `formId`) are **not** masked.

### Current state of files touched

- `packages/schemas/src/admin/audit-logs.schema.ts`: `listAuditLogsQuerySchema` (strict + refine), `auditLogItemSchema` (strict), envelope schemas `auditLogDetailResponseSchema`, `paginatedAuditLogsResponseSchema` (used by the controller spec). Keep both envelope exports.
- `admin-audit-logs.controller.ts`: list + detail, `toAuditLogResponse(log)`; preserve both route prefixes, guards, the `ZodValidationPipe(..., 'VALIDATION_ERROR', 'query')`, and `totalPages = total === 0 ? 0 : ceil`.
- `audit-log.service.ts`: constructor `(auditLogRepository)`; `listAuditLogs`, `getAuditLogById` (throws `AuditLogNotFoundException`). `AuditLogService` is exported from `AdminModule` — grep for other `new AuditLogService(` call sites (specs) and update them.
- `admin.module.ts:208-217`: `PrismaAuditLogRepository` + `AuditLogService` factory.
- `test/admin-audit-logs.e2e-spec.ts`: builds `AppModule` with `mockPrisma` and in-memory repos; `USER_PROFILE_REPOSITORY_PORT` is **not** overridden today.
- `components/layout/admin/admin-nav.ts`: `ADMIN_NAV` list; `tests/pilot-scope.test.mjs` asserts no hidden route in nav (the new route is not hidden — fine).
- `mocks/handlers/index.ts`: registers `adminFraudLogHandlers` — add the new handlers next to it. Hybrid mode serves only `DEFERRED_KEEP_MOCK` routes, so the new handlers never answer in hybrid.
- FraudLog files to mirror: `fraud-log/page.tsx`, `components/FraudLogScreen.tsx`, `components/FraudLogTable.tsx`, `hooks/use-fraud-log.ts`, `lib/admin/fraud-log-service.ts`, `lib/admin/fraud-log-messages.ts`. Drawer: `code-issues/components/CodeIssueDrawer.tsx` (`Dialog` with `width={560}` and the right-edge class list). Pager: `users/components/UsersTable.tsx:125-137`.

### Guardrails

- `apiRequest` only (unwraps `data`, parses with the schema); never import `mocks/` from app code (`no-direct-mocks.test.mjs`).
- Validate with shared schemas; do not re-declare limits (`limit` max 100, `page` max 100000) in the FE.
- `contract-callsites.test.mjs` requires a backend e2e that calls every FE-called path: `admin-audit-logs.e2e-spec.ts` already calls `/admin/audit-logs` and `/admin/audit-logs/:id`; keep at least one call to each.
- Read only: no edit/delete/export buttons.
- A11y: table `<caption className="sr-only">`, row activation by keyboard, drawer `labelledBy`, filter inputs labelled; `<pre>` with `tabIndex={0}` and `overflow-auto` for long JSON.
- All copy Vietnamese; times in Vietnam time via `lib/format/date-time.ts` helpers (`formatShortDateTime`, `vietnamDateKey`) or `formatDayMonthTime` from `lib/admin/users-view.ts`.
- Repo is public: no real emails, ids, or payment data in mock seeds.

### Previous story intelligence (14.1, 14.2)

- 14.2: the `contract-callsites` gate failed until a backend e2e called the FE route — here it already exists; just keep it.
- 14.2: route-diff stayed unchanged because the backend serves the route; same here.
- 14.1 review patched double-submit and busy-dialog dismissal; not relevant (read only), but the drawer must not break when the detail request fails (show error + retry, keep list row data).
- Memory note from 14.1: `admin-audit:*` Outbox rows are not in `identity_audit_logs` — confirmed in code, see D1.

### Git intelligence

- Branch `feat/14-3-admin-audit-log-viewer` from `origin/develop` `7a3c1c7` (PR #58 / 14.2 merged).
- Recent FE admin work (14.2 `9329592`) used service / view / MSW / `node --test` layout; follow it.

### Latest tech information

- No new libraries. Next 16.3, React 19.2, zod 3.25, msw 2.15 (`apps/frontend/my-app/package.json`); NestJS + Prisma backend unchanged. `<input type="date">` gives `YYYY-MM-DD`; build the offset string by hand, do not use `Date#toISOString()` (UTC shift).

### Project Structure Notes

- New BE: `apps/backend/src/modules/admin/application/audit-metadata-mask.ts` (+ spec).
- New FE: `app/(signed-in)/(admin)/admin/audit-log/{page.tsx,components/AuditLogScreen.tsx,components/AuditLogTable.tsx,components/AuditLogDrawer.tsx,hooks/use-audit-log.ts}`, `lib/admin/audit-log-service.ts`, `lib/admin/audit-log-view.ts`, `mocks/data/admin-audit-logs.ts`, `mocks/handlers/admin-audit-logs.ts`, `tests/admin-audit-log-view.test.mjs`.
- Modified: `packages/schemas/src/admin/audit-logs.schema.ts`, `admin-audit-logs.controller.ts` (+ spec), `audit-log.service.ts` (+ spec), `admin.module.ts`, `test/admin-audit-logs.e2e-spec.ts`, `components/layout/admin/admin-nav.ts`, `mocks/handlers/index.ts`, `tests/admin-contract.test.mjs`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 14.3]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-18.md — gap 3, D3]
- [Source: apps/backend/src/modules/admin/presentation/admin-audit-logs.controller.ts]
- [Source: packages/schemas/src/admin/audit-logs.schema.ts]
- [Source: apps/backend/src/modules/admin/application/admin-missing-code-reports.service.ts]
- [Source: apps/backend/src/modules/auth/application/ports/identity-audit.port.ts]
- [Source: apps/backend/src/common/scheduler/outbox/outbox-handler.ts — `subscribedEventTypes`: unhandled types stay PENDING]
- [Source: apps/frontend/my-app/app/(signed-in)/(admin)/admin/fraud-log/]

## Dev Agent Record

### Agent Model Used

- Model: claude-3-7-sonnet / gemini-2.5-pro / Antigravity Agent

### Debug Log References

- None. All test suites, typechecks, and lints passed cleanly.

### Completion Notes List

- Shared schemas updated in `packages/schemas/src/admin/audit-logs.schema.ts` with `auditLogUserRefSchema`, `auditLogPageSchema`, `auditLogDetailSchema`, `AUDIT_LOG_PAGE_SIZE = 50`.
- Recursive sensitive metadata masking implemented in pure backend helper `maskAuditMetadata` with test coverage in `audit-metadata-mask.spec.ts`.
- Injected `UserProfileRepositoryPort` into `AuditLogService` to batch-resolve display labels across actor and targetUser without mutating stored logs.
- Controller response mapped with `actor`, `targetUser`, and masked metadata; e2e suite updated and passing 15/15 tests.
- FE service + view helper modules implemented with robust date range handling, UUID validation, and error messages (`audit-log-service.ts`, `audit-log-view.ts`, unit tests 6/6 passing).
- MSW handlers registered with single-line `http.get(apiUrl(...))` endpoints matching route-diff expectations; contract tests passing 6/6.
- Admin UI created at `/admin/audit-log` matching FraudLog look and feel with read-only badge, responsive table, filters with debounce, and detail drawer with formatted JSON.
- Verification passed: packages/schemas (708/708 tests), backend unit (2752/2752 tests) and e2e (15/15), frontend (1013/1013 tests), typecheck clean, lint clean.

### File List

- `packages/schemas/src/admin/audit-logs.schema.ts`
- `apps/backend/src/modules/admin/application/audit-metadata-mask.ts`
- `apps/backend/src/modules/admin/application/audit-metadata-mask.spec.ts`
- `apps/backend/src/modules/admin/application/audit-log.service.ts`
- `apps/backend/src/modules/admin/application/audit-log.service.spec.ts`
- `apps/backend/src/modules/admin/admin.module.ts`
- `apps/backend/src/modules/admin/presentation/admin-audit-logs.controller.ts`
- `apps/backend/src/modules/admin/presentation/admin-audit-logs.controller.spec.ts`
- `apps/backend/test/admin-audit-logs.e2e-spec.ts`
- `apps/frontend/my-app/components/layout/admin/admin-nav.ts`
- `apps/frontend/my-app/lib/admin/audit-log-service.ts`
- `apps/frontend/my-app/lib/admin/audit-log-view.ts`
- `apps/frontend/my-app/tests/admin-audit-log-view.test.mjs`
- `apps/frontend/my-app/mocks/data/admin-audit-logs.ts`
- `apps/frontend/my-app/mocks/handlers/admin-audit-logs.ts`
- `apps/frontend/my-app/mocks/handlers/index.ts`
- `apps/frontend/my-app/tests/admin-contract.test.mjs`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/audit-log/page.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/audit-log/hooks/use-audit-log.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/audit-log/components/AuditLogDrawer.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/audit-log/components/AuditLogTable.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/audit-log/components/AuditLogScreen.tsx`

## Change Log

- 2026-10-18: Story created (ready-for-dev).
- 2026-10-18: Implementation complete and verified across schemas, backend, and frontend suites. Ready for review.
- 2026-10-18: Code review (Blind/Edge/Auditor). 7 patches applied (drawer retry, filter a11y, date shape check, mask suffix rule per Quan, test gaps); 5 deferred to deferred-work.md. Status → done.
