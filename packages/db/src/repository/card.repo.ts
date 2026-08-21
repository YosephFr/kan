import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { CardPriority, ListStatus } from "@kan/db/schema";
import {
  cardActivities,
  cardAttachments,
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

export const deriveCardLifecycle = (args: {
  currentStatus?: ListStatus | null;
  destinationStatus: ListStatus | null;
  startedAt: Date | null;
  completedAt?: Date | null;
  movedAt: Date;
}) => ({
  startedAt:
    args.destinationStatus === "inProgress" && !args.startedAt
      ? args.movedAt
      : args.startedAt,
  completedAt:
    args.destinationStatus === "done"
      ? args.currentStatus === "done"
        ? (args.completedAt ?? null)
        : args.movedAt
      : null,
});

export const getCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(cards)
    .where(isNull(cards.deletedAt));

  return result[0]?.count ?? 0;
};

export const create = async (
  db: dbClient,
  cardInput: {
    title: string;
    description: string;
    createdBy: string;
    listId: number;
    workspaceId: number;
    position: "start" | "end";
    dueDate?: Date | null;
    priority?: CardPriority;
    colourCode?: string | null;
    initializeLifecycle?: boolean;
  },
) => {
  return db.transaction(async (tx) => {
    let index = 0;
    const lifecycleAt = new Date();
    const [destinationList] = await tx
      .select({ status: lists.status })
      .from(lists)
      .where(and(eq(lists.id, cardInput.listId), isNull(lists.deletedAt)))
      .limit(1)
      .for("update");

    if (!destinationList) throw new Error(`List ${cardInput.listId} not found`);

    const lifecycle =
      cardInput.initializeLifecycle === false
        ? { startedAt: null, completedAt: null }
        : deriveCardLifecycle({
            destinationStatus: destinationList.status,
            startedAt: null,
            movedAt: lifecycleAt,
          });

    if (cardInput.position === "end") {
      const lastCard = await tx.query.cards.findFirst({
        columns: {
          index: true,
        },
        where: and(eq(cards.listId, cardInput.listId), isNull(cards.deletedAt)),
        orderBy: desc(cards.index),
      });

      if (lastCard) index = lastCard.index + 1;
    }

    const getExistingCardAtIndex = async () =>
      tx.query.cards.findFirst({
        columns: {
          id: true,
        },
        where: and(
          eq(cards.listId, cardInput.listId),
          eq(cards.index, index),
          isNull(cards.deletedAt),
        ),
      });

    const existingCardAtIndex = await getExistingCardAtIndex();

    if (existingCardAtIndex?.id) {
      await tx.execute(sql`
        UPDATE card
        SET index = index + 1
        WHERE "listId" = ${cardInput.listId} AND index >= ${index} AND "deletedAt" IS NULL;
      `);
    }

    const [counterResult] = await tx
      .update(workspaces)
      .set({ cardCounter: sql`${workspaces.cardCounter} + 1` })
      .where(eq(workspaces.id, cardInput.workspaceId))
      .returning({ cardCounter: workspaces.cardCounter });

    if (!counterResult)
      throw new Error(`Workspace ${cardInput.workspaceId} not found`);

    const cardNumber = counterResult.cardCounter;

    const result = await tx
      .insert(cards)
      .values({
        publicId: generateUID(),
        title: cardInput.title,
        description: cardInput.description,
        createdBy: cardInput.createdBy,
        listId: cardInput.listId,
        index: index,
        cardNumber,
        dueDate: cardInput.dueDate ?? null,
        priority: cardInput.priority ?? "none",
        colourCode: cardInput.colourCode ?? null,
        startedAt: lifecycle.startedAt,
        completedAt: lifecycle.completedAt,
      })
      .returning({
        id: cards.id,
        listId: cards.listId,
        publicId: cards.publicId,
        cardNumber: cards.cardNumber,
        priority: cards.priority,
        colourCode: cards.colourCode,
        dueDate: cards.dueDate,
        startedAt: cards.startedAt,
        completedAt: cards.completedAt,
      });

    if (!result[0]) throw new Error("Unable to create card");

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      cardId: result[0].id,
      type: "card.created",
      createdBy: cardInput.createdBy,
    });

    const countExpr = sql<number>`COUNT(*)`.mapWith(Number);

    const duplicateIndices = await tx
      .select({
        index: cards.index,
        count: countExpr,
      })
      .from(cards)
      .where(and(eq(cards.listId, result[0].listId), isNull(cards.deletedAt)))
      .groupBy(cards.listId, cards.index)
      .having(gt(countExpr, 1));

    if (duplicateIndices.length > 0) {
      // Compact indices for this list to sequential values (0..n-1) preserving order
      await tx.execute(sql`
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY "index", id) - 1 AS new_index
          FROM "card"
          WHERE "listId" = ${result[0].listId} AND "deletedAt" IS NULL
        )
        UPDATE "card" c
        SET "index" = o.new_index
        FROM ordered o
        WHERE c.id = o.id;
      `);

      // Last resort: verify fix; rollback if duplicates persist
      const postFixDupes = await tx
        .select({ index: cards.index, count: countExpr })
        .from(cards)
        .where(and(eq(cards.listId, result[0].listId), isNull(cards.deletedAt)))
        .groupBy(cards.listId, cards.index)
        .having(gt(countExpr, 1));

      if (postFixDupes.length > 0) {
        throw new Error(
          `Invariant violation: duplicate card indices remain after compaction in list ${result[0].listId}`,
        );
      }
    }

    return result[0];
  });
};

