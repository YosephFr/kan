import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { kanRequest } from "../client.js";
import { jsonResult } from "../result.js";

const permissionSchema = z.enum([
  "workspace:view",
  "workspace:edit",
  "workspace:delete",
  "workspace:manage",
  "board:view",
  "board:create",
  "board:edit",
  "board:delete",
  "list:view",
  "list:create",
  "list:edit",
  "list:delete",
  "card:view",
  "card:create",
  "card:edit",
  "card:delete",
  "comment:view",
  "comment:create",
  "comment:edit",
  "comment:delete",
  "member:view",
  "member:invite",
  "member:edit",
  "member:remove",
]);

const workspaceInput = { workspacePublicId: z.string().min(12) };
const memberInput = {
  workspacePublicId: z.string().min(12),
  memberPublicId: z.string().min(12),
};
const roleInput = {
  workspacePublicId: z.string().min(12),
  rolePublicId: z.string().min(12),
};

export function registerPermissionTools(server: McpServer): void {
  server.registerTool(
    "get_my_workspace_permissions",
    {
      description:
        "Get the current user's effective permissions in a workspace.",
      inputSchema: workspaceInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId }) =>
      jsonResult(
        await kanRequest(
          "GET",
          `/workspaces/${workspacePublicId}/permissions/me`,
        ),
      ),
  );

  server.registerTool(
    "get_member_permissions",
    {
      description:
        "Get one member's effective and overridden workspace permissions.",
      inputSchema: memberInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId, memberPublicId }) =>
      jsonResult(
        await kanRequest(
          "GET",
          `/workspaces/${workspacePublicId}/members/${memberPublicId}/permissions`,
        ),
      ),
  );

  server.registerTool(
    "grant_member_permission",
    {
      description:
        "Grant an explicit permission override to a workspace member.",
      inputSchema: { ...memberInput, permission: permissionSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId, memberPublicId, permission }) =>
      jsonResult(
        await kanRequest(
          "POST",
          `/workspaces/${workspacePublicId}/members/${memberPublicId}/permissions/grant`,
          { permission },
        ),
      ),
  );

  server.registerTool(
    "revoke_member_permission",
    {
      description: "Revoke a permission through an explicit member override.",
      inputSchema: { ...memberInput, permission: permissionSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId, memberPublicId, permission }) =>
      jsonResult(
        await kanRequest(
          "POST",
          `/workspaces/${workspacePublicId}/members/${memberPublicId}/permissions/revoke`,
          { permission },
        ),
      ),
  );

  server.registerTool(
    "reset_member_permissions",
    {
      description:
        "Remove one member's permission overrides and return to role defaults.",
      inputSchema: memberInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId, memberPublicId }) =>
      jsonResult(
        await kanRequest(
          "POST",
          `/workspaces/${workspacePublicId}/members/${memberPublicId}/permissions/reset`,
        ),
      ),
  );

  server.registerTool(
    "reset_all_member_permissions",
    {
      description:
        "Remove every member-specific permission override in a workspace.",
      inputSchema: workspaceInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId }) =>
      jsonResult(
        await kanRequest(
          "POST",
          `/workspaces/${workspacePublicId}/members/permissions/reset`,
        ),
      ),
  );

  server.registerTool(
    "list_workspace_roles",
    {
      description: "List the roles available in a workspace.",
      inputSchema: workspaceInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId }) =>
      jsonResult(
        await kanRequest("GET", `/workspaces/${workspacePublicId}/roles`),
      ),
  );

  server.registerTool(
    "get_workspace_role_permissions",
    {
      description:
        "Get the complete permission matrix for all workspace roles.",
      inputSchema: workspaceInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId }) =>
      jsonResult(
        await kanRequest(
          "GET",
          `/workspaces/${workspacePublicId}/roles/permissions`,
        ),
      ),
  );

  server.registerTool(
    "get_role_permissions",
    {
      description: "Get the permission set for one workspace role.",
      inputSchema: roleInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId, rolePublicId }) =>
      jsonResult(
        await kanRequest(
          "GET",
          `/workspaces/${workspacePublicId}/roles/${rolePublicId}/permissions`,
        ),
      ),
  );

  server.registerTool(
    "grant_role_permission",
    {
      description: "Grant a permission to every member using a workspace role.",
      inputSchema: { ...roleInput, permission: permissionSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId, rolePublicId, permission }) =>
      jsonResult(
        await kanRequest(
          "POST",
          `/workspaces/${workspacePublicId}/roles/${rolePublicId}/permissions/grant`,
          { permission },
        ),
      ),
  );

  server.registerTool(
    "revoke_role_permission",
    {
      description:
        "Revoke a permission from every member using a workspace role.",
      inputSchema: { ...roleInput, permission: permissionSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspacePublicId, rolePublicId, permission }) =>
      jsonResult(
        await kanRequest(
          "POST",
          `/workspaces/${workspacePublicId}/roles/${rolePublicId}/permissions/revoke`,
          { permission },
        ),
      ),
  );
}
