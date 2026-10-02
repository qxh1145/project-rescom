# IR.1 Pilot Scope, Ownership and Contract Freeze: contract inventory (2026-10-02)

Status: DRAFT for owner review. Read-only inventory; no code changed. Source of truth: `apps/frontend/my-app` (services in `lib/**`, raw `fetch` in `app/**`), `apps/backend/src/**/presentation/*.controller.ts`, `packages/schemas`, `apps/frontend/my-app/mocks/route-allowlist.ts` (enforced by `tests/route-diff.test.mjs`), `apps/backend/test/*.e2e-spec.ts`, `ir-3-ir-4-evidence-2026-10-02.md`.

Conventions. FE source paths are relative to `apps/frontend/my-app/lib/` unless they start with `app/` or `lib/`. Schema names are files under `packages/schemas/src/<domain>/`. Evidence names are `apps/backend/test/<name>.e2e-spec.ts` ("(+.prisma)" = real-Postgres twin suite). Status rules:
- `verified`: controller + shared `@rescom/schemas` schema + at least one e2e or contract test.
- `verified-unit`: same, but the only test is a unit spec (controller/service/schema spec), no e2e.
- `assumed`: controller exists but the response schema is local to the frontend (or inline), or a code comment says ASSUMED. Test exists unless noted; the gap is the shared schema.
- `mock-only`: no backend controller; served by MSW only (route allowlist: MOCK_ONLY or DEFERRED_KEEP_MOCK).
Access: `public` no session; `guest-capable` public + CSRF only when a session exists; `auth` session; `admin` session + ADMIN role; `+CSRF` = mutating call sending `X-CSRF-Token` (`lib/api/client.ts`, `app/forms/forms-api.ts`). Status codes, idempotency and pagination for each call are defined by the cited controller and the e2e suite named (IR.3/IR.4 evidence maps clauses to suites); they are not re-tabulated here.

## 1. Contract inventory

### A. Auth and session (shell)

| # | Call | Frontend source | Backend controller | Shared schema | Access | Status | Evidence / gap |
|---|---|---|---|---|---|---|---|
| 1 | `GET /auth/csrf` | lib/api/client.ts:49 | auth.controller.ts | none (inline `{data:{csrfToken}}` parse) | auth session | **assumed** | e2e auth, single-session, auth-throttling. Gap: no shared response schema. |
| 2 | `POST /auth/register` | auth/auth-service.ts:55 | auth.controller.ts | register.schema + sanitized-user.schema | public, auth-bucket throttle | **verified** | e2e auth, auth-throttling, respondent-journey.prisma |
| 3 | `POST /auth/login` | auth/auth-service.ts:42 | auth.controller.ts | login.schema + sanitized-user.schema | public, auth-bucket throttle | **verified** | e2e auth, auth-throttling, security, single-session |
| 4 | `POST /auth/logout` | auth/auth-service.ts:224 | auth.controller.ts | none (204, no body) | auth+CSRF | **verified** | e2e auth, single-session |
| 5 | `POST /auth/refresh` | auth/session-refresh.ts:81 | auth.controller.ts | local `refreshResponseSchema` `{csrfToken}` | refresh cookie + CSRF | **assumed** | e2e auth, single-session; FE session-refresh.test.mjs. Gap: schema not shared. |
| 6 | `GET /auth/me` | auth/auth-service.ts:160 | auth.controller.ts | sanitized-user.schema | auth | **verified** | e2e auth, single-session, admin-users |
| 7 | `POST /auth/password/forgot` | auth/auth-service.ts:75 | auth.controller.ts | password-reset.schema | public, auth-bucket throttle | **verified** | e2e password-reset (+.prisma), auth-throttling |
| 8 | `POST /auth/password/reset` | auth/auth-service.ts:91 | auth.controller.ts | password-reset.schema | public, auth-bucket throttle | **verified** | e2e password-reset (+.prisma) |
| 9 | `GET /auth/google (full-page navigation)` | api/config.ts:30 | google-oauth.controller.ts | google-oauth.schema | public | **verified** | e2e google-oauth. Real flow cannot carry `returnTo`. |
| 10 | `POST /auth/google/link/start` | auth/auth-service.ts:121 | google-oauth.controller.ts | google-oauth.schema | auth+CSRF | **verified** | e2e google-oauth |
| 11 | `POST /auth/google/mock-complete` | auth/auth-service.ts:169 | none | none | mock | **mock-only** | MOCK_ONLY allowlist; only when `NEXT_PUBLIC_API_MOCKING=enabled` |
| 12 | `GET /mock/demo-accounts` | auth/auth-service.ts:218 | none | none | mock | **mock-only** | MOCK_ONLY allowlist; /login demo list, `enabled` mode only |

### B. Onboarding, profile, consent, tours

| # | Call | Frontend source | Backend controller | Shared schema | Access | Status | Evidence / gap |
|---|---|---|---|---|---|---|---|
| 13 | `GET /demographics` | demographics/demographics-service.ts:20, auth/auth-service.ts:190 | demographics.controller.ts | demographic-profile.schema | auth | **verified** | e2e marketplace-feed, user-profile(.prisma), demographic-onboarding |
| 14 | `PUT /demographics` | demographics/demographics-service.ts:25 | demographics.controller.ts | demographic-profile.schema | auth+CSRF | **verified** | e2e user-profile, marketplace-feed |
| 15 | `POST /demographics/survey` | demographics/demographics-service.ts:32 | demographics.controller.ts | demographic-profile.schema | auth+CSRF | **verified** | e2e demographic-onboarding |
| 16 | `GET /users/me/profile` | profile/profile-service.ts:21 | user-profile.controller.ts | user-profile.schema | auth | **verified** | e2e user-profile (+.prisma) |
| 17 | `PATCH /users/me/profile` | profile/profile-service.ts:30 | user-profile.controller.ts | user-profile.schema | auth+CSRF | **verified** | e2e user-profile (+.prisma) |
| 18 | `GET /product-tours` | product-tour/tour-service.ts:12 | product-tours.controller.ts | product-tour.schema | auth | **verified-unit** | Unit only: product-tours.controller.spec.ts, service spec; no e2e |
| 19 | `PUT /product-tours/:tourId` | product-tour/tour-service.ts:21 | product-tours.controller.ts | product-tour.schema | auth+CSRF | **verified-unit** | Unit only (as above) |
| 20 | `GET /integrity/consent` | participation/consent-service.ts:31 | integrity-consent.controller.ts | integrity-consent.schema | auth | **verified** | e2e integrity-consent (+.prisma); FE participation-contract.test.mjs |
| 21 | `POST /integrity/consent` | participation/consent-service.ts:35 | integrity-consent.controller.ts | integrity-consent.schema | auth+CSRF | **verified** | e2e integrity-consent (+.prisma) |

### C. Notifications

| # | Call | Frontend source | Backend controller | Shared schema | Access | Status | Evidence / gap |
|---|---|---|---|---|---|---|---|
| 22 | `GET /notifications` | notifications/notification-service.ts:72 | notifications.controller.ts | notification.schema (FE tolerant wrapper) | auth | **verified** | e2e notifications |
| 23 | `GET /notifications/unread-count` | notifications/notification-service.ts:56 | notifications.controller.ts | notification.schema | auth | **verified** | e2e notifications |
| 24 | `PATCH /notifications/read-all` | notifications/notification-service.ts:83 | notifications.controller.ts | notification.schema | auth+CSRF | **verified** | e2e notifications |
| 25 | `PATCH /notifications/:id/read` | notifications/notification-service.ts:76 | notifications.controller.ts | notification.schema | auth+CSRF | **verified** | e2e notifications |

