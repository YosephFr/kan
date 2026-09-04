import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  WorkspaceChangedError,
  WorkspacePermissionChangedError,
} from "@kan/db/repository/workspace-boundary";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import * as workspaceVisualWallRepo from "@kan/db/repository/workspaceVisualWall.repo";
import { VisualWallError } from "@kan/db/repository/workspaceVisualWall.repo";

import {
  freeformUrlSchema,
  visualWallExpectedVersionSchema,
  visualWallMutationResultSchema,
  visualWallPlacementSchema,
  visualWallPublicIdSchema,
  workspaceVisualWallSnapshotSchema,
} from "../schemas";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertPermission, hasPermission } from "../utils/permissions";

const workspacePublicIdSchema = visualWallPublicIdSchema;

const getWorkspaceOrThrow = async (
  db: Parameters<typeof workspaceRepo.getByPublicId>[0],
  workspacePublicId: string,
) => {
  const workspace = await workspaceRepo.getByPublicId(db, workspacePublicId);
  if (!workspace || workspace.deletedAt !== null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "WORKSPACE_NOT_FOUND" });
  }
  return workspace;
};

const mapError = (error: unknown): never => {
  if (error instanceof TRPCError) throw error;
  if (error instanceof WorkspaceChangedError) {
    throw new TRPCError({ code: "NOT_FOUND", message: "WORKSPACE_NOT_FOUND" });
  }
  if (error instanceof WorkspacePermissionChangedError) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "WORKSPACE_VISUAL_WALL_EDIT_FORBIDDEN",
    });
  }
  if (error instanceof VisualWallError) {
    throw new TRPCError({
      code:
        error.code === "VISUAL_WALL_ITEM_NOT_FOUND"
          ? "NOT_FOUND"
          : error.code === "VISUAL_WALL_ITEM_LIMIT_REACHED"
            ? "PAYLOAD_TOO_LARGE"
            : "BAD_REQUEST",
      message: error.code,
    });
  }
  throw error;
};

const placementFields = visualWallPlacementSchema.shape;

const assertPlacementBounds = (
  placement: z.infer<typeof visualWallPlacementSchema>,
) => {
  if (
    placement.x + placement.width > 1_200 ||
    placement.y + placement.height > 1_000_000
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "VISUAL_WALL_ITEM_OUT_OF_BOUNDS",
    });
  }
};

export const workspaceVisualWallRouter = createTRPCRouter({
  get: protectedProcedure
    .meta({
      openapi: {
        summary: "Get a workspace visual wall",
        method: "GET",
        path: "/workspaces/{workspacePublicId}/visual-wall",
        tags: ["Workspace visual wall"],
        protect: true,
      },
    })
    .input(z.object({ workspacePublicId: workspacePublicIdSchema }))
    .output(workspaceVisualWallSnapshotSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const workspace = await getWorkspaceOrThrow(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, userId, workspace.id, "workspace:view");
      const viewModeEnabled = !(await hasPermission(
        ctx.db,
        userId,
        workspace.id,
        "workspace:edit",
      ));
      try {
        const wall = await workspaceVisualWallRepo.getSnapshot(ctx.db, {
          workspacePublicId: input.workspacePublicId,
          expectedWorkspaceId: workspace.id,
          actorId: userId,
        });
        return wall
          ? {
              exists: true,
              version: wall.version,
              freeformUrl: wall.freeformUrl,
              updatedAt: wall.updatedAt,
              viewModeEnabled,
              items: wall.items.map((item) => ({
                ...item,
                viewUrl: `/api/workspace-canvas-images/${item.imagePublicId}`,
              })),
            }
          : {
              exists: false,
              version: 0,
              freeformUrl: null,
              updatedAt: null,
              viewModeEnabled,
              items: [],
            };
      } catch (error) {
        return mapError(error);
      }
    }),

  addImages: protectedProcedure
    .meta({
      openapi: {
        summary: "Add images to a workspace visual wall",
        method: "POST",
        path: "/workspaces/{workspacePublicId}/visual-wall/images",
        tags: ["Workspace visual wall"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: workspacePublicIdSchema,
        expectedVersion: visualWallExpectedVersionSchema,
        items: z
          .array(
            z.object({
              imagePublicId: visualWallPublicIdSchema,
              ...placementFields,
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .output(visualWallMutationResultSchema)
    .mutation(async ({ ctx, input }) => {
      input.items.forEach(assertPlacementBounds);
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const workspace = await getWorkspaceOrThrow(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, userId, workspace.id, "workspace:edit");
      try {
        return await workspaceVisualWallRepo.addImages(ctx.db, {
          ...input,
          expectedWorkspaceId: workspace.id,
          actorId: userId,
        });
      } catch (error) {
        return mapError(error);
      }
    }),

  updateItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Update a workspace visual wall item",
        method: "PATCH",
        path: "/workspaces/{workspacePublicId}/visual-wall/items/{itemPublicId}",
        tags: ["Workspace visual wall"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: workspacePublicIdSchema,
        itemPublicId: visualWallPublicIdSchema,
        expectedVersion: visualWallExpectedVersionSchema,
        ...placementFields,
      }),
    )
    .output(visualWallMutationResultSchema)
    .mutation(async ({ ctx, input }) => {
      assertPlacementBounds(input);
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const workspace = await getWorkspaceOrThrow(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, userId, workspace.id, "workspace:edit");
      try {
        return await workspaceVisualWallRepo.updateItem(ctx.db, {
          workspacePublicId: input.workspacePublicId,
          itemPublicId: input.itemPublicId,
          expectedVersion: input.expectedVersion,
          expectedWorkspaceId: workspace.id,
          actorId: userId,
          placement: {
            x: input.x,
            y: input.y,
            width: input.width,
            height: input.height,
            zIndex: input.zIndex,
          },
        });
      } catch (error) {
        return mapError(error);
      }
    }),

  removeItem: protectedProcedure
    .meta({
      openapi: {
        summary: "Remove a workspace visual wall item",
        method: "DELETE",
        path: "/workspaces/{workspacePublicId}/visual-wall/items/{itemPublicId}",
        tags: ["Workspace visual wall"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: workspacePublicIdSchema,
        itemPublicId: visualWallPublicIdSchema,
        expectedVersion: visualWallExpectedVersionSchema,
      }),
    )
    .output(visualWallMutationResultSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const workspace = await getWorkspaceOrThrow(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, userId, workspace.id, "workspace:edit");
      try {
        return await workspaceVisualWallRepo.removeItem(ctx.db, {
          ...input,
          expectedWorkspaceId: workspace.id,
          actorId: userId,
        });
      } catch (error) {
        return mapError(error);
      }
    }),

  setFreeformLink: protectedProcedure
    .meta({
      openapi: {
        summary: "Set the workspace Freeform link",
        method: "PUT",
        path: "/workspaces/{workspacePublicId}/visual-wall/freeform",
        tags: ["Workspace visual wall"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: workspacePublicIdSchema,
        expectedVersion: visualWallExpectedVersionSchema,
        freeformUrl: freeformUrlSchema.nullable(),
      }),
    )
    .output(visualWallMutationResultSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const workspace = await getWorkspaceOrThrow(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, userId, workspace.id, "workspace:edit");
      try {
        return await workspaceVisualWallRepo.setFreeformLink(ctx.db, {
          ...input,
          expectedWorkspaceId: workspace.id,
          actorId: userId,
        });
      } catch (error) {
        return mapError(error);
      }
    }),
});
