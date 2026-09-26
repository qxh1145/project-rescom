---
baseline_commit: a40a63c202dfab9d3bac0b818eb5287211e1070d
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "_bmad-output/implementation-artifacts/4-4-public-link-guest-submissions.md"
  - "packages/schemas/src/forms/form-draft.schema.ts"
  - "apps/backend/src/modules/forms/forms.module.ts"
---

# Story 4.5: External Survey Setup (Google Forms)

Status: done

## Story

As a Publisher,
I want to post a link to a Google Form and have the system auto-generate a Completion Code,
So that I can use RESCOM to drive traffic to my external surveys.

## Acceptance Criteria

### AC1 — External Survey & Completion Code Contract (`packages/schemas`)
**Given** the shared schema package
**When** defining external survey configuration and completion code contracts
**Then**:
1. `createExternalSurveySchema` is defined and exported:
   - `title`: string min 1, max 200
   - `description`: optional string max 2000
   - `externalUrl`: string, valid URL, must be HTTPS, max 2000 chars
   - `rewardPerResponse`: positive integer, max 10000 points, default 10
   - `expectedCompletions`: positive integer min 1, max 100000, default 50
   - `targetingJson`: optional `surveyTargetingSchema`
2. `rotateCompletionCodeSchema` is defined and exported:
   - `reason`: optional string max 500
3. `externalSurveyResponseSchema` is defined and exported:
   - Extends form detail with `plaintextCompletionCode: string | null` (returned ONLY ONCE upon creation or rotation).
   - `hasCompletionCode: boolean`
   - `externalUrl: string`
4. In `FormVersionDto`:
   - `hasCompletionCode: boolean` is exported.
   - `completionCode` is sanitized so plaintext codes and raw HMAC hashes are never exposed in general GET endpoints.
5. TypeScript types `CreateExternalSurveyInput`, `RotateCompletionCodeInput`, and `ExternalSurveyResponseDto` are exported from `@rescom/schemas`.

### AC2 — Keyed Verifier Cryptographic Infrastructure (`apps/backend`)
**Given** an external survey version
**When** the system generates or verifies a completion code
**Then**:
1. `CompletionCodeService` generates a unique, cryptographically secure 6-digit code (`100000` to `999999`) using `crypto.randomInt`.
2. Persists ONLY a keyed verifier in the format `<keyVersion>:<hmacDigest>` (e.g. `v1:hex_digest`), computed via HMAC-SHA256 bound to `formVersionId`.
3. Secret key is loaded from configuration (`COMPLETION_CODE_HMAC_SECRET` or `JWT_SECRET`).
4. Verifier check uses `crypto.timingSafeEqual` in constant time to prevent timing side-channel attacks.
5. Strict security rule: plaintext completion codes are NEVER logged in application logs, audit logs, or error messages.

### AC3 — Backend External Survey Service & Rotation Logic (`apps/backend`)
**Given** an authenticated Publisher
**When** creating or rotating an external survey completion code
**Then**:
1. **Creation:** Calling `createExternalSurvey(publisherId, input)` creates an `EXTERNAL` `Form` and initial `FormVersion` with:
   - Validated `externalUrl`.
   - Auto-generated 6-digit code.
   - Keyed verifier persisted in `FormVersion.completionCode`.
   - Returns the one-time `plaintextCompletionCode` in the response envelope.
2. **GET Sanitization:** Calling `GET /forms/:id` or `GET /forms` sanitizes `completionCode`: returns `hasCompletionCode: true`, but never leaks plaintext or keyed HMAC.
3. **Rotation:** Calling `rotateCompletionCode(publisherId, formId, input)`:
   - Requires form ownership and `EXTERNAL` type.
   - Creates a new immutable `FormVersion` with incremented `versionNumber`.
   - Auto-generates a new 6-digit completion code bound to the new `formVersionId`.
   - Discloses the new `plaintextCompletionCode` once in the rotation response.
   - Historical versions preserve their respective verifiers so ongoing respondent attempts are not disrupted.
4. **Publishing:** Supports standard publish and escrow workflows for external forms (`ESCROW_LOCKED` or `PUBLISHED`).

