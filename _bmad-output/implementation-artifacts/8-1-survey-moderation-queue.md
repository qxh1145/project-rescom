---
baseline_commit: 378e4a71ff125fb1acf6ee18291fc298ae56bf94
context:
  - "_bmad-output/planning-artifacts/epics.md#Story 8.1"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#4.6 Survey Moderation (FR-20) and FR-53"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-16, AD-19, Module and Durable-State Ownership Map, Cross-Context Financial Workflow Map"
  - "_bmad-output/implementation-artifacts/2-6-form-publish-lifecycle-immutability.md"
  - "_bmad-output/implementation-artifacts/2-7-form-versioning.md"
  - "_bmad-output/implementation-artifacts/6-3-escrow-lock-release-refund.md"
  - "_bmad-output/implementation-artifacts/6-6-point-top-up-request-admin-approval.md"
  - "_bmad-output/implementation-artifacts/9-6-event-notification-system.md"
  - "_bmad-output/implementation-artifacts/spec-mock-respondent-journey.md"
  - "packages/schemas/src/forms/form-publish.schema.ts"
  - "apps/backend/src/modules/forms/application/forms.service.ts"
  - "apps/backend/src/modules/forms/application/forms-escrow.coordinator.ts"
  - "apps/backend/src/modules/economy/application/top-up.service.ts"
---

# Story 8.1: Survey Moderation Queue

Status: done

## Story

As an Admin,
I want to review all newly created surveys before they go live on the Marketplace,
so that I can ensure they meet platform guidelines and don't contain malicious content.

## Acceptance Criteria

Epic ACs (`epics.md` Story 8.1):
- **Given** a Publisher publishes a survey **When** the status changes to `MODERATION_QUEUE` **Then** it appears in the Admin Moderation Dashboard (FR-20, FR-53).
- **And** an Admin can preview the survey and click "Approve" (moves to `PUBLISHED`) or "Reject" (moves to `CLOSED`, points refunded).

PRD consequences folded in (FR-20 / FR-53): every survey (Internal **and** External, rewarded **and** free) enters the queue on publish ("Pending Moderation") and does not appear on the Marketplace until approved; the Admin approves or rejects **with a reason**; rejection returns the Escrow Points to the Publisher; the Publisher is notified of approval/rejection. Moderation owns "survey moderation cases" and "admin-action audit" (Ownership Map); the audit event follows the Story 6.6 `AdminTopUpApproved` Outbox pattern.

### AC1 — Lifecycle: every publish lands in `MODERATION_QUEUE` (authoritative transition table)
1. `packages/schemas/src/forms/form-publish.schema.ts` is the single source of truth and becomes:
   - `DRAFT → [MODERATION_QUEUE]`
   - `ESCROW_LOCKED → [MODERATION_QUEUE, CLOSED]` (legacy rows only — nothing enters `ESCROW_LOCKED` any more)
   - `MODERATION_QUEUE → [PUBLISHED, CLOSED]`
   - `PUBLISHED → [CLOSED]`, `CLOSED → []`
   Direct `DRAFT → PUBLISHED`, `DRAFT → ESCROW_LOCKED` and `ESCROW_LOCKED → PUBLISHED` are removed (they bypassed moderation). `determinePublishTargetStatus()` returns `MODERATION_QUEUE` for every form. Doc comments explain the lifecycle.
2. `POST /forms/:id/publish` validates exactly as before, reserves Escrow (if the effective cost > 0) **and** moves the form to `MODERATION_QUEUE` under one Unit of Work keyed `publish:{formVersionId}` (AD-16 Publish+Escrow): a lost optimistic update rolls the escrow journal back. A Publisher-supplied `targetStatus` other than `MODERATION_QUEUE` → `400 INVALID_STATUS_TRANSITION`.
3. `POST /forms/external` with `autoPublish: true` no longer writes an unfunded `ESCROW_LOCKED` form: it reserves Escrow for the new version and creates the form in `MODERATION_QUEUE` under the same Unit of Work (insufficient balance → `409 INSUFFICIENT_ESCROW_BALANCE`, nothing created).
4. While queued, the pinned `FormVersion` stays `isPublished = false`, `publishedAt = null`; the form is not in the Marketplace feed, not startable (`startAttempt` → 404 `SURVEY_NOT_AVAILABLE`), not served on `/f/:id`, and immutable (`PATCH /draft`/`DELETE` → 409). Approval sets `isPublished = true` and `publishedAt = approvedAt`. Re-published versions (Story 2.7 `POST /forms/:id/versions` → edit → publish) follow the same path: the form leaves the Marketplace while the new version is queued, and approval makes the new version the live one.
5. The generic Admin endpoint `POST /forms/:id/status` can no longer bypass moderation: any transition out of `MODERATION_QUEUE` → `409 FORM_MODERATION_REQUIRED`; `→ PUBLISHED` is impossible by the table; `→ CLOSED` is delegated to the refunding close path. Legacy `ESCROW_LOCKED → MODERATION_QUEUE` stays possible for Admins.
   _Amended by the code review of 2026-09-26:_ generic Admin endpoints (`/status`, `/close`) cannot take a queued survey out of the queue — `POST /forms/:id/close` on a queued survey by anyone but its owner → `409 FORM_MODERATION_REQUIRED` (the owner may still withdraw it; P1). The legacy `ESCROW_LOCKED → MODERATION_QUEUE` move runs the publish validations (422) and requires the form's Escrow to fund its open quota, otherwise `409 MODERATION_ESCROW_NOT_FUNDED` with `details.shortfall` (P2); the Admin never reserves on the Publisher's behalf and closes such a row instead.
6. `POST /forms/:id/reopen` requires the current version to have been approved (`isPublished`), otherwise `409 FORM_NOT_REOPENABLE` (a rejected/withdrawn survey cannot be put live by reopening).
   _Amended by decision E8-D1 (2026-09-26, option B; transition table signed off, see the ARCHITECTURE-SPINE amendment note):_ every close records who closed the survey in `Form.closeKind` — `OWNER` (the Publisher's close or withdrawal, including an Admin closing their own survey), `ADMIN` (an Admin takedown of someone else's survey via `/close` or `/status`), `MODERATION` (rejection). Reopen additionally requires the last close to be the owner's: otherwise `409 FORM_NOT_REOPENABLE` with `details = { reason: 'CLOSED_BY_ADMIN_OR_MODERATION', closeKind }` (an unapproved version gives `reason: 'VERSION_NOT_APPROVED'`). A close recorded before the column existed (`NULL`) fails closed. `FormDetailDto.closeKind` exposes it.

### AC2 — Escrow semantics for never-live versions (refund exactly what was reserved)
1. `FormsEscrowCoordinator.coordinateClose` keeps the Story 6.3 formula for a live version (unused completions × effective reward). For a version that never went live (queued/withdrawn/rejected) it refunds the Escrow actually reserved for the form's never-live versions (sum of their `publish:{formVersionId}` journals, read through a new Economy query `LedgerService.getEscrowReservation(formVersionId)`) **plus** the unused quota of the earlier live version when this was a re-publication. Refund key stays `close-refund:{formId}:{versionNumber}`; the refund is capped at the Escrow balance (existing `refundUnusedEscrow`).
2. This prevents refunding another survey's Escrow for legacy unfunded forms (reservation 0 → refund 0) and returns the full reservation on rejection.
3. _Superseded by the Epic 6 code review (2026-09-26, P3/P4; recorded by the Epic 8 review P14):_ every close — live close, withdrawal, rejection — refunds everything the form still holds, computed from the form's own journals: `reserved − refunded − consumed − owed` (`LedgerService.getFormEscrowPosition`). The refund key is `close-refund:{formId}:c{closeCount}` (`Form.closeCount` = times the survey entered CLOSED), so every close/reopen cycle posts its own journal. A re-publication reserves only the shortfall (open slots × draw − what the form still holds), and approval requires that shortfall to be 0 (P2). `getEscrowReservation` remains as a read-only diagnostic only.

