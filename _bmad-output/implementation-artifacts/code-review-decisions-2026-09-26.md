# Code Review Decisions: Phase 1 Epics 4–9 (2026-09-26)

These are the 22 `decision_needed` items from the Phase 1 epic code reviews run on 2026-09-26 (Epics 4–9). None of them has been implemented. The patches that don't depend on them are being applied separately, and every story listed below stays `in-progress` until its decisions are made. Each item's `[Review][Decision]` checkbox lives in the story file(s) listed with it, under `_bmad-output/implementation-artifacts/`. To answer, reply with `ID: option` (for example `E6-D1: B`) or "accept all recommendations". The recommendations come from the triage reports and don't conflict with each other.

**Severity:** 1 high, 15 medium, 6 low. **Decide these pairs together:** E4-DN2 + E7-DN2 · E5-D2 + E8-D6 · E5-D4 + E8-D2 · E6-D1 + E6-D2.

---

## 1. Escrow and pricing

### E6-D1: Who pays for the 20% Internal-survey discount?
- **Stories:** `6-3-escrow-lock-release-refund.md`, `6-4-respondent-point-credit-pending-logic.md` · **Severity:** high
- **Context:** Publishing locks `round(0.8 × reward)` per slot, but every Internal payout pays the full reward. Once about 80% of the quota is paid out, payouts fail or start drawing on the Escrow of the Publisher's other surveys.
- **Options:**
  - A: The Respondent receives the discounted 80%, and the Marketplace, receipts and notifications show that amount.
  - **B: Platform subsidy. Escrow pays 80%, `SYSTEM_ISSUANCE` mints the other 20%, and the Respondent gets the full advertised reward.**
  - C: Lock the full reward in Escrow and treat FR-19's discount as a lower Internal pricing band (this ties into E6-D2).
- **Recommendation: B.** It keeps FR-19's intent (Internal surveys cost the Publisher less) and the advertised reward with no UI change. Points can't be cashed out (FR-34), so minting the 20% is a contained policy cost.
- **What it takes:** a 3-entry balanced journal in `creditInternalReward`/`settleInternalReward`, an `escrowDrawPerCompletion(form)` helper for Epic 6 P4, and a test that pays out 100% of a quota and ends with Escrow = 0.
**Outcome (2026-09-26):** accepted B; implemented in `packages/schemas/src/economy/escrow.schema.ts` (`internalRewardFunding` beside the single `escrowDrawPerCompletion` draw helper), `apps/backend/src/modules/economy/application/ledger.service.ts` (`creditInternalReward`: one balanced journal ESCROW −round(0.8 × reward), SYSTEM_ISSUANCE −rest, Respondent +reward, same keys), Outbox `rewardAmount` docs (`internal-submission.schema.ts`, participation port/service), tests in `ledger.service.spec.ts`, `forms-escrow.coordinator.spec.ts` (100% quota → form Escrow 0, other survey untouched), `test/forms-escrow.e2e-spec.ts` (every slot paid through real submissions, idempotent replay); stories 6.3 and 6.4.

### E6-D2: How should the FR-14 reward pricing bands be enforced?
- **Stories:** `6-3-escrow-lock-release-refund.md` · **Severity:** medium
- **Context:** The band validators exist but nothing calls them. Forms have no duration field, so there's no way to pick a band. FR-14's minimum of 5 points also conflicts with free (0-point) Internal surveys (6.3 AC3.1).
- **Options:**
  - **(a) Add `estimatedDurationMinutes` to the Form and validate the band at publish (400 `PRICING_REWARD_OUT_OF_BAND` with min, max and suggested values).**
  - (b) Derive the duration: from the question count for Internal surveys, and from a Publisher-entered field for External surveys.
  - (c) Defer FR-14 enforcement to a follow-up story and mark 6.3 AC1.2 / Task 1.1 as partial.
- **Recommendation: (a), checked at publish only, so drafts stay editable.** It is the only option that enforces FR-14 as written. **Please also confirm two things:** (1) 0-point Internal surveys are exempt from the band; (2) whether the band maximum (40) replaces the current 10,000-point cap. If E6-D1 = C, the Internal band becomes 80% of the External band.
- **What it takes:** a new Form column, new fields in the draft, External and publish schemas, a builder/wizard input, a band check at publish, and the band returned by `getPricingQuote`.
**Outcome (2026-09-26):** accepted (a); implemented in `packages/schemas` (`estimatedDurationMinutesSchema`, `checkPublishRewardBand`, `PricingQuoteDto`; draft/External/publish schemas), Prisma `Form.estimatedDurationMinutes` + migration `20260926233000_form_estimated_duration_minutes`, `forms.service.ts` / `form-publishability.ts` (band min+max at publish and External auto-publish only; 400 `PRICING_REWARD_OUT_OF_BAND` `{min,max,suggested}`, 422 `ESTIMATED_DURATION_REQUIRED`; 0-point Internal exempt; band in `getPricingQuote`), builder + External wizard UI (`app/forms/pricing-band.ts`); story 6.3. Sub-questions: (1) 0-point Internal exemption kept; (2) default recorded — the band maximum (40) applies at publish for rewarded surveys, the 10,000 cap stays the draft input limit.

---

## 2. Self-participation and starter-point farming

### E4-DN2: Can Publishers see and complete their own surveys?
- **Stories:** `4-2-automated-marketplace-matching.md` (checkbox there; also affects 4.3) · **Severity:** medium
- **Context:** The feed doesn't hide a user's own surveys, and `startAttempt` doesn't reject the owner. A Publisher can therefore pay themselves from their own Escrow and inflate their completion count.
- **Options:**
  - **A: Forbid it. The feed hides the user's own surveys, `startAttempt` returns 403 `SELF_PARTICIPATION_FORBIDDEN`, and the mock does the same.**
  - B: Allow it as an unpaid preview: no reward, no quota used, no activation credit.
  - C: Keep the current behaviour.
