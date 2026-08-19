# Current-Version and Repository-Reality Review

**Reviewer lens:** Verify every committed architecture decision was web-researched or reality-checked rather than asserted from training data; check current versions, existence/fit of named technologies, live starter defaults, repository manifests/source/schema, and documentation-authority conflicts.

**Reviewed:** 2026-08-16 (Asia/Ho_Chi_Minh)  
**Primary target:** `ARCHITECTURE-SPINE.md`  
**Repository evidence:** root and app manifests/lockfiles, `docker-compose.yml`, `apps/backend/prisma/schema.prisma`, current source tree, architecture memlog, PRD/addendum, epics, solution design, and `PROJECT_SUMMARY.md`  
**Method:** repository inspection plus live npm registry checks and primary official documentation only for version/current-fit claims.

## Verdict

**FAIL — the technology families are real and generally suitable, but the finalized spine is not yet ratified by the brownfield repository and several adopted data invariants are contradicted by the current Prisma schema.** No technology rewrite is justified. The immediate work is to align the existing scaffold and authoritative documents with the decisions already made, then prove the invariant-bearing schema and runtime paths.

Evidence quality is uneven. The architecture memlog records repository-observed versions and decisions, but contains no web-source URLs or reproducible version-check output. This review supplies current primary-source checks; claims that depend on deployment, hardware, or unimplemented behavior remain **INSUFFICIENT EVIDENCE**.

## Severity Summary

| Severity | Count | Summary |
| --- | ---: | --- |
| CRITICAL | 2 | Ledger and Research Integrity invariants are not represented by the current authoritative schema. |
| HIGH | 4 | The monorepo/backend/cache substrate is target-only; Prisma is split across incompatible release families; runtime is unpinned; production security/deployment claims are unproven. |
| MEDIUM | 4 | Architecture source authority is stale; current starter paths/defaults do not match; PostgreSQL production seed is unspecified; AI model/hardware fit is unproven. |
| LOW | 2 | Next.js is one patch behind the live latest; UUID/NanoID convention is looser than repository reality. |

## Findings

### CRITICAL-1 — AD-1 is contradicted by the current ledger schema

`LedgerTransaction` is a single user/balance/amount row. It has no transaction header, account/entry sides, balancing group, or database constraint capable of proving equal and opposite entries. Its `idempotencyKey` prevents duplicate rows only; it does not make a group balance to zero. The schema also does not enforce append-only behavior. This contradicts AD-1, PRD FR-30, and Story 6.1, which require equal and opposite entries and immutable accounting.

**Reality evidence:** `apps/backend/prisma/schema.prisma` (`LedgerTransaction`); `_bmad-output/planning-artifacts/epics.md` Story 6.1.  
**Disposition:** **MODIFY before ledger implementation.** Represent a transfer and its entries explicitly, add balance/integrity constraints at the database boundary, and define how append-only is enforced. Prisma `$transaction` can make writes atomic but cannot by itself prove double-entry balance.

### CRITICAL-2 — AD-9 through AD-15 are only partially reflected in the current schema

The schema contains useful initial models, but misses invariant-bearing fields/entities named by the adopted decisions and approved addendum:

- `IntegrityEvent` has no `clientEventId`, server `receivedAt`, or consent-notice version; uniqueness is `(attemptId, sequence)`, not the required client-event identity.
- `IntegrityAssessment` has no revision identity/uniqueness, applicability state, evidence coverage, or decision field. The explicit `NOT_ASSESSED`, `NOT_AVAILABLE`, `INSUFFICIENT_EVIDENCE`, and `UNESTABLISHED` states do not exist.
- `OutboxEvent` has no uniqueness/idempotency constraint tying one assessment request to one submitted response.
- No TrustEdge/rebuildable trust-projection model exists despite AD-15 and Story 10.8.
- `RespondentReputation` requires numeric score/confidence, so it cannot represent the mandated neutral cold-start state without an undocumented sentinel.

This is not merely “implementation pending”: `PROJECT_SUMMARY.md` calls the schema full, and the implementation-readiness report says it matches the domain entities. Those readiness claims are false against the current file.

**Disposition:** **MODIFY before migration or Implementation Readiness.** Align the schema with the adopted contracts or explicitly mark the schema as a non-authoritative draft. Do not infer missing semantics from JSON columns.

### HIGH-1 — The adopted Turborepo/NestJS/Redis/shared-package substrate does not exist