### D. Marketplace and economy

| # | Call | Frontend source | Backend controller | Shared schema | Access | Status | Evidence / gap |
|---|---|---|---|---|---|---|---|
| 26 | `GET /marketplace/feed` | marketplace/marketplace-service.ts:26 | marketplace.controller.ts | marketplace.schema | auth | **verified** | e2e marketplace-feed, marketplace-activation |
| 27 | `GET /economy/starter-points/status` | economy/starter-points-service.ts:9 | starter-points.controller.ts | starter-points.schema | auth | **verified** | e2e starter-points |
| 28 | `GET /economy/wallet` | wallet/wallet-service.ts:42,64 | ledger.controller.ts | wallet.schema (+ FE optional `surveyTitle`, ASSUMED) | auth | **verified** | e2e ledger, forms-escrow, reward-settlement, starter-points |
| 29 | `GET /economy/top-ups` | wallet/top-up-service.ts:40 | top-up.controller.ts | top-up.schema | auth | **verified** | e2e top-up |
| 30 | `POST /economy/top-ups` | wallet/top-up-service.ts:30 | top-up.controller.ts | top-up.schema | auth+CSRF | **verified** | e2e top-up; financial-publisher.prisma (approval side) |

### E. Respondent runner (internal and external)

| # | Call | Frontend source | Backend controller | Shared schema | Access | Status | Evidence / gap |
|---|---|---|---|---|---|---|---|
| 31 | `GET /surveys/:id` | participation/survey-form-service.ts:20 | survey-runner.controller.ts | survey-runner.schema (surveySummary) | public | **verified** | e2e survey-runner-reads, respondent-journey(.prisma); FE participation-contract.test.mjs |
| 32 | `POST /surveys/:id/attempts` | participation/attempts-service.ts:27 | participation.controller.ts | survey-attempt.schema | auth+CSRF | **verified** | e2e survey-attempt, respondent-journey.prisma (b1, b2) |
| 33 | `GET /attempts/:id` | participation/attempts-service.ts:87 | survey-runner.controller.ts | survey-runner.schema | auth (owner) | **verified** | e2e survey-runner-reads, survey-feedback |
| 34 | `GET /attempts/:id/outcome` | participation/submission-service.ts:48 | survey-runner.controller.ts | survey-runner.schema | auth (owner) | **verified** | e2e survey-runner-reads, respondent-journey |
| 35 | `POST /attempts/:id/cancel` | participation/external-service.ts:81 | survey-runner.controller.ts | survey-runner.schema | auth+CSRF | **verified** | e2e survey-runner-reads, attempt-cancel.prisma |
| 36 | `POST /responses/:id/submit` | participation/submission-service.ts:25 | participation.controller.ts | internal-submission.schema | guest-capable (public + optional CSRF), bot-protection | **verified** | e2e participation-submission, bot-protection, respondent-journey.prisma (d) |
| 37 | `POST /attempts/:id/verify-code` | participation/external-service.ts:35 | participation.controller.ts | external-completion.schema | auth+CSRF | **verified** | e2e external-completion, external-survey-idempotency.prisma |
| 38 | `POST /attempts/:id/report-missing-code` | participation/external-service.ts:55 | participation.controller.ts | external-completion.schema | auth+CSRF | **verified** | e2e external-completion |
| 39 | `POST /responses/:id/integrity-events` | app/forms/hooks/telemetry-buffer.mjs:65, useSurveyTelemetry.ts:74 (raw fetch) | participation.controller.ts | survey-telemetry.schema | guest-capable | **verified** | e2e survey-telemetry. Raw fetch, no response parse. |
| 40 | `POST /forms/:id/attempts/:attemptId/integrity-events` | app/forms/hooks/telemetry-buffer.mjs:67 | participation.controller.ts | survey-telemetry.schema | guest-capable | **verified** | e2e survey-telemetry |
| 41 | `GET /attempts/:id/feedback` | participation/feedback-service.ts:22 | survey-feedback.controller.ts | survey-feedback.schema | auth (owner) | **verified** | e2e survey-feedback |
| 42 | `POST /attempts/:id/feedback` | participation/feedback-service.ts:50 | survey-feedback.controller.ts | survey-feedback.schema | auth+CSRF | **verified** | e2e survey-feedback |
| 43 | `POST /storage/uploads/initiate` | participation/file-upload-service.ts:85; app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:156 | storage.controller.ts | file-storage.schema | guest-capable (optional CSRF) | **verified** | e2e file-storage; FE file-upload-runner.test.mjs |
| 44 | `POST /storage/uploads/:id/finalize` | participation/file-upload-service.ts:95; RespondentFileUploadBlock.tsx:216 | storage.controller.ts | file-storage.schema | guest-capable (optional CSRF) | **verified** | e2e file-storage |
| 45 | `GET /storage/uploads` | participation/file-upload-service.ts:114 | storage.controller.ts | file-storage.schema | auth | **verified** | e2e file-storage |
| 46 | `GET /storage/objects/:id/status` | participation/file-upload-service.ts:105 | storage.controller.ts | file-storage.schema | auth | **verified** | e2e file-storage |
| 47 | `DELETE /storage/objects/:id` | participation/file-upload-service.ts:123; RespondentFileUploadBlock.tsx:355,364 | storage.controller.ts | file-storage.schema | guest-capable (optional CSRF) | **verified** | e2e file-storage |
| 48 | `GET /public/forms/:id` | app/f/[id]/page.tsx:34 (raw fetch) | public-forms.controller.ts | public-form.schema (type import only) | public | **verified** | e2e public-form-submissions. Page unusable in production: see section 3 (captcha). |
| 49 | `POST /public/forms/:id/submissions` | app/f/[id]/page.tsx:76 (raw fetch) | public-forms.controller.ts | public-form.schema / internal-submission.schema | guest + captcha token | **verified** | e2e public-form-submissions. Production fails closed (no captcha provider). |

### F. Publisher (forms, builder, results)

