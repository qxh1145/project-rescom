---
title: Updated RESCOM Architecture — Rubric, Security, Data, and Operations Review
reviewed: 2026-08-16
reviewer_lens: good-spine rubric plus security, data integrity, privacy, ownership, and operations
artifact: ../ARCHITECTURE-SPINE.md
verdict: pass
critical_findings: 0
high_findings: 0
medium_findings: 1
---

# Updated RESCOM Architecture Review

## Gate Verdict

**PASS — 0 Critical, 0 High.** The latest shared state closes both precision findings from the previous re-review and the Critical/High issues raised by the adversarial pass. The Spine is now sufficiently binding for independently implemented schema and application contracts to converge. The current Prisma draft and absent backend/migrations remain intentionally blocked implementation, not unresolved architecture.

Deterministic `lint_spine.py` passes with zero findings on this final re-audited state. `git diff --check` also reports no whitespace errors.

## Scope and Authority

Re-reviewed in the requested authority order:

1. `_bmad-output/specs/spec-rescom/SPEC.md`
2. Final `prd.md` plus approved `addendum.md`
3. `ARCHITECTURE-SPINE.md`
4. `solution-design.md`
5. `epics.md`
6. Repository reality as brownfield evidence and structural seed

Also inspected `reconcile-integrity-prd.md`, the prior adversarial/data/version/rubric reviews, current Prisma schema, manifests, Docker Compose, migration-history absence, Git status, and the supersession status of the two V2 proposals. The Solution Design consistently inherits the Spine; lower-authority artifacts no longer override it.

## Final Re-audit of Prior Critical and High Findings

### Ledger posting, overdraft, concurrency, and reversal — RESOLVED

AD-1 now binds the account/journal/entry/projection model, zero-sum unit invariant, non-negative user spendability classes, deterministic ascending balance-row locks, atomic sufficiency/post/projection update, runtime append-only permissions, and global command idempotency.

The prior reversal precision defect is closed: `reversesJournalId` is unique on the original journal, the reversing entries exactly negate it, every journal is reversible at most once, and reversal-of-reversal may only extend a non-branching chain. Concurrent double reversal and branching implementations are therefore non-conforming.

### Attempt, Response, FormVersion, quota, and Completion Code — RESOLVED

AD-19 requires an exact published/open FormVersion, eligibility, quota reservation with expiry/release, no conflicting active Attempt, and a one-to-one `IN_PROGRESS` Response created in the Internal-start transaction. Telemetry therefore has a durable Response identity and submission transitions that same row. External start applies the same lifecycle/eligibility/quota/concurrency checks and authoritative start time. Logical-Form completion is concurrency-protected, participant/version context is authoritative through Attempt, and guest identity does not fabricate a required account.

External Completion Code scope is one verifier per published External FormVersion. `keyVersion`, keyed digest bound to FormVersion, active-key retention, new-version rotation, active Attempt/exact-version/server-time checks, constant-time comparison, no plaintext/input logging, durable three-failure Attempt lock, account-plus-version limiting, and Privacy approval for IP/device scope remove incompatible verifier and rotation models.

### Reward/assessment independence and Integrity boundary — RESOLVED

Authenticated Internal submission atomically emits independent reward and assessment events pinned to the effective policy deployment. Guest submission emits no reward event. `SHADOW`/`ADVISORY` credit does not wait for scoring; `ENFORCED` uses a hold plus immutable decision commands, with idempotent fail-open release and incident on terminal failure or governance deadline. Later promotion cannot change the pinned path.

External responses remain `NOT_ASSESSED`; FraudLog is limited to hard security/confirmed abuse; consented `IntegrityEvent` is not the domain event bus; assessment revisions, decisions, Reliability, Survey Quality, and deferred TrustEdge have separate ownership and history.

### Outbox ordering, fencing, replay, and local atomicity — RESOLVED

The previous ordering High is closed. AD-10 now assigns a named `orderingStream` and contiguous `streamSequence` in the producer transaction. A handler subscription consumes the complete named stream and records intentional no-ops; aggregate version is explicitly not a partial-subscription offset. Per-stream serialization, duplicate/stale no-op, gap retry, and a blocking terminal gap with audited re-drive/approved compensated skip are binding.

Claims use owner, lease expiry, and monotonically unique fencing token; only the matching owner/token may complete. PostgreSQL-local effect plus processed-handler/stream position is atomic. External adapters persist attempts, reuse provider idempotency identity, reconcile status before acknowledgment, and reject irreversible providers that offer neither idempotency nor status reconciliation. Retries cannot duplicate assessments, reviews, notifications, or Ledger journals.

AD-17 now explicitly extends the owner/fencing lease, `availableAt`, retry/backoff, terminal/dead-letter, audited re-drive/skip, and idempotent-command protections to scheduled financial/security work. Pending/Frozen expiry and auto-refund therefore cannot implement a weaker competing job protocol.

### Sessions, OAuth, CSRF, and abuse controls — RESOLVED

AD-20 binds short access lifetime, PostgreSQL Session revocation authority, hashed rotating refresh family, one-session enforcement, cookie flags, exact credentialed CORS allowlists, synchronizer-token CSRF lifecycle, refresh-cookie bootstrap after expired access, constant-time token comparison, and token-free security audit. OAuth state/nonce/PKCE/redirect/provider-token validation is explicit. Google email collision never auto-links; explicit recent-auth linking is audited and cannot remove the final login method.

