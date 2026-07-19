import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { jsonResult } from "../result.js";

export function registerIntegrationTools(server: McpServer): void {
  server.registerTool(
    "list_integration_providers",
    {
      description:
        "List the current user's available and connected import providers.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => jsonResult(await kanRequest("GET", "/integration/providers")),
  );

  server.registerTool(
    "get_integration_authorization_url",
    {
      description:
        "Get the authorization URL for a supported integration provider.",
      inputSchema: { provider: z.literal("trello") },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ provider }) => {
      const params = new URLSearchParams({ provider });
      return jsonResult(
        await kanRequest("GET", `/integration/authorize?${params.toString()}`),
      );
    },
  );

  server.registerTool(
    "disconnect_integration",
    {
      description: "Disconnect Trello or GitHub from the current Kan user.",
      inputSchema: { provider: z.enum(["trello", "github"]) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ provider }) =>
      jsonResult(
        await kanRequest("POST", "/integration/disconnect", { provider }),
      ),
  );

  server.registerTool(
    "list_trello_boards",
    {
      description:
        "List Trello boards available through the connected account.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () =>
      jsonResult(await kanRequest("GET", "/integrations/trello/boards")),
  );

  server.registerTool(
    "import_trello_boards",
    {
      description: "Import selected Trello boards into a Kan workspace.",
      inputSchema: {
        workspacePublicId: z.string().min(12),
        boardIds: z.array(z.string().min(1)).min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspacePublicId, boardIds }) =>
      jsonResult(
        await kanRequest("POST", "/imports/trello/boards", {
          workspacePublicId,
          boardIds,
        }),
      ),
  );

  server.registerTool(
    "list_github_projects",
    {
      description:
        "List GitHub projects available through the connected account.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () =>
      jsonResult(await kanRequest("GET", "/integrations/github/projects")),
  );

  server.registerTool(
    "import_github_projects",
    {
      description: "Import selected GitHub projects into a Kan workspace.",
      inputSchema: {
        workspacePublicId: z.string().min(12),
        projectIds: z.array(z.string().min(1)).min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspacePublicId, projectIds }) =>
      jsonResult(
        await kanRequest("POST", "/imports/github/projects", {
          workspacePublicId,
          projectIds,
        }),
      ),
  );
}