| # | Call | Frontend source | Backend controller | Shared schema | Access | Status | Evidence / gap |
|---|---|---|---|---|---|---|---|
| 50 | `POST /forms` | forms/builder-service.ts:128; resubmit-service.ts:98 | forms.controller.ts | request: form-draft.schema; response: local `builderFormSchema` | auth+CSRF | **assumed** | e2e forms-draft, forms-escrow, forms-publish. Gap: response not shared. |
| 51 | `GET /forms (list, recent)` | forms/manage-service.ts:176; builder-service.ts:172 | forms.controller.ts | local `publisherFormListSchema` | auth | **assumed** | e2e forms-draft, forms-publish. Gap: not shared; ASSUMED management fields. |
| 52 | `GET /forms/:id` | forms/manage-service.ts:184; builder-service.ts:138 | forms.controller.ts | local `publisherFormSchema` / `builderFormSchema` | auth (owner/admin) | **assumed** | e2e forms-draft, forms-publish, forms-escrow. Gap: not shared; ASSUMED optional fields. |
| 53 | `PATCH /forms/:id/draft` | forms/builder-service.ts:152 | forms.controller.ts | request: form-draft.schema; response local | auth+CSRF | **assumed** | e2e forms-draft, forms-versioning; financial-publisher.prisma (autosave) |
| 54 | `GET /forms/:id/pricing-quote` | forms/builder-service.ts:160 | forms.controller.ts | local `pricingQuoteSchema` | auth | **assumed** | e2e forms-escrow, forms-publish. economy/pricing.schema exists, unused by the FE. |
| 55 | `POST /forms/:id/publish` | forms/builder-service.ts:164 | forms.controller.ts | request: form-publish.schema; response local | auth+CSRF | **assumed** | e2e forms-publish, forms-escrow; financial-publisher.prisma |
| 56 | `POST /forms/external` | forms/create-service.ts:24 | forms.controller.ts | external-form.schema | auth+CSRF | **verified** | e2e external-survey, external-survey-idempotency.prisma |
| 57 | `POST /forms/audience-estimate` | forms/create-service.ts:49 | audience-estimate.controller.ts | audience-estimate.schema | auth+CSRF | **verified** | e2e audience-estimate (+.prisma) |
| 58 | `GET /forms/:id/progress` | forms/manage-service.ts:189 | publisher-form-reads.controller.ts | publisher-results.schema (progress) | auth (owner/admin) | **verified** | e2e publisher-results (+.prisma); FE publisher-results-contract.test.mjs |
| 59 | `GET /forms/:id/in-progress-attempts` | forms/manage-service.ts:194; app/forms/forms-api.ts:79 | forms.controller.ts | local zod mirror of shared `FormInProgressAttemptsDto` type | auth (owner/admin) | **assumed** | e2e forms-versioning. Gap: runtime schema local. |
| 60 | `POST /forms/:id/close` | forms/manage-service.ts:204 | forms.controller.ts | local `publisherFormSchema` | auth+CSRF | **assumed** | e2e forms-escrow, forms-publish, forms-versioning |
| 61 | `POST /forms/:id/reopen` | forms/manage-service.ts:216 | forms.controller.ts | local `publisherFormSchema` | auth+CSRF | **assumed** | e2e forms-escrow |
| 62 | `DELETE /forms/:id` | forms/manage-service.ts:230 | forms.controller.ts | local `deletedFormSchema` | auth+CSRF | **assumed** | e2e forms-draft, forms-publish |
| 63 | `POST /forms/:id/versions` | forms/manage-service.ts:244 | forms.controller.ts | local `createdFormVersionSchema` | auth+CSRF | **assumed** | e2e forms-versioning |
| 64 | `GET /forms/:id/versions` | forms/results-service.ts:221 | forms.controller.ts | local `formVersionSummarySchema` (+ ASSUMED stats) | auth (owner/admin) | **assumed** | e2e forms-versioning |
| 65 | `GET /forms/:id/versions/:versionId` | forms/results-service.ts:228 | publisher-form-reads.controller.ts | publisher-results.schema (versionDetail) | auth (owner/admin) | **verified** | e2e publisher-results (+.prisma) |
| 66 | `GET /forms/:id/responses` | forms/results-service.ts:149 | publisher-results.controller.ts | publisher-results.schema (responsesPage) | auth (owner/admin) | **verified** | e2e publisher-results (+.prisma); FE publisher-results-contract.test.mjs. Also feeds client-side export. |
| 67 | `GET /forms/:id/analytics` | forms/results-analytics-service.ts:45 | publisher-results.controller.ts | publisher-results.schema (analytics) | auth (owner/admin) | **verified** | e2e publisher-results (+.prisma) |

### G. Admin

| # | Call | Frontend source | Backend controller | Shared schema | Access | Status | Evidence / gap |
|---|---|---|---|---|---|---|---|
| 68 | `GET /admin/queue-counts` | admin/admin-queue-service.ts:22 | admin-overview.controller.ts | admin-overview.schema | admin | **verified** | e2e admin-read-views; FE admin-contract.test.mjs. `disputes`/`quality` counts are 0 placeholders (override C3/C4). |
| 69 | `GET /admin/overview` | admin/overview-service.ts:25 | admin-overview.controller.ts | admin-overview.schema | admin | **verified** | e2e admin-read-views; FE admin-contract.test.mjs |
| 70 | `GET /admin/fraud-log` | admin/fraud-log-service.ts:59 | admin-fraud-log.controller.ts | fraud-log.schema | admin | **verified** | e2e admin-read-views (+.prisma) |
| 71 | `GET /admin/ledger/journals` | admin/transactions-service.ts:52 | admin-ledger.controller.ts | admin-ledger.schema | admin | **verified** | e2e admin-read-views (+.prisma) |
| 72 | `GET /admin/ledger/summary` | admin/transactions-service.ts:56 | admin-ledger.controller.ts | admin-ledger.schema | admin | **verified** | e2e admin-read-views (+.prisma) |
| 73 | `GET /admin/users` | admin/users-service.ts:90 | admin-users.controller.ts | admin-users.schema (page wrapper local) | admin | **verified** | e2e admin-users (+.prisma, error-envelope) |
| 74 | `GET /admin/users/:id` | admin/users-service.ts:94 | admin-users.controller.ts | admin-users.schema | admin | **verified** | e2e admin-users |
| 75 | `PATCH /admin/users/:id/status` | admin/users-service.ts:109 | admin-users.controller.ts | admin-users.schema | admin+CSRF | **verified** | e2e admin-users, admin-audit-logs |
| 76 | `PATCH /admin/users/:id/role` | admin/users-service.ts:119 | admin-users.controller.ts | admin-users.schema | admin+CSRF | **verified** | e2e admin-users |
| 77 | `GET /admin/moderation/surveys` | admin/moderation-service.ts:76 | admin-moderation.controller.ts | survey-moderation.schema | admin | **verified** | e2e survey-moderation, moderation.prisma |
| 78 | `GET /admin/moderation/surveys/:formId` | admin/moderation-service.ts:80 | admin-moderation.controller.ts | survey-moderation.schema | admin | **verified** | e2e survey-moderation |
| 79 | `POST /admin/moderation/surveys/:formId/approve` | admin/moderation-service.ts:85 | admin-moderation.controller.ts | survey-moderation.schema | admin+CSRF | **verified** | e2e survey-moderation, forms-publish; moderation.prisma |
| 80 | `POST /admin/moderation/surveys/:formId/reject` | admin/moderation-service.ts:97 | admin-moderation.controller.ts | survey-moderation.schema | admin+CSRF | **verified** | e2e survey-moderation, moderation.prisma |
| 81 | `GET /admin/top-ups` | admin/top-up-admin-service.ts:58 | admin-top-up.controller.ts | top-up.schema | admin | **verified** | e2e top-up |
| 82 | `POST /admin/top-ups/:id/approve` | admin/top-up-admin-service.ts:62 | admin-top-up.controller.ts | top-up.schema | admin+CSRF | **verified** | e2e top-up; financial-publisher.prisma |
| 83 | `POST /admin/top-ups/:id/reject` | admin/top-up-admin-service.ts:70 | admin-top-up.controller.ts | top-up.schema | admin+CSRF | **verified** | e2e top-up |
| 84 | `GET /admin/missing-code-reports` | admin/disputes-service.ts:158 | admin-missing-code-reports.controller.ts | missing-code-reports.schema | admin | **verified-unit** | Unit only: admin-missing-code-reports.service.spec, admin-read.schema.spec; no e2e, no controller spec |
| 85 | `POST /admin/completion-code-limits/reset` | admin/disputes-service.ts:189 | admin-completion-code-limit.controller.ts | participation (completion-code-limit) | admin+CSRF | **verified** | e2e external-completion; controller spec |

