import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { dbClient } from "@kan/db/client";
import * as cardSubtaskRepo from "@kan/db/repository/cardSubtask.repo";
import * as resourceRepo from "@kan/db/repository/cardSubtaskResource.repo";

import { cardSubtaskResourceSchema } from "../schemas";
import { protectedProcedure } from "../trpc";
import { findPipelineSubtask, loadCardPipeline } from "../utils/card-pipeline";
import { assertPermission } from "../utils/permissions";

const publicId = z.string().length(12);
interface ResourceProcedureContext {
  db: dbClient;
  user?: { id: string } | null;
}

async function getContext(
  ctx: ResourceProcedureContext,
  subtaskPublicId: string,
) {
  const userId = ctx.user?.id;
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  const context = await cardSubtaskRepo.getSubtaskContextByPublicId(
    ctx.db,
    subtaskPublicId,
  );
  if (!context) throw new TRPCError({ code: "NOT_FOUND" });
  await assertPermission(ctx.db, userId, context.workspaceId, "card:edit");
  return { context, userId };
}

async function getLinkedResource(
  ctx: Pick<ResourceProcedureContext, "db">,
  input: { subtaskPublicId: string; resourcePublicId: string },
  card: { publicId: string; workspaceId: number },
) {
  const pipeline = await loadCardPipeline(ctx, {
    publicId: card.publicId,
    workspaceId: card.workspaceId,
  });
  return findPipelineSubtask(
    pipeline,
    input.subtaskPublicId,
  ).subtask.resources.find(
    (resource) => resource.publicId === input.resourcePublicId,
  );
}

export const cardSubtaskResourceProcedures = {
  linkResource: protectedProcedure
    .meta({
      openapi: {
        summary: "Link a card resource to a subtask",
        method: "POST",
        path: "/subtasks/{subtaskPublicId}/resources",
        tags: ["Card resources"],
        protect: true,
      },
    })
    .input(
      z.object({
        subtaskPublicId: publicId,
        resourcePublicId: publicId,
      }),
    )
    .output(cardSubtaskResourceSchema)
    .mutation(async ({ ctx, input }) => {
      const { context, userId } = await getContext(ctx, input.subtaskPublicId);
      const result = await resourceRepo.linkResource(ctx.db, {
        ...input,
        expectedWorkspaceId: context.workspaceId,
        createdBy: userId,
      });
      if (result.status === "workspace_changed") {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (result.status === "resource_invalid") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Resource not found",
        });
      }
      if (result.status !== "linked" && result.status !== "existing") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subtask not found",
        });
      }
      const resource = await getLinkedResource(ctx, input, {
        publicId: context.cardPublicId,
        workspaceId: context.workspaceId,
      });
      if (!resource) throw new TRPCError({ code: "NOT_FOUND" });
      return resource;
    }),

  unlinkResource: protectedProcedure
    .meta({
      openapi: {
        summary: "Unlink a card resource from a subtask",
        method: "DELETE",
        path: "/subtasks/{subtaskPublicId}/resources/{resourcePublicId}",
        tags: ["Card resources"],
        protect: true,
      },
    })
    .input(
      z.object({
        subtaskPublicId: publicId,
        resourcePublicId: publicId,
      }),
    )
    .output(z.object({ success: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const { context, userId } = await getContext(ctx, input.subtaskPublicId);
      const result = await resourceRepo.unlinkResource(ctx.db, {
        ...input,
        expectedWorkspaceId: context.workspaceId,
        deletedBy: userId,
      });
      if (result.status !== "unlinked") {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { success: true };
    }),
};
