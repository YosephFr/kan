import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardActivities,
  cardPipelineStages,
  cards,
  cardsToLabels,
  cardSubtasks,
  lists,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import {
  deriveCardLifecycle,
  OPEN_SUBTASKS_CONFIRMATION_REQUIRED,
} from "./card.repo";
import { assertActiveResourcesAcknowledged } from "./cardResourceVisibility.repo";
import { invalidateCardAlerts } from "./notification-alert.repo";
import { assertBoardsInWorkspace } from "./workspace-boundary";

export const getCandidates = async (db: dbClient, cardPublicIds: string[]) => {
  if (cardPublicIds.length === 0) return [];

  const candidates = await db.query.cards.findMany({
    columns: {
      id: true,
      publicId: true,
      createdBy: true,
      listId: true,
      title: true,
      description: true,
      dueDate: true,
      priority: true,
      colourCode: true,
      startedAt: true,
      completedAt: true,
    },
    where: and(inArray(cards.publicId, cardPublicIds), isNull(cards.deletedAt)),
    with: {
      list: {
        columns: {
          publicId: true,
          name: true,
        },
        with: {
          board: {
            columns: {
              publicId: true,
              name: true,
              workspaceId: true,
            },
          },
        },
      },
    },
  });

  const candidatesByPublicId = new Map(
    candidates.map((card) => [card.publicId, card]),
  );

  return cardPublicIds.flatMap((publicId) => {
    const card = candidatesByPublicId.get(publicId);
    return card ? [card] : [];
  });
};

