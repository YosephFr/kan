import { and, count, eq, inArray, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { cardsToLabels, labels } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import {
  assertBoardsInWorkspace,
  lockCardsInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

export const getCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(labels)
    .where(isNull(labels.deletedAt));

  return result[0]?.count ?? 0;
};

export const create = async (
  db: dbClient,
  labelInput: {
    name: string;
    colourCode: string;
    createdBy: string;
    boardId: number;
    expectedWorkspaceId: number;
    cardId?: number;
  },
) => {
  return db.transaction(async (tx) => {
    if (labelInput.cardId === undefined) {
      await assertBoardsInWorkspace(
        tx,
        [labelInput.boardId],
        labelInput.expectedWorkspaceId,
      );
    } else {
      const [card] = await lockCardsInWorkspace(
        tx,
        [labelInput.cardId],
        labelInput.expectedWorkspaceId,
      );
      if (!card || card.boardId !== labelInput.boardId) {
        throw new WorkspaceChangedError();
      }
    }
    const [result] = await tx
      .insert(labels)
      .values({
        publicId: generateUID(),
        name: labelInput.name,
        colourCode: labelInput.colourCode,
        createdBy: labelInput.createdBy,
        boardId: labelInput.boardId,
      })
      .returning({
        id: labels.id,
        publicId: labels.publicId,
        name: labels.name,
        colourCode: labels.colourCode,
      });

    if (labelInput.cardId !== undefined && result) {
      await tx.insert(cardsToLabels).values({
        cardId: labelInput.cardId,
        labelId: result.id,
      });
    }
    return result;
  });
};

export const bulkCreate = async (
  db: dbClient,
  labelsInput: {
    publicId: string;
    name: string;
    colourCode: string;
    boardId: number;
    createdBy: string;
  }[],
  options: { expectedWorkspaceId: number },
) => {
  if (labelsInput.length === 0) return [];
  return db.transaction(async (tx) => {
    const boardIds = [...new Set(labelsInput.map((label) => label.boardId))];
    if (boardIds.length !== 1 || boardIds[0] === undefined) {
      throw new WorkspaceChangedError();
    }
    await assertBoardsInWorkspace(tx, boardIds, options.expectedWorkspaceId);
    return tx
      .insert(labels)
      .values(labelsInput)
      .returning({ id: labels.id, publicId: labels.publicId });
  });
};

export const getAllByPublicIds = (db: dbClient, labelPublicIds: string[]) => {
  return db.query.labels.findMany({
    columns: {
      id: true,
    },
    where: inArray(labels.publicId, labelPublicIds),
  });
};

export const getAllByPublicIdsForBoard = (
  db: dbClient,
  labelPublicIds: string[],
  boardId: number,
) => {
  return db.query.labels.findMany({
    columns: {
      id: true,
    },
    where: and(
      inArray(labels.publicId, labelPublicIds),
      eq(labels.boardId, boardId),
      isNull(labels.deletedAt),
    ),
  });
};

export const getByPublicId = async (db: dbClient, labelPublicId: string) => {
  return db.query.labels.findFirst({
    columns: {
      id: true,
      publicId: true,
      name: true,
      colourCode: true,
    },
    where: and(eq(labels.publicId, labelPublicId), isNull(labels.deletedAt)),
  });
};

export const getByPublicIdForBoard = async (
  db: dbClient,
  labelPublicId: string,
  boardId: number,
) => {
  return db.query.labels.findFirst({
    columns: {
      id: true,
      publicId: true,
      name: true,
      colourCode: true,
    },
    where: and(
      eq(labels.publicId, labelPublicId),
      eq(labels.boardId, boardId),
      isNull(labels.deletedAt),
    ),
  });
};

export const update = async (
  db: dbClient,
  labelInput: {
    labelPublicId: string;
    name: string;
    colourCode: string;
    expectedWorkspaceId: number;
  },
) => {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: labels.id, boardId: labels.boardId })
      .from(labels)
      .where(
        and(
          eq(labels.publicId, labelInput.labelPublicId),
          isNull(labels.deletedAt),
        ),
      )
      .limit(1);
    if (!candidate) throw new WorkspaceChangedError();
    await assertBoardsInWorkspace(
      tx,
      [candidate.boardId],
      labelInput.expectedWorkspaceId,
    );
    const [lockedLabel] = await tx
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.id, candidate.id), isNull(labels.deletedAt)))
      .limit(1)
      .for("update");
    if (!lockedLabel) throw new WorkspaceChangedError();
    const [result] = await tx
      .update(labels)
      .set({
        name: labelInput.name,
        colourCode: labelInput.colourCode,
      })
      .where(and(eq(labels.id, lockedLabel.id), isNull(labels.deletedAt)))
      .returning({
        id: labels.id,
        publicId: labels.publicId,
        name: labels.name,
        colourCode: labels.colourCode,
      });
    return result;
  });
};

export const softDelete = async (
  db: dbClient,
  args: {
    labelId: number;
    expectedWorkspaceId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: labels.id, boardId: labels.boardId })
      .from(labels)
      .where(and(eq(labels.id, args.labelId), isNull(labels.deletedAt)))
      .limit(1);
    if (!candidate) throw new WorkspaceChangedError();
    await assertBoardsInWorkspace(
      tx,
      [candidate.boardId],
      args.expectedWorkspaceId,
      { boardLock: "update" },
    );
    const [lockedLabel] = await tx
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.id, candidate.id), isNull(labels.deletedAt)))
      .limit(1)
      .for("update");
    if (!lockedLabel) throw new WorkspaceChangedError();
    await tx
      .delete(cardsToLabels)
      .where(eq(cardsToLabels.labelId, lockedLabel.id));
    const [result] = await tx
      .update(labels)
      .set({
        deletedAt: args.deletedAt,
        deletedBy: args.deletedBy,
      })
      .where(and(eq(labels.id, lockedLabel.id), isNull(labels.deletedAt)))
      .returning({ id: labels.id });
    return result;
  });
};

export const getByPublicIdGuarded = async (
  db: dbClient,
  args: { labelPublicId: string; expectedWorkspaceId: number },
) =>
  db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: labels.id, boardId: labels.boardId })
      .from(labels)
      .where(
        and(eq(labels.publicId, args.labelPublicId), isNull(labels.deletedAt)),
      )
      .limit(1);
    if (!candidate) throw new WorkspaceChangedError();
    await assertBoardsInWorkspace(
      tx,
      [candidate.boardId],
      args.expectedWorkspaceId,
    );
    const [result] = await tx
      .select({
        publicId: labels.publicId,
        name: labels.name,
        colourCode: labels.colourCode,
      })
      .from(labels)
      .where(and(eq(labels.id, candidate.id), isNull(labels.deletedAt)))
      .limit(1);
    if (!result) throw new WorkspaceChangedError();
    return result;
  });

export const getWorkspaceAndLabelIdByLabelPublicId = async (
  db: dbClient,
  labelPublicId: string,
) => {
  const result = await db.query.labels.findFirst({
    columns: { id: true },
    where: and(eq(labels.publicId, labelPublicId), isNull(labels.deletedAt)),
    with: {
      board: {
        columns: { workspaceId: true },
      },
    },
  });

  return result
    ? {
        id: result.id,
        workspaceId: result.board.workspaceId,
      }
    : null;
};
