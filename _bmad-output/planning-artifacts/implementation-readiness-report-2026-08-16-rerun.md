---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
status: final
run: rerun-after-architecture-convergence
assessor: BMad Implementation Readiness Validator
includedFiles:
  prd:
    - _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md
    - _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/addendum.md
  architecture:
    - _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md
    - _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md
  epics:
    - _bmad-output/planning-artifacts/epics.md
  ux: []
excludedFiles:
  - _bmad-output/planning-artifacts/architecture/RESCOM-Architecture-V2.md
  - RESCOM Architecture V2 — Research Integrity Engine 3b6c370d487e803eb34efd2299bd9bc3.md
  - architecture reviews, health reports, and reconciliation/status documents as canonical inputs
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-16
**Project:** project-rescom

## Document Discovery

### Selected canonical inputs

- PRD: final `prd.md` plus approved `addendum.md`
- Architecture: `ARCHITECTURE-SPINE.md` plus explanatory `solution-design.md`
- Epics and stories: `epics.md`
- UX: no UX design document found

### Discovery issues and resolution

- No sharded PRD, Architecture, Epics, or UX indexes were found.
- Two Architecture V2 copies exist but are explicitly excluded as superseded historical proposals.
- Architecture reviews, health reports, and reconciliation/status documents remain supporting evidence rather than canonical implementation inputs.
- The missing UX artifact is retained as a readiness warning for later assessment.
- The prior same-day readiness report is preserved; this rerun uses a separate output file.

## PRD Analysis

### Functional Requirements

FR-1 — Email/Password Registration: Users register with a unique email and policy-valid password; duplicate email produces a clear error and weak passwords are rejected.

FR-2 — Google OAuth Login: First Google login creates an account and subsequent logins resolve the same durable identity. Email equality alone never links accounts; an existing password user must authenticate and explicitly link the verified Google identity, and no duplicate account may be created.

FR-3 — Single-Session Enforcement: One active session per account; a new login immediately invalidates the previous session and the previous client receives a session-expired result on its next request.

FR-4 — Frozen Starter Points: Registration grants exactly 100 Frozen Points, displays 100 Frozen/0 Available, and does not permit spending them while frozen.

FR-5 — Starter Points Expiry: If onboarding is incomplete 30 days after registration, the 100 Frozen Points are forfeited, the Frozen balance becomes zero, and the user is notified.

FR-6 — Mandatory Demographic Survey: The first-use survey collects required age range, gender, region/province, occupation, academic major, income bracket, and interests; Marketplace access remains blocked and the data populates the targeting profile.

FR-7 — Second Onboarding Survey: After demographics, the user must complete one Marketplace survey; the Marketplace is visible with an activation prompt and successful completion changes status to Verified Member.

FR-8 — Point Unlock on Activation: Completing both onboarding steps transfers all 100 Points from Frozen to Available and records an immutable Ledger transaction.

FR-9 — Demographic Profile: Each user has major, academic year, age, gender, region, occupation, income bracket, and interests; onboarding populates it and later edits immediately affect future matching.

FR-10 — Publisher Targeting Criteria: Survey creation supports gender, age range, major, university, and region, with interests/income still an assumption; at least one criterion is required and estimated audience size is shown.

FR-11 — Automated Matching: The feed contains only surveys matching the Respondent profile; non-qualifying surveys are hidden and Publishers may broaden criteria.

FR-12 — External Survey Creation: A required three-step flow captures external URL and estimated time, targeting, then sample size/reward; URL and completion of every step are validated and estimated duration drives pricing.

FR-13 — Server-Generated Completion Code: Each published External Form Version receives one server-generated six-digit code. Plaintext is disclosed once for embedding; storage retains only key version plus FormVersion-bound keyed digest, active keys remain verifiable, and code rotation creates a new immutable Form Version.

FR-14 — Point Reward Pricing: Enforce <5 min = 5–10, 5–10 min = 10–20, 10–15 min = 15–25, >15 min = 20–40 Points; below-minimum rewards fail and the system suggests a valid value.

FR-15 — Escrow Lock on Publish: Lock sample-size × reward from Available into Escrow; insufficient balance blocks publishing, balances reflect the movement, and the Ledger records it.

FR-16 — Drag-and-Drop Form Builder: Support the complete component registry, reorder/edit/delete, sections, required flags, preview, intentional attention checks and consistency rules, expected-effort hints, integrity evidence preview, and warnings against excessive/misleading checks.

FR-17 — Optional AI Form Generator: Natural-language intent produces Zod-valid draft Form Definition JSON opened in the Builder. AI outage never blocks manual creation, Publisher confirmation is required for integrity metadata, and the longer AI timeout remains an assumption.

FR-18 — Form Versioning: Forms have ordered versions; published Form Versions and integrity configuration are immutable, edits create drafts, responses reference the exact version, and historical versions remain viewable.

FR-19 — Internal Form Pricing Discount: Internal Forms cost 20% fewer Points per response than External Forms of the same estimated duration and the comparison is displayed.

FR-20 — Moderation Queue: Publishing any form creates Pending Moderation state and withholds it from Marketplace until Admin approval. Admin may approve/reject with reason; rejection refunds Escrow and notifies Publisher.

FR-21 — External Survey Attempt Start: Starting records server-authoritative startTime, opens the external form, preserves RESCOM countdown/code UI, and disables submit until the countdown completes.