### H. Deferred Phase 2 and mock-only (MSW only: DEFERRED_KEEP_MOCK 14)

| # | Call | Frontend source | Backend controller | Shared schema | Access | Status | Evidence / gap |
|---|---|---|---|---|---|---|---|
| 86 | `POST /forms/:id/attempts/:attemptId/disputes` | forms/dispute-service.ts:40 | none | none (local `disputeResultSchema`) | auth+CSRF | **mock-only** | Disputes, Story 8.5. Not served by backend. |
| 87 | `GET /admin/disputes` | admin/disputes-service.ts:155 (called only when `isHybridMocking`) | none | none (local) | admin | **mock-only** | Disputes, Story 8.5 |
| 88 | `POST /admin/disputes/:id/resolve` | admin/disputes-service.ts:176 | none | none (local) | admin+CSRF | **mock-only** | Disputes, Story 8.5 |
| 89 | `GET /integrity/reliability/me` | participation/trust-service.ts:34 | none | none (local) | auth | **mock-only** | Reliability, Epic 10 |
| 90 | `GET /admin/quality-reviews` | admin/quality-service.ts:104 | none | none (local) | admin | **mock-only** | Quality review, Epic 10 |
| 91 | `POST /admin/quality-reviews/:responseId/decision` | admin/quality-service.ts:112 | none | none (local) | admin+CSRF | **mock-only** | Quality review, Epic 10 |
| 92 | `GET /forms/:id/quality` | forms/results-service.ts:214 | none | none (local `formQualitySchema`) | auth | **mock-only** | Survey quality, Epic 10 (FR-62) |
| 93 | `GET /forms/:id/ai/conversation` | forms/builder-service.ts:179 | none (backend has only POST /forms/ai/prepare-prompt, unused by FE) | none (local) | auth | **mock-only** | AI builder, Epic 3 |
| 94 | `POST /forms/:id/ai/messages` | forms/builder-service.ts:183 | none | none (local) | auth+CSRF | **mock-only** | AI builder, Epic 3 |
| 95 | `POST /forms/ai/messages` | forms/builder-service.ts:193 | none | none (local) | auth+CSRF | **mock-only** | AI builder, Epic 3 (first prompt of a new chat) |
| 96 | `POST /forms/:id/ai/conversation` | forms/builder-service.ts:203 | none | none (local) | auth+CSRF | **mock-only** | AI builder, Epic 3 (attach chat to draft) |
| 97 | `POST /forms/:id/ai/suggest-block` | forms/builder-service.ts:211 | none | none (local) | auth+CSRF | **mock-only** | AI builder, Epic 3 |
| 98 | `GET /engagement/me` | engagement/engagement-service.ts:38 | none | none (local) | auth | **mock-only** | Streak and tier, Stories 7.4-7.6 |
| 99 | `GET /engagement/leaderboard` | engagement/leaderboard-service.ts:46 | none | none (local) | auth | **mock-only** | Leaderboard, Stories 7.4-7.6 |

Not frontend calls, but part of the real flows: `GET /auth/google/callback` (backend redirect to `/auth/callback`), the browser `PUT` to the presigned object-storage URL (outside `/api`, on the S3 domain; allowlist `PUT /storage/mock-uploads/:id` is its MOCK_ONLY stand-in; not covered by route-diff and depends on MinIO CORS), `GET /storage/objects/:id/download-url` (backend only).

Backend routes with no frontend caller (not reachable from the UI; keep out of the pilot contract or note as ops-only): `POST /economy/starter-points/unlock|expire`, `/economy/journals*`, `/economy/accounts*`, `/economy/integrity`, `/economy/rewards/*` (admin redrive/release), `POST /forms/:id/status`, `POST /forms/:id/rotate-code`, `POST /forms/ai/prepare-prompt`, `/forms/:id/attempts` and `/surveys/:id/submissions` aliases, `GET /admin/audit-logs*`, `/admin/outbox/*`, `GET /system/metrics|health`, `DELETE /auth/google/link`, `GET /storage/objects/:id/download-url`.

### Direct mock consumers outside `mocks/`

No `mockRepository`, `mocks/data/*` or `mocks/legacy/*` import exists in `app/`, `lib/` or `components/` (searched 2026-10-02). The IR epic's list (shell, notification, feedback, onboarding guard, legacy respondent consumers) is already empty. What remains is mode plumbing, not data access:

| File:line | What it touches | Pilot action |
|---|---|---|
| `components/providers/MswProvider.tsx:14` | dynamic `import("@/mocks/browser")` when `NEXT_PUBLIC_API_MOCKING` is `enabled` or `hybrid` | Dead code with `disabled`; confirm bundle excludes MSW (IR.6) |
| `lib/api/config.ts:17-18,30` | `isApiMockingEnabled`, `isHybridMocking`, mock Google URL `/auth/callback?provider=mock-google` | Keep; assert `disabled` in the pilot build |
| `lib/auth/auth-service.ts:169,218` | `POST /auth/google/mock-complete`, `GET /mock/demo-accounts` | Called only in `enabled` mode |
| `lib/admin/disputes-service.ts:10,155-159` | `GET /admin/disputes` only when `isHybridMocking` | Removed with the disputes screen |
| `components/ui/DemoDataTag.tsx:1,10` | "Dữ liệu minh hoạ" tag, renders only in `hybrid` | Disappears with `disabled`; screens must be hidden, not just untagged |

## 2. Screen to route map

Shell calls on every signed-in route (`app/(signed-in)/layout.tsx` via SessionGate): `GET /auth/me`, `GET /demographics` (onboarding guard), `GET /notifications/unread-count`, `GET /users/me/profile`, `GET /economy/wallet?limit=1`; admin routes add `GET /admin/queue-counts`. All verified, none mock. Calls below are page-specific. Journey codes (proposed, see decision 1): J1 respondent internal survey, J2 respondent external (Google Forms) completion, J3 publisher internal, J4 publisher external, J5 wallet and top-up, J6 admin console, J0 auth and account.

DEFERRED = depends on a mock-only call (breaks with `disabled`, must be hidden). FLAG = reachable through a build-time constant in `lib/forms/results-scope.ts` (all `true` today for internal testing).