export const bulkCreateCardLabelRelationships = async (
  db: dbClient,
  cardLabelRelationshipInput: {
    cardId: number;
    labelId: number;
  }[],
) => {
  const result = await db
    .insert(cardsToLabels)
    .values(cardLabelRelationshipInput)
    .returning();

  return result;
};

export const bulkCreateCardWorkspaceMemberRelationships = async (
  db: dbClient,
  cardWorkspaceMemberRelationshipInput: {
    cardId: number;
    workspaceMemberId: number;
  }[],
) => {
  const result = await db
    .insert(cardToWorkspaceMembers)
    .values(cardWorkspaceMemberRelationshipInput)
    .returning();

  return result;
};

export const update = async (
  db: dbClient,
  cardInput: {
    title?: string;
    description?: string;
    dueDate?: Date | null;
    priority?: CardPriority;
    colourCode?: string | null;
  },
  args: {
    cardPublicId: string;
  },
) => {
  const [result] = await db
    .update(cards)
    .set({
      title: cardInput.title,
      description: cardInput.description,
      dueDate: cardInput.dueDate !== undefined ? cardInput.dueDate : undefined,
      priority: cardInput.priority,
      colourCode:
        cardInput.colourCode !== undefined ? cardInput.colourCode : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(cards.publicId, args.cardPublicId), isNull(cards.deletedAt)))
    .returning({
      id: cards.id,
      publicId: cards.publicId,
      title: cards.title,
      description: cards.description,
      dueDate: cards.dueDate,
      priority: cards.priority,
      colourCode: cards.colourCode,
      startedAt: cards.startedAt,
      completedAt: cards.completedAt,
    });

  return result;
};

export const getCardWithListByPublicId = (
  db: dbClient,
  cardPublicId: string,
) => {
  return db.query.cards.findFirst({
    columns: {
      id: true,
      index: true,
    },
    with: {
      list: {
        columns: {
          id: true,
          boardId: true,
        },
      },
    },
    where: and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)),
  });
};

export const getByPublicId = (db: dbClient, cardPublicId: string) => {
  return db.query.cards.findFirst({
    columns: {
      id: true,
      publicId: true,
      title: true,
      description: true,
      listId: true,
      dueDate: true,
      priority: true,
      colourCode: true,
      startedAt: true,
      completedAt: true,
    },
    with: {
      list: {
        columns: {
          publicId: true,
          name: true,
          status: true,
          colourCode: true,
        },
      },
      labels: {
        columns: {
          labelId: true,
        },
      },
    },
    where: eq(cards.publicId, cardPublicId),
  });
};

export const getCardLabelRelationship = async (
  db: dbClient,
  args: { cardId: number; labelId: number },
) => {
  return db.query.cardsToLabels.findFirst({
    where: and(
      eq(cardsToLabels.cardId, args.cardId),
      eq(cardsToLabels.labelId, args.labelId),
    ),
  });
};

