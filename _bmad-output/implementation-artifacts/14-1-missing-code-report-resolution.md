---
baseline_commit: b0df9b2
---
# Story 14.1: Missing-Code Report Resolution

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want to resolve a Respondent's missing-code report,
so that a Respondent whose Publisher forgot the completion code is either paid or told why not.

## Acceptance Criteria

1. **Resolve route.** `POST /admin/missing-code-reports/:attemptId/resolve` (also under `/api/...`) exists. It is `ADMIN` only (`SessionAuthGuard`, `RolesGuard`, `@Roles('ADMIN')`), requires `CsrfGuard` and `JsonOnlyGuard`, uses `ParseUUIDPipe`, and takes a strict body `{ outcome: 'CREDIT_RESPONDENT' | 'DISMISSED', note }`. `note` is trimmed and required for **both** outcomes, 10–500 characters (Decision D5). The response is `{ attemptId, outcome, attemptStatus, rewardPoints: int|null, replayed: boolean }`. Respondent, Publisher, and amount always come from the server and never from the body (FR-23).
2. **Credit.** `CREDIT_RESPONDENT` runs in one Unit of Work keyed `external-completion:{attemptId}`. Lock order is form row `FOR NO KEY UPDATE`, then attempt row `FOR UPDATE`, then ledger accounts. Inside it:
   - the attempt becomes `COMPLETED` with `submittedAt = now`;
   - the reward settles through the existing External path, `settleExternalOrExisting` → `creditPendingReward`. That path debits the Publisher ESCROW, credits the Respondent PENDING, and uses journal key `external-completion:{attemptId}`. The amount is the form's current `rewardPerResponse` (D1);
   - the resolution columns are set;
   - `closeFormIfQuotaMet` runs;
   - the audit Outbox row and the notification Outbox row are written.

   The 48-hour release then runs on the existing scheduler. After commit, `starterPointsCoordinator.tryUnlockStarterPoints` runs for the Respondent, as in the normal completion flow (FR-24, FR-ADD-11).
3. **Credit refusals.** Each refusal changes nothing and returns:
   - guest attempt (`respondentId` null): 409 `REWARD_NOT_SETTLEABLE` (existing);
   - attempt already `COMPLETED`, or the Respondent already completed this logical form: 409 `SURVEY_ALREADY_COMPLETED` (existing);
   - form not `PUBLISHED`: 409 `MISSING_CODE_SURVEY_CLOSED` (new);
   - quota full: 409 `SURVEY_QUOTA_FULL` (existing). The check is `completedCount + activeReservationCount(excluding this attempt) >= expectedCompletions`, evaluated under the form lock;
   - escrow below the reward: 409 `SURVEY_REWARD_UNAVAILABLE` (existing mapping of `InsufficientEscrowBalanceException`);
   - form not EXTERNAL: 400 `ATTEMPT_NOT_EXTERNAL` (existing).

   `DISMISSED` has none of these checks. It works on a closed survey.
4. **Report state.** Additive migration `apps/backend/prisma/migrations/20261023100000_missing_code_resolution/migration.sql`. It adds a Prisma enum `MissingCodeResolution { CREDIT_RESPONDENT DISMISSED }` and four nullable columns on `survey_attempts`:
   - `missing_code_resolved_at timestamp(3)`;
   - `missing_code_resolution "MissingCodeResolution"`;
   - `missing_code_resolution_note varchar(500)`;
   - `missing_code_resolved_by uuid`, with an FK to `users(id)` `ON DELETE RESTRICT`, like `completion_code_limit_resets.reset_by_id`.

   It also adds a CHECK that the four columns are either all null or all set, and that they are set only when `missing_code_reported_at IS NOT NULL`. In `prisma-missing-code-report-stats.ts`, `listUnresolved` and `countUnresolved` both gain `AND a.missing_code_resolved_at IS NULL`, so a resolved report leaves the list, the tab count, the sidebar badge, and the overview card.
5. **Once only.** A report can be resolved only while it is *open*. Open means `missing_code_reported_at IS NOT NULL`, `missing_code_resolved_at IS NULL`, and `status <> 'COMPLETED'`. The write is a CAS on `missing_code_resolved_at IS NULL` under the attempt row lock.
   - No report on the attempt: 404 `MISSING_CODE_REPORT_NOT_FOUND`.
   - Same outcome again on an already-resolved report: 200 `{ replayed: true }`, with no second journal, notification, or audit (D4).
   - Different outcome on a resolved report: 409 `MISSING_CODE_REPORT_ALREADY_RESOLVED`.
   - Admin resolving their own attempt: 403 `MISSING_CODE_SELF_RESOLVE_FORBIDDEN`.
   - A Prisma concurrency test proves exactly one journal and one audit row in three races: two concurrent `CREDIT_RESPONDENT` calls; `CREDIT_RESPONDENT` against `DISMISSED`; `CREDIT_RESPONDENT` against the Respondent's own late correct code (`verifyExternalCompletionCode`).
6. **Audit and notifications in the same transaction.**
   - Audit Outbox row: `idempotencyKey admin-audit:missing-code:{attemptId}`, `eventType AdminMissingCodeReportResolved`, payload `{ schemaVersion: 1, action: 'MISSING_CODE_REPORT_RESOLVED', auditCategory: 'MODERATION_ADMIN_ACTION', adminId, attemptId, surveyId, outcome, rewardPoints|null, journalId|null, noteLength, correlationId|null, occurredAt }`. The note text is stored only in the row.
   - Notification Outbox row: `idempotencyKey missing-code-resolved:{attemptId}`, `eventType ParticipationMissingCodeReportResolved`, consumed by one new Outbox handler.
   - The handler notifies the Respondent for both outcomes: `CREDIT_RESPONDENT` uses type `REWARD_PENDING`; `DISMISSED` uses the new type `MISSING_CODE_REPORT_RESOLVED`. Both messages include the note, cut to `NOTIFICATION_MESSAGE_MAX_LENGTH`.
   - On `CREDIT_RESPONDENT` only, the handler also notifies the Publisher with type `MISSING_CODE_REPORT_RESOLVED`. That message asks them to check the completion code on the external form. It never contains the Admin note or the Respondent's identity (D6).
   - Notifications are in-app only, with no email (FR-57, D6).