- **Recommendation: A.** It matches the platform's other four-eyes rules: no self-moderation, no self-approved top-ups, and activation already ignores the user's own surveys. Publishers already have a preview.
- **What it takes:** one filter in `MarketplaceService`, one guard in `startAttempt`, the same rule in the mock, and tests.
**Outcome (2026-09-26):** accepted A (decided together with E7-DN2); implemented in `apps/backend/src/modules/marketplace/application/marketplace.service.ts` (feed skips `form.isOwnedBy(userId)`), `apps/backend/src/modules/participation/application/participation.service.ts` (`startAttempt` throws new `SelfParticipationForbiddenException` before any reservation), `participation.exceptions.ts` + `common/http/http-exception.filter.ts` (403 `SELF_PARTICIPATION_FORBIDDEN`, shared `SELF_PARTICIPATION_FORBIDDEN_CODE` in `packages/schemas/src/participation/survey-attempt.schema.ts`), `apps/frontend/my-app/lib/mock/repository.ts` (mock feed hides own surveys, mock start rejects with the same code); tests: marketplace/participation service specs, filter spec, `test/marketplace-activation.e2e-spec.ts` (feed + 403), `tests/marketplace-activation.test.mjs`; story 4.2 (+4.3).

### E7-DN2: How much should we do against starter-point farming beyond FR-48?
- **Stories:** `7-2-secondary-deep-onboarding.md` · **Severity:** medium
- **Context:** A sock account can fill in a junk profile, complete any other account's survey (including a colluding Publisher's one-question or zero-reward survey) and receive 100 starter points. A zero-reward External completion has no credit that could later be reversed.
- **Options:**
  - A: Accept the risk for Phase 1 and rely on 8.1 moderation, the 8.2 rate limits and the Phase 2 integrity work.
  - B: Add cheap qualifying rules: (1) the survey must pay at least 1 point; (2) a per-Publisher cap on starter unlocks per 24 h; (3) a minimum Publisher account age, or the Publisher must be activated.
  - C: Only Internal surveys with at least M questions qualify.
- **Recommendation: B(1) now, and A for the rest.** The ≥1-point filter is a tiny change that closes the gap where a completion can't be disputed. Record B(2), B(3) and IP/device clustering in `deferred-work.md`.
- **What it takes:** a `rewardPerResponse >= 1` filter in both starter-points provider queries and in the mock's `activationCompletions`, plus tests.
**Outcome (2026-09-26):** accepted B(1), A for the rest; implemented in `packages/schemas/src/economy/starter-activation.ts` (`STARTER_ACTIVATION_MIN_SURVEY_REWARD` = 1, `isStarterActivationRewardEligible`, completions carry `rewardPerResponse` and the shared rule re-checks it), `prisma-starter-points-data-provider.ts` (both queries filter `form.rewardPerResponse >= 1`), the in-memory provider, the mock's `activationCompletions` and activation recommendations; tests in the schemas, coordinator, provider, e2e and mock suites; B(2), B(3) and IP/device clustering recorded as deferred in `deferred-work.md`; story 7.2.

> Feedback on your own survey (Epic 9 P2) is fixed by a patch whatever E4-DN2 decides, so it needs no decision.

---

## 3. Form lifecycle and moderation

### E8-D1: Do you sign off the new lifecycle transition table, and can a Publisher reopen a survey after an Admin takedown?
- **Stories:** `8-1-survey-moderation-queue.md` · **Severity:** medium
- **Context:** The new table removes every path to PUBLISHED that skips moderation, as FR-20 requires, and the architecture needs explicit sign-off on it. However, `reopenForm` lets a Publisher put a survey back live after an Admin has closed it.
- **Options:**
  - A: Approve the table as implemented. Admin takedowns stay reversible.
  - **B: Approve the table and make Admin takedowns final. Record `closeKind` (OWNER, ADMIN or MODERATION); reopening is allowed only after the owner closed the survey, otherwise 409 `FORM_NOT_REOPENABLE`.**
  - C: Approve the table, but send a reopened survey back through moderation (CLOSED → MODERATION_QUEUE).
- **Recommendation: B.** It is the smallest change that keeps FR-20's "not on the Marketplace until approved" meaningful after a takedown.
- **What it takes:** a `closeKind` column written in the close transition, a check in reopen, an exhaustive from→to contract test in `form-publish.schema.spec.ts`, and the sign-off recorded against the spine's Open Question. Follow-up: route Admin takedowns through a moderation command that records a reason and an audit event and notifies the Publisher.
**Outcome (2026-09-26):** accepted B (transition table signed off; Admin takedowns final); implemented in `packages/schemas/src/forms/form-publish.schema.ts` (`formCloseKindEnum` OWNER/ADMIN/MODERATION, `isOwnerReopenableClose`) and `form-draft.schema.ts` (`FormDetailDto.closeKind`), Prisma `FormCloseKind` + `Form.closeKind` with drift-tolerant migration `20260927020000_form_close_kind` (no backfill; NULL fails closed), `apps/backend/src/modules/forms/` (`FormEntity.close(kind)` written in the same conditional update as the CLOSED transition and `closeCount`; `closeForm` → OWNER for the owner, ADMIN for another Admin; `rejectPublication` → MODERATION; `reopenForm` → 409 `FORM_NOT_REOPENABLE` with `details { reason: CLOSED_BY_ADMIN_OR_MODERATION | VERSION_NOT_APPROVED, closeKind }`) and `common/http/http-exception.filter.ts`; exhaustive from→to contract test in `apps/backend/src/modules/forms/presentation/form-publish.schema.spec.ts`; sign-off recorded as a dated amendment note next to the ARCHITECTURE-SPINE open question. Tests in forms service, moderation commands, Prisma repository, filter and `test/survey-moderation.e2e-spec.ts`. The Moderation takedown command (reason/audit/notification) is a recorded follow-up in `deferred-work.md`. Story `8-1-survey-moderation-queue.md` (done).

