# RESCOM Current Architecture Rubric Review

**Review date:** 2026-08-16  
**Intent:** Independent BMAD architecture reviewer-gate validation  
**Reviewed artifact:** ARCHITECTURE-SPINE.md  
**Verdict:** **FAIL — not implementation-ready as a system architecture contract**  
**Architecture Health Score:** **4.8 / 10**

The spine is mechanically clean and its high-level direction is generally sound, but it cannot yet serve as a safe build substrate. The present Prisma schema contradicts or cannot represent several of the spine's most important adopted invariants: double-entry accounting, immutable Form Version linkage, consent-aware telemetry, reproducible assessment revisions, independent reliability and Survey Quality histories, assessment-based review, and TrustGraph projections. Authentication, privacy compliance, worker topology, module ownership, and the production operational envelope also remain materially under-specified.

Do not interpret the spine's frontmatter status of final as approval to migrate the current schema or implement production telemetry, rewards, or cookie authentication. Resolve the P0 items in this review first.

## 1. Scope and authority

### 1.1 Evidence reviewed

- Canonical SPEC: _bmad-output/specs/spec-rescom/SPEC.md
- Canonical PRD: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md
- Canonical PRD addendum: _bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/addendum.md
- Epics and stories: _bmad-output/planning-artifacts/epics.md
- Binding spine: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md
- Companion solution design: _bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md
- Both copies of RESCOM Architecture V2:
  - _bmad-output/planning-artifacts/architecture/RESCOM-Architecture-V2.md
  - RESCOM Architecture V2 — Research Integrity Engine 3b6c370d487e803eb34efd2299bd9bc3.md
- Current repository structure, package manifests and locks, frontend source, Docker Compose, Prisma configuration, and apps/backend/prisma/schema.prisma
- Current PROJECT_SUMMARY.md

The two V2 files are byte-identical at review time: both have SHA-256 09184c10c6001c61e32421b754a81910a956202038c6ec843bf6bce5c18dcd93. This proves current equality, not safe future co-ownership.

The SPEC explicitly declares itself and its companions to be the canonical preservation-validated contract. Where V2 conflicts with the SPEC, PRD/addendum, spine, or epics, the canonical contract wins.

### 1.2 Verification performed

- BMAD deterministic spine lint: **PASS**, zero findings.
- Prisma syntax validation: **PASS**. This proves only that Prisma accepts the schema, not that it satisfies business or architecture invariants.
- Installed backend package check: Prisma CLI 6.0.0, Prisma Client 6.0.0, and @prisma/config 7.9.1 are simultaneously installed.
- Installed frontend package check: Next.js 16.3.0 and React/React DOM 19.2.8.
- Frontend production build: **not proven** in the review environment because next/font attempted to fetch Geist from Google Fonts and the environment had no outbound access. The code compiled until that external fetch.
- No NestJS application source, backend controllers/use cases, migrations, automated tests, CI workflow, deployment manifest, backup configuration, monitoring configuration, or Redis service was found.

### 1.3 Insufficient-evidence boundaries

The following claims are **INSUFFICIENT EVIDENCE**, not verified:

- Actual Clean Architecture dependency direction or module isolation, because no backend source exists.
- Runtime API behavior, cookie security, RBAC, single-session enforcement, rate limiting, idempotency, row locking, or response envelopes.
- Published Form Version immutability and append-only Ledger/FraudLog enforcement.
- The 500 ms API target, two-second feed target, 99% uptime target, worker recovery, or horizontal-replica safety.
- Production Vercel/VPS/Cloudflare/Tailscale/S3/managed-PostgreSQL deployment, secret handling, backups, restore, logging, APM, or health checks.
- AI provider isolation and graceful failure in a running environment.
- Compliance with Vietnamese privacy law. The documents express intent but there is no approved processing inventory, impact assessment, retention schedule, cross-border assessment, data-subject rights flow, or legal review.

## 2. Scorecard

| Dimension | Score | Reviewer judgment |
| --- | ---: | --- |
| Paradigm and strategic direction | 8.0 | Modular monolith, PostgreSQL source of truth, optional AI, and deferred distributed infrastructure are appropriate. |
| Requirements coverage | 5.5 | Most integrity concepts appear in the spine, but Form Version, authentication/session, storage, audit, DR, and privacy mechanics are incomplete. |
| Documentation consistency | 4.0 | Canonical docs and the spine improve on V2, but both V2 copies and the schema still encode superseded behavior. |
| Data integrity | 2.5 | Ledger, Form Version, response uniqueness, telemetry, assessment revision, snapshot, review, and outbox invariants are not enforceable in the schema. |
| Security and privacy | 3.5 | Useful boundaries exist, but cookie authentication, session invalidation, CSRF, data rights, retention, and cross-border processing are unresolved. |
| Feasibility | 6.0 | The selected stack is feasible, but the all-at-once GO LIVE scope is not supported by the current near-empty implementation. |
| Maintainability | 5.5 | Clean Architecture and ownership intent are good; actual module boundaries, repository naming, and duplicated documents can diverge. |
| Scalability | 6.0 | Outbox, PostgreSQL, Redis, and modular-monolith choices scale adequately for the pilot, but claiming, retries, backpressure, and capacity assumptions are missing. |
| Production readiness | 2.5 | No operational contract for deploys, migrations, secrets, backups, restore, monitoring, alerts, or incident response. |