7. **Report DTO for the console.** `missingCodeReportSchema` gains four required fields, so the FE can render the actions:
   - `formVersionId` (uuid), needed for the existing reset route;
   - `rewardPerResponse` (int ≥ 0);
   - `surveyOpen` (boolean, form `PUBLISHED`);
   - `failedCodeVerifications` (int ≥ 0).

   Reward and status come through the Forms-owned lookup port (AD-16). Participation SQL never reads `forms`.
8. **Console.** With mocking `disabled` or `hybrid`, each row of the "Báo thiếu mã" tab on `/admin/disputes` (Figma 11c `62:1609`) offers these actions, reusing the existing `disputes-view.ts` labels:
   - "Cộng {points} cho người trả lời". It is disabled with a reason when the survey is closed, the attempt is a guest attempt, or `attemptStatus === 'COMPLETED'`;
   - "Bác bỏ báo cáo";
   - "Mở lại giới hạn mã", only when `failedCodeVerifications > 0`. It calls the existing `POST /admin/completion-code-limits/reset` and does **not** call resolve.

   The row also has a reason textarea, validated 10–500. Each action opens `ConfirmDecisionDialog`. Busy state blocks double submit. On success the row disappears and the tab, sidebar, and overview counts reload.

   New error codes map to Vietnamese messages. On `MISSING_CODE_REPORT_ALREADY_RESOLVED`, `SURVEY_ALREADY_COMPLETED`, or 404, the list reloads.

   The credit confirm copy says the Points go to the Respondent's **Pending** balance for 48 hours (D1). Full-mock mode (`enabled`) keeps today's MSW `CaseDetail` flow.
9. **Scope guard.** These stay unchanged: the `ATTEMPT_DISPUTE` and `LOCKED_ATTEMPT` kinds, the `/admin/disputes` and `/admin/disputes/:id/resolve` MSW routes, `NoExternalDisputeHolds`, and `tests/route-diff.test.mjs` with its counts (`MOCK_ONLY 3`, `DEFERRED_KEEP_MOCK 14`). The new route has no MSW handler, because hybrid mode passes it through to the backend. No other route changes behavior.

## Tasks / Subtasks

- [x] **Task 0: Preconditions**
  - [x] `git status --short --branch` shows `feat/14-1-missing-code-report-resolution`, created 2026-10-18 from `docs/epic-14-admin-console-gaps` `b0df9b2`, which is `origin/develop` `9db64bf` plus the Epic 14 planning commits. Upstream is unset. Push with `git push -u origin feat/14-1-missing-code-report-resolution`. Open the PR to `develop` after the docs PR, or include the docs commits.
- [x] **Task 1: Shared contracts** (AC 1, 3, 5, 6, 7). These go in `packages/schemas/src/`; export them through the indexes and add specs.
  - [x] Create `participation/missing-code-resolution.schema.ts`:
    - `MISSING_CODE_RESOLUTION_OUTCOMES = ['CREDIT_RESPONDENT','DISMISSED']`;
    - `MISSING_CODE_RESOLUTION_NOTE_MIN = 10`, `MISSING_CODE_RESOLUTION_NOTE_MAX = 500`;
    - `resolveMissingCodeReportSchema`, `.strict()`, with a trimmed `note`;
    - `resolveMissingCodeReportResultSchema`;
    - `missingCodeAuditKey = (id) => \`admin-audit:missing-code:${id}\``, `missingCodeResolvedEventKey = (id) => \`missing-code-resolved:${id}\``;
    - `MISSING_CODE_AUDIT_EVENT_TYPE = 'AdminMissingCodeReportResolved'` and `missingCodeAuditEventPayloadSchema`;
    - `MISSING_CODE_RESOLVED_EVENT_TYPE = 'ParticipationMissingCodeReportResolved'` and `missingCodeResolvedEventPayloadSchema`, with fields `{ schemaVersion: 1, attemptId, surveyId, surveyTitle, respondentId, publisherId, outcome, rewardPoints|null, note, occurredAt }`.
  - [x] In `admin/missing-code-reports.schema.ts`, add the AC 7 fields to `missingCodeReportSchema`. It stays `.strict()`.
  - [x] In `notifications/notification.schema.ts`, **append** `MISSING_CODE_REPORT_RESOLVED` to `NOTIFICATION_TYPES`. Never reorder it. Do not add it to `EMAIL_NOTIFICATION_TYPES`.
- [x] **Task 2: DB** (AC 4)
  - [x] Prisma: add `enum MissingCodeResolution`; add `SurveyAttempt` fields `missingCodeResolvedAt`, `missingCodeResolution`, `missingCodeResolutionNote @db.VarChar(500)`, `missingCodeResolvedById @db.Uuid` plus a relation to `User` (named, e.g. `"SurveyAttemptMissingCodeResolver"`, `onDelete: Restrict`); add `MISSING_CODE_REPORT_RESOLVED` to `enum NotificationType`.
  - [x] Write one migration, `20261023100000_missing_code_resolution`, after the latest migration `20261022100000_top_up_refund_resolution`. It contains `CREATE TYPE "MissingCodeResolution"`, `ALTER TYPE "NotificationType" ADD VALUE 'MISSING_CODE_REPORT_RESOLVED'` (copy `20261022090000_notification_type_topup_refund_rejected`), the four `ADD COLUMN`s, the FK, and the CHECK `survey_attempts_missing_code_resolution_consistent`.
  - [x] `prisma/sql/post-push-invariants.sql`: mirror the columns only if `test/migration-chain.spec.ts` requires it. Read that test first; it compares the invariants block against `20260927040000_reconcile_db_push_tables`.
  - [x] Update `test/migration-chain.prisma.e2e-spec.ts` (`columnsOf('survey_attempts')`, around line 307) and the `.slice(-11)` list in `notifications/infrastructure/notification-type.parity.spec.ts`.
