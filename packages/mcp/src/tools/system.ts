import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { kanAdminRequest, kanRequest } from "../client.js";
import { jsonResult } from "../result.js";

export function registerSystemTools(server: McpServer): void {
  server.registerTool(
    "get_health",
    {
      description: "Check Kan, database, and object storage health.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => jsonResult(await kanRequest("GET", "/health")),
  );

  server.registerTool(
    "get_instance_stats",
    {
      description:
        "Get instance-wide counts using KAN_ADMIN_API_KEY. This is distinct from the user's API token.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => jsonResult(await kanAdminRequest("GET", "/stats")),
  );

  server.registerTool(
    "get_current_user",
    {
      description:
        "Get the profile associated with the configured Kan API token.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => jsonResult(await kanRequest("GET", "/users/me")),
  );

  server.registerTool(
    "update_current_user",
    {
      description: "Update the current user's display name or avatar key.",
      inputSchema: {
        name: z.string().min(1).optional(),
        image: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, image }) =>
      jsonResult(await kanRequest("PUT", "/users", { name, image })),
  );

  server.registerTool(
    "set_current_user_password",
    {
      description:
        "Replace the current user's login password. Use only after explicit user direction; the password is sent directly to Kan and is never returned.",
      inputSchema: { newPassword: z.string().min(8) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ newPassword }) =>
      jsonResult(
        await kanRequest("POST", "/users/me/password", { newPassword }),
      ),
  );
}
