# Reconciliation — Approved Sprint Change Proposal

- **Input:** `../../sprint-change-proposal-2026-08-16.md`
- **PRD:** `prd.md`
- **Addendum:** `addendum.md`
- **Result:** Substantively reconciled

## Covered in PRD

- Internal-Form-only Integrity Engine boundary.
- Response Integrity, Respondent Reliability, and Survey Quality.
- External `NOT_ASSESSED`, guest `NOT_AVAILABLE`, and neutral `UNESTABLISHED` handling.
- FR-58 through FR-67.
- Progressive policy modes and reward behavior.
- Explainability, confidence, evidence coverage, reason codes, and policy versioning.
- Success metrics, counter-metrics, NFRs, privacy, and data governance.
- Existing feature preservation and advanced-model deferrals.

## Preserved in Addendum

- Candidate event/outbox/scoring flow.
- Candidate architecture decisions and module boundaries.
- Candidate entities, enums, integrity constraints, and APIs.
- TrustGraph relational projection guidance.
- Rollout, testing, observability, and technical alignment issues.

## Remaining Decisions

- Policy-promotion authority and calibration criteria.
- Survey Quality minimum evidence threshold.
- Integrity review and appeal ownership.
- Integrity-data retention periods.
- Publisher export fields.

These decisions are explicit PRD Open Questions. `SHADOW` instrumentation and architecture planning can proceed, but enforcement and production telemetry launch require the relevant governance decisions.