- [x] **Task 3: Read side** (AC 4, 7)
  - [x] `participation/infrastructure/prisma-missing-code-report-stats.ts`:
    - add `AND a.missing_code_resolved_at IS NULL` to **both** queries;
    - select `a.form_version_id` and `a.failed_code_verifications`;
    - mirror the change in `in-memory-missing-code-report-stats.ts`;
    - update the port doc in `missing-code-report-stats.port.ts`, which currently says "There is no resolution column".
  - [x] Forms port: add `findSummaries({ formIds }) → Map<formId, { title, rewardPerResponse, status }>` to `forms/application/ports/form-title-lookup.port.ts`, or add a sibling method next to `findTitles`. Implement it in the Forms adapter and its in-memory twin.
  - [x] `admin/application/admin-missing-code-reports.service.ts`: map the new fields; `surveyOpen = status === 'PUBLISHED'`. A missing form gives `survey: null`, `rewardPerResponse: 0`, `surveyOpen: false`.
- [x] **Task 4: Repository command** (AC 2, 3, 5): `participation-repository.port.ts`, `prisma-participation.repository.ts`, `in-memory-participation.repository.ts`
  - [x] `lockOpenMissingCodeReport(attemptId)` runs inside the ambient UoW tx. It locks the form row `FOR NO KEY UPDATE` (as `completeExternalAttemptTransaction` does around line 1263), then the attempt `FOR UPDATE`. It returns the attempt with its report and resolution fields, plus `formOpen` from `isFormOpenForCompletion`.
  - [x] `completeAttemptByAdmin(attemptId, now)` does `updateMany where { id, status: { not: 'COMPLETED' }, missingCodeResolvedAt: null }` and sets `status COMPLETED, submittedAt`. It returns `{ changed }`. If the update hits the unique index `survey_attempts_one_completion_per_account`, it raises `SurveyAlreadyCompletedException`. Check `hasCompletedLogicalFormWith` before the update.
  - [x] Quota helper: `getQuotaStatusWith(tx, formId, cutoff)` with this attempt excluded from `activeReservationCount`. Add an optional `excludeAttemptId` parameter; do not copy the helper.
  - [x] `recordMissingCodeResolution(attemptId, { resolution, note, adminId, resolvedAt }, auditEvent, resolvedEvent)` runs the CAS `missingCodeResolvedAt: null` and `outboxEvent.createMany` in one `runInTransaction`. Model it on `prisma-payos-top-up.repository.ts:380-420`. It returns `{ changed }`; `changed = false` under the lock means a bug, so throw.
  - [x] Keep the in-memory repository's semantics identical to Prisma.
- [x] **Task 5: Service** (AC 1–6): a new `ParticipationService.resolveMissingCodeReport(adminId, attemptId, input, { correlationId })`
  - [x] Parse the input with the shared schema. Load the attempt. A missing attempt or `missingCodeReportedAt === null` gives `MissingCodeReportNotFoundException`. `attempt.respondentId === adminId` gives `MissingCodeSelfResolveForbiddenException`. A non-EXTERNAL form gives the existing `AttemptNotExternalException`.
  - [x] Run `unitOfWork.run(externalCompletionKey(attemptId), …)` and call `lockOpenMissingCodeReport`. Then branch:
    - Already resolved with the same outcome: return `{ replayed: true }` with the stored outcome and status.
    - Already resolved with another outcome: `MissingCodeReportAlreadyResolvedException`.
    - Status `COMPLETED`: CREDIT gives `SurveyAlreadyCompletedException`; DISMISSED gives `MissingCodeReportAlreadyResolvedException`, because the report is no longer open.
    - **CREDIT:**
      1. Guest attempt: `RewardNotSettleableException`.
      2. Form not open: `MissingCodeSurveyClosedException`.
      3. Quota full: `SurveyQuotaFullException`.
      4. Call `completeAttemptByAdmin`.
      5. Call `settleExternalOrExisting(attempt.id, form.publisherId, attempt.respondentId, form.rewardPerResponse)` (the private method around service line 1566). Map `InsufficientBalanceException` to `SurveyRewardUnavailableException`, the same as line ~1570.
      6. Call `quotaCloser?.closeFormIfQuotaMet(form.id, now)`.
      7. Call `recordMissingCodeResolution`.
    - **DISMISSED:** call `recordMissingCodeResolution` only.
  - [x] After commit, on CREDIT, call `starterPointsCoordinator.tryUnlockStarterPoints(respondentId)`, the same as the normal flow. Do **not** call `notifyPendingCredit`: the Outbox handler sends the Respondent notice, so calling it would notify twice.
  - [x] Add exceptions to `participation/application/exceptions/participation.exceptions.ts`, each with a `readonly code`. Map them in `common/http/http-exception.filter.ts` (404, 403, 409, 409) and add specs to `http-exception.filter.spec.ts`.
- [x] **Task 6: Controller** (AC 1)
  - [x] Create `participation/presentation/admin-missing-code-resolution.controller.ts` with `@Controller(['admin/missing-code-reports','api/admin/missing-code-reports'])` and `@Post(':attemptId/resolve')`. Copy the guards, `@HttpCode(200)`, and envelope from `admin-completion-code-limit.controller.ts`. Read `x-correlation-id`. Register it in `participation.module.ts`.
  - [x] Leave the Admin-module GET controller as it is. Two controllers can share the path prefix; add an e2e test that proves both routes resolve.
