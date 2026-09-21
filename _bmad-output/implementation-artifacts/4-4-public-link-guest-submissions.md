---
baseline_commit: a40a63c202dfab9d3bac0b818eb5287211e1070d
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "_bmad-output/implementation-artifacts/4-3-feed-interactions-sortfilterauto-hide.md"
  - "packages/schemas/src/forms/form-definition.schema.ts"
  - "apps/backend/src/modules/forms/forms.module.ts"
---

# Story 4.4: Public Link & Guest Submissions

Status: review

## Story

As a Publisher,
I want to generate a public link for my Internal Form and allow non-registered guests to submit responses,
So that I can collect data outside the RESCOM ecosystem without spending Escrow points.

## Acceptance Criteria

### AC1 — Public Form & Guest Submission Contract (`packages/schemas`)
**Given** the shared schema package
**When** defining public access and guest submissions
**Then**:
1. `formSettingsSchema` supports `allowPublicAccess: z.boolean().default(true)`.
2. `publicFormDetailsSchema` is defined and exported:
   - `id`: UUID
   - `title`: string
   - `description`: string nullable
   - `type`: 'INTERNAL'
   - `versionNumber`: positive integer
   - `blocks`: `z.array(formBlockSchema)`
   - `settings`: `formSettingsSchema`
   - `metadata`: `formIntegrityMetadataSchema`
   - `publicUrl`: string
   - `publishedAt`: string nullable
3. `guestSubmissionSchema` is defined and exported:
   - `answers`: `z.record(z.unknown())`
   - `captchaToken`: string min 1 char
   - `telemetry`: `z.record(z.unknown()).optional()`
4. `guestSubmissionResponseSchema` is defined and exported:
   - `submissionId`: string UUID
   - `formId`: string UUID
   - `status`: 'SUBMITTED'
   - `isGuest`: true
   - `rewardEarned`: 0
   - `integrityStatus`: 'ASSESSED'
   - `respondentReliability`: 'NOT_AVAILABLE'
   - `submittedAt`: string
5. TypeScript types `PublicFormDetailsDto`, `GuestSubmissionInput`, and `GuestSubmissionResponseDto` are exported from `@rescom/schemas`.

### AC2 — Public Form Access & Validation (`apps/backend`)
**Given** an unauthenticated visitor
**When** requesting `GET /api/public/forms/:id`
**Then**:
1. Returns HTTP 200 with `PublicFormDetailsDto` if the form exists, is `PUBLISHED`, has type `INTERNAL`, and has `allowPublicAccess !== false` (and `requireAuth !== true`).
2. If the form is not found or not published, returns HTTP 404.
3. If the form requires authentication (`requireAuth: true` or `allowPublicAccess: false`), returns HTTP 403 Forbidden with `PUBLIC_ACCESS_DISABLED`.
4. Endpoint requires no authentication cookie or session header.

### AC3 — Guest Submission Processing & Escrow Isolation (`apps/backend`)
**Given** an unauthenticated visitor submitting answers via `POST /api/public/forms/:id/submissions`
**When** the submission payload is processed
**Then**:
1. Answers are validated against the form's question blocks schema.
2. The submission is persisted as a `Response`:
   - `isGuest`: `true`
   - `respondentId`: `null`
   - `status`: `'SUBMITTED'`
   - `ipAddress`: captured client IP address
   - `answersJson`: validated answers
3. **Escrow Isolation:** Points are strictly NOT deducted from Publisher escrow, and NO reward points are awarded to the guest submitter (zero ledger entries created).
4. **Integrity & Reputation Isolation:**
   - Response Integrity assessment is performed/recorded.
   - `RespondentReliability` is marked `NOT_AVAILABLE` and cannot be merged into any authenticated user profile.
5. Returns HTTP 201 with `GuestSubmissionResponseDto`.

### AC4 — Bot Protection & Strict IP Rate Limiting (`apps/backend`)
**Given** guest submission requests
**When** checking abuse prevention controls
**Then**:
1. Enforces strict IP-based rate limiting (configurable, default 3 submissions per IP per 24 hours). If exceeded, returns HTTP 429 Too Many Requests.
2. Enforces CAPTCHA token verification (Turnstile / reCAPTCHA). In test mode or with mock token `'test-turnstile-token'`, verification passes. If missing or invalid, returns HTTP 400 Bad Request with `CAPTCHA_VERIFICATION_FAILED`.

### AC5 — Frontend Public Form Experience & Publisher Link Sharing (`apps/frontend/my-app`)
**Given** a visitor or publisher
**When** interacting with public link features
**Then**:
1. Public route `/f/[id]` renders the published form using `FormRenderer` for unauthenticated guests.
2. Includes Turnstile/CAPTCHA verification widget before submitting.
3. Upon successful guest submission, shows a clear completion screen confirming submission without requiring an account.
4. On Publisher Forms list and Form Edit pages, shows the shareable public link (`/f/[id]`) with a 1-click "Copy Link" button for published internal forms.

