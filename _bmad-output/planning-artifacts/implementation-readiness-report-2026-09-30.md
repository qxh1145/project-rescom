---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
assessmentFocus: Readiness to integrate the MSW-mocked frontend with the real backend
inputDocuments:
  prd:
    - _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md
    - _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/addendum.md
  spec:
    - _bmad-output/specs/spec-rescom/SPEC.md
  architecture:
    - _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md
    - _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md
  epics:
    - _bmad-output/planning-artifacts/epics.md
    - _bmad-output/implementation-artifacts/sprint-status.yaml
  ux:
    - _bmad-output/planning-artifacts/ux-designs/ux-project-rescom-2026-09-14/DESIGN.md
    - _bmad-output/planning-artifacts/ux-designs/ux-project-rescom-2026-09-14/EXPERIENCE.md
    - docs/frontend/design-system.md
    - docs/frontend/figma-screen-inventory.md
    - docs/frontend/screen-implementation-guide.md
  integration:
    - _bmad-output/brainstorming/brainstorm-backend-integration-deployment-2026-09-29/integration-deployment-plan.md
    - docs/frontend/api-conventions.md
    - docs/frontend/mock-strategy.md
    - docs/frontend/architecture.md
  codebaseReality:
    - apps/backend/ (NestJS + Prisma)
    - apps/frontend/my-app/ (Next.js + MSW mocks)
excludedDocuments:
  - _bmad-output/planning-artifacts/architecture/RESCOM-Architecture-V2.archive.md (explicitly archived)
supersedes: implementation-readiness-report-2026-09-29.md (incomplete; stopped after step 2)
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-30
**Project:** project-rescom
**Focus:** Is the project ready for backend integration (replace MSW mocks with real API)?

## Document Inventory

### PRD Documents
- `prds/prd-project-rescom-2026-08-08/prd.md` — primary PRD (86K, 2026-09-27)
- `prds/prd-project-rescom-2026-08-08/addendum.md` — PRD addendum
- `specs/spec-rescom/SPEC.md` — canonical SPEC (declared top of authority chain)

### Architecture Documents
- `architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md`
- `architecture/architecture-project-rescom-2026-08-08/solution-design.md`
- Excluded: `architecture/RESCOM-Architecture-V2.archive.md` (archived)

### Epics and Stories Documents
- `epics.md` (80K, 2026-09-30)
- 36 story files and `sprint-status.yaml` in `implementation-artifacts/`

### UX Documents
- `ux-designs/ux-project-rescom-2026-09-14/DESIGN.md` and `EXPERIENCE.md` — near-empty stubs (~150 bytes each)
- Effective UX sources: `docs/frontend/design-system.md`, `figma-screen-inventory.md`, `screen-implementation-guide.md`

### Integration Documents (added for assessment focus)
- `brainstorming/brainstorm-backend-integration-deployment-2026-09-29/integration-deployment-plan.md`
- `docs/frontend/api-conventions.md`, `mock-strategy.md`, `architecture.md`

### Discovery Notes
- No whole-vs-sharded duplicates among active documents.
- UX planning artifacts are stubs; real UX contract lives in `docs/frontend/`.
- Prior report `implementation-readiness-report-2026-09-29.md` is incomplete (steps 1–2 only) and predates the integration plan's final revision and the 2026-09-30 analytics commit.

## PRD Analysis

### Functional Requirements

FR-1 — Email/Password Registration: Users can register with email and password. System validates email uniqueness and password strength.

FR-2 — Google OAuth Login: Users can sign up and log in via Google Account (OAuth 2.0).

FR-3 — Single-Session Enforcement: Each account can only be logged in on one device at a time. New login invalidates the previous session.

FR-4 — Frozen Starter Points: System automatically grants 100 Frozen Points upon registration.

FR-5 — Starter Points Expiry: If the account does not complete onboarding within 30 days of registration, the 100 Frozen Points are forfeited.

FR-6 — Mandatory Demographic Survey: New users must complete the system onboarding survey as their first action. It collects age range, gender, region/province, occupation, academic major, income bracket, and interests. The 2026-09-26 amendment changes this to a one-question-per-screen, four-part wizard, adds display name, university, academic year, birth year, and goal intent, requires at least three interests, and makes goal intent non-authoritative for permissions.

FR-7 — Second Onboarding Survey: After completing the demographic survey, the user must complete one additional Marketplace survey to fully activate.

FR-8 — Point Unlock on Activation: After both onboarding surveys, 100 Frozen Points transfer to Available Balance.

FR-9 — Demographic Profile: Each user has a profile containing major, academic year, age, gender, region, occupation, income bracket, and interests; the amendment adds university, birth year, and onboarding goal intent.

FR-10 — Publisher Targeting Criteria: When creating a survey, the Publisher sets gender, age range, major, university, and region targeting. Interests and income are excluded until Open Question 13 is approved.

FR-11 — Automated Matching: The system matches targeting criteria against Respondent profiles and only shows matching surveys in their feed.

FR-12 — External Survey Creation: Publisher supplies the Google Forms link and estimated time, targeting criteria, sample size, and point reward through a three-step stepper.

FR-13 — Server-Generated Completion Code: The system generates one unique six-digit code per published External Form Version. It is static for that version, bound by keyed digest, shown once to the Publisher, and rotated only through a new immutable version.

FR-14 — Point Reward Pricing Table: The system enforces `<5 min: 5–10`, `5–10 min: 10–20`, `10–15 min: 15–25`, and `>15 min: 20–40` Points; Publishers cannot set rewards below the minimum.

FR-15 — Escrow Lock on Publish: The system calculates sample size × reward and locks that total from the Publisher’s Available Balance.

FR-16 — Drag-and-Drop Form Builder: Publisher can create sectioned surveys with text, textarea, number, single-choice, multiple-choice, rating, linear-scale, date, and file-upload components using a palette, canvas, properties panel, and live preview, including explicitly configured integrity metadata.

FR-17 — AI Form Generator: Publisher can describe survey intent in natural language; the optional assistant produces a Zod-valid draft Form Definition for review and editing without becoming a blocking dependency.

FR-18 — Form Versioning: Each survey has ordered Form Versions. Published versions and their integrity configuration are immutable; changes require a new draft and responses remain pinned to the submitted version.

FR-19 — Internal Form Pricing Discount: Internal Forms cost 20% fewer Points per response than External Forms of the same estimated duration.

FR-20 — Moderation Queue: Published Internal and External surveys enter an Admin queue and remain absent from the Marketplace until approved.

FR-21 — Survey Attempt Start: Starting an External survey records `startTime` server-side, opens the hosted form, and shows a countdown and code-entry UI in RESCOM.

