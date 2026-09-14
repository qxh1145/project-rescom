---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
status: final
overallReadiness: NOT READY
assessor: Codex with independent OMC code-reviewer verification
includedFiles:
  prd:
    - prds/prd-project-rescom-2026-08-08/prd.md
    - prds/prd-project-rescom-2026-08-08/addendum.md
    - prds/prd-project-rescom-2026-08-08/reconcile-architecture.md
    - prds/prd-project-rescom-2026-08-08/reconcile-implementation-readiness-2026-08-16.md
    - prds/prd-project-rescom-2026-08-08/reconcile-overview.md
    - prds/prd-project-rescom-2026-08-08/reconcile-sprint-change-proposal.md
    - prds/prd-project-rescom-2026-08-08/reconcile-srs.md
  architecture:
    - architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md
    - architecture/architecture-project-rescom-2026-08-08/solution-design.md
    - architecture/architecture-project-rescom-2026-08-08/reconcile-integrity-prd.md
  epics:
    - epics.md
  ux: []
excludedFiles:
  - architecture/RESCOM-Architecture-V2.archive.md
  - "**/.memlog.md"
  - "**/review-*.md"
  - "**/*health-report*.md"
---

# Implementation Readiness Assessment Report

**Date:** 2026-09-14
**Project:** project-rescom

## Document Discovery

### PRD Documents

**Primary document:**

- `prds/prd-project-rescom-2026-08-08/prd.md` (80,222 bytes; modified 2026-09-12 08:24:18)

**Supporting documents:**

- `addendum.md`
- `reconcile-architecture.md`
- `reconcile-implementation-readiness-2026-08-16.md`
- `reconcile-overview.md`
- `reconcile-sprint-change-proposal.md`
- `reconcile-srs.md`

The collection has no `index.md`; `prd.md` is the confirmed primary document.

### Architecture Documents

**Primary documents:**

- `ARCHITECTURE-SPINE.md` (44,411 bytes; modified 2026-09-12 08:24:18)
- `solution-design.md` (30,387 bytes; modified 2026-09-12 08:24:18)
- `reconcile-integrity-prd.md` (11,455 bytes; modified 2026-09-12 08:24:18)

The collection has no `index.md`. The archived `RESCOM-Architecture-V2.archive.md` is excluded.

### Epics and Stories Documents

- `epics.md` (59,736 bytes; modified 2026-09-12 08:24:18)

### UX Design Documents

No UX design document was found.

### Discovery Issues

- UX documentation is missing and will reduce assessment completeness.
- PRD and architecture collections do not contain sharded-document `index.md` files.
- The configured key documents `srs_rescom.md` and `rescom.md` were not found at the project root.

## PRD Analysis

### Functional Requirements

FR-1: **Email/Password Registration** — Users can register with email and password. The system validates email uniqueness and password strength.

FR-2: **Google OAuth Login** — Users can sign up and log in through Google OAuth 2.0.

FR-3: **Single-Session Enforcement** — Each account can be logged in on only one device at a time; a new login invalidates the previous session.

FR-4: **Frozen Starter Points** — The system automatically grants 100 Frozen Points upon registration.

FR-5: **Starter Points Expiry** — If the account does not complete onboarding within 30 days of registration, the 100 Frozen Points are forfeited.

FR-6: **Mandatory Demographic Survey** — New users must first complete a system onboarding survey collecting age range, gender, region/province, occupation, academic major, income bracket, and interests from 17 or more categories.

FR-7: **Second Onboarding Survey** — After the demographic survey, the user must complete one Marketplace survey to become fully active.

FR-8: **Point Unlock on Activation** — Completing both onboarding surveys transfers the 100 Frozen Points to Available Balance.

FR-9: **Demographic Profile** — Each user has a profile containing major, academic year, age, gender, region, occupation, income bracket, and interests.

FR-10: **Publisher Targeting Criteria** — Publishers set gender, age range, major, university, and region criteria; interests and income remain excluded until Open Question 13 is approved.

FR-11: **Automated Matching** — The system matches targeting criteria against Respondent profiles and shows only qualifying surveys.

FR-12: **External Survey Creation** — A three-step flow captures the Google Forms link and estimated time, targeting criteria, and sample size plus reward per completion.

FR-13: **Server-Generated Completion Code** — The system generates one unique six-digit code per published External Form Version. The Publisher embeds the static version-scoped code; rotation creates a new Form Version.

FR-14: **Point Reward Pricing Table** — The system enforces rewards of 5–10 Points below five minutes, 10–20 Points for five to ten minutes, 15–25 Points for ten to fifteen minutes, and 20–40 Points above fifteen minutes. Publishers cannot set rewards below the minimum.

FR-15: **Escrow Lock on Publish** — The system calculates sample size multiplied by reward per response and locks that total from the Publisher's Available Balance.

FR-16: **Drag-and-Drop Form Builder** — Publishers can build forms with text, textarea, number, single-choice, multiple-choice, rating, linear-scale, date, and file-upload components using a palette, canvas, and properties panel.

FR-17: **AI Form Generator** — Publishers can describe survey intent in natural language and receive an editable draft Form Definition; this optional capability must not block the Form Builder.

FR-18: **Form Versioning** — Each Form owns ordered versions. Published versions are immutable; edits create a new draft version.

FR-19: **Internal Form Pricing Discount** — Internal Forms cost 20% fewer Points per response than External Forms of the same estimated duration.

FR-20: **Moderation Queue** — Every published survey enters Admin moderation and remains absent from the Marketplace until approval.

FR-21: **Survey Attempt Start** — Starting an External survey records server-side `startTime`, opens the hosted form, and displays a countdown and code-entry modal in RESCOM.

FR-22: **Completion Code Verification** — The backend verifies that the submitted code matches the exact External Form Version pinned by the active Attempt and that server-measured elapsed time meets the estimated duration.

