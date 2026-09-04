import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { CardResourceDriveType } from "@kan/db/schema";
import {
  boards,
  cardActivities,
  cardAttachments,
  cardAttachmentUploadSessions,
  cardResources,
  cards,
  cardSubtaskResources,
  cardSubtasks,
  cardVisualWallItems,
  cardVisualWallPreviews,
  cardVisualWallPreviewStorageDeletions,
  lists,
  workspaces,
} from "@kan/db/schema";
import { extractCardCanvasReferences } from "@kan/shared";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";
import { hasValidAttachmentStorageOwnership } from "./cardAttachment.repo";
import { getCanvasHeadForUpdateTx } from "./cardCanvas.internal";
import {
  assertWorkspacePermissionTx,
  lockCardsInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

const activeResource = and(
  isNull(cardResources.deletedAt),
  or(
    eq(cardResources.kind, "drive"),
    eq(cardResources.kind, "web"),
    and(
      eq(cardResources.kind, "upload"),
      isNull(cardAttachments.deletedAt),
      isNull(cardAttachments.storageQuarantinedAt),
    ),
  ),
);

export const getSummaryByCardIds = async (
  db: dbClient | DbTransaction,
  cardIds: number[],
) => {
  if (cardIds.length === 0) return new Map<number, ResourceSummary>();
  const rows = await db
    .select({
      cardId: cardResources.cardId,
      uploads:
        sql<number>`count(*) filter (where ${cardResources.kind} = 'upload' and ${cardAttachments.deletedAt} is null and ${cardAttachments.storageQuarantinedAt} is null)`.mapWith(
          Number,
        ),
      driveLinks:
        sql<number>`count(*) filter (where ${cardResources.kind} = 'drive')`.mapWith(
          Number,
        ),
      webLinks:
        sql<number>`count(*) filter (where ${cardResources.kind} = 'web')`.mapWith(
          Number,
        ),
    })
    .from(cardResources)
    .leftJoin(
      cardAttachments,
      eq(cardResources.attachmentId, cardAttachments.id),
    )
    .where(
      and(
        inArray(cardResources.cardId, cardIds),
        isNull(cardResources.deletedAt),
      ),
    )
    .groupBy(cardResources.cardId);

  return new Map(
    rows.map((row) => [
      row.cardId,
      {
        uploads: row.uploads,
        driveLinks: row.driveLinks,
        webLinks: row.webLinks,
        total: row.uploads + row.driveLinks + row.webLinks,
      },
    ]),
  );
};

export interface ResourceSummary {
  total: number;
  uploads: number;
  driveLinks: number;
  webLinks: number;
}

export const emptyResourceSummary = (): ResourceSummary => ({
  total: 0,
  uploads: 0,
  driveLinks: 0,
  webLinks: 0,
});

export const getSummaryByCardId = async (
  db: dbClient | DbTransaction,
  cardId: number,
) =>
  (await getSummaryByCardIds(db, [cardId])).get(cardId) ??
  emptyResourceSummary();

export const getSummariesByCardPublicIds = async (
  db: dbClient | DbTransaction,
  cardPublicIds: string[],
) => {
  if (cardPublicIds.length === 0) return new Map<string, ResourceSummary>();
  const cardRows = await db
    .select({ id: cards.id, publicId: cards.publicId })
    .from(cards)
    .where(
      and(inArray(cards.publicId, cardPublicIds), isNull(cards.deletedAt)),
    );
  const byCardId = await getSummaryByCardIds(
    db,
    cardRows.map((card) => card.id),
  );
  return new Map(
    cardRows.map((card) => [
      card.publicId,
      byCardId.get(card.id) ?? emptyResourceSummary(),
    ]),
  );
};

export const listByCardId = (db: dbClient | DbTransaction, cardId: number) =>
  db
    .select({
      publicId: cardResources.publicId,
      kind: cardResources.kind,
      title: cardResources.title,
      driveType: cardResources.driveType,
      driveFileId: cardResources.driveFileId,
      resourceKey: cardResources.resourceKey,
      webUrl: cardResources.webUrl,
      webUrlHash: cardResources.webUrlHash,
      webDescription: cardResources.webDescription,
      webSiteName: cardResources.webSiteName,
      webImageUrl: cardResources.webImageUrl,
      contentType: cardAttachments.contentType,
      originalFilename: cardAttachments.originalFilename,
      size: cardAttachments.size,
      createdAt: cardResources.createdAt,
    })
    .from(cardResources)
    .leftJoin(
      cardAttachments,
      eq(cardResources.attachmentId, cardAttachments.id),
    )
    .where(and(eq(cardResources.cardId, cardId), activeResource))
    .orderBy(asc(cardResources.createdAt), asc(cardResources.publicId));

export const getListSnapshot = async (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    requirePublic: boolean;
  },
) =>
  db.transaction(async (tx) => {
    await lockCardsInWorkspace(tx, [input.cardId], input.expectedWorkspaceId, {
      cardLock: "share",
      requirePublic: input.requirePublic,
    });
    const resources = await listByCardId(tx, input.cardId);
    const summary = await getSummaryByCardId(tx, input.cardId);
    return { resources, summary };
  });

