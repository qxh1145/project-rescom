> **SUPERSEDED 2026-10-05 — GCP dropped.** Pilot runs on Hostinger VPS + Cloudflare R2 (`sprint-change-proposal-2026-10-04-hostinger-vps.md` §7.3). Kept as history only; do not execute.

# Proposed Cloud Resource Inventory & Architecture Plan (Corrected)

- **Date:** 2026-10-03
- **Story:** 11.2 Google Cloud Pilot Infrastructure Provisioning
- **Region:** `asia-southeast1` (Singapore)
- **Architecture Baseline:** AD-23 (Single VM + Cloud SQL + GCS + Vercel + Cloudflare)
- **Status:** PROPOSED TECHNICAL SPECIFICATION — NOT DEPLOYED

---

## 1. Google Cloud Platform (GCP) Resources (Proposed Specification)

### 1.1 Networking (VPC & Private Services Access)
- **VPC Network:** `rescom-vpc` (Custom mode).
- **Subnet:** `rescom-subnet-sea1` (`10.10.0.0/24` in `asia-southeast1`).
- **Private Services Access (PSA):**
  - Reserved peering IP range: `rescom-servicenetworking-range` (`10.20.0.0/16`).
  - Peered connection to `servicenetworking.googleapis.com` for Cloud SQL private IP.
- **Firewall Rules:**
  - `rescom-allow-cloudflare-https`: Allow ingress TCP 80, 443 strictly from Cloudflare published ranges (`TRUSTED_PROXY_RANGES`).
  - `rescom-allow-team-ssh`: Allow ingress TCP 22 strictly from owner-approved team CIDR (approval pending; observed temporary IP was `14.233.81.122/32`).
  - `rescom-deny-all-ingress-default`: Implicit deny all other inbound traffic. Ports 4000 (NestJS API), 3310 (ClamAV), 5432 (Cloud SQL) strictly private.

### 1.2 Database (Cloud SQL for PostgreSQL 15)
- **Engine Version:** PostgreSQL 15 (Standard maintenance version).
- **Instance Identifier:** `rescom-sql-pilot` (Zonal, `asia-southeast1-a`).
- **Tier Sizing Proposal:**
  - *Option A (Pilot Recommended):* `db-g1-small` (1 shared vCPU, 1.7 GB RAM) to conserve trial credits.
  - *Option B (Alternative):* `db-custom-1-3840` (1 vCPU, 3.75 GB RAM) for higher memory headroom.
  - *Storage:* 10 GB SSD (`pd-ssd`), auto-resize enabled (cap at 50 GB).
- **Network Interface:** Private IP only (`no public IPv4`), bound to `rescom-vpc` via Private Services Access.
- **Security & TLS:** `sslmode=require` / `ENCRYPTED_ONLY`. Timezone: `UTC`.
- **Backup & PITR Configuration:**
  - Automated daily backups: Enabled (7-day retention).
  - Transaction log retention: 7 days for Point-in-Time Recovery.
  - Backup window: 19:00 UTC (02:00 ICT off-peak).
  - Deletion protection: Enabled.
- **Database & Identity Isolation:**
  - Single instance hosting two distinct logical databases:
    - `rescom_staging`
    - `rescom_prod` (schema pre-reserved; no dark deploy or live traffic until Story 11.5)
  - Dedicated PostgreSQL roles:
    - `rescom_staging_user`
    - `rescom_prod_user`
  - Explicit privilege revocation and isolation:
    ```sql
    REVOKE CONNECT ON DATABASE rescom_staging FROM PUBLIC;
    REVOKE CONNECT ON DATABASE rescom_prod FROM PUBLIC;
    GRANT CONNECT ON DATABASE rescom_staging TO rescom_staging_user;
    GRANT CONNECT ON DATABASE rescom_prod TO rescom_prod_user;
    ```
  - Cross-environment connection denial must be verified upon database creation.

### 1.3 Object Storage (Google Cloud Storage)
- **Buckets:**
  - Staging: `rescom-<project-id>-staging`
  - Production: `rescom-<project-id>-prod`
- **Location & Class:** Regional `asia-southeast1`, Standard Storage.
- **Access Controls:**
  - Uniform bucket-level access: `ENABLED`.
  - Public access prevention: `ENFORCED` (`no public read/write`).
- **Identities & Service Accounts:**
  - Staging SA: `sa-rescom-storage-staging@<project-id>.iam.gserviceaccount.com`
  - Production SA: `sa-rescom-storage-prod@<project-id>.iam.gserviceaccount.com`
  - IAM Binding: Bucket-level `roles/storage.objectAdmin` restricted strictly to each respective bucket (no project-wide storage role).
- **HMAC Credentials:**
  - Separate HMAC key generated per environment service account for XML S3 API interoperability (`STORAGE_ENDPOINT=https://storage.googleapis.com`, `STORAGE_FORCE_PATH_STYLE=true`).
  - Credential references only; secrets captured securely in environment files/secret managers.