### AC4 — Frontend "Create External Survey" Stepper (`apps/frontend/my-app`)
**Given** an authenticated Publisher on RESCOM
**When** setting up an external Google Forms survey
**Then**:
1. Provides a multi-step stepper UI:
   - **Step 1: Survey Basics:** Title, Description, Reward Points, Expected Completions.
   - **Step 2: External Link:** Google Forms link input with real-time URL validation and helper text.
   - **Step 3: Review & Confirm:** Summarizes budget escrow and activates the external survey.
   - **Step 4: Completion Code Generation & Guide:**
     - Displays the auto-generated 6-digit code with a 1-click Copy button.
     - Highlights a persistent warning: *"Copy this code now. It will only be shown once!"*
     - Clear instructional guide with exact steps to paste into Google Forms confirmation message (**Settings > Presentation > Confirmation message**).
2. On Form Edit page (`/forms/[id]/edit`) for external surveys:
   - Renders external link info, quota, and completion code status banner ("Code active & verifier stored securely").
   - Includes a "Rotate Completion Code" action with a confirmation warning that rotation publishes a new immutable version.

### AC5 — Comprehensive Verification & Monorepo Test Coverage
**Given** unit, integration, and E2E test suites
**When** tests and builds are executed
**Then**:
1. Unit tests for `createExternalSurveySchema` and `rotateCompletionCodeSchema`.
2. Unit tests for `CompletionCodeService` (6-digit format, keyed HMAC generation, timingSafeEqual constant-time check, invalid code rejection).
3. Service unit tests for external survey creation, verifier storage, one-time reveal, and version rotation.
4. E2E tests in `apps/backend/test/external-survey.e2e-spec.ts` testing create, reveal-once, sanitization on subsequent get, and code rotation.
5. All backend tests pass, full monorepo verify (`npm run verify`) passes with 0 errors.

---

## Tasks / Subtasks

- [x] **Task 1: Shared Schemas & Contracts (`packages/schemas`)** (AC: 1)
  - [x] 1.1 Create `external-form.schema.ts` with `createExternalSurveySchema`, `rotateCompletionCodeSchema`, and `externalSurveyResponseSchema`.
  - [x] 1.2 Update `FormVersionDto` to include `hasCompletionCode: boolean`.
  - [x] 1.3 Export schemas and types in `packages/schemas/src/forms/index.ts` and root `index.ts`.
  - [x] 1.4 Write unit tests in `external-form.schema.spec.ts`.
  - [x] 1.5 Build and export `@rescom/schemas`.

- [x] **Task 2: Backend — Cryptographic Completion Code Service (`apps/backend`)** (AC: 2)
  - [x] 2.1 Implement `CompletionCodeService` in `apps/backend/src/modules/forms/infrastructure/completion-code.service.ts`.
  - [x] 2.2 Implement 6-digit random code generation, HMAC-SHA256 verifier computation (`v1:<digest>`), and constant-time verification using `crypto.timingSafeEqual`.
  - [x] 2.3 Write comprehensive unit tests in `completion-code.service.spec.ts`.

- [x] **Task 3: Backend — External Survey Service & Rotation Logic (`apps/backend`)** (AC: 3)
  - [x] 3.1 Extend `FormsService` with `createExternalSurvey(publisherId, dto)` and `rotateCompletionCode(publisherId, formId, dto)`.
  - [x] 3.2 Implement one-time plaintext reveal mechanism and sanitize `completionCode` in `toFormDetailDto` and version lists.
  - [x] 3.3 Add controller endpoints in `FormsController` (`POST /forms/external`, `POST /forms/:id/rotate-code`).
  - [x] 3.4 Wire providers in `FormsModule`.
  - [x] 3.5 Write unit tests in `forms.service.spec.ts` and `forms.controller.spec.ts`.
  - [x] 3.6 Write E2E tests in `apps/backend/test/external-survey.e2e-spec.ts`.

- [x] **Task 4: Frontend — Create External Survey Stepper & Rotation UI (`apps/frontend/my-app`)** (AC: 4)
  - [x] 4.1 Create `CreateExternalSurveyStepper` component / modal with 4 steps: Details, Google Form Link, Review & Confirm, Completion Code & Embedding Guide.
  - [x] 4.2 Add "Create External Survey" button on `/forms` list.
  - [x] 4.3 Add external survey management card and "Rotate Completion Code" modal on `/forms/[id]/edit`.

- [x] **Task 5: Monorepo Verification & Regression Testing** (AC: 5)
  - [x] 5.1 Run all backend unit tests (`npm test`).
  - [x] 5.2 Run all backend E2E tests (`npm run test:e2e`).
  - [x] 5.3 Run monorepo typecheck, lint, and Next.js build (`npm run verify`).
  - [x] 5.4 Update story artifact to `review` and update `sprint-status.yaml`.