export const createDrive = async (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    title: string;
    driveType: CardResourceDriveType;
    driveFileId: string;
    resourceKey: string | null;
    createdBy: string;
    publicVisibilityAcknowledged: boolean;
  },
) =>
  db.transaction(async (tx) => {
    const [card] = await lockCardsInWorkspace(
      tx,
      [input.cardId],
      input.expectedWorkspaceId,
      { cardLock: "update" },
    );
    if (!card) throw new WorkspaceChangedError();
    const [board] = await tx.query.boards.findMany({
      columns: { visibility: true },
      where: (boards, { eq }) => eq(boards.id, card.boardId),
      limit: 1,
    });
    if (!board) throw new WorkspaceChangedError();
    if (board.visibility === "public" && !input.publicVisibilityAcknowledged) {
      return { status: "public_ack_required" as const };
    }

    const [existing] = await tx
      .select({
        id: cardResources.id,
        publicId: cardResources.publicId,
        title: cardResources.title,
        resourceKey: cardResources.resourceKey,
      })
      .from(cardResources)
      .where(
        and(
          eq(cardResources.cardId, card.id),
          eq(cardResources.kind, "drive"),
          eq(cardResources.driveType, input.driveType),
          eq(cardResources.driveFileId, input.driveFileId),
          isNull(cardResources.deletedAt),
        ),
      )
      .limit(1);
    if (existing) {
      const nextResourceKey = input.resourceKey ?? existing.resourceKey;
      if (
        existing.title !== input.title ||
        existing.resourceKey !== nextResourceKey
      ) {
        await tx
          .update(cardResources)
          .set({
            title: input.title,
            resourceKey: nextResourceKey,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(cardResources.id, existing.id),
              isNull(cardResources.deletedAt),
            ),
          );
      }
      return { status: "existing" as const, publicId: existing.publicId };
    }

    const publicId = generateUID();
    const [resource] = await tx
      .insert(cardResources)
      .values({
        publicId,
        cardId: card.id,
        kind: "drive",
        title: input.title,
        driveType: input.driveType,
        driveFileId: input.driveFileId,
        resourceKey: input.resourceKey,
        createdBy: input.createdBy,
      })
      .returning({ publicId: cardResources.publicId });
    if (!resource) throw new Error("Unable to create card resource");
    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.resource.added",
      cardId: card.id,
      toTitle: input.title,
      createdBy: input.createdBy,
    });
    return { status: "created" as const, publicId };
  });

export const MAX_ACTIVE_WEB_RESOURCES_PER_CARD = 100;