FR-23: **Missing Code Report** — Respondents can report an External Form whose Publisher omitted the Completion Code.

FR-24: **48-Hour Pending Period** — External Form rewards enter Pending Balance and automatically transfer to Available after 48 hours without a complaint.

FR-25: **One Completion Per Account** — An authenticated account can complete a logical Form only once across all versions and reopen cycles.

FR-26: **In-Platform Survey Experience** — Internal Forms render inside RESCOM from the published Form Version's Form Definition JSON.

FR-27: **Demographic Cross-Check** — The system checks disclosed demographic answers against the Respondent profile for consistency.

FR-28: **Bot Detection** — The system rejects completion times that are impossibly short relative to question count and type.

FR-29: **Internal Reward Credit and ENFORCED Hold** — Authenticated Internal submissions use the policy mode pinned at submission. `SHADOW` and `ADVISORY` credit Available within one to two minutes without waiting for scoring; `ENFORCED` first credits a non-spendable Integrity Hold before any Decision.

FR-30: **Immutable Double-Entry Ledger** — Every Point movement is append-only with debit and credit sides; entries cannot be edited or deleted.

FR-31: **Wallet Dashboard** — The wallet displays Available, Pending, Frozen, Integrity Hold, and the complete transaction history.

FR-32: **Escrow Refund on Survey Close** — When a survey expires or closes with unused slots, remaining Escrow automatically returns to the Publisher's Available Balance.

FR-33: **Survey Reopen with Additional Tokens** — Publishers can reopen closed surveys by funding additional sample quota while preserving prior responses.

FR-34: **Manual Top-Up Request** — A user may purchase at least 100 Points for 20,000 VND through bank transfer and submit an Admin-reviewed request.

FR-35: **Admin Top-Up Approval** — Admin verifies the bank transfer and approves or rejects the request; approval credits Available Balance.

FR-36: **Personalized Feed** — The Marketplace displays only active, approved surveys matching the user's profile.

FR-37: **Sort and Filter Options** — The feed supports best match, shortest duration, highest reward, nearest deadline, same university/major, newest, and combinable advanced filters.

FR-38: **Auto-Hide on Quota Completion** — A survey reaching its sample quota is automatically hidden from the Marketplace.

FR-39: **Progress Tracking** — Publisher dashboards show completion versus target, Points spent, Escrow remaining, deadline, and survey status.

FR-40: **Internal Response Data** — Publishers can view individual Internal Form responses and safe integrity metadata in the dashboard.

FR-41: **Traffic Analytics** — Dashboards show temporal views/clicks, average completion time, drop-off, and applicable Form-Version integrity distributions and quality findings.

FR-42: **Feedback Summary** — Dashboards aggregate question clarity, survey length, technical issues, overall experience, and comments.

FR-43: **Post-Completion Feedback** — Respondents may rate clarity, length accuracy, description accuracy, technical issues, and overall experience and may leave a comment.

FR-44: **Negative Feedback Deprioritization** — Surveys crossing an approved negative-feedback threshold receive lower feed visibility; automation remains disabled until Open Question 15 is approved.

FR-45: **Time Barrier** — The server measures elapsed time from server-recorded start to submission and rejects attempts below the minimum.

FR-46: **Rate Limiting** — The system limits survey completions within a time window to prevent bot behavior.

FR-47: **Immutable FraudLog** — Rejected hard anti-abuse attempts, security-policy violations, and confirmed abuse evidence are stored in an append-only FraudLog, separate from soft integrity evidence.

FR-48: **Frozen Points Anti-Bot** — Starter Points remain unusable until both onboarding surveys are complete.

FR-49: **Streak Counter** — The system tracks consecutive calendar days with at least one completed survey and resets after a missed day.

FR-50: **Leaderboard** — Authenticated users can see rankings for most surveys completed, all-time and weekly, and longest active streak.

FR-51: **Tier Progression** — Users progress from New User to Verified Member at two onboarding surveys, Active Contributor at at least 20 surveys, Trusted Researcher at at least 100, and Community Ambassador at at least 300. Tier benefits remain independent of research reliability and subject to Open Questions 3 and 4.

FR-52: **User Management** — Admin can view, search, filter, ban, unban, and edit user accounts.

FR-53: **Survey Moderation** — Admin can approve or reject surveys in the moderation queue with a reason.

FR-54: **Complaint Resolution** — Admin reviews complaints and evidence, upholds or dismisses them, applies the associated Point resolution, and notifies both parties.

FR-55: **FraudLog Monitoring** — Admin can view, search, and filter FraudLog and manually act on repeat offenders.

FR-56: **Transaction Dashboard** — Admin can inspect aggregate and detailed top-up, Escrow, refund, and other Point transactions.

FR-57: **Event Notifications** — The system sends in-app and appropriate email notifications for account, survey, reward, Integrity Hold, complaint, quota, account-ban, and top-up events.

FR-58: **Consent-Aware Behavioral Telemetry** — Internal Forms capture only disclosed interaction events needed for integrity assessment.

FR-59: **Response Integrity Assessment** — Every submitted Internal Form response receives a versioned integrity assessment or an explicit recoverable pending state.

FR-60: **Cold-Start Handling** — New Respondents are evaluated without treating missing history as risk.

FR-61: **Respondent Reliability** — The system maintains longitudinal reliability snapshots for authenticated Respondents using eligible Internal Form evidence.

FR-62: **Survey Quality Assessment** — Each Internal Form Version receives an independent quality assessment once sufficient eligible evidence exists.

FR-63: **Explainability and Reproducibility** — Every integrity assessment must be explainable and reproducible from preserved signals and an immutable policy version.

FR-64: **Integrity Decision Modes** — Integrity policies progress through controlled `SHADOW`, `ADVISORY`, and `ENFORCED` modes.

