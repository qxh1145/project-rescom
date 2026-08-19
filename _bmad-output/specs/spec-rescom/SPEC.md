---
id: SPEC-rescom
companions: 
  - "../../planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "../../planning-artifacts/prds/prd-project-rescom-2026-08-08/addendum.md"
  - "../../planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "../../planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "../../planning-artifacts/epics.md"
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# RESCOM Research Integrity Engine

## Why

RESCOM replaces informal survey exchange with a trusted marketplace where surveys reach relevant respondents and contributors are fairly rewarded. To build a long-term competitive moat, RESCOM must prove the reliability of the research data it collects. By introducing the Research Integrity Engine and TrustGraph, RESCOM shifts from just capturing answers to capturing how answers are formed—evaluating response integrity, respondent reliability, and survey quality to become infrastructure for trusted human research data.

## Capabilities

- **CAP-1**
  - **intent:** Internal Form Renderer emits consented, privacy-preserving behavioral telemetry (focus, dwell time, answer changes) during survey execution.
  - **success:** Telemetry is durably logged in PostgreSQL, deduplicated by client event ID, and submission succeeds even if telemetry fails.

- **CAP-2**
  - **intent:** System derives versioned integrity signals (temporal, interaction, consistency, attention, semantic, historical) from raw telemetry and answers.
  - **success:** Signals are immutable, replayable, and stored separately from raw events.

- **CAP-3**
  - **intent:** System calculates an independent, versioned Response Integrity assessment for each Internal Form submission based on derived signals and an immutable policy.
  - **success:** The immutable assessment output includes a 0-100 score, confidence level, evidence coverage, and safe reason codes; a separately persisted, linked operational decision records ACCEPT/REVIEW and rollout mode.

- **CAP-4**
  - **intent:** System maintains Respondent Reliability profiles and Survey Quality snapshots over time.
  - **success:** New users initialize as UNESTABLISHED (neutral), gradually building reliability. Survey Quality aggregates dropout, friction, and response distributions per immutable Form Version.

- **CAP-5**
  - **intent:** System evaluates External Form responses as NOT_ASSESSED, bypassing the Integrity Engine due to lack of behavioral telemetry.
  - **success:** External responses proceed via Completion Code and Time Barrier without being penalized for missing integrity evidence.

- **CAP-6**
  - **intent:** Authorized administrators resolve pending Integrity Reviews in a dedicated queue, generating calibration labels.
  - **success:** Review outcomes release or reverse held rewards idempotently and feed back into Respondent Reliability and Survey Quality.

- **CAP-7**
  - **intent:** System tracks integrity-relevant relationships (TrustGraph) in PostgreSQL.
  - **success:** Relational projection tracks respondent-to-response and review-outcome links without exposing raw account linkage to Publishers.

## Constraints

- Integrity Engine must operate exclusively on Internal Forms.
- New/guest users and external responses must not be assigned a low integrity score solely due to missing evidence.
- Raw telemetry and sensitive thresholds must be completely hidden from Publishers; they receive only safe reason codes and confidence levels.
- System must support progressive enforcement: policies begin in SHADOW (no reward impact) before moving to ADVISORY or ENFORCED.
- Point Ledger reward releases must consume idempotent Integrity Decisions.

## Non-goals

- No graph database (Neo4j), Kafka, feature store, or ML pipeline infrastructure in the MVP.
- No automatic fraud generation: low response quality is not automatically equated with security fraud (FraudLog remains separate).
- No LLM/AI sole decision making; semantic AI analysis is only one of many signals feeding the rule-based scorer.
- Do not collect raw keystrokes, clipboard content, or unrelated browsing activity.

## Success signal

- At least 95% of submitted Internal Form responses receive an assessment or an explicit ASSESSMENT_PENDING state.
- 100% of completed assessments contain policy version, evidence coverage, confidence, and reason codes.
- Responses from UNESTABLISHED users are handled fairly without disproportionate rejection rates compared to established cohorts.
