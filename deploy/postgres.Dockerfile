# PostgreSQL 15 + pgBackRest for WAL archiving and base backups to Cloudflare R2 (Story 11.2 AC3, B2).
# Stays on alpine: the existing pgdata volume was initialised by postgres:15-alpine (musl collation);
# a glibc image on the same volume could silently invalidate text indexes.
FROM postgres:15.19-alpine3.24
RUN apk add --no-cache pgbackrest