- **CORS Configuration:**
  *Must expose required checksum and metadata headers for AWS SDK browser PUTs:*
  - Staging bucket:
    ```json
    [
      {
        "origin": ["https://staging-app.rescom.com.vn"],
        "method": ["PUT", "GET", "HEAD"],
        "responseHeader": [
          "Content-Type",
          "ETag",
          "Content-Disposition",
          "x-amz-checksum-sha256",
          "x-amz-sdk-checksum-algorithm"
        ],
        "maxAgeSeconds": 3600
      }
    ]
    ```
  - Production bucket:
    ```json
    [
      {
        "origin": ["https://app.rescom.com.vn"],
        "method": ["PUT", "GET", "HEAD"],
        "responseHeader": [
          "Content-Type",
          "ETag",
          "Content-Disposition",
          "x-amz-checksum-sha256",
          "x-amz-sdk-checksum-algorithm"
        ],
        "maxAgeSeconds": 3600
      }
    ]
    ```

### 1.4 Compute Engine VM (Pilot Staging)
- **Instance Identifier:** `rescom-vm-staging`
- **Machine Type:** `e2-medium` (2 vCPUs, 4 GB RAM) in `asia-southeast1-a`.
- **Boot Disk:** 30 GB `pd-balanced`, Debian 12 amd64.
- **Static External IP:** `rescom-ip-staging` (Standard external IPv4).
- **Service Account:** Dedicated VM identity `sa-rescom-vm-staging@<project-id>.iam.gserviceaccount.com` with least privilege (Logging write, Monitoring metric write; no Editor or broad roles).
- **Labels:** `app=rescom`, `environment=staging`, `owner=quan`.
- **Software Stack:**
  - Docker Engine & Docker Compose plugin.
  - Caddy `2.11.6-alpine` (ports 80, 443).
  - NestJS API container (immutable amd64 digest from GHCR, port 4000 internal).
  - ClamAV Debian `1.5.4` (port 3310 internal).
- **Volume Mounts:**
  - Caddy data/config: `caddy_data`, `caddy_config`.
  - Origin CA certificates: `/opt/rescom/deploy/certs` (read-only mode 400).
  - ClamAV signatures: `clamav_db`.
  - No database or persistent user upload volumes on host.

---

## 2. Edge & Cloudflare Configuration (Proposed Specification)

- **Zone:** `rescom.com.vn`
- **DNS Records:**
  - `staging-api.rescom.com.vn` -> A record pointing to `rescom-vm-staging` static external IP (Proxied / Orange Cloud).
  - `staging-app.rescom.com.vn` -> CNAME pointing to `cname.vercel-dns.com` (DNS only / Grey Cloud recommended to preserve genuine client IP).
- **SSL / TLS Mode:** Full (strict).
- **Origin CA Certificates (Environment Isolation):**
  - Staging Origin CA certificate mounted at `/opt/rescom/deploy/certs/origin.pem` and `origin-key.pem` on the staging VM, covering `staging-api.rescom.com.vn`.
  - Production Origin CA certificate mounted on the production VM, covering `api.rescom.com.vn`.
  - Separate certificates and private keys per environment; no shared certificates across environments.
- **Dynamic Caching & Bypass (Accounting for Next.js Rewrite):**
  - *Next.js Rewrite Behavior:* `apps/frontend/my-app/next.config.ts` rewrites `/api/:path*` to `${RESCOM_API_URL}/:path*`. Because `RESCOM_API_URL` has no `/api` suffix, requests arrive at Cloudflare and Caddy as `/:path*` (e.g. `/auth/google`, `/surveys/123`, `/health/ready`), NOT `/api/:path*`.
  - *Cloudflare Rule:* Cache bypass and security challenge bypass rules must apply to the entire API hostname (`staging-api.rescom.com.vn/*` / `api.rescom.com.vn/*`), rather than filtering on `/api/*`.

---

## 3. Vercel Frontend Configuration (Proposed Specification)

- **Monorepo Root:** `apps/frontend/my-app`
- **Function Region:** `sin1` (Singapore).
- **Staging Environment Variables:**
  - `RESCOM_API_URL`: `https://staging-api.rescom.com.vn` (no trailing `/api`).
  - `RESCOM_EDGE_KEY`: Secret string matching staging VM `EDGE_KEY` (Server-only, no `NEXT_PUBLIC_`).
  - `NEXT_PUBLIC_API_URL`: `/api` (Internal rewrite via `next.config.ts`).
  - `NEXT_PUBLIC_PILOT_BUILD`: `true`
  - `NEXT_PUBLIC_API_MOCKING`: `disabled`
- **Production Environment Variables:**
  - Dedicated production values; completely isolated from staging keys.

---

## 4. Google Cloud Billing Budget & Gross Credit Configuration (Proposed Specification)

- **Budget Name:** `rescom-pilot-budget-200`
- **Scope:** Rescom Pilot GCP Project.
- **Target Amount:** **USD 200.00**.
- **Time Period:** Trial period duration (or Monthly, pending owner trial start/expiry date).
- **Credit Treatment:** **Gross Spend (Exclude credits/promotions from spend deduction)**.
  - Reason: Configuring the budget to track gross spend ensures threshold notifications fire based on real resource consumption, before trial credits are exhausted.
- **Threshold Rules (Actual Spend):**
  - 25% (USD 50.00)
  - 50% (USD 100.00)
  - 100% (USD 200.00)
- **Notification Channels:** Direct email alerts to Quan and Cloud Monitoring channels.
- *Notice:* This is a proposed configuration setting to be executed in Task B, not currently deployed.
