> **SUPERSEDED 2026-10-05 — GCP dropped.** Pilot runs on Hostinger VPS + Cloudflare R2 (`sprint-change-proposal-2026-10-04-hostinger-vps.md` §7.3). Kept as history only; do not execute.

# Task A Preflight and Access Verification Report (Corrected)

- **Date:** 2026-10-03
- **Story:** 11.2 Google Cloud Pilot Infrastructure Provisioning
- **Baseline Commit:** `1cf4149` (Story 11.1 packaging)
- **Implementer:** Antigravity (implementer persona)
- **Status:** TASK A PARTIAL PREFLIGHT — BLOCKED ON EXTERNAL INPUTS & PRICING VERIFICATION

---

## 1. Executive Summary

Task A is a read-only, non-destructive preflight audit. It executes strictly without creating billable cloud resources or altering live DNS. Its objectives are:
1. Audit local tooling and shell environment configurations for Google Cloud, Cloudflare, Vercel, and GitHub.
2. Verify non-secret technical inputs against official documentation and repository contracts with reproducible command evidence.
3. Establish a preliminary, unconfirmed resource inventory and monthly budget model with explicit assumptions.
4. Identify unresolved owner inputs and access prerequisites blocking Task B (cloud provisioning) without asserting unverified negative claims.

---

## 2. Environment & Tooling Audit (Narrowed to Verified Scope)

The checks below report strictly what was tested in the current non-interactive shell process. They do not scan system keyrings, browser session stores, or external web consoles:

| Tool / Target | Command Tested | Result / Scope Checked | Status / Action Needed |
| :--- | :--- | :--- | :--- |
| **Docker & Compose** | `which docker` | Present at `/usr/local/bin/docker`; Docker Engine & Compose plugin available. | Ready for local or containerized tasks. |
| **GitHub CLI (`gh`)** | `which gh`, `gh auth status` | Present at `/opt/homebrew/bin/gh`; authenticated as `qxh1145` (`repo`, `workflow`, `read:org`). | Ready to manage GHCR packages and repo secrets. |
| **Google Cloud SDK (`gcloud`)** | `which gcloud` | Not found in current `$PATH`. | Operator session needed (`gcloud` CLI in terminal or web console execution). |
| **Vercel CLI (`vercel`)** | `which vercel` | Not found in current `$PATH`. | Vercel CLI / Web Console access needed. |
| **Cloudflare CLI (`wrangler`)** | `which wrangler` | Not found in current `$PATH`. | Cloudflare Web Console or API token reference needed. |
| **Shell GCP Credentials** | `env \| grep -E 'GOOGLE\|GCP\|CLOUDSDK'` | No GCP service account keys or project variables exported in active shell. | Operator must select project in authenticated session. |
| **GCP Project & Billing** | None | No project ID or billing account bound in current environment. | **BLOCKER 1:** GCP Project ID and trial billing account confirmation needed from Quan. |

> [!NOTE]
> The absence of `gcloud` in `$PATH` indicates only that the binary is not present in the current terminal execution environment; it does not imply the owner lacks an active Google Cloud account, trial credit, or browser console access.

---

## 3. Verified Non-Secret Technical Inputs

### 3.1 Cloudflare Edge Proxy IP Ranges
- **Source:** Cloudflare published endpoint lists (`https://www.cloudflare.com/ips/`).
- **Commands Executed:**
  ```bash
  curl -s https://www.cloudflare.com/ips-v4
  curl -s https://www.cloudflare.com/ips-v6
  ```
- **Retrieved IPv4 Ranges (15 CIDRs):**
  `173.245.48.0/20`, `103.21.244.0/22`, `103.22.200.0/22`, `103.31.4.0/22`, `141.101.64.0/18`, `108.162.192.0/18`, `190.93.240.0/20`, `188.114.96.0/20`, `197.234.240.0/22`, `198.41.128.0/17`, `162.158.0.0/15`, `104.16.0.0/13`, `104.24.0.0/14`, `172.64.0.0/13`, `131.0.72.0/22`.
- **Retrieved IPv6 Ranges (7 CIDRs):**
  `2400:cb00::/32`, `2606:4700::/32`, `2803:f800::/32`, `2405:b500::/32`, `2405:8100::/32`, `2a06:98c0::/29`, `2c0f:f248::/32`.
- **Validation:** Matches the CIDR list defined in `deploy/.env.prod.example` (`TRUSTED_PROXY_RANGES`).

### 3.2 Operator Host Egress & Local SSH Key
- **Observed Dynamic Egress IP:** `14.233.81.122/32` (observed dynamically via `curl -s https://api.ipify.org`).
  *Important:* This is an observed single-point egress IP only. It is **NOT** an owner-approved, static team SSH CIDR. Approval of a stable team CIDR or VPN range is explicitly pending.
- **Local Public SSH Key:** `~/.ssh/id_ed25519.pub`
  - Fingerprint: `SHA256:tvV/peD60U6FKungpHdeiTWi7QCN0rf8QOBa0UDVWpk`
  - Comment: `quan@MacBook-Pro-M4-Max`
  - Type: `ED25519`

### 3.3 Container Architecture & Baseline
- Repository baseline commit: `1cf4149` (Story 11.1 packaging).
- Local image `rescom-api:local` (ID `380b8dcbacb8`) is built for `arm64/linux`. Compute Engine `e2-medium` uses `amd64/linux`. An amd64 image must be compiled and pushed to GHCR (`ghcr.io/qxh1145/rescom-api:<sha>`) before staging deployment.
- Target container composition (AD-23):
  - `caddy:2.11.6-alpine`
  - `rescom-api:<sha>` (Prisma + NestJS, port 4000 private)
  - `clamav/clamav-debian:1.5.4` (clamd port 3310 private)

---

## 4. Pending Owner Decisions & Missing Inputs

| Item | Current Status | Requirement / Least-Privilege Action |
| :--- | :--- | :--- |
| **GCP Project ID** | Missing | Owner to provide target project ID. |
| **GCP Billing Account** | Missing | Owner to confirm billing account linkage and trial duration/credits. |
| **Operator GCP Access** | Pending | Authenticated least-privilege operator session (e.g. `gcloud auth login` in terminal) or repository secret-store references. *(Do not share private credentials or admin keys in chat).* |
| **Budget Alert Email** | Pending | Actual email address(es) for Quan to receive Cloud Billing alerts at $50, $100, $200. |
| **Cloud SQL Sizing & Isolation Model** | Decision Pending | Confirm Option A (`db-g1-small` on single shared instance, isolated DBs/roles) vs Option B (`db-custom-1-3840`), or separate instances. |
| **Cloudflare Zone Access** | Pending | DNS management access on `rescom.com.vn` for creating staging DNS and Origin CA certificate. |
| **Google OAuth Staging Client** | Pending | Staging Client ID & Secret configured in Google Auth Platform with redirect `https://staging-app.rescom.com.vn/api/auth/google/callback`. |
| **SMTP Delivery Provider** | Pending | Provider selection and domain verification for sender `no-reply@rescom.com.vn`. |
| **Team SSH CIDR** | Pending | Owner approval of authorized team IP range(s) for port 22 allowlist. |

---

## 5. Provisioning Readiness Verdict

- **Task A Status:** **PARTIAL PREFLIGHT (IN-PROGRESS)** — non-destructive audit completed; cost model and external access inputs remain unconfirmed.
- **Task B Status:** **BLOCKED** — cannot provision billable GCP networking, database, storage, or VM until target project and operator access are established.
