#!/bin/sh
# Nightly backup: Postgres dump + MinIO object mirror, copied off-site with rclone.
# Cron (as root, from the repo dir):
#   30 3 * * * cd /opt/rescom && sh deploy/backup.sh >> /var/log/rescom-backup.log 2>&1
# Needs `rclone config` with a remote named in RCLONE_REMOTE (e.g. b2:rescom-backup).
# Restore DB: gunzip -c db-XXXX.sql.gz | docker compose ... exec -T postgres psql -U $POSTGRES_USER $POSTGRES_DB
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
# Read single keys; .env.internal is not shell-safe (e.g. EMAIL_FROM has < >).
get() { grep -E "^$1=" "$DIR/.env.internal" | tail -n1 | cut -d= -f2-; }
POSTGRES_USER=$(get POSTGRES_USER); POSTGRES_DB=$(get POSTGRES_DB)
COMPOSE="docker compose -f $DIR/docker-compose.internal.yml --env-file $DIR/.env.internal"
OUT="$DIR/backups"
REMOTE="${RCLONE_REMOTE:-$(get RCLONE_REMOTE)}"
: "${REMOTE:?set RCLONE_REMOTE in .env.internal, e.g. b2:rescom-backup}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$OUT/db" "$OUT/objects"

$COMPOSE exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner \
  | gzip > "$OUT/db/db-$STAMP.sql.gz"
find "$OUT/db" -name 'db-*.sql.gz' -mtime +14 -delete

# Plain-file mirror of the bucket (restorable with `mc mirror` back into any S3 store).
$COMPOSE run --rm -T -v "$OUT/objects:/backup" --entrypoint /bin/sh minio-init -c \
  'mc alias set rescom http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null &&
   mc mirror --overwrite --remove "rescom/$STORAGE_BUCKET" /backup'

rclone copy "$OUT/db" "$REMOTE/db"
rclone sync "$OUT/objects" "$REMOTE/objects"
echo "$STAMP backup ok"