export const bulkCreate = async (
  db: dbClient,
  cardInput: {
    publicId: string;
    title: string;
    description: string;
    createdBy: string;
    listId: number;
    workspaceId: number;
    index: number;
    importId?: number;
    dueDate?: Date | null;
    priority?: CardPriority;
    colourCode?: string | null;
  }[],
) => {
  if (cardInput.length === 0) return [];

  return db.transaction(async (tx) => {
    // Group incoming cards by list to compute safe, sequential indices per list
    const byList = new Map<number, typeof cardInput>();
    for (const item of cardInput) {
      const arr = byList.get(item.listId) ?? [];
      arr.push(item);
      byList.set(item.listId, arr);
    }

    // Atomically reserve a contiguous range of cardNumbers per workspace by
    // bumping cardCounter once per workspace.
    const countsByWorkspace = new Map<number, number>();
    for (const item of cardInput) {
      countsByWorkspace.set(
        item.workspaceId,
        (countsByWorkspace.get(item.workspaceId) ?? 0) + 1,
      );
    }

    const cardNumberByWorkspaceQueue = new Map<number, number[]>();
    for (const [workspaceId, count] of countsByWorkspace.entries()) {
      const [counterResult] = await tx
        .update(workspaces)
        .set({ cardCounter: sql`${workspaces.cardCounter} + ${count}` })
        .where(eq(workspaces.id, workspaceId))
        .returning({ cardCounter: workspaces.cardCounter });

      if (!counterResult) throw new Error(`Workspace ${workspaceId} not found`);

      const last = counterResult.cardCounter;
      const start = last - count + 1;
      const queue: number[] = [];
      for (let n = start; n <= last; n++) queue.push(n);
      cardNumberByWorkspaceQueue.set(workspaceId, queue);
    }

    const allValuesToInsert: {
      publicId: string;
      title: string;
      description: string;
      createdBy: string;
      listId: number;
      index: number;
      cardNumber: number;
      importId?: number;
      dueDate?: Date | null;
      priority: CardPriority;
      colourCode?: string | null;
      startedAt: Date | null;
      completedAt: Date | null;
    }[] = [];

    // For each list, append incoming cards after current max index, preserving incoming order
    for (const [listId, items] of byList.entries()) {
      const destinationList = await tx.query.lists.findFirst({
        columns: { status: true },
        where: and(eq(lists.id, listId), isNull(lists.deletedAt)),
      });

      if (!destinationList) throw new Error(`List ${listId} not found`);

      const last = await tx.query.cards.findFirst({
        columns: { index: true },
        where: and(eq(cards.listId, listId), isNull(cards.deletedAt)),
        orderBy: [desc(cards.index)],
      });

      let nextIndex = last ? last.index + 1 : 0;
      const sorted = [...items].sort((a, b) => a.index - b.index);
      for (const it of sorted) {
        const lifecycle = deriveCardLifecycle({
          destinationStatus: destinationList.status,
          startedAt: null,
          movedAt: new Date(),
        });
        const queue = cardNumberByWorkspaceQueue.get(it.workspaceId);
        const cardNumber = queue?.shift();
        if (cardNumber === undefined)
          throw new Error(
            `Failed to allocate cardNumber for workspace ${it.workspaceId}`,
          );
        allValuesToInsert.push({
          publicId: it.publicId,
          title: it.title,
          description: it.description,
          createdBy: it.createdBy,
          listId: it.listId,
          index: nextIndex++,
          cardNumber,
          importId: it.importId,
          dueDate: it.dueDate ?? null,
          priority: it.priority ?? "none",
          colourCode: it.colourCode ?? null,
          startedAt: lifecycle.startedAt,
          completedAt: lifecycle.completedAt,
        });
      }
    }

    const inserted = await tx
      .insert(cards)
      .values(allValuesToInsert)
      .returning({ id: cards.id });

    // Post-insert: compact per list if duplicates exist; then verify
    const countExpr = sql<number>`COUNT(*)`.mapWith(Number);
    for (const listId of byList.keys()) {
      const duplicateIndices = await tx
        .select({ index: cards.index, count: countExpr })
        .from(cards)
        .where(and(eq(cards.listId, listId), isNull(cards.deletedAt)))
        .groupBy(cards.listId, cards.index)
        .having(gt(countExpr, 1));

      if (duplicateIndices.length > 0) {
        await tx.execute(sql`
          WITH ordered AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY "index", id) - 1 AS new_index
            FROM "card"
            WHERE "listId" = ${listId} AND "deletedAt" IS NULL
          )
          UPDATE "card" c
          SET "index" = o.new_index
          FROM ordered o
          WHERE c.id = o.id;
        `);

        const postFixDupes = await tx
          .select({ index: cards.index, count: countExpr })
          .from(cards)
          .where(and(eq(cards.listId, listId), isNull(cards.deletedAt)))
          .groupBy(cards.listId, cards.index)
          .having(gt(countExpr, 1));

        if (postFixDupes.length > 0) {
          throw new Error(
            `Invariant violation: duplicate card indices remain after compaction in list ${listId}`,
          );
        }
      }
    }

    return inserted;
  });
};