FR-22 — Completion Code Verification: Backend validates the six-digit code against the exact published version pinned to the active Attempt and verifies server-measured elapsed time. The Phase 1 amendment provisionally locks an Attempt after three wrong codes and blocks the account/version after six, requiring an audited Admin reset.

FR-23 — Missing Code Report: A Respondent can report that the Publisher omitted the Completion Code from the hosted form.

FR-24 — 48-Hour Pending Period: External-form rewards enter Pending Balance and automatically transfer to Available after 48 hours without a complaint.

FR-25 — One Completion Per Account: Each authenticated account may complete a logical Form at most once across all versions and reopen cycles.

FR-26 — In-Platform Survey Experience: Internal surveys render within RESCOM from the published Form Definition and support every registered question type, progress, and section navigation.

FR-27 — Demographic Cross-Check: The system compares disclosed demographic answers with the onboarding profile. Contradictions create versioned integrity signals but cannot independently reject, lower long-term reliability, or create FraudLog records.

FR-28 — Bot Detection: The system checks actual completion time against a threshold based on question count and type, rejects impossibly fast submissions, and records the hard-control result separately from integrity assessments.

FR-29 — Internal Reward Credit and ENFORCED Hold: Valid authenticated Internal submissions use the policy mode pinned at submission. `SHADOW` and `ADVISORY` credit Available within 1–2 minutes independently of scoring; `ENFORCED` first posts to a non-spendable Integrity Hold, then releases, retains, reverses, or fails open through idempotent settlement.

FR-30 — Immutable Double-Entry Ledger: Every Point movement is an append-only debit/credit transaction that cannot be edited or deleted and uses ACID transactions with row-level locking.

FR-31 — Wallet Dashboard: The wallet shows Available, Pending, Frozen, Integrity Hold, and immutable transaction history, with distinct lifecycle entries tied to the relevant Response.

FR-32 — Escrow Refund on Survey Close: Unused Escrow is automatically returned to the Publisher’s Available Balance when a survey expires or closes with unfilled slots.

FR-33 — Survey Reopen with Additional Tokens: A Publisher can reopen a closed/completed survey by funding only the added sample quota while preserving previous responses.

FR-34 — Manual Top-Up Request: A user selects at least 100 Points (20,000 VNĐ), transfers funds, and submits a one-way top-up request for Admin review.

FR-35 — Admin Top-Up Approval: Admin verifies the transfer and approves or rejects the request; approval credits Available Balance through the ledger.

FR-36 — Personalized Feed: Marketplace shows only active, approved surveys that match the Respondent’s profile and exposes reward, time, and remaining slots.

FR-37 — Sort and Filter: The feed supports best match, shortest duration, highest reward, nearest deadline, same university/major, newest, and combinable advanced filters.

FR-38 — Auto-Hide on Quota Completion: A survey reaching its sample quota becomes Completed and is hidden from new Respondents.

FR-39 — Progress Tracking: Publisher dashboard shows completion versus target, Points spent, Escrow remaining, deadline countdown, and lifecycle status.

FR-40 — Internal Response Data: Publisher can view Internal Form responses pinned to Form Version with safe integrity metadata, but never raw telemetry, sensitive evidence, or unrelated Respondent history; export remains gated.

FR-41 — Traffic Analytics: Dashboard shows views/clicks over time, average completion time, drop-off, Internal integrity distributions and Survey Quality, and External `NOT_ASSESSED` status.

FR-42 — Feedback Summary: Dashboard aggregates Respondent feedback. The Phase 1 amendment replaces separate dimension ratings with average overall rating, per-tag reporting shares, and gated free-text visibility.

FR-43 — Post-Completion Feedback: Phase 1 requires one overall 1–5 rating and permits issue tags plus a comment of at most 500 characters, with one immutable feedback record per completed Attempt.

FR-44 — Negative Feedback Deprioritization: Surveys crossing an approved threshold are ranked lower; automation remains disabled until Open Question 15 is approved.

FR-45 — Time Barrier: Server rejects submissions below the server-measured minimum. The Phase 1 amendment fixes Attempt reservation at 30 minutes and blocks surveys whose declared/effective duration cannot leave five minutes for submission.

FR-46 — Rate Limiting: Centrally versioned policy limits completions and sensitive actions. Phase 1 provisionally names `participation-rate-limit-v1` with 20 completions/hour and 10 relevant requests/action/minute, pending Open Question 16 approval.

FR-47 — Immutable FraudLog: Rejected hard-abuse attempts, security-policy violations, and confirmed abuse evidence are append-only; soft integrity evidence stays in Integrity records.

FR-48 — Frozen Points Anti-Bot: Starter Points remain unusable until both onboarding surveys are completed.

FR-49 — Streak Counter: The system tracks consecutive calendar days with at least one completion and increments at most once per day.

FR-50 — Leaderboard: Authenticated users can view most-completed rankings (weekly and all-time) and longest active streak; exact scope and displayed count remain gated.

FR-51 — Tier Progression: New User receives 100 Frozen Points; Verified Member completes two onboarding surveys and unlocks access; Active Contributor completes at least 20 surveys and gains feed priority; Trusted Researcher completes at least 100 surveys but retains the default 48-hour External Pending period unless approved otherwise; Community Ambassador completes at least 300 surveys and is badge-only until privileges are approved. Engagement tier remains independent of reliability.

FR-52 — User Management: Admin can view, search, filter, ban/unban, and edit users, with edits logged.

FR-53 — Survey Moderation: Admin approves or rejects queued surveys with reasons; rejection returns Escrow. Pilot cadence remains gated by Open Question 22.

FR-54 — Complaint Resolution: Admin reviews evidence, upholds or dismisses complaints, performs the applicable Point reversal, and notifies both parties by email.

FR-55 — FraudLog Monitoring: Admin can read, search, and filter FraudLog and manually ban repeat offenders; no automatic ban is allowed.

FR-56 — Transaction Dashboard: Admin sees aggregate and drill-down views of top-ups, active escrows, refunds, and other Point transactions.

FR-57 — Event Notifications: In-app and, for critical events, email notifications cover activation, moderation, reward states, Integrity Holds, complaints, quota, bans, and top-ups; push is excluded.

FR-58 — Consent-Aware Behavioral Telemetry: Internal Forms capture only disclosed, purpose-bound interaction events with notice/version acceptance; prohibited categories include raw keystrokes, clipboard content, unrelated browsing, and background-device activity. Production telemetry remains disabled until its governance gates close.

FR-59 — Response Integrity Assessment: Every submitted Internal response receives a versioned assessment or explicit recoverable pending state, including score where applicable, confidence, coverage, safe reason codes, policy/revision/timestamp, and a separate immutable decision.

