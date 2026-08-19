---
title: RESCOM Architecture Convergence Status
status: final
updated: 2026-08-16
scope: Canonical requirements, architecture documents, and repository reality
---

# RESCOM Architecture Convergence Status

## Authority Applied

1. `_bmad-output/specs/spec-rescom/SPEC.md`
2. Final `prd.md` plus approved `addendum.md`
3. `ARCHITECTURE-SPINE.md`
4. `solution-design.md`
5. `epics.md`
6. Repository reality as brownfield evidence and structural seed

Both files titled `RESCOM Architecture V2 — Research Integrity Engine` are **superseded, non-canonical historical proposals**. They remain in place for rationale only and now carry explicit warning banners. Archive/deduplication is a separate repository-cleanup action; neither copy is an implementation or schema authority.

## Repository Reality Preserved

- Existing paths `apps/backend` and `apps/frontend/my-app` are ratified; no bulk rename was performed.
- The frontend is a Next.js 16.3.0 / React 19.2.8 starter, not a completed application.
- The backend has Prisma configuration/schema only; NestJS API/worker source, tests, and migrations do not exist.
- Root npm workspaces, shared package manifests, CI, Redis, object storage, API, and worker are targets/conditional dependencies, not implemented reality.
- Local Compose contains PostgreSQL 15 only.
- `prisma` and `@prisma/client` are 6.0.0 while `@prisma/config` is 7.9.1; one family must be selected and configured through that major's public `prisma/config` contract before generation/migration.
- The current Prisma schema is syntactically valid but non-conforming. No migration history is present in the repository and live database state is not evidenced. It was not edited in this Architecture Update and must not be promoted through `db push` or a first migration.

## Conflict Resolution Matrix

| Prior conflict | Canonical resolution | Binding location |
| --- | --- | --- |
| External responses assessed with reduced confidence | External is always `NOT_ASSESSED` by the full engine | AD-8; PRD FR-67 |
| IntegrityIncident replaces FraudLog | Integrity assessment/review and security FraudLog remain separate | AD-13; ownership map |
| In-process-only jobs versus independent worker service | One NestJS codebase/image; production API + worker entrypoints; explicit local co-location | AD-5, AD-17 |
| Redis required from Day 1 | Redis is conditional ephemeral infrastructure; PostgreSQL keeps durable authority | AD-6; PRD NFR-4 |
| Stateless cookie JWT versus immediate invalidation | Short-lived cookie JWT bound to PostgreSQL Session; rotating refresh and revocation | AD-20; PRD NFR-6 |
| Strict four layers for every feature | Inward dependency direction plus mandatory ports at invariant/external seams; simple local CRUD allowed | AD-7 |
| Turborepo as architecture invariant | npm workspaces first; Turbo deferred to measured build-orchestration need | AD-2; Deferred |
| Four frontend deployments/apps | One initial Next.js app; split only on measured isolation need | Structural Seed; Deferred |
| Self-referencing Form rows as versions | Logical Form plus separate immutable FormVersion | AD-19 |
| Single-sided LedgerTransaction | LedgerAccount + LedgerJournal + balanced LedgerEntry records | AD-1 |
| Generic/retry-unsafe Outbox | Transactional event identity, aggregate version, PostgreSQL lease, retry/dead-letter, handler dedupe | AD-10, AD-17 |
| Score and business action in one assessment | Immutable assessment revision plus separate immutable IntegrityDecision | AD-11, AD-14 |
| IntegrityEvent as a mixed domain bus | Only allowlisted consented behavioral telemetry; domain facts use owned records/events | AD-9 |
| Seven deployable Integrity modules | One Integrity bounded context with internal signal/scoring/reliability/quality/review components | AD-16; ownership map |
| Immediate TrustGraph implementation | TrustEdge is a deferred rebuildable projection behind a measured trigger | AD-15 |
| Cross-context money dual writes/partial failure | Named workflow coordinators use a shared Unit of Work for atomic pairs or source+Outbox with stable Economy command IDs and explicit terminal recovery | AD-16; financial workflow map |

## Load-Bearing Contract Coverage

| Contract | Architecture result | Schema status |
| --- | --- | --- |
| Double-entry Point conservation | Zero-sum journal/unit, 2+ entries, no-overdraft account policy, ordered balance-row locking, atomic projection update, exact linked reversal, unique command, Economy-only writer | Current schema contradicts; redesign next |
| Form/Version/Attempt/Response identity | Explicit FormVersion, unique version, published immutability, eligible start creates reservation + Attempt + IN_PROGRESS Response, logical-Form completion, key-versioned FormVersion-scoped External Completion Code | Current schema contradicts; redesign next |
| Session/cookie security | PostgreSQL session authority, ≤15-minute access JWT, rotating hashed refresh, CORS/CSRF/cookie/audit contract | No implementation; design schema next |
| Transactional Outbox | Same transaction, independent reward/assessment events, unique identity, complete named ordering stream/contiguous sequence where needed, aggregate version as domain metadata, fenced lease, backoff, dead-letter, atomic local effect/handler dedupe | Current schema incomplete; redesign next |
| Integrity lineage | Consented events, separate signals/assessment revisions/decisions/snapshots/review, External non-applicability | Current schema contradicts; redesign later in sequence |
| Module writes | One authoritative bounded-context and durable-record ownership map | No backend modules yet; enforce during scaffold/schema |
| Privacy/governance | No production personal-data processing until the qualified review gate; Integrity telemetry has additional consent/allowlist/governance gates; no legal-compliance claim | Human approvals remain open |
| Object storage | Private environment-isolated adapter, durable technical object/quarantine/clean/attachment state, split metadata/attachment ownership, authorize/finalize/validate/signed access/lifecycle | Provider and scanning policy open before upload work |

