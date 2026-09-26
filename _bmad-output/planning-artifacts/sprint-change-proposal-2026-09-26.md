---
title: RESCOM Sprint Change Proposal — Simplified Pilot Hosting on Google Cloud
date: 2026-09-26
status: approved
change_scope: moderate
selected_approach: direct-adjustment
approved_by: Quan
approved_on: 2026-09-26
review_mode: batch
---

# Sprint Change Proposal: Simplified Pilot Hosting on Google Cloud

## 1. Issue Summary

### Change Trigger

All Phase 1 epics (1, 2, 4, 5, 6, 7, 8, 9) are `done` in `sprint-status.yaml`, but no production topology has been selected. The PRD and Architecture Spine still name targets that were never provisioned and that no longer fit the team's budget or tooling:

- PRD Platform section: backend on a 4 vCPU / 16 GB VPS, managed PostgreSQL on Neon or Supabase, an unnamed S3-compatible provider, AI on a gaming laptop over Tailscale, and three frontend subdomains.
- A later team draft diagram added more parts: a separate NestJS Worker container, Grafana Cloud + Alloy, Sentry, an uptime monitor, a MacBook AI host, Google Cloud PostgreSQL and Cloudinary object storage across three providers.
- Local development uses `minio/minio:latest`. The MinIO Community Edition repository was archived in 2026 and no longer receives releases or patches.

The team has a USD 300 / 90-day Google Cloud trial credit and wants the simplest topology that can run the pilot and later move to FPT Cloud without code changes.

**Issue type:** Strategic pivot (hosting and operations), not a product-scope change.

### Evidence