FR-60 — Cold-Start Handling: New Respondents begin `UNESTABLISHED`; missing history cannot itself reduce integrity or block them, and reliability remains separate from confidence.

FR-61 — Respondent Reliability: Authenticated Respondents receive versioned longitudinal snapshots based only on eligible Internal evidence and confirmed review outcomes; external/guest responses and completion count alone do not establish reliability.

FR-62 — Survey Quality Assessment: Each Internal Form Version receives its own assessment after sufficient evidence; insufficient samples produce `INSUFFICIENT_EVIDENCE`, and poor Survey Quality cannot reduce Respondent Reliability.

FR-63 — Explainability and Reproducibility: Activated policies are immutable; signals and policy lineage are preserved; authorized users receive safe explanations; reprocessing creates a new revision rather than overwriting history.

FR-64 — Integrity Decision Modes: New policies begin in `SHADOW`, may progress to `ADVISORY`, and only separately authorized `ENFORCED` policies can produce `ACCEPT` or `REVIEW`; all ENFORCED rewards are held first and fail open on terminal failure or decision deadline expiry.

FR-65 — Integrity Review and Feedback Labels: Authorized reviewers can accept, mark insufficient evidence, or reject with reasons; reward settlement is idempotent, outcomes become calibration labels, and Respondents receive explanations and appeal access. ENFORCED activation remains gated.

FR-66 — TrustGraph-Ready Relationships: The approved data store maintains versioned relationships among Respondents, Responses, Form Versions, Publishers, policies, reviews, and outcomes with restricted sensitive evidence.

FR-67 — Assessment Applicability: Applicability is explicit: authenticated Internal responses may use all dimensions; approved guest Internal responses cannot receive Respondent Reliability; External responses are `NOT_ASSESSED`; neutral states never become zero scores.

**Total Functional Requirements: 67**

### Non-Functional Requirements

NFR-1: API response target is <500ms under the named normal-load profile; percentile, workload, exclusions, and measurement window require Open Question 22 approval before release testing.

NFR-2: Survey Feed loads in <2 seconds with no more than 50 surveys.

NFR-3: Point transactions use ACID and row-level locking to prevent race conditions.

NFR-4: PostgreSQL is authoritative for Time Barrier and durable security state. A single-replica/no-Redis profile uses durable PostgreSQL counters plus conservative local limits and cannot scale horizontally; a shared-Redis profile uses shared counters and fails closed on high-risk mutations during Redis outage.

NFR-5: AI Form Generation has a separate timeout and is not subject to the 500ms API target.

NFR-6: A short-lived signed access JWT is stored in a Secure HTTP-Only cookie and bound to a PostgreSQL-authoritative revocable session; refresh secrets rotate and single-session invalidation is server-enforced.

NFR-7: CORS, Helmet, and `@nestjs/throttler` protect all API endpoints.

NFR-8: `startTime`, Completion Code generation, and Point calculations are server-authoritative; the client is never trusted.

NFR-9: All Point transactions use ACID for consistency.

NFR-10: FraudLog is append-only, with no delete or update.

NFR-11: Point Ledger integrity prevents balances from being duplicated or lost.

NFR-12: Auto-Refund runs on schedule for expired surveys.

NFR-13: External Pending automatically transfers to Available after the 48-hour expiry.

NFR-14: Uptime target is at least 99% during the named peak-academic profile; boundary, exclusions, and measurement window require Open Question 22 approval.

NFR-15: AI failure cannot affect login, surveys, Points, or Marketplace.

NFR-16: Frontend and Backend remain separated in a monorepo.

NFR-17: Prisma ORM manages the database schema.

NFR-18: Frontend and Backend share Zod validation.

NFR-19: Form Definition JSON schema is a shared package.

NFR-20: UI-heavy story acceptance is gated on a canonical UX artifact covering responsive states, accessibility, localization/content rules, and sensitive Integrity language; Open Question 20 owns the measurable target.

NFR-21: Survey creation follows a clear three-step stepper.

NFR-22: CSAT target is greater than 4.0/5.0.

NFR-23: Integrity telemetry ingestion is idempotent through client event ID and server-side uniqueness.

NFR-24: Submitted responses remain durable when scoring is unavailable and enter a recoverable pending assessment state.

NFR-25: Scoring retries cannot duplicate assessments, reviews, notifications, Integrity Holds, releases, reversals, or other ledger actions.

NFR-26: Historical assessments are reproducible from preserved signals and immutable policy versions.

NFR-27: Initial deterministic assessment completes within 1–2 minutes under the named normal-load profile; workload, percentile, and measurement window require Open Question 22 approval.

NFR-28: Raw telemetry, sensitive evidence, and review actions are role-restricted and access-audited.

NFR-29: Integrity Engine failure cannot affect authentication, Form rendering, response durability, or External Form flows.

NFR-30: Assessment, review, and reliability queries are paginated and never load raw event streams into dashboards.

**Total Non-Functional Requirements: 30**

### Additional Requirements and Constraints

- The declared canonical authority chain places `_bmad-output/specs/spec-rescom/SPEC.md` above this PRD, followed by the addendum, Architecture Spine, solution design, epics, and repository reality. The canonical SPEC was not included in the configured readiness inventory and therefore represents an assessment dependency outside the selected set.
- The PRD contains 22 unresolved, owner-bound gates: leaderboard contract; survey-reopen pricing; Trusted Researcher pending duration; Community Ambassador privileges; AI timeout/recovery; response-file export; integrity-policy promotion; Survey Quality evidence threshold; integrity-review ownership; retention periods; integrity export; ENFORCED decision deadline; additional targeting fields; failed-code policy; feedback-deprioritization threshold; production rate limits; consent and subject rights; review/rejection/appeal settlement; guest identity/abuse controls; accessibility/content contract; validation of market-evidence claims; and operational SLO profiles.
- Production personal-data processing requires documented access, correction, deletion/anonymization, export, consent-withdrawal, named ownership, and audited access. Production integrity telemetry is disabled until the specified privacy, minimization, retention, rights, promotion, review, and evidence-threshold gates close.
- Points are internal, non-transferable, non-cashable tokens. Production launch requires qualified Vietnamese privacy/legal review and documented evidence.
- Published forms, active integrity policies, assessment history, ledger transactions, FraudLog, integrity events, reliability snapshots, and Survey Quality snapshots have explicit immutability or append-only requirements.
- The addendum requires authenticated Internal submission to atomically persist the Response transition, pinned policy deployment, uniquely identified reward-request outbox event, and uniquely identified assessment-request outbox event. Reward and assessment consumers are independent and replay-idempotent.
- Deterministic integrity scoring must remain framework-independent and consume immutable signals plus immutable policy versions. Assessment, operational decision, and review lifecycles are separate.
- Publishers receive only safe assessments and never raw telemetry, hidden thresholds, sensitive device/account links, or unrelated Respondent history.
- Integrity rollout is instrumentation → shadow → calibration → advisory → authorized enforcement. Tests must cover scoring, golden cases, event/API contracts, replay, cold start, permissions/privacy, recovery, fairness, review, and appeal.
- The addendum states the current Prisma schema lacks migration history/live-state evidence and must be redesigned against the Architecture Spine before client generation or migration work.
- The 2026-09-26 pilot amendment supersedes older hosting text with Vercel `sin1`, one Google Compute Engine VM in `asia-southeast1`, Cloud SQL private IP, private Google Cloud Storage, Caddy, ClamAV, Cloudflare-only ingress, Sentry, an uptime monitor, and GitHub Actions/GHCR.

