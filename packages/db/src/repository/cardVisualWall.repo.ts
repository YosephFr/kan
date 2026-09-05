import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardAttachments,
  cardResources,
  cards,
  cardVisualWallItems,
  cardVisualWallPreviews,
  cardVisualWallPreviewStorageDeletions,
  cardVisualWalls,
  lists,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";
import type { VisualWallPlacement } from "./workspaceVisualWall.repo";
import {
  assertWorkspacePermissionTx,
  lockCardsInWorkspace,
} from "./workspace-boundary";
import {
  MAX_VISUAL_WALL_ITEMS,
  VisualWallError,
} from "./workspaceVisualWall.repo";

export type CardVisualWallMutationResult =
  | { status: "saved"; version: number; updatedAt: Date }
  | { status: "conflict"; remoteVersion: number }
  | { status: "public_ack_required" };

const cancelPreviewDeletionKeysTx = (
  tx: DbTransaction,
  s3Keys: readonly string[],
) =>
  s3Keys.length === 0
    ? Promise.resolve()
    : tx
        .delete(cardVisualWallPreviewStorageDeletions)
        .where(
          inArray(cardVisualWallPreviewStorageDeletions.s3Key, [...s3Keys]),
        );

export { cancelPreviewDeletionKeysTx };

const enqueuePreviewDeletionTx = async (
  tx: DbTransaction,
  preview: { id: number; s3Key: string; size: number },
) => {
  const now = new Date();
  await tx
    .update(cardVisualWallPreviews)
    .set({ deletedAt: now })
    .where(
      and(
        eq(cardVisualWallPreviews.id, preview.id),
        isNull(cardVisualWallPreviews.deletedAt),
      ),
    );
  await tx
    .insert(cardVisualWallPreviewStorageDeletions)
    .values({ s3Key: preview.s3Key, size: preview.size })
    .onConflictDoUpdate({
      target: cardVisualWallPreviewStorageDeletions.s3Key,
      set: {
        size: preview.size,
        attempts: 0,
        lastAttemptAt: null,
        availableAt: now,
        completedAt: null,
      },
    });
};

const getWallTx = async (tx: DbTransaction, cardId: number) => {
  const [wall] = await tx
    .select({
      id: cardVisualWalls.id,
      version: cardVisualWalls.version,
      freeformUrl: cardVisualWalls.freeformUrl,
      updatedAt: cardVisualWalls.updatedAt,
    })
    .from(cardVisualWalls)
    .where(eq(cardVisualWalls.cardId, cardId))
    .limit(1);
  return wall ?? null;
};

const getWallForUpdateTx = async (tx: DbTransaction, cardId: number) => {
  const [wall] = await tx
    .select({
      id: cardVisualWalls.id,
      version: cardVisualWalls.version,
      freeformUrl: cardVisualWalls.freeformUrl,
      updatedAt: cardVisualWalls.updatedAt,
    })
    .from(cardVisualWalls)
    .where(eq(cardVisualWalls.cardId, cardId))
    .limit(1)
    .for("update");
  return wall ?? null;
};

const prepareMutationTx = async (
  tx: DbTransaction,
  input: { cardId: number; actorId: string; expectedVersion: number },
) => {
  const existing = await getWallForUpdateTx(tx, input.cardId);
  const remoteVersion = existing?.version ?? 0;
  if (remoteVersion !== input.expectedVersion) {
    return { status: "conflict" as const, remoteVersion };
  }
  if (existing)
    return { status: "ready" as const, wall: existing, created: false };
  const now = new Date();
  const [wall] = await tx
    .insert(cardVisualWalls)
    .values({
      cardId: input.cardId,
      version: 1,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      createdAt: now,
      updatedAt: now,
    })
    .returning({
      id: cardVisualWalls.id,
      version: cardVisualWalls.version,
      freeformUrl: cardVisualWalls.freeformUrl,
      updatedAt: cardVisualWalls.updatedAt,
    });
  if (!wall) throw new Error("Failed to create card visual wall");
  return { status: "ready" as const, wall, created: true };
};

