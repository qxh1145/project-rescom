---
title: RESCOM Sprint Change Proposal — Research Integrity Engine and TrustGraph
date: 2026-08-16
status: approved
change_scope: major-planning-adjustment
selected_approach: direct-adjustment
approved_by: Quan
approved_on: 2026-08-16
---

# Sprint Change Proposal: Research Integrity Engine and TrustGraph

## 1. Issue Summary

### Change Trigger

RESCOM's current planning artifacts define a survey marketplace with Internal and External Forms, a point economy, targeting, Form Builder, AI Form Generator, gamification, analytics, moderation, and basic anti-fraud controls. The current quality controls are primarily binary mechanisms: Completion Code, Time Barrier, rate limiting, demographic cross-checking, pending rewards, Publisher disputes, and FraudLog entries.

The project needs a defensible core capability that improves as RESCOM accumulates proprietary data. The approved direction is to add a **Research Integrity Engine + TrustGraph-ready data foundation** for surveys created and executed inside RESCOM.

The engine assesses three independent dimensions:

1. **Response Integrity** — reliability of one Internal Form submission.
2. **Respondent Reliability** — longitudinal reliability derived from eligible authenticated Internal Form history.
3. **Survey Quality** — quality characteristics of each immutable Internal Form Version.

### Evidence

- The PRD currently defines demographic cross-checking, timing-based bot detection, rate limiting, and FraudLog controls, but no behavioral telemetry model, derived signals, scoring policy, confidence, evidence coverage, reason codes, or review-label loop.
- The epic plan derives Trusted Researcher status mainly from completion count, which measures engagement rather than demonstrated response reliability.
- The Prisma schema stores final answers and basic lifecycle state but no telemetry, signals, assessments, policy versions, reliability snapshots, Survey Quality snapshots, reviews, or TrustGraph projections.
- Implementation artifacts are empty, so the planning change requires no code rollback.

### Approved Product Boundary

- All existing RESCOM product features remain in scope.
- The full Research Integrity Engine applies only to **Internal Forms created and executed within RESCOM**.
- External Forms retain Completion Code, Time Barrier, Pending Balance, Publisher dispute, and FraudLog controls.
- External responses are `NOT_ASSESSED`, not assigned a low score.
- Authenticated Internal responses may use all three assessment dimensions.
- Guest Internal responses may receive Response Integrity and contribute to Survey Quality; Respondent Reliability is `NOT_AVAILABLE`.
- New respondents begin as `UNESTABLISHED`, not low-trust.

## 2. Impact Analysis

### Epic Impact

| Epic | Impact |
|---|---|
| Epic 1 — System Foundation & Identity | Add telemetry consent, privacy controls, pseudonymous processing, and restricted evidence access. |
| Epic 2 — Core Form Builder & Schema | Add versioned integrity metadata, attention-check designation, consistency rules, expected-effort hints, and immutable scoring configuration per Form Version. |
| Epic 3 — AI Form Generation | Preserve feature. Require Publisher confirmation before AI-generated integrity checks become active. |
| Epic 4 — Distribution & Public Access | Define assessment applicability for guest Internal and External responses. |
| Epic 5 — Survey Execution & Responses | Add consented event capture, durable submission, transactional outbox, signal derivation trigger, and assessment lifecycle. |
| Epic 6 — Point Ledger & Wallet | Preserve existing rewards in SHADOW/ADVISORY; support idempotent integrity holds only for authorized ENFORCED review decisions. |
| Epic 7 — Onboarding & Gamification | Separate engagement tiers from Respondent Reliability; implement neutral cold start. |
| Epic 8 — Security, Moderation & Anti-Fraud | Keep hard security controls and FraudLog separate from response-quality assessments. |
| Epic 9 — Analytics & Notifications | Add Publisher integrity dashboards, Survey Quality findings, review notifications, and safe reason-code summaries. |
| New Epic 10 — Research Integrity Engine | Add telemetry, signals, versioned scoring, cold start, reliability, Survey Quality, reviews, labels, and TrustGraph projection. |

### Artifact Conflicts

#### PRD

- Vision does not yet establish trusted Internal Form data as a product capability.
- Functional requirements do not define integrity telemetry, assessments, confidence, applicability, or review.
- Existing privacy language limits demographic data to matching and must be expanded with explicit purpose, consent, minimization, retention, and access controls.
- Existing success metrics cannot measure assessment coverage, review quality, cold-start outcomes, or cohort disparity.

