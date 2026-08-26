import {
  and,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  workspaceCanvasImageReferences,
  workspaceCanvasImages,
  workspaces,
} from "@kan/db/schema";
import {
  MAX_CARD_CANVAS_IMAGE_RESOURCES,
  MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
} from "@kan/shared";

import type { DbTransaction } from "./workspaceCanvasImage.internal";
import {
  assertWorkspacePermissionTx,
  hasWorkspacePermissionTx,
  lockActiveWorkspaceByPublicId,
} from "./workspace-boundary";
import {
  getActorImageUsage,
  getPhysicalImageUsage,
  hasHeadReference,
  hasRevisionReference,
  lockEditableWorkspace,
  MAX_WORKSPACE_CANVAS_STORED_IMAGE_BYTES,
  MAX_WORKSPACE_CANVAS_STORED_IMAGES,
  reclaimWorkspaceCanvasImagesTx,
  withReclaimedS3Keys,
  WORKSPACE_CANVAS_IMAGE_SHARED_RETENTION_MS,
  WorkspaceCanvasImageReferenceError,
} from "./workspaceCanvasImage.internal";

export const listByWorkspacePublicId = async (
  db: dbClient,
  input: {
    workspacePublicId: string;
    expectedWorkspaceId: number;
    userId: string;
    imagePublicIds: string[];
  },
) =>
  db.transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceByPublicId(tx, input);
    await assertWorkspacePermissionTx(tx, {
      workspaceId: workspace.id,
      userId: input.userId,
      permission: "workspace:view",
    });
    const imagePublicIds = [...new Set(input.imagePublicIds)];
    if (imagePublicIds.length > MAX_CARD_CANVAS_IMAGE_RESOURCES) {
      throw new WorkspaceCanvasImageReferenceError(
        "IMAGE_RESOURCE_BUDGET_EXCEEDED",
      );
    }
    if (imagePublicIds.length === 0) return [];
    const canEdit = await hasWorkspacePermissionTx(tx, {
      workspaceId: workspace.id,
      userId: input.userId,
      permission: "workspace:edit",
    });
    const referencedByHead = exists(
      tx
        .select({ id: workspaceCanvasImageReferences.id })
        .from(workspaceCanvasImageReferences)
        .where(
          eq(workspaceCanvasImageReferences.imageId, workspaceCanvasImages.id),
        ),
    );
    return tx
      .select({
        publicId: workspaceCanvasImages.publicId,
        title: workspaceCanvasImages.title,
        originalFilename: workspaceCanvasImages.originalFilename,
        contentType: workspaceCanvasImages.contentType,
        size: workspaceCanvasImages.size,
        createdAt: workspaceCanvasImages.createdAt,
      })
      .from(workspaceCanvasImages)
      .where(
        and(
          eq(workspaceCanvasImages.workspaceId, workspace.id),
          inArray(workspaceCanvasImages.publicId, imagePublicIds),
          isNull(workspaceCanvasImages.deletedAt),
          canEdit
            ? or(
                referencedByHead,
                eq(workspaceCanvasImages.createdBy, input.userId),
                isNotNull(workspaceCanvasImages.sharedAt),
              )
            : referencedByHead,
        ),
      )
      .orderBy(desc(referencedByHead), desc(workspaceCanvasImages.createdAt))
      .limit(MAX_CARD_CANVAS_IMAGE_RESOURCES);
  });

