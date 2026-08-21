#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
mcp_dir="$repo_dir/packages/mcp"
dist_dir="$mcp_dir/dist"
entrypoint="$dist_dir/index.js"
env_file="${KAN_MCP_ENV_FILE:-$repo_dir/.env.kan-mcp.local}"
lock_dir="$mcp_dir/.dist-build.lock"
lock_owner_file="$lock_dir/owner.pid"
lock_attempts=100
lock_sleep_seconds=0.1
lock_owner_grace_seconds=30
build_dir=""
backup_dir=""
owns_lock=false

if [[ "${KAN_MCP_LAUNCHER_TEST_MODE:-}" == "1" ]]; then
  lock_attempts="${KAN_MCP_TEST_LOCK_ATTEMPTS:-$lock_attempts}"
  lock_sleep_seconds="${KAN_MCP_TEST_LOCK_SLEEP_SECONDS:-$lock_sleep_seconds}"
  lock_owner_grace_seconds="${KAN_MCP_TEST_LOCK_OWNER_GRACE_SECONDS:-$lock_owner_grace_seconds}"
fi

if [[ ! "$lock_attempts" =~ ^[1-9][0-9]*$ ]] ||
  [[ ! "$lock_sleep_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] ||
  [[ ! "$lock_owner_grace_seconds" =~ ^[0-9]+$ ]]; then
  printf '%s\n' "Invalid MCP build lock configuration" >&2
  exit 1
fi

read_lock_owner() {
  local owner=""
  [[ -f "$lock_owner_file" ]] || return 1
  IFS= read -r owner <"$lock_owner_file" || true
  [[ "$owner" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$owner"
}

lock_owner_window_elapsed() {
  local modified_at=""
  local now=""
  if modified_at="$(stat -c %Y "$lock_dir" 2>/dev/null)"; then
    :
  elif modified_at="$(stat -f %m "$lock_dir" 2>/dev/null)"; then
    :
  else
    return 1
  fi
  now="$(date +%s)"
  ((now - modified_at >= lock_owner_grace_seconds))
}

recover_stale_lock() {
  local owner=""
  local current_owner=""
  [[ -d "$lock_dir" ]] || return 0

  if owner="$(read_lock_owner)"; then
    if kill -0 "$owner" 2>/dev/null; then
      return 1
    fi
    current_owner="$(read_lock_owner 2>/dev/null || true)"
    [[ "$current_owner" == "$owner" ]] || return 1
    rm -f -- "$lock_owner_file"
    rmdir "$lock_dir" 2>/dev/null || true
    return 0
  fi

  lock_owner_window_elapsed || return 1
  rm -f -- "$lock_owner_file"
  rmdir "$lock_dir" 2>/dev/null || true
}

assert_owned_lock() {
  local owner=""
  owner="$(read_lock_owner 2>/dev/null || true)"
  if [[ "$owns_lock" != true || "$owner" != "$$" ]]; then
    printf '%s\n' "Lost ownership of the MCP build lock" >&2
    return 1
  fi
}

release_owned_lock() {
  local owner=""
  [[ "$owns_lock" == true ]] || return 0
  owner="$(read_lock_owner 2>/dev/null || true)"
  if [[ "$owner" == "$$" ]]; then
    rm -f -- "$lock_owner_file"
    if ! rmdir "$lock_dir" 2>/dev/null; then
      printf '%s\n' "$$" >"$lock_owner_file" 2>/dev/null || true
      return 1
    fi
  fi
  owns_lock=false
}

cleanup() {
  if [[ -n "$build_dir" && -d "$build_dir" ]]; then
    rm -r -- "$build_dir"
  fi
  if [[ -n "$backup_dir" && -d "$backup_dir" ]]; then
    if [[ ! -d "$dist_dir" ]]; then
      mv "$backup_dir" "$dist_dir"
    else
      rm -r -- "$backup_dir"
    fi
  fi
  release_owned_lock
}
trap cleanup EXIT

if [[ ! -s "$env_file" ]]; then
  printf '%s\n' "Missing MCP environment file: $env_file" >&2
  exit 1
fi

set -a
source "$env_file"
set +a

needs_build() {
  [[ ! -f "$entrypoint" ]] && return 0
  find "$mcp_dir/src" "$mcp_dir/package.json" "$mcp_dir/tsconfig.json" \
    "$repo_dir/pnpm-lock.yaml" -type f -newer "$entrypoint" -print -quit |
    grep -q .
}

if needs_build; then
  for ((_attempt = 1; _attempt <= lock_attempts; _attempt += 1)); do
    if mkdir "$lock_dir" 2>/dev/null; then
      owns_lock=true
      if ! printf '%s\n' "$$" >"$lock_owner_file"; then
        rm -f -- "$lock_owner_file"
        rmdir "$lock_dir" 2>/dev/null || true
        owns_lock=false
        exit 1
      fi
      break
    fi
    recover_stale_lock || true
    sleep "$lock_sleep_seconds"
  done
  if [[ "$owns_lock" != true ]]; then
    printf '%s\n' "Timed out waiting for the MCP build lock" >&2
    exit 1
  fi

  if needs_build; then
    build_dir="$(mktemp -d "$mcp_dir/.dist-build.XXXXXX")"
    pnpm --dir "$mcp_dir" exec tsc --noEmit false --declaration false \
      --emitDeclarationOnly false --outDir "$build_dir" >&2
    if [[ ! -f "$build_dir/index.js" ]]; then
      printf '%s\n' "MCP build did not produce index.js" >&2
      exit 1
    fi

    assert_owned_lock

    if [[ -d "$dist_dir" ]]; then
      backup_dir="$(mktemp -d "$mcp_dir/.dist-previous.XXXXXX")"
      rmdir "$backup_dir"
      mv "$dist_dir" "$backup_dir"
    fi
    if ! mv "$build_dir" "$dist_dir"; then
      if [[ -n "$backup_dir" && -d "$backup_dir" ]]; then
        mv "$backup_dir" "$dist_dir"
        backup_dir=""
      fi
      exit 1
    fi
    build_dir=""
    if [[ -n "$backup_dir" && -d "$backup_dir" ]]; then
      rm -r -- "$backup_dir"
      backup_dir=""
    fi
  fi
fi

release_owned_lock

exec node "$entrypoint"