| Route (under `app/`) | Journey | Page-specific calls (# in section 1) | Mock-only / deferred dependency | Pilot-hide handle |
|---|---|---|---|---|
| `/` landing | J0 | none | no |  |
| `/login` | J0 | POST /auth/login (3); GET /auth/google (9); mock-only: /mock/demo-accounts (12) in `enabled` mode | no (mock calls dev-only) |  |
| `/register` | J0 | POST /auth/register (2) | no |  |
| `/forgot-password`, `/forgot-password/sent`, `/reset-password` | J0 | POST /auth/password/forgot (7), /reset (8) | no | Password recovery; needs SMTP + scheduler (outbox) |
| `/auth/callback`, `/auth/error` | J0 | GET /auth/me (6), GET /demographics (13); mock-complete (11) in `enabled` mode | no |  |
| `/auth/link-google` | J0 | POST /auth/google/link/start (10) | no |  |
| `/dashboard` | J0 | redirect to `/marketplace` | no |  |
| `/f/[id]` (public guest form) | J1 guest | GET /public/forms/:id (48), POST .../submissions (49), telemetry (39-40) | Not mock, but captcha stub: `app/f/components/CaptchaWidget.tsx:25` sends hard-coded `test-turnstile-token`; production backend rejects every token | Exclude route until a real captcha provider exists (decision 22) |
| `/surveys/[id]/full` | J1 | GET /surveys/:id (31) | no |  |
| `/privacy`, `/terms`, `/forbidden`, `/maintenance`, `/offline`, `/rate-limited`, `/server-error` | J0 | none (static) | no |  |
| `/(signed-in)/(focus)/onboarding` | J0 | PUT /demographics (14), POST /demographics/survey (15) | no |  |
| `/(app)/marketplace` | J1 | GET /marketplace/feed (26), GET /economy/starter-points/status (27), POST /surveys/:id/attempts (32) | no |  |
| `/(focus)/surveys/[id]/start` | J1 | GET /surveys/:id (31), GET/POST /integrity/consent (20-21), POST /surveys/:id/attempts (32) | no | Consent/telemetry in scope (decision 16) |
| `/(focus)/attempts/[id]` | J1 / J2 | GET /attempts/:id (33), POST /responses/:id/submit (36), telemetry (39-40), uploads (43-47), cancel (35) | no |  |
| `/(focus)/attempts/[id]/complete` | J1 | GET /attempts/:id/outcome (34), GET/POST /attempts/:id/feedback (41-42) | no |  |
| `/(focus)/attempts/[id]/google-form` | J2 | POST /attempts/:id/verify-code (37), report-missing-code (38), cancel (35) | no | External completion (decision 14) |
| `/(app)/notifications` | J0 | GET /notifications (22), PATCH read (25), read-all (24) | no |  |
| `/(app)/wallet` | J5 | GET /economy/wallet (28), GET /economy/top-ups (29) | no |  |
| `/(focus)/wallet/top-up`, `/top-up/[id]`, `/top-up/[id]/pending` | J5 | POST /economy/top-ups (30), GET /economy/top-ups (29) | no (bank details come from backend env; see section 3) |  |
| `/(app)/account` | J0 | GET /users/me/profile (16), /demographics (13), /integrity/consent (20), /product-tours (18-19); `use-account-data.ts:26,28` also GET /engagement/me (98), /integrity/reliability/me (89) | DEFERRED (tier, reliability rows) | Strip engagement + reliability queries and rows (`account/hooks/use-account-data.ts`, `AccountScreen.tsx:75-86`, `ProfileCard.tsx`) |
| `/(app)/account/profile` | J0 | GET/PATCH /users/me/profile (16-17), PUT /demographics (14) | no |  |
| `/(app)/account/streak`, `/account/tier` | Phase 2 | GET /engagement/me (98) | DEFERRED | Hide route; links in section below |
| `/(app)/account/trust` | Phase 2 | GET /integrity/reliability/me (89) | DEFERRED | Hide route; links below |
| `/(app)/leaderboard` | Phase 2 | GET /engagement/me (98), /engagement/leaderboard (99) | DEFERRED | Hide route; links below |
| `/(app)/forms` | J3 / J4 | GET /forms (51), close (60), DELETE (62) via row actions | no |  |
| `/(app)/forms/new` | J3 / J4 | none (chooser); links to `/forms/new/builder` and `/forms/new/google-form` | no (AI mentioned in subtitle only: `ChooseMethodScreen.tsx:114`) |  |
| `/(focus)/forms/new/builder`, `/forms/[id]/builder`, `/builder/preview`, `/builder/publish`, `/forms/[id]/submitted` | J3 | POST /forms (50), GET /forms/:id (52), PATCH draft (53), pricing-quote (54), publish (55), GET /forms (51), audience-estimate (57), uploads (43-47, preview) | Contains AI entry points (below) | See AI entry points |
| `/(focus)/forms/new/builder/ai`, `/(focus)/forms/[id]/builder/ai` | Phase 2 | AI routes 93-97 (mock-only) | DEFERRED | Hide route + entry points below |
| `/(focus)/forms/new/google-form` | J4 | POST /forms/external (56), audience-estimate (57) | no |  |
| `/(app)/forms/[id]` (Tiến độ) | J3 / J4 | GET /forms/:id (52), GET /progress (58), GET /in-progress-attempts (59), close (60) | Links to export, quality tab | FLAG `RESPONSE_EXPORT_ENABLED`, `SURVEY_QUALITY_ENABLED` |
| `/(app)/forms/[id]/reopen` | J3 / J4 | POST /forms/:id/reopen (61) | no |  |
| `/(app)/forms/[id]/resubmit` | J3 | GET /forms/:id (52), POST /forms (50), PATCH draft (53) (copy of a rejected form) | no |  |
| `/(app)/forms/[id]/responses` (Tóm tắt) | J3 | GET /forms/:id/responses (66), GET /forms/:id/analytics (67) | no | FLAG `RESULTS_ANALYTICS_ENABLED` |
| `/(app)/forms/[id]/responses/questions`, `/individual`, `/[responseId]` | J3 | GET /responses (66), GET /analytics (67) | no | Form responses and analytics (decisions 6-7) |
| `/(app)/forms/[id]/versions` | J3 | GET /forms/:id/versions (64), POST /forms/:id/versions (63) | no (diff is client-side) | FLAG `VERSION_DIFF_ENABLED` (`VersionsScreen.tsx:192`) |
| `/(app)/forms/[id]/versions/[versionNumber]` | J3 | GET /forms/:id/versions/:versionId (65) | no | FLAG `VERSION_DETAIL_ENABLED` |
| `/(app)/forms/[id]/quality` | Phase 2 | GET /forms/:id/quality (92) | DEFERRED | FLAG `SURVEY_QUALITY_ENABLED`; tab at `SurveyTabs.tsx:33` |
| `/(app)/forms/[id]/export` | Phase 2 (decision 12) | GET /forms/:id/responses (66); file built in the browser (`lib/forms/results-export.ts`) | no (real data, but data-export policy open) | FLAG `RESPONSE_EXPORT_ENABLED`; entries below |
| `/(app)/forms/[id]/complaints/[attemptId]` | Phase 2 | POST /forms/:id/attempts/:attemptId/disputes (86) | DEFERRED; orphan route: no inbound link in `app/`, `components/` or `lib/` (only reachable by typing the URL) | FLAG `PUBLISHER_DISPUTES_ENABLED`; delete route in pilot build |
| `/(admin)/admin` | J6 | GET /admin/overview (69), queue-counts (68) | Overview todo item links to `/admin/disputes` (`lib/admin/overview-view.ts:56`); queue counts `disputes`/`quality` are 0 placeholders | Filter todo kinds and queue badges |
| `/(admin)/admin/surveys` | J6 | GET/POST /admin/moderation/surveys* (77-80) | no |  |
| `/(admin)/admin/top-ups` | J6 | GET /admin/top-ups (81), approve/reject (82-83) | no |  |
| `/(admin)/admin/users` | J6 | GET /admin/users* (73-74), PATCH status/role (75-76) | no |  |
| `/(admin)/admin/fraud-log` | J6 | GET /admin/fraud-log (70), GET /admin/users (73) | no |  |
| `/(admin)/admin/transactions` | J6 | GET /admin/ledger/journals (71), /summary (72) | no |  |
| `/(admin)/admin/disputes` | Phase 2 / J2 partial | GET /admin/disputes (87), POST resolve (88) mock; GET /admin/missing-code-reports (84), POST /admin/completion-code-limits/reset (85) real | DEFERRED (mixed page) | Hide page; optionally rebuild a missing-code-only view if J2 stays in scope |
| `/(admin)/admin/quality` | Phase 2 | GET /admin/quality-reviews (90), POST decision (91) | DEFERRED | Hide page + nav entry |

### Deferred Phase 2 entry points to hide (nav links and inbound links)

| Feature | Entry points (file:line) |
|---|---|
| Disputes (admin) | Admin nav `components/layout/admin/admin-nav.ts:17`; overview todo link `lib/admin/overview-view.ts:56`; queue badge `queue: "disputes"` (admin-nav.ts:17) |
| Quality (admin) | Admin nav `components/layout/admin/admin-nav.ts:18`; queue badge `queue: "quality"` |
| Quality (publisher) | Tab `app/(signed-in)/(app)/forms/[id]/components/SurveyTabs.tsx:33` (flag `SURVEY_QUALITY_ENABLED`); link back `forms/[id]/quality/components/QualityScreen.tsx:72` |
| Complaints (publisher) | No inbound link found; `FormWorkspace.tsx:29` maps the segment; route `forms/[id]/complaints/[attemptId]`; flag `PUBLISHER_DISPUTES_ENABLED` is not read by any entry point |
| Reliability / trust | `account/components/AccountScreen.tsx:75-76` (row + link `/account/trust`), `account/components/AccountDesktop.tsx:66`, query `account/hooks/use-account-data.ts:28` |
| AI builder | `forms/[id]/builder/components/BuilderHeader.tsx:43`, `BuilderScreen.tsx:362`, `Canvas.tsx:271`, `forms/[id]/builder/ai/components/AiChatScreen.tsx:117` (history links); chooser text `forms/new/components/ChooseMethodScreen.tsx:114` |
| Engagement (streak, tier, leaderboard) | `account/components/ProfileCard.tsx:38,62,108,116` (tier/streak links, `DemoDataTag` :45), `account/components/AccountScreen.tsx:86` (link `/leaderboard`), `leaderboard/components/EngagementAside.tsx:19,35`, `account/streak/components/StreakScreen.tsx:110`, `components/layout/app/nav-items.ts:23` (mobile nav highlights `/leaderboard`), query `account/hooks/use-account-data.ts:26` |
| Export | `forms/[id]/components/ProgressScreen.tsx:95,107-109`, `forms/[id]/components/HeaderActions.tsx:74-75` (flag `RESPONSE_EXPORT_ENABLED`) |
| Version diff | `forms/[id]/versions/components/VersionsScreen.tsx:192`, `forms/[id]/versions/hooks/use-form-versions.ts:18` (flag `VERSION_DIFF_ENABLED`) |
| Guest public form | Route `app/f/[id]/page.tsx`; no in-app link found |

Build-time handles that exist today (`lib/forms/results-scope.ts`): `RESULTS_ANALYTICS_ENABLED` (l.10), `VERSION_DETAIL_ENABLED` (l.13), `VERSION_DIFF_ENABLED` (l.19), `SURVEY_QUALITY_ENABLED` (l.26), `RESPONSE_EXPORT_ENABLED` (l.29), `PUBLISHER_DISPUTES_ENABLED` (l.35, unused by entry points), `PUBLISHER_FEEDBACK_SUMMARY_ENABLED` (l.38, already `false`). No equivalent flag exists for disputes admin, admin quality, reliability, AI builder or engagement: those need a flag or route deletion.

## 3. Production-blocking defaults

| # | Where (file:line) | Why it blocks | Suggested decision |
|---|---|---|---|
| 1 | `deploy/docker-compose.prod.yml:33` builds the production frontend with `NEXT_PUBLIC_API_MOCKING: hybrid` (overrides the Dockerfile default `disabled`, `deploy/frontend.Dockerfile:13`; `deploy/README.md:12` documents it) | Pilot users would see MSW demo data for 14 routes | Change to `disabled` (IR.6); hide the 14 deferred routes first |
| 2 | `apps/frontend/my-app/.env.example:6` and `.env.local:2` set `NEXT_PUBLIC_API_MOCKING=hybrid` | Copy-paste default | Change example to `disabled`; keep `hybrid` only in a documented internal profile |
| 3 | `docker-compose.yml:4-5` (`minioadmin` / `minioadmin`), `apps/backend/.env.example:107-108`, schema defaults `src/common/config/env.schema.ts:312-313` | Default object-store credentials | Configure: production refuses them (`env.schema.ts:419-420`); `deploy/.env.prod.example` already forces CHANGE_ME. Verify at IR.5 that startup fails on the default |
| 4 | `docker-compose.yml:13-14` and `apps/backend/.env.example:21` (`rescom_admin` / `rescom_password`) | Default Postgres credentials (local compose only) | Remove from any deployed path; prod compose uses `POSTGRES_PASSWORD` from `.env.prod`. No schema guard exists for the DB URL |
| 5 | `apps/backend/.env.example:24,29,34,37` placeholder secrets (`replace_with_at_least_32_characters_...`); `env.schema.ts:81-83` only checks length >= 32 | Placeholders are 60+ chars so the production validator accepts them: a copied example would boot in production with a public secret | Rotate/configure: generate with `openssl rand -base64 48`; add a startup refusal for `replace_with_*` values (JWT_SECRET, AUTH_SECRET_PROTECTION_KEY, COMPLETION_CODE_HMAC_SECRET, STORAGE_CAPABILITY_SECRET) |
| 6 | `apps/backend/.env.example:64-65` Google placeholders; `env.schema.ts:278-282,407-408` only rejects the literal defaults `rescom-google-client-id/secret` | Placeholder `replace_with_google_client_*` passes the production check | Configure real OAuth client for `app.rescom.com.vn`; extend the guard |
| 7 | `apps/backend/.env.example:119-122`, `env.schema.ts:71-72,338-344`: `TOPUP_BANK_ACCOUNT_NUMBER=0000000000`, name `RESCOM DEMO`, BIN 970436 (Vietcombank) | Placeholder top-up bank data shown to users on the transfer screen | Configure: production refuses placeholder number/name (`env.schema.ts:430-431`); owner supplies the real account, name, BIN. `deploy/.env.prod.example` uses CHANGE_ME. Frontend shows backend values (`wallet/top-up/components/TransferScreen.tsx:28-33`); mock bank `mocks/data/top-up.ts:21` is mock-only |
| 8 | `apps/backend/src/modules/forms/infrastructure/captcha-validator.service.ts:34-62` (non-production accepts any non-empty token; production fails closed with `CAPTCHA_PROVIDER_NOT_CONFIGURED`); `apps/frontend/my-app/app/f/components/CaptchaWidget.tsx:25` sends hard-coded `test-turnstile-token` after a 450 ms fake delay | Captcha stub, no Turnstile secret or verify call. Production: guest submissions on `/f/[id]` always fail. Any non-production deploy: guests bypass captcha | Decide: exclude `/f/[id]` from pilot (recommended) or integrate Turnstile (site key in FE, secret in env). Do not ship the stub widget |
| 9 | `lib/forms/results-scope.ts:29` `RESPONSE_EXPORT_ENABLED = true` (export of respondent answers open to any form owner, client-side CSV/XLSX from `GET /forms/:id/responses`) | Export left open (override of IR.4a AC7.1, OQ-6) | Set `false` for pilot unless the owner approves data-export policy; remove entries in section 2 |
| 10 | `apps/backend/.env.example:59` `AUTH_RATE_LIMIT_MAX_REQUESTS=10` per 60 s per client IP (env default `env.schema.ts:129`); local `.env:31` sets 60; `deploy/.env.prod.example` sets `TRUST_PROXY_HOPS=2` but not the auth limit | Cohort sharing campus NAT shares one auth bucket; wrong hop count makes all users share the proxy IP | Configure: set explicit pilot value and verify `TRUST_PROXY_HOPS` against the AD-23 chain (Vercel, edge, Caddy, NestJS) at IR.5 |
| 11 | `apps/backend/.env.example:12`, `env.schema.ts:189` `SCHEDULER_ENABLED` defaults false; `.env.prod.example` sets true | With it off nothing time-based runs (48h reward release, deadline close, upload cleanup, outbox email); password reset email depends on the outbox | Configure: true on exactly one replica; verify at IR.5 |
| 12 | `apps/backend/.env.example:81-95` `EMAIL_DELIVERY_MODE=smtp` to local Mailpit, `SMTP_REQUIRE_TLS=false`, `EMAIL_FROM=no-reply@rescom.local` | Dev mail sink; production schema refuses capture/disabled and non-TLS (`env.schema.ts:495-533`) | Configure real SMTP provider and sender domain (SPF/DKIM) before J0 password recovery is approved |
| 13 | `apps/backend/.env.example:149-161`, `src/scripts/seed.ts:125-129,157-171`: demo seed accounts `admin@rescom.test`, `admin2@rescom.test` and demo users; random passwords written to `apps/backend/.seed-credentials.local.md` (gitignored, exists locally) | Demo accounts; seed refuses `NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=true` | Remove from the production path (never set `SEED_ALLOW_PRODUCTION`); create at least two real Admins by DB promotion (self-review/self-approval rules need two); delete the local credentials file |
| 14 | `apps/backend/.env.example:40`, `deploy/.env.prod.example` `FRONTEND_ORIGINS`; `deploy/README.md:14-16` and `deploy/.env.prod.example:7-8` use `rescom.io.vn` / `rescom.example.com`, while IR.1 requires `app.rescom.com.vn` (AD-23) | Origin mismatch breaks exact-origin CSRF, OAuth callback and cookies | Configure per decision 3; update deploy docs and Google OAuth redirect |
| 15 | `apps/backend/.env.example:149`, local `apps/backend/.env`, `deploy/.env.prod` and `apps/frontend/my-app/.env.local` exist on disk and are gitignored (`.gitignore:73,139`, frontend `.gitignore:34`); only `*.example` files are tracked | Real secrets may live in these files (not read for this inventory) | Owner confirms no real secret was ever committed (`git log -S` scan) and rotates anything that was |
| 16 | NODE_ENV-gated relaxations: captcha pass-through (item 8), cookie `secure` only in production (`modules/auth/presentation/cookie-options.helper.ts:21,41,61`), HSTS only in production (`common/security/helmet.config.ts:23`), email default `capture` outside production (`env.schema.ts:494`), rate limits x100 under `NODE_ENV=test` (`.env.example:60`), seed guard | Any deploy that is not literally `NODE_ENV=production` silently gets the relaxed behavior | Configure: staging and pilot both run `NODE_ENV=production`; assert in IR.5 |
| 17 | `apps/backend/.env.example:129` `ABUSE_CONTROL_PROFILE=REDIS_DISABLED_SINGLE_REPLICA`, `:135` `PARTICIPATION_RATE_LIMIT_POLICY_VERSION=participation-rate-limit-v1` (provisional, PRD OQ-16 unapproved) | Single replica only; provisional policy values | Confirm one API replica; owner approves or renames the policy version |
| 18 | `apps/backend/test` PG suites skip when the DB env var is unset (`ir-3-ir-4-evidence-2026-10-02.md`) | A green CI can mean the PG evidence did not run | Set `JOURNEY_TEST_DATABASE_URL` / `FINANCIAL_TEST_DATABASE_URL` in CI (Story 11.3) |

Owner and due date for every row: TBD (placeholder, decision 2).

## 4. Decisions for the owner

Recommended defaults are grounded in what is built and tested. "Approve" = in the pilot; "Hide" = build-exclude or flag off, no new Phase 2 scope. Owner / due date for each: `TBD / TBD`.

| # | Decision | Recommended default | Reason |
|---|---|---|---|
| 1 | Pilot journey list | Approve J0 auth/account, J1 respondent internal, J2 respondent external, J3 publisher internal, J4 publisher external, J5 wallet and top-up, J6 admin console (surveys, top-ups, users, fraud-log, transactions) | All have verified calls and IR.3/IR.4 evidence; nothing in them needs a mock |
| 2 | Integration Lead, Release Manager, domain owners (Auth, Respondent, Publisher, Economy, Admin, Infra), decision owners, due dates | Record names; placeholders `TBD / TBD` until supplied | AC requires them; not derivable from the repo |
| 3 | AD-23: canonical origin `app.rescom.com.vn`, relative `/api` rewritten Vercel, edge, Caddy, NestJS:4000 | Confirm | Deploy docs and examples still say `rescom.io.vn` / `rescom.example.com` (section 3, item 14); `FRONTEND_ORIGINS`, OAuth redirect and CSRF depend on it |
| 4 | Password recovery routes | Approve | e2e `password-reset` (+.prisma), FE `password-reset.test.mjs`; needs SMTP and `SCHEDULER_ENABLED=true` |
| 5 | Reliability (`/account/trust`) | Hide | Mock-only (`GET /integrity/reliability/me`), Epic 10 deferred |
| 6 | Form responses (`/forms/[id]/responses*`) | Approve | Verified, e2e `publisher-results` (+.prisma), FE contract test |
| 7 | Form analytics | Approve | Verified (`GET /analytics`), same suites |
| 8 | Progress (`/forms/[id]`) | Approve | Verified (`GET /progress`), same suites |
| 9 | Publisher complaints (`/forms/[id]/complaints/*`) | Hide | Mock-only; route is already orphaned (no inbound link); Story 8.5 deferred |
| 10 | Admin disputes (`/admin/disputes`) | Hide | Mixed page; dispute half is mock-only. Missing-code reports and limit reset are real, so rebuild a missing-code-only view only if J2 stays in scope |
| 11 | Quality (admin `/admin/quality`, publisher `/forms/[id]/quality`) | Hide | Mock-only, Epic 10 deferred; no backend |
| 12 | Export | Hide | Real data, but override of IR.4a AC7.1 and OQ-6 is unresolved; hiding is one flag (`RESPONSE_EXPORT_ENABLED`) |
| 13 | Version diff | Hide diff, approve version list + read-only version detail | Detail is verified; diff is client-side only and an override of AC5.2; one flag (`VERSION_DIFF_ENABLED`) |
| 14 | External completion | In scope | e2e `external-completion` (time barrier, expiry, replay), PG replay test (f); IR.3 evidence already treats it as in scope |
| 15 | Analytics (publisher summary) | In scope | Same as 7 |
| 16 | Consent and telemetry | In scope for the runner (consent, integrity events); no raw telemetry exposed; integrity metadata stays `NOT_ASSESSED` | e2e `integrity-consent`, `survey-telemetry`; Epic 10 deferred |
| 17 | Engagement: streak, tier, leaderboard | Hide | Mock-only; entry points listed in section 2 |
| 18 | AI builder | Hide | Mock-only; backend has only an unused `POST /forms/ai/prepare-prompt`; manual builder is verified |
| 19 | Override IR.4a AC7 (export, quality, complaints stay reachable) | Revert to pilot target: hide all three | Decisions 9, 11, 12 |
| 20 | Override IR.4a AC5.2 (version diff visible) | Revert: hide | Decision 13 |
| 21 | Override IR.4b C3/C4 (`0` placeholders for disputes and quality counts) | Revert: remove those counts and badges | Hidden screens must not show fake zero queues (`admin-nav.ts:17-18`) |
| 22 | Guest public form `/f/[id]` | Exclude from pilot | Captcha is a stub, production fails closed (section 3, item 8); no Turnstile integration |
| 23 | Override IR.4b C7 (no pilot nav filter) | Revert: apply the filter | Needed to remove nav entries in section 2 |
| 24 | Hybrid mocking | Pilot and staging build `disabled`; remove `hybrid` from `deploy/docker-compose.prod.yml:33` | IR.6; `hybrid` is a hard blocker (section 3, item 1) |
| 25 | Features built without a story (auth throttle config, S3 checksum fix, runner `file_upload`, integrity consent, survey topic, QUOTA auto-close, forgot/reset password, session revoke reason, admin fraud-log/ledger/outbox views) | Approve all except admin outbox views (no frontend, ops-only) | Each has an e2e suite (`auth-throttling`, `file-storage`, `integrity-consent`, `password-reset`, `admin-read-views`); outbox has no FE caller |
| 26 | Production defaults (section 3) | Approve all "configure/remove" decisions; add startup refusal for placeholder secrets | Items 5-6 are validator gaps, not config gaps |
| 27 | Assumed contracts (rows marked `assumed`) | Promote publisher response schemas (forms list, detail, draft, publish, close, reopen, versions, pricing quote, in-progress attempts), `/auth/csrf`, `/auth/refresh` into `@rescom/schemas` as IR.4 work; owner = Publisher domain | Tests exist for all; only the shared schema is missing |
| 28 | Unit-only contracts (`/product-tours`, `/admin/missing-code-reports`) | Add one e2e each, or accept unit evidence | No e2e today |

## 5. Coverage summary

- Frontend-reachable API calls inventoried: **99** (includes 2 raw-`fetch` telemetry URLs and 2 public-form URLs).
- By status: **verified 66**, **verified-unit 3**, **assumed 14**, **mock-only 16** (14 DEFERRED_KEEP_MOCK + 2 MOCK_ONLY called by the FE; the third MOCK_ONLY, `PUT /storage/mock-uploads/:id`, is a browser PUT with no FE `/api` call).
- Route-diff (`tests/route-diff.test.mjs`) allowlist: MOCK_ONLY 3, DEFERRED_KEEP_MOCK 14, PLANNED 0, REMOVE 0. Every frontend call is either served by a controller or listed there; no reachable call is unclassified.
- Recommended pilot set (every call with a controller, i.e. all except mock-only): **83** calls. Mapped to controller: **83/83 = 100%**. Mapped to controller + shared schema + test (verified or verified-unit): **69/83 = 83%**. Remaining 14 are `assumed` (shared response schema missing).
- Mock-only calls reachable in the current build: 16. They reach zero pilot-journey screens only after the hides in section 2 are applied; with `disabled` and no hides, the deferred screens would call a backend that has no such route (404).
- Direct `mockRepository` consumers outside `mocks/`: **0**.
- Pilot-journey screens with a mock-only dependency today: `/account` (engagement, reliability rows), `/forms/[id]` (quality tab), `/forms/[id]/builder*` (AI entry points), admin overview/nav (disputes, quality). Everything else is real.

### Surprises worth a look
1. `deploy/docker-compose.prod.yml:33` builds production with `hybrid` mocking.
2. Deploy docs and examples use `rescom.io.vn`; IR.1 AC and AD-23 name `app.rescom.com.vn`.
3. Production validator accepts the `.env.example` placeholder secrets (length-only check) and the Google placeholder values.
4. `/f/[id]` guest form ships a stub captcha that sends `test-turnstile-token`; production rejects all tokens, so the route is dead there.
5. The complaints route has no inbound link (orphan), and `PUBLISHER_DISPUTES_ENABLED` gates nothing.
6. Backend `POST /forms/ai/prepare-prompt` exists but the frontend never calls it; the AI builder runs on 5 mock routes.
7. No reachable frontend call lacks both a controller and an allowlist entry. Not covered by route-diff: raw-`fetch` URLs (telemetry, public forms, storage) and the browser PUT to the presigned S3 URL.
8. The IR epic's "direct mockRepository consumers" list is already empty.

## Owner decisions (2026-10-02)

1. **Pilot journeys:** all 7 approved: auth/account (including password recovery), respondent internal, respondent external (Google Forms, external completion in scope), publisher internal, publisher external (including progress, responses and analytics), wallet and top-up, admin console. Consent/telemetry in scope for the runner.
2. **Hidden or build-excluded in the pilot build:** reliability/trust, publisher complaints, admin disputes (the real "Báo thiếu mã" tab stays), Survey Quality (admin and publisher), export, version diff (version list and read-only detail stay), engagement (streak, tier, leaderboard), AI builder, guest form `/f/[id]` (stub captcha). No deferred scope is marked complete or moved into Phase 1.
3. **Mocking:** pilot and staging builds use `NEXT_PUBLIC_API_MOCKING=disabled`; every 2026-10-01 internal-testing override (IR.4a AC7 and AC5.2, IR.4b C3/C4 and C7) is reverted for the pilot build. Local dev may stay `hybrid`.
4. **AD-23 origin:** `app.rescom.com.vn` confirmed; deploy docs using `rescom.io.vn` / `rescom.example.com` must be corrected.
5. **Owners and due dates:** TBD (to be recorded by the owner).

## Implementation of the decisions (2026-10-02)

- **Contracts:** the 14 `assumed` calls are now `verified`. Their response schemas live in `@rescom/schemas` (`forms/publisher-form.schema.ts`, `auth/csrf.schema.ts`), the frontend services parse with them, and the `forms-draft`, `forms-escrow`, `forms-versioning` and `auth` e2e suites parse real responses with them. The 3 unit-only calls are now `verified` by `product-tours.e2e-spec.ts` and `admin-missing-code-reports.e2e-spec.ts`. New counts: 83 pilot calls, 83 verified (100%); 16 mock-only, all unreachable in the pilot build.
- **Pilot build:** `NEXT_PUBLIC_PILOT_BUILD=true` (`lib/pilot-scope.ts`, `PILOT_HIDDEN_ROUTES`) makes every hidden screen render `notFound()` and removes its entry points; checked by `tests/pilot-scope.test.mjs`. Export is client-side (no backend endpoint), so the frontend flag closes it.
- **Deploy:** `deploy/docker-compose.prod.yml` builds with mocking `disabled` and the pilot flag; domains are `app.rescom.com.vn` (plus `s3.rescom.com.vn` and mail `@rescom.com.vn`, confirmed by the owner).
- **Production defaults:** `env.schema.ts` now refuses `replace_with_*` / `changeme*` / `example*` placeholders in secrets, storage and SMTP credentials, and the default DB password.
- **Still open:** owners and due dates; guest `/f/[id]` is hidden until a real Turnstile integration exists; seed demo admins must not be loaded on staging/production.