export const reserveWeb = async (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    webUrl: string;
    fallbackTitle: string;
    createdBy: string;
    publicVisibilityAcknowledged: boolean;
  },
) =>
  db.transaction(async (tx) => {
    const [card] = await lockCardsInWorkspace(
      tx,
      [input.cardId],
      input.expectedWorkspaceId,
      { cardLock: "update" },
    );
    if (!card) throw new WorkspaceChangedError();
    const [board] = await tx.query.boards.findMany({
      columns: { visibility: true },
      where: (boards, { eq }) => eq(boards.id, card.boardId),
      limit: 1,
    });
    if (!board) throw new WorkspaceChangedError();
    if (board.visibility === "public" && !input.publicVisibilityAcknowledged) {
      return { status: "public_ack_required" as const };
    }

    const webUrlHash = createHash("sha256").update(input.webUrl).digest("hex");
    const [existing] = await tx
      .select({
        publicId: cardResources.publicId,
      })
      .from(cardResources)
      .where(
        and(
          eq(cardResources.cardId, card.id),
          eq(cardResources.kind, "web"),
          eq(cardResources.webUrlHash, webUrlHash),
          isNull(cardResources.deletedAt),
        ),
      )
      .limit(1);
    if (existing) {
      return { status: "existing" as const, publicId: existing.publicId };
    }

    const [activeWebCount] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(cardResources)
      .where(
        and(
          eq(cardResources.cardId, card.id),
          eq(cardResources.kind, "web"),
          isNull(cardResources.deletedAt),
        ),
      );
    if ((activeWebCount?.count ?? 0) >= MAX_ACTIVE_WEB_RESOURCES_PER_CARD) {
      return { status: "limit_reached" as const };
    }

    const publicId = generateUID();
    const [resource] = await tx
      .insert(cardResources)
      .values({
        publicId,
        cardId: card.id,
        kind: "web",
        title: input.fallbackTitle,
        webUrl: input.webUrl,
        webUrlHash,
        webSiteName: input.fallbackTitle,
        createdBy: input.createdBy,
      })
      .returning({ publicId: cardResources.publicId });
    if (!resource) throw new Error("Unable to create card resource");
    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.resource.added",
      cardId: card.id,
      toTitle: input.fallbackTitle,
      createdBy: input.createdBy,
    });
    return { status: "created" as const, publicId };
  });

export const updateWebMetadata = async (
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    resourcePublicId: string;
    title: string;
    description: string | null;
    siteName: string | null;
    imageUrl: string | null;
  },
) =>
  db.transaction(async (tx) => {
    const [card] = await lockCardsInWorkspace(
      tx,
      [input.cardId],
      input.expectedWorkspaceId,
      { cardLock: "update" },
    );
    if (!card) throw new WorkspaceChangedError();

    const [resource] = await tx
      .update(cardResources)
      .set({
        title: input.title,
        webDescription: input.description,
        webSiteName: input.siteName,
        webImageUrl: input.imageUrl,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(cardResources.publicId, input.resourcePublicId),
          eq(cardResources.cardId, card.id),
          eq(cardResources.kind, "web"),
          isNull(cardResources.deletedAt),
        ),
      )
      .returning({ publicId: cardResources.publicId });
    return resource
      ? { status: "updated" as const, publicId: resource.publicId }
      : { status: "not_found" as const };
  });

