#!/usr/bin/env bash
set -euo pipefail

release_sha="${1:-}"
if [[ ! "$release_sha" =~ ^[0-9a-f]{40}$ ]]; then
  printf '%s\n' "Release snapshot requires a full Git SHA" >&2
  exit 64
fi

backup_root="${KAN_BACKUP_ROOT:-/home/ubuntu/backups/kan}"
current_dir="$backup_root/minio-current"
release_root="$backup_root/minio-releases"
snapshot_dir="$release_root/$release_sha"

if [[ ! -d "$current_dir" ]]; then
  printf '%s\n' "Current MinIO backup is missing" >&2
  exit 1
fi
if [[ -d "$snapshot_dir" ]]; then
  printf '%s\n' "$snapshot_dir"
  exit 0
fi

mkdir -p "$release_root"
chmod 700 "$release_root"
temporary_dir="$(mktemp -d "$release_root/.${release_sha}.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT

tar -C "$current_dir" -cf - . | tar -C "$temporary_dir" -xf -
printf '%s\n' "$release_sha" >"$temporary_dir/RELEASE_SHA"
chmod -R go-rwx "$temporary_dir"
mv "$temporary_dir" "$snapshot_dir"
trap - EXIT

printf '%s\n' "$snapshot_dir"