const finishMutationTx = async (
  tx: DbTransaction,
  input: {
    wallId: number;
    version: number;
    actorId: string;
    created: boolean;
  },
): Promise<CardVisualWallMutationResult> => {
  const updatedAt = new Date();
  const version = input.created ? input.version : input.version + 1;
  const [updated] = await tx
    .update(cardVisualWalls)
    .set({ version, updatedBy: input.actorId, updatedAt })
    .where(
      and(
        eq(cardVisualWalls.id, input.wallId),
        eq(cardVisualWalls.version, input.version),
      ),
    )
    .returning({ version: cardVisualWalls.version });
  if (!updated) {
    const [remote] = await tx
      .select({ version: cardVisualWalls.version })
      .from(cardVisualWalls)
      .where(eq(cardVisualWalls.id, input.wallId))
      .limit(1);
    return { status: "conflict", remoteVersion: remote?.version ?? 0 };
  }
  return { status: "saved", version, updatedAt };
};

const lockEditableCard = async (
  tx: DbTransaction,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    actorId: string;
  },
) => {
  const [card] = await lockCardsInWorkspace(
    tx,
    [input.cardId],
    input.expectedWorkspaceId,
    { cardLock: "update" },
  );
  if (!card) throw new VisualWallError("VISUAL_WALL_ITEM_INVALID");
  await assertWorkspacePermissionTx(tx, {
    workspaceId: input.expectedWorkspaceId,
    userId: input.actorId,
    permission: "card:edit",
  });
  return card;
};

const requiresPublicAcknowledgement = async (
  tx: DbTransaction,
  boardId: number,
  acknowledged: boolean,
) => {
  if (acknowledged) return false;
  const [board] = await tx
    .select({ visibility: boards.visibility })
    .from(boards)
    .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)))
    .limit(1)
    .for("share");
  return board?.visibility === "public";
};

export const getSnapshot = (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    actorId: string | null;
    requirePublic: boolean;
  },
) =>
  db.transaction(async (tx) => {
    const [card] = await lockCardsInWorkspace(
      tx,
      [input.cardId],
      input.expectedWorkspaceId,
      { cardLock: "share", requirePublic: input.requirePublic },
    );
    if (!card) throw new VisualWallError("VISUAL_WALL_ITEM_INVALID");
    if (!input.requirePublic) {
      if (!input.actorId) throw new VisualWallError("VISUAL_WALL_ITEM_INVALID");
      await assertWorkspacePermissionTx(tx, {
        workspaceId: input.expectedWorkspaceId,
        userId: input.actorId,
        permission: "card:view",
      });
    }
    const wall = await getWallTx(tx, card.id);
    if (!wall) return null;
    const items = await tx
      .select({
        publicId: cardVisualWallItems.publicId,
        resourcePublicId: cardResources.publicId,
        title: cardResources.title,
        widthPx: cardVisualWallPreviews.width,
        heightPx: cardVisualWallPreviews.height,
        x: cardVisualWallItems.x,
        y: cardVisualWallItems.y,
        width: cardVisualWallItems.width,
        height: cardVisualWallItems.height,
        zIndex: cardVisualWallItems.zIndex,
      })
      .from(cardVisualWallItems)
      .innerJoin(
        cardResources,
        eq(cardVisualWallItems.resourceId, cardResources.id),
      )
      .innerJoin(
        cardVisualWallPreviews,
        eq(cardVisualWallPreviews.resourceId, cardResources.id),
      )
      .innerJoin(
        cardAttachments,
        eq(cardResources.attachmentId, cardAttachments.id),
      )
      .where(
        and(
          eq(cardVisualWallItems.wallId, wall.id),
          isNull(cardVisualWallItems.deletedAt),
          eq(cardResources.cardId, card.id),
          eq(cardResources.kind, "upload"),
          isNull(cardResources.deletedAt),
          isNull(cardAttachments.deletedAt),
          isNull(cardAttachments.storageQuarantinedAt),
          isNull(cardVisualWallPreviews.deletedAt),
          sql`${cardAttachments.contentType} like 'image/%'`,
        ),
      )
      .orderBy(asc(cardVisualWallItems.zIndex), asc(cardVisualWallItems.id));
    return { ...wall, items };
  });

export const getExpectedVersionStatus = (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    expectedVersion: number;
    actorId: string;
  },
) =>
  db.transaction(async (tx) => {
    const card = await lockEditableCard(tx, input);
    const wall = await getWallTx(tx, card.id);
    const remoteVersion = wall?.version ?? 0;
    if (remoteVersion !== input.expectedVersion) {
      return { status: "conflict" as const, remoteVersion };
    }
    if (wall) {
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
        throw new VisualWallError("VISUAL_WALL_ITEM_LIMIT_REACHED");
      }
    }
    return { status: "ready" as const };
  });