- [x] **Task 7: Notification handler** (AC 6)
  - [x] Create `participation/application/missing-code-resolved-notification.handler.ts` implementing `OutboxHandler` for `MISSING_CODE_RESOLVED_EVENT_TYPE`. Model it on `economy/application/top-up-refund-notification.handler.ts`: parse the payload, throw `OutboxPayloadInvalidError` if it is invalid, then call `notifications.publish` with `dedupeKey` `${event.idempotencyKey}:respondent` or `:publisher`. Register it like `rewards/infrastructure/rewards-outbox.registrar.ts`.
  - [x] Messages are marked `ASSUMED` until Owner review:
    - CREDIT, Respondent: "Admin đã xác nhận bạn hoàn thành khảo sát "{title}". {points} Điểm đang chờ, sẽ chuyển vào Khả dụng sau 48 giờ. Ghi chú: {note}"
    - DISMISSED, Respondent: "Báo cáo thiếu mã cho khảo sát "{title}" không được chấp nhận. Lý do: {note}"
    - CREDIT, Publisher: "Admin đã cộng Điểm cho một người trả lời khảo sát "{title}" vì không tìm thấy mã hoàn thành. Hãy kiểm tra mã hoàn thành trên biểu mẫu bên ngoài."
    - Cut every message to `NOTIFICATION_MESSAGE_MAX_LENGTH` with "…".
  - [x] FE `lib/notifications/notification-presentation.ts`: add `MISSING_CODE_REPORT_RESOLVED` to both maps; the `Record` type enforces it. Use href `/notifications` or the survey list, icon `flag`, label "Kết quả báo thiếu mã".
- [x] **Task 8: FE service, view, messages** (AC 8): `apps/frontend/my-app/lib/admin/`
  - [x] `disputes-service.ts`: add `resolveMissingCodeReport(attemptId, { outcome, note })` → `POST /admin/missing-code-reports/${encodeURIComponent(id)}/resolve`, using `resolveMissingCodeReportResultSchema` and CSRF through `apiRequest`, as `resetCompletionCodeLimit` does (lines 193-202).
  - [x] `disputes-view.ts`: add a pure `missingCodeReportActions(report)` that reuses the MISSING_CODE labels at lines 284-307 and `resetAction`, and returns `disabledReason` for closed survey, guest, or `COMPLETED`. Fix the credit `confirmBody` to name **Điểm chờ (48 giờ)**. Give `validateDecisionNote` optional `{ min, max, audience }` so the missing-code copy says "gửi cho người trả lời" and uses 10–500. Existing dispute behavior and copy must stay byte-identical; the tests at lines 110-313 pin them.
  - [x] `disputes-messages.ts`: add `MISSING_CODE_REPORT_NOT_FOUND`, `MISSING_CODE_REPORT_ALREADY_RESOLVED`, `MISSING_CODE_SURVEY_CLOSED`, `MISSING_CODE_SELF_RESOLVE_FORBIDDEN`, `SURVEY_ALREADY_COMPLETED`, `SURVEY_QUOTA_FULL`, `SURVEY_REWARD_UNAVAILABLE`, `REWARD_NOT_SETTLEABLE`. Extend `isStaleCaseError`, or add `isStaleReportError`, for the reload codes.
- [x] **Task 9: FE screen** (AC 8): `app/(signed-in)/(admin)/admin/disputes/components/`
  - [x] `MissingCodeReportList.tsx`: per row, add a points chip, an "Xử lý" toggle that reveals a `Textarea` (reason) and the action buttons, and `ConfirmDecisionDialog`. Add a `useRef` double-submit guard, like `code-issues/components/ResolveCodeIssueDialog.tsx`. Update the header doc comment, which currently says "read only".
  - [x] Add a hook `hooks/use-missing-code-resolution.ts`, modeled on `use-case-decision.ts`. It runs resolve or reset, then calls `queue.reload()` and refreshes the AdminShell queue counts through the existing refresh path. Find how 13.x screens refresh `/admin/queue-counts`; do not add a new mechanism.
  - [x] `DisputesScreen.tsx` around lines 61-69: pass the callbacks. The pilot build (`PILOT_BUILD`, MISSING_CODE tab only) must work.
- [x] **Task 10: Tests**
  - [x] Schemas: body strictness, trim and length, the result schema, the audit and event payloads, the key helpers, the new report DTO fields, and `NOTIFICATION_TYPES` append-only order.
  - [x] Backend unit, `participation.service.missing-code-resolution.spec.ts`: each refusal from AC 3 and AC 5; replay versus cross-outcome; self forbidden; CREDIT posts exactly one `external-completion:` journal and writes the audit and event once; DISMISSED posts no journal; no `notifyPendingCredit`; starter unlock called on CREDIT; ABANDONED and LOCKED attempts can be credited; the quota helper excludes this attempt's own reservation. Also cover the report-stats predicate, the admin service mapping, and the notification handler (three messages, truncation, dedupe keys, no Publisher message on DISMISSED).
  - [x] Backend Prisma e2e, `test/missing-code-resolution.prisma.e2e-spec.ts`, modeled on `test/top-up-payos-mismatch.prisma.e2e-spec.ts`. Cover the three races in AC 5, each ending with one journal, one audit row, and the Respondent PENDING credited once. Also prove that a resolved report leaves `countUnresolved`, and that the CHECK constraint rejects a half-set resolution.
  - [x] Backend HTTP e2e, in `test/admin-missing-code-reports.e2e-spec.ts` or a new spec: 401 and 403 (non-admin, missing CSRF); 400 (bad body, unknown key, short note); 404; GET and POST on the same prefix both work; the GET body has the new fields.
  - [x] FE `tests/admin-disputes.test.mjs`: `missingCodeReportActions` (disabled reasons, reset only when failures > 0), note validation 10–500 with the missing-code copy, message mapping, and service schema parsing. All existing dispute tests stay green.
  - [x] Run `npm test --workspace @rescom/schemas`; backend `npm test --workspace backend -- participation missing-code notification http-exception`, `npm run test:e2e --workspace backend -- missing-code migration notification external-completion`, and `npm run build --workspace backend`; and in `apps/frontend/my-app`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Prisma e2e needs Docker Postgres. If Docker is down, say so in the completion notes and do not mark the story done.
  - [x] Visual check in hybrid mode at 1440 and 390 px, against Figma 11c `62:1609` (re-read it with the Figma MCP first): row actions, the disabled credit reason, note validation, confirm dialog copy, and the row disappearing with the counts updating.

