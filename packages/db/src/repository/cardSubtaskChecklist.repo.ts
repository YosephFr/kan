import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardActivities,
  cardPipelineStages,
  cards,
  cardSubtaskChecklistItems,
  cardSubtasks,
  lists,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";
import {
  lockPipelineCardById,
  resolveSubtaskCardId,
} from "./cardPipeline.internal";

const resolveChecklistItemCardId = async (
  db: dbClient,
  itemPublicId: string,
) => {
  const [item] = await db
    .select({ cardId: cardSubtasks.cardId })
    .from(cardSubtaskChecklistItems)
    .innerJoin(
      cardSubtasks,
      eq(cardSubtaskChecklistItems.subtaskId, cardSubtasks.id),
    )
    .where(
      and(
        eq(cardSubtaskChecklistItems.publicId, itemPublicId),
        isNull(cardSubtaskChecklistItems.deletedAt),
        isNull(cardSubtasks.deletedAt),
      ),
    )
    .limit(1);

  return item?.cardId ?? null;
};

export const getChecklistItemContextByPublicId = async (
  db: dbClient,
  itemPublicId: string,
) => {
  const [context] = await db
    .select({
      itemId: cardSubtaskChecklistItems.id,
      itemPublicId: cardSubtaskChecklistItems.publicId,
      itemTitle: cardSubtaskChecklistItems.title,
      completed: cardSubtaskChecklistItems.completed,
      subtaskId: cardSubtasks.id,
      subtaskPublicId: cardSubtasks.publicId,
      subtaskTitle: cardSubtasks.title,
      stagePublicId: cardPipelineStages.publicId,
      stageStatus: cardPipelineStages.status,
      cardId: cards.id,
      cardPublicId: cards.publicId,
      cardTitle: cards.title,
      listPublicId: lists.publicId,
      listName: lists.name,
      boardPublicId: boards.publicId,
      boardName: boards.name,
      boardVisibility: boards.visibility,
      workspaceId: workspaces.id,
      workspacePublicId: workspaces.publicId,
    })
    .from(cardSubtaskChecklistItems)
    .innerJoin(
      cardSubtasks,
      eq(cardSubtaskChecklistItems.subtaskId, cardSubtasks.id),
    )
    .innerJoin(
      cardPipelineStages,
      eq(cardSubtasks.stageId, cardPipelineStages.id),
    )
    .innerJoin(cards, eq(cardSubtasks.cardId, cards.id))
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
    .where(
      and(
        eq(cardSubtaskChecklistItems.publicId, itemPublicId),
        isNull(cardSubtaskChecklistItems.deletedAt),
        isNull(cardSubtasks.deletedAt),
        isNull(cards.deletedAt),
        isNull(lists.deletedAt),
        isNull(boards.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);

  return context ?? null;
};

const selectItemForUpdate = async (
  tx: DbTransaction,
  input: { cardId: number; itemPublicId: string },
) => {
  const [item] = await tx
    .select({
      id: cardSubtaskChecklistItems.id,
      publicId: cardSubtaskChecklistItems.publicId,
      subtaskId: cardSubtaskChecklistItems.subtaskId,
      subtaskPublicId: cardSubtasks.publicId,
      title: cardSubtaskChecklistItems.title,
      completed: cardSubtaskChecklistItems.completed,
      index: cardSubtaskChecklistItems.index,
    })
    .from(cardSubtaskChecklistItems)
    .innerJoin(
      cardSubtasks,
      eq(cardSubtaskChecklistItems.subtaskId, cardSubtasks.id),
    )
    .where(
      and(
        eq(cardSubtaskChecklistItems.publicId, input.itemPublicId),
        eq(cardSubtasks.cardId, input.cardId),
        isNull(cardSubtaskChecklistItems.deletedAt),
        isNull(cardSubtasks.deletedAt),
      ),
    )
    .limit(1)
    .for("update", { of: cardSubtaskChecklistItems });

  return item ?? null;
};

const setTemporaryChecklistIndices = async (
  tx: DbTransaction,
  subtaskId: number,
) => {
  await tx
    .update(cardSubtaskChecklistItems)
    .set({ index: sql`-${cardSubtaskChecklistItems.index} - 1` })
    .where(
      and(
        eq(cardSubtaskChecklistItems.subtaskId, subtaskId),
        isNull(cardSubtaskChecklistItems.deletedAt),
      ),
    );
};

const normalizeChecklist = async (tx: DbTransaction, subtaskId: number) => {
  const items = await tx
    .select({ id: cardSubtaskChecklistItems.id })
    .from(cardSubtaskChecklistItems)
    .where(
      and(
        eq(cardSubtaskChecklistItems.subtaskId, subtaskId),
        isNull(cardSubtaskChecklistItems.deletedAt),
      ),
    )
    .orderBy(
      asc(cardSubtaskChecklistItems.index),
      asc(cardSubtaskChecklistItems.id),
    );
  await setTemporaryChecklistIndices(tx, subtaskId);
  for (const [index, item] of items.entries()) {
    await tx
      .update(cardSubtaskChecklistItems)
      .set({ index })
      .where(eq(cardSubtaskChecklistItems.id, item.id));
  }
};

export const addChecklistItem = async (
  db: dbClient,
  input: {
    subtaskPublicId: string;
    title: string;
    expectedWorkspaceId: number;
    createdBy: string;
  },
) => {
  if (input.title.trim().length === 0) {
    return { status: "invalid_input" as const };
  }
  const cardId = await resolveSubtaskCardId(db, input.subtaskPublicId);
  if (cardId === null) return { status: "not_found" as const };

  return db.transaction(async (tx) => {
    const card = await lockPipelineCardById(tx, cardId);
    if (!card) return { status: "not_found" as const };
    if (card.workspaceId !== input.expectedWorkspaceId) {
      return { status: "workspace_changed" as const };
    }
    const [subtask] = await tx
      .select({ id: cardSubtasks.id, publicId: cardSubtasks.publicId })
      .from(cardSubtasks)
      .where(
        and(
          eq(cardSubtasks.publicId, input.subtaskPublicId),
          eq(cardSubtasks.cardId, card.id),
          isNull(cardSubtasks.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!subtask) return { status: "not_found" as const };

    const [last] = await tx
      .select({ index: cardSubtaskChecklistItems.index })
      .from(cardSubtaskChecklistItems)
      .where(
        and(
          eq(cardSubtaskChecklistItems.subtaskId, subtask.id),
          isNull(cardSubtaskChecklistItems.deletedAt),
        ),
      )
      .orderBy(
        desc(cardSubtaskChecklistItems.index),
        desc(cardSubtaskChecklistItems.id),
      )
      .limit(1);
    const [item] = await tx
      .insert(cardSubtaskChecklistItems)
      .values({
        publicId: generateUID(),
        subtaskId: subtask.id,
        title: input.title.trim(),
        index: last ? last.index + 1 : 0,
        createdBy: input.createdBy,
      })
      .returning({
        publicId: cardSubtaskChecklistItems.publicId,
        title: cardSubtaskChecklistItems.title,
        completed: cardSubtaskChecklistItems.completed,
        index: cardSubtaskChecklistItems.index,
        createdAt: cardSubtaskChecklistItems.createdAt,
        updatedAt: cardSubtaskChecklistItems.updatedAt,
      });
    if (!item) return { status: "not_found" as const };

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.subtask.checklist.item.added",
      cardId: card.id,
      subtaskPublicId: subtask.publicId,
      toTitle: item.title,
      createdBy: input.createdBy,
    });
    return { status: "created" as const, item };
  });
};

export const updateChecklistItem = async (
  db: dbClient,
  input: {
    itemPublicId: string;
    title?: string;
    completed?: boolean;
    expectedWorkspaceId: number;
    updatedBy: string;
  },
) => {
  if (input.title !== undefined && input.title.trim().length === 0) {
    return { status: "invalid_input" as const };
  }
  const cardId = await resolveChecklistItemCardId(db, input.itemPublicId);
  if (cardId === null) return { status: "not_found" as const };

  return db.transaction(async (tx) => {
    const card = await lockPipelineCardById(tx, cardId);
    if (!card) return { status: "not_found" as const };
    if (card.workspaceId !== input.expectedWorkspaceId) {
      return { status: "workspace_changed" as const };
    }
    const current = await selectItemForUpdate(tx, {
      cardId,
      itemPublicId: input.itemPublicId,
    });
    if (!current) return { status: "not_found" as const };

    const title = input.title?.trim();
    const [item] = await tx
      .update(cardSubtaskChecklistItems)
      .set({
        ...(title !== undefined ? { title } : {}),
        ...(input.completed !== undefined
          ? { completed: input.completed }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(cardSubtaskChecklistItems.id, current.id))
      .returning({
        publicId: cardSubtaskChecklistItems.publicId,
        title: cardSubtaskChecklistItems.title,
        completed: cardSubtaskChecklistItems.completed,
        index: cardSubtaskChecklistItems.index,
        createdAt: cardSubtaskChecklistItems.createdAt,
        updatedAt: cardSubtaskChecklistItems.updatedAt,
      });
    if (!item) return { status: "not_found" as const };

    const type =
      input.completed === true && !current.completed
        ? ("card.updated.subtask.checklist.item.completed" as const)
        : input.completed === false && current.completed
          ? ("card.updated.subtask.checklist.item.uncompleted" as const)
          : ("card.updated.subtask.checklist.item.updated" as const);
    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type,
      cardId: card.id,
      subtaskPublicId: current.subtaskPublicId,
      fromTitle: current.title,
      toTitle: item.title,
      createdBy: input.updatedBy,
    });
    return { status: "updated" as const, item };
  });
};

export const reorderChecklistItems = async (
  db: dbClient,
  input: {
    subtaskPublicId: string;
    orderedItemPublicIds: string[];
    expectedWorkspaceId: number;
    updatedBy: string;
  },
) => {
  const cardId = await resolveSubtaskCardId(db, input.subtaskPublicId);
  if (cardId === null) return { status: "not_found" as const };

  return db.transaction(async (tx) => {
    const card = await lockPipelineCardById(tx, cardId);
    if (!card) return { status: "not_found" as const };
    if (card.workspaceId !== input.expectedWorkspaceId) {
      return { status: "workspace_changed" as const };
    }
    const [subtask] = await tx
      .select({ id: cardSubtasks.id, publicId: cardSubtasks.publicId })
      .from(cardSubtasks)
      .where(
        and(
          eq(cardSubtasks.publicId, input.subtaskPublicId),
          eq(cardSubtasks.cardId, card.id),
          isNull(cardSubtasks.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!subtask) return { status: "not_found" as const };

    const current = await tx
      .select({
        id: cardSubtaskChecklistItems.id,
        publicId: cardSubtaskChecklistItems.publicId,
        title: cardSubtaskChecklistItems.title,
        index: cardSubtaskChecklistItems.index,
      })
      .from(cardSubtaskChecklistItems)
      .where(
        and(
          eq(cardSubtaskChecklistItems.subtaskId, subtask.id),
          isNull(cardSubtaskChecklistItems.deletedAt),
        ),
      )
      .orderBy(
        asc(cardSubtaskChecklistItems.index),
        asc(cardSubtaskChecklistItems.id),
      )
      .for("update");
    if (
      current.length !== input.orderedItemPublicIds.length ||
      new Set(input.orderedItemPublicIds).size !== current.length
    ) {
      return { status: "invalid_order" as const };
    }
    const byPublicId = new Map(current.map((item) => [item.publicId, item.id]));
    const orderedIds = input.orderedItemPublicIds.map((publicId) =>
      byPublicId.get(publicId),
    );
    if (orderedIds.some((id) => id === undefined)) {
      return { status: "invalid_order" as const };
    }

    await setTemporaryChecklistIndices(tx, subtask.id);
    const updatedAt = new Date();
    for (const [index, itemId] of orderedIds.entries()) {
      if (itemId === undefined) continue;
      await tx
        .update(cardSubtaskChecklistItems)
        .set({ index, updatedAt })
        .where(eq(cardSubtaskChecklistItems.id, itemId));
    }
    const previousById = new Map(current.map((item) => [item.id, item]));
    const activities = orderedIds.flatMap((itemId, toIndex) => {
      if (itemId === undefined) return [];
      const previous = previousById.get(itemId);
      if (!previous || previous.index === toIndex) return [];
      return [
        {
          publicId: generateUID(),
          type: "card.updated.subtask.checklist.item.updated" as const,
          cardId: card.id,
          subtaskPublicId: subtask.publicId,
          fromIndex: previous.index,
          toIndex,
          fromTitle: previous.title,
          toTitle: previous.title,
          createdBy: input.updatedBy,
        },
      ];
    });
    if (activities.length > 0)
      await tx.insert(cardActivities).values(activities);
    return { status: "reordered" as const };
  });
};

export const softDeleteChecklistItem = async (
  db: dbClient,
  input: {
    itemPublicId: string;
    expectedWorkspaceId: number;
    deletedBy: string;
  },
) => {
  const cardId = await resolveChecklistItemCardId(db, input.itemPublicId);
  if (cardId === null) return { status: "not_found" as const };

  return db.transaction(async (tx) => {
    const card = await lockPipelineCardById(tx, cardId);
    if (!card) return { status: "not_found" as const };
    if (card.workspaceId !== input.expectedWorkspaceId) {
      return { status: "workspace_changed" as const };
    }
    const current = await selectItemForUpdate(tx, {
      cardId,
      itemPublicId: input.itemPublicId,
    });
    if (!current) return { status: "not_found" as const };

    const deletedAt = new Date();
    await tx
      .update(cardSubtaskChecklistItems)
      .set({ deletedAt, deletedBy: input.deletedBy, updatedAt: deletedAt })
      .where(eq(cardSubtaskChecklistItems.id, current.id));
    await normalizeChecklist(tx, current.subtaskId);
    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.subtask.checklist.item.deleted",
      cardId: card.id,
      subtaskPublicId: current.subtaskPublicId,
      fromTitle: current.title,
      createdBy: input.deletedBy,
    });

    return { status: "deleted" as const, publicId: current.publicId };
  });
};
