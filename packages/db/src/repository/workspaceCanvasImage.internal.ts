import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
  isNotNull,
  isNull,
  lte,
  notExists,
  or,
  sql,
  sum,
} from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  workspaceCanvases,
  workspaceCanvasImageReferences,
  workspaceCanvasImages,
  workspaceCanvasImageUploadSessions,
  workspaceCanvasRevisions,
  workspaces,
} from "@kan/db/schema";

import { hasWorkspacePermissionTx } from "./workspace-boundary";

export type DbTransaction = Parameters<
  Parameters<dbClient["transaction"]>[0]
>[0];

export const WORKSPACE_CANVAS_IMAGE_SHARED_RETENTION_MS =
  30 * 24 * 60 * 60 * 1000;
const WORKSPACE_CANVAS_IMAGE_PRIVATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const WORKSPACE_CANVAS_IMAGE_GC_BATCH_SIZE = 250;
export const WORKSPACE_CANVAS_UPLOAD_OUTBOX_GRACE_MS = 60 * 1000;
export const MAX_WORKSPACE_CANVAS_STORED_IMAGES = 250;
export const MAX_WORKSPACE_CANVAS_STORED_IMAGE_BYTES = 100 * 1024 * 1024;

export class WorkspaceCanvasImageReferenceError extends Error {
  constructor(
    public readonly code:
      | "IMAGE_REFERENCE_INVALID"
      | "IMAGE_RESOURCE_BUDGET_EXCEEDED",
  ) {
    super(code);
    this.name = "WorkspaceCanvasImageReferenceError";
  }
}

export async function lockEditableWorkspace(
  tx: DbTransaction,
  workspacePublicId: string,
  userId: string,
) {
  const [workspace] = await tx
    .select({ id: workspaces.id, publicId: workspaces.publicId })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.publicId, workspacePublicId),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!workspace) return { status: "not_found" as const };
  if (
    !(await hasWorkspacePermissionTx(tx, {
      workspaceId: workspace.id,
      userId,
      permission: "workspace:edit",
    }))
  ) {
    return { status: "forbidden" as const };
  }
  return { status: "locked" as const, workspace };
}

export const getActorImageUsage = async (
  tx: DbTransaction,
  workspaceId: number,
  userId: string,
) => {
  const referencedByHead = exists(
    tx
      .select({ id: workspaceCanvasImageReferences.id })
      .from(workspaceCanvasImageReferences)
      .where(
        eq(workspaceCanvasImageReferences.imageId, workspaceCanvasImages.id),
      ),
  );
  const [usage] = await tx
    .select({
      count: count(),
      totalBytes: sum(workspaceCanvasImages.size),
    })
    .from(workspaceCanvasImages)
    .where(
      and(
        eq(workspaceCanvasImages.workspaceId, workspaceId),
        isNull(workspaceCanvasImages.deletedAt),
        or(
          referencedByHead,
          and(
            eq(workspaceCanvasImages.createdBy, userId),
            isNull(workspaceCanvasImages.sharedAt),
          ),
        ),
      ),
    );
  return {
    count: usage?.count ?? 0,
    totalBytes: Number(usage?.totalBytes ?? 0),
  };
};

export const getPhysicalImageUsage = async (
  tx: DbTransaction,
  workspaceId: number,
) => {
  const [imageUsage] = await tx
    .select({
      count: count(),
      totalBytes: sum(workspaceCanvasImages.size),
    })
    .from(workspaceCanvasImages)
    .where(
      and(
        eq(workspaceCanvasImages.workspaceId, workspaceId),
        isNull(workspaceCanvasImages.storageDeletedAt),
      ),
    );
  const [uploadUsage] = await tx
    .select({
      count: count(),
      totalBytes: sum(workspaceCanvasImageUploadSessions.size),
    })
    .from(workspaceCanvasImageUploadSessions)
    .where(
      and(
        eq(workspaceCanvasImageUploadSessions.workspaceId, workspaceId),
        isNull(workspaceCanvasImageUploadSessions.storageDeletedAt),
        isNull(workspaceCanvasImageUploadSessions.consumedAt),
      ),
    );
  const [pendingConsumedCleanup] = await tx
    .select({ count: count() })
    .from(workspaceCanvasImageUploadSessions)
    .where(
      and(
        eq(workspaceCanvasImageUploadSessions.workspaceId, workspaceId),
        isNull(workspaceCanvasImageUploadSessions.storageDeletedAt),
        isNotNull(workspaceCanvasImageUploadSessions.consumedAt),
      ),
    );
  return {
    count: (imageUsage?.count ?? 0) + (uploadUsage?.count ?? 0),
    totalBytes:
      Number(imageUsage?.totalBytes ?? 0) +
      Number(uploadUsage?.totalBytes ?? 0),
    pendingConsumedCleanupCount: pendingConsumedCleanup?.count ?? 0,
  };
};

export const hasHeadReference = async (tx: DbTransaction, imageId: number) =>
  Boolean(
    (
      await tx
        .select({ id: workspaceCanvasImageReferences.id })
        .from(workspaceCanvasImageReferences)
        .where(eq(workspaceCanvasImageReferences.imageId, imageId))
        .limit(1)
    )[0],
  );

