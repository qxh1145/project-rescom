---
created: 2026-10-03
story_key: 11-2-hostinger-vps-pilot-infrastructure-provisioning
epic: 11
baseline_commit: 1cf4149
owner: Quan
technical_checklist: 11-2-cloud-infrastructure-checklist.md
---

# Story 11.2: Hostinger VPS Pilot Infrastructure Provisioning

Status: in-progress

## Story

As an Operator,
I want the pilot infrastructure provisioned on the owner's Hostinger VPS with least exposure,
so that the API, database and storage are reachable only through the intended paths.

## Execution readiness and scope

Re-scoped 2026-10-05 from Google Cloud after `sprint-change-proposal-2026-10-04-hostinger-vps.md` was approved with owner decisions B1–B4 (§7.3). GCP evidence in `11-2-evidence/` is historical. Hostinger evidence goes to `11-2-hostinger-evidence/`.

- **B1 Greenfield:** The measured VPS is Debian 12 x86_64 with 2 vCPU, 7.8 GiB RAM, 0 swap, 99 GB SSD and an empty Docker daemon. No live data exists, so no pre-change backup is needed before first deploy.
- **B2 Off-host backup:** Cloudflare R2, in a dedicated WAL/base-backup bucket.
- **B3 DR targets:** RPO 15 minutes and RTO 4 hours (pilot).
- **B4 File storage:** Cloudflare R2 through the existing S3 adapter. No MinIO.

IR.1, IR.5 and 11.1 are `done`. Story 11.1 transfers the real object-storage verification (AC7) to this story, now against R2. Provision staging first with synthetic data. Production dark deploy, migration and cohort opening belong to Story 11.5.

In scope: host preparation, firewall, Compose stack (Caddy, API, PostgreSQL, ClamAV), WAL archiving to R2, R2 upload buckets, Cloudflare DNS/TLS, Vercel, OAuth, SMTP, staging migration/bootstrap, verification and an operator runbook. Out of scope: CI/CD (11.3), alerting and the PITR restore drill (11.4), production launch (11.5), post-pilot hosting review (11.6) and Phase 2 features.

## Acceptance Criteria

Source: `epics.md`, Story 11.2 (re-scoped 2026-10-05).

1. **Host:** The VPS has a swapfile (size recorded), cron or systemd timers available, and a recorded post-start RAM/CPU/disk baseline. Image builds and ClamAV signature reloads do not run on the API's peak path.
2. **Database:** PostgreSQL 15 runs as a private container on a named durable volume with no published port. Staging and production use separate databases and roles, and `PUBLIC` `CONNECT` is revoked. `prisma migrate deploy` runs explicitly from the same immutable API image and never runs on API startup. Staging migration succeeds, and the production procedure is prepared for the 11.5 gate.
3. **Backup:** WAL archiving (`wal-g` or `pgBackRest`) plus a base backup ship to a dedicated private R2 bucket with a token scoped to that bucket. `archive_timeout` supports the 15-minute RPO, and archive failure is detectable. A first base backup and continuing WAL segments are visible in R2. The restore drill belongs to 11.4.
4. **Storage:** Each environment has a private R2 upload bucket, an API token scoped to that bucket only, and CORS limited to that environment's frontend origin. No MinIO service or `S3_DOMAIN` route exists in the pilot stack. Bucket naming is recorded against persisted `StoredObject.bucket`.
5. **Network:** The host firewall admits 80/443 only from current Cloudflare IP ranges. SSH is keys only and restricted to recorded team CIDRs. IPv6 posture is documented. Docker-published ports cannot bypass the firewall. Ports 4000, 3310 and 5432 are not public.
6. **API edge:** Cloudflare proxies the API hostname with Full (strict) and an Origin CA certificate. Caddy enforces the edge-key gate and the signed client-IP chain, and the chain passes staging verification.
7. **Frontend:** Vercel serves the canonical origin with functions in `sin1`, and staging has its own origin. Browser API calls use same-origin `/api`, externally rewritten to the API edge. Canonical domain is `rescom.io.vn` (owner decision 2026-10-05): frontend `https://app.rescom.io.vn`, API edge `https://api.rescom.io.vn`, staging `staging-app.rescom.io.vn` / `staging-api.rescom.io.vn`. The VPS `.env.prod` (apex origin, `S3_DOMAIN`) predates this and must be rewritten.
8. **OAuth:** Each environment has its own Google OAuth client and secret, an exact same-host `/api/auth/google/callback` redirect URI, and matching frontend success and error URLs.
9. **Secrets:** Runtime secrets live in the VPS env file (mode 600), approved GitHub Actions secret scopes and Vercel server-only variables. `RESCOM_EDGE_KEY` equals that environment's `EDGE_KEY` and never uses a `NEXT_PUBLIC_` prefix. Secrets stay out of Git, reports and browser bundles.
10. **Isolation:** Staging uses a separate database, R2 bucket, OAuth client/secret, domain, edge key, Compose project name and synthetic accounts, while mirroring the production proxy topology. Heavy staging runs are sequential on the shared VPS. Production credentials cannot reach staging data and vice versa.
11. **Transferred 11.1 evidence:** The unchanged S3 adapter (`WHEN_REQUIRED` checksums) passes a real R2 presigned PUT/GET/hash round trip from the production image. A browser-origin upload proves CORS. The application upload flow proves private upload, 50 MB limit, scan, finalize, owner download and fail-closed behavior. The proven signing region (`auto`) and endpoint are recorded.

