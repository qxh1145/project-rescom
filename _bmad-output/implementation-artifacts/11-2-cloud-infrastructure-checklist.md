> **GCP CONTENT SUPERSEDED 2026-10-05.** Sections about GCP projects, Cloud SQL, GCS/HMAC and budgets no longer apply. Story 11.2 Task 1 rewrites this checklist for Hostinger VPS + Cloudflare R2. Still valid: Cloudflare, Vercel, OAuth and SMTP rows, using the `rescom.io.vn` domains.

# Story 11.2 — Cloud Infrastructure Technical Checklist

Owner: Quan. Prepared: 2026-10-03. Status: in-progress (Task A partial preflight; billable provisioning blocked on external inputs & owner confirmation).

Use with [Story 11.2](11-2-hostinger-vps-pilot-infrastructure-provisioning.md). Check a box only after recording effective configuration and evidence. **Locked** means an approved project requirement; **proposed** means an operator choice requiring a recorded owner decision; **input** means an actual external value is missing.

## 1. Owner input sheet

| Input | Value / decision to record | Blocks |
| --- | --- | --- |
| GCP project ID(s), billing account and operator identity | **BLOCKED / Pending owner input**: No GCP project/billing account found in environment; `gcloud` CLI not installed. | Resource creation |
| Trial start, actual expiry, remaining credit | **Pending owner input**: Must inspect billing account balance directly; assumed 90-day trial runway. | Cost/runway decision |
| Budget recipients and spending response owner | **Quan** (`qxh1145`); notification email address pending owner input. | AC1 |
| Region / zone | `asia-southeast1` locked; `asia-southeast1-a` proposed for VM & Cloud SQL. | VM/SQL creation |
| VM sizing/OS/disk and total monthly estimate | Proposed `e2-medium` (2 vCPU, 4 GB RAM), Debian 12 amd64, 30 GB pd-balanced. Preliminary estimate: ~$35.57/mo (with IP & disk). Confirmed local image is arm64, requires amd64 build. Owner confirmation pending. | Billable VM |
| SQL edition/tier/storage/isolation and backup settings | Proposed PostgreSQL 15, `db-g1-small` (Option A, ~$35.92/mo) or `db-custom-1-3840` (Option B, ~$69.50/mo), 10 GB SSD, 7-day backups + 7-day PITR. Single instance with isolated databases/roles proposed. Owner confirmation pending. | Billable SQL |
| Staging frontend/API domains | Proposed `staging-app.rescom.io.vn`, `staging-api.rescom.io.vn`; DNS access on Cloudflare pending. | TLS/OAuth |
| Production frontend/API domains | Locked `app.rescom.io.vn`, `api.rescom.io.vn` | Production config |
| Bucket names and portability decision | Proposed `rescom-<project>-staging`, `rescom-<project>-prod` (regional `asia-southeast1`, Standard, uniform bucket-level access, public access prevention enforced). | Storage |
| Team SSH IPv4/IPv6 CIDRs and public keys | Observed single-host egress IP: `14.233.81.122/32` (dynamic, approval pending). Public key: `~/.ssh/id_ed25519.pub` (`SHA256:tvV/peD60U6FKungpHdeiTWi7QCN0rf8QOBa0UDVWpk`). | VM administration |
| Vercel team/project/plan and repo access | Pending owner setup; region `sin1` locked. Vercel CLI not installed locally. | Frontend |
| Cloudflare zone/account and API hostname ownership | Pending zone access on `rescom.io.vn`. Cloudflare published IP ranges verified from official API (2026-10-03). | Edge |
| OAuth clients/consent screen/test identities | Separate staging and prod; pending creation on Google Auth Platform. | Google login |
| SMTP provider/domain ownership | Proposed Brevo, sender `no-reply@rescom.io.vn`; pending verification and credentials. | Production-mode API startup/email |
| Image SHA/digest and CPU architecture | Current image `rescom-api:local` is `arm64`; requires amd64 build from baseline `1cf4149` pushed to `ghcr.io/qxh1145/rescom-api`. | Migration/API |
| Backup retention, RPO/RTO, restore cadence | Proposed 7-day daily backups and 7-day PITR logs; RPO/RTO drill tracked in 11.4. | Operations acceptance |
| Quarantine/cleanup/privacy owner | Quan operational owner; retention/legal decisions pending. | Real personal-data processing |

