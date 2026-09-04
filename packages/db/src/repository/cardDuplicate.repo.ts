import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardActivities,
  cardResources,
  cardVisualWallItems,
  cardVisualWalls,
  cards,
  cardsToLabels,
  cardToWorkspaceMembers,
  checklistItems,
  checklists,
  labels,
  lists,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import { cloneCardCanvasHeadTx } from "./cardCanvasClone.repo";
import { clonePipelineForCardTx } from "./cardPipelineClone.repo";
import { cloneCardResourcesTx } from "./cardResourceClone.repo";
import { cloneCardVisualWallTx } from "./cardVisualWallClone.repo";
import type { PreparedCardVisualWallUploadClone } from "./cardVisualWallClone.repo";
import {
  assertBoardsInWorkspace,
  assertWorkspacePermissionTx,
  WorkspaceChangedError,
} from "./workspace-boundary";

export class CardPipelineCloneError extends Error {
  constructor() {
    super("CARD_PIPELINE_CLONE_FAILED");
    this.name = "CardPipelineCloneError";
  }
}

export const preflightVisualWallDuplicate = (
  db: dbClient,
  input: {
    sourceCardId: number;
    targetListPublicId: string;
    expectedWorkspaceId: number;
    actorId: string;
    publicVisibilityAcknowledged: boolean;
  },
) =>
  db.transaction(async (tx) => {
    await assertWorkspacePermissionTx(tx, {
      workspaceId: input.expectedWorkspaceId,
      userId: input.actorId,
      permission: "card:view",
    });
    await assertWorkspacePermissionTx(tx, {
      workspaceId: input.expectedWorkspaceId,
      userId: input.actorId,
      permission: "card:create",
    });
    const [source] = await tx
      .select({ id: cards.id })
      .from(cards)
      .innerJoin(lists, eq(cards.listId, lists.id))
      .innerJoin(boards, eq(lists.boardId, boards.id))
      .where(
        and(
          eq(cards.id, input.sourceCardId),
          eq(boards.workspaceId, input.expectedWorkspaceId),
          isNull(cards.deletedAt),
          isNull(lists.deletedAt),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1);
    const [target] = await tx
      .select({ visibility: boards.visibility })
      .from(lists)
      .innerJoin(boards, eq(lists.boardId, boards.id))
      .where(
        and(
          eq(lists.publicId, input.targetListPublicId),
          eq(boards.workspaceId, input.expectedWorkspaceId),
          isNull(lists.deletedAt),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1);
    if (!source || !target) throw new WorkspaceChangedError();
    if (
      target.visibility !== "public" ||
      input.publicVisibilityAcknowledged
    ) {
      return { status: "ready" as const };
    }
    const [item] = await tx
      .select({ id: cardVisualWallItems.id })
      .from(cardVisualWallItems)
      .innerJoin(
        cardVisualWalls,
        eq(cardVisualWallItems.wallId, cardVisualWalls.id),
      )
      .where(
        and(
          eq(cardVisualWalls.cardId, input.sourceCardId),
          isNull(cardVisualWallItems.deletedAt),
        ),
      )
      .limit(1);
    return item
      ? { status: "public_ack_required" as const }
      : { status: "ready" as const };
  });

export const duplicateCard = async (
  db: dbClient,
  input: {
    sourceCardPublicId: string;
    targetListPublicId: string;
    expectedWorkspaceId: number;
    createdBy: string;
    title?: string;
    index?: number;
    copyLabels: boolean;
    copyMembers: boolean;
    copyChecklists: boolean;
    copyPipeline: boolean;
    publicVisibilityAcknowledged: boolean;
    visualWallUploadClones?: readonly PreparedCardVisualWallUploadClone[];
  },
) =>
  db.transaction(async (tx) => {
    const [sourceLocation] = await tx
      .select({ id: cards.id, listId: cards.listId })
      .from(cards)
      .where(
        and(
          eq(cards.publicId, input.sourceCardPublicId),
          isNull(cards.deletedAt),
        ),
      )
      .limit(1);
    const [targetLocation] = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(
        and(
          eq(lists.publicId, input.targetListPublicId),
          isNull(lists.deletedAt),
        ),
      )
      .limit(1);
    if (!sourceLocation || !targetLocation) throw new WorkspaceChangedError();

    const listIds = [
      ...new Set([sourceLocation.listId, targetLocation.id]),
    ].sort((a, b) => a - b);
    const lockedLists = await tx
      .select({
        id: lists.id,
        boardId: lists.boardId,
        status: lists.status,
      })
      .from(lists)
      .where(and(inArray(lists.id, listIds), isNull(lists.deletedAt)))
      .orderBy(asc(lists.id))
      .for("update");
    if (lockedLists.length !== listIds.length) {
      throw new WorkspaceChangedError();
    }

    const lockedCards = await tx
      .select({
        id: cards.id,
        publicId: cards.publicId,
        listId: cards.listId,
        index: cards.index,
        title: cards.title,
        description: cards.description,
        dueDate: cards.dueDate,
        priority: cards.priority,
        colourCode: cards.colourCode,
      })
      .from(cards)
      .where(and(inArray(cards.listId, listIds), isNull(cards.deletedAt)))
      .orderBy(asc(cards.id))
      .for("update");
    const sourceCard = lockedCards.find(
      (card) => card.id === sourceLocation.id,
    );
    if (!sourceCard || !listIds.includes(sourceCard.listId)) {
      throw new WorkspaceChangedError();
    }

    const targetList = lockedLists.find(
      (list) => list.id === targetLocation.id,
    );
    if (!targetList) throw new WorkspaceChangedError();
    await assertBoardsInWorkspace(
      tx,
      lockedLists.map((list) => list.boardId),
      input.expectedWorkspaceId,
      { boardLock: "update", workspaceLock: "update" },
    );
    await assertWorkspacePermissionTx(tx, {
      workspaceId: input.expectedWorkspaceId,
      userId: input.createdBy,
      permission: "card:view",
    });
    await assertWorkspacePermissionTx(tx, {
      workspaceId: input.expectedWorkspaceId,
      userId: input.createdBy,
      permission: "card:create",
    });

    const [targetBoard] = await tx
      .select({ visibility: boards.visibility })
      .from(boards)
      .where(
        and(
          eq(boards.id, targetList.boardId),
          eq(boards.workspaceId, input.expectedWorkspaceId),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1);
    if (!targetBoard) throw new WorkspaceChangedError();
    if (
      targetBoard.visibility === "public" &&
      !input.publicVisibilityAcknowledged
    ) {
      const [linkResource] = await tx
        .select({ id: cardResources.id })
        .from(cardResources)
        .where(
          and(
            eq(cardResources.cardId, sourceCard.id),
            or(eq(cardResources.kind, "drive"), eq(cardResources.kind, "web")),
            isNull(cardResources.deletedAt),
          ),
        )
        .limit(1);
      if (linkResource) return { status: "public_ack_required" as const };
      const [visualWallItem] = await tx
        .select({ id: cardVisualWallItems.id })
        .from(cardVisualWallItems)
        .innerJoin(
          cardVisualWalls,
          eq(cardVisualWallItems.wallId, cardVisualWalls.id),
        )
        .where(
          and(
            eq(cardVisualWalls.cardId, sourceCard.id),
            isNull(cardVisualWallItems.deletedAt),
          ),
        )
        .limit(1);
      if (visualWallItem) return { status: "public_ack_required" as const };
    }

    const sourceLabelRows = input.copyLabels
      ? await tx
          .select({ publicId: labels.publicId })
          .from(cardsToLabels)
          .innerJoin(labels, eq(cardsToLabels.labelId, labels.id))
          .where(
            and(
              eq(cardsToLabels.cardId, sourceCard.id),
              isNull(labels.deletedAt),
            ),
          )
          .orderBy(asc(labels.id))
      : [];
    const targetLabels =
      sourceLabelRows.length === 0
        ? []
        : await tx
            .select({ id: labels.id })
            .from(labels)
            .where(
              and(
                eq(labels.boardId, targetList.boardId),
                inArray(
                  labels.publicId,
                  sourceLabelRows.map((label) => label.publicId),
                ),
                isNull(labels.deletedAt),
              ),
            )
            .orderBy(asc(labels.id))
            .for("share");

    const sourceMembers = input.copyMembers
      ? await tx
          .select({ id: workspaceMembers.id })
          .from(cardToWorkspaceMembers)
          .innerJoin(
            workspaceMembers,
            eq(cardToWorkspaceMembers.workspaceMemberId, workspaceMembers.id),
          )
          .where(
            and(
              eq(cardToWorkspaceMembers.cardId, sourceCard.id),
              eq(workspaceMembers.workspaceId, input.expectedWorkspaceId),
              eq(workspaceMembers.status, "active"),
              isNull(workspaceMembers.deletedAt),
            ),
          )
          .orderBy(asc(workspaceMembers.id))
          .for("share", { of: workspaceMembers })
      : [];

    const sourceChecklists = input.copyChecklists
      ? await tx
          .select({
            id: checklists.id,
            name: checklists.name,
            index: checklists.index,
          })
          .from(checklists)
          .where(
            and(
              eq(checklists.cardId, sourceCard.id),
              isNull(checklists.deletedAt),
            ),
          )
          .orderBy(asc(checklists.index), asc(checklists.id))
      : [];
    const sourceChecklistItems =
      sourceChecklists.length === 0
        ? []
        : await tx
            .select({
              checklistId: checklistItems.checklistId,
              title: checklistItems.title,
              index: checklistItems.index,
            })
            .from(checklistItems)
            .where(
              and(
                inArray(
                  checklistItems.checklistId,
                  sourceChecklists.map((checklist) => checklist.id),
                ),
                isNull(checklistItems.deletedAt),
              ),
            )
            .orderBy(
              asc(checklistItems.checklistId),
              asc(checklistItems.index),
              asc(checklistItems.id),
            );

    const lastTargetCard = lockedCards
      .filter((card) => card.listId === targetList.id)
      .sort((a, b) => b.index - a.index)[0];
    const endIndex = (lastTargetCard?.index ?? -1) + 1;
    const targetIndex = Math.min(
      Math.max(input.index ?? endIndex, 0),
      endIndex,
    );
    await tx
      .update(cards)
      .set({ index: sql`${cards.index} + 1` })
      .where(
        and(
          eq(cards.listId, targetList.id),
          sql`${cards.index} >= ${targetIndex}`,
          isNull(cards.deletedAt),
        ),
      );

    const [counter] = await tx
      .update(workspaces)
      .set({ cardCounter: sql`${workspaces.cardCounter} + 1` })
      .where(eq(workspaces.id, input.expectedWorkspaceId))
      .returning({ cardCounter: workspaces.cardCounter });
    if (!counter) throw new WorkspaceChangedError();

    const [createdCard] = await tx
      .insert(cards)
      .values({
        publicId: generateUID(),
        title: input.title ?? sourceCard.title,
        description: sourceCard.description,
        createdBy: input.createdBy,
        listId: targetList.id,
        index: targetIndex,
        cardNumber: counter.cardCounter,
        dueDate: sourceCard.dueDate,
        priority: sourceCard.priority,
        colourCode: sourceCard.colourCode,
        startedAt: null,
        completedAt: null,
      })
      .returning({
        id: cards.id,
        publicId: cards.publicId,
        priority: cards.priority,
      });
    if (!createdCard) throw new Error("Unable to duplicate card");

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.created",
      cardId: createdCard.id,
      createdBy: input.createdBy,
    });
    if (targetLabels.length > 0) {
      await tx.insert(cardsToLabels).values(
        targetLabels.map((label) => ({
          cardId: createdCard.id,
          labelId: label.id,
        })),
      );
      await tx.insert(cardActivities).values(
        targetLabels.map((label) => ({
          publicId: generateUID(),
          type: "card.updated.label.added" as const,
          cardId: createdCard.id,
          labelId: label.id,
          createdBy: input.createdBy,
        })),
      );
    }
    if (sourceMembers.length > 0) {
      await tx.insert(cardToWorkspaceMembers).values(
        sourceMembers.map((member) => ({
          cardId: createdCard.id,
          workspaceMemberId: member.id,
        })),
      );
      await tx.insert(cardActivities).values(
        sourceMembers.map((member) => ({
          publicId: generateUID(),
          type: "card.updated.member.added" as const,
          cardId: createdCard.id,
          workspaceMemberId: member.id,
          createdBy: input.createdBy,
        })),
      );
    }

    for (const checklist of sourceChecklists) {
      const [createdChecklist] = await tx
        .insert(checklists)
        .values({
          publicId: generateUID(),
          name: checklist.name,
          cardId: createdCard.id,
          index: checklist.index,
          createdBy: input.createdBy,
        })
        .returning({ id: checklists.id });
      if (!createdChecklist) throw new Error("Unable to duplicate checklist");
      const items = sourceChecklistItems.filter(
        (item) => item.checklistId === checklist.id,
      );
      if (items.length > 0) {
        await tx.insert(checklistItems).values(
          items.map((item) => ({
            publicId: generateUID(),
            checklistId: createdChecklist.id,
            title: item.title,
            completed: false,
            index: item.index,
            createdBy: input.createdBy,
          })),
        );
      }
      await tx.insert(cardActivities).values({
        publicId: generateUID(),
        type: "card.updated.checklist.added",
        cardId: createdCard.id,
        toTitle: checklist.name,
        createdBy: input.createdBy,
      });
    }

    let subtaskBySourceId:
      | Map<number, { id: number; publicId: string }>
      | undefined;
    let subtaskPublicIdBySourcePublicId: Map<string, string> | undefined;
    if (input.copyPipeline) {
      const cloneResult = await clonePipelineForCardTx(tx, {
        sourceCardId: sourceCard.id,
        destinationCardId: createdCard.id,
        expectedSourceWorkspaceId: input.expectedWorkspaceId,
        expectedDestinationWorkspaceId: input.expectedWorkspaceId,
        createdBy: input.createdBy,
      });
      if (
        cloneResult.status !== "cloned" &&
        cloneResult.status !== "no_pipeline"
      ) {
        throw new CardPipelineCloneError();
      }
      if (cloneResult.status === "cloned") {
        subtaskBySourceId = cloneResult.subtaskBySourceId;
        subtaskPublicIdBySourcePublicId =
          cloneResult.subtaskPublicIdBySourcePublicId;
      }
    }

    const clonedResources = await cloneCardResourcesTx(tx, {
      sourceCardId: sourceCard.id,
      destinationCardId: createdCard.id,
      expectedWorkspaceId: input.expectedWorkspaceId,
      createdBy: input.createdBy,
      subtaskBySourceId,
      visualWallUploadClones: input.visualWallUploadClones,
    });
    await cloneCardCanvasHeadTx(tx, {
      sourceCardId: sourceCard.id,
      destinationCardId: createdCard.id,
      createdBy: input.createdBy,
      subtaskBySourceId,
      subtaskPublicIdBySourcePublicId,
      resourcePublicIdBySourcePublicId:
        clonedResources.resourcePublicIdBySourcePublicId,
    });
    await cloneCardVisualWallTx(tx, {
      sourceCardId: sourceCard.id,
      destinationCardId: createdCard.id,
      createdBy: input.createdBy,
      resourcePublicIdBySourcePublicId:
        clonedResources.resourcePublicIdBySourcePublicId,
    });

    return {
      status: "duplicated" as const,
      ...createdCard,
      skippedResourceCount: clonedResources.skippedUploadCount,
    };
  });
