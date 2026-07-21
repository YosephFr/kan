import { TRPCError } from "@trpc/server";
import { z } from "zod";

import * as pulseRepo from "@kan/db/repository/pulse.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { buildPulseSummary } from "../pulse/metrics";
import { pulseSummarySchema } from "../schemas";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertPermission } from "../utils/permissions";

export const pulseRouter = createTRPCRouter({
  summary: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/workspaces/{workspacePublicId}/pulse",
        summary: "Get workspace flow metrics",
        description:
          "Returns current flow health, throughput, workload, and attention signals for a workspace",
        tags: ["Workspaces"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: z.string().min(12),
        period: z.enum(["week", "month"]),
      }),
    )
    .output(pulseSummarySchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not authenticated",
        });

      const workspace = await workspaceRepo.getByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace || workspace.deletedAt)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
        });

      await assertPermission(ctx.db, userId, workspace.id, "workspace:view");

      const source = await pulseRepo.getSourceByWorkspaceId(
        ctx.db,
        workspace.id,
      );
      if (!source)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Workspace with public ID ${input.workspacePublicId} not found`,
        });

      return buildPulseSummary(source, input.period);
    }),
});
