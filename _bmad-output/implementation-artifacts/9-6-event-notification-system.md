---
baseline_commit: 378e4a71ff125fb1acf6ee18291fc298ae56bf94
context:
  - "_bmad-output/planning-artifacts/epics.md#Story 9.6"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#4.18 Notification System (FR-57)"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md (Notifications context row, AD-5, AD-7, AD-10)"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md#12. Module Ownership"
  - "_bmad-output/implementation-artifacts/6-5-frozen-starter-points-lifecycle.md"
  - "_bmad-output/implementation-artifacts/spec-mock-respondent-journey.md"
  - "apps/backend/src/modules/economy/application/starter-points.coordinator.ts"
  - "apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts"
  - "apps/backend/src/modules/participation/application/participation.service.ts"
  - "apps/frontend/my-app/components/layout/PortalShell.tsx"
  - "apps/frontend/my-app/lib/mock/repository.ts"
---

# Story 9.6: Event Notification System

Status: done

## Story

As a User,
I want to receive notifications for important account events,
so that I know when my surveys are approved, points are released, or top-ups succeed.

## Acceptance Criteria

Epic source (FR-57): **Given** a system event (e.g., 48h pending points released, Top-up approved) **When** the event occurs **Then** an in-app notification record is created for the target user **And** a notification badge appears in the user's header navigation **And** the user can click to view a list of recent unread notifications.

This story is delivered BEFORE Story 6.6 (top-up approval) and Story 8.1 (survey moderation approve/reject). It therefore ships a reusable Notifications capability (publisher port) that those stories call; it hooks up only the producers that already exist today.