#### Architecture

- Existing Clean Architecture and modular monolith remain suitable.
- Missing modules: integrity events, signals, scoring, respondent reliability, Survey Quality, review, and trust relations.
- Missing durable event/outbox flow, immutable scoring policy, replayability, and progressive enforcement.
- No graph database or new distributed infrastructure is required initially.

#### Data Model

- Response records lack integrity applicability and assessment state.
- No durable telemetry, signal, assessment, policy, snapshot, review, or graph-projection entities exist.
- `isTrustedResearcher` currently conflates engagement threshold with trust and must remain separate from reliability.

#### UX

- No UX planning artifact currently exists.
- New experiences are required for telemetry disclosure, Publisher summaries, Respondent reliability state, Survey Quality findings, and Admin integrity review.
- Raw telemetry, device-link evidence, hidden thresholds, and unrelated respondent history must not be exposed to Publishers.

#### Secondary Artifacts

- Update `PROJECT_SUMMARY.md`, `srs_rescom.md`, `rescom.md`, shared Zod contracts, Prisma schema, test strategy, monitoring, retention documentation, and analytics definitions.

### Technical Impact

- Increased write volume from Internal Form telemetry.
- Background assessment processing and retry handling.
- Versioned, reproducible deterministic policies.
- Additional role-based access and audit requirements.
- New Publisher, Respondent, and Admin queries with pagination and aggregation.
- New data-governance and calibration responsibilities.

### Pre-Existing Readiness Conflicts

These conflicts are outside the Integrity Engine change but must be resolved before implementation readiness:

1. Backend is Express in the PRD/project summary but NestJS in architecture and epics.
2. Starter reward is 100 Points in the PRD but 500 Points in Story 6.5.
3. PRD unlocks starter Points after two surveys; Story 6.5 unlocks after the demographic survey alone.
4. PRD defers Redis while the architecture requires Redis from Day 1.

## 3. Recommended Approach

### Selected Path: Direct Adjustment

The approved path preserves all existing core features and adds the Integrity Engine as a dedicated capability. No existing epic or feature is removed or deferred by this change proposal.

### Alternatives Considered

#### Rollback

Not applicable. No implementation work requires reversal.

#### MVP Scope Reduction

Rejected by product decision. AI generation, gamification, guest forms, External Forms, and existing analytics remain in scope.

### Effort and Risk

- **Change classification:** Major planning adjustment; not a project restart.
- **Estimated effort:** High.
- **Technical risk:** Medium–High.
- **Estimated implementation increase:** Approximately 30–50%, subject to story sizing.
- **Primary risks:** telemetry privacy, data volume, false confidence, cold-start bias, score gaming, reward coupling, review workload, and policy calibration.

### Rollout Strategy

1. Instrumentation validation.
2. Shadow scoring with no reward or visibility impact.
3. Calibration against reviewed samples.
4. Advisory dashboards and explanations.
5. Authorized enforced review routing.
6. Advanced semantic, graph, personalized, or ML models only after sufficient confirmed labels exist.

## 4. Detailed Change Proposals

### 4.1 PRD Vision

Replace the current marketplace-only positioning with the following extension:

> RESCOM remains a survey marketplace with its existing point economy, Form Builder, AI generation, gamification, analytics, moderation, and External Form capabilities. For Internal Forms created and completed within RESCOM, the platform additionally operates a Research Integrity Engine that assesses Response Integrity, Respondent Reliability, and Survey Quality. Every assessment reports confidence, evidence coverage, reason codes, and policy version. External Forms remain under existing verification controls and are marked `NOT_ASSESSED` by the full Integrity Engine. New users are `UNESTABLISHED`, not untrustworthy.

### 4.2 PRD Glossary

Add definitions for:

- Research Integrity Engine
- Response Integrity
- Respondent Reliability
- Survey Quality
- Assessment Confidence
- Evidence Coverage
- Integrity Reason Code
- Integrity Policy Version
- Integrity Decision
- `UNESTABLISHED`
- TrustGraph
- `NOT_ASSESSED`
- `NOT_AVAILABLE`

### 4.3 New Functional Requirements

