import { and, count, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardActivities,
  cardAttachments,
  cardAttachmentUploadSessions,
  cardResources,
  cards,
  lists,
  users,
  workspaces,
} from "@kan/db/schema";
import {
  generateUID,
  MAX_PENDING_ATTACHMENT_UPLOADS_PER_CARD,
  MAX_PENDING_ATTACHMENT_UPLOADS_PER_USER,
} from "@kan/shared/utils";

type DbTransaction = Parameters<Parameters<dbClient["transaction"]>[0]>[0];

async function lockCardHierarchy(tx: DbTransaction, cardId: number) {
  const [location] = await tx
    .select({ listId: cards.listId })
    .from(cards)
    .where(and(eq(cards.id, cardId), isNull(cards.deletedAt)))
    .limit(1);
  if (!location) return { status: "not_found" as const };

  const [list] = await tx
    .select({ id: lists.id, boardId: lists.boardId })
    .from(lists)
    .where(and(eq(lists.id, location.listId), isNull(lists.deletedAt)))
    .limit(1)
    .for("update");
  if (!list) return { status: "not_found" as const };

  const [card] = await tx
    .select({ id: cards.id, listId: cards.listId, publicId: cards.publicId })
    .from(cards)
    .where(and(eq(cards.id, cardId), isNull(cards.deletedAt)))
    .limit(1)
    .for("update");
  if (!card) return { status: "not_found" as const };
  if (card.listId !== list.id) return { status: "moved" as const };

  const [board] = await tx
    .select({
      id: boards.id,
      workspaceId: boards.workspaceId,
      visibility: boards.visibility,
    })
    .from(boards)
    .where(and(eq(boards.id, list.boardId), isNull(boards.deletedAt)))
    .limit(1)
    .for("update");
  if (!board) return { status: "not_found" as const };

  return { status: "locked" as const, card, list, board };
}

export function hasValidAttachmentStorageOwnership(input: {
  s3Key: string;
  uploadSessionId: number | null;
  uploadSession?: {
    id: number;
    cardId: number;
    consumedAt: Date | null;
  } | null;
  card: {
    id: number;
    publicId: string;
    list: {
      board: {
        workspace: { id: number; publicId: string };
      };
    };
  };
}): boolean {
  if (input.uploadSessionId !== null) {
    return (
      input.uploadSession?.id === input.uploadSessionId &&
      input.uploadSession.cardId === input.card.id &&
      input.uploadSession.consumedAt !== null &&
      /^\.objects\/[a-z0-9]{12}$/.test(input.s3Key)
    );
  }

  const [workspaceSegment, cardSegment, ...objectSegments] =
    input.s3Key.split("/");
  return Boolean(
    workspaceSegment &&
      /^[a-zA-Z0-9_-]+$/.test(workspaceSegment) &&
      cardSegment === input.card.publicId &&
      objectSegments.length > 0 &&
      objectSegments.every(
        (segment) => segment && segment !== "." && segment !== "..",
      ),
  );
}

export const getCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(cardAttachments)
    .where(isNull(cardAttachments.deletedAt));

  return result[0]?.count ?? 0;
};

