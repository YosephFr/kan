import { and, eq, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { PreparedCardVisualWallUploadClone } from "@kan/db/repository/cardVisualWallClone.repo";
import * as cardDuplicateRepo from "@kan/db/repository/cardDuplicate.repo";
import { cloneCardResourcesTx } from "@kan/db/repository/cardResourceClone.repo";
import {
  assertActiveResourcesAcknowledged,
  PublicVisibilityAcknowledgementError,
} from "@kan/db/repository/cardResourceVisibility.repo";
import * as cardVisualWallRepo from "@kan/db/repository/cardVisualWall.repo";
import {
  backfillVisualWallsFromLegacyCanvases,
  saveBackfilledCardPreview,
} from "@kan/db/repository/visualWallBackfill.repo";
import { WorkspacePermissionChangedError } from "@kan/db/repository/workspace-boundary";
import {
  addImages,
  getSnapshot,
  removeItem,
  updateItem,
  VisualWallError,
} from "@kan/db/repository/workspaceVisualWall.repo";
import {
  boards,
  cardAttachments,
  cardCanvases,
  cardResources,
  cards,
  cardVisualWallItems,
  cardVisualWallPreviews,
  cardVisualWallPreviewStorageDeletions,
  cardVisualWalls,
  workspaceCanvases,
  workspaceCanvasImages,
  workspaceMemberPermissions,
  workspaceVisualWallItems,
  workspaceVisualWalls,
} from "@kan/db/schema";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";
import { cardVisualWallRouter } from "./card-visual-wall";

const placement = (zIndex = 0) => ({
  x: 10,
  y: zIndex * 10,
  width: 200,
  height: 120,
  zIndex,
});

const publicId = (prefix: string, value: number) =>
  `${prefix}${value.toString(36).padStart(12 - prefix.length, "0")}`;

describe("visual wall repositories", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
  });

  const createWorkspaceImage = async (
    imagePublicId: string,
    workspaceId = seeded.workspace.id,
  ) => {
    const [image] = await db
      .insert(workspaceCanvasImages)
      .values({
        publicId: imagePublicId,
        workspaceId,
        title: "Visual",
        filename: `${imagePublicId}.webp`,
        originalFilename: `${imagePublicId}.png`,
        contentType: "image/webp",
        size: 128,
        width: 100,
        height: 60,
        optimizedAt: new Date(),
        s3Key: `.objects/${imagePublicId}`,
        sha256: "a".repeat(64),
        createdBy: seeded.user.id,
      })
      .returning();
    if (!image) throw new Error("Workspace image missing");
    return image;
  };

  const createCardUpload = async (resourcePublicId = "wallupload01") => {
    const [attachment] = await db
      .insert(cardAttachments)
      .values({
        publicId: resourcePublicId,
        cardId: seeded.card.id,
        filename: "visual.png",
        originalFilename: "visual.png",
        contentType: "image/png",
        size: 128,
        s3Key: `.objects/${resourcePublicId}`,
        sha256: "b".repeat(64),
        createdBy: seeded.user.id,
      })
      .returning();
    if (!attachment) throw new Error("Attachment missing");
    const [resource] = await db
      .select()
      .from(cardResources)
      .where(eq(cardResources.attachmentId, attachment.id));
    if (!resource) throw new Error("Resource missing");
    const [preview] = await db
      .insert(cardVisualWallPreviews)
      .values({
        resourceId: resource.id,
        s3Key: `.visual-wall/${resourcePublicId}`,
        contentType: "image/webp",
        size: 96,
        sha256: "c".repeat(64),
        width: 100,
        height: 60,
      })
      .returning();
    if (!preview) throw new Error("Preview missing");
    return { attachment, resource, preview };
  };

  const prepareUploadClone = async (resourcePublicId: string) => {
    const { attachment, resource, preview } =
      await createCardUpload(resourcePublicId);
    const added = await cardVisualWallRepo.addResource(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      actorId: seeded.user.id,
      resourcePublicId: resource.publicId,
      placement: placement(3),
      publicVisibilityAcknowledged: true,
    });
    expect(added).toMatchObject({ status: "saved", version: 1 });
    const clone: PreparedCardVisualWallUploadClone = {
      sourceWallVersion: 1,
      sourceResourcePublicId: resource.publicId,
      attachment: {
        sourceS3Key: attachment.s3Key,
        filename: attachment.filename,
        originalFilename: attachment.originalFilename,
        contentType: attachment.contentType,
        size: attachment.size,
        sha256: attachment.sha256,
      },
      preview: {
        sourceS3Key: preview.s3Key,
        contentType: preview.contentType,
        size: preview.size,
        sha256: preview.sha256,
        width: preview.width,
        height: preview.height,
      },
      destinationAttachmentS3Key: `.objects/clone-${resourcePublicId}`,
      destinationPreviewS3Key: `.visual-wall/clone-${resourcePublicId}`,
      attachmentSha256: attachment.sha256 ?? "b".repeat(64),
    };
    return { attachment, resource, preview, clone };
  };

  it("creates lazily, preserves duplicate image instances and enforces CAS, scope and permission revocation", async () => {
    const image = await createWorkspaceImage("wallimage001");
    await expect(
      getSnapshot(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        actorId: seeded.user.id,
      }),
    ).resolves.toBeNull();
    expect(await db.select().from(workspaceVisualWalls)).toHaveLength(0);

    const created = await addImages(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      actorId: seeded.user.id,
      items: [
        { imagePublicId: image.publicId, ...placement(0) },
        { imagePublicId: image.publicId, ...placement(1) },
      ],
    });
    expect(created).toMatchObject({ status: "saved", version: 1 });
    await expect(
      getSnapshot(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ version: 1, items: [{}, {}] });
    await expect(
      addImages(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        actorId: seeded.user.id,
        items: [{ imagePublicId: image.publicId, ...placement(2) }],
      }),
    ).resolves.toEqual({ status: "conflict", remoteVersion: 1 });

    const foreignImage = await createWorkspaceImage(
      "wallimage002",
      seeded.otherWorkspace.id,
    );
    await expect(
      addImages(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        actorId: seeded.user.id,
        items: [{ imagePublicId: foreignImage.publicId, ...placement(2) }],
      }),
    ).rejects.toMatchObject({ code: "VISUAL_WALL_ITEM_INVALID" });

    await db.insert(workspaceMemberPermissions).values({
      workspaceMemberId: seeded.member.id,
      permission: "workspace:edit",
      granted: false,
    });
    await expect(
      addImages(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        actorId: seeded.user.id,
        items: [{ imagePublicId: image.publicId, ...placement(2) }],
      }),
    ).rejects.toBeInstanceOf(WorkspacePermissionChangedError);
  });

  it("accepts exactly 5000 active items and rejects item 5001 before resolving images", async () => {
    const image = await createWorkspaceImage("wallimage003");
    const created = await addImages(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      actorId: seeded.user.id,
      items: [{ imagePublicId: image.publicId, ...placement(0) }],
    });
    if (created.status !== "saved") throw new Error("Wall missing");
    const [wall] = await db
      .select({ id: workspaceVisualWalls.id })
      .from(workspaceVisualWalls)
      .where(eq(workspaceVisualWalls.workspaceId, seeded.workspace.id));
    if (!wall) throw new Error("Wall missing");
    for (let start = 0; start < 4_998; start += 500) {
      const length = Math.min(500, 4_998 - start);
      await db.insert(workspaceVisualWallItems).values(
        Array.from({ length }, (_, offset) => ({
          publicId: publicId("li", start + offset),
          wallId: wall.id,
          imageId: image.id,
          x: 0,
          y: 0,
          width: 44,
          height: 44,
          zIndex: start + offset + 1,
        })),
      );
    }
    await expect(
      addImages(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        actorId: seeded.user.id,
        items: [{ imagePublicId: image.publicId, ...placement(4_999) }],
      }),
    ).resolves.toMatchObject({ status: "saved", version: 2 });
    const [countAtLimit] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(workspaceVisualWallItems)
      .where(isNull(workspaceVisualWallItems.deletedAt));
    expect(countAtLimit?.count).toBe(5_000);

    const missingImagePublicId = "doesnotexist";
    await expect(
      addImages(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 2,
        actorId: seeded.user.id,
        items: [{ imagePublicId: missingImagePublicId, ...placement(5_000) }],
      }),
    ).rejects.toBeInstanceOf(VisualWallError);
  });

  it("converges legacy edits between stages without overwriting wall edits or resurrecting tombstones", async () => {
    const workspaceImage = await createWorkspaceImage("legacyimg001");
    const privateLegacyElementId = "private-project-plan";
    const workspaceScene = (x: number) => ({
      elements: [
        {
          id: privateLegacyElementId,
          type: "image",
          x,
          y: 20,
          width: 300,
          height: 180,
          customData: { kanResourcePublicId: workspaceImage.publicId },
        },
      ],
      appState: {},
    });
    const [workspaceCanvas] = await db
      .insert(workspaceCanvases)
      .values({
        workspaceId: seeded.workspace.id,
        scene: workspaceScene(10),
        version: 1,
        hash: "d".repeat(64),
        bytes: 100,
        elementCount: 1,
        createdBy: seeded.user.id,
        updatedBy: seeded.user.id,
      })
      .returning();
    if (!workspaceCanvas) throw new Error("Canvas missing");

    const { resource } = await createCardUpload("legacyres001");
    const cardScene = {
      elements: [
        {
          id: "card-image-one",
          type: "image",
          x: 1,
          y: 2,
          width: 100,
          height: 60,
          link: `kan-resource:${resource.publicId}`,
        },
        {
          id: "card-image-two",
          type: "image",
          x: 201,
          y: 2,
          width: 100,
          height: 60,
          link: `kan-resource:${resource.publicId}`,
        },
      ],
      appState: {},
    };
    await db.insert(cardCanvases).values({
      cardId: seeded.card.id,
      scene: cardScene,
      version: 1,
      hash: "e".repeat(64),
      bytes: 200,
      elementCount: 2,
      createdBy: seeded.user.id,
      updatedBy: seeded.user.id,
    });

    const firstBackfill = await backfillVisualWallsFromLegacyCanvases(db);
    expect(JSON.stringify(firstBackfill)).not.toContain(privateLegacyElementId);
    expect(await db.select().from(cardVisualWallItems)).toHaveLength(2);
    const [workspaceItem] = await db
      .select()
      .from(workspaceVisualWallItems)
      .where(
        eq(workspaceVisualWallItems.legacyElementId, privateLegacyElementId),
      );
    if (!workspaceItem) throw new Error("Backfilled item missing");

    await db
      .update(workspaceCanvases)
      .set({ scene: workspaceScene(110), version: 2 })
      .where(eq(workspaceCanvases.id, workspaceCanvas.id));
    await backfillVisualWallsFromLegacyCanvases(db);
    await expect(
      db
        .select({ x: workspaceVisualWallItems.x })
        .from(workspaceVisualWallItems)
        .where(eq(workspaceVisualWallItems.id, workspaceItem.id)),
    ).resolves.toEqual([{ x: 110 }]);

    const wallSnapshot = await getSnapshot(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      actorId: seeded.user.id,
    });
    if (!wallSnapshot) throw new Error("Wall snapshot missing");
    await updateItem(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: wallSnapshot.version,
      actorId: seeded.user.id,
      itemPublicId: workspaceItem.publicId,
      placement: { x: 210, y: 20, width: 300, height: 180, zIndex: 0 },
    });
    await db
      .update(workspaceCanvases)
      .set({ scene: workspaceScene(310), version: 3 })
      .where(eq(workspaceCanvases.id, workspaceCanvas.id));
    await backfillVisualWallsFromLegacyCanvases(db);
    await expect(
      db
        .select({ x: workspaceVisualWallItems.x })
        .from(workspaceVisualWallItems)
        .where(eq(workspaceVisualWallItems.id, workspaceItem.id)),
    ).resolves.toEqual([{ x: 210 }]);

    const editedSnapshot = await getSnapshot(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      actorId: seeded.user.id,
    });
    if (!editedSnapshot) throw new Error("Wall snapshot missing");
    await removeItem(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: editedSnapshot.version,
      actorId: seeded.user.id,
      itemPublicId: workspaceItem.publicId,
    });
    await backfillVisualWallsFromLegacyCanvases(db);
    const [tombstone] = await db
      .select({ deletedAt: workspaceVisualWallItems.deletedAt })
      .from(workspaceVisualWallItems)
      .where(eq(workspaceVisualWallItems.id, workspaceItem.id));
    expect(tombstone?.deletedAt).not.toBeNull();
    expect(await db.select().from(cardVisualWallItems)).toHaveLength(2);
  });

  it("requires public acknowledgement for Freeform and enforces public versus private reads", async () => {
    await db
      .update(boards)
      .set({ visibility: "private" })
      .where(eq(boards.id, seeded.board.id));
    const linked = await cardVisualWallRepo.setFreeformLink(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      actorId: seeded.user.id,
      freeformUrl: "https://www.icloud.com/freeform/abc#Plan",
      publicVisibilityAcknowledged: false,
    });
    expect(linked).toMatchObject({ status: "saved", version: 1 });
    await expect(
      db.transaction((tx) =>
        assertActiveResourcesAcknowledged(tx, [seeded.card.id], false),
      ),
    ).rejects.toBeInstanceOf(PublicVisibilityAcknowledgementError);

    await expect(
      cardVisualWallRouter
        .createCaller({ db, user: null } as never)
        .get({ cardPublicId: seeded.card.publicId }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await db
      .update(boards)
      .set({ visibility: "public" })
      .where(eq(boards.id, seeded.board.id));
    await expect(
      cardVisualWallRepo.setFreeformLink(db, {
        cardId: seeded.card.id,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        actorId: seeded.user.id,
        freeformUrl: "https://www.icloud.com/freeform/def#Public",
        publicVisibilityAcknowledged: false,
      }),
    ).resolves.toEqual({ status: "public_ack_required" });
    await expect(
      cardVisualWallRouter
        .createCaller({ db, user: null } as never)
        .get({ cardPublicId: seeded.card.publicId }),
    ).resolves.toMatchObject({
      exists: true,
      freeformUrl: "https://www.icloud.com/freeform/abc#Plan",
      viewModeEnabled: true,
    });
  });

  it("releases a preview created by a losing CAS request only when it has no active item", async () => {
    const { resource, preview } = await createCardUpload("racepreview1");
    const released = await cardVisualWallRepo.releaseUnreferencedPreview(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      resourcePublicId: resource.publicId,
      previewS3Key: preview.s3Key,
    });
    expect(released).toBe(preview.s3Key);
    await expect(
      db
        .select()
        .from(cardVisualWallPreviews)
        .where(
          and(
            eq(cardVisualWallPreviews.id, preview.id),
            isNull(cardVisualWallPreviews.deletedAt),
          ),
        ),
    ).resolves.toHaveLength(0);
  });

  it("recreates a released storage reservation when the object is later deleted", async () => {
    const s3Key = ".visual-wall/reserved-then-deleted";
    await cardVisualWallRepo.reservePreviewDeletionKeys(db, [s3Key]);
    await db.transaction(async (tx) => {
      await cardVisualWallRepo.cancelPreviewDeletionKeysTx(tx, [s3Key]);
    });
    await expect(
      db
        .select()
        .from(cardVisualWallPreviewStorageDeletions)
        .where(eq(cardVisualWallPreviewStorageDeletions.s3Key, s3Key)),
    ).resolves.toEqual([]);

    await cardVisualWallRepo.enqueuePreviewDeletionKeys(db, [s3Key]);
    await expect(
      db
        .select({
          attempts: cardVisualWallPreviewStorageDeletions.attempts,
          completedAt: cardVisualWallPreviewStorageDeletions.completedAt,
        })
        .from(cardVisualWallPreviewStorageDeletions)
        .where(eq(cardVisualWallPreviewStorageDeletions.s3Key, s3Key)),
    ).resolves.toEqual([{ attempts: 0, completedAt: null }]);
  });

  it("removes a successful backfill reservation instead of retaining a completed row", async () => {
    const { resource, preview } = await createCardUpload("backfillres1");
    await db
      .delete(cardVisualWallPreviews)
      .where(eq(cardVisualWallPreviews.id, preview.id));
    const s3Key = ".visual-wall/backfilled-preview";
    await cardVisualWallRepo.reservePreviewDeletionKeys(db, [s3Key]);

    await expect(
      saveBackfilledCardPreview(db, {
        resourceId: resource.id,
        s3Key,
        size: 96,
        sha256: "d".repeat(64),
        width: 100,
        height: 60,
      }),
    ).resolves.toEqual({ status: "created" });
    await expect(
      db
        .select()
        .from(cardVisualWallPreviewStorageDeletions)
        .where(eq(cardVisualWallPreviewStorageDeletions.s3Key, s3Key)),
    ).resolves.toEqual([]);
  });

  it("duplicates wall uploads and composition without copying the Freeform link", async () => {
    const { clone } = await prepareUploadClone("clonewall001");
    await cardVisualWallRepo.setFreeformLink(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 1,
      actorId: seeded.user.id,
      freeformUrl: "https://www.icloud.com/freeform/source#Private",
      publicVisibilityAcknowledged: true,
    });
    clone.sourceWallVersion = 2;
    const duplicated = await cardDuplicateRepo.duplicateCard(db, {
      sourceCardPublicId: seeded.card.publicId,
      targetListPublicId: seeded.list.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
      copyLabels: false,
      copyMembers: false,
      copyChecklists: false,
      copyPipeline: false,
      publicVisibilityAcknowledged: true,
      visualWallUploadClones: [clone],
    });
    expect(duplicated.status).toBe("duplicated");
    if (duplicated.status !== "duplicated") throw new Error("Clone missing");
    const [targetCard] = await db
      .select({ id: cards.id })
      .from(cards)
      .where(eq(cards.publicId, duplicated.publicId));
    if (!targetCard) throw new Error("Target card missing");
    const [targetWall] = await db
      .select()
      .from(cardVisualWalls)
      .where(eq(cardVisualWalls.cardId, targetCard.id));
    expect(targetWall).toMatchObject({ version: 1, freeformUrl: null });
    if (!targetWall) throw new Error("Target wall missing");
    const [targetItem] = await db
      .select()
      .from(cardVisualWallItems)
      .where(eq(cardVisualWallItems.wallId, targetWall.id));
    expect(targetItem).toMatchObject(placement(3));
    const [targetResource] = await db
      .select()
      .from(cardResources)
      .where(eq(cardResources.cardId, targetCard.id));
    expect(targetResource?.kind).toBe("upload");
    if (!targetResource) throw new Error("Target resource missing");
    await expect(
      db
        .select()
        .from(cardVisualWallPreviews)
        .where(eq(cardVisualWallPreviews.resourceId, targetResource.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        s3Key: clone.destinationPreviewS3Key,
        sha256: clone.preview.sha256,
      }),
    ]);
  });

  it("rejects prepared clone objects when the active wall item disappears", async () => {
    const { resource, clone } = await prepareUploadClone("clonerace001");
    await db
      .update(cardVisualWallItems)
      .set({ deletedAt: new Date() })
      .where(eq(cardVisualWallItems.resourceId, resource.id));
    await expect(
      db.transaction((tx) =>
        cloneCardResourcesTx(tx, {
          sourceCardId: seeded.card.id,
          destinationCardId: seeded.emptyCard.id,
          expectedWorkspaceId: seeded.workspace.id,
          createdBy: seeded.user.id,
          visualWallUploadClones: [clone],
        }),
      ),
    ).rejects.toThrow("Prepared visual wall upload source changed");
    await expect(
      db
        .select()
        .from(cardResources)
        .where(eq(cardResources.cardId, seeded.emptyCard.id)),
    ).resolves.toHaveLength(0);
  });

  it("rejects prepared clone objects when the preview changes", async () => {
    const { preview, clone } = await prepareUploadClone("clonerace002");
    await db
      .update(cardVisualWallPreviews)
      .set({ sha256: "f".repeat(64) })
      .where(eq(cardVisualWallPreviews.id, preview.id));
    await expect(
      db.transaction((tx) =>
        cloneCardResourcesTx(tx, {
          sourceCardId: seeded.card.id,
          destinationCardId: seeded.emptyCard.id,
          expectedWorkspaceId: seeded.workspace.id,
          createdBy: seeded.user.id,
          visualWallUploadClones: [clone],
        }),
      ),
    ).rejects.toThrow("Prepared visual wall upload source changed");
  });

  it("rejects a partial clone when a new wall resource appears after preparation", async () => {
    const { clone } = await prepareUploadClone("clonerace003");
    const { resource: addedResource } = await createCardUpload("clonerace004");
    await expect(
      cardVisualWallRepo.addResource(db, {
        cardId: seeded.card.id,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        actorId: seeded.user.id,
        resourcePublicId: addedResource.publicId,
        placement: placement(4),
        publicVisibilityAcknowledged: true,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 2 });
    await expect(
      db.transaction((tx) =>
        cloneCardResourcesTx(tx, {
          sourceCardId: seeded.card.id,
          destinationCardId: seeded.emptyCard.id,
          expectedWorkspaceId: seeded.workspace.id,
          createdBy: seeded.user.id,
          visualWallUploadClones: [clone],
        }),
      ),
    ).rejects.toThrow("Prepared visual wall upload source changed");
    await expect(
      db
        .select()
        .from(cardResources)
        .where(eq(cardResources.cardId, seeded.emptyCard.id)),
    ).resolves.toHaveLength(0);
  });
});