- [ ] Record decisions and unresolved inputs; store credential references, never credential values, in this sheet.
- [ ] Confirm access to GCP billing/project, DNS, Vercel, Google OAuth and SMTP before AGY provisioning.
- [ ] Record separate production launch prerequisites under 11.5; synthetic staging can progress independently.

## 2. GCP project, budget and VM specification

| Parameter | Target | Evidence |
| --- | --- | --- |
| Resource labels | `app=rescom`, `environment=staging` or `prod`, owner label | Inventory export |
| APIs | Compute Engine, Cloud SQL Admin, Service Networking, Cloud Storage; Cloud Billing Budget for budget API automation | Enabled API list |
| VPC | Proposed dedicated custom-mode VPC, environment subnet(s), no overlapping local/VPN/PSA ranges | Network/CIDR export |
| Cloud SQL connection | Private Services Access on selected VPC; reserved producer range | Peering/allocation export |
| VM | Proposed `e2-medium` class from approved proposal; validate memory headroom for ClamAV + Node and shared CPU under pilot load | SKU decision and healthy stack |
| OS / disk | Proposed Debian 12 amd64, 30 GB persistent boot disk, automatic security updates; confirm supported image and capacity | OS, image arch, disk report |
| External address | Reserved static IPv4 for API edge origin | IP resource reference |
| VM identity | Dedicated service account with only necessary permissions; no default Editor grant | IAM export |
| Containers | Caddy `2.11.6-alpine`, API immutable SHA/digest, ClamAV `1.5.4`; reuse 11.1 pins | `compose ps` / image digests |
| Scheduler | One API replica and `SCHEDULER_ENABLED=true` per environment | Container/config report |
| Persistent volumes | Caddy state and ClamAV signatures only; no DB/user files | Volume inventory |
| Budget | USD 200 alerts-only budget with actual-cost thresholds 25%, 50%, 100% (= USD 50/100/200), or equivalent explicitly recorded budgets | Budget export |
| Budget period / credits | Select and record period to match trial tracking; record treatment of trial credits so alerts measure intended usage | Budget filters and recipient verification |

- [ ] Estimate all deployed environments, managed DB, backups, IP, egress, storage and SMTP costs; record dated calculator output. (Preliminary estimate in `11-2-evidence/02-budget-network.md`; official calculator quote pending owner billing linkage)
- [ ] Configure alerts and verify recipients/channel. Do not claim actual threshold notifications have fired if only configured; record a channel test separately.
- [ ] Assign an action at each threshold. Alerts-only budgets do not automatically stop resources.
- [ ] Install Docker Engine and Compose plugin; record versions. Keep local image architecture mismatch out of the x86 VM.

### Firewall and SSH

- [ ] Apply ingress TCP 80/443 only from the current Cloudflare published origin-proxy IPv4/IPv6 ranges; restrict to the environment VM target.
- [ ] Apply TCP 22 only from approved team CIDRs with keys-only SSH; disable password/root login and verify an authorized session before removing prior access.
- [ ] Audit inherited/default firewall rules, VPC ingress and host firewall together; a broader rule must not reopen restricted ports.
- [ ] Do not permit public 4000, 3310 or 5432. Keep UDP 443 closed unless explicitly justified; existing Compose publishes it, but TCP HTTPS is sufficient for this plan.
- [ ] Verify direct-origin public access denied from a non-Cloudflare source and public edge HTTPS permitted. Test IPv6 if assigned; otherwise record IPv4-only design.
- [ ] Ensure outbound DNS, HTTPS (images/GCS/ClamAV updates), SMTP TLS and private SQL reachability; record egress policy.

## 3. Cloud SQL specification