FR-22 — Completion Code Verification: Validate code against the exact Form Version pinned by the active Attempt and elapsed server time. Correct code plus sufficient time succeeds; wrong code is rejected and FraudLogged; three failures lock the session/Attempt, currently tagged as an assumption.

FR-23 — Missing Code Report: The code modal exposes a report action and Admin can resolve a missing-code report by refunding/instructing the Publisher.

FR-24 — External Pending Period: External rewards enter Pending for 48 hours, show amount/countdown, permit Publisher complaint, and transfer automatically to Available through background processing when undisputed.

FR-25 — One Completion Per Account: An account completes a logical survey exactly once; repeat attempts are blocked and UI shows Completed.

FR-26 — In-Platform Internal Experience: Render all published Form Definition question types within RESCOM with progress and section navigation.

FR-27 — Demographic Cross-Check: Disclosed demographic contradictions create versioned signals but cannot alone reject, reduce reliability, or create FraudLog; opinion answers are excluded.

FR-28 — Bot Detection: Enforce minimum credible completion time based on question composition; impossible submissions are rejected and FraudLogged, while hard security controls remain separate from Integrity assessment evidence.

FR-29 — Instant Internal Credit: Valid Internal submissions credit Available within 1–2 minutes, never use Pending, write the Ledger, and notify. SHADOW/ADVISORY/ACCEPT preserve instant credit; an approved ENFORCED/REVIEW flow may use an idempotent Integrity Hold.

FR-30 — Immutable Double-Entry Ledger: Every Point movement has debit and credit sides, is append-only, derives balances from entries, and uses ACID plus row locking; runtime update/delete is prohibited.

FR-31 — Wallet Dashboard: Show Available, Pending, Frozen and immutable transaction history with timestamp, type, amount, and related survey.

FR-32 — Escrow Refund: Deadline/close with unused slots automatically refunds Escrow to Publisher Available through background work, records the Ledger journal, and notifies Publisher.

FR-33 — Survey Reopen: Publisher can pay only for added quota, preserve prior responses, and return a closed survey to Marketplace.

FR-34 — Manual Top-Up Request: Minimum purchase is 100 Points/20,000 VNĐ; bank-transfer evidence enters Admin queue; conversion is one-way with no refund or account-to-account transfer.

FR-35 — Admin Top-Up Approval: Admin reviews pending transfer details, approval credits Available through Ledger and notification, and rejection provides a reason.

FR-36 — Personalized Feed: Show only active, approved, profile-matching surveys; mark/hide completed or active attempts; cards show reward, estimated time and remaining slots; approvals update the feed.

FR-37 — Sort and Filter: Combine best match, duration, reward, deadline, university/major, newest and advanced filters; default is best match and results update immediately.

FR-38 — Quota Auto-Hide: Reaching quota changes survey to Completed, prevents new starts, hides it, and notifies Publisher.

FR-39 — Publisher Progress: Dashboard shows completion target, spend, Escrow, deadline, status and real-time progress percentage.

FR-40 — Internal Response Data: Publisher can inspect version-linked responses and safe score/confidence/coverage/reasons/policy/review metadata, never raw telemetry, device/account evidence or unrelated history; CSV export remains an assumption.

FR-41 — Traffic Analytics: Show views/clicks over time, average duration and dropout formula. Internal dashboards show versioned Integrity/Quality summaries; External dashboards show `NOT_ASSESSED`.

FR-42 — Feedback Summary: Publisher sees averaged clarity, duration, technical and overall ratings plus listed free-text comments.

FR-43 — Post-Completion Feedback: Optional prompt captures five rating dimensions and comments; Publisher can view it, aggregate evidence contributes to Survey Quality only after threshold, and one review cannot materially alter Quality.

FR-44 — Negative Feedback Deprioritization: Consistently poor surveys rank lower and Publisher is notified; threshold ≥5 negative reviews or average <2/5 remains an assumption.

FR-45 — Time Barrier: Server startTime/elapsed time rejects too-fast completion and appends a FraudLog record.

FR-46 — Rate Limiting: Temporarily block excessive survey completion; Admin-configurable limits remain an assumption.

FR-47 — Immutable FraudLog: Append-only security log for hard anti-abuse rejection, policy violation and confirmed abuse, recording user/time/survey/type/details. Soft quality and review routing remain Integrity records; no update/delete.

FR-48 — Frozen Points Anti-Bot: Starter Points remain unusable until both onboarding steps, preventing immediately spendable value from mass-created accounts.

FR-49 — Streak Counter: Track days with at least one completion, increment once per calendar day, reset after a missed day, and display in profile/Marketplace.

FR-50 — Leaderboard: Authenticated users see weekly/all-time completion and active-streak rankings updated near real time; top 50 remains an assumption.

FR-51 — Membership Tiers: Derive five engagement tiers from completion count and apply/display benefits automatically. Tier remains independent of research Reliability/Confidence; pending reduction and Ambassador privileges remain assumptions.

FR-52 — User Management: Admin lists/searches/filters, bans/unbans and edits users; banned users cannot log in, unban restores access, and edits are audited.

FR-53 — Survey Moderation: Admin approves/rejects queued surveys with reason, rejection refunds Escrow, and there is no strict moderation SLA.

FR-54 — Complaint Resolution: Admin reviews reporter/reported user/evidence/description, upholds or dismisses, reverses Pending/Available back to Escrow when upheld, and emails both parties with reason.

