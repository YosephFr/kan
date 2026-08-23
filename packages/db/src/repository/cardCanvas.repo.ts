import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { CardPipelineStageStatus, CardPriority } from "@kan/db/schema";
import {
  cardActivities,
  cardCanvases,
  cardCanvasFrames,
  cardCanvasRevisions,
  cardPipelineStages,
  cardPipelineStageStatuses,
  cards,
  cardSubtaskChecklistItems,
  cardSubtasks,
  notifications,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type {
  CardCanvasCasResult,
  PreparedCardCanvasScene,
} from "./cardCanvas.internal";
import type { DbTransaction } from "./cardPipeline.internal";
import {
  applyNormalizedCanvasTx,
  CardCanvasReferenceError,
  getCanvasHeadByCardIdTx,
  getCanvasHeadForUpdateTx,
  prepareCardCanvasScene,
} from "./cardCanvas.internal";
import {
  deriveSubtaskLifecycle,
  lockPipelineCardByPublicId,
  resolveActiveWorkspaceMember,
} from "./cardPipeline.internal";
import { DEFAULT_CARD_PIPELINE_STAGES } from "./cardPipeline.repo";
import {
  lockCardsInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

const assignmentDedupeKey = (
  userId: string,
  subtaskPublicId: string,
  assignmentReference: string,
) =>
  ["subtask.assigned", userId, subtaskPublicId, assignmentReference].join(":");

function hasExactStageSet(
  stages: readonly { status: CardPipelineStageStatus; index: number }[],
) {
  return (
    stages.length === cardPipelineStageStatuses.length &&
    new Set(stages.map((stage) => stage.status)).size ===
      cardPipelineStageStatuses.length &&
    new Set(stages.map((stage) => stage.index)).size ===
      cardPipelineStageStatuses.length &&
    cardPipelineStageStatuses.every((status) =>
      stages.some((stage) => stage.status === status),
    ) &&
    cardPipelineStageStatuses.every((_, index) =>
      stages.some((stage) => stage.index === index),
    )
  );
}

async function resolveCardId(
  db: dbClient | DbTransaction,
  cardPublicId: string,
) {
  const [card] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)))
    .limit(1);
  return card?.id ?? null;
}

export const getSnapshot = async (
  db: dbClient,
  input: {
    cardPublicId: string;
    expectedWorkspaceId: number;
    requirePublic: boolean;
  },
) =>
  db.transaction(async (tx) => {
    const cardId = await resolveCardId(tx, input.cardPublicId);
    if (cardId === null) throw new WorkspaceChangedError();
    const [card] = await lockCardsInWorkspace(
      tx,
      [cardId],
      input.expectedWorkspaceId,
      { cardLock: "share", requirePublic: input.requirePublic },
    );
    if (!card || card.publicId !== input.cardPublicId) {
      throw new WorkspaceChangedError();
    }
    return getCanvasHeadByCardIdTx(tx, card.id);
  });

export const save = async (
  db: dbClient,
  input: {
    cardPublicId: string;
    expectedWorkspaceId: number;
    expectedVersion: number;
    scene: unknown;
    actorId: string;
  },
) => {
  const prepared = await prepareCardCanvasScene(input.scene);
  return db.transaction(async (tx) => {
    const cardId = await resolveCardId(tx, input.cardPublicId);
    if (cardId === null) throw new WorkspaceChangedError();
    const [card] = await lockCardsInWorkspace(
      tx,
      [cardId],
      input.expectedWorkspaceId,
      { cardLock: "update" },
    );
    if (!card || card.publicId !== input.cardPublicId) {
      throw new WorkspaceChangedError();
    }
    return applyNormalizedCanvasTx(tx, {
      cardId: card.id,
      expectedVersion: input.expectedVersion,
      prepared,
      actorId: input.actorId,
    });
  });
};

