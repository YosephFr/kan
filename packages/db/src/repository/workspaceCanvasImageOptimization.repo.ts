import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  workspaceCanvasImages,
  workspaceCanvasImageStorageDeletions,
  workspaces,
} from "@kan/db/schema";
import {
  hasWorkspaceCanvasPhysicalCapacity,
  MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES,
} from "@kan/shared";

import {
  lockActiveWorkspaceByPublicId,
  WorkspaceChangedError,
} from "./workspace-boundary";
import {
  getPhysicalImageUsage,
  isValidOptimizedWorkspaceCanvasImage,
  reclaimWorkspaceCanvasImagesTx,
  withReclaimedS3Keys,
  WORKSPACE_CANVAS_IMAGE_REPLACEMENT_GRACE_MS,
} from "./workspaceCanvasImage.internal";

const MAX_OPTIMIZATION_BATCH_SIZE = 100;
const WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_RESERVATION_MS = 15 * 60 * 1000;

export const claimWorkspaceCanvasImageOptimizationBatch = async (
  db: dbClient,
  input: {
    afterId?: number;
    limit?: number;
    workspacePublicId?: string;
  } = {},
) => {
  const afterId = Math.max(0, input.afterId ?? 0);
  const limit = Math.max(
    1,
    Math.min(input.limit ?? 25, MAX_OPTIMIZATION_BATCH_SIZE),
  );
  return db.transaction((tx) =>
    tx
      .select({
        id: workspaceCanvasImages.id,
        publicId: workspaceCanvasImages.publicId,
        workspaceId: workspaceCanvasImages.workspaceId,
        workspacePublicId: workspaces.publicId,
        s3Key: workspaceCanvasImages.s3Key,
        contentType: workspaceCanvasImages.contentType,
        size: workspaceCanvasImages.size,
        sha256: workspaceCanvasImages.sha256,
      })
      .from(workspaceCanvasImages)
      .innerJoin(
        workspaces,
        and(
          eq(workspaces.id, workspaceCanvasImages.workspaceId),
          isNull(workspaces.deletedAt),
        ),
      )
      .where(
        and(
          gt(workspaceCanvasImages.id, afterId),
          input.workspacePublicId
            ? eq(workspaces.publicId, input.workspacePublicId)
            : undefined,
          isNull(workspaceCanvasImages.optimizedAt),
          isNull(workspaceCanvasImages.deletedAt),
          isNull(workspaceCanvasImages.storageDeletedAt),
        ),
      )
      .orderBy(asc(workspaceCanvasImages.id))
      .limit(limit)
      .for("update", { skipLocked: true }),
  );
};