FR-55 — FraudLog Monitoring: Admin read-only searches/filters by user/time/type, sees repeat-offender flags, and manually decides bans; no automatic ban.

FR-56 — Transaction Dashboard: Admin sees aggregate and drill-down views of pending top-ups, active escrows and processed refunds.

FR-57 — Event Notifications: In-app notifications cover activation, moderation, Points, complaints, quota, bans and top-ups; critical events email users; push remains Phase 2.

FR-58 — Consent-Aware Telemetry: Before eligible Internal participation, disclose purpose/categories and record notice/purpose acceptance. Allow question display, commit/change, navigation, focus, validation and timing; prohibit keystrokes, clipboard, unrelated browsing/device activity. Every event references Response and exact Form Version; External Forms emit none.

FR-59 — Response Integrity Assessment: Every submitted Internal Response gets a versioned assessment or recoverable pending state. Completed records contain 0–100 score, confidence, coverage, safe reasons, policy, revision, timestamp and lineage; a separate immutable Decision records outcome/mode; missing evidence lowers coverage and failure cannot corrupt Response.

FR-60 — Cold Start: New Respondents are `UNESTABLISHED`; current response and cohort evidence may be used, history weight grows gradually, confidence remains separate, and missing history alone cannot block.

FR-61 — Respondent Reliability: Append historical snapshots from eligible authenticated Internal assessments and confirmed reviews only. External/Guest do not update it; completion count and one poor response cannot establish fraud/reliability.

FR-62 — Survey Quality: Assess each immutable Internal Form Version independently after sufficient eligible dropout/timing/friction/failure/feedback/check/distribution evidence. Preserve history; Quality cannot lower Respondent Reliability; insufficient samples produce `INSUFFICIENT_EVIDENCE`.

FR-63 — Explainability/Reproducibility: Immutable policies and preserved signal lineage reproduce assessments; authorized users receive stable safe reasons while thresholds/device details remain restricted; reprocessing appends revisions.

FR-64 — Integrity Decision Modes: New immutable policies start SHADOW, may become ADVISORY, then separately authorized ENFORCED. SHADOW does not affect rewards/visibility; ADVISORY has no auto-rejection; ENFORCED may choose ACCEPT/REVIEW; REVIEW creates a non-fraud Integrity Hold; auto-rejection requires separate audit/authority.

FR-65 — Integrity Review: Authorized reviewers see assessment/version/context, choose accepted/insufficient/rejected with reason, invoke idempotent reward release/reversal, append calibration labels without rewriting assessment, notify Respondent, and provide appeal.

FR-66 — TrustGraph-Ready Relationships: Preserve versioned links among Respondent, Response, Form Version, Publisher, policy, review and outcome in the approved store; restrict device/account evidence, retain signal lineage, and never expose raw graph data to Publisher.

FR-67 — Applicability: Authenticated Internal may use all dimensions; Guest Internal gets Response Integrity/Quality contribution with Reliability `NOT_AVAILABLE`; External is `NOT_ASSESSED`; non-applicable/insufficient states never become zero.

**Total Functional Requirements: 67**

### Non-Functional Requirements

NFR-1: Average API response time below 500 ms under normal load.

NFR-2: Survey Feed loads within two seconds for at most 50 surveys.

NFR-3: Point transactions use ACID and row-level locking against races.

NFR-4: PostgreSQL owns durable security state. The declared single-replica/no-Redis profile uses PostgreSQL counters plus conservative local request limits and cannot scale out; the shared-Redis profile uses distributed counters and fails high-risk mutations closed when configured Redis is unavailable.

NFR-5: AI generation has a separate timeout and is outside the normal 500 ms SLA.

NFR-6: Access JWT is short-lived, Secure/HttpOnly cookie-bound to PostgreSQL revocable Session; refresh rotates and server enforces single-session invalidation.

NFR-7: Every API endpoint applies CORS, Helmet, and `@nestjs/throttler` protections.

NFR-8: Server is authoritative for startTime, Completion Code generation and Point calculations.

NFR-9: Every Point transaction is ACID-consistent.

NFR-10: FraudLog is append-only without update/delete.

NFR-11: Ledger cannot duplicate or lose balances.

NFR-12: Auto-refund processing runs on schedule for expired surveys.

NFR-13: Pending automatically transfers to Available at 48 hours.

NFR-14: Uptime is at least 99% during peak academic periods.

NFR-15: AI outage cannot affect login, surveys, Points or Marketplace.

NFR-16: One monorepo separates Frontend and Backend applications.

NFR-17: Prisma manages database schema.

NFR-18: Frontend and Backend share Zod validation.

NFR-19: Form Definition JSON schema lives in a shared package.

NFR-20: UI is modern/minimal and targets Gen Z students.

NFR-21: Survey creation follows a clear three-step flow.

NFR-22: CSAT target exceeds 4.0/5.0.

NFR-23: Telemetry ingestion uses client event ID plus server uniqueness for idempotency.

NFR-24: Response remains durable during scoring outage and assessment becomes recoverably pending.

NFR-25: Scoring retry cannot duplicate assessments, reviews, notifications or Ledger effects.

NFR-26: Historical assessment is reproducible from preserved signals and immutable policy.

NFR-27: Initial deterministic assessment completes in the 1–2 minute Internal validation window under normal load.

