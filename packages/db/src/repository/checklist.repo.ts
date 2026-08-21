import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { cardActivities, checklistItems, checklists } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { WorkspaceBoundaryTransaction } from "./workspace-boundary";
import {
  lockCardsInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

const lockChecklistCard = async (
  tx: WorkspaceBoundaryTransaction,
  cardId: number,
  expectedWorkspaceId: number,
) => {
  const [card] = await lockCardsInWorkspace(tx, [cardId], expectedWorkspaceId);
  if (!card) throw new WorkspaceChangedError();
  return card;
};

const lockChecklist = async (
  tx: WorkspaceBoundaryTransaction,
  checklistId: number,
  expectedWorkspaceId: number,
) => {
  const [candidate] = await tx
    .select({ cardId: checklists.cardId })
    .from(checklists)
    .where(and(eq(checklists.id, checklistId), isNull(checklists.deletedAt)))
    .limit(1);
  if (!candidate) throw new WorkspaceChangedError();

  await lockChecklistCard(tx, candidate.cardId, expectedWorkspaceId);
  const [checklist] = await tx
    .select({
      id: checklists.id,
      cardId: checklists.cardId,
      name: checklists.name,
    })
    .from(checklists)
    .where(
      and(
        eq(checklists.id, checklistId),
        eq(checklists.cardId, candidate.cardId),
        isNull(checklists.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!checklist) throw new WorkspaceChangedError();
  return checklist;
};

const lockChecklistItem = async (
  tx: WorkspaceBoundaryTransaction,
  itemId: number,
  expectedWorkspaceId: number,
) => {
  const [candidate] = await tx
    .select({
      checklistId: checklistItems.checklistId,
      cardId: checklists.cardId,
    })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
    .where(
      and(
        eq(checklistItems.id, itemId),
        isNull(checklistItems.deletedAt),
        isNull(checklists.deletedAt),
      ),
    )
    .limit(1);
  if (!candidate) throw new WorkspaceChangedError();

  await lockChecklistCard(tx, candidate.cardId, expectedWorkspaceId);
  const [checklist] = await tx
    .select({ id: checklists.id, cardId: checklists.cardId })
    .from(checklists)
    .where(
      and(
        eq(checklists.id, candidate.checklistId),
        eq(checklists.cardId, candidate.cardId),
        isNull(checklists.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!checklist) throw new WorkspaceChangedError();

  const [item] = await tx
    .select({
      id: checklistItems.id,
      checklistId: checklistItems.checklistId,
      index: checklistItems.index,
      title: checklistItems.title,
      completed: checklistItems.completed,
    })
    .from(checklistItems)
    .where(
      and(
        eq(checklistItems.id, itemId),
        eq(checklistItems.checklistId, checklist.id),
        isNull(checklistItems.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!item) throw new WorkspaceChangedError();
  return { cardId: checklist.cardId, item };
};

const lockChecklists = async (
  tx: WorkspaceBoundaryTransaction,
  checklistIds: number[],
  expectedWorkspaceId: number,
) => {
  const requestedIds = [...new Set(checklistIds)].sort((a, b) => a - b);
  if (requestedIds.length === 0) throw new WorkspaceChangedError();
  const candidates = await tx
    .select({ id: checklists.id, cardId: checklists.cardId })
    .from(checklists)
    .where(
      and(inArray(checklists.id, requestedIds), isNull(checklists.deletedAt)),
    );
  if (candidates.length !== requestedIds.length) {
    throw new WorkspaceChangedError();
  }

  await lockCardsInWorkspace(
    tx,
    candidates.map((checklist) => checklist.cardId),
    expectedWorkspaceId,
  );
  const locked = await tx
    .select({ id: checklists.id, cardId: checklists.cardId })
    .from(checklists)
    .where(
      and(inArray(checklists.id, requestedIds), isNull(checklists.deletedAt)),
    )
    .orderBy(asc(checklists.id))
    .for("update");
  const candidateCardById = new Map(
    candidates.map((checklist) => [checklist.id, checklist.cardId]),
  );
  if (
    locked.length !== requestedIds.length ||
    locked.some(
      (checklist) => candidateCardById.get(checklist.id) !== checklist.cardId,
    )
  ) {
    throw new WorkspaceChangedError();
  }
  return locked;
};

export const getCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(checklists)
    .where(isNull(checklists.deletedAt));
  return result[0]?.count ?? 0;
};

export const getCountItems = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(checklistItems)
    .where(isNull(checklistItems.deletedAt));
  return result[0]?.count ?? 0;
};

export const create = async (
  db: dbClient,
  checklistInput: {
    cardId: number;
    expectedWorkspaceId: number;
    name: string;
    createdBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    await lockChecklistCard(
      tx,
      checklistInput.cardId,
      checklistInput.expectedWorkspaceId,
    );
    const lastChecklist = await tx.query.checklists.findFirst({
      where: and(
        eq(checklists.cardId, checklistInput.cardId),
        isNull(checklists.deletedAt),
      ),
      orderBy: desc(checklists.index),
    });

    const [result] = await tx
      .insert(checklists)
      .values({
        publicId: generateUID(),
        name: checklistInput.name,
        createdBy: checklistInput.createdBy,
        cardId: checklistInput.cardId,
        index: lastChecklist ? lastChecklist.index + 1 : 0,
      })
      .returning({
        id: checklists.id,
        publicId: checklists.publicId,
        name: checklists.name,
      });
    if (!result) return undefined;

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.checklist.added",
      cardId: checklistInput.cardId,
      toTitle: result.name,
      createdBy: checklistInput.createdBy,
    });

    return result;
  });
};

export const createItem = async (
  db: dbClient,
  checklistItemInput: {
    checklistId: number;
    title: string;
    createdBy: string;
    completed?: boolean;
    expectedWorkspaceId: number;
  },
) => {
  return db.transaction(async (tx) => {
    const checklist = await lockChecklist(
      tx,
      checklistItemInput.checklistId,
      checklistItemInput.expectedWorkspaceId,
    );
    const lastItem = await tx.query.checklistItems.findFirst({
      where: and(
        eq(checklistItems.checklistId, checklistItemInput.checklistId),
        isNull(checklistItems.deletedAt),
      ),
      orderBy: desc(checklistItems.index),
    });

    const [result] = await tx
      .insert(checklistItems)
      .values({
        publicId: generateUID(),
        title: checklistItemInput.title,
        createdBy: checklistItemInput.createdBy,
        checklistId: checklistItemInput.checklistId,
        index: lastItem ? lastItem.index + 1 : 0,
        completed: checklistItemInput.completed ?? false,
      })
      .returning({
        id: checklistItems.id,
        publicId: checklistItems.publicId,
        title: checklistItems.title,
        completed: checklistItems.completed,
      });
    if (!result) return undefined;

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.checklist.item.added",
      cardId: checklist.cardId,
      toTitle: result.title,
      createdBy: checklistItemInput.createdBy,
    });

    return result;
  });
};