export const createCardLabelRelationship = async (
  db: dbClient,
  cardLabelRelationshipInput: { cardId: number; labelId: number },
) => {
  const [result] = await db
    .insert(cardsToLabels)
    .values({
      cardId: cardLabelRelationshipInput.cardId,
      labelId: cardLabelRelationshipInput.labelId,
    })
    .returning();

  return result;
};

export const bulkCreateCardLabelRelationship = async (
  db: dbClient,
  cardLabelRelationshipInput: { cardId: number; labelId: number }[],
) => {
  const [result] = await db
    .insert(cardsToLabels)
    .values(cardLabelRelationshipInput)
    .returning();

  return result;
};

export const getCardMemberRelationship = (
  db: dbClient,
  args: { cardId: number; memberId: number },
) => {
  return db.query.cardToWorkspaceMembers.findFirst({
    where: and(
      eq(cardToWorkspaceMembers.cardId, args.cardId),
      eq(cardToWorkspaceMembers.workspaceMemberId, args.memberId),
    ),
  });
};

export const createCardMemberRelationship = async (
  db: dbClient,
  cardMemberRelationshipInput: { cardId: number; memberId: number },
) => {
  const [result] = await db
    .insert(cardToWorkspaceMembers)
    .values({
      cardId: cardMemberRelationshipInput.cardId,
      workspaceMemberId: cardMemberRelationshipInput.memberId,
    })
    .returning();

  return { success: !!result };
};

