import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardAttachments,
  cardResources,
  cardVisualWallItems,
  cardVisualWallPreviews,
  cardVisualWalls,
  cards,
  lists,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";
import { MAX_CARD_VISUAL_WALL_WORKSPACE_PHYSICAL_BYTES } from "@kan/shared";

import type { DbTransaction } from "./cardPipeline.internal";

export interface CardVisualWallCloneSource {
  sourceWallVersion: number;
  sourceResourcePublicId: string;
  attachment: {
    sourceS3Key: string;
    filename: string;
    originalFilename: string;
    contentType: string;
    size: number;
    sha256: string | null;
  };
  preview: {
    sourceS3Key: string;
    contentType: string;
    size: number;
    sha256: string;
    width: number;
    height: number;
  };
}

export interface PreparedCardVisualWallUploadClone
  extends CardVisualWallCloneSource {
  destinationAttachmentS3Key: string;
  destinationPreviewS3Key: string;
  attachmentSha256: string;
}

export class CardVisualWallCloneStorageQuotaError extends Error {
  constructor() {
    super("VISUAL_WALL_CLONE_STORAGE_QUOTA_REACHED");
    this.name = "CardVisualWallCloneStorageQuotaError";
  }
}

const getWorkspacePhysicalUsageTx = async (
  tx: DbTransaction,
  workspaceId: number,
) => {
  const [[attachmentUsage], [previewUsage]] = await Promise.all([
    tx
      .select({
        bytes: sql<number>`coalesce(sum(${cardAttachments.size}), 0)`.mapWith(
          Number,
        ),
      })
      .from(cardAttachments)
      .innerJoin(cards, eq(cardAttachments.cardId, cards.id))
      .innerJoin(lists, eq(cards.listId, lists.id))
      .innerJoin(boards, eq(lists.boardId, boards.id))
      .where(
        and(
          eq(boards.workspaceId, workspaceId),
          isNull(cardAttachments.deletedAt),
          isNull(cards.deletedAt),
          isNull(lists.deletedAt),
          isNull(boards.deletedAt),
        ),
      ),
    tx
      .select({
        bytes: sql<number>`coalesce(sum(${cardVisualWallPreviews.size}), 0)`.mapWith(
          Number,
        ),
      })
      .from(cardVisualWallPreviews)
      .innerJoin(
        cardResources,
        eq(cardVisualWallPreviews.resourceId, cardResources.id),
      )
      .innerJoin(cards, eq(cardResources.cardId, cards.id))
      .innerJoin(lists, eq(cards.listId, lists.id))
      .innerJoin(boards, eq(lists.boardId, boards.id))
      .where(
        and(
          eq(boards.workspaceId, workspaceId),
          isNull(cardVisualWallPreviews.deletedAt),
          isNull(cardResources.deletedAt),
          isNull(cards.deletedAt),
          isNull(lists.deletedAt),
          isNull(boards.deletedAt),
        ),
      ),
  ]);
  return (attachmentUsage?.bytes ?? 0) + (previewUsage?.bytes ?? 0);
};

export const getWorkspaceVisualWallClonePhysicalUsage = (
  db: dbClient,
  workspaceId: number,
) => db.transaction((tx) => getWorkspacePhysicalUsageTx(tx, workspaceId));

export const assertWorkspaceVisualWallCloneQuotaTx = async (
  tx: DbTransaction,
  input: { workspaceId: number; additionalBytes: number },
) => {
  const currentBytes = await getWorkspacePhysicalUsageTx(tx, input.workspaceId);
  if (
    currentBytes + input.additionalBytes >
    MAX_CARD_VISUAL_WALL_WORKSPACE_PHYSICAL_BYTES
  ) {
    throw new CardVisualWallCloneStorageQuotaError();
  }
};

const cardCloneSourceWhere = (input: {
  sourceCardId: number;
  expectedWorkspaceId: number;
}) =>
  and(
    eq(cardVisualWalls.cardId, input.sourceCardId),
    eq(boards.workspaceId, input.expectedWorkspaceId),
    eq(cardResources.cardId, input.sourceCardId),
    eq(cardResources.kind, "upload"),
    isNull(cardVisualWallItems.deletedAt),
    isNull(cardResources.deletedAt),
    isNull(cardAttachments.deletedAt),
    isNull(cardAttachments.storageQuarantinedAt),
    isNull(cardVisualWallPreviews.deletedAt),
    isNull(cards.deletedAt),
    isNull(lists.deletedAt),
    isNull(boards.deletedAt),
  );