### AC6 — Comprehensive Test Coverage
**Given** unit, integration, and E2E suites across the monorepo
**When** tests and builds are executed
**Then**:
1. Unit tests for `publicFormDetailsSchema` and `guestSubmissionSchema`.
2. Unit tests for `PublicFormsService` (form retrieval, access control, guest submission, escrow isolation, and bot protection).
3. Unit tests for IP rate limiting and CAPTCHA validation.
4. E2E tests in `public-form-submissions.e2e-spec.ts` verifying guest view, guest submit, rate limiting, and 0 escrow deduction.
5. All regression test suites pass and frontend builds cleanly with 0 TypeScript errors.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Schemas & Contracts (`packages/schemas`)** (AC: 1)
  - [x] 1.1 Update `formSettingsSchema` to support `allowPublicAccess`.
  - [x] 1.2 Create `public-form.schema.ts` with `publicFormDetailsSchema`, `guestSubmissionSchema`, and `guestSubmissionResponseSchema`.
  - [x] 1.3 Export new schemas and TypeScript types in `packages/schemas/src/forms/index.ts` and root `index.ts`.
  - [x] 1.4 Write unit tests for public form and guest submission schemas.
  - [x] 1.5 Build and export `@rescom/schemas`.

- [x] **Task 2: Backend — CAPTCHA & IP Rate Limiting Infrastructure (`apps/backend`)** (AC: 4)
  - [x] 2.1 Create `CaptchaValidatorService` validating Turnstile/reCAPTCHA tokens with test bypass support.
  - [x] 2.2 Implement `GuestSubmissionRateLimiter` tracking and enforcing max 3 submissions per IP per 24 hours.
  - [x] 2.3 Write unit tests for CAPTCHA validator and rate limiter.

- [x] **Task 3: Backend — Public Form Service & Domain Logic (`apps/backend`)** (AC: 2, 3)
  - [x] 3.1 Create `PublicFormsService` in `apps/backend/src/modules/forms/application/public-forms.service.ts`.
  - [x] 3.2 Implement `getPublicForm(formId)` verifying published status, internal type, and public access settings.
  - [x] 3.3 Implement `submitGuestResponse(formId, input, ipAddress)` validating answers, recording `Response` with `isGuest: true`, creating `IntegrityAssessment` with reliability `NOT_AVAILABLE`, and verifying zero escrow deduction.
  - [x] 3.4 Write unit tests in `public-forms.service.spec.ts`.

- [x] **Task 4: Backend — Public Controller & Routing (`apps/backend`)** (AC: 2, 3, 4)
  - [x] 4.1 Create `PublicFormsController` under `@Controller('public/forms')` without `SessionAuthGuard`.
  - [x] 4.2 Add `GET :id` and `POST :id/submissions` endpoints.
  - [x] 4.3 Wire `PublicFormsService`, `PublicFormsController`, and providers into `FormsModule`.
  - [x] 4.4 Write controller unit tests in `public-forms.controller.spec.ts`.
  - [x] 4.5 Write E2E tests in `apps/backend/test/public-form-submissions.e2e-spec.ts`.

- [x] **Task 5: Frontend — Public Form Page & Publisher Link Sharing (`apps/frontend/my-app`)** (AC: 5)
  - [x] 5.1 Create public route `apps/frontend/my-app/app/f/[id]/page.tsx` rendering the form for guest submission with CAPTCHA token support.
  - [x] 5.2 Add guest completion screen after submission.
  - [x] 5.3 Add "Public Link" display with "Copy Link" button in Publisher form management (`/forms` and `/forms/[id]/edit`).

- [x] **Task 6: Full Monorepo Regression Testing & Verification** (AC: 6)
  - [x] 6.1 Run all backend unit tests (`npm test`).
  - [x] 6.2 Run all backend E2E tests (`npm run test:e2e`).
  - [x] 6.3 Run frontend production build (`next build --webpack`).
  - [x] 6.4 Verify all Acceptance Criteria are met and mark story for review.

---

## Dev Notes

### Architecture Context
- **Ownership (AD-16 / ARCHITECTURE-SPINE):** Public form access and guest submissions belong to the Survey Distribution bounded context. Guest submissions generate a `Response` entity tagged as `isGuest: true` with `respondentId: null`.
- **Zero Escrow Deductions:** Since guest respondents do not have a RESCOM account, no points are awarded, and publisher escrow remains untouched.
- **Integrity Assessment for Guests:** The submission triggers response integrity scoring (e.g. evaluating time spent and answer patterns), but Respondent Reliability is marked `NOT_AVAILABLE` because there is no persistent authenticated identity.
- **Security & Bot Protection:** The guest submission endpoint is unauthenticated, requiring both strict IP rate limiting (3 submissions per IP per 24 hours) and CAPTCHA/Turnstile token validation.
- **Clean Architecture Boundaries:** Domain and application layers are completely decoupled from `@nestjs/*` framework dependencies; domain exceptions are mapped to HTTP responses in `HttpExceptionFilter`.

