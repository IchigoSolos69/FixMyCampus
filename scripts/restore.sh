#!/usr/bin/env bash
# Restore into an isolated compose project, never the live default project.
set -euo pipefail
umask 077
restore_archive="${1:?Usage: RESTORE_PROJECT=fixmycampus-restore MYSQL_PORT=3307 bash scripts/restore.sh backups/archive.tar.gz}"
: "${RESTORE_PROJECT:?Set a separate compose project name, for example fixmycampus-restore}"
: "${MYSQL_PORT:?Set an unused database port, for example 3307}"
if [[ "$RESTORE_PROJECT" == "fixmycampus" || ! "$RESTORE_PROJECT" =~ ^fixmycampus-restore[-a-z0-9]*$ || "$MYSQL_PORT" == 3306 ]]; then
  printf 'Refusing restore: use a fixmycampus-restore* project and a non-live MySQL port.\n' >&2
  exit 1
fi
restore_stage="$(mktemp -d)"
trap 'rm -f "$restore_stage/database.sql.gz" "$restore_stage/uploads.tar.gz" "$restore_stage/MANIFEST"; rmdir "$restore_stage" 2>/dev/null || true' EXIT
# Extract only the known filenames; ignore other archive entries.
tar -xzf "$restore_archive" -C "$restore_stage" database.sql.gz uploads.tar.gz MANIFEST
gzip -t "$restore_stage/database.sql.gz"
gzip -t "$restore_stage/uploads.tar.gz"
docker compose -p "$RESTORE_PROJECT" up -d --wait mysql
gzip -dc "$restore_stage/database.sql.gz" | docker compose -p "$RESTORE_PROJECT" exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'
cat "$restore_stage/uploads.tar.gz" | docker compose -p "$RESTORE_PROJECT" run --rm --no-deps -T --entrypoint tar app -C /app/uploads -xzf -
printf 'Restored isolated project %s on MySQL port %s. Validate counts and private attachments before any live cutover.\n' "$RESTORE_PROJECT" "$MYSQL_PORT"
