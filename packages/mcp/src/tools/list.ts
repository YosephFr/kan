import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { accentColourCodes } from "../constants.js";

export function registerListTools(server: McpServer): void {
  server.tool(
    "create_list",
    "Create a new list inside a board",
    {
      boardPublicId: z.string().describe("The board's public ID"),
      name: z.string().describe("List name"),
      status: z
        .enum(["planned", "inProgress", "blocked", "done", "other"])
        .nullable()
        .optional()
        .describe("Workflow status represented by the list"),
      colourCode: z
        .enum(accentColourCodes)
        .nullable()
        .optional()
        .describe("List accent colour as a six-digit hex value"),
    },
    async ({ boardPublicId, name, status, colourCode }) => {
      const data = await kanRequest("POST", "/lists", {
        boardPublicId,
        name,
        status,
        colourCode,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.tool(
    "update_list",
    "Update a list's name, position, workflow status, or colour",
    {
      listPublicId: z.string().describe("The list's public ID"),
      name: z.string().optional().describe("New list name"),
      index: z.number().int().optional().describe("New position index"),
      status: z
        .enum(["planned", "inProgress", "blocked", "done", "other"])
        .nullable()
        .optional()
        .describe("Workflow status represented by the list"),
      colourCode: z
        .enum(accentColourCodes)
        .nullable()
        .optional()
        .describe("List accent colour, or null to clear"),
      confirmCardLifecycleUpdate: z
        .boolean()
        .optional()
        .describe("Confirm lifecycle changes for cards already in the list"),
    },
    async ({
      listPublicId,
      name,
      index,
      status,
      colourCode,
      confirmCardLifecycleUpdate,
    }) => {
      const data = await kanRequest("PUT", `/lists/${listPublicId}`, {
        name,
        index,
        status,
        colourCode,
        confirmCardLifecycleUpdate,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.tool(
    "delete_list",
    "Delete a list and all its cards",
    { listPublicId: z.string().describe("The list's public ID") },
    async ({ listPublicId }) => {
      const data = await kanRequest("DELETE", `/lists/${listPublicId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );
}