NFR-28: Raw telemetry, restricted evidence and reviews are role-restricted and access-audited.

NFR-29: Integrity outage cannot affect authentication, rendering, Response durability or External flows.

NFR-30: Assessment/review/reliability queries are paginated and dashboards never load raw event streams.

**Total Non-Functional Requirements: 30**

### Additional Requirements

- MVP retains the entire existing GO LIVE scope while adding the Internal Research Integrity Engine; Sprint Planning must size the deliberately expanded scope before committing a launch date.
- Points are closed-loop, non-cashable and non-transferable. Automated payment, organizational tenancy, native mobile, push, horizontal scale, semantic LLM scoring, graph anomaly models and graph database are explicitly deferred.
- Canonical platform constraints are responsive Next.js/TypeScript on Vercel, one NestJS backend in Docker/VPS, managed PostgreSQL, S3-compatible private storage, optional Ollama/Qwen over Tailscale, and Cloudflare edge/security.
- Production requires qualified Vietnamese privacy/legal review and documentary evidence; the PRD/architecture do not themselves establish compliance.
- Integrity collection requires explicit notice/purpose, data minimization, restricted evidence access, separate retention schedules, lineage, appeal, and separation from FraudLog.
- Addendum data contracts require Response/FormVersion-linked client event identity; immutable signal/policy/assessment revisions; separate Integrity Decision; append-only Reliability/Quality history; explicit applicability; Guest exclusion from Reliability; Publisher-safe projections; and replay/idempotency/failure tests.
- Addendum rollout is instrumentation → SHADOW → calibration → ADVISORY → authorized ENFORCED review routing; advanced models wait for confirmed labels.
- Eleven named Product/Governance/Operations questions remain open, including policy-promotion ownership, Survey Quality threshold, review/appeal ownership, retention, export, leaderboard, reopen price, tier benefits and AI timeout.
- Ten assumptions remain unresolved, including interests/income targeting, AI timeout, three Completion Code failures, CSV export, feedback threshold, configurable rate limits, top-50 leaderboard and tier benefits.

### PRD Completeness Assessment

The PRD is unusually comprehensive and provides 67 traceable FRs, 30 NFRs, explicit non-goals, success/counter-metrics, assumptions, launch gates and an approved technical Addendum. It is sufficient for coverage analysis but not yet sufficient for unconditional implementation readiness. The higher-authority wording around ENFORCED rewards is internally ambiguous: FR-29 and FR-64 say a later `REVIEW` creates/may place a hold, whereas the adopted architecture requires every ENFORCED reward to enter a non-spendable hold before assessment and the decision to release or retain it. The PRD must say that `REVIEW` retains the pre-existing hold. Several Product/Governance/Privacy questions are correctly gated rather than decided, but the launch plan cannot claim production readiness until their named gates are closed. No dedicated UX artifact exists to define the required user-facing telemetry, pending, review, appeal, non-applicability and error states.

## Epic Coverage Validation

### Coverage Matrix

