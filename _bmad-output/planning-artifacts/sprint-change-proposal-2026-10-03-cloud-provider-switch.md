---
title: "RESCOM Sprint Change Proposal — Cloud Provider Switch (GCP → TBD)"
date: 2026-10-03
status: draft-pending-vendor-budget-selection
change_scope: moderate
trigger: GCP billing activation failed — Visa card rejected by Google
review_mode: batch
author: Developer agent (Codex supervisor), Correct Course workflow
prior_proposals:
  - sprint-change-proposal-2026-09-26.md  # AD-23 adopted — GCP pilot topology
  - sprint-change-proposal-2026-10-01.md  # Epic IR backlog reconciliation
do_not_apply_until: vendor selected AND budget approved by owner
---

> **SUPERSEDED 2026-10-05 — GCP dropped.** Pilot runs on Hostinger VPS + Cloudflare R2 (`sprint-change-proposal-2026-10-04-hostinger-vps.md` §7.3). Kept as history only; do not execute.

<!-- ============================================================
     SUPERVISOR REVIEW / TRIAL-FIRST AMENDMENT — 2026-10-03
     Codex (supervisor) | AGY (author) | Quan (owner/payment)
     ============================================================ -->

> [!CAUTION]
> **THIS DRAFT IS NOT APPROVED.**
> It contains unverified vendor claims and MUST NOT be used to authorize payments, bank transfers, or cloud resource provisioning.

## Supervisor Review — Trial-First Amendment (2026-10-03)

**Decision authority:** Quan (account holder & payment owner).
**Implementation:** AGY. **Supervision:** Codex.

### Why this amendment exists

The owner's switching trigger is a GCP card failure. The new priority is **free-trial-first**: no vendor is selected and no budget has been confirmed. The draft below must not be acted upon until eligibility and full-service coverage are verified.

### Free-trial candidates (unconfirmed — verify before committing)