Repository reality is an npm root package with no `workspaces`, no `turbo.json`, and independent app lockfiles. Turborepo is not installed. The only frontend app is nested at `apps/frontend/my-app`; the backend has Prisma only and no NestJS, TypeScript build, controllers, modules, or tests. `packages/` has no package manifests or Zod contracts. Redis has no image, client, configuration, or code.

Official Turborepo documentation says a valid multi-package setup needs package-manager workspaces, a root lockfile, root `package.json`, root `turbo.json`, and a `package.json` in every package; the maintained basic starter uses `apps/web`, `apps/docs`, and shared packages. The current repository meets only the broad folder idea, not the live starter or minimum workspace contract. See [Turborepo repository structure](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository), [official basic starter](https://github.com/vercel/turborepo/blob/main/examples/basic/README.md), and [`create-turbo`](https://turborepo.dev/docs/reference/create-turbo).

**Disposition:** **MODIFY wording immediately:** these are adopted targets, not existing architecture. Before the first backend story, establish one root package manager/workspace contract and reconcile actual paths with the structural seed. **KEEP** NestJS, Redis, Zod, and Turborepo as choices; their fit is confirmed below.

### HIGH-2 — Prisma is split between v6 and v7 release families

The backend installs `prisma@6.0.0`, `@prisma/client@6.0.0`, and `@prisma/config@7.9.1`. The live registry reports Prisma `7.9.1` as current GA. Current Prisma configuration is imported from `prisma/config` and Prisma 7 changes client generation, driver adapters, configuration, seeding, and runtime requirements. See the [Prisma 7 upgrade guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7), [current config reference](https://docs.prisma.io/docs/orm/reference/prisma-config-reference), and [current getting-started status](https://docs.prisma.io/docs/getting-started).

`npx prisma validate` succeeds locally under Node `22.18.0`, proving only that the present v6 CLI can parse the current schema in this installed tree. It does not prove migration, generation, runtime client behavior, CI reproducibility, or support for the v7 config package.

**Disposition:** **MODIFY before generation/migration.** Select one release family and use its documented configuration/runtime model end to end. A rewrite or ORM replacement is not justified.

### HIGH-3 — No runtime version contract exists

The repository has no `engines`, `.nvmrc`, `.node-version`, runtime Dockerfile, or deployment runtime declaration. The inspected shell is Node `22.18.0`.

Current compatibility facts:

- Next.js 16 requires Node `20.9+`; its default starter enables TypeScript, Tailwind, ESLint, App Router, Turbopack, and `@/*` alias ([official installation](https://nextjs.org/docs/app/getting-started/installation)).
- NestJS 11 requires Node 20+ and uses Express 5 by default ([official migration guide](https://docs.nestjs.com/migration-guide)). Live npm: `@nestjs/core@11.2.1`.
- Prisma `7.9.1` requires Node `^20.19 || ^22.12 || >=24.0` (live npm metadata).
- Node 20 is now EOL; Node 22 and 24 are supported LTS lines ([official Node release schedule](https://nodejs.org/en/about/previous-releases)).

The inspected Node version happens to satisfy these floors, but another machine or production image can diverge.

**Disposition:** **MODIFY before scaffolding.** Pin a supported LTS runtime compatible with the selected Prisma family and enforce it in package metadata, local tooling, CI, and Docker/deployment configuration.

### HIGH-4 — AD-4, AD-17, and production-readiness claims are unverified

There is no Tailscale policy, Ollama service configuration, Redis deployment, backend Dockerfile, Nginx config, environment separation, secret configuration, storage configuration, CI/CD, monitoring, backup, or managed PostgreSQL configuration in the repository. Therefore “backend is the only authorized client,” isolated environments, distributed job claiming, 99% uptime, backups, and safe telemetry handling are all **INSUFFICIENT EVIDENCE**.

The technology fit is real: Ollama supports JSON-schema structured outputs and binds to `127.0.0.1:11434` by default ([structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [FAQ](https://docs.ollama.com/faq)); Tailscale’s recommended Grants are deny-by-default and can restrict a destination to specific ports ([official Grants](https://tailscale.com/docs/features/access-control/grants)). But a VPN connection alone does not prove exclusive authorization, and remote Ollama access requires an intentional bind/proxy plus a least-privilege Tailscale policy.

**Disposition:** **KEEP** the private transport decision, but require deployable configuration and policy tests before calling it implemented or production-ready.

### MEDIUM-1 — Documentation authority and status are internally inconsistent

The spine frontmatter lists `rescom.md` and `prd.md` as sources, but root `rescom.md` is deleted and the current PRD is under a run folder. `PROJECT_SUMMARY.md` still describes the backend as Node.js/Express in its tree while calling the selected backend NestJS elsewhere; it says the frontend is uninitialized despite a live Next.js scaffold; and it reports “11 models, 8 enums” although the current schema has materially more. The addendum still lists Express/NestJS and deferred/Day-1 Redis conflicts even though the current PRD NFRs have been edited to NestJS/Redis.

**Disposition:** **MODIFY the source-of-truth map.** Point the spine to existing versioned artifacts, identify the Prisma schema as draft versus authoritative, refresh `PROJECT_SUMMARY.md`, and remove resolved conflicts from active blocker lists.

### MEDIUM-2 — Structural seed and actual paths disagree

The spine seeds `apps/web`, `apps/api`, `packages/form-schema`, `packages/integrity-contracts`, and `packages/shared-types`; current paths are `apps/frontend/my-app`, `apps/backend`, and empty `packages/schemas`, `packages/shared`, and `packages/types` directories. Turborepo does not support ambiguous nested package globs, so the current `apps/frontend/my-app` shape must be deliberately modeled rather than assumed compatible with `apps/*` defaults.

**Disposition:** **MODIFY either the seed or repository before workspace activation.** Do not maintain two naming schemes.

### MEDIUM-3 — PostgreSQL 15 is supported, but production version/provider is unbound

`postgres:15-alpine` is a real and supported development choice. PostgreSQL 15 is supported until 2027-11-11, and the project recommends running the current minor (currently 15.18) ([official version policy](https://www.postgresql.org/support/versioning/)). The floating `15-alpine` tag does not make local patch level reproducible, and “managed production PostgreSQL” does not select a provider, major/minor policy, extensions, pooler mode, backup/restore objective, or migration process.

PostgreSQL is also a valid first queue-claim mechanism: official docs explicitly identify `FOR UPDATE ... SKIP LOCKED` as suitable for multiple consumers of a queue-like table ([official `SELECT` docs](https://www.postgresql.org/docs/17/sql-select.html)).

**Disposition:** **KEEP** PostgreSQL 15 for current development; **MODIFY** deployment seed before production and pin/rehearse the effective image and managed service behavior.

### MEDIUM-4 — “Qwen” has no testable model or hardware fit

Ollama exists and structured output support fits the Form Definition JSON boundary, but the spine names only the Qwen family. There is no exact model/quantization, Ollama version, GPU/VRAM inventory, context requirement, prompt/schema compatibility test, throughput target, or fallback-quality baseline. Ollama documents that concurrency and context length directly increase memory use and that GPU fit governs parallelism ([official FAQ](https://docs.ollama.com/faq)).

**Disposition:** **INSUFFICIENT EVIDENCE.** Keep the provider interface and optional dependency, but defer a specific Qwen commitment until a recorded hardware/model benchmark proves the required schema-validity and latency envelope.

### LOW-1 — Frontend versions are real and near-current

Live registry on 2026-08-16 reports `next@16.3.1` latest; the repository is pinned to stable `16.3.0`, published 2026-08-03. `react@19.2.8` is current and matches the repository. React’s official versions page identifies 19.2 as current ([React versions](https://react.dev/versions)); Next.js 16.3 is a real stable line, not the preview originally visible in stale search indexes.

**Disposition:** **KEEP.** The Next.js one-patch lag is low severity. There is **INSUFFICIENT EVIDENCE** in this review that 16.3.1 is a security-required update; evaluate its official changelog before changing the pin.

### LOW-2 — The ID convention permits divergence that current schema does not use

The spine allows “UUIDv4 or NanoID,” while every current database identity uses Prisma `uuid()`/PostgreSQL UUID and NanoID is not installed. Two modules could make incompatible choices for shared identifiers.

**Disposition:** **MODIFY** the convention to UUID for database/domain identifiers unless a specific boundary requires an opaque string ID. This is a reality-alignment correction, not a technology replacement.

## Technology Reality Matrix

| Technology/decision | Current evidence | Version/current-fit verdict |
| --- | --- | --- |
| Next.js / React | Installed `16.3.0` / `19.2.8`; live latest `16.3.1` / `19.2.8` | **CONFIRMED**, one Next patch behind. |
| Node.js | Local `22.18.0`; no project pin | **FIT BUT UNBOUND**; supported LTS required. |
| NestJS | Not installed; live core `11.2.1` | **EXISTS/FITS**, target only. Nest 11 requires Node 20+. |
| `@nestjs/schedule` | Not installed; live `6.1.3`, peers Nest 10/11 | **EXISTS/FITS** for in-process scheduling. Multi-replica exclusivity still requires the AD-17 claiming mechanism. |
| Prisma | CLI/client `6.0.0`; config `7.9.1`; live current `7.9.1` | **REAL BUT MISALIGNED**. Align one family. |
| PostgreSQL | Local `postgres:15-alpine` | **SUPPORTED/FITS**; production details unbound. |
| Redis | Not installed/deployed; live Node client `redis@6.2.1`; Redis docs current through 8.8 | **EXISTS/FITS** for centralized rate limiting. Distributed locking correctness depends on a selected algorithm and failure model; see [official rate limiter](https://redis.io/docs/latest/develop/use-cases/rate-limiter/) and [distributed locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/). |
| Turborepo | Not installed/configured; live `turbo@2.10.10` | **EXISTS/FITS**, but repository is not currently a valid Turborepo workspace. |
| Zod | Not installed; live `4.4.3` | **EXISTS/FITS**. Zod 4 is stable and browser/Node compatible ([official docs](https://zod.dev/)). |
| Ollama | No config/code | **EXISTS/FITS** for local structured outputs; operational fit unproven. |
| Qwen | Family name only | **INSUFFICIENT EVIDENCE** without model/hardware benchmark. |
| Tailscale | No policy/config | **EXISTS/FITS** for private reachability; exclusive authorization unproven. |
| Clean Architecture / modular monolith | No backend application code | **INSUFFICIENT EVIDENCE** to ratify dependency direction or module ownership. |

## Decision Disposition

| Decision group | Verdict | Reason |
| --- | --- | --- |
| AD-1 ledger | **MODIFY** | Current schema cannot express or enforce double entry/append-only. |
| AD-2 shared Zod schema | **KEEP, IMPLEMENT** | Technology fit confirmed; package absent. |
| AD-3 optional AI | **KEEP** | Sensible failure isolation; no implementation evidence yet. |
| AD-4 Tailscale-only AI | **KEEP, PROVE** | Technology fit confirmed; policy/config absent. |
| AD-5 in-process schedule | **KEEP WITH AD-17** | Official module exists; claiming/idempotency must be implemented. |
| AD-6 Redis Day 1 | **KEEP, IMPLEMENT** | Good distributed rate-limit fit; currently absent. |
| AD-7 Clean Architecture | **KEEP, PROVE** | No backend source exists to ratify it. |
| AD-8–AD-15 integrity | **MODIFY SCHEMA / IMPLEMENT** | Current schema omits multiple committed invariants. |
| AD-16 ownership | **KEEP, PROVE** | No module code/repository ports exist. |
| AD-17 environments/jobs | **KEEP, PROVE** | No deployment or claiming implementation exists. |
| AD-18 safe projections | **KEEP, IMPLEMENT** | No API/projection layer exists. |

## Required Actions Before Continuing Development

1. **Stop treating the current Prisma schema as implementation-ready.** Repair the ledger and integrity-contract mismatches before generating the first production migration.
2. **Choose and enforce one runtime/package baseline:** supported Node LTS, one Prisma release family, and compatible NestJS/Prisma configuration.
3. **Make the repository an actual workspace or amend the spine:** root workspaces/lockfile/`turbo.json`, canonical app paths, and real shared packages.
4. **Correct documentation authority:** existing source paths, current framework choice, scaffold status, schema counts/status, and resolved conflict lists.
5. **Convert security/operations assertions into evidence:** Tailscale Grants, Ollama bind policy, environment isolation, Redis/PostgreSQL claiming, backup/restore, observability, and deployment configuration.
6. **Benchmark before binding Qwen:** exact model, quantization, Ollama version, hardware, context, latency, concurrency, and JSON-schema pass rate.

## Review Boundary

This review did not modify the spine, solution design, manifests, source, or schema. It did not infer production configuration from architectural intent. Where the repository has no runnable implementation or deployment evidence, the result is explicitly **INSUFFICIENT EVIDENCE** rather than a claim of correctness.