### PRD Completeness Assessment

The PRD is structurally strong: all 67 FRs and 30 NFRs are globally numbered, most FRs include testable consequences, integrity applicability is explicit, and important invariants—immutability, idempotency, server authority, and fail-open settlement—are stated consistently. The addendum provides useful downstream technical constraints.

It is not fully implementation-ready as a product contract. Twenty-two decisions remain explicitly gated. Open Question 20 blocks UI-heavy story acceptance; Open Question 22 blocks interpretation of several performance, freshness, uptime, moderation, and release-test targets; Open Questions 17–19 block production personal-data/telemetry, ENFORCED integrity settlement, and Guest participation. Other unresolved gates block leaderboard, reopen pricing, AI launch testing, export, deprioritization, targeting extensions, and production anti-abuse policy.

There are also active-document inconsistencies requiring reconciliation: the GO LIVE list still includes the AI Form Generator while the 2026-09-26 amendment defers Epic 3 and provisions no pilot AI host; older Platform lines remain present but are superseded by an amendment; and the original FR-42/FR-43 feedback wording is retained even though the Phase 1 amendment changes the data model. These are recoverable because the amendments state precedence, but they increase implementation and test ambiguity if stories fail to carry the amendments forward.

### Canonical SPEC and Integration-Focus Notes (2026-09-30)

- `SPEC.md` (top of the authority chain) is scoped to the Research Integrity Engine only (CAP-1…CAP-7). It adds no requirements beyond FR-58…FR-67 and NFR-23…NFR-30; it does not describe the core marketplace. The core contract is therefore the PRD + addendum.
- The PRD was re-read in full on 2026-09-30; it is unchanged since 2026-09-27, so the FR/NFR extraction above (first produced 2026-09-29) remains accurate.
- Integration-relevant PRD constraints: NFR-6 (HttpOnly cookie JWT bound to a PostgreSQL revocable session), NFR-7 (CORS/Helmet/throttler), NFR-8 (server authority), NFR-18/NFR-19 (Zod and Form Definition shared between FE and BE), and the addendum statement that the Prisma schema "must be redesigned against the updated Spine before client generation or migration work."
- Integrity telemetry (FR-58) cannot run in production until Open Question 17 closes. Integration can proceed in `SHADOW` or with telemetry off.

## Epic Coverage Validation

Coverage is traced from the `epics.md` FR Coverage Map and story acceptance criteria. The Phase column comes from `sprint-status.yaml` (2026-09-29). "P2-deferred" means a story exists but is explicitly deferred.

### Coverage Matrix

