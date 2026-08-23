import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { CardPriority, ListStatus } from "@kan/db/schema";
import {
  boards,
  cardActivities,
  cards,
  cardsToLabels,
  checklistItems,
  checklists,
  labels,
  lists,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { WorkspaceBoundaryTransaction } from "./workspace-boundary";
import { cloneCardCanvasHeadTx } from "./cardCanvasClone.repo";
import { clonePipelineForCardTx } from "./cardPipeline.repo";
import { cloneCardResourcesTx } from "./cardResourceClone.repo";
import {
  lockBoardTreeInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

interface BoardCloneSource {
  name: string;
  labels: { publicId: string; name: string; colourCode: string | null }[];
  lists: {
    name: string;
    index: number;
    status: ListStatus | null;
    colourCode: string | null;
    cards: {
      publicId?: string;
      title: string;
      description: string | null;
      index: number;
      priority: CardPriority;
      colourCode: string | null;
      labels: {
        publicId: string;
        name: string;
        colourCode: string | null;
      }[];
      checklists?: {
        publicId: string;
        name: string;
        index: number;
        items: {
          publicId: string;
          title: string;
          completed: boolean;
          index: number;
        }[];
      }[];
    }[];
  }[];
}

const getLiveSource = async (
  tx: WorkspaceBoundaryTransaction,
  boardId: number,
): Promise<BoardCloneSource | undefined> => {
  const [sourceBoard] = await tx
    .select({ name: boards.name })
    .from(boards)
    .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)))
    .limit(1);
  if (!sourceBoard) return undefined;

  const sourceLabels = await tx
    .select({
      publicId: labels.publicId,
      name: labels.name,
      colourCode: labels.colourCode,
    })
    .from(labels)
    .where(and(eq(labels.boardId, boardId), isNull(labels.deletedAt)))
    .orderBy(asc(labels.id));
  const sourceLists = await tx
    .select({
      id: lists.id,
      name: lists.name,
      index: lists.index,
      status: lists.status,
      colourCode: lists.colourCode,
    })
    .from(lists)
    .where(and(eq(lists.boardId, boardId), isNull(lists.deletedAt)))
    .orderBy(asc(lists.index), asc(lists.id));
  const listIds = sourceLists.map((list) => list.id);
  const sourceCards =
    listIds.length === 0
      ? []
      : await tx
          .select({
            id: cards.id,
            publicId: cards.publicId,
            title: cards.title,
            description: cards.description,
            index: cards.index,
            priority: cards.priority,
            colourCode: cards.colourCode,
            listId: cards.listId,
          })
          .from(cards)
          .where(and(inArray(cards.listId, listIds), isNull(cards.deletedAt)))
          .orderBy(asc(cards.listId), asc(cards.index), asc(cards.id));
  const cardIds = sourceCards.map((card) => card.id);
  const sourceCardLabels =
    cardIds.length === 0
      ? []
      : await tx
          .select({
            cardId: cardsToLabels.cardId,
            publicId: labels.publicId,
            name: labels.name,
            colourCode: labels.colourCode,
          })
          .from(cardsToLabels)
          .innerJoin(labels, eq(cardsToLabels.labelId, labels.id))
          .where(
            and(
              inArray(cardsToLabels.cardId, cardIds),
              isNull(labels.deletedAt),
            ),
          )
          .orderBy(asc(cardsToLabels.cardId), asc(labels.id));
  const sourceChecklists =
    cardIds.length === 0
      ? []
      : await tx
          .select({
            id: checklists.id,
            publicId: checklists.publicId,
            name: checklists.name,
            index: checklists.index,
            cardId: checklists.cardId,
          })
          .from(checklists)
          .where(
            and(
              inArray(checklists.cardId, cardIds),
              isNull(checklists.deletedAt),
            ),
          )
          .orderBy(
            asc(checklists.cardId),
            asc(checklists.index),
            asc(checklists.id),
          );
  const checklistIds = sourceChecklists.map((checklist) => checklist.id);
  const sourceItems =
    checklistIds.length === 0
      ? []
      : await tx
          .select({
            publicId: checklistItems.publicId,
            title: checklistItems.title,
            completed: checklistItems.completed,
            index: checklistItems.index,
            checklistId: checklistItems.checklistId,
          })
          .from(checklistItems)
          .where(
            and(
              inArray(checklistItems.checklistId, checklistIds),
              isNull(checklistItems.deletedAt),
            ),
          )
          .orderBy(
            asc(checklistItems.checklistId),
            asc(checklistItems.index),
            asc(checklistItems.id),
          );

  return {
    name: sourceBoard.name,
    labels: sourceLabels,
    lists: sourceLists.map((list) => ({
      name: list.name,
      index: list.index,
      status: list.status,
      colourCode: list.colourCode,
      cards: sourceCards
        .filter((card) => card.listId === list.id)
        .map((card) => ({
          publicId: card.publicId,
          title: card.title,
          description: card.description,
          index: card.index,
          priority: card.priority,
          colourCode: card.colourCode,
          labels: sourceCardLabels
            .filter((label) => label.cardId === card.id)
            .map(({ cardId: _, ...label }) => label),
          checklists: sourceChecklists
            .filter((checklist) => checklist.cardId === card.id)
            .map((checklist) => ({
              publicId: checklist.publicId,
              name: checklist.name,
              index: checklist.index,
              items: sourceItems
                .filter((item) => item.checklistId === checklist.id)
                .map(({ checklistId: _, ...item }) => item),
            })),
        })),
    })),
  };
};