- `docker-compose.yml` runs PostgreSQL 15, MinIO, `minio/mc` and ClamAV; the backend requires ClamAV (`MALWARE_SCANNER_*`, fail-closed per AD-22).
- `apps/backend` uses `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` against `STORAGE_ENDPOINT` (S3 API), so any S3-compatible provider works without code changes. Cloudinary does not expose the S3 API and would require rewriting Story 5.3's storage adapter.
- `.env.example` sets `ABUSE_CONTROL_PROFILE=REDIS_DISABLED_SINGLE_REPLICA`, which is valid only with exactly one API replica (AD-6).
- `StoredObject.bucket` is persisted per object, so the bucket name matters when changing provider.
- Google Cloud free trial: USD 300 for 90 days, then a 30-day grace period before resources are deleted; Cloud SQL has no always-free tier ([Google Cloud docs](https://docs.cloud.google.com/free/docs/free-cloud-features)).
- Epic 3 (AI Form Generator) is already in `phase_2_deferred`; no Phase 1 story needs an AI host.

### Decision

Run the pilot on one Google Cloud VM plus managed PostgreSQL and object storage in `asia-southeast1`, keep the frontend on Vercel, and use only portable interfaces (Docker, PostgreSQL, S3 API, environment variables). The decision is recorded as AD-23 in the Architecture Spine.

## 2. Impact Analysis

### Epic Impact

| Epic | Impact |
|---|---|
| Epics 1, 2, 4–9 (done) | None. No completed story is reopened or rolled back. |
| Epic 3 (Phase 2) | No AI host in the pilot. The Form Builder must hide the "Generate with AI" entry point while the AI Gateway is unconfigured (AD-3 already requires graceful absence). |
| Epic 10 (Phase 2) | None. The dedicated worker process of AD-5 remains the target once Epic 10 processing lands. |
| **New Epic 11** | Production Deployment & Pilot Readiness — six stories to package, provision, deploy, observe and launch, plus the post-trial hosting decision. |

### Artifact Conflicts

- **PRD — Platform, Cost, Out-of-scope:** hosting lines superseded (amendments added; product requirements unchanged).
- **Architecture Spine:** new AD-23; amendments to AD-3/AD-4 (no AI host in pilot) and AD-5 (co-located scheduler in the pilot); Stack table updated; two Open Questions partly resolved; Deferred list extended.
- **Solution Design §16:** pilot deployment profile referenced.
- **Epics:** Epic 11 added to Epic List, FR Coverage Map and stories.
- **UX:** no change beyond hiding the AI entry point (Story 11.5).
- **Secondary artifacts (Epic 11 work, not changed by this proposal):** `docker-compose.yml`, new `docker-compose.prod.yml`, `Dockerfile`, `Caddyfile`, GitHub Actions workflow, `.env.example` storage defaults, `PROJECT_SUMMARY.md` stack table (updated here).

### Technical Impact

- **No application code rewrite.** Storage stays on the S3 API; Prisma stays on PostgreSQL.
- `S3Client` needs `requestChecksumCalculation` / `responseChecksumValidation` = `WHEN_REQUIRED` for Google Cloud Storage interoperability with recent AWS SDK v3 releases.
- Scheduled durable work runs inside the API process with one scheduler owner (AD-5 small-deployment clause), keeping PostgreSQL claims per AD-10/AD-17.
- `TRUST_PROXY_HOPS=1` with Caddy restoring the client IP from `CF-Connecting-IP`, so rate limits and audit logs record the real client address.
- Local development may keep MinIO pinned to a fixed tag; it is no longer a production candidate.

## 3. Recommended Approach

### Selected Path: Direct Adjustment

Add Epic 11 and amend hosting sections. No rollback, no MVP scope reduction.

### Target Topology

| Concern | Choice |
|---|---|
| Frontend | Vercel, function region `sin1`, `/api/*` rewrite to the backend |
| Edge | Cloudflare proxy (DNS, TLS, DDoS) for `rescom.com.vn` and `api.rescom.com.vn` |
| Backend host | One Compute Engine VM (e2-medium class), `asia-southeast1`, Docker Compose: Caddy, NestJS API (+ in-process scheduler), ClamAV |
| Database | Cloud SQL for PostgreSQL, private IP, automated backups + point-in-time recovery |
| Object storage | Google Cloud Storage private bucket via S3 interoperability (HMAC keys) |
| Observability | Sentry (frontend + backend) and UptimeRobot, alerts to Telegram/email |
| CI/CD | GitHub Actions → GHCR → SSH deploy to the VM, previous tag kept for rollback |
| Removed from the draft diagram | MinIO (prod), Cloudinary, Redis, separate worker container, MacBook/Ollama host, Tailscale, Grafana Cloud + Alloy |

### Alternatives Considered

- **Cloud Run:** rejected for the pilot; ClamAV and continuously running scheduled jobs do not fit scale-to-zero.
- **Cloudinary for uploads:** rejected; not S3-compatible, optimised for public media, free-plan delivery stops when credits run out.
- **FPT Cloud from day one:** deferred to the post-trial decision (Story 11.6); no public trial credit was found and there is no Cloud Run–style managed runtime, but in-country data centres are attractive for demographic data.

### Effort, Risk, Timeline

- Effort: Medium (about three weeks of packaging, provisioning and verification).
- Risk: Low for code; Medium for operations (single VM is a single point of failure — accepted for the pilot).
- Estimated cost: roughly USD 40–60 per month on Google Cloud (approximate; verify with the Google Cloud Pricing Calculator), covered by the trial credit for 90 days.

| Phase | Dates (2026) | Exit gate |
|---|---|---|
| Packaging (11.1) | 28 Sep – 4 Oct | `npm run verify` green; production image runs locally |
| Provisioning (11.2) | 5 – 11 Oct | API answers through `api.rescom.com.vn` |
| CI/CD + observability (11.3, 11.4) | 12 – 18 Oct | Full-journey smoke test and one Cloud SQL restore succeed |
| Pilot launch (11.5) | from 19 Oct | AD-21 privacy gate approved; no critical Sentry errors after week one |
| Post-trial decision (11.6) | 7 – 20 Dec (trial day ~70) | Migration rehearsal succeeds; stay on GCP or move to FPT Cloud before trial day 90 (≈ 3 Jan 2027), hard stop at grace end (≈ 2 Feb 2027) |

Trial dates assume the Google Cloud account is created on 5 Oct 2026.

## 4. Detailed Change Proposals

### 4.1 PRD — Platform (amendment appended under `## Platform`)

OLD:
```
- Domain: rescom.com.vn (main), api.rescom.com.vn (backend), survey.rescom.com.vn (public surveys)
- Backend: NestJS + Clean Architecture → Docker → VPS (4 vCPU / 16 GB RAM)
- Database: Managed PostgreSQL (Neon/Supabase) with Connection Pooling
- File Storage: S3-compatible Object Storage
- AI: Ollama + Qwen on private GPU, accessed via Tailscale VPN
```
NEW (amendment 2026-09-26): pilot hosting per AD-23 — Vercel (`sin1`); Cloudflare; one Compute Engine VM in `asia-southeast1` with Docker Compose; Cloud SQL for PostgreSQL; Google Cloud Storage via the S3 API; public surveys served under `rescom.com.vn/f/<id>` instead of a separate subdomain; no AI host in Phase 1 (Epic 3 deferred).

Rationale: budget (trial credit), fewer moving parts, portability to FPT Cloud.

### 4.2 PRD — Cost and Out-of-scope

- Cost: AI hosting statement marked as Phase 2 (Epic 3 deferred).
- "Horizontal backend scaling — single VPS sufficient for pilot" → single VM on Google Cloud.

### 4.3 Architecture Spine

- **New AD-23 — Portable Single-VM Pilot Topology [ADOPTED].**
- **AD-3 / AD-4 amendment:** the Phase 1 deployment has no AI host; the AI Adapter stays unconfigured and the Form Builder hides the AI entry point.
- **AD-5 amendment:** the pilot is an explicitly small deployment; scheduled durable work runs inside the API process under one scheduler owner (configuration flag). A dedicated worker process returns when Epic 10 processing lands or a second API replica is needed.
- **Stack table:** hosting, database, object storage, observability and CI/CD rows filled in; Ollama/Tailscale marked deferred.
- **Open Questions:** "Before production readiness" and "Before file-upload production use" — providers and region resolved; RPO/RTO, retention, email provider and ownership remain open.
- **Deferred:** dedicated worker container, Grafana/Alloy stack, AI host + Tailscale.

### 4.4 Solution Design §16

Amendment pointing to AD-23 as the pilot deployment profile and listing the Operations approvals still required.

### 4.5 Epics — New Epic 11: Production Deployment & Pilot Readiness

Covers NFR-ADD-3 (secrets), NFR-ADD-4 (observability, health), NFR-ADD-5 (backup/restore) and the AD-23 topology.

- **Story 11.1** Deployment-ready backend packaging
- **Story 11.2** Google Cloud pilot infrastructure provisioning
- **Story 11.3** CI/CD pipeline with rollback
- **Story 11.4** Observability, alerting and backup-restore drill
- **Story 11.5** Pilot launch readiness
- **Story 11.6** Post-trial hosting decision and portability rehearsal

Full acceptance criteria are in `epics.md`.

### 4.6 Sprint Status

`epic-11: backlog` with stories `11-1` … `11-6` at `backlog`.

## 5. Implementation Handoff

### Scope Classification

**Moderate** — backlog addition plus hosting amendments; no product requirement changes and no rollback.

### Handoff

- **Developer (Amelia):** Stories 11.1 and 11.3 via `bmad-create-story` → `bmad-dev-story`.
- **Operations / Quan:** Stories 11.2, 11.4, 11.6 (account, billing, provisioning, restore drill, post-trial decision).
- **Product + Privacy/Legal:** AD-21 processing-register approval before Story 11.5 launch. This gate can move the pilot date.

### Success Criteria

- Production runs on the AD-23 topology with zero application-code changes to storage or persistence adapters.
- Full-journey smoke test passes on production: register, onboarding, create form, publish + moderation, answer with file upload, top-up approval, notifications.
- One successful Cloud SQL restore before launch.
- A rehearsed migration path to FPT Cloud (or a documented decision to stay) before trial day 90.

## 6. Checklist Status

| Section | Status |
|---|---|
| 1. Trigger and context | [x] Done — hosting pivot; evidence above |
| 2. Epic impact | [x] Done — Epic 11 added; Epic 3 note; no rollback |
| 3.1 PRD | [x] Done — Platform/Cost amendments |
| 3.2 Architecture | [x] Done — AD-23 and amendments |
| 3.3 UI/UX | [x] Done — hide AI entry point only |
| 3.4 Other artifacts | [!] Action-needed — Dockerfile, compose, Caddyfile, CI workflow are Epic 11 work |
| 4. Path forward | [x] Direct Adjustment — viable, effort Medium, risk Low |
| 5. Proposal components | [x] Done |
| 6. Final review and handoff | [x] Approved by Quan on 2026-09-26 |

## 7. Approval

**Approved by:** Quan
**Approval date:** 2026-09-26
**Decision:** Apply the hosting simplification to the planning artifacts and add Epic 11.

This approval does not satisfy the AD-21 privacy/legal launch gate or the Operations approvals listed in the Spine's Open Questions.

## 8. Workflow Execution Log

| Date | Event | Result |
|---|---|---|
| 2026-09-26 | Change trigger confirmed | Simplified, portable pilot hosting on Google Cloud |
| 2026-09-26 | Review mode | Batch (Quan asked to apply the agreed updates directly) |
| 2026-09-26 | Impact analysis | Moderate; no rollback; Epic 11 added |
| 2026-09-26 | Artifacts updated | PRD, Architecture Spine, Solution Design, Epics, Sprint Status, PROJECT_SUMMARY |
| 2026-09-26 | Handoff | Developer (11.1, 11.3); Operations/Quan (11.2, 11.4, 11.6); Product + Privacy (AD-21 before 11.5) |