export const listRevisions = async (
  db: dbClient,
  input: {
    cardPublicId: string;
    expectedWorkspaceId: number;
  },
) =>
  db.transaction(async (tx) => {
    const cardId = await resolveCardId(tx, input.cardPublicId);
    if (cardId === null) throw new WorkspaceChangedError();
    const [card] = await lockCardsInWorkspace(
      tx,
      [cardId],
      input.expectedWorkspaceId,
      { cardLock: "share" },
    );
    if (!card || card.publicId !== input.cardPublicId) {
      throw new WorkspaceChangedError();
    }
    const head = await getCanvasHeadByCardIdTx(tx, card.id);
    if (!head) return [];
    return tx
      .select({
        publicId: cardCanvasRevisions.publicId,
        version: cardCanvasRevisions.sourceVersion,
        kind: cardCanvasRevisions.kind,
        bytes: cardCanvasRevisions.bytes,
        elementCount: cardCanvasRevisions.elementCount,
        createdAt: cardCanvasRevisions.createdAt,
      })
      .from(cardCanvasRevisions)
      .where(eq(cardCanvasRevisions.canvasId, head.id))
      .orderBy(
        desc(cardCanvasRevisions.createdAt),
        desc(cardCanvasRevisions.id),
      );
  });

export const restore = async (
  db: dbClient,
  input: {
    cardPublicId: string;
    revisionPublicId: string;
    expectedWorkspaceId: number;
    expectedVersion: number;
    actorId: string;
  },
): Promise<CardCanvasCasResult | { status: "revision_not_found" }> =>
  db.transaction(async (tx) => {
    const cardId = await resolveCardId(tx, input.cardPublicId);
    if (cardId === null) throw new WorkspaceChangedError();
    const [card] = await lockCardsInWorkspace(
      tx,
      [cardId],
      input.expectedWorkspaceId,
      { cardLock: "update" },
    );
    if (!card || card.publicId !== input.cardPublicId) {
      throw new WorkspaceChangedError();
    }
    const head = await getCanvasHeadForUpdateTx(tx, card.id);
    if (!head || head.version !== input.expectedVersion) {
      return {
        status: "conflict" as const,
        code: "CANVAS_VERSION_CONFLICT" as const,
        remoteVersion: head?.version ?? 0,
      };
    }
    const [revision] = await tx
      .select({ scene: cardCanvasRevisions.scene })
      .from(cardCanvasRevisions)
      .where(
        and(
          eq(cardCanvasRevisions.publicId, input.revisionPublicId),
          eq(cardCanvasRevisions.canvasId, head.id),
        ),
      )
      .limit(1)
      .for("share");
    if (!revision) return { status: "revision_not_found" as const };
    const prepared = await prepareCardCanvasScene(revision.scene);
    return applyNormalizedCanvasTx(tx, {
      cardId: card.id,
      expectedVersion: input.expectedVersion,
      prepared,
      actorId: input.actorId,
      checkpoint: "preRestore",
    });
  });

async function queryFrames(
  tx: DbTransaction,
  cardId: number,
  includeTombstones: boolean,
) {
  const head = await getCanvasHeadByCardIdTx(tx, cardId);
  if (!head) return [];
  const rows = await tx
    .select({
      publicId: cardCanvasFrames.publicId,
      elementId: cardCanvasFrames.elementId,
      name: cardCanvasFrames.name,
      present: cardCanvasFrames.present,
      subtaskId: cardSubtasks.id,
      subtaskPublicId: cardSubtasks.publicId,
      subtaskTitle: cardSubtasks.title,
      stageStatus: cardPipelineStages.status,
    })
    .from(cardCanvasFrames)
    .leftJoin(
      cardSubtasks,
      and(
        eq(cardCanvasFrames.subtaskId, cardSubtasks.id),
        isNull(cardSubtasks.deletedAt),
      ),
    )
    .leftJoin(
      cardPipelineStages,
      eq(cardSubtasks.stageId, cardPipelineStages.id),
    )
    .where(
      includeTombstones
        ? eq(cardCanvasFrames.canvasId, head.id)
        : and(
            eq(cardCanvasFrames.canvasId, head.id),
            eq(cardCanvasFrames.present, true),
          ),
    )
    .orderBy(asc(cardCanvasFrames.id));
  const subtaskIds = rows.flatMap((row) =>
    row.subtaskId === null ? [] : [row.subtaskId],
  );
  const checklistRows =
    subtaskIds.length === 0
      ? []
      : await tx
          .select({
            subtaskId: cardSubtaskChecklistItems.subtaskId,
            total: count(cardSubtaskChecklistItems.id),
            completed:
              sql<number>`count(*) filter (where ${cardSubtaskChecklistItems.completed} = true)`.mapWith(
                Number,
              ),
          })
          .from(cardSubtaskChecklistItems)
          .where(
            and(
              inArray(cardSubtaskChecklistItems.subtaskId, subtaskIds),
              isNull(cardSubtaskChecklistItems.deletedAt),
            ),
          )
          .groupBy(cardSubtaskChecklistItems.subtaskId);
  const checklistBySubtaskId = new Map(
    checklistRows.map((row) => [
      row.subtaskId,
      { total: Number(row.total), completed: Number(row.completed) },
    ]),
  );
  return rows.map((row) => {
    const checklist = row.subtaskId
      ? (checklistBySubtaskId.get(row.subtaskId) ?? {
          total: 0,
          completed: 0,
        })
      : { total: 0, completed: 0 };
    return {
      publicId: row.publicId,
      elementId: row.elementId,
      name: row.name,
      present: row.present,
      subtask:
        row.subtaskPublicId && row.subtaskTitle && row.stageStatus
          ? {
              publicId: row.subtaskPublicId,
              title: row.subtaskTitle,
              stageStatus: row.stageStatus,
              checklist: {
                ...checklist,
                progressPercent:
                  checklist.total === 0
                    ? 0
                    : Math.round((checklist.completed / checklist.total) * 100),
              },
            }
          : null,
    };
  });
}