| FR | Requirement | Epic / Story | Status | Phase 1 state |
|----|-------------|--------------|--------|---------------|
| FR-1 | Email/password registration | E1 / 1.1 | ✓ Covered | done |
| FR-2 | Google OAuth login | E1 / 1.2 | ✓ Covered | done |
| FR-3 | Single-session enforcement | E1 / 1.3 | ✓ Covered | done |
| FR-4 | Frozen starter Points | E6 / 6.5 | ✓ Covered | done |
| FR-5 | Starter Points expiry (+ notify user) | E6 / 6.5 | ⚠ Partial: expiry covered; the "user is notified" consequence is not in 6.5 or 9.6 | done |
| FR-6 | Mandatory demographic survey | E7 / 7.1 | ✓ Covered | done |
| FR-7 | Second onboarding survey | E7 / 7.2 | ✓ Covered | done (story file is named `7-2-secondary-deep-onboarding`; the epic title is "Marketplace Survey Activation Step") |
| FR-8 | Point unlock on activation | E6 / 6.5, E7 / 7.2 | ✓ Covered | done |
| FR-9 | Demographic profile (update anytime) | E7 / 7.1 | ⚠ Partial: capture only; no story for "user can update profile at any time" | done |
| FR-10 | Publisher targeting criteria (+ audience estimate) | E4 / 4.1 | ⚠ Partial: "estimated audience size before publishing" is not in the AC | done |
| FR-11 | Automated matching | E4 / 4.2 | ✓ Covered | done |
| FR-12 | External survey 3-step stepper | E2 (map) / 4.5 | ✓ Covered (the map says E2; the story sits in E4) | done |
| FR-13 | Server-generated completion code | E5 (map) / 4.5, 5.5 | ✓ Covered | done |
| FR-14 | Reward pricing table | E6 / 6.3 | ✓ Covered | done |
| FR-15 | Escrow lock on publish | E6 / 6.3 | ✓ Covered | done |
| FR-16 | Drag-and-drop Form Builder | E2 / 2.3–2.5 | ⚠ Partial: integrity-authoring consequences (attention checks, warnings) are only in 2.1 schema | done |
| FR-17 | AI Form Generator | E3 / 3.1–3.4 | ✓ Covered | **P2-deferred** (PRD GO-LIVE list still includes it) |
| FR-18 | Form versioning | E2 / 2.7 | ✓ Covered | done |
| FR-19 | Internal 20% discount | E6 / 6.3 | ✓ Covered | done |
| FR-20 | Moderation queue | E8 / 8.1 | ✓ Covered | done |
| FR-21 | Attempt start | E5 / 5.1 | ✓ Covered | done |
| FR-22 | Completion code verification | E5 / 5.5 | ✓ Covered | done |
| FR-23 | Missing-code report | E5 / 5.5 | ⚠ Partial: the Respondent-side report is covered; the Admin resolution side has no story (8.5 is deferred) | done |
| FR-24 | 48h pending (external) | E5 / 5.5, E6 / 6.4 | ✓ Covered | done |
| FR-25 | One completion per account | E5 / 5.1 | ✓ Covered | done |
| FR-26 | In-platform survey experience | E5 / 5.2 | ✓ Covered | done |
| FR-27 | Demographic cross-check | E7 / 7.3 | ✓ Covered | **P2-deferred** |
| FR-28 | Bot detection | E8 / 8.2 | ✓ Covered | done |
| FR-29 | Internal reward credit / ENFORCED hold | E5 / 5.4, E6 / 6.4 | ✓ Covered | done (SHADOW/ADVISORY path; ENFORCED blocked by OQ-18) |
| FR-30 | Immutable double-entry ledger | E6 / 6.1 | ✓ Covered | done |
| FR-31 | Wallet dashboard + history | E6 / 6.2 | ⚠ Partial: 6.2 omits Integrity Hold and transaction history; history sits in 9.5 (deferred), while sprint-status says "personal wallet history retained in Story 6.2" | done |
| FR-32 | Escrow refund on close | E6 / 6.3 | ⚠ Partial: manual close only; the deadline-driven background refund (NFR-12) is not in the AC | done |
| FR-33 | Survey reopen | E6 (map) / 6.3 cites it | ❌ Not really covered: no reopen AC exists, and OQ-2 blocks it | — |
| FR-34 | Manual top-up request | E6 / 6.6 | ✓ Covered | done |
| FR-35 | Admin top-up approval | E6 / 6.6 | ✓ Covered | done |
| FR-36 | Personalized feed | E4 / 4.2 | ✓ Covered | done |
| FR-37 | Sort & filter | E4 / 4.3 | ⚠ Partial: 2 of 6 sort modes; no combinable filters | done |
| FR-38 | Auto-hide on quota | E4 / 4.3 | ⚠ Partial: the AC hides *completed-by-me* surveys, not quota-reached surveys, and has no publisher notification | done |
| FR-39 | Publisher progress tracking | **NOT FOUND** | ❌ MISSING | — |
| FR-40 | Response data (internal) | E5 (map); cited in 5.4 (misattributed) and 9.1 | ❌ Effectively missing in Phase 1: the only real AC is in 9.1, which is P2-deferred | P2-deferred |
| FR-41 | Traffic analytics | E9 / 9.1 | ✓ Covered | **P2-deferred** |
| FR-42 | Feedback summary | E9 / 9.3 | ✓ Covered | **P2-deferred** |
| FR-43 | Post-completion feedback | E9 / 9.2 | ✓ Covered | done |
| FR-44 | Negative-feedback deprioritization | E9 / 9.4 | ✓ Covered | **P2-deferred** (OQ-15) |
| FR-45 | Time barrier | E8 / 8.2 | ✓ Covered | done |
| FR-46 | Rate limiting | E8 / 8.2 | ✓ Covered | done |
| FR-47 | Immutable FraudLog | E8 / 8.3 | ⚠ Partial: the FraudLog write path is exercised by 5.5/8.2; the owning story 8.3 is deferred | P2-deferred |
| FR-48 | Frozen points anti-bot | E8 / 8.4, E6 / 6.5 | ✓ Covered via 6.5 | done (8.4 deferred) |
| FR-49 | Streak | E7 / 7.4 | ✓ Covered | **P2-deferred** |
| FR-50 | Leaderboard | E7 / 7.5 | ✓ Covered (AC conflicts with PRD: "top point-earners, top 100" vs completions/streak and OQ-1) | **P2-deferred** |
| FR-51 | Tier progression | E7 / 7.6 | ✓ Covered (AC hard-codes 24h, which contradicts OQ-3's 48h default) | **P2-deferred** |
| FR-52 | Admin user management | E1 / 1.4 | ✓ Covered | done |
| FR-53 | Survey moderation | E8 / 8.1 | ✓ Covered | done |
| FR-54 | Complaint resolution | E8 / 8.5 | ✓ Covered | **P2-deferred** |
| FR-55 | FraudLog monitoring | E8 / 8.3 | ✓ Covered | **P2-deferred** |
| FR-56 | Admin transaction dashboard | E9 / 9.5 (mis-traced) | ❌ Mis-traced: 9.5 is *user* transaction history (FR-31), and no admin system-wide story exists | P2-deferred |
| FR-57 | Event notifications | E9 / 9.6 | ⚠ Partial: in-app only; no email-channel AC | done |
| FR-58–FR-67 | Research Integrity Engine | E10 / 10.1–10.8 | ✓ Covered | **P2-deferred** (all) |

### Missing Requirements

#### Critical (impacts backend integration directly)

- **FR-39 Publisher Progress Tracking.** No story exists, yet the frontend already ships a survey monitoring dashboard (commit `0628d8e`). This screen is mock-only by construction.
  - Recommendation: add a Phase 1 story (Epic 9 or IR) for `GET /forms/:id/progress`, or hide the dashboard at IR.1.
- **FR-40 Response Data (Internal).** The only real AC is in Story 9.1 (deferred). The frontend now ships a full `/forms/:id/responses` experience (Summary / By question / Individual, commit `d1175eb`). This is gap-register API-14/API-15.
  - Recommendation: IR.1 must decide either to promote a thin "response viewing" story into Phase 1 or to hide the route.
- **FR-56 Admin Transaction Dashboard.** Mis-traced to a user-history story.
  - Recommendation: re-trace FR-56 to a new admin story (P2 is acceptable) and FR-31 history to 6.2/9.5.

#### High Priority

- **FR-33 Survey Reopen.** Listed in the map but has no AC; blocked by OQ-2. Mark it explicitly as gated.
- **FR-31 Wallet History and Integrity Hold.** History ownership is ambiguous (6.2 vs deferred 9.5). Integration needs a verified `GET /wallet/transactions` contract.
- **FR-38 Auto-hide on quota** and **FR-5 / FR-57 notifications.** Partial AC coverage means the backend may not emit the events the frontend expects.
- **FR-9 profile update, FR-10 audience estimate, FR-37 full sort/filter.** If the frontend exposes these controls, they are unbacked.
- **FR-23 admin side and FR-47 / FR-55.** FraudLog and missing-code resolution have no Phase 1 admin surface.

### Coverage Statistics

- Total PRD FRs: 67
- FRs with at least one story: 64 (95.5%). FR-33 and FR-39 have none; FR-56 is mis-traced.
- FRs fully covered by an AC: 48 (71.6%)
- FRs delivered in Phase 1 (story `done`): 38 (56.7%). 26 FRs are explicitly deferred to Phase 2 (Epics 3 and 10, plus 7.3–7.6, 8.3–8.5, 9.1, 9.3–9.5).
- Epic IR and Epic 11 add no FRs. They are integration and operations epics, all 12 stories are `backlog`, and **no IR story file has been created yet**.

## UX Alignment Assessment

### UX Document Status

- **The canonical BMAD UX artifacts are only stubs.** `DESIGN.md` and `EXPERIENCE.md` hold frontmatter and nothing else (`status: in-progress`).
- **The de facto UX contract** is Figma file `mkudD5Ngi5RPyIAVxCcxXi`, inventoried in `docs/frontend/figma-screen-inventory.md`, together with `design-system.md` and `screen-implementation-guide.md`. PRD amendments of 2026-09-26 also point to Figma canvas sections (e.g. onboarding section 12).
- `epics.md` still says "No UX document found for this project yet".

### Alignment Issues

1. **Figma and the UI implement screens that have no Phase 1 backend story.** When mocks are switched off, each of these becomes a 404 or an empty screen unless it is hidden:

   | Screen (Figma page) | Frontend status | Backend / PRD status |
   |---|---|---|
   | Leaderboard, streak, tier (16) | Done (`/leaderboard`, `/account/streak`, `/account/tier`) | 7.4–7.6 P2-deferred; OQ-1 and OQ-3 open |
   | Survey monitoring / progress (10) | Built (commit `0628d8e`) | FR-39 has no story |
   | Responses: Summary / By question / Individual (10) | Built (commit `d1175eb`) | FR-40/41 only in 9.1 (P2); API-14/15 are `assumed` |
   | Reopen survey (10) | Figma | FR-33 has no AC; OQ-2 blocks it |
   | Complaints (10, 11) | Figma | 8.5 P2-deferred |
   | Export file (10) | Figma | **PRD non-goal / OQ-6**; must not ship |
   | Integrity hold, reliability, admin quality review (17) | Mock scenario `integrity-hold` | Epic 10 P2; ENFORCED blocked by OQ-12/18 |
   | Forgot password (15) | Mock route `/auth/password/forgot` | No FR, no story (API-12) |
   | AI chat in Form Builder (13) | Figma | Epic 3 P2; entry point must be hidden (AD-3/4 amendment) |
   | Admin FraudLog, transactions (11) | Figma | 8.3 and 9.5 P2; FR-56 mis-traced |

2. **Mock fall-through contradicts IR.2.** `mock-strategy.md` states "Unhandled requests are bypassed to the network, so screens not yet migrated keep working." IR.2 and risk R01 require the opposite: an unhandled MSW request must not silently reach the backend.
3. **The layering doc is out of date on legacy mocks.** `docs/frontend/architecture.md` says "All other pages still read the legacy `mockRepository`", and the MSW auth handlers delegate session state to it. Any page still reading `lib/mock` keeps showing fake data even when `NEXT_PUBLIC_API_MOCKING` is off (API-07…API-11).
4. **Canonical origin conflict.** The PRD platform amendment says the frontend is `rescom.com.vn` (public surveys at `/f/<id>`). The integration plan and Epic IR say `app.rescom.com.vn`. OAuth callback registration and CSRF exact-origin configuration depend on one answer.

### Warnings

- ⚠️ **NFR-20 / OQ-20 gate.** The PRD blocks UI-heavy story acceptance until a canonical UX artifact defines responsive states, accessibility, localization and sensitive Integrity language. The UI was built against Figma, so this gate is formally open. Either promote the Figma inventory plus the frontend docs to canonical UX, or fill DESIGN.md/EXPERIENCE.md.
- ⚠️ **Architecture support for the UI.** Architecture covers the envelope (`{data,error,meta}`), cursor pagination, `Idempotency-Key`, cookie session and CSRF (AD-20). It has no read-model decision for publisher analytics or progress aggregation. If IR.1 promotes the responses/analytics screens, a query/projection design is needed so that NFR-1 (<500 ms) and NFR-30 (paginated) hold.

## Epic Quality Review

The review covers all epics. It concentrates on the backlog **Epic IR** and **Epic 11**, because they are the integration path, and on `done` stories whose ACs or implementation affect integration. Repository evidence was gathered on 2026-09-30 by read-only inspection of `apps/backend` and `apps/frontend/my-app`.

### Repository Reality Snapshot (evidence)

| Check | Result |
|---|---|
| Backend build | PASS |
| Backend unit tests | 110/110 suites, **1814/1814 pass** (e2e: 33 specs, not run) |
| Prisma migrations | **20 migrations** (`20260912085000_init_users` … `20260927060000_product_tour_progress`); `migrate status` reports up to date on local DB |
| Frontend tests | `node --test`: **664/664 pass**; `tsc --noEmit`: 0 errors; eslint clean |
| Shared contracts | `@rescom/schemas` imported by 117 backend and ~170 frontend files. The frontend is **not** an npm workspace member; it uses a tsconfig path plus `transpilePackages` |
| API transport | FE uses relative `/api` with `credentials: same-origin`, `X-CSRF-Token` from `GET /auth/csrf`, and envelope `{data,error,meta}`. BE matches: every controller is also mounted under `api/`, and CORS uses an exact allowlist |
| MSW handlers | 89 total. **≈30 have no backend route** (ASSUMED / MOCK-ONLY) |
| Mock switch | Global `NEXT_PUBLIC_API_MOCKING` only. **No per-domain hybrid toggle.** Unhandled requests **bypass to the network** |
| Direct mock consumers | Legacy `/forms/[id]/respond` (still linked from `lib/activation.ts`), `use-onboarding-guard`, `PortalShell`, `NotificationBell`, `SurveyFeedbackPrompt`, `ResetDemoModal`, `Sidebar` type import. No current `(signed-in)` screen imports mocks |
| Seed | **No seed script.** Respondent, publisher, 2 admins and smoke account do not exist |
| Background work | **No outbox dispatcher and no scheduler.** 48h pending release, starter-point expiry, matured release and reservation expiry run only via admin endpoints or lazily on access |
| Pagination | Three different shapes (`page/limit/total`, `limit/offset/hasMore`, `nextCursor`). The architecture mandates cursor pagination |
| OAuth callback | `GOOGLE_REDIRECT_URI` defaults to the backend host (`:4000/auth/google/callback`), not the same-host `/api/...` required by AD-20/IR |
| Local infra | Compose provides postgres:5433, **localstack** S3:4566 and clamav:3310. `.env.example` DB creds and `STORAGE_ENDPOINT` (MinIO :9000) do not match compose. Story 11.1 references MinIO |
| CAPTCHA | No real provider. Production rejects all tokens, so guest submissions are effectively disabled (consistent with OQ-19) |

### Backend-Missing Endpoints Called by the Frontend (contract gap register, as-is)

| Domain | Missing routes | Pilot relevance |
|---|---|---|
| Respondent runner | `GET /surveys/:id`, `GET /attempts/:id`, `GET /attempts/:id/outcome`, `POST /attempts/:id/cancel` | **Launch-critical** (API-01…04). The pinned-form read (API-05) is also unverified |
| Publisher results | `GET /forms/:id/{responses,analytics,progress,quality,versions/:versionId}`, `POST /forms/:id/{pause,resume}` (BE has `POST /forms/:id/status`), `POST /forms/audience-estimate` | Progress and responses are high-value; decide at IR.1 |
| Profile | `GET/PATCH /users/me/profile` | FR-9 "update anytime" |
| Engagement | `GET /engagement/me`, `/engagement/leaderboard` | P2-deferred: hide |
| Integrity | `GET/POST /integrity/consent`, `GET /integrity/reliability/me` | Consent sits in `/surveys/[id]/start`: decide |
| Disputes | `POST /forms/:id/attempts/:aid/disputes`, `GET /admin/disputes`, `POST /admin/disputes/:id/resolve` | P2-deferred: hide |
| Admin | `GET /admin/{overview,queue-counts,fraud-log,quality-reviews,ledger/journals,ledger/summary}`, `POST /admin/quality-reviews/:id/decision` | Overview is the admin landing page: decide |
| Auth | `POST /auth/password/forgot` (no reset page either) | Decide: hide or build |
| AI | `/forms/:id/ai/{conversation,messages,suggest-block}` | Epic 3 deferred: hide |

### 🔴 Critical Violations

1. **Hidden work: nobody owns the gap-closing implementation.** IR.3 and IR.4 begin "Given … contract gaps are resolved", but no story implements the missing endpoints (API-01…05 minimum, plus whatever IR.1 promotes). IR.1 only *classifies* gaps. This is a forward dependency on unwritten stories, and it is the largest risk in the integration epic.
   - **Remediation:** after IR.1, create explicit backend stories, e.g. "IR.2b Respondent read-model endpoints (`GET /surveys/:id`, attempt read/outcome/cancel, pinned form)", plus one story per promoted publisher/admin read.
2. **`done` Epic 6 stories do not meet their FRs' background-job consequences.**
   - FR-24 ("auto-transfer is handled by a background job"), FR-5 (30-day expiry), FR-32 (refund on deadline), NFR-12 and NFR-13 all require scheduled work.
   - The backend exposes these only as admin-triggered endpoints. There is no scheduler and no outbox dispatcher, yet Stories 6.4 and 6.5 are `done`, and Story 11.1 assumes the scheduled work already exists ("runs in-process behind one configuration flag").
   - **Remediation:** add a story, or explicitly expand 11.1, to *implement* the in-process scheduler and outbox dispatcher with PostgreSQL claiming (AD-10/AD-17). Re-open the affected ACs or record the deviation.
3. **Integration gate model depends on a mechanism that does not exist.** IR.2 requires per-domain hybrid mock controls and no silent fall-through of unhandled MSW requests. The current code has a single global toggle with bypass-to-network (and `mock-strategy.md` documents bypass as intended). Without this, R01 ("assumed endpoint 404s on main screens") is guaranteed.
   - **Remediation:** IR.2 must deliver per-domain toggles plus `onUnhandledRequest: error` (or a visible banner) before any domain cutover.
4. **IR.1 is epic-sized and not developer-completable.** It bundles G0 governance (named owners, due dates, AD-23 confirmation, eight scope decisions, secrets inventory) with the G1 mechanical inventory and coverage report. Much of it needs Product Owner decisions, not engineering.
   - **Remediation:** split it into IR.1a "G0 decision record" (PO-owned checklist) and IR.1b "Contract register + coverage report" (engineering). Most of IR.1b's raw data now exists in this report.

### 🟠 Major Issues

1. **Seed dependency.** IR.2 requires a deterministic seed (respondent, publisher, 2 admins, smoke), and IR.4 and 11.5 depend on two admins. No seed exists. It is in IR.2's AC, so it is covered, but it is on the critical path.
2. **Same-host OAuth callback is not configured.** The backend default redirect bypasses `/api`. Cookies set on `:4000` or `api.` hosts will not reach `app.` under AD-20 host-only cookies. IR.2 and IR.6 require it, but no AC names the env/config change.
3. **Trusted client IP conflicts with the architecture.** AD-23 fixes `TRUST_PROXY_HOPS=1` and `CF-Connecting-IP`. With Vercel's external `/api` rewrite in front of Cloudflare, `CF-Connecting-IP` will be Vercel's egress IP, so every user shares a few IPs for rate limiting (R07). Stories 11.1 and IR.6 mention "the approved multi-hop chain", but AD-23 was never amended.
   - **Remediation:** amend AD-23 with the real header chain (Vercel `x-forwarded-for` / `x-real-ip` → Cloudflare → Caddy) before 11.1.
4. **Canonical origin undecided.** The PRD says `rescom.com.vn`; IR and the integration plan say `app.rescom.com.vn`. This must be decided at IR.1 because OAuth client registration, CORS/CSRF allowlists and cookie scope all depend on it.
5. **Pagination contract drift.** The architecture mandates cursor pagination, but three shapes exist in the backend and `api-conventions.md` defines none. IR.1's register must record the shape per endpoint, or a normalization story is needed before new endpoints are added.
6. **Done-story ACs contradict the PRD.** These do not block integration today but will mislead integration tests:
   - 2.6: "directly to PUBLISHED for internal non-reward surveys" vs FR-20 (every survey is moderated).
   - 6.2: "spend or withdraw" (withdrawal is a non-goal).
   - 7.5: "top point-earners / top 100" vs FR-50 and OQ-1.
   - 7.6: hard-codes 24h vs OQ-3's 48h default.
   - 9.1: CSV export vs OQ-6 and the non-goals.
   - 10.7: "held Escrow rewards" vs Integrity Hold.
   - 5.4: cites FR-40 for answer validation.
7. **Undefined acceptance thresholds.** IR.6 ("one-replica performance meet the approved acceptance matrix") and 11.4 (RPO/RTO "proposed") depend on OQ-22 and Operations approval, and no story owns producing those numbers.
8. **Email channel has no owner.** FR-57 critical-event email and 11.5's production smoke "email … registration" need an email provider, which the Architecture lists as still open. No story provisions it.
9. **Local infrastructure drift.** Compose uses localstack while 11.1 and `.env.example` assume MinIO, and the `.env.example` DB credentials are wrong. New-developer onboarding for IR.2 will fail as documented.

### 🟡 Minor Concerns

- `epics.md` "UX Design Requirements" still says no UX document exists; it should reference the Figma inventory.
- The FR Coverage Map places FR-12 in E2 and FR-13 in E5, but the stories live in E4.
- Story file `7-2-secondary-deep-onboarding.md` does not match the epic title "Marketplace Survey Activation Step".
- `mock-strategy.md` is stale (service worker vs the actual fetch patch).
- Epic IR and Epic 11 are technical/operational epics. They are acceptable here as brownfield integration epics whose goals are phrased as end-to-end user journeys, but they deliver no standalone user value.

### Best-Practice Checklist (Epic IR / Epic 11)

| Check | IR | 11 |
|---|---|---|
| Delivers user value | ~ (journey-proven) | ✗ (operational) |
| Independent of later epics | ✓ | ✗ 11.5 needs IR.6 (declared, acceptable) |
| Stories sized appropriately | ✗ IR.1 too large | ✓ |
| No forward / hidden dependencies | ✗ gap-closing stories missing | ✗ scheduler assumed to exist |
| Clear, testable ACs | ✓ mostly; performance matrix undefined | ~ RPO/RTO undefined |
| Traceability | ✓ gates G0–G7 | ✓ AD-23 |
| Story files created | ✗ none | ✗ none |

## Summary and Recommendations

### Overall Readiness Status

**NEEDS WORK.** Epic IR can start now: IR.1 and the auth/demographics slice of IR.2 are ready. The project is **not ready to switch the mocks off** for the respondent or publisher journeys.

Readiness by domain (mock off today):

| Domain | Ready? | Why |
|---|---|---|
| Auth (email), session, CSRF, logout | ✅ Ready | All routes exist; FE/BE envelope, CSRF and cookie flow match |
| Google OAuth | ⚠ Config needed | Callback is on the backend host, not same-host `/api` |
| Demographics / onboarding | ✅ Ready (guard still reads legacy mock) | Routes exist; `use-onboarding-guard` must be migrated |
| Marketplace feed, starter status | ✅ Mostly | Routes exist; FE expects ASSUMED extra fields (e.g. `topic`) |
| Respondent runner (start → answer → submit → outcome) | ❌ Blocked | Missing `GET /surveys/:id`, `GET /attempts/:id`, `/outcome`, `/cancel` |
| Wallet, top-up, admin top-up | ✅ Mostly | Routes exist; FE expects ASSUMED display fields |
| Notifications, feedback, product tours | ✅ Ready | Routes exist |
| Form builder / publish / manage | ✅ Mostly | Pause/resume must map to `POST /forms/:id/status` |
| Moderation, admin users | ✅ Mostly | Admin overview and queue counts are missing |
| Publisher progress / responses / analytics | ❌ Mock-only | No backend and no Phase 1 story (FR-39/40/41) |
| Leaderboard, streak, tier, trust, disputes, fraud log, quality, AI chat, forgot-password | ❌ Mock-only | Deferred or unscoped; must be hidden |
| Pending release / starter expiry / refund jobs | ❌ Not scheduled | Admin-triggered only; no scheduler or outbox dispatcher |

### Critical Issues Requiring Immediate Action

1. **No stories own the missing endpoints.** About 30 frontend calls have no backend route, including 4 launch-critical respondent-runner routes. IR.3 and IR.4 assume the gaps are "resolved", but no story resolves them.
2. **No scheduler or outbox dispatcher**, although Stories 6.4 and 6.5 are `done`. The 48h pending → Available transfer, 30-day starter expiry, deadline refund and reservation expiry do not run by themselves (FR-5, FR-24, FR-32, NFR-12, NFR-13).
3. **The mock switch is all-or-nothing and falls through silently.** There is no per-domain hybrid toggle, and unhandled requests reach the real backend. The IR.2 foundation must be built before any cutover.
4. **Mock-only screens with no scope decision.** Publisher progress/responses/analytics (FR-39/40 have no Phase 1 story), leaderboard/streak/tier/trust, disputes, admin fraud-log/quality/transactions/overview, forgot-password, AI chat and export are all reachable. Each must be promoted with a story or hidden before a pilot build.
5. **Unresolved topology decisions** that block auth on staging: canonical origin (`rescom.com.vn` vs `app.rescom.com.vn`), the same-host OAuth callback, and the trusted client-IP chain behind Vercel's rewrite (AD-23 still says `CF-Connecting-IP`, 1 hop).

### Recommended Next Steps

1. **Hold the G0/IR.1 session this week.** Decide the canonical origin, and give an in-scope or hidden decision for every mock-only route in the table above. The frontend and backend inventories in this report can serve directly as the IR.1 contract register draft.
2. **Create the missing stories** before starting IR.3 and IR.4:
   - (a) Respondent read-model endpoints: `GET /surveys/:id`, attempt read/outcome/cancel, pinned form read.
   - (b) In-process scheduler plus outbox dispatcher with PostgreSQL claiming (or fold it explicitly into 11.1 and re-open 6.4/6.5).
   - (c) One thin story per promoted publisher/admin read. Progress (FR-39) and responses (FR-40) are the likely candidates.
   - (d) An email provider story.
3. **Run IR.2 first on the auth and demographics slice.** Build the per-domain mock toggle with `onUnhandledRequest` set to error plus a banner, a deterministic seed (respondent, publisher, 2 admins, smoke), same-host `/api` OAuth callback config, and fix `.env.example` / compose drift (localstack vs MinIO, DB credentials).
4. **Amend Architecture AD-23** for the Vercel → Cloudflare → Caddy client-IP header chain, and fix the PRD origin, before Story 11.1.
5. **Clean up traceability.** Re-trace FR-56 and FR-12/13, mark FR-33 as gated by OQ-2, correct the contradictory done-story ACs (2.6, 6.2, 7.5, 7.6, 9.1, 10.7), and point `epics.md` UX requirements at the Figma inventory.
6. **Choose a pagination convention** (the architecture says cursor) and record the shape per endpoint in the IR.1 register before adding new list endpoints.

### Final Note

This assessment identified **32 issues across 3 categories**: FR coverage (8), UX alignment (6) and epic/story quality plus repository reality (18, of which 4 are critical). The foundations are strong: the backend builds, 1814/1814 backend and 664/664 frontend tests pass, 20 migrations are applied, and the FE/BE transport contract (envelope, CSRF, cookies, `/api`) already matches. The gap is the *contract surface* and the *background jobs*, not the architecture. Address the critical issues before IR.3 and IR.4. IR.1 and IR.2 can begin immediately.

---
**Assessed:** 2026-09-30 · **Assessor:** Claude (BMAD Implementation Readiness, PM role) · **Evidence:** read-only repository inspection plus the planning artifacts listed in frontmatter
