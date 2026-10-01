---
created: 2026-09-30
story_key: ir-4b-profile-update-email-delivery-admin-overview
epic: IR (Integration Readiness)
context:
  - "_bmad-output/planning-artifacts/epics.md#Story IR.4b (L1281-1305), Epic IR dependencies (L1094-1106)"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md (FR-6 L231-239, FR-9 L264-272, FR-35 L548-553, FR-52 L754-760, FR-56 L786-790, FR-57 L794-807, NFR-1, NFR-7, NFR-18, NFR-25, NFR-28, NFR-30, Privacy L1130-1138)"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md (AD-2, AD-5 amendment, AD-7, AD-10, AD-16, AD-17, AD-18, AD-20, AD-21, AD-23, ownership map L209-220, conventions L240-243, open questions L339-340)"
  - "_bmad-output/planning-artifacts/implementation-readiness-report-2026-09-30.md (L325, L373, L391-392, L455, L467, L471, L505, L546, L556, L566, L570)"
  - "_bmad-output/implementation-artifacts/9-6-event-notification-system.md"
  - "_bmad-output/implementation-artifacts/7-1-mandatory-demographic-survey.md"
  - "_bmad-output/implementation-artifacts/7-2-secondary-deep-onboarding.md"
  - "_bmad-output/implementation-artifacts/1-4-role-based-access-control-rbac-user-management.md"
  - "_bmad-output/implementation-artifacts/8-1-survey-moderation-queue.md"
  - "_bmad-output/implementation-artifacts/deferred-work.md (L62-64, L75, L79, L98, L145, L218, L228, L245, L268, L315, L317)"
  - "_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md (E9-D2, E9-D3, OC2, E8-D3)"
---

# Story IR.4b: Profile Update, Email Delivery and Admin Overview

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Three separable parts.** This story bundles three independent capabilities that IR.4 needs. It is written so it
> can be split without rewriting:
>
> | Part | Scope | Hard dependency | Can start |
> |:--|:--|:--|:--|
> | **A. Profile** | `GET/PATCH /users/me/profile` (FR-9) | IR.1 approves the route (or it stays best-effort) | Immediately |
> | **B. Email** | `EmailSenderPort`, adapters, critical-event email via Outbox (FR-57 email) | **IR.2b Outbox dispatcher merged** | Port, adapters, schema and templates now; handler wiring after IR.2b |
> | **C. Admin overview** | `GET /admin/queue-counts`, `GET /admin/overview` | IR.1 decides which admin queues are in the pilot | Immediately (soft use of Part A `displayName`, with an email fallback) |
>
> The recommended split is IR.4b-1 (A), IR.4b-2 (B) and IR.4b-3 (C). See "Questions / Decisions for Owner" at the end.

## Story

As a User and as an Admin,
I want to edit my profile, receive critical emails, and see what needs my attention,
so that the pilot supports FR-9 profile updates, FR-57 email for critical events and an actionable admin landing page.

## Acceptance Criteria

### Part A — Profile (FR-9)

1. **A1 Shared contract.** `userProfileSchema`, `updateUserProfileSchema`, `userGoalSchema` and their constants live in
   `packages/schemas/src/users/user-profile.schema.ts` (exported from the package root). The frontend service
   `apps/frontend/my-app/lib/profile/profile-service.ts` and the backend controller import the same schemas. A contract
   test proves that the backend response parses with the frontend's schema. The wire field names stay the ones the
   frontend already uses (`displayName`, `birthYear`, `school`, `schoolYear`, `goal`); `school` and `schoolYear` are the
   PRD's "university" and "academic year" (FR-6/FR-9 amendments of 2026-09-26).
2. **A2 Read.** An authenticated user calling `GET /users/me/profile` (and `GET /api/users/me/profile`) receives
   `200 {data: UserProfile, error: null, meta: {}}` for their own account. A user with no stored profile row receives all
   fields `null`, never 404. Unauthenticated callers receive 401.
3. **A3 Update.** `PATCH /users/me/profile` with Session, `X-CSRF-Token` and a JSON body applies a partial update:
   an absent key keeps the stored value, `null` clears it, and a blank string is normalized to `null` for text fields.
   It returns the full updated `UserProfile`. Unknown keys and invalid values return 400 `VALIDATION_ERROR` with zod
   `format()` details. A missing or invalid CSRF token returns 403, and a non-JSON body is rejected by `JsonOnlyGuard`.
4. **A4 Validation.** `displayName` is trimmed, 1–50 characters after trim (`DISPLAY_NAME_MAX = 50`, the same as
   `lib/onboarding/onboarding-answers.ts:70`), with lone surrogates removed and control characters rejected.
   `birthYear` is an integer whose derived age (`currentYear - birthYear`, using an injected clock) lies within
   `DEMOGRAPHIC_AGE_MIN..DEMOGRAPHIC_AGE_MAX` (13..100). `school` is trimmed, 1–200 characters. `schoolYear` is one of
   `SCHOOL_YEAR_VALUES` (`"Năm 1"`, `"Năm 2"`, `"Năm 3"`, `"Năm 4"`, `"Năm 5+"`). `goal` is `EARN | COLLECT | BOTH`.
5. **A5 Demographics unchanged.** The FR-6 matching fields (`age`, `gender`, `location`, `occupation`, `fieldOfStudy`,
   `householdIncome`, `specificInterests`) keep flowing only through `GET/PUT /demographics` and
   `POST /demographics/survey`. A `PUT /demographics` change is visible to the next `GET /marketplace` feed request
   with no cache in between (FR-9 "take effect for future matching immediately"). `PATCH /users/me/profile` never
   writes `demographic_profiles`, and `birthYear` never rewrites the demographic `age`.
6. **A6 Goal is intent only.** Setting or changing `goal` never changes `User.role`, `User.status`, sessions or any
   permission. A test asserts the role is unchanged after `goal: "COLLECT"` on a Respondent and `goal: "EARN"` on a
   Publisher.
7. **A7 Frontend verified.** `profile-service.ts`, `mocks/handlers/profile.ts`, `lib/onboarding/onboarding-answers.ts`
   and `lib/onboarding/onboarding-submit.ts` stop calling the contract ASSUMED. The MSW handler validates with the
   shared schema and returns `VALIDATION_ERROR` (not `PROFILE_INVALID_INPUT`). Onboarding and `/account/profile` keep
   working with MSW both on and off.

### Part B — Email for critical events (FR-57 email)

8. **B1 Port and adapters.** `EmailSenderPort` (framework-free, in `notifications/application/ports`) has at least
   three adapters: `SmtpEmailSender` (portable SMTP through `nodemailer`, not a provider SDK — AD-23),
   `CaptureEmailSender` (in-memory, local and test) and `DisabledEmailSender` (no-op that reports `SKIPPED`).
   `EMAIL_DELIVERY_MODE` in `env.schema.ts` selects the adapter. Production refuses to boot with `capture`.
   `apps/backend/.env.example` and `apps/backend/README.md` document every variable.
9. **B2 Critical types.** `EMAIL_NOTIFICATION_TYPES` in `@rescom/schemas` lists the notification types that also send
   email: `TOPUP_SUCCESS`, `TOPUP_REJECTED`, `ACCOUNT_LOCKED` and `ACCOUNT_UNLOCKED`. `COMPLAINT_RESOLVED` is added only
   when a complaint-resolution producer exists (Story 8.5, Phase 2). No other type sends email.