| FR | PRD requirement | Epic/story coverage | Status |
| --- | --- | --- | --- |
| FR-1 | Email/password registration | Epic 1 / Story 1.1 | Covered |
| FR-2 | Google OAuth | Epic 1 / Story 1.2 | Covered |
| FR-3 | Single session | Epic 1 / Story 1.3 | Covered |
| FR-4 | 100 Frozen Points | Epic 6 / Story 6.5 | Covered |
| FR-5 | 30-day starter expiry | Epic 6 / Story 6.5 | Covered |
| FR-6 | Mandatory demographics | Epic 7 / Story 7.1 | Covered |
| FR-7 | Second activation survey | Epic 7 / Stories 7.1–7.2 | Covered |
| FR-8 | Frozen → Available unlock | Epic 6 + 7 / Stories 6.5, 7.1–7.2 | Covered |
| FR-9 | Demographic profile | Epic 7 / Story 7.1 | Covered |
| FR-10 | Publisher targeting | Epic 4 / Story 4.1 | Covered |
| FR-11 | Automated matching | Epic 4 / Story 4.2 | Covered |
| FR-12 | External three-step creation | Claimed by Epic 2; Story 4.5 covers only URL/code | Partial |
| FR-13 | FormVersion Completion Code | Epic 4 + 5 / Stories 4.5, 5.5 | Covered |
| FR-14 | Reward pricing table | Epic 6 / Story 6.3 | Covered |
| FR-15 | Escrow lock | Epic 6 / Story 6.3 | Covered |
| FR-16 | Form Builder | Epic 2 / Stories 2.1–2.5 | Covered |
| FR-17 | Optional AI generation | Epic 3 / Stories 3.1–3.4 | Covered |
| FR-18 | Immutable FormVersion | Epic 2 / Stories 2.6–2.7 | Covered |
| FR-19 | Internal discount | Epic 6 / Story 6.3 | Covered |
| FR-20 | Moderation queue | Epic 8 / Story 8.1 | Covered |
| FR-21 | Attempt start | Epic 5 / Story 5.1 | Covered |
| FR-22 | Code/time verification | Epic 5 / Story 5.5 | Covered |
| FR-23 | Missing-code report | Epic 5 / Story 5.5 | Covered |
| FR-24 | 48-hour Pending | Epic 5 + 6 / Stories 5.5, 6.4 | Covered |
| FR-25 | Logical-form completion uniqueness | Epic 5 / Story 5.1 | Covered |
| FR-26 | Internal rendering | Epic 5 / Story 5.2 | Covered |
| FR-27 | Demographic signal | Epic 7 / Story 7.3 | Covered |
| FR-28 | Bot timing validation | Epic 8 / Story 8.2 | Covered |
| FR-29 | Instant Internal credit | Epic 5 + 6 / Stories 5.4, 6.4 | Covered, subject to PRD hold correction |
| FR-30 | Double-entry Ledger | Epic 6 / Story 6.1 | Covered |
| FR-31 | Wallet | Epic 6 / Story 6.2 | Covered |
| FR-32 | Escrow refund | Epic 6 / Story 6.3 | Covered |
| FR-33 | Reopen with added quota | Claimed by Epic 6; Story 6.3 only closes/refunds | Partial |
| FR-34 | Manual top-up | Epic 6 / Story 6.6 | Covered |
| FR-35 | Admin approval | Epic 6 / Story 6.6 | Covered |
| FR-36 | Personalized feed | Epic 4 / Story 4.2 | Covered |
| FR-37 | Full sort/filter combinations | Epic 4 / Story 4.3 only Reward/Time sorts | Partial |
| FR-38 | Quota auto-hide/status/notification | Claimed by Epic 4; no complete story AC | Partial |
| FR-39 | Publisher progress dashboard | No story or coverage-map entry | **Missing** |
| FR-40 | Individual Internal response data | Epic 5 map / Story 9.1 provides aggregate/export, not full individual view | Partial |
| FR-41 | Time-granular traffic analytics | Epic 9 / Story 9.1 omits hour/day/week/month detail | Partial |
| FR-42 | Multi-dimensional feedback summary | Epic 9 / Story 9.3 covers stars/comments only | Partial |
| FR-43 | Five-dimension completion feedback | Epic 9 / Story 9.2 covers star/comment only | Partial |
| FR-44 | Negative feedback ranking | Epic 9 / Story 9.4 | Covered |
| FR-45 | Server Time Barrier | Epic 8 / Story 8.2 | Covered |
| FR-46 | Rate limiting | Epic 8 / Story 8.2 | Covered |
| FR-47 | Separate immutable FraudLog | Epic 8 / Story 8.3 | Covered |
| FR-48 | Frozen anti-bot | Epic 8 / Story 8.4 | Covered |
| FR-49 | Daily streak | Epic 7 / Story 7.4 | Covered |
| FR-50 | Completion/streak leaderboard | Epic 7 / Story 7.5 ranks point earners/top 100 | Partial / drift |
| FR-51 | Five membership tiers | Epic 7 / Story 7.6 covers only Trusted Researcher and promotes an assumption | Partial |
| FR-52 | Admin user management | Epic 1 / Story 1.4 | Covered |
| FR-53 | Survey moderation | Epic 8 / Story 8.1 | Covered |
| FR-54 | Complaint resolution | Epic 8 / Story 8.5 | Covered |
| FR-55 | FraudLog monitoring | Epic 8 / Story 8.3 | Covered |
| FR-56 | Admin system transaction dashboard | Coverage map points to Epic 9 / Story 9.5, which is user wallet history | **Missing / incorrect mapping** |
| FR-57 | In-app and critical email notifications | Epic 9 / Story 9.6 covers in-app subset only | Partial |
| FR-58 | Consent-aware telemetry | Epic 10 / Stories 10.1–10.2 | Covered |
| FR-59 | Assessment/pending/Decision | Epic 10 / Stories 10.3–10.4 | Covered |
| FR-60 | Cold start | Epic 10 / Story 10.5 | Covered |
| FR-61 | Reliability snapshots | Epic 10 / Story 10.5 | Covered |
| FR-62 | FormVersion Quality | Epic 10 / Story 10.6 | Covered |
| FR-63 | Reproducibility | Epic 10 / Stories 10.3–10.4 | Covered |
| FR-64 | Rollout modes | Epic 10 / Stories 10.4, 10.7 | Covered, subject to PRD hold correction |
| FR-65 | Review, reward action and appeal | Epic 10 / Story 10.7 omits appeal and complete reject/reversal path | Partial |
| FR-66 | Deferred Trust projection | Epic 10 / Story 10.8 with AD-15 trigger | Covered |
| FR-67 | Applicability | Epic 4 + 10 / Stories 4.4, 10.4–10.8 | Covered |

### Missing Requirements

#### Critical missing implementation paths

**FR-39 — Publisher Progress Tracking**

- Impact: Publishers lack the required target/completion, spend, Escrow, deadline and lifecycle dashboard despite this being central to UJ-1.
- Recommendation: Add a Publisher Survey Progress story to Epic 9, with real-time projection ownership and all PRD metrics/statuses.

**FR-56 — Admin Transaction Dashboard**

- Impact: Admin cannot monitor system-wide top-ups, Escrow and refunds. Story 9.5 is a user wallet history and does not satisfy FR-56.
- Recommendation: Keep Story 9.5 traced to FR-31 and add a separate privileged, paginated Admin transaction/financial-operations dashboard story in Epic 9 or the Admin epic.

#### High-priority partial coverage