FR-65: **Integrity Review and Feedback Labels** — Authorized reviewers can resolve integrity-review cases with documented outcomes and idempotent reward settlement.

FR-66: **TrustGraph-Ready Relationships** — The system maintains versioned integrity-relevant relationships in the approved platform data store.

FR-67: **Assessment Applicability** — The system records whether each integrity dimension is applicable, not assessed, unavailable, pending, or supported by insufficient evidence without converting non-scores to zero.

**Total Functional Requirements: 67**

### Non-Functional Requirements

NFR-1: API responses target less than 500 ms under a named normal-load profile; percentile, workload, exclusions, and measurement window require Open Question 22 approval.

NFR-2: The Survey Feed loads in under two seconds with at most 50 surveys.

NFR-3: Point transactions use ACID transactions and row-level locking.

NFR-4: PostgreSQL is authoritative for Time Barrier and durable security state. A single-replica/no-Redis profile uses durable PostgreSQL counters and conservative local limits; a shared-Redis profile uses Redis counters and fails closed on high-risk mutations when configured Redis is unavailable.

NFR-5: AI Form Generation uses a separate timeout and is not governed by the 500 ms API target.

NFR-6: Short-lived signed access JWTs are stored in Secure HTTP-Only cookies and bound to PostgreSQL-authoritative revocable sessions; refresh secrets rotate and single-session invalidation is server-enforced.

NFR-7: CORS, Helmet, and `@nestjs/throttler` protect all API endpoints.

NFR-8: `startTime`, Completion Code generation, and Point calculations remain server-authoritative.

NFR-9: Every Point transaction uses ACID consistency.

NFR-10: FraudLog is append-only with no update or delete operations.

NFR-11: Ledger integrity prevents Point duplication or loss.

NFR-12: An Auto-Refund background job runs on schedule for expired surveys.

NFR-13: A background job transfers External rewards from Pending to Available at the 48-hour expiry.

NFR-14: Uptime targets at least 99% during a named peak-academic profile; scope, exclusions, and measurement window require Open Question 22 approval.

NFR-15: AI failure cannot affect login, surveys, Points, or Marketplace operation.

NFR-16: The monorepo keeps Frontend and Backend separated.

NFR-17: Prisma manages the database schema.

NFR-18: Zod validation is shared by Frontend and Backend.

NFR-19: Form Definition JSON is defined in a shared package.

NFR-20: UI-heavy story acceptance is gated on a canonical UX artifact covering responsive states, accessibility, localization/content rules, and sensitive Integrity language; Open Question 20 owns the unresolved measurable target.

NFR-21: Survey creation follows a clear three-step flow.

NFR-22: CSAT targets greater than 4.0 out of 5.0.

NFR-23: Integrity telemetry ingestion is idempotent using client event IDs and server-enforced uniqueness.

NFR-24: Submitted responses remain durable when scoring is unavailable, with a recoverable pending assessment.

NFR-25: Scoring retries cannot duplicate assessments, reviews, notifications, Integrity Holds, releases, reversals, or Ledger actions.

NFR-26: Historical assessments are reproducible from preserved signals and immutable policy versions.

NFR-27: Initial deterministic assessment completes within one to two minutes under the named normal-load profile; workload, percentile, and measurement window require Open Question 22 approval.

NFR-28: Raw telemetry, sensitive integrity evidence, and review actions are access-controlled and access-audited.

NFR-29: Integrity Engine failure cannot affect authentication, Form rendering, response durability, or External Form flows.

NFR-30: Assessment, review, and reliability queries are paginated and do not load raw event streams into dashboards.

**Total Non-Functional Requirements: 30**

### Additional Requirements

The PRD declares 22 unresolved, owner-bound gates rather than silently treating assumptions as implementation defaults:

1. Leaderboard scope, time windows, and displayed ranking count.
2. Survey-reopen pricing behavior.
3. Whether Trusted Researcher changes the External 48-hour Pending period.
4. Community Ambassador privileges beyond a badge.
5. AI generation timeout and recovery behavior.
6. Internal response-data export scope, format, fields, and access policy.
7. Integrity-policy promotion authority and calibration evidence.
8. Minimum eligible evidence for Publisher-visible Survey Quality.
9. Integrity review, appeal ownership, and turnaround expectations.
10. Retention periods for integrity events, signals, assessments, reviews, and snapshots.
11. Exportable Publisher integrity fields and non-applicability representation.
12. Maximum `ENFORCED` no-decision interval before fail-open release and incident creation.
13. Whether interests or income may be used for Publisher targeting.
14. Completion Code failure limits, lock duration, recovery, and audit behavior.
15. Negative-feedback threshold, window, and appeal/recovery behavior.
16. Rate-limit values, scopes, controls, and dependency-outage behavior.
17. Consent, notice, withdrawal, data classification, retention, access auditing, and subject-rights flows.
18. `ENFORCED` review, rejection, appeal, quota, and compensating-settlement rules.
19. Guest identity, repeat-completion, abuse, consent, reward, subject-rights, and quality-evidence rules.
20. WCAG target, responsive states, keyboard/screen-reader behavior, focus/error association, contrast, reduced motion, localization, and Integrity language.
21. Source validation for the product-vision market figures.
22. Operational SLO workloads, percentiles, windows, freshness, moderation baseline, normal load, and peak-academic-period definitions.

Additional binding constraints and integrations include:

- The canonical authority order is SPEC, final PRD plus addendum, Architecture Spine, solution design, epics, and repository reality.
- Full Research Integrity applies only to Internal Forms; External Forms are `NOT_ASSESSED` by that engine.
- Guest Internal participation, production telemetry, `ENFORCED` mode, export features, and several automated policies stay disabled until their explicit gates close.
- Missing evidence never becomes a low or zero integrity score.
- Points are internal, non-transferable, non-cashable units; production launch requires qualified Vietnamese privacy/legal review.
- Prohibited telemetry includes raw keystrokes, clipboard contents, unrelated browsing, and background device activity.
- PostgreSQL, S3-compatible storage, Vercel, a NestJS VPS deployment, Cloudflare, and a Tailscale-accessed Ollama/Qwen host are named platform integrations.
- AI remains an optional dependency with no authority to block core product paths.
- The addendum requires idempotent Outbox-driven reward and assessment work, pure versioned scoring, immutable history, fenced reward settlement, restricted evidence, and a relational TrustGraph projection before any graph-database adoption.

### PRD Completeness Assessment

The PRD is unusually well structured for traceability: it contains 67 globally numbered FRs, 30 numbered NFRs, explicit testable consequences, an authority chain, scope boundaries, and owner-bound decision gates. The final PRD and addendum also reconcile the previously identified `ENFORCED` reward-hold timing conflict.

It is not fully implementation-ready on its own. Twenty-two decisions remain open by design. The most immediate cross-cutting gaps are the absent canonical UX artifact required by NFR-20/Open Question 20 and the undefined operational test profiles required by Open Question 22. Privacy/legal, telemetry, and integrity-governance gates also prevent production activation of affected capabilities even when structural implementation can proceed.

## Epic Coverage Validation

### Coverage Matrix