export const getByPublicId = (db: dbClient, publicId: string) => {
  return db.query.cardAttachments.findFirst({
    where: eq(cardAttachments.publicId, publicId),
    with: {
      uploadSession: {
        columns: {
          id: true,
          cardId: true,
          consumedAt: true,
        },
      },
      card: {
        columns: {
          id: true,
          publicId: true,
          deletedAt: true,
        },
        with: {
          list: {
            columns: {
              id: true,
              deletedAt: true,
            },
            with: {
              board: {
                columns: {
                  id: true,
                  workspaceId: true,
                  visibility: true,
                  deletedAt: true,
                },
                with: {
                  workspace: {
                    columns: { id: true, publicId: true, deletedAt: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
};

export const createUploadSession = async (
  db: dbClient,
  input: {
    publicId: string;
    cardId: number;
    workspaceId: number;
    userId: string;
    s3Key: string;
    filename: string;
    originalFilename: string;
    contentType: string;
    size: number;
    sha256: string;
    expiresAt: Date;
    publicVisibilityAcknowledged: boolean;
  },
) => {
  return db.transaction(async (tx) => {
    const hierarchy = await lockCardHierarchy(tx, input.cardId);
    if (
      hierarchy.status !== "locked" ||
      hierarchy.board.workspaceId !== input.workspaceId
    ) {
      return { status: "workspace_mismatch" as const };
    }
    if (
      hierarchy.board.visibility === "public" &&
      !input.publicVisibilityAcknowledged
    ) {
      return { status: "public_ack_required" as const };
    }

    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1)
      .for("update");
    if (!user) return { status: "user_missing" as const };

    const now = new Date();
    await tx
      .delete(cardAttachmentUploadSessions)
      .where(
        and(
          isNull(cardAttachmentUploadSessions.consumedAt),
          lte(cardAttachmentUploadSessions.expiresAt, now),
          or(
            eq(cardAttachmentUploadSessions.userId, input.userId),
            eq(cardAttachmentUploadSessions.cardId, input.cardId),
          ),
        ),
      );

    const [pendingForUser] = await tx
      .select({ count: count() })
      .from(cardAttachmentUploadSessions)
      .where(
        and(
          eq(cardAttachmentUploadSessions.userId, input.userId),
          isNull(cardAttachmentUploadSessions.consumedAt),
          gt(cardAttachmentUploadSessions.expiresAt, now),
        ),
      );
    if (
      (pendingForUser?.count ?? 0) >= MAX_PENDING_ATTACHMENT_UPLOADS_PER_USER
    ) {
      return { status: "user_limit" as const };
    }

    const [pendingForCard] = await tx
      .select({ count: count() })
      .from(cardAttachmentUploadSessions)
      .where(
        and(
          eq(cardAttachmentUploadSessions.cardId, input.cardId),
          eq(cardAttachmentUploadSessions.workspaceId, input.workspaceId),
          isNull(cardAttachmentUploadSessions.consumedAt),
          gt(cardAttachmentUploadSessions.expiresAt, now),
        ),
      );
    if (
      (pendingForCard?.count ?? 0) >= MAX_PENDING_ATTACHMENT_UPLOADS_PER_CARD
    ) {
      return { status: "card_limit" as const };
    }

    const { publicVisibilityAcknowledged: _acknowledged, ...sessionValues } =
      input;
    const [session] = await tx
      .insert(cardAttachmentUploadSessions)
      .values(sessionValues)
      .returning({ publicId: cardAttachmentUploadSessions.publicId });

    return session
      ? { status: "created" as const, session }
      : { status: "user_missing" as const };
  });
};

export const claimUploadSessionForConfirmation = async (
  db: dbClient,
  input: {
    publicId: string;
    cardId: number;
    workspaceId: number;
    userId: string;
    claimToken: string;
    claimExpiresAt: Date;
  },
) => {
  return db.transaction(async (tx) => {
    const hierarchy = await lockCardHierarchy(tx, input.cardId);
    if (
      hierarchy.status !== "locked" ||
      hierarchy.board.workspaceId !== input.workspaceId
    ) {
      return { status: "workspace_mismatch" as const };
    }

    const now = new Date();
    const [session] = await tx
      .update(cardAttachmentUploadSessions)
      .set({
        claimToken: input.claimToken,
        claimExpiresAt: input.claimExpiresAt,
      })
      .where(
        and(
          eq(cardAttachmentUploadSessions.publicId, input.publicId),
          eq(cardAttachmentUploadSessions.cardId, input.cardId),
          eq(cardAttachmentUploadSessions.workspaceId, input.workspaceId),
          eq(cardAttachmentUploadSessions.userId, input.userId),
          isNull(cardAttachmentUploadSessions.consumedAt),
          gt(cardAttachmentUploadSessions.expiresAt, now),
          or(
            isNull(cardAttachmentUploadSessions.claimToken),
            isNull(cardAttachmentUploadSessions.claimExpiresAt),
            lte(cardAttachmentUploadSessions.claimExpiresAt, now),
          ),
        ),
      )
      .returning();

    if (session) return { status: "claimed" as const, session };

    const [confirmedAttachment] = await tx
      .select({
        publicId: cardAttachments.publicId,
        filename: cardAttachments.filename,
        originalFilename: cardAttachments.originalFilename,
        contentType: cardAttachments.contentType,
        size: cardAttachments.size,
        createdAt: cardAttachments.createdAt,
      })
      .from(cardAttachmentUploadSessions)
      .innerJoin(
        cardAttachments,
        and(
          eq(cardAttachments.uploadSessionId, cardAttachmentUploadSessions.id),
          eq(cardAttachments.cardId, input.cardId),
          isNull(cardAttachments.deletedAt),
          isNull(cardAttachments.storageQuarantinedAt),
        ),
      )
      .innerJoin(
        cardResources,
        and(
          eq(cardResources.attachmentId, cardAttachments.id),
          eq(cardResources.publicId, cardAttachments.publicId),
          eq(cardResources.cardId, input.cardId),
          eq(cardResources.kind, "upload"),
          isNull(cardResources.deletedAt),
        ),
      )
      .where(
        and(
          eq(cardAttachmentUploadSessions.publicId, input.publicId),
          eq(cardAttachmentUploadSessions.cardId, input.cardId),
          eq(cardAttachmentUploadSessions.workspaceId, input.workspaceId),
          eq(cardAttachmentUploadSessions.userId, input.userId),
          isNotNull(cardAttachmentUploadSessions.consumedAt),
        ),
      )
      .limit(1);

    return confirmedAttachment
      ? { status: "already_created" as const, attachment: confirmedAttachment }
      : { status: "unavailable" as const };
  });
};

export const deleteUnissuedUploadSession = async (
  db: dbClient,
  input: {
    publicId: string;
    cardId: number;
    workspaceId: number;
    userId: string;
  },
) => {
  return db.transaction(async (tx) => {
    const hierarchy = await lockCardHierarchy(tx, input.cardId);
    if (
      hierarchy.status !== "locked" ||
      hierarchy.board.workspaceId !== input.workspaceId
    ) {
      return { status: "workspace_mismatch" as const };
    }

    const [session] = await tx
      .delete(cardAttachmentUploadSessions)
      .where(
        and(
          eq(cardAttachmentUploadSessions.publicId, input.publicId),
          eq(cardAttachmentUploadSessions.cardId, input.cardId),
          eq(cardAttachmentUploadSessions.workspaceId, input.workspaceId),
          eq(cardAttachmentUploadSessions.userId, input.userId),
          isNull(cardAttachmentUploadSessions.consumedAt),
          isNull(cardAttachmentUploadSessions.claimToken),
          isNull(cardAttachmentUploadSessions.claimExpiresAt),
        ),
      )
      .returning({
        publicId: cardAttachmentUploadSessions.publicId,
      });

    return session
      ? { status: "deleted" as const, session }
      : { status: "unavailable" as const };
  });
};

export const releaseUploadSessionClaim = async (
  db: dbClient,
  input: { publicId: string; claimToken: string },
) => {
  const [session] = await db
    .update(cardAttachmentUploadSessions)
    .set({ claimToken: null, claimExpiresAt: null })
    .where(
      and(
        eq(cardAttachmentUploadSessions.publicId, input.publicId),
        eq(cardAttachmentUploadSessions.claimToken, input.claimToken),
        isNull(cardAttachmentUploadSessions.consumedAt),
      ),
    )
    .returning({ publicId: cardAttachmentUploadSessions.publicId });

  return session;
};

export const consumeClaimedUploadSessionAndCreate = async (
  db: dbClient,
  input: {
    sessionPublicId: string;
    cardId: number;
    workspaceId: number;
    userId: string;
    claimToken: string;
    finalS3Key: string;
    publicVisibilityAcknowledged: boolean;
  },
) => {
  return db.transaction(async (tx) => {
    const hierarchy = await lockCardHierarchy(tx, input.cardId);
    if (
      hierarchy.status !== "locked" ||
      hierarchy.board.workspaceId !== input.workspaceId
    ) {
      await tx
        .update(cardAttachmentUploadSessions)
        .set({ claimToken: null, claimExpiresAt: null })
        .where(
          and(
            eq(cardAttachmentUploadSessions.publicId, input.sessionPublicId),
            eq(cardAttachmentUploadSessions.claimToken, input.claimToken),
            isNull(cardAttachmentUploadSessions.consumedAt),
          ),
        );
      return { status: "workspace_mismatch" as const };
    }
    if (
      hierarchy.board.visibility === "public" &&
      !input.publicVisibilityAcknowledged
    ) {
      await tx
        .update(cardAttachmentUploadSessions)
        .set({ claimToken: null, claimExpiresAt: null })
        .where(
          and(
            eq(cardAttachmentUploadSessions.publicId, input.sessionPublicId),
            eq(cardAttachmentUploadSessions.claimToken, input.claimToken),
            isNull(cardAttachmentUploadSessions.consumedAt),
          ),
        );
      return { status: "public_ack_required" as const };
    }

    const now = new Date();
    const [session] = await tx
      .update(cardAttachmentUploadSessions)
      .set({ consumedAt: now, claimToken: null, claimExpiresAt: null })
      .where(
        and(
          eq(cardAttachmentUploadSessions.publicId, input.sessionPublicId),
          eq(cardAttachmentUploadSessions.cardId, input.cardId),
          eq(cardAttachmentUploadSessions.workspaceId, input.workspaceId),
          eq(cardAttachmentUploadSessions.userId, input.userId),
          eq(cardAttachmentUploadSessions.claimToken, input.claimToken),
          gt(cardAttachmentUploadSessions.claimExpiresAt, now),
          isNull(cardAttachmentUploadSessions.consumedAt),
          gt(cardAttachmentUploadSessions.expiresAt, now),
        ),
      )
      .returning();

    if (!session) return { status: "unavailable" as const };

    const attachmentPublicId = generateUID();
    const [attachment] = await tx
      .insert(cardAttachments)
      .values({
        publicId: attachmentPublicId,
        cardId: session.cardId,
        filename: session.filename,
        originalFilename: session.originalFilename,
        contentType: session.contentType,
        size: session.size,
        s3Key: input.finalS3Key,
        sha256: session.sha256,
        uploadSessionId: session.id,
        createdBy: session.userId,
      })
      .returning({
        id: cardAttachments.id,
        publicId: cardAttachments.publicId,
        filename: cardAttachments.filename,
        originalFilename: cardAttachments.originalFilename,
        contentType: cardAttachments.contentType,
        size: cardAttachments.size,
        createdAt: cardAttachments.createdAt,
      });

    if (!attachment) return { status: "unavailable" as const };

    await tx
      .insert(cardResources)
      .values({
        publicId: attachmentPublicId,
        cardId: session.cardId,
        kind: "upload",
        title: session.originalFilename,
        attachmentId: attachment.id,
        createdBy: session.userId,
      })
      .onConflictDoNothing({ target: cardResources.publicId });

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.attachment.added",
      cardId: session.cardId,
      attachmentId: attachment.id,
      toTitle: attachment.originalFilename,
      createdBy: session.userId,
    });

    return { status: "created" as const, attachment };
  });
};

export const getAllByCardId = (db: dbClient, cardId: number) => {
  return db.query.cardAttachments.findMany({
    where: and(
      eq(cardAttachments.cardId, cardId),
      isNull(cardAttachments.deletedAt),
      isNull(cardAttachments.storageQuarantinedAt),
    ),
    orderBy: (attachments, { desc }) => [desc(attachments.createdAt)],
  });
};

export const softDeleteWithWorkspaceGuard = async (
  db: dbClient,
  input: {
    attachmentPublicId: string;
    workspaceId: number;
    userId: string;
    deletedAt: Date;
  },
) => {
  return db.transaction(async (tx) => {
    const [attachmentCard] = await tx
      .select({ cardId: cardAttachments.cardId })
      .from(cardAttachments)
      .where(
        and(
          eq(cardAttachments.publicId, input.attachmentPublicId),
          isNull(cardAttachments.deletedAt),
        ),
      )
      .limit(1);
    if (!attachmentCard) return { status: "not_found" as const };

    const hierarchy = await lockCardHierarchy(tx, attachmentCard.cardId);
    if (
      hierarchy.status !== "locked" ||
      hierarchy.board.workspaceId !== input.workspaceId
    ) {
      return { status: "workspace_mismatch" as const };
    }

    const [row] = await tx
      .select({
        id: cardAttachments.id,
        publicId: cardAttachments.publicId,
        s3Key: cardAttachments.s3Key,
        originalFilename: cardAttachments.originalFilename,
        uploadSessionId: cardAttachments.uploadSessionId,
        storageQuarantinedAt: cardAttachments.storageQuarantinedAt,
        uploadSessionCardId: cardAttachmentUploadSessions.cardId,
        uploadSessionConsumedAt: cardAttachmentUploadSessions.consumedAt,
        workspacePublicId: workspaces.publicId,
      })
      .from(cardAttachments)
      .innerJoin(cards, eq(cardAttachments.cardId, cards.id))
      .innerJoin(lists, eq(cards.listId, lists.id))
      .innerJoin(boards, eq(lists.boardId, boards.id))
      .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
      .leftJoin(
        cardAttachmentUploadSessions,
        eq(cardAttachments.uploadSessionId, cardAttachmentUploadSessions.id),
      )
      .where(
        and(
          eq(cardAttachments.publicId, input.attachmentPublicId),
          isNull(cardAttachments.deletedAt),
        ),
      )
      .limit(1)
      .for("update", { of: cardAttachments });

    if (!row) return { status: "not_found" as const };
    const storageIsValid = hasValidAttachmentStorageOwnership({
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
        id: hierarchy.card.id,
        publicId: hierarchy.card.publicId,
        list: {
          board: {
            workspace: {
              id: hierarchy.board.workspaceId,
              publicId: row.workspacePublicId,
            },
          },
        },
      },
    });
    if (row.storageQuarantinedAt || !storageIsValid) {
      return { status: "invalid_storage" as const };
    }

    await tx
      .update(cardAttachments)
      .set({ deletedAt: input.deletedAt })
      .where(
        and(eq(cardAttachments.id, row.id), isNull(cardAttachments.deletedAt)),
      );
    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.attachment.removed",
      cardId: hierarchy.card.id,
      attachmentId: row.id,
      fromTitle: row.originalFilename,
      createdBy: input.userId,
    });

    return {
      status: "deleted" as const,
      attachment: { publicId: row.publicId, s3Key: row.s3Key },
    };
  });
};
