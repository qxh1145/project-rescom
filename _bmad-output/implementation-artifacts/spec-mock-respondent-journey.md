---
title: 'Mock-first Respondent journey frontend'
type: 'feature'
created: '2026-09-24'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: '378e4a71ff125fb1acf6ee18291fc298ae56bf94'
context:
  - 'PROJECT_SUMMARY.md'
  - '_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md'
  - '_bmad-output/planning-artifacts/epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The frontend contains API-coupled Marketplace and Form Renderer work, but it lacks a coherent branded entry experience and cannot demonstrate the core Respondent journey without the backend. This blocks product review of registration, activation, survey discovery, and reward behavior.

**Approach:** Build one responsive, mock-first Respondent journey—login/register, demographic onboarding, dashboard, personalized Marketplace, and Internal/External survey completion—using the mint/blue, rounded, student-friendly visual direction observed at `localhost:3001`. Keep domain access behind typed repositories so a later API adapter can replace mock data without rewriting screens.

## Boundaries & Constraints

**Always:** Preserve existing Form Renderer, marketplace contracts, shared `@rescom/schemas` types, offline-answer utilities, and unrelated working-tree changes. Treat the same verified user as both Respondent and future Publisher. Persist demo session, onboarding, attempts, completions, and balances in namespaced `localStorage`; provide a reset path. Model 100 starter points as Frozen until demographics plus one eligible survey are complete. Internal rewards become Available immediately; External rewards become Pending for 48 hours. Use Vietnamese user-facing copy, responsive layouts, keyboard-visible focus, semantic labels, loading/empty/error states, and reduced-motion-safe transitions.

**Ask First:** Adding runtime dependencies; replacing existing shared schemas; deleting or redesigning existing Publisher/Wallet/Form Builder behavior; importing, copying, or generating official brand/mascot assets; changing backend code or API contracts.

**Never:** Call the live backend in this demo journey, hardcode fixtures inside page components, present Points as transferable cash, allow duplicate completion, trust a client-provided reward or elapsed time as an authoritative production pattern, or implement deferred Publisher/Admin/advanced-integrity modules.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| New account | Valid registration | Create mock session, grant 100 Frozen Points, route to onboarding | Duplicate/invalid input remains on form with field-level messages |
| Returning account | Demo credentials | Route incomplete account to onboarding and activated account to dashboard | Invalid credentials show a non-destructive alert |
| Interrupted onboarding | Refresh after one or more answers | Restore progress and permit back/forward navigation | Corrupt stored state resets safely to step one |
| Personalized feed | Completed demographic profile | Show only eligible, published, uncompleted surveys with reward, effort, type, and slots | Empty and simulated-failure states offer reset/retry |
| Internal completion | Valid required answers | Mark complete, credit Available, update activation progress, prevent resubmission | Validation or simulated submit failure preserves answers |
| External completion | Active attempt and completion code | Enforce mock countdown; valid code credits Pending for 48 hours | Early or wrong code explains why completion is blocked |

</frozen-after-approval>

## Code Map

- `apps/frontend/my-app/app/layout.tsx` and `app/globals.css` -- global metadata, tokens, typography, responsive base, and focus/motion rules.
- `apps/frontend/my-app/lib/mock/` -- typed fixtures, state store, repositories, latency/failure simulation, and reset behavior.
- `apps/frontend/my-app/components/layout/` -- reusable RESCOM brand mark, public shell, portal shell, sidebar, and mobile navigation.
- `apps/frontend/my-app/app/login/page.tsx` -- reference-inspired login/register entry.
- `apps/frontend/my-app/app/onboarding/page.tsx` -- resumable demographic wizard and activation explanation.
- `apps/frontend/my-app/app/dashboard/page.tsx` -- activation, balance, streak, and recommendations overview.
- `apps/frontend/my-app/app/marketplace/` -- existing feed refactored to consume repository data and consistent presentation components.
- `apps/frontend/my-app/app/forms/[id]/respond/page.tsx` -- existing Internal Form Renderer integrated with mock attempts and settlement.
- `apps/frontend/my-app/app/attempts/[id]/page.tsx` -- dedicated External Form countdown/code experience.

## Tasks & Acceptance

