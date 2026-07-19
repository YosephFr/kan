import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { jsonResult } from "../result.js";

const eventSchema = z.enum([
  "card.created",
  "card.updated",
  "card.moved",
  "card.deleted",
]);

const webhookInput = {
  workspacePublicId: z.string().min(12),
  webhookPublicId: z.string().min(12),
};

export function registerWebhookTools(server: McpServer): void {
  server.registerTool(
    "list_webhooks",
    {
      description: "List a workspace's configured webhooks.",
      inputSchema: { workspacePublicId: z.string().min(12) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId }) =>
      jsonResult(
        await kanRequest("GET", `/workspaces/${workspacePublicId}/webhooks`),
      ),
  );

  server.registerTool(
    "create_webhook",
    {
      description: "Create a webhook for card lifecycle events in a workspace.",
      inputSchema: {
        workspacePublicId: z.string().min(12),
        name: z.string().min(1).max(255),
        url: z.string().url().max(2048),
        secret: z.string().max(512).optional(),
        events: z.array(eventSchema).min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspacePublicId, name, url, secret, events }) =>
      jsonResult(
        await kanRequest("POST", `/workspaces/${workspacePublicId}/webhooks`, {
          name,
          url,
          secret,
          events,
        }),
      ),
  );

  server.registerTool(
    "update_webhook",
    {
      description:
        "Update a webhook's destination, events, secret, name, or active state.",
      inputSchema: {
        ...webhookInput,
        name: z.string().min(1).max(255).optional(),
        url: z.string().url().max(2048).optional(),
        secret: z.string().max(512).optional(),
        events: z.array(eventSchema).min(1).optional(),
        active: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      workspacePublicId,
      webhookPublicId,
      name,
      url,
      secret,
      events,
      active,
    }) =>
      jsonResult(
        await kanRequest(
          "PUT",
          `/workspaces/${workspacePublicId}/webhooks/${webhookPublicId}`,
          { name, url, secret, events, active },
        ),
      ),
  );

  server.registerTool(
    "delete_webhook",
    {
      description: "Permanently delete a workspace webhook.",
      inputSchema: webhookInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId, webhookPublicId }) =>
      jsonResult(
        await kanRequest(
          "DELETE",
          `/workspaces/${workspacePublicId}/webhooks/${webhookPublicId}`,
        ),
      ),
  );

  server.registerTool(
    "test_webhook",
    {
      description: "Send a test delivery through an existing webhook.",
      inputSchema: webhookInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspacePublicId, webhookPublicId }) =>
      jsonResult(
        await kanRequest(
          "POST",
          `/workspaces/${workspacePublicId}/webhooks/${webhookPublicId}/test`,
        ),
      ),
  );
}
