---
title: Updated RESCOM Architecture — Final Adversarial Boundary Re-audit
reviewer: adversarial-divergence-lens
date: 2026-08-16
scope: Latest shared-state ARCHITECTURE-SPINE.md, solution-design.md, reconciliation, upstream planning artifacts, and repository reality
verdict: PASS
critical_findings: 0
high_findings: 0
medium_findings: 0
low_findings: 0
---

# Updated RESCOM Architecture — Final Adversarial Boundary Re-audit

## Gate Verdict

**PASS — 0 Critical, 0 High.** The latest binding Spine and Solution Design close the prior Critical cross-context financial workflow gap and all eight High findings requested for re-test. Independent implementations can now converge on compatible durable identities, ownership, failure behavior, and Point movements without adding a new topology or technology.

The prior Medium advisories are now either binding rules or explicit pre-enable/schema gates. No residual adversarial finding remains in this lens. The current Prisma schema remains explicitly non-conforming and un-migrated; that is the accepted next-task blocker, not evidence that these target contracts are already implemented.

## Re-audit Method

I rebuilt lower-level implementations and injected:

- concurrent journal post/reversal, quota reservation, completion and policy promotion;
- worker lease expiry, stale claim, event gap, dead-letter, re-drive and provider crash;
- External code brute force, verifier-key rotation, dispute/release race and duplicate completion;
- expired-access reload, refresh/CSRF rotation, OAuth collision and Session-authority outage;
- Redis absent versus configured/down deployment profiles;
- cross-context transaction failure, migration/FK ordering, scan outage and orphaned upload.

The verdict is based on the latest shared files, not the earlier review snapshot.

## Prior Critical Re-test

| Finding | Final result | Binding evidence/result |
| --- | --- | --- |
| External Completion Code → Pending Ledger and adjacent Point workflows lacked coordinator/failure model | **Resolved** | The Spine now has an authoritative Cross-Context Financial Workflow Map. Participation coordinates External completion plus `CreditPending` under one shared PostgreSQL UoW with stable `external-completion:{attemptId}` identity; completion claim and Pending journal commit or roll back together. Publish/Escrow, Internal reward/hold, External dispute, close/refund and top-up also name coordinator, boundary and idempotency/failure behavior. |

No Point workflow in the reviewed map requires uncoordinated cross-module table writes. Economy remains the sole Ledger writer; coordinators invoke owner-provided handlers under AD-16.

## Eight High Re-tests

### 1. CSRF reload / refresh bootstrap — Resolved

The no-store bootstrap may authenticate through either a valid access token or the valid refresh cookie plus exact Origin/Fetch-Metadata checks. Refresh requires the current synchronizer token and atomically rotates refresh secret plus CSRF hash, returning the next token only to the allowed origin. This closes the expired-access page-reload deadlock without making refresh CSRF-blind.

### 2. Stranded ENFORCED Integrity Hold — Resolved

AD-14 now requires a governance-approved deadline. Terminal/missed-deadline assessment emits one idempotent fail-open release plus incident; an Integrity assessment cannot silently strand Points. A hard-security hold remains a separately authorized non-Integrity path.

### 3. Redis absent versus Redis outage — Resolved

`REDIS_DISABLED_SINGLE_REPLICA` and `REDIS_SHARED` are explicit deployment profiles. The first requires exactly one API replica and PostgreSQL durable controls; startup rejects multi-replica misuse. Configured Redis outage fails closed for guest/code mutation, while Session/cache falls back to PostgreSQL and low-risk reads degrade conservatively with alerting.

### 4. Completion verifier key/scope — Resolved

The verifier persists `keyVersion` plus a keyed digest bound to FormVersion; keys remain available for active versions and key/code rotation produces a new version. Validation uses exact active Attempt/FormVersion and server time, locks after three failures, and applies account-plus-FormVersion limits. IP/device scopes require Privacy approval.

### 5. Outbox terminal gaps / provider crash — Resolved

Ordering-sensitive producers assign complete named streams with contiguous sequence. Dead-letter remains a blocking gap until audited re-drive or explicit approved skip; money/access/policy skips require compensation/fail-safe. Local effect plus processing marker is atomic. External adapters persist attempt before call, reuse idempotency identity, reconcile status before acknowledgment, and reject irreversible providers lacking idempotency/status lookup.

### 6. Migration integrator / cross-context FK — Resolved

A named Platform Migration Integrator owns the repository dependency graph, serial order, cross-context FK review, whole-chain integration tests and apply-once release gate. Contexts author only owned records; the referencing-table owner authors the FK without altering the referenced owner's table.

### 7. Storage state / metadata owner — Resolved

