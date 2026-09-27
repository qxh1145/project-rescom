---
baseline_commit: 378e4a71ff125fb1acf6ee18291fc298ae56bf94
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/implementation-artifacts/6-5-frozen-starter-points-lifecycle.md"
  - "_bmad-output/implementation-artifacts/7-1-mandatory-demographic-survey.md"
  - "_bmad-output/implementation-artifacts/9-6-event-notification-system.md"
  - "_bmad-output/implementation-artifacts/spec-mock-respondent-journey.md"
---

# Story 7.2: Marketplace Survey Activation Step

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Naming note:** the sprint-status key / file name is `7-2-secondary-deep-onboarding` (kept so tracking stays
> consistent), but the authoritative definition is `epics.md` → Epic 7 → **Story 7.2: Marketplace Survey Activation
> Step** (FR-7, FR-8). This story implements the epics.md definition.

## Story

As a New Respondent,
I want to complete one Marketplace survey after my demographic profile,
so that I can prove initial participation and unlock my starter Points.

## Acceptance Criteria

1. **Activation prompt on the Marketplace (FR-7).** Given a signed-in Respondent whose demographic profile is complete
   (Story 7.1) but who is not yet activated and whose starter points have not expired, when they open the Marketplace
   (and the dashboard), then an activation card is shown that states: the 100 Frozen starter points, the single
   remaining step "hoàn thành 1 khảo sát trên Chợ khảo sát để mở khóa", progress (step 2 of 2), the days remaining and
   the expiry date of the 30-day window (FR-5), and up to 3 recommended eligible surveys (Internal first — they unlock
   instantly; External marked "mở khóa sau 48 giờ đối soát"). The `?activation=1` handoff from Story 7.1 highlights the
   card ("Hồ sơ đã lưu — Bước 2/2"). The card is data-driven (activation status API/mock), not a static banner.
