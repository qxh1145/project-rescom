# Story 11.2 Task 4 — WAL archiving + base backups to R2 (runbook and evidence)

> Date: 2026-10-09 · Owner/operator: Quan · AC3 (B2, B3: RPO 15 min)
> Tool: pgBackRest 2.58.0 inside `postgres:15.19-alpine3.24` (`deploy/postgres.Dockerfile`).

## Why this runs first

Production has been live on the VPS since about 2026-10-05, with real accounts and a points ledger. The B1
"greenfield, no backup needed" assumption no longer holds. The only DB copy is the `pgdata` volume,
and no backup exists. This task closes that gap before any edge/Caddy cutover.

## Design

| Item | Value |
| --- | --- |
| Tool | pgBackRest (alpine package). WAL-G was rejected because it ships glibc builds only, and the volume was initialised by an alpine (musl) image. Moving to a glibc image risks silently invalidating text indexes. |
| Archive | `archive_mode=on`, `archive_command=pgbackrest --stanza=rescom archive-push %p`, `archive_timeout=300` (≤5 min of WAL at risk, inside the 15 min RPO) |
| Base backup | Daily full backup at 02:30 Asia/Ho_Chi_Minh (`deploy/systemd/rescom-pg-backup.timer`), `repo1-retention-full=7` (expired WAL is pruned with it) |
| Failure detection | `pgbackrest check` every 15 min (`rescom-pg-archive-check.timer`). A broken archive makes the unit fail, which shows in `systemctl --failed`, and `pg_stat_archiver.failed_count` rises. Alert wiring belongs to 11.4. |
| Repository | Dedicated private R2 bucket, path `/pgbackrest`, S3 path-style, region `auto`, `aes-256-cbc` client-side encryption, zstd |
| Secrets | `PGBACKREST_REPO1_*` live in `/opt/rescom/deploy/.env.prod` (mode 600) and only the postgres container receives them. Keep the cipher passphrase off the VPS as well, because restores need it. |
| Restore drill | Story 11.4 (RTO 4 h) |

## Local proof (2026-10-09, linux/amd64, posix repo standing in for R2)

```
stanza-create command end: completed successfully
check command end: completed successfully
backup command end: completed successfully
expire command end: completed successfully
status: ok · cipher: aes-256-cbc
wal archive min/max (15): 000000010000000000000001/000000010000000000000005
full backup: 20261009-081553F
pg_stat_archiver: archived=6 failed=3   (failures = segments pushed before stanza-create, then retried OK)
broken repo -> check: ERROR: [041]: unable to load info file ...archive.info   (detection works)
```

The R2 (S3) path is proven only by the VPS run below.

## VPS steps (operator runs; paste outputs back for evidence)

Run them in order. Step 4 restarts PostgreSQL, so the API sees about 10–30 s of DB errors.

**0. Identify the running stack and take a stopgap logical dump to your laptop.**

```bash
ssh root@201.18.212.192 'docker ps --format "{{.Names}} {{.Image}}"; cd /opt/rescom && git log --oneline -1 && git status --short; docker inspect rescom-postgres-1 --format "{{index .Config.Labels \"com.docker.compose.project.config_files\"}} | {{index .Config.Labels \"com.docker.compose.project.environment_file\"}}"'
```

```bash
ssh root@201.18.212.192 'docker exec rescom-postgres-1 sh -c "pg_dump -U \$POSTGRES_USER -d \$POSTGRES_DB -Fc"' > ~/rescom-prod-$(date +%F).dump && ls -lh ~/rescom-prod-*.dump
```

If `docker ps` shows a `minio` container, uploads live in its volume and this DB backup does not cover them.
Report it. MinIO → R2 migration is Task 5, and step 4 below leaves MinIO untouched.

**1. R2 (Cloudflare dashboard).** Create the private bucket `rescom-prod-pgbackup`. Create an R2 API token
with *Object Read & Write* scoped to that bucket only. Note the S3 endpoint
`<account-id>.r2.cloudflarestorage.com`, the access key ID and the secret.

**2. Secrets on the VPS.** Append these lines to `/opt/rescom/deploy/.env.prod`, keeping `chmod 600`.
Generate the passphrase with `openssl rand -base64 48`, and store a copy in your password manager.

```
PGBACKREST_REPO1_S3_ENDPOINT=<account-id>.r2.cloudflarestorage.com
PGBACKREST_REPO1_S3_BUCKET=rescom-prod-pgbackup
PGBACKREST_REPO1_S3_KEY=...
PGBACKREST_REPO1_S3_KEY_SECRET=...
PGBACKREST_REPO1_CIPHER_PASS=...
```

**3. Get the files onto the VPS.** After the changes are committed and pushed, run `cd /opt/rescom && git pull`.
Needed: `deploy/postgres.Dockerfile`, `deploy/pgbackrest.conf`, `deploy/docker-compose.hostinger.yml`, `deploy/systemd/`.

**4. Rebuild and restart PostgreSQL only.** Use `--no-deps` so caddy and the backend are not recreated.
Use the compose and env files that step 0 reported, if they differ from these.

```bash
cd /opt/rescom && docker compose -f deploy/docker-compose.hostinger.yml --env-file deploy/.env.prod up -d --build --no-deps postgres
docker exec rescom-postgres-1 sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -Atc "show archive_mode; show archive_timeout; select version()"'
```

**5. Initialise the repository and take the first full backup.**

```bash
docker exec -u postgres rescom-postgres-1 pgbackrest --stanza=rescom stanza-create
docker exec -u postgres rescom-postgres-1 pgbackrest --stanza=rescom check
docker exec -u postgres rescom-postgres-1 pgbackrest --stanza=rescom --type=full backup
docker exec -u postgres rescom-postgres-1 pgbackrest --stanza=rescom info
```

**6. Install the timers.**

```bash
cp /opt/rescom/deploy/systemd/rescom-pg-* /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now rescom-pg-backup.timer rescom-pg-archive-check.timer
systemctl list-timers 'rescom-*' --no-pager
```

**7. Proof for AC3.**

- After at least 10 minutes, run `info` again. The WAL archive max segment must have advanced.
- The R2 dashboard must show `pgbackrest/archive/rescom/…` and `pgbackrest/backup/rescom/…` objects.
- Failure detection must work. This command must print an ERROR:

```bash
docker exec -u postgres -e PGBACKREST_REPO1_S3_KEY_SECRET=wrong rescom-postgres-1 pgbackrest --stanza=rescom check
docker exec rescom-postgres-1 sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -Atc "select archived_count, failed_count, last_archived_wal, last_failed_wal from pg_stat_archiver"'
```

**Rollback:** Restore the previous `postgres:` service block (`git checkout <prev> -- deploy/docker-compose.hostinger.yml`),
then rerun step 4. It uses the same volume and the same PG 15 major version, so data is untouched.
Then run `systemctl disable --now rescom-pg-backup.timer rescom-pg-archive-check.timer`.

## VPS results

_Pending operator run._