| Parameter | Target | Decision/evidence |
| --- | --- | --- |
| Engine | PostgreSQL 15, matching current local/migration baseline; record available maintenance version | Instance export |
| Edition / tier | Proposed Enterprise, smallest suitable supported tier; size after estimate and pilot load needs | Quan decision pending; no fabricated SKU |
| Location | `asia-southeast1` | Instance export |
| Public IP | Disabled; private IP in selected VPC only | Network export + negative check |
| Availability | Proposed zonal for pilot; HA choice explicitly costed if requested | Accepted availability decision |
| Staging isolation | Separate database + role minimum; proposed separate instance for strongest isolation if affordable | Record model, grants and maintenance blast radius |
| Disk | Proposed SSD 10 GB starting size if supported, auto-resize with approved cap/headroom monitoring | Actual supported settings |
| Backups/PITR | Enabled explicitly; proposed 7 retained daily backups and 7-day transaction-log retention if edition supports it | Settings export; final retention approval in 11.4 |
| Backup window | Proposed low-traffic UTC window; record actual schedule | Window decision |
| TLS | `ENCRYPTED_ONLY`; app URL `sslmode=require`, server identity validation posture documented | TLS DB connection evidence |
| Time zone | UTC connection/session configuration | SQL `SHOW timezone` |
| Deletion protection | Enabled on production resources; staging teardown policy recorded | Instance export |
| DB identities | Separate staging/prod credentials and database grants; runtime/migration privilege policy documented | Redacted role/grant report |

- [ ] Confirm default Cloud SQL settings do not leave PITR or encryption optional.
- [ ] Test TLS from the actual API image; if CA verification is added, use portable mounted trust material and verify Prisma support. Do not silently switch to plaintext.
- [ ] Run controlled staging `prisma migrate deploy` followed by `prisma migrate status`; capture image SHA and migration identifiers. No migrate-on-start.
- [ ] Verify runtime permissions against append-only ledger/audit rules. If separate migrator role is selected, test all required migrations using it.
- [ ] Revoke `CONNECT ON DATABASE <environment_db> FROM PUBLIC` and grant CONNECT only to intended environment roles; inspect memberships, ownership and schema/object grants. Separate credentials alone do not override PostgreSQL's default PUBLIC CONNECT privilege. Verify staging cannot connect to production DB and vice versa; separate databases on one instance still share administrative/availability scope.
- [ ] Record backups/PITR enabled now; successful restore and RPO/RTO proof belong to 11.4.

## 4. Cloud Storage specification and browser upload checklist

| Parameter | Target | Evidence |
| --- | --- | --- |
| Bucket location / class | Regional `asia-southeast1`, Standard | Bucket export |
| Access controls | Uniform bucket-level access and public access prevention enforced | Bucket/IAM export |
| Identities | Dedicated service account per environment, HMAC credential per identity | Redacted identity references |
| Permissions | Bucket-level `roles/storage.objectAdmin` starting profile (read/write/copy/delete required); no project-wide object grants | IAM positive/negative proof |
| Portability | Record exact bucket name; later host reuses name or reviewed migration updates `StoredObject.bucket` | Naming decision |
| S3 endpoint | `https://storage.googleapis.com`, path-style true | Smoke configuration |
| Signing region | `auto` provisional; compare `asia-southeast1` only if necessary and record value that passes real adapter proof | Successful region/result |
| Checksums | Existing AWS SDK `requestChecksumCalculation` and `responseChecksumValidation` = `WHEN_REQUIRED` | Adapter + smoke |
| Retention/lifecycle | No locked retention or lifecycle deletion of active/verified objects without policy; inspect soft-delete/versioning defaults and cost | Owner policy / effective defaults |

HMAC keys authenticate the service account to the XML API; bucket restriction comes from the service account's IAM grants. Store the HMAC secret when created; it is shown once for service-account keys. Keep provider configuration outside application code.

### Proposed bucket CORS