### Review Findings

Code review 2026-10-18 (Blind Hunter, Edge Case Hunter, Acceptance Auditor; diff `b0df9b2..b380b30`).

- [x] [Review][Patch] (Decision resolved 2026-10-18 by Quan: reject with message) Re-report after DISMISSED is silently swallowed — `reportMissingCompletionCode` must throw a clear error when `missingCodeResolvedAt !== null` instead of returning "submitted to RESCOM admin for review". Record it as an AC 9 deviation (Respondent route behavior changes) [apps/backend/src/modules/participation/application/participation.service.ts:1835]
- [x] [Review][Patch] (Decision resolved 2026-10-18 by Quan: refuse credit) Credit must be refused for an attempt the Respondent cancelled after reporting (`ABANDONED` + `closedReason = CANCELLED`); DISMISSED still allowed. FE disables Credit with a reason (needs the close reason in the report DTO) [apps/backend/src/modules/participation/application/participation.service.ts:1938]
- [x] [Review][Patch] (Decision resolved 2026-10-18 by Quan: DTO flag) Respondent already completed the form on another attempt — expose a flag (e.g. `respondentCompletedForm`) on the report DTO (Participation self-join, no `forms` read) and have the FE disable Credit with a reason; Admin dismisses [apps/backend/src/modules/participation/infrastructure/prisma-missing-code-report-stats.ts]
- [x] [Review][Patch] Task 10 tests marked done but missing: AC 5 races `CREDIT_RESPONDENT` vs `DISMISSED` and vs the Respondent's late correct code; one-audit-row and PENDING-once assertions in race 9; resolved report leaves `countUnresolved`; CHECK `survey_attempts_missing_code_resolution_consistent` rejects a half-set row; HTTP e2e 401/403 (non-admin, no CSRF)/400 (bad body, unknown key, short note)/404, GET+POST same prefix, GET body new fields [apps/backend/test/missing-code-resolution.prisma.e2e-spec.ts:422]
- [x] [Review][Patch] Respondent CREDIT notice must use type `REWARD_PENDING` (AC 6); handler and its spec use `MISSING_CODE_REPORT_RESOLVED` for both outcomes [apps/backend/src/modules/participation/application/missing-code-resolved-notification.handler.ts:56]
- [x] [Review][Patch] Credit confirm copy says the Publisher receives the reason ("Người đăng và người trả lời nhận thông báo kèm lý do"), contradicting D6 [apps/frontend/my-app/lib/admin/disputes-view.ts:381]
- [x] [Review][Patch] `completeAttemptByAdmin` result `{ changed }` ignored; throw on `changed = false` like `recordMissingCodeResolution` so a credit never settles without completing the attempt [apps/backend/src/modules/participation/application/participation.service.ts:1961]
- [x] [Review][Patch] `isStaleCaseError` gained `status === 404`, which also changes the existing `use-case-decision.ts` dispute flow (Task 8: existing dispute behavior byte-identical); move the 404 rule into a missing-code-only helper [apps/frontend/my-app/lib/admin/disputes-messages.ts:61]
- [x] [Review][Patch] "Mở lại giới hạn mã" offered on guest reports, then throws client-side in `confirm()`; gate the reset action on `report.respondent` [apps/frontend/my-app/lib/admin/disputes-view.ts:372]

Review patch outcome (2026-10-18). All 9 patches were applied and are uncommitted on `feat/14-1-missing-code-report-resolution`.

Deviations from the spec:
- **AC 9 deviation.** The Respondent route `POST /attempts/:id/report-missing-code` now returns 409 `MISSING_CODE_REPORT_ALREADY_RESOLVED` once an Admin has resolved the report.
- **AC 3 addition.** CREDIT on a cancelled attempt now returns 409 `MISSING_CODE_ATTEMPT_CANCELLED`.
- **AC 7 addition.** The report DTO gains two required booleans: `attemptCancelled` and `respondentCompletedForm`.

Verification:
- schemas: 708 tests passed.
- backend unit (`participation missing-code notification http-exception admin-missing-code`): 638 tests passed.
- backend build: clean.
- Prisma and HTTP e2e (`test:e2e -- missing-code`): 38 tests passed, 0 skipped, run live against Postgres on port 5433.
- FE: typecheck, lint, build clean, and 1003 tests passed.

Re-review of the patch diff (2026-10-18, Sonnet code-reviewer): the first result was FAIL on 1 medium finding, plus 2 low findings. All three were fixed in repair loop 1:
- **Medium.** `attempt_cancelled` could be NULL for legacy ABANDONED rows whose `closed_reason` is NULL. The strict schema then broke the whole queue. It now uses `IS TRUE`, and e2e test 17 covers the legacy row.
- **Low.** `MISSING_CODE_ATTEMPT_CANCELLED` was added to `isStaleReportError`, so the list reloads and shows the disabled reason.
- **Low.** The full-mock MSW `actionsOf` credit copy was reverted to the pre-14.1 text to respect the AC 9 scope guard.

Informational, not fixed: `respondentCompletedForm` checks only `survey_attempts`, not legacy attempt-less `responses`. In that case the stale 409 path handles it at click time.

Verification after repair: e2e 38/38, FE 1003/1003, typecheck and backend build clean.

## Dev Notes

### Scope boundary (read first)

**In scope:** Admin resolution of FR-23 missing-code reports (credit or dismiss), the resolution columns, the audit row, in-app notifications, the console actions in the real-backend modes, and the extra report DTO fields.

**Out of scope:**
- Story 8.5 (Publisher complaint, `ATTEMPT_DISPUTE`, dispute holds) and the `LOCKED_ATTEMPT` kind: both stay on MSW.
- Email for resolution notices.
- Any change to `POST /admin/completion-code-limits/reset`.
- An audit-log UI (Story 14.3). Note for 14.3: admin audit events here, as in 13.9/13.12, are Outbox rows (`admin-audit:*`) with no consumer. They are **not** in the Identity `audit_logs` table that `GET /admin/audit-logs` reads.
- A live capability port in Participation (D7).