| Vendor | Trial info | Key unknowns |
|--------|-----------|--------------|
| **FPT Cloud** | [1-month trial (0 VND)](https://fptcloud.com/dung-thu-chi-0d-nhan-03-uu-dai-cung-fpt-cloud/) | Personal/student eligibility; international card required?; managed DB (private PG15 + PITR) and S3-compatible object storage covered? |
| **VNG Cloud** | Older vServer/vStorage trial policy | Current validity; card requirement; managed DB coverage — all unconfirmed |

**Do not select a vendor until:** trial eligibility confirmed, all three required services (compute, managed private PG15/PITR, S3-compatible storage) verified, and owner explicitly approves.

### What the draft below must NOT be relied upon for

- Bank transfer details or secondary prices → **do not use**
- "Nonprofit" claim → **unsupported, do not assert**
- S3 compatibility → **must be tested, not assumed**
- Existing OAuth credentials → **separate OAuth clients required per provider**
- Self-hosted DB as DB substitute → **unapproved deviation; private managed PG15/PITR remains mandatory**

### Authoritative references

- Architecture spine: `architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md`
- This amendment **supersedes** all actionable guidance in the draft below until conditions above are met.

---


# Sprint Change Proposal: Cloud Provider Switch — GCP → TBD (2026-10-03)

> **Status:** DRAFT — Pending owner decision on vendor and budget.
> Do NOT apply canonical edits (epics.md, architecture spine, sprint-status.yaml, PROJECT_SUMMARY.md) until a provider is confirmed and the owner explicitly approves.
> Google OAuth is **not** affected by this change; it is an identity provider, not a hosting provider.

---

## 1. Issue Summary

### 1.1 Change Trigger

Story 11.2 is `in-progress`. Preflight work (Task A partial) was completed on 2026-10-03.
Billable GCP resource provisioning (Cloud SQL, Cloud Storage, VM) is blocked because the owner's Visa card was rejected by Google billing and GCP billing activation cannot be completed.
The owner has explicitly approved switching away from GCP as the hosting provider.

### 1.2 Context

- AD-23 (adopted 2026-09-26, `sprint-change-proposal-2026-09-26.md`) selected Google Cloud as the pilot host with FPT Cloud as the explicit portability target for Story 11.6.
- Story 11.1 is `done`. The packaging work (Dockerfile, docker-compose.prod.yml, Caddyfile, S3 adapter with `WHEN_REQUIRED` checksums) is provider-neutral and requires **no changes** regardless of which provider is selected.
- Story 11.2 is `in-progress` with partial preflight only; no production infrastructure was provisioned and no GCP resources were billed.
- Stories 11.3–11.6 are `backlog`.
- The `@aws-sdk/client-s3` storage adapter requires no provider-specific SDK changes — it works against any S3-compatible endpoint by changing `STORAGE_ENDPOINT` and credentials.
- The architecture's three-service stack (Caddy + NestJS API + ClamAV), private DB, S3-compatible object storage, automated backups + PITR, Cloudflare, Vercel, and GitHub Actions → GHCR → SSH deploy are all constraints that **carry forward unchanged**.

### 1.3 What Does Not Change

| Item | Status |
|---|---|
| Story 11.1 packaging | ✅ Done and provider-neutral — no rework |
| Google OAuth | ✅ Unaffected — Google is the identity provider, not the host |
| Cloudflare DNS/TLS | ✅ Unchanged |
| Vercel frontend | ✅ Unchanged |
| Three-service Docker Compose stack | ✅ Unchanged |
| S3 adapter (`@aws-sdk/client-s3`) | ✅ No code change — endpoint is ENV-configured |
| Private DB requirement | ✅ Carries forward as AC |
| Automated backups + PITR | ✅ Mandatory AC for the new provider |
| Existing completed epics (1–IR) | ✅ Not reopened |
| AD-21 privacy gate | ✅ Still required before Story 11.5 |

---

## 2. Provider Research & Evidence

> **Legend:** ✅ Verified from official source | ⚠️ Needs sales quote | ❓ Unconfirmed

### 2.1 Candidate A — FPT Cloud (Primary Evaluation)

**Why FPT Cloud first:** It is the explicit portability target in AD-23 and Story 11.6 AC. Moving directly eliminates the two-step migration risk. FPT Smart Cloud is an FPT Group entity — the same group that operates FPT University, which may support a sponsorship or academic discount request.

#### 2.1.1 Account & Signup (Verified)

| Item | Evidence |
|---|---|
| Self-service signup | ✅ `console.fptcloud.com` → "Login with FPT ID" → "Don't have an account? Sign up" — email + phone OTP, no business registration required for individual accounts |
| Payment — VNPay gateway | ✅ Top-up via VNPay: bank transfer, domestic card, e-wallet |
| Payment — Direct bank transfer | ✅ Công ty TNHH FPT Smart Cloud · TPBank · Account 20138138901 (source: official FPT Cloud billing docs) |
| Payment — No Visa/international card required | ✅ Domestic-only payment confirmed |
| Support hotline | ✅ 1800 6139 (free) and 1900 638 399 |
| Support email | ✅ support@fptcloud.com |

> **Beginner account steps for FPT Cloud:**
> 1. Open `https://console.fptcloud.com` in Chrome/Firefox/Edge.
> 2. Click **"Login with FPT ID"** → **"Don't have an account? Sign up"**.
> 3. Enter First name, Last name, Email, Username (6–32 chars), Password (min 12 chars, uppercase + lowercase + digit + special char).
> 4. Tick reCAPTCHA, accept Terms, click **Sign up**.
> 5. Check email inbox (including Spam) for activation link; click it.
> 6. On first login, verify phone number via SMS OTP.
> 7. To top up: Portal → **Billing → Balance & Transactions** → **Top Up** → choose VNPay (bank transfer / domestic card / e-wallet).
> 8. To request sponsorship: contact sales (fptcloud.com/lien-he) mentioning FPT University Da Nang affiliation before activating paid services.

#### 2.1.2 VM / Compute (Verified public prices)

| Package | vCPU | RAM | SSD | Price/month | Source |
|---|---|---|---|---|---|
| STANDARD-01 | 2 | 4 GB | 40 GB | **599,000 VND** | ✅ Schema.org structured data, fptcloud.com/bang-gia/ (2026-10-03) |
| STANDARD-02 | 4 | 8 GB | 100 GB + 100 GB backup | **1,200,000 VND** | ✅ same |
| STANDARD-03 | 8 | 16 GB | 500 GB + 500 GB backup | **3,600,000 VND** | ✅ same |
| HIGH-01 | 8 | 16 GB | 300 GB | Contact for quote | ⚠️ No public price |

> **Note:** STANDARD-01 (2 vCPU / 4 GB) at 599k VND/month is close to GCP e2-medium (~USD 33–40/month ≈ ~850k–1M VND). STANDARD-01 is a viable pilot size for a single-replica API with in-process scheduler. STANDARD-02 adds headroom and includes 100 GB backup.

#### 2.1.3 FPT Object Storage (S3-compatible — Verified)

| Item | Evidence |
|---|---|
| S3 API compatibility | ✅ Docs confirm: "FPT Object Storage hỗ trợ tích hợp vào các S3-SDK hoặc S3-Client tuân theo chuẩn AWS S3" (docs.fptcloud.com/vi/docs/category/fpt-object-storage/) |
| SDK integration docs | ✅ `Integrate FPT Object Storage with S3-Client` page exists; AWS SDK v3 usage documented |
| IAM / Access Keys | ✅ Portal-managed Access Key + SubUser permissions documented |
| Bucket CORS configuration | ✅ Mentioned in tutorials (upload/download presigned URL flows) |
| Bucket data migration tool | ✅ `Di chuyển dữ liệu giữa các Bucket` tutorial available |
| Pricing | ⚠️ **No public per-GB price found on pricing page** — must request quote or check portal calculator |

#### 2.1.4 Managed PostgreSQL (FPT Database Engine) — Needs Quote

| Item | Evidence |
|---|---|
| Service name | FPT Database Engine |
| PostgreSQL support | ✅ Listed as supported engine (docs sidebar) |
| Private networking | ⚠️ Needs confirmation — ask whether DB instance can be on private VPC reachable only from the VM |
| PITR (Point-in-Time Recovery) | ⚠️ Needs explicit confirmation — ask whether WAL-based PITR is available |
| Automated daily backup | ⚠️ Needs confirmation of retention period options |
| Pricing | ⚠️ **Not publicly listed** — contact for quote |

#### 2.1.5 Private Networking / VPC

| Item | Evidence |
|---|---|
| VPC / private network | ⚠️ FPT Cloud has network products; private IP between VM and DB needs sales confirmation |
| Firewall (Layer 4) | ✅ Included in STANDARD packages |
| Load Balancer (Basic) | ✅ Included in STANDARD-02+ |

#### 2.1.6 Compatibility with Story 11.1 Deliverables

```
Story 11.1 AC7 (GCS presigned URL test, deferred to 11.2):
→ Must be re-run against FPT Object Storage S3 endpoint instead.
→ Test: presigned upload + presigned download via unchanged @aws-sdk/client-s3.
→ Only ENV vars change: STORAGE_ENDPOINT, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_BUCKET.
→ WHEN_REQUIRED checksum setting is already in place (Story 11.1).
```

#### 2.1.7 FPT Cloud — Summary Assessment

| Requirement | Status |
|---|---|
| No international card needed | ✅ VNPay / bank transfer |
| Vietnamese data center | ✅ Hanoi + HCM (Tier III) |
| S3-compatible object storage | ✅ Verified |
| Self-service VM with known price | ✅ STANDARD-01 at 599k VND |
| Managed PostgreSQL + private IP + PITR | ⚠️ **Needs sales quote** |
| FPT University sponsorship possible | ⚠️ **Needs inquiry — not confirmed** |
| In-country data residency for demographic data | ✅ Strong alignment |
| Portability target already in AD-23 | ✅ |

---

### 2.2 Candidate B — VNG Cloud / GreenNode (Fallback)

Evaluated as fallback if FPT Cloud minimum packages are unaffordable or PITR is unavailable.

| Item | Evidence |
|---|---|
| Platform | VNG Cloud (transitioning to GreenNode at greennode.ai) — both portals operational |
| Payment in VND | ✅ Direct VND billing standard; VNPay / bank transfer |
| Data center in Vietnam | ✅ Hanoi + HCM |
| S3-compatible storage (vStorage) | ✅ Native S3 API, multi-region (HN + HCM), Gold/Silver/Archive tiers |
| vStorage pricing | ✅ ~530 VND/GB/month (GreenNode public pricing, sourced from search) |
| Managed PostgreSQL (vDB) | ✅ Managed PostgreSQL exists |
| vDB pricing entry point | ✅ ~504,000 VND/month (sourced from search, verify on portal) |
| Private networking (vPC) | ✅ Virtual Private Cloud supported |
| PITR | ⚠️ Needs verification in console/docs |
| Signup | ✅ Self-service at vngcloud.vn or greennode.ai |
| International card required | ❓ Check if VNPay/bank transfer is available for individual accounts |

> **Note:** VNG Cloud vDB and vStorage prices cited above are from secondary research sources, not directly from the VNG Cloud pricing calculator. Verify at `https://vngcloud.vn` or `https://greennode.ai` before committing.

---

### 2.3 Providers Evaluated and Excluded

| Provider | Reason for Exclusion |
|---|---|
| Google Cloud (GCP) | ❌ Trigger: Visa rejected, billing activation blocked |
| Cloudflare R2 | ✅ S3-compatible storage only — no VM or managed DB; was already noted in Story 11.6 as S3 fallback only; not a full replacement |
| Vultr / UpCloud | ❌ No data center in Vietnam; require international card (USD/EUR); no local compliance |
| Neon / Supabase | ❌ Managed DB only — no VM or integrated object storage; same international card concern |
| AZDIGI / vHost / PA Vietnam | ❌ S3 storage only or IaaS without managed PostgreSQL + PITR — cannot satisfy the full 3-service stack requirement |

---

## 3. Recommended Approach

### 3.1 Path Forward: Direct Adjustment (Conditional)

Replace GCP references in stories 11.2–11.6, the architecture spine AD-23 amendment, PRD hosting section, and PROJECT_SUMMARY with provider-neutral or provider-specific text once a vendor is confirmed.

**No rollback needed.** Story 11.1 is done and provider-neutral. Stories 11.3–11.6 are backlog. Only Story 11.2 needs targeted replacement.

### 3.2 Recommended Primary Candidate: FPT Cloud

**Rationale:**
1. Already the explicit portability target in AD-23 and Story 11.6 — moving directly removes the two-hop migration risk.
2. Payment by domestic bank transfer / VNPay — solves the immediate card rejection problem.
3. Vietnamese data center — data residency alignment for demographic data (AD-21 consideration).
4. FPT University affiliation — plausible sponsorship inquiry channel (not confirmed).
5. Object Storage confirmed S3-compatible with AWS SDK v3.

**Blocking question before confirming FPT Cloud:**
- Can FPT Cloud provide managed PostgreSQL with **private IP only**, **automated daily backup**, and **PITR**, for a price within the team budget? This is unknown and must be answered via sales quote before committing.
- If managed PostgreSQL with PITR is not available or too expensive, evaluate running PostgreSQL as a Docker container on the VM with `pg_basebackup` + WAL archiving to FPT Object Storage — an accepted degradation for the pilot phase, provided the RPO/RTO are acceptable and the owner approves the deviation.

### 3.3 Fallback Candidate: VNG Cloud / GreenNode

Use if FPT Cloud managed PostgreSQL is not affordable or PITR is unavailable. VNG Cloud vDB + vStorage + vServer is a well-documented stack with VND billing. Verify prices on the portal calculator before committing.

### 3.4 Effort, Risk, Timeline

| Item | Assessment |
|---|---|
| Effort | Low — Story 11.1 is done; only ENV vars and AC references change in 11.2 |
| Risk — Code | None; storage adapter and Prisma are already provider-neutral |
| Risk — Operations | Low-Medium; operator must learn new console and run presigned URL smoke test against new S3 endpoint |
| Timeline impact | Depends on quote response time (FPT sales) and owner account creation. If sponsorship inquiry takes > 1 week, proceed with paid account. |

---

## 4. Detailed Change Proposals

> ⚠️ These are PROPOSED edits. Do NOT apply until vendor and budget are confirmed by the owner.

---

### 4.1 Story 11.2 — Complete Replacement of GCP References

**File:** `_bmad-output/planning-artifacts/epics.md` — Story 11.2 section  
**File:** Story file (if a separate `story-11-2.md` exists)

#### OLD (current, epics.md lines ~1376–1394):

```
### Story 11.2: Google Cloud Pilot Infrastructure Provisioning

As an Operator,
I want the pilot infrastructure provisioned in one region with least exposure,
So that the API, database and storage are reachable only through the intended paths.

**Acceptance Criteria:**

**Given** a Google Cloud project on the trial billing account
**When** the environment is provisioned in `asia-southeast1`
**Then** budget alerts fire at USD 50, 100 and 200.
**And** Cloud SQL for PostgreSQL has private IP only, automated backups and point-in-time recovery,
       and `prisma migrate deploy` has been applied.
**And** one private Cloud Storage bucket exists per environment with HMAC credentials scoped to it
       and CORS limited to the frontend origin for presigned uploads; the bucket name is chosen so
       it can be reused on the post-trial host or its rewrite is planned (`StoredObject.bucket`).
**And** the VM firewall admits 80/443 only from Cloudflare IP ranges; SSH uses keys only and is
       limited to team addresses.
**And** Cloudflare provides the public API edge to the VM with SSL mode Full (strict), while the
       NestJS port remains private.
**And** Vercel serves `app.rescom.com.vn` from region `sin1` and external-rewrites same-origin
       `/api` to the public API edge; browser code does not call a backend origin directly.
**And** the Google OAuth client lists the canonical same-host callback under
       `app.rescom.com.vn/api/...` and the approved frontend URLs.
**And** secrets live in the VM `.env` (file mode 600) and GitHub Actions secrets only, never in
       the repository (NFR-ADD-3).
**And** staging uses a separate database, bucket, OAuth client/secret, domain and synthetic
       accounts while mirroring the production proxy topology.
```

#### NEW (to be finalized when vendor confirmed — placeholder uses `[PROVIDER]`):

```
### Story 11.2: [PROVIDER] Pilot Infrastructure Provisioning

As an Operator,
I want the pilot infrastructure provisioned in one region with least exposure,
So that the API, database and storage are reachable only through the intended paths.

**Acceptance Criteria:**

**Given** a [PROVIDER] account with a confirmed payment method and budget alerts configured
**When** the environment is provisioned in the [PROVIDER] Vietnam region
**Then** billing/cost alerts are configured at the team-approved monthly thresholds.
**And** a managed PostgreSQL instance (or documented self-hosted alternative approved by the owner)
       has private IP connectivity only from the VM, automated daily backups, and point-in-time
       recovery (or an owner-approved RPO alternative); `prisma migrate deploy` has been applied.
**And** one private S3-compatible object storage bucket exists per environment with IAM access
       credentials scoped to it and CORS limited to `https://app.rescom.com.vn` for presigned
       uploads; Story 11.1 AC7 (presigned upload + download smoke) passes against the new endpoint
       using the unchanged `@aws-sdk/client-s3` adapter with `WHEN_REQUIRED` checksums.
**And** the VM firewall admits 80/443 only from Cloudflare IP ranges; SSH uses key-based auth
       only and is restricted to team IP addresses.
**And** Cloudflare provides the public API edge to the VM with SSL mode Full (strict); the NestJS
       port 4000 is not exposed externally.
**And** Vercel serves `app.rescom.com.vn` from region `sin1` and external-rewrites same-origin
       `/api` to the public API edge; browser code does not call a backend origin directly.
**And** the Google OAuth client lists the canonical same-host callback under
       `app.rescom.com.vn/api/...` and the approved frontend URLs (Google OAuth credential is
       unaffected by the hosting provider change).
**And** secrets live in the VM `.env` (file mode 600) and GitHub Actions secrets only (NFR-ADD-3).
**And** staging uses a separate database, bucket, OAuth client/secret, domain and synthetic
       accounts while mirroring the production proxy topology.
```

**Rationale:** Remove all GCP-specific references (`asia-southeast1`, `Google Cloud project`, `Cloud SQL`, `Cloud Storage`, `HMAC keys`, `USD` thresholds). Replace with provider-neutral language. Google OAuth reference is kept because it is the identity provider, not the hosting provider. The S3 smoke test (AC7 deferred from 11.1) is promoted to an explicit 11.2 acceptance criterion.

---

### 4.2 Story 11.3 — Minor Amendment (CI/CD image registry)

No GCP-specific registry was used (GitHub Container Registry GHCR was already the target). **No change required.** Story 11.3 ACs are already provider-neutral.

---

### 4.3 Story 11.4 — Minor Amendment (Cloud SQL → provider DB)

**File:** `_bmad-output/planning-artifacts/epics.md` — Story 11.4 section

#### OLD (one AC line):

```
**And** Cloud SQL backup failures, database connectivity, VM disk above 80% and ClamAV health raise alerts.
**And** one point-in-time restore of Cloud SQL into a scratch instance has been performed and its
       steps written down; RPO, RTO and backup retention are proposed for Operations approval (NFR-ADD-5).
```

#### NEW:

```
**And** [PROVIDER] managed database backup failures (or pg_basebackup/WAL archive failures if
       self-hosted), database connectivity, VM disk above 80% and ClamAV health raise alerts.
**And** one point-in-time restore (or a documented pg_restore from latest backup if PITR is
       not available) into a scratch instance has been performed and its steps written down; RPO,
       RTO and backup retention are proposed for Operations approval (NFR-ADD-5).
```

**Rationale:** Remove Cloud SQL-specific terminology; keep the intent (tested restore + approved RPO/RTO).

---

### 4.4 Story 11.5 — No Change Required

Story 11.5 ACs are already provider-neutral (no GCP references). ✅

---

### 4.5 Story 11.6 — Amendment: Remove GCP as Starting Provider, Keep Portability Clause

**File:** `_bmad-output/planning-artifacts/epics.md` — Story 11.6

#### OLD (given clause):

```
**Given** Story 11.5 has completed the limited cohort and the Google Cloud trial reaches about day 70
**When** the hosting decision is prepared
**Then** the team asks the university about FPT Cloud sponsorship and compares it with paid Google Cloud.
**And** if FPT Cloud is a candidate, FPT Object Storage passes presigned upload/download with the
       unchanged AWS SDK storage adapter (fallback: Cloudflare R2).
```

#### NEW:

```
**Given** Story 11.5 has completed the limited cohort and the pilot has run for approximately 60–70 days
**When** the post-launch hosting review is prepared
**Then** the team reviews the current provider's cost and SLA against the team budget and compares
       with alternative providers (e.g., the provider not chosen in Story 11.2).
**And** if the object storage provider changes, the S3 presigned upload/download smoke passes with the
       unchanged `@aws-sdk/client-s3` adapter against the new endpoint (fallback always available:
       Cloudflare R2).
```

**Rationale:** GCP trial day-70 trigger is irrelevant when GCP is not the starting host. The portability rehearsal intent is preserved. The specific provider comparison is left open — it depends on the 11.2 choice.

---

### 4.6 Architecture Spine — AD-23 Amendment

**File:** `rescom.md` or the current architecture document

#### OLD (AD-23 adopted text, excerpt):

```
AD-23 — Portable Single-VM Pilot Topology [ADOPTED]:
Backend: One Compute Engine VM (e2-medium class), asia-southeast1
Database: Cloud SQL for PostgreSQL, private IP, automated backups + PITR
Object storage: Google Cloud Storage private bucket via S3 interoperability (HMAC keys)
```

#### NEW (proposed amendment, to be appended — do not overwrite existing AD-23 record):

```
AD-23 — Amendment (2026-10-03): GCP billing blocked — provider TBD
The Google Cloud topology described in AD-23 (2026-09-26) is superseded for the pilot.
GCP billing activation failed due to payment method rejection (Visa card declined by Google).
The owner has approved switching to an alternative provider.

The following constraints carry forward unchanged from AD-23:
- Single VM, one Docker Compose stack (Caddy + NestJS API + ClamAV + in-process scheduler)
- Managed PostgreSQL (or owner-approved self-hosted with WAL backup) — private IP only, no public DB
- S3-compatible object storage — private bucket, IAM scoped credentials, CORS to frontend origin
- Cloudflare edge (DNS, TLS, DDoS) — unchanged
- Vercel frontend — unchanged
- GitHub Actions → GHCR → SSH deploy — unchanged
- No provider-specific SDK in application code

Provider-specific entries (region, service names, credential types) will be filled in once
the owner confirms the selected provider and payment is established.
Candidate A (primary): FPT Cloud — managed PostgreSQL + FPT Object Storage + VM
Candidate B (fallback): VNG Cloud / GreenNode — vDB + vStorage + vServer
Decision gate: owner confirms vendor + budget → architect updates AD-23 with final provider.
```

---

### 4.7 PRD — Platform Section Amendment

#### OLD:

```
NEW (amendment 2026-09-26): pilot hosting per AD-23 — Vercel (sin1); Cloudflare; one Compute Engine VM
in asia-southeast1 with Docker Compose; Cloud SQL for PostgreSQL; Google Cloud Storage via the S3 API;
public surveys served under rescom.com.vn/f/<id>; no AI host in Phase 1.
```

#### NEW (append, do not replace):

```
Amendment (2026-10-03): GCP billing blocked — provider switch in progress per AD-23 amendment.
Vercel, Cloudflare, Docker Compose stack, PostgreSQL, S3-compatible storage, and Prisma carry forward.
Provider-specific platform entries (VM type, DB service, storage service) are TBD pending vendor/budget
selection. Candidate A: FPT Cloud; Candidate B: VNG Cloud. See sprint-change-proposal-2026-10-03.
```

---

### 4.8 PROJECT_SUMMARY.md — Stack Table Amendment

#### OLD (section 3 rows):

```
| **Database** | PostgreSQL (Docker Compose locally, Cloud SQL `asia-southeast1` in production) |
| **File Storage** | Google Cloud Storage via S3 API (presigned URL uploads) + ClamAV scanning; MinIO locally |
| **Backend Host** | One Google Compute Engine VM (`asia-southeast1`), Docker Compose + Caddy |
```

#### NEW (apply after vendor confirmed):

```
| **Database** | PostgreSQL (Docker Compose locally, [PROVIDER] managed DB private IP in production) |
| **File Storage** | [PROVIDER] S3-compatible Object Storage (presigned URL uploads) + ClamAV scanning; MinIO locally |
| **Backend Host** | One [PROVIDER] VM (Vietnam region), Docker Compose + Caddy |
```

---

## 5. Staging Acceptance Checks After Provider Switch

These checks must pass before Story 11.2 can be marked `done` on the new provider:

| Check | Description |
|---|---|
| **S3 presigned upload smoke** | Upload a test file (≥ 1 MB) to the new provider bucket using `@aws-sdk/client-s3` with `WHEN_REQUIRED` checksums; download via presigned GET URL. No code change — only ENV vars. |
| **S3 CORS validation** | Browser-side presigned upload from `app.rescom.com.vn` origin succeeds (no CORS error in DevTools). |
| **PostgreSQL private IP** | `prisma db pull` succeeds from the VM; direct connection from the public internet fails. |
| **PITR evidence** | Restore a point-in-time copy of the DB to a scratch instance; document steps and timing for NFR-ADD-5. (If PITR not available: document RPO/RTO and get owner approval for the deviation.) |
| **Firewall check** | TCP port 4000 and DB port are not reachable from the public internet. |
| **OAuth callback** | Google OAuth flow completes with the existing Google Cloud OAuth client (no credential changes needed). |
| **Budget alert fire** | Trigger a cost event; confirm alert reaches Telegram/email. |
| **Staging mirror** | Staging environment mirrors production topology with separate DB, bucket, OAuth client. |

---

## 6. Impact Analysis

### 6.1 Epic Impact

| Epic / Story | Impact |
|---|---|
| Epics 1–IR (done) | None |
| Story 11.1 (done) | None — packaging is provider-neutral; AC7 GCS run deferred to 11.2 is now redirected to new provider S3 smoke |
| **Story 11.2** | **Primary affected story** — GCP references replaced with provider-neutral or provider-specific text |
| Story 11.3 | No change — GHCR and SSH deploy are already provider-neutral |
| Story 11.4 | Minor amendment — "Cloud SQL" → "[PROVIDER] managed DB" |
| Story 11.5 | No change — already provider-neutral |
| Story 11.6 | Minor amendment — remove GCP trial day-70 trigger; preserve portability rehearsal intent |

### 6.2 Artifact Conflicts

| Artifact | Change |
|---|---|
| `epics.md` | Story 11.2 full replacement; Stories 11.4, 11.6 minor amendments |
| `rescom.md` (architecture) | AD-23 amendment appended |
| PRD platform section | Amendment appended |
| `PROJECT_SUMMARY.md` stack table | 3 rows updated after vendor confirmed |
| `sprint-status.yaml` | Story 11.2 status stays `in-progress`; no other changes |

### 6.3 Technical Impact

- **No application code change.** The storage adapter, Prisma, NestJS, ClamAV, Caddy, GitHub Actions pipeline are all unchanged.
- **ENV var changes only** for the new provider: `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET`, `DATABASE_URL`.
- **Story 11.1 AC7** (GCS presigned URL test, deferred) must be re-run against the new provider's S3 endpoint as part of Story 11.2 acceptance.

---

## 7. Unresolved Owner Decisions Required

The following questions must be answered by the owner before canonical edits are applied:

| # | Question | Impact |
|---|---|---|
| **B1** | Which provider: FPT Cloud or VNG Cloud (or other)? | Determines which AC text is finalized for Story 11.2 |
| **B2** | What is the approved monthly hosting budget (VND)? | Determines whether managed PostgreSQL or self-hosted PostgreSQL on VM is used |
| **B3** | FPT Cloud: Is managed PostgreSQL with private IP + PITR available at an affordable price? (requires sales quote) | If No → evaluate self-hosted PostgreSQL on VM or switch to VNG Cloud vDB |
| **B4** | FPT Cloud: Will you pursue an FPT University sponsorship inquiry before activating a paid account? | If Yes → sponsor inquiry must complete before provisioning |
| **B5** | If managed PostgreSQL with PITR is unavailable at budget: Accept self-hosted PostgreSQL on VM + WAL backup to object storage as pilot RPO deviation? | Architecture deviation; must be owner-approved |
| **B6** | What is the payment account owner for cloud billing (team lead vs. individual vs. university account)? | Affects account type and invoice requirements |

---

## 8. Quote Request Checklist for FPT Cloud Sales

Send to `support@fptcloud.com` or call 1800 6139:

```
Subject: Báo giá dịch vụ — Dự án sinh viên FPT University Đà Nẵng

Kính gửi FPT Cloud,

Chúng tôi là nhóm sinh viên thuộc FPT University Đà Nẵng, đang phát triển
nền tảng nghiên cứu cộng đồng RESCOM (phi lợi nhuận, phi thương mại).

Xin vui lòng báo giá gói dịch vụ sau:

1. Cloud Server:
   - 2 vCPU / 4 GB RAM / 40–80 GB SSD
   - Hệ điều hành: Ubuntu 22.04 LTS
   - Kết nối: IP tĩnh, băng thông tối thiểu 100 Mbps
   
2. Managed PostgreSQL (FPT Database Engine):
   - PostgreSQL 15 hoặc 16
   - Kết nối: private IP only (không public internet)
   - Yêu cầu: automated daily backup + Point-in-Time Recovery (PITR)
   - Dung lượng ban đầu: 20–50 GB SSD
   
3. FPT Object Storage:
   - Private bucket (không public)
   - IAM Access Key scoped per bucket
   - CORS configuration (cho phép presigned upload từ domain cụ thể)
   - Ước tính: 10–50 GB/tháng, bandwidth < 100 GB/tháng
   
4. Hỏi thêm: Có chương trình hỗ trợ / tài trợ cho dự án sinh viên
   FPT University không?

Xin báo giá hàng tháng (VND) và cho biết:
- Managed PostgreSQL có hỗ trợ private IP + PITR không?
- Object Storage endpoint có tương thích AWS SDK v3 (S3 API) không?
- Phương thức thanh toán: chuyển khoản ngân hàng có được không?

Trân trọng,
[Tên] — RESCOM Team, FPT University Đà Nẵng
```

---

## 9. Implementation Handoff

### 9.1 Scope Classification

**Moderate** — Story 11.2 AC replacement + architecture amendment + minor 11.4/11.6 amendments. No rollback, no MVP reduction, no application code change.

### 9.2 Handoff Assignments

| Owner | Tasks |
|---|---|
| **Quan (Operations/Owner)** | Answer decisions B1–B6; create FPT Cloud (or VNG Cloud) account; top up via bank transfer; send sales quote request; confirm vendor + budget → trigger canonical edits |
| **Developer agent** | Apply canonical edits to epics.md, rescom.md, PRD, PROJECT_SUMMARY.md, sprint-status.yaml once owner confirms B1–B3 |
| **Quan (Operations)** | Run Story 11.2 provisioning on confirmed provider; run S3 presigned URL smoke (Story 11.1 AC7 redirect) |

### 9.3 Success Criteria for This Change Proposal

- A cloud provider is confirmed by the owner with an active account and confirmed payment method.
- Story 11.2 ACs are updated with provider-specific text and the staging acceptance checks (§5) all pass.
- Story 11.1 AC7 (deferred GCS smoke) passes against the new S3 endpoint — this closes the deferred item.
- AD-23 amendment is recorded in the architecture spine.
- PRD and PROJECT_SUMMARY stack table reflect the confirmed provider.
- No application code was changed; storage adapter and Prisma remain provider-neutral.

---

## 10. Checklist Status (Batch Mode)

| Section | Status |
|---|---|
| 1. Trigger and context | [x] Done — GCP billing blocked; Visa rejected; owner approved switch |
| 2. Epic impact | [x] Done — 11.2 primary; 11.4, 11.6 minor; 11.1/11.3/11.5 unchanged |
| 3.1 PRD | [x] Done — amendment text drafted |
| 3.2 Architecture | [x] Done — AD-23 amendment drafted |
| 3.3 UI/UX | [x] N/A — no UI change |
| 3.4 Other artifacts | [x] Done — PROJECT_SUMMARY stack table change drafted |
| 4. Path forward | [x] Direct Adjustment — provider-neutral replacement; FPT Cloud primary |
| 5. Proposal components | [x] Done — before/after for each affected story and artifact |
| 6. Owner decisions | [!] **Action-needed** — B1–B6 unresolved; canonical edits blocked |
| 7. Final review and handoff | [!] **Pending owner approval** |

---

## 11. Workflow Execution Log

| Date | Event | Result |
|---|---|---|
| 2026-10-03 | Change trigger confirmed | GCP billing blocked — Visa card rejected |
| 2026-10-03 | Owner approved provider switch | Generally approved; specific vendor/budget pending |
| 2026-10-03 | Review mode | Batch |
| 2026-10-03 | Research completed | FPT Cloud: VM/S3 verified; managed PostgreSQL needs quote. VNG Cloud: full stack available, prices estimated. Both support VND payment. |
| 2026-10-03 | Proposal drafted | Before/after edits for Stories 11.2, 11.4, 11.6; AD-23 amendment; PRD + PROJECT_SUMMARY amendments |
| 2026-10-03 | Status | **DRAFT — Stop here. Apply after vendor + budget confirmed.** |