---

## Dev Agent Record

### Implementation Plan
1. Define shared schemas in `@rescom/schemas` (`formSettingsSchema.allowPublicAccess`, `publicFormDetailsSchema`, `guestSubmissionSchema`, `guestSubmissionResponseSchema`).
2. Implement CAPTCHA validation and IP rate limiting services in backend infrastructure with `@Optional()` configuration for DI friendliness.
3. Implement `PublicFormsService` for public form retrieval and guest response submission, strictly enforcing zero escrow deductions and zero reward points.
4. Implement `PublicFormsController` with unauthenticated routes `GET /public/forms/:id` and `POST /public/forms/:id/submissions`, writing controller unit tests and comprehensive E2E tests.
5. Create frontend public route `/f/[id]` with `CaptchaWidget`, guest completion screen, and "Copy Link" buttons on publisher lists and edit pages.
6. Verify monorepo test suites, E2E suites, typechecking, linting, and production builds.

### Debug Log
- **Form Settings Schema Property:** Adding `allowPublicAccess: z.boolean().default(true)` to `formSettingsSchema` required updating initial form creation templates in `forms.service.ts` and test fixtures in `prisma-form.repository.spec.ts` and frontend edit/preview states.
- **NestJS DI Metadata:** Interface types on constructors caused NestJS DI to attempt resolving `Object` providers. Fixed by decorating constructor options with `@Optional()`.
- **Clean Architecture Boundary Validation (AC8):** `test/architecture.spec.ts` enforces that application and domain layers do not import `@nestjs/*`. Refactored `PublicFormsService` to throw pure domain exceptions (`PublicFormAccessDisabledException`, `CaptchaVerificationFailedException`, `GuestRateLimitExceededException`, `InvalidGuestSubmissionException`) which are translated into appropriate HTTP status codes in `HttpExceptionFilter`.
- **React 19 Linting Purity Rule:** `useRef(Date.now())` was flagged by Next.js ESLint (`react-hooks/purity`). Resolved by initializing `useRef<number | null>(null)` and populating inside `useEffect`.

### Completion Notes
- All 6 acceptance criteria for Story 4.4 are fully implemented and verified.
- 53 backend unit test suites (504 tests) pass with 100% success rate.
- 13 backend E2E test suites (132 tests) pass in band with 100% success rate.
- Full monorepo verification (`npm run verify`) passed cleanly (build, typecheck, lint, test).

---

## File List
- `packages/schemas/src/forms/form-definition.schema.ts`
- `packages/schemas/src/forms/public-form.schema.ts`
- `packages/schemas/src/forms/index.ts`
- `apps/backend/src/modules/forms/infrastructure/captcha-validator.service.ts`
- `apps/backend/src/modules/forms/infrastructure/guest-submission-rate-limiter.ts`
- `apps/backend/src/modules/forms/infrastructure/guest-security.spec.ts`
- `apps/backend/src/modules/forms/application/exceptions/form.exceptions.ts`
- `apps/backend/src/modules/forms/application/public-forms.service.ts`
- `apps/backend/src/modules/forms/application/public-forms.service.spec.ts`
- `apps/backend/src/modules/forms/presentation/public-forms.controller.ts`
- `apps/backend/src/modules/forms/presentation/public-forms.controller.spec.ts`
- `apps/backend/src/modules/forms/presentation/public-form.schema.spec.ts`
- `apps/backend/src/modules/forms/forms.module.ts`
- `apps/backend/src/common/http/http-exception.filter.ts`
- `apps/backend/test/public-form-submissions.e2e-spec.ts`
- `apps/frontend/my-app/app/f/[id]/page.tsx`
- `apps/frontend/my-app/app/f/components/CaptchaWidget.tsx`
- `apps/frontend/my-app/app/forms/components/renderer/FormRenderer.tsx`
- `apps/frontend/my-app/app/forms/page.tsx`
- `apps/frontend/my-app/app/forms/[id]/edit/page.tsx`
- `apps/frontend/my-app/app/forms/[id]/preview/page.tsx`
- `_bmad-output/implementation-artifacts/4-4-public-link-guest-submissions.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

---

## Change Log
- 2026-09-15: Initial story specification created for Story 4.4: Public Link & Guest Submissions. Status set to in-progress.
- 2026-09-15: Implemented shared schemas (`public-form.schema.ts`), backend services (`CaptchaValidatorService`, `GuestSubmissionRateLimiter`, `PublicFormsService`), presentation controller (`PublicFormsController`), frontend public view (`/f/[id]`), Turnstile widget (`CaptchaWidget`), and publisher link sharing. Full monorepo verification and E2E suites passing. Status updated to review.