export const moveMany = async (
  db: dbClient,
  args: {
    cardIds: number[];
    destinationListId: number;
    expectedWorkspaceId: number;
    createdBy: string;
    confirmOpenSubtasks?: boolean;
    publicVisibilityAcknowledged?: boolean;
  },
) => {
  if (args.cardIds.length === 0) return [];

  return db.transaction(async (tx) => {
    const cardLocations = await tx
      .select({ id: cards.id, listId: cards.listId })
      .from(cards)
      .where(and(inArray(cards.id, args.cardIds), isNull(cards.deletedAt)));

    if (cardLocations.length !== args.cardIds.length) {
      throw new Error("One or more cards were not found");
    }

    const requestedListIds = [
      ...new Set([
        args.destinationListId,
        ...cardLocations.map((card) => card.listId),
      ]),
    ].sort((a, b) => a - b);
    const lockedLists = await tx
      .select({ id: lists.id, boardId: lists.boardId, status: lists.status })
      .from(lists)
      .where(and(inArray(lists.id, requestedListIds), isNull(lists.deletedAt)))
      .orderBy(asc(lists.id))
      .for("update");

    if (lockedLists.length !== requestedListIds.length) {
      throw new Error("One or more lists were not found");
    }

    const selectedCards = await tx
      .select({
        id: cards.id,
        publicId: cards.publicId,
        listId: cards.listId,
        startedAt: cards.startedAt,
        completedAt: cards.completedAt,
        listStatus: lists.status,
      })
      .from(cards)
      .innerJoin(lists, eq(cards.listId, lists.id))
      .where(and(inArray(cards.id, args.cardIds), isNull(cards.deletedAt)))
      .orderBy(asc(cards.id))
      .for("update", { of: cards });

    if (
      selectedCards.length !== args.cardIds.length ||
      selectedCards.some((card) => !requestedListIds.includes(card.listId))
    ) {
      throw new Error("One or more cards moved concurrently");
    }

    await assertBoardsInWorkspace(
      tx,
      lockedLists.map((list) => list.boardId),
      args.expectedWorkspaceId,
    );

    if (selectedCards.some((card) => card.listId === args.destinationListId)) {
      throw new Error("Cards are already in the destination list");
    }

    const cardsById = new Map(selectedCards.map((card) => [card.id, card]));
    const orderedCards = args.cardIds.map((cardId) => {
      const card = cardsById.get(cardId);
      if (!card) throw new Error(`Card ${cardId} not found`);
      return card;
    });
    const labelRelationships = await tx
      .select({
        cardId: cardsToLabels.cardId,
        labelId: cardsToLabels.labelId,
      })
      .from(cardsToLabels)
      .where(inArray(cardsToLabels.cardId, args.cardIds));
    const movedAt = new Date();
    const destinationList = lockedLists.find(
      (list) => list.id === args.destinationListId,
    );

    if (!destinationList) throw new Error("Destination list not found");

    const boardRows = await tx
      .select({ id: boards.id, visibility: boards.visibility })
      .from(boards)
      .where(
        and(
          inArray(
            boards.id,
            lockedLists.map((list) => list.boardId),
          ),
          eq(boards.workspaceId, args.expectedWorkspaceId),
          isNull(boards.deletedAt),
        ),
      );
    const visibilityByBoardId = new Map(
      boardRows.map((board) => [board.id, board.visibility]),
    );
    if (visibilityByBoardId.get(destinationList.boardId) === "public") {
      const listById = new Map(lockedLists.map((list) => [list.id, list]));
      const privateSourceCardIds = selectedCards.flatMap((card) => {
        const sourceList = listById.get(card.listId);
        return sourceList &&
          visibilityByBoardId.get(sourceList.boardId) === "private"
          ? [card.id]
          : [];
      });
      await assertActiveResourcesAcknowledged(
        tx,
        privateSourceCardIds,
        args.publicVisibilityAcknowledged ?? false,
      );
    }

    if (destinationList.status === "done") {
      const cardIdsEnteringDone = orderedCards
        .filter((card) => card.listStatus !== "done")
        .map((card) => card.id);

      if (cardIdsEnteringDone.length > 0) {
        const [openSubtasks] = await tx
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(cardSubtasks)
          .innerJoin(
            cardPipelineStages,
            eq(cardSubtasks.stageId, cardPipelineStages.id),
          )
          .where(
            and(
              inArray(cardSubtasks.cardId, cardIdsEnteringDone),
              isNull(cardSubtasks.deletedAt),
              sql`${cardPipelineStages.status} <> 'done'`,
            ),
          );

        if ((openSubtasks?.count ?? 0) > 0 && !args.confirmOpenSubtasks) {
          throw new Error(OPEN_SUBTASKS_CONFIRMATION_REQUIRED);
        }
      }
    }

    await tx
      .update(cards)
      .set({ index: sql`${cards.index} + ${args.cardIds.length}` })
      .where(
        and(eq(cards.listId, args.destinationListId), isNull(cards.deletedAt)),
      );

    for (const [index, card] of orderedCards.entries()) {
      const lifecycle = deriveCardLifecycle({
        currentStatus: card.listStatus,
        destinationStatus: destinationList.status,
        startedAt: card.startedAt,
        completedAt: card.completedAt,
        movedAt,
      });

      await tx
        .update(cards)
        .set({
          listId: args.destinationListId,
          index,
          startedAt: lifecycle.startedAt,
          completedAt: lifecycle.completedAt,
          updatedAt: movedAt,
        })
        .where(and(eq(cards.id, card.id), isNull(cards.deletedAt)));
      if (lifecycle.completedAt) {
        await invalidateCardAlerts(tx, {
          cardId: card.id,
          invalidatedAt: movedAt,
        });
      }
    }

    await tx
      .delete(cardsToLabels)
      .where(inArray(cardsToLabels.cardId, args.cardIds));

    const sourceListIds = Array.from(
      new Set(orderedCards.map((card) => card.listId)),
    );

    for (const sourceListId of sourceListIds) {
      await tx.execute(sql`
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY "index", id) - 1 AS new_index
          FROM "card"
          WHERE "listId" = ${sourceListId} AND "deletedAt" IS NULL
        )
        UPDATE "card" c
        SET "index" = o.new_index
        FROM ordered o
        WHERE c.id = o.id;
      `);
    }

    const listActivities = orderedCards.map((card) => ({
      publicId: generateUID(),
      type: "card.updated.list" as const,
      cardId: card.id,
      fromListId: card.listId,
      toListId: args.destinationListId,
      createdBy: args.createdBy,
    }));
    const labelActivities = labelRelationships.map((relationship) => ({
      publicId: generateUID(),
      type: "card.updated.label.removed" as const,
      cardId: relationship.cardId,
      labelId: relationship.labelId,
      createdBy: args.createdBy,
    }));

    await tx
      .insert(cardActivities)
      .values([...listActivities, ...labelActivities]);

    const updatedCards = await tx
      .select({
        id: cards.id,
        publicId: cards.publicId,
        title: cards.title,
        description: cards.description,
        dueDate: cards.dueDate,
        priority: cards.priority,
        colourCode: cards.colourCode,
        startedAt: cards.startedAt,
        completedAt: cards.completedAt,
      })
      .from(cards)
      .where(inArray(cards.id, args.cardIds));
    const updatedCardsById = new Map(
      updatedCards.map((card) => [card.id, card]),
    );

    return args.cardIds.flatMap((cardId) => {
      const card = updatedCardsById.get(cardId);
      return card ? [card] : [];
    });
  });
};
