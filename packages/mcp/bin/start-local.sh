#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
env_file="${KAN_MCP_ENV_FILE:-$repo_dir/.env.kan-mcp.local}"

if [[ ! -s "$env_file" ]]; then
  printf '%s\n' "Missing MCP environment file: $env_file" >&2
  exit 1
fi

set -a
source "$env_file"
set +a

if [[ ! -f "$repo_dir/packages/mcp/dist/index.js" ]]; then
  pnpm --dir "$repo_dir" --filter @kan/mcp build >&2
fi

exec node "$repo_dir/packages/mcp/dist/index.js"