export const addResource = (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    expectedVersion: number;
    actorId: string;
    resourcePublicId: string;
    placement: VisualWallPlacement;
    publicVisibilityAcknowledged: boolean;
  },
) =>
  db.transaction(async (tx) => {
    const card = await lockEditableCard(tx, input);
    if (
      await requiresPublicAcknowledgement(
        tx,
        card.boardId,
        input.publicVisibilityAcknowledged,
      )
    ) {
      return { status: "public_ack_required" as const };
    }
    const prepared = await prepareMutationTx(tx, {
      cardId: card.id,
      actorId: input.actorId,
      expectedVersion: input.expectedVersion,
    });
    if (prepared.status === "conflict") return prepared;
    const [countRow] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(cardVisualWallItems)
      .where(
        and(
          eq(cardVisualWallItems.wallId, prepared.wall.id),
          isNull(cardVisualWallItems.deletedAt),
        ),
      );
    if ((countRow?.count ?? 0) >= MAX_VISUAL_WALL_ITEMS) {
      throw new VisualWallError("VISUAL_WALL_ITEM_LIMIT_REACHED");
    }
    const [resource] = await tx
      .select({ id: cardResources.id })
      .from(cardResources)
      .innerJoin(
        cardAttachments,
        eq(cardResources.attachmentId, cardAttachments.id),
      )
      .innerJoin(
        cardVisualWallPreviews,
        eq(cardVisualWallPreviews.resourceId, cardResources.id),
      )
      .where(
        and(
          eq(cardResources.publicId, input.resourcePublicId),
          eq(cardResources.cardId, card.id),
          eq(cardResources.kind, "upload"),
          isNull(cardResources.deletedAt),
          isNull(cardAttachments.deletedAt),
          isNull(cardAttachments.storageQuarantinedAt),
          isNull(cardVisualWallPreviews.deletedAt),
          sql`${cardAttachments.contentType} like 'image/%'`,
        ),
      )
      .limit(1)
      .for("share", { of: cardResources });
    if (!resource) throw new VisualWallError("VISUAL_WALL_ITEM_INVALID");
    await tx.insert(cardVisualWallItems).values({
      publicId: generateUID(),
      wallId: prepared.wall.id,
      resourceId: resource.id,
      ...input.placement,
    });
    return finishMutationTx(tx, {
      wallId: prepared.wall.id,
      version: prepared.wall.version,
      actorId: input.actorId,
      created: prepared.created,
    });
  });

export const getPreviewSource = async (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    actorId: string;
    resourcePublicId: string;
  },
) =>
  db.transaction(async (tx) => {
    const card = await lockEditableCard(tx, input);
    const [source] = await tx
      .select({
        resourceId: cardResources.id,
        resourcePublicId: cardResources.publicId,
        s3Key: cardAttachments.s3Key,
        contentType: cardAttachments.contentType,
        size: cardAttachments.size,
        previewS3Key: cardVisualWallPreviews.s3Key,
        previewContentType: cardVisualWallPreviews.contentType,
        previewSize: cardVisualWallPreviews.size,
        previewSha256: cardVisualWallPreviews.sha256,
        previewWidth: cardVisualWallPreviews.width,
        previewHeight: cardVisualWallPreviews.height,
      })
      .from(cardResources)
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
          eq(cardResources.publicId, input.resourcePublicId),
          eq(cardResources.cardId, card.id),
          eq(cardResources.kind, "upload"),
          isNull(cardResources.deletedAt),
          isNull(cardAttachments.deletedAt),
          isNull(cardAttachments.storageQuarantinedAt),
          sql`${cardAttachments.contentType} in ('image/jpeg', 'image/png', 'image/webp')`,
        ),
      )
      .limit(1)
      .for("share", { of: cardResources });
    return source ?? null;
  });

