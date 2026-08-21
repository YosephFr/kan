import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  cardPipelineStages,
  cardSubtasks,
  workspaceMembers,
} from "@kan/db/schema";

import type { DbTransaction } from "./cardPipeline.internal";

export async function selectSubtaskForUpdate(
  tx: DbTransaction,
  input: { cardId: number; subtaskPublicId: string },
) {
  const [subtask] = await tx
    .select({
      id: cardSubtasks.id,
      publicId: cardSubtasks.publicId,
      cardId: cardSubtasks.cardId,
      stageId: cardSubtasks.stageId,
      stagePublicId: cardPipelineStages.publicId,
      stageStatus: cardPipelineStages.status,
      title: cardSubtasks.title,
      description: cardSubtasks.description,
      priority: cardSubtasks.priority,
      dueDate: cardSubtasks.dueDate,
      startedAt: cardSubtasks.startedAt,
      completedAt: cardSubtasks.completedAt,
      ownerWorkspaceMemberId: cardSubtasks.ownerWorkspaceMemberId,
      index: cardSubtasks.index,
    })
    .from(cardSubtasks)
    .innerJoin(
      cardPipelineStages,
      eq(cardSubtasks.stageId, cardPipelineStages.id),
    )
    .where(
      and(
        eq(cardSubtasks.publicId, input.subtaskPublicId),
        eq(cardSubtasks.cardId, input.cardId),
        isNull(cardSubtasks.deletedAt),
      ),
    )
    .limit(1)
    .for("update", { of: cardSubtasks });

  return subtask ?? null;
}

export async function selectPublicSubtaskById(
  tx: DbTransaction,
  subtaskId: number,
) {
  const [subtask] = await tx
    .select({
      publicId: cardSubtasks.publicId,
      title: cardSubtasks.title,
      description: cardSubtasks.description,
      priority: cardSubtasks.priority,
      dueDate: cardSubtasks.dueDate,
      startedAt: cardSubtasks.startedAt,
      completedAt: cardSubtasks.completedAt,
      index: cardSubtasks.index,
      stagePublicId: cardPipelineStages.publicId,
      stageStatus: cardPipelineStages.status,
      ownerPublicId: workspaceMembers.publicId,
      createdAt: cardSubtasks.createdAt,
      updatedAt: cardSubtasks.updatedAt,
    })
    .from(cardSubtasks)
    .innerJoin(
      cardPipelineStages,
      eq(cardSubtasks.stageId, cardPipelineStages.id),
    )
    .leftJoin(
      workspaceMembers,
      eq(cardSubtasks.ownerWorkspaceMemberId, workspaceMembers.id),
    )
    .where(and(eq(cardSubtasks.id, subtaskId), isNull(cardSubtasks.deletedAt)))
    .limit(1);

  return subtask ?? null;
}

export async function setTemporaryStageIndices(
  tx: DbTransaction,
  stageIds: number[],
) {
  if (stageIds.length === 0) return;
  await tx
    .update(cardSubtasks)
    .set({ index: sql`-${cardSubtasks.index} - 1` })
    .where(
      and(
        inArray(cardSubtasks.stageId, [...new Set(stageIds)]),
        isNull(cardSubtasks.deletedAt),
      ),
    );
}

export async function normalizeStage(tx: DbTransaction, stageId: number) {
  const active = await tx
    .select({ id: cardSubtasks.id })
    .from(cardSubtasks)
    .where(
      and(eq(cardSubtasks.stageId, stageId), isNull(cardSubtasks.deletedAt)),
    )
    .orderBy(asc(cardSubtasks.index), asc(cardSubtasks.id));

  await setTemporaryStageIndices(tx, [stageId]);
  for (const [index, subtask] of active.entries()) {
    await tx
      .update(cardSubtasks)
      .set({ index })
      .where(eq(cardSubtasks.id, subtask.id));
  }
}