export const createFromSnapshot = async (
  db: dbClient,
  args: {
    source?: BoardCloneSource;
    workspaceId: number;
    expectedSourceWorkspaceId?: number;
    createdBy: string;
    slug: string;
    name?: string;
    type: "regular" | "template";
    sourceBoardId?: number;
  },
) =>
  db.transaction(async (tx) => {
    if (
      args.sourceBoardId !== undefined &&
      (args.expectedSourceWorkspaceId === undefined ||
        args.workspaceId !== args.expectedSourceWorkspaceId)
    ) {
      throw new WorkspaceChangedError();
    }

    let cloneSource = args.source;
    let sourceCardRows: { publicId: string; id: number }[] = [];
    if (
      args.sourceBoardId !== undefined &&
      args.expectedSourceWorkspaceId !== undefined
    ) {
      const lockedTree = await lockBoardTreeInWorkspace(
        tx,
        args.sourceBoardId,
        args.expectedSourceWorkspaceId,
        { cardLock: "update", boardLock: "update" },
      );
      cloneSource = await getLiveSource(tx, args.sourceBoardId);
      if (!cloneSource) throw new WorkspaceChangedError();
      sourceCardRows =
        lockedTree.cardIds.length === 0
          ? []
          : await tx
              .select({ publicId: cards.publicId, id: cards.id })
              .from(cards)
              .where(
                and(
                  inArray(cards.id, lockedTree.cardIds),
                  isNull(cards.deletedAt),
                ),
              );
    }
    if (!cloneSource) throw new WorkspaceChangedError();
    const sourceCardIdByPublicId = new Map(
      sourceCardRows.map((card) => [card.publicId, card.id]),
    );

    const [newBoard] = await tx
      .insert(boards)
      .values({
        publicId: generateUID(),
        name: args.name ?? cloneSource.name,
        slug: args.slug,
        createdBy: args.createdBy,
        workspaceId: args.workspaceId,
        type: args.type,
        sourceBoardId: args.sourceBoardId,
      })
      .returning({
        id: boards.id,
        publicId: boards.publicId,
        name: boards.name,
      });
    if (!newBoard) throw new Error("Failed to create board");

    const labelMap = new Map<string, number>();
    if (cloneSource.labels.length > 0) {
      const labelRows = cloneSource.labels.map((label) => ({
        sourcePublicId: label.publicId,
        publicId: generateUID(),
        name: label.name,
        colourCode: label.colourCode ?? null,
        createdBy: args.createdBy,
        boardId: newBoard.id,
      }));
      const inserted = await tx
        .insert(labels)
        .values(labelRows.map(({ sourcePublicId: _, ...row }) => row))
        .returning({ id: labels.id, publicId: labels.publicId });
      const insertedByPublicId = new Map(
        inserted.map((label) => [label.publicId, label.id]),
      );
      for (const label of labelRows) {
        const createdId = insertedByPublicId.get(label.publicId);
        if (!createdId) throw new Error("Failed to create label");
        labelMap.set(label.sourcePublicId, createdId);
      }
    }

    const srcLists = [...cloneSource.lists].sort((a, b) => a.index - b.index);
    const listRows = srcLists.map((list) => ({
      sourceIndex: list.index,
      publicId: generateUID(),
      name: list.name,
      createdBy: args.createdBy,
      boardId: newBoard.id,
      index: list.index,
      status: list.status,
      colourCode: list.colourCode,
    }));
    const insertedLists =
      listRows.length === 0
        ? []
        : await tx
            .insert(lists)
            .values(listRows.map(({ sourceIndex: _, ...row }) => row))
            .returning({ id: lists.id, publicId: lists.publicId });
    const insertedListByPublicId = new Map(
      insertedLists.map((list) => [list.publicId, list.id]),
    );
    const listIndexToId = new Map<number, number>();
    for (const list of listRows) {
      const createdId = insertedListByPublicId.get(list.publicId);
      if (!createdId) throw new Error("Failed to create list");
      listIndexToId.set(list.sourceIndex, createdId);
    }

    let skippedResourceCount = 0;
    for (const list of srcLists) {
      const newListId = listIndexToId.get(list.index);
      if (!newListId) throw new Error("Failed to map list");
      for (const card of [...list.cards].sort((a, b) => a.index - b.index)) {
        const [createdCard] = await tx
          .insert(cards)
          .values({
            publicId: generateUID(),
            title: card.title,
            description: card.description ?? "",
            createdBy: args.createdBy,
            listId: newListId,
            index: card.index,
            priority: card.priority,
            colourCode: card.colourCode,
          })
          .returning({ id: cards.id });
        if (!createdCard) throw new Error("Failed to create card");

        const sourceCardId = card.publicId
          ? sourceCardIdByPublicId.get(card.publicId)
          : undefined;
        if (sourceCardId) {
          const cloneResult = await clonePipelineForCardTx(tx, {
            sourceCardId,
            destinationCardId: createdCard.id,
            expectedSourceWorkspaceId: args.workspaceId,
            expectedDestinationWorkspaceId: args.workspaceId,
            createdBy: args.createdBy,
          });
          if (
            cloneResult.status !== "cloned" &&
            cloneResult.status !== "no_pipeline"
          ) {
            throw new Error("Failed to clone card pipeline");
          }
          const clonedResources = await cloneCardResourcesTx(tx, {
            sourceCardId,
            destinationCardId: createdCard.id,
            createdBy: args.createdBy,
            subtaskBySourceId:
              cloneResult.status === "cloned"
                ? cloneResult.subtaskBySourceId
                : undefined,
          });
          skippedResourceCount += clonedResources.skippedUploadCount;
          await cloneCardCanvasHeadTx(tx, {
            sourceCardId,
            destinationCardId: createdCard.id,
            createdBy: args.createdBy,
            subtaskBySourceId:
              cloneResult.status === "cloned"
                ? cloneResult.subtaskBySourceId
                : undefined,
            subtaskPublicIdBySourcePublicId:
              cloneResult.status === "cloned"
                ? cloneResult.subtaskPublicIdBySourcePublicId
                : undefined,
            resourcePublicIdBySourcePublicId:
              clonedResources.resourcePublicIdBySourcePublicId,
          });
        }

        await tx.insert(cardActivities).values({
          publicId: generateUID(),
          type: "card.created",
          cardId: createdCard.id,
          createdBy: args.createdBy,
          sourceBoardId: args.sourceBoardId,
        });
        const cardLabels = card.labels.flatMap((label) => {
          const labelId = labelMap.get(label.publicId);
          return labelId ? [{ cardId: createdCard.id, labelId }] : [];
        });
        if (cardLabels.length > 0) {
          await tx.insert(cardsToLabels).values(cardLabels);
          await tx.insert(cardActivities).values(
            cardLabels.map((relationship) => ({
              publicId: generateUID(),
              type: "card.updated.label.added" as const,
              cardId: relationship.cardId,
              labelId: relationship.labelId,
              createdBy: args.createdBy,
              sourceBoardId: args.sourceBoardId,
            })),
          );
        }

        for (const checklist of [...(card.checklists ?? [])].sort(
          (a, b) => a.index - b.index,
        )) {
          const [createdChecklist] = await tx
            .insert(checklists)
            .values({
              publicId: generateUID(),
              name: checklist.name,
              createdBy: args.createdBy,
              cardId: createdCard.id,
              index: checklist.index,
            })
            .returning({ id: checklists.id });
          if (!createdChecklist) throw new Error("Failed to create checklist");
          await tx.insert(cardActivities).values({
            publicId: generateUID(),
            type: "card.updated.checklist.added",
            cardId: createdCard.id,
            toTitle: checklist.name,
            createdBy: args.createdBy,
            sourceBoardId: args.sourceBoardId,
          });
          const itemValues = [...checklist.items]
            .sort((a, b) => a.index - b.index)
            .map((item) => ({
              publicId: generateUID(),
              title: item.title,
              createdBy: args.createdBy,
              checklistId: createdChecklist.id,
              index: item.index,
              completed: item.completed,
            }));
          if (itemValues.length > 0) {
            await tx.insert(checklistItems).values(itemValues);
            await tx.insert(cardActivities).values(
              itemValues.map((item) => ({
                publicId: generateUID(),
                type: "card.updated.checklist.item.added" as const,
                cardId: createdCard.id,
                toTitle: item.title,
                createdBy: args.createdBy,
                sourceBoardId: args.sourceBoardId,
              })),
            );
          }
        }
      }
    }

    return { ...newBoard, skippedResourceCount };
  });