### Decisions (sprint-change-proposal-2026-10-18 D1/D2 approved by Owner Quan; D3–D7 defaults from this story, so confirm at review)

- **D1: Pending, current price.** A credit goes through `external-completion:{attemptId}` into PENDING and is released after 48 h, at the form's **current** `rewardPerResponse`. The attempt never completed before, so there is no earlier price. This is the same behavior as `redriveExternalReward`. The FE mock's assumption (`internal-reward:{attemptId}` straight to Available) is dropped.
- **D2: Counts toward quota.** A credited attempt is a normal `COMPLETED` attempt, so it counts in `countCompletionsByFormIds` and can trigger `closeFormIfQuotaMet`. An ABANDONED or LOCKED attempt has already released its reservation. The quota check therefore uses the reservation rule with the attempt's own reservation excluded, so an admin credit never pushes the survey past `expectedCompletions`.
- **D3: Closed survey refuses credit.** A closed survey has already refunded its unused escrow (`close-refund:`). The credit would fail on escrow or pay out of a closed survey, so it is refused up front with `MISSING_CODE_SURVEY_CLOSED`. The Admin can still dismiss with a reason. A compensation path for closed surveys is Story 14.5 (direct credit).
- **D4: Replay versus conflict.** The same outcome on an already-resolved report returns 200 `replayed`. A different outcome returns 409. This mirrors 13.9 D7.
- **D5: Note required for both outcomes, 10–500 characters.** This deviates from the epic AC, which says "optional for credit, 1–500". It follows the existing console rule (`DECISION_NOTE_MIN = 10`, note required for every decision, `use-case-decision.ts:38-46`). 500 characters keeps the note close to the 500-character notification limit; the message is truncated anyway. The epics.md 14.1 AC is updated to match.
- **D6: In-app only; the Publisher gets no note.** The current FE copy says "gửi email cho cả hai bên", but FR-23 does not require email, and adding an email type needs a template and a closed-list change. The Admin note is written for the Respondent. The Publisher gets only a fixed "check your completion code" notice, with no Respondent identity (AD-18).
- **D7: Role guard only.** Role guard only, the same as the sibling Participation admin routes (`redriveExternalReward`, completion-code reset). A role change revokes the user's sessions (`users-service.ts` PATCH role). 13.9/13.12 use the Economy `ADMIN_CAPABILITY_PORT`; importing it into Participation is an extra module dependency that no AC requires. Self-resolution is still forbidden.

### Current state of files touched (read each before editing)

- `participation/application/participation.service.ts`
  - `verifyExternalCompletionCode` (l.1008): respondent-only (`attempt.respondentId !== callerUserId` → `ParticipantNotEligibleException`), plus code, time barrier, and rate limits. **Cannot be reused.**
  - UoW key `external-completion:${attempt.id}` (l.1164).
  - `settleExternalOrExisting` (private, l.1566): `findExternalSettlement`, then `coordinator.settleExternalReward`; `InsufficientBalanceException` is caught and rethrown as `SurveyRewardUnavailableException`.
  - `quotaCloser?.closeFormIfQuotaMet` (l.1283).
  - `redriveExternalReward` (l.1508): the template for deriving publisher, reward, and respondent.
  - `resetCompletionCodeLimit` (l.1421).
  - `notifyPendingCredit` (l.1734).
  - `reportMissingCompletionCode` (l.1757): accepts IN_PROGRESS, ABANDONED, and expired attempts; rejects COMPLETED, LOCKED, and cancelled ones. A report can therefore sit on an ABANDONED attempt, and a reported attempt can become LOCKED later.
- `participation/infrastructure/prisma-participation.repository.ts`
  - `lockAttemptForVerification` (l.1031, attempt `FOR UPDATE`).
  - `completeExternalAttemptTransaction` (l.1263): lock order is user advisory lock, then form `FOR NO KEY UPDATE`, then attempt `FOR UPDATE`. It claims only `IN_PROGRESS`, so it **cannot be reused** for ABANDONED or LOCKED.
  - `isFormOpenForCompletion` (l.150, `status === 'PUBLISHED'`).
  - `hasCompletedLogicalFormWith`.
  - `getQuotaStatusWith` (l.397).
  - The reserve quota check (l.664-673): `completedCount + activeReservationCount >= expectedCompletions`.
  - `resetCompletionCodeFailures` (l.1167).
  - Report CAS plus Outbox (l.1375-1396, key `missing-code-report:{attemptId}`, event `ExternalCompletionCodeMissingReported`).
- `participation/infrastructure/prisma-missing-code-report-stats.ts`
  - Open predicate (l.45-60): `missing_code_reported_at IS NOT NULL AND status <> 'COMPLETED' AND NOT EXISTS (completion_code_limit_resets r … r.created_at >= a.missing_code_reported_at)`.
  - Keyset `ORDER BY missing_code_reported_at DESC, id DESC`.
  - Partial index `survey_attempts_missing_code_reported_idx` (migration `20261001120800`).