export const savePreview = async (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    actorId: string;
    resourcePublicId: string;
    s3Key: string;
    contentType: "image/webp";
    size: number;
    sha256: string;
    width: number;
    height: number;
  },
) =>
  db.transaction(async (tx) => {
    const card = await lockEditableCard(tx, input);
    const [resource] = await tx
      .select({ id: cardResources.id })
      .from(cardResources)
      .innerJoin(
        cardAttachments,
        eq(cardResources.attachmentId, cardAttachments.id),
      )
      .where(
        and(
          eq(cardResources.publicId, input.resourcePublicId),
          eq(cardResources.cardId, card.id),
          eq(cardResources.kind, "upload"),
          isNull(cardResources.deletedAt),
          isNull(cardAttachments.deletedAt),
          isNull(cardAttachments.storageQuarantinedAt),
          sql`${cardAttachments.contentType} like 'image/%'`,
        ),
      )
      .limit(1)
      .for("share", { of: cardResources });
    if (!resource) throw new VisualWallError("VISUAL_WALL_ITEM_INVALID");
    const [existing] = await tx
      .select({
        id: cardVisualWallPreviews.id,
        s3Key: cardVisualWallPreviews.s3Key,
        sha256: cardVisualWallPreviews.sha256,
        deletedAt: cardVisualWallPreviews.deletedAt,
      })
      .from(cardVisualWallPreviews)
      .where(eq(cardVisualWallPreviews.resourceId, resource.id))
      .limit(1)
      .for("update");
    if (existing && existing.deletedAt === null) {
      return {
        status: "existing" as const,
        s3Key: existing.s3Key,
        sha256: existing.sha256,
      };
    }
    if (existing) {
      await tx
        .update(cardVisualWallPreviews)
        .set({
          s3Key: input.s3Key,
          contentType: input.contentType,
          size: input.size,
          sha256: input.sha256,
          width: input.width,
          height: input.height,
          deletedAt: null,
          storageDeletedAt: null,
          createdAt: new Date(),
        })
        .where(eq(cardVisualWallPreviews.id, existing.id));
      await cancelPreviewDeletionKeysTx(tx, [input.s3Key]);
      return {
        status: "created" as const,
        s3Key: input.s3Key,
        sha256: input.sha256,
      };
    }
    await tx.insert(cardVisualWallPreviews).values({
      resourceId: resource.id,
      s3Key: input.s3Key,
      contentType: input.contentType,
      size: input.size,
      sha256: input.sha256,
      width: input.width,
      height: input.height,
    });
    await cancelPreviewDeletionKeysTx(tx, [input.s3Key]);
    return {
      status: "created" as const,
      s3Key: input.s3Key,
      sha256: input.sha256,
    };
  });

export const releaseUnreferencedPreview = (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    resourcePublicId: string;
    previewS3Key: string;
  },
) =>
  db.transaction(async (tx) => {
    const [card] = await lockCardsInWorkspace(
      tx,
      [input.cardId],
      input.expectedWorkspaceId,
      { cardLock: "share" },
    );
    if (!card) return null;
    const [preview] = await tx
      .select({
        id: cardVisualWallPreviews.id,
        resourceId: cardVisualWallPreviews.resourceId,
        s3Key: cardVisualWallPreviews.s3Key,
        size: cardVisualWallPreviews.size,
      })
      .from(cardVisualWallPreviews)
      .innerJoin(
        cardResources,
        eq(cardVisualWallPreviews.resourceId, cardResources.id),
      )
      .where(
        and(
          eq(cardResources.cardId, card.id),
          eq(cardResources.publicId, input.resourcePublicId),
          eq(cardVisualWallPreviews.s3Key, input.previewS3Key),
          isNull(cardVisualWallPreviews.deletedAt),
        ),
      )
      .limit(1)
      .for("update", { of: cardVisualWallPreviews });
    if (!preview) return null;
    const [activeItem] = await tx
      .select({ id: cardVisualWallItems.id })
      .from(cardVisualWallItems)
      .where(
        and(
          eq(cardVisualWallItems.resourceId, preview.resourceId),
          isNull(cardVisualWallItems.deletedAt),
        ),
      )
      .limit(1);
    if (activeItem) return null;
    await enqueuePreviewDeletionTx(tx, preview);
    return preview.s3Key;
  });