### AC3 — Admin moderation queue & preview (FR-20, FR-53)
1. New `moderation` bounded-context module (`apps/backend/src/modules/moderation`).
2. `GET /admin/moderation/surveys` (+ `api/` prefix): `SessionAuthGuard` + `RolesGuard` + `@Roles('ADMIN')`, query `listModerationQueueQuerySchema` (`limit` 1–50 default 20, `offset` ≥ 0); returns forms in `MODERATION_QUEUE` FIFO (oldest submission first) as `{ items, total, limit, offset, hasMore }` with: `formId`, `formVersionId`, `versionNumber`, `title`, `description`, `type`, `status`, `publisherId`, `publisherEmail|null`, `rewardPerResponse`, `expectedCompletions`, `effectiveRewardPerResponse`, `escrowAmount` (effective cost), `estimatedEffortSeconds`, `blocksCount`, `externalUrl|null`, `targetingJson|null`, `isResubmission`, `submittedAt`.
3. `GET /admin/moderation/surveys/:formId` (Admin only): the same fields plus the pinned version's `schemaJson` (for the rendered preview) and the latest moderation `decision|null`; works for queued and already-decided forms; unknown form → `404 FORM_NOT_FOUND`.

### AC4 — Approve (`MODERATION_QUEUE → PUBLISHED`)
1. `POST /admin/moderation/surveys/:formId/approve` (Admin, `CsrfGuard` + `JsonOnlyGuard`), body `{ formVersionId }` (the version the Admin previewed), optional `X-Correlation-Id` (UUID, else generated).
2. Under one Unit of Work keyed `moderation:{formVersionId}`: re-verify the actor's **live** Identity capability (`ADMIN_CAPABILITY_PORT`, `users` row `FOR SHARE`; not `ADMIN`+`ACTIVE` → `403 MODERATION_ADMIN_CAPABILITY_REQUIRED`); an Admin cannot moderate their own survey (`403 MODERATION_SELF_REVIEW_FORBIDDEN`); an existing decision for this version with the same outcome → idempotent replay (`replayed: true`, no side effects); the opposite outcome → `409 MODERATION_ALREADY_DECIDED`; form not in `MODERATION_QUEUE` → `409 FORM_NOT_IN_MODERATION_QUEUE`; pinned version ≠ `formVersionId` → `409 MODERATION_VERSION_MISMATCH`.
3. _Code review 2026-09-26 (P2):_ before the transition, approval re-runs the publish validations on the stored version (Internal Form Definition; External metadata, HTTPS URL and completion code; stored targeting) → `422 FORM_VALIDATION_ERROR` / `EXTERNAL_COMPLETION_CODE_REQUIRED`, and requires the form's Escrow to fund its open quota → `409 MODERATION_ESCROW_NOT_FUNDED` (`details.shortfall`); the Admin rejects instead. The preview reports `escrowHeld` and `fundingShortfall`; `escrowAmount` is the cost quote.
   Research command `FormModerationCommands.approvePublication` performs the **conditional** transition (`status = MODERATION_QUEUE` and unchanged `updatedAt`) and marks the version published; a lost transition re-reads the winner (same outcome → replay, else `409 MODERATION_ALREADY_DECIDED`). Concurrent approve + reject → exactly one wins.
4. Moderation records a `SurveyModerationDecision` (`APPROVED`, `adminId`, optional `reason`, `correlationId`, `decidedAt`; unique per `formVersionId`) **and** appends an Outbox admin-audit event (`eventType: 'AdminSurveyApproved'`, `producer: 'moderation-service'`, `aggregateType: 'Form'`, `aggregateId: formId`, `aggregateVersion: versionNumber`, `idempotencyKey: 'admin-audit:moderation:{formVersionId}'`, payload `surveyModerationAuditEventPayloadSchema`) in the same transaction.
5. After commit: `SURVEY_APPROVED` notification to the Publisher via `NOTIFICATION_PUBLISHER_PORT` (dedupe `moderation:{formVersionId}`; replays re-publish and are deduplicated).
6. The approved survey appears in the Marketplace feed and can be started.

### AC5 — Reject (`MODERATION_QUEUE → CLOSED`, Escrow refunded atomically)
1. `POST /admin/moderation/surveys/:formId/reject` (Admin, `CsrfGuard` + `JsonOnlyGuard`), body `{ formVersionId, reason }` (reason trimmed 5–500 chars, required).
2. Same Unit of Work / capability / self-review / replay / conflict rules as AC4. `FormModerationCommands.rejectPublication` performs the conditional `MODERATION_QUEUE → CLOSED` transition and then calls `FormsEscrowCoordinator.coordinateClose` (AC2) — Research `CloseForm` + Economy `RefundUnusedEscrow` under the shared Unit of Work, key `close-refund:{formId}:{versionNumber}` (_now `close-refund:{formId}:c{closeCount}`, Epic 6 review P3_). Decision (`REJECTED`, reason, `refundAmount`, `refundJournalId`) + Outbox `AdminSurveyRejected` commit in the same transaction; any failure rolls everything back.
3. After commit: `SURVEY_REJECTED` notification with the reason and the refunded amount.
   _Amended by decision E8-D2 (2026-09-26, option A):_ when the rejected version is a re-submission of a survey that was already live, the notice says so explicitly ("Your edited survey … (version n) was rejected … the whole survey is now closed for good, including the previously approved version, and it cannot be reopened."); the warning and the refund always fit the 500-character budget (the reason is shortened instead), also on a replay.
4. A rejected survey cannot be reopened (AC1.6) and never appears in the Marketplace.

### AC6 — Frontend
1. Typed live client `apps/frontend/my-app/app/admin/moderation/moderation-api.ts` (`listModerationQueue`, `getModerationSurvey`, `approveSurvey`, `rejectSurvey`) using `formMutationFetch` for CSRF mutations and schema-validated responses; `node --test` coverage.
2. Minimal Admin Moderation Dashboard `app/admin/moderation/page.tsx` on the live API (same pattern as the live Publisher forms pages, not part of the mock respondent journey): queue list with loading/empty/error/403 states, preview panel (metadata, escrow, targeting, external URL or the rendered Internal form via `FormRenderer` in preview mode), Approve and Reject (reason required, validated) with busy/disabled states, Vietnamese copy, keyboard focus, responsive.
   _Decision E8-D5 (2026-09-26, option A):_ the unlinked live page is accepted by the mock-journey spec's human owner (spec Change Log). _Decision E8-D2 (option A):_ before rejecting a re-submission (`isResubmission`) the preview shows a warning panel ("Từ chối sẽ đóng vĩnh viễn toàn bộ khảo sát — kể cả phiên bản đã duyệt trước đó …"), linked to the reject button ("Từ chối & đóng vĩnh viễn khảo sát") via `aria-describedby`.
3. Publisher pages present the queued state: status label helper (`MODERATION_QUEUE` → "Chờ kiểm duyệt"), status badge in `/forms` and `/forms/[id]/edit`, an explanatory banner on the edit page while queued, publish modal/notification copy that says the survey goes to moderation (not straight to the Marketplace), and the External-survey wizard toggle copy.

### AC7 — Quality
1. Unit tests for the schema changes, lifecycle rules, escrow semantics, moderation service (approve, reject+refund, replay, conflicts, race, capability, self-review, notifications, audit event), repositories (in-memory + mocked Prisma), controller (guards overridden).
2. New `test/survey-moderation.e2e-spec.ts` (publish → queue → preview → approve → marketplace/startable; reject → CLOSED + refund + notification + outbox; RBAC/CSRF/validation; replay/conflict; demoted admin).
3. Existing e2e specs affected by the new publish target are updated deliberately (approve via the moderation endpoint where the flow matters, keep assertions that still hold). The WHOLE e2e suite passes.