Composite result: **4.8 / 10**.

## 3. Good-spine rubric

| Rubric test | Result | Evidence and judgment |
| --- | --- | --- |
| Fixes the real divergence points for the level below | **FAIL** | Ledger shape, Form/Version identity, authentication/session state, cookie security, job topology, and module table ownership remain open to incompatible implementations. |
| Every AD Rule is enforceable and prevents its stated divergence | **FAIL** | AD-1 describes debit/credit but not the balanced journal/entry invariant; AD-9 and AD-11 are contradicted by the schema; AD-5 conflicts with worker deployment; AD-16 lacks one authoritative ownership map. |
| Nothing Deferred can cause incompatible implementation | **FAIL** | Distributed workers are deferred while V2 deploys a worker container and AD-17 requires multi-replica claiming. The worker/API topology must be decided now even if scale-out is deferred. |
| Named technology is current and reality-checked | **FAIL** | Repository versions were inspected, but Node and NestJS are unpinned; Prisma major families are mixed; Next.js 16.3 is treated as production despite the official release channel describing 16.3 as preview and 16.2.11 as Active LTS in July 2026. |
| Ratifies rather than contradicts brownfield reality | **FAIL** | The structural seed names apps/web, apps/api, packages/form-schema, and packages/integrity-contracts; the repo has apps/backend, apps/frontend/my-app, packages/schemas, packages/shared, and packages/types. Turborepo and Redis are not scaffolded. |
| Covers the capabilities of the driving SPEC | **FAIL** | The prose covers CAP-1 through CAP-7 conceptually, but the current data seed cannot represent CAP-1, CAP-2, CAP-3, CAP-4, CAP-6, or CAP-7 faithfully. |
| No inherited decision is weakened | **PARTIAL** | The canonical internal-only boundary and fraud separation are preserved in the spine, but the two V2 documents and current schema retain earlier contradictory models. |
| Every system-level dimension is decided, deferred, or questioned | **FAIL** | Secrets, deploy/migration strategy, backups/RPO/RTO, restore testing, health checks, alerts, incident response, object-storage ownership, email delivery, CSRF, and privacy-rights workflows are silent or only mentioned outside the spine. |

## 4. Findings by severity

### CRITICAL

#### C-01 — The current Ledger is not double-entry

**Conflict**

- AD-1 and PRD FR-30 require equal and opposite debit/credit entries and a balance derivable from immutable entries.
- apps/backend/prisma/schema.prisma:288 defines one LedgerTransaction row containing one userId, one balanceType, and one amount.
- The schema has no journal/header, no second side, no ledger account, no balanced-sum constraint, no currency/unit constraint, no reversal relation, and no database-level append-only protection.
- The unique idempotencyKey on the single row does not establish atomic double-entry accounting; using the same key for two rows would actually be prohibited.

**Impact**

Points can be created or destroyed without a counter-entry, and escrow/available/pending/frozen transfers cannot be proven balanced. This violates the platform's core economic invariant and makes audit, reconciliation, reversals, and incident recovery unreliable.

**Required disposition:** **MODIFY AD-1 and REPLACE the schema model before any Ledger migration.**

Define a transaction/journal header with a unique idempotency key and two-or-more immutable entries against explicit accounts. Require the sum of entries for a Point transaction to equal zero in one PostgreSQL transaction. Define reversal-by-new-transaction, lock ordering, allowed account/balance transitions, and database privileges or trigger controls that deny update/delete in production.

#### C-02 — Form Version identity and one-completion integrity are not enforceable

**Conflict**

- PRD FR-18, FR-25, FR-40, FR-58, and FR-62 require immutable Form Versions and exact response/version linkage.
- The spine has no dedicated adopted decision for the Form aggregate versus Form Version identity.
- The current Form model combines survey and version fields through parentFormId/versionNumber, but has no uniqueness constraint for a logical form and version.
- Response references formId, while SurveyAttempt also carries a nullable formVersionId that is not a foreign key.
- Neither Response nor SurveyAttempt has a database uniqueness constraint for one authenticated completion per survey.
- There is no database constraint or write path that prevents edits to a published Form/FormSchema.

**Impact**

Two stories can reasonably implement incompatible definitions of formId, surveyId, and formVersionId. Responses, telemetry, scoring, analytics, refunds, and Survey Quality can attach to different versions or be duplicated under concurrency.

**Required disposition:** **ADD a binding Form/Version AD and REPLACE the current version seed before migrations.**