### E8-D2: Should rejecting an edited version close the live survey for good?
- **Stories:** `8-1-survey-moderation-queue.md` · **Severity:** medium
- **Context:** Take v1 live and v2 queued. Rejecting v2 closes and refunds the whole form, and it can never come back, because reopening needs an approved current version. The Admin UI gives no warning.
- **Options:**
  - **A: Keep the strict rule (AC1.6/AC5.4), and add a warning for re-submissions in the Admin UI and in the `SURVEY_REJECTED` notice.**
  - B: Reject only the edit, and keep the survey live on the last approved version. This needs a "live version" pointer, which is a large change (the same as E5-D4 option C).
  - C: Send the rejection back to editing: create a new draft copy and keep the Escrow reserved; the Publisher then edits and resubmits, or withdraws.
- **Recommendation: A now, C in Phase 2.** The warning is cheap and matches the acceptance criteria. Decide C together with E5-D4.
- **What it takes:** warning copy for `isResubmission` in `app/admin/moderation/page.tsx` and in the rejection notification.
**Outcome (2026-09-26):** accepted A (strict rule kept; option C recorded as a Phase 2 follow-up with E5-D4 in `deferred-work.md`); implemented in `apps/frontend/my-app/app/admin/moderation/` (`describeRejectionImpact` in `moderation-view.ts`; warning panel before rejecting a re-submission, reject button relabelled "Từ chối & đóng vĩnh viễn khảo sát" and described by the warning, success copy) and `apps/backend/src/modules/moderation/application/survey-moderation.service.ts` (`RESUBMISSION_REJECTION_WARNING` in the `SURVEY_REJECTED` text for re-submissions, also on replays; the reason is shortened so the warning and refund fit 500 characters). Tests in the moderation service spec, `test/survey-moderation.e2e-spec.ts` and `tests/moderation-view.test.mjs`. Story `8-1-survey-moderation-queue.md` (done).