| FR | PRD Requirement | Epic / Story Coverage | Status |
|---|---|---|---|
| FR-1 | Email/password registration | Story 1.1 omits an explicit password-strength contract and complete duplicate-registration response behavior | **Partial** |
| FR-2 | Google OAuth login | Epic 1 / Story 1.2 | Covered |
| FR-3 | Single-session enforcement | Story 1.3 covers atomic revocation and 401 behavior but omits the required expired-session user notification | **Partial** |
| FR-4 | Frozen starter Points | Stories 6.5 and 8.4 cover grant/non-spendability but not the complete initial Wallet presentation | **Partial** |
| FR-5 | Starter Points expiry | Story 6.5 covers 30-day expiry but omits expiry notification | **Partial** |
| FR-6 | Mandatory demographic survey | Epic 7 / Story 7.1 omits the required demographic field set and validation contract | **Partial** |
| FR-7 | Second onboarding survey | Stories 7.1–7.2 cover the second completion but omit the explicit Verified Member state transition | **Partial** |
| FR-8 | Point unlock on activation | Epics 6–7 / Stories 6.5 and 7.2 | Covered |
| FR-9 | Demographic profile | Epic 7 / Story 7.1 saves a profile but omits its complete field and update behavior | **Partial** |
| FR-10 | Publisher targeting criteria | Epic 4 / Story 4.1 provides example criteria but not the complete allowed/excluded contract | **Partial** |
| FR-11 | Automated matching | Story 4.2 covers matching but omits the Publisher audience-size/criteria-relaxation path | **Partial** |
| FR-12 | External survey three-step creation | Claimed by Epic 2; Story 4.5 covers only link and Completion Code setup | **Partial** |
| FR-13 | Server-generated Completion Code | Epics 4–5 / Stories 4.5 and 5.5 | Covered |
| FR-14 | Reward pricing table | Epic 6 / Story 6.3 references pricing but omits every duration band and min/max rule | **Partial** |
| FR-15 | Escrow lock on publish | Epic 6 / Story 6.3 covers atomic Escrow posting but not insufficient-balance blocking and messaging | **Partial** |
| FR-16 | Drag-and-drop Form Builder | Epic 2 / Stories 2.3–2.5 cover core editing but omit sections and several Integrity-builder requirements | **Partial** |
| FR-17 | AI Form Generator | Stories 3.1–3.4 cover generation/validation/fallback but omit confirmation of AI-suggested Integrity metadata and violate the timeout gate | **Partial** |
| FR-18 | Form Versioning | Stories 2.6–2.7 cover immutability and exact-version linkage but omit archived-version viewing | **Partial** |
| FR-19 | Internal Form pricing discount | Story 6.3 applies the discount but omits the required Publisher-facing comparison | **Partial** |
| FR-20 | Moderation queue | Story 8.1 covers queue/approve/reject/refund but omits Publisher notification | **Partial** |
| FR-21 | Survey Attempt start | Epic 5 / Story 5.1 covers authoritative Attempt start but omits the External new-tab/countdown/code-modal experience | **Partial** |
| FR-22 | Completion Code verification | Story 5.5 covers version/time checks but omits the required wrong-code FraudLog behavior and hardcodes an unapproved attempt limit | **Partial** |
| FR-23 | Missing Code report | Story 5.5 exposes the report path but omits Admin receipt and resolution behavior | **Partial** |
| FR-24 | External 48-hour Pending period | Stories 5.5, 6.4, and 8.5 cover Pending/release/dispute but omit the required balance countdown presentation | **Partial** |
| FR-25 | One completion per account | Story 5.1 covers logical-Form enforcement but omits the completed-card state | **Partial** |
| FR-26 | In-platform survey experience | Story 5.2 covers renderer execution but omits progress and section-navigation behavior | **Partial** |
| FR-27 | Demographic cross-check | Story 7.3 covers contradiction signals and no reject/FraudLog behavior but does not prohibit long-term Reliability impact or limit checks to disclosed demographic fields | **Partial** |
| FR-28 | Bot detection | Stories 8.2–8.3 cover rejection/logging but substitute an unapproved hardcoded timing formula and omit the complete timing evidence contract | **Partial** |
| FR-29 | Internal reward and `ENFORCED` hold | Stories 5.4 and 6.4 cover settlement modes but omit the required one-to-two-minute and Respondent state/notification contract | **Partial** |
| FR-30 | Immutable double-entry Ledger | Epic 6 / Story 6.1 | Covered |
| FR-31 | Wallet dashboard | Stories 6.2 and 9.5 omit Integrity Hold presentation and complete hold/review transaction semantics | **Partial** |
| FR-32 | Escrow refund on close | Story 6.3 covers manual close refund but not deadline expiry or scheduled Auto-Refund | **Partial** |
| FR-33 | Survey reopen with added tokens | No story defines reopen, added quota payment, Marketplace return, or response preservation | **Missing** |
| FR-34 | Manual top-up request | Story 6.6 covers a transfer request but omits minimum amount and one-way restrictions | **Partial** |
| FR-35 | Admin top-up approval | Story 6.6 covers approval but omits rejection behavior and user notification | **Partial** |
| FR-36 | Personalized feed | Stories 4.2–4.3 cover published/matched/user-completed filtering but omit the required card fields and approval-update behavior | **Partial** |
| FR-37 | Complete sort and filter options | Epic 4 / Story 4.3 implements only reward and estimated-time sorting | **Partial** |
| FR-38 | Auto-hide when quota completes | No story implements quota-complete hiding; Story 4.3 covers only per-user completed-survey hiding | **Missing** |
| FR-39 | Publisher progress tracking | No epic-map entry or story implementing completion target, spend, Escrow, deadline, and status together | **Missing** |
| FR-40 | Internal response data | No story provides in-app individual-response viewing; Story 9.1 substitutes unauthorized CSV export and aggregates | **Missing** |
| FR-41 | Traffic analytics | Story 9.1 omits hour/day/month patterns and drop-off analytics | **Partial** |
| FR-42 | Feedback summary | Story 9.3 provides rating/comments but omits the required multidimensional summary | **Partial** |
| FR-43 | Post-completion feedback | Story 9.2 provides one star rating/comment rather than the required feedback dimensions | **Partial** |
| FR-44 | Negative-feedback deprioritization | Story 9.4 covers ranking reduction but hardcodes an unapproved threshold and omits Publisher notification and policy-version audit | **Partial** |
| FR-45 | Time Barrier | Stories 5.1, 5.5, 8.2, and 8.3 cover authority/rejection/logging but use an unapproved threshold formula | **Partial** |
| FR-46 | Rate limiting | Story 8.2 covers configured limiting but omits centrally versioned policy, temporary-block semantics, and dependency-outage behavior | **Partial** |
| FR-47 | Immutable FraudLog | Story 8.3 separates hard violations from Integrity evidence but does not require append-only persistence or the full record contract | **Partial** |
| FR-48 | Frozen Points anti-bot | Epic 8 / Story 8.4 | Covered |
| FR-49 | Streak counter | Story 7.4 covers increment/reset but omits profile/Marketplace presentation and the calendar-timezone contract | **Partial** |
| FR-50 | Leaderboard | Story 7.5 ranks point earners/top 100 instead of completion and active-streak rankings | **Partial** |
| FR-51 | Tier progression | Story 7.6 implements only Trusted Researcher and hardcodes an unapproved benefit | **Partial** |
| FR-52 | User management | Story 1.4 covers listing/privilege/status changes but omits search/filter/edit and has authorization terminology drift | **Partial** |
| FR-53 | Survey moderation | Story 8.1 covers preview/approve/reject/refund but omits rejection reasons and the unresolved operating profile | **Partial** |
| FR-54 | Complaint resolution | Story 8.5 covers External dispute resolution but omits evidence/notification details and precise settlement destinations | **Partial** |
| FR-55 | FraudLog monitoring | Story 8.3 provides a dashboard but omits search/filter and repeat-offender manual-action behavior | **Partial** |
| FR-56 | Admin-wide transaction dashboard | No story implements the Admin-wide dashboard; Story 9.5 provides only a user's own Wallet history | **Missing** |
| FR-57 | Event notifications | Story 9.6 covers generic in-app notifications but omits most enumerated events and critical email delivery | **Partial** |
| FR-58 | Consent-aware telemetry | Stories 10.1–10.2 cover event allowlisting and notice recording but omit consent withdrawal and complete applicability behavior | **Partial** |
| FR-59 | Response Integrity assessment | Stories 10.3–10.4 cover assessment fields but do not fully guarantee assessment-or-recoverable-pending for every submitted Internal response | **Partial** |
| FR-60 | Cold-start handling | Story 10.5 covers neutral cold start but omits separate Reliability/confidence presentation and explicit no-blocking solely for missing history | **Partial** |
| FR-61 | Respondent Reliability | Story 10.5 covers snapshots/cold start but omits the full eligible-history and non-fraud classification safeguards | **Partial** |
| FR-62 | Survey Quality assessment | Story 10.6 covers core aggregation but omits insufficient-evidence behavior and is blocked by the evidence-threshold gate | **Partial** |
| FR-63 | Explainability and reproducibility | Stories 10.3–10.4 cover immutable policy/lineage/revisions but omit complete authorized plain-language explanation behavior | **Partial** |
| FR-64 | Integrity Decision modes | Stories 5.4, 6.4, and 10.4 cover modes and reward paths but omit new-policy `SHADOW` default and complete enforcement prohibitions | **Partial** |
| FR-65 | Integrity review and labels | Story 10.7 omits complete insufficient/rejected/appeal settlement and incorrectly refers to releasing Escrow rather than Integrity Hold | **Partial** |
| FR-66 | TrustGraph-ready relationships | Story 10.8 is correctly trigger-gated and covers relational projection/protection, but omits complete evidence-source and policy-version traceability | **Partial** |
| FR-67 | Assessment applicability | Stories 10.4–10.5 cover External and Guest states but not the complete non-score/insufficient-evidence contract | **Partial** |

### Missing and Partial Requirements

#### Missing Requirements

**FR-33: Survey Reopen with Additional Tokens**