10. **B3 New producers and types.** `NotificationType` gains `TOPUP_REJECTED`, `ACCOUNT_LOCKED` and `ACCOUNT_UNLOCKED`
    in the Prisma enum, the shared enum and the parity spec. Top-up rejection publishes `TOPUP_REJECTED` instead of
    `WARNING`. `UserAdminService.updateUserStatus` publishes `ACCOUNT_LOCKED` or `ACCOUNT_UNLOCKED` after its
    transaction commits, and only when the status actually changed. Both producers use the existing optional
    `NotificationPublisherPort`.
11. **B4 Queue through the Outbox.** When `NotificationsService.publish` creates (not deduplicates) a notification
    whose type is in `EMAIL_NOTIFICATION_TYPES`, the notification row and one `OutboxEvent`
    (`eventType = "NotificationEmailRequested"`, `idempotencyKey = "notification-email:{notificationId}"`) commit in
    the same notifications-local transaction. A `DUPLICATE` publish writes no Outbox row. The originating domain
    transaction is never extended, blocked or rolled back by email (the publisher is still called after it commits).
12. **B5 Delivery handler.** An IR.2b Outbox handler `notifications.email-delivery` consumes `NotificationEmailRequested`.
    Before calling the provider it commits an `EmailDelivery` attempt (`status = SENDING`, keyed by the event
    idempotency key — AD-10). On success it records `SENT` and the provider message id, together with the
    `ProcessedHandler` row, in one transaction. A definite, retryable failure (connection refused, SMTP 4xx before
    `DATA` is accepted) records `FAILED` and rethrows so the dispatcher retries with backoff and dead-letters after its
    bound. A permanent failure (SMTP 5xx, invalid recipient) records `FAILED` terminally and acknowledges. An ambiguous
    outcome (timeout after `DATA`, or a crash that leaves a `SENDING` row) records `UNCONFIRMED` and is **not** resent
    automatically.
13. **B6 No duplicate email.** For one notification at most one provider send is accepted, including under replay,
    concurrent dispatch of the same event, a crash after claim and a dispatcher retry. Tests prove the invariant with
    `CaptureEmailSender` (unit) and against PostgreSQL (`*.prisma.e2e-spec.ts`).
14. **B7 Privacy and logs.** The Outbox payload holds no email address or message body, only
    `{ notificationId, userId, type }`. The recipient address is resolved at send time through `USER_REPOSITORY_PORT`.
    Templates are Vietnamese, rendered from `type` (not from the English `Notification.message` — deferred-work L63),
    and contain no personal data beyond what the recipient needs; for example, a top-up rejection says "see the reason
    in Rescom" rather than repeating the reason. Logs and `EmailDelivery.lastErrorCode` never contain SMTP credentials,
    the recipient address, the subject or the body; log lines carry `notificationId`, `type`, status and correlation ID.
15. **B8 Local capture.** With `EMAIL_DELIVERY_MODE=capture`, sent emails are observable in tests via
    `CaptureEmailSender.sent()`. For manual QA, SMTP mode pointed at the optional Mailpit service in
    `docker-compose.yml` shows real rendered messages.

### Part C — Admin overview and queue counts

16. **C1 Shared contracts.** `adminQueueCountsSchema` and `adminOverviewSchema` move to
    `packages/schemas/src/admin/admin-overview.schema.ts`. `lib/admin/admin-queue-service.ts` and
    `lib/admin/overview-service.ts` import them, and a contract test covers both routes.
17. **C2 Authorization.** Both routes use `@UseGuards(SessionAuthGuard, RolesGuard)` + `@Roles('ADMIN')`.
    Unauthenticated → 401, non-admin → 403 `FORBIDDEN_RESOURCE`, locked admin → the existing locked response.
18. **C3 Queue counts.** `GET /admin/queue-counts` returns `{ surveys, topUps }`, where `surveys` is the number of
    forms with `status = MODERATION_QUEUE` and `topUps` the number of `TopUpRequest` rows with `status = PENDING`.
    `disputes` and `quality` are optional in the schema and **omitted** by the backend unless IR.1 approved that queue
    and a real backing query exists. They are never returned as `0` to stand in for "not built".
19. **C4 Overview.** `GET /admin/overview` returns `pendingSurveys.count`, `pendingTopUps.{count, points, amountVnd}`
    (sums over PENDING top-ups), `escrow.{points, runningSurveys}` (sum of all `ESCROW`-class ledger account balances;
    count of `PUBLISHED` forms) and `todo` (the oldest `SURVEY_REVIEW` and oldest `TOP_UP` item, each with
    `moreCount = count - 1` and `priority = false`). `openIssues` and `flaggedAccounts` are optional and omitted, and
    `DISPUTE`/`MISSING_CODE` todo items are not emitted, unless IR.1 approved them and a real backing query exists.
20. **C5 Bounded queries.** The overview runs a fixed number of indexed queries (at most 8, independent of data size),
    with no `findMany` without `take` and no load of form versions. `forms` gains an index on `(status, updated_at)`
    through a Forms-owned migration. The response meets NFR-1 (<500 ms) on the seeded pilot dataset.
21. **C6 Context boundaries.** The Admin read service reads other contexts only through ports that those contexts own
    and export (Forms: moderation queue stats; Economy: top-up and escrow stats; Identity: user display labels). No
    cross-context Prisma repository access (AD-16), and `test/architecture.spec.ts` stays green.
22. **C7 Frontend.** The sidebar badge and the overview stat card, todo rows and FraudLog card render only what the
    response contains: a missing `openIssues` hides the "Khiếu nại & báo lỗi mở" card, and a missing
    `flaggedAccounts` hides `FlaggedAccountsCard`. Nav entries for sections IR.1 did not approve are hidden through one
    constant (`ADMIN_PILOT_SECTIONS` in `components/layout/admin/admin-nav.ts`), following the `PAUSE_SUPPORTED`
    pattern.

### Cross-cutting

23. **X1** Every new route uses `createSuccessEnvelope`, is mounted at both `x` and `api/x`, and has tests for
    unauthenticated, forbidden (where relevant), validation and success. New exceptions are mapped in
    `http-exception.filter.ts`.
24. **X2** Tests cover validation, authorization, the email adapter contract (one shared suite run against every
    adapter) and the no-duplicate-email invariant. Backend unit, e2e, schemas and frontend suites pass, and
    `npm run prisma:validate --workspace backend` succeeds.

## Tasks / Subtasks

### Part A — Profile

- [ ] **A-T1 Shared schema** (AC: A1, A4)
  - [ ] Create `packages/schemas/src/users/user-profile.schema.ts` with `USER_GOALS`, `userGoalSchema`,
        `USER_PROFILE_DISPLAY_NAME_MAX = 50`, `USER_PROFILE_SCHOOL_MAX = 200`, `SCHOOL_YEAR_VALUES`,
        `userProfileSchema` (response, `.strict()`, `schoolYear` as `z.string().nullable()` so it tolerates catalog
        changes), `updateUserProfileSchema` (request, `.strict()`, all keys `.optional()` and `.nullable()`; text
        transforms trim → `removeLoneSurrogates` → blank-to-null) and `isBirthYearAllowed(year, currentYear)` built on
        `DEMOGRAPHIC_AGE_MIN/MAX`. Reuse `packages/schemas/src/common/unicode-text.ts`; do not write a new sanitizer.
  - [ ] Export it from `packages/schemas/src/users/index.ts`.
  - [ ] `user-profile.schema.spec.ts`: blank → null, 50/51 characters, control characters, unknown key, bad enum,
        `null` clears, `{}` accepted (no-op), and birth-year age bounds at 13 and 100.