### AC1 — Shared notification contracts (`packages/schemas/src/notifications`, FR-57, NFR-18)
1. `notification.schema.ts` exports:
   - `NOTIFICATION_TYPES` / `notificationTypeSchema` / `NotificationType`: `SURVEY_APPROVED`, `SURVEY_REJECTED`, `ESCROW_RELEASED`, `TOPUP_SUCCESS`, `REWARD_EARNED`, `REWARD_PENDING`, `REWARD_RELEASED`, `ACCOUNT_ACTIVATED`, `WARNING` (must equal the Prisma `NotificationType` enum, same order — asserted against the generated `$Enums` by `notification-type.parity.spec.ts`). _Decision E9-D2 (2026-09-26, option A): `REWARD_EARNED` added for FR-57 "Points earned"._
   - Constants `NOTIFICATION_LIST_DEFAULT_LIMIT = 20`, `NOTIFICATION_LIST_MAX_LIMIT = 50`, `NOTIFICATION_MESSAGE_MAX_LENGTH = 500`, `NOTIFICATION_DEDUPE_KEY_MAX_LENGTH = 200`.
   - `notificationSchema` / `NotificationDto`: `{ id: uuid, type, message, isRead: boolean, createdAt: datetime, readAt: datetime | null }` (no `userId`: the list is always the caller's own).
   - `listNotificationsQuerySchema` / `ListNotificationsQuery`: query-string tolerant — `limit` (coerced int 1..50, default 20), `offset` (coerced int 0..`NOTIFICATION_LIST_MAX_OFFSET` = 10 000, default 0 — _code review 2026-09-26 P10: a larger value is a 400, not a 500_), `unreadOnly` (`true`/`false` string or boolean, default `false`); unknown keys rejected.
   - `notificationListSchema` / `NotificationListDto`: `{ items: NotificationDto[], unreadCount, total, limit, offset, hasMore }`.
   - `notificationUnreadCountSchema` / `NotificationUnreadCountDto`: `{ unreadCount }`.
   - `markNotificationReadResultSchema` / `MarkNotificationReadResultDto`: `{ notification: NotificationDto, unreadCount }`.
   - `markAllNotificationsReadResultSchema` / `MarkAllNotificationsReadResultDto`: `{ updatedCount, unreadCount }`.
   - `publishNotificationCommandSchema` / `PublishNotificationCommand`: `{ userId: uuid, type, message: trimmed 1..500, dedupeKey: trimmed 1..200 }`. _Code review 2026-09-26 (P9):_ lone UTF-16 surrogates in `message` are replaced with U+FFFD (shared `replaceLoneSurrogates`), and producers truncate with the pair-safe `truncateText`.
2. Exported from `packages/schemas/src/notifications/index.ts` and the package root `src/index.ts`; unit tests in `notification.schema.spec.ts`.

### AC2 — Persistence (`apps/backend/prisma`, FR-57, NFR-25, AD-10)
1. `NotificationType` enum gains `SURVEY_REJECTED`, `REWARD_PENDING`, `REWARD_RELEASED`, `ACCOUNT_ACTIVATED` (Phase 1 events with no truthful existing value — see Dev Notes "Enum decision"). _Decision E9-D2 (2026-09-26):_ plus `REWARD_EARNED` (before `REWARD_PENDING`), added by the drift-tolerant migration `20260927030000_notification_reward_earned` (guarded `CREATE TYPE` with the full shape, else `ALTER TYPE … ADD VALUE IF NOT EXISTS 'REWARD_EARNED' BEFORE 'REWARD_PENDING'`).
2. `Notification` model gains `dedupeKey String? @map("dedupe_key")`, `readAt DateTime? @map("read_at")`, `@@unique([userId, dedupeKey])`, `@@index([userId, createdAt])`, `@@index([userId, isRead])`.
3. Hand-written, re-runnable migration `apps/backend/prisma/migrations/20260926090000_event_notifications/migration.sql` that works both when the `notifications` table/enum already exist (created by `db push`, since no earlier migration creates them) and when they do not: `CREATE TYPE` guarded by `duplicate_object`, `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, drop/re-add FK to `users` with `ON DELETE CASCADE`.
4. `npm run prisma:validate --workspace backend` and `npx prisma generate` succeed.

### AC3 — Notifications module (`apps/backend/src/modules/notifications`, AD-7, Notifications context ownership)
1. Domain `NotificationEntity` (id, userId, type, message, isRead, readAt, dedupeKey, createdAt) with `toDto()`.
2. Ports in `application/ports`:
   - `NOTIFICATION_REPOSITORY_PORT` / `NotificationRepositoryPort`: `createIfAbsent(input) → boolean` (idempotent on `(userId, dedupeKey)`), `listForUser(userId, { limit, offset, unreadOnly })`, `countForUser(userId, { unreadOnly })`, `markRead(userId, id, readAt)`, `markAllRead(userId, readAt) → number`. (_Code review 2026-09-26 P13:_ the planned `findByIdForUser` was dropped — mark-read returns the owned row itself.)
   - `NOTIFICATION_PUBLISHER_PORT` / `NotificationPublisherPort`: `publish(command) → Promise<'CREATED' | 'DUPLICATE' | 'FAILED'>` — the ONLY dependency other contexts take. Contract: idempotent by `(userId, dedupeKey)`, never throws, and callers invoke it only after their source transaction has committed (a notification failure can never roll back or fail the source workflow — ARCHITECTURE-SPINE Notifications row).
3. `NotificationsService` (framework-free) implements the publisher port plus the read-side use cases: `list`, `getUnreadCount`, `markRead` (ownership enforced — another user's or unknown id → `NotificationNotFoundException`, code `NOTIFICATION_NOT_FOUND`; already-read is an idempotent success that keeps the original `readAt`), `markAllRead`.
   - `publish` validates with `publishNotificationCommandSchema`; invalid commands and repository errors return `FAILED` and are reported through an injected `NotificationFailureLogger` (Nest `Logger` wired in the module).
4. Adapters: `PrismaNotificationRepository` (`createMany({ skipDuplicates: true })` → `INSERT … ON CONFLICT DO NOTHING`, owner-scoped `where` on every query, NEVER joins the ambient Unit-of-Work transaction) and `InMemoryNotificationRepository` (tests / e2e overrides).
5. `NotificationsModule` is `@Global()`, imports `PrismaModule` + `AuthModule`, exports `NOTIFICATION_PUBLISHER_PORT` only, and is registered in `AppModule`. (_Code review 2026-09-26 P11:_ the repository port and `NotificationsService` stay private to the context — AC3.2 / AD-16; `test/architecture.spec.ts` forbids importing them from other modules.)
6. `NotificationNotFoundException` maps to HTTP 404 in `http-exception.filter.ts`.

### AC4 — Authenticated endpoints (`NotificationsController`, route `['notifications', 'api/notifications']`)
1. Class-level `@UseGuards(SessionAuthGuard)`; every route acts only on `@CurrentUser()`'s notifications.
2. `GET /notifications?limit&offset&unreadOnly` → `NotificationListDto` (newest first; `unreadCount` always counts all unread, independent of paging/filter). Invalid query → 400 `VALIDATION_ERROR`.
3. `GET /notifications/unread-count` → `{ unreadCount }` (cheap badge refresh).
4. `PATCH /notifications/:id/read` (`CsrfGuard`, `ParseUUIDPipe`) → `MarkNotificationReadResultDto`; unknown / not-owned → 404 `NOTIFICATION_NOT_FOUND`.
5. `PATCH /notifications/read-all` (`CsrfGuard`) → `MarkAllNotificationsReadResultDto`.
6. Responses use `createSuccessEnvelope`; unauthenticated → 401; missing CSRF → 403.

### AC5 — Existing producers emit notifications (FR-57, AD-16)
1. **48h pending release** — `RewardSettlementCoordinator.releasePendingReward(params)` (new) posts the Ledger release and then publishes `REWARD_RELEASED` to the respondent with `dedupeKey = release-pending:{attemptId}`; `releaseMaturedPendingRewards` uses it per candidate (so each released reward notifies once); `POST /economy/rewards/release-pending/:attemptId` routes through the coordinator. Dispute-held / failed releases publish nothing.
2. **External pending credit** — `ParticipationService.verifyExternalCompletionCode` publishes `REWARD_PENDING` with `dedupeKey = external-completion:{attemptId}` after the completion Unit of Work commits and only when a positive reward journal was posted (idempotent replay of an already-COMPLETED attempt publishes nothing new). _Code review 2026-09-26 (P1):_ a replay re-publishes the deduplicated notice (recovering a failed first publish) only while the credit is still Pending — `RewardSettlementCoordinator.getExternalCreditState(attemptId)` = `PENDING`; after a release or a reversal nothing is published, and a failed state lookup skips the publish without failing the replay.
3. **Starter points** — `StarterPointsCoordinator` publishes through `NotificationPublisherPort` instead of `StarterPointsUserDataProvider.createNotification` (method removed from the port and both adapters): unlock → `ACCOUNT_ACTIVATED` (`starter-unlock:{userId}`), expiry → `WARNING` (`starter-expiry:{userId}`). _Code review 2026-09-26 (P1/P7):_ a later unlock check re-publishes a lost `ACCOUNT_ACTIVATED` or expiry `WARNING` (deduplicated) only within `NOTIFICATION_RECOVERY_WINDOW_MS` (7 days) of the source journal.
4. The publisher is injected as an optional dependency everywhere (`{ token: NOTIFICATION_PUBLISHER_PORT, optional: true }`), so modules/tests without it keep working; a failing publisher never changes the source workflow's result. _Decision E9-D3 (2026-09-26, option A, PO sign-off):_ delivery is **best-effort, at-most-once, post-commit** for Phase 1 — a crash between the source commit and the publish can lose a notice; the Ledger / wallet history is authoritative. Producers move to an AD-10 Outbox subscription once the AD-5 worker exists (`deferred-work.md`, Story 9.6 dev entry; documented on `NotificationPublisherPort`).
5. Survey approval/rejection (8.1) and top-up approval (6.6) are NOT implemented here — they will call the same port with `SURVEY_APPROVED`/`SURVEY_REJECTED`/`TOPUP_SUCCESS`.
6. **Internal instant credit** (_decision E9-D2, 2026-09-26, option A_) — `RewardSettlementCoordinator.settleInternalReward` publishes `REWARD_EARNED` to the respondent after the `internal-reward:{responseId}` journal commits, with `dedupeKey = internal-reward:{responseId}` and the full credited amount (the advertised reward, decision E6-D1). It covers every path that posts the credit — the submission's own settlement, the respondent's replay re-drive of a settlement that failed after the submission committed, and the Admin re-drive `POST /economy/rewards/internal/:responseId`; a replay or re-drive that finds the credit already posted publishes nothing. Guests, zero-reward surveys and Integrity Holds (ENFORCED → `HELD_IN_INTEGRITY`, Phase 2) publish nothing; a failed publish never changes the settlement. The other FR-57 events without a producer ("survey quota reached", "ban/unban") are deferred (`deferred-work.md`).

### AC6 — Mock-first frontend notifications (`apps/frontend/my-app/lib/mock`)
1. `MockNotification` type + `MockStoreState.notifications: Record<userId, MockNotification[]>`; store helpers tolerate persisted states that predate the field.
2. Fixtures seed `user-active-002` with an already-read `ACCOUNT_ACTIVATED` and an unread `REWARD_PENDING` (consistent with its fixture wallet: 20 pending); other personas start empty.
3. Repository methods (current user only): `getNotifications({ limit, unreadOnly })` → `{ items, unreadCount, total, hasMore }` newest first; `getUnreadNotificationCount()`; `markNotificationRead(id)` (unknown / other user's id → error code `NOTIFICATION_NOT_FOUND`); `markAllNotificationsRead()`.
4. Mock producers mirror backend dedupe keys: starter unlock → `ACCOUNT_ACTIVATED` (`starter-unlock:{userId}`), External pending credit → `REWARD_PENDING` (`external-completion:{attemptId}`). ~~Internal instant credit does not notify (backend parity).~~ _Amended 2026-09-26 (decision E9-D2, option A):_ Internal instant credit → `REWARD_EARNED` (once per response — the mock keys it `internal-reward:{attemptId}`, 1:1 with the Response; full reward, Vietnamese copy; free surveys publish nothing), presented in the bell as "Bạn đã nhận điểm thưởng" 💰 linking to `/wallet`. A `rescom:notifications-changed` window event is dispatched (browser only) when notifications change.

### AC7 — Header bell & recent-notification list (`components/layout`)
1. `NotificationBell` in the `PortalShell` header: bell button with unread badge (hidden at 0, `9+` cap), `aria-label` announcing the unread count, `aria-expanded`/`aria-controls`.
2. Clicking opens a panel listing recent notifications (limit 10) with a type-specific title/icon, message, relative time (vi), unread marker; filter toggle "Tất cả / Chưa đọc" so the user can view unread notifications only; clicking an unread item marks it read; "Đánh dấu tất cả đã đọc" marks all read.
3. Loading, empty, and error (with retry) states; Escape closes the panel and returns focus to the bell, an outside click closes it without moving focus (non-modal popover; _code review 2026-09-26 P13_); visible keyboard focus; responsive (full-width sheet under the header on mobile, 384px popover on ≥ sm) without horizontal overflow at 375px.
4. The bell refreshes on mount, on open, on window focus, and on `rescom:notifications-changed`. All business rules stay in the repository.

### AC8 — Typed live API client (`app/notifications/notifications-api.ts`)
`fetchNotifications(query?, { signal })`, `fetchUnreadNotificationCount()`, `markNotificationRead(id)`, `markAllNotificationsRead()` — responses validated with the shared schemas; mutations go through `formMutationFetch` (CSRF); API errors surface `error.message`/`code`; 401 gives a friendly message. Not wired into the mock-first UI (later swap).

### AC9 — Tests & verification
1. Schemas: contract tests. Backend: service, both repositories' semantics (in-memory), controller spec (guards overridden), coordinator/participation producer tests, new `notifications.e2e-spec.ts` (release → notification → list/badge count → mark read → mark all; ownership 404; CSRF 403; 401; validation 400; dedupe on replay).
2. Every existing e2e spec whose flow now reaches the publisher overrides `NOTIFICATION_REPOSITORY_PORT` with `InMemoryNotificationRepository`; the WHOLE e2e suite passes.
3. Frontend: mock repository notification tests + live client tests.
4. `verify.sh` passes (schemas, backend unit, backend e2e, frontend tests, typecheck, lint).

## Tasks / Subtasks

- [x] **Task 1: Shared contracts** (AC: 1)
  - [x] 1.1 `packages/schemas/src/notifications/notification.schema.ts` + `index.ts`; export from `src/index.ts`.
  - [x] 1.2 `notification.schema.spec.ts` (types parity list, query coercion/defaults/bounds/strict, DTO, publish command trimming/limits).
- [x] **Task 2: Prisma schema + migration** (AC: 2)
  - [x] 2.1 Extend `NotificationType`; add `dedupeKey`, `readAt`, unique + indexes to `Notification`.
  - [x] 2.2 Write `20260926090000_event_notifications/migration.sql` (idempotent, drift-tolerant).
  - [x] 2.3 `npm run prisma:validate --workspace backend`; `npx prisma generate` (apps/backend).
- [x] **Task 3: Notifications module core** (AC: 3)
  - [x] 3.1 Domain entity, exceptions, ports (repository + publisher).
  - [x] 3.2 `NotificationsService` (publish/list/count/markRead/markAllRead) + unit spec (red → green).
  - [x] 3.3 `InMemoryNotificationRepository` + spec; `PrismaNotificationRepository`.
  - [x] 3.4 Map `NotificationNotFoundException` → 404 in the global filter.
- [x] **Task 4: Endpoints + module wiring** (AC: 4)
  - [x] 4.1 `NotificationsController` + controller spec (override `CsrfGuard`).
  - [x] 4.2 `NotificationsModule` (`@Global`), register in `AppModule`.
- [x] **Task 5: Producers** (AC: 5)
  - [x] 5.1 `RewardSettlementCoordinator.releasePendingReward` + notification in `releaseMaturedPendingRewards`; controller endpoint routes through it; specs.
  - [x] 5.2 `ParticipationService` optional publisher → `REWARD_PENDING` after external completion commit; module wiring; spec.
  - [x] 5.3 `StarterPointsCoordinator` → publisher (`ACCOUNT_ACTIVATED`, `WARNING`); remove `createNotification` from the data-provider port/adapters; update specs.
  - [x] 5.4 `EconomyModule` / `ParticipationModule` factories inject the publisher optionally.
- [x] **Task 6: Backend e2e** (AC: 9)
  - [x] 6.1 New `test/notifications.e2e-spec.ts`.
  - [x] 6.2 Add `NOTIFICATION_REPOSITORY_PORT` in-memory overrides to existing specs that reach producers (starter-points, reward-settlement, external-completion, participation-submission, marketplace-feed, auth, google-oauth, single-session); update the starter-points spec assertions to the notification repository.
  - [x] 6.3 Run the WHOLE e2e suite.
- [x] **Task 7: Frontend mock + UI + live client** (AC: 6, 7, 8)
  - [x] 7.1 Mock types/store/fixtures/repository notifications + producers + change event.
  - [x] 7.2 `components/layout/NotificationBell.tsx`; mount in `PortalShell` header (keep 375px header from overflowing). _375 px browser QA still pending — see deferred-work (Story 9.6 dev entry) and review DF4._
  - [x] 7.3 `app/notifications/notifications-api.ts`.
  - [x] 7.4 `tests/notifications.test.mjs` (mock repository + live client).
- [x] **Task 8: Verification & bookkeeping** (AC: 9)
  - [x] 8.1 `npx eslint "{src,test}/**/*.ts" --fix` (apps/backend); frontend lint.
  - [x] 8.2 `verify.sh` all green; update story file, sprint-status, deferred-work.

### Review Findings

_Epic 9 code review of 2026-09-26 (full mode: Blind Hunter + Edge Case Hunter + Acceptance Auditor; triage IDs D/P/DF in brackets, decision IDs from `code-review-decisions-2026-09-26.md`). Stories 9.6 and 9.2 were triaged together; this list holds the findings that belong to 9.6 (P4 and P12 touch both stories and are listed under their main story, with a pointer here). Dismissed as noise across the epic: 8 (X1–X8: the Epic 6-owned test breakages were already rebased, the release-notification failure cannot skip the unlock, the `LedgerController` fallback cannot run under Nest, `ESCROW_RELEASED` is reserved for Epic 6 DF6, mock/backend feedback eligibility cannot differ, `?limit=` coercion, duplicate-tag cap, UTF-16 vs code-point caps). The decisions were **not** implemented; every patch was applied with tests ("Apply every patch")._

- [x] [Review][Decision] E9-D2 — FR-57 "Points earned": Internal instant credit publishes no notification (D2, medium) — Internal surveys are the main Phase 1 earning path and FR-57 lists "Points earned" first, but AC6.4 excludes them as "backend parity" (a rationale the same story created); the receipt and wallet history show the credit. Options: (A) add `REWARD_EARNED` (drift-tolerant `ALTER TYPE … ADD VALUE IF NOT EXISTS`, `NOTIFICATION_TYPES`, bell presentation, mock), published after the Internal credit journal commits (first submit; re-drive/replay only when a new journal was posted), `dedupeKey = internal-reward:{responseId}`, guests and zero-reward surveys skipped; (B) accept receipt + wallet history as "Points earned" and amend FR-57/AC6.4 with PO sign-off; (C) reuse `REWARD_RELEASED` with other copy — not recommended (the type and its bell title would be wrong). **Recommendation: A** (P5's unknown-type fallback, which must land first, is now in place). Either way the other uncovered FR-57 events (survey quota reached, ban/unban) are now recorded in `deferred-work.md`. — **Resolved 2026-09-26:** option A accepted by Quan; `REWARD_EARNED` added (Prisma enum + drift-tolerant migration `20260927030000_notification_reward_earned`, `NOTIFICATION_TYPES` in Prisma order, parity spec green), published by `RewardSettlementCoordinator.settleInternalReward` after the Internal credit journal commits (submit, replay re-drive and Admin re-drive; nothing when the credit was already posted), deduplicated on `internal-reward:{responseId}`, full credited amount, guests/zero-reward/ENFORCED skipped; bell presentation "Bạn đã nhận điểm thưởng" + mock producer; unit (coordinator + participation service), e2e (`participation-submission`, `reward-settlement`) and frontend tests; "quota reached" and "ban/unban" producers recorded as deferred (FR-57 remainder).
- [x] [Review][Decision] E9-D3 — Delivery guarantee: best-effort at-most-once now, or Outbox-backed (D3, medium) — producers publish after their Unit of Work commits and `publish` swallows every error into `FAILED`, so a crash, deploy or DB blip between commit and publish loses the notice (Ledger/wallet history stay authoritative). AD-10 targets Outbox-driven delivery, but no AD-5 worker or claim/lease infrastructure exists; the gap was recorded unattended (`deferred-work.md`, Story 9.6 dev entry, first bullet) without sign-off. Options: (A) accept best-effort for Phase 1 and sign off that entry — P1 and P7 (applied below) give every producer a bounded replay recovery; (B) producer-side Outbox now (a `NotificationRequested` event in each source transaction plus a co-located relay; requires the first AD-10 worker); (C) a reconciliation sweep without the Outbox (still needs a scheduler and owner query ports). **Recommendation: A now, B once the worker exists**; record the sign-off and the "money notices may be lost; history is authoritative" risk in `deferred-work.md`. — **Resolved 2026-09-26:** option A accepted by Quan; best-effort, at-most-once, post-commit delivery signed off for Phase 1 in `deferred-work.md` (Story 9.6 dev entry, first bullet) with the risk, AC5.4 amended, and the move to an AD-10 Outbox subscription once the AD-5 worker exists documented there and on `NotificationPublisherPort`; P1/P7 already give the replayable producers a bounded recovery. No behaviour change.
- [x] [Review][Patch] The COMPLETED fast path could publish a false "points are pending" notice after a release or reversal; the activation notice's recovery was unbounded (P1, medium) — fixed: new `RewardSettlementCoordinator.getExternalCreditState(attemptId)` → `NONE | PENDING | RELEASED | REVERSED` (reversal wins over release). `ParticipationService.replayExternalCompletion` now publishes the deduplicated `REWARD_PENDING` only when a positive credit journal exists and its state is `PENDING`; a failed state lookup is logged and skipped (the replay still returns its original result); the first-completion path is unchanged and the Epic 7 P5 `tryUnlockStarterPoints` call still runs right after it. `StarterPointsCoordinator` exports `NOTIFICATION_RECOVERY_WINDOW_MS` (7 days) and re-publishes `ACCOUNT_ACTIVATED` for an already-unlocked account only within that window of the unlock journal (ledger clock); outside it nothing is published or written. Tests: participation spec (PENDING re-publishes with the same key; RELEASED/REVERSED/NONE do not; a throwing lookup still replays without publishing; no lookup without a journal), coordinator spec (one case per state incl. "reversed after release"), starter-points spec (1-day-old unlock re-publishes, 8-day-old never calls the publisher), e2e `external-completion` test 6 (lost notice recovered while Pending; after an Admin `POST /economy/journals/:id/reverse` a replay creates no `REWARD_PENDING`). [apps/backend/src/modules/participation/application/participation.service.ts:1570, apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts:163, apps/backend/src/modules/economy/application/starter-points.coordinator.ts:106]
- [x] [Review][Patch] An unknown notification type crashed the bell (every portal page) and one unknown/legacy row rejected the whole live list (P5, low) — fixed: presentation moved to the pure `lib/notification-presentation.ts` (`getNotificationPresentation(type)` with a neutral "Thông báo" 🔔 fallback without link, own-property lookup), used at both bell call sites; the live `fetchNotifications` validates the envelope separately and keeps only the items that parse (`unreadCount` stays authoritative), throwing `MALFORMED` only for an invalid envelope. Tests (`tests/notifications.test.mjs`): fallback + every known type mapped; one unknown + one valid item → the valid item; invalid envelope still rejected. [apps/frontend/my-app/lib/notification-presentation.ts:1, apps/frontend/my-app/app/notifications/notifications-api.ts:66]
- [x] [Review][Patch] The bell's local list could contradict the badge after mark-read / mark-all (P6, low) — fixed: `handleItemClick` reads the current filter from `panelStateRef` after the await and computes the next list from a synchronously updated `itemsRef` (two quick clicks both see the latest list); an unread list emptied while `unreadCount > 0` reloads silently; `handleMarkAll` updates the list optimistically (unread filter cleared, "all" items marked read) before the silent reload. No DOM harness exists (DF7) — covered by the manual QA checklist in the Completion Notes. [apps/frontend/my-app/components/layout/NotificationBell.tsx:199]
- [x] [Review][Patch] The starter-points expiry WARNING was never re-published after a failed first publish (P7, low) — fixed: `publishExpired(userId, journal)` extracted from the sweep (message still states the voided amount); `checkAndUnlockStarterPoints` re-publishes it (deduplicated by `starter-expiry:{userId}`) in the EXPIRED branch and in the branch where the expiry won the race, both only within `NOTIFICATION_RECOVERY_WINDOW_MS`, so `tryUnlockStarterPoints` (every submission, verification, demographics save, release) recovers it on the user's next activity. Tests: a sweep whose publish fails is recovered exactly once by later triggers; outside the window the publisher is not called; the race branch publishes the WARNING. [apps/backend/src/modules/economy/application/starter-points.coordinator.ts:636]
- [x] [Review][Patch] A split surrogate pair in notification text failed the publish and lost the notice (P9, low) — fixed: (1) `publishNotificationCommandSchema.message` replaces lone surrogates with U+FFFD (shared `replaceLoneSurrogates`, new `packages/schemas/src/common/unicode-text.ts`), so every producer is protected; (2) moderation and top-up truncation now use the shared `truncateText`, which counts UTF-16 units (the unit Zod's `.max(500)` counts) but never cuts inside a surrogate pair. Tests: schema spec, `notifications.service.spec.ts` (lone surrogate → `CREATED`, stored with U+FFFD), moderation spec (76-char title + emoji; 246-char reason + emoji → well-formed, ≤ 500), top-up spec (296-char reason + emoji). [packages/schemas/src/notifications/notification.schema.ts:134, apps/backend/src/modules/moderation/application/survey-moderation.service.ts:539, apps/backend/src/modules/economy/application/top-up.service.ts:409]
- [x] [Review][Patch] `offset` had no upper bound: `offset=1e20` returned a 500 instead of a 400 (P10, low) — fixed: `NOTIFICATION_LIST_MAX_OFFSET = 10_000` and `.max(...)` on `listNotificationsQuerySchema.offset`. Tests: schema spec (10 000 accepted; 10 001 and `1e20` rejected), e2e "rejects invalid list queries" (`offset=1e20`, `offset=10001` → 400 `VALIDATION_ERROR`). [packages/schemas/src/notifications/notification.schema.ts:68]
- [x] [Review][Patch] The `@Global` NotificationsModule exported the repository and the full service (P11, low) — fixed: `exports: [NOTIFICATION_PUBLISHER_PORT]` only; `test/architecture.spec.ts` gains a rule that no non-spec file outside `modules/notifications/` imports (`from`, `import()` or `require()`) `notification-repository.port`, `notifications.service` or anything under `notifications/infrastructure/`. Full build, unit and e2e suites pass (e2e overrides and `moduleFixture.get` are non-strict). AC3.5 amended. [apps/backend/src/modules/notifications/notifications.module.ts:44]
- [x] [Review][Patch] The `NotificationType` "parity" test compared against a hard-coded copy, not Prisma (P12, low; the feedback-enum half is listed in Story 9.2) — fixed: `notification-type.parity.spec.ts` asserts `NOTIFICATION_TYPES` equals `Object.values($Enums.NotificationType)`; the schema-package test is kept. [apps/backend/src/modules/notifications/infrastructure/notification-type.parity.spec.ts:1]
- [x] [Review][Patch] Story-record accuracy (P13, low; 9.6 part) — fixed: AC3.2 no longer lists `findByIdForUser`; AC3.5 states the single export (P11); AC7.3 and the completion note say Escape returns focus and an outside click closes without moving it; Task 7.2 is annotated "375 px QA pending"; AC1.1/AC5.2/AC5.3 and the "replays re-publish" completion note state the P1/P7/P9/P10 rules; AC9 re-recorded (Completion Notes, code review line); manual QA checklist for P6/DF4 added. All corrections are decision-independent (E9-D2/E9-D3 may amend AC1.1/AC5 again).
- [x] [Review][Defer] Producers store finished English sentences with no structured params, so rows cannot be re-rendered in Vietnamese later (DF1, low) [apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts:231] — deferred: already recorded (Story 9.6/6.6/8.1 dev entries); a gate for the live-API swap (localized backend copy or type + params, e.g. a nullable `params Json` column) before real rows accumulate.
- [x] [Review][Defer] Live notification-center refresh model: no polling, `read-all` without a cutoff, three unsnapshotted reads with offset paging (DF2, low) [apps/frontend/my-app/components/layout/NotificationBell.tsx:1, apps/backend/src/modules/notifications/presentation/notifications.controller.ts:55] — deferred: the bell is mock-backed by design (spec-mock), shows 10 items and self-corrects on the next refresh; revisit polling/visibility refresh, a `before` cutoff and keyset paging together at the live-API swap.
- [x] [Review][Defer] The `(user_id, dedupe_key)` index, `ON CONFLICT DO NOTHING` and the unique race are proven only against mocks and in-memory doubles (DF3, low; shared with Story 9.2) [apps/backend/src/modules/notifications/infrastructure/prisma-notification.repository.ts:23] — deferred: needs the Postgres test container (Epic 6 DF5).
- [x] [Review][Defer] No-overflow at 375 px is unverified for the header with the bell (DF4, medium; shared with Story 9.2) [apps/frontend/my-app/components/layout/PortalShell.tsx:149] — deferred: needs manual browser QA (already recorded; spec-mock 375 px item open); Task 7.2 is annotated (P13); run the QA checklist before moving 9.6/9.2 to done and fix the layout only if clipping is observed.
- [x] [Review][Defer] The mock never moves Pending to Available, so `REWARD_RELEASED` cannot be demonstrated; mock activation fires after 48 h while the points still show as Pending (DF5, low) [apps/frontend/my-app/lib/mock/repository.ts:1039] — deferred: already recorded; owned by decision E7-DN1 (its option A adds a mock "simulate 48 h" control, which should also release Pending and publish `REWARD_RELEASED` with `release-pending:{attemptId}`).
- [x] [Review][Defer] No tests cover the bell's UI-behaviour ACs (9+ cap, Escape/focus, filter) (DF7, low; shared with Story 9.2) [apps/frontend/my-app/components/layout/NotificationBell.tsx:1] — deferred: `node --test` has no DOM harness and new dependencies are not allowed; P5 moved the presentation into a testable helper; add component tests when a DOM harness is approved.

## Dev Notes

### Architecture guardrails
- **Ownership:** the Notifications context owns notification intent + user read state and "consumes domain events; notification failure cannot roll back the source transaction" (ARCHITECTURE-SPINE bounded-context table; solution-design §12). Other contexts depend only on `NotificationPublisherPort` (AD-7 cross-module port). They never touch the `notifications` table.
- **Clean Architecture guard** (`apps/backend/test/architecture.spec.ts`): nothing under `notifications/domain` or `notifications/application` may import `@nestjs/*`, `@prisma/client`, express, or anything named "adapter". The Nest `Logger` is injected via the module factory behind the framework-free `NotificationFailureLogger` interface.
- **Transactions:** Postgres aborts a whole transaction on any statement error, even if JS catches it. Therefore the Prisma notification adapter never uses `runInTransaction`/the ambient UoW, and producers publish after their source commit: `LedgerService.releasePendingReward` commits its own journal; `ParticipationService` publishes after `unitOfWork.run(...)` resolves; `StarterPointsCoordinator` publishes after the unlock/expiry journal.
- **Idempotency (AD-10 / NFR-25 "replay cannot create a duplicate notification"):** `dedupeKey` = the source event identity, reusing the Ledger idempotency key of the journal that caused it (`release-pending:{attemptId}`, `external-completion:{attemptId}`, `starter-unlock:{userId}`, `starter-expiry:{userId}`; since decision E9-D2 also `internal-reward:{responseId}` for `REWARD_EARNED`). Uniqueness is `(userId, dedupeKey)` so one event may notify several users (e.g. future dispute outcomes). Prisma `createMany({ skipDuplicates: true })` → `ON CONFLICT DO NOTHING`, so a replay is a silent no-op, not an error.
- **Enum decision:** only values a Phase 1 event truly needs and that have no truthful existing value were added: `REWARD_RELEASED` (the AC's own example; `ESCROW_RELEASED` means the Publisher's escrow — a distinct Economy event in the archived event catalogue), `REWARD_PENDING` (FR-57 "Points pending"; needed for the requested mock/backed External pending notification), `ACCOUNT_ACTIVATED` (FR-57 "account activation"; replaces 6.5's stop-gap `TOPUP_SUCCESS` for starter unlock, which would render as a top-up), `SURVEY_REJECTED` (Story 8.1 reject path; PRD "Publisher is notified of approval/rejection"; avoids a second enum migration). Top-up rejection (6.6) can use `WARNING`. _Decision E9-D2 (2026-09-26): `REWARD_EARNED` added for FR-57 "Points earned" (Internal instant credit); `REWARD_RELEASED` was not reused because its meaning (Pending → Available) and bell title would be wrong._
- **Copy language:** backend notification messages stay English like every other backend string (6.5 precedent); the mock UI is Vietnamese. Localizing live notification copy (or rendering from type + params) is recorded in deferred-work.

### Current state of files being modified (read before editing)
- `economy/application/starter-points.coordinator.ts` — writes notifications via `StarterPointsUserDataProvider.createNotification` (Prisma adapter `prisma.notification.create`, in-memory adapter pushes to an array). Types `TOPUP_SUCCESS` (unlock) / `WARNING` (expiry). Keep: eligibility rules, journals, return shapes. Change: notifications go through the optional publisher; unlock type becomes `ACCOUNT_ACTIVATED`.
- `economy/application/reward-settlement.coordinator.ts` — `releaseMaturedPendingRewards(candidates)` loops `ledgerService.releasePendingReward` and counts released / disputed (`DisputeHoldActiveException`) / failed; no caller yet (no scheduler). Keep the summary semantics.
- `economy/presentation/ledger.controller.ts` — `POST rewards/release-pending/:attemptId` calls `ledgerService.releasePendingReward` directly and returns the serialized journal (e2e asserts `idempotencyKey === release-pending:{attemptId}`). Change only the call target (coordinator); response unchanged.
- `economy/economy.module.ts` — `@Global`; factories for `RewardSettlementCoordinator(ledgerService)` and `StarterPointsCoordinator(ledgerService, dataProvider)`; add optional publisher injection.
- `participation/application/participation.service.ts` — constructor `(formRepo, demographicRepo, participationRepo, rewardSettlementCoordinator?, completionCodeService?, starterPointsCoordinator?, unitOfWork = PassThrough)`; add optional 8th `notificationPublisher?`. In `verifyExternalCompletionCode`, publish after the UoW and before the starter unlock check. Preserve the fast-path replay branch unchanged.
- `participation/participation.module.ts` — factory; add `{ token: NOTIFICATION_PUBLISHER_PORT, optional: true }`.
- `components/layout/PortalShell.tsx` — header right cluster: streak pill, wallet pill, reset, logout. Add the bell before the reset button; at < sm hide the streak "ngày" suffix so 375px does not overflow (spec-mock notes existing clipping).
- `lib/mock/{types,store,fixtures,repository}.ts` — persisted in `localStorage` key `rescom_demo_v1_store`; old persisted states lack `notifications` → helpers must default to `{}`.

### E2E pitfalls (from Story 6.5)
- e2e specs boot the whole `AppModule` with a tiny mocked `PrismaService`. The publisher is best-effort, so a missing override would not 500, but it would log errors and hide real regressions → override `NOTIFICATION_REPOSITORY_PORT` with `InMemoryNotificationRepository` in every spec whose flow reaches a producer, and run the WHOLE suite.
- CSRF-guarded e2e requests: `.set('x-csrf-token', tokens.csrfToken).set('Origin', 'http://localhost:3000')`.

### Frontend rules
- Mock-first (human-owned `spec-mock-respondent-journey.md`): the bell uses `mockRepository`, never the live backend. Business rules in the repository; components only format.
- Frontend unit tests run with `node --test` + Node 22 type stripping: new TS imported by tests must use explicit `.ts` relative imports, `import type` for types, and no parameter properties/enums.
- No new dependencies (inline SVG icons, `Intl.RelativeTimeFormat('vi')`).

### Testing standards
- Backend: Jest unit specs next to sources; e2e in `apps/backend/test`. Schemas: Jest. Frontend: `node --test tests/*.test.mjs`.
- Baseline before story: schemas 158, backend unit 727, e2e 196 passed / 3 skipped, frontend 44.

### Project Structure Notes
- New backend module follows the per-module layout (`domain/`, `application/ports`, `application/exceptions`, `infrastructure/` Prisma + InMemory adapters, `presentation/`), matching `economy` and `marketplace`.
- Routes registered with bare and `api/` prefixes like other controllers.
- Live API client colocated at `app/notifications/notifications-api.ts` (non-route file; mirrors `app/wallet/wallet-api.ts`).

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.6: Event Notification System]
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#FR-57: Event Notifications]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-10 — Transactional Submission Outbox] (replay cannot duplicate a notification)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md (bounded-context table, Notifications row)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md#12. Module Ownership]
- [Source: _bmad-output/implementation-artifacts/6-5-frozen-starter-points-lifecycle.md#Debug Log References] (e2e override regression)
- [Source: apps/backend/prisma/schema.prisma#model Notification]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Implementation Plan

- **Capability, not a feature patch:** new `notifications` bounded context. Other contexts depend only on `NotificationPublisherPort` (`NOTIFICATION_PUBLISHER_PORT`, provided by the `@Global()` `NotificationsModule` via `useExisting: NotificationsService`) and inject it optionally, so 6.6 (top-up) and 8.1 (moderation) can publish `TOPUP_SUCCESS` / `SURVEY_APPROVED` / `SURVEY_REJECTED` with one line.
- **Failure isolation:** `NotificationsService.publish` validates with `publishNotificationCommandSchema`, catches every repository error, logs through a framework-free `NotificationFailureLogger` (Nest `Logger` wired in the module) and returns `CREATED | DUPLICATE | FAILED` — it never throws. Producers publish after their source commit; the Prisma adapter uses the base client (never `runInTransaction`) and `createMany({ skipDuplicates: true })` so a replay is `ON CONFLICT DO NOTHING`, never an aborting unique violation.
- **Idempotency:** `dedupeKey` reuses the Ledger idempotency key of the journal that caused the event (`release-pending:{attemptId}`, `external-completion:{attemptId}`, `starter-unlock:{userId}`, `starter-expiry:{userId}`); uniqueness is `(userId, dedupeKey)`.
- **Ownership:** every repository query carries `userId`; mark-read uses `updateMany where {id, userId, isRead:false}` + owner-scoped `findFirst`, so not-owned and unknown ids both surface as 404 `NOTIFICATION_NOT_FOUND` and an already-read row keeps its original `readAt`.
- **Frontend:** mock repository owns list/filter/paging/read-state/ownership/dedupe and emits `rescom:notifications-changed`; `NotificationBell` only formats (type → Vietnamese title/icon/link, relative time) and calls the repository. Typed live client validates responses with the shared schemas and uses `formMutationFetch` (CSRF) for PATCHes.

### Debug Log References

- Red phase confirmed for every new unit spec (schemas, service, controller, coordinator/participation producer tests, frontend mock/client tests) before implementation.
- First full e2e run after wiring: `starter-points.e2e-spec.ts` failed as expected (asserted the removed `dataProvider.notifications`) → moved to `InMemoryNotificationRepository`. A temporary `console.warn` probe in the Prisma adapter (removed afterwards) showed that only `external-completion` and `reward-settlement` reach the Prisma notification adapter in existing suites.
- Intermittent, unrelated e2e flakes observed: `auth.e2e-spec.ts` (404 on login / 400 on refresh) once, `forms-versioning.e2e-spec.ts` (501 / 400) once — both passed in isolation and on the next full run. Non-Nest status codes point at supertest's ephemeral port being shadowed by other local `127.0.0.1` listeners (recorded in deferred-work).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- AC1: `packages/schemas/src/notifications` (types list = Prisma enum, list query with coercion/strict keys, DTOs, publish command); 17 tests.
- AC2: `NotificationType` + `SURVEY_REJECTED`, `REWARD_PENDING`, `REWARD_RELEASED`, `ACCOUNT_ACTIVATED`; `Notification.dedupeKey`, `readAt`, `@@unique([userId, dedupeKey])`, two `userId` indexes. Hand-written drift-tolerant migration `20260926090000_event_notifications` (no earlier migration creates the table/enum). `prisma validate` + `prisma generate` OK; `prisma format` leaves the schema unchanged.
- AC3/AC4: notifications module + endpoints `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` (bare and `api/` prefixes; `SessionAuthGuard` class-level, `CsrfGuard` on PATCHes; query validated with `ZodValidationPipe(..., 'query')`; `ParseUUIDPipe`). `NotificationNotFoundException` → 404.
- AC5 producers: pending release → `REWARD_RELEASED` via new `RewardSettlementCoordinator.releasePendingReward` (used by the sweep and by `POST /economy/rewards/release-pending/:attemptId`); External completion → `REWARD_PENDING` after the completion UoW commits and only when a positive journal exists; starter unlock → `ACCOUNT_ACTIVATED` (replaces 6.5's `TOPUP_SUCCESS` stop-gap), starter expiry → `WARNING`. `StarterPointsUserDataProvider.createNotification` removed from the port and both adapters. A failing publisher never changes the source result (tested).
- AC6/AC7/AC8: mock notifications (seeded for `user-active-002`: one read `ACCOUNT_ACTIVATED`, one unread `REWARD_PENDING`; legacy persisted stores tolerated), producers mirroring backend keys (starter unlock, External pending credit; Internal instant credit deliberately does not notify), bell with badge (9+ cap), filter "Tất cả / Chưa đọc", mark one / mark all, loading/empty/error+retry, Escape closes with focus return and an outside click closes without moving focus (_corrected by the 2026-09-26 code review, P13_), stale-response guard, responsive sheet/popover. Streak "ngày" suffix hidden below `sm` to keep the 375px header from growing. Live client `app/notifications/notifications-api.ts`.
- Deviation: the story listed `findByIdForUser` on the repository port; it was dropped because no use case needs it (mark-read returns the owned row itself).
- E2E overrides: `NOTIFICATION_REPOSITORY_PORT` → `InMemoryNotificationRepository` in `starter-points`, `reward-settlement`, `external-completion` (these now also assert the notifications) and defensively in `participation-submission` and `marketplace-feed` (their flows run the starter-unlock hook). `auth`, `google-oauth`, `single-session` only reach the starter grant, which never notifies.
- Independent review pass (code-reviewer agent) → fixes applied:
  - [High] Notification spoofing via `POST /economy/rewards/release-pending/:attemptId`: a replay could target another `respondentId` and put caller text in the message through an unvalidated `amount`. Now the body is validated with the shared `releasePendingRewardSchema` (zod), non-admins may only release their own reward (403 `FORBIDDEN_RESOURCE`), and the coordinator takes recipient and amount from the committed journal (credited account owner must equal the claimed respondent). Unit + e2e tests added.
  - [Medium] Bell could stay on the skeleton when a silent refresh overtook a visible load and failed → silent failures now surface the error unless a list is already shown.
  - [Low] Expiry message states the amount actually voided; External completion replays re-publish (deduplicated) so a transient `FAILED` can recover (_code review 2026-09-26 P1: only while the credit is still Pending_); mark-all reloads read timestamps from the repository; mock notification ids are UUIDs so mock lists satisfy `notificationListSchema` (tested).
  - Not changed: outside click closes the panel without pulling focus back to the bell (deliberate — focus stays where the user clicked; Escape returns focus), and the pre-existing `LedgerController` coordinator fallback used by its unit spec.
- Verification (2026-09-26, final): schemas 175/175 (+17), backend unit 767/767 (+40), backend e2e 206 passed / 3 skipped (+10, 24 suites), frontend 64/64 (+20), `npm run typecheck` clean, `npm run lint` clean. Full e2e runs hit intermittent environment flakes (non-Nest 400/404/501 responses in `auth`, `forms-versioning`, `reward-settlement` wallet GET) that passed in isolation and on the next full run; recorded in deferred-work.
- Deferred items appended to `deferred-work.md` (outbox-driven delivery, backend copy localization, email channel/retention, release scheduler + pre-existing release endpoint authorization, mock 48h release simulation, 375px header QA, e2e port-collision flake).
- **Code review 2026-09-26 (Epic 9):** applied P1 (`getExternalCreditState`; the replay recovers `REWARD_PENDING` only while the credit is Pending; `NOTIFICATION_RECOVERY_WINDOW_MS` = 7 days bounds the `ACCOUNT_ACTIVATED` re-publish; Epic 7 P5's unlock call still follows the notice), P5 (`lib/notification-presentation.ts` with a neutral fallback; the live list keeps valid items and rejects only a bad envelope), P6 (bell filter read after the await, emptied-unread refill, optimistic mark-all), P7 (expiry `WARNING` recovered by later unlock checks within the window), P9 (U+FFFD for lone surrogates in the publish command; pair-safe `truncateText` in moderation and top-up), P10 (`NOTIFICATION_LIST_MAX_OFFSET` = 10 000), P11 (publisher port is the only export + architecture rule), P12 (Prisma-backed `NotificationType` parity spec) and P13 (this record), plus P4's notification-client half (401 → `AUTH_REQUIRED`, listed in Story 9.2). Shared helpers live in the new `packages/schemas/src/common/unicode-text.ts`. Decisions E9-D2 (FR-57 "Points earned") and E9-D3 (best-effort vs Outbox delivery) are open and not implemented; 6 items deferred (DF1–DF5, DF7). AC9 re-recorded after the Epic 6/5/7/8 review rebases — final `verify.sh` (2026-09-26): schemas 379/379, backend unit 1394/1394 (98 suites), backend e2e 288 passed / 3 skipped (30 suites), frontend 224/224, typecheck clean, lint clean; `npm run prisma:validate --workspace backend` valid.
- **Decision follow-up 2026-09-26 (Batch D, decisions E9-D2 and E9-D3, both option A accepted by Quan):** E9-D2 — `REWARD_EARNED` for Internal instant credits (schemas, Prisma enum + migration `20260927030000_notification_reward_earned`, coordinator producer covering submit / replay re-drive / Admin re-drive with `internal-reward:{responseId}` dedupe and the full credited amount, bell presentation, mock producer); the FR-57 remainder ("survey quota reached", "ban/unban") is deferred. E9-D3 — best-effort delivery signed off (deferred-work, AC5.4, publisher-port doc); Outbox delivery once the worker exists. Tests: schemas (+1), coordinator spec (+5: once after the journal commits with the full amount, replay adds none, no notice for ENFORCED/guest/zero reward, none for a failed credit, a failing or contract-breaking publisher keeps the settlement), participation service spec (+5: after the submission commit, idempotent replay, replay-recovered settlement once, Admin re-drive once, guest none), e2e `participation-submission` (submit → one `REWARD_EARNED` via `GET /notifications`, retry adds none) and `reward-settlement` (Admin re-drive → one notice), frontend (mock producer + presentation). No unchecked Decision/Patch items remain → Status `done`. Still open for a human: the 375 px manual QA checklist below (DF4). Final `verify.sh` (2026-09-26): schemas 435/435, backend unit 1516/1516 (100 suites), backend e2e 299 passed / 3 skipped (30 suites), frontend 254/254, typecheck clean, lint clean; `npm run prisma:validate --workspace backend` valid.
- **Manual QA checklist (P6 / DF4; no DOM harness, no dev server in the unattended run):** at 375 px the portal header (streak, wallet, bell, reset, logout) does not overflow horizontally and the panel opens as a full-width sheet; with > 10 unread in "Chưa đọc", marking the shown items refills the list instead of showing "Không có thông báo chưa đọc" next to a non-zero count; switching to "Tất cả" while a mark-read is in flight keeps the item (now read) in the "all" list; "Đánh dấu tất cả đã đọc" clears the unread styling at once even if the reload fails; an unknown type renders as "Thông báo" 🔔 without navigating.

### File List

- `packages/schemas/src/notifications/notification.schema.ts` (new)
- `packages/schemas/src/notifications/notification.schema.spec.ts` (new)
- `packages/schemas/src/notifications/index.ts` (new)
- `packages/schemas/src/index.ts` (modified)
- `apps/backend/prisma/schema.prisma` (modified)
- `apps/backend/prisma/migrations/20260926090000_event_notifications/migration.sql` (new)
- `apps/backend/src/app.module.ts` (modified)
- `apps/backend/src/common/http/http-exception.filter.ts` (modified)
- `apps/backend/src/modules/notifications/notifications.module.ts` (new)
- `apps/backend/src/modules/notifications/domain/notification.entity.ts` (new)
- `apps/backend/src/modules/notifications/application/notifications.service.ts` (new)
- `apps/backend/src/modules/notifications/application/notifications.service.spec.ts` (new)
- `apps/backend/src/modules/notifications/application/exceptions/notification.exceptions.ts` (new)
- `apps/backend/src/modules/notifications/application/ports/notification-publisher.port.ts` (new)
- `apps/backend/src/modules/notifications/application/ports/notification-repository.port.ts` (new)
- `apps/backend/src/modules/notifications/infrastructure/in-memory-notification.repository.ts` (new)
- `apps/backend/src/modules/notifications/infrastructure/prisma-notification.repository.ts` (new)
- `apps/backend/src/modules/notifications/infrastructure/prisma-notification.repository.spec.ts` (new)
- `apps/backend/src/modules/notifications/presentation/notifications.controller.ts` (new)
- `apps/backend/src/modules/notifications/presentation/notifications.controller.spec.ts` (new)
- `apps/backend/src/modules/economy/economy.module.ts` (modified)
- `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts` (modified)
- `apps/backend/src/modules/economy/application/reward-settlement.coordinator.spec.ts` (modified)
- `apps/backend/src/modules/economy/application/starter-points.coordinator.ts` (modified)
- `apps/backend/src/modules/economy/application/starter-points.coordinator.spec.ts` (modified)
- `apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.ts` (modified)
- `apps/backend/src/modules/economy/infrastructure/in-memory-starter-points-data-provider.ts` (modified)
- `apps/backend/src/modules/economy/presentation/ledger.controller.ts` (modified)
- `apps/backend/src/modules/economy/presentation/ledger.controller.spec.ts` (modified)
- `apps/backend/src/modules/participation/application/participation.service.ts` (modified)
- `apps/backend/src/modules/participation/application/participation.service.spec.ts` (modified)
- `apps/backend/src/modules/participation/participation.module.ts` (modified)
- `apps/backend/test/notifications.e2e-spec.ts` (new)
- `apps/backend/test/starter-points.e2e-spec.ts` (modified)
- `apps/backend/test/reward-settlement.e2e-spec.ts` (modified)
- `apps/backend/test/external-completion.e2e-spec.ts` (modified)
- `apps/backend/test/participation-submission.e2e-spec.ts` (modified)
- `apps/backend/test/marketplace-feed.e2e-spec.ts` (modified)
- `apps/frontend/my-app/lib/mock/types.ts` (modified)
- `apps/frontend/my-app/lib/mock/store.ts` (modified)
- `apps/frontend/my-app/lib/mock/fixtures.ts` (modified)
- `apps/frontend/my-app/lib/mock/repository.ts` (modified)
- `apps/frontend/my-app/components/layout/NotificationBell.tsx` (new)
- `apps/frontend/my-app/components/layout/PortalShell.tsx` (modified)
- `apps/frontend/my-app/app/notifications/notifications-api.ts` (new)
- `apps/frontend/my-app/tests/notifications.test.mjs` (new)
- `_bmad-output/implementation-artifacts/9-6-event-notification-system.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified)

Code review 2026-09-26 (new):
- `packages/schemas/src/common/unicode-text.ts`
- `packages/schemas/src/common/unicode-text.spec.ts`
- `apps/backend/src/modules/notifications/infrastructure/notification-type.parity.spec.ts`
- `apps/frontend/my-app/lib/notification-presentation.ts`

Code review 2026-09-26 (modified):
- `packages/schemas/src/index.ts`
- `packages/schemas/src/notifications/notification.schema.ts`
- `packages/schemas/src/notifications/notification.schema.spec.ts`
- `apps/backend/src/modules/notifications/notifications.module.ts`
- `apps/backend/src/modules/notifications/application/notifications.service.spec.ts`
- `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts`
- `apps/backend/src/modules/economy/application/reward-settlement.coordinator.spec.ts`
- `apps/backend/src/modules/economy/application/starter-points.coordinator.ts`
- `apps/backend/src/modules/economy/application/starter-points.coordinator.spec.ts`
- `apps/backend/src/modules/economy/application/top-up.service.ts`
- `apps/backend/src/modules/economy/application/top-up.service.spec.ts`
- `apps/backend/src/modules/moderation/application/survey-moderation.service.ts`
- `apps/backend/src/modules/moderation/application/survey-moderation.service.spec.ts`
- `apps/backend/src/modules/participation/application/participation.service.ts`
- `apps/backend/src/modules/participation/application/participation.service.spec.ts`
- `apps/backend/test/architecture.spec.ts`
- `apps/backend/test/external-completion.e2e-spec.ts`
- `apps/backend/test/notifications.e2e-spec.ts`
- `apps/frontend/my-app/components/layout/NotificationBell.tsx`
- `apps/frontend/my-app/app/notifications/notifications-api.ts`
- `apps/frontend/my-app/tests/notifications.test.mjs`

Decision follow-up 2026-09-26 (new):
- `apps/backend/prisma/migrations/20260927030000_notification_reward_earned/migration.sql` (E9-D2)

Decision follow-up 2026-09-26 (modified):
- `packages/schemas/src/notifications/notification.schema.ts`, `notification.schema.spec.ts` (E9-D2)
- `apps/backend/prisma/schema.prisma` (`NotificationType.REWARD_EARNED`)
- `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts`, `reward-settlement.coordinator.spec.ts` (E9-D2 producer)
- `apps/backend/src/modules/participation/application/participation.service.ts` (comment), `participation.service.spec.ts` (E9-D2 tests)
- `apps/backend/src/modules/notifications/application/ports/notification-publisher.port.ts` (E9-D3 delivery guarantee doc)
- `apps/backend/test/participation-submission.e2e-spec.ts`, `apps/backend/test/reward-settlement.e2e-spec.ts` (E9-D2 e2e)
- `apps/frontend/my-app/lib/notification-presentation.ts`, `apps/frontend/my-app/lib/mock/repository.ts`, `apps/frontend/my-app/tests/notifications.test.mjs` (E9-D2 bell + mock)
- `_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md`, `deferred-work.md`, `sprint-status.yaml`

### Change Log

- 2026-09-26: Story created (create-story) and implemented (dev-story): shared notification contracts, Prisma enum/model + migration, Notifications module with publisher port and owner-scoped endpoints, producers for pending release / External pending credit / starter unlock & expiry, mock-first header bell with recent list and mark-as-read, typed live API client, unit + e2e + frontend tests.
- 2026-09-26: Addressed independent review findings (release-notification spoofing, bell loading race, expiry amount, replay re-publish, repository-sourced read timestamps, UUID mock ids). Status → review.
- 2026-09-26: Code review 2026-09-26 (Epic 9): Review Findings written (2 decisions, 9 patch items covering P1/P5/P6/P7/P9–P13, 6 defers; 8 dismissed across the epic); every patch applied with tests (state-gated pending-notice recovery, 7-day recovery window for activation/expiry notices, unknown-type fallback and tolerant live list, bell list/badge consistency, surrogate-safe notification text, bounded offset, publisher-port-only export, Prisma parity spec, story-record corrections). Status → in-progress (decisions E9-D2/E9-D3 open; 375 px QA pending).
- 2026-09-26: Decision follow-up 2026-09-26: E9-D2 (A) — `REWARD_EARNED` for Internal instant credits (enum + migration `20260927030000_notification_reward_earned`, shared types, coordinator producer on submit / replay re-drive / Admin re-drive, bell presentation, mock producer, unit + e2e + frontend tests; FR-57 remainder deferred); E9-D3 (A) — best-effort delivery signed off, Outbox move documented. `verify.sh`: schemas 435/435, backend unit 1516/1516 (100 suites), backend e2e 299 passed / 3 skipped (30 suites), frontend 254/254, typecheck clean, lint clean; `npm run prisma:validate --workspace backend` valid. No unchecked Decision/Patch items remain. Status → done (375 px manual QA still recorded in deferred-work).