export const getWithListAndMembersByPublicId = async (
  db: dbClient,
  cardPublicId: string,
) => {
  const card = await db.query.cards.findFirst({
    columns: {
      id: true,
      publicId: true,
      title: true,
      description: true,
      dueDate: true,
      priority: true,
      colourCode: true,
      startedAt: true,
      completedAt: true,
      createdBy: true,
      cardNumber: true,
      index: true,
    },
    with: {
      labels: {
        with: {
          label: {
            columns: {
              publicId: true,
              name: true,
              colourCode: true,
            },
          },
        },
      },
      attachments: {
        columns: {
          publicId: true,
          contentType: true,
          originalFilename: true,
          size: true,
        },
        where: isNull(cardAttachments.deletedAt),
        orderBy: asc(cardAttachments.createdAt),
      },
      checklists: {
        columns: {
          publicId: true,
          name: true,
          index: true,
        },
        where: isNull(checklists.deletedAt),
        orderBy: asc(checklists.index),
        with: {
          items: {
            columns: {
              publicId: true,
              title: true,
              completed: true,
              index: true,
            },
            where: isNull(checklistItems.deletedAt),
            orderBy: asc(checklistItems.index),
          },
        },
      },
      list: {
        columns: {
          publicId: true,
          name: true,
          status: true,
          colourCode: true,
        },
        with: {
          board: {
            columns: {
              publicId: true,
              name: true,
            },
            with: {
              labels: {
                columns: {
                  publicId: true,
                  colourCode: true,
                  name: true,
                },
                where: isNull(labels.deletedAt),
              },
              lists: {
                columns: {
                  publicId: true,
                  name: true,
                  status: true,
                  colourCode: true,
                },
                where: isNull(lists.deletedAt),
                orderBy: asc(lists.index),
              },
              workspace: {
                columns: {
                  publicId: true,
                  cardPrefix: true,
                },
                with: {
                  members: {
                    columns: {
                      publicId: true,
                      email: true,
                      status: true,
                    },
                    with: {
                      user: {
                        columns: {
                          id: true,
                          name: true,
                          email: true,
                          image: true,
                        },
                      },
                    },
                    where: isNull(workspaceMembers.deletedAt),
                  },
                },
              },
            },
          },
        },
        // https://github.com/drizzle-team/drizzle-orm/issues/2903
        // where: isNull(lists.deletedAt),
      },
      members: {
        with: {
          member: {
            columns: {
              publicId: true,
              email: true,
            },
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                },
              },
            },
            // https://github.com/drizzle-team/drizzle-orm/issues/2903
            // where: isNull(workspaceMembers.deletedAt),
          },
        },
      },
      activities: {
        columns: {
          publicId: true,
          type: true,
          createdAt: true,
          fromIndex: true,
          toIndex: true,
          fromTitle: true,
          toTitle: true,
          fromDescription: true,
          toDescription: true,
          fromDueDate: true,
          toDueDate: true,
          fromPriority: true,
          toPriority: true,
          fromColourCode: true,
          toColourCode: true,
        },
        with: {
          fromList: {
            columns: {
              publicId: true,
              name: true,
              index: true,
            },
          },
          toList: {
            columns: {
              publicId: true,
              name: true,
              index: true,
            },
          },
          label: {
            columns: {
              publicId: true,
              name: true,
            },
          },
          member: {
            columns: {
              publicId: true,
            },
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
          comment: {
            columns: {
              publicId: true,
              comment: true,
              createdBy: true,
              updatedAt: true,
              deletedAt: true,
            },
            // https://github.com/drizzle-team/drizzle-orm/issues/2903
            // where: isNull(comments.deletedAt),
          },
        },
      },
    },
    where: and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)),
  });

  if (!card) return null;

  const formattedResult = {
    ...card,
    labels: card.labels.map((label) => label.label),
    members: card.members.map((member) => member.member),
    activities: card.activities.filter(
      (activity) => !activity.comment?.deletedAt,
    ),
  };

  return formattedResult;
};