**Execution:**
- [x] `apps/frontend/my-app/lib/mock/{types,fixtures,store,repository}.ts` -- implement deterministic persona, survey, attempt, and balance operations with schema-compatible DTOs and storage recovery.
- [x] `apps/frontend/my-app/lib/mock/repository.test.mjs` -- cover every I/O matrix state, duplicate-completion prevention, settlement, reset, and corrupted storage.
- [ ] `apps/frontend/my-app/app/globals.css`, `app/layout.tsx`, `components/layout/*` -- establish the reference-inspired design system and responsive public/portal shells without external assets. Mobile QA at 375px still finds clipped portal header actions.
- [ ] `apps/frontend/my-app/app/page.tsx`, `app/login/page.tsx` -- route by mock session and implement accessible login/register tabs with documented demo credentials. Mobile QA at 375px still finds public-header overflow and a clipped register CTA.
- [x] `apps/frontend/my-app/app/onboarding/page.tsx` -- implement required demographics, resumable steps, validation, and Frozen-point activation messaging.
- [x] `apps/frontend/my-app/app/dashboard/page.tsx` -- implement the first useful post-login overview and onboarding checklist.
- [x] `apps/frontend/my-app/app/marketplace/{page,MarketplaceCard,MarketplaceFilterBar}.tsx` -- replace direct fetches with mock repositories and implement matching, filtering, sorting, completion hiding, empty, loading, and retry states.
- [x] `apps/frontend/my-app/app/forms/[id]/respond/page.tsx` -- reuse `FormRenderer`, preserve drafts on failure, settle Internal rewards, and return a clear success state.
- [x] `apps/frontend/my-app/app/attempts/[id]/page.tsx` -- implement External attempt instructions, countdown, code validation, missing-code report state, and Pending reward receipt.
- [x] `apps/frontend/my-app/tests/respondent-journey.test.mjs` -- add route-independent journey tests for onboarding gates and both settlement paths.

**Acceptance Criteria:**
- Given a fresh browser state, when the demo user completes registration, onboarding, and one eligible survey, then the journey progresses without backend availability and the 100 Frozen Points unlock exactly once.
- Given a returning activated user, when they search, sort, filter, start, leave, and resume a survey, then state remains consistent across refreshes and completed surveys cannot be repeated.
- Given desktop and 375px mobile viewports, when each journey screen is inspected, then primary actions remain visible, navigation is usable, text does not overflow, and keyboard focus is evident.

## Spec Change Log

- 2026-09-26 — Code-review decisions (Batch B), accepted by Quan (the human owner of this spec) in `code-review-decisions-2026-09-26.md`:
  - **E7-DN1 (option A), sign-off:** an External completion counts toward activation only after its 48-hour review window (FR-24/FR-48); Internal completions still unlock instantly. The acceptance criterion "completes … one eligible survey → the 100 Frozen Points unlock exactly once" holds for the External path after the window. Because the mock cannot wait 48 hours, the Reset-demo modal gained a clearly labelled demo-only control, "Mô phỏng hết 48 giờ đối soát", which closes the review window of the signed-in user's External completions early (without changing their completion time), releases their Pending credit to Available (REWARD_RELEASED notice) and re-runs the activation.
  - **E4-DN2 (option A):** a user never sees or starts their own survey in the Marketplace (mock parity with the backend's 403 `SELF_PARTICIPATION_FORBIDDEN`).
  - **E7-DN2 (option B(1)):** only surveys paying at least 1 point count as the "eligible survey" for activation.
  - **E7-DN3 (option A):** "Verified Member" is shown from the new additive `isVerifiedMember` field of the shared starter-points status (both onboarding steps done), separate from the starter points' 30-day expiry.
- 2026-09-26 — Code-review decision E8-D5 (Batch C2), accepted by Quan (the human owner of this spec) in `code-review-decisions-2026-09-26.md`:
  - **Option A for the Admin page:** the live-API Admin Moderation Dashboard `/admin/moderation` (Story 8.1) is accepted as an explicit exception to "Never … implement deferred Publisher/Admin/advanced-integrity modules". It is outside the demo respondent journey (not linked from `PortalShell`/Sidebar, never used by the mock repository) and follows the existing live-API Publisher `/forms` pages; the rest of the Admin portal stays deferred.
  - **Option B for the adapter:** "Existing API adapters remain untouched" is upheld. The Story 8.2 additions (the Internal submission call `submitInternalResponse` and the bot-protection-aware error shape with `status`/`retryAfterSeconds`) moved out of `app/marketplace/participation-api.ts` into the new `app/marketplace/participation-submit-api.ts`; `participation-api.ts` is restored to its prior API surface (`startSurveyAttempt`, `verifyExternalCompletionCode`, `reportMissingCompletionCode`), guarded by a `node --test` check.

## Design Notes

Keep business mutations in the repository, not React components. The repository returns promises with small deterministic latency so pages exercise real loading states. Components may format domain values but must not calculate authoritative rewards, eligibility, or time-barrier outcomes. Existing API adapters remain untouched for deferred integration work.

## Verification

**Commands:**
- `rtk npm test` -- all existing and new frontend unit tests pass.
- `rtk npm run typecheck` -- TypeScript reports no errors.
- `rtk npm run lint` -- ESLint reports no errors.
- `rtk npm run build` -- Next.js production build succeeds.

**Manual checks:**
- Run the complete new-user and returning-user journeys at desktop and mobile widths; verify visual parity with the reference direction, reset behavior, persistence, error recovery, Internal Available credit, and External Pending credit.
