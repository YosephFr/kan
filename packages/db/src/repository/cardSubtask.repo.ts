import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { CardPriority } from "@kan/db/schema";
import {
  boards,
  cardActivities,
  cardPipelineStages,
  cards,
  cardSubtasks,
  lists,
  notifications,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import {
  deriveSubtaskLifecycle,
  lockPipelineCardById,
  resolveActiveWorkspaceMember,
  resolveStageCardId,
  resolveSubtaskCardId,
} from "./cardPipeline.internal";
import {
  normalizeStage,
  selectPublicSubtaskById,
  selectSubtaskForUpdate,
  setTemporaryStageIndices,
} from "./cardSubtask.internal";

const assignmentDedupeKey = (
  userId: string,
  subtaskPublicId: string,
  assignmentReference: string,
) =>
  ["subtask.assigned", userId, subtaskPublicId, assignmentReference].join(":");

export const getByPublicId = async (db: dbClient, subtaskPublicId: string) => {
  const cardId = await resolveSubtaskCardId(db, subtaskPublicId);
  if (cardId === null) return null;

  return db.transaction(async (tx) => {
    const card = await lockPipelineCardById(tx, cardId);
    if (!card) return null;
    const subtask = await selectSubtaskForUpdate(tx, {
      cardId,
      subtaskPublicId,
    });
    return subtask ? selectPublicSubtaskById(tx, subtask.id) : null;
  });
};

export const getSubtaskContextByPublicId = async (
  db: dbClient,
  subtaskPublicId: string,
) => {
  const [context] = await db
    .select({
      subtaskId: cardSubtasks.id,
      subtaskPublicId: cardSubtasks.publicId,
      subtaskTitle: cardSubtasks.title,
      ownerWorkspaceMemberId: cardSubtasks.ownerWorkspaceMemberId,
      stageId: cardPipelineStages.id,
      stagePublicId: cardPipelineStages.publicId,
      stageStatus: cardPipelineStages.status,
      stageName: cardPipelineStages.name,
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
    .from(cardSubtasks)
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
        eq(cardSubtasks.publicId, subtaskPublicId),
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

export const createSubtask = async (
  db: dbClient,
  input: {
    stagePublicId: string;
    title: string;
    description?: string | null;
    priority?: CardPriority;
    dueDate?: Date | null;
    ownerPublicId?: string | null;
    expectedWorkspaceId: number;
    createdBy: string;
  },
) => {
  if (input.title.trim().length === 0) {
    return { status: "invalid_input" as const };
  }
  const cardId = await resolveStageCardId(db, input.stagePublicId);
  if (cardId === null) return { status: "not_found" as const };

  return db.transaction(async (tx) => {
    const card = await lockPipelineCardById(tx, cardId);
    if (!card) return { status: "not_found" as const };
    if (card.workspaceId !== input.expectedWorkspaceId) {
      return { status: "workspace_changed" as const };
    }

    const [stage] = await tx
      .select({
        id: cardPipelineStages.id,
        publicId: cardPipelineStages.publicId,
        status: cardPipelineStages.status,
      })
      .from(cardPipelineStages)
      .where(
        and(
          eq(cardPipelineStages.publicId, input.stagePublicId),
          eq(cardPipelineStages.cardId, card.id),
        ),
      )
      .limit(1)
      .for("update");
    if (!stage) return { status: "not_found" as const };

    const owner = input.ownerPublicId
      ? await resolveActiveWorkspaceMember(tx, {
          workspaceId: card.workspaceId,
          memberPublicId: input.ownerPublicId,
        })
      : null;
    if (input.ownerPublicId && !owner) {
      return { status: "owner_invalid" as const };
    }

    const [last] = await tx
      .select({ index: cardSubtasks.index })
      .from(cardSubtasks)
      .where(
        and(eq(cardSubtasks.stageId, stage.id), isNull(cardSubtasks.deletedAt)),
      )
      .orderBy(desc(cardSubtasks.index), desc(cardSubtasks.id))
      .limit(1);
    const now = new Date();
    const lifecycle = deriveSubtaskLifecycle({
      currentStatus: null,
      destinationStatus: stage.status,
      startedAt: null,
      completedAt: null,
      movedAt: now,
    });
    const [created] = await tx
      .insert(cardSubtasks)
      .values({
        publicId: generateUID(),
        cardId: card.id,
        stageId: stage.id,
        title: input.title.trim(),
        description: input.description ?? null,
        priority: input.priority ?? "none",
        dueDate: input.dueDate ?? null,
        ownerWorkspaceMemberId: owner?.id ?? null,
        index: last ? last.index + 1 : 0,
        startedAt: lifecycle.startedAt,
        completedAt: lifecycle.completedAt,
        createdBy: input.createdBy,
      })
      .returning({ id: cardSubtasks.id, publicId: cardSubtasks.publicId });
    if (!created) return { status: "not_found" as const };

    const assignmentReference = generateUID();
    await tx.insert(cardActivities).values({
      publicId: assignmentReference,
      type: "card.updated.subtask.added",
      cardId: card.id,
      subtaskPublicId: created.publicId,
      toPipelineStagePublicId: stage.publicId,
      toTitle: input.title.trim(),
      createdBy: input.createdBy,
    });
    if (
      owner?.userId &&
      owner.userId !== input.createdBy &&
      card.completedAt === null &&
      card.listStatus !== "done" &&
      !card.boardArchived
    ) {
      await tx
        .insert(notifications)
        .values({
          publicId: generateUID(),
          type: "subtask.assigned",
          userId: owner.userId,
          cardId: card.id,
          subtaskId: created.id,
          workspaceId: card.workspaceId,
          dedupeKey: assignmentDedupeKey(
            owner.userId,
            created.publicId,
            assignmentReference,
          ),
        })
        .onConflictDoNothing({ target: notifications.dedupeKey });
    }

    return {
      status: "created" as const,
      subtask: await selectPublicSubtaskById(tx, created.id),
      assignmentReference,
    };
  });
};

export const updateSubtask = async (
  db: dbClient,
  input: {
    subtaskPublicId: string;
    title?: string;
    description?: string | null;
    priority?: CardPriority;
    dueDate?: Date | null;
    expectedWorkspaceId: number;
    updatedBy: string;
  },
) => {
  if (input.title !== undefined && input.title.trim().length === 0) {
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
    const current = await selectSubtaskForUpdate(tx, {
      cardId,
      subtaskPublicId: input.subtaskPublicId,
    });
    if (!current) return { status: "not_found" as const };

    const title = input.title?.trim();
    const updatedAt = new Date();
    const dueDateChanged =
      input.dueDate !== undefined &&
      current.dueDate?.getTime() !== input.dueDate?.getTime();
    const [updated] = await tx
      .update(cardSubtasks)
      .set({
        ...(title !== undefined ? { title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        updatedAt,
      })
      .where(
        and(eq(cardSubtasks.id, current.id), isNull(cardSubtasks.deletedAt)),
      )
      .returning({ id: cardSubtasks.id });
    if (!updated) return { status: "not_found" as const };

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.subtask.updated",
      cardId: card.id,
      subtaskPublicId: current.publicId,
      fromTitle: current.title,
      toTitle: title ?? current.title,
      createdBy: input.updatedBy,
    });
    if (dueDateChanged) {
      await tx
        .update(notifications)
        .set({ deletedAt: updatedAt, dedupeKey: null })
        .where(
          and(
            eq(notifications.subtaskId, current.id),
            inArray(notifications.type, [
              "subtask.due.soon",
              "subtask.due.overdue",
            ]),
            isNull(notifications.deletedAt),
          ),
        );
    }

    return {
      status: "updated" as const,
      subtask: await selectPublicSubtaskById(tx, updated.id),
    };
  });
};

export const setSubtaskOwner = async (
  db: dbClient,
  input: {
    subtaskPublicId: string;
    ownerPublicId: string | null;
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
    const current = await selectSubtaskForUpdate(tx, {
      cardId,
      subtaskPublicId: input.subtaskPublicId,
    });
    if (!current) return { status: "not_found" as const };

    const owner = input.ownerPublicId
      ? await resolveActiveWorkspaceMember(tx, {
          workspaceId: card.workspaceId,
          memberPublicId: input.ownerPublicId,
        })
      : null;
    if (input.ownerPublicId && !owner) {
      return { status: "owner_invalid" as const };
    }

    if (current.ownerWorkspaceMemberId === (owner?.id ?? null)) {
      return {
        status: "unchanged" as const,
        ownerChanged: false as const,
        subtaskId: current.id,
        subtask: await selectPublicSubtaskById(tx, current.id),
      };
    }

    const assignmentReference = generateUID();
    const previousOwner = current.ownerWorkspaceMemberId
      ? await tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.id, current.ownerWorkspaceMemberId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;
    await tx
      .update(cardSubtasks)
      .set({
        ownerWorkspaceMemberId: owner?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(cardSubtasks.id, current.id));
    await tx.insert(cardActivities).values({
      publicId: assignmentReference,
      type: "card.updated.subtask.updated",
      cardId: card.id,
      subtaskPublicId: current.publicId,
      createdBy: input.updatedBy,
    });
    if (previousOwner?.userId) {
      await tx
        .update(notifications)
        .set({ deletedAt: new Date(), dedupeKey: null })
        .where(
          and(
            eq(notifications.subtaskId, current.id),
            eq(notifications.userId, previousOwner.userId),
            inArray(notifications.type, [
              "subtask.due.soon",
              "subtask.due.overdue",
            ]),
            isNull(notifications.deletedAt),
          ),
        );
    }
    if (
      owner?.userId &&
      owner.userId !== input.updatedBy &&
      card.completedAt === null &&
      card.listStatus !== "done" &&
      !card.boardArchived
    ) {
      await tx
        .insert(notifications)
        .values({
          publicId: generateUID(),
          type: "subtask.assigned",
          userId: owner.userId,
          cardId: card.id,
          subtaskId: current.id,
          workspaceId: card.workspaceId,
          dedupeKey: assignmentDedupeKey(
            owner.userId,
            current.publicId,
            assignmentReference,
          ),
        })
        .onConflictDoNothing({ target: notifications.dedupeKey });
    }

    return {
      status: "updated" as const,
      ownerChanged: true as const,
      subtaskId: current.id,
      previousOwnerWorkspaceMemberId: current.ownerWorkspaceMemberId,
      assignmentReference,
      subtask: await selectPublicSubtaskById(tx, current.id),
    };
  });
};

export const moveSubtask = async (
  db: dbClient,
  input: {
    subtaskPublicId: string;
    destinationStagePublicId: string;
    destinationIndex: number;
    expectedWorkspaceId: number;
    movedBy: string;
  },
) => {
  if (!Number.isInteger(input.destinationIndex) || input.destinationIndex < 0) {
    return { status: "invalid_index" as const };
  }
  const cardId = await resolveSubtaskCardId(db, input.subtaskPublicId);
  if (cardId === null) return { status: "not_found" as const };

  return db.transaction(async (tx) => {
    const card = await lockPipelineCardById(tx, cardId);
    if (!card) return { status: "not_found" as const };
    if (card.workspaceId !== input.expectedWorkspaceId) {
      return { status: "workspace_changed" as const };
    }
    const current = await selectSubtaskForUpdate(tx, {
      cardId,
      subtaskPublicId: input.subtaskPublicId,
    });
    if (!current) return { status: "not_found" as const };

    const [destinationStage] = await tx
      .select({
        id: cardPipelineStages.id,
        publicId: cardPipelineStages.publicId,
        status: cardPipelineStages.status,
      })
      .from(cardPipelineStages)
      .where(
        and(
          eq(cardPipelineStages.publicId, input.destinationStagePublicId),
          eq(cardPipelineStages.cardId, card.id),
        ),
      )
      .limit(1)
      .for("update");
    if (!destinationStage) return { status: "invalid_destination" as const };

    const affectedStageIds = [
      ...new Set([current.stageId, destinationStage.id]),
    ];
    const ordered = await tx
      .select({
        id: cardSubtasks.id,
        stageId: cardSubtasks.stageId,
        publicId: cardSubtasks.publicId,
      })
      .from(cardSubtasks)
      .where(
        and(
          inArray(cardSubtasks.stageId, affectedStageIds),
          isNull(cardSubtasks.deletedAt),
        ),
      )
      .orderBy(asc(cardSubtasks.index), asc(cardSubtasks.id))
      .for("update");
    const sourceOrder = ordered
      .filter(
        (subtask) =>
          subtask.stageId === current.stageId && subtask.id !== current.id,
      )
      .map((subtask) => subtask.id);
    const destinationOrder =
      current.stageId === destinationStage.id
        ? sourceOrder
        : ordered
            .filter((subtask) => subtask.stageId === destinationStage.id)
            .map((subtask) => subtask.id);
    if (input.destinationIndex > destinationOrder.length) {
      return { status: "invalid_index" as const };
    }
    destinationOrder.splice(input.destinationIndex, 0, current.id);

    await setTemporaryStageIndices(tx, affectedStageIds);
    const updatedAt = new Date();
    if (current.stageId !== destinationStage.id) {
      for (const [index, subtaskId] of sourceOrder.entries()) {
        await tx
          .update(cardSubtasks)
          .set({ index, updatedAt })
          .where(eq(cardSubtasks.id, subtaskId));
      }
    }
    const lifecycle = deriveSubtaskLifecycle({
      currentStatus: current.stageStatus,
      destinationStatus: destinationStage.status,
      startedAt: current.startedAt,
      completedAt: current.completedAt,
      movedAt: updatedAt,
    });
    for (const [index, subtaskId] of destinationOrder.entries()) {
      await tx
        .update(cardSubtasks)
        .set({
          stageId: destinationStage.id,
          index,
          ...(subtaskId === current.id
            ? {
                startedAt: lifecycle.startedAt,
                completedAt: lifecycle.completedAt,
              }
            : {}),
          updatedAt,
        })
        .where(eq(cardSubtasks.id, subtaskId));
    }

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.subtask.moved",
      cardId: card.id,
      subtaskPublicId: current.publicId,
      fromPipelineStagePublicId: current.stagePublicId,
      toPipelineStagePublicId: destinationStage.publicId,
      createdBy: input.movedBy,
    });
    if (destinationStage.status === "done") {
      await tx
        .update(notifications)
        .set({ deletedAt: updatedAt, dedupeKey: null })
        .where(
          and(
            eq(notifications.subtaskId, current.id),
            inArray(notifications.type, [
              "subtask.due.soon",
              "subtask.due.overdue",
            ]),
            isNull(notifications.deletedAt),
          ),
        );
    }

    return {
      status: "moved" as const,
      subtask: await selectPublicSubtaskById(tx, current.id),
    };
  });
};

export const reorderSubtasks = async (
  db: dbClient,
  input: {
    stagePublicId: string;
    orderedSubtaskPublicIds: string[];
    expectedWorkspaceId: number;
    updatedBy: string;
  },
) => {
  const cardId = await resolveStageCardId(db, input.stagePublicId);
  if (cardId === null) return { status: "not_found" as const };

  return db.transaction(async (tx) => {
    const card = await lockPipelineCardById(tx, cardId);
    if (!card) return { status: "not_found" as const };
    if (card.workspaceId !== input.expectedWorkspaceId) {
      return { status: "workspace_changed" as const };
    }
    const [stage] = await tx
      .select({
        id: cardPipelineStages.id,
        publicId: cardPipelineStages.publicId,
      })
      .from(cardPipelineStages)
      .where(
        and(
          eq(cardPipelineStages.publicId, input.stagePublicId),
          eq(cardPipelineStages.cardId, card.id),
        ),
      )
      .limit(1)
      .for("update");
    if (!stage) return { status: "not_found" as const };

    const current = await tx
      .select({
        id: cardSubtasks.id,
        publicId: cardSubtasks.publicId,
        index: cardSubtasks.index,
      })
      .from(cardSubtasks)
      .where(
        and(eq(cardSubtasks.stageId, stage.id), isNull(cardSubtasks.deletedAt)),
      )
      .orderBy(asc(cardSubtasks.index), asc(cardSubtasks.id))
      .for("update");
    if (
      current.length !== input.orderedSubtaskPublicIds.length ||
      new Set(input.orderedSubtaskPublicIds).size !== current.length
    ) {
      return { status: "invalid_order" as const };
    }
    const byPublicId = new Map(current.map((item) => [item.publicId, item.id]));
    const orderedIds = input.orderedSubtaskPublicIds.map((publicId) =>
      byPublicId.get(publicId),
    );
    if (orderedIds.some((id) => id === undefined)) {
      return { status: "invalid_order" as const };
    }

    await setTemporaryStageIndices(tx, [stage.id]);
    const updatedAt = new Date();
    for (const [index, subtaskId] of orderedIds.entries()) {
      if (subtaskId === undefined) continue;
      await tx
        .update(cardSubtasks)
        .set({ index, updatedAt })
        .where(eq(cardSubtasks.id, subtaskId));
    }

    const previousById = new Map(current.map((item) => [item.id, item]));
    const activities = orderedIds.flatMap((subtaskId, toIndex) => {
      if (subtaskId === undefined) return [];
      const previous = previousById.get(subtaskId);
      if (!previous || previous.index === toIndex) return [];
      return [
        {
          publicId: generateUID(),
          type: "card.updated.subtask.moved" as const,
          cardId: card.id,
          subtaskPublicId: previous.publicId,
          fromIndex: previous.index,
          toIndex,
          fromPipelineStagePublicId: stage.publicId,
          toPipelineStagePublicId: stage.publicId,
          createdBy: input.updatedBy,
        },
      ];
    });
    if (activities.length > 0)
      await tx.insert(cardActivities).values(activities);

    return { status: "reordered" as const };
  });
};

export const softDeleteSubtask = async (
  db: dbClient,
  input: {
    subtaskPublicId: string;
    expectedWorkspaceId: number;
    deletedBy: string;
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
    const current = await selectSubtaskForUpdate(tx, {
      cardId,
      subtaskPublicId: input.subtaskPublicId,
    });
    if (!current) return { status: "not_found" as const };

    const deletedAt = new Date();
    await tx
      .update(cardSubtasks)
      .set({ deletedAt, deletedBy: input.deletedBy, updatedAt: deletedAt })
      .where(eq(cardSubtasks.id, current.id));
    await normalizeStage(tx, current.stageId);
    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.subtask.deleted",
      cardId: card.id,
      subtaskPublicId: current.publicId,
      fromPipelineStagePublicId: current.stagePublicId,
      fromTitle: current.title,
      createdBy: input.deletedBy,
    });
    await tx
      .update(notifications)
      .set({ deletedAt, dedupeKey: null })
      .where(
        and(
          eq(notifications.subtaskId, current.id),
          inArray(notifications.type, [
            "subtask.assigned",
            "subtask.due.soon",
            "subtask.due.overdue",
          ]),
          isNull(notifications.deletedAt),
        ),
      );

    return { status: "deleted" as const, publicId: current.publicId };
  });
};

export { clearInvalidOwnersForCardIdsTx } from "./cardSubtaskOwnerCleanup.repo";