## Tasks / Subtasks

- [x] Task 1: Shared contracts (AC1, AC3–AC5)
  - [x] 1.1 Update transition table / `determinePublishTargetStatus` / docs in `form-publish.schema.ts`.
  - [x] 1.2 New `packages/schemas/src/moderation/survey-moderation.schema.ts` (+ index, root export): outcome enum, query/list/item/preview/decision/result schemas, approve/reject bodies, `surveyModerationKey()`, audit event types + payload schema, constants.
  - [x] 1.3 Schema unit tests (`packages/schemas/src/moderation/survey-moderation.schema.spec.ts`) and updated `form-publish.schema.spec.ts` (backend presentation spec).
- [x] Task 2: Persistence (AC4, AC5)
  - [x] 2.1 Prisma: enum `SurveyModerationOutcome`, model `SurveyModerationDecision` (+ back-relations on `Form`, `FormVersion`, `User`).
  - [x] 2.2 Hand-written drift-tolerant migration `20260926150000_survey_moderation_decisions` (FKs to `forms`/`form_versions` only when those tables exist — they are not created by any migration).
  - [x] 2.3 `prisma validate` + `prisma generate`.
- [x] Task 3: Research (forms) changes (AC1, AC2)
  - [x] 3.1 `FormsService`: optional `UnitOfWorkPort`; publish + autoPublish under `publish:{versionId}`; close under `close-refund:{formId}:{versionNumber}`; publisher `targetStatus` restricted; reopen guard; generic transition guard / delegation.
  - [x] 3.2 `FormsEscrowCoordinator.coordinateClose` never-live branch; `LedgerService.getEscrowReservation`.
  - [x] 3.3 `FormRepositoryPort.findModerationQueue` (Prisma + in-memory); Prisma `create`/`update`/`createVersion` join the ambient Unit of Work (`runInTransaction`).
  - [x] 3.4 `FormModerationCommands` (listQueue, findForReview, approvePublication, rejectPublication) exported from `FormsModule`; new exceptions + HTTP mapping.
  - [x] 3.5 Update forms unit specs (service, coordinator, repository, controller, schema).
- [x] Task 4: Moderation module (AC3–AC5)
  - [x] 4.1 Domain `SurveyModerationDecision` entity; ports `SurveyModerationRepositoryPort`, `PublisherDirectoryPort`.
  - [x] 4.2 `SurveyModerationService` (queue, preview, approve, reject) with UoW, live capability, self-review, replay, lost-race resolution, audit event, post-commit notifications.
  - [x] 4.3 Infrastructure: Prisma + in-memory decision repositories (decision + Outbox in one transaction), user-backed publisher directory.
  - [x] 4.4 `AdminModerationController` + `ModerationModule` (registered in `AppModule`); exceptions mapped in `HttpExceptionFilter`.
  - [x] 4.5 Unit tests (service, repositories, controller, entity).
- [x] Task 5: e2e (AC7)
  - [x] 5.1 New `test/survey-moderation.e2e-spec.ts`.
  - [x] 5.2 Update `forms-publish`, `forms-escrow`, `forms-versioning` (and any other failing) specs; override new Prisma-backed providers where the flow is exercised.
- [x] Task 6: Frontend (AC6)
  - [x] 6.1 `app/forms/form-status.ts` labels/tones + usage in `/forms`, `/forms/[id]/edit`, `PublishConfirmationModal`, `CreateExternalSurveyModal`.
  - [x] 6.2 `app/admin/moderation/moderation-api.ts` + `tests/moderation-api.test.mjs` (+ `form-status` test).
  - [x] 6.3 `app/admin/moderation/page.tsx` dashboard.
- [x] Task 7: Verification & bookkeeping
  - [x] 7.1 `verify.sh` (schemas, backend unit, backend e2e, frontend tests, typecheck, lint) + prisma validate; eslint --fix.
  - [x] 7.2 Deferred items appended to `deferred-work.md`; story + sprint status → `review`.

### Review Findings