export const getPreviewForView = async (
  db: dbClient,
  input: { resourcePublicId: string; actorId: string | null },
) =>
  db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({
        cardId: cardResources.cardId,
        workspaceId: boards.workspaceId,
        boardVisibility: boards.visibility,
      })
      .from(cardResources)
      .innerJoin(
        cardVisualWallPreviews,
        eq(cardVisualWallPreviews.resourceId, cardResources.id),
      )
      .innerJoin(
        cardVisualWallItems,
        eq(cardVisualWallItems.resourceId, cardResources.id),
      )
      .innerJoin(
        cardVisualWalls,
        eq(cardVisualWalls.id, cardVisualWallItems.wallId),
      )
      .innerJoin(
        cardAttachments,
        eq(cardResources.attachmentId, cardAttachments.id),
      )
      .innerJoin(cards, eq(cards.id, cardResources.cardId))
      .innerJoin(lists, eq(lists.id, cards.listId))
      .innerJoin(boards, eq(boards.id, lists.boardId))
      .where(
        and(
          eq(cardResources.publicId, input.resourcePublicId),
          eq(cardResources.kind, "upload"),
          isNull(cardResources.deletedAt),
          isNull(cardAttachments.deletedAt),
          isNull(cardAttachments.storageQuarantinedAt),
          isNull(cardVisualWallPreviews.deletedAt),
          isNull(cardVisualWallItems.deletedAt),
          isNull(cards.deletedAt),
          isNull(lists.deletedAt),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1);
    if (!candidate) return null;
    const isPublic = candidate.boardVisibility === "public";
    const [card] = await lockCardsInWorkspace(
      tx,
      [candidate.cardId],
      candidate.workspaceId,
      { cardLock: "share", requirePublic: isPublic },
    );
    if (!card) return null;
    if (!isPublic) {
      if (!input.actorId) return null;
      await assertWorkspacePermissionTx(tx, {
        workspaceId: candidate.workspaceId,
        userId: input.actorId,
        permission: "card:view",
      });
    }
    const [preview] = await tx
      .select({
        s3Key: cardVisualWallPreviews.s3Key,
        contentType: cardVisualWallPreviews.contentType,
        size: cardVisualWallPreviews.size,
        sha256: cardVisualWallPreviews.sha256,
        width: cardVisualWallPreviews.width,
        height: cardVisualWallPreviews.height,
      })
      .from(cardVisualWallPreviews)
      .innerJoin(
        cardResources,
        eq(cardVisualWallPreviews.resourceId, cardResources.id),
      )
      .innerJoin(
        cardVisualWallItems,
        eq(cardVisualWallItems.resourceId, cardResources.id),
      )
      .where(
        and(
          eq(cardResources.publicId, input.resourcePublicId),
          eq(cardResources.cardId, card.id),
          isNull(cardResources.deletedAt),
          isNull(cardVisualWallPreviews.deletedAt),
          isNull(cardVisualWallItems.deletedAt),
        ),
      )
      .limit(1);
    return preview ?? null;
  });

export const updateItem = (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    expectedVersion: number;
    actorId: string;
    itemPublicId: string;
    placement: VisualWallPlacement;
  },
) =>
  db.transaction(async (tx) => {
    const card = await lockEditableCard(tx, input);
    const prepared = await prepareMutationTx(tx, {
      cardId: card.id,
      actorId: input.actorId,
      expectedVersion: input.expectedVersion,
    });
    if (prepared.status === "conflict") return prepared;
    const [updated] = await tx
      .update(cardVisualWallItems)
      .set({ ...input.placement, updatedAt: new Date() })
      .where(
        and(
          eq(cardVisualWallItems.wallId, prepared.wall.id),
          eq(cardVisualWallItems.publicId, input.itemPublicId),
          isNull(cardVisualWallItems.deletedAt),
        ),
      )
      .returning({ id: cardVisualWallItems.id });
    if (!updated) throw new VisualWallError("VISUAL_WALL_ITEM_NOT_FOUND");
    return finishMutationTx(tx, {
      wallId: prepared.wall.id,
      version: prepared.wall.version,
      actorId: input.actorId,
      created: prepared.created,
    });
  });