2. **One eligible Marketplace survey (definition).** A completion counts toward activation only when it is an
   authenticated (non-guest) completion by the respondent of a survey published by **another** user (never the
   respondent's own survey): an Internal survey whose Response is `VALIDATED`, or an External survey whose Attempt is
   `COMPLETED` (verified completion code). The Mandatory Demographic Survey is a `DemographicProfile`, not a Form, so it
   never counts. Starting an attempt already requires the survey to be `PUBLISHED` (Story 5.1/8.1), so a completion of a
   survey that is later closed still counts.
3. **External completions count after the 48-hour review window (FR-24, FR-48).** An Internal completion qualifies
   immediately. An External completion qualifies only once its 48-hour review window (from verification) has elapsed and
   its `external-completion:{attemptId}` Pending credit has not been reversed (Phase-1 dispute outcome). Until then the
   activation state is `PENDING_CONFIRMATION` and the status exposes `confirmsAt`. Self-releasing a Pending reward early
   does not shorten the window.
4. **Exactly-once unlock (FR-8).** Only after a qualifying completion (and a complete demographic profile) does Economy
   transfer 100 Points FROZEN → USER_AVAILABLE, in one journal keyed `starter-unlock:{userId}`. This holds under retries
   and under concurrency (two completions finishing simultaneously, or unlock racing the expiry sweep): at most one
   unlock journal is ever posted, balances end at Frozen 0 / Available +100, and exactly one `ACCOUNT_ACTIVATED`
   notification exists. A losing concurrent caller converges on the winner instead of failing.
5. **Expiry and activation are mutually exclusive (FR-5).** A completion counts only if it happened within 30 days of
   registration. A respondent with an in-window qualifying completion can still be unlocked after the deadline (catch-up,
   e.g. External review window or an earlier failed unlock); a respondent whose only completions are after the deadline
   is expired. The expiry sweep never expires a user who is activated, eligible (it unlocks them instead) or awaiting an
   in-window External review (it defers them); an admin `cutoffDate` can only narrow the sweep, never expire a user still
   inside their own 30-day window. Unlock refuses when an expiry journal exists; the ledger (FROZEN cannot go negative)
   guarantees only one of the two journals can post. A failure for one user does not abort the sweep.
6. **Unlock failures never fail the respondent's request.** The unlock runs after the source transaction (internal
   submission, external verification, demographic save/submit, pending-reward release). A failure there is logged and
   swallowed: the survey submission / verification / profile response still succeeds. A later trigger (next completion,
   profile save, pending release, `POST /economy/starter-points/unlock`, or the expiry sweep's catch-up) retries.
7. **Activation status API.** `GET /economy/starter-points/status` (existing, read-only) additionally returns
   `activationState` (`NOT_GRANTED | DEMOGRAPHICS_REQUIRED | SURVEY_REQUIRED | PENDING_CONFIRMATION | READY_TO_UNLOCK |
   ACTIVATED | EXPIRED`), `activatedAt`, and `activationSurvey` (`{ source, formId, completedAt, confirmsAt, status }`
   or null). Existing fields keep their meaning (`hasCompletedMarketplaceSurvey` = a *qualifying* completion exists).
   `POST /economy/starter-points/unlock` is the client retry for `READY_TO_UNLOCK`; a repeat after activation re-publishes
   the (deduplicated) `ACCOUNT_ACTIVATED` notification. One shared pure rule (`evaluateStarterActivation` in
   `@rescom/schemas`) drives both the backend coordinator and the frontend mock.
8. **Success state.** Once unlocked, the activation card disappears and a one-time, dismissible success state ("Tài
   khoản đã kích hoạt — +100 điểm Khả dụng") is shown; the `ACCOUNT_ACTIVATED` notification appears in the bell exactly
   once; the dashboard badge reads "Thành viên Đã Xác Thực" (FR-7 "Verified Member"). An `EXPIRED` state explains the
   forfeiture. After an External completion the receipt tells the respondent the 100 points unlock after the 48-hour
   review (with the time) and suggests an Internal survey to unlock instantly.
9. **Frontend contract parity (mock-first).** The mock repository enforces the same rules (eligible = others' surveys;
   Internal immediate, External after 48 h; 30-day window; exactly once; lazy expiry "sweep") via the shared evaluator,
   exposes `getActivationStatus()` (status DTO + recommended surveys), and a typed live-API client exists for
   `GET /economy/starter-points/status` and `POST /economy/starter-points/unlock`.
10. **Regression safety.** Existing e2e/unit specs updated only where the rule deliberately changed (documented); new
    unit, e2e (incl. the concurrent case and the non-fatal unlock) and frontend tests; full `verify.sh` green.

## Tasks / Subtasks

- [x] **Task 1 — Shared activation rule in `@rescom/schemas` (AC: 2, 3, 5, 7)**
  - [x] 1.1 `packages/schemas/src/economy/starter-points.schema.ts`: add `EXTERNAL_COMPLETION_REVIEW_HOURS = 48`,
        `STARTER_ACTIVATION_STATES` / `starterActivationStateSchema`, `activationSurveySchema`, extend
        `starterPointsStatusSchema` with `activationState`, `activatedAt`, `activationSurvey`; extend
        `expireStarterPointsResultSchema` with `unlockedUserIds`, `deferredCount`, `failedCount`.
  - [x] 1.2 Pure `evaluateStarterActivation(input)` (+ types) implementing the window / review-window / eligibility /
        state rules; export from the economy index.
  - [x] 1.3 Spec coverage in `starter-points.schema.spec.ts` (every state, boundaries, catch-up, late completion,
        pending external, deadline).
- [x] **Task 2 — Ledger hardening (AC: 4, 5)**
  - [x] 2.1 `LedgerService.unlockStarterPoints`: when the post loses a race (`InsufficientBalance` /
        `InvalidLedgerOperation` / idempotency conflict) re-read `starter-unlock:{userId}` and return the winner.
  - [x] 2.2 `LedgerService.isJournalReversed(journalId)`.
  - [x] 2.3 Unit tests (race convergence with a Prisma-ordering double; reversal lookup).
- [x] **Task 3 — Starter-points data provider (AC: 2)**
  - [x] 3.1 Port: replace `hasCompletedMarketplaceSurvey` with
        `findActivationSurveyCompletions(userId, { completedBefore, limit })` returning `{ source, formId, attemptId,
        completedAt }[]` ordered by `completedAt` asc.
  - [x] 3.2 Prisma adapter: Internal = `Response VALIDATED`, not guest, `form.publisherId ≠ userId`, `submittedAt`;
        External = `SurveyAttempt COMPLETED`, form type EXTERNAL, not guest, `form.publisherId ≠ userId`,
        `submittedAt`; merge, sort, limit. Unit spec with a mocked Prisma.
  - [x] 3.3 In-memory adapter: `completions` map + `recordCompletion` helper (keep `userRegistrationDates` /
        `demographicCompletions`).
- [x] **Task 4 — Coordinator (AC: 3, 4, 5, 6, 7)**
  - [x] 4.1 `getStatus` builds the DTO from `evaluateStarterActivation` (External completions whose Pending credit was
        reversed are dropped).
  - [x] 4.2 `checkAndUnlockStarterPoints`: fast path on an existing unlock journal (re-publish deduplicated
        `ACCOUNT_ACTIVATED`), refuse on expiry, refuse unless `READY_TO_UNLOCK`, converge on race losers.
  - [x] 4.3 `tryUnlockStarterPoints(userId, trigger)` — never throws; logs through an injected framework-free logger.
  - [x] 4.4 `expireUnmaturedStarterPoints`: per-candidate evaluation (skip activated, catch-up unlock when eligible,
        defer pending review, expire otherwise; only users past their own deadline; per-user failures counted).
  - [x] 4.5 Unit specs incl. concurrent `Promise.all` unlocks, unlock-vs-expiry race, external review window, own
        survey excluded (provider), late completion, catch-up, notification recovery.
- [x] **Task 5 — Call sites & wiring (AC: 6)**
  - [x] 5.1 `ParticipationService` (internal submit, external verify) and `DemographicsService` (update, submit) call
        `tryUnlockStarterPoints`.
  - [x] 5.2 `RewardSettlementCoordinator.releasePendingReward` triggers `tryUnlockStarterPoints` after the release.
  - [x] 5.3 `EconomyModule`: logger (Nest `Logger`) into the coordinator; coordinator into the reward-settlement factory.
  - [x] 5.4 Unit specs: a throwing coordinator does not fail submission/verification/profile save.
- [x] **Task 6 — Backend e2e (AC: 1–7, 10)**
  - [x] 6.1 Update provider stubs in `external-completion`, `participation-submission`, `demographic-onboarding`,
        `starter-points` e2e specs to the new port.
  - [x] 6.2 New `test/marketplace-activation.e2e-spec.ts` with a participation-backed provider: status
        `SURVEY_REQUIRED` → Internal survey of another publisher → `ACTIVATED` once (+100, one notification); own survey
        does not count; External completion → `PENDING_CONFIRMATION`, no unlock → after the window `POST /unlock` →
        `ACTIVATED`; concurrent unlock requests post one journal; unlock failure keeps the submission 200.
- [x] **Task 7 — Frontend mock repository (AC: 1, 3, 5, 8, 9)**
  - [x] 7.1 Replace `checkAndUnlockFrozenPoints` with an evaluator-driven `reconcileStarterPoints` (unlock exactly
        once, lazy expiry with WARNING notification); completions come from stored COMPLETED attempts of others' surveys.
  - [x] 7.2 `getActivationStatus()` → `{ status: StarterPointsStatusDto, recommendedSurveys }`; submission results
        carry `activation` info; `submitDemographicSurvey` / `getOnboardingStatus` use the evaluator.
  - [x] 7.3 Relative fixture dates for not-yet-activated demo users (no 30-day time bomb in the demo or tests).
- [x] **Task 8 — Frontend UI (AC: 1, 8)**
  - [x] 8.1 `components/activation/ActivationCard.tsx` (loading / error+retry / states / recommendations / success /
        expired; accessible progressbar, live region, focus-visible).
  - [x] 8.2 Marketplace page and dashboard use it (replace the static 7.1 banner and the static checklist).
  - [x] 8.3 External receipt (`app/attempts/[id]`) shows the pending-activation notice.
- [x] **Task 9 — Typed live client (AC: 7, 9)**
  - [x] 9.1 `app/marketplace/activation-api.ts`: `fetchStarterPointsStatus`, `claimStarterPointsUnlock`,
        `refreshActivationStatus` (claim when `READY_TO_UNLOCK`), schema-validated, errors keep `code`/`details`.
- [x] **Task 10 — Frontend tests (AC: 9, 10)**
  - [x] 10.1 New `tests/marketplace-activation.test.mjs` (mock rules) and `tests/activation-api.test.mjs` (live client).
  - [x] 10.2 Update tests whose expectation changed deliberately (External completion no longer unlocks immediately).
- [x] **Task 11 — Verification & bookkeeping (AC: 10)**
  - [x] 11.1 `npx eslint "{src,test}/**/*.ts" --fix` (backend); frontend lint/typecheck.
  - [x] 11.2 `verify.sh` all green.
  - [x] 11.3 Dev Agent Record, File List, sprint-status → `review`, deferred items → `deferred-work.md`.

### Review Findings

Code review 2026-09-26 (Epic 7, full mode: Blind Hunter + Edge Case Hunter + Acceptance Auditor). The three decisions are listed with the same IDs in `code-review-decisions-2026-09-26.md` and were **not** implemented. All patches were applied ("Apply every patch"); only their decision-independent parts where a patch touches a decision.

- [x] [Review][Decision] E7-DN1 (medium) Should External completions count toward activation only after the 48-hour review window? — The dev agent added the 48 h hold (AC3, citing FR-24/FR-48); PRD FR-7/FR-8 and the frozen `spec-mock-respondent-journey.md` say the points unlock right after one completed survey, and the mock cannot simulate 48 h, so a demo user whose only survey is External never sees the unlock. Options: **A** keep the 48 h rule, record the sign-off in the spec's Change Log and add a mock-only demo control "Mô phỏng hết 48 giờ đối soát" in the Reset-demo modal that ages the current user's External attempts by 48 h (Internal stays instant); **B** count External at code verification (`confirmsAt = completedAt`) and accept that one leaked per-version completion code gives every bot account 100 spendable points; **C** only Internal completions activate. Recommendation: **A**. (P7 — the window-closed copy — only matters under A or C and is harmless under B.) [packages/schemas/src/economy/starter-activation.ts:84, apps/frontend/my-app/lib/mock/repository.ts] — **Resolved 2026-09-26:** option A accepted by Quan; the 48 h rule is kept (PO sign-off recorded in the `spec-mock-respondent-journey.md` Spec Change Log and here) and the Reset-demo modal gained a clearly labelled demo-only control "Mô phỏng hết 48 giờ đối soát" (`mockRepository.simulateExternalReviewElapsed`): it closes the review of the signed-in user's External completions early through a demo-only `reviewClosedAt` (optional input of the shared `evaluateStarterActivation`, never set by the backend; `completedAt` is not rewritten, so the 30-day window and rate limits are unaffected), releases every unreleased Pending credit once (`release-pending:{attemptId}` + REWARD_RELEASED) and re-runs the activation, so the External-only demo path unlocks; Internal stays instant; schemas and mock tests added.
- [x] [Review][Decision] E7-DN2 (medium) How much should we do against starter-point farming beyond FR-48? — A sock account can fill a junk profile, complete another account's survey (including a colluding Publisher's one-question or zero-reward survey) and get +100 Available; a zero-reward External completion has no Pending credit, so the Phase-1 disqualifier (reversal) can never apply. Options: **A** accept for Phase 1 (8.1 moderation, 8.2 limits, Phase-2 integrity work); **B** cheap qualifying rules — (1) the survey must pay ≥ 1 point (filter `form.rewardPerResponse >= 1` in both provider queries and the mock's `activationCompletions`), (2) a per-Publisher cap on starter unlocks per 24 h, (3) a minimum Publisher account age or an activated Publisher; **C** only Internal surveys with ≥ M questions qualify. Recommendation: **B(1) now, A for the rest**, recording B(2), B(3) and IP/device clustering in `deferred-work.md`; decide together with E4-DN2 (self-participation). [apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.ts:39, packages/schemas/src/economy/starter-activation.ts:16] — **Resolved 2026-09-26:** option B(1) accepted by Quan (A for the rest, decided with E4-DN2 = A); only surveys paying ≥ 1 point qualify: shared `STARTER_ACTIVATION_MIN_SURVEY_REWARD` / `isStarterActivationRewardEligible` re-checked by `evaluateStarterActivation` (completions now carry `rewardPerResponse`), `form.rewardPerResponse >= 1` in both Prisma provider queries, the in-memory provider, the mock's `activationCompletions` and its activation recommendations; B(2), B(3) and IP/device clustering recorded as deferred in `deferred-work.md`; tests in the schemas, coordinator, provider, e2e and mock suites.
- [x] [Review][Decision] E7-DN3 (low) Can a Respondent whose starter-point window expired still become a "Verified Member"? — "Verified Member" = `activationState === 'ACTIVATED'`, so an expired user who later finishes both steps keeps "Thành viên Mới (Chờ Kích Hoạt)" forever, contradicting the EXPIRED card on the same page. Options: **A** separate the status from the points — `isVerifiedMember` = profile complete and a confirmed eligible completion at any time, added to `StarterActivationEvaluation` and (additively) `starterPointsStatusSchema`, used by the dashboard badge and the Sidebar; **B** keep Verified Member = ACTIVATED but show a distinct "Điểm tân thủ đã hết hạn" badge for EXPIRED. Recommendation: **A**; the badge fix is needed under either option (the Sidebar already explains the expiry after P3; the dashboard badge is untouched pending this decision). [apps/frontend/my-app/app/dashboard/page.tsx:119, packages/schemas/src/economy/starter-activation.ts:143] — **Resolved 2026-09-26:** option A accepted by Quan; `isVerifiedMember` (unlocked, or a complete profile plus a confirmed eligible completion at any time — independent of the 30-day expiry) added to `StarterActivationEvaluation` and the status DTO (`starterPointsStatusSchema`, coordinator — which now reads completions up to now, not only to the deadline — and mock); the dashboard badge uses it via `memberStatusBadge` ("Chưa Xác Thực" instead of "Chờ Kích Hoạt" for an unverified EXPIRED user), the Sidebar shows a verified EXPIRED view and the EXPIRED card says whether the user is still a Verified Member; tests in the schemas, coordinator, e2e and frontend suites.
- [x] [Review][Patch] P2 (medium) Past the 30-day deadline the unlock no longer required a complete demographic profile (an in-window completion stood in for it, contradicting AC4). The evaluator now uses `demographicsDone = input.isDemographicComplete`; past the deadline an in-window completion catches up only while the profile is complete, otherwise the evaluation is EXPIRED [packages/schemas/src/economy/starter-activation.ts:134]
- [x] [Review][Patch] P3 (medium) The Sidebar's static checklist contradicted the activation rules on every portal page (own/pending surveys ticked step 2, EXPIRED showed "Chờ mở khóa", `frozen ?? 100`). `PortalShell` now loads the activation status (non-fatal, refreshed on `NOTIFICATIONS_CHANGED_EVENT`) and the Sidebar renders the pure `sidebarActivationView(status)` driven by `activationState` only. The badge source (`isVerifiedMember`) waits for E7-DN3 [apps/frontend/my-app/lib/activation.ts:137, apps/frontend/my-app/components/layout/Sidebar.tsx:84, apps/frontend/my-app/components/layout/PortalShell.tsx]
- [x] [Review][Patch] P5 (low) The idempotent replay paths never re-triggered the starter unlock (AC6). Applied on top of Epic 6 P5: the Internal owner replay and the External COMPLETED replay call `tryUnlockStarterPoints` (non-fatal, idempotent; guest replays do not) [apps/backend/src/modules/participation/application/participation.service.ts:841, apps/backend/src/modules/participation/application/participation.service.ts:1163]
- [x] [Review][Patch] P7 (low) PENDING_CONFIRMATION past the deadline still said "làm 1 khảo sát nội bộ để mở khóa ngay" and recommended surveys that can no longer count. New `isActivationWindowOpen`; ActivationCard and the External receipt drop the "unlock now" nudge and recommendations once the window closed; the mock returns no recommendations past the deadline; submission `activation` carries `expiresAt` [apps/frontend/my-app/lib/activation.ts:108, apps/frontend/my-app/components/activation/ActivationCard.tsx:301, apps/frontend/my-app/lib/mock/repository.ts:1714]
- [x] [Review][Patch] P10 (low) The External receipt's "unlock after 48 h (with time)" notice disappeared when the attempt page was reopened. The COMPLETED branch now rebuilds it from the activation status via `receiptActivationNotice(status, surveyId)` [apps/frontend/my-app/app/attempts/[id]/page.tsx:101, apps/frontend/my-app/lib/activation.ts:221]
- [x] [Review][Patch] P14 (low) `refreshActivationStatus` lost a valid status when the unlock claim failed and ignored the abort signal for the claim. `claimStarterPointsUnlock(options)` forwards `signal`; a failed (non-abort) claim returns the status already read [apps/frontend/my-app/app/marketplace/activation-api.ts:89]
- [x] [Review][Defer] DF1 (medium) No scheduler runs the expiry sweep or releases matured rewards, so an External-only respondent stays READY_TO_UNLOCK until another trigger; a zero-reward External has no credit whose release could trigger the unlock [apps/backend/src/modules/economy/presentation/starter-points.controller.ts:56] — deferred, same missing AD-5/AD-17 worker as Epic 6 DF1/DF2; Epic 6 P2 added `POST /economy/rewards/release-matured` and the live client claims READY_TO_UNLOCK on read
- [x] [Review][Defer] DF2 (low) The 48 h window ignores open dispute holds, `resolveDisputeHold(REFUND_TO_PUBLISHER)` and reversals posted after the unlock (no clawback) [apps/backend/src/modules/economy/application/starter-points.coordinator.ts:421] — deferred, dispute methods have no callers until Story 8.5 (Epic 6 DF4/DF11)
- [x] [Review][Defer] DF3 (low) An Internal completion counts at once even when ENFORCED routes its reward to INTEGRITY_HOLD; a response later REJECTED/DISPUTED keeps the unlock [apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.ts:44] — deferred, ENFORCED and those statuses are unreachable in Phase 1 (Epic 6 DF3, Epic 10)
- [x] [Review][Defer] DF4 (low) Status/unlock paths make ~7 queries plus one per External completion with no rate limit; the 20-per-source limit lets 20 reversed External completions hide a valid 21st [apps/backend/src/modules/economy/application/starter-points.coordinator.ts:371] — deferred, already recorded (uncached status reads; Epic 6 DF10)
- [x] [Review][Defer] DF7 (medium) The activation e2e suite re-derives the eligibility rule in a test provider; provider queries and unlock/expiry races never run against PostgreSQL [apps/backend/test/marketplace-activation.e2e-spec.ts:45] — deferred, needs the Postgres test container (Epic 6 DF5); shared with Story 7.1
- [x] [Review][Defer] DF8 (low) `window.open` runs after an awaited start call and may be blocked by popup blockers [apps/frontend/my-app/components/activation/ActivationCard.tsx:136] — deferred, pre-existing MarketplaceCard pattern; the attempt page has a synchronous "open the form" fallback; pre-open `about:blank` at the live-API swap

## Dev Notes

### What already exists (audit — do not rebuild)

| Piece | File | Current state | This story |
|---|---|---|---|
| Grant/unlock/expiry journals | `apps/backend/src/modules/economy/application/ledger.service.ts` (`grantStarterPoints`, `unlockStarterPoints`, `expireStarterPoints`) | Keys `starter-grant/unlock/expiry:{userId}`; unlock pre-checks FROZEN balance **before** the row lock, so a concurrent loser throws `InvalidLedgerOperation`/`InsufficientBalance` (Prisma locks + checks sufficiency before inserting the journal) | Converge on the winner |
| Coordinator | `economy/application/starter-points.coordinator.ts` | `getStatus` (any VALIDATED response / any COMPLETED attempt counts, incl. own surveys and External immediately); `checkAndUnlock` throws on ledger errors; sweep skips "completed" users forever and aborts on the first failure | Evaluator-driven, hardened |
| Data provider | `economy/infrastructure/prisma-starter-points-data-provider.ts` / `in-memory-…` | `hasCompletedMarketplaceSurvey` boolean | Completions with timestamps + eligibility filter |
| Status endpoint | `economy/presentation/starter-points.controller.ts` | `GET status`, `POST unlock` (CSRF), `POST expire` (ADMIN) | Reused; DTO extended additively |
| Unlock triggers | `participation.service.ts` (internal submit ~L476, external verify ~L697), `demographics.service.ts` (update, submit) | `await checkAndUnlock…` — a throw fails the request after the source commit | `tryUnlockStarterPoints` |
| Notifications | `NOTIFICATION_PUBLISHER_PORT` (Story 9.6) | `ACCOUNT_ACTIVATED` deduped by `starter-unlock:{userId}`; not re-published when already unlocked (deferred item) | Re-publish on the fast path |
| 7.1 handoff | `app/marketplace/page.tsx` static "Bước 2/2" banner; `lib/onboarding.ts` `MARKETPLACE_ACTIVATION_PATH` | static | Data-driven card |
| Mock unlock | `lib/mock/repository.ts#checkAndUnlockFrozenPoints` | any completed survey (External immediately), no window, no expiry | Shared evaluator |

### Decisions (conservative; recorded for review)

- **External timing = after the 48 h review window.** PRD FR-7/FR-8 say "complete 1 additional survey" without timing.
  FR-24 holds External completions 48 h because the code is a claim the Publisher can dispute; FR-48 requires that "creating
  accounts en masse yields no usable Points". Activating on verification would hand 100 spendable points to every bot
  that learns a shared Google-Form code. Internal completions are server-validated (answers + time barrier) and count at
  submission. The window runs from verification time (not from the Pending release, which a respondent can currently
  trigger early — deferred item from 9.6). A reversed `external-completion:{attemptId}` journal (the Phase-1 admin
  dispute outcome) disqualifies the completion.
- **30-day window applies to the completion time**, so the unlock itself may happen later (catch-up). Otherwise a user
  whose External survey was verified on day 29, or whose unlock failed transiently on day 29, would be stuck with Frozen
  points that are neither unlocked nor expired. _Amended by code review P2 (2026-09-26):_ the catch-up requires the
  demographic profile to be complete at evaluation time (AC4); an in-window completion never stands in for it. Past the
  deadline with an incomplete profile the evaluation is EXPIRED. Finality stays anchored on the `starter-expiry` journal:
  the mock voids lazily on read (final at once), while on the backend a user who re-completes the profile before the admin
  sweep runs can still catch up — consistent with AC4 (profile complete at unlock) and AC5 (in-window completion).
- **Own surveys never count** (no general self-participation rule exists yet; logged in deferred-work).
- **GET status stays read-only** (HTTP safety); `POST /economy/starter-points/unlock` is the retry. The live client
  composes them (`refreshActivationStatus`).
- **Verified Member** = `activationState === 'ACTIVATED'` (derived from the unlock journal); persisted tiers are Phase 2.
- **Recommendations** are computed by the mock repository from the feed (Internal first, then shortest effort, others'
  surveys only). The live swap composes `GET /marketplace/feed` + status.
- **Economy reads Participation tables** only through the existing read-only starter-points data provider (pattern from
  6.5); no writes outside Economy.

### Architecture compliance

- Clean Architecture guard: coordinator/services stay framework-free (logger injected as an interface; Nest `Logger`
  wired in `economy.module.ts`).
- AD-1/AD-16: every point movement through `LedgerService` with idempotency keys; unlock and expiry both debit FROZEN,
  which cannot go negative.
- Notifications published after the ledger commit, never throwing (9.6).
- AD-2: the activation rule lives once in `@rescom/schemas` and is consumed by backend + frontend.

### Testing requirements

- Backend unit (`npm test --workspace backend`), WHOLE e2e suite (`npm run test:e2e --workspace backend`), schemas,
  frontend (`node --test`), typecheck, lint — via `verify.sh`.
- e2e: new CSRF-guarded calls send `x-csrf-token` + `Origin`; override `NOTIFICATION_REPOSITORY_PORT`; never call
  `app.listen()`. Existing specs that override `STARTER_POINTS_DATA_PROVIDER` with ad-hoc objects must implement the new
  port method.

### Previous story intelligence

- 6.5: adding Prisma-backed providers to existing flows broke 4 e2e suites — this story adds none (the provider already
  exists and is overridden where needed).
- 7.1: completeness rule is shared; `nextStep` uses `isUnlocked || hasCompletedMarketplaceSurvey` — keep that contract.
- 9.6: notification dedupe keys mirror journal keys; mock notifications mirror backend events.

### Project Structure Notes

- New: `apps/backend/test/marketplace-activation.e2e-spec.ts`, `apps/frontend/my-app/components/activation/ActivationCard.tsx`,
  `apps/frontend/my-app/app/marketplace/activation-api.ts`, `apps/frontend/my-app/tests/marketplace-activation.test.mjs`,
  `apps/frontend/my-app/tests/activation-api.test.mjs`.
- `apps/frontend/my-app` is a nested git repo; do not commit anything.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.2, #Story 6.5, #Story 7.1]
- [Source: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md#UJ-1 step 3, #FR-5, #FR-7, #FR-8, #FR-24, #FR-48]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md#AD-1, #AD-2, #AD-16]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — 9.6 items on starter-unlock notification recovery and early self-release]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Full verification (`verify.sh`, 2026-09-26, final run after review follow-ups): schemas 260/260 (18 suites), backend unit 960/960 (81 suites), backend e2e 247 passed / 3 skipped (28 suites; the 3 skips are the Postgres-gated ledger tests), frontend 128/128, typecheck clean, lint clean; `prisma validate` clean; `next build --webpack` succeeds. Logs: scratchpad `log-*.txt`, `next-build-7-2.txt`.
- Red phases observed: evaluator spec (missing module), ledger race specs (2 failed with the converge block disabled, then green), provider spec (missing method), coordinator spec (new API), participation/demographics specs (unlock failure failed the request / `getStatus` failure failed the survey save), mock activation tests (9/9 failing), live-client test (missing module), unlock-result schema spec.

### Implementation Plan

- One shared pure rule `evaluateStarterActivation` (`@rescom/schemas`) → consumed by `StarterPointsCoordinator` and the mock repository.
- Economy owns every movement: `starter-unlock:{userId}` converges concurrent callers; unlock and expiry both debit FROZEN (non-negative), coordinator re-checks the other journal on failure.
- Call sites use `tryUnlockStarterPoints` (never throws, logs through an injected framework-free logger → Nest `Logger`).
- Status API reused and extended additively; `POST /unlock` is the retry; frontend card is data-driven via the mock repository, typed live client for the swap.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Naming:** sprint key `7-2-secondary-deep-onboarding` kept; implemented epics.md Story 7.2 "Marketplace Survey Activation Step".
- **Eligible survey (AC2):** `findActivationSurveyCompletions` (Prisma + in-memory) returns non-guest completions of surveys published by someone else — Internal `VALIDATED` responses and External `COMPLETED` attempts, ordered by `submittedAt`, bounded to the 30-day deadline. The demographic survey is not a Form, so it never counts.
- **External timing (AC3, decision):** counts only after the 48 h review window from verification (FR-24/FR-48 rationale in Dev Notes) and only if its `external-completion:{attemptId}` Pending credit was not reversed (`LedgerService.isJournalReversed`). State `PENDING_CONFIRMATION` exposes `confirmsAt`. Early self-release of the Pending reward does not shorten the window.
- **Exactly once (AC4):** `LedgerService.unlockStarterPoints` now converges on the winning journal when a concurrent unlock committed first (Prisma checks the locked balance before inserting the journal, so the loser saw `InsufficientBalance`/pre-check `InvalidLedgerOperation`). Tests: `Promise.all` unlocks (in-memory and a Prisma-ordering repository double), coordinator concurrent unlock (one journal, one notification), e2e with 3 concurrent `POST /unlock`. Already-unlocked checks re-publish the deduplicated `ACCOUNT_ACTIVATED` notice (fixes the 9.6 deferred recovery gap).
- **Expiry vs activation (AC5):** unlock refuses when an expiry journal exists (also when expiry wins a race mid-unlock); completions after the deadline never count; in-window completions allow a catch-up unlock after the deadline. The sweep evaluates each candidate with the same rule: skips users still inside their own window (an admin `cutoffDate` only narrows), activated / not granted / already expired; unlocks `READY_TO_UNLOCK` users; defers `PENDING_CONFIRMATION`; expires the rest; per-user failures are counted/logged and the sweep continues; `totalPointsVoided` now reports the amount actually voided. Result DTO gained `unlockedUserIds`, `deferredCount`, `failedCount`.
- **Non-fatal unlock (AC6):** internal submission, external verification, demographic update/submit and Pending release call `tryUnlockStarterPoints` (logs + swallows). `DemographicsService.resolveNextStep` falls back to `MARKETPLACE_ACTIVATION` if the status read fails. e2e proves a failing ledger unlock keeps the submission 200 and `POST /unlock` recovers.
- **Status API (AC7):** `GET /economy/starter-points/status` (read-only) adds `activationState`, `activatedAt`, `activationSurvey`; `hasCompletedMarketplaceSurvey` now means a *qualifying* completion. New shared `starterPointsUnlockResultSchema`; the backend result type aliases it. `RewardSettlementCoordinator.releasePendingReward` re-checks activation after a release.
- **Frontend (AC1, AC8, AC9):** mock repository replaced `checkAndUnlockFrozenPoints` with an evaluator-driven `reconcileStarterPoints` (exactly-once unlock with `starter-unlock:{userId}` journal rows, lazy 30-day expiry with a WARNING notification), new `getActivationStatus()` (status DTO + ≤3 recommended surveys: others' surveys, Internal first, Internal-only while an External one is under review), submission results carry `activation` (`state`, `confirmsAt`). New `components/activation/ActivationCard.tsx` (loading/error+retry, Bước 1/2 or 2/2, Frozen 100, countdown + expiry date with urgency, accessible progressbar, pending-review notice, recommendations with "Mở khóa ngay"/"Mở khóa sau 48 giờ", one-time dismissible success state, expired state) on the Marketplace (replaces the static 7.1 banner; `?activation=1` highlights) and the dashboard (replaces the static checklist; "Thành viên Đã Xác Thực" badge driven by the live state). External receipt explains the 48 h activation wait. Typed live client `app/marketplace/activation-api.ts` (`fetchStarterPointsStatus`, `claimStarterPointsUnlock`, `refreshActivationStatus`). Not-yet-activated demo users now have registration dates relative to "now" (no 30-day time bomb).
- **Deliberate test change:** `tests/notifications.test.mjs` expected an External completion to unlock immediately; it now asserts `REWARD_PENDING` first and `ACCOUNT_ACTIVATED` exactly once after the 48 h window. Backend coordinator spec rewritten for the new port (`recordCompletion`) and rules; the old "does not expire a completed user" case became "catch-up unlock for an in-window completion" + "expire a late completion".
- **Independent review follow-ups (code-reviewer pass):** M1 — past the deadline the rule, the sweep and the mock disagreed when the profile was incomplete: the evaluator now treats the demographic step as done past the deadline whenever an in-window completion exists (the 7.1 gate required a complete profile to start it), so past the deadline the only states are ACTIVATED / READY_TO_UNLOCK / PENDING_CONFIRMATION / EXPIRED (/ NOT_GRANTED) and EXPIRED is final; the sweep now voids only `evaluation.isExpired`. L1 — the completion lookup limit applies per source (reversed External credits cannot crowd out Internal completions). L2 — unlock posts the Frozen points actually held (capped at 100) and `LedgerService.expireStarterPoints` refuses once `starter-unlock` exists. L4 — `isJournalReversed` follows the reversal chain (a reversed reversal reinstates the credit). Not changed (accepted/documented): L3 concurrent losers also report `unlocked: true` with the same `journalId`; L5 the provider's reuse of the users mapper (from 7.1); no server-side trigger at `confirmsAt` (scheduler deferred).
- **No Prisma schema change / migration; no new dependencies.** Deferred items appended to `deferred-work.md`.
- **Code review 2026-09-26 (Epic 7):** applied P2 (the unlock always needs a complete profile — this reverses the M1 follow-up above, which inferred the demographic step past the deadline from an in-window completion), P3 (data-driven Sidebar activation block via `sidebarActivationView`), P5 (Internal/External replays re-trigger `tryUnlockStarterPoints`, on top of Epic 6 P5), P7 (`isActivationWindowOpen`: no "unlock now" nudge or recommendations once the 30-day window closed), P10 (reopened External receipt keeps the 48 h notice via `receiptActivationNotice`), P14 (live client keeps a READY_TO_UNLOCK status when the claim fails and forwards the abort signal). Verified that Epic 6 P2 kept the PENDING_RELEASE unlock trigger on the journal-derived respondent. 6 items deferred (DF1–DF4, DF7, DF8). Three decisions (E7-DN1 External 48 h hold, E7-DN2 anti-farming beyond FR-48, E7-DN3 expired users and Verified Member) await the user and were not implemented, so the story stays in-progress.
- **Decision follow-up 2026-09-26 (E7-DN1 option A, E7-DN2 option B(1), E7-DN3 option A, accepted by Quan; E7-DN2 decided together with E4-DN2 = A):** PO sign-off for the 48 h External hold recorded (spec Change Log); demo-only "Mô phỏng hết 48 giờ đối soát" control in the Reset-demo modal (mock repository method + tests); only surveys paying ≥ 1 point count toward activation (shared rule, both provider queries, in-memory provider, mock; residual farming controls deferred); "Verified Member" separated from the starter points via `isVerifiedMember` on the status DTO (dashboard badge, Sidebar, EXPIRED card). Deliberate test changes: the mock/e2e "own survey never counts" tests no longer start the own survey (E4-DN2 forbids it) and seed the completion directly; test providers and fixtures carry `rewardPerResponse`; status fixtures carry `isVerifiedMember`. Independent review follow-ups applied: the demo control no longer rewrites `completedAt` (it previously could leave a just-past-deadline completion under review while releasing its points, and reset the rate-limit window), it also releases Pending whose 48 h passed in real time, the Reset-demo modal clears a previous run's message on close, and past the deadline the coordinator keeps at most one confirmed late completion (bounded reversal lookups for expired accounts). Mock registration ids are now unique within a millisecond (`user-<ms>-<random>`), fixing a latent test flake where two back-to-back registrations shared one id. No Prisma schema change. Verification: schemas 418 (23 suites), backend unit 1419 (98 suites), backend e2e 291 passed / 3 skipped (30 suites), frontend 238, typecheck + lint clean, `prisma validate` clean.

### File List

- `packages/schemas/src/economy/starter-activation.ts` (new)
- `packages/schemas/src/economy/starter-activation.spec.ts` (new)
- `packages/schemas/src/economy/starter-points.schema.ts` (modified)
- `packages/schemas/src/economy/starter-points.schema.spec.ts` (modified)
- `packages/schemas/src/economy/index.ts` (modified)
- `apps/backend/src/modules/economy/application/starter-points.coordinator.ts` (modified)
- `apps/backend/src/modules/economy/application/starter-points.coordinator.spec.ts` (modified)
- `apps/backend/src/modules/economy/application/ledger.service.ts` (modified)
- `apps/backend/src/modules/economy/application/ledger.service.spec.ts` (modified)
- `apps/backend/src/modules/economy/application/reward-settlement.coordinator.ts` (modified)
- `apps/backend/src/modules/economy/application/reward-settlement.coordinator.spec.ts` (modified)
- `apps/backend/src/modules/economy/economy.module.ts` (modified)
- `apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.ts` (modified)
- `apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.spec.ts` (modified)
- `apps/backend/src/modules/economy/infrastructure/in-memory-starter-points-data-provider.ts` (modified)
- `apps/backend/src/modules/participation/application/participation.service.ts` (modified)
- `apps/backend/src/modules/participation/application/participation.service.spec.ts` (modified)
- `apps/backend/src/modules/users/application/demographics.service.ts` (modified)
- `apps/backend/src/modules/users/application/demographics.service.spec.ts` (modified)
- `apps/backend/test/marketplace-activation.e2e-spec.ts` (new)
- `apps/backend/test/starter-points.e2e-spec.ts` (modified)
- `apps/backend/test/demographic-onboarding.e2e-spec.ts` (modified)
- `apps/backend/test/external-completion.e2e-spec.ts` (modified)
- `apps/backend/test/participation-submission.e2e-spec.ts` (modified)
- `apps/frontend/my-app/lib/activation.ts` (new)
- `apps/frontend/my-app/lib/mock/repository.ts` (modified)
- `apps/frontend/my-app/lib/mock/types.ts` (modified)
- `apps/frontend/my-app/lib/mock/fixtures.ts` (modified)
- `apps/frontend/my-app/components/activation/ActivationCard.tsx` (new)
- `apps/frontend/my-app/app/marketplace/activation-api.ts` (new)
- `apps/frontend/my-app/app/marketplace/page.tsx` (modified)
- `apps/frontend/my-app/app/dashboard/page.tsx` (modified)
- `apps/frontend/my-app/app/attempts/[id]/page.tsx` (modified)
- `apps/frontend/my-app/tests/marketplace-activation.test.mjs` (new)
- `apps/frontend/my-app/tests/activation-api.test.mjs` (new)
- `apps/frontend/my-app/tests/notifications.test.mjs` (modified)
- `apps/frontend/my-app/components/layout/Sidebar.tsx` (modified — code review P3)
- `apps/frontend/my-app/components/layout/PortalShell.tsx` (modified — code review P3)
- Decision follow-up 2026-09-26 (E7-DN1, E7-DN2, E7-DN3):
  - `packages/schemas/src/economy/starter-activation.ts` (+ spec), `packages/schemas/src/economy/starter-points.schema.ts` (+ spec)
  - `apps/backend/src/modules/economy/application/starter-points.coordinator.ts` (+ spec)
  - `apps/backend/src/modules/economy/infrastructure/prisma-starter-points-data-provider.ts` (+ spec), `apps/backend/src/modules/economy/infrastructure/in-memory-starter-points-data-provider.ts`
  - `apps/backend/test/marketplace-activation.e2e-spec.ts`
  - `apps/frontend/my-app/lib/mock/repository.ts`, `apps/frontend/my-app/lib/mock/types.ts`, `apps/frontend/my-app/lib/activation.ts`
  - `apps/frontend/my-app/components/layout/ResetDemoModal.tsx`, `apps/frontend/my-app/components/activation/ActivationCard.tsx`, `apps/frontend/my-app/app/dashboard/page.tsx`
  - `apps/frontend/my-app/tests/marketplace-activation.test.mjs`, `apps/frontend/my-app/tests/activation-api.test.mjs`
  - `_bmad-output/implementation-artifacts/spec-mock-respondent-journey.md` (Spec Change Log), `_bmad-output/implementation-artifacts/code-review-decisions-2026-09-26.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/7-2-secondary-deep-onboarding.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified)

### Change Log

- 2026-09-26: Story created (ready-for-dev) from epics.md Story 7.2 (sprint key kept as `7-2-secondary-deep-onboarding`).
- 2026-09-26: Implemented Tasks 1–11 (+ independent review follow-ups M1, L1, L2, L4) — shared activation rule, exactly-once/race-safe unlock, expiry/activation exclusivity with catch-up sweep, non-fatal unlock triggers (+ Pending release trigger), extended status API + unlock-result contract, mock-first activation card on Marketplace/dashboard, External receipt notice, typed live client, tests. Full verification green. Status → review.
- 2026-09-26: Code review 2026-09-26 (Epic 7): applied P2, P3, P5, P7, P10, P14 with tests; 6 items deferred to `deferred-work.md`; decisions E7-DN1..DN3 open (not implemented). Status → in-progress.
- 2026-09-26: Decision follow-up 2026-09-26: E7-DN1 → option A (48 h External hold kept with PO sign-off; demo-only "Mô phỏng hết 48 giờ đối soát" control that matures the signed-in user's External completions, releases Pending and re-runs the activation); E7-DN2 → option B(1) (only surveys paying ≥ 1 point qualify; B(2)/B(3)/IP-device clustering deferred); E7-DN3 → option A (`isVerifiedMember` on the status DTO, used by the dashboard badge and Sidebar). No unchecked decision/patch items remain → Status `done`.