#### FR-58: Consent-Aware Behavioral Telemetry

- Capture only disclosed Internal Form interaction events.
- Record consent-notice version.
- Prohibit raw keystrokes, clipboard content, unrelated browsing, and background device activity.
- Link events to Response and immutable Form Version.

#### FR-59: Response Integrity Assessment

- Produce score 0–100, confidence, evidence coverage, reason codes, policy version, decision, and timestamp.
- Support temporal, interaction, attention, consistency, semantic, historical, survey-context, and graph signals when available.
- Missing evidence reduces coverage, not score directly.

#### FR-60: Cold-Start Handling

- Initialize new respondents as `UNESTABLISHED`.
- Use current-response and applicable survey/cohort baselines.
- Increase personal-history weighting gradually.
- Never block solely because history is missing.

#### FR-61: Respondent Reliability

- Use eligible authenticated Internal Form assessments and confirmed reviews.
- Exclude External and guest responses.
- Keep completion count and engagement tier independent.
- Store immutable versioned snapshots.

#### FR-62: Survey Quality

- Assess each immutable Internal Form Version independently.
- Use dropout, timing accuracy, question friction, technical failures, feedback, and response distributions.
- Never automatically reduce Respondent Reliability because Survey Quality is poor.

#### FR-63: Explainability and Reproducibility

- Use immutable scoring policies.
- Store derived signals and policy version.
- Expose safe reason codes, not sensitive thresholds.
- Create new revisions when reprocessing.

#### FR-64: Integrity Decision Modes

- `SHADOW`: record only.
- `ADVISORY`: expose authorized findings without automatic rejection.
- `ENFORCED`: approved policies may route to `ACCEPT` or `REVIEW`.
- Automatic rejection remains prohibited unless separately approved.

#### FR-65: Integrity Review and Labels

- Provide authorized review with evidence summary and version context.
- Resolve as accepted, insufficient evidence, or rejected.
- Apply reward actions idempotently.
- Preserve outcomes as calibration labels.
- Notify respondents and support appeal.

#### FR-66: TrustGraph-Ready Relationships

- Store versioned integrity-relevant relationships in PostgreSQL.
- Restrict device/account linkage evidence.
- Record source and policy version for graph-derived signals.

#### FR-67: Assessment Applicability

- Authenticated Internal: all dimensions may apply.
- Guest Internal: Response Integrity and Survey Quality; reliability `NOT_AVAILABLE`.
- External: full engine `NOT_ASSESSED`.
- Never translate non-applicability into zero.

### 4.4 New Success Metrics

- Assessment coverage.
- Explainability coverage.
- Review turnaround.
- Review overturn rate by policy version.
- Cold-start outcome monitoring.
- Survey Quality coverage.
- Publisher utilization of integrity data.
- Cohort disparity monitoring.
- Missing-evidence penalty audit.
- Score-gaming indicators.

### 4.5 New Non-Functional Requirements

- Idempotent telemetry ingestion.
- Durable response submission during engine outage.
- Idempotent scoring, review, and ledger retries.
- Historical assessment reproducibility.
- Deterministic scoring within the existing Internal Form validation window.
- Restricted and audited evidence access.
- Engine failure isolation.
- Paginated assessment and reliability queries.

### 4.6 Privacy and Governance

- Disclose matching and integrity-assessment purposes separately.
- Minimize telemetry and prohibit raw keystroke capture.
- Store Publisher-facing reasons separately from restricted raw signals.
- Use pseudonymous identifiers where possible.
- Define retention by data class.
- Record consent-notice version.
- Require approved purpose and lineage before statistical or ML training.
- Preserve historical assessment auditability.

### 4.7 Architecture Decisions

Add:

- AD-8 Internal-Form Integrity Boundary.
- AD-9 Durable, Idempotent Telemetry.
- AD-10 Transactional Submission and Outbox.
- AD-11 Pure, Versioned Scoring Core.
- AD-12 Independent Assessment Dimensions.
- AD-13 Integrity Is Not Fraud.
- AD-14 Progressive Enforcement.
- AD-15 Relational TrustGraph First.

Add backend modules:

```text
integrity-events
integrity-signals
integrity-scoring
respondent-reliability
survey-quality
integrity-review
trust-relations
```

