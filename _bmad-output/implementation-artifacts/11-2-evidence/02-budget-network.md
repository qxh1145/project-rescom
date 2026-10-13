> **SUPERSEDED 2026-10-05 — GCP dropped.** Pilot runs on Hostinger VPS + Cloudflare R2 (`sprint-change-proposal-2026-10-04-hostinger-vps.md` §7.3). Kept as history only; do not execute.

# Cloud Budget, SKU Estimates, and Network Security Plan (Corrected)

- **Date:** 2026-10-03
- **Story:** 11.2 Google Cloud Pilot Infrastructure Provisioning
- **Region:** `asia-southeast1` (Singapore)
- **Status:** PRELIMINARY PLANNING ESTIMATE — OFFICIAL QUOTE PENDING OWNER BILLING CONFIRMATION

---

## 1. Google Cloud Pilot Cost Estimates (Monthly Run Rate)

### 1.1 Documentation Sources & Assumptions (Consulted 2026-10-03)
- Compute Engine Pricing: [https://cloud.google.com/compute/all-pricing](https://cloud.google.com/compute/all-pricing)
- Cloud SQL for PostgreSQL Pricing: [https://cloud.google.com/sql/pricing](https://cloud.google.com/sql/pricing)
- Cloud Storage Pricing: [https://cloud.google.com/storage/pricing](https://cloud.google.com/storage/pricing)
- Network & Egress Pricing: [https://cloud.google.com/vpc/network-pricing](https://cloud.google.com/vpc/network-pricing)
- Cloud Billing Budgets: [https://cloud.google.com/billing/docs/how-to/budgets](https://cloud.google.com/billing/docs/how-to/budgets)

**Traffic & Operating Assumptions:**
1. Operating duration: 730 hours/month (continuous run).
2. Location: Region `asia-southeast1` (Singapore), single zone (`asia-southeast1-a`) for both VM and Cloud SQL to avoid cross-zone network egress charges ($0.01/GB).
3. Traffic scale: Synthetic / pilot load. Internet egress assumed < 100 GB/month (covered under the global 100 GB/month Free Tier per billing account; note: this is a usage assumption, not a guaranteed unlimited free egress). Any internet egress exceeding 100 GB/month is billed at $0.12/GB.
4. Storage volume: 10 GB Cloud SQL baseline SSD; 10 GB Cloud Storage; < 10,000 Class A/B XML API requests/month.
5. All figures below are **preliminary planning estimates** and must be validated against the official Google Cloud Pricing Calculator once the billing account is bound.

---

### 1.2 Scenario A: Staging-Only Deployment (Phase 1 Target)

This scenario provisions only the staging environment (`rescom-vm-staging`, staging Cloud SQL database, staging GCS bucket).

| Component | SKU / Specification | Unit Rate (`asia-southeast1`) | Monthly Cost (USD) | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Compute VM** | `e2-medium` (2 vCPU, 4 GB RAM) | ~$0.0392 / hour | ~$28.62 | Staging API, Caddy & ClamAV. |
| **Boot Disk** | 30 GB `pd-balanced` | ~$0.110 / GB / month | $3.30 | Debian 12 amd64 OS + Docker. |
| **Static IPv4** | In-use standard external IPv4 | $0.005 / hour | $3.65 | Reserved origin IP for Cloudflare. |
| **Cloud SQL Compute (Option A)** | `db-g1-small` (1 shared vCPU, 1.7 GB RAM) *(Pilot proposal)* | ~$0.0450 / hour | ~$32.85 | Sized for pilot trial runway. |
| *Cloud SQL Alternative (Option B)* | `db-custom-1-3840` (1 vCPU, 3.75 GB RAM) *(Production tier)* | ~$0.0910 / hour | *~$66.43* | Sized for standard production load. |
| **Cloud SQL Storage** | 10 GB SSD (`pd-ssd`) | ~$0.187 / GB / month | $1.87 | Initial size, auto-expandable. |
| **Cloud SQL Backups & PITR** | 7 daily backups + 7-day WAL logs | ~$0.088 / GB / month | ~$1.20 | Differential snapshots + WAL storage. |
| **Cloud Storage (GCS)** | Regional Standard (10 GB) | $0.023 / GB / month | $0.23 | Survey uploads. |
| **Cloud Storage Ops** | Class A & Class B | $0.005 / 1k (A), $0.0004 / 1k (B) | ~$0.20 | Pilot request volume. |
| **Network Egress** | Internet egress | Tier 0–100 GB/mo | $0.00 | Assumes < 100 GB/mo free tier; $0.12/GB thereafter. |
| **Subtotal Staging-Only (Option A)** | `db-g1-small` | — | **~$71.92 / month** | **Estimated staging burn rate** |
| *Subtotal Staging-Only (Option B)* | `db-custom-1-3840` | — | *~$105.50 / month* | *Estimated staging burn rate* |

---

### 1.3 Scenario B: Simultaneous Staging + Production Resources

If both staging and production VMs run simultaneously with separate static IPs, and databases are hosted either on a shared instance or separate instances:

| Model | Resource Composition | Monthly Estimate (USD) | 90-Day Trial Impact ($300 Credit) |
| :--- | :--- | :--- | :--- |
| **Shared DB Instance (Option A1)** | 2 VMs (`e2-medium`) + 2 Disks (30 GB) + 2 Static IPs + 1 Shared Cloud SQL (`db-g1-small`) with 2 DBs + 2 GCS buckets | **~$107.49 / month** | **~$322.47** (Exceeds $300 trial if both run continuously for 90 days; requires staged start or VM scheduling). |
| **Shared DB Instance (Option B1)** | 2 VMs (`e2-medium`) + 2 Disks (30 GB) + 2 Static IPs + 1 Shared Cloud SQL (`db-custom-1-3840`) with 2 DBs + 2 GCS buckets | **~$141.07 / month** | **~$423.21** (Exceeds trial credit; unsustainable without paid funding). |
| **Dual DB Instances (Option A2)** | 2 VMs + 2 Disks + 2 IPs + 2 Cloud SQL instances (`db-g1-small`) + 2 GCS buckets | **~$143.41 / month** | **~$430.23** (Exceeds trial credit). |

**Strategic Recommendation:**
To prevent exhausting trial credits prematurely, only the **Staging environment** (Scenario A, Option A: `~$72/month`) should be provisioned in Story 11.2. Production VM and production dark deployment must remain deferred until Story 11.5 after the go/no-go gate.

---

## 2. Cloud Billing Budget & Gross Credit Configuration (Proposed Specification)

To satisfy **Acceptance Criterion 1 (AC1)**:
- **Budget Name:** `rescom-pilot-budget-200` (Proposed).
- **Scope:** Rescom Pilot GCP Project.
- **Budget Target Amount:** **USD 200.00**.
- **Time Period:** Proposed: Project duration / Trial runway window (pending owner confirmation of trial start/end date).
- **Credit Treatment (Gross Spend):**
  - Setting: **Exclude promotional credits from spend deduction** (track Gross Usage).
  - Rationale: If credits are deducted from calculated spend, alerts will not fire until the $300 credit is almost exhausted. Tracking gross spend ensures alerts fire when raw resource consumption hits $50, $100, and $200.
- **Alert Thresholds (Actual Spend):**
  1. **25% (USD 50.00)** — Triggers initial alert to Quan. Action: Audit resource utilization and verify no stray resources exist.
  2. **50% (USD 100.00)** — Triggers mid-point alert. Action: Review Cloud SQL growth and network egress.
  3. **100% (USD 200.00)** — Triggers critical alert. Action: Mandatory review of pilot runway before proceeding.
- **Notification Channels:** Direct email alerts to Quan and Cloud Monitoring notification channels.
- *Notice:* Cloud Billing budgets are **alerts-only** and do not automatically stop running resources.

---

## 3. Network Architecture & Security Specification

```
 Internet (Browsers)
       │
       ▼
 Vercel Frontend (app.rescom.com.vn / staging-app.rescom.com.vn)
 [Region: sin1 | Headers: x-rescom-edge-key, x-rescom-client-ip]
       │
       ▼ (Rewrite: /api/* -> https://api.rescom.com.vn/*)
 Cloudflare Edge Proxy (api.rescom.com.vn / staging-api.rescom.com.vn)
 [Full (Strict) TLS | Separate Origin CAs | TRUSTED_PROXY_RANGES]
       │
       ▼ (Ports 80/443 only from Cloudflare published IPs)
 GCP External IPv4 (Static IP: rescom-ip-staging)
       │
 ┌─────┴─────────────────────────────────────────────────────────────────┐
 │ GCP VPC Network: rescom-vpc (10.10.0.0/24)                             │
 │                                                                       │
 │  VM: rescom-vm-staging (e2-medium)                                    │
 │  ┌─────────────────────────────────────────────────────────────────┐  │
 │  │ Caddy 2.11.6 (Ports 80/443 host)                                │  │
 │  │  - Validates x-rescom-edge-key == EDGE_KEY                       │  │
 │  │  - Filters client IP from Cloudflare peer                       │  │
 │  │  - Reverse proxy to api:4000 (Docker internal bridge)           │  │
 │  └───────────────┬─────────────────────────────────────────────────┘  │
 │                  ▼                                                    │
 │  ┌─────────────────────────────────┐   ┌───────────────────────────┐  │
 │  │ NestJS API (Port 4000 internal) │──▶│ ClamAV (Port 3310 intern) │  │
 │  └───────────────┬─────────────────┘   └───────────────────────────┘  │
 └──────────────────┼────────────────────────────────────────────────────┘
                    │ Private IP (Private Services Access: 10.20.0.0/16)
                    ▼
 ┌───────────────────────────────────────────────────────────────────────┐
 │ Cloud SQL: rescom-sql-pilot (PostgreSQL 15)                           │
 │ Private IP only (e.g. 10.20.0.3) | sslmode=require | Timezone UTC     │
 │ Databases: rescom_staging, rescom_prod (isolated roles & grants)      │
 └───────────────────────────────────────────────────────────────────────┘
```

### 3.1 Firewall Rules Matrix

| Rule Name | Direction | Priority | Source Filter | Destination | Protocols & Ports | Action |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `rescom-allow-cloudflare-http-https` | Ingress | 1000 | Cloudflare published ranges (`TRUSTED_PROXY_RANGES`) | Target: `rescom-vm-staging` | TCP 80, 443 | **ALLOW** |
| `rescom-allow-team-ssh` | Ingress | 1000 | Owner-approved team CIDR (approval pending) | Target: `rescom-vm-staging` | TCP 22 | **ALLOW** (Keys-only) |
| `default-deny-all-ingress` | Ingress | 65534 | `0.0.0.0/0`, `::/0` | All instances | All protocols | **DENY** |
| `rescom-allow-egress-all` | Egress | 1000 | Local VPC | `0.0.0.0/0` (DNS, HTTPS, S3, SMTP) | All protocols | **ALLOW** |

### 3.2 Port Exposure & Protection Summary

| Port | Service | Host Binding | Public Exposure | Protection Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **80 / 443** | Caddy Edge | Host public IP | **Restricted** | GCP Firewall allows only Cloudflare IPs; direct access dropped. |
| **22** | OpenSSH | Host public IP | **Restricted** | GCP Firewall allows only owner-approved team CIDR; keys-only, root disabled. |
| **4000** | NestJS API | Docker bridge `api:4000` | **NONE** | No host port mapping; reachable only by Caddy container. |
| **3310** | ClamAV Daemon | Docker bridge `clamav:3310` | **NONE** | No host port mapping; reachable only by NestJS container. |
| **5432** | Cloud SQL | VPC Private IP (`10.20.0.x`) | **NONE** | Public IP disabled; reachable only within `rescom-vpc` over TLS. |
