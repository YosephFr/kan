import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  WorkspaceChangedError,
  WorkspacePermissionChangedError,
} from "@kan/db/repository/workspace-boundary";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import * as workspaceCanvasRepo from "@kan/db/repository/workspaceCanvas.repo";
import { WorkspaceCanvasPolicyError } from "@kan/db/repository/workspaceCanvas.repo";
import * as workspaceCanvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";
import { WorkspaceCanvasImageReferenceError } from "@kan/db/repository/workspaceCanvasImage.repo";
import {
  CardCanvasSceneError,
  MAX_WORKSPACE_CANVAS_IMAGE_LIST_BATCH,
} from "@kan/shared";
import { putObject } from "@kan/shared/utils";

import {
  workspaceCanvasCasResultSchema,
  workspaceCanvasImageListSchema,
  workspaceCanvasImageSchema,
  workspaceCanvasImageUploadFieldsSchema,
  workspaceCanvasImageUploadRequestSchema,
  workspaceCanvasImageUploadSessionSchema,
  workspaceCanvasPublicIdSchema,
  workspaceCanvasRevisionSchema,
  workspaceCanvasSnapshotSchema,
} from "../schemas";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  fetchRemoteCardImage,
  importRemoteCardImage,
} from "../utils/card-resource-remote-image";
import { assertPermission, hasPermission } from "../utils/permissions";
import { SafePreviewError } from "../utils/safe-preview-types";
import {
  consumeWorkspaceCanvasImageRateLimit,
  consumeWorkspaceCanvasImageUploadRateLimit,
  WorkspaceCanvasImageRateLimitError,
} from "../utils/workspace-canvas-image-rate-limit";
import {
  confirmWorkspaceCanvasImageUpload,
  createWorkspaceCanvasImageUpload,
  deleteReclaimedWorkspaceCanvasImageObjects,
  mapWorkspaceCanvasImage,
} from "../utils/workspace-canvas-image-upload";

const expectedVersionSchema = z.number().int().min(0).max(2_147_483_647);
const workspaceImageUploadInputSchema =
  workspaceCanvasImageUploadFieldsSchema.extend({
    workspacePublicId: workspaceCanvasPublicIdSchema,
  });

async function getWorkspaceOrThrow(
  db: Parameters<typeof workspaceRepo.getByPublicId>[0],
  workspacePublicId: string,
) {
  const workspace = await workspaceRepo.getByPublicId(db, workspacePublicId);
  if (!workspace || workspace.deletedAt !== null) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "WORKSPACE_NOT_FOUND",
    });
  }
  return workspace;
}

function mapCanvasError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof WorkspaceChangedError) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "WORKSPACE_NOT_FOUND",
    });
  }
  if (error instanceof WorkspacePermissionChangedError) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "WORKSPACE_CANVAS_EDIT_FORBIDDEN",
    });
  }
  if (error instanceof CardCanvasSceneError) {
    const oversized =
      error.code === "SCENE_TOO_LARGE" || error.code === "TOO_MANY_ELEMENTS";
    throw new TRPCError({
      code: oversized ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
      message: error.code,
    });
  }
  if (error instanceof WorkspaceCanvasPolicyError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.code });
  }
  if (error instanceof WorkspaceCanvasImageReferenceError) {
    throw new TRPCError({
      code:
        error.code === "IMAGE_RESOURCE_BUDGET_EXCEEDED"
          ? "PAYLOAD_TOO_LARGE"
          : "BAD_REQUEST",
      message: error.code,
    });
  }
  throw error;
}