PostgreSQL remains the durable source of truth. Redis remains short-lived coordination and rate-limit infrastructure. No Kafka, graph database, feature store, or ML platform is required initially.

### 4.8 Data Model

Add:

- `IntegrityConsent`
- `IntegrityEvent`
- `IntegritySignal`
- `IntegrityPolicy`
- `ResponseIntegrityAssessment`
- `RespondentReliabilitySnapshot`
- `SurveyQualitySnapshot`
- `IntegrityReview`
- rebuildable `TrustEdge` projection

Add enums for applicability, assessment status, decision, policy mode, reliability state, and review outcome.

Apply uniqueness and indexing for event deduplication, assessment revisions, response sequence, decision/status lookup, and policy reproducibility.

### 4.9 API Contracts

Add:

```text
POST /responses/:responseId/integrity-events
POST /responses/:responseId/submit
GET  /publisher/forms/:formId/integrity-summary
GET  /publisher/responses/:responseId/integrity
GET  /publisher/forms/:formId/survey-quality
GET  /me/reliability-summary
GET  /admin/integrity-reviews
GET  /admin/integrity-reviews/:reviewId
POST /admin/integrity-reviews/:reviewId/resolve
```

Publisher APIs expose safe assessments, confidence, evidence coverage, and reason codes. They never expose raw telemetry, sensitive device links, hidden thresholds, or unrelated history.

### 4.10 New Epic 10

#### Story 10.1 — Integrity Consent and Event Contract

Define permitted events, shared schemas, consent versioning, deduplication, and prohibited collection.

#### Story 10.2 — Telemetry Collection

Instrument the Internal Form Renderer, batch safely, and keep submission independent from complete telemetry delivery.

#### Story 10.3 — Signal Derivation

Derive versioned replayable signals and mark unavailable evidence explicitly.

#### Story 10.4 — Versioned Response Integrity Scoring

Implement deterministic scoring with confidence, evidence coverage, reason codes, policy version, decision, revision, and rollout mode.

#### Story 10.5 — Cold Start and Respondent Reliability

Implement `UNESTABLISHED`, applicable baselines, gradual history weighting, and immutable reliability snapshots.

#### Story 10.6 — Survey Quality

Assess each Form Version using aggregate quality evidence and minimum sample requirements.

#### Story 10.7 — Integrity Review and Labels

Create a review queue separate from FraudLog, idempotent reward actions, notifications, appeals, and calibration labels.

#### Story 10.8 — TrustGraph Projection

Build restricted, typed, versioned, rebuildable PostgreSQL relationships.

### 4.11 Existing Story Amendments

- **Story 2.1:** Add versioned integrity metadata to shared Form Schema.
- **Story 4.4:** Define guest assessment applicability.
- **Story 5.2:** Emit consented events from Internal Form execution.
- **Story 5.4:** Persist response and assessment outbox event atomically.
- **Story 6.4:** Preserve rewards in SHADOW/ADVISORY and support authorized integrity hold in ENFORCED mode.
- **Story 7.3:** Treat demographic contradiction as a signal, not independent proof of fraud.
- **Story 7.6:** Keep engagement tier separate from reliability.
- **Story 8.2:** Keep hard bot controls separate but usable as evidence.
- **Story 8.3:** Prevent low scores from automatically creating FraudLog entries.
- **Story 9.1:** Add integrity and Survey Quality dashboards.
- **Story 9.2:** Aggregate feedback into Survey Quality with minimum evidence controls.

### 4.12 UX Addendum

Create `ux-integrity-engine.md` covering:

- Form Builder Integrity Settings.
- Telemetry notice and consent.
- Respondent submission and review states.
- Reliability state and confidence.
- Publisher integrity distribution and Survey Quality findings.
- Admin integrity-review queue.
- External `NOT_ASSESSED` messaging.
- Accessibility, neutral language, threshold protection, and restricted evidence.

### 4.13 Verification and Observability

Required tests:

- Rule unit tests.
- Deterministic golden cases.
- Event and API contract tests.
- Idempotency and replay tests.
- Cold-start and applicability tests.
- Permission and privacy tests.
- Failure and recovery tests.
- Fairness and cohort reports.
- Review and appeal workflow tests.

Required monitoring:

