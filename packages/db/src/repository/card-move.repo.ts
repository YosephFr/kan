import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { cardActivities, cards, cardsToLabels } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

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
    createdBy: string;
  },
) => {
  if (args.cardIds.length === 0) return [];

  return db.transaction(async (tx) => {
    const selectedCards = await tx
      .select({
        id: cards.id,
        publicId: cards.publicId,
        listId: cards.listId,
      })
      .from(cards)
      .where(and(inArray(cards.id, args.cardIds), isNull(cards.deletedAt)));

    if (selectedCards.length !== args.cardIds.length) {
      throw new Error("One or more cards were not found");
    }

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

    await tx
      .update(cards)
      .set({ index: sql`${cards.index} + ${args.cardIds.length}` })
      .where(
        and(eq(cards.listId, args.destinationListId), isNull(cards.deletedAt)),
      );

    for (const [index, card] of orderedCards.entries()) {
      await tx
        .update(cards)
        .set({
          listId: args.destinationListId,
          index,
          updatedAt: movedAt,
        })
        .where(and(eq(cards.id, card.id), isNull(cards.deletedAt)));
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
