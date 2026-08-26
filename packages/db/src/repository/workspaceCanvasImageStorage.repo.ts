import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  workspaceCanvasImages,
  workspaceCanvasImageStorageDeletions,
  workspaceCanvasImageUploadSessions,
  workspaces,
} from "@kan/db/schema";

import {
  assertWorkspacePermissionTx,
  lockActiveWorkspaceByPublicId,
} from "./workspace-boundary";
import {
  WORKSPACE_CANVAS_IMAGE_GC_BATCH_SIZE,
  WORKSPACE_CANVAS_UPLOAD_OUTBOX_GRACE_MS,
} from "./workspaceCanvasImage.internal";

export const markWorkspaceCanvasImageStorageDeleted = async (
  db: dbClient,
  s3Keys: string[],
) => {
  if (s3Keys.length === 0) return [];
  const uniqueS3Keys = [...new Set(s3Keys)];
  const now = new Date();
  const images = await db
    .update(workspaceCanvasImages)
    .set({ storageDeletedAt: now })
    .where(
      and(
        inArray(workspaceCanvasImages.s3Key, uniqueS3Keys),
        isNotNull(workspaceCanvasImages.deletedAt),
        isNull(workspaceCanvasImages.storageDeletedAt),
      ),
    )
    .returning({ s3Key: workspaceCanvasImages.s3Key });
  const uploads = await db
    .update(workspaceCanvasImageUploadSessions)
    .set({ storageDeletedAt: now })
    .where(
      and(
        inArray(workspaceCanvasImageUploadSessions.s3Key, uniqueS3Keys),
        isNull(workspaceCanvasImageUploadSessions.storageDeletedAt),
        or(
          isNotNull(workspaceCanvasImageUploadSessions.consumedAt),
          lte(workspaceCanvasImageUploadSessions.expiresAt, now),
        ),
      ),
    )
    .returning({ s3Key: workspaceCanvasImageUploadSessions.s3Key });
  const deletions = await db
    .update(workspaceCanvasImageStorageDeletions)
    .set({ completedAt: now })
    .where(
      and(
        inArray(workspaceCanvasImageStorageDeletions.s3Key, uniqueS3Keys),
        isNull(workspaceCanvasImageStorageDeletions.completedAt),
        lte(workspaceCanvasImageStorageDeletions.availableAt, now),
      ),
    )
    .returning({ s3Key: workspaceCanvasImageStorageDeletions.s3Key });
  return [...images, ...uploads, ...deletions];
};

export const listPendingWorkspaceCanvasStorageDeletionKeys = async (
  db: dbClient,
  limit = WORKSPACE_CANVAS_IMAGE_GC_BATCH_SIZE,
) =>
  db
    .select({ s3Key: workspaceCanvasImageStorageDeletions.s3Key })
    .from(workspaceCanvasImageStorageDeletions)
    .where(
      and(
        isNull(workspaceCanvasImageStorageDeletions.completedAt),
        lte(workspaceCanvasImageStorageDeletions.availableAt, new Date()),
      ),
    )
    .orderBy(
      asc(workspaceCanvasImageStorageDeletions.availableAt),
      asc(workspaceCanvasImageStorageDeletions.createdAt),
      asc(workspaceCanvasImageStorageDeletions.id),
    )
    .limit(limit);

export const enqueueWorkspaceCanvasStorageDeletionKeys = async (
  db: dbClient,
  s3Keys: string[],
  availableAt = new Date(),
) => {
  const uniqueS3Keys = [...new Set(s3Keys)];
  if (uniqueS3Keys.length === 0) return [];
  return db
    .insert(workspaceCanvasImageStorageDeletions)
    .values(uniqueS3Keys.map((s3Key) => ({ s3Key, availableAt })))
    .onConflictDoNothing()
    .returning({ s3Key: workspaceCanvasImageStorageDeletions.s3Key });
};

export const markWorkspaceCanvasStorageDeletionAttempted = async (
  db: dbClient,
  s3Keys: string[],
) => {
  if (s3Keys.length === 0) return [];
  return db
    .update(workspaceCanvasImageStorageDeletions)
    .set({
      attempts: sql`${workspaceCanvasImageStorageDeletions.attempts} + 1`,
      lastAttemptAt: new Date(),
    })
    .where(
      and(
        inArray(workspaceCanvasImageStorageDeletions.s3Key, [
          ...new Set(s3Keys),
        ]),
        isNull(workspaceCanvasImageStorageDeletions.completedAt),
        lte(workspaceCanvasImageStorageDeletions.availableAt, new Date()),
      ),
    )
    .returning({ s3Key: workspaceCanvasImageStorageDeletions.s3Key });
};

export const hardDeleteWorkspaceWithCanvasStorageOutbox = async (
  db: dbClient,
  input: {
    workspacePublicId: string;
    expectedWorkspaceId: number;
    userId: string;
  },
) =>
  db.transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceByPublicId(tx, {
      ...input,
      lock: "update",
    });
    await assertWorkspacePermissionTx(tx, {
      workspaceId: workspace.id,
      userId: input.userId,
      permission: "workspace:delete",
    });
    const images = await tx
      .select({ s3Key: workspaceCanvasImages.s3Key })
      .from(workspaceCanvasImages)
      .where(
        and(
          eq(workspaceCanvasImages.workspaceId, workspace.id),
          isNull(workspaceCanvasImages.storageDeletedAt),
        ),
      );
    const uploads = await tx
      .select({
        s3Key: workspaceCanvasImageUploadSessions.s3Key,
        expiresAt: workspaceCanvasImageUploadSessions.expiresAt,
      })
      .from(workspaceCanvasImageUploadSessions)
      .where(
        and(
          eq(workspaceCanvasImageUploadSessions.workspaceId, workspace.id),
          isNull(workspaceCanvasImageUploadSessions.storageDeletedAt),
        ),
      );
    const now = new Date();
    const deletionItems = [
      ...images.map((image) => ({ s3Key: image.s3Key, availableAt: now })),
      ...uploads.map((upload) => ({
        s3Key: upload.s3Key,
        availableAt: new Date(
          upload.expiresAt.getTime() + WORKSPACE_CANVAS_UPLOAD_OUTBOX_GRACE_MS,
        ),
      })),
    ];
    if (deletionItems.length > 0) {
      await tx
        .insert(workspaceCanvasImageStorageDeletions)
        .values(deletionItems)
        .onConflictDoUpdate({
          target: workspaceCanvasImageStorageDeletions.s3Key,
          set: {
            availableAt: sql`excluded."availableAt"`,
            completedAt: null,
          },
        });
    }
    const s3Keys = deletionItems
      .filter((item) => item.availableAt.getTime() <= now.getTime())
      .map((item) => item.s3Key);
    const [deleted] = await tx
      .delete(workspaces)
      .where(eq(workspaces.id, workspace.id))
      .returning({ id: workspaces.id });
    return { deleted: Boolean(deleted), s3Keys };
  });