AD-6 defines mutually exclusive `REDIS_DISABLED_SINGLE_REPLICA` and `REDIS_SHARED` profiles, rejects unsafe multi-replica startup, preserves PostgreSQL durable authority, and defines fail-closed versus PostgreSQL-fallback behavior during Redis outage.

### Cross-context money, ownership, storage, and migrations — RESOLVED

The authoritative workflow map names coordinators, shared-transaction or Outbox boundaries, stable command keys, and failure behavior for publication/escrow, External completion/Pending, Internal reward/assessment, ENFORCED hold, External dispute, close/refund, and top-up. AD-16 preserves exclusive table ownership even when owner handlers participate in one PostgreSQL Unit of Work.

The ownership map assigns domain records, Outbox mechanics, technical StoredObject state, and domain-specific audits without creating deployable services. AD-22 binds private storage, quarantine/CLEAN gating, attachment ownership, signed access, scanning outage, cleanup, and retention authorities.

The Platform Migration Integrator owns the single repository dependency/order/apply gate; the referencing context authors cross-owner foreign keys. Empty-database and previous-supported-snapshot runs, rollback/forward-fix, invariant/concurrency tests, expand/contract rollout, and the explicit no-first-migration gate are all binding. The one Next.js app route groups are structural organization only and cannot replace server authorization.

### Privacy, governance, providers, and operations — RESOLVED AS GATED

AD-21 blocks all production personal-data processing until Product plus qualified Privacy/Legal approval of the processing register and rights/lifecycle controls; Integrity telemetry has the additional consent, field-allowlist, evidence, promotion, and review gates. Guest Internal additionally has an explicit Product/Security/Privacy abuse-control activation gate. Form publication/moderation lifecycle transitions require Product/Research/Moderation plus Engineering approval and contract tests before schema/client generation. The documents make no unsupported legal-compliance claim.

Vercel plus Cloudflare/VPS are ratified product targets, while managed PostgreSQL, object storage, email providers, and regions remain explicit pre-production gates rather than fictional current deployments. Deployment/rollback, secrets, health/readiness, logs/correlation, alerts, incidents, encrypted backups, restore drills, RPO/RTO, and storage failure policy all have named approval gates.

## Remaining Medium Advisory

1. **Stale non-canonical overview:** `AGENTS.md` requires reading `PROJECT_SUMMARY.md`, but that file still describes Express and `IntegrityIncident` replacing FraudLog. It is outside the canonical authority chain and preserved outside this task's scope, yet remains an agent-divergence risk. Refresh it or add a prominent non-canonical/stale banner in a separate documentation task.

## Low Repository-Reality Advisories

- The frontend still uses `@types/node` major 20 while Node 22 is the target.
- Local Compose retains development credentials, an obsolete Compose `version`, and a floating `postgres:15-alpine` tag.
- npm workspaces, NestJS API/worker, Redis, object storage, CI, migrations, and contract tests do not exist. The architecture accurately marks them as target, conditional, or blocked work.

These are implementation/repository-hygiene items, not architecture holes.

## Good-Spine Checklist

| Dimension | Result | Review |
| --- | --- | --- |
| Real divergence points | **Pass** | Ledger, FormVersion, Attempt/Response, Outbox streams, sessions, reward policy, and cross-context money have one binding model. |
| Enforceable AD Rules | **Pass** | Rules name keys, state transitions, ownership, transactions, failure modes, and testable prevents. |
| Deferred safety | **Pass** | Redis rollout, Turbo, TrustEdge, graph/streaming/ML, frontend split, and microservices have measured triggers. |
| Technology/current fit | **Pass** | Existing versions are reality-labeled; Node 22 and one Prisma family are gated targets. |
| Brownfield ratification | **Pass** | Existing paths are preserved; absent code/migrations and non-conforming schema are explicit. |
| SPEC/PRD coverage | **Pass** | Canonical External, Integrity, privacy, versioning, reward, and platform requirements agree. |
| Authority/inheritance | **Pass** | Authority chain is explicit; V2 proposals are superseded/non-canonical; Solution and epics do not override Spine. |
| Operational/environmental envelope | **Pass as gated** | Providers, regions, deployment, recovery, observability, and approvals are decided or gated. |
| Security/privacy | **Pass** | Revocable sessions, CSRF/OAuth, evidence projections, storage, abuse profiles, and launch gates are binding. |
| Module/state ownership | **Pass** | Every priority durable record, audit, Outbox mechanic, migration boundary, and financial workflow has an owner. |

## Migration and Reality Gate

The current Prisma schema still lacks the ratified FormVersion, double-entry Ledger, revocable Session, transactional Outbox, Integrity lineage, and ownership constraints. No NestJS application or migration history exists. This is deliberately the next schema-design task and is not evidence of a current production system.

The next task may redesign `schema.prisma`, but must not generate or apply a migration until schema-contract, invariant, concurrency, replay, empty/upgrade-chain tests, and independent review pass.

## Final Recommendation

Accept and close the Architecture Update with **Critical 0, High 0**. The sole Medium advisory is the preserved, non-canonical `PROJECT_SUMMARY.md`; it requires no architecture decision and does not block schema modeling under the explicit no-migration gate.