## Tasks / Subtasks

- [ ] 1. Inputs and host preparation (AC1, AC5, AC7, AC10)
  - [ ] Rewrite `11-2-cloud-infrastructure-checklist.md` for Hostinger + R2 (remove the GCP sections).
  - [ ] Record team SSH CIDRs, R2 account and bucket names, Cloudflare zone, Vercel project and operator access in the checklist. References only, no secrets.
  - [ ] Add a swapfile and install cron or confirm systemd timers. Configure the firewall (Cloudflare-only 80/443, CIDR-limited SSH, Docker bypass mitigation such as the `DOCKER-USER` chain, IPv6) and verify that operator SSH still works before closing the session.
- [ ] 2. Align the Compose stack with AD-23 and B4 (AC2, AC4, AC6, AC9)
  - [ ] Reconcile `deploy/docker-compose.hostinger.yml` and `Caddyfile.hostinger` (commit `398086a`). Remove MinIO, `minio-init` and the `S3_DOMAIN` route. Remove `prisma migrate deploy` from the API start command. Use the immutable GHCR image, not a VPS build. Pin Caddy. Reuse the edge-key, client-IP and log-redaction rules from `deploy/Caddyfile` with Origin CA TLS.
  - [ ] Keep PostgreSQL private on a named volume with an explicit Compose project name per environment and a single scheduler owner.
- [ ] 3. Database and staging schema (AC2, AC10)
  - [ ] Create environment databases and roles, revoke `PUBLIC` `CONNECT`, and demonstrate cross-environment denial.
  - [ ] Run `prisma migrate deploy` explicitly from the API image. Record migration status and schema version.
- [ ] 4. WAL archiving to R2 (AC3)
  - [ ] Create the backup bucket and scoped token. Configure the WAL tool, `archive_mode`, `archive_command` and `archive_timeout`, and schedule base backups with a timer.
  - [ ] Prove that a base backup and new WAL segments land in R2, and that a broken archive command surfaces an error. Hand the restore drill to 11.4.
- [ ] 5. R2 upload storage and transferred 11.1 AC7 (AC4, AC11)
  - [ ] Create per-environment private buckets, scoped tokens and exact-origin CORS (PUT/GET plus signed checksum headers).
  - [ ] Run `node dist/apps/backend/src/scripts/storage-smoke.js` inside the production image against R2. Capture PUT/GET status, hash match and checksum behavior, and verify cleanup separately.
  - [ ] Run the application upload/scan/finalize flow with clean, infected and 50 MB files. Prove unauthorized and anonymous fetch are denied and that scanner or storage outages fail closed. If R2 fails, record the gap and raise a MinIO deviation. Do not swap in a provider SDK.
- [ ] 6. Cloudflare, Vercel, SMTP and OAuth (AC6–AC9)
  - [ ] Set up a proxied API DNS record, Full (strict) and an Origin CA cert at `deploy/certs/`, and fetch current Cloudflare ranges for the firewall and `TRUSTED_PROXY_RANGES`.
  - [ ] Configure the Vercel `sin1` region and per-environment variables. Configure OAuth redirects and SMTP/TLS. Prove same-origin cookies/CSRF, the OAuth callback and the external rewrite.
- [ ] 7. Verify topology and hand off (all ACs)
  - [ ] From two client IPs, verify that signed client-IP headers survive the rewrite and that forged headers cannot select an auth bucket. Verify that a missing or wrong edge key returns 403 and that a valid key without a client IP returns 400.
  - [ ] Prove firewall exposure, DB and bucket privacy, and staging isolation with both positive and negative checks. Record the resource baseline (AC1).
  - [ ] Write evidence and the runbook in `11-2-hostinger-evidence/`, and transfer outputs to 11.3, 11.4 and IR.6. Mark `review` only when staging evidence is complete.