- [ ] **A-T2 Persistence (Identity-owned)** (AC: A2, A3, A5)
  - [ ] `apps/backend/prisma/schema.prisma`: add `enum UserGoal { EARN COLLECT BOTH }` and a `UserProfile` model
        (`userId` PK/FK → `users.id` `onDelete: Cascade`, `displayName VARCHAR(50)?`, `birthYear Int?`,
        `school VARCHAR(200)?`, `schoolYear VARCHAR(20)?`, `goal UserGoal?`, timestamps, `@@map("user_profiles")`),
        plus `profile UserProfile?` on `User`. Doc comment: "FR-9 amendment 2026-09-26: `school` = university,
        `schoolYear` = academic year; not matching fields."
  - [ ] Hand-written, re-runnable migration `apps/backend/prisma/migrations/20260930xxxxxx_user_profiles/migration.sql`
        using the 9.6 style (`CREATE TYPE` guarded by `duplicate_object`, `CREATE TABLE IF NOT EXISTS`, FK with
        `ON DELETE CASCADE`). Keep `test/migration-chain.spec.ts` green.
- [ ] **A-T3 Application + adapters** (AC: A2–A6)
  - [ ] `apps/backend/src/modules/users/application/ports/user-profile.repository.port.ts`:
        `USER_PROFILE_REPOSITORY_PORT`, `findByUserId(userId)`, `upsertPartial(userId, patch)`, and
        `findDisplayLabels(userIds): Map<userId, displayName | null>` for Part C.
  - [ ] `users/infrastructure/prisma-user-profile.repository.ts`: `upsert` with `update` containing only the provided
        keys (atomic `INSERT … ON CONFLICT DO UPDATE`; unlike `demographic_profiles`, no JSON packing, so no
        read-merge-write lock is needed). Add `in-memory-user-profile.repository.ts`.
  - [ ] `users/application/user-profile.service.ts` (framework-free, injected `clock`): `getOwnProfile`,
        `updateOwnProfile`. It validates `birthYear` against the clock's year, throws `UserProfileValidationException`
        (`code = 'VALIDATION_ERROR'`, 400) for an out-of-range year, and never touches role, status or demographics.
  - [ ] Register the port and service in `users/users.module.ts` and export them.
- [ ] **A-T4 HTTP** (AC: A2, A3, X1)
  - [ ] `users/presentation/user-profile.controller.ts`: `@Controller(['users/me/profile', 'api/users/me/profile'])`,
        class-level `@UseGuards(SessionAuthGuard)`, `GET`, and `PATCH` with `@HttpCode(200)`,
        `@UseGuards(CsrfGuard, JsonOnlyGuard)` and `@UsePipes(new ZodValidationPipe(updateUserProfileSchema))`.
        Copy `demographics.controller.ts` exactly.
  - [ ] **Module placement:** `AuthModule` imports `UsersModule` (`auth.module.ts:60`), so the controller cannot be
        registered in `UsersModule` without a cycle. This is why `DemographicsController` sits in `MarketplaceModule`.
        Create `users/user-profile-http.module.ts` (imports `AuthModule` and `UsersModule`, `controllers:
        [UserProfileController]`) and add it to `app.module.ts`.
  - [ ] Map `UserProfileValidationException` in `common/http/http-exception.filter.ts`.
- [ ] **A-T5 Backend tests** (AC: A2–A6, X1)
  - [ ] `user-profile.service.spec.ts` (clock, partial semantics, role untouched),
        `user-profile.controller.spec.ts`, `prisma-user-profile.repository.spec.ts` (mirror
        `prisma-demographic-profile.repository.spec.ts`).
  - [ ] `apps/backend/test/user-profile.e2e-spec.ts`: 401, 403 without CSRF, 400 unknown key, `null` clears, blank →
        null, no-row → all null, goal does not change role (read `GET /auth/me` after), and demographics untouched.
  - [ ] Extend `test/demographic-onboarding.e2e-spec.ts` or `marketplace-feed.e2e-spec.ts`: after `PUT /demographics`
        changes location, the next feed request matches with the new value (A5).
- [ ] **A-T6 Frontend** (AC: A1, A7)
  - [ ] `lib/profile/profile-service.ts`: import the schemas from `@rescom/schemas`, remove the "ASSUMED" doc and the
        local zod definitions. Keep the 404 → `null` tolerance for now (SessionProvider and onboarding treat the
        profile as best-effort) and note that IR.5 removes it.
  - [ ] `mocks/handlers/profile.ts`: use the shared `updateUserProfileSchema`; error code `VALIDATION_ERROR`; normalize
        blank to null like the backend.
  - [ ] Update the "ASSUMED" comments in `lib/onboarding/onboarding-answers.ts` (L21, L25, L187),
        `lib/onboarding/onboarding-submit.ts` (L7), `lib/demographic-options.ts` (L176),
        `app/(signed-in)/(focus)/onboarding/hooks/use-onboarding-flow.ts` (L57) and
        `app/(signed-in)/(app)/account/hooks/use-account-data.ts` (L15). Make `OnboardingGoal` an alias of the shared
        `UserGoal`, and derive `SCHOOL_YEAR_OPTIONS` values from `SCHOOL_YEAR_VALUES`.
  - [ ] Tests: extend `tests/onboarding-flow.test.mjs` / `tests/account-view.test.mjs` so `toProfilePatch` output
        parses with `updateUserProfileSchema`, and add a contract test that a backend-shaped response parses with
        `userProfileSchema`.

### Part B — Email

- [ ] **B-T1 Shared contracts** (AC: B2, B3, B7)
  - [ ] `packages/schemas/src/notifications/notification.schema.ts`: append `TOPUP_REJECTED`, `ACCOUNT_LOCKED` and
        `ACCOUNT_UNLOCKED` to `NOTIFICATION_TYPES` (append at the end, in the same order as the Prisma enum).
  - [ ] New `packages/schemas/src/notifications/email-delivery.schema.ts`: `EMAIL_NOTIFICATION_TYPES`,
        `isEmailNotificationType(type)`, `NOTIFICATION_EMAIL_REQUESTED_EVENT = 'NotificationEmailRequested'`,
        `notificationEmailRequestedPayloadSchema` (`{ schemaVersion: 1, notificationId: uuid, userId: uuid, type }`,
        `.strict()`), `notificationEmailKey(notificationId)` → `notification-email:{id}`, and the
        `EMAIL_DELIVERY_STATUSES` enum. Add a spec.
  - [ ] Keep `topUpRejectionKey` (`packages/schemas/src/economy/top-up.schema.ts` L39) unchanged: the dedupe key stays
        `topup-rejection:{id}`; only the notification type changes.
- [ ] **B-T2 Persistence (Notifications-owned: "channel delivery attempt/status", spine L216)** (AC: B3, B5, B6)
  - [ ] `schema.prisma`: append the three values to `enum NotificationType`; add
        `enum EmailDeliveryStatus { SENDING SENT FAILED UNCONFIRMED SKIPPED }` and model `EmailDelivery` (`id`,
        `idempotencyKey @unique`, `notificationId @unique @db.Uuid`, `userId @db.Uuid`, `notificationType`,
        `status`, `attempts Int @default(0)`, `providerMessageId String?`, `lastErrorCode String?` (a code, never
        raw provider text), `sendingStartedAt`, `sentAt`, timestamps, `@@index([status, updatedAt])`,
        `@@map("email_deliveries")`). Store no recipient address (minimization, AD-21).
  - [ ] Migration `20260930xxxxxx_email_delivery`: `ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS …` (one per
        value, in a migration that does not also use them) and a guarded table/enum creation. Update
        `notifications/infrastructure/notification-type.parity.spec.ts`.