export const reserveWorkspaceCanvasImageOptimizationObject = async (
  db: dbClient,
  input: {
    imageId: number;
    imagePublicId: string;
    workspaceId: number;
    workspacePublicId: string;
    expectedS3Key: string;
    expectedSha256: string;
    finalS3Key: string;
    finalContentType: "image/webp";
    finalSize: number;
    finalSha256: string;
    width: number;
    height: number;
    optimizedAt: Date;
  },
) =>
  db.transaction(async (tx) => {
    if (
      !/^\.objects\/[a-z0-9]{12}$/.test(input.finalS3Key) ||
      input.finalS3Key === input.expectedS3Key ||
      !isValidOptimizedWorkspaceCanvasImage({
        contentType: input.finalContentType,
        size: input.finalSize,
        sha256: input.finalSha256,
        width: input.width,
        height: input.height,
        optimizedAt: input.optimizedAt,
      })
    ) {
      return { status: "invalid_optimized_image" as const };
    }
    try {
      await lockActiveWorkspaceByPublicId(tx, {
        workspacePublicId: input.workspacePublicId,
        expectedWorkspaceId: input.workspaceId,
        lock: "update",
      });
    } catch (error) {
      if (!(error instanceof WorkspaceChangedError)) throw error;
      return { status: "stale" as const };
    }
    const now = new Date();
    const reclaimedS3Keys = await reclaimWorkspaceCanvasImagesTx(tx, {
      workspaceId: input.workspaceId,
      now,
    });
    const [image] = await tx
      .select({ id: workspaceCanvasImages.id })
      .from(workspaceCanvasImages)
      .where(
        and(
          eq(workspaceCanvasImages.id, input.imageId),
          eq(workspaceCanvasImages.publicId, input.imagePublicId),
          eq(workspaceCanvasImages.workspaceId, input.workspaceId),
          eq(workspaceCanvasImages.s3Key, input.expectedS3Key),
          eq(workspaceCanvasImages.sha256, input.expectedSha256),
          isNull(workspaceCanvasImages.optimizedAt),
          isNull(workspaceCanvasImages.deletedAt),
          isNull(workspaceCanvasImages.storageDeletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!image) {
      return withReclaimedS3Keys({ status: "stale" as const }, reclaimedS3Keys);
    }
    const physicalUsage = await getPhysicalImageUsage(
      tx,
      input.workspaceId,
      now,
    );
    if (
      !hasWorkspaceCanvasPhysicalCapacity(
        physicalUsage.totalBytes,
        input.finalSize,
      )
    ) {
      return withReclaimedS3Keys(
        { status: "storage_budget" as const },
        reclaimedS3Keys,
      );
    }
    const [reservation] = await tx
      .insert(workspaceCanvasImageStorageDeletions)
      .values({
        s3Key: input.finalS3Key,
        workspaceId: input.workspaceId,
        size: input.finalSize,
        availableAt: new Date(
          now.getTime() + WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_RESERVATION_MS,
        ),
      })
      .onConflictDoNothing()
      .returning({ s3Key: workspaceCanvasImageStorageDeletions.s3Key });
    return reservation
      ? withReclaimedS3Keys(
          { status: "reserved" as const, reservation },
          reclaimedS3Keys,
        )
      : withReclaimedS3Keys(
          { status: "unavailable" as const },
          reclaimedS3Keys,
        );
  });

export const completeWorkspaceCanvasImageOptimization = async (
  db: dbClient,
  input: {
    imageId: number;
    imagePublicId: string;
    workspaceId: number;
    workspacePublicId: string;
    expectedS3Key: string;
    expectedSha256: string;
    finalS3Key: string;
    finalContentType: "image/webp";
    finalSize: number;
    finalSha256: string;
    width: number;
    height: number;
    optimizedAt: Date;
  },
) =>
  db.transaction(async (tx) => {
    if (
      !/^\.objects\/[a-z0-9]{12}$/.test(input.finalS3Key) ||
      input.finalS3Key === input.expectedS3Key ||
      !isValidOptimizedWorkspaceCanvasImage({
        contentType: input.finalContentType,
        size: input.finalSize,
        sha256: input.finalSha256,
        width: input.width,
        height: input.height,
        optimizedAt: input.optimizedAt,
      })
    ) {
      return {
        status: "invalid_optimized_image" as const,
        reclaimedS3Keys: [input.finalS3Key],
      };
    }
    try {
      await lockActiveWorkspaceByPublicId(tx, {
        workspacePublicId: input.workspacePublicId,
        expectedWorkspaceId: input.workspaceId,
        lock: "update",
      });
    } catch (error) {
      if (!(error instanceof WorkspaceChangedError)) throw error;
      return {
        status: "stale" as const,
        reclaimedS3Keys: [input.finalS3Key],
      };
    }
    const [image] = await tx
      .select({
        id: workspaceCanvasImages.id,
        size: workspaceCanvasImages.size,
      })
      .from(workspaceCanvasImages)
      .where(
        and(
          eq(workspaceCanvasImages.id, input.imageId),
          eq(workspaceCanvasImages.publicId, input.imagePublicId),
          eq(workspaceCanvasImages.workspaceId, input.workspaceId),
          eq(workspaceCanvasImages.s3Key, input.expectedS3Key),
          eq(workspaceCanvasImages.sha256, input.expectedSha256),
          isNull(workspaceCanvasImages.optimizedAt),
          isNull(workspaceCanvasImages.deletedAt),
          isNull(workspaceCanvasImages.storageDeletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!image) {
      return {
        status: "stale" as const,
        reclaimedS3Keys: [input.finalS3Key],
      };
    }
    const [reservation] = await tx
      .select({ id: workspaceCanvasImageStorageDeletions.id })
      .from(workspaceCanvasImageStorageDeletions)
      .where(
        and(
          eq(workspaceCanvasImageStorageDeletions.s3Key, input.finalS3Key),
          eq(
            workspaceCanvasImageStorageDeletions.workspaceId,
            input.workspaceId,
          ),
          eq(workspaceCanvasImageStorageDeletions.size, input.finalSize),
          isNull(workspaceCanvasImageStorageDeletions.completedAt),
          gt(workspaceCanvasImageStorageDeletions.availableAt, new Date()),
        ),
      )
      .limit(1)
      .for("update");
    if (!reservation) {
      return {
        status: "invalid_optimized_image" as const,
        reclaimedS3Keys: [input.finalS3Key],
      };
    }
    const physicalUsage = await getPhysicalImageUsage(tx, input.workspaceId);
    if (physicalUsage.totalBytes > MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES) {
      return {
        status: "storage_budget" as const,
        reclaimedS3Keys: [input.finalS3Key],
      };
    }
    const [updated] = await tx
      .update(workspaceCanvasImages)
      .set({
        contentType: input.finalContentType,
        size: input.finalSize,
        width: input.width,
        height: input.height,
        optimizedAt: input.optimizedAt,
        s3Key: input.finalS3Key,
        sha256: input.finalSha256.toLowerCase(),
      })
      .where(
        and(
          eq(workspaceCanvasImages.id, input.imageId),
          eq(workspaceCanvasImages.s3Key, input.expectedS3Key),
          eq(workspaceCanvasImages.sha256, input.expectedSha256),
          isNull(workspaceCanvasImages.optimizedAt),
          isNull(workspaceCanvasImages.deletedAt),
          isNull(workspaceCanvasImages.storageDeletedAt),
        ),
      )
      .returning({ publicId: workspaceCanvasImages.publicId });
    if (!updated) {
      return {
        status: "stale" as const,
        reclaimedS3Keys: [input.finalS3Key],
      };
    }
    const now = new Date();
    await tx
      .insert(workspaceCanvasImageStorageDeletions)
      .values({
        s3Key: input.finalS3Key,
        workspaceId: input.workspaceId,
        size: input.finalSize,
        availableAt: now,
        completedAt: now,
      })
      .onConflictDoUpdate({
        target: workspaceCanvasImageStorageDeletions.s3Key,
        set: { completedAt: now },
      });
    await tx
      .insert(workspaceCanvasImageStorageDeletions)
      .values({
        s3Key: input.expectedS3Key,
        workspaceId: input.workspaceId,
        size: image.size,
        availableAt: new Date(
          now.getTime() + WORKSPACE_CANVAS_IMAGE_REPLACEMENT_GRACE_MS,
        ),
      })
      .onConflictDoUpdate({
        target: workspaceCanvasImageStorageDeletions.s3Key,
        set: {
          availableAt: sql`excluded."availableAt"`,
          workspaceId: sql`excluded."workspaceId"`,
          size: sql`excluded."size"`,
          completedAt: null,
        },
      });
    return {
      status: "completed" as const,
      image: updated,
      reclaimedS3Keys: [],
    };
  });

export const reconcileWorkspaceCanvasImageOptimization = async (
  db: dbClient,
  input: {
    imageId: number;
    imagePublicId: string;
    workspaceId: number;
    workspacePublicId: string;
    expectedS3Key: string;
    finalS3Key: string;
    finalContentType: "image/webp";
    finalSize: number;
    finalSha256: string;
    width: number;
    height: number;
    optimizedAt: Date;
  },
) =>
  db.transaction(async (tx) => {
    const now = new Date();
    if (
      !/^\.objects\/[a-z0-9]{12}$/.test(input.finalS3Key) ||
      input.finalS3Key === input.expectedS3Key ||
      !isValidOptimizedWorkspaceCanvasImage({
        contentType: input.finalContentType,
        size: input.finalSize,
        sha256: input.finalSha256,
        width: input.width,
        height: input.height,
        optimizedAt: input.optimizedAt,
      })
    ) {
      return { status: "inconsistent" as const, reclaimedS3Keys: [] };
    }
    try {
      await lockActiveWorkspaceByPublicId(tx, {
        workspacePublicId: input.workspacePublicId,
        expectedWorkspaceId: input.workspaceId,
        lock: "update",
      });
    } catch (error) {
      if (!(error instanceof WorkspaceChangedError)) throw error;
      await tx
        .insert(workspaceCanvasImageStorageDeletions)
        .values({
          s3Key: input.finalS3Key,
          size: input.finalSize,
          availableAt: now,
        })
        .onConflictDoUpdate({
          target: workspaceCanvasImageStorageDeletions.s3Key,
          set: {
            size: input.finalSize,
            availableAt: now,
            completedAt: null,
          },
        });
      return {
        status: "not_persisted" as const,
        reclaimedS3Keys: [input.finalS3Key],
      };
    }
    const [image] = await tx
      .select({
        publicId: workspaceCanvasImages.publicId,
        s3Key: workspaceCanvasImages.s3Key,
        contentType: workspaceCanvasImages.contentType,
        size: workspaceCanvasImages.size,
        sha256: workspaceCanvasImages.sha256,
        width: workspaceCanvasImages.width,
        height: workspaceCanvasImages.height,
        optimizedAt: workspaceCanvasImages.optimizedAt,
      })
      .from(workspaceCanvasImages)
      .where(
        and(
          eq(workspaceCanvasImages.id, input.imageId),
          eq(workspaceCanvasImages.publicId, input.imagePublicId),
          eq(workspaceCanvasImages.workspaceId, input.workspaceId),
        ),
      )
      .limit(1)
      .for("update");
    if (image?.s3Key === input.finalS3Key) {
      await tx
        .insert(workspaceCanvasImageStorageDeletions)
        .values({
          s3Key: input.finalS3Key,
          workspaceId: input.workspaceId,
          size: input.finalSize,
          availableAt: now,
          completedAt: now,
        })
        .onConflictDoUpdate({
          target: workspaceCanvasImageStorageDeletions.s3Key,
          set: {
            workspaceId: input.workspaceId,
            size: input.finalSize,
            completedAt: now,
          },
        });
      const matchesFinalState =
        image.contentType === input.finalContentType &&
        image.size === input.finalSize &&
        image.sha256 === input.finalSha256.toLowerCase() &&
        image.width === input.width &&
        image.height === input.height &&
        image.optimizedAt?.getTime() === input.optimizedAt.getTime();
      return matchesFinalState
        ? {
            status: "completed" as const,
            image: { publicId: image.publicId },
            reclaimedS3Keys: [],
          }
        : { status: "inconsistent" as const, reclaimedS3Keys: [] };
    }
    const [finalOwner] = await tx
      .select({ id: workspaceCanvasImages.id })
      .from(workspaceCanvasImages)
      .where(eq(workspaceCanvasImages.s3Key, input.finalS3Key))
      .limit(1)
      .for("share");
    if (finalOwner) {
      await tx
        .insert(workspaceCanvasImageStorageDeletions)
        .values({
          s3Key: input.finalS3Key,
          workspaceId: input.workspaceId,
          size: input.finalSize,
          availableAt: now,
          completedAt: now,
        })
        .onConflictDoUpdate({
          target: workspaceCanvasImageStorageDeletions.s3Key,
          set: { completedAt: now },
        });
      return { status: "inconsistent" as const, reclaimedS3Keys: [] };
    }
    await tx
      .insert(workspaceCanvasImageStorageDeletions)
      .values({
        s3Key: input.finalS3Key,
        workspaceId: input.workspaceId,
        size: input.finalSize,
        availableAt: now,
      })
      .onConflictDoUpdate({
        target: workspaceCanvasImageStorageDeletions.s3Key,
        set: {
          workspaceId: input.workspaceId,
          size: input.finalSize,
          availableAt: now,
          completedAt: null,
        },
      });
    return {
      status: "not_persisted" as const,
      reclaimedS3Keys: [input.finalS3Key],
    };
  });