## Dev Notes

### Existing assets to reuse

| Asset | Current behavior and intended use |
| --- | --- |
| `deploy/backend.Dockerfile` | Node 22, non-root multi-stage image; contains Prisma CLI. Reuse one immutable image for migrations and API. Local 11.1 image was arm64; an x86 VM requires amd64 or a verified multi-architecture image. |
| `deploy/docker-compose.prod.yml` | Only Caddy/API/ClamAV; API has no host port. Environment file default `.env.prod`; use an explicit staging override and distinct Compose project name. Three-service stack per environment, one API replica. |
| `deploy/Caddyfile` | Origin CA TLS, edge-key gate, signed client-IP restoration and log redaction. `/health/*` bypasses edge key, but remains behind the Cloudflare-only origin firewall. |
| `deploy/.env.prod.example` | Full production variable contract. Update examples only for proven infrastructure settings; real secrets stay untracked. |
| `apps/frontend/my-app/next.config.ts` | Rewrites `/api/:path*` to `${RESCOM_API_URL}/:path*`; supply API origin without an appended `/api` to avoid double-prefix errors. |
| `apps/frontend/my-app/proxy.ts`, `lib/api/edge-headers.ts` | Drops incoming `x-rescom-*`, sets edge key and client address from `x-real-ip`. Real Vercel/Cloudflare proof is still required. |
| `apps/backend/src/scripts/storage-smoke.ts` | Existing portable presigned round trip. It does not exercise browser CORS or malware scan and does not fail on delete error; verify those separately. |
| `deploy/docker-compose.internal.yml`, `.env.internal.example` | Internal test stack. Preserve it; it is not the Cloud pilot topology. |

Do not introduce a frontend container, MinIO, Redis, separate worker or provider SDK into the pilot stack. PostgreSQL 15 runs as a private container on the VPS (B1). `CF-Connecting-IP` at the API edge describes Vercel egress, not the respondent. Never increase `TRUST_PROXY_HOPS=1` to mask a broken header chain.

Cloudflare proxying the frontend can change what Vercel sees as client IP. Prefer DNS-only Vercel frontend records for the staging proof; API records remain proxied. If Product/Operations requires proxied frontend DNS, prove genuine client-IP preservation on the actual Vercel plan or record an architecture decision before claiming AC5 complete. A configured region does not prove the external rewrite itself executes in that region.

### Files and evidence

Existing files likely to update after verification: `deploy/README.md` (keep Vietnamese), `deploy/.env.prod.example`, frontend region configuration if necessary, this story, its checklist and `sprint-status.yaml`. Read full files and the frontend `AGENTS.md` before implementation edits. Store new sanitized evidence under `_bmad-output/implementation-artifacts/11-2-hostinger-evidence/` (`11-2-evidence/` is historical GCP), including resource inventory, configuration exports, commands/results and AC verdicts. Reference actual release SHA and effective settings, not illustrative values.

### Validation and completion

Use infrastructure configuration exports, public-path smoke, IAM negative checks, controlled migrations, R2 WAL/backup proof and real R2/browser proofs. No application regression suite is required for writing these documents. During execution, run relevant existing checks if deployment assets or application code changes; use isolated staging/scratch data. No real user dataset is needed. G4 requires 11.3/11.4 evidence; IR.6 owns independent G5 staging acceptance; 11.5 owns production opening.

### References

