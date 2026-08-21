import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { jsonResult } from "../result.js";

const publicId = z.string().length(12);
const priority = z.enum(["none", "low", "medium", "high", "urgent"]);

export function registerCardPipelineTools(server: McpServer): void {
  server.registerTool(
    "get_card_pipeline",
    {
      description:
        "Get a card's four-stage subtask pipeline without initializing it.",
      inputSchema: { cardPublicId: publicId },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ cardPublicId }) =>
      jsonResult(await kanRequest("GET", `/cards/${cardPublicId}/pipeline`)),
  );

  server.registerTool(
    "initialize_card_pipeline",
    {
      description:
        "Initialize the card's fixed Por hacer, En curso, Bloqueado and Hecho stages. Safe to call more than once.",
      inputSchema: { cardPublicId: publicId },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ cardPublicId }) =>
      jsonResult(await kanRequest("POST", `/cards/${cardPublicId}/pipeline`)),
  );

  server.registerTool(
    "update_card_pipeline_stages",
    {
      description:
        "Patch the name, colour or order of one to four pipeline stages. Semantic statuses never change.",
      inputSchema: {
        cardPublicId: publicId,
        stages: z
          .array(
            z.object({
              stagePublicId: publicId,
              name: z.string().min(1).max(255).optional(),
              colourCode: z
                .string()
                .regex(/^#[0-9a-f]{6}$/i)
                .nullable()
                .optional(),
              index: z.number().int().min(0).max(3).optional(),
            }),
          )
          .min(1)
          .max(4),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ cardPublicId, stages }) =>
      jsonResult(
        await kanRequest("PUT", `/cards/${cardPublicId}/pipeline/stages`, {
          stages,
        }),
      ),
  );

  server.registerTool(
    "create_card_subtask",
    {
      description: "Create one subtask in an initialized card pipeline.",
      inputSchema: {
        cardPublicId: publicId,
        stagePublicId: publicId,
        title: z.string().min(1).max(500),
        description: z.string().max(10000).optional(),
        priority: priority.optional(),
        dueDate: z.string().datetime().nullable().optional(),
        ownerPublicId: publicId.nullable().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ dueDate, ...input }) =>
      jsonResult(
        await kanRequest("POST", `/cards/${input.cardPublicId}/subtasks`, {
          ...input,
          dueDate,
        }),
      ),
  );

  server.registerTool(
    "update_card_subtask",
    {
      description: "Update a subtask's content, priority or due date.",
      inputSchema: {
        subtaskPublicId: publicId,
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(10000).nullable().optional(),
        priority: priority.optional(),
        dueDate: z.string().datetime().nullable().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ subtaskPublicId, ...changes }) =>
      jsonResult(
        await kanRequest("PUT", `/subtasks/${subtaskPublicId}`, changes),
      ),
  );

  server.registerTool(
    "move_card_subtask",
    {
      description:
        "Move a subtask to another stage in its parent card, optionally at an exact zero-based position.",
      inputSchema: {
        subtaskPublicId: publicId,
        stagePublicId: publicId,
        index: z.number().int().min(0).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ subtaskPublicId, stagePublicId, index }) =>
      jsonResult(
        await kanRequest("POST", `/subtasks/${subtaskPublicId}/move`, {
          stagePublicId,
          index,
        }),
      ),
  );

  server.registerTool(
    "reorder_card_subtasks",
    {
      description: "Set the complete subtask order for one pipeline stage.",
      inputSchema: {
        cardPublicId: publicId,
        stagePublicId: publicId,
        orderedSubtaskPublicIds: z.array(publicId),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ cardPublicId, stagePublicId, orderedSubtaskPublicIds }) =>
      jsonResult(
        await kanRequest(
          "PUT",
          `/cards/${cardPublicId}/pipeline/stages/${stagePublicId}/subtasks/order`,
          { orderedSubtaskPublicIds },
        ),
      ),
  );

  server.registerTool(
    "assign_card_subtask",
    {
      description:
        "Set or clear the single responsible workspace member for a subtask.",
      inputSchema: {
        subtaskPublicId: publicId,
        ownerPublicId: publicId.nullable(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ subtaskPublicId, ownerPublicId }) =>
      jsonResult(
        await kanRequest("PUT", `/subtasks/${subtaskPublicId}/owner`, {
          ownerPublicId,
        }),
      ),
  );

  server.registerTool(
    "delete_card_subtask",
    {
      description: "Soft-delete one card subtask and its checklist.",
      inputSchema: { subtaskPublicId: publicId },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ subtaskPublicId }) =>
      jsonResult(await kanRequest("DELETE", `/subtasks/${subtaskPublicId}`)),
  );

  server.registerTool(
    "create_subtask_checklist_item",
    {
      description: "Add a checklist step to a card subtask.",
      inputSchema: {
        subtaskPublicId: publicId,
        title: z.string().min(1).max(500),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ subtaskPublicId, title }) =>
      jsonResult(
        await kanRequest("POST", `/subtasks/${subtaskPublicId}/checklist`, {
          title,
        }),
      ),
  );

  server.registerTool(
    "update_subtask_checklist_item",
    {
      description: "Update a subtask checklist item's title or completion.",
      inputSchema: {
        checklistItemPublicId: publicId,
        title: z.string().min(1).max(500).optional(),
        completed: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ checklistItemPublicId, ...changes }) =>
      jsonResult(
        await kanRequest(
          "PATCH",
          `/subtasks/checklist/${checklistItemPublicId}`,
          changes,
        ),
      ),
  );

  server.registerTool(
    "reorder_subtask_checklist",
    {
      description: "Set the complete checklist item order for one subtask.",
      inputSchema: {
        subtaskPublicId: publicId,
        orderedItemPublicIds: z.array(publicId),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ subtaskPublicId, orderedItemPublicIds }) =>
      jsonResult(
        await kanRequest(
          "PUT",
          `/subtasks/${subtaskPublicId}/checklist/order`,
          { orderedItemPublicIds },
        ),
      ),
  );

  server.registerTool(
    "delete_subtask_checklist_item",
    {
      description: "Delete a checklist item from a card subtask.",
      inputSchema: { checklistItemPublicId: publicId },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ checklistItemPublicId }) =>
      jsonResult(
        await kanRequest(
          "DELETE",
          `/subtasks/checklist/${checklistItemPublicId}`,
        ),
      ),
  );

  server.registerTool(
    "link_attachment_to_subtask",
    {
      description:
        "Link a confirmed attachment from the parent card to a subtask.",
      inputSchema: {
        subtaskPublicId: publicId,
        attachmentPublicId: publicId,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ subtaskPublicId, attachmentPublicId }) =>
      jsonResult(
        await kanRequest("POST", `/subtasks/${subtaskPublicId}/attachments`, {
          attachmentPublicId,
        }),
      ),
  );

  server.registerTool(
    "unlink_attachment_from_subtask",
    {
      description: "Remove an attachment link from a subtask.",
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
          `/subtasks/${subtaskPublicId}/attachments/${resourcePublicId}`,
        ),
      ),
  );
}