export const reorder = async (
  db: dbClient,
  args: {
    newListId: number | undefined;
    newIndex: number | undefined;
    cardId: number;
    clearLabels?: boolean;
  },
) => {
  return db.transaction(async (tx) => {
    const [cardLocation] = await tx
      .select({ listId: cards.listId })
      .from(cards)
      .where(and(eq(cards.id, args.cardId), isNull(cards.deletedAt)))
      .limit(1);

    if (!cardLocation)
      throw new Error(`Card not found for public ID ${args.cardId}`);

    const requestedListIds = [
      ...new Set([cardLocation.listId, args.newListId ?? cardLocation.listId]),
    ].sort((a, b) => a - b);
    const lockedLists = await tx
      .select({ id: lists.id, index: lists.index, status: lists.status })
      .from(lists)
      .where(and(inArray(lists.id, requestedListIds), isNull(lists.deletedAt)))
      .orderBy(asc(lists.id))
      .for("update");

    if (lockedLists.length !== requestedListIds.length)
      throw new Error("One or more lists were not found");

    const [card] = await tx
      .select({
        id: cards.id,
        index: cards.index,
        listId: cards.listId,
        startedAt: cards.startedAt,
        completedAt: cards.completedAt,
      })
      .from(cards)
      .where(and(eq(cards.id, args.cardId), isNull(cards.deletedAt)))
      .limit(1)
      .for("update");

    if (!card || !requestedListIds.includes(card.listId))
      throw new Error(`Card ${args.cardId} moved concurrently`);

    if (args.clearLabels) {
      await tx
        .delete(cardsToLabels)
        .where(eq(cardsToLabels.cardId, args.cardId));
    }

    const currentList = lockedLists.find((list) => list.id === card.listId);

    if (!currentList)
      throw new Error(`Current list ${card.listId} was not locked`);

    const currentIndex = card.index;
    const destinationListId = args.newListId ?? currentList.id;
    const destinationList = lockedLists.find(
      (list) => list.id === destinationListId,
    );

    if (!destinationList)
      throw new Error(`List not found for public ID ${destinationListId}`);

    const lastDestinationCard =
      args.newListId === undefined
        ? undefined
        : await tx.query.cards.findFirst({
            columns: { id: true, index: true },
            where: and(
              eq(cards.listId, destinationList.id),
              isNull(cards.deletedAt),
            ),
            orderBy: desc(cards.index),
          });
    const newList: {
      id: number;
      index: number;
      status: ListStatus | null;
      cards: { id: number; index: number }[];
    } = {
      ...destinationList,
      cards: lastDestinationCard ? [lastDestinationCard] : [],
    };

    let newIndex = args.newIndex;

    if (newIndex === undefined) {
      const lastCardIndex = newList.cards.length
        ? newList.cards[0]?.index
        : undefined;

      newIndex = lastCardIndex !== undefined ? lastCardIndex + 1 : 0;
    }

    if (currentList.id === newList.id) {
      await tx.execute(sql`
        UPDATE card
        SET index =
          CASE
            WHEN index = ${currentIndex} THEN ${newIndex}
            WHEN ${currentIndex} < ${newIndex} AND index > ${currentIndex} AND index <= ${newIndex} THEN index - 1
            WHEN ${currentIndex} > ${newIndex} AND index >= ${newIndex} AND index < ${currentIndex} THEN index + 1
            ELSE index
          END
        WHERE "listId" = ${currentList.id} AND "deletedAt" IS NULL;
      `);
    } else {
      const movedAt = new Date();

      await tx.execute(sql`
        UPDATE card
        SET index = index + 1
        WHERE "listId" = ${newList.id} AND index >= ${newIndex} AND "deletedAt" IS NULL;
      `);

      await tx.execute(sql`
        UPDATE card
        SET index = index - 1
        WHERE "listId" = ${currentList.id} AND index >= ${currentIndex} AND "deletedAt" IS NULL;
      `);

      const lifecycle = deriveCardLifecycle({
        currentStatus: currentList.status,
        destinationStatus: newList.status,
        startedAt: card.startedAt,
        completedAt: card.completedAt,
        movedAt,
      });

      await tx
        .update(cards)
        .set({
          listId: newList.id,
          index: newIndex,
          startedAt: lifecycle.startedAt,
          completedAt: lifecycle.completedAt,
          updatedAt: movedAt,
        })
        .where(and(eq(cards.id, card.id), isNull(cards.deletedAt)));
    }

    const countExpr = sql<number>`COUNT(*)`.mapWith(Number);

    const duplicateIndices = await tx
      .select({
        index: cards.index,
        count: countExpr,
      })
      .from(cards)
      .where(
        and(
          inArray(cards.listId, [currentList.id, newList.id]),
          isNull(cards.deletedAt),
        ),
      )
      .groupBy(cards.listId, cards.index)
      .having(gt(countExpr, 1));

    if (duplicateIndices.length > 0) {
      // Auto-heal by compacting indices for the affected list(s)
      const affectedListIds = [...new Set([currentList.id, newList.id])];

      if (affectedListIds.length === 1) {
        await tx.execute(sql`
          WITH ordered AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY "index", id) - 1 AS new_index
            FROM "card"
            WHERE "listId" = ${affectedListIds[0]} AND "deletedAt" IS NULL
          )
          UPDATE "card" c
          SET "index" = o.new_index
          FROM ordered o
          WHERE c.id = o.id;
        `);
      } else if (affectedListIds.length === 2) {
        await tx.execute(sql`
          WITH ordered AS (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY "listId" ORDER BY "index", id) - 1 AS new_index
            FROM "card"
            WHERE "listId" IN (${sql.join(affectedListIds, sql`,`)}) AND "deletedAt" IS NULL
          )
          UPDATE "card" c
          SET "index" = o.new_index
          FROM ordered o
          WHERE c.id = o.id;
        `);
      }

      // Verify fix and rollback if necessary
      const postFixDupes = await tx
        .select({ index: cards.index, count: countExpr })
        .from(cards)
        .where(
          and(inArray(cards.listId, affectedListIds), isNull(cards.deletedAt)),
        )
        .groupBy(cards.listId, cards.index)
        .having(gt(countExpr, 1));

      if (postFixDupes.length > 0) {
        throw new Error(
          `Invariant violation: duplicate card indices remain after compaction for card ${card.id}`,
        );
      }
    }

    const updatedCard = await tx.query.cards.findFirst({
      columns: {
        id: true,
        publicId: true,
        title: true,
        description: true,
        dueDate: true,
        priority: true,
        colourCode: true,
        startedAt: true,
        completedAt: true,
      },
      where: eq(cards.id, card.id),
    });

    return updatedCard;
  });
};