Use an explicit logical Form/Survey record plus immutable FormVersion records with unique formId + versionNumber. Require Attempt, Response, event, signal, and Survey Quality data to reference FormVersion by foreign key. Define the authoritative uniqueness key for one completion at the logical survey level and handle guests separately.

#### C-03 — The canonical Integrity contract cannot be represented by the current schema

**Conflict**

AD-9 through AD-15 and SPEC CAP-1 through CAP-7 require durable and reproducible integrity data. The schema instead follows the older V2 proposal:

- IntegrityEvent has no clientEventId, responseId, receivedAt, or consent link; it deduplicates by attemptId + sequence; formVersionId is nullable.
- IntegrityConsent and IntegritySignal do not exist.
- Authenticated and guest applicability is inconsistent: Response allows a nullable respondent, but SurveyAttempt requires respondentId.
- IntegrityAssessment lacks evidenceCoverage, decision, applicability, status/pending state, assessmentRevision, assessedAt, a policy foreign key, and the unique responseId + policyVersion + revision invariant.
- ScoringPolicy lacks a checksum, retirement record, promotion approval/audit relation, and enforceable post-activation immutability.
- RespondentReputation is a mutable unique singleton rather than append-only RespondentReliabilitySnapshot history.
- SurveyQualitySnapshot does not exist.
- IntegrityReview is tied to IntegrityIncident, not the assessment/review workflow required by FR-65.
- TrustEdge does not exist.

Prisma syntax validation passes, but it cannot validate these semantic omissions.

**Impact**

CAP-1, CAP-2, CAP-3, CAP-4, CAP-6, and CAP-7 cannot be delivered without schema redesign. Retries can create irreproducible or duplicate assessments; guest behavior is contradictory; review labels cannot be traced to the assessment they adjudicate; and Publisher-safe projections lack a reliable source.

**Required disposition:** **REPLACE the V2 integrity seed with the canonical addendum model before migration/client generation.**

#### C-04 — Cookie authentication and single-session enforcement are architecturally contradictory

**Conflict**

- The spine convention states “Stateless JWT stored in HTTP-Only cookies.”
- PRD FR-3 requires a new login to immediately invalidate the prior device.
- AD-6 mentions Redis Session Management but defines no authoritative session record, token version, refresh-token rotation, or revocation path.
- No decision defines cookie Domain/Path, Secure, SameSite, Max-Age, credentialed CORS origins, CSRF defense, logout invalidation, secret/key rotation, or compromised-token response.
- User has one Role enum even though the product says the same person can act as Publisher and Respondent.

Strict immediate single-session invalidation requires server-observed mutable session state or a user session-version check; a completely stateless JWT cannot provide it.

**Impact**

Independent auth stories can build incompatible revocation schemes, insecure cross-origin cookie behavior, or a login flow that falsely claims immediate invalidation. Cookie-authenticated mutations are exposed to CSRF if same-site attributes and request validation are left implicit.

**Required disposition:** **MODIFY the authentication convention before Story 1.x implementation.**

Choose either a server-side session registry or a sessionVersion checked on every authenticated request; define access/refresh token lifetimes and rotation; use host-only Secure HttpOnly cookies unless a broader domain is explicitly justified; specify SameSite and exact credentialed CORS origins; and require CSRF protection for unsafe methods. Model Publisher/Respondent as capabilities or activities unless mutually exclusive roles are genuinely intended; keep ADMIN as a privileged authorization role.

#### C-05 — Production telemetry is blocked by an incomplete privacy architecture

**Conflict**

- AD-9 leaves retention to an open question; AD-18 protects projections but does not define data-subject rights or lifecycle.
- The PRD requires demographic, behavioral, response, device/context, relationship, and review data, plus appeal and deletion/access expectations.
- No binding decision covers lawful purpose inventory, consent withdrawal effects, purpose limitation, per-class retention and deletion/anonymization, legal holds, account deletion, subject access/export/correction, minor users, breach handling, cross-border processor inventory, encryption/key management, or privacy impact assessment ownership.
- Vercel, managed PostgreSQL, object storage, email, monitoring, and possibly AI providers may create cross-border transfers, but hosting regions and processors are not selected.

Vietnam's Law on Personal Data Protection 91/2025/QH15 is in force from 2026-01-01 according to the [official legal database](https://vbpl.moj.gov.vn/bocongan/Pages/vbpq-thuoctinh.aspx?ItemID=179252&Keyword=). Government guidance describes data-subject rights, processing and cross-border impact assessments, and continuing updates when processing changes: [Government policy summary](https://xaydungchinhsach.chinhphu.vn/quoc-hoi-da-thong-qua-luat-bao-ve-du-lieu-ca-nhan-119250626153701582.htm). It also describes notice, access, correction, deletion, privacy settings, and cross-border protections for online services: [Government implementation summary](https://xaydungchinhsach.chinhphu.vn/nhung-quy-dinh-dang-chu-y-trong-luat-bao-ve-du-lieu-ca-nhan-2025-119251225084154179.htm).

