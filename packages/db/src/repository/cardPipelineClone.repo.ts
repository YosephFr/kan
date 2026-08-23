import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  cardActivities,
  cardPipelineStages,
  cardPipelineStageStatuses,
  cardSubtaskChecklistItems,
  cardSubtasks,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";
import { lockPipelineCardsByIds } from "./cardPipeline.internal";

export interface ClonePipelineInput {
  sourceCardId: number;
  destinationCardId: number;
  expectedSourceWorkspaceId: number;
  expectedDestinationWorkspaceId: number;
  createdBy: string;
}

export const clonePipelineForCard = async (
  db: dbClient,
  input: ClonePipelineInput,
) => db.transaction((tx) => clonePipelineForCardTx(tx, input));

export const clonePipelineForCardTx = async (
  tx: DbTransaction,
  input: ClonePipelineInput,
) => {
  if (input.sourceCardId === input.destinationCardId) {
    return { status: "invalid_destination" as const };
  }

  const lockedCards = await lockPipelineCardsByIds(tx, [
    input.sourceCardId,
    input.destinationCardId,
  ]);
  if (lockedCards.length !== 2) return { status: "not_found" as const };
  const sourceCard = lockedCards.find((card) => card.id === input.sourceCardId);
  const destinationCard = lockedCards.find(
    (card) => card.id === input.destinationCardId,
  );
  if (
    !sourceCard ||
    !destinationCard ||
    sourceCard.workspaceId !== input.expectedSourceWorkspaceId ||
    destinationCard.workspaceId !== input.expectedDestinationWorkspaceId
  ) {
    return { status: "workspace_changed" as const };
  }

  const sourceStages = await tx
    .select()
    .from(cardPipelineStages)
    .where(eq(cardPipelineStages.cardId, input.sourceCardId))
    .orderBy(asc(cardPipelineStages.index), asc(cardPipelineStages.id))
    .for("update");
  if (sourceStages.length === 0) return { status: "no_pipeline" as const };
  const statuses = new Set(sourceStages.map((stage) => stage.status));
  const indexes = new Set(sourceStages.map((stage) => stage.index));
  if (
    sourceStages.length !== cardPipelineStageStatuses.length ||
    !cardPipelineStageStatuses.every((status) => statuses.has(status)) ||
    !cardPipelineStageStatuses.every((_, index) => indexes.has(index))
  ) {
    return { status: "invalid_source" as const };
  }

  const destinationStages = await tx
    .select({ id: cardPipelineStages.id })
    .from(cardPipelineStages)
    .where(eq(cardPipelineStages.cardId, input.destinationCardId))
    .for("update");
  if (destinationStages.length > 0) {
    return { status: "destination_initialized" as const };
  }

  const insertedStages = await tx
    .insert(cardPipelineStages)
    .values(
      sourceStages.map((stage) => ({
        publicId: generateUID(),
        cardId: input.destinationCardId,
        status: stage.status,
        name: stage.name,
        colourCode: stage.colourCode,
        index: stage.index,
        createdBy: input.createdBy,
      })),
    )
    .returning({
      id: cardPipelineStages.id,
      publicId: cardPipelineStages.publicId,
      status: cardPipelineStages.status,
    });
  const plannedStage = insertedStages.find(
    (stage) => stage.status === "planned",
  );
  if (!plannedStage) throw new Error("Cloned pipeline has no planned stage");

  const sourceSubtasks = await tx
    .select({
      id: cardSubtasks.id,
      publicId: cardSubtasks.publicId,
      title: cardSubtasks.title,
      description: cardSubtasks.description,
      priority: cardSubtasks.priority,
      index: cardSubtasks.index,
    })
    .from(cardSubtasks)
    .innerJoin(
      cardPipelineStages,
      eq(cardSubtasks.stageId, cardPipelineStages.id),
    )
    .where(
      and(
        eq(cardSubtasks.cardId, input.sourceCardId),
        isNull(cardSubtasks.deletedAt),
      ),
    )
    .orderBy(
      asc(cardPipelineStages.index),
      asc(cardSubtasks.index),
      asc(cardSubtasks.id),
    );
  const preparedSubtasks = sourceSubtasks.map((subtask, index) => ({
    sourceSubtaskId: subtask.id,
    sourceSubtaskPublicId: subtask.publicId,
    values: {
      publicId: generateUID(),
      cardId: input.destinationCardId,
      stageId: plannedStage.id,
      title: subtask.title,
      description: subtask.description,
      priority: subtask.priority,
      dueDate: null,
      startedAt: null,
      completedAt: null,
      ownerWorkspaceMemberId: null,
      index,
      createdBy: input.createdBy,
    },
  }));
  const insertedSubtasks =
    sourceSubtasks.length === 0
      ? []
      : await tx
          .insert(cardSubtasks)
          .values(preparedSubtasks.map((subtask) => subtask.values))
          .returning({
            id: cardSubtasks.id,
            publicId: cardSubtasks.publicId,
          });
  const insertedByPublicId = new Map(
    insertedSubtasks.map((subtask) => [subtask.publicId, subtask]),
  );
  const destinationBySourceSubtaskId = new Map(
    preparedSubtasks.flatMap((source) => {
      const destination = insertedByPublicId.get(source.values.publicId);
      return destination
        ? [[source.sourceSubtaskId, destination] as const]
        : [];
    }),
  );
  if (destinationBySourceSubtaskId.size !== sourceSubtasks.length) {
    throw new Error("Failed to map cloned subtasks");
  }
  const subtaskPublicIdBySourcePublicId = new Map(
    preparedSubtasks.flatMap((source) => {
      const destination = insertedByPublicId.get(source.values.publicId);
      return destination
        ? [[source.sourceSubtaskPublicId, destination.publicId] as const]
        : [];
    }),
  );
  if (subtaskPublicIdBySourcePublicId.size !== sourceSubtasks.length) {
    throw new Error("Failed to map cloned subtask public IDs");
  }

  if (sourceSubtasks.length > 0) {
    const sourceChecklistItems = await tx
      .select({
        subtaskId: cardSubtaskChecklistItems.subtaskId,
        title: cardSubtaskChecklistItems.title,
        index: cardSubtaskChecklistItems.index,
      })
      .from(cardSubtaskChecklistItems)
      .where(
        and(
          inArray(
            cardSubtaskChecklistItems.subtaskId,
            sourceSubtasks.map((subtask) => subtask.id),
          ),
          isNull(cardSubtaskChecklistItems.deletedAt),
        ),
      )
      .orderBy(
        asc(cardSubtaskChecklistItems.subtaskId),
        asc(cardSubtaskChecklistItems.index),
        asc(cardSubtaskChecklistItems.id),
      );
    const checklistValues = sourceChecklistItems.flatMap((item) => {
      const destination = destinationBySourceSubtaskId.get(item.subtaskId);
      return destination
        ? [
            {
              publicId: generateUID(),
              subtaskId: destination.id,
              title: item.title,
              completed: false,
              index: item.index,
              createdBy: input.createdBy,
            },
          ]
        : [];
    });
    if (checklistValues.length > 0) {
      await tx.insert(cardSubtaskChecklistItems).values(checklistValues);
    }
  }

  await tx.insert(cardActivities).values([
    {
      publicId: generateUID(),
      type: "card.updated.pipeline.initialized" as const,
      cardId: input.destinationCardId,
      createdBy: input.createdBy,
    },
    ...sourceSubtasks.flatMap((source) => {
      const destination = destinationBySourceSubtaskId.get(source.id);
      return destination
        ? [
            {
              publicId: generateUID(),
              type: "card.updated.subtask.added" as const,
              cardId: input.destinationCardId,
              subtaskPublicId: destination.publicId,
              toPipelineStagePublicId: plannedStage.publicId,
              toTitle: source.title,
              createdBy: input.createdBy,
            },
          ]
        : [];
    }),
  ]);

  return {
    status: "cloned" as const,
    stages: insertedStages.map(({ id: _id, ...stage }) => stage),
    subtaskPublicIds: insertedSubtasks.map((subtask) => subtask.publicId),
    subtaskBySourceId: destinationBySourceSubtaskId,
    subtaskPublicIdBySourcePublicId,
  };
};