export const hasRevisionReference = async (
  tx: DbTransaction,
  workspaceId: number,
  imagePublicId: string,
) => {
  const revisionNeedle = JSON.stringify({
    elements: [{ customData: { kanResourcePublicId: imagePublicId } }],
  });
  const revisionLinkNeedle = JSON.stringify({
    elements: [{ link: `kan-resource:${imagePublicId}` }],
  });
  return Boolean(
    (
      await tx
        .select({ id: workspaceCanvasRevisions.id })
        .from(workspaceCanvasRevisions)
        .innerJoin(
          workspaceCanvases,
          and(
            eq(workspaceCanvases.id, workspaceCanvasRevisions.canvasId),
            eq(workspaceCanvases.workspaceId, workspaceId),
          ),
        )
        .where(
          or(
            sql`${workspaceCanvasRevisions.scene} @> ${revisionNeedle}::jsonb`,
            sql`${workspaceCanvasRevisions.scene} @> ${revisionLinkNeedle}::jsonb`,
          ),
        )
        .limit(1)
    )[0],
  );
};

export const reclaimWorkspaceCanvasImagesTx = async (
  tx: DbTransaction,
  input: { workspaceId: number; now?: Date },
) => {
  const now = input.now ?? new Date();
  const sharedRetentionBoundary = new Date(
    now.getTime() - WORKSPACE_CANVAS_IMAGE_SHARED_RETENTION_MS,
  );
  const privateRetentionBoundary = new Date(
    now.getTime() - WORKSPACE_CANVAS_IMAGE_PRIVATE_RETENTION_MS,
  );
  const pendingUploadDeletes = await tx
    .select({ s3Key: workspaceCanvasImageUploadSessions.s3Key })
    .from(workspaceCanvasImageUploadSessions)
    .where(
      and(
        eq(workspaceCanvasImageUploadSessions.workspaceId, input.workspaceId),
        isNull(workspaceCanvasImageUploadSessions.storageDeletedAt),
        or(
          isNotNull(workspaceCanvasImageUploadSessions.consumedAt),
          lte(workspaceCanvasImageUploadSessions.expiresAt, now),
        ),
      ),
    )
    .orderBy(
      asc(workspaceCanvasImageUploadSessions.expiresAt),
      asc(workspaceCanvasImageUploadSessions.id),
    )
    .limit(WORKSPACE_CANVAS_IMAGE_GC_BATCH_SIZE)
    .for("update");
  const pendingImageDeleteLimit =
    WORKSPACE_CANVAS_IMAGE_GC_BATCH_SIZE - pendingUploadDeletes.length;
  const pendingImageDeletes =
    pendingImageDeleteLimit === 0
      ? []
      : await tx
          .select({
            id: workspaceCanvasImages.id,
            s3Key: workspaceCanvasImages.s3Key,
          })
          .from(workspaceCanvasImages)
          .where(
            and(
              eq(workspaceCanvasImages.workspaceId, input.workspaceId),
              isNotNull(workspaceCanvasImages.deletedAt),
              isNull(workspaceCanvasImages.storageDeletedAt),
            ),
          )
          .orderBy(
            asc(workspaceCanvasImages.deletedAt),
            asc(workspaceCanvasImages.id),
          )
          .limit(pendingImageDeleteLimit)
          .for("update");
  const reclaimedS3Keys = [
    ...pendingUploadDeletes.map((upload) => upload.s3Key),
    ...pendingImageDeletes.map((image) => image.s3Key),
  ];
  let lastId = 0;

  while (reclaimedS3Keys.length < WORKSPACE_CANVAS_IMAGE_GC_BATCH_SIZE) {
    const headReferenceQuery = tx
      .select({ id: workspaceCanvasImageReferences.id })
      .from(workspaceCanvasImageReferences)
      .where(
        eq(workspaceCanvasImageReferences.imageId, workspaceCanvasImages.id),
      );
    const candidates = await tx
      .select({
        id: workspaceCanvasImages.id,
        publicId: workspaceCanvasImages.publicId,
        s3Key: workspaceCanvasImages.s3Key,
        sharedAt: workspaceCanvasImages.sharedAt,
      })
      .from(workspaceCanvasImages)
      .where(
        and(
          eq(workspaceCanvasImages.workspaceId, input.workspaceId),
          gt(workspaceCanvasImages.id, lastId),
          isNull(workspaceCanvasImages.deletedAt),
          isNull(workspaceCanvasImages.storageDeletedAt),
          notExists(headReferenceQuery),
          or(
            and(
              isNotNull(workspaceCanvasImages.sharedAt),
              lte(workspaceCanvasImages.sharedAt, sharedRetentionBoundary),
            ),
            and(
              isNull(workspaceCanvasImages.sharedAt),
              lte(workspaceCanvasImages.createdAt, privateRetentionBoundary),
            ),
          ),
        ),
      )
      .orderBy(asc(workspaceCanvasImages.id))
      .limit(WORKSPACE_CANVAS_IMAGE_GC_BATCH_SIZE)
      .for("update");
    if (candidates.length === 0) break;
    lastId = candidates.at(-1)?.id ?? lastId;

    for (const candidate of candidates) {
      if (
        candidate.sharedAt !== null &&
        (await hasRevisionReference(tx, input.workspaceId, candidate.publicId))
      ) {
        continue;
      }
      const [deleted] = await tx
        .update(workspaceCanvasImages)
        .set({ deletedAt: now, deletedBy: null })
        .where(
          and(
            eq(workspaceCanvasImages.id, candidate.id),
            isNull(workspaceCanvasImages.deletedAt),
          ),
        )
        .returning({ id: workspaceCanvasImages.id });
      if (deleted) reclaimedS3Keys.push(candidate.s3Key);
      if (reclaimedS3Keys.length >= WORKSPACE_CANVAS_IMAGE_GC_BATCH_SIZE) break;
    }
  }
  return reclaimedS3Keys;
};

export const withReclaimedS3Keys = <T extends object>(
  result: T,
  reclaimedS3Keys: string[],
): T & { reclaimedS3Keys?: string[] } => ({
  ...result,
  ...(reclaimedS3Keys.length > 0 ? { reclaimedS3Keys } : {}),
});