export const removeItem = (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    expectedVersion: number;
    actorId: string;
    itemPublicId: string;
  },
) =>
  db.transaction(async (tx) => {
    const card = await lockEditableCard(tx, input);
    const prepared = await prepareMutationTx(tx, {
      cardId: card.id,
      actorId: input.actorId,
      expectedVersion: input.expectedVersion,
    });
    if (prepared.status === "conflict") return prepared;
    const removedAt = new Date();
    let [removed] = await tx
      .update(cardVisualWallItems)
      .set({ deletedAt: removedAt, updatedAt: removedAt })
      .where(
        and(
          eq(cardVisualWallItems.wallId, prepared.wall.id),
          eq(cardVisualWallItems.publicId, input.itemPublicId),
          isNotNull(cardVisualWallItems.legacyElementId),
          isNull(cardVisualWallItems.deletedAt),
        ),
      )
      .returning({
        id: cardVisualWallItems.id,
        resourceId: cardVisualWallItems.resourceId,
      });
    if (!removed) {
      [removed] = await tx
        .delete(cardVisualWallItems)
        .where(
          and(
            eq(cardVisualWallItems.wallId, prepared.wall.id),
            eq(cardVisualWallItems.publicId, input.itemPublicId),
            isNull(cardVisualWallItems.legacyElementId),
            isNull(cardVisualWallItems.deletedAt),
          ),
        )
        .returning({
          id: cardVisualWallItems.id,
          resourceId: cardVisualWallItems.resourceId,
        });
    }
    if (!removed) throw new VisualWallError("VISUAL_WALL_ITEM_NOT_FOUND");
    const [remaining] = await tx
      .select({ id: cardVisualWallItems.id })
      .from(cardVisualWallItems)
      .where(
        and(
          eq(cardVisualWallItems.resourceId, removed.resourceId),
          isNull(cardVisualWallItems.deletedAt),
        ),
      )
      .limit(1);
    let reclaimedS3Keys: string[] = [];
    if (!remaining) {
      const [preview] = await tx
        .select({
          id: cardVisualWallPreviews.id,
          s3Key: cardVisualWallPreviews.s3Key,
          size: cardVisualWallPreviews.size,
        })
        .from(cardVisualWallPreviews)
        .where(
          and(
            eq(cardVisualWallPreviews.resourceId, removed.resourceId),
            isNull(cardVisualWallPreviews.deletedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (preview) {
        await enqueuePreviewDeletionTx(tx, preview);
        reclaimedS3Keys = [preview.s3Key];
      }
    }
    const result = await finishMutationTx(tx, {
      wallId: prepared.wall.id,
      version: prepared.wall.version,
      actorId: input.actorId,
      created: prepared.created,
    });
    return { ...result, reclaimedS3Keys };
  });

export const listPendingPreviewDeletionKeys = (
  db: dbClient,
  now = new Date(),
) =>
  db
    .select({ s3Key: cardVisualWallPreviewStorageDeletions.s3Key })
    .from(cardVisualWallPreviewStorageDeletions)
    .where(
      and(
        isNull(cardVisualWallPreviewStorageDeletions.completedAt),
        lte(cardVisualWallPreviewStorageDeletions.availableAt, now),
      ),
    )
    .orderBy(
      asc(cardVisualWallPreviewStorageDeletions.attempts),
      asc(cardVisualWallPreviewStorageDeletions.id),
    )
    .limit(50);

export const countPendingPreviewDeletionKeys = (db: dbClient) =>
  db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(cardVisualWallPreviewStorageDeletions)
    .where(isNull(cardVisualWallPreviewStorageDeletions.completedAt))
    .then(([row]) => row?.count ?? 0);

export const enqueuePreviewDeletionKeys = (
  db: dbClient,
  s3Keys: readonly string[],
) =>
  s3Keys.length === 0
    ? Promise.resolve()
    : db
        .insert(cardVisualWallPreviewStorageDeletions)
        .values([...new Set(s3Keys)].map((s3Key) => ({ s3Key })))
        .onConflictDoUpdate({
          target: cardVisualWallPreviewStorageDeletions.s3Key,
          set: {
            attempts: 0,
            lastAttemptAt: null,
            availableAt: new Date(),
            completedAt: null,
          },
        });

export const reservePreviewDeletionKeys = (
  db: dbClient,
  s3Keys: readonly string[],
  availableAt = new Date(Date.now() + 60 * 60 * 1000),
) =>
  s3Keys.length === 0
    ? Promise.resolve()
    : db
        .insert(cardVisualWallPreviewStorageDeletions)
        .values([...new Set(s3Keys)].map((s3Key) => ({ s3Key, availableAt })))
        .onConflictDoNothing({
          target: cardVisualWallPreviewStorageDeletions.s3Key,
        });

export const renewPreviewDeletionKeyReservations = (
  db: dbClient,
  s3Keys: readonly string[],
  availableAt = new Date(Date.now() + 60 * 60 * 1000),
) =>
  s3Keys.length === 0
    ? Promise.resolve()
    : db
        .update(cardVisualWallPreviewStorageDeletions)
        .set({ availableAt })
        .where(
          and(
            inArray(cardVisualWallPreviewStorageDeletions.s3Key, [
              ...new Set(s3Keys),
            ]),
            isNull(cardVisualWallPreviewStorageDeletions.completedAt),
          ),
        );

export const releaseUnreferencedStorageKeys = (
  db: dbClient,
  s3Keys: readonly string[],
) =>
  db.transaction(async (tx) => {
    const uniqueKeys = [...new Set(s3Keys)];
    if (uniqueKeys.length === 0) return [];
    const [attachmentReferences, previewReferences] = await Promise.all([
      tx
        .select({ s3Key: cardAttachments.s3Key })
        .from(cardAttachments)
        .where(
          and(
            inArray(cardAttachments.s3Key, uniqueKeys),
            isNull(cardAttachments.deletedAt),
          ),
        ),
      tx
        .select({ s3Key: cardVisualWallPreviews.s3Key })
        .from(cardVisualWallPreviews)
        .where(
          and(
            inArray(cardVisualWallPreviews.s3Key, uniqueKeys),
            isNull(cardVisualWallPreviews.deletedAt),
          ),
        ),
    ]);
    const referenced = new Set([
      ...attachmentReferences.map((row) => row.s3Key),
      ...previewReferences.map((row) => row.s3Key),
    ]);
    const referencedKeys = uniqueKeys.filter((key) => referenced.has(key));
    const unreferencedKeys = uniqueKeys.filter((key) => !referenced.has(key));
    await cancelPreviewDeletionKeysTx(tx, referencedKeys);
    if (unreferencedKeys.length > 0) {
      await tx
        .update(cardVisualWallPreviewStorageDeletions)
        .set({ availableAt: new Date(), completedAt: null })
        .where(
          inArray(
            cardVisualWallPreviewStorageDeletions.s3Key,
            unreferencedKeys,
          ),
        );
    }
    return unreferencedKeys;
  });

export const markPreviewDeletionAttempted = (db: dbClient, s3Keys: string[]) =>
  s3Keys.length === 0
    ? Promise.resolve()
    : db
        .update(cardVisualWallPreviewStorageDeletions)
        .set({
          attempts: sql`${cardVisualWallPreviewStorageDeletions.attempts} + 1`,
          lastAttemptAt: new Date(),
        })
        .where(
          and(
            inArray(cardVisualWallPreviewStorageDeletions.s3Key, s3Keys),
            isNull(cardVisualWallPreviewStorageDeletions.completedAt),
          ),
        );

export const markPreviewStorageDeleted = (db: dbClient, s3Keys: string[]) =>
  s3Keys.length === 0
    ? Promise.resolve()
    : db.transaction(async (tx) => {
        const now = new Date();
        await tx
          .update(cardVisualWallPreviews)
          .set({ storageDeletedAt: now })
          .where(
            and(
              inArray(cardVisualWallPreviews.s3Key, s3Keys),
              isNotNull(cardVisualWallPreviews.deletedAt),
            ),
          );
        await tx
          .delete(cardVisualWallPreviewStorageDeletions)
          .where(inArray(cardVisualWallPreviewStorageDeletions.s3Key, s3Keys));
      });

export const setFreeformLink = (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    expectedVersion: number;
    actorId: string;
    freeformUrl: string | null;
    publicVisibilityAcknowledged: boolean;
  },
) =>
  db.transaction(async (tx) => {
    const card = await lockEditableCard(tx, input);
    if (
      input.freeformUrl &&
      (await requiresPublicAcknowledgement(
        tx,
        card.boardId,
        input.publicVisibilityAcknowledged,
      ))
    ) {
      return { status: "public_ack_required" as const };
    }
    const prepared = await prepareMutationTx(tx, {
      cardId: card.id,
      actorId: input.actorId,
      expectedVersion: input.expectedVersion,
    });
    if (prepared.status === "conflict") return prepared;
    await tx
      .update(cardVisualWalls)
      .set({ freeformUrl: input.freeformUrl })
      .where(eq(cardVisualWalls.id, prepared.wall.id));
    return finishMutationTx(tx, {
      wallId: prepared.wall.id,
      version: prepared.wall.version,
      actorId: input.actorId,
      created: prepared.created,
    });
  });