### E5-D4: What happens to in-progress attempts when a Publisher starts a new version?
- **Stories:** `5-4-internal-form-submission.md` · **Severity:** low
- **Context:** "Create New Version" moves the form from PUBLISHED to DRAFT. Respondents who are mid-survey then fail to submit (and, after Epic 6 P6, fail to verify External codes), losing up to 30 minutes of work.
- **Options:**
  - **A: Strict (today's behaviour). Accept submissions only while the form is PUBLISHED, and have the builder warn the Publisher that in-progress respondents will be cut off.**
  - B: Lenient. Accept attempts pinned to a published version unless the form was closed or refunded.
  - C: Keep the form PUBLISHED on the old version until the new one is approved. This changes the lifecycle across Epics 2, 4 and 8.
- **Recommendation: A.** It fails closed and matches the Escrow-refund rules. Revisit C together with E8-D2.
- **What it takes:** a warning in the builder's "Create New Version" flow. No backend change.
**Outcome (2026-09-26):** accepted A (strict cut-off kept; option C left for Phase 2 with E8-D2); implemented in `packages/schemas/src/forms/form-draft.schema.ts` (`FormInProgressAttemptsDto`, `CreateFormVersionResultDto`), `apps/backend/src/modules/forms/` (`FormRepositoryPort.countInProgressAttempts` in the Prisma and in-memory adapters, `FormsService.getInProgressAttempts` + `createNewVersion` returning `interruptedAttempts`, `GET /forms/:id/in-progress-attempts`), and the live builder `apps/frontend/my-app/app/forms/[id]/edit/` (`NewVersionConfirmationModal` warning with the live count, success notice with the interrupted count; copy in `app/forms/attempt-window.ts`, client `fetchInProgressAttempts` in `app/forms/forms-api.ts`); tests in the forms service/controller specs, `test/forms-versioning.e2e-spec.ts` and `tests/attempt-window.test.mjs`. Story `5-4-internal-form-submission.md` (AC2 amendment note).

### E8-D3: Should Admins stay banned from moderating their own surveys when there is only one Admin account?
- **Stories:** `8-1-survey-moderation-queue.md` · **Severity:** medium
- **Context:** An Admin can't approve their own survey, mirroring the no-self-approval rule for top-ups in 6.6. With a single Admin account, that Admin's surveys can never go live. The rule isn't in the PRD or the spine.
- **Options:**
  - **A: Keep the ban. Ops set up at least 2 active Admin accounts before the pilot.**
  - B: Allow self-approval only when no other active Admin exists, and flag it as `selfReview: true` in the audit record.
  - C: Always allow self-moderation, with the same audit flag.
- **Recommendation: A.** It is consistent with 6.6 and with E4-DN2. Choose B only if the pilot really has just one Admin.
- **What it takes:** no code change. Ops create a second Admin account.
**Outcome (2026-09-26):** accepted A (ban kept, no code change); the ops requirement "provision at least two active Admin accounts before the pilot" is recorded in `apps/backend/.env.example`, the new ops checklist in `apps/backend/README.md` and as a needs-human entry in `deferred-work.md` (Batch C2). Story `8-1-survey-moderation-queue.md` (done).

### E8-D5: Should we accept the 8.1/8.2 frontend additions that the human-owned mock-journey spec reserves for you?
- **Stories:** `8-1-survey-moderation-queue.md`, `8-2-automated-bot-protection-time-barrier-rate-limit.md` · **Severity:** low (governance only; no runtime harm)
- **Context:** The unattended dev agent added a live `/admin/moderation` page (not linked from the navigation) and extended the live adapter `participation-api.ts`. `spec-mock-respondent-journey.md` leaves both kinds of change to its human owner.
- **Options:**
  - A: Accept both changes, and add a note to the spec's Change Log.
  - B: Keep the Admin page, but move the new client code into a separate file and restore `participation-api.ts`.
  - C: Remove `/admin/moderation`, or put it behind a feature flag.
- **Recommendation: A for the Admin page, B for the adapter.** The page is 8.1's main acceptance criterion and isn't linked anywhere. Restoring the adapter honours the spec's "adapters stay untouched" rule at almost no cost.
- **What it takes:** a Spec Change Log entry, and moving `submitInternalResponse` and the new error shape into `participation-submit-api.ts`.
**Outcome (2026-09-26):** accepted A for the Admin page (dated entry in the Change Log of `spec-mock-respondent-journey.md`) and B for the adapter: `submitInternalResponse`, `ParticipationApiError` and `toParticipationApiError` moved to the new `apps/frontend/my-app/app/marketplace/participation-submit-api.ts`; `participation-api.ts` restored to its pre-8.2 content and API surface (`startSurveyAttempt`, `verifyExternalCompletionCode`, `reportMissingCompletionCode`); `tests/bot-protection.test.mjs` imports the new file and guards the restored surface. Stories `8-1-survey-moderation-queue.md` and `8-2-automated-bot-protection-time-barrier-rate-limit.md` (done).

---

## 4. Attempt lifetime and participation limits

### E5-D2: How do we reconcile the fixed 30-minute attempt reservation with time-barrier and effort settings of up to 24 h?
- **Stories:** `5-1-survey-attempt-initialization-concurrency.md` (related: 8.2 time barrier) · **Severity:** medium
- **Context:** If a survey's required time barrier is 30 minutes or more, nobody can ever submit it. An honest survey that takes longer than 30 minutes expires mid-way, and the answers or the External code are lost.
- **Options:**
  - **A: Block it at publish. Reject publishing if the barrier exceeds the window minus 5 minutes, or the expected effort exceeds the window (`SURVEY_DURATION_EXCEEDS_RESERVATION`).**
  - B: Per-attempt reservation: `expires_at = max(30 min, 2 × effort, barrier + 10 min)`, capped at about 3 h.
  - C: Keep 30 minutes, and add a way to extend the reservation (a heartbeat).
- **Recommendation: A for Phase 1.** It is the simplest fix, and a survey nobody can finish can no longer be published. **Please also confirm whether Phase 1 needs surveys longer than 30 minutes.** If it does, choose B.
- **What it takes:** a publish-time check in the forms schema and service. Under any option, the rule "required barrier + grace < reservation window" is enforced at publish.
**Outcome (2026-09-26):** accepted A; embedded sub-question default recorded: **Phase 1 does not support surveys longer than 30 minutes** (option B deferred to Phase 2 in `deferred-work.md`; PRD FR-45 amendment note). Implemented in `packages/schemas/src/participation/reservation-window.ts` (`checkSurveyFitsReservationWindow`: effective barrier via `computeInternalTimeBarrier` — answerable questions × 2 s and the publisher minimum — or the External configured minimum ≤ 1,500 s; `expectedEffortSeconds` ≤ 1,800 s; `estimatedDurationMinutes` ≤ 30), `apps/backend/src/modules/forms/application/form-publishability.ts` (`assertSurveyFitsReservationWindow`, 422 `SURVEY_DURATION_EXCEEDS_RESERVATION` with the violations; runs in `assertFormPublishable`, so publish, the legacy queue move and the moderation approval re-check it) and `forms.service.ts` (External auto-publish); builder pre-check and Vietnamese 422 copy in `apps/frontend/my-app/app/forms/attempt-window.ts` + the edit page. No existing fixture exceeded the window. Tests in schemas, forms service, `test/forms-publish.e2e-spec.ts`, frontend. Story `5-1-survey-attempt-initialization-concurrency.md`.

### E8-D6: Where should the hourly completion limit apply, given the 30-minute attempt lifetime?
- **Stories:** `8-2-automated-bot-protection-time-barrier-rate-limit.md` · **Severity:** medium
- **Context:** A user at 19 of 20 completions starts two surveys and finishes one. Submitting the other then returns 429 with a retry time of up to 60 minutes, but the attempt expires after 30 minutes, so the finished work is lost.
- **Options:**
  - **A: Reserve capacity at start. Allow a start only if completions in the window plus the user's other open attempts are below the limit, and drop the check at submit and verify.**
  - B: Keep AC3.2 as written, and warn at start when other attempts are open.
  - C: Enforce the limit at start only. Concurrent submissions can then overshoot the cap by the number of open attempts.
- **Recommendation: A.** It matches FR-46 ("blocks further attempts"), and an honest user never loses finished work.
- **What it takes:** a change to the limiter's start check, removal of the COMPLETIONS pre-check at submit and verify (Epic 8 P3's in-transaction backstop stays), and an amendment to 8.2 AC3.2.
**Outcome (2026-09-26):** accepted A; implemented in `packages/schemas/src/participation/bot-protection.ts` (`evaluateCompletionCapacity`; optional `completionsInWindow`/`inProgressAttempts` in the 429 details), `apps/backend/src/modules/participation/application/participation-rate-limiter.ts` (`assertStartCapacity`, `rejectStartCapacity`), `participation.service.ts` (start reserves; the submit/verify pre-checks are removed; the P3 backstop stays and counts completed attempts only, so no double counting) and `infrastructure/prisma-participation.repository.ts` (`reserveAttempt` takes the per-user advisory lock FIRST, then the form row, and counts completions + open attempts; `findOpenAttemptStartTimes`) with in-memory parity; mock journey and `lib/participation-guards.ts` copy; 8.2 AC3.2 amended. Tests in schemas, limiter, repository, service, `test/bot-protection.e2e-spec.ts`, frontend. Story `8-2-automated-bot-protection-time-barrier-rate-limit.md` (stays in-progress for E8-D4/E8-D5).

### E5-D1: What happens after an External attempt is locked for 3 wrong completion codes?
- **Stories:** `5-5-external-form-completion-code-verification.md` · **Severity:** medium
- **Context:** A locked attempt blocks nothing. The user can start a new attempt and get 3 more guesses at the same code, which is shared by everyone on that FormVersion. FR-22 leaves the values to Open Question 14.
- **Options:**
  - A: Hard lock per account and FormVersion until an Admin resolves it (FR-23). A new version resets the lock.
  - **B: Cumulative cap: 3 tries per attempt and 6 per account and FormVersion, then block as in A. No automatic reset.**
  - C: A cooldown of X hours after a lock, then 3 more tries.