export const getCardVisualWallCloneBudget = (
  db: dbClient,
  input: { sourceCardId: number; expectedWorkspaceId: number },
) => {
  const sources = db
    .selectDistinct({
      resourceId: cardResources.id,
      sourceBytes:
        sql<number>`${cardAttachments.size} + ${cardVisualWallPreviews.size}`
          .mapWith(Number)
          .as("sourceBytes"),
    })
    .from(cardVisualWallItems)
    .innerJoin(cardVisualWalls, eq(cardVisualWallItems.wallId, cardVisualWalls.id))
    .innerJoin(cardResources, eq(cardVisualWallItems.resourceId, cardResources.id))
    .innerJoin(cardAttachments, eq(cardResources.attachmentId, cardAttachments.id))
    .innerJoin(
      cardVisualWallPreviews,
      eq(cardVisualWallPreviews.resourceId, cardResources.id),
    )
    .innerJoin(cards, eq(cardVisualWalls.cardId, cards.id))
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .where(cardCloneSourceWhere(input))
    .as("cardVisualWallCloneSources");
  return db
    .select({
      resourceCount: sql<number>`count(*)`.mapWith(Number),
      sourceBytes:
        sql<number>`coalesce(sum(${sources.sourceBytes}), 0)`.mapWith(Number),
    })
    .from(sources)
    .then(([budget]) => ({
      resourceCount: budget?.resourceCount ?? 0,
      sourceBytes: budget?.sourceBytes ?? 0,
    }));
};

const boardCloneSourceWhere = (input: {
  sourceBoardId: number;
  expectedWorkspaceId: number;
}) =>
  and(
    eq(boards.id, input.sourceBoardId),
    eq(boards.workspaceId, input.expectedWorkspaceId),
    eq(cardResources.cardId, cards.id),
    eq(cardResources.kind, "upload"),
    isNull(cardVisualWallItems.deletedAt),
    isNull(cardResources.deletedAt),
    isNull(cardAttachments.deletedAt),
    isNull(cardAttachments.storageQuarantinedAt),
    isNull(cardVisualWallPreviews.deletedAt),
    isNull(cards.deletedAt),
    isNull(lists.deletedAt),
    isNull(boards.deletedAt),
  );

export const getBoardVisualWallCloneBudget = async (
  db: dbClient,
  input: { sourceBoardId: number; expectedWorkspaceId: number },
) => {
  const sources = db
    .selectDistinct({
      resourceId: cardResources.id,
      sourceBytes:
        sql<number>`${cardAttachments.size} + ${cardVisualWallPreviews.size}`
          .mapWith(Number)
          .as("sourceBytes"),
    })
    .from(cardVisualWallItems)
    .innerJoin(cardVisualWalls, eq(cardVisualWallItems.wallId, cardVisualWalls.id))
    .innerJoin(cardResources, eq(cardVisualWallItems.resourceId, cardResources.id))
    .innerJoin(cardAttachments, eq(cardResources.attachmentId, cardAttachments.id))
    .innerJoin(
      cardVisualWallPreviews,
      eq(cardVisualWallPreviews.resourceId, cardResources.id),
    )
    .innerJoin(cards, eq(cardVisualWalls.cardId, cards.id))
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .where(boardCloneSourceWhere(input))
    .as("boardVisualWallCloneSources");
  return db
    .select({
      resourceCount: sql<number>`count(*)`.mapWith(Number),
      sourceBytes:
        sql<number>`coalesce(sum(${sources.sourceBytes}), 0)`.mapWith(Number),
    })
    .from(sources)
    .then(([budget]) => ({
      resourceCount: budget?.resourceCount ?? 0,
      sourceBytes: budget?.sourceBytes ?? 0,
    }));
};

export const getCardVisualWallCloneSources = (
  db: dbClient,
  input: {
    sourceCardId: number;
    expectedWorkspaceId: number;
    maxResources: number;
  },
) =>
  db
    .selectDistinct({
      sourceWallVersion: cardVisualWalls.version,
      sourceResourcePublicId: cardResources.publicId,
      attachment: {
        sourceS3Key: cardAttachments.s3Key,
        filename: cardAttachments.filename,
        originalFilename: cardAttachments.originalFilename,
        contentType: cardAttachments.contentType,
        size: cardAttachments.size,
        sha256: cardAttachments.sha256,
      },
      preview: {
        sourceS3Key: cardVisualWallPreviews.s3Key,
        contentType: cardVisualWallPreviews.contentType,
        size: cardVisualWallPreviews.size,
        sha256: cardVisualWallPreviews.sha256,
        width: cardVisualWallPreviews.width,
        height: cardVisualWallPreviews.height,
      },
    })
    .from(cardVisualWallItems)
    .innerJoin(cardVisualWalls, eq(cardVisualWallItems.wallId, cardVisualWalls.id))
    .innerJoin(cardResources, eq(cardVisualWallItems.resourceId, cardResources.id))
    .innerJoin(cardAttachments, eq(cardResources.attachmentId, cardAttachments.id))
    .innerJoin(
      cardVisualWallPreviews,
      eq(cardVisualWallPreviews.resourceId, cardResources.id),
    )
    .innerJoin(cards, eq(cardVisualWalls.cardId, cards.id))
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .where(cardCloneSourceWhere(input))
    .orderBy(asc(cardResources.id))
    .limit(input.maxResources + 1);