- Requirement: A Publisher can reopen a completed or closed survey by paying additional tokens for a larger sample quota while preserving previous responses.
- Impact: No story defines the reopen command, incremental Escrow, Marketplace return, or preserved-history behavior.
- Recommendation: Add a gated reopen story after Open Question 2 is resolved.

**FR-38: Auto-Hide on Quota Completion**

- Requirement: A survey reaching its sample quota becomes unavailable for new Attempts and is hidden from the Marketplace.
- Impact: Story 4.3 only hides surveys already completed by the current user.
- Recommendation: Add concurrency-safe quota closure to the Attempt/reservation slice and reflect the resulting state in the feed.

**FR-39: Publisher Progress Tracking**

- Requirement: Publisher dashboards show completion versus target, Points spent, Escrow remaining, deadline countdown, and complete survey status.
- Impact: Publishers lack a traceable implementation path for the primary survey-overview experience.
- Recommendation: Add a dedicated Publisher Survey Overview story to Epic 9 or expand Story 9.1 with the full contract.

**FR-40: Internal Response Data**

- Requirement: Publishers can view individual Internal Form responses in-app, linked to exact Form Versions and accompanied by safe Integrity metadata.
- Impact: Story 9.1 provides aggregates and an unauthorized CSV export, not in-app individual-response viewing.
- Recommendation: Add an in-app response explorer story and keep export disabled until Open Questions 6 and 11 close.

**FR-56: Admin Transaction Dashboard**

- Requirement: Admin can inspect system-wide aggregate Point metrics and drill into individual transactions.
- Impact: Story 9.5 implements only a user's own Wallet history.
- Recommendation: Add a separate Admin transaction-monitoring story; retain Story 9.5 under FR-31.

#### Partial Coverage

Fifty-seven requirements have a recognizable story path but lack one or more binding acceptance-criteria elements:

- FR-1; FR-3 through FR-7; FR-9 through FR-12; FR-14 through FR-29; FR-31 through FR-32; FR-34 through FR-37; FR-41 through FR-47; FR-49 through FR-55; and FR-57 through FR-67.

The matrix above identifies the concrete gap for every partial requirement. Before regenerating stories, treat the PRD's testable consequences and owner-bound gates as part of each requirement contract, not optional detail.

### Epic-Only Requirements Not Numbered in the PRD

The epics introduce 14 `FR-ADD` requirements not present in the PRD's FR-1 through FR-67 inventory:

- FR-ADD-1 through FR-ADD-5 and FR-ADD-5b: block types, manipulation, autosave/preview, schema validation/versioning, and published-form immutability.
- FR-ADD-6 through FR-ADD-7: AI pipeline and failure isolation.
- FR-ADD-8 through FR-ADD-10: public access, response lifecycle, and file-upload validation.
- FR-ADD-11 through FR-ADD-13: financial idempotency, authorization, and immutable audit logging.

Most are derived details or refinements of existing PRD requirements, but they are not canonical PRD FRs. FR-ADD-8 is especially risky because it authorizes guest submission while PRD Open Question 19 explicitly keeps Guest Internal participation disabled until approval.

### Coverage Statistics

- Total PRD FRs: 67
- Explicitly claimed by the epic coverage map: 66
- Fully covered by concrete story acceptance criteria: 5
- Partial or mismatched story coverage: 57
- Missing: 5
- Epic-map claimed coverage: 98.5% (66/67)
- Requirements with any semantic story path: 92.5% (62/67)
- Verified complete story-level coverage: 7.5% (5/67)

## UX Alignment Assessment

### UX Document Status

**Not found.** No whole UX document matching `*ux*.md` and no sharded UX `index.md` exists under the configured planning-artifacts directory.

UX is unequivocally required. RESCOM is a responsive, user-facing web application with authentication and onboarding, a drag-and-drop Form Builder, AI waiting and failure states, Internal Form answering, External Form countdown/code entry, offline recovery, Marketplace discovery, Wallet and Publisher dashboards, Admin moderation/review interfaces, feedback, notifications, and sensitive integrity explanations.

### PRD and Epic Alignment Issues

- PRD NFR-20 and Open Question 20 explicitly block UI-heavy story acceptance until a canonical UX artifact defines accessibility, responsive states, localization/content rules, and sensitive Integrity language.
- The epics document instead says a standard Next.js/Tailwind UI may be assumed. This conflicts with the PRD rule that unresolved choices are not implementation defaults.
- Story 4.4 enables Guest Internal submissions although PRD Open Question 19 keeps that capability disabled until Product, Security, Privacy, and Research approval.
- Story 7.5 fixes a top-100 leaderboard presentation although Open Question 1 leaves ranking scope and display count unresolved.
- Story 7.6 automatically shortens the External Pending period to 24 hours although the PRD keeps 48 hours unless Open Question 3 is approved.
- Story 9.1 authorizes CSV response and integrity-metadata export although PRD Open Questions 6 and 11 keep MVP behavior in-app only pending approval.
- Stories include isolated loading, offline, and dashboard states, but there is no end-to-end navigation model, responsive state matrix, empty/error/loading/permission state inventory, or cross-role information architecture.

### Architecture Support

The architecture provides several necessary technical foundations:

- One Next.js frontend is the initial deployment target.
- Shared Zod contracts bind the Form Builder, renderer, APIs, and telemetry.
- AI failure isolation preserves manual Form Builder operation.
- Dashboard queries use precomputed assessment/summary records rather than raw event streams.
- Storage and authorization boundaries support secure file-upload interactions.

These foundations do not replace UX design. The architecture does not define responsive breakpoints, keyboard-accessible drag-and-drop behavior, screen-reader semantics, focus management, error association, contrast, reduced-motion behavior, Vietnamese localization, integrity-language guidelines, or dashboard visualization/accessibility conventions.

### Warnings