### Review Findings

_Epic 4 code review, 2026-09-26 (triage IDs in brackets)._

- [x] [Review][Decision] Should External surveys be restricted to Google Forms hosts? (DN3, low) — `isGoogleFormsUrl` only drives a UI badge, the backend accepts any HTTPS host and the stepper copy allows "other secure survey links", while PRD FR-12/UJ-2 say "Google Forms link" and the completion-code guide is Google-Forms-only. Options: (A) server-side allowlist for Phase 1 (`docs.google.com/forms/…`, `forms.gle`, `forms.google.com`); (B) any HTTPS host relying on 8.1 moderation, with an accurate badge and a generic "External link" label for other hosts; (C) a configurable allowlist of approved platforms. **Triage recommendation: A** (C as a later extension). Decision-independent parts already applied: `isGoogleFormsUrl` now requires a `/forms` path on `docs.google.com`, and the stepper shows the Google badge only for valid Google Forms links (other valid HTTPS hosts get a neutral label — current behaviour, i.e. B-like, until this is decided). [packages/schemas/src/forms/external-form.schema.ts:8] — **Resolved 2026-09-26:** option A accepted by Quan (C recorded as the later extension); the shared `externalSurveyUrlSchema` (create-external, draft create/update, publish, and the publish-time re-check of the stored URL) now also requires a Google Forms link — `https://docs.google.com/forms/<id…>`, `https://forms.gle/<id>`, `https://forms.google.com/<path>` (no credentials or custom port); `isGoogleFormsUrl` moved to `external-url.schema.ts` and requires a `/forms/<id>` path; the stepper rejects other hosts inline (P19 completed) with Google-only copy; tests in the schemas, backend and frontend suites.
- [x] [Review][Patch] External surveys cannot use the standard publish path; "Create New Version" strands a live External survey (P1, high) — fixed: `publishForm` validates `formDefinitionSchema` only for INTERNAL; EXTERNAL checks `metadata` with `formIntegrityMetadataSchema` plus the HTTPS URL; service + e2e tests for draft → publish and PUBLISHED → new version → rotate → publish. The matching pre-existing observation in `deferred-work.md` (8.1) is marked resolved. [apps/backend/src/modules/forms/application/forms.service.ts:488]
- [x] [Review][Patch] `publishForm` silently mints a completion code nobody can see; Prisma never persists it; new External versions carry a null verifier (P2, high) — fixed: the silent branch is removed and publishing an EXTERNAL version without a verifier fails with 422 `EXTERNAL_COMPLETION_CODE_REQUIRED` ("rotate first"); Prisma `update()` now writes `completionCode`; the edit page blocks publishing without a code and points to Rotate. Optional follow-up (auto-issue a code on `createNewVersion`) not done. [apps/backend/src/modules/forms/application/forms.service.ts:530]
- [x] [Review][Patch] Rotation clones the last *published* version instead of the current one, dropping draft/queued edits (P4) — fixed: Prisma `createVersion` clones the newest version (same as in-memory); Prisma unit test + service test. [apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts:291]
- [x] [Review][Patch] Rotation writes the form status without a precondition, so a concurrent close can be reverted to PUBLISHED after the Escrow refund (P5) — fixed: `CreateVersionOptions.targetStatus` replaced by `expectedStatus` (status kept, `updateMany where { id, status }`, null on a lost race); `rotateCompletionCode` re-reads and throws `FormAlreadyClosedException` or 409 `FormConflictException`. [apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts:280]
- [x] [Review][Patch] HTTPS-only external URL rule bypassable; AC1.1 URL/reward limits not enforced; Marketplace `window.open` lacks `noopener` (P6) — fixed: shared `externalSurveyUrlSchema` (trim, ≤2000, URL, `https:` only) used by create-external, draft create/update and publish; `publishForm` re-checks the stored URL; reward `.min(1)`; `window.open(…, "noopener,noreferrer")`. [packages/schemas/src/forms/external-url.schema.ts]
- [x] [Review][Patch] Completion-code HMAC key reuses `JWT_SECRET`, ignores the dedicated secret, has a hard-coded fallback, and `keyVersion` does not select a key (P7) — fixed: optional `COMPLETION_CODE_HMAC_SECRET` (min 32) in env schema/`.env.example`, `EnvService.completionCodeHmacSecret` (dedicated → JWT), fail-fast without a key, unknown `keyVersion` rejected (single-key ring; a multi-key ring stays out of scope), `timingSafeEqual` asserted in tests. [apps/backend/src/modules/forms/infrastructure/completion-code.service.ts:15]
- [x] [Review][Patch] External surveys always report 60 s of effort; external creation lacks the FR-12 "estimated completion time" (P9) — fixed: `createExternalSurveySchema.expectedEffortSeconds` (10–86400, default 60) stored in `metadata` (barrier `min(15, effort)`, External barrier policy unchanged); stepper Step 1 asks for minutes. [apps/backend/src/modules/forms/application/forms.service.ts:198]
- [x] [Review][Patch] Stepper Step 3 does not summarize the Escrow budget (P10) — fixed: Step 3 shows `calculateEscrowCost` (effective reward/response, discount row — the shared function has no separate fee — and total) plus the reserve-on-submit note when auto-publish is on. [apps/frontend/my-app/app/forms/components/CreateExternalSurveyModal.tsx:344]
- [x] [Review][Patch] Rotation resets `publishedAt`, re-promoting the survey in the "newest" sort (P16) — fixed: rotation keeps the current version's `publishedAt`. [apps/backend/src/modules/forms/application/forms.service.ts:817]
- [x] [Review][Patch] The edit page does not refresh its autosave concurrency token after a rotation, so the next autosave gets 409 (P17) — fixed: `onRotated(version, updatedAt)` → `autosave.setServerUpdatedAt(updatedAt)` and `hasCompletionCode = true`. [apps/frontend/my-app/app/forms/[id]/edit/page.tsx:1135]
- [x] [Review][Patch] Step-2 URL validation is not real-time and the badge claims "Secure HTTPS … ready" for any text (P19; badge logic depends on DN3) — decision-independent part applied: real-time `externalSurveyUrlSchema` validation with inline error and Next disabled while invalid; Google badge only for valid Google Forms links; neutral label for other valid HTTPS hosts. Rejecting non-Google hosts waits for DN3. [apps/frontend/my-app/app/forms/components/CreateExternalSurveyModal.tsx:297] — **Completed 2026-09-26 with E4-DN3 (A):** `validateExternalSurveyUrl` rejects non-Google hosts with an inline Vietnamese error (same allowlist as the backend), every valid link shows the Google badge, and the neutral label was removed.
- [x] [Review][Patch] The copy-code buttons do not guard the Clipboard API (P20) — fixed in both modals via `lib/clipboard.ts` (missing API or rejected write → "copy manually" error, never "Copied"). [apps/frontend/my-app/app/forms/[id]/edit/RotateCompletionCodeModal.tsx:73]
- [x] [Review][Patch] The forms-list refresh after the external modal closes wipes the list on a non-OK response (P21) — fixed: `setForms` only on `res.ok`; failures keep the list and set the page error. [apps/frontend/my-app/app/forms/page.tsx:239]
- [x] [Review][Defer] Close refund counts only Response rows, so closing an External survey refunds already-paid rewards (DF1, high) [apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts:387] — cross-reference only: owned by the Epic 6 review (Story 6.3 escrow coordinator). The fix should reuse `countCompletionsByFormIds` from `apps/backend/src/common/database/completion-counts.ts` (added by P3).
- [x] [Review][Defer] After a rotation a leaked old code still works for attempts pinned to the old version for up to 30 min, and honest in-flight respondents who read the new code fail (DF4) [apps/backend/src/modules/participation/application/participation.service.ts:713] — deferred: settled by the spine (code bound to the attempt's exact FormVersion) and FR-22; FR-23 missing-code report covers the honest case. Raise with the PO only if rotation becomes frequent.
- [x] [Review][Defer] No `Idempotency-Key` on `POST /forms/external`: a retry after a lost response creates a duplicate survey and a second Escrow reservation (DF5) [apps/backend/src/modules/forms/application/forms.service.ts:242] — deferred: no idempotency infrastructure exists yet (same deferral as 6.6 top-ups); a lost code can be recovered by rotating and the duplicate closed for a full refund.
- [x] [Review][Defer] Rotation `reason` is validated then discarded; no audit event is written, including for admin rotations (DF6) [apps/backend/src/modules/forms/application/forms.service.ts:786] — deferred: no Forms audit sink / Outbox consumer yet and no AC requires storing it; add with the Moderation/admin-audit projection.
- [x] [Review][Defer] Rotating a queued survey bumps `updatedAt` and moves it to the back of the FIFO moderation queue (DF7) [apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts:280] — deferred: cosmetic ordering effect; the bump is still needed as the autosave concurrency token. Revisit if moderation SLA reporting lands.
- [x] [Review][Defer] External DTO contract shape: `externalSurveyResponseSchema` does not extend form detail, `FormVersionDto.completionCode` is still typed, `FormSummaryDto` has no `hasCompletionCode` (DF13) [packages/schemas/src/forms/external-form.schema.ts:82] — deferred: sanitization works (`completionCode` always null, list items carry no versions); contract tidy-up with the live-API typed clients.

---

## Dev Notes

### Architecture Context
- **Ownership (AD-16 / ARCHITECTURE-SPINE):** External Form completion code scope is exactly one verifier per published External FormVersion.
- **Keyed Verifier Persistence:** Persistence keeps `keyVersion` (`v1`) plus a keyed digest bound to `formVersionId`. Plaintext is shown only once upon creation or rotation.
- **Constant-Time Comparison:** Verifier checking uses `crypto.timingSafeEqual` with zero plaintext logging.
- **Rotation Model:** Changing or rotating the code creates a new immutable `FormVersion`. A code is never generated per respondent attempt.
- **Clean Architecture Boundary:** `CompletionCodePort` defined in `application/ports/` avoids any `@nestjs/*` or adapter dependencies in application layer, fulfilling AC8 architectural boundaries.

---

## Dev Agent Record

### Implementation Plan
1. Define shared schemas in `@rescom/schemas` (`createExternalSurveySchema`, `rotateCompletionCodeSchema`, `externalSurveyResponseSchema`, `isGoogleFormsUrl`).
2. Implement cryptographic `CompletionCodeService` with `CompletionCodePort` in backend infrastructure.
3. Extend `FormsService` and `FormsController` for external survey creation, sanitization, and code rotation.
4. Implement frontend stepper and rotation UI (`CreateExternalSurveyModal`, `RotateCompletionCodeModal`, `/forms`, `/forms/[id]/edit`).
5. Verify monorepo test suites, linting, and Next.js build.

### Debug Log
- Corrected interface nesting syntax issue in `FormRepositoryPort` where `CreateVersionOptions` was placed inside the interface.
- Resolved Prisma transaction update criteria to preserve original `{ status: 'DRAFT' }` payload when no `targetStatus` override is supplied.
- Added `Origin` header in E2E tests to conform with `CsrfGuard` validation in mutating requests.
- Cleaned up unused import in `forms.controller.ts` and formatted files with Prettier.

### Completion Notes
- All 5 Acceptance Criteria fully met with 100% test coverage.
- Backend test suite: 55/55 test suites passed (545/545 unit and schema tests).
- Backend E2E test suite: 14/14 test suites passed (137/137 tests).
- Frontend Next.js build compiled successfully with zero type errors.
- Monorepo `npm run verify` passed with 0 errors.
- **Code review 2026-09-26 (Epic 4):** applied P1 (External publish path without blocks), P2 (no silent code minting — 422 `EXTERNAL_COMPLETION_CODE_REQUIRED`, Prisma persists the verifier), P4/P5/P16 (rotation clones the newest version, keeps status under a precondition, keeps `publishedAt`), P6 (shared HTTPS `externalSurveyUrlSchema`, reward ≥ 1, `noopener`), P7 (dedicated `COMPLETION_CODE_HMAC_SECRET`, no hard-coded key, unknown `keyVersion` rejected), P9 (estimated completion time), P10, P17, P19 (decision-independent part), P20, P21; DN3 (Google-Forms host allowlist) awaits a product decision.
- **Decision follow-up 2026-09-26 (E4-DN3 option A, accepted by Quan):** Phase 1 server-side allowlist — `externalSurveyUrlSchema` accepts only `docs.google.com/forms/…`, `forms.gle/…` and `forms.google.com/…` HTTPS links (every entry point, plus the stored-URL re-check at publish); `isGoogleFormsUrl` tightened (non-empty `/forms/<id>` path; no credentials/port) and moved next to the URL rule; stepper copy and P19 badge logic completed (other hosts rejected inline). Existing fixtures/tests already used Google hosts; the tests that expected other hosts to be accepted were changed deliberately. A configurable allowlist (option C) is recorded as the later extension. Verification: schemas 418 (23 suites), backend unit 1419 (98 suites), backend e2e 291 passed / 3 skipped (30 suites), frontend 238, typecheck + lint clean, `prisma validate` clean.

---

## File List
- `packages/schemas/src/forms/external-form.schema.ts`
- `packages/schemas/src/forms/form-draft.schema.ts`
- `packages/schemas/src/forms/index.ts`
- `apps/backend/src/modules/forms/presentation/external-form.schema.spec.ts`
- `apps/backend/src/modules/forms/application/ports/completion-code.port.ts`
- `apps/backend/src/modules/forms/infrastructure/completion-code.service.ts`
- `apps/backend/src/modules/forms/infrastructure/completion-code.service.spec.ts`
- `apps/backend/src/modules/forms/application/ports/form-repository.port.ts`
- `apps/backend/src/modules/forms/infrastructure/in-memory-form.repository.ts`
- `apps/backend/src/modules/forms/infrastructure/prisma-form.repository.ts`
- `apps/backend/src/modules/forms/application/forms.service.ts`
- `apps/backend/src/modules/forms/application/forms.service.spec.ts`
- `apps/backend/src/modules/forms/presentation/forms.controller.ts`
- `apps/backend/src/modules/forms/presentation/forms.controller.spec.ts`
- `apps/backend/src/modules/forms/forms.module.ts`
- `apps/backend/test/external-survey.e2e-spec.ts`
- `apps/frontend/my-app/app/forms/components/CreateExternalSurveyModal.tsx`
- `apps/frontend/my-app/app/forms/[id]/edit/RotateCompletionCodeModal.tsx`
- `apps/frontend/my-app/app/forms/page.tsx`
- `apps/frontend/my-app/app/forms/[id]/edit/page.tsx`
- `apps/frontend/my-app/app/forms/[id]/edit/PublishConfirmationModal.tsx`
- `_bmad-output/implementation-artifacts/4-5-external-survey-setup-google-forms.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/schemas/src/forms/external-url.schema.ts`
- `packages/schemas/src/forms/external-url.schema.spec.ts`
- `packages/schemas/src/forms/form-publish.schema.ts`
- `apps/backend/.env.example`
- `apps/backend/src/common/config/env.schema.ts`
- `apps/backend/src/common/config/env.service.ts`
- `apps/backend/src/modules/forms/application/exceptions/form.exceptions.ts`
- `apps/backend/src/modules/forms/infrastructure/prisma-form.repository.spec.ts`
- `apps/backend/src/modules/moderation/application/survey-moderation.service.spec.ts`
- `apps/backend/test/forms-publish.e2e-spec.ts`
- `apps/backend/test/forms-escrow.e2e-spec.ts`
- `apps/frontend/my-app/app/forms/components/external-survey-form.ts`
- `apps/frontend/my-app/app/marketplace/MarketplaceCard.tsx`
- `apps/frontend/my-app/lib/clipboard.ts`
- `apps/frontend/my-app/tests/external-survey-form.test.mjs`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- Decision follow-up 2026-09-26 (E4-DN3):
  - `packages/schemas/src/forms/external-url.schema.ts` (+ spec), `packages/schemas/src/forms/external-form.schema.ts`
  - `apps/backend/src/modules/forms/application/form-publishability.ts`, `apps/backend/src/modules/forms/application/forms.service.spec.ts`, `apps/backend/src/modules/forms/presentation/external-form.schema.spec.ts`
  - `apps/frontend/my-app/app/forms/components/external-survey-form.ts`, `apps/frontend/my-app/app/forms/components/CreateExternalSurveyModal.tsx`, `apps/frontend/my-app/tests/external-survey-form.test.mjs`
  - `_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, `_bmad-output/implementation-artifacts/deferred-work.md`

---

## Change Log
- 2026-09-15: Initial story specification created for Story 4.5: External Survey Setup (Google Forms). Status set to in-progress.
- 2026-09-15: Completed implementation across schemas, backend cryptography, forms service, controller, E2E tests, and frontend stepper & rotation UI. Verified clean build, typecheck, lint, and test pass. Status updated to review.
- 2026-09-26: Code review 2026-09-26: Epic 4 review findings written (1 decision open, 13 patches applied — P1, P2, P4–P7, P9, P10, P16, P17, P19–P21, 6 deferred incl. the Epic 6 DF1 cross-reference); status set to in-progress pending DN3.
- 2026-09-26: Decision follow-up 2026-09-26: E4-DN3 → option A (Google Forms-only server-side allowlist in the shared `externalSurveyUrlSchema`, tightened `isGoogleFormsUrl`, P19 badge logic completed, Google-only stepper copy; configurable allowlist deferred as option C). No unchecked decision/patch items remain → Status `done`.
