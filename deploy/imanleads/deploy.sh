#!/usr/bin/env bash
set -Eeuo pipefail

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
wait_for_web_health() {
  for _ in {1..90}; do
    if curl -fsS http://127.0.0.1:3900/api/v1/health | grep -q '"status":"ok"'; then
      return 0
    fi
    sleep 2
  done
  return 1
}

mkdir -p /home/ubuntu/.local/bin
install -m 755 "$repo_dir/deploy/imanleads/ci-deploy-entrypoint.sh" /home/ubuntu/.local/bin/kan-ci-deploy

mkdir -p /home/ubuntu/backups/kan/minio-current

if [[ -n "$("${compose[@]}" ps -q postgres 2>/dev/null)" ]]; then
  "$repo_dir/deploy/imanleads/backup.sh"
fi

"${compose[@]}" config --quiet
old_web_container_id="$("${compose[@]}" ps -q web 2>/dev/null || true)"
old_web_image_id=""
rollback_image="imanleads/kan-web:rollback-$KAN_IMAGE_TAG"
old_web_stopped=0
new_web_activated=0
deployment_succeeded=0

rollback_on_error() {
  status=$1
  trap - ERR
  set +e
  if (( deployment_succeeded == 0 && new_web_activated == 1 )) && [[ -n "$old_web_image_id" ]]; then
    "${compose[@]}" stop -t 30 web
    docker image tag "$rollback_image" "imanleads/kan-web:$KAN_IMAGE_TAG"
    "${compose[@]}" up -d --no-deps --force-recreate web
    wait_for_web_health
  elif (( deployment_succeeded == 0 && old_web_stopped == 1 )) && [[ -n "$old_web_container_id" ]]; then
    "${compose[@]}" start web
    wait_for_web_health
  fi
  exit "$status"
}

trap 'rollback_on_error $?' ERR

if [[ -n "$old_web_container_id" ]]; then
  old_web_image_id="$(docker inspect --format '{{.Image}}' "$old_web_container_id")"
  docker image tag "$old_web_image_id" "$rollback_image"
fi

"${compose[@]}" up -d --wait postgres redis minio
"${compose[@]}" run --rm --no-deps minio-init
"${compose[@]}" --profile maintenance build \
  migrate web workspace-canvas-image-backfill visual-wall-backfill
"${compose[@]}" run --rm --no-deps migrate

legacy_workspace_canvas_images="$(
  "${compose[@]}" exec -T postgres psql \
    --username "${POSTGRES_USER:-kan}" \
    --dbname "${POSTGRES_DB:-kan}" \
    --tuples-only \
    --no-align \
    --command 'select count(*) from "workspace_canvas_image" where "optimizedAt" is null and "deletedAt" is null and "storageDeletedAt" is null'
)"
if [[ ! "$legacy_workspace_canvas_images" =~ ^[0-9]+$ ]]; then
  printf '%s\n' "Unable to count legacy workspace canvas images" >&2
  exit 1
fi
if (( legacy_workspace_canvas_images > 0 )); then
  "$repo_dir/deploy/imanleads/snapshot-minio-backup.sh" "$deployed_sha"
fi

set +e
"${compose[@]}" --profile maintenance run --rm --no-deps \
  workspace-canvas-image-backfill
workspace_backfill_status=$?
set -e

if (( workspace_backfill_status != 0 )); then
  "${compose[@]}" logs --tail 200 workspace-canvas-image-backfill
  printf '%s\n' "Workspace canvas image backfill failed with status $workspace_backfill_status" >&2
  exit "$workspace_backfill_status"
fi

if [[ -n "$old_web_container_id" ]]; then
  old_web_stopped=1
  "${compose[@]}" stop -t 30 web
fi

"$repo_dir/deploy/imanleads/backup.sh"
"$repo_dir/deploy/imanleads/snapshot-minio-backup.sh" "$deployed_sha"

set +e
"${compose[@]}" --profile maintenance run --rm --no-deps \
  visual-wall-backfill
visual_wall_backfill_status=$?
set -e

if (( visual_wall_backfill_status != 0 )); then
  "${compose[@]}" logs --tail 200 visual-wall-backfill
  printf '%s\n' "Visual wall backfill failed with status $visual_wall_backfill_status" >&2
  rollback_on_error "$visual_wall_backfill_status"
fi

new_web_activated=1
"${compose[@]}" up -d --no-deps --force-recreate web
if ! wait_for_web_health; then
  "${compose[@]}" ps
  "${compose[@]}" logs --tail 200 web
  printf '%s\n' "New web image failed health validation" >&2
  rollback_on_error 1
fi

"$repo_dir/deploy/imanleads/install-nginx.sh"
sudo install -m 644 "$repo_dir/deploy/imanleads/kan-backup.service" /etc/systemd/system/kan-backup.service
sudo install -m 644 "$repo_dir/deploy/imanleads/kan-backup.timer" /etc/systemd/system/kan-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now kan-backup.timer

curl -kfsS --resolve work.imanleads.com:443:127.0.0.1 \
  https://work.imanleads.com/api/v1/health | grep -q '"status":"ok"'

"${compose[@]}" logs --since 30m --no-color web 2>&1 | \
  "$repo_dir/deploy/imanleads/audit-workspace-canvas-logs.sh"

deployment_succeeded=1
trap - ERR
docker image rm "$rollback_image" >/dev/null 2>&1 || true

git rev-parse HEAD
"${compose[@]}" ps
