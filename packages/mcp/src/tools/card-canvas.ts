import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { jsonResult } from "../result.js";

const publicId = z.string().regex(/^[a-z0-9]{12}$/);
const priority = z.enum(["none", "low", "medium", "high", "urgent"]);
const stageStatus = z.enum(["planned", "inProgress", "blocked", "done"]);

const canvasPaths = {
  frames: (cardPublicId: string) => `/cards/${cardPublicId}/canvas/frames`,
  convertFrame: (cardPublicId: string) =>
    `/cards/${cardPublicId}/canvas/convert-frame`,
} as const;

export function registerCardCanvasTools(server: McpServer): void {
  server.registerTool(
    "list_card_canvas_frames",
    {
      description:
        "List the stable frames in a card whiteboard, including their live subtask status, without returning the arbitrary canvas scene.",
      inputSchema: { cardPublicId: publicId },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ cardPublicId }) =>
      jsonResult(await kanRequest("GET", canvasPaths.frames(cardPublicId))),
  );

  server.registerTool(
    "convert_canvas_frame_to_subtask",
    {
      description:
        "Atomically convert one existing whiteboard frame into a card subtask using the current canvas version. This never accepts or writes an arbitrary scene.",
      inputSchema: {
        cardPublicId: publicId,
        framePublicId: publicId,
        expectedVersion: z.number().int().min(1),
        targetStageStatus: stageStatus,
        subtaskFields: z.object({
          title: z.string().trim().min(1).max(500),
          description: z.string().max(10000).optional(),
          priority: priority.optional(),
          dueDate: z.string().datetime().nullable().optional(),
          ownerPublicId: publicId.nullable().optional(),
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ cardPublicId, ...input }) =>
      jsonResult(
        await kanRequest("POST", canvasPaths.convertFrame(cardPublicId), input),
      ),
  );
}
