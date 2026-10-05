---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
inputDocuments:
  prd:
    - _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md
    - _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/addendum.md
  architecture:
    - _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md
    - _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md
  epics:
    - _bmad-output/planning-artifacts/epics.md
  ux:
    - _bmad-output/planning-artifacts/ux-designs/ux-project-rescom-2026-09-14/DESIGN.md
    - _bmad-output/planning-artifacts/ux-designs/ux-project-rescom-2026-09-14/EXPERIENCE.md
excludedDocuments:
  - _bmad-output/planning-artifacts/architecture/RESCOM-Architecture-V2.archive.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-29
**Project:** project-rescom

## Document Inventory

### PRD Documents

- `prds/prd-project-rescom-2026-08-08/prd.md` — primary PRD
- `prds/prd-project-rescom-2026-08-08/addendum.md` — PRD addendum

### Architecture Documents

- `architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` — architecture spine
- `architecture/architecture-project-rescom-2026-08-08/solution-design.md` — detailed solution design

The explicitly archived `architecture/RESCOM-Architecture-V2.archive.md` is excluded.

### Epics and Stories Documents

- `epics.md` — primary epic and story specification

### UX Documents

- `ux-designs/ux-project-rescom-2026-09-14/DESIGN.md`
- `ux-designs/ux-project-rescom-2026-09-14/EXPERIENCE.md`

### Discovery Notes

- The grouped PRD, Architecture, and UX directories do not contain `index.md` manifests.
- Reconciliation notes, review reports, health reports, and `.memlog.md` files are supporting artifacts and are not primary assessment inputs.

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