**Impact**

Collecting production telemetry before these decisions can create irreversible compliance and trust risk. “Consent-aware” storage alone is not a full privacy architecture.

**Required disposition:** **ADD a binding privacy/data-governance decision and keep production telemetry disabled until approved.**

Obtain qualified Vietnamese privacy/legal review; this architecture review is not legal advice.

### HIGH

#### H-01 — Module boundaries and state ownership have three competing maps

- The spine's design paragraph names Auth, Profile, Survey, Ledger, and Admin.
- Its structural seed names auth, users, surveys, points, ai, and integrity.
- V2 names Identity, Research, Participation, Integrity, Marketplace, Economy, Moderation, Analytics, Notifications, and AI.
- The solution design splits Integrity into integrity-events, integrity-signals, integrity-scoring, respondent-reliability, survey-quality, integrity-review, and trust-relations.
- V2 places review under both Integrity and Moderation, while the solution design gives integrity-review ownership.

AD-16 says each module exclusively owns state but does not identify one authoritative module for each table or transaction boundary. Two compliant teams can therefore both own Review or place Attempt/Response under Survey versus Participation.

**Action:** **MODIFY AD-16.** Adopt one bounded-context map and a table/write-ownership matrix. For GO LIVE, keep integrity components as internal submodules of one Integrity bounded context unless independent lifecycle/ownership proves separate Nest modules necessary.

#### H-02 — Background-job topology conflicts and the Outbox cannot safely claim work

- AD-5 says jobs run inside the main NestJS process.
- Deferred says distributed workers wait until traffic requires them.
- V2 deploys an API container and a Worker container from the same image.
- AD-17 and solution design require distributed claiming safe with two replicas.
- OutboxEvent lacks a uniqueness/deduplication key, lease owner, lease expiry, next-attempt timestamp, error record, dead-letter state, and explicit atomic claim contract.

**Action:** **MODIFY AD-5/AD-10/AD-17.** Use one backend codebase and image but choose a separate worker runtime process for production, even on one VPS, or explicitly accept API-embedded scheduling and its deployment/restart behavior. Specify PostgreSQL FOR UPDATE SKIP LOCKED or equivalent atomic leasing, retry/backoff, poison-message handling, idempotent handler keys, and observability.

#### H-03 — The production operational envelope is incomplete

Epics require secret management, structured logging/APM/health checks, daily backups, restore procedures, and RPO/RTO. The spine decides none of:

- deployment promotion and rollback;
- database migration ownership and compatibility;
- backup frequency, retention, encryption, restore testing, RPO, or RTO;
- health/readiness/liveness behavior;
- metrics, alerts, on-call/incident response, or log retention;
- secret injection and rotation;
- managed-PostgreSQL provider/region, pooling, connection limits, or failover;
- S3 bucket isolation, malware scanning, retention, and access;
- email provider/delivery failure and idempotency.

**Action:** Add an Operations AD set or explicit Deferred/Open gates with owners and deadlines. These are required before production, not optional documentation polish.

#### H-04 — Both V2 documents retain superseded rules and the schema follows them

Examples:

- V2 line 368 gives External responses an IntegrityAssessment with reduced confidence; SPEC lines 39–40 and AD-8 require NOT_ASSESSED.
- V2 lines 683–685 extend/replace FraudLog with IntegrityIncident; SPEC line 61 and AD-13 require separation.
- V2's event, assessment, reputation, review, and outbox model snippets are the structures currently copied into Prisma, but the canonical PRD addendum defines different entities and uniqueness rules.
- V2 deploys a Worker container while the spine says in-process main API jobs.

**Action:** Mark V2 explicitly superseded/non-binding, preserve it only for rationale, and maintain one canonical copy. Replace the other copy with a pointer or archive marker. Update the schema from the canonical SPEC/addendum, not from V2 snippets.

#### H-05 — Redis is simultaneously required, absent, and ambiguously authoritative

AD-6 requires Redis from Day 1 for Time Barrier, rate limiting, and Session Management. Docker Compose contains only PostgreSQL. Epics still list an in-memory Time Barrier NFR even though the PRD now says Redis.

More importantly, “caching Time Barrier state” leaves open whether Redis loss permits early completion, denies all submissions, or reconstructs from PostgreSQL. A cache must not become the sole authority for fraud-sensitive start time or session invalidation without an explicit durability decision.

**Action:** **MODIFY AD-6.** PostgreSQL owns durable Attempt start and session/revocation truth; Redis is derived cache, distributed rate-limit store, and lock/lease coordination. Define outage behavior per feature. Add Redis locally when the dependent story begins.

#### H-06 — The user authorization model conflicts with the product role model

The product says one user can act as both Publisher and Respondent, yet User.role is a single ADMIN/PUBLISHER/RESPONDENT enum. This makes normal marketplace participation mutually exclusive or encourages privilege mutation.

