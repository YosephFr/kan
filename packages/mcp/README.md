# Kan MCP server

The Kan MCP server exposes the complete public Kan API plus two idempotent orchestration tools for turning reviewed plans or meeting transcripts into workspaces, boards, lists, and cards.

## Capabilities

- Workspaces, boards, lists, cards, comments, labels, members, and checklists
- Attachments through opaque, single-use upload sessions with exact size, MIME, and SHA-256 validation
- Card resources for listing uploads and adding canonical Google Drive, Docs, Sheets, or Slides links
- Resource links between a parent card and its subtasks, with guarded deletion when a resource is in use
- Card whiteboard frame discovery and guarded conversion of a frame into an executable subtask
- User profile, instance health, and administrator statistics
- Workspace roles, member permission overrides, invite links, and invite acceptance
- Webhooks and Trello or GitHub imports
- Idempotent workspace/board/list creation with `ensure_workspace_board`
- Batched card reconciliation with assignments, labels, due dates, list movement, and checklists through `sync_board_cards`
- A `meeting_to_kan` prompt that requires target, ownership, timing, and duplicate decisions before applying changes

Kan currently models people as workspace members with roles and permission overrides. It does not expose a separate user-group entity through its public API.

## Required environment

| Variable                 | Purpose                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `KAN_BASE_URL`           | Kan origin without `/api/v1`                                 |
| `KAN_API_TOKEN`          | User API key created in Kan settings                         |
| `KAN_ADMIN_API_KEY`      | Optional instance administrator key for `get_instance_stats` |
| `KAN_REQUEST_TIMEOUT_MS` | Optional request timeout; defaults to 30000                  |

## Build and run

```bash
pnpm --filter @kan/mcp test
pnpm --filter @kan/mcp typecheck
pnpm --filter @kan/mcp build
KAN_BASE_URL=https://kan.example.com KAN_API_TOKEN=kan_xxx node packages/mcp/dist/index.js
```

For this checkout, `packages/mcp/bin/start-local.sh` reads the ignored `.env.kan-mcp.local` file, atomically rebuilds when source, package metadata, or the lockfile is newer than the compiled bundle, and starts the stdio server. Build locks record their owner PID; dead owners are recovered immediately, while an ownerless lock waits 30 seconds to avoid stealing the lock during creation. MCP `0.6.0` exposes card resources and whiteboard frame conversion while retaining the attachment upload tools; arbitrary whiteboard scenes, storage keys, and internal IDs are never accepted or returned.

## Codex

Use a project-scoped `.codex/config.toml` or run:

```bash
codex mcp add kan -- /absolute/path/to/packages/mcp/bin/start-local.sh
```

Restart Codex after adding the server. The desktop app, CLI, and IDE extension share the same MCP configuration.

## Claude Code

Register the same executable as a local stdio MCP server:

```bash
claude mcp add kan -- /absolute/path/to/packages/mcp/bin/start-local.sh
```

## Meeting workflow

1. Supply the transcript and relevant source files.
2. Resolve destination, existing versus new board, owners, due dates, completion state, and attachments.
3. Inspect the destination through the read tools.
4. Run `ensure_workspace_board` with `mode=plan`.
5. Run `sync_board_cards` with `mode=plan` and review the proposed changes.
6. Repeat both calls with `mode=apply` after confirmation.
7. Attach only explicitly supplied files with `upload_card_attachment`.
8. Read the resulting board and sample cards to verify assignments, lists, labels, descriptions, and checklists.

`sync_board_cards` matches cards case-insensitively by `matchTitle` or `title`, so replaying an approved import updates instead of duplicating it. It never deletes missing cards, lists, checklists, or checklist items. Relation mode `merge` preserves manual assignments and labels; `replace` reconciles those two relations exactly.