- `admin/application/admin-missing-code-reports.service.ts` (read only, `deps = { reports, formTitles, profiles }`).
- `admin/presentation/admin-missing-code-reports.controller.ts` (GET only).
- `admin/admin.module.ts` (l.93 controller, l.141 factory, l.103-119 overview uses the same port).
- `admin/application/admin-overview.service.ts` (l.60-93, l.132): `disputes` equals the missing-code count.
- `participation/presentation/admin-completion-code-limit.controller.ts`: the controller template.
- `economy/application/reward-settlement.coordinator.ts` (l.198 `settleExternalReward`, l.268 release).
- `ledger.service.ts` `creditPendingReward` (l.1579): ESCROW to PENDING; `InsufficientEscrowBalanceException`.
- Audit pattern: `admin-top-up-refund.service.ts:306`, `payos-top-up.service.ts:261`. Free text is never copied into the audit payload, only its length.
- Closest flow analog: `rewards/application/rewards-admin-code-issues.service.ts:94` (UoW, lock report, require OPEN, replay identical, Outbox resolved event, handler `code-issue-notification.handler.ts` registered in `rewards-outbox.registrar.ts`).
- Notifications: `NOTIFICATION_PUBLISHER_PORT` is idempotent by `(userId, dedupeKey)`; in-app messages are at most 500 characters; FE `NOTIFICATION_PRESENTATION` is a `Record<NotificationType, …>`, so the build fails until the new type is added.
- FE:
  - `lib/admin/disputes-service.ts`: mode at l.164-177. Outside full mock, the reports replace the MISSING_CODE cases, and ATTEMPT_DISPUTE and LOCKED counts are 0 in real mode. Reset is at l.193-202.
  - `DisputesScreen.tsx:61-69`: the real MISSING_CODE branch renders `MissingCodeReportList`, which is read only.
  - `disputes-view.ts`: MISSING_CODE labels at l.284-307, `resetAction` at l.324, `validateDecisionNote` at l.342.
  - `disputes-messages.ts`: `RESOLVE_MESSAGES` at l.17-37, `isStaleCaseError` at l.49-57.
  - `mocks/route-allowlist.ts`: no missing-code entry.
  - `tests/route-diff.test.mjs:103-106` asserts the counts.
  - The test runner is `node --test tests/*.test.mjs`.

### API contract (after this story)

- `GET /admin/missing-code-reports?limit&cursor` returns `{ items[], total, nextCursor }`. Each item adds `formVersionId`, `rewardPerResponse`, `surveyOpen`, and `failedCodeVerifications`. Resolved reports are excluded.
- `POST /admin/missing-code-reports/:attemptId/resolve` (CSRF, JSON) takes `{ outcome, note }` and returns `{ attemptId, outcome, attemptStatus, rewardPoints, replayed }`. Errors:
  - 400 `VALIDATION_ERROR` or `ATTEMPT_NOT_EXTERNAL`;
  - 403 `MISSING_CODE_SELF_RESOLVE_FORBIDDEN`;
  - 404 `MISSING_CODE_REPORT_NOT_FOUND`;
  - 409 `MISSING_CODE_REPORT_ALREADY_RESOLVED`, `MISSING_CODE_SURVEY_CLOSED`, `SURVEY_ALREADY_COMPLETED`, `SURVEY_QUOTA_FULL`, `SURVEY_REWARD_UNAVAILABLE`, or `REWARD_NOT_SETTLEABLE`.

### Guardrails

- **Credit once.** The journal key `external-completion:{attemptId}` is the same one the Respondent's own completion uses, so the ledger dedupes the two paths. The attempt row lock, the `status <> COMPLETED` CAS, and the resolution CAS in one transaction are the primary guard. Never post the journal before the locks or outside the UoW.
- **Lock order.** Form first, then attempt, then ledger accounts. This is the same order as `completeExternalAttemptTransaction`, so the Respondent's late code and the Admin credit cannot deadlock.
- **AD-16.** Participation owns the attempt and the route; Economy is called only through `settleExternalOrExisting` and the coordinator; Forms data comes only through the Forms port. Participation SQL never reads `forms`.
- **AD-1.** No direct balance writes; no reversal.
- **PII.** The Admin note stays in the attempt row and the Respondent notice only. It never goes into the audit payload or the Publisher notice.
- **Append-only enums.** `NOTIFICATION_TYPES` and the Prisma `NotificationType` parity test.
- **No money in the FE.** The points shown are display only; the server recomputes them.
- **Do not break:** `external-completion.e2e-spec.ts`, completion-code-limit specs, `admin-missing-code-reports.e2e-spec.ts`, `admin-overview.service.spec.ts`, FE `admin-disputes.test.mjs`, `pilot-scope.test.mjs`, `hybrid-mocking.test.mjs`, `route-diff.test.mjs`, and the known pre-existing failure `rewards-flash.prisma.e2e:144` (do not mask it; see memory).

### Previous story intelligence

There is no earlier story in Epic 14. Lessons from 13.9 and 13.12, the same shape of Admin resolution:
- the order is shared schema, then port plus both repositories, then service, then controller, then e2e;
- replay versus 409 semantics;
- the audit payload carries `noteLength`, not the note;
- a Prisma concurrency e2e with `Promise.all`;
- FE error mapping must check `error.name === "ZodError"`, not `instanceof`;
- toasts inside modal dialogs;
- at 390 px use `grid-cols-[minmax(0,1fr)]`;
- `node:test` covers only pure `lib/` modules.

13.12 review: tests marked done but missing were the main finding, so each Task 10 bullet must exist.

### Git intelligence

- `b0df9b2` / `1bc6a3e`: Epic 14 planning docs.
- `9db64bf`: merge of 13.13 review patches.
- Recent pattern: one branch per story, conventional commits `feat(participation): …` / `fix(...)`.

### Latest tech information

No new library. The stack is pinned by the repo (NestJS, Prisma, Zod, Next.js). Follow the existing patterns.

### Project Structure Notes

- New in the backend:
  - migration `20261023100000_missing_code_resolution`;
  - `participation/presentation/admin-missing-code-resolution.controller.ts`;
  - `participation/application/missing-code-resolved-notification.handler.ts`;
  - `test/missing-code-resolution.prisma.e2e-spec.ts`.