export const getBoardVisualWallCloneSources = (
  db: dbClient,
  input: {
    sourceBoardId: number;
    expectedWorkspaceId: number;
    maxResources: number;
  },
) =>
  db
    .selectDistinct({
      sourceCardId: cards.id,
      sourceWallVersion: cardVisualWalls.version,
      sourceResourcePublicId: cardResources.publicId,
      attachment: {
        sourceS3Key: cardAttachments.s3Key,
        filename: cardAttachments.filename,
        originalFilename: cardAttachments.originalFilename,
        contentType: cardAttachments.contentType,
        size: cardAttachments.size,
        sha256: cardAttachments.sha256,
      },
      preview: {
        sourceS3Key: cardVisualWallPreviews.s3Key,
        contentType: cardVisualWallPreviews.contentType,
        size: cardVisualWallPreviews.size,
        sha256: cardVisualWallPreviews.sha256,
        width: cardVisualWallPreviews.width,
        height: cardVisualWallPreviews.height,
      },
    })
    .from(cardVisualWallItems)
    .innerJoin(cardVisualWalls, eq(cardVisualWallItems.wallId, cardVisualWalls.id))
    .innerJoin(cardResources, eq(cardVisualWallItems.resourceId, cardResources.id))
    .innerJoin(cardAttachments, eq(cardResources.attachmentId, cardAttachments.id))
    .innerJoin(
      cardVisualWallPreviews,
      eq(cardVisualWallPreviews.resourceId, cardResources.id),
    )
    .innerJoin(cards, eq(cardVisualWalls.cardId, cards.id))
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .where(boardCloneSourceWhere(input))
    .orderBy(asc(cards.id), asc(cardResources.id))
    .limit(input.maxResources + 1);

export async function cloneCardVisualWallTx(
  tx: DbTransaction,
  input: {
    sourceCardId: number;
    destinationCardId: number;
    createdBy: string;
    resourcePublicIdBySourcePublicId: ReadonlyMap<string, string>;
  },
) {
  const [sourceWall] = await tx
    .select({ id: cardVisualWalls.id })
    .from(cardVisualWalls)
    .where(eq(cardVisualWalls.cardId, input.sourceCardId))
    .limit(1)
    .for("share");
  if (!sourceWall) return { status: "no_wall" as const };
  const sourceItems = await tx
    .select({
      resourcePublicId: cardResources.publicId,
      x: cardVisualWallItems.x,
      y: cardVisualWallItems.y,
      width: cardVisualWallItems.width,
      height: cardVisualWallItems.height,
      zIndex: cardVisualWallItems.zIndex,
    })
    .from(cardVisualWallItems)
    .innerJoin(cardResources, eq(cardVisualWallItems.resourceId, cardResources.id))
    .where(
      and(
        eq(cardVisualWallItems.wallId, sourceWall.id),
        isNull(cardVisualWallItems.deletedAt),
      ),
    )
    .orderBy(asc(cardVisualWallItems.id));
  const mapped = sourceItems.flatMap((item) => {
    const publicId = input.resourcePublicIdBySourcePublicId.get(
      item.resourcePublicId,
    );
    return publicId ? [{ ...item, publicId }] : [];
  });
  if (mapped.length === 0) return { status: "no_items" as const };
  const targetResources = await tx
    .select({ id: cardResources.id, publicId: cardResources.publicId })
    .from(cardResources)
    .where(
      inArray(
        cardResources.publicId,
        mapped.map((item) => item.publicId),
      ),
    );
  const resourceIdByPublicId = new Map(
    targetResources.map((resource) => [resource.publicId, resource.id]),
  );
  const [wall] = await tx
    .insert(cardVisualWalls)
    .values({
      cardId: input.destinationCardId,
      version: 1,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
      freeformUrl: null,
    })
    .returning({ id: cardVisualWalls.id });
  if (!wall) throw new Error("Failed to clone card visual wall");
  const items = mapped.flatMap((item) => {
    const resourceId = resourceIdByPublicId.get(item.publicId);
    return resourceId
      ? [
          {
            publicId: generateUID(),
            wallId: wall.id,
            resourceId,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            zIndex: item.zIndex,
          },
        ]
      : [];
  });
  if (items.length > 0) await tx.insert(cardVisualWallItems).values(items);
  return { status: "cloned" as const, itemCount: items.length };
}