export const softDeleteUnreferenced = async (
  db: dbClient,
  input: {
    imagePublicId: string;
    workspacePublicId: string;
    userId: string;
  },
) =>
  db.transaction(async (tx) => {
    const boundary = await lockEditableWorkspace(
      tx,
      input.workspacePublicId,
      input.userId,
    );
    if (boundary.status !== "locked") return boundary;
    const [image] = await tx
      .select({
        id: workspaceCanvasImages.id,
        s3Key: workspaceCanvasImages.s3Key,
        sharedAt: workspaceCanvasImages.sharedAt,
      })
      .from(workspaceCanvasImages)
      .where(
        and(
          eq(workspaceCanvasImages.publicId, input.imagePublicId),
          eq(workspaceCanvasImages.workspaceId, boundary.workspace.id),
          eq(workspaceCanvasImages.createdBy, input.userId),
          isNull(workspaceCanvasImages.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!image) return { status: "not_found" as const };
    if (await hasHeadReference(tx, image.id)) {
      return { status: "referenced" as const };
    }
    if (
      await hasRevisionReference(tx, boundary.workspace.id, input.imagePublicId)
    ) {
      return { status: "referenced" as const };
    }
    if (
      image.sharedAt !== null &&
      image.sharedAt.getTime() >
        Date.now() - WORKSPACE_CANVAS_IMAGE_SHARED_RETENTION_MS
    ) {
      return { status: "referenced" as const };
    }
    const [deleted] = await tx
      .update(workspaceCanvasImages)
      .set({ deletedAt: new Date(), deletedBy: input.userId })
      .where(
        and(
          eq(workspaceCanvasImages.id, image.id),
          isNull(workspaceCanvasImages.deletedAt),
        ),
      )
      .returning({ publicId: workspaceCanvasImages.publicId });
    return deleted
      ? { status: "deleted" as const, s3Key: image.s3Key }
      : { status: "not_found" as const };
  });

export const hasValidStorageOwnership = (input: {
  s3Key: string;
  workspaceId: number;
  uploadSessionId: number | null;
  uploadSession: {
    id: number;
    workspaceId: number;
    consumedAt: Date | null;
  } | null;
}) =>
  input.uploadSessionId !== null &&
  input.uploadSession !== null &&
  input.uploadSession.id === input.uploadSessionId &&
  input.uploadSession.workspaceId === input.workspaceId &&
  input.uploadSession.consumedAt !== null &&
  /^\.objects\/[a-z0-9]{12}$/.test(input.s3Key);

export const preflightImageImport = async (
  db: dbClient,
  input: { workspacePublicId: string; userId: string },
) =>
  db.transaction(async (tx) => {
    const boundary = await lockEditableWorkspace(
      tx,
      input.workspacePublicId,
      input.userId,
    );
    if (boundary.status !== "locked") return boundary;
    const reclaimedS3Keys = await reclaimWorkspaceCanvasImagesTx(tx, {
      workspaceId: boundary.workspace.id,
    });
    const physicalUsage = await getPhysicalImageUsage(
      tx,
      boundary.workspace.id,
    );
    if (physicalUsage.pendingConsumedCleanupCount > 0) {
      return withReclaimedS3Keys(
        { status: "storage_cleanup" as const },
        reclaimedS3Keys,
      );
    }
    if (physicalUsage.count >= MAX_WORKSPACE_CANVAS_STORED_IMAGES) {
      return withReclaimedS3Keys(
        { status: "storage_limit" as const },
        reclaimedS3Keys,
      );
    }
    if (physicalUsage.totalBytes >= MAX_WORKSPACE_CANVAS_STORED_IMAGE_BYTES) {
      return withReclaimedS3Keys(
        { status: "storage_budget" as const },
        reclaimedS3Keys,
      );
    }
    const usage = await getActorImageUsage(
      tx,
      boundary.workspace.id,
      input.userId,
    );
    if (usage.count >= MAX_CARD_CANVAS_IMAGE_RESOURCES) {
      return withReclaimedS3Keys(
        { status: "image_limit" as const },
        reclaimedS3Keys,
      );
    }
    if (usage.totalBytes >= MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES) {
      return withReclaimedS3Keys(
        { status: "image_budget" as const },
        reclaimedS3Keys,
      );
    }
    return withReclaimedS3Keys(
      { status: "available" as const },
      reclaimedS3Keys,
    );
  });

export const getForView = async (
  db: dbClient,
  input: { imagePublicId: string; userId: string },
) =>
  db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({
        workspaceId: workspaceCanvasImages.workspaceId,
        workspacePublicId: workspaces.publicId,
      })
      .from(workspaceCanvasImages)
      .innerJoin(
        workspaces,
        eq(workspaces.id, workspaceCanvasImages.workspaceId),
      )
      .where(eq(workspaceCanvasImages.publicId, input.imagePublicId))
      .limit(1);
    if (!candidate) return null;
    const workspace = await lockActiveWorkspaceByPublicId(tx, {
      workspacePublicId: candidate.workspacePublicId,
      expectedWorkspaceId: candidate.workspaceId,
    });
    await assertWorkspacePermissionTx(tx, {
      workspaceId: workspace.id,
      userId: input.userId,
      permission: "workspace:view",
    });
    const image = await tx.query.workspaceCanvasImages.findFirst({
      where: and(
        eq(workspaceCanvasImages.publicId, input.imagePublicId),
        eq(workspaceCanvasImages.workspaceId, workspace.id),
        isNull(workspaceCanvasImages.deletedAt),
      ),
      with: {
        workspace: {
          columns: { id: true, publicId: true, deletedAt: true },
        },
        uploadSession: {
          columns: {
            id: true,
            workspaceId: true,
            consumedAt: true,
          },
        },
      },
    });
    if (
      !image ||
      image.workspace.deletedAt ||
      !hasValidStorageOwnership({
        s3Key: image.s3Key,
        workspaceId: image.workspaceId,
        uploadSessionId: image.uploadSessionId,
        uploadSession: image.uploadSession,
      })
    ) {
      return null;
    }
    const [headReference] = await tx
      .select({ id: workspaceCanvasImageReferences.id })
      .from(workspaceCanvasImageReferences)
      .where(eq(workspaceCanvasImageReferences.imageId, image.id))
      .limit(1);
    if (!headReference) {
      const canEdit = await hasWorkspacePermissionTx(tx, {
        workspaceId: workspace.id,
        userId: input.userId,
        permission: "workspace:edit",
      });
      if (
        !canEdit ||
        (image.createdBy !== input.userId && image.sharedAt === null)
      ) {
        return null;
      }
    }
    return image;
  });