export const listFrames = async (
  db: dbClient,
  input: {
    cardPublicId: string;
    expectedWorkspaceId: number;
    requirePublic: boolean;
    includeTombstones?: boolean;
  },
) =>
  db.transaction(async (tx) => {
    const cardId = await resolveCardId(tx, input.cardPublicId);
    if (cardId === null) throw new WorkspaceChangedError();
    const [card] = await lockCardsInWorkspace(
      tx,
      [cardId],
      input.expectedWorkspaceId,
      { cardLock: "share", requirePublic: input.requirePublic },
    );
    if (!card || card.publicId !== input.cardPublicId) {
      throw new WorkspaceChangedError();
    }
    return queryFrames(tx, card.id, input.includeTombstones ?? false);
  });

async function initializePipelineTx(
  tx: DbTransaction,
  input: { cardId: number; actorId: string },
) {
  let stages = await tx
    .select({
      id: cardPipelineStages.id,
      publicId: cardPipelineStages.publicId,
      status: cardPipelineStages.status,
      name: cardPipelineStages.name,
      index: cardPipelineStages.index,
    })
    .from(cardPipelineStages)
    .where(eq(cardPipelineStages.cardId, input.cardId))
    .orderBy(asc(cardPipelineStages.index), asc(cardPipelineStages.id))
    .for("update");
  if (stages.length === 0) {
    stages = await tx
      .insert(cardPipelineStages)
      .values(
        DEFAULT_CARD_PIPELINE_STAGES.map((stage, index) => ({
          publicId: generateUID(),
          cardId: input.cardId,
          status: stage.status,
          name: stage.name,
          index,
          createdBy: input.actorId,
        })),
      )
      .returning({
        id: cardPipelineStages.id,
        publicId: cardPipelineStages.publicId,
        status: cardPipelineStages.status,
        name: cardPipelineStages.name,
        index: cardPipelineStages.index,
      });
    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.pipeline.initialized",
      cardId: input.cardId,
      createdBy: input.actorId,
    });
  }
  if (!hasExactStageSet(stages)) {
    throw new CardCanvasConversionError("CARD_PIPELINE_INVALID_STATE");
  }
  return stages;
}

export type CardCanvasConversionErrorCode =
  | "CANVAS_FRAME_NOT_FOUND"
  | "CANVAS_FRAME_ALREADY_LINKED"
  | "CARD_PIPELINE_INVALID_STATE"
  | "SUBTASK_OWNER_INVALID"
  | "SUBTASK_INVALID";

export class CardCanvasConversionError extends Error {
  constructor(public readonly code: CardCanvasConversionErrorCode) {
    super(code);
    this.name = "CardCanvasConversionError";
  }
}

