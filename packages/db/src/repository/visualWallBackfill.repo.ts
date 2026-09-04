import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type {
  NormalizedCardCanvasElement,
  NormalizedCardCanvasScene,
} from "@kan/shared";
import {
  cardAttachments,
  cardCanvases,
  cardResources,
  cardVisualWallItems,
  cardVisualWallPreviews,
  cardVisualWallPreviewStorageDeletions,
  cardVisualWalls,
  workspaceCanvases,
  workspaceCanvasImages,
  workspaceVisualWallItems,
  workspaceVisualWalls,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import { MAX_VISUAL_WALL_ITEMS } from "./workspaceVisualWall.repo";

const publicIdPattern = /^[a-z0-9]{12}$/;
const LEGACY_CANVAS_BATCH_SIZE = 5;
const FAILURE_SAMPLE_LIMIT = 20;

const getResourcePublicId = (element: NormalizedCardCanvasElement) => {
  const customData =
    element.customData &&
    typeof element.customData === "object" &&
    !Array.isArray(element.customData)
      ? element.customData
      : null;
  const customPublicId = customData?.kanResourcePublicId;
  if (
    typeof customPublicId === "string" &&
    publicIdPattern.test(customPublicId)
  ) {
    return customPublicId;
  }
  const match =
    typeof element.link === "string"
      ? /^kan-resource:([a-z0-9]{12})$/.exec(element.link)
      : null;
  return match?.[1] ?? null;
};

const finiteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const placementChanged = (
  current: {
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
  },
  next: {
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
  },
) =>
  current.x !== next.x ||
  current.y !== next.y ||
  current.width !== next.width ||
  current.height !== next.height ||
  current.zIndex !== next.zIndex;

export const extractLegacyVisualWallItems = (
  scene: NormalizedCardCanvasScene,
) => {
  if (!Array.isArray(scene.elements)) {
    throw new Error("VISUAL_WALL_BACKFILL_SCENE_INVALID");
  }
  if (scene.elements.length > MAX_VISUAL_WALL_ITEMS) {
    throw new Error("VISUAL_WALL_BACKFILL_ITEM_LIMIT_REACHED");
  }
  return scene.elements.flatMap((element, zIndex) => {
    if (element.type !== "image") return [];
    const resourcePublicId = getResourcePublicId(element);
    if (!resourcePublicId) return [];
    const sourceWidth = Math.max(1, Math.abs(finiteNumber(element.width, 1)));
    const sourceHeight = Math.max(1, Math.abs(finiteNumber(element.height, 1)));
    const scale = Math.min(1, 1_200 / sourceWidth, 1_000_000 / sourceHeight);
    const width = Math.min(
      1_200,
      Math.max(44, Math.round(sourceWidth * scale)),
    );
    const height = Math.min(
      1_000_000,
      Math.max(44, Math.round(sourceHeight * scale)),
    );
    const x = Math.min(
      1_200 - width,
      Math.max(0, Math.round(finiteNumber(element.x, 0))),
    );
    const y = Math.min(
      1_000_000 - height,
      Math.max(0, Math.round(finiteNumber(element.y, 0))),
    );
    return [
      {
        legacyElementId: element.id,
        resourcePublicId,
        x,
        y,
        width,
        height,
        zIndex,
      },
    ];
  });
};

export async function backfillVisualWallsFromLegacyCanvases(db: dbClient) {
  let workspaceItemCount = 0;
  let cardItemCount = 0;
  let skippedItemCount = 0;
  let workspaceFailureCount = 0;
  let cardFailureCount = 0;
  const failureSamples: {
    ownerType: "workspace" | "card";
    ownerId: number;
    code: "VISUAL_WALL_BACKFILL_ITEM_FAILED";
  }[] = [];
  const recordFailure = (ownerType: "workspace" | "card", ownerId: number) => {
    if (ownerType === "workspace") workspaceFailureCount += 1;
    else cardFailureCount += 1;
    if (failureSamples.length < FAILURE_SAMPLE_LIMIT) {
      failureSamples.push({
        ownerType,
        ownerId,
        code: "VISUAL_WALL_BACKFILL_ITEM_FAILED",
      });
    }
  };

  let workspaceAfterId = 0;
  while (true) {
    const workspaceCanvasesToMigrate = await db
      .select({
        id: workspaceCanvases.id,
        workspaceId: workspaceCanvases.workspaceId,
        scene: workspaceCanvases.scene,
        createdBy: workspaceCanvases.createdBy,
        updatedBy: workspaceCanvases.updatedBy,
      })
      .from(workspaceCanvases)
      .where(gt(workspaceCanvases.id, workspaceAfterId))
      .orderBy(asc(workspaceCanvases.id))
      .limit(LEGACY_CANVAS_BATCH_SIZE);
    if (workspaceCanvasesToMigrate.length === 0) break;
    workspaceAfterId =
      workspaceCanvasesToMigrate.at(-1)?.id ?? workspaceAfterId;
    for (const canvas of workspaceCanvasesToMigrate) {
      const placements = extractLegacyVisualWallItems(canvas.scene);
      for (const placement of placements) {
        try {
          const inserted = await db.transaction(async (tx) => {
            const [image] = await tx
              .select({ id: workspaceCanvasImages.id })
              .from(workspaceCanvasImages)
              .where(
                and(
                  eq(workspaceCanvasImages.workspaceId, canvas.workspaceId),
                  eq(
                    workspaceCanvasImages.publicId,
                    placement.resourcePublicId,
                  ),
                  isNull(workspaceCanvasImages.deletedAt),
                ),
              )
              .limit(1)
              .for("share");
            if (!image) return 0;
            const createdWall = await tx
              .insert(workspaceVisualWalls)
              .values({
                workspaceId: canvas.workspaceId,
                version: 1,
                createdBy: canvas.createdBy,
                updatedBy: canvas.updatedBy,
              })
              .onConflictDoNothing({ target: workspaceVisualWalls.workspaceId })
              .returning({ id: workspaceVisualWalls.id });
            const [wall] = await tx
              .select({ id: workspaceVisualWalls.id })
              .from(workspaceVisualWalls)
              .where(eq(workspaceVisualWalls.workspaceId, canvas.workspaceId))
              .limit(1)
              .for("update");
            if (!wall) throw new Error("VISUAL_WALL_BACKFILL_WRITE_FAILED");
            const [existingItem] = await tx
              .select({
                id: workspaceVisualWallItems.id,
                imageId: workspaceVisualWallItems.imageId,
                x: workspaceVisualWallItems.x,
                y: workspaceVisualWallItems.y,
                width: workspaceVisualWallItems.width,
                height: workspaceVisualWallItems.height,
                zIndex: workspaceVisualWallItems.zIndex,
                createdAt: workspaceVisualWallItems.createdAt,
                updatedAt: workspaceVisualWallItems.updatedAt,
                deletedAt: workspaceVisualWallItems.deletedAt,
              })
              .from(workspaceVisualWallItems)
              .where(
                and(
                  eq(workspaceVisualWallItems.wallId, wall.id),
                  eq(
                    workspaceVisualWallItems.legacyElementId,
                    placement.legacyElementId,
                  ),
                ),
              )
              .limit(1)
              .for("update");
            if (existingItem) {
              if (
                existingItem.deletedAt ||
                existingItem.updatedAt.getTime() !==
                  existingItem.createdAt.getTime() ||
                (existingItem.imageId === image.id &&
                  !placementChanged(existingItem, placement))
              ) {
                return 0;
              }
              await tx
                .update(workspaceVisualWallItems)
                .set({
                  imageId: image.id,
                  x: placement.x,
                  y: placement.y,
                  width: placement.width,
                  height: placement.height,
                  zIndex: placement.zIndex,
                })
                .where(eq(workspaceVisualWallItems.id, existingItem.id));
              await tx
                .update(workspaceVisualWalls)
                .set({
                  version: sql`${workspaceVisualWalls.version} + 1`,
                  updatedAt: new Date(),
                  updatedBy: canvas.updatedBy,
                })
                .where(eq(workspaceVisualWalls.id, wall.id));
              return 1;
            }
            const [countRow] = await tx
              .select({ count: sql<number>`count(*)`.mapWith(Number) })
              .from(workspaceVisualWallItems)
              .where(
                and(
                  eq(workspaceVisualWallItems.wallId, wall.id),
                  isNull(workspaceVisualWallItems.deletedAt),
                ),
              );
            if ((countRow?.count ?? 0) >= MAX_VISUAL_WALL_ITEMS) {
              throw new Error("VISUAL_WALL_BACKFILL_ITEM_LIMIT_REACHED");
            }
            const rows = await tx
              .insert(workspaceVisualWallItems)
              .values({
                publicId: generateUID(),
                wallId: wall.id,
                imageId: image.id,
                legacyElementId: placement.legacyElementId,
                x: placement.x,
                y: placement.y,
                width: placement.width,
                height: placement.height,
                zIndex: placement.zIndex,
              })
              .onConflictDoNothing()
              .returning({ id: workspaceVisualWallItems.id });
            if (rows.length > 0) {
              await tx
                .update(workspaceCanvasImages)
                .set({ sharedAt: new Date() })
                .where(
                  and(
                    eq(workspaceCanvasImages.id, image.id),
                    isNull(workspaceCanvasImages.sharedAt),
                  ),
                );
              if (createdWall.length === 0) {
                await tx
                  .update(workspaceVisualWalls)
                  .set({
                    version: sql`${workspaceVisualWalls.version} + 1`,
                    updatedAt: new Date(),
                    updatedBy: canvas.updatedBy,
                  })
                  .where(eq(workspaceVisualWalls.id, wall.id));
              }
            }
            return rows.length;
          });
          workspaceItemCount += inserted;
          if (inserted === 0) skippedItemCount += 1;
        } catch {
          recordFailure("workspace", canvas.workspaceId);
        }
      }
      await db.transaction(async (tx) => {
        const [wall] = await tx
          .select({ id: workspaceVisualWalls.id })
          .from(workspaceVisualWalls)
          .where(eq(workspaceVisualWalls.workspaceId, canvas.workspaceId))
          .limit(1)
          .for("update");
        if (!wall) return;
        const retainedLegacyIds = new Set(
          placements.map((placement) => placement.legacyElementId),
        );
        const removable = (
          await tx
            .select({
              id: workspaceVisualWallItems.id,
              legacyElementId: workspaceVisualWallItems.legacyElementId,
              createdAt: workspaceVisualWallItems.createdAt,
              updatedAt: workspaceVisualWallItems.updatedAt,
            })
            .from(workspaceVisualWallItems)
            .where(
              and(
                eq(workspaceVisualWallItems.wallId, wall.id),
                isNotNull(workspaceVisualWallItems.legacyElementId),
                isNull(workspaceVisualWallItems.deletedAt),
              ),
            )
            .for("update")
        ).filter(
          (item) =>
            item.legacyElementId !== null &&
            !retainedLegacyIds.has(item.legacyElementId) &&
            item.updatedAt.getTime() === item.createdAt.getTime(),
        );
        if (removable.length === 0) return;
        const removedAt = new Date();
        await tx
          .update(workspaceVisualWallItems)
          .set({ deletedAt: removedAt, updatedAt: removedAt })
          .where(
            inArray(
              workspaceVisualWallItems.id,
              removable.map((item) => item.id),
            ),
          );
        await tx
          .update(workspaceVisualWalls)
          .set({
            version: sql`${workspaceVisualWalls.version} + 1`,
            updatedAt: removedAt,
            updatedBy: canvas.updatedBy,
          })
          .where(eq(workspaceVisualWalls.id, wall.id));
      });
    }
  }

  let cardAfterId = 0;
  while (true) {
    const cardCanvasesToMigrate = await db
      .select({
        id: cardCanvases.id,
        cardId: cardCanvases.cardId,
        scene: cardCanvases.scene,
        createdBy: cardCanvases.createdBy,
        updatedBy: cardCanvases.updatedBy,
      })
      .from(cardCanvases)
      .where(gt(cardCanvases.id, cardAfterId))
      .orderBy(asc(cardCanvases.id))
      .limit(LEGACY_CANVAS_BATCH_SIZE);
    if (cardCanvasesToMigrate.length === 0) break;
    cardAfterId = cardCanvasesToMigrate.at(-1)?.id ?? cardAfterId;
    for (const canvas of cardCanvasesToMigrate) {
      const placements = extractLegacyVisualWallItems(canvas.scene);
      for (const placement of placements) {
        try {
          const inserted = await db.transaction(async (tx) => {
            const [resource] = await tx
              .select({ id: cardResources.id })
              .from(cardResources)
              .innerJoin(
                cardAttachments,
                eq(cardResources.attachmentId, cardAttachments.id),
              )
              .where(
                and(
                  eq(cardResources.cardId, canvas.cardId),
                  eq(cardResources.kind, "upload"),
                  eq(cardResources.publicId, placement.resourcePublicId),
                  isNull(cardResources.deletedAt),
                  isNull(cardAttachments.deletedAt),
                  isNull(cardAttachments.storageQuarantinedAt),
                  sql`${cardAttachments.contentType} in ('image/jpeg', 'image/png', 'image/webp')`,
                ),
              )
              .limit(1)
              .for("share", { of: cardResources });
            if (!resource) return 0;
            const createdWall = await tx
              .insert(cardVisualWalls)
              .values({
                cardId: canvas.cardId,
                version: 1,
                createdBy: canvas.createdBy,
                updatedBy: canvas.updatedBy,
              })
              .onConflictDoNothing({ target: cardVisualWalls.cardId })
              .returning({ id: cardVisualWalls.id });
            const [wall] = await tx
              .select({ id: cardVisualWalls.id })
              .from(cardVisualWalls)
              .where(eq(cardVisualWalls.cardId, canvas.cardId))
              .limit(1)
              .for("update");
            if (!wall) throw new Error("VISUAL_WALL_BACKFILL_WRITE_FAILED");
            const [existingItem] = await tx
              .select({
                id: cardVisualWallItems.id,
                resourceId: cardVisualWallItems.resourceId,
                x: cardVisualWallItems.x,
                y: cardVisualWallItems.y,
                width: cardVisualWallItems.width,
                height: cardVisualWallItems.height,
                zIndex: cardVisualWallItems.zIndex,
                createdAt: cardVisualWallItems.createdAt,
                updatedAt: cardVisualWallItems.updatedAt,
                deletedAt: cardVisualWallItems.deletedAt,
              })
              .from(cardVisualWallItems)
              .where(
                and(
                  eq(cardVisualWallItems.wallId, wall.id),
                  eq(
                    cardVisualWallItems.legacyElementId,
                    placement.legacyElementId,
                  ),
                ),
              )
              .limit(1)
              .for("update");
            if (existingItem) {
              if (
                existingItem.deletedAt ||
                existingItem.updatedAt.getTime() !==
                  existingItem.createdAt.getTime() ||
                (existingItem.resourceId === resource.id &&
                  !placementChanged(existingItem, placement))
              ) {
                return 0;
              }
              await tx
                .update(cardVisualWallItems)
                .set({
                  resourceId: resource.id,
                  x: placement.x,
                  y: placement.y,
                  width: placement.width,
                  height: placement.height,
                  zIndex: placement.zIndex,
                })
                .where(eq(cardVisualWallItems.id, existingItem.id));
              await tx
                .update(cardVisualWalls)
                .set({
                  version: sql`${cardVisualWalls.version} + 1`,
                  updatedAt: new Date(),
                  updatedBy: canvas.updatedBy,
                })
                .where(eq(cardVisualWalls.id, wall.id));
              return 1;
            }
            const [countRow] = await tx
              .select({ count: sql<number>`count(*)`.mapWith(Number) })
              .from(cardVisualWallItems)
              .where(
                and(
                  eq(cardVisualWallItems.wallId, wall.id),
                  isNull(cardVisualWallItems.deletedAt),
                ),
              );
            if ((countRow?.count ?? 0) >= MAX_VISUAL_WALL_ITEMS) {
              throw new Error("VISUAL_WALL_BACKFILL_ITEM_LIMIT_REACHED");
            }
            const rows = await tx
              .insert(cardVisualWallItems)
              .values({
                publicId: generateUID(),
                wallId: wall.id,
                resourceId: resource.id,
                legacyElementId: placement.legacyElementId,
                x: placement.x,
                y: placement.y,
                width: placement.width,
                height: placement.height,
                zIndex: placement.zIndex,
              })
              .onConflictDoNothing()
              .returning({ id: cardVisualWallItems.id });
            if (rows.length > 0 && createdWall.length === 0) {
              await tx
                .update(cardVisualWalls)
                .set({
                  version: sql`${cardVisualWalls.version} + 1`,
                  updatedAt: new Date(),
                  updatedBy: canvas.updatedBy,
                })
                .where(eq(cardVisualWalls.id, wall.id));
            }
            return rows.length;
          });
          cardItemCount += inserted;
          if (inserted === 0) skippedItemCount += 1;
        } catch {
          recordFailure("card", canvas.cardId);
        }
      }
      await db.transaction(async (tx) => {
        const [wall] = await tx
          .select({ id: cardVisualWalls.id })
          .from(cardVisualWalls)
          .where(eq(cardVisualWalls.cardId, canvas.cardId))
          .limit(1)
          .for("update");
        if (!wall) return;
        const retainedLegacyIds = new Set(
          placements.map((placement) => placement.legacyElementId),
        );
        const removable = (
          await tx
            .select({
              id: cardVisualWallItems.id,
              legacyElementId: cardVisualWallItems.legacyElementId,
              createdAt: cardVisualWallItems.createdAt,
              updatedAt: cardVisualWallItems.updatedAt,
            })
            .from(cardVisualWallItems)
            .where(
              and(
                eq(cardVisualWallItems.wallId, wall.id),
                isNotNull(cardVisualWallItems.legacyElementId),
                isNull(cardVisualWallItems.deletedAt),
              ),
            )
            .for("update")
        ).filter(
          (item) =>
            item.legacyElementId !== null &&
            !retainedLegacyIds.has(item.legacyElementId) &&
            item.updatedAt.getTime() === item.createdAt.getTime(),
        );
        if (removable.length === 0) return;
        const removedAt = new Date();
        await tx
          .update(cardVisualWallItems)
          .set({ deletedAt: removedAt, updatedAt: removedAt })
          .where(
            inArray(
              cardVisualWallItems.id,
              removable.map((item) => item.id),
            ),
          );
        await tx
          .update(cardVisualWalls)
          .set({
            version: sql`${cardVisualWalls.version} + 1`,
            updatedAt: removedAt,
            updatedBy: canvas.updatedBy,
          })
          .where(eq(cardVisualWalls.id, wall.id));
      });
    }
  }
  const failedItemCount = workspaceFailureCount + cardFailureCount;
  return {
    workspaceItemCount,
    cardItemCount,
    skippedItemCount,
    failedItemCount,
    workspaceFailureCount,
    cardFailureCount,
    failureSamples,
  };
}

export const listMissingCardPreviewSources = (
  db: dbClient,
  limit = 25,
  afterResourceId = 0,
) =>
  db
    .select({
      resourceId: cardResources.id,
      resourcePublicId: cardResources.publicId,
      s3Key: cardAttachments.s3Key,
      contentType: cardAttachments.contentType,
      size: cardAttachments.size,
    })
    .from(cardVisualWallItems)
    .innerJoin(
      cardResources,
      eq(cardVisualWallItems.resourceId, cardResources.id),
    )
    .innerJoin(
      cardAttachments,
      eq(cardResources.attachmentId, cardAttachments.id),
    )
    .leftJoin(
      cardVisualWallPreviews,
      and(
        eq(cardVisualWallPreviews.resourceId, cardResources.id),
        isNull(cardVisualWallPreviews.deletedAt),
      ),
    )
    .where(
      and(
        isNull(cardVisualWallPreviews.id),
        isNull(cardVisualWallItems.deletedAt),
        gt(cardResources.id, afterResourceId),
        isNull(cardResources.deletedAt),
        isNull(cardAttachments.deletedAt),
        isNull(cardAttachments.storageQuarantinedAt),
      ),
    )
    .groupBy(
      cardResources.id,
      cardResources.publicId,
      cardAttachments.s3Key,
      cardAttachments.contentType,
      cardAttachments.size,
    )
    .orderBy(asc(cardResources.id))
    .limit(limit);

export const saveBackfilledCardPreview = (
  db: dbClient,
  input: {
    resourceId: number;
    s3Key: string;
    size: number;
    sha256: string;
    width: number;
    height: number;
  },
) =>
  db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: cardVisualWallPreviews.id,
        s3Key: cardVisualWallPreviews.s3Key,
        deletedAt: cardVisualWallPreviews.deletedAt,
      })
      .from(cardVisualWallPreviews)
      .where(eq(cardVisualWallPreviews.resourceId, input.resourceId))
      .limit(1)
      .for("update");
    if (existing?.deletedAt === null) {
      return { status: "existing" as const };
    }
    if (existing) {
      await tx
        .insert(cardVisualWallPreviewStorageDeletions)
        .values({ s3Key: existing.s3Key })
        .onConflictDoUpdate({
          target: cardVisualWallPreviewStorageDeletions.s3Key,
          set: {
            attempts: 0,
            lastAttemptAt: null,
            availableAt: new Date(),
            completedAt: null,
          },
        });
      await tx
        .update(cardVisualWallPreviews)
        .set({
          s3Key: input.s3Key,
          contentType: "image/webp",
          size: input.size,
          sha256: input.sha256,
          width: input.width,
          height: input.height,
          deletedAt: null,
          storageDeletedAt: null,
          createdAt: new Date(),
        })
        .where(eq(cardVisualWallPreviews.id, existing.id));
      await tx
        .delete(cardVisualWallPreviewStorageDeletions)
        .where(eq(cardVisualWallPreviewStorageDeletions.s3Key, input.s3Key));
      return { status: "created" as const };
    }
    await tx.insert(cardVisualWallPreviews).values({
      resourceId: input.resourceId,
      s3Key: input.s3Key,
      contentType: "image/webp",
      size: input.size,
      sha256: input.sha256,
      width: input.width,
      height: input.height,
    });
    await tx
      .delete(cardVisualWallPreviewStorageDeletions)
      .where(eq(cardVisualWallPreviewStorageDeletions.s3Key, input.s3Key));
    return { status: "created" as const };
  });

export const countMissingCardPreviews = async (db: dbClient) => {
  const rows = await listMissingCardPreviewSources(db, 1);
  return rows.length;
};
