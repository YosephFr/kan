#!/usr/bin/env bash
set -euo pipefail

repo_dir="/home/ubuntu/kan"
lock_file="/home/ubuntu/.cache/kan-deploy.lock"

if [[ ! "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy[[:space:]]([0-9a-f]{40})$ ]]; then
  printf '%s\n' "Only an exact Kan production revision can be deployed" >&2
  exit 64
fi

expected_sha="${BASH_REMATCH[1]}"

if [[ "${KAN_DEPLOY_LOCK_HELD:-}" != "1" ]]; then
  mkdir -p "$(dirname "$lock_file")"
  export KAN_DEPLOY_LOCK_HELD=1
  exec flock -w 2700 "$lock_file" "$0"
fi

cd "$repo_dir"

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  printf '%s\n' "The production checkout is not pristine" >&2
  git status --short >&2
  exit 1
fi

git fetch origin main
origin_sha="$(git rev-parse origin/main)"

if [[ "$origin_sha" != "$expected_sha" ]]; then
  printf '%s\n' "Revision $expected_sha was superseded by $origin_sha" >&2
  exit 75
fi

git merge --ff-only origin/main
exec "$repo_dir/deploy/imanleads/deploy.sh" "$expected_sha"