function throwRemoteImageError(error: unknown): never {
  if (error instanceof WorkspaceCanvasImageRateLimitError) {
    throw new TRPCError({
      code:
        error.code === "LIMIT_EXCEEDED"
          ? "TOO_MANY_REQUESTS"
          : "SERVICE_UNAVAILABLE",
      message:
        error.code === "LIMIT_EXCEEDED"
          ? "WORKSPACE_CANVAS_IMAGE_RATE_LIMIT_REACHED"
          : "WORKSPACE_CANVAS_IMAGE_IMPORT_UNAVAILABLE",
    });
  }
  if (error instanceof SafePreviewError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "WORKSPACE_CANVAS_REMOTE_IMAGE_INVALID",
    });
  }
  if (error instanceof TRPCError) {
    if (
      error.code === "UNAUTHORIZED" ||
      error.code === "FORBIDDEN" ||
      error.code === "NOT_FOUND" ||
      error.code === "PRECONDITION_FAILED" ||
      error.code === "TOO_MANY_REQUESTS"
    ) {
      throw error;
    }
    if (error.code === "BAD_REQUEST") {
      if (error.message === "WORKSPACE_CANVAS_IMAGE_DIMENSIONS_INVALID") {
        throw error;
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "WORKSPACE_CANVAS_REMOTE_IMAGE_INVALID",
      });
    }
    if (error.code === "CONFLICT") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "WORKSPACE_CANVAS_IMAGE_IMPORT_CONFLICT",
      });
    }
    if (
      error.code === "UNPROCESSABLE_CONTENT" &&
      error.message === "WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_FAILED"
    ) {
      throw error;
    }
    if (
      error.code === "SERVICE_UNAVAILABLE" &&
      error.message === "WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_BUSY"
    ) {
      throw error;
    }
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "WORKSPACE_CANVAS_IMAGE_IMPORT_FAILED",
  });
}

async function consumeImageUploadRateLimit(
  userId: string,
  workspacePublicId: string,
) {
  try {
    await consumeWorkspaceCanvasImageUploadRateLimit(userId, workspacePublicId);
  } catch (error) {
    if (!(error instanceof WorkspaceCanvasImageRateLimitError)) throw error;
    throw new TRPCError({
      code:
        error.code === "LIMIT_EXCEEDED"
          ? "TOO_MANY_REQUESTS"
          : "SERVICE_UNAVAILABLE",
      message:
        error.code === "LIMIT_EXCEEDED"
          ? "WORKSPACE_CANVAS_UPLOAD_RATE_LIMIT_REACHED"
          : "WORKSPACE_CANVAS_UPLOAD_UNAVAILABLE",
    });
  }
}