- Event deduplication, missing, and ordering rates.
- Assessment latency, backlog, retry, and failure rates.
- Score, confidence, evidence-coverage, and policy-version distributions.
- Review and overturn rates.
- Cold-start outcomes and cohort disparity.
- Survey Quality distributions.
- Ledger hold/release failures.
- Restricted-evidence access attempts.

## 5. Implementation Handoff

### Scope Classification

**Major** — fundamental planning expansion requiring Product Manager and Solution Architect ownership before backlog implementation.

### Handoff Recipients

#### Product Manager

- Update PRD vision, glossary, requirements, metrics, privacy, and MVP commitments.
- Preserve all approved existing product features.
- Define governance ownership and review/appeal policy.
- Resolve pre-existing product inconsistencies.

#### Solution Architect

- Update architecture spine and detailed design.
- Define event, outbox, policy, scoring, review, and relational TrustGraph boundaries.
- Update Prisma and shared API/schema contracts.
- Resolve Express versus NestJS and Redis decisions.

#### Product Owner / Story Workflow

- Add Epic 10 and amend affected stories.
- Preserve existing story IDs.
- Define dependencies and acceptance criteria.
- Re-run epic validation after changes.

#### Developer and QA

- Implement only after updated artifacts pass implementation readiness.
- Begin with event contracts, data model, and shadow-mode scoring.
- Build deterministic tests before enabling advisory or enforced behavior.

### Required Sequence

1. Approve this Sprint Change Proposal.
2. Update PRD.
3. Update architecture and detailed design.
4. Update epics and stories.
5. Create Integrity UX addendum.
6. Align SRS, project summary, schema, and shared contracts.
7. Resolve pre-existing readiness conflicts.
8. Run BMAD Implementation Readiness.
9. Run Sprint Planning.
10. Implement instrumentation and SHADOW policy first.

### Success Criteria

- Internal-only applicability is consistent across all artifacts.
- The three assessment dimensions remain independent.
- New users are neutral and confidence-aware.
- External and guest applicability is explicit.
- Integrity assessments remain distinct from fraud accusations.
- Every assessment is versioned, explainable, reproducible, and auditable.
- Missing evidence never becomes a zero score.
- Existing RESCOM product features remain in scope.
- No enforcement policy launches without SHADOW calibration.
- Updated PRD, architecture, UX, and epics pass implementation readiness.

## 6. Checklist Status

| Section | Status |
|---|---|
| Trigger and context | Approved |
| Epic impact | Approved |
| Artifact conflict analysis | Approved |
| Path forward | Approved — Direct Adjustment |
| PRD vision and boundary | Approved |
| PRD glossary | Approved |
| Functional requirements | Approved |
| Metrics, privacy, and NFRs | Approved |
| Architecture | Approved |
| Database and API | Approved |
| Epics and stories | Approved |
| UX | Approved |
| Documentation, rollout, and verification | Approved |
| Complete proposal | Approved by Quan on 2026-08-16 |

## 7. Approval

**Approved by:** Quan  
**Approval date:** 2026-08-16  
**Decision:** Proceed with Direct Adjustment and preserve all existing RESCOM product features.

This approval authorizes planning-artifact updates and handoff to Product Manager and Solution Architect workflows. It does not by itself authorize production enforcement, automatic response rejection, or ML model training.

## 8. Workflow Execution Log

| Date | Event | Result |
|---|---|---|
| 2026-08-16 | Change trigger confirmed | Research Integrity Engine + TrustGraph-ready foundation for Internal Forms |
| 2026-08-16 | Review mode selected | Incremental |
| 2026-08-16 | Impact analysis completed | Major planning adjustment; no rollback required |
| 2026-08-16 | Path selected | Direct Adjustment; preserve existing features |
| 2026-08-16 | Detailed proposals reviewed | Nine proposals approved |
| 2026-08-16 | Complete proposal approved | Approved by Quan |
| 2026-08-16 | Handoff routed | Product Manager + Solution Architect |

### Handoff Status

- **Product Manager:** Ready to update PRD, product metrics, privacy rules, and scope language.
- **Solution Architect:** Ready to update architecture, data model, APIs, scoring boundaries, and TrustGraph design.
- **Product Owner:** Queued after PRD and architecture updates to add Epic 10 and amend existing stories.
- **Implementation:** Not started; requires updated artifacts and BMAD Implementation Readiness approval.