export const syncReferences = async (
  tx: DbTransaction,
  input: {
    canvasId: number;
    workspaceId: number;
    actorId: string;
    references: { publicId: string; elementId: string }[];
  },
) => {
  const publicIds = [...new Set(input.references.map((item) => item.publicId))];
  const images =
    publicIds.length === 0
      ? []
      : await tx
          .select({
            id: workspaceCanvasImages.id,
            publicId: workspaceCanvasImages.publicId,
            size: workspaceCanvasImages.size,
            createdBy: workspaceCanvasImages.createdBy,
            sharedAt: workspaceCanvasImages.sharedAt,
          })
          .from(workspaceCanvasImages)
          .where(
            and(
              eq(workspaceCanvasImages.workspaceId, input.workspaceId),
              inArray(workspaceCanvasImages.publicId, publicIds),
              isNull(workspaceCanvasImages.deletedAt),
            ),
          )
          .for("share");
  if (images.length !== publicIds.length) {
    throw new WorkspaceCanvasImageReferenceError("IMAGE_REFERENCE_INVALID");
  }
  const currentReferenceImageIds =
    images.length === 0
      ? new Set<number>()
      : new Set(
          (
            await tx
              .select({ imageId: workspaceCanvasImageReferences.imageId })
              .from(workspaceCanvasImageReferences)
              .where(
                and(
                  eq(workspaceCanvasImageReferences.canvasId, input.canvasId),
                  inArray(
                    workspaceCanvasImageReferences.imageId,
                    images.map((image) => image.id),
                  ),
                ),
              )
          ).map((reference) => reference.imageId),
        );
  if (
    images.some(
      (image) =>
        image.sharedAt === null &&
        image.createdBy !== input.actorId &&
        !currentReferenceImageIds.has(image.id),
    )
  ) {
    throw new WorkspaceCanvasImageReferenceError("IMAGE_REFERENCE_INVALID");
  }
  if (
    images.length > 50 ||
    images.some((image) => image.size > 10 * 1024 * 1024) ||
    images.reduce((total, image) => total + image.size, 0) > 20 * 1024 * 1024
  ) {
    throw new WorkspaceCanvasImageReferenceError(
      "IMAGE_RESOURCE_BUDGET_EXCEEDED",
    );
  }
  const imageByPublicId = new Map(
    images.map((image) => [image.publicId, image.id]),
  );
  if (images.length > 0) {
    await tx
      .update(workspaceCanvasImages)
      .set({
        sharedAt: sql`coalesce(${workspaceCanvasImages.sharedAt}, now())`,
      })
      .where(
        inArray(
          workspaceCanvasImages.id,
          images.map((image) => image.id),
        ),
      );
  }
  await tx
    .delete(workspaceCanvasImageReferences)
    .where(eq(workspaceCanvasImageReferences.canvasId, input.canvasId));
  if (input.references.length > 0) {
    await tx.insert(workspaceCanvasImageReferences).values(
      input.references.map((reference) => {
        const imageId = imageByPublicId.get(reference.publicId);
        if (!imageId) {
          throw new WorkspaceCanvasImageReferenceError(
            "IMAGE_REFERENCE_INVALID",
          );
        }
        return {
          canvasId: input.canvasId,
          elementId: reference.elementId,
          imageId,
        };
      }),
    );
  }
};

export {
  MAX_WORKSPACE_CANVAS_STORED_IMAGE_BYTES,
  MAX_WORKSPACE_CANVAS_STORED_IMAGES,
  reclaimWorkspaceCanvasImagesTx,
  WorkspaceCanvasImageReferenceError,
};
export {
  enqueueWorkspaceCanvasStorageDeletionKeys,
  hardDeleteWorkspaceWithCanvasStorageOutbox,
  listPendingWorkspaceCanvasStorageDeletionKeys,
  markWorkspaceCanvasImageStorageDeleted,
  markWorkspaceCanvasStorageDeletionAttempted,
} from "./workspaceCanvasImageStorage.repo";
export {
  claimUploadSession,
  consumeUploadSession,
  createUploadSession,
  deleteUnissuedUploadSession,
  releaseUploadSessionClaim,
} from "./workspaceCanvasImageUpload.repo";