Platform Infrastructure owns technical `StoredObject` metadata and a durable state machine through quarantine/clean/attached or terminal states. Only `CLEAN` objects may attach/download; scanner outage remains quarantined and fails closed. The domain owner owns only its attachment relation, while operations/privacy responsibilities are explicit.

### 8. Attempt eligibility / Guest reward — Resolved

Internal start transactionally checks exact published/open version, targeting, logical non-completion, quota and conflicting Attempt, then creates Attempt, expiring quota reservation and one Response. Authenticated completion alone emits the reward request; Guest completion emits only assessment, has nullable account identity, no account reward and no Reliability update.

## Other Load-bearing Re-tests

- **Ledger:** zero-sum per journal/unit, non-negative user-state account classes, deterministic balance-row locks, atomic append/projection update, unique command identity, append-only authority, exact reversal and unique non-branching `reversesJournalId` all converge. Concurrent duplicate command or double reversal cannot post twice under the stated contract.
- **Policy/reward:** submission pins the effective policy deployment identity/mode into both independent events. Promotion cannot change an existing Response path. `SHADOW`/`ADVISORY` credit never waits for scoring; Guest emits no reward event.
- **Attempt/Response/Event:** Attempt and one-to-one `IN_PROGRESS` Response exist before telemetry. Submission transitions the same Response; event dedupe has a durable response identity.
- **Session/OAuth:** PostgreSQL is revocation authority; access/refresh/cookie/CORS/CSRF contracts, single-session invalidation, provider-subject identity, explicit Google linking and OAuth state/nonce/PKCE/token validation are binding.
- **Integrity/Fraud:** External stays `NOT_ASSESSED`; IntegrityEvent is consented telemetry rather than a domain bus; assessment evidence, decision and Economy command are separate; FraudLog remains hard security/confirmed abuse only.
- **Worker/Redis:** one NestJS artifact with API/worker processes; PostgreSQL owns durable claims; Redis never becomes durable truth.
- **Ownership:** Platform Infrastructure owns mechanics only; business contexts retain their durable state and migration authorship; Integrity subcomponents remain one context, not deployable services.
- **Privacy/governance:** production personal-data and telemetry gates remain explicit, and no legal-compliance claim is invented.
- **Current reality:** npm workspace, NestJS, worker, Redis, object storage, CI and migrations remain targets/not implemented; Prisma package mismatch and non-conforming schema are accurately labeled.

## Medium Advisory Closure

| Prior advisory | Final disposition |
| --- | --- |
| Scheduled financial processors lacked the complete Outbox execution profile | **Closed:** AD-17 now inherits AD-10 owner/fencing lease, `availableAt`, retry/backoff, terminal/dead-letter, audited re-drive/skip and idempotent-command protections. |
| External Attempt start did not mirror Internal eligibility validation | **Closed:** AD-19 now applies published/open, targeting, logical completion, quota, conflicting-Attempt, reservation and server-start validation to any Form start. |
| Publication/moderation state names could diverge | **Closed as an explicit schema gate:** Product/Research/Moderation plus Engineering must approve and contract-test the lifecycle transition table before schema/client generation; enum-name inference is forbidden. |
| Guest abuse controls lacked a named approval artifact | **Closed as an explicit enablement gate:** Product/Security/Privacy must approve scopes, bot challenge, reservation expiry, retention, monitoring and support/appeal posture before shared/production Guest Internal enablement. |

The Completion verifier additionally requires constant-time comparison and prohibits logging plaintext/code input. The earlier duplicate `API Format` convention row has been removed. Platform Infrastructure remains a technical mechanics owner with no business side effect or domain meaning.

## Remaining Findings

None in this adversarial lens.

## Schema/Implementation Gate

The next Prisma task remains blocked from migration until contract tests prove at least:

- concurrent zero-sum/no-overdraft posting, command dedupe and double-reversal rejection;
- FormVersion immutability, Internal/External Attempt eligibility, quota reservation and logical completion uniqueness;
- one-to-one Attempt/Response identity and Completion verifier key/scope behavior;
- cross-context financial UoW rollback and stable command IDs;
- Session revocation, expired-access CSRF bootstrap, refresh rotation/reuse and OAuth identity linking;
- Outbox ordering, fencing, terminal re-drive/skip and local atomic effect/dedupe;
- ENFORCED fail-open hold release;
- migration chain/FK ownership and storage quarantine state/authorization.

No migration should be generated before those tests and a final data/security review pass.

## Final Gate Result

**PASS: 0 Critical, 0 High, 0 Medium, 0 Low.** The updated architecture is sufficiently converged for the next schema-contract design task. The pass does not claim implementation or production readiness; repository reality remains an intentionally gated brownfield starting point.
