#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lock_file="/home/ubuntu/.cache/kan-deploy.lock"
expected_sha="${1:-}"

if [[ -n "$expected_sha" && ! "$expected_sha" =~ ^[0-9a-f]{40}$ ]]; then
  printf '%s\n' "Expected revision must be a full Git SHA" >&2
  exit 64
fi

if [[ "${KAN_DEPLOY_LOCK_HELD:-}" != "1" ]]; then
  mkdir -p "$(dirname "$lock_file")"
  export KAN_DEPLOY_LOCK_HELD=1
  exec flock -w 2700 "$lock_file" "$0" "$@"
fi

cd "$repo_dir"

if [[ ! -s .env ]]; then
  printf '%s\n' "Missing $repo_dir/.env" >&2
  exit 1
fi

if [[ "$(git branch --show-current)" != "main" ]]; then
  printf '%s\n' "Deployments require the main branch" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  printf '%s\n' "The remote checkout is not pristine" >&2
  git status --short
  exit 1
fi

git fetch origin main
origin_sha="$(git rev-parse origin/main)"

if [[ -n "$expected_sha" && "$origin_sha" != "$expected_sha" ]]; then
  printf '%s\n' "Revision $expected_sha was superseded by $origin_sha" >&2
  exit 75
fi

git merge --ff-only origin/main

deployed_sha="$(git rev-parse HEAD)"
if [[ -n "$expected_sha" && "$deployed_sha" != "$expected_sha" ]]; then
  printf '%s\n' "Production checkout resolved to $deployed_sha instead of $expected_sha" >&2
  exit 1
fi

set -a
source .env
set +a

KAN_IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
export KAN_IMAGE_TAG
compose=(docker compose --env-file "$repo_dir/.env" -f "$repo_dir/deploy/imanleads/compose.yaml")

mkdir -p /home/ubuntu/.local/bin
install -m 755 "$repo_dir/deploy/imanleads/ci-deploy-entrypoint.sh" /home/ubuntu/.local/bin/kan-ci-deploy

mkdir -p /home/ubuntu/backups/kan/minio-current

if [[ -n "$("${compose[@]}" ps -q postgres 2>/dev/null)" ]]; then
  "$repo_dir/deploy/imanleads/backup.sh"
fi

"${compose[@]}" config --quiet
"${compose[@]}" up -d --build --remove-orphans

for attempt in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:3900/api/v1/health | grep -q '"status":"ok"'; then
    break
  fi
  if [[ "$attempt" == "90" ]]; then
    "${compose[@]}" ps
    "${compose[@]}" logs --tail 200 web migrate minio-init
    exit 1
  fi
  sleep 2
done

"$repo_dir/deploy/imanleads/install-nginx.sh"
sudo install -m 644 "$repo_dir/deploy/imanleads/kan-backup.service" /etc/systemd/system/kan-backup.service
sudo install -m 644 "$repo_dir/deploy/imanleads/kan-backup.timer" /etc/systemd/system/kan-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now kan-backup.timer

curl -kfsS --resolve work.imanleads.com:443:127.0.0.1 \
  https://work.imanleads.com/api/v1/health | grep -q '"status":"ok"'

git rev-parse HEAD
"${compose[@]}" ps