_Epic 8 code review of 2026-09-26 (Blind Hunter + Edge Case Hunter + Acceptance Auditor; triage IDs D/P/DF in brackets, decision IDs from `code-review-decisions-2026-09-26.md`). Findings of Stories 8.1 and 8.2 were triaged together; this list holds the ones that belong to 8.1. Dismissed as noise across the epic: 9 (the re-publication over-refund / stranded reservation / double refund / External blind spot and the reject audit-key regression were already fixed by the Epic 6 review P3/P4; fixed-window burst, client correlation id and the replay's current-form block are by design; the barrier-exceeds-lifetime case belongs to E5-D2)._

- [x] [Review][Decision] E8-D1 — Sign-off of the revised lifecycle transition table, and reopening after an Admin takedown (D1, medium) — The new table removes every path to PUBLISHED that skips moderation (FR-20), but the ARCHITECTURE-SPINE open question requires Product/Research/Moderation + Engineering to approve and contract-test it. `reopenForm` also puts the approved current version back live without new moderation, including a survey an Admin took down through `POST /forms/:id/close` (Admin close of a live survey is allowed and unaudited, pre-existing from 2.6/6.3). Options: (A) approve the table as implemented, Admin takedowns stay reversible; (B) approve the table and make Admin takedowns final — persist `closeKind` (OWNER | ADMIN | MODERATION) in the same conditional update as the close and `closeCount`, `reopenForm` → 409 `FORM_NOT_REOPENABLE` unless the last close was the owner's, follow-up: route Admin takedowns through a Moderation command with reason, audit event and notification; (C) approve the table with reopen going back through moderation (`CLOSED → MODERATION_QUEUE`, Escrow for the extra slots reserved at request time). **Recommendation: B**, plus the exhaustive from→to contract test in `form-publish.schema.spec.ts` and the sign-off recorded against the spine's open question. Not implemented (decision pending). [packages/schemas/src/forms/form-publish.schema.ts:23] — **Resolved 2026-09-26:** option B accepted by Quan; transition table signed off (dated amendment note next to the ARCHITECTURE-SPINE open question; exhaustive from→to contract test in `form-publish.schema.spec.ts`); new `FormCloseKind` (`OWNER`/`ADMIN`/`MODERATION`) written by `FormEntity.close()` in the same conditional update as the CLOSED transition and `closeCount` (`closeForm`: owner → OWNER, other Admin → ADMIN; `rejectPublication` → MODERATION), Prisma `Form.closeKind` + drift-tolerant migration `20260927020000_form_close_kind` (no backfill: NULL fails closed); `reopenForm` → 409 `FORM_NOT_REOPENABLE` with `details { reason: CLOSED_BY_ADMIN_OR_MODERATION, closeKind }` unless the owner closed it; `FormDetailDto.closeKind`. Tests: contract matrix, forms service (owner/Admin/`/status`/Admin-owner/NULL/withdrawn), moderation commands, Prisma repository, filter, e2e. Follow-up (Moderation takedown command with reason/audit/notification) in `deferred-work.md`.
- [x] [Review][Decision] E8-D2 — Rejecting a re-submission closes the whole, previously approved survey for good (D2, medium; decide with E5-D4) — v1 live, v2 queued (form off the Marketplace); rejecting v2 moves the form to CLOSED and refunds everything; `reopenForm` then refuses (current version never approved) and `createNewVersion` needs PUBLISHED, so the approved v1 content can never return. The Admin UI does not warn. Options: (A) keep it strict as AC1.6/AC5.4 say, and warn in the Admin UI when `isResubmission` ("Từ chối sẽ đóng vĩnh viễn khảo sát đang chạy v{n−1}") and in the `SURVEY_REJECTED` copy; (B) reject only the edit — the form returns to PUBLISHED on the last approved version (needs a "live version" pointer across participation/Marketplace/public forms = E5-D4 option C); (C) reject back to editing — create draft v{n+1} copied from the rejected one, form → DRAFT, Escrow stays reserved. **Recommendation: A now (cheap, matches the ACs), C in Phase 2** together with E5-D4. Not implemented. [apps/backend/src/modules/forms/application/form-moderation.commands.ts:120] — **Resolved 2026-09-26:** option A accepted by Quan; the strict rule stays (rejecting a re-submission closes the whole survey for good) and is now explicit: the Admin dashboard shows a warning panel before rejecting a re-submission (`describeRejectionImpact` in `moderation-view.ts`, reject button relabelled and described by it) and the Publisher's `SURVEY_REJECTED` text carries `RESUBMISSION_REJECTION_WARNING` (also on replays; reason shortened to keep the 500-char budget). Tests: moderation service, `test/survey-moderation.e2e-spec.ts`, `tests/moderation-view.test.mjs`. Option C recorded as a Phase 2 follow-up with E5-D4 in `deferred-work.md`.
- [x] [Review][Decision] E8-D3 — Self-moderation ban with a single Admin account (D3, medium) — `MODERATION_SELF_REVIEW_FORBIDDEN` mirrors the 6.6 four-eyes rule but is not in the PRD/spine; with one Admin account that Admin's own surveys can never go live. Options: (A) keep the ban, Ops provision ≥ 2 ACTIVE Admin accounts before the pilot; (B) allow self-approval only when no other ACTIVE Admin exists, flagged `selfReview: true` in the decision and audit payload; (C) always allow it with the audit flag. **Recommendation: A** (consistent with 6.6 and E4-DN2; B only if the pilot really has one Admin). No code change for A. [apps/backend/src/modules/moderation/application/survey-moderation.service.ts:322] — **Resolved 2026-09-26:** option A accepted by Quan; the self-moderation ban stays (no code change); ops requirement "provision at least two active Admin accounts before the pilot" recorded in `apps/backend/.env.example`, the `apps/backend/README.md` ops checklist and as a needs-human entry in `deferred-work.md`.
- [x] [Review][Decision] E8-D5 — The human-owned mock-journey spec vs the 8.1/8.2 frontend additions (D5, low, governance; shared with Story 8.2) — `spec-mock-respondent-journey.md` reserves deferred Admin modules and live-adapter edits for its human owner; the unattended dev run added the unlinked live `/admin/moderation` page (8.1) and extended `app/marketplace/participation-api.ts` (8.2). Options: (A) accept both, with a Spec Change Log note; (B) keep the Admin page, move the new live participation client code into e.g. `app/marketplace/participation-submit-api.ts` and restore `participation-api.ts`; (C) remove or feature-flag `/admin/moderation` (backend stays). **Recommendation: A for the Admin page, B for the adapter**; the human owner decides. Not implemented (the review patches edited the Admin page in place, P2/P6/P8/P9). [apps/frontend/my-app/app/admin/moderation/page.tsx:1] — **Resolved 2026-09-26:** option A (Admin page) + B (adapter) accepted by Quan; the `/admin/moderation` page is accepted in the mock spec's Change Log (dated note), and the 8.2 live-client additions moved to `app/marketplace/participation-submit-api.ts` with `participation-api.ts` restored to its prior API surface (Story 8.2).
- [x] [Review][Patch] An Admin could take someone else's queued survey out of the queue through `POST /forms/:id/close`, bypassing moderation (P1, medium) — fixed: `closeForm` throws `FormModerationRequiredException` (409 `FORM_MODERATION_REQUIRED`) when a queued survey is closed by anyone but its owner (the owner keeps the full-refund withdrawal); no transition, no `closeCount` bump, no `close-refund:` journal. AC1.5 amended ("generic Admin endpoints `/status` and `/close` cannot take a queued survey out of the queue"). Tests: `forms.service.spec.ts` (Admin close → 409, status/closeCount/escrow unchanged, owner withdrawal still refunds), `survey-moderation.e2e-spec.ts` (Admin `/close` → 409, then the reject endpoint records the decision and the Outbox audit row). [apps/backend/src/modules/forms/application/forms.service.ts:591]
- [x] [Review][Patch] Approval did not verify funding or validity; the Admin saw a cost quote labelled "escrow locked" (P2, medium) — fixed: `FormsEscrowCoordinator.getFundingPosition(form, publisherId)` → `{ required, held, shortfall }` from the form's own journals (all 0 for a free survey; `coordinatePublish` now reserves exactly this shortfall, so the formula exists once); the publish validations were extracted from `publishForm` into `assertFormPublishable` (`form-publishability.ts`: Internal definition; External metadata, HTTPS URL, completion code; stored targeting via `parseStoredTargeting`). `FormModerationCommands.approvePublication` runs both inside the moderation Unit of Work before the conditional transition → 422 `FORM_VALIDATION_ERROR` / `EXTERNAL_COMPLETION_CODE_REQUIRED` or 409 `MODERATION_ESCROW_NOT_FUNDED` (`details.shortfall`, new `ModerationEscrowNotFundedException`, mapped in `http-exception.filter.ts`); the legacy Admin move `ESCROW_LOCKED → MODERATION_QUEUE` runs the same checks and fails closed (the Admin never reserves on the Publisher's behalf, Epic 6 P13). The preview adds `escrowHeld` / `fundingShortfall` (null once the survey left the queue); `escrowAmount` is re-documented as the cost quote; the migration comment and `deferred-work.md` legacy entry were updated. UI: see the frontend line below. Tests: `form-moderation.commands.spec.ts` (unfunded legacy row → 409 and stays queued, partial funding → exact shortfall, funded row and free survey approve, re-submission with a shortfall-only reservation approves, missing code / `http:` URL / invalid targeting / no blocks → 422), `forms.service.spec.ts` (legacy row without reservation → 409, with a full reservation → queued, `http:` URL → 422, unfunded row can still be closed), `survey-moderation.service.spec.ts` (preview held/shortfall, approve refused, reject refunds 0), filter spec, e2e (legacy `/status` → 409 with shortfall, preview + approve 409). [apps/backend/src/modules/forms/application/form-moderation.commands.ts:88]
- [x] [Review][Patch] The moderation decision lookup bypassed the ambient Unit of Work client (P5, low) — fixed: `PrismaSurveyModerationRepository.findByFormVersionId` reads through `currentClient(this.prisma)` (Epic 6 P7 convention). Test: repository spec with `PrismaUnitOfWork` — inside the Unit of Work the `tx` client is used, never `prisma`. [apps/backend/src/modules/moderation/infrastructure/prisma-survey-moderation.repository.ts:33]
- [x] [Review][Patch] One malformed stored row broke the whole Admin queue (P6, low) — fixed: `toQueueItem` parses the stored targeting with `parseStoredTargeting` (invalid → `targetingJson: null` + new `targetingInvalid: true`, schema default false) and falls back to the 60 s default for a non-integer/negative `expectedEffortSeconds`; approval of such a survey is refused by P2's `assertFormPublishable`. UI badge: see the frontend line below. Tests: schema spec (flag default), service spec (`{ locations: [1] }` + `12.5` effort → the list validates against `moderationQueueListSchema`, item flagged). [apps/backend/src/modules/moderation/application/survey-moderation.service.ts:473]
- [x] [Review][Patch] An unbounded queue `offset` returned 500 instead of 400 (P7, low) — fixed: `MODERATION_QUEUE_MAX_OFFSET = 10_000` and `.max(...)` on `listModerationQueueQuerySchema.offset` (400 `VALIDATION_ERROR` from the controller pipe). Tests: schema spec (`"1e20"` and 10,001 rejected, 10,000 accepted), e2e `?offset=1e20` → 400. [packages/schemas/src/moderation/survey-moderation.schema.ts:49]
- [x] [Review][Patch] Admin dashboard: escrow quote vs held amount, funding warning and invalid-targeting badge (P2 UI + P6 badge, medium/low) — fixed: the list shows "Chi phí ký quỹ {n} điểm" (a quote, no longer "Ký quỹ đã khoá"); the preview shows the quote plus "Ký quỹ đang giữ: {escrowHeld} điểm"; when `fundingShortfall > 0` an amber `role="alert"` panel explains the shortfall and Approve is disabled with an `aria-describedby` reason; a "Tiêu chí nhắm mục tiêu không hợp lệ" badge appears in the list and preview when `targetingInvalid`, and Approve is disabled for it too (the backend would answer 422). [apps/frontend/my-app/app/admin/moderation/page.tsx:297]
- [x] [Review][Patch] The Admin page showed "empty queue" after deciding the last item on a later page (P8, low) — fixed: pure helper `clampQueueOffset(offset, total, pageSize)` in the new `moderation-view.ts`; the load effect moves back to the last valid page when a later page comes back empty while `total > 0`. Test: `tests/moderation-view.test.mjs`. [apps/frontend/my-app/app/admin/moderation/page.tsx:77]
- [x] [Review][Patch] Admin error states showed raw English backend/network messages (P9, low) — fixed: `describeError` moved to the testable `describeModerationError(error, fallback)`; the default returns the Vietnamese fallback, never `error.message`; new mappings for `MODERATION_ADMIN_CAPABILITY_REQUIRED`, `MODERATION_INVALID_REQUEST` / `VALIDATION_ERROR`, `FORM_NOT_FOUND`, `MODERATION_ESCROW_NOT_FUNDED` (with `details.shortfall`), `FORM_VALIDATION_ERROR` / `EXTERNAL_COMPLETION_CODE_REQUIRED` and a network `TypeError` ("Không thể kết nối máy chủ"); the English fallbacks in `moderation-api.ts` are Vietnamese now. Test: `tests/moderation-view.test.mjs` (+ `moderation-api.test.mjs` updated). [apps/frontend/my-app/app/admin/moderation/moderation-view.ts:34]
- [x] [Review][Patch] Append-only moderation audit rows were declared `ON DELETE CASCADE`; the refund-key column comment was stale (P13, low) — fixed: `onDelete: Restrict` on both `SurveyModerationDecision` relations and `ON DELETE RESTRICT` in the uncommitted, drift-tolerant migration `20260926150000_survey_moderation_decisions` (edited in place; no new migration), comment → `close-refund:{formId}:c{closeCount}`; `prisma validate` + `prisma generate` OK. Not reachable today (decided forms are never DRAFT-deletable); hardening against a future delete path erasing audits. [apps/backend/prisma/schema.prisma:822]
- [x] [Review][Patch] Story 8.1 contract text was stale after Epic 6 P3/P4 (P14, low) — fixed: AC1.5, AC2 (new item 3), AC4.3 and AC5.2 plus the Dev Notes "Idempotency keys" / "Rejection refund" now state the `close-refund:{formId}:c{closeCount}` key, the journal-based refund `reserved − refunded − consumed − owed`, the shortfall-only re-publication and the P1/P2 rules; the `deferred-work.md` over-reservation item was already marked resolved by the Epic 6 review and the legacy `ESCROW_LOCKED` item now describes the fail-closed path; `LedgerService.getEscrowReservation` is kept and documented as a read-only diagnostic (tests/operators only). [apps/backend/src/modules/economy/application/ledger.service.ts:687]
- [x] [Review][Defer] Queue FIFO order and `submittedAt` come from the mutable `Form.updatedAt`; items and total are two unsnapshotted queries (DF2, low) [apps/backend/src/modules/moderation/application/survey-moderation.service.ts:473] — deferred: same root cause as Epic 4 DF7 (the rotation bump is the autosave concurrency token) and the moderation SLA item (OQ22 / SM-C1); persist `queued_at` on the MODERATION_QUEUE transition when SLA work lands.
- [x] [Review][Defer] The queue API uses offset instead of cursor pagination (DF3, low) [packages/schemas/src/moderation/survey-moderation.schema.ts:38] — deferred: AC3.2 prescribes limit/offset; same deviation and decision as Epic 4 DN1 (B); record it in the spine deviation list and revisit with the Admin portal.
- [x] [Review][Defer] Concurrent approve/reject, Unit-of-Work rollback, the conditional `updatedAt` update and P2002 inside the ambient transaction never run against PostgreSQL (DF4, medium; shared with Story 8.2) [apps/backend/test/survey-moderation.e2e-spec.ts] — deferred: needs the Postgres test container (Epic 6 DF5, Epic 5 DF5); add P2's funding checks and P3's advisory lock to that suite.
- [x] [Review][Defer] A queued survey of a LOCKED publisher can be approved (DF7, low) [apps/backend/src/modules/moderation/application/survey-moderation.service.ts:313] — deferred: no product rule exists; live surveys of LOCKED publishers also stay on the Marketplace; decide with the account-suspension policy (Admin user management, Phase 2).