- `_bmad-output/planning-artifacts/epics.md` — Epic 11 dependency model, Stories 11.2–11.5.
- `_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md` — AD-5, AD-17, AD-21, AD-22, AD-23 and 2026-10-03 amendment; Open Questions.
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-26.md` — approved provider/region decision; historical estimates.
- `_bmad-output/implementation-artifacts/ir-1-pilot-contract-inventory-2026-10-02.md` — canonical origin, owners, production defaults.
- `_bmad-output/implementation-artifacts/ir-5-g3/ir-5-g3-evidence-2026-10-03.md` — accepted deviations and real proxy proof transferred to staging.
- `_bmad-output/implementation-artifacts/11-1-deployment-ready-backend-packaging.md`, `11-1-evidence/06-storage-smoke.txt` — predecessor and GCS transfer.
- [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/), [R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/), [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/), [PostgreSQL continuous archiving](https://www.postgresql.org/docs/15/continuous-archiving.html). Recheck before provisioning.
- [Cloudflare Full strict](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/), [Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/), [origin IP ranges](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/).
- [Vercel rewrites](https://vercel.com/docs/routing/rewrites), [request headers](https://vercel.com/docs/headers/request-headers), [function region](https://vercel.com/docs/functions/configuring-functions/region). Official documentation consulted 2026-10-03; recheck before provisioning.

## Dev Agent Record

### Agent Model Used

- Codex (planning); read-only infrastructure-context subagent.
- Antigravity (Gemini 3.8 Flash, implementer); supervised by Codex.

### Debug Log References

- Task A partial read-only preflight executed 2026-10-03: audited local CLI tools (`docker`, `gh` present; `gcloud`, `vercel`, `wrangler` not in PATH), checked active shell variables (no cloud credentials or projects exported).
- Verified Cloudflare IP ranges from official endpoints (`ips-v4` and `ips-v6`) matching `TRUSTED_PROXY_RANGES`.
- Observed local egress IP `14.233.81.122/32` (dynamic single host; owner approval of stable team CIDR pending). Verified public key `id_ed25519.pub`.
- Established preliminary resource inventory and monthly budget model with dated official pricing references and explicit traffic assumptions in `11-2-evidence/`.
- No billable cloud resources created or live DNS modified. All infrastructure tasks remain unchecked.
- 2026-10-09 (Claude Opus 5.5, dev-story): B1 is void because prod has been live since about 2026-10-05 with no backup. Owner chose backup-first. A read-only SSH inventory was denied by the session permission classifier, so live state comes from the operator's step-0 output. Local amd64 proof of pgBackRest (stanza-create/check/full backup/WAL/encryption; a broken repo fails `check`) is recorded in `11-2-hostinger-evidence/01-wal-backup-runbook.md`.

### Completion Notes List

- Story context and technical checklist prepared; external values and sizing decisions remain explicitly pending.
- Fresh AGY conversation handoff is included in the checklist. Story creation does not start billable provisioning.
- Task A partial preflight complete: preliminary planning models and non-secret facts recorded in checklist and `11-2-evidence/`.
- Billable resource provisioning (Task B) is BLOCKED pending GCP project ID, billing account confirmation, and authenticated operator access.
- 2026-10-09: Task 4 repo side is done: `deploy/postgres.Dockerfile` (pgBackRest on the same alpine base), `deploy/pgbackrest.conf`, the hostinger compose postgres service (archive_mode/command/timeout 300 s, PGBACKREST_* env only), systemd units (daily full backup, 15-min `check`), env example and operator runbook. Task 4 stays unchecked until the VPS run proves R2 base backup and WAL, and failure detection.

### File List

- `_bmad-output/implementation-artifacts/11-2-hostinger-vps-pilot-infrastructure-provisioning.md`
- `_bmad-output/implementation-artifacts/11-2-cloud-infrastructure-checklist.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/11-2-evidence/00-task-a-preflight-report.md` (new)
- `_bmad-output/implementation-artifacts/11-2-evidence/01-resource-inventory.md` (new)
- `_bmad-output/implementation-artifacts/11-2-evidence/02-budget-network.md` (new)
- `_bmad-output/implementation-artifacts/11-2-hostinger-evidence/01-wal-backup-runbook.md` (new)
- `deploy/postgres.Dockerfile` (new)
- `deploy/pgbackrest.conf` (new)
- `deploy/systemd/rescom-pg-backup.service`, `rescom-pg-backup.timer`, `rescom-pg-archive-check.service`, `rescom-pg-archive-check.timer` (new)
- `deploy/docker-compose.hostinger.yml`
- `deploy/.env.prod.example`

## Change Log

- 2026-10-03: Created Story 11.2 and provisioning checklist from the approved AD-23 topology and Story 11.1 handoff.
- 2026-10-03: Partial Task A preflight executed (Antigravity as implementer, supervised by Codex). Audited local environment, verified Cloudflare IP ranges, established preliminary resource/cost models in `11-2-evidence/`. Provisioning blocked awaiting GCP project, billing account, and operator access.
- 2026-10-03: Supervisor corrections applied: narrowed negative credential claims, removed asserted geolocation, corrected CORS checksum response headers, updated Next.js rewrite path bypass specifications, documented dated pricing sources with traffic assumptions and simultaneous environment models, and reverted all task checkboxes to unchecked pending owner decisions.
- 2026-10-05: Re-scoped from Google Cloud to Hostinger VPS per approved sprint-change-proposal-2026-10-04 (B1 greenfield, B2 R2 backup, B3 RPO 15m/RTO 4h, B4 R2 uploads). Renamed story file/key; rewrote ACs and tasks; GCP Task A evidence retained as history.
- 2026-10-09: Backup-first (owner decision, because live prod data has no backup). Added pgBackRest→R2 WAL/base-backup assets, systemd timers and the operator runbook, with local proof. VPS run pending.