async function createConvertedSubtaskTx(
  tx: DbTransaction,
  input: {
    card: Awaited<ReturnType<typeof lockPipelineCardByPublicId>> & object;
    stage: {
      id: number;
      publicId: string;
      status: CardPipelineStageStatus;
    };
    title: string;
    description?: string | null;
    priority?: CardPriority;
    dueDate?: Date | null;
    ownerPublicId?: string | null;
    actorId: string;
  },
) {
  const owner = input.ownerPublicId
    ? await resolveActiveWorkspaceMember(tx, {
        workspaceId: input.card.workspaceId,
        memberPublicId: input.ownerPublicId,
      })
    : null;
  if (input.ownerPublicId && !owner) {
    throw new CardCanvasConversionError("SUBTASK_OWNER_INVALID");
  }
  const [last] = await tx
    .select({ index: cardSubtasks.index })
    .from(cardSubtasks)
    .where(
      and(
        eq(cardSubtasks.stageId, input.stage.id),
        isNull(cardSubtasks.deletedAt),
      ),
    )
    .orderBy(desc(cardSubtasks.index), desc(cardSubtasks.id))
    .limit(1)
    .for("update");
  const now = new Date();
  const lifecycle = deriveSubtaskLifecycle({
    currentStatus: null,
    destinationStatus: input.stage.status,
    startedAt: null,
    completedAt: null,
    movedAt: now,
  });
  const [created] = await tx
    .insert(cardSubtasks)
    .values({
      publicId: generateUID(),
      cardId: input.card.id,
      stageId: input.stage.id,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "none",
      dueDate: input.dueDate ?? null,
      ownerWorkspaceMemberId: owner?.id ?? null,
      index: last ? last.index + 1 : 0,
      startedAt: lifecycle.startedAt,
      completedAt: lifecycle.completedAt,
      createdBy: input.actorId,
    })
    .returning({ id: cardSubtasks.id, publicId: cardSubtasks.publicId });
  if (!created) throw new Error("Unable to create converted subtask");
  const assignmentReference = generateUID();
  await tx.insert(cardActivities).values({
    publicId: assignmentReference,
    type: "card.updated.subtask.added",
    cardId: input.card.id,
    subtaskPublicId: created.publicId,
    toPipelineStagePublicId: input.stage.publicId,
    toTitle: input.title,
    createdBy: input.actorId,
  });
  if (
    owner?.userId &&
    owner.userId !== input.actorId &&
    input.card.completedAt === null &&
    input.card.listStatus !== "done" &&
    !input.card.boardArchived
  ) {
    await tx
      .insert(notifications)
      .values({
        publicId: generateUID(),
        type: "subtask.assigned",
        userId: owner.userId,
        cardId: input.card.id,
        subtaskId: created.id,
        workspaceId: input.card.workspaceId,
        dedupeKey: assignmentDedupeKey(
          owner.userId,
          created.publicId,
          assignmentReference,
        ),
      })
      .onConflictDoNothing({ target: notifications.dedupeKey });
  }
  return created;
}