- **Recommendation: B.** It still limits guessing, but an honest mistyper can retry once without Admin help. The values stay provisional until OQ14 is approved.
- **What it takes:** a versioned `completion-code-policy-v1`, and a `SUM(failed_code_verifications)` check in `startAttempt` and before the code comparison. This builds on the server-owned counter from Epic 5 P2.
**Outcome (2026-09-26):** accepted B (values provisional pending PRD Open Question 14 — PRD FR-22 amendment note and `deferred-work.md` launch-gate entry); implemented in `packages/schemas/src/participation/completion-code-policy.ts` (`completion-code-policy-v1`: 3 per attempt, 6 per account + FormVersion; `COMPLETION_CODE_LIMIT_REACHED`; reset contract), `apps/backend/src/modules/participation/` (summed server-owned counter minus Admin-forgiven strikes checked in `startAttempt` — pre-check and inside `reserveAttempt` — and under the attempt lock before the code comparison, 409 `COMPLETION_CODE_LIMIT_REACHED`; a wrong code reaching 6 locks the attempt; Admin recovery `POST /admin/completion-code-limits/reset` in `presentation/admin-completion-code-limit.controller.ts`), Prisma `CompletionCodeLimitReset` + migration `20260927010000_completion_code_limit_resets` (append-only audit rows), and the mock journey (`lib/mock/repository.ts`, attempts page). Tests in schemas, repository, service, controller, `test/external-completion.e2e-spec.ts`, frontend mock. Story `5-5-external-form-completion-code-verification.md`.

### E8-D4: How should the provisional rate-limit values be versioned?
- **Stories:** `8-2-automated-bot-protection-time-barrier-rate-limit.md` · **Severity:** medium
- **Context:** All four limits can be overridden from env, but every 429 response and FraudLog entry still says `participation-rate-limit-v1`. Nothing stops production from running the unapproved defaults (20 completions per hour, 10 requests per minute).
- **Options:**
  - A: Pin v1. Approve the defaults, and allow env overrides only in development and test.
  - **B: Keep the env overrides, but require an explicit `PARTICIPATION_RATE_LIMIT_POLICY_VERSION` in production (it must differ from v1 when any value differs), and stamp that version on 429s and FraudLog entries.**
  - C: Leave it as is until OQ16, and track it as a launch-gate item.
- **Recommendation: B.** Ops can tune the values without mislabelling the evidence. **The values themselves still need OQ16 approval before launch.**
- **What it takes:** one env var with a production-only validation rule in `env.schema.ts`, and the version stamped in the limiter's 429 details and FraudLog entries.
**Outcome (2026-09-26):** accepted B; implemented in `packages/schemas/src/participation/bot-protection.ts` (`ParticipationRateLimitPolicy.policyVersion`, `resolveParticipationRateLimitPolicyVersion`, `hasDefaultParticipationRateLimitValues`, version-name pattern), `apps/backend/src/common/config/env.schema.ts` (`PARTICIPATION_RATE_LIMIT_POLICY_VERSION`: required in production; `participation-rate-limit-v1` only for the default values, in any environment; default v1 in dev/test) and `env.service.ts`, and `participation-rate-limiter.ts` (the configured version replaces the hard-coded label on every 429 and RATE_LIMIT FraudLog entry); `.env.example`, backend README ops checklist, PRD FR-46 amendment note. The values still await Open Question 16 (launch-gate entry in `deferred-work.md`). Tests in schemas, env service, limiter and `test/bot-protection.e2e-spec.ts`. Story `8-2-automated-bot-protection-time-barrier-rate-limit.md` (done).

### E5-D3: Should resubmitting an already-submitted Internal response return 409 or an idempotent 200?
- **Stories:** `5-4-internal-form-submission.md` · **Severity:** low
- **Context:** Story 5.4 (AC2.1/AC6.2) says 409. The architecture (AD-16) and the planned Epic 6 P5 say a retry returns the original result, and the code and tests already return 200.
- **Options:**
  - **A: Idempotent 200 that returns the original result (policy mode and amount). Amend 5.4 AC2.1 and AC6.2.**
  - B: 409 `SURVEY_ALREADY_COMPLETED` with details, after a non-fatal reward re-drive.
- **Recommendation: A.** A client that retries after a lost reply needs the original result, and External surveys already behave this way.
- **What it takes:** updating the 5.4 story text, and keeping 409 for abandoned, expired and locked attempts. The code change comes with Epic 6 P5.
**Outcome (2026-09-26):** accepted A; the behaviour was already in place (Epic 6 P5 replay); story 5.4 AC2.1/AC6.2 amended with a dated note, the service doc comment updated, and tests now assert the original result (unit `decision E5-D3 …` + a LOCKED 409 case; `test/participation-submission.e2e-spec.ts` retry equals the first reply, no new Outbox rows). Story `5-4-internal-form-submission.md`.

---

## 5. Starter-point activation

### E7-DN1: Should External completions count toward activation only after the 48-hour review window?
- **Stories:** `7-2-secondary-deep-onboarding.md` · **Severity:** medium
- **Context:** The dev agent added a 48 h hold on External completions, citing FR-24 and FR-48. The PRD and the frozen mock spec say the points unlock right after one completed survey. The mock can't simulate 48 hours, so in the demo the External path never unlocks.
- **Options:**
  - **A: Keep the 48 h rule. Record the sign-off in the spec's Change Log and add a mock-only demo control, "Mô phỏng hết 48 giờ đối soát" ("simulate the end of the 48-hour review window"). Internal completions stay instant.**
  - B: Count External completions at code verification, as the PRD literally says. Accept that one leaked code gives every bot account 100 points.
  - C: Only Internal completions count toward activation.
