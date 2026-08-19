---
title: RESCOM Updated Architecture — Version and Repository-Reality Review
reviewer_lens: current-version-and-brownfield-reality
reviewed: 2026-08-16
artifact: ../ARCHITECTURE-SPINE.md
verdict: pass
critical_findings: 0
high_findings: 0
medium_findings: 0
low_findings: 2
---

# Updated Version and Repository-Reality Review

## Gate Verdict

**PASS.** The updated Spine's technology choices are current enough and mutually compatible, and the final shared state consistently distinguishes repository reality, product deployment targets, conditional infrastructure, and future implementation. There are **0 Critical**, **0 High**, and **0 Medium** findings. Two Low repository-hygiene items remain and are already sequenced as implementation work.

A missing implementation that the Spine explicitly labels as a target, conditional dependency, deferred item, or launch gate is not treated as an architecture contradiction in this review.

## Scope and Evidence

Reviewed the latest shared-filesystem state of:

- `ARCHITECTURE-SPINE.md`
- `solution-design.md`
- `reconcile-integrity-prd.md`
- `SPEC.md`, final PRD, approved Addendum, and `epics.md`
- both historical `RESCOM Architecture V2 — Research Integrity Engine` copies
- root, backend, frontend-wrapper, and Next application `package.json` files
- backend and frontend lockfiles
- `apps/backend/prisma.config.ts` and `apps/backend/prisma/schema.prisma`
- repository migration paths, workspace/package paths, Nest source paths, CI paths, and Git status
- `docker-compose.yml` and locally available Docker Compose validation

Read-only verification executed on 2026-08-16:

- local runtime: Node `v22.18.0`, npm `10.9.3`
- `apps/backend`: `npx prisma -v` reported CLI/Client `6.0.0`; `npx prisma validate` passed
- `apps/frontend/my-app`: ESLint passed; `tsc --noEmit` passed
- root and backend `npm test`: failed because both still contain the placeholder `Error: no test specified`
- `docker compose config -q`: valid configuration with an obsolete top-level `version` warning
- `docker compose ps`: live state could not be inspected because the Docker daemon was unavailable

No application code, Prisma schema, migration, package, Spine, or Solution Design file was edited by this reviewer.

## Official Current-Version Checks

| Named choice | Official/current evidence | Repository evidence | Result |
| --- | --- | --- | --- |
| **Node.js 22 LTS baseline** | The Node.js release table lists v22 “Jod” as LTS and recommends production use of Active or Maintenance LTS releases. | Runtime is `v22.18.0`, but no root `engines`, version file, CI, or deployment image enforces it. | **Compatible target; honestly marked for later enforcement.** Node 22 is supported, though no longer the newest LTS line. |
| **NestJS backend target** | NestJS 11 requires Node 20 or newer. Nest officially supports a standalone application context without an HTTP listener, suitable for jobs/worker execution. | No `@nestjs/*`, `nest-cli.json`, backend `src/`, API entrypoint, or worker entrypoint exists. | **Compatible and feasible target; not current reality.** Node 22 satisfies NestJS 11's runtime floor. |
| **One codebase / API + worker entrypoints** | Nest supports runnable application projects and standalone application contexts using shared providers/modules. | Structural seed names `main.ts` and `worker.ts`; neither exists. | **Feasible target, correctly labeled.** Two processes from one build are not evidence of microservices. |
| **Next.js / React scaffold** | Next.js officially released 16.3 on 2026-08-03; Next 16 requires Node 20.9 or newer. | Manifest and lock resolve Next `16.3.0`, React/React DOM `19.2.8`; one default App Router application exists at `apps/frontend/my-app`. | **Verified existing scaffold.** Node 22 is compatible. No claim of completed application behavior is made. |
| **npm workspaces first; Turbo deferred** | npm natively supports root-declared workspaces and linked local packages. | Root `package.json` has no `workspaces`; `packages/` has no package manifests; no `turbo.json` exists. | **Sound target/deferment and honest current-state wording.** |
| **Prisma one compatible family** | Prisma's current v7 upgrade guide requires coordinated `prisma` and `@prisma/client` upgrades; v7 recommends Node 22.x. Current Prisma config examples import from the public `prisma/config` entrypoint. | CLI/Client lock to `6.0.0`; direct `@prisma/config` resolves `7.9.1`; config imports `@prisma/config`; CLI 6 validation succeeds using the default schema path and does not report loading the config. | **Verified gate.** Spine, Solution Design, and reconciliation now require selection of one family and that major's public `prisma/config` contract before generation/migration. |
| **PostgreSQL durable source** | PostgreSQL 15 remains supported through 2027-11-11. | Compose declares only `postgres:15-alpine`, with a named volume. No migration history exists in the repository. | **Viable local major version and accurate Compose description.** Production provider/region remain correctly open. |
| **Redis conditional ephemeral use** | No version is architecturally pinned; the Spine constrains semantics instead of a library implementation. | No Redis service, manifest dependency, or configuration exists. | **Consistent.** It is explicitly conditional and PostgreSQL remains durable authority. |
| **Private S3-compatible storage** | S3 presigned URLs support time-limited uploads without giving the client bucket credentials. | No provider, bucket, adapter, or dependency exists. | **Feasible target and correctly gated.** Provider and malware/quarantine policy are open. |
| **Ollama/Qwen over Tailscale** | Ollama serves its local API on port `11434` by default. Tailscale grants support source/destination/port restrictions. | No Ollama, model, Tailscale policy, or deployment configuration exists in the repository. | **Feasible optional target, not current reality.** AD-4 now requires a least-privilege Grant and a deployment test proving unauthorized tailnet identities and public paths are denied. |