export const getChecklistByPublicId = async (
  db: dbClient,
  checklistPublicId: string,
) => {
  const checklist = await db.query.checklists.findFirst({
    where: and(
      eq(checklists.publicId, checklistPublicId),
      isNull(checklists.deletedAt),
    ),
    with: {
      card: {
        with: {
          list: {
            with: {
              board: {
                with: {
                  workspace: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return checklist;
};

export const getChecklistItemByPublicIdWithChecklist = async (
  db: dbClient,
  checklistItemPublicId: string,
) => {
  const item = await db.query.checklistItems.findFirst({
    where: and(
      eq(checklistItems.publicId, checklistItemPublicId),
      isNull(checklistItems.deletedAt),
    ),
    with: {
      checklist: {
        with: {
          card: {
            with: {
              list: {
                with: {
                  board: {
                    with: { workspace: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  return item;
};

export const updateItemById = async (
  db: dbClient,
  args: {
    id: number;
    title?: string;
    completed?: boolean;
    expectedWorkspaceId: number;
    updatedBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    const { cardId, item } = await lockChecklistItem(
      tx,
      args.id,
      args.expectedWorkspaceId,
    );
    const [result] = await tx
      .update(checklistItems)
      .set({
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.completed !== undefined ? { completed: args.completed } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(eq(checklistItems.id, args.id), isNull(checklistItems.deletedAt)),
      )
      .returning({
        publicId: checklistItems.publicId,
        title: checklistItems.title,
        completed: checklistItems.completed,
      });
    if (!result) throw new WorkspaceChangedError();

    if (args.completed !== undefined) {
      await tx.insert(cardActivities).values({
        publicId: generateUID(),
        type: args.completed
          ? "card.updated.checklist.item.completed"
          : "card.updated.checklist.item.uncompleted",
        cardId,
        toTitle: result.title,
        createdBy: args.updatedBy,
      });
    }
    if (args.title !== undefined && args.title !== item.title) {
      await tx.insert(cardActivities).values({
        publicId: generateUID(),
        type: "card.updated.checklist.item.updated",
        cardId,
        fromTitle: item.title,
        toTitle: result.title,
        createdBy: args.updatedBy,
      });
    }

    return result;
  });
};

export const softDeleteItemById = async (
  db: dbClient,
  args: {
    id: number;
    expectedWorkspaceId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    const { cardId, item } = await lockChecklistItem(
      tx,
      args.id,
      args.expectedWorkspaceId,
    );
    const [result] = await tx
      .update(checklistItems)
      .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
      .where(
        and(eq(checklistItems.id, args.id), isNull(checklistItems.deletedAt)),
      )
      .returning({ id: checklistItems.id });
    if (!result) throw new WorkspaceChangedError();

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.checklist.item.deleted",
      cardId,
      fromTitle: item.title,
      createdBy: args.deletedBy,
    });

    return result;
  });
};

export const softDeleteById = async (
  db: dbClient,
  args: {
    id: number;
    expectedWorkspaceId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    const checklist = await lockChecklist(
      tx,
      args.id,
      args.expectedWorkspaceId,
    );
    const activeItems = await tx
      .select({ id: checklistItems.id })
      .from(checklistItems)
      .where(
        and(
          eq(checklistItems.checklistId, checklist.id),
          isNull(checklistItems.deletedAt),
        ),
      )
      .orderBy(asc(checklistItems.id))
      .for("update");
    if (activeItems.length > 0) {
      await tx
        .update(checklistItems)
        .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
        .where(
          and(
            inArray(
              checklistItems.id,
              activeItems.map((item) => item.id),
            ),
            isNull(checklistItems.deletedAt),
          ),
        );
    }

    const [result] = await tx
      .update(checklists)
      .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
      .where(and(eq(checklists.id, args.id), isNull(checklists.deletedAt)))
      .returning({ id: checklists.id });
    if (!result) throw new WorkspaceChangedError();

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.checklist.deleted",
      cardId: checklist.cardId,
      fromTitle: checklist.name,
      createdBy: args.deletedBy,
    });

    return result;
  });
};

export const updateChecklistById = async (
  db: dbClient,
  args: {
    id: number;
    name: string;
    expectedWorkspaceId: number;
    updatedBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    const checklist = await lockChecklist(
      tx,
      args.id,
      args.expectedWorkspaceId,
    );
    const [result] = await tx
      .update(checklists)
      .set({ name: args.name, updatedAt: new Date() })
      .where(and(eq(checklists.id, args.id), isNull(checklists.deletedAt)))
      .returning({ publicId: checklists.publicId, name: checklists.name });
    if (!result) throw new WorkspaceChangedError();

    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: "card.updated.checklist.renamed",
      cardId: checklist.cardId,
      fromTitle: checklist.name,
      toTitle: result.name,
      createdBy: args.updatedBy,
    });

    return result;
  });
};

export const bulkCreate = async (
  db: dbClient,
  checklistInput: {
    cardId: number;
    name: string;
    createdBy: string;
    index: number;
  }[],
  expectedWorkspaceId: number,
) => {
  if (checklistInput.length === 0) return [];

  return db.transaction(async (tx) => {
    await lockCardsInWorkspace(
      tx,
      checklistInput.map((checklist) => checklist.cardId),
      expectedWorkspaceId,
    );
    const byCard = groupByKey(checklistInput, "cardId");

    const allValuesToInsert: {
      publicId: string;
      cardId: number;
      name: string;
      createdBy: string;
      index: number;
    }[] = [];

    for (const [cardId, items] of byCard.entries()) {
      const last = await tx.query.checklists.findFirst({
        columns: { index: true },
        where: and(eq(checklists.cardId, cardId), isNull(checklists.deletedAt)),
        orderBy: [desc(checklists.index)],
      });

      let nextIndex = last ? last.index + 1 : 0;

      const sorted = [...items].sort((a, b) => a.index - b.index);

      for (const item of sorted) {
        allValuesToInsert.push({
          publicId: generateUID(),
          ...item,
          index: nextIndex++,
        });
      }
    }

    const inserted = await tx
      .insert(checklists)
      .values(allValuesToInsert)
      .returning({ id: checklists.id, publicId: checklists.publicId });

    const insertedByPublicId = new Map(
      inserted.map((checklist) => [checklist.publicId, checklist]),
    );
    return allValuesToInsert.flatMap((checklist) => {
      const result = insertedByPublicId.get(checklist.publicId);
      return result ? [result] : [];
    });
  });
};

export const bulkCreateItems = async (
  db: dbClient,
  checklistItemInput: {
    checklistId: number;
    title: string;
    createdBy: string;
    index: number;
    completed: boolean;
  }[],
  expectedWorkspaceId: number,
) => {
  if (checklistItemInput.length === 0) return [];

  return db.transaction(async (tx) => {
    await lockChecklists(
      tx,
      checklistItemInput.map((item) => item.checklistId),
      expectedWorkspaceId,
    );
    const byChecklist = groupByKey(checklistItemInput, "checklistId");

    const allValuesToInsert: {
      publicId: string;
      checklistId: number;
      title: string;
      createdBy: string;
      index: number;
      completed: boolean;
    }[] = [];

    for (const [checklistId, items] of byChecklist.entries()) {
      const last = await tx.query.checklistItems.findFirst({
        columns: { index: true },
        where: and(
          eq(checklistItems.checklistId, checklistId),
          isNull(checklistItems.deletedAt),
        ),
        orderBy: [desc(checklistItems.index)],
      });

      let nextIndex = last ? last.index + 1 : 0;

      const sorted = [...items].sort((a, b) => a.index - b.index);

      for (const item of sorted) {
        allValuesToInsert.push({
          publicId: generateUID(),
          ...item,
          index: nextIndex++,
        });
      }
    }

    const inserted = await tx
      .insert(checklistItems)
      .values(allValuesToInsert)
      .returning({
        id: checklistItems.id,
        publicId: checklistItems.publicId,
        title: checklistItems.title,
        completed: checklistItems.completed,
      });

    return inserted;
  });
};

const groupByKey = <T extends Record<string, unknown>>(
  items: T[],
  keyField: keyof T,
): Map<number, T[]> => {
  const grouped = new Map<number, T[]>();
  for (const item of items) {
    const key = item[keyField] as number;
    const arr = grouped.get(key) ?? [];
    arr.push(item);
    grouped.set(key, arr);
  }
  return grouped;
};

export const reorderItem = async (
  db: dbClient,
  args: {
    itemId: number;
    newIndex: number;
    expectedWorkspaceId: number;
  },
) => {
  return db.transaction(async (tx) => {
    const { item } = await lockChecklistItem(
      tx,
      args.itemId,
      args.expectedWorkspaceId,
    );
    const lockedItems = await tx
      .select({
        id: checklistItems.id,
        publicId: checklistItems.publicId,
        title: checklistItems.title,
        completed: checklistItems.completed,
      })
      .from(checklistItems)
      .where(
        and(
          eq(checklistItems.checklistId, item.checklistId),
          isNull(checklistItems.deletedAt),
        ),
      )
      .orderBy(asc(checklistItems.id))
      .for("update");

    const currentIndex = item.index;
    const newIndex = Math.max(
      0,
      Math.min(args.newIndex, lockedItems.length - 1),
    );

    if (currentIndex === newIndex) {
      const unchanged = lockedItems.find((entry) => entry.id === item.id);
      if (!unchanged) {
        throw new WorkspaceChangedError();
      }
      return {
        publicId: unchanged.publicId,
        title: unchanged.title,
        completed: unchanged.completed,
      };
    }

    if (currentIndex < newIndex) {
      await tx.execute(sql`
        UPDATE card_checklist_item
        SET index = index - 1
        WHERE "checklistId" = ${item.checklistId}
        AND index > ${currentIndex}
        AND index <= ${newIndex}
        AND "deletedAt" IS NULL
        `);
    } else {
      await tx.execute(sql`
        UPDATE card_checklist_item
        SET index = index + 1
        WHERE "checklistId" = ${item.checklistId}
        AND index >= ${newIndex}
        AND index < ${currentIndex}
        AND "deletedAt" IS NULL
        `);
    }

    const [updated] = await tx
      .update(checklistItems)
      .set({ index: newIndex })
      .where(
        and(
          eq(checklistItems.id, args.itemId),
          isNull(checklistItems.deletedAt),
        ),
      )
      .returning({
        publicId: checklistItems.publicId,
        title: checklistItems.title,
        completed: checklistItems.completed,
      });

    if (!updated) {
      throw new WorkspaceChangedError();
    }

    return updated;
  });
};