export const getWebPreviewContextByPublicId = async (
  db: dbClient,
  publicId: string,
) => {
  const [resource] = await db
    .select({
      publicId: cardResources.publicId,
      workspaceId: boards.workspaceId,
      boardVisibility: boards.visibility,
      imageUrl: cardResources.webImageUrl,
    })
    .from(cardResources)
    .innerJoin(cards, eq(cardResources.cardId, cards.id))
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
    .where(
      and(
        eq(cardResources.publicId, publicId),
        eq(cardResources.kind, "web"),
        isNotNull(cardResources.webImageUrl),
        isNull(cardResources.deletedAt),
        isNull(cards.deletedAt),
        isNull(lists.deletedAt),
        isNull(boards.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);
  return resource ?? null;
};

export const getByPublicId = async (db: dbClient, publicId: string) => {
  const [resource] = await db
    .select({
      id: cardResources.id,
      publicId: cardResources.publicId,
      cardId: cardResources.cardId,
      kind: cardResources.kind,
      title: cardResources.title,
      attachmentId: cardResources.attachmentId,
      attachmentPublicId: cardAttachments.publicId,
      s3Key: cardAttachments.s3Key,
      deletedAt: cardResources.deletedAt,
    })
    .from(cardResources)
    .leftJoin(
      cardAttachments,
      eq(cardResources.attachmentId, cardAttachments.id),
    )
    .where(and(eq(cardResources.publicId, publicId), activeResource))
    .limit(1);
  return resource ?? null;
};

export const getContextByPublicId = async (db: dbClient, publicId: string) => {
  const [resource] = await db
    .select({
      publicId: cardResources.publicId,
      cardId: cards.id,
      cardPublicId: cards.publicId,
      workspaceId: boards.workspaceId,
      boardVisibility: boards.visibility,
      kind: cardResources.kind,
    })
    .from(cardResources)
    .innerJoin(cards, eq(cardResources.cardId, cards.id))
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .leftJoin(
      cardAttachments,
      eq(cardResources.attachmentId, cardAttachments.id),
    )
    .where(
      and(
        eq(cardResources.publicId, publicId),
        activeResource,
        isNull(cards.deletedAt),
        isNull(lists.deletedAt),
        isNull(boards.deletedAt),
      ),
    )
    .limit(1);
  return resource ?? null;
};

export const softDeleteWithWorkspaceGuard = async (
  db: dbClient,
  input: {
    resourcePublicId: string;
    expectedWorkspaceId: number;
    deletedBy: string;
    removeReferences: boolean;
  },
) =>
  db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ cardId: cardResources.cardId })
      .from(cardResources)
      .where(
        and(
          eq(cardResources.publicId, input.resourcePublicId),
          isNull(cardResources.deletedAt),
        ),
      )
      .limit(1);
    if (!candidate) return { status: "not_found" as const };
    const [card] = await lockCardsInWorkspace(
      tx,
      [candidate.cardId],
      input.expectedWorkspaceId,
      { cardLock: "update" },
    );
    if (!card) return { status: "workspace_changed" as const };
    await assertWorkspacePermissionTx(tx, {
      workspaceId: input.expectedWorkspaceId,
      userId: input.deletedBy,
      permission: "card:edit",
    });
    const canvasHead = await getCanvasHeadForUpdateTx(tx, card.id);
    const canvasReferenceCount = canvasHead
      ? extractCardCanvasReferences(canvasHead.scene).resources.filter(
          (reference) => reference.publicId === input.resourcePublicId,
        ).length
      : 0;

    const [row] = await tx
      .select({
        id: cardResources.id,
        kind: cardResources.kind,
        title: cardResources.title,
        attachmentId: cardResources.attachmentId,
        attachmentPublicId: cardAttachments.publicId,
        s3Key: cardAttachments.s3Key,
        uploadSessionId: cardAttachments.uploadSessionId,
        storageQuarantinedAt: cardAttachments.storageQuarantinedAt,
        uploadSessionCardId: cardAttachmentUploadSessions.cardId,
        uploadSessionConsumedAt: cardAttachmentUploadSessions.consumedAt,
        workspacePublicId: workspaces.publicId,
      })
      .from(cardResources)
      .leftJoin(
        cardAttachments,
        eq(cardResources.attachmentId, cardAttachments.id),
      )
      .leftJoin(
        cardAttachmentUploadSessions,
        eq(cardAttachments.uploadSessionId, cardAttachmentUploadSessions.id),
      )
      .innerJoin(cards, eq(cardResources.cardId, cards.id))
      .innerJoin(lists, eq(cards.listId, lists.id))
      .innerJoin(boards, eq(lists.boardId, boards.id))
      .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
      .where(
        and(
          eq(cardResources.publicId, input.resourcePublicId),
          eq(cardResources.cardId, card.id),
          eq(workspaces.id, input.expectedWorkspaceId),
          isNull(cardResources.deletedAt),
          isNull(cards.deletedAt),
          isNull(lists.deletedAt),
          isNull(boards.deletedAt),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1)
      .for("update", { of: cardResources });
    if (!row) return { status: "not_found" as const };

    const [usage] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(cardSubtaskResources)
      .innerJoin(
        cardSubtasks,
        eq(cardSubtaskResources.subtaskId, cardSubtasks.id),
      )
      .where(
        and(
          or(
            eq(cardSubtaskResources.resourceId, row.id),
            and(
              isNull(cardSubtaskResources.resourceId),
              row.attachmentId === null
                ? eq(cardSubtaskResources.resourceId, row.id)
                : eq(cardSubtaskResources.attachmentId, row.attachmentId),
            ),
          ),
          isNull(cardSubtaskResources.deletedAt),
          isNull(cardSubtasks.deletedAt),
        ),
      );
    const referenceCount = usage?.count ?? 0;
    const [wallUsage] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(cardVisualWallItems)
      .where(
        and(
          eq(cardVisualWallItems.resourceId, row.id),
          isNull(cardVisualWallItems.deletedAt),
        ),
      );
    const visualWallReferenceCount = wallUsage?.count ?? 0;
    if (
      visualWallReferenceCount > 0 ||
      (referenceCount > 0 && !input.removeReferences) ||
      canvasReferenceCount > 0
    ) {
      if (canvasReferenceCount > 0 && canvasHead) {
        return {
          status: "in_use" as const,
          referenceCount,
          canvasReferenceCount,
          canvasVersion: canvasHead.version,
        };
      }
      return {
        status: "in_use" as const,
        referenceCount,
        visualWallReferenceCount,
      };
    }

    let uploadAttachmentId: number | null = null;
    if (row.kind === "upload") {
      if (
        row.attachmentId === null ||
        row.attachmentPublicId === null ||
        row.s3Key === null ||
        row.storageQuarantinedAt ||
        !hasValidAttachmentStorageOwnership({
          s3Key: row.s3Key,
          uploadSessionId: row.uploadSessionId,
          uploadSession:
            row.uploadSessionId === null || row.uploadSessionCardId === null
              ? null
              : {
                  id: row.uploadSessionId,
                  cardId: row.uploadSessionCardId,
                  consumedAt: row.uploadSessionConsumedAt,
                },
          card: {
            id: card.id,
            publicId: card.publicId,
            list: {
              board: {
                workspace: {
                  id: input.expectedWorkspaceId,
                  publicId: row.workspacePublicId,
                },
              },
            },
          },
        })
      ) {
        return { status: "invalid_storage" as const };
      }
      uploadAttachmentId = row.attachmentId;
    }

    const deletedAt = new Date();
    const [orphanedPreview] = await tx
      .update(cardVisualWallPreviews)
      .set({ deletedAt })
      .where(
        and(
          eq(cardVisualWallPreviews.resourceId, row.id),
          isNull(cardVisualWallPreviews.deletedAt),
        ),
      )
      .returning({
        s3Key: cardVisualWallPreviews.s3Key,
        size: cardVisualWallPreviews.size,
      });
    if (orphanedPreview) {
      await tx
        .insert(cardVisualWallPreviewStorageDeletions)
        .values({
          s3Key: orphanedPreview.s3Key,
          size: orphanedPreview.size,
        })
        .onConflictDoUpdate({
          target: cardVisualWallPreviewStorageDeletions.s3Key,
          set: {
            size: orphanedPreview.size,
            attempts: 0,
            lastAttemptAt: null,
            availableAt: deletedAt,
            completedAt: null,
          },
        });
    }
    if (referenceCount > 0) {
      await tx
        .update(cardSubtaskResources)
        .set({ deletedAt, deletedBy: input.deletedBy })
        .where(
          and(
            or(
              eq(cardSubtaskResources.resourceId, row.id),
              and(
                isNull(cardSubtaskResources.resourceId),
                row.attachmentId === null
                  ? eq(cardSubtaskResources.resourceId, row.id)
                  : eq(cardSubtaskResources.attachmentId, row.attachmentId),
              ),
            ),
            isNull(cardSubtaskResources.deletedAt),
          ),
        );
    }
    await tx
      .update(cardResources)
      .set({ deletedAt, deletedBy: input.deletedBy })
      .where(
        and(eq(cardResources.id, row.id), isNull(cardResources.deletedAt)),
      );
    if (uploadAttachmentId !== null) {
      await tx
        .update(cardAttachments)
        .set({ deletedAt })
        .where(
          and(
            eq(cardAttachments.id, uploadAttachmentId),
            isNull(cardAttachments.deletedAt),
          ),
        );
    }
    await tx.insert(cardActivities).values(
      row.kind === "upload"
        ? {
            publicId: generateUID(),
            type: "card.updated.attachment.removed" as const,
            cardId: card.id,
            attachmentId: row.attachmentId,
            fromTitle: row.title,
            createdBy: input.deletedBy,
          }
        : {
            publicId: generateUID(),
            type: "card.updated.resource.removed" as const,
            cardId: card.id,
            fromTitle: row.title,
            createdBy: input.deletedBy,
          },
    );
    return {
      status: "deleted" as const,
      s3Key: row.kind === "upload" ? row.s3Key : null,
    };
  });
