# Adversarial Boundary Review

## Verdict

Three incompatible implementations remain possible while obeying the current AD text.

## Collision 1 — Assessment and Reward Ownership

The Response team could write assessment state and credit Points in one transaction, while the Integrity team could independently append an assessment and command the Ledger. Both could claim compliance with AD-10 and AD-14, producing duplicate ownership and reward races.

**Required fix:** Exclusive module-owned tables; only Ledger writes ledger records; other modules submit idempotent commands through application ports/events.

## Collision 2 — Outbox Processing Under Two API Replicas

Each API replica could run the same in-process scheduled processor and claim the same pending work. AD-10 says idempotent but does not bind claim/lock behavior.

**Required fix:** Every scheduled/outbox processor uses database or Redis distributed claiming/locking and remains safe under retries.

## Collision 3 — Publisher Analytics Projection

One analytics implementation could query raw events directly while another consumes sanitized assessment summaries. Both could argue they support Publisher integrity dashboards.

**Required fix:** Raw events, restricted signals, and linkage evidence remain inside Integrity/Admin boundaries; Publisher and Respondent APIs consume safe projections only.