- **Recommendation: A.** Completion codes are shared per version, so a leaked code would let bot accounts collect points instantly. The demo control fixes the demo gap.
- **What it takes:** a Spec Change Log entry, and a reset-demo control that ages the current user's External attempts by 48 h.
**Outcome (2026-09-26):** accepted A (PO sign-off recorded in `spec-mock-respondent-journey.md` Spec Change Log and story 7.2); the backend 48 h rule is unchanged; demo-only control "Mô phỏng hết 48 giờ đối soát" in `apps/frontend/my-app/components/layout/ResetDemoModal.tsx` → `mockRepository.simulateExternalReviewElapsed()` (closes the review of the signed-in user's External completions early via a demo-only `reviewClosedAt` — honoured by the shared `evaluateStarterActivation`, never set by the backend — without rewriting `completedAt`, so the 30-day window and rate limits are unaffected; releases every unreleased Pending credit once with `release-pending:{attemptId}` + REWARD_RELEASED; re-runs the activation); tests in `tests/marketplace-activation.test.mjs` and `starter-activation.spec.ts`; story 7.2.

### E7-DN3: Can a Respondent whose starter-point window expired still become a "Verified Member"?
- **Stories:** `7-2-secondary-deep-onboarding.md` · **Severity:** low
- **Context:** "Verified Member" is derived from the starter-points unlock. A user whose 30-day window expired keeps the badge "Thành viên Mới (Chờ Kích Hoạt)" ("new member, awaiting activation") forever, even after finishing both steps. The badge also contradicts the EXPIRED card on the same page.
- **Options:**
  - **A: Separate the member status from the points. `isVerifiedMember` = profile complete and a confirmed eligible completion at any time. Expiry forfeits only the points.**
  - B: Keep "Verified Member" equal to ACTIVATED, but show a separate "Điểm tân thủ đã hết hạn" ("starter points expired") badge for expired users.
- **Recommendation: A.** FR-7 ties the status to completing a survey, and FR-5 forfeits only the points. The DTO change only adds a field.
- **What it takes:** adding `isVerifiedMember` to `StarterActivationEvaluation` and `starterPointsStatusSchema`, and using it for the dashboard badge (and the Sidebar after Epic 7 P3). The badge fix is needed under either option.
**Outcome (2026-09-26):** accepted A; implemented in `packages/schemas/src/economy/starter-activation.ts` (`isVerifiedMember` = unlocked, or complete profile + a confirmed eligible completion at any time), `starter-points.schema.ts` (`isVerifiedMember` on the status DTO), `StarterPointsCoordinator.getStatus` (completions read up to now, not only to the deadline), the mock status, `apps/frontend/my-app/lib/activation.ts` (`memberStatusBadge`, verified EXPIRED Sidebar view), the dashboard badge and the EXPIRED activation card copy; tests in the schemas, coordinator, e2e and frontend suites; story 7.2.

---

## 6. Feedback and notifications

### E9-D1: Should feedback use FR-43's five rated dimensions, or one overall rating plus issue tags?
- **Stories:** `9-2-respondent-post-completion-feedback.md` · **Severity:** medium
- **Context:** FR-43 asks for five rated dimensions. Story 9.2 ships one overall 5-star rating plus four optional issue tags. There is no production data yet, so changing now is still cheap.
- **Options:**
  - **A: Keep the overall rating plus issue tags, and amend FR-42/FR-43 so that 9.3 shows the average rating plus the share of respondents reporting each issue.**
  - B: Add four optional per-dimension star ratings now. This needs a migration, a v2 schema and a longer prompt.
  - C: Keep A now, and add B's columns with Story 9.3.
- **Recommendation: A.** It is the least friction for respondents, matches the epic AC, and the tags map directly onto FR-44's deprioritization triggers. If you want per-dimension averages, choose B before launch rather than C, because C leaves two incompatible sets of data.
- **What it takes:** recording the sign-off in 9.2 and amending PRD FR-42/FR-43. No code change.
**Outcome (2026-09-26):** accepted A; implemented as dated "Amendment 2026-09-26 (code-review decision E9-D1)" notes next to FR-42 (Story 9.3 shows the average overall rating plus the per-issue-tag share) and FR-43 (Phase 1 model: one required overall 1–5 rating + optional issue tags + optional comment) in `_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md`, and the PO sign-off in story `9-2-respondent-post-completion-feedback.md` (Epic source note, AC6.2, Dev Notes) and `deferred-work.md`. No schema or code change.

### E9-D2: Should Internal instant credits send a "Points earned" notification (FR-57)?
- **Stories:** `9-6-event-notification-system.md` · **Severity:** medium
- **Context:** Internal surveys are the main way to earn points in Phase 1, and they send no notification. 9.6 AC6.4 justifies this as "backend parity", but the same story wrote that backend.
- **Options:**
  - **A: Add a `REWARD_EARNED` type, published after the Internal credit journal commits (deduplicated on `internal-reward:{responseId}`; guests and zero-reward surveys skipped).**
  - B: Treat the receipt and wallet history as enough, and amend FR-57 and AC6.4.
  - C: Reuse `REWARD_RELEASED` with different wording. Not recommended: the type would be wrong.
- **Recommendation: A.** It is small, matches the PRD literally, and FR-46's hourly cap limits the volume.
- **What it takes:** an enum migration, `NOTIFICATION_TYPES`, the bell's presentation and the mock. Land Epic 9 P5 (fallback for unknown types) first. Whatever you decide, record the other missing FR-57 events (quota reached, ban/unban) in `deferred-work.md`.
**Outcome (2026-09-26):** accepted A; implemented in `apps/backend/prisma/schema.prisma` (`NotificationType.REWARD_EARNED`) + drift-tolerant migration `20260927030000_notification_reward_earned`, `packages/schemas/src/notifications/notification.schema.ts` (`NOTIFICATION_TYPES`, Prisma order — the Prisma parity spec stays green), `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts` (`settleInternalReward` publishes `REWARD_EARNED` after the `internal-reward:{responseId}` journal commits — submit, replay re-drive and Admin re-drive; nothing when the credit was already posted; dedupe key `internal-reward:{responseId}`; the full credited amount; guests, zero-reward surveys and ENFORCED holds skipped; a failed publish never changes the settlement), `apps/frontend/my-app/lib/notification-presentation.ts` ("Bạn đã nhận điểm thưởng" 💰 → `/wallet`) and the mock Internal completion (`lib/mock/repository.ts`). Tests in the schemas, coordinator and participation service specs, `test/participation-submission.e2e-spec.ts` (`GET /notifications` shows one notice, a retry adds none), `test/reward-settlement.e2e-spec.ts` (Admin re-drive) and `tests/notifications.test.mjs`. "Survey quota reached" and "ban/unban" recorded as deferred (FR-57 remainder, `deferred-work.md`). Story `9-6-event-notification-system.md`.

### E9-D3: Should notifications be best-effort for Phase 1, or backed by the Outbox now?
- **Stories:** `9-6-event-notification-system.md` · **Severity:** medium
- **Context:** Notifications are sent after the transaction commits, and failures are swallowed. A crash between the commit and the send loses the notice, though the ledger and wallet history stay correct. The target architecture delivers notifications through the Outbox (AD-10), but the Outbox worker isn't built yet.
- **Options:**
  - **A: Accept best-effort for Phase 1. Sign off `deferred-work.md:62`, and apply Epic 9 P1 and P7 so that every notification has a bounded way to be re-sent.**
  - B: Build the producer-side Outbox now. This requires the first AD-10 worker.
  - C: A reconciliation sweep without the Outbox. This still needs a scheduler and new query ports.
- **Recommendation: A now, then B once the AD-5 worker exists.** B is a large piece of cross-cutting work that other deferred items are also waiting on.
- **What it takes:** recording the sign-off and the risk ("points notices can be lost; the history is authoritative") in `deferred-work.md`. P1 and P7 are already planned patches.
**Outcome (2026-09-26):** accepted A; the PO sign-off and the risk are recorded in `deferred-work.md` (Story 9.6 dev entry, first bullet, plus the Batch D entry), story `9-6-event-notification-system.md` (AC5.4 and the decision item) and the `NotificationPublisherPort` doc comment, together with the move to an AD-10 Outbox subscription (option B) once the AD-5 worker exists. P1 and P7 were already applied. No behaviour change.

### E9-D4: Should the feedback thank-you message promise that Publishers won't see the respondent's identity?
- **Stories:** `9-2-respondent-post-completion-feedback.md` · **Severity:** low
- **Context:** The message says "danh tính của bạn không được hiển thị cho người đăng khảo sát" ("your identity is not shown to the survey publisher"). That is true today, but it commits Story 9.3 to a privacy guarantee that the spine still lists as an open launch gate: on surveys with few respondents, a comment can be traced to its author.
- **Options:**
  - **A: Remove the identity promise now, and add it back once 9.3's privacy design is approved.**
  - B: Keep the promise, and make pseudonymous display plus minimum aggregation a binding 9.3 requirement. This needs Product and Privacy approval.
- **Recommendation: A.** Don't promise a guarantee that hasn't been designed yet. The story's completion notes already claim the promise was removed.
- **What it takes:** a one-line copy change in `SurveyFeedbackPrompt.tsx`, applied together with Epic 9 P13.
**Outcome (2026-09-26):** accepted A; the identity clause is removed — the thank-you note is now the shared `SURVEY_FEEDBACK_THANK_YOU_NOTE` ("Đánh giá được dùng để cải thiện chất lượng khảo sát và điểm thưởng của bạn không bị ảnh hưởng.") in `apps/frontend/my-app/lib/survey-feedback.ts`, rendered by `components/feedback/SurveyFeedbackPrompt.tsx`; regression test in `tests/survey-feedback.test.mjs`; the P13 completion note in story `9-2-respondent-post-completion-feedback.md` aligned.

---

## 7. Marketplace feed and External surveys

### E4-DN1: Should we add cursor pagination to the Marketplace feed now?
- **Stories:** `4-2-automated-marketplace-matching.md`, `4-3-feed-interactions-sortfilterauto-hide.md` · **Severity:** medium
- **Context:** The spine requires cursor pagination for list APIs, but the feed returns every match. Matching, filtering and sorting all run in Node, so a cursor can't reduce the load until matching moves into SQL. Changing the contract would also touch shared types that the human-owned mock journey uses.
- **Options:**
  - A: Implement it now: `cursor` and `limit` (default 20, max 50) with `nextCursor`, and update the mock.
  - **B: Defer it to the live-API swap and SQL feed work. Record the deviation from the spine in `deferred-work.md`, and apply Epic 4 P11 now to cut what each request loads.**
  - C: A hard server cap (for example 100 cards) with no cursor. Results would be silently cut off.
- **Recommendation: B.** A cursor over filtering done in memory brings no real scalability benefit, and changing the contract now would disrupt the mock journey.
- **What it takes:** a `deferred-work.md` entry. P11 is already a planned patch.
**Outcome (2026-09-26):** accepted B; the spine deviation (no feed cursor until matching moves into SQL / the live-API swap) is recorded in `deferred-work.md` ("code-review decisions 2026-09-26 (Batch B)") and in stories 4.2 and 4.3; P11 verified in place (`PrismaFormRepository.findPublishedForms` loads only the newest published version per form and skips forms without one, same in the in-memory adapter; covered by `prisma-form.repository.spec.ts` and `marketplace.service.spec.ts`). No code change.

### E4-DN3: Should External surveys be restricted to Google Forms links?
- **Stories:** `4-5-external-survey-setup-google-forms.md` · **Severity:** low
- **Context:** The backend accepts a link to any HTTPS host, and the "Google Forms" badge appears for any `docs.google.com` path. FR-12 and the completion-code guide assume Google Forms.
- **Options:**
  - **A: A server-side allowlist for Phase 1 (`docs.google.com/forms/…`, `forms.gle`, `forms.google.com`), and a stricter `isGoogleFormsUrl`.**
  - B: Allow any HTTPS host and rely on moderation. Fix the badge, and label other hosts as "External link".
  - C: A configurable allowlist of approved platforms.
- **Recommendation: A, with C as a later extension.** It matches FR-12 and stops survey links from pointing anywhere, which closes a phishing risk.
- **What it takes:** an allowlist check in `external-form.schema.ts` and updated modal copy. This also unblocks Epic 4 P19 (the badge logic).
**Outcome (2026-09-26):** accepted A (C recorded as the later extension); implemented in `packages/schemas/src/forms/external-url.schema.ts` (the shared `externalSurveyUrlSchema` used by create-external, draft create/update and publish now also requires `isGoogleFormsUrl`, which moved there and requires a `/forms/<id>` path on `docs.google.com`, a non-empty path on `forms.gle`/`forms.google.com`, no credentials or custom port), the publish-time re-check message in `form-publishability.ts`, `apps/frontend/my-app/app/forms/components/external-survey-form.ts` + `CreateExternalSurveyModal.tsx` (P19 completed: non-Google hosts rejected inline, neutral label removed, Google-only copy); tests in the schemas, backend schema/service and frontend suites; story 4.5.

---

## Other confirmations (from story Completion Notes)

The dev agents asked you to confirm these, but they have no `[Review][Decision]` checkbox and don't block any story. The 8.1 items (the self-moderation ban and the transition-table sign-off) are already covered by E8-D3 and E8-D1.

| ID | Story | To confirm | Suggested answer |
|---|---|---|---|
| OC1 | `7-1-mandatory-demographic-survey.md` | A demographic profile now counts as complete only when all 7 FR-6 fields are filled (previously 3), for every logged-in role. Accounts with older, partial profiles get 403 on the feed and on attempts until they finish the survey. No data migration was written. | Confirm. There is no production data yet, so no migration is needed. |
| OC2 | `7-1-mandatory-demographic-survey.md` | FR-9's "academic year" isn't collected; the FR-6 list is the required set. | Confirm. Add `academicYear` (schema, column and UI) later only if targeting needs it. |
| OC3 | `6-6-point-top-up-request-admin-approval.md` | Top-up limits that aren't in the PRD: at most 50,000 points (10,000,000 VND) per request, at most 3 open requests, and no self-approval. | Confirm. The no-self-approval rule is the basis for E8-D3 and E4-DN2. |
| OC4 | `6-6-point-top-up-request-admin-approval.md` | Stale PENDING top-up requests never expire, and they count toward the 3-request cap. | Confirm an expiry (for example 7 days), to be built once a scheduler exists. |

---

## Summary

| ID | Question | Recommendation | Stories blocked |
|---|---|---|---|
| E6-D1 | Who pays for the 20% Internal discount? | **B**: platform subsidy (Escrow pays 80%, the platform mints 20%) | 6.3, 6.4 |
| E6-D2 | How to enforce the FR-14 pricing bands? | **(a)**: duration field, band checked at publish, 0-point exempt (+ confirm the band maximum) | 6.3 |
| E4-DN2 | Can Publishers take their own surveys? | **A**: forbid it (feed filter + 403) | 4.2 (+4.3) |
| E7-DN2 | How much to do against starter-point farming? | **B(1)**: only surveys paying ≥1 point qualify; accept the rest for Phase 1 | 7.2 |
| E8-D1 | Transition-table sign-off; reopen after an Admin takedown? | **B**: approve the table; Admin takedowns are final (`closeKind`) | 8.1 |
| E8-D2 | Does rejecting an edit close the live survey for good? | **A**: yes, with a warning (C in Phase 2) | 8.1 |
| E5-D4 | What happens to in-progress attempts on "Create New Version"? | **A**: strict, plus a warning to the Publisher | 5.4 |
| E8-D3 | Self-moderation ban with one Admin? | **A**: keep the ban; set up 2 Admin accounts | 8.1 |
| E8-D5 | Accept the frontend additions the mock spec reserves? | **A** for the Admin page, **B** for the adapter | 8.1, 8.2 |
| E5-D2 | 30-min reservation vs barrier/effort up to 24 h? | **A**: block at publish (+ confirm whether surveys over 30 min are needed) | 5.1 |
| E8-D6 | Where does the completion limit apply? | **A**: reserve capacity at start | 8.2 |
| E5-D1 | What happens after an attempt is locked for wrong codes? | **B**: 3 tries per attempt, 6 per account + version | 5.5 |
| E8-D4 | How to version the rate-limit values? | **B**: required policy-version env var in production (+ OQ16 approval) | 8.2 |
| E5-D3 | Resubmission: 409 or 200? | **A**: idempotent 200 with the original result | 5.4 |
| E7-DN1 | 48 h hold before External completions activate? | **A**: keep it, plus a mock demo control | 7.2 |
| E7-DN3 | Can an expired user become a Verified Member? | **A**: separate the status from the points | 7.2 |
| E9-D1 | Five rating dimensions or one rating plus tags? | **A**: one rating plus tags; amend FR-42/43 | 9.2 |
| E9-D2 | "Points earned" notification for Internal credits? | **A**: add `REWARD_EARNED` | 9.6 |
| E9-D3 | Best-effort notifications or the Outbox? | **A**: best-effort now, Outbox later | 9.6 |
| E9-D4 | Promise Publisher anonymity in the thank-you message? | **A**: remove the promise for now | 9.2 |
| E4-DN1 | Cursor pagination for the feed now? | **B**: defer; apply P11 | 4.2, 4.3 |
| E4-DN3 | Google Forms links only? | **A**: server-side allowlist | 4.5 |

**Stories blocked (13):** 4.2, 4.3, 4.5, 5.1, 5.4, 5.5, 6.3, 6.4, 7.2, 8.1, 8.2, 9.2, 9.6.
