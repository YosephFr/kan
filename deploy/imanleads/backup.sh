#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backup_root="${KAN_BACKUP_ROOT:-/home/ubuntu/backups/kan}"
postgres_dir="$backup_root/postgres"
minio_dir="$backup_root/minio-current"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_path="$postgres_dir/kan-$stamp.dump"
compose=(docker compose --env-file "$repo_dir/.env" -f "$repo_dir/deploy/imanleads/compose.yaml")

mkdir -p \
  "$postgres_dir" \
  "$minio_dir/kan-avatars" \
  "$minio_dir/kan-workspace-logos" \
  "$minio_dir/kan-attachments"
chmod 700 "$backup_root" "$postgres_dir" "$minio_dir"

"${compose[@]}" exec -T postgres pg_dump \
  --username "${POSTGRES_USER:-kan}" \
  --dbname "${POSTGRES_DB:-kan}" \
  --format custom >"$dump_path.tmp"
mv "$dump_path.tmp" "$dump_path"
pg_restore --list "$dump_path" >/dev/null
sha256sum "$dump_path" >"$dump_path.sha256"

"${compose[@]}" exec -T minio sh -eu -c '
  mc alias set backup http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  workspace_logo_bucket="${NEXT_PUBLIC_WORKSPACE_LOGOS_BUCKET_NAME:-kan-workspace-logos}"
  mc mirror --overwrite --remove \
    "backup/$NEXT_PUBLIC_AVATAR_BUCKET_NAME" \
    "/backup/$NEXT_PUBLIC_AVATAR_BUCKET_NAME"
  if mc stat "backup/$workspace_logo_bucket" >/dev/null 2>&1; then
    mc mirror --overwrite --remove \
      "backup/$workspace_logo_bucket" \
      "/backup/$workspace_logo_bucket"
  fi
  mc mirror --overwrite --remove \
    "backup/$NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME" \
    "/backup/$NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME"
'

find "$postgres_dir" -type f -name 'kan-*.dump' -mtime +30 -delete
find "$postgres_dir" -type f -name 'kan-*.dump.sha256' -mtime +30 -delete

printf '%s\n' "$dump_path"