export const workspaceCanvasRouter = createTRPCRouter({
  get: protectedProcedure
    .meta({
      openapi: {
        summary: "Get a workspace canvas",
        method: "GET",
        path: "/workspaces/{workspacePublicId}/canvas",
        tags: ["Workspace canvas"],
        protect: true,
      },
    })
    .input(z.object({ workspacePublicId: workspaceCanvasPublicIdSchema }))
    .output(workspaceCanvasSnapshotSchema)
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
        const head = await workspaceCanvasRepo.getSnapshot(ctx.db, {
          workspacePublicId: input.workspacePublicId,
          expectedWorkspaceId: workspace.id,
          actorId: userId,
        });
        return head
          ? {
              exists: true,
              version: head.version,
              scene: head.scene,
              hash: head.hash,
              bytes: head.bytes,
              elementCount: head.elementCount,
              updatedAt: head.updatedAt,
              viewModeEnabled,
            }
          : {
              exists: false,
              version: 0,
              scene: null,
              hash: null,
              bytes: 0,
              elementCount: 0,
              updatedAt: null,
              viewModeEnabled,
            };
      } catch (error) {
        mapCanvasError(error);
      }
    }),

  save: protectedProcedure
    .meta({
      openapi: {
        summary: "Save a workspace canvas",
        method: "PUT",
        path: "/workspaces/{workspacePublicId}/canvas",
        tags: ["Workspace canvas"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: workspaceCanvasPublicIdSchema,
        expectedVersion: expectedVersionSchema,
        scene: z.unknown(),
      }),
    )
    .output(workspaceCanvasCasResultSchema)
    .mutation(() => {
      throw new TRPCError({
        code: "CONFLICT",
        message: "CANVAS_LEGACY_READ_ONLY",
      });
    }),

  listImages: protectedProcedure
    .meta({
      openapi: {
        summary: "List workspace canvas images",
        method: "GET",
        path: "/workspaces/{workspacePublicId}/canvas/images",
        tags: ["Workspace canvas"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: workspaceCanvasPublicIdSchema,
        imagePublicIds: z
          .array(workspaceCanvasPublicIdSchema)
          .max(MAX_WORKSPACE_CANVAS_IMAGE_LIST_BATCH),
      }),
    )
    .output(workspaceCanvasImageListSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const workspace = await getWorkspaceOrThrow(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, userId, workspace.id, "workspace:view");
      try {
        const result = await workspaceCanvasImageRepo.listByWorkspacePublicId(
          ctx.db,
          {
            workspacePublicId: input.workspacePublicId,
            expectedWorkspaceId: workspace.id,
            userId,
            imagePublicIds: input.imagePublicIds,
          },
        );
        return {
          images: result.images.map(mapWorkspaceCanvasImage),
          usageBytes: result.usageBytes,
          quotaBytes: result.quotaBytes,
        };
      } catch (error) {
        mapCanvasError(error);
      }
    }),

  createImageUpload: protectedProcedure
    .meta({
      openapi: {
        summary: "Create a workspace canvas image upload",
        method: "POST",
        path: "/workspaces/{workspacePublicId}/canvas/images/upload",
        tags: ["Workspace canvas"],
        protect: true,
      },
    })
    .input(workspaceImageUploadInputSchema)
    .output(workspaceCanvasImageUploadSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const workspace = await getWorkspaceOrThrow(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, userId, workspace.id, "workspace:edit");
      await consumeImageUploadRateLimit(userId, input.workspacePublicId);
      const upload = workspaceCanvasImageUploadRequestSchema.parse(input);
      return createWorkspaceCanvasImageUpload(ctx.db, {
        workspacePublicId: input.workspacePublicId,
        ...upload,
        userId,
      });
    }),

  confirmImageUpload: protectedProcedure
    .meta({
      openapi: {
        summary: "Confirm a workspace canvas image upload",
        method: "POST",
        path: "/workspaces/{workspacePublicId}/canvas/images/confirm",
        tags: ["Workspace canvas"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: workspaceCanvasPublicIdSchema,
        uploadSessionPublicId: workspaceCanvasPublicIdSchema,
      }),
    )
    .output(workspaceCanvasImageSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const workspace = await getWorkspaceOrThrow(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, userId, workspace.id, "workspace:edit");
      await consumeImageUploadRateLimit(userId, input.workspacePublicId);
      return mapWorkspaceCanvasImage(
        await confirmWorkspaceCanvasImageUpload(ctx.db, {
          ...input,
          userId,
        }),
      );
    }),

  importRemoteImage: protectedProcedure
    .meta({
      openapi: {
        summary: "Import a remote workspace canvas image",
        method: "POST",
        path: "/workspaces/{workspacePublicId}/canvas/images/remote",
        tags: ["Workspace canvas"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: workspaceCanvasPublicIdSchema,
        url: z.string().min(1).max(2048),
      }),
    )
    .output(workspaceCanvasImageSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const workspace = await getWorkspaceOrThrow(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, userId, workspace.id, "workspace:edit");
      try {
        await consumeWorkspaceCanvasImageRateLimit(
          userId,
          input.workspacePublicId,
        );
        const capacity = await workspaceCanvasImageRepo.preflightImageImport(
          ctx.db,
          { workspacePublicId: input.workspacePublicId, userId },
        );
        if ("reclaimedS3Keys" in capacity) {
          await deleteReclaimedWorkspaceCanvasImageObjects(
            ctx.db,
            capacity.reclaimedS3Keys ?? [],
          );
        }
        if (capacity.status === "not_found") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "WORKSPACE_NOT_FOUND",
          });
        }
        if (capacity.status === "forbidden") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "WORKSPACE_CANVAS_EDIT_FORBIDDEN",
          });
        }
        if (capacity.status === "image_budget") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "WORKSPACE_CANVAS_IMAGE_TOTAL_LIMIT_REACHED",
          });
        }
        if (capacity.status === "storage_budget") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "WORKSPACE_CANVAS_IMAGE_STORAGE_LIMIT_REACHED",
          });
        }
        const bucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
        if (!bucket) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "WORKSPACE_CANVAS_IMAGE_IMPORT_FAILED",
          });
        }
        let confirmedImage:
          | Awaited<ReturnType<typeof confirmWorkspaceCanvasImageUpload>>
          | undefined;
        await importRemoteCardImage(input.url, {
          fetchImage: fetchRemoteCardImage,
          createUpload: async (upload) =>
            await createWorkspaceCanvasImageUpload(ctx.db, {
              workspacePublicId: input.workspacePublicId,
              userId,
              ...upload,
            }),
          writeStagingObject: async ({ key, bytes, contentType }) => {
            await putObject({ bucket, key, body: bytes, contentType });
          },
          confirmUpload: async (uploadSessionPublicId) => {
            confirmedImage = await confirmWorkspaceCanvasImageUpload(ctx.db, {
              workspacePublicId: input.workspacePublicId,
              userId,
              uploadSessionPublicId,
            });
            return confirmedImage;
          },
          discardUpload: async ({ uploadSessionPublicId, stagingKey }) => {
            await workspaceCanvasImageRepo.deleteUnissuedUploadSession(ctx.db, {
              publicId: uploadSessionPublicId,
              workspacePublicId: input.workspacePublicId,
              userId,
            });
            await deleteReclaimedWorkspaceCanvasImageObjects(ctx.db, [
              stagingKey,
            ]);
          },
        });
        if (!confirmedImage) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "WORKSPACE_CANVAS_IMAGE_IMPORT_FAILED",
          });
        }
        return mapWorkspaceCanvasImage(confirmedImage);
      } catch (error) {
        throwRemoteImageError(error);
      }
    }),

  deleteImage: protectedProcedure
    .meta({
      openapi: {
        summary: "Delete an unreferenced workspace canvas image",
        method: "DELETE",
        path: "/workspaces/{workspacePublicId}/canvas/images/{imagePublicId}",
        tags: ["Workspace canvas"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: workspaceCanvasPublicIdSchema,
        imagePublicId: workspaceCanvasPublicIdSchema,
      }),
    )
    .output(z.object({ success: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const workspace = await getWorkspaceOrThrow(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, userId, workspace.id, "workspace:edit");
      const bucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
      if (!bucket) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "WORKSPACE_IMAGE_STORAGE_UNAVAILABLE",
        });
      }
      const result = await workspaceCanvasImageRepo.softDeleteUnreferenced(
        ctx.db,
        { ...input, userId },
      );
      if (result.status === "forbidden") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "WORKSPACE_CANVAS_EDIT_FORBIDDEN",
        });
      }
      if (result.status === "not_found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "WORKSPACE_CANVAS_IMAGE_NOT_FOUND",
        });
      }
      if (result.status === "referenced") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "WORKSPACE_CANVAS_IMAGE_STILL_REFERENCED",
        });
      }
      await deleteReclaimedWorkspaceCanvasImageObjects(ctx.db, [result.s3Key]);
      return { success: true as const };
    }),

  listRevisions: protectedProcedure
    .meta({
      openapi: {
        summary: "List workspace canvas revisions",
        method: "GET",
        path: "/workspaces/{workspacePublicId}/canvas/revisions",
        tags: ["Workspace canvas"],
        protect: true,
      },
    })
    .input(z.object({ workspacePublicId: workspaceCanvasPublicIdSchema }))
    .output(z.array(workspaceCanvasRevisionSchema))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      const workspace = await getWorkspaceOrThrow(
        ctx.db,
        input.workspacePublicId,
      );
      await assertPermission(ctx.db, userId, workspace.id, "workspace:edit");
      try {
        return await workspaceCanvasRepo.listRevisions(ctx.db, {
          workspacePublicId: input.workspacePublicId,
          expectedWorkspaceId: workspace.id,
          actorId: userId,
        });
      } catch (error) {
        mapCanvasError(error);
      }
    }),

  restore: protectedProcedure
    .meta({
      openapi: {
        summary: "Restore a workspace canvas revision",
        method: "POST",
        path: "/workspaces/{workspacePublicId}/canvas/restore",
        tags: ["Workspace canvas"],
        protect: true,
      },
    })
    .input(
      z.object({
        workspacePublicId: workspaceCanvasPublicIdSchema,
        revisionPublicId: workspaceCanvasPublicIdSchema,
        expectedVersion: expectedVersionSchema,
      }),
    )
    .output(workspaceCanvasCasResultSchema)
    .mutation(() => {
      throw new TRPCError({
        code: "CONFLICT",
        message: "CANVAS_LEGACY_READ_ONLY",
      });
    }),
});