## Health-Review Finding Disposition

The 4.2/10 health report remains an immutable validation snapshot; it is not rewritten to imply implementation improved. This Update changes the document-side disposition:

### Addressed in the architecture contract

- **C-01 split authority:** resolved by an explicit chain and V2 supersession banners.
- **C-02 Ledger ambiguity:** resolved in AD-1; the schema remains the next blocked task.
- **C-03 Form/version identity:** resolved in AD-19; the schema remains the next blocked task.
- **C-04 Integrity/Outbox ambiguity:** resolved across AD-9 through AD-17; implementation remains absent.
- **C-05 privacy governance:** converted into an enforceable production personal-data gate plus an additional Integrity-telemetry gate in AD-21, with named approval categories still open.
- Worker topology, Redis authority/outage, session revocation, pragmatic dependency boundaries, module ownership, and object storage are now explicit.

### Rejected or lowered after verification

- **Mandatory Turborepo absence** is no longer an architecture failure: npm workspaces are sufficient first; Turbo is deferred.
- **Missing Redis in the vertical slice** is lowered from a foundation blocker to a measured-trigger dependency. Durable security/workflow state never relies on it.
- **Four separate frontend applications** are rejected as a starting invariant; one existing Next.js app is ratified.
- **Four physical Clean Architecture layers for every CRUD feature** are rejected as unnecessary ceremony; the dependency rule remains at real seams.
- **Next.js 16.3.0 as an architecture blocker** is rejected. It is real repository state; supported patch selection belongs to manifests and security maintenance, not the Spine.
- **A separate worker as a microservice rewrite** is rejected. API and worker are processes from one modular-monolith artifact.

### Still blocked by implementation evidence, not an unresolved architecture choice

- Prisma schema conformance and database-level invariants
- One compatible Prisma package family
- npm workspace and shared contract packages
- NestJS API/worker scaffold and boundary tests
- Migration, isolated test database, CI, replay/concurrency/security tests
- Managed PostgreSQL/object-storage/email providers and regions, deployment, observability, backup/restore, RPO/RTO, and legal/privacy evidence; Vercel plus Cloudflare/VPS remain final-PRD targets rather than deployed reality

## Remaining Human Gates

- Product + qualified Privacy/Legal: purpose/register, data classes, retention/deletion/anonymization, subject rights/withdrawal, minor-user posture, processors/regions, and incident/legal-hold rules.
- Product + Integrity Governance: policy promotion owner, calibration/cohort evidence, rollback, and audit criteria.
- Product + Research: Survey Quality evidence threshold, aggregation/linkability, and export fields.
- Operations/Admin: Integrity review/appeal owner, access policy, and turnaround expectations.
- Operations: confirm the PRD Vercel plus Cloudflare/VPS targets; select managed PostgreSQL, storage/email providers and regions; approve deployment/rollback, secrets, backup retention, restore cadence, RPO/RTO, alerting, and incident ownership.
- Operations + record owner/Privacy: storage scanning/quarantine/release/outage/cleanup policy and data classification/retention before production upload.
- Product + Security + Privacy: Guest Internal abuse-control artifact before shared/production enablement.
- Product/Research/Moderation + Engineering: explicit Form publication/moderation state-transition contract before schema/client generation.

These do not block local foundation architecture/schema design. The qualified Privacy/Legal gate blocks all production personal-data processing; the additional telemetry gate blocks production Integrity collection. The remaining gates block Publisher-visible Survey Quality, promotion beyond `SHADOW`, review routing, or production-readiness claims as named above.

## Next Schema Gate

The next run may redesign `apps/backend/prisma/schema.prisma` against AD-1, AD-9 through AD-22, and the ownership map. It must not create a migration until:

1. schema-contract tests cover zero-sum/no-overdraft/concurrent Ledger posting and one-reversal-per-journal chains, FormVersion immutability/linkage and publication/moderation transitions, eligible Internal/External Attempt/reservation plus IN_PROGRESS Response identity, logical completion and key-versioned constant-time/no-log FormVersion Completion Code, session revocation/refresh/CSRF bootstrap identity, event/outbox and scheduled-job deduplication, complete-stream ordering/dead-letter-gap disposition and fenced claim recovery, atomic handler effect, provider reconciliation, independent reward/scoring plus fail-open hold paths, cross-context money coordinators, durable storage quarantine states, assessment revision lineage, guest applicability, and append-only restrictions;
2. an independent architecture/data/security review reports no unresolved Critical finding; and
3. the Prisma package family and isolated test-database strategy are agreed.