## Dev Notes

### Current state (read before changing)
- **Lifecycle today** (`form-publish.schema.ts`): `determinePublishTargetStatus` → `ESCROW_LOCKED` for External/rewarded, `PUBLISHED` for free Internal. Nothing ever moves a form into `MODERATION_QUEUE`; `ESCROW_LOCKED` forms never go live (Marketplace `findPublishedForms` and `startAttempt` only accept `PUBLISHED` + `currentVersion.isPublished`). The publisher can also send `targetStatus: 'PUBLISHED'` to `/publish` (table allows `DRAFT → PUBLISHED`) — a moderation bypass that must close.
- **`FormsService.publishForm`**: validates `formDefinitionSchema` (≥1 block), external URL, then `escrowCoordinator.coordinatePublish` (Ledger `reserveEscrow`, key `publish:{formVersionId}`) **before** `formRepository.update(... expectation {status: DRAFT, updatedAt})` — not atomic today (no UoW). `closeForm` updates first, then `coordinateClose` — also not atomic. `transitionStatus` (Admin generic `POST /forms/:id/status`) can move any form along the table without refunds or audit.
- **`createExternalSurvey(autoPublish)`** creates the form directly in `determinePublishTargetStatus()` status **without reserving Escrow** (the frontend wizard defaults `autoPublish: true`). With a queue that leads to approvable unfunded surveys and to close refunds that drain other surveys' Escrow (the Escrow account is per user, not per form).
- **Escrow**: one `ESCROW` account per user. `reserveEscrow` (`publish:{versionId}`), `refundUnusedEscrow` (`close-refund:{formId}:{closeVersion}`, capped at the Escrow balance), `reopenEscrow` (`reopen-escrow:{formId}:{n}`). Re-publishing a new version reserves the full cost again (pre-existing Story 2.7/6.3 interaction; see Deferred).
- **Versioning (2.7)**: `POST /forms/:id/versions` (PUBLISHED only) → form `DRAFT`, new unpublished version; earlier versions keep `isPublished = true`. `currentVersion` = highest `versionNumber`. `rotateCompletionCode` creates a new version keeping the form status and `isPublished` of the current version.
- **Participation / Marketplace / public forms** gate on `form.status === 'PUBLISHED'` and (participation) `currentVersion.isPublished`. They need no change: queued forms are invisible/unstartable automatically.
- **Story 6.6 pattern to mirror**: `TopUpService` (`UnitOfWorkPort.run(key)`, `AdminCapabilityPort.findCurrentCapability` inside the UoW, self-review guard, conditional transition + Outbox in one repository call, lost-transition resolution, post-commit notifications, `X-Correlation-Id` honoured when UUID), `AdminTopUpController` (guards/prefixes), `PrismaTopUpRepository.saveReviewDecision` (Outbox insert shape), `InMemoryAdminCapabilityRepository` (e2e override).
- **Unit of Work**: `UNIT_OF_WORK_PORT` (global `PrismaModule`) → `PrismaUnitOfWork` → `runInTransaction`. Prisma repositories only join it when they call `runInTransaction(this.prisma, tx => …)`; `PrismaFormRepository` currently calls `this.prisma.$transaction` directly → switch `create`/`update`/`createVersion` to `runInTransaction` (identical behaviour without an ambient transaction). `PrismaLedgerRepository.postJournalTransaction` already joins.

