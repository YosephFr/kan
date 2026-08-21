import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { jsonResult } from "../result.js";

const publicId = z.string().length(12);

const resourcePaths = {
  card: (cardPublicId: string) => `/cards/${cardPublicId}/resources`,
  drive: (cardPublicId: string) => `/cards/${cardPublicId}/resources/drive`,
  resource: (resourcePublicId: string) => `/resources/${resourcePublicId}`,
  subtask: (subtaskPublicId: string) =>
    `/subtasks/${subtaskPublicId}/resources`,
  subtaskResource: (subtaskPublicId: string, resourcePublicId: string) =>
    `/subtasks/${subtaskPublicId}/resources/${resourcePublicId}`,
} as const;

export function registerCardResourceTools(server: McpServer): void {
  server.registerTool(
    "list_card_resources",
    {
      description:
        "List uploads and Google Drive links attached to a card without exposing storage keys or internal IDs.",
      inputSchema: { cardPublicId: publicId },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ cardPublicId }) =>
      jsonResult(await kanRequest("GET", resourcePaths.card(cardPublicId))),
  );

  server.registerTool(
    "add_drive_link_to_card",
    {
      description:
        "Add a Google Drive, Docs, Sheets or Slides share link to a card. Kan validates and canonicalizes the URL without bypassing Drive permissions.",
      inputSchema: {
        cardPublicId: publicId,
        url: z.string().url().max(2048),
        title: z.string().trim().min(1).max(255).optional(),
        publicVisibilityAcknowledged: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ cardPublicId, url, title, publicVisibilityAcknowledged }) =>
      jsonResult(
        await kanRequest("POST", resourcePaths.drive(cardPublicId), {
          url,
          title,
          publicVisibilityAcknowledged,
        }),
      ),
  );

  server.registerTool(
    "link_resource_to_subtask",
    {
      description:
        "Link an upload or Drive resource from the parent card to a subtask.",
      inputSchema: {
        subtaskPublicId: publicId,
        resourcePublicId: publicId,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ subtaskPublicId, resourcePublicId }) =>
      jsonResult(
        await kanRequest("POST", resourcePaths.subtask(subtaskPublicId), {
          resourcePublicId,
        }),
      ),
  );

  server.registerTool(
    "unlink_resource_from_subtask",
    {
      description: "Remove a card resource link from a subtask.",
      inputSchema: {
        subtaskPublicId: publicId,
        resourcePublicId: publicId,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ subtaskPublicId, resourcePublicId }) =>
      jsonResult(
        await kanRequest(
          "DELETE",
          resourcePaths.subtaskResource(subtaskPublicId, resourcePublicId),
        ),
      ),
  );

  server.registerTool(
    "delete_card_resource",
    {
      description:
        "Soft-delete a card resource. Set confirmUsageRemoval only after reviewing RESOURCE_IN_USE because it also removes subtask references.",
      inputSchema: {
        resourcePublicId: publicId,
        confirmUsageRemoval: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ resourcePublicId, confirmUsageRemoval }) =>
      jsonResult(
        await kanRequest(
          "DELETE",
          `${resourcePaths.resource(resourcePublicId)}${
            confirmUsageRemoval ? "?removeReferences=true" : ""
          }`,
        ),
      ),
  );
}