- [ ] **B-T3 Port and adapters** (AC: B1, B8)
  - [ ] `notifications/application/ports/email-sender.port.ts`: `EMAIL_SENDER_PORT`;
        `send(message: OutboundEmail): Promise<EmailSendResult>`, where `OutboundEmail = { to, subject, text, html,
        idempotencyKey, headers? }` and `EmailSendResult = { outcome: 'ACCEPTED', providerMessageId } |
        { outcome: 'RETRYABLE', code } | { outcome: 'PERMANENT', code } | { outcome: 'AMBIGUOUS', code } |
        { outcome: 'SKIPPED' }`; plus `readonly supportsIdempotentResend: boolean`. The file must not contain the word
        "adapter" (`test/architecture.spec.ts` rejects `/adapter/i` under `application/`).
  - [ ] `notifications/infrastructure/smtp-email-sender.ts` (nodemailer; `createTransport({ host, port, secure,
        requireTLS: !secure, auth, connectionTimeout, greetingTimeout, socketTimeout })`). Set a deterministic
        `Message-ID: <{idempotencyKey}@{EMAIL_MESSAGE_ID_DOMAIN}>`. Classify errors: `ECONNREFUSED`/`ETIMEDOUT` before
        the envelope, or `responseCode` 4xx → `RETRYABLE`; 5xx → `PERMANENT`; socket timeout after `DATA` →
        `AMBIGUOUS`. `supportsIdempotentResend = false`.
  - [ ] `notifications/infrastructure/capture-email-sender.ts` (in-memory `sent()`, `clear()`, programmable
        outcomes for tests) and `disabled-email-sender.ts` (`SKIPPED`).
  - [ ] Module factory in `notifications.module.ts` picks the adapter from `EnvService.emailDeliveryMode`.
  - [ ] Dependencies: add `nodemailer` to `apps/backend/package.json` (current stable is 10.0.x as of 2026-09-30; it
        ships its own types, so check whether `@types/nodemailer` is still needed at install time).
- [ ] **B-T4 Configuration** (AC: B1, B7)
  - [ ] `apps/backend/src/common/config/env.schema.ts`: `EMAIL_DELIVERY_MODE` (`disabled | capture | smtp`, default
        `capture` outside production), `EMAIL_FROM`, `EMAIL_REPLY_TO` (optional), `EMAIL_APP_BASE_URL` (HTTPS in
        production, e.g. `https://app.rescom.com.vn`), `EMAIL_MESSAGE_ID_DOMAIN`, `SMTP_HOST`, `SMTP_PORT` (default
        587), `SMTP_SECURE` (`booleanEnv(false)`), `SMTP_USERNAME`, `SMTP_PASSWORD`, `EMAIL_SEND_TIMEOUT_MS` (default
        10000). In `superRefine`: in production, `capture` is rejected; `smtp` requires host, port, from, username and
        password; `EMAIL_APP_BASE_URL` must be HTTPS and its origin must be in `FRONTEND_ORIGINS`. Whether production may
        run with `disabled` is an owner decision (see Questions); until decided, reject it.
  - [ ] Typed getters in `env.service.ts` + `env.service.spec.ts` cases.
  - [ ] `apps/backend/.env.example`: add a "Mail" section with safe placeholders only. `README.md`: document the
        provider, the modes, Mailpit and the secret-handling rule (AD-23: secrets through the environment only).
  - [ ] `docker-compose.yml`: optional `mailpit` service (SMTP 1025, UI 8025), used only locally.
- [ ] **B-T5 Queue on publish** (AC: B4)
  - [ ] Extend `NotificationRepositoryPort` with
        `createIfAbsentWithEmailRequest(record, event): Promise<{ created: boolean; notificationId }>`. The Prisma
        adapter runs one local `$transaction`: `INSERT … ON CONFLICT DO NOTHING RETURNING id`; only if a row was
        inserted, `tx.outboxEvent.create` with `producer = 'notifications-service'`, `aggregateType = 'Notification'`,
        `aggregateId = notificationId`, `correlationId` when known. It still never joins the caller's ambient
        transaction (9.6 AC3.4). Add the in-memory equivalent with an `outboxEvents` array.
  - [ ] `NotificationsService.publish`: use the new method when `isEmailNotificationType(type)` and the mode is not
        `disabled`; otherwise keep the current path. The result contract (`CREATED | DUPLICATE | FAILED`, never
        throws) is unchanged.
- [ ] **B-T6 Producers** (AC: B3)
  - [ ] `economy/application/top-up.service.ts` L405-416: rejection publishes `TOPUP_REJECTED` (same dedupe key).
  - [ ] `users/application/user-admin.service.ts`: add an optional `NotificationPublisherPort` constructor argument.
        After `transactionPort.run` returns an effective change (not the no-op branch), publish `ACCOUNT_LOCKED` or
        `ACCOUNT_UNLOCKED` with `dedupeKey = account-status:{targetUserId}:{changeId}`, where `changeId` is a UUID the
        service generates for that change and also writes into the `USER_STATUS_CHANGED` audit metadata. Wrap the
        publish so a failure never changes the HTTP result. Wire `{ token: NOTIFICATION_PUBLISHER_PORT, optional:
        true }` in the factory in `admin/admin.module.ts` L32-37.
  - [ ] A locked user cannot sign in to read the in-app notice, so the email is the only channel that reaches them.
        The template must not tell them to "open the app"; it points to support (`EMAIL_REPLY_TO`).