Use the corresponding environment origin only. The staging example below is a proposed hostname, to be replaced after the domain decision. `responseHeader` governs exposed response headers; verify the actual preflight requested headers from the adapter/browser rather than treating this field as an S3-style allowed-headers list.

```json
[
  {
    "origin": ["https://staging-app.rescom.io.vn"],
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

- [ ] Apply separate exact-origin config to each bucket; no wildcard origin and no production/staging origin mixture.
- [ ] Test allowed-origin preflight and PUT with the actual signed headers. Test unrelated origin lacks browser permission; CORS is not a replacement for authentication.
- [ ] Run `node dist/apps/backend/src/scripts/storage-smoke.js` inside the production image; no full signed URL or HMAC secret in evidence. Capture statuses and SHA-256 match. Runtime contains compiled output, not source TypeScript/`ts-node`.
- [ ] Confirm smoke object removal independently because the current script suppresses delete failure.
- [ ] Prove anonymous access denied; cross-environment credentials denied; bucket grants contain no `allUsers`/`allAuthenticatedUsers`.
- [ ] Prove app initiate → browser PUT → ClamAV scan → finalize CLEAN → authorized download. Scan-outage stays QUARANTINED/fail-closed; infected object is rejected.
- [ ] Use synthetic files only; preserve the 50 MB application limit and clamd `StreamMaxLength=100M`. Transfer >25 MB real-upload proof to IR.6 if not run here.

## 5. Cloudflare, Vercel and OAuth specification

| Concern | Production | Staging |
| --- | --- | --- |
| Frontend origin | `https://app.rescom.io.vn` | Proposed `https://staging-app.rescom.io.vn` |
| API edge | `https://api.rescom.io.vn` | Proposed `https://staging-api.rescom.io.vn` |
| API DNS | Proxied to corresponding VM static IP | Same topology |
| Frontend DNS | Prefer DNS-only to Vercel; verify genuine client-IP preservation before enabling a frontend proxy | Same choice as intended production |
| Cloudflare TLS | Full (strict), origin certificate matching API hostname | Separate matching origin cert |
| Origin files | `deploy/certs/origin.pem`, `origin-key.pem` | Separate environment files on staging VM |
| API caching | Bypass dynamic `/api` source traffic and origin auth/health paths; no cached auth/session responses | Same rules |
| Vercel functions | `sin1`; verify actual deployment configuration | `sin1` |
| App root | `apps/frontend/my-app`, with monorepo workspace build access | Same |
| OAuth redirect | `https://app.rescom.io.vn/api/auth/google/callback` | `https://<staging-frontend>/api/auth/google/callback` |
| Auth frontend URLs | `/auth/callback`, `/auth/error` on canonical origin | Same paths on staging origin |
| OAuth credentials | Dedicated production client | Dedicated staging client and test users |

### Environment map

| Setting | VM backend / Caddy | Vercel frontend |
| --- | --- | --- |
| API domain | `API_DOMAIN=<environment API hostname>` | `RESCOM_API_URL=https://<environment API hostname>` (no `/api` suffix) |
| Trusted edge | `EDGE_KEY=<environment secret>`, `TRUSTED_PROXY_RANGES=<current Cloudflare ranges>` | `RESCOM_EDGE_KEY=<same environment secret>`, server-only |
| Browser API | Private `PORT=4000`, `TRUST_PROXY_HOPS=1` | `NEXT_PUBLIC_API_URL=/api` |
| Pilot | `NODE_ENV=production`, one scheduler owner, `ABUSE_CONTROL_PROFILE=REDIS_DISABLED_SINGLE_REPLICA` | `NEXT_PUBLIC_PILOT_BUILD=true`, `NEXT_PUBLIC_API_MOCKING=disabled` |
| Origin/auth | Exact `FRONTEND_ORIGINS`, OAuth redirect/success/error and `EMAIL_APP_BASE_URL` | Correct assigned canonical domain |
| Database/storage | Private URL/TLS and per-env `STORAGE_*` HMAC config | No DB/HMAC credentials |
| Mail | Real SMTP provider, `SMTP_REQUIRE_TLS=true`, verified sender | No SMTP credentials |
| Application secrets | Separate per-env `JWT_SECRET`, `AUTH_SECRET_PROTECTION_KEY`, `COMPLETION_CODE_HMAC_SECRET`, `STORAGE_CAPABILITY_SECRET`; use full backend example for remaining required variables | None exposed to browser |
| Rate limit | Current example 60/60s; preserve until explicit owner decision changes it | No client override |

