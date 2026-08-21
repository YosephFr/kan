import { and, count, eq, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { cardActivities, comments } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { WorkspaceBoundaryTransaction } from "./workspace-boundary";
import {
  lockCardsInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

const lockCommentCard = async (
  tx: WorkspaceBoundaryTransaction,
  cardId: number,
  expectedWorkspaceId: number,
) => {
  const [card] = await lockCardsInWorkspace(tx, [cardId], expectedWorkspaceId);
  if (!card) throw new WorkspaceChangedError();
  return card;
};

export const getCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(comments)
    .where(isNull(comments.deletedAt));

  return result[0]?.count ?? 0;
};

export const create = async (
  db: dbClient,
  commentInput: {
    cardId: number;
    expectedWorkspaceId: number;
    comment: string;
    createdBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    await lockCommentCard(
      tx,
      commentInput.cardId,
      commentInput.expectedWorkspaceId,
    );

    const [result] = await tx
      .insert(comments)
      .values({
        publicId: generateUID(),
        comment: commentInput.comment,
        createdBy: commentInput.createdBy,
        cardId: commentInput.cardId,
      })
      .returning({
        id: comments.id,
        publicId: comments.publicId,
        comment: comments.comment,
      });
    if (!result) return undefined;

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.comment.added",
      cardId: commentInput.cardId,
      commentId: result.id,
      toComment: result.comment,
      createdBy: commentInput.createdBy,
    });

    return result;
  });
};

export const getByPublicId = (db: dbClient, publicId: string) => {
  return db.query.comments.findFirst({
    columns: {
      id: true,
      publicId: true,
      comment: true,
      createdBy: true,
      cardId: true,
    },
    where: eq(comments.publicId, publicId),
  });
};

export const update = async (
  db: dbClient,
  commentInput: {
    id: number;
    cardId: number;
    expectedWorkspaceId: number;
    comment: string;
    updatedBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    await lockCommentCard(
      tx,
      commentInput.cardId,
      commentInput.expectedWorkspaceId,
    );
    const [current] = await tx
      .select({ comment: comments.comment })
      .from(comments)
      .where(
        and(
          eq(comments.id, commentInput.id),
          eq(comments.cardId, commentInput.cardId),
          isNull(comments.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) throw new WorkspaceChangedError();

    const [result] = await tx
      .update(comments)
      .set({
        comment: commentInput.comment,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(comments.id, commentInput.id),
          eq(comments.cardId, commentInput.cardId),
          isNull(comments.deletedAt),
        ),
      )
      .returning({
        id: comments.id,
        publicId: comments.publicId,
        comment: comments.comment,
      });
    if (!result) throw new WorkspaceChangedError();

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.comment.updated",
      cardId: commentInput.cardId,
      commentId: result.id,
      fromComment: current.comment,
      toComment: result.comment,
      createdBy: commentInput.updatedBy,
    });

    return result;
  });
};

export const softDelete = async (
  db: dbClient,
  args: {
    commentId: number;
    cardId: number;
    expectedWorkspaceId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    await lockCommentCard(tx, args.cardId, args.expectedWorkspaceId);
    const [current] = await tx
      .select({ id: comments.id, comment: comments.comment })
      .from(comments)
      .where(
        and(
          eq(comments.id, args.commentId),
          eq(comments.cardId, args.cardId),
          isNull(comments.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) throw new WorkspaceChangedError();

    const [result] = await tx
      .update(comments)
      .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
      .where(
        and(
          eq(comments.id, args.commentId),
          eq(comments.cardId, args.cardId),
          isNull(comments.deletedAt),
        ),
      )
      .returning({ id: comments.id });
    if (!result) throw new WorkspaceChangedError();

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.comment.deleted",
      cardId: args.cardId,
      commentId: result.id,
      fromComment: current.comment,
      createdBy: args.deletedBy,
    });

    return result;
  });
};
