import { and, asc, count, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { CardPipelineStageStatus } from "@kan/db/schema";
import {
  boards,
  cardActivities,
  cardAttachments,
  cardPipelineStages,
  cardPipelineStageStatuses,
  cardResources,
  cards,
  cardSubtaskChecklistItems,
  cardSubtaskResources,
  cardSubtasks,
  lists,
  users,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";
import { lockPipelineCardByPublicId } from "./cardPipeline.internal";
import {
  lockCardsInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

export interface CardPipelineSummary {
  total: number;
  completed: number;
  blocked: number;
  progressPercent: number;
}

export interface CardPipelineStageUpdate {
  publicId: string;
  name?: string;
  colourCode?: string | null;
  index?: number;
}

export const DEFAULT_CARD_PIPELINE_STAGES: readonly {
  status: CardPipelineStageStatus;
  name: string;
}[] = [
  { status: "planned", name: "Por hacer" },
  { status: "inProgress", name: "En curso" },
  { status: "blocked", name: "Bloqueado" },
  { status: "done", name: "Hecho" },
];

const emptySummary = (): CardPipelineSummary => ({
  total: 0,
  completed: 0,
  blocked: 0,
  progressPercent: 0,
});

const hasExactStageSet = (
  stages: readonly { status: CardPipelineStageStatus; index: number }[],
) => {
  if (stages.length !== cardPipelineStageStatuses.length) return false;
  const statuses = new Set(stages.map((stage) => stage.status));
  const indexes = new Set(stages.map((stage) => stage.index));
  return (
    cardPipelineStageStatuses.every((status) => statuses.has(status)) &&
    indexes.size === cardPipelineStageStatuses.length &&
    cardPipelineStageStatuses.every((_, index) => indexes.has(index))
  );
};

const selectPublicStages = async (tx: DbTransaction, cardId: number) =>
  tx
    .select({
      publicId: cardPipelineStages.publicId,
      status: cardPipelineStages.status,
      name: cardPipelineStages.name,
      colourCode: cardPipelineStages.colourCode,
      index: cardPipelineStages.index,
      createdAt: cardPipelineStages.createdAt,
      updatedAt: cardPipelineStages.updatedAt,
    })
    .from(cardPipelineStages)
    .where(eq(cardPipelineStages.cardId, cardId))
    .orderBy(asc(cardPipelineStages.index), asc(cardPipelineStages.publicId));

const queryByCardPublicId = async (
  db: dbClient | DbTransaction,
  cardPublicId: string,
) => {
  const [card] = await db
    .select({ id: cards.id, publicId: cards.publicId })
    .from(cards)
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
    .where(
      and(
        eq(cards.publicId, cardPublicId),
        isNull(cards.deletedAt),
        isNull(lists.deletedAt),
        isNull(boards.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);

  if (!card) return null;

  const stages = await db
    .select({
      id: cardPipelineStages.id,
      publicId: cardPipelineStages.publicId,
      status: cardPipelineStages.status,
      name: cardPipelineStages.name,
      colourCode: cardPipelineStages.colourCode,
      index: cardPipelineStages.index,
      createdAt: cardPipelineStages.createdAt,
      updatedAt: cardPipelineStages.updatedAt,
    })
    .from(cardPipelineStages)
    .where(eq(cardPipelineStages.cardId, card.id))
    .orderBy(asc(cardPipelineStages.index), asc(cardPipelineStages.publicId));

  if (stages.length === 0) {
    return {
      cardPublicId: card.publicId,
      status: "uninitialized" as const,
      initialized: false,
      stages: [],
    };
  }

  if (!hasExactStageSet(stages)) {
    return {
      cardPublicId: card.publicId,
      status: "invalid_state" as const,
      initialized: false,
      stages: [],
    };
  }

  const stageIds = stages.map((stage) => stage.id);
  const subtasks = await db
    .select({
      id: cardSubtasks.id,
      publicId: cardSubtasks.publicId,
      stageId: cardSubtasks.stageId,
      title: cardSubtasks.title,
      description: cardSubtasks.description,
      priority: cardSubtasks.priority,
      dueDate: cardSubtasks.dueDate,
      startedAt: cardSubtasks.startedAt,
      completedAt: cardSubtasks.completedAt,
      index: cardSubtasks.index,
      createdAt: cardSubtasks.createdAt,
      updatedAt: cardSubtasks.updatedAt,
      ownerPublicId: workspaceMembers.publicId,
      ownerName: users.name,
      ownerImage: users.image,
    })
    .from(cardSubtasks)
    .leftJoin(
      workspaceMembers,
      eq(cardSubtasks.ownerWorkspaceMemberId, workspaceMembers.id),
    )
    .leftJoin(users, eq(workspaceMembers.userId, users.id))
    .where(
      and(
        inArray(cardSubtasks.stageId, stageIds),
        isNull(cardSubtasks.deletedAt),
      ),
    )
    .orderBy(asc(cardSubtasks.index), asc(cardSubtasks.publicId));

  const subtaskIds = subtasks.map((subtask) => subtask.id);
  const checklistItems =
    subtaskIds.length === 0
      ? []
      : await db
          .select({
            subtaskId: cardSubtaskChecklistItems.subtaskId,
            publicId: cardSubtaskChecklistItems.publicId,
            title: cardSubtaskChecklistItems.title,
            completed: cardSubtaskChecklistItems.completed,
            index: cardSubtaskChecklistItems.index,
            createdAt: cardSubtaskChecklistItems.createdAt,
            updatedAt: cardSubtaskChecklistItems.updatedAt,
          })
          .from(cardSubtaskChecklistItems)
          .where(
            and(
              inArray(cardSubtaskChecklistItems.subtaskId, subtaskIds),
              isNull(cardSubtaskChecklistItems.deletedAt),
            ),
          )
          .orderBy(
            asc(cardSubtaskChecklistItems.index),
            asc(cardSubtaskChecklistItems.publicId),
          );
  const resources =
    subtaskIds.length === 0
      ? []
      : await db
          .select({
            subtaskId: cardSubtaskResources.subtaskId,
            relationPublicId: cardSubtaskResources.publicId,
            publicId: cardResources.publicId,
            kind: cardResources.kind,
            title: cardResources.title,
            driveType: cardResources.driveType,
            driveFileId: cardResources.driveFileId,
            resourceKey: cardResources.resourceKey,
            attachmentPublicId: cardAttachments.publicId,
            filename: cardAttachments.filename,
            originalFilename: cardAttachments.originalFilename,
            contentType: cardAttachments.contentType,
            size: cardAttachments.size,
            createdAt: cardSubtaskResources.createdAt,
          })
          .from(cardSubtaskResources)
          .innerJoin(
            cardResources,
            or(
              eq(cardSubtaskResources.resourceId, cardResources.id),
              and(
                isNull(cardSubtaskResources.resourceId),
                eq(
                  cardSubtaskResources.attachmentId,
                  cardResources.attachmentId,
                ),
              ),
            ),
          )
          .leftJoin(
            cardAttachments,
            eq(cardResources.attachmentId, cardAttachments.id),
          )
          .where(
            and(
              inArray(cardSubtaskResources.subtaskId, subtaskIds),
              isNull(cardSubtaskResources.deletedAt),
              isNull(cardResources.deletedAt),
              or(
                eq(cardResources.kind, "drive"),
                and(
                  isNull(cardAttachments.deletedAt),
                  isNull(cardAttachments.storageQuarantinedAt),
                ),
              ),
            ),
          )
          .orderBy(
            asc(cardSubtaskResources.createdAt),
            asc(cardSubtaskResources.publicId),
          );

  const checklistBySubtask = new Map<number, typeof checklistItems>();
  for (const item of checklistItems) {
    const items = checklistBySubtask.get(item.subtaskId) ?? [];
    items.push(item);
    checklistBySubtask.set(item.subtaskId, items);
  }
  const resourcesBySubtask = new Map<number, typeof resources>();
  for (const resource of resources) {
    const items = resourcesBySubtask.get(resource.subtaskId) ?? [];
    items.push(resource);
    resourcesBySubtask.set(resource.subtaskId, items);
  }
  const subtasksByStage = new Map<number, typeof subtasks>();
  for (const subtask of subtasks) {
    const items = subtasksByStage.get(subtask.stageId) ?? [];
    items.push(subtask);
    subtasksByStage.set(subtask.stageId, items);
  }

  return {
    cardPublicId: card.publicId,
    status: "ready" as const,
    initialized: true,
    stages: stages.map(({ id: stageId, ...stage }) => ({
      ...stage,
      subtasks: (subtasksByStage.get(stageId) ?? []).map(
        ({
          id: subtaskId,
          stageId: _stageId,
          ownerPublicId,
          ownerName,
          ownerImage,
          ...subtask
        }) => ({
          ...subtask,
          owner: ownerPublicId
            ? {
                publicId: ownerPublicId,
                name: ownerName,
                image: ownerImage,
              }
            : null,
          checklistItems: (checklistBySubtask.get(subtaskId) ?? []).map(
            ({ subtaskId: _subtaskId, ...item }) => item,
          ),
          resources: (resourcesBySubtask.get(subtaskId) ?? []).map(
            ({ subtaskId: _subtaskId, ...resource }) => resource,
          ),
        }),
      ),
    })),
  };
};

export const getByCardPublicId = (db: dbClient, cardPublicId: string) =>
  queryByCardPublicId(db, cardPublicId);

export const getByCardPublicIdGuarded = async (
  db: dbClient,
  args: {
    cardPublicId: string;
    expectedWorkspaceId: number;
    requirePublic: boolean;
  },
) =>
  db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(
        and(eq(cards.publicId, args.cardPublicId), isNull(cards.deletedAt)),
      )
      .limit(1);
    if (!candidate) throw new WorkspaceChangedError();
    const [lockedCard] = await lockCardsInWorkspace(
      tx,
      [candidate.id],
      args.expectedWorkspaceId,
      { cardLock: "share", requirePublic: args.requirePublic },
    );
    if (!lockedCard || lockedCard.publicId !== args.cardPublicId) {
      throw new WorkspaceChangedError();
    }

    const pipeline = await queryByCardPublicId(tx, args.cardPublicId);
    if (!pipeline) throw new WorkspaceChangedError();
    return {
      pipeline,
      summary: await getSummaryByCardId(tx, lockedCard.id),
    };
  });

export const initialize = async (
  db: dbClient,
  input: {
    cardPublicId: string;
    expectedWorkspaceId: number;
    createdBy: string;
  },
) =>
  db.transaction(async (tx) => {
    const card = await lockPipelineCardByPublicId(tx, input.cardPublicId);
    if (!card) return { status: "not_found" as const };
    if (card.workspaceId !== input.expectedWorkspaceId) {
      return { status: "workspace_changed" as const };
    }

    const existing = await tx
      .select({
        status: cardPipelineStages.status,
        index: cardPipelineStages.index,
      })
      .from(cardPipelineStages)
      .where(eq(cardPipelineStages.cardId, card.id))
      .orderBy(asc(cardPipelineStages.id))
      .for("update");

    if (existing.length > 0) {
      if (!hasExactStageSet(existing)) {
        return { status: "invalid_state" as const };
      }
      return {
        status: "existing" as const,
        stages: await selectPublicStages(tx, card.id),
      };
    }

    await tx.insert(cardPipelineStages).values(
      DEFAULT_CARD_PIPELINE_STAGES.map((stage, index) => ({
        publicId: generateUID(),
        cardId: card.id,
        status: stage.status,
        name: stage.name,
        index,
        createdBy: input.createdBy,
      })),
    );
    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.pipeline.initialized",
      cardId: card.id,
      createdBy: input.createdBy,
    });

    return {
      status: "initialized" as const,
      stages: await selectPublicStages(tx, card.id),
    };
  });

export const updateStages = async (
  db: dbClient,
  input: {
    cardPublicId: string;
    expectedWorkspaceId: number;
    stages: CardPipelineStageUpdate[];
    updatedBy: string;
  },
) =>
  db.transaction(async (tx) => {
    if (
      input.stages.length < 1 ||
      input.stages.length > cardPipelineStageStatuses.length ||
      new Set(input.stages.map((stage) => stage.publicId)).size !==
        input.stages.length ||
      input.stages.some(
        (stage) =>
          (stage.name !== undefined && stage.name.trim().length === 0) ||
          (stage.index !== undefined &&
            (!Number.isInteger(stage.index) ||
              stage.index < 0 ||
              stage.index >= cardPipelineStageStatuses.length)) ||
          (stage.name === undefined &&
            stage.colourCode === undefined &&
            stage.index === undefined),
      )
    ) {
      return { status: "invalid_input" as const };
    }

    const card = await lockPipelineCardByPublicId(tx, input.cardPublicId);
    if (!card) return { status: "not_found" as const };
    if (card.workspaceId !== input.expectedWorkspaceId) {
      return { status: "workspace_changed" as const };
    }

    const currentStages = await tx
      .select()
      .from(cardPipelineStages)
      .where(eq(cardPipelineStages.cardId, card.id))
      .orderBy(asc(cardPipelineStages.id))
      .for("update");
    if (currentStages.length === 0) {
      return { status: "not_initialized" as const };
    }
    if (!hasExactStageSet(currentStages)) {
      return { status: "invalid_state" as const };
    }

    const inputByPublicId = new Map(
      input.stages.map((stage) => [stage.publicId, stage]),
    );
    const currentByPublicId = new Map(
      currentStages.map((stage) => [stage.publicId, stage]),
    );
    if (input.stages.some((stage) => !currentByPublicId.has(stage.publicId))) {
      return { status: "invalid_input" as const };
    }

    const mergedStages = currentStages.map((current) => {
      const patch = inputByPublicId.get(current.publicId);
      return {
        ...current,
        name: patch?.name?.trim() ?? current.name,
        colourCode:
          patch?.colourCode !== undefined
            ? patch.colourCode
            : current.colourCode,
        index: patch?.index ?? current.index,
      };
    });
    if (
      new Set(mergedStages.map((stage) => stage.index)).size !==
        cardPipelineStageStatuses.length ||
      mergedStages.some(
        (stage) =>
          stage.index < 0 || stage.index >= cardPipelineStageStatuses.length,
      )
    ) {
      return { status: "invalid_input" as const };
    }

    const reindexedStageIds = currentStages.flatMap((current) => {
      const patch = inputByPublicId.get(current.publicId);
      return patch?.index !== undefined && patch.index !== current.index
        ? [current.id]
        : [];
    });
    if (reindexedStageIds.length > 0) {
      await tx
        .update(cardPipelineStages)
        .set({ index: sql`-${cardPipelineStages.index} - 1` })
        .where(inArray(cardPipelineStages.id, reindexedStageIds));
    }

    const updatedAt = new Date();
    const activities = [];
    for (const patch of input.stages) {
      const current = currentByPublicId.get(patch.publicId);
      if (!current) return { status: "invalid_input" as const };
      const nextName = patch.name?.trim() ?? current.name;
      const nextColourCode =
        patch.colourCode !== undefined ? patch.colourCode : current.colourCode;
      const nextIndex = patch.index ?? current.index;
      if (
        current.name === nextName &&
        current.colourCode === nextColourCode &&
        current.index === nextIndex
      ) {
        continue;
      }

      const update: {
        name?: string;
        colourCode?: string | null;
        index?: number;
        updatedAt: Date;
      } = { updatedAt };
      if (patch.name !== undefined) update.name = nextName;
      if (patch.colourCode !== undefined) {
        update.colourCode = nextColourCode;
      }
      if (patch.index !== undefined) update.index = nextIndex;

      await tx
        .update(cardPipelineStages)
        .set(update)
        .where(eq(cardPipelineStages.id, current.id));

      activities.push({
        publicId: generateUID(),
        type: "card.updated.pipeline.stage.updated" as const,
        cardId: card.id,
        createdBy: input.updatedBy,
        fromTitle: current.name,
        toTitle: nextName,
        fromPipelineStagePublicId: current.publicId,
        toPipelineStagePublicId: current.publicId,
      });
    }

    if (activities.length > 0)
      await tx.insert(cardActivities).values(activities);

    return {
      status: "updated" as const,
      stages: await selectPublicStages(tx, card.id),
    };
  });

export {
  clonePipelineForCard,
  clonePipelineForCardTx,
} from "./cardPipelineClone.repo";

export const getSummariesByCardIds = async (
  db: dbClient | DbTransaction,
  cardIds: number[],
): Promise<Map<number, CardPipelineSummary>> => {
  const uniqueCardIds = [...new Set(cardIds)];
  const summaries = new Map(
    uniqueCardIds.map((cardId) => [cardId, emptySummary()]),
  );
  if (uniqueCardIds.length === 0) return summaries;

  const stageRows = await db
    .select({
      cardId: cardPipelineStages.cardId,
      status: cardPipelineStages.status,
      index: cardPipelineStages.index,
    })
    .from(cardPipelineStages)
    .where(inArray(cardPipelineStages.cardId, uniqueCardIds));
  const stagesByCardId = new Map<number, typeof stageRows>();
  for (const stage of stageRows) {
    const stages = stagesByCardId.get(stage.cardId) ?? [];
    stages.push(stage);
    stagesByCardId.set(stage.cardId, stages);
  }
  const validCardIds = uniqueCardIds.filter((cardId) =>
    hasExactStageSet(stagesByCardId.get(cardId) ?? []),
  );
  if (validCardIds.length === 0) return summaries;

  const rows = await db
    .select({
      cardId: cardSubtasks.cardId,
      total: count(cardSubtasks.id),
      completed: sql<number>`count(*) filter (where ${cardPipelineStages.status} = 'done')`,
      blocked: sql<number>`count(*) filter (where ${cardPipelineStages.status} = 'blocked')`,
    })
    .from(cardSubtasks)
    .innerJoin(
      cardPipelineStages,
      eq(cardSubtasks.stageId, cardPipelineStages.id),
    )
    .where(
      and(
        inArray(cardSubtasks.cardId, validCardIds),
        isNull(cardSubtasks.deletedAt),
      ),
    )
    .groupBy(cardSubtasks.cardId);

  for (const row of rows) {
    const total = Number(row.total);
    const completed = Number(row.completed);
    summaries.set(row.cardId, {
      total,
      completed,
      blocked: Number(row.blocked),
      progressPercent: total === 0 ? 0 : Math.round((completed / total) * 100),
    });
  }

  return summaries;
};

export const getSummaryByCardId = async (
  db: dbClient | DbTransaction,
  cardId: number,
): Promise<CardPipelineSummary> =>
  (await getSummariesByCardIds(db, [cardId])).get(cardId) ?? emptySummary();

export const getSummariesByCardPublicIds = async (
  db: dbClient | DbTransaction,
  cardPublicIds: string[],
): Promise<Map<string, CardPipelineSummary>> => {
  const uniquePublicIds = [...new Set(cardPublicIds)];
  const result = new Map(
    uniquePublicIds.map((publicId) => [publicId, emptySummary()]),
  );
  if (uniquePublicIds.length === 0) return result;

  const activeCards = await db
    .select({ id: cards.id, publicId: cards.publicId })
    .from(cards)
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
    .where(
      and(
        inArray(cards.publicId, uniquePublicIds),
        isNull(cards.deletedAt),
        isNull(lists.deletedAt),
        isNull(boards.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    );
  const summaries = await getSummariesByCardIds(
    db,
    activeCards.map((card) => card.id),
  );
  for (const card of activeCards) {
    result.set(card.publicId, summaries.get(card.id) ?? emptySummary());
  }

  return result;
};

export const countOpenSubtasksByCardId = async (
  db: dbClient,
  cardId: number,
) => {
  const [result] = await db
    .select({ count: count(cardSubtasks.id) })
    .from(cardSubtasks)
    .innerJoin(
      cardPipelineStages,
      eq(cardSubtasks.stageId, cardPipelineStages.id),
    )
    .where(
      and(
        eq(cardSubtasks.cardId, cardId),
        isNull(cardSubtasks.deletedAt),
        ne(cardPipelineStages.status, "done"),
      ),
    );

  return Number(result?.count ?? 0);
};