- New in schemas: `participation/missing-code-resolution.schema.ts`.
- New in the FE: `admin/disputes/hooks/use-missing-code-resolution.ts`.
- Changed: Prisma schema; participation port, both repositories, service, exceptions, module; report-stats (both); Forms lookup port and adapters; admin missing-code service; HTTP exception filter; notification schema and parity spec; FE disputes service, view, messages, list, and screen; notification presentation; and tests.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 14.1]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-18.md §5 D1/D2]
- [Source: prds/prd-project-rescom-2026-08-08/prd.md#FR-23] (consequences amended 2026-10-18), FR-24, FR-57
- [Source: architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md] AD-1, AD-10, AD-16, AD-18; Cross-Context Financial Workflow Map row "Complete External Attempt + credit Pending"
- [Source: _bmad-output/implementation-artifacts/5-5-external-form-completion-code-verification.md] (completion-code policy, E5-D1 lock after 3 wrong codes)
- [Source: _bmad-output/implementation-artifacts/13-9-amount-mismatch-resolution.md] (Admin resolution template)
- Figma file `mkudD5Ngi5RPyIAVxCcxXi` frame 11c `62:1609` "Khiếu nại & báo lỗi"

## Dev Agent Record

### Agent Model Used

Claude 3.7 Sonnet / Google Gemini Agentic Pair Programmer

### Debug Log References

- Backend unit & integration test run: 41 test suites passed, 631 tests passed.
- Backend Prisma e2e (`missing-code-resolution.prisma.e2e-spec.ts`): all 10 test scenarios passed against local PostgreSQL (5433).
- Frontend tests (`apps/frontend/my-app`): 1003 tests passed, 0 failures.
- Frontend build (`next build`): successful static generation & typing.
- Backend build (`tsc -p tsconfig.build.json`): clean build.

### Completion Notes List

- Implemented Story 14.1 Missing-Code Report Resolution per AC 1–9 and D1–D7.
- Added shared schemas, DTOs, and event payloads for missing code resolution.
- Applied Prisma migration `20261023100000_missing_code_resolution` adding `MissingCodeResolution` enum, four resolution columns to `survey_attempts`, and consistency CHECK constraint.
- Implemented `lockOpenMissingCodeReport`, `completeAttemptByAdmin`, `recordMissingCodeResolution`, and `excludeAttemptId` in participation repository.
- Added CAS and UoW locking in `ParticipationService.resolveMissingCodeReport`, supporting CREDIT_RESPONDENT and DISMISSED outcomes with idempotency replays and conflict guards.
- Created `AdminMissingCodeResolutionController` with `POST /admin/missing-code-reports/:attemptId/resolve` and `/api/admin/missing-code-reports/:attemptId/resolve`.
- Created Outbox event handler `MissingCodeResolvedNotificationHandler` sending in-app notifications to respondent and publisher.
- Updated Admin FE `/admin/disputes` "Báo thiếu mã" tab with points chip, "Xử lý" toggle, 10–500 char note validation, confirm dialog with 48h pending notice, double-submit protection, and auto-refresh.

### File List

- `packages/schemas/src/participation/missing-code-resolution.schema.ts`
- `packages/schemas/src/participation/missing-code-resolution.schema.spec.ts`
- `packages/schemas/src/participation/index.ts`
- `packages/schemas/src/admin/missing-code-reports.schema.ts`
- `packages/schemas/src/admin/admin-read.schema.spec.ts`
- `packages/schemas/src/notifications/notification.schema.ts`
- `packages/schemas/src/notifications/notification.schema.spec.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20261023100000_missing_code_resolution/migration.sql`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/common/http/http-exception.filter.spec.ts`
- `apps/backend/src/modules/forms/application/ports/form-title-lookup.port.ts`
- `apps/backend/src/modules/forms/infrastructure/in-memory-form-admin-reads.ts`
- `apps/backend/src/modules/forms/infrastructure/prisma-form-admin-reads.ts`
- `apps/backend/src/modules/admin/application/admin-missing-code-reports.service.ts`
- `apps/backend/src/modules/admin/application/admin-missing-code-reports.service.spec.ts`
- `apps/backend/src/modules/participation/application/ports/missing-code-report-stats.port.ts`
- `apps/backend/src/modules/participation/infrastructure/prisma-missing-code-report-stats.ts`
- `apps/backend/src/modules/participation/domain/survey-attempt.entity.ts`
- `apps/backend/src/modules/participation/application/exceptions/participation.exceptions.ts`
- `apps/backend/src/modules/participation/application/ports/participation-repository.port.ts`
- `apps/backend/src/modules/participation/infrastructure/prisma-participation.repository.ts`
- `apps/backend/src/modules/participation/infrastructure/in-memory-participation.repository.ts`
- `apps/backend/src/modules/participation/application/participation.service.ts`
- `apps/backend/src/modules/participation/application/participation.service.spec.ts`
- `apps/backend/src/modules/participation/application/participation.service.missing-code-resolution.spec.ts`
- `apps/backend/src/modules/participation/presentation/admin-missing-code-resolution.controller.ts`
- `apps/backend/src/modules/participation/presentation/admin-missing-code-resolution.controller.spec.ts`
- `apps/backend/src/modules/participation/participation.module.ts`
- `apps/backend/src/modules/participation/application/missing-code-resolved-notification.handler.ts`
- `apps/backend/src/modules/participation/application/missing-code-resolved-notification.handler.spec.ts`
- `apps/backend/src/modules/participation/infrastructure/participation-scheduler.registrar.ts`
- `apps/backend/src/modules/notifications/infrastructure/notification-type.parity.spec.ts`
- `apps/backend/test/missing-code-resolution.prisma.e2e-spec.ts`
- `apps/backend/test/migration-chain.prisma.e2e-spec.ts`
- `apps/frontend/my-app/lib/notifications/notification-presentation.ts`
- `apps/frontend/my-app/lib/admin/disputes-service.ts`
- `apps/frontend/my-app/lib/admin/disputes-view.ts`
- `apps/frontend/my-app/lib/admin/disputes-messages.ts`
- `apps/frontend/my-app/tests/admin-disputes.test.mjs`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/disputes/hooks/use-missing-code-resolution.ts`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/disputes/components/MissingCodeReportList.tsx`
- `apps/frontend/my-app/app/(signed-in)/(admin)/admin/disputes/components/DisputesScreen.tsx`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/epics.md`