**Action:** Replace the single business-role concept with capabilities/activity state. A normal user may publish and respond; ADMIN is a privileged role/permission set. If multiple administrative roles are later needed, model assignments explicitly rather than overloading marketplace behavior.

#### H-07 — Technology version baseline is not production-safe

- Prisma CLI/Client 6.0.0 are mixed with @prisma/config 7.9.1. Local prisma validate succeeds, but the major-family mix remains unsupported as an architectural baseline and can break generation/migration/config behavior.
- Official Prisma documentation describes Prisma 7 as current and a different prisma/config plus driver-adapter setup: [Prisma ORM documentation](https://www.prisma.io/docs/orm) and [Prisma config reference](https://docs.prisma.io/docs/orm/reference/prisma-config-reference).
- The Next.js manifest pins 16.3.0, while the official July 2026 release feed calls 16.3 Preview and identifies 16.2.11 as Active LTS with security updates: [Next.js release feed](https://nextjs.org/blog).
- Node is unpinned. Node's official release table lists Node 24 as LTS and Node 20 as EOL in March 2026: [Node.js releases](https://nodejs.org/en/about/previous-releases).
- NestJS is unpinned/not installed. The current official branch is NestJS 11 and it requires Node 20 or newer, recommending the latest LTS: [NestJS migration guide](https://docs.nestjs.com/migration-guide).

**Action:** Before scaffolding, pin Node 24 LTS and one tested NestJS 11 release family; align all Prisma packages to one family and its documented config/adapter pattern; use an Active LTS/security-patched Next.js line unless the team explicitly accepts Preview risk.

#### H-08 — “Immutable” records have no enforcement boundary

Ledger, Integrity events, policies, assessments, Form Versions, audit records, and FraudLog are repeatedly called immutable. Prisma models and a service convention do not prevent an accidental update/delete, direct SQL, or cross-module repository from violating that rule.

**Action:** Define how immutability is enforced: repository API restrictions, database roles/privileges, triggers where justified, append-only tables, and migration-only alteration. Define reversal/correction records rather than mutation. Add tests that attempt forbidden updates/deletes.

#### H-09 — The GO LIVE scope is overcommitted relative to current capacity evidence

The PRD deliberately keeps all existing features and adds the full Integrity Engine, TrustGraph-ready projections, Form Builder, optional AI, economy, moderation, analytics, gamification, notifications, and admin tooling. The repo currently has no backend application logic and only a default Next.js page.

This is delivery over-engineering, not technology over-engineering: the architecture avoids Kafka/Kubernetes/graph databases correctly, but the MVP still contains too many simultaneously critical domains to validate safely.

**Action:** Preserve the target architecture but stage delivery in vertical releases. Foundation first: identity/security, Form/Version, Response/Attempt, and real double-entry Ledger. Then external marketplace; then internal forms; then SHADOW-only telemetry/scoring; then review/reliability/quality; then TrustGraph projections. Do not move policy beyond SHADOW without governance evidence.

#### H-10 — Object storage and upload security are requirements but absent from the spine

The PRD includes file-upload blocks and S3-compatible storage; epics require type/size validation, signed URLs, and possibly malware scanning. The spine diagram, Stack, structural seed, ADs, and Deferred section omit storage ownership and threat boundaries.

**Action:** Add a storage boundary decision: object key ownership, upload-init/finalize flow, allowlisted MIME/extensions, size limits, server-side validation, quarantine/scanning policy, encryption, signed URL TTL, deletion/retention, and environment/bucket isolation.

### MEDIUM

#### M-01 — Structural seed contradicts the repository

The seed says apps/web and apps/api, while the actual repo has apps/backend and apps/frontend/my-app plus an unused apps/frontend/package.json. Shared-package names also differ. This is likely to cause imports, CI filters, Docker paths, and ownership docs to diverge.

**Action:** Ratify actual paths or make one explicit, atomic restructure before feature work. Add root workspaces/Turborepo only after the desired final paths are settled.

#### M-02 — “UUIDv4 or NanoID” is not a convention

The spine permits either UUIDv4 or NanoID, V2 examples use cuid, and Prisma foreign keys are PostgreSQL UUID. Two teams can comply and still create incompatible IDs.

**Action:** Pick UUID for database entities to match current PostgreSQL/Prisma fields. Treat public identifiers as opaque strings at API boundaries. Introduce a separate public NanoID only when a concrete enumeration/security need justifies it.

#### M-03 — API and event compatibility rules are too thin

REST JSON and a data/error/meta envelope do not decide API versioning, pagination, error codes, idempotency headers, optimistic concurrency, event schema evolution, backward compatibility, or deprecation. NFR-30 requires paginated integrity queries.

**Action:** Add concise conventions for route/version policy, stable machine error codes, cursor pagination, idempotency-key semantics, event type/schema versioning, and compatibility tests.

#### M-04 — No capacity assumptions or load-shedding rules

The architecture selects suitable pilot technology but gives no assumptions for concurrent survey sessions, events per response, event batch size, retention volume, outbox throughput, database growth, connection limits, or review backlog.

**Action:** Add measurable pilot envelopes and thresholds that trigger partitioning, worker separation/replicas, Redis changes, or analytics offloading. Do not add new infrastructure until a threshold is crossed.

#### M-05 — Integrity is over-modularized in the companion design

Seven separately named Integrity modules can create excessive ports/events/transactions before the domain exists. The important boundary is Integrity versus Participation/Economy/Moderation, not necessarily a Nest module per data type.

**Action:** Start with one Integrity bounded context containing internal components for events, signals, scoring, reliability, quality, review integration, and trust projections. Split only when independent ownership, deployment, or complexity is measured.

#### M-06 — Event data minimization is a prose rule, not a contract

IntegrityEvent.metadata is unrestricted JSON. The event enum includes answer-entered and semantic events, which can encourage raw response or sensitive-text duplication in telemetry.

**Action:** Use discriminated, allowlisted Zod payloads per event type; cap payload size; prohibit answer content and raw keystrokes in telemetry; separate answers from telemetry storage; and test Publisher/Admin projections against field-level allowlists.

#### M-07 — Frontend build reproducibility depends on an external font fetch

The default layout uses next/font Google Geist. The production build failed in the offline review environment solely because it could not reach fonts.googleapis.com.

**Action:** For reproducible builds and a smaller external dependency surface, self-host the approved fonts or ensure the build environment intentionally permits and pins the fetch. This does not block architecture work.

### LOW

#### L-01 — Spine traceability metadata is stale

The spine frontmatter lists rescom.md and prd.md as sources, while rescom.md is deleted and the actual canonical source set includes SPEC, PRD addendum, epics, and V2 rationale.

**Action:** Update source and companion metadata in the next architecture update.

#### L-02 — Two identical V2 files are an avoidable future split-brain

The copies are equal today, but both look authoritative and neither points to the other.

**Action:** Keep one narrative source and replace/archive the duplicate with a clear pointer and supersession notice.

## 5. Documentation versus implementation mismatch matrix

| Contract requirement | Document evidence | Current implementation evidence | Result |
| --- | --- | --- | --- |
| Double-entry immutable Ledger | AD-1; PRD FR-30 | One single-sided LedgerTransaction model | **CONTRADICTED** |
| Exact immutable Form Version links | PRD FR-18/40/58/62 | Response links Form; Attempt has nullable non-FK formVersionId | **CONTRADICTED** |
| One completion per account per survey | PRD FR-25 | No database unique constraint | **MISSING** |
| Consent notice/version | AD-9; FR-58 | No IntegrityConsent or consent fields | **MISSING** |
| Client event ID deduplication | SPEC CAP-1; NFR-23 | Deduplication is attemptId + sequence | **CONTRADICTED** |
| Event links to Response and Form Version | AD-9; FR-58 | No responseId; formVersionId nullable and not related | **CONTRADICTED** |
| Server receipt timestamp | AD-9 | createdAt exists, but no explicit receivedAt contract | **WEAK / INDIRECT** |
| Immutable derived signals | CAP-2 | No IntegritySignal model | **MISSING** |
| Reproducible assessment revision | AD-11; FR-59/63 | No coverage, decision, status, revision, or uniqueness | **CONTRADICTED** |
| Neutral cold start and reliability snapshots | AD-12; FR-60/61 | Mutable RespondentReputation singleton | **CONTRADICTED** |
| Survey Quality per Form Version | CAP-4; FR-62 | No model | **MISSING** |
| Review of assessment, separate from FraudLog | AD-13/14; FR-65 | Review belongs to IntegrityIncident; no FraudLog model | **CONTRADICTED** |
| Relational TrustGraph projection | AD-15; CAP-7 | No TrustEdge model | **MISSING** |
| Transactional outbox | AD-10 | Generic OutboxEvent exists | **PARTIAL** |
| Safe concurrent job claim | AD-17 | No lease/claim contract or code | **MISSING** |
| Redis Day 1 | AD-6 | No dependency/config/service | **MISSING** |
| NestJS modular monolith | Paradigm/Stack | Backend contains only Prisma packages | **NOT IMPLEMENTED** |
| Turborepo monorepo | Paradigm/Stack | No workspace/turbo configuration | **NOT IMPLEMENTED** |
| Shared Form/Integrity contracts | AD-2/AD-9 | Shared package directories empty/absent under different names | **NOT IMPLEMENTED** |
| Secure file storage | PRD/Epics | No storage code or architecture decision | **MISSING** |
| Production DR/observability/secrets | Epics NFR-ADD-3/4/5 | No configs or binding ADs | **MISSING** |

## 6. Major-decision disposition

| Decision | Disposition | Reason |
| --- | --- | --- |
| Clean Architecture + Modular Monolith | **KEEP** | Appropriate for the team and pilot; avoids premature services. |
| PostgreSQL as system of record | **KEEP** | Supports transactions, outbox, relational projections, and pilot scale. |
| Prisma | **KEEP** | Feasible, but align one major family and add SQL-level constraints/migrations where Prisma cannot express invariants. |
| Shared Zod Form/Integrity contracts | **KEEP** | Prevents frontend/backend/event drift. |
| Optional AI through a provider and Tailscale | **KEEP** | Correct isolation and failure boundary. |
| Internal-only full Integrity Engine | **KEEP** | Matches the canonical SPEC and available evidence. |
| Pure/versioned scoring and progressive policy | **KEEP** | Strong reproducibility and safety model. |
| Relational TrustGraph first | **KEEP** | Avoids premature graph infrastructure. |
| No Kafka/Kubernetes/feature store/graph DB in MVP | **KEEP** | Correctly avoids technology over-engineering. |
| AD-1 Ledger | **MODIFY** | Tighten to journal/accounts/entries/balance/reversal/immutability invariants. |
| AD-5 in-main-process jobs | **MODIFY** | Choose one production topology; recommended same image/codebase with a separate worker process. |
| AD-6 Redis | **MODIFY** | Redis must not be the sole authority for Attempt/session correctness; define outage behavior. |
| AD-9/10 telemetry and outbox | **MODIFY** | Add exact uniqueness, lifecycle, claim, retry, and privacy constraints. |
| AD-16 module ownership | **MODIFY** | Add a single context and table/write-ownership map. |
| Stateless JWT cookie convention | **REPLACE** | Use revocable/session-versioned cookie authentication with explicit CSRF/CORS/cookie rules. |
| Current LedgerTransaction model | **REPLACE** | It is single-sided and cannot prove conservation. |
| Current Form self-version seed | **REPLACE** | Use explicit Form plus immutable FormVersion. |
| Mutable RespondentReputation and incident-based review | **REPLACE** | Use canonical snapshots and assessment-linked IntegrityReview; keep FraudLog separate. |
| Single PUBLISHER/RESPONDENT Role enum | **REPLACE** | Publishing/responding are simultaneous capabilities, not exclusive roles. |
| V2 reduced-confidence External assessment | **REMOVE** | Canonical contract says NOT_ASSESSED. |
| V2 “IntegrityIncident replaces FraudLog” | **REMOVE** | Canonical contract requires strict separation. |
| “UUIDv4 or NanoID” choice | **REMOVE** | A two-option convention permits incompatible persistence. |
| Duplicate V2 authority | **REMOVE** | Keep one clearly non-binding rationale copy. |

## 7. Recommended optimized architecture

This recommendation preserves the chosen stack and avoids a rewrite.

### 7.1 Runtime and repository

- One monorepo with one authoritative path scheme. Ratify apps/backend and a single frontend app path, then configure root workspaces/Turborepo.
- One NestJS 11 modular-monolith codebase and Docker image.
- Run API and worker as separate processes/commands from that image in production; allow a single worker replica initially.
- Managed PostgreSQL is authoritative.
- Redis is a derived cache, rate-limit store, and coordination/lease store; never the sole source for Attempt start, financial state, or session revocation.
- S3-compatible storage is isolated by environment and accessed through an explicit upload-init/finalize/quarantine flow.
- AI remains an optional adapter accessed over Tailscale.

### 7.2 Authoritative bounded contexts

1. Identity — User, credentials/OAuth, sessions, admin authorization, demographic profile.
2. Research — logical Form/Survey, immutable FormVersion, targeting.
3. Participation — SurveyAttempt, Response, submission lifecycle, one-completion rule.
4. Economy — Ledger accounts, journals/transactions, entries, escrow, wallet projections, settlement.
5. Integrity — consent, telemetry, signals, policies, assessments, reliability snapshots, Survey Quality snapshots, review integration, TrustGraph projections.
6. Moderation — survey moderation, external-form disputes, FraudLog/security incidents, and the human workflow boundary that invokes Integrity Review ports.
7. Marketplace — eligibility, matching, ranking; reads safe projections only.
8. Analytics/Notifications — read models and delivery; no ownership of source domain state.
9. AI — form generation and optional semantic signal adapter; never policy authority.

Within Integrity, start with internal components rather than seven separately autonomous Nest modules.

### 7.3 Minimum persistence corrections

- Form plus FormVersion with unique version and published immutability.
- Response and Attempt foreign keys to FormVersion; explicit logical-survey completion uniqueness.
- LedgerAccount, LedgerTransaction/Journal, and LedgerEntry with atomic zero-sum posting and reversal records.
- IntegrityConsent linked to Attempt/Response and notice/purpose version.
- IntegrityEvent with responseId, formVersionId, clientEventId, receivedAt, occurredAt, schema version, and unique responseId + clientEventId.
- IntegritySignal with immutable signal definition/version and evidence-availability state.
- IntegrityPolicy with immutable definition/checksum/version and audited promotion records.
- ResponseIntegrityAssessment with applicability, status, score, confidence, evidence coverage, safe reason codes, decision, policy version, revision, and unique response + policy + revision.
- Append-only RespondentReliabilitySnapshot and SurveyQualitySnapshot.
- IntegrityReview linked to Assessment with append-only outcome/label and idempotent Ledger action reference.
- FraudLog/security incident separate from Integrity assessments.
- Typed, versioned, rebuildable TrustEdge projection.
- Outbox with unique event/idempotency identity, atomic lease, retries/backoff, last error, and terminal/dead-letter handling.

### 7.4 Security and privacy baseline

- Revocable/session-versioned cookie authentication; explicit Secure, HttpOnly, host-only Domain, Path, SameSite, TTL, refresh rotation, logout, and key rotation.
- Exact credentialed CORS allowlist plus CSRF protection for unsafe cookie-authenticated methods.
- ADMIN permissions separated from ordinary publishing/responding capabilities.
- Field-level safe projections; no generic serialization of Prisma Integrity records.
- Per-data-class retention and deletion/anonymization rules; subject access/correction/deletion/export and consent-withdrawal workflows.
- Approved processing/cross-border impact assessment, processor/region inventory, incident/breach handling, encryption, audited evidence access, and minor-user policy before production telemetry.

### 7.5 Operational baseline

- Pin Node 24 LTS, a tested NestJS 11 release family, one Prisma release family, and an Active LTS/security-patched Next.js line.
- Versioned database migrations with expand/contract rules, pre-deploy checks, rollback/forward-fix policy, and restore-tested backups.
- Health/readiness endpoints; structured logs with correlation IDs; metrics and alerts for API, outbox, assessment, Ledger, storage, and access control.
- Define RPO, RTO, backup retention, restore-drill cadence, secrets rotation, deploy rollback, and incident ownership.
- Establish pilot capacity assumptions and thresholds before adding partitions, queues, streaming, or new databases.

## 8. Prioritized changes required before continuing development

### P0 — Architecture/schema blockers

1. Declare the canonical source order and mark both V2 documents superseded; retain one narrative copy only.
2. Update the spine with binding decisions for Form/Version identity, completion uniqueness, auth/session/cookie/CSRF, Ledger posting, worker topology, and one authoritative module/table ownership map.
3. Replace the current Prisma seed with the canonical Form Version, double-entry Ledger, Integrity consent/event/signal/assessment/snapshot/review/TrustEdge, and claimable Outbox contracts.
4. Keep FraudLog/security incidents separate from Integrity assessment/review.
5. Resolve ordinary user capabilities versus ADMIN authorization.
6. Approve privacy purposes, retention, rights, cross-border processing, and legal gates; keep production telemetry off until complete.
7. Align all Prisma packages, pin Node/Nest, and choose an Active LTS/security-patched Next.js baseline before scaffolding.

### P1 — Foundation implementation gates

8. Ratify repository paths and add workspaces/Turborepo, Redis local service, NestJS scaffold, shared Zod packages, migrations, and CI.
9. Implement database-level and application-level invariant tests: Ledger zero-sum, append-only restrictions, Form Version immutability, one completion under concurrency, event deduplication, assessment revision idempotency, outbox recovery, and safe projections.
10. Decide S3 upload security, email delivery, secrets, observability, deployment, migration, backup, RPO/RTO, and restore testing.
11. Build vertical slices in dependency order; do not implement TrustGraph or advanced integrity projections before the authoritative Form/Response/Ledger/telemetry foundations.

### P2 — Controlled rollout

12. Launch scoring in SHADOW only; collect monitoring and reviewed calibration labels.
13. Add reliability and Survey Quality only after eligibility/minimum-evidence rules are approved.
14. Add TrustGraph projections only after authoritative relations are stable.
15. Advance to ADVISORY or ENFORCED only after policy ownership, appeal, fairness/cohort review, and idempotent reward-hold/release tests pass.

## 9. Final gate decision

**Gate result: FAIL.**

The target architecture is recoverable without changing the core stack. Keep the modular monolith, PostgreSQL, Prisma, Zod, optional AI, transactional outbox, and relational TrustGraph direction. The required work is to make the key invariants concrete, remove superseded V2 contracts, correct the schema before migrations, and add the missing security/privacy/operations decisions.

The next architecture update should be re-reviewed against this report. A passing gate requires:

- no critical contradictions between canonical requirements, spine, solution design, and Prisma;
- exact, enforceable Form Version, Ledger, Integrity, auth, and Outbox contracts;
- one module/table ownership map and one worker topology;
- approved privacy and production operational gates;
- one compatible, supported package baseline; and
- implementation evidence or explicit “target/not yet implemented” wording for every stack/runtime claim.
