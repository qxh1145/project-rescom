# Hostinger VPS Read-Only Inventory Evidence (Measured Baseline)

> **Task:** Read-Only Hostinger VPS Remote Inventory (Story 11.2 Assessment)  
> **Date:** 2026-10-04  
> **Target:** `root@201.18.212.192` (Hostinger VPS)  
> **Status:** **INVENTORY COMPLETE (READ-ONLY MEASUREMENT)**  
> **Supervisor:** Codex | **Executor:** AGY

---

## 1. Remote Execution & Hardware Baseline (Measured vs Reported)

Inventory executed strictly read-only via authenticated SSH agent (`SHA256:tvV/peD60U6FKungpHdeiTWi7QCN0rf8QOBa0UDVWpk`):

```
uname -a: Linux srv2026011 6.1.0-53-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.1.187-1 x86_64 GNU/Linux
os-release: Debian GNU/Linux 12 (bookworm)
lscpu: AMD EPYC 9355P 32-Core Processor, 2 vCPUs (1 socket, 2 cores, 1 thread/core)
free -h: Total 7.8 GiB | Used: 451 MiB | Free: 6.6 GiB | Available: 7.3 GiB | Swap: 0 B
df -h: Filesystem /dev/sda1 | Size: 99 GB | Used: 2.0 GB (3%) | Available: 93 GB
```

- **CPU Core Discrepancy:** Measured **2 vCPUs** (AMD EPYC 9355P @ 2.0GHz) vs. **4 vCPUs reported**.
- **Memory & Swap:** 7.8 GiB physical RAM available. **Swap is 0 B** (no swap file configured). Any 4 GB swap recommendation is an optional proposal subject to live measurement, not an assumed or guaranteed capacity fit.
- **Disk Headroom:** 93 GB available SSD space. Minimal host footprint (2.0 GB used by base OS).

---

## 2. Docker Daemon & Workload Inventory (Actual Measured State)

Sanitized read-only inspection of the active Docker engine:
- `docker --version`: Docker version 29.8.2, build 7fc2dff | `docker compose version`: v5.5.1
- `docker ps -a`: **0 containers** (no running, stopped, or exited containers).
- `docker compose ls`: **0 active compose stacks**.
- `docker images`: **0 images** present (0 B used).
- `docker volume ls`: **0 volumes** present (no `pgdata`, `minio_data`, or `caddy_data`).
- `docker system df`: 0 B total disk usage across images, containers, volumes, and build cache.
- **Discrepancy & Evidence Boundary:** The active Docker daemon currently runs zero containers and manages zero volumes, with no relevant listening service ports. However, this measured snapshot does **NOT** prove services were never deployed historically or that customer data does not exist in an external database, another host, or detached storage. The discrepancy between the owner-reported running deployment and this empty Docker daemon requires owner clarification.

---

## 3. Working Directory & Codebase Metadata

Inspection of repository path (`/opt/rescom`):
- Cloned repo path: `/opt/rescom` (branch: `develop`, clean working tree).
- Checked-out commit: `132d430 update`.
- Remote Tracked Origin Note: The local branch ref points to `origin/develop` at `132d430`, but remote tracking status is not proven to be current HEAD without a network `git fetch` (prohibited under read-only boundary).
- Deployment files present in `/opt/rescom/deploy/`:
  - `docker-compose.prod.yml` (Single-VPS stack manifest on commit `132d430`)
  - `Caddyfile` (Reverse proxy routing for `{$APP_DOMAIN}` and `{$S3_DOMAIN}`)
  - `.env.prod` (Untracked environment file, created Oct 1 15:34)
  - `backup.sh` (Shell backup script present)
- Deployment history, alternate runtime paths, and external data storage locations remain **Unknown**.

---

## 4. Deployed Storage & URL Topology (Configuration Evidence)

Extracted non-secret configuration keys from `/opt/rescom/deploy/.env.prod`:
- `APP_DOMAIN`: `rescom.io.vn` (Note: `.io.vn` TLD configured on VPS, distinct from documentation example `rescom.com.vn`)
- `S3_DOMAIN`: `s3.rescom.io.vn`
- `STORAGE_ENDPOINT`: `https://s3.rescom.io.vn`
- `STORAGE_BUCKET`: `rescom-private-storage`
- `STORAGE_FORCE_PATH_STYLE`: `true`
- `STORAGE_REGION`: `us-east-1`
- `EMAIL_DELIVERY_MODE`: `smtp`
- **Storage Evidence Boundary:** The presence of environment variable keys in `.env.prod` is configuration evidence only; it does **NOT** prove a functioning storage service or that the referenced bucket exists and is operational. No MinIO container or S3 volume is currently active on the daemon.

---

## 5. Network Listeners, Firewall & Backup Schedulers

- **Network Listeners (`ss -tulpn`):**
  - TCP 22 (`sshd`, pid 601) listening on all interfaces.
  - UDP/TCP 53, 5355 (`systemd-resolve`).
  - TCP 127.0.0.1:1721, 65529 (`monarx-agent`, Hostinger security agent).
  - Ports 80, 443, 3000, 4000, 5432, 9000 are **NOT listening**.
- **Firewall Status:**
  - `ufw` is not installed; host-level `iptables` INPUT policy is ACCEPT.
  - *Edge Firewall Boundary:* Host-level ACCEPT does **NOT** prove an edge firewall is absent; upstream Hostinger hPanel firewall settings remain **Unknown**.
  - *Target Architecture Requirement:* Future firewall provisioning must restrict SSH strictly to authorized team CIDRs (keys-only), restrict HTTP/HTTPS 80/443 strictly to Cloudflare proxy ranges, prevent Docker iptables bypass for database/scanner services on IPv4/IPv6, and preserve operator access (avoiding blanket 22/80/443 allow rules).
- **Backup Scheduler:**
  - `crontab: command not found` (Debian minimal install without cron daemon).
  - `/etc/cron.d` contains only `docker-image-prune`, `docker-builder-prune`, `monarx-update`, `e2scrub_all`.
  - `systemctl list-timers`: 7 default system maintenance timers; zero application backup timers.
  - `/var/log/rescom*` and `/opt/rescom/deploy/backups`: Do not exist on the filesystem.

---

## 6. Resource Headroom & Operational Risk Summary

1. **CPU Contention Risk:** Host has **2 vCPUs** (not 4 vCPUs). ClamAV signature compilation and Next.js frontend builds are CPU-intensive and must not run concurrently with API workloads.
2. **Memory Contention & OOM Risk:** 7.8 GiB RAM is constrained if running full multi-service stack; **0 B swap** creates OOM-kill risk during memory spikes. A swap partition/file is an optional proposal subject to live load verification.
3. **Operational Unknowns & Discrepancies:** User-reported running deployment vs. empty Docker daemon, live data location, and upstream Hostinger hPanel firewall configuration remain unverified.

---

## 7. Next Bounded Task

- **Authorization Scope Boundary:** The inventory task is complete and does **NOT** authorize live host changes, package installations (`ufw`, `cron`), swap provisioning, `git pull`, or container execution. All live changes require explicit owner approval.
- **Next Bounded Task (Story 11.2 Phase 1 — Draft Host Preparation & Staging Plan):**
  Draft a non-destructive plan artifact defining:
  1. Host preparation proposal: swapfile sizing and memory measurement strategy.
  2. Strict firewall architecture: team CIDR-restricted SSH, Cloudflare-only ingress on 80/443, Docker iptables bypass mitigation, and IPv6 posture.
  3. Systemd timer definition for non-secret `deploy/backup.sh` invocation.
  4. Clarification questions for the owner regarding the reported deployment discrepancy and live database location.
