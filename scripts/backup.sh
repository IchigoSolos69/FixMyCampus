#!/usr/bin/env bash
# Run from the repository root; schedule daily outside 09:00-21:00 IST.
set -euo pipefail
umask 077
backup_root="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_root"
backup_root="$(cd "$backup_root" && pwd)"
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_stage="$(mktemp -d "$backup_root/.backup-XXXXXX")"
trap 'rm -f "$backup_stage/database.sql.gz" "$backup_stage/uploads.tar.gz" "$backup_stage/MANIFEST"; rmdir "$backup_stage" 2>/dev/null || true' EXIT
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --databases "$MYSQL_DATABASE"' | gzip > "$backup_stage/database.sql.gz"
docker compose run --rm --no-deps -T --entrypoint tar app -C /app/uploads -czf - . > "$backup_stage/uploads.tar.gz"
printf 'FixMyCampus backup\nUTC=%s\nIncludes=database.sql.gz,uploads.tar.gz\n' "$backup_stamp" > "$backup_stage/MANIFEST"
backup_output="$backup_root/fixmycampus-$backup_stamp.tar.gz"
tar -C "$backup_stage" -czf "$backup_output" database.sql.gz uploads.tar.gz MANIFEST
gzip -t "$backup_output"
# Only delete archives matching this tool's name, under the resolved backup root.
find "$backup_root" -maxdepth 1 -type f -name 'fixmycampus-????????T??????Z.tar.gz' -mtime +29 -delete
printf 'Created %s\n' "$backup_output"