export const softDelete = async (
  db: dbClient,
  args: {
    cardId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    const [result] = await tx
      .update(cards)
      .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
      .where(eq(cards.id, args.cardId))
      .returning({
        id: cards.id,
        listId: cards.listId,
        index: cards.index,
      });

    if (!result)
      throw new Error(`Unable to soft delete card ID ${args.cardId}`);

    await tx.execute(sql`
      UPDATE card
      SET index = index - 1
      WHERE "listId" = ${result.listId} AND index > ${result.index} AND "deletedAt" IS NULL;
    `);

    const countExpr = sql<number>`COUNT(*)`.mapWith(Number);

    const duplicateIndices = await tx
      .select({
        index: cards.index,
        count: countExpr,
      })
      .from(cards)
      .where(and(eq(cards.listId, result.listId), isNull(cards.deletedAt)))
      .groupBy(cards.listId, cards.index)
      .having(gt(countExpr, 1));

    if (duplicateIndices.length > 0) {
      throw new Error(
        `Duplicate indices found after soft deleting ${result.id}`,
      );
    }

    return result;
  });
};

export const softDeleteAllByListIds = async (
  db: dbClient,
  args: {
    listIds: number[];
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  const updatedCards = await db
    .update(cards)
    .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
    .where(and(inArray(cards.listId, args.listIds), isNull(cards.deletedAt)))
    .returning({
      id: cards.id,
    });

  return updatedCards;
};

export const hardDeleteCardMemberRelationship = async (
  db: dbClient,
  args: { cardId: number; memberId: number },
) => {
  const [result] = await db
    .delete(cardToWorkspaceMembers)
    .where(
      and(
        eq(cardToWorkspaceMembers.cardId, args.cardId),
        eq(cardToWorkspaceMembers.workspaceMemberId, args.memberId),
      ),
    )
    .returning();

  return { success: !!result };
};

export const hardDeleteCardLabelRelationship = async (
  db: dbClient,
  args: { cardId: number; labelId: number },
) => {
  const [result] = await db
    .delete(cardsToLabels)
    .where(
      and(
        eq(cardsToLabels.cardId, args.cardId),
        eq(cardsToLabels.labelId, args.labelId),
      ),
    )
    .returning();

  return result;
};

export const hardDeleteAllCardLabelRelationships = async (
  db: dbClient,
  labelId: number,
) => {
  const [result] = await db
    .delete(cardsToLabels)
    .where(eq(cardsToLabels.labelId, labelId))
    .returning();

  return result;
};

export const getWorkspaceAndCardIdByCardPublicId = async (
  db: dbClient,
  cardPublicId: string,
) => {
  const result = await db.query.cards.findFirst({
    columns: { id: true, createdBy: true },
    where: and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)),
    with: {
      list: {
        columns: { name: true, publicId: true },
        with: {
          board: {
            columns: {
              id: true,
              publicId: true,
              workspaceId: true,
              visibility: true,
              name: true,
            },
          },
        },
      },
    },
  });

  return result
    ? {
        id: result.id,
        boardId: result.list.board.id,
        createdBy: result.createdBy,
        workspaceId: result.list.board.workspaceId,
        workspaceVisibility: result.list.board.visibility,
        listPublicId: result.list.publicId,
        listName: result.list.name,
        boardPublicId: result.list.board.publicId,
        boardName: result.list.board.name,
      }
    : null;
};