export const convertFrame = async (
  db: dbClient,
  input: {
    cardPublicId: string;
    expectedWorkspaceId: number;
    framePublicId: string;
    expectedVersion: number;
    scene?: unknown;
    targetStageStatus: CardPipelineStageStatus;
    subtaskFields: {
      title: string;
      description?: string | null;
      priority?: CardPriority;
      dueDate?: Date | null;
      ownerPublicId?: string | null;
    };
    actorId: string;
  },
) => {
  const title = input.subtaskFields.title.trim();
  if (
    title.length === 0 ||
    title.length > 500 ||
    (input.subtaskFields.description?.length ?? 0) > 10000
  ) {
    throw new CardCanvasConversionError("SUBTASK_INVALID");
  }
  const suppliedPrepared =
    input.scene === undefined
      ? null
      : await prepareCardCanvasScene(input.scene);
  return db.transaction(async (tx) => {
    const card = await lockPipelineCardByPublicId(tx, input.cardPublicId);
    if (!card) throw new WorkspaceChangedError();
    if (card.workspaceId !== input.expectedWorkspaceId) {
      throw new WorkspaceChangedError();
    }

    let casResult: CardCanvasCasResult;
    let prepared: PreparedCardCanvasScene;
    if (suppliedPrepared) {
      prepared = suppliedPrepared;
      casResult = await applyNormalizedCanvasTx(tx, {
        cardId: card.id,
        expectedVersion: input.expectedVersion,
        prepared,
        actorId: input.actorId,
      });
    } else {
      const head = await getCanvasHeadForUpdateTx(tx, card.id);
      if (!head || head.version !== input.expectedVersion) {
        return {
          status: "conflict" as const,
          code: "CANVAS_VERSION_CONFLICT" as const,
          remoteVersion: head?.version ?? 0,
        };
      }
      prepared = await prepareCardCanvasScene(head.scene);
      casResult = {
        status: "unchanged",
        version: head.version,
        hash: head.hash,
        bytes: head.bytes,
        elementCount: head.elementCount,
        canvasId: head.id,
      };
    }
    if (casResult.status === "conflict") return casResult;

    const [frame] = await tx
      .select({
        id: cardCanvasFrames.id,
        subtaskId: cardCanvasFrames.subtaskId,
      })
      .from(cardCanvasFrames)
      .where(
        and(
          eq(cardCanvasFrames.publicId, input.framePublicId),
          eq(cardCanvasFrames.canvasId, casResult.canvasId),
          eq(cardCanvasFrames.present, true),
        ),
      )
      .limit(1)
      .for("update");
    if (!frame) {
      throw new CardCanvasConversionError("CANVAS_FRAME_NOT_FOUND");
    }
    if (frame.subtaskId !== null) {
      throw new CardCanvasConversionError("CANVAS_FRAME_ALREADY_LINKED");
    }
    const stages = await initializePipelineTx(tx, {
      cardId: card.id,
      actorId: input.actorId,
    });
    const stage = stages.find(
      (candidate) => candidate.status === input.targetStageStatus,
    );
    if (!stage) {
      throw new CardCanvasConversionError("CARD_PIPELINE_INVALID_STATE");
    }
    const subtask = await createConvertedSubtaskTx(tx, {
      card,
      stage,
      ...input.subtaskFields,
      title,
      actorId: input.actorId,
    });
    const [linked] = await tx
      .update(cardCanvasFrames)
      .set({ subtaskId: subtask.id, updatedAt: new Date() })
      .where(
        and(
          eq(cardCanvasFrames.id, frame.id),
          isNull(cardCanvasFrames.subtaskId),
        ),
      )
      .returning({ id: cardCanvasFrames.id });
    if (!linked) {
      throw new CardCanvasConversionError("CANVAS_FRAME_ALREADY_LINKED");
    }
    return {
      status: "saved" as const,
      version: casResult.version,
      hash: casResult.hash,
      bytes: casResult.bytes,
      elementCount: casResult.elementCount,
      framePublicId: input.framePublicId,
      subtaskPublicId: subtask.publicId,
    };
  });
};

export const getPresenceByCardIds = async (
  db: dbClient | DbTransaction,
  cardIds: number[],
) => {
  const uniqueCardIds = [...new Set(cardIds)];
  const result = new Map(uniqueCardIds.map((cardId) => [cardId, false]));
  if (uniqueCardIds.length === 0) return result;
  const rows = await db
    .select({ cardId: cardCanvases.cardId })
    .from(cardCanvases)
    .where(inArray(cardCanvases.cardId, uniqueCardIds));
  for (const row of rows) result.set(row.cardId, true);
  return result;
};

export const getPresenceByCardPublicIds = async (
  db: dbClient | DbTransaction,
  cardPublicIds: string[],
) => {
  const uniquePublicIds = [...new Set(cardPublicIds)];
  const result = new Map(uniquePublicIds.map((publicId) => [publicId, false]));
  if (uniquePublicIds.length === 0) return result;
  const rows = await db
    .select({ publicId: cards.publicId })
    .from(cards)
    .innerJoin(cardCanvases, eq(cards.id, cardCanvases.cardId))
    .where(
      and(inArray(cards.publicId, uniquePublicIds), isNull(cards.deletedAt)),
    );
  for (const row of rows) result.set(row.publicId, true);
  return result;
};

export { CardCanvasReferenceError, getCanvasHeadByCardIdTx };