- [ ] **B-T7 Delivery handler (after IR.2b)** (AC: B5, B6, B7)
  - [ ] `notifications/application/email-delivery.handler.ts` (framework-free), registered with the IR.2b handler
        registry under `notifications.email-delivery` for `NotificationEmailRequested`. Steps: parse the payload with
        the shared schema → load or create the `EmailDelivery` row by key → if `SENT`, `SKIPPED`, `UNCONFIRMED` or
        terminal `FAILED`, acknowledge → if `SENDING` and `!supportsIdempotentResend`, mark `UNCONFIRMED` and
        acknowledge → resolve the recipient with `USER_REPOSITORY_PORT.findById` (missing user → `SKIPPED`) → commit
        `SENDING`, `attempts + 1` → render → `send` → record the outcome as in AC B5 (the `SENT` update and the
        `ProcessedHandler` insert in one transaction, per IR.2b's handler contract).
  - [ ] `notifications/application/email-templates.ts`: pure Vietnamese subject/text/html per type, with HTML-escaped
        interpolation and links built from `EMAIL_APP_BASE_URL` (`/wallet` for top-ups; no link for
        `ACCOUNT_LOCKED`). No names, amounts or reasons in the body unless the owner approves them.
  - [ ] Delivery repository port + Prisma/in-memory adapters (`email-delivery.repository.port.ts`,
        `prisma-email-delivery.repository.ts`). The dispatcher's retry/backoff/dead-letter settings come from IR.2b;
        do not build a second retry loop.
  - [ ] If IR.2b is not merged yet: finish B-T1 to B-T6 and the handler with its unit tests, driven by a direct
        test harness. Leave registration as the only open subtask and keep the story `in-progress`. Do not write an
        ad-hoc poller.
- [ ] **B-T8 Tests** (AC: B1–B8, X2)
  - [ ] `notifications/infrastructure/email-sender.contract.ts`: one shared suite (accepted, retryable, permanent,
        ambiguous, idempotency key carried) run by `capture-email-sender.spec.ts` and `smtp-email-sender.spec.ts`
        (nodemailer `streamTransport`/`jsonTransport` or a stub SMTP server; no network in unit tests).
  - [ ] `email-delivery.handler.spec.ts`: replay after `SENT` sends nothing; `SENDING` → `UNCONFIRMED` with no send;
        retryable → rethrow + `FAILED`; permanent → acknowledge; missing user → `SKIPPED`; payload with extra keys →
        rejected.
  - [ ] `notifications.service.spec.ts`: critical type → one notification + one Outbox row; `DUPLICATE` → no Outbox
        row; non-critical type → no Outbox row; mode `disabled` → no Outbox row.
  - [ ] `top-up.e2e-spec.ts`: rejection notification type is `TOPUP_REJECTED`. `admin-users.e2e-spec.ts`: lock and
        unlock publish once; a repeated same-status PATCH publishes nothing.
  - [ ] `test/email-delivery.prisma.e2e-spec.ts`: two concurrent dispatches of one event → exactly one
        `CaptureEmailSender` send and one `SENT` row; crash simulation (a `SENDING` row left behind) → `UNCONFIRMED`,
        zero extra sends.
  - [ ] A log-capture assertion: no recipient address, SMTP password or body in any log line from the handler/adapters.
- [ ] **B-T9 Frontend** (AC: B3)
  - [ ] `lib/notifications/notification-presentation.ts` and `notification-messages.ts`: add entries for
        `TOPUP_REJECTED` (danger, `/wallet`), `ACCOUNT_LOCKED` and `ACCOUNT_UNLOCKED`. Keep the legacy `WARNING`
        top-up topic parsing for rows created before this change.
  - [ ] MSW (`mocks/handlers/notifications.ts`, `mocks/data/admin-top-ups.ts`): the mock top-up rejection emits
        `TOPUP_REJECTED`. Tests in `tests/notifications.test.mjs` / `notification-center.test.mjs`.

### Part C — Admin overview

- [ ] **C-T1 Shared contract** (AC: C1, C3, C4)
  - [ ] Create `packages/schemas/src/admin/admin-overview.schema.ts` by moving `adminQueueCountsSchema`,
        `adminTodoItemSchema`, `flaggedAccountSchema` and `adminOverviewSchema` from the frontend files unchanged,
        except that `disputes`, `quality`, `openIssues` and `flaggedAccounts` become `.optional()`. Export it from
        `admin/index.ts` and the package root. Add a spec.
- [ ] **C-T2 Owning-context stats ports** (AC: C5, C6)
  - [ ] Forms: `forms/application/ports/moderation-queue-stats.port.ts` (`countQueued()`, `oldestQueued()` →
        `{ formId, title, type, publisherId, submittedAt } | null`, `countPublished()`), implemented in
        `forms/infrastructure/prisma-moderation-queue-stats.ts` with `count` and `findFirst({ orderBy: [{ updatedAt:
        'asc' }, { id: 'asc' }], select })`, the same order as `findModerationQueue`
        (`prisma-form.repository.ts:521-548`) but **without** `include: { versions }`. Export the token from
        `forms.module.ts`.
  - [ ] Forms migration: `@@index([status, updatedAt])` on `Form` (`20260930xxxxxx_forms_status_index`).
  - [ ] Economy: `economy/application/ports/admin-economy-stats.port.ts` (`pendingTopUpSummary()` → `{ count, points,
        amountVnd }` via one `aggregate({ _count, _sum: { amount, amountVnd }, where: { status: 'PENDING' } })`;
        `oldestPendingTopUp()` via `findFirst` on the `[status, createdAt]` index; `escrowTotal()` via
        `ledgerAccount.aggregate({ _sum: { balance }, where: { accountClass: 'ESCROW' } })`). Export it from
        `economy.module.ts`.
  - [ ] Identity: labels come from `USER_REPOSITORY_PORT.findById` (email) and Part A's
        `USER_PROFILE_REPOSITORY_PORT.findDisplayLabels` (display name). The label is `displayName ?? email`, because
        the frontend schema requires `min(1)`. Without Part A merged, use the email.
- [ ] **C-T3 Admin service + controller** (AC: C2–C6)
  - [ ] `admin/application/admin-overview.service.ts` (framework-free): `getQueueCounts()` and `getOverview()`. It
        runs the port calls in `Promise.all` and builds the todo items (`moreCount = max(0, count - 1)`,
        `priority: false`). Approved optional queues come from `ADMIN_OPTIONAL_QUEUES` (a constant, empty for the
        pilot unless IR.1 approves one) and are never filled with placeholders.
  - [ ] `admin/presentation/admin-overview.controller.ts`: `@Controller(['admin', 'api/admin'])`,
        `@UseGuards(SessionAuthGuard, RolesGuard)`, `@Roles('ADMIN')`, `@Get('queue-counts')`, `@Get('overview')`,
        `createSuccessEnvelope`.
  - [ ] `admin/admin.module.ts`: import `FormsModule` and `EconomyModule` (neither imports `AdminModule`, so no
        cycle), register the controller and provide the service by factory.
- [ ] **C-T4 Tests** (AC: C2–C6, X2)
  - [ ] `admin-overview.service.spec.ts` with in-memory ports: empty queues → zeros and empty `todo`; `moreCount`;
        optional fields absent; the label fallback; the number of port calls per request is constant.
  - [ ] `test/admin-overview.e2e-spec.ts`: 401, 403 for a Respondent and a Publisher, 200 for an Admin; the
        response parses with the shared schema; `disputes`/`quality`/`openIssues`/`flaggedAccounts` are absent.
  - [ ] Optional `test/admin-overview.prisma.e2e-spec.ts`: seeded counts and sums match the ledger/top-up tables.
- [ ] **C-T5 Frontend** (AC: C1, C7)
  - [ ] `lib/admin/admin-queue-service.ts` and `lib/admin/overview-service.ts`: import the shared schemas and replace
        "ASSUMED" with "VERIFIED".
  - [ ] `lib/admin/overview-view.ts` `statCardsOf`: skip the issues card when `openIssues` is absent.
        `app/(signed-in)/(admin)/admin/components/OverviewScreen.tsx`: render `FlaggedAccountsCard` only when
        `flaggedAccounts` is present (the grid becomes one column).
  - [ ] `components/layout/admin/admin-nav.ts`: `ADMIN_PILOT_SECTIONS` filters `ADMIN_NAV` to the sections IR.1
        approved. `AdminShell.tsx` already shows no badge for an `undefined` count; keep that behaviour.
  - [ ] MSW (`mocks/handlers/admin.ts`, `mocks/data/admin-overview.ts`): omit the unapproved optional fields so mock and
        real responses match.
  - [ ] `tests/admin-overview.test.mjs`: cases for absent `openIssues`/`flaggedAccounts` and a schema parse of a
        backend-shaped payload. Add an `admin-nav` filter test.

## Dev Notes

### Current state (read before changing anything)

**Frontend profile contract** — `apps/frontend/my-app/lib/profile/profile-service.ts` (ASSUMED):

| Field | Frontend type | Written by | Read by | Backend today | This story |
|:--|:--|:--|:--|:--|:--|
| `displayName` | `string \| null` | onboarding step `name` (`toProfilePatch`, trimmed, max 50) | `SessionProvider` header name (falls back to the email local part), `/account/profile` | **absent** (the `User` model has no name) | `user_profiles.display_name` |
| `birthYear` | `int \| null` | onboarding `birth-year` | `answersFromServer` prefill (falls back to `currentYear - demographics.age`) | only `demographic_profiles.age` (integer, never advances — deferred DF10) | `user_profiles.birth_year`; `age` stays the matching field |
| `school` | `string \| null` | onboarding 12.6 (students only; `null` for non-students) | `/account/profile` "Trường" | **absent** | `user_profiles.school` (= PRD "university") |
| `schoolYear` | `string \| null` | onboarding 12.7 (`SCHOOL_YEAR_OPTIONS`) | "Năm học" | **absent** (deferred-work L98 / OC2) | `user_profiles.school_year` (= PRD "academic year") |
| `goal` | `EARN \| COLLECT \| BOTH \| null` | onboarding 12.11 (`GOAL_LABELS`) | "Mục tiêu" | **absent** | `user_profiles.goal` enum |

- Callers: `SessionProvider.tsx:89` (best-effort `Promise.allSettled`), `use-onboarding-flow.ts:89` (prefill,
  `.catch(() => null)`), `use-onboarding-flow.ts:170` (`submitOnboarding` → `PATCH` after the VERIFIED
  `POST /demographics/survey`; a profile failure is logged but never blocks onboarding, and a 404 is silent).
- `/account/profile` (`app/(signed-in)/(app)/account/profile/page.tsx` → `ProfileScreen`) has **no per-field
  editor**. "Sửa" reopens the onboarding question (`profileEditHref` in `lib/profile/account-view.ts`), and "Hoàn tất"
  re-submits the whole survey plus the whole profile patch. So `PATCH` receives full objects in practice, but it must
  still honour partial semantics.
- The same screen also calls the ASSUMED `GET /engagement/me`, `GET /integrity/consent` and
  `GET /integrity/reliability/me` (`use-account-data.ts`). **They are not part of this story.** IR.1/IR.5 must approve
  or hide them.
- MSW: `mocks/handlers/profile.ts` stores profiles in `createCollection("user-profiles")`, applies scenario
  `"profile"`, requires CSRF on PATCH, and uses error code `PROFILE_INVALID_INPUT`. That code exists nowhere else in
  the repo, so switching it to `VALIDATION_ERROR` is safe.

**Backend users module** — `apps/backend/src/modules/users/`:

- There are no `/users/*` routes. `DemographicsController` (`GET /demographics`, `PUT /demographics`,
  `POST /demographics/survey`) is registered in `marketplace/marketplace.module.ts:25`, because `AuthModule` imports
  `UsersModule` and the guards need `AuthModule`.
- `DemographicProfile` (`schema.prisma` L370-384) has only `age`, `location`, `householdIncome` and
  `specificInterests`. Gender, occupation, fieldOfStudy and interests are packed into the `specific_interests` JSON
  (`prisma-demographic-profile.repository.ts`, read-merge-update under `SELECT … FOR UPDATE`, Epic 7 P6). **Do not add
  the new fields to that JSON or that table**: they are not matching fields (AC says non-demographic), and a separate
  table avoids the lock and the packing.
- `DemographicsService.updateProfile` triggers `StarterPointsCoordinator.tryUnlockStarterPoints`. The profile service
  must not.
- Nothing in `schema.prisma`, `packages/schemas` or `apps/backend/src` mentions university, academic year, school,
  goal or display name today (verified by grep).

**Notifications** — `apps/backend/src/modules/notifications/` (Story 9.6):

- `NotificationPublisherPort.publish(command) → 'CREATED' | 'DUPLICATE' | 'FAILED'` never throws, is idempotent on
  `(userId, dedupeKey)` and is called **after** the source transaction commits (decision E9-D3: best-effort,
  at-most-once). `NotificationsModule` is `@Global()` and exports only `NOTIFICATION_PUBLISHER_PORT`; other modules
  must not import the repository or service (`test/architecture.spec.ts`).
- `PrismaNotificationRepository.createIfAbsent` uses `createMany({ skipDuplicates: true })` on the base client, never
  the ambient Unit of Work.
- Current producers: see the table below. **Ban/unban publishes nothing** (`UserAdminService.updateUserStatus` writes
  only `identity_audit_logs` and revokes sessions on LOCKED). **No complaint/dispute model exists** (Story 8.5 is
  deferred and economy binds `NoExternalDisputeHolds`).

| Event | Source | Type today | dedupeKey | Email in this story |
|:--|:--|:--|:--|:--|
| Top-up approved | `economy/application/top-up.service.ts` L396-403 | `TOPUP_SUCCESS` | `topup-approval:{id}` | yes |
| Top-up rejected | `top-up.service.ts` L405-416 | `WARNING` | `topup-rejection:{id}` | yes, with type changed to `TOPUP_REJECTED` |
| Account locked / unlocked | `users/application/user-admin.service.ts` L37-145 | — (none) | — | yes; new producer, `ACCOUNT_LOCKED` / `ACCOUNT_UNLOCKED` |
| Complaint resolved | — (Story 8.5, Phase 2) | — | — | no producer, so no email (list is extensible) |
| Survey approved/rejected, rewards, starter points | moderation / economy / participation | various | various | no (not "critical" per FR-57) |

- `WARNING` is also used for starter-point expiry, and the frontend tells the two apart by message text
  (`notification-presentation.ts` L38-74). Email criticality therefore cannot key on `WARNING`, which is why the story
  adds `TOPUP_REJECTED`.
- The frontend notification item schema accepts any string `type` (`lib/notifications/notification-service.ts:19`),
  so new enum values do not break parsing. Presentation entries are still needed.

**Outbox** — `OutboxEvent` (L751-781) has idempotencyKey (unique), claim owner/fencing token/expiry, attempts,
availableAt, lastError, terminalState and `@@index([status, availableAt])`. `ProcessedHandler` (L783-792) has
`@@unique([handlerName, eventId])` and is **unused**. There is **no dispatcher, poller or handler registry** (only two
`setInterval`s: system metrics and storage cleanup; `@nestjs/schedule` is not installed). Writers call
`tx.outboxEvent.create` inside `runInTransaction` per repository, with no shared helper. **IR.2b adds the dispatcher;
Part B registers into it and must not build its own.**

**Admin** — frontend contracts (ASSUMED):

`GET /admin/queue-counts` (`lib/admin/admin-queue-service.ts`, consumed by `components/layout/admin/AdminShell.tsx:46`
for sidebar badges):

| Field | Meaning (frontend doc) | Backend source | Pilot |
|:--|:--|:--|:--|
| `surveys` | forms in `MODERATION_QUEUE` | `forms.status` (**no index today**) | return |
| `topUps` | `PENDING` top-ups | `top_up_requests` `@@index([status, createdAt])` | return |
| `disputes` | open disputes + missing-code reports | **none** (no case table; `SurveyAttempt.missingCodeReportedAt` has no admin read path) | omit unless IR.1 approves and a query is built |
| `quality` | rewards held for quality review | **none** (Epic 10 / `/admin/quality-reviews` ASSUMED) | omit |

`GET /admin/overview` (`lib/admin/overview-service.ts`, consumed by `app/(signed-in)/(admin)/admin/hooks/use-admin-overview.ts`):

| Field | Type | Backend computation | Pilot |
|:--|:--|:--|:--|
| `pendingSurveys.count` | int ≥ 0 | `count(forms where status=MODERATION_QUEUE)` | return |
| `pendingTopUps.count` / `.points` / `.amountVnd` | int ≥ 0 | one `aggregate` over PENDING (`amount`, `amountVnd`) | return |
| `openIssues.disputes` / `.missingCodeReports` | int ≥ 0 | none | omit (optional) |
| `escrow.points` | int ≥ 0 | `SUM(ledger_accounts.balance) WHERE account_class='ESCROW'` (ledger truth; the per-publisher account also holds escrow of queued forms) | return |
| `escrow.runningSurveys` | int ≥ 0 | `count(forms where status=PUBLISHED)` | return |
| `todo[]` `SURVEY_REVIEW` | `{id=formId, createdAt=submittedAt(form.updatedAt), moreCount, priority=false, surveyTitle, publisherName, surveyType}` | oldest queued form + publisher label | return when the queue is non-empty |
| `todo[]` `TOP_UP` | `{id, createdAt, moreCount, priority=false, points=amount, amountVnd, requesterName, transferReference}` | oldest PENDING top-up + requester label | return when non-empty |
| `todo[]` `DISPUTE` / `MISSING_CODE` | — | none | never emitted |
| `flaggedAccounts[]` | FraudLog summaries | `FraudLog` has no admin read route (`/admin/fraud-log` ASSUMED) | omit (optional) |

- The mock composes the same fields in `mocks/data/admin-overview.ts` (`buildAdminOverview`) and `mocks/handlers/admin.ts`
  (`requireMockAdmin` mirrors `RolesGuard`).
- The stat-card caption "Trên các khảo sát đang chạy" slightly overstates what the ledger escrow total covers (it
  includes forms waiting for moderation). Keep the number ledger-true; the copy is a UX note for the owner, not a
  backend change.
- Existing admin routes: `admin/moderation/surveys` (`moderation/presentation/admin-moderation.controller.ts`),
  `admin/top-ups` (`economy/presentation/admin-top-up.controller.ts`), `admin/users`, `admin/audit-logs`
  (`admin/presentation/*`). Every one uses class-level `SessionAuthGuard, RolesGuard` + `@Roles('ADMIN')` and dual
  paths. There is no existing overview, stats or dashboard endpoint (`GET /system/metrics` is CPU/memory only).
- `FormModerationCommands.listQueue` loads every version per form (`include: { versions }`). **Do not reuse it for
  counts**; add the dedicated stats port.

### Implementation deviation (Part B, 2026-10-01)

- **B5 transaction boundary:** the `SENT` outcome (like `SENDING` before the call) is committed by
  `PrismaEmailDeliveryRepository` on its own, not in the same transaction as the `processed_handlers` row. The
  handler is kind (b) (`runsOutsideTransaction`): an SMTP call held inside the dispatcher's interactive transaction
  could outlive the transaction timeout and roll back a send that already happened. Correctness does not depend on
  the shared commit: a replay finds `SENT` (or `UNCONFIRMED`/terminal `FAILED`) by the idempotency key and
  acknowledges without sending. A `SENDING` row younger than 3× `EMAIL_SEND_TIMEOUT_MS` is retried later (it may be
  in flight); an older one is treated as abandoned and becomes `UNCONFIRMED`. The SMTP sender enforces one hard
  deadline per send (`AMBIGUOUS:DEADLINE`).

### Architecture guardrails

- **AD-2 / NFR-18:** one Zod schema per boundary, in `packages/schemas`, imported by both sides; contract tests.
- **AD-7:** domain/application code imports no NestJS, Prisma, nodemailer or HTTP. Email is explicitly a mandatory
  port boundary. `test/architecture.spec.ts` also rejects the word "adapter" in `application/` files.
- **AD-10 (email-specific):** "Before an external call, the adapter persists an attempt with the event idempotency
  key; retry reuses that key and reconciles provider status/result before acknowledgment. An irreversible provider
  without idempotency or status reconciliation is not an approved adapter." SMTP has neither. This story's
  compliance position is: persist `SENDING` before the call, and **never resend an ambiguous attempt** (it becomes
  `UNCONFIRMED`). That gives at-most-once for ambiguous cases and bounded retries only for definite failures. An
  architect must sign it off (see Questions), or the provider must be one with an HTTP idempotency key (then
  `supportsIdempotentResend = true`).
- **AD-16:** Admin reads through ports owned by Forms and Economy; migrations only in the owning context (the Forms
  index belongs to Forms, `user_profiles` to Identity, `email_deliveries` to Notifications).
- **AD-17:** the email handler's backlog and dead letters are visible through IR.2b's readiness/metrics, with no
  payload leakage.
- **AD-18:** no generic Prisma serialization; map rows to the shared DTOs explicitly.
- **AD-20:** PATCH requires `X-CSRF-Token` + exact origin (`CsrfGuard`); the admin role is privileged authorization.
- **AD-21:** the email provider is a new **personal-data processor** (it receives addresses). It must be added to the
  processing register/processor inventory before production (OQ-17 gate). Profile fields are personal data: do not log
  values.
- **AD-23:** portable interfaces only. SMTP credentials come from environment variables; no provider SDK, no in-code
  secret reads. Google Cloud blocks outbound port 25, so use 587 (STARTTLS) or 465 (TLS).
- **Conventions:** `{data,error,meta}` via `createSuccessEnvelope` (no interceptor); domain exceptions are `Error`
  subclasses with `readonly code`, mapped in the `instanceof` chain of `common/http/http-exception.filter.ts`;
  `ZodValidationPipe(schema, 'VALIDATION_ERROR', target)`; framework-free services wired with `useFactory` + `inject`;
  optional cross-context ports via `{ token, optional: true }`.

### Library / framework

- NestJS 10.4, Prisma 6.0.0 (exact), zod ^3.24 (schemas/backend) and ^3.25 (frontend), Jest 29 (backend + schemas),
  `node --test tests/*.test.mjs` (frontend), Next.js app router + MSW.
- New: `nodemailer` (latest 10.0.x as of 2026-09-30; bundles its own type declarations). Nothing else. No
  `@nestjs/schedule` (IR.2b owns scheduling), no provider SDK, no templating engine (plain TypeScript template
  functions with HTML escaping).

### Testing standards

- Backend unit: colocated `*.spec.ts` (`apps/backend/jest.config.js`, `@rescom/schemas` mapped to the source).
- Backend e2e: `apps/backend/test/*.e2e-spec.ts`, booting `AppModule` and overriding tokens with in-memory adapters
  (pattern: `test/notifications.e2e-spec.ts`); run with `npm run test:e2e --workspace backend` (`--runInBand`).
- PostgreSQL e2e: `*.prisma.e2e-spec.ts`, database URL name must end with `_test`, skipped when unreachable; no
  testcontainers.
- Schemas: `packages/schemas/src/**/*.spec.ts`.
- Frontend: `apps/frontend/my-app/tests/*.test.mjs`.

### Previous story intelligence

- **9.6:** the publisher contract (never throws, post-commit, optional injection), `NotificationType` parity spec and
  drift-tolerant hand-written migrations. E9-D3 option B (Outbox-driven notifications) is deferred until the worker
  exists. This story does **not** convert the in-app path to option B; it only adds the email Outbox event inside the
  notifications-local write.
- **7.1 / 7.2:** one shared completeness definition in `@rescom/schemas`; demographics JSON packing with a row lock
  (P6); mock parity rule "`undefined` keeps, `null` clears" (P13), reused here for PATCH. DF6 (profile gaming before a
  targeted survey) stays deferred and is not made worse, because the new fields are not matching fields.
- **1.4:** RBAC guards, the identity audit port, the self-lock ban and the last-active-admin guard in
  `updateUserStatus`. The new publish goes after the transaction and must not change those branches.
- **6.6 / 8.1:** admin commands write `admin-audit:*` Outbox events in the source transaction (no consumer yet).
  E8-D3 requires two admins, which the IR.2 seed provides. The moderation queue uses offset paging (DF3), which does not
  affect counts.
- Code-review decision **OC2** said "add academicYear later only if targeting needs it". The FR-6/FR-9 amendments of
  2026-09-26 later added university and academic year to onboarding and say they back FR-10 university targeting.
  This story stores them as profile (non-matching) fields per the epic AC. Using them for targeting is a separate
  decision (see Questions).

### Git intelligence

Recent commits (`d1175eb`, `2c7ae67`, `9fd09d9`, `987d359`) are frontend analytics polish, readiness reports and
integration planning. No backend changes touch these areas; the working tree changes are planning docs only.

### Project structure notes

- New backend files: `users/{application/user-profile.service.ts, application/ports/user-profile.repository.port.ts,
  infrastructure/{prisma,in-memory}-user-profile.repository.ts, presentation/user-profile.controller.ts,
  user-profile-http.module.ts}`; `notifications/{application/email-delivery.handler.ts, application/email-templates.ts,
  application/ports/{email-sender,email-delivery.repository}.port.ts, infrastructure/{smtp,capture,disabled}-email-sender.ts,
  infrastructure/prisma-email-delivery.repository.ts}`; `forms/{application/ports/moderation-queue-stats.port.ts,
  infrastructure/prisma-moderation-queue-stats.ts}`; `economy/{application/ports/admin-economy-stats.port.ts,
  infrastructure/prisma-admin-economy-stats.ts}`; `admin/{application/admin-overview.service.ts,
  presentation/admin-overview.controller.ts}`.
- New schemas: `packages/schemas/src/users/user-profile.schema.ts`,
  `packages/schemas/src/notifications/email-delivery.schema.ts`, `packages/schemas/src/admin/admin-overview.schema.ts`.
- Variance: the profile controller gets its own HTTP module (cycle avoidance) instead of living in `UsersModule`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story IR.4b, L1281-1305]
- [Source: _bmad-output/planning-artifacts/epics.md#Story IR.2b, L1178-1212] — dispatcher, `ProcessedHandler` atomicity
- [Source: prd.md FR-9 L264-272 and amendment L267; FR-6 amendment L238; FR-57 L794-807; FR-35 L548-553; FR-52 L754-760]
- [Source: ARCHITECTURE-SPINE.md AD-7 L121, AD-10 L136, AD-16 L166, AD-21 L191, AD-23 L201, ownership L209-220, open question "email provider" L340]
- [Source: implementation-readiness-report-2026-09-30.md L467, L471, L505, L566]
- [Source: deferred-work.md L62-64 (E9-D3/email), L79 (top-up email), L98 (academic year), L268/L315 (ban/unban notices)]
- [Source: apps/frontend/my-app/lib/profile/profile-service.ts; lib/admin/admin-queue-service.ts; lib/admin/overview-service.ts]
- [Source: apps/backend/src/modules/notifications/application/ports/notification-publisher.port.ts]
- [Source: apps/backend/prisma/schema.prisma — User L244, DemographicProfile L370, OutboxEvent L751, ProcessedHandler L783, Notification L807, TopUpRequest L832]

### Test plan (summary matrix)

| Area | Unit | E2E (in-memory) | PostgreSQL e2e | Frontend |
|:--|:--|:--|:--|:--|
| Profile schema | bounds, blank→null, strict, clears | — | — | patch/response parse |
| Profile API | service (clock, partial, role untouched) | 401/403/400/200, no-row, demographics untouched, FR-9 immediate matching | repository upsert concurrency (optional) | onboarding submit, account view |
| Email port | shared contract suite × every adapter | — | — | — |
| Email queue | publish critical/non-critical/duplicate/disabled | top-up rejection type; lock/unlock publish once | — | presentation of new types |
| Email delivery | handler states (SENT replay, SENDING→UNCONFIRMED, retryable, permanent, missing user) | — | concurrent dispatch → one send; crash-after-SENDING → zero resends | — |
| Logs/PII | log-capture assertion | — | — | — |
| Admin overview | service composition, bounded port calls, optional omission, label fallback | 401/403×2/200 + schema parse | seeded sums (optional) | absent-card rendering, nav filter |

## Questions / Decisions for Owner

1. **Email provider (spine L340, readiness L505).** Which provider, and on which sending domain? The candidates are any
   SMTP-capable service, for example Amazon SES (SMTP), Resend (SMTP, or HTTP with an idempotency key), Brevo,
   Postmark or Google Workspace SMTP relay. The provider also needs SPF/DKIM/DMARC on the domain and an entry in the
   AD-21 processor inventory. **Recommendation:** an SMTP-capable provider through the portable `SmtpEmailSender`; pick
   one with an HTTP idempotency key only if the architect rejects the position in Q2.
2. **AD-10 and SMTP.** Is it acceptable to satisfy AD-10 with "persist before send, never auto-resend an ambiguous
   attempt (`UNCONFIRMED`)"? The alternative is to allow only an idempotency-key HTTP API, which some would call a
   provider-specific adapter under AD-23. This needs architect sign-off.
3. **Which admin queues are in the pilot (IR.1)?** The default in this story returns only `surveys` and `topUps`; omits
   `disputes`, `quality`, `openIssues` and `flaggedAccounts`; and hides the Disputes, Quality and FraudLog nav entries.
   Should missing-completion-code reports (FR-23, data exists in `SurveyAttempt.missingCodeReportedAt`) count as a
   pilot queue? If yes, a Participation-owned stats port and an admin read route are needed, which is extra scope.
4. **Split this story?** **Recommendation: yes**, into IR.4b-1 Profile, IR.4b-2 Email (blocked by IR.2b) and IR.4b-3
   Admin overview, so A and C can finish before the dispatcher lands. `sprint-status.yaml` would need three keys (not
   edited here).
5. **Wire names for university and academic year.** Keep the frontend names `school`/`schoolYear` (the story's
   default, zero frontend churn) or rename to `university`/`academicYear` across the frontend (8 files)?
6. **`birthYear` in the profile.** It is not in the epic AC but the frontend sends it. The story stores it for display
   and prefill and leaves the demographic `age` as the matching authority. Alternatively, should it replace `age`
   (fixes deferred DF10 but touches matching) or be dropped?
7. **University/academic year for targeting.** The FR-6 amendment says they back FR-10 university targeting, while the
   epic AC calls them non-demographic. Confirm that the pilot does **not** target on them. If it does, they must move to
   `/demographics` and the completeness rule instead.
8. **Production with email disabled.** May production start with `EMAIL_DELIVERY_MODE=disabled` (for example while
   the provider is pending), or must it refuse to boot? The story defaults to refusing.
9. **Email content.** May emails include amounts (top-up points/VND) or the rejection/ban reason? The default is a
   generic notice plus a link (or support contact for bans), which minimizes personal data in third-party mailboxes.
10. **Email request durability.** The email Outbox row is written together with the in-app notification, after the
    source transaction commits (inherits E9-D3 at-most-once: a crash between the source commit and the publish loses
    both). The stricter option is to write `NotificationEmailRequested` inside each source transaction (top-up review,
    user status change), aligned with deferred E9-D3 option B. Accept the default for the pilot?
11. **Out-of-scope ASSUMED calls on `/account/profile`.** `GET /engagement/me`, `GET /integrity/consent` and
    `GET /integrity/reliability/me` are still ASSUMED on the same screen. IR.1 must approve or hide them; this story
    does not implement them.

## Dev Agent Record

### Agent Model Used

(to be filled by the dev agent)

### Debug Log References

### Completion Notes List

- Story context created 2026-09-30 by the create-story workflow (Claude Opus 5.5). Ultimate context engine analysis
  completed - comprehensive developer guide created.

### File List