Primary sources:

- [Node.js release status](https://nodejs.org/en/about/previous-releases)
- [NestJS 11 migration/runtime requirements](https://docs.nestjs.com/migration-guide)
- [Nest standalone application contexts](https://docs.nestjs.com/application-context)
- [Next.js 16.3 release index](https://nextjs.org/blog)
- [Next.js 16 runtime requirements](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)
- [Prisma v7 upgrade guide](https://docs.prisma.io/docs/orm/v6/more/upgrades/to-v7)
- [Prisma system requirements](https://docs.prisma.io/docs/orm/reference/system-requirements)
- [Prisma config reference](https://docs.prisma.io/docs/orm/reference/prisma-config-reference)
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
- [Tailscale grants syntax](https://tailscale.com/docs/reference/syntax/grants)
- [Ollama API introduction](https://docs.ollama.com/api/introduction)
- [S3 presigned upload behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)

## Repository-Reality Matrix

| Assertion in updated architecture | Direct repository check | Judgment |
| --- | --- | --- |
| one initial Next.js application | Only `apps/frontend/my-app` contains Next source and dependencies; `apps/frontend/package.json` is a placeholder wrapper | **Verified** |
| one planned NestJS backend codebase | `apps/backend` contains package metadata, Prisma config/schema, lockfile, and installed dependencies, but no `src/` | **Verified as target, not implementation** |
| API and worker from one artifact | No entrypoint or image exists | **Correctly target-labeled** |
| PostgreSQL-only current Compose | `docker-compose.yml` defines only `postgres:15-alpine` and its volume | **Verified** |
| Redis, storage, API, worker absent | No corresponding Compose service, application source, or manifest dependency | **Verified** |
| root not yet an npm workspace | Root manifest has no `workspaces`; no root lockfile was found | **Verified** |
| shared contract packages absent | `packages/` has no files/manifests | **Verified** |
| Turborepo deferred | No Turbo configuration/dependency exists | **Verified** |
| backend Prisma family is mixed | CLI/Client `6.0.0`, direct config package `7.9.1` in manifest and lock | **Verified** |
| schema is syntactically valid but non-conforming | `prisma validate` passes; schema still contains single-sided `LedgerTransaction`, self-versioned `Form`, required Attempt respondent, generic outbox, and the earlier Integrity structures | **Verified** |
| migrations and CI absent | No Prisma migrations and no `.github` files exist | **Verified** |
| production readiness not evidenced | No deployment image/config, CI, secret flow, observability, backup/restore evidence, or live production inventory exists | **Verified and explicitly gated** |

The current Prisma schema remains an uncommitted user modification and was preserved. The Git worktree also contains unrelated deletions and untracked artifacts; this review does not attribute them to the Architecture Update or alter them.

### Architecture-run mutation boundary

The Architecture Update changed planning artifacts only. No package manifest, lockfile, Docker Compose file, frontend/backend source, Prisma schema, or migration was changed by the run:

- current Git status shows no package-manifest, lockfile, Compose, or application-source modification from this run;
- no migration directory or SQL migration exists;
- `apps/backend/prisma/schema.prisma` remains a pre-existing uncommitted user modification: the pre-Update health report already records its same single-sided `LedgerTransaction`, self-versioned `Form`, missing migration history, and non-conforming Integrity/Outbox structures;
- the reconciliation document records that the Architecture Update did not edit the schema; and
- no package installation or backend/frontend scaffold was performed.

This supports the claimed scope boundary without pretending that the overall worktree is clean.

## Authority and Supersession Check

### Passed

The same explicit order is present in the Spine, Solution Design, and reconciliation/status document:

1. SPEC
2. final PRD plus approved Addendum
3. Architecture Spine
4. Solution Design
5. epics
6. repository reality as brownfield evidence/structural seed

The latest upstream artifacts now agree on the formerly divergent boundaries checked by this lens:

- published `FormVersion` is immutable and Attempts pin the exact version;
- External responses are `NOT_ASSESSED` by the full Integrity Engine;
- assessment evidence is immutable and an operational `IntegrityDecision` is separate;
- soft quality/integrity evidence does not create a `FraudLog`;
- Google OAuth email collision requires authenticated explicit linking rather than email-only auto-linking;
- Outbox infrastructure records have an explicit technical owner while producer domains retain event meaning and business side effects.

Both V2 copies have frontmatter `status: superseded`, `canonical: false`, a valid `superseded_by` path for their location, and a prominent warning that their External assessment, FraudLog replacement, worker-service implications, and schema examples do not bind implementation. They remain historical files as requested.

The final PRD's Platform section describes product deployment targets: Vercel for the frontend, Cloudflare in front of a Docker/VPS backend, managed PostgreSQL, S3-compatible storage, and private Ollama/Qwen access. The Spine, Solution Design, and reconciliation artifact explicitly label these as targets rather than deployed reality. Repository evidence contains none of those deployment configurations, and the documents now say so; there is no false production-state claim.

## Findings

### L-02 — Local Compose is valid but carries obsolete and non-reproducible development defaults

**Evidence:** Compose validation passes but warns that top-level `version: '3.8'` is obsolete. The database image is a floating `postgres:15-alpine` tag and credentials are hard-coded development values.

**Disposition:** Clean up during the toolchain/environment baseline: remove the obsolete key, distinguish local-only credentials, and pin an approved minor/digest for reproducible CI/deployment. PostgreSQL 15 itself remains supported, and the architecture does not claim this Compose file is production-ready.

### L-03 — Runtime/toolchain enforcement is still absent, as the documents acknowledge

**Evidence:** The active shell runs Node `22.18.0`, but root/backend manifests do not declare `engines`, no runtime version file or CI exists, and root/backend tests are placeholders.

**Disposition:** Implement the already-defined build-sequence gate. This is correctly labeled target work and does not reduce the architecture verdict.

## Closed Re-audit Findings

- **M-01 closed:** Every canonical/companion occurrence checked now says only that no migration history is present and live database state is not evidenced. The unsupported “un-migrated” claim is gone from Spine, Solution Design, Addendum, and reconciliation.
- **M-02 closed:** Spine, Solution Design, and reconciliation require one selected Prisma family and that major's public `prisma/config` contract before generation or migration. Exact versions remain correctly owned by manifests/lockfiles.
- **L-01 closed:** AD-4 requires a least-privilege Tailscale Grant and deployment validation that unauthorized tailnet identities and public paths cannot reach the AI port.

## Explicit Non-Findings

- **Node 22 is not obsolete for this architecture.** It is still an LTS line and satisfies both Next 16 and Nest 11 runtime requirements.
- **Next 16.3.0 is not a preview mismatch.** It was officially released on 2026-08-03 and exactly matches the current manifest/lockfile.
- **Missing NestJS, worker, Redis, object storage, npm workspace configuration, and shared packages are not unresolved architecture contradictions.** Each is labeled as target, conditional, or deferred.
- **Two entrypoints do not imply microservices.** A web bootstrap and a standalone worker bootstrap can share one Nest codebase, modules, artifact, and data authority.
- **Turborepo is not required to make npm workspaces valid.** Deferral is technically sound for the current repository size.
- **PostgreSQL 15 is not out of support.** Its supported lifetime extends through 2027-11-11.
- **The non-conforming Prisma schema is not represented as production architecture.** The documents block migration and name the redesign gate explicitly.
- **The V2 files no longer compete for authority.** Their warnings and frontmatter are unambiguous.

## Gate Recommendation

Accept the updated Spine. No Critical, High, or Medium version/reality finding remains. L-02 and L-03 are ordinary toolchain/environment work already represented honestly in the build sequence; they do not block architecture handoff.