- FR-12: add the complete external URL/time → targeting → sample/reward stepper and validations.
- FR-33: add reopen/additional-quota pricing, Escrow and re-moderation behavior.
- FR-37/38: add all sort/filter combinations and concurrency-safe quota auto-hide/notification.
- FR-40/41: define individual response access plus required time-granular analytics.
- FR-42/43: cover every feedback dimension and free-text behavior.
- FR-50/51: align leaderboard basis/scope and all five tiers; do not promote assumptions as decided behavior.
- FR-57: cover the full notification event matrix and critical email delivery.
- FR-65: cover appeal and idempotent reject/reversal resolution.

### Coverage Statistics

- Total PRD FRs: **67**
- FRs claimed in the epic coverage map: **66 (98.5%)**
- Fully covered by explicit story acceptance criteria: **53 (79.1%)**
- Partially covered/drifted: **12 (17.9%)**
- Missing or incorrectly mapped: **2 (3.0%)**
- FRs with at least a partial story path: **65 (97.0%)**

## UX Alignment Assessment

### UX Document Status

**Not found.** No whole or sharded UX design artifact exists under planning artifacts. The epics file explicitly substitutes an assumption of a “standard Next.js/Tailwind UI,” but that is not a UX specification.

UX is unequivocally required: RESCOM is a responsive two-sided marketplace containing authentication/linking, mandatory onboarding, external and internal survey creation, drag-and-drop building, AI waiting/fallback, Marketplace discovery, Attempt execution, file upload, Completion Code and Time Barrier states, Wallet/Escrow/Pending/Hold states, Publisher/Admin dashboards, complaints, notifications, consent, Integrity review and appeal.

### Architecture Support

- The architecture supports one initial Next.js application with public/authenticated/admin route groups, shared Zod contracts, a responsive web target, scoped private uploads, revocable cookie sessions, safe Publisher/Respondent projections, pagination and explicit asynchronous/pending states.
- Architecture correctly states that route groups are not authorization and provides backend contracts for consent, `NOT_ASSESSED`, `NOT_AVAILABLE`, pending assessment, review, appeal, session expiry, AI outage, Redis degradation and worker delay.
- Architecture intentionally does not define visual design, information architecture, content language, accessibility or interaction details; therefore it cannot substitute for UX design.

### Alignment Issues

- No canonical flow/wireframe defines first registration → demographics → Marketplace activation → Frozen unlock, including failure and expiry states.
- No UX contract defines OAuth collision/linking, session replacement, CSRF/session recovery, account lock, or safe authentication errors.
- External Form creation lacks an agreed three-step interaction despite FR-12/NFR-21; existing stories cover only part of it.
- Form Builder lacks accessibility, keyboard drag/reorder fallback, responsive editor behavior, validation focus, autosave conflict/recovery and large-form performance states.
- Internal answering lacks a designed consent-notice comprehension flow, withdrawal behavior, offline/reconnect conflict handling, submission retry, quota-expiry and upload-quarantine states.
- External completion lacks designed countdown, locked-attempt, wrong-code, missing-code, Pending/dispute and accessibility states.
- Financial UX lacks confirmation/reversal language and clear separation among Available, Pending, Frozen, Escrow and Integrity Hold.
- Integrity UX lacks approved language for `UNESTABLISHED`, `NOT_ASSESSED`, `NOT_AVAILABLE`, `INSUFFICIENT_EVIDENCE`, assessment pending, REVIEW, fail-open release, reason codes and appeal.
- Publisher/Admin dashboards lack information hierarchy, empty/loading/error/dead-letter states, safe-evidence disclosure, pagination and export behavior.
- Story-level UX has visible drift: leaderboard top 50 vs top 100 and completion/streak vs point-earner ranking; five feedback dimensions vs one star rating; tier assumptions represented as behavior.

### Warnings

- **High readiness warning:** Phase 4 UI implementation should not start beyond low-risk technical foundations without a UX artifact covering the critical journeys and state matrix.
- Accessibility requirements are absent: no WCAG target, keyboard/screen-reader behavior, focus management, contrast, error association or reduced-motion requirements.
- Localization/content policy is absent despite Vietnamese-facing journeys and sensitive Integrity language.
- Responsive breakpoints and mobile web behavior are not specified even though web-first mobile use is in scope.
- UX acceptance tests and usability-validation criteria are missing; NFR-20/NFR-22 alone are insufficient.

## Epic Quality Review

### Epic Structure and Independence

