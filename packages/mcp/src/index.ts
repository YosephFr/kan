#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerPrompts } from "./prompts.js";
import { registerAttachmentTools } from "./tools/attachment.js";
import { registerAutomationTools } from "./tools/automation.js";
import { registerBoardTools } from "./tools/board.js";
import { registerCardTools } from "./tools/card.js";
import { registerChecklistTools } from "./tools/checklist.js";
import { registerIntegrationTools } from "./tools/integration.js";
import { registerLabelTools } from "./tools/label.js";
import { registerListTools } from "./tools/list.js";
import { registerMemberTools } from "./tools/member.js";
import { registerPermissionTools } from "./tools/permission.js";
import { registerSystemTools } from "./tools/system.js";
import { registerWebhookTools } from "./tools/webhook.js";
import { registerWorkspaceTools } from "./tools/workspace.js";

const server = new McpServer(
  {
    name: "kan",
    version: "0.2.0",
  },
  {
    instructions:
      "Inspect workspaces, boards, members, and current cards before writing. Never guess a target workspace, board, assignee, due date, or destructive action. For meeting imports, resolve ambiguities with the user, run ensure_workspace_board and sync_board_cards in plan mode, present the plan, then apply only after confirmation. These batch tools are idempotent by name/title and do not delete unspecified content. Upload only file paths the user explicitly supplied. Prefer public IDs returned by read tools.",
  },
);

registerWorkspaceTools(server);
registerBoardTools(server);
registerListTools(server);
registerCardTools(server);
registerChecklistTools(server);
registerLabelTools(server);
registerMemberTools(server);
registerAttachmentTools(server);
registerSystemTools(server);
registerPermissionTools(server);
registerWebhookTools(server);
registerIntegrationTools(server);
registerAutomationTools(server);
registerPrompts(server);

const transport = new StdioServerTransport();
await server.connect(transport);