**Blocking warning:** A canonical UX artifact is required before UI-heavy stories can be considered implementation-ready under the PRD's own NFR-20 and Open Question 20.

At minimum, the UX artifact must define:

- Role-based information architecture and the primary journeys from onboarding through earning, publishing, review, and administration.
- Desktop/mobile breakpoints and responsive state behavior.
- Keyboard, screen-reader, focus, error, contrast, and reduced-motion requirements.
- Loading, empty, offline, retry, timeout, permission-denied, moderation, hold, appeal, and failure states.
- Vietnamese/English content policy and neutral wording for Integrity, FraudLog, Reliability, and review outcomes.
- Data-table, chart, and sensitive-metadata disclosure rules for Publisher and Admin dashboards.

## Epic Quality Review

### Review Scope

All 10 epics and 58 stories were reviewed for user value, independence, forward dependencies, entity timing, vertical slicing, acceptance-criteria quality, and traceability. Every story contains a Given/When/Then skeleton, but structural and contractual defects prevent implementation readiness.

### Critical Violations

#### 1. Epic independence is broadly broken

- Story 2.6 invokes Escrow and moderation transitions before Epics 6 and 8 deliver those capabilities.
- Story 4.2 requires the demographic profile from Epic 7 and moderation approval from Epic 8.
- Stories 5.2 and 5.4 require telemetry, assessment, and Decision contracts not delivered until Epic 10.
- Story 6.5 requires the onboarding flow from future Epic 7.
- Stories 7.3 and 8.3 create Integrity signals before Epic 10 establishes their contracts.
- Story 9.1 requires Integrity and Survey Quality outputs from future Epic 10.

**Remediation:** Reorder the plan around executable vertical slices, move foundational contracts before their first consumers, or defer each integration to an explicit follow-up story after its provider exists.

#### 2. Owner-bound decisions are encoded as defaults

- Story 3.2 fixes an AI timeout at 60 seconds despite Open Question 5.
- Story 4.4 enables Guest submissions and invents an IP limit despite Open Question 19.
- Story 5.5 fixes a three-attempt lock despite Open Question 14 explicitly rejecting that default.
- Story 7.5 fixes a top-100, point-earner leaderboard despite Open Question 1 and the FR-50 completion/streak contract.
- Story 7.6 shortens External Pending to 24 hours despite the PRD's 48-hour default and Open Question 3.
- Story 8.2 invents a `questionCount × 2 seconds` Time Barrier despite unresolved security-policy values.
- Story 9.4 activates and hardcodes negative-feedback thresholds despite Open Question 15.
- Stories 10.6 and 10.7 assume Publisher-visible Survey Quality and `ENFORCED` review before Open Questions 8 and 18 close.

**Remediation:** Replace invented values with explicit blocked prerequisites or the PRD's stated safe default. Do not mark affected stories ready until their named owners record the decision.

#### 3. Stories contradict approved scope

- Story 2.6 allows an Internal non-reward survey to go directly to `PUBLISHED`; FR-20 requires all surveys to pass moderation.
- Story 9.1 authorizes CSV response and integrity export; FR-40 and Open Questions 6 and 11 limit MVP behavior to in-app viewing.
- Story 10.3 includes semantic AI scoring although semantic LLM integrity scoring is outside MVP.

**Remediation:** Remove unauthorized behaviors and retain them in explicitly gated or deferred backlog items.

#### 4. UI-heavy stories violate the UX gate

The epics acknowledge that no UX artifact exists but proceed with builders, modals, dashboards, offline behavior, Admin queues, and sensitive Integrity messaging. PRD NFR-20 and Open Question 20 explicitly block these stories.

**Remediation:** Create and approve the canonical UX artifact, then revise all UI-heavy stories with responsive, accessibility, localization, loading, empty, error, offline, and permission states.

### Major Issues

#### 5. Brownfield foundation work is missing and misordered

Architecture records an existing frontend scaffold but no root workspace, NestJS API/worker foundation, migration history, test infrastructure, CI, or object-storage integration, plus incompatible Prisma package families. No story establishes this baseline. Story 1.6 assumes NestJS and shared schemas and appears after authentication stories that already need its security controls.

**Remediation:** Add a first brownfield integration story covering path preservation, Node/npm workspaces, Prisma alignment, NestJS API/worker scaffold, migration/test strategy, CI, and boundary tests. Move security/API foundations before authentication endpoints.

#### 6. Entity timing violates Form Version and Economy invariants

- Story 2.2 creates a generic Form and Story 2.6 publishes it before Story 2.7 introduces `FormVersion`, although Attempts and publishing require an immutable exact version.
- Registration is implemented in Story 1.1 while the mandatory starter-Point grant is deferred to Story 6.5.

**Remediation:** Introduce `Form` and its draft `FormVersion` before publication. Deliver the starter grant atomically with registration or establish a prerequisite Economy slice.

#### 7. Technical milestones replace independently consumable value

Examples include Stories 1.6, 2.1, 3.3, 6.1, 7.3, 8.2, 10.1, 10.3, 10.4, and 10.8, whose personas are System Architect, Full-Stack Developer, Data Engineer, or System Owner. Epic 10 is itself framed as “Foundation & TrustGraph.”

**Remediation:** Reframe enablers around demonstrable user/Admin outcomes and move technical contracts into acceptance criteria or implementation tasks. Rename Epic 6 around safe earning/spending/tracking and Epic 10 around explainable, privacy-safe research-quality outcomes.

#### 8. Story slicing is inconsistent

- Stories 3.1–3.3 split prompt input, waiting, and parsing into technical layers; no single story delivers an editable AI-generated draft.
- Story 5.4 combines validation, durable submission, two Outbox streams, three policy modes, Economy settlement, and fail-open incidents.
- Story 10.3 combines worker infrastructure, six signal families, optional AI, fencing, ordering, gap handling, and deduplication.
- Story 10.4 combines scoring, revisions, Decisions, rollout modes, and External applicability.