### Design decisions
- **One persisted queue state.** Escrow reservation and queue entry happen in one transaction, so `ESCROW_LOCKED` is never observable for new publications; it stays in the enum/table only for legacy rows (Admin can still move a legacy `ESCROW_LOCKED` form into the queue or close it). No data migration of existing rows (legacy `ESCROW_LOCKED` forms created by `autoPublish` have no reservation; silently queueing them could publish unfunded surveys).
- **Free Internal surveys are moderated too** (FR-20: "external or internal").
- **Queued version is not published** (`isPublished=false`, `publishedAt=null`): keeps every existing "is it live?" check correct without new code, and `publishedAt` becomes the go-live (approval) time used by Marketplace sorting.
- **Admin decides on an exact version** (`formVersionId` in the body): a completion-code rotation or other version change between preview and decision yields `409 MODERATION_VERSION_MISMATCH` (AD-19 exact-version rule).
- **Ownership (AD-16)**: Moderation owns `SurveyModerationDecision` + the admin-audit Outbox event; Research owns the Form transition (`FormModerationCommands` in `forms/application`, exported by `FormsModule`); Economy owns the refund journal and the reservation query. The Moderation coordinator invokes owner-provided commands under one `UnitOfWorkPort` token; each owner writes only its own tables. Publisher email comes from Identity's `USER_REPOSITORY_PORT` (read-only) through a Moderation `PublisherDirectoryPort`.
- **Idempotency keys**: UoW + notification dedupe `moderation:{formVersionId}`; refund `close-refund:{formId}:c{closeCount}` (the architecture's `{closeVersion}`; Epic 6 review P3 replaced the original `{versionNumber}`, which repeated across close/reopen cycles); audit `admin-audit:moderation:{formVersionId}`; decision unique per `formVersionId` (DB backstop).
- **Self-moderation forbidden** (mirrors 6.6 self-approval rule; four-eyes on marketplace content).
- **Rejection refund** = everything the form still holds in Escrow, from its own journals: `reserved − refunded − consumed − owed` (Epic 6 review P4; this replaced "reservation of never-live versions + unused quota of an earlier live version"). The pooled-balance cap remains a safety net.
- **Funding and validity at approval (code review 2026-09-26, P2):** approval (and the legacy `ESCROW_LOCKED → MODERATION_QUEUE` move) never trusts how a survey entered the queue — the stored version must pass `assertFormPublishable` (shared with `publishForm`) and `FormsEscrowCoordinator.getFundingPosition` must report no shortfall. An Admin never reserves on the Publisher's behalf (Epic 6 review P13).
- **Admin UI**: built as a minimal live-API page. Rationale: it is this story's primary AC ("appears in the Admin Moderation Dashboard … Admin can preview … click Approve/Reject"), it follows the existing live-API Publisher pages (`/forms`, `/forms/[id]/edit`) rather than the mock respondent journey, it is not linked from the mock `PortalShell` navigation, and authorization stays server-side (`RolesGuard` + live capability). The full Admin portal (navigation, users, complaints, top-ups, FraudLog) remains deferred.

### Guardrails
- Clean Architecture: nothing under `modules/*/domain|application` imports `@nestjs/*`, `@prisma/client`, `express`, or "adapter". Wire in `moderation.module.ts` with `useFactory`.
- Controllers: class-level `SessionAuthGuard` + `RolesGuard` + `@Roles('ADMIN')`; mutations add `CsrfGuard` + `JsonOnlyGuard`; `ParseUUIDPipe`; `ZodValidationPipe`; `createSuccessEnvelope`; routes `['admin/moderation/surveys', 'api/admin/moderation/surveys']`.
- Domain exceptions carry `code`, mapped in `http-exception.filter.ts`.
- Notifications only after commit, never throwing (`NOTIFICATION_PUBLISHER_PORT` optional injection).
- FraudLog is NOT used (moderation decisions are not abuse evidence).
- No new npm dependencies.

### Testing standards
- Backend unit: Jest, in-memory adapters + `PassThroughUnitOfWork`; Prisma adapters with mocked transaction clients (see `prisma-top-up.repository.spec.ts`).
- e2e: boot `AppModule`, mock `PrismaService` (`$transaction: cb => cb(mockPrisma)`), override `USER_REPOSITORY_PORT`, `SESSION_REPOSITORY_PORT`, `IDENTITY_AUDIT_PORT`, `FORM_REPOSITORY_PORT`, `LEDGER_REPOSITORY_PORT`, `NOTIFICATION_REPOSITORY_PORT`, `ADMIN_CAPABILITY_PORT`, `SURVEY_MODERATION_REPOSITORY_PORT`, and (for specs whose mock Prisma has no `$transaction`) `UNIT_OF_WORK_PORT` with `PassThroughUnitOfWork`. CSRF requests send `x-csrf-token` + `Origin: http://localhost:3000`.
- Frontend: `node --test tests/*.test.mjs`, typecheck, lint.

### Project Structure Notes
- New: `apps/backend/src/modules/moderation/{moderation.module.ts, application/{survey-moderation.service.ts, exceptions/, ports/}, domain/, infrastructure/, presentation/}`; `apps/backend/src/modules/forms/application/form-moderation.commands.ts`; `packages/schemas/src/moderation/`; `apps/frontend/my-app/app/admin/moderation/`; `apps/frontend/my-app/app/forms/form-status.ts`.
- Architecture target lists `modules/moderation/` — this story creates it.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.1]
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#FR-20, FR-53, UJ-1 step 8, UJ-3 resolution]
- [Source: ARCHITECTURE-SPINE.md#AD-16, #AD-19, Ownership Map (Moderation row), Cross-Context Financial Workflow Map (Publish+Escrow, Close Form/refund, Approve manual top-up)]
- [Source: _bmad-output/implementation-artifacts/6-6-point-top-up-request-admin-approval.md#Dev Notes]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Admin portal]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5) — unattended BMAD sprint run (bmad-create-story → bmad-dev-story).

### Implementation Plan

1. Contracts first: rewrite the authoritative transition table (`DRAFT → MODERATION_QUEUE` only; `ESCROW_LOCKED` legacy-only; no path to `PUBLISHED` except from the queue) and add the moderation schemas (queue/preview/decision/result/audit payload, `surveyModerationKey`).
2. Research/Economy: publish, auto-publish, close and reopen run under the shared Unit of Work (`publish:{versionId}`, `close-refund:{formId}:{n}`, `reopen-escrow:{formId}:{n}`); `PrismaFormRepository` joins the ambient transaction; `coordinateClose` refunds exactly the reservation (`LedgerService.getEscrowReservation`) for never-live versions; `FormModerationCommands` exposes the conditional `MODERATION_QUEUE → PUBLISHED | CLOSED` transitions.
3. Moderation bounded context (new module): `SurveyModerationService` coordinator mirroring Story 6.6 (live capability, self-review guard, replay/conflict/lost-race resolution, decision + Outbox audit event in the same Unit of Work, post-commit notifications), Prisma/in-memory decision repositories, Admin controller.
4. Tests at every layer, then the e2e suites affected by the new publish target, then frontend (status labels, queued banner, typed client, Admin dashboard page).

### Debug Log References

- Full `verify.sh` #1: backend e2e 1 failure — `socket hang up` on the first request of the new `survey-moderation.e2e-spec.ts` (other 25 suites green). Re-ran the suite in isolation 5× (11/11 each time) and the whole e2e suite (26/26), then `verify.sh` #2: OVERALL PASS. Consistent with the known supertest ephemeral-port flake on this machine.
- `test/architecture.spec.ts` flagged the word "adapter" in a comment of `survey-moderation.service.ts`; comment reworded.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Lifecycle (AC1):** every publish (Internal/External, free/rewarded, first version or re-publication) reserves Escrow and enters `MODERATION_QUEUE` atomically; the queued version stays `isPublished=false`/`publishedAt=null`, so it is invisible in the Marketplace, not startable, not served publicly and immutable. Approval sets `isPublished=true`, `publishedAt=approvedAt`. Publisher-requested `targetStatus` other than `MODERATION_QUEUE` → 400. `POST /forms/external` with `autoPublish` now reserves Escrow in the same Unit of Work (previously it created an unfunded `ESCROW_LOCKED` form). The generic Admin `POST /forms/:id/status` refuses to move a queued form (`409 FORM_MODERATION_REQUIRED`) and delegates `CLOSED` to the refunding close path. Reopen requires an approved current version (`409 FORM_NOT_REOPENABLE`).
- **Escrow (AC2):** close/reject of a never-live version refunds exactly what was reserved for the form's never-live versions (+ unused quota of an earlier live version for re-publications), key `close-refund:{formId}:{versionNumber}`, capped at the Escrow balance — a legacy unfunded version can no longer drain another survey's Escrow.
- **Moderation (AC3–AC5):** new `moderation` module. `GET /admin/moderation/surveys` (FIFO queue with publisher email, reward, quota, escrow, effort, block count, external URL, targeting, re-submission flag), `GET …/:formId` (preview incl. Form Definition + decision), `POST …/:formId/approve` (`{formVersionId, note?}`), `POST …/:formId/reject` (`{formVersionId, reason 5–500}`); all under `/api` too; `SessionAuthGuard`+`RolesGuard('ADMIN')`, CSRF+JSON-only on decisions, `X-Correlation-Id` honoured when UUID. Decisions run under `moderation:{formVersionId}` with the live Admin capability (`ADMIN_CAPABILITY_PORT` from 6.6), self-moderation forbidden, exact-version check, idempotent replay, opposite decision → `409 MODERATION_ALREADY_DECIDED`, concurrent approve+reject → exactly one wins (conditional transition + unique decision per version). `SurveyModerationDecision` row + `AdminSurveyApproved/Rejected` Outbox event (`admin-audit:moderation:{formVersionId}`) commit with the transition/refund; `SURVEY_APPROVED`/`SURVEY_REJECTED` (reason + refunded points) are published after commit.
- **Frontend (AC6) — decision:** built the minimal Admin Moderation Dashboard at `/admin/moderation` as a live-API page because (a) it is this story's primary AC, (b) it follows the existing live-API Publisher pages (`/forms`, `/forms/[id]/edit`) rather than the mock respondent journey the human-owned spec governs, (c) it is not linked from the mock shell and adds no Admin portal navigation, and (d) authorization stays server-side. It has queue list (loading/empty/error/401/403), pagination, preview (metadata, escrow, targeting, external link, read-only `FormRenderer` for Internal forms), approve (optional note) and reject (validated reason, counter) with busy states and Vietnamese copy. Publisher pages show "Chờ kiểm duyệt" badges, a queued banner, moderation-aware publish modal/notification copy and "Gửi kiểm duyệt ngay" on the External wizard. Typed client `moderation-api.ts` + `form-status.ts` are covered by `tests/moderation-api.test.mjs`. No manual browser QA (backend/Postgres not running); typecheck, lint and `next build` pass.
- **Existing tests updated deliberately:** `forms-publish`, `forms-versioning`, `forms-escrow` e2e now publish → approve through the real moderation endpoint (overriding `UNIT_OF_WORK_PORT` where the mock Prisma has no `$transaction`, plus `ADMIN_CAPABILITY_PORT`, `SURVEY_MODERATION_REPOSITORY_PORT`, `NOTIFICATION_REPOSITORY_PORT`); unit specs (forms service/controller/schema, participation mock) updated the same way. Other suites seed `PUBLISHED` forms directly and were unaffected.
- **Prisma:** enum `SurveyModerationOutcome`, model `SurveyModerationDecision` (+ back-relations on `Form`, `FormVersion`, `User`), hand-written drift-tolerant migration `20260926150000_survey_moderation_decisions` (FKs to `forms`/`form_versions` only when those tables exist, since no migration creates them). `prisma validate` + `prisma generate` OK. `npx prisma format` normalised whitespace in the schema file.
- **Verification (final `verify.sh`, OVERALL PASS):** schemas 203 (+10), backend unit 900 (+71), backend e2e 232 passed / 3 skipped in 26 suites (+13 tests, +1 suite), frontend 89 (+8), typecheck + lint clean.
- Deferred/open items appended to `deferred-work.md` (Admin portal shell, Outbox consumer, pre-existing re-publication escrow over-reservation, legacy ESCROW_LOCKED rows, publisher withdraw UI, single-admin self-moderation PO question, moderation SLA, Postgres-gated tests).
- Code review 2026-09-26: applied patches P1 (Admin `/close` of someone else's queued survey → 409 `FORM_MODERATION_REQUIRED`), P2 (approval and the legacy `ESCROW_LOCKED → MODERATION_QUEUE` move re-run the publish validations via the new `assertFormPublishable` and require full Escrow funding via `FormsEscrowCoordinator.getFundingPosition` → 409 `MODERATION_ESCROW_NOT_FUNDED`; preview `escrowHeld` / `fundingShortfall`; dashboard shows the quote, the held amount and a funding warning that disables Approve), P5 (`currentClient` decision lookup), P6 (malformed stored targeting/effort flagged instead of breaking the queue; `targetingInvalid` badge), P7 (`offset` ≤ 10 000), P8 (`clampQueueOffset`), P9 (Vietnamese `describeModerationError`), P13 (`ON DELETE RESTRICT` on decision rows; migration edited in place) and P14 (AC/Dev Notes aligned with Epic 6 P3/P4). Four decisions stay open (E8-D1, E8-D2, E8-D3, E8-D5 — see Review Findings); 4 defers recorded in `deferred-work.md`. Verification: `verify.sh` OVERALL PASS — schemas 366, backend unit 1364 (96 suites), backend e2e 284 passed / 3 skipped (30 suites), frontend 216, typecheck + lint clean; `prisma validate` OK. Status → in-progress (open decisions).

### File List

New:
- `packages/schemas/src/moderation/index.ts`
- `packages/schemas/src/moderation/survey-moderation.schema.ts`
- `packages/schemas/src/moderation/survey-moderation.schema.spec.ts`
- `apps/backend/prisma/migrations/20260926150000_survey_moderation_decisions/migration.sql`
- `apps/backend/src/modules/forms/application/form-moderation.commands.ts`
- `apps/backend/src/modules/forms/application/form-moderation.commands.spec.ts`
- `apps/backend/src/modules/moderation/moderation.module.ts`
- `apps/backend/src/modules/moderation/domain/survey-moderation-decision.entity.ts`
- `apps/backend/src/modules/moderation/application/survey-moderation.service.ts`
- `apps/backend/src/modules/moderation/application/survey-moderation.service.spec.ts`
- `apps/backend/src/modules/moderation/application/exceptions/moderation.exceptions.ts`
- `apps/backend/src/modules/moderation/application/ports/survey-moderation-repository.port.ts`
- `apps/backend/src/modules/moderation/application/ports/publisher-directory.port.ts`
- `apps/backend/src/modules/moderation/infrastructure/prisma-survey-moderation.repository.ts`
- `apps/backend/src/modules/moderation/infrastructure/in-memory-survey-moderation.repository.ts`
- `apps/backend/src/modules/moderation/infrastructure/user-publisher-directory.ts`
- `apps/backend/src/modules/moderation/infrastructure/survey-moderation.repositories.spec.ts`
- `apps/backend/src/modules/moderation/presentation/admin-moderation.controller.ts`
- `apps/backend/src/modules/moderation/presentation/admin-moderation.controller.spec.ts`
- `apps/backend/test/survey-moderation.e2e-spec.ts`
- `apps/frontend/my-app/app/admin/moderation/moderation-api.ts`
- `apps/frontend/my-app/app/admin/moderation/page.tsx`
- `apps/frontend/my-app/app/forms/form-status.ts`
- `apps/frontend/my-app/tests/moderation-api.test.mjs`

Modified:
- `packages/schemas/src/index.ts`
- `packages/schemas/src/forms/form-publish.schema.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/src/common/http/http-exception.filter.spec.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts`
- `apps/backend/src/modules/economy/application/ledger.service.spec.ts`
- `apps/backend/src/modules/forms/forms.module.ts`
- `apps/backend/src/modules/forms/application/forms.service.ts`
- `apps/backend/src/modules/forms/application/forms.service.spec.ts`
- `apps/backend/src/modules/forms/application/forms-escrow.coordinator.ts`
- `apps/backend/src/modules/forms/application/forms-escrow.coordinator.spec.ts`
- `apps/backend/src/modules/forms/application/exceptions/form.exceptions.ts`
- `apps/backend/src/modules/forms/application/ports/form-repository.port.ts`
- `apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts`
- `apps/backend/src/modules/forms/infrastructure/prisma-form.repository.spec.ts`
- `apps/backend/src/modules/forms/infrastructure/in-memory-form.repository.ts`
- `apps/backend/src/modules/forms/presentation/forms.controller.spec.ts`
- `apps/backend/src/modules/forms/presentation/form-publish.schema.spec.ts`
- `apps/backend/src/modules/participation/application/participation.service.spec.ts`
- `apps/backend/test/forms-publish.e2e-spec.ts`
- `apps/backend/test/forms-versioning.e2e-spec.ts`
- `apps/backend/test/forms-escrow.e2e-spec.ts`
- `apps/frontend/my-app/app/forms/page.tsx`
- `apps/frontend/my-app/app/forms/[id]/edit/page.tsx`
- `apps/frontend/my-app/app/forms/[id]/edit/PublishConfirmationModal.tsx`
- `apps/frontend/my-app/app/forms/components/CreateExternalSurveyModal.tsx`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

Code review 2026-09-26 (new):
- `apps/backend/src/modules/forms/application/form-publishability.ts`
- `apps/frontend/my-app/app/admin/moderation/moderation-view.ts`
- `apps/frontend/my-app/tests/moderation-view.test.mjs`

Code review 2026-09-26 (modified):
- `packages/schemas/src/moderation/survey-moderation.schema.ts`, `survey-moderation.schema.spec.ts`
- `apps/backend/prisma/schema.prisma`, `apps/backend/prisma/migrations/20260926150000_survey_moderation_decisions/migration.sql`
- `apps/backend/src/common/http/http-exception.filter.ts`, `http-exception.filter.spec.ts`
- `apps/backend/src/modules/economy/application/ledger.service.ts` (doc comment only)
- `apps/backend/src/modules/forms/application/forms.service.ts`, `forms.service.spec.ts`, `forms-escrow.coordinator.ts`, `form-moderation.commands.ts`, `form-moderation.commands.spec.ts`, `exceptions/form.exceptions.ts`
- `apps/backend/src/modules/forms/presentation/forms.controller.spec.ts`
- `apps/backend/src/modules/moderation/application/survey-moderation.service.ts`, `survey-moderation.service.spec.ts`
- `apps/backend/src/modules/moderation/infrastructure/prisma-survey-moderation.repository.ts`, `survey-moderation.repositories.spec.ts`
- `apps/backend/test/survey-moderation.e2e-spec.ts`
- `apps/frontend/my-app/app/admin/moderation/page.tsx`, `moderation-api.ts`, `tests/moderation-api.test.mjs`
- `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`

Decision follow-up 2026-09-26 (Batch C2: E8-D1, E8-D2, E8-D3, E8-D5):
- New: `apps/backend/prisma/migrations/20260927020000_form_close_kind/migration.sql`, `apps/frontend/my-app/app/marketplace/participation-submit-api.ts` (E8-D5, see Story 8.2)
- Modified: `packages/schemas/src/forms/form-publish.schema.ts` (`formCloseKindEnum`, `isOwnerReopenableClose`, sign-off doc), `packages/schemas/src/forms/form-draft.schema.ts` (`FormDetailDto.closeKind`); `apps/backend/prisma/schema.prisma` (`FormCloseKind`, `Form.closeKind`); `apps/backend/src/modules/forms/domain/form.entity.ts`; `apps/backend/src/modules/forms/application/forms.service.ts`, `forms.service.spec.ts`, `form-moderation.commands.ts`, `form-moderation.commands.spec.ts`, `exceptions/form.exceptions.ts`; `apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts`, `prisma-form.repository.spec.ts`; `apps/backend/src/modules/forms/presentation/form-publish.schema.spec.ts`; `apps/backend/src/common/http/http-exception.filter.ts`, `http-exception.filter.spec.ts`; `apps/backend/src/modules/moderation/application/survey-moderation.service.ts`, `survey-moderation.service.spec.ts`; `apps/backend/test/survey-moderation.e2e-spec.ts`; `apps/backend/.env.example`, `apps/backend/README.md`; `apps/frontend/my-app/app/admin/moderation/page.tsx`, `moderation-view.ts`, `apps/frontend/my-app/tests/moderation-view.test.mjs`
- Docs: `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` (E8-D1 sign-off note), `_bmad-output/implementation-artifacts/spec-mock-respondent-journey.md` (Change Log), `deferred-work.md`, `sprint-status.yaml`, `code-review-decisions-2026-09-26.md`

### Change Log

- 2026-09-26: Implemented Story 8.1 — moderation-first Form lifecycle (every publish reserves Escrow and waits in `MODERATION_QUEUE`), atomic publish/close/reopen Units of Work, reservation-exact refunds for never-live versions, new Moderation module (queue, preview, approve, reject with refund, live Admin capability, audit Outbox event, notifications), `SurveyModerationDecision` persistence + migration, Admin Moderation Dashboard page + typed client, Publisher "Chờ kiểm duyệt" state, tests at every layer. Status → review.
- 2026-09-26: Code review 2026-09-26: Review Findings written (4 decisions, 10 patch items covering P1/P2/P5–P9/P13/P14, 4 defers; 9 dismissed across the epic); every patch applied with tests (moderation-only exit from the queue, funding + publish validity at approval and legacy queue entry, preview held/shortfall, ambient-client decision read, fail-soft queue rows, bounded offset, dashboard paging/error copy, RESTRICT audit FKs, contract text). Status → in-progress (decisions E8-D1/D2/D3/D5 open).
- 2026-09-26: Decision follow-up 2026-09-26: E8-D1 (B), E8-D2 (A), E8-D3 (A) and E8-D5 (A page / B adapter) accepted by Quan (Batch C2) — transition table signed off with an exhaustive contract test and a spine amendment note; `Form.closeKind` (OWNER/ADMIN/MODERATION, migration `20260927020000_form_close_kind`) makes Admin takedowns and rejections final (reopen → 409 `FORM_NOT_REOPENABLE` with the reason); explicit re-submission rejection warnings in the Admin dashboard and the `SURVEY_REJECTED` notice (option C deferred to Phase 2 with E5-D4); two-Admin ops requirement documented; Admin page accepted in the mock spec, 8.2 adapter additions moved out. AC1.6, AC5.3 and AC6.2 amended. No decision or patch items remain open. Status → done.