| Epic | User-value assessment | Independence/dependency result |
| --- | --- | --- |
| 1 — System Foundation & Identity | Mixed foundation and real authentication/Admin value | Not executable first: Story 1.1 assumes NestJS, Session, Zod, security and database infrastructure; security foundation is delayed to Story 1.6; registration also requires Economy starter grant from Epic 6. |
| 2 — Form Builder & Schema | Strong Publisher value | Story 2.6 publishes/locks Escrow/moderates before Economy Epic 6 and Moderation Epic 8. It also permits direct publication for an Internal non-reward case despite FR-20 requiring all surveys to moderate. |
| 3 — AI Assistant | User value and backward dependency on Epic 2 | Structurally acceptable, but hardcodes an unresolved 60-second assumption. |
| 4 — Distribution & Public Access | Strong distribution value | Story 4.4 requires future Participation (Epic 5), Security (Epic 8) and Integrity (Epic 10); Story 4.5 needs later Attempt execution. Epic cannot stand alone. |
| 5 — Execution & Responses | Core Respondent value | Submission requires future Economy Epic 6, Security Epic 8 and Integrity Epic 10. Story 5.4 is not independently completable. |
| 6 — Ledger & Wallet | Strong financial value | Story 6.4 requires Integrity Epic 10; Story 6.5 requires onboarding Epic 7; Story 6.3 reaches Moderation Epic 8. |
| 7 — Onboarding/Gamification | User value | Generally depends backward, but promotes unresolved leaderboard/tier assumptions and Story 7.3 is an architecture-extension story rather than a bounded user increment. |
| 8 — Security/Moderation | Admin/security value | Mostly backward-compatible; “silently log suspicious behavior” is unsuitable language for privacy-governed telemetry/security and must distinguish disclosed telemetry from hard-security audit. |
| 9 — Analytics/Feedback/Notifications | Publisher/Admin/User value | FR-56 is falsely mapped to a user Wallet story; several analytics/feedback/email requirements are partial. |
| 10 — Integrity Foundation/TrustGraph | Mostly technical milestone with eventual user value | Stories 10.1–10.4 are schema/pipeline/scoring milestones. TrustEdge is explicitly deferred behind a measured trigger but Story 10.8 sits in the delivery epic. Production consent/governance activation gates are not represented as prerequisite stories. |

### Critical Violations

1. **No repository/toolchain/schema foundation story exists.** Current reality has no npm workspace, NestJS source, API/worker entrypoints, tests, CI or migrations, and Prisma package majors are misaligned. Story 1.1 cannot start safely. Story 1.6 appears after five stories that depend on it.
   - Remediation: Add an initial implementation epic/story sequence for Node/workspace/Prisma-family alignment, Nest API+worker bootstrap, shared Zod/API envelope, isolated test database/CI and security baseline. Keep it limited to enabling the first vertical slice.

2. **The current Prisma draft violates the binding schema gate, but no schema-redesign story precedes feature work.** Verified missing/incompatible contracts include durable `AuthIdentity`, required relational `FormVersion`, separate `FraudLog`, Outbox lease/fencing/processed-handler state, explicit assessment applicability/pending, Guest participant propagation, append-only Reliability snapshots and `clientEventId` deduplication.
   - Remediation: Insert the architecture-approved Prisma schema-contract task before client generation or any migration. It must write contract/concurrency/replay/security tests first and prohibit migration until independent review passes.

3. **Forward dependencies make the epic order non-executable.** Epic 2 → 6/8, Epic 4 → 5/8/10, Epic 5 → 6/8/10 and Epic 6 → 7/10 violate the rule that Epic N cannot require Epic N+1.
   - Remediation: Re-slice around vertical outcomes and the architecture build sequence: contracts/toolchain → Identity + Research/FormVersion + Participation foundations → Economy → submission/outbox/worker → External flow → consented telemetry → SHADOW scoring → evidence-gated dimensions.

4. **Core FRs have no correct story.** FR-39 is absent and FR-56 is assigned to a non-equivalent user Wallet story.
   - Remediation: Add explicit Publisher Progress and Admin Transaction Dashboard stories before declaring epic decomposition complete.

5. **Epic 10 is predominantly a technical milestone and includes deferred work.** TrustEdge must not be an MVP dependency before its measured AD-15 trigger.
   - Remediation: Express telemetry/assessment increments through observable Respondent/Publisher/Admin outcomes; move TrustEdge to a conditional backlog item with entry criteria.

### Major Issues

- Story 2.6, 5.4, 6.1, 10.3 and 10.4 are too large: each spans multiple owners, schema, concurrency, failure recovery and UI/API behavior. Split into independently testable contracts/use cases/adapters/E2E slices without losing business value.
- Story 1.1 lacks successful-login acceptance criteria, exact password/email policy, deterministic duplicate contract, response envelope, cookie/CSRF behavior and locked-account behavior.
- Story 1.2 specifies safe linking behavior but does not name durable provider-subject storage as an implementation prerequisite; the current nullable password without `AuthIdentity` is unusable.
- Story 2.6 lifecycle is internally inconsistent (`ESCROW_LOCKED` only for external, direct `PUBLISHED` for some internal) and conflicts with universal moderation.
- Story 4.4 enables Guest Internal before the Product/Security/Privacy abuse-control gate is approved.
- Story 5.4 combines Response validation, policy pinning, two Outbox streams, reward policy, assessment request and terminal fail-open behavior in one story.
- Story 6.4 still cannot be accepted without the PRD correction that every ENFORCED reward is held before Decision.
- NFR-23 through NFR-30 are absent from the epics Requirements Inventory even though several stories partially implement them; full NFR traceability cannot be demonstrated.
- Unresolved assumptions are promoted into ACs: 60-second AI timeout, IP rate, top-100 point-earner leaderboard, 24-hour Trusted tier, CSV export and feedback thresholds.
- Story 9.1 authorizes CSV export despite PRD ambiguity and “advanced export” being out of MVP; privacy-safe field selection is an open gate.
- Story 10.7 lacks appeal and complete REJECTED/reversal/idempotency behavior required by FR-65.
- No story closes Privacy/Legal production processing, policy-promotion, review-owner, Survey Quality threshold, storage scanning or Form lifecycle gates.

### Minor Concerns

