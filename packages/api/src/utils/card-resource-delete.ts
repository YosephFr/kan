import { TRPCError } from "@trpc/server";

import type { dbClient } from "@kan/db/client";
import * as cardResourceRepo from "@kan/db/repository/cardResource.repo";
import { WorkspacePermissionChangedError } from "@kan/db/repository/workspace-boundary";
import { createLogger } from "@kan/logger";
import { deleteObject } from "@kan/shared/utils";

import { assertPermission } from "./permissions";

const logger = createLogger("card-resource-delete");

export async function deleteCardResource(
  db: dbClient,
  input: {
    userId: string;
    resourcePublicId: string;
    removeReferences: boolean;
  },
) {
  const context = await cardResourceRepo.getContextByPublicId(
    db,
    input.resourcePublicId,
  );
  if (!context) throw new TRPCError({ code: "NOT_FOUND" });
  await assertPermission(db, input.userId, context.workspaceId, "card:edit");
  const result = await cardResourceRepo
    .softDeleteWithWorkspaceGuard(db, {
      resourcePublicId: input.resourcePublicId,
      expectedWorkspaceId: context.workspaceId,
      deletedBy: input.userId,
      removeReferences: input.removeReferences,
    })
    .catch((error: unknown) => {
      if (error instanceof WorkspacePermissionChangedError) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "CARD_RESOURCE_EDIT_FORBIDDEN",
        });
      }
      throw error;
    });
  if (result.status === "in_use") {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        (result.visualWallReferenceCount ?? 0) > 0
          ? "RESOURCE_IN_USE_VISUAL_WALL"
          : (result.canvasReferenceCount ?? 0) > 0
            ? "RESOURCE_IN_USE_LEGACY_CANVAS"
            : "RESOURCE_IN_USE",
    });
  }
  if (result.status !== "deleted") {
    throw new TRPCError({
      code: result.status === "not_found" ? "NOT_FOUND" : "CONFLICT",
      message: "RESOURCE_UNAVAILABLE",
    });
  }

  const bucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
  if (bucket && result.s3Key) {
    try {
      await deleteObject(bucket, result.s3Key);
    } catch (error) {
      logger.warn(
        { error, resourcePublicId: input.resourcePublicId },
        "Failed to delete card resource object",
      );
    }
  }
}