**Remediation:** Use independently demonstrable vertical increments. Split submission/outbox, signal families, scoring, policy deployment, and recovery where each slice can be tested and released safely.

#### 9. Traceability contains false mappings and omissions

- FR-12 is mapped to Epic 2, but no story owns the complete External three-step creation flow.
- FR-39 is missing entirely.
- FR-40 is mapped to Epic 5, but no story implements in-app individual-response viewing; Story 9.1 provides aggregates and an unauthorized CSV export instead.
- Story 9.5 claims FR-56 but implements personal Wallet history instead of the Admin-wide dashboard.
- Story 9.6 omits most FR-57 events and required critical email delivery.
- The epics requirements inventory stops at NFR-22 and omits final PRD NFR-23 through NFR-30.

**Remediation:** Rebuild FR/NFR-to-story traceability from the final PRD and addendum. Require concrete acceptance-criteria coverage for every mapping.

### Minor Concerns

#### 10. Acceptance criteria are often non-deterministic

Examples include “basic” rate limiting, “production security standards,” “basic” versioning, unspecified autosave behavior, example-only file restrictions, an undefined streak timezone, and ambiguous “Escrow/Publisher” dispute settlement. Most stories have only one Given scenario and do not separately cover permissions, validation failures, concurrency, retries, or recovery.

**Remediation:** Replace adjectives and examples with exact transitions, policy references, authorization behavior, failure outcomes, idempotency rules, and measurable UI states.

#### 11. Canonical source and terminology drift remains

Epic frontmatter lists only the PRD and Architecture Spine, omitting the final addendum and solution design from the canonical chain. Story 1.4 also describes Publisher as a managed role although architecture defines publishing/responding as simultaneous normal-user capabilities and only `ADMIN` as privileged authorization.

**Remediation:** Reconcile the epics against the complete canonical source set and standardize authorization terminology.

### Positive Observations

- All 67 PRD FR identifiers appear in the requirements inventory.
- All 58 stories use a Given/When/Then structure.
- Several difficult invariants are captured well: revocable sessions, immutable Form Version identity, balanced Ledger posting, transactional Outbox behavior, and separation of Integrity assessment from FraudLog.

### Epic Quality Verdict

**NOT READY / HOLD.** The current epic sequence cannot be executed in order without future dependencies, and multiple stories implement unapproved or explicitly disabled behavior. These are planning defects, not ordinary implementation details.

## Summary and Recommendations

### Overall Readiness Status

**NOT READY — HOLD new story implementation.**

The requirements are detailed and the architecture captures several strong invariants, but the downstream implementation plan is not executable as written. The blocking problems are missing UX authority, broken epic sequencing, incomplete or false traceability, unapproved product defaults, and stories that contradict canonical scope.

Stories 1.1–1.3 may be treated as completed brownfield reality, but their existence does not clear the planning gate for Story 1.4 or later work. Story 1.4 currently includes UI-heavy behavior and authorization ambiguity and should not be treated as ready until the blockers below are addressed.

### Critical Issues Requiring Immediate Action

1. **Create the canonical UX artifact.** NFR-20 and Open Question 20 explicitly block UI-heavy stories; no UX document exists.
2. **Correct epic sequencing and forward dependencies.** Earlier epics consume Economy, onboarding, moderation, and Integrity capabilities delivered only in later epics.
3. **Remove unapproved defaults and scope violations.** Guest participation, 60-second AI timeout, three-attempt code lock, 24-hour tier payout, automated feedback thresholds, response export, and semantic scoring are unauthorized, gated, or deferred. Story 10.8 may remain only as the measured-trigger-gated work already expressed in its acceptance criteria.
4. **Repair requirements traceability.** Add complete story paths for missing FR-33, FR-38, FR-39, FR-40, and FR-56; close the acceptance-criteria gaps across the 57 partial FRs; and restore NFR-23 through NFR-30 to the epic inventory.
5. **Add and correctly order the brownfield foundation.** Align Prisma packages, establish npm workspaces, scaffold NestJS API/worker and test/migration infrastructure, establish CI, and move baseline security before dependent authentication work.
6. **Reconcile the full canonical chain.** The epics must incorporate the final PRD addendum and solution design, use canonical authorization terminology, and resolve the Completion Code attempt-limit conflict between the PRD gate and architecture AD-19.

### Recommended Next Steps

1. Run `[CU] Create UX` using `bmad-ux` in a fresh context. Resolve Open Question 20 and define responsive, accessible, localized, error, offline, permission, and sensitive-content behavior.
2. Run `[CC] Correct Course` using `bmad-correct-course` in a fresh context. Record decisions or safe deferrals for the owner-bound gates that current stories have converted into defaults.
3. Update the Architecture Spine and solution design where lower-authority decisions conflict with the final PRD, especially Completion Code failure policy and deferred/gated Integrity capabilities.
4. Regenerate or comprehensively revise `epics.md`: add the brownfield foundation, reorder provider/consumer slices, remove deferred scope, use vertical user-value stories, and rebuild full FR/NFR traceability.
5. Validate the revised stories, starting with the next intended story, before development.
6. Rerun `[IR] Check Implementation Readiness`. Proceed only when UX, traceability, sequencing, scope, and gate conflicts are resolved.

### Final Note

This assessment identified **11 grouped issues across five categories**: document/UX completeness, requirements traceability, epic sequencing and independence, story scope and quality, and brownfield foundation readiness. Four groups are critical and seven are major or minor. Address the critical issues before starting Story 1.4 or any later implementation story.

**Assessment date:** 2026-09-14  
**Assessor:** Codex, following the BMAD Implementation Readiness workflow, with a separate OMC code-reviewer evidence pass.