- Many technical stories use System Architect/Data Engineer as the persona and deliver infrastructure rather than directly usable outcomes.
- Most stories provide one happy-path Given/When/Then block with chained `And` clauses and omit validation, authorization, conflict, retry, empty/loading and failure cases.
- Entity references drift among `form_id`, logical Form, survey ID and exact FormVersion.
- Story 7.5 conflicts with PRD leaderboard dimensions and size; Story 7.6 implements only one of five tiers.
- Story 8.3 title says “Integrity Incident System” although its accepted contract preserves separate FraudLog and Integrity records; naming invites implementation drift.
- Database changes are not explicitly localized to the first story that needs each owned entity, and cross-context migration ownership is absent from story tasks.

### Recommended Epic/Story Corrections

1. Add a pre-feature Foundation/Schema Contract vertical slice and move Story 1.6 protections before authentication endpoints.
2. Reorder/split epics to match the adopted architecture build sequence and eliminate every forward dependency.
3. Correct FR-29/64 hold semantics in the PRD, then align Stories 5.4/6.4/10.7.
4. Add FR-39 and FR-56 stories and repair all partial FR mappings listed in Step 3.
5. Create a UX design/state-matrix activity before UI-heavy stories are marked ready.
6. Add full NFR-1…NFR-30 traceability plus architecture/open-gate entry criteria to the epic inventory.
7. Move assumptions back to Product decisions or explicit gates; do not encode them as ACs.
8. Defer Story 10.8 until the measured TrustEdge trigger is approved.

## Summary and Recommendations

### Overall Readiness Status

**NOT READY**

RESCOM is not ready for Phase 4 feature implementation or a first database migration. Architecture convergence substantially improved the target contract, but the canonical source set is not reproducible from a clean checkout, the final PRD still conflicts with its adopted ENFORCED reward contract, the epic sequence is not executable without forward dependencies, critical FR paths and UX are incomplete, and the current Prisma draft cannot implement the adopted contracts.

Work may proceed only on planning remediation, UX definition, repository/toolchain foundation, and test-first Prisma schema-contract design. No migration should be generated until those gates pass independent review.

### Critical Issues Requiring Immediate Action

1. **Canonical authority is not tracked reproducibly.** `SPEC.md`, `addendum.md` and `AGENTS.md` are untracked, while `srs_rescom.md` and `rescom.md` are deleted even though the current key-document map names them. A clean checkout of tracked changes does not contain the declared authority chain.

2. **The final PRD has unsafe ENFORCED hold wording.** FR-29/FR-64 imply `REVIEW` creates a hold after Decision; AD-14 and Stories 5.4/6.4 require every ENFORCED reward to enter a non-spendable hold first, with ACCEPT releasing and REVIEW retaining it. Higher-authority PRD wording must be corrected before implementation.

3. **The executable schema contradicts the canonical architecture.** The current draft lacks durable OAuth provider-subject identity, relational required FormVersion on Attempt, separate FraudLog, Outbox lease/fencing/processed-handler state, explicit assessment applicability/pending semantics, consistent Guest participant identity, append-only Reliability snapshots and client-event telemetry deduplication. No migration history exists and live database state is not evidenced.

4. **No enabling foundation/schema story precedes feature work, and epic order contains forward dependencies.** Story 1.1 assumes infrastructure placed in Story 1.6; Epics 2/4/5/6 depend on future Economy, Moderation, Security, Participation and Integrity work.

5. **Functional coverage is overstated.** Only 53/67 FRs have complete story acceptance coverage. FR-39 and FR-56 lack correct stories; twelve additional requirements are partial or drifted.

6. **No UX artifact exists for a heavily user-facing, privacy-sensitive product.** Authentication/linking, onboarding, Form Builder, survey execution, financial states, consent, Integrity status/review/appeal and Admin workflows lack canonical state/interaction/accessibility design.

### Recommended Next Steps

1. Track the canonical SPEC/Addendum/AGENTS changes and either restore the deleted legacy key documents or update the key-document map to their explicit superseded replacements. Verify the authority set from a clean checkout.
2. Amend PRD FR-29 and FR-64 so ENFORCED always creates the hold before Decision and REVIEW retains that pre-existing hold; rerun PRD validation.
3. Produce the missing UX artifact and state matrix for authentication, onboarding, creation, execution, Wallet/Hold, consent, review/appeal, Admin, accessibility, responsive behavior and failure recovery.
4. Repair the epic coverage map, add FR-39/FR-56 stories, complete the twelve partial FRs, restore NFR-23…NFR-30 traceability, and remove assumptions from ACs.
5. Re-slice/reorder epics to the architecture build sequence and add the repository/toolchain/security/schema-contract foundation before Story 1.1.
6. Redesign Prisma against AD-1 and AD-9…AD-22 using contract, concurrency, replay, migration and security tests. Do not generate a migration until schema review reports no Critical/High finding.
7. Move TrustEdge to a conditional backlog item and close the named Privacy/Legal, Guest, storage, Form-lifecycle, policy-promotion, review-owner and Survey Quality gates at their required stages.
8. Re-run Implementation Readiness after the corrected artifacts and schema-contract review are complete.

### Final Note

This assessment found **six blocking issue groups** across document authority, requirements semantics, traceability, UX, epic quality/dependencies and executable schema reality. The architecture is now a useful target, but target quality is not equivalent to implementation readiness. Address every blocker before authorizing feature development or migration work.

**Assessment completed:** 2026-08-16  
**Assessor:** BMad Implementation Readiness Validator