- [ ] Configure Vercel preview/staging scope carefully: arbitrary previews must not receive production credentials or production bucket CORS access.
- [ ] Verify pilot bundle excludes MSW; browser requests target `/api` on the frontend origin.
- [ ] Verify exact same-origin cookies, CSRF, Google OAuth round trip and SMTP delivery with synthetic staging identities.
- [ ] Verify signed client IP on actual Vercel → Cloudflare → Caddy path with two public IPs, including spoofed incoming `x-rescom-*` and forwarding headers.
- [ ] Verify missing/wrong edge key 403, valid key missing client IP 400, no edge secret in browser requests/source or logs.
- [ ] Store Vercel edge secret only in server-side environment scope; VM `.env` mode 600, origin key restricted, GitHub environment secrets ready for 11.3.

## 6. Provisioning order and evidence handoff

1. Complete input/cost sheet and record owner decisions.
2. Configure project/APIs/budget → VPC/PSA → private Cloud SQL → buckets/IAM/HMAC/CORS.
3. Provision staging VM/firewall/Docker → install runtime env/cert securely → run controlled staging migrations from immutable image.
4. Configure Cloudflare API DNS/TLS → Vercel staging domain/region/env → OAuth/SMTP.
5. Start one staging API replica; run privacy, GCS, browser/proxy and isolation checks.
6. Prepare production resource/config inventory without opening user access; transfer production migrations/dark deploy to 11.5.
7. Produce AC verdicts and remaining blockers for code review, then hand off to 11.3/11.4/IR.6.

Suggested evidence files under `11-2-evidence/`: `01-resource-inventory.md`, `02-budget-network.md`, `03-sql-migrations.md`, `04-storage-gcs.md`, `05-dns-tls-vercel-oauth.md`, `06-client-ip-isolation.md`, `07-ac-verdict.md`. These are intended artifacts, not existing proof. Each records date, release SHA/digest, environment, sanitized command/result, PASS/FAIL/BLOCKED and owner. Do not store env dumps, tokens, OAuth codes, cookies, private keys or full presigned URLs.

## 7. Fresh AGY conversation handoff

Start a **new conversation for each bounded task**; do not reuse `d87892f5-191b-452f-9137-da2513cd221f`. Preserve context through these files and task evidence. Initial task is account/input preflight and a concrete provisioning plan; actual cloud changes follow once required inputs and account authorization are available. Use `--output-format stream-json` for progress visibility.

```text
Workspace: /Users/quan/HocTap/Vibecode/project-rescom
Role: Execute the assigned Story 11.2 task in a fresh AGY conversation.
Read AGENTS.md, PROJECT_SUMMARY.md, Story 11.2 and its technical checklist.
First inspect current git status and effective account/project before any action.
Task A: inspect available account/resource access, fill nonsecret owner inputs,
and prepare an exact resource/settings/cost plan with missing inputs listed.
For this initial task, do not create billable resources or change live DNS.
Output: updated checklist and sanitized evidence; report READY or BLOCKED,
changes, verified facts, pending decisions and the next bounded task.
Do not mark infrastructure ACs complete based on a plan.
```

Subsequent conversations: B = approved GCP network/SQL/storage; C = VM/edge/Vercel/OAuth staging; D = real GCS/proxy/isolation evidence and review preparation. Each receives the previous task's evidence paths and assigned scope. Completion reports must distinguish task completion from whole-story completion.

Official reference links and architecture sources are listed in Story 11.2; consult them before execution, especially current Cloudflare ranges, budget behavior, Cloud SQL settings and Vercel header behavior.
