import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { getWorkspaceSummaries } from "../workspaces.js";

export function registerBoardTools(server: McpServer): void {
  server.tool(
    "list_boards",
    "List all boards in a workspace. Requires the workspace publicId — use find_workspace_by_name first if you only know the workspace name.",
    {
      workspacePublicId: z
        .string()
        .min(12)
        .describe(
          "The workspace's 12-character public ID (not the name). Get it from list_workspaces or find_workspace_by_name first.",
        ),
      type: z.enum(["regular", "template"]).optional(),
      archived: z.boolean().optional(),
    },
    async ({ workspacePublicId, type, archived }) => {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (archived !== undefined) params.set("archived", String(archived));
      const query = params.size ? `?${params.toString()}` : "";
      const data = await kanRequest(
        "GET",
        `/workspaces/${workspacePublicId}/boards${query}`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.tool(
    "find_board_by_name",
    "Find a board by workspace name and board name (both case-insensitive). Resolves workspace name → publicId, then board name → publicId automatically. Use this when you only know names.",
    {
      workspaceName: z
        .string()
        .describe("The workspace name (e.g. 'UC Roleplay')"),
      boardName: z
        .string()
        .describe("The board name (e.g. 'Mechanics Rework')"),
    },
    async ({ workspaceName, boardName }) => {
      const workspaces = await getWorkspaceSummaries();
      const workspace = workspaces.find(
        (w) => w.name.toLowerCase() === workspaceName.toLowerCase(),
      );
      if (!workspace) {
        const names = workspaces.map((w) => w.name).join(", ");
        return {
          content: [
            {
              type: "text",
              text: `No workspace found with name "${workspaceName}". Available: ${names}`,
            },
          ],
        };
      }
      const boards = await kanRequest<{ publicId: string; name: string }[]>(
        "GET",
        `/workspaces/${workspace.publicId}/boards`,
      );
      const board = boards.find(
        (b) => b.name.toLowerCase() === boardName.toLowerCase(),
      );
      if (!board) {
        const names = boards.map((b) => b.name).join(", ");
        return {
          content: [
            {
              type: "text",
              text: `No board found with name "${boardName}" in workspace "${workspaceName}". Available boards: ${names}`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(board, null, 2) }],
      };
    },
  );

  server.tool(
    "get_board",
    "Get a board by its public ID, including its lists and cards",
    {
      boardPublicId: z.string().describe("The board's public ID"),
      labelPublicIds: z
        .array(z.string().min(12))
        .optional()
        .describe("Filter cards by label public IDs"),
      memberPublicIds: z
        .array(z.string().min(12))
        .optional()
        .describe("Filter cards by workspace member public IDs"),
      listPublicIds: z.array(z.string().min(12)).optional(),
      dueDateFilters: z
        .array(
          z.enum([
            "overdue",
            "today",
            "tomorrow",
            "next-week",
            "next-month",
            "no-due-date",
          ]),
        )
        .optional(),
      type: z.enum(["regular", "template"]).optional(),
    },
    async ({
      boardPublicId,
      labelPublicIds,
      memberPublicIds,
      listPublicIds,
      dueDateFilters,
      type,
    }) => {
      const params = new URLSearchParams();
      labelPublicIds?.forEach((value) => params.append("labels", value));
      memberPublicIds?.forEach((value) => params.append("members", value));
      listPublicIds?.forEach((value) => params.append("lists", value));
      dueDateFilters?.forEach((value) =>
        params.append("dueDateFilters", value),
      );
      if (type) params.set("type", type);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const data = await kanRequest("GET", `/boards/${boardPublicId}${qs}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.tool(
    "get_board_by_slug",
    "Get a board by workspace slug and board slug",
    {
      workspaceSlug: z.string().describe("The workspace slug"),
      boardSlug: z.string().describe("The board slug"),
      labelPublicIds: z.array(z.string().min(12)).optional(),
      memberPublicIds: z.array(z.string().min(12)).optional(),
      listPublicIds: z.array(z.string().min(12)).optional(),
      dueDateFilters: z
        .array(
          z.enum([
            "overdue",
            "today",
            "tomorrow",
            "next-week",
            "next-month",
            "no-due-date",
          ]),
        )
        .optional(),
    },
    async ({
      workspaceSlug,
      boardSlug,
      labelPublicIds,
      memberPublicIds,
      listPublicIds,
      dueDateFilters,
    }) => {
      const params = new URLSearchParams();
      labelPublicIds?.forEach((value) => params.append("labels", value));
      memberPublicIds?.forEach((value) => params.append("members", value));
      listPublicIds?.forEach((value) => params.append("lists", value));
      dueDateFilters?.forEach((value) =>
        params.append("dueDateFilters", value),
      );
      const query = params.size ? `?${params.toString()}` : "";
      const data = await kanRequest(
        "GET",
        `/workspaces/${workspaceSlug}/boards/${boardSlug}${query}`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.tool(
    "create_board",
    "Create a new board in a workspace",
    {
      workspacePublicId: z.string().describe("The workspace's public ID"),
      name: z.string().describe("Board name"),
      slug: z
        .string()
        .min(3)
        .max(60)
        .regex(/^(?![-]+$)[a-zA-Z0-9-]+$/)
        .optional()
        .describe("URL-friendly slug (auto-generated if omitted)"),
      visibility: z
        .enum(["public", "private"])
        .optional()
        .describe("Board visibility (default: private)"),
      lists: z.array(z.string().min(1)).default([]),
      labels: z.array(z.string().min(1)).default([]),
      type: z.enum(["regular", "template"]).optional(),
      sourceBoardPublicId: z.string().min(12).optional(),
    },
    async ({
      workspacePublicId,
      name,
      slug,
      visibility,
      lists,
      labels,
      type,
      sourceBoardPublicId,
    }) => {
      const created = await kanRequest<{ publicId: string }>(
        "POST",
        `/workspaces/${workspacePublicId}/boards`,
        {
          name,
          lists,
          labels,
          type,
          sourceBoardPublicId,
        },
      );
      const current = await kanRequest<{
        slug: string;
        visibility: string;
      }>("GET", `/boards/${created.publicId}`);
      const update: Record<string, string> = {};
      if (slug !== undefined && current.slug !== slug) update.slug = slug;
      if (visibility !== undefined && current.visibility !== visibility) {
        update.visibility = visibility;
      }
      if (Object.keys(update).length > 0) {
        await kanRequest("PUT", `/boards/${created.publicId}`, {
          ...update,
        });
      }
      const data = await kanRequest("GET", `/boards/${created.publicId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.tool(
    "update_board",
    "Update a board's name, slug, visibility, or favorite status",
    {
      boardPublicId: z.string().describe("The board's public ID"),
      name: z.string().optional().describe("New board name"),
      slug: z.string().optional().describe("New board slug"),
      visibility: z
        .enum(["public", "private"])
        .optional()
        .describe("New visibility"),
      isFavorite: z
        .boolean()
        .optional()
        .describe("Whether the board is favorited"),
      isArchived: z
        .boolean()
        .optional()
        .describe("Whether the board is archived"),
    },
    async ({
      boardPublicId,
      name,
      slug,
      visibility,
      isFavorite,
      isArchived,
    }) => {
      const data = await kanRequest("PUT", `/boards/${boardPublicId}`, {
        name,
        slug,
        visibility,
        favorite: isFavorite,
        isArchived,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.tool(
    "delete_board",
    "Delete a board (soft delete)",
    { boardPublicId: z.string().describe("The board's public ID") },
    async ({ boardPublicId }) => {
      const data = await kanRequest("DELETE", `/boards/${boardPublicId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.registerTool(
    "check_board_slug_availability",
    {
      description:
        "Check whether a new slug is available for an existing board.",
      inputSchema: {
        boardPublicId: z.string().min(12),
        boardSlug: z
          .string()
          .min(3)
          .max(60)
          .regex(/^(?![-]+$)[a-zA-Z0-9-]+$/),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ boardPublicId, boardSlug }) => {
      const params = new URLSearchParams({ boardSlug });
      const data = await kanRequest(
        "GET",
        `/boards/${boardPublicId}/check-slug-availability?${params.toString()}`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.registerTool(
    "move_board",
    {
      description:
        "Move a board and all of its contents into another workspace.",
      inputSchema: {
        boardPublicId: z.string().min(12),
        targetWorkspacePublicId: z.string().min(12),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ boardPublicId, targetWorkspacePublicId }) => {
      const data = await kanRequest("POST", `/boards/${boardPublicId}/move`, {
        targetWorkspacePublicId,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    },
  );
}
