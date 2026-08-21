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
import type { ListStatus } from "@kan/db/schema";
import { cardActivities, cards, lists } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import { invalidateCardAlertsForList } from "./notification-alert.repo";
import {
  assertBoardsInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

export class ListStatusChangeConfirmationRequiredError extends Error {
  constructor(public readonly cardCount: number) {
    super("Confirm the status change for a list containing cards");
    this.name = "ListStatusChangeConfirmationRequiredError";
  }
}

export const inferListStatus = (name: string): ListStatus | null => {
  const normalized = name.trim().toLocaleLowerCase();

  if (normalized === "por hacer") return "planned";
  if (normalized === "en progreso") return "inProgress";
  if (normalized === "estancado") return "blocked";
  if (normalized === "hecho") return "done";

  return null;
};

export const getCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(lists)
    .where(isNull(lists.deletedAt));

  return result[0]?.count ?? 0;
};

export const create = async (
  db: dbClient,
  listInput: {
    name: string;
    createdBy: string;
    boardId: number;
    expectedWorkspaceId: number;
    importId?: number;
    status?: ListStatus | null;
    colourCode?: string | null;
  },
) => {
  return db.transaction(async (tx) => {
    const lockedLists = await tx
      .select({ id: lists.id, index: lists.index })
      .from(lists)
      .where(and(eq(lists.boardId, listInput.boardId), isNull(lists.deletedAt)))
      .orderBy(asc(lists.id))
      .for("update");
    await assertBoardsInWorkspace(
      tx,
      [listInput.boardId],
      listInput.expectedWorkspaceId,
      { boardLock: "update" },
    );
    const currentLists = await tx
      .select({ id: lists.id, index: lists.index })
      .from(lists)
      .where(and(eq(lists.boardId, listInput.boardId), isNull(lists.deletedAt)))
      .orderBy(asc(lists.id));
    const currentListIds = new Set(currentLists.map((list) => list.id));
    if (lockedLists.some((list) => !currentListIds.has(list.id))) {
      throw new WorkspaceChangedError();
    }
    const list = [...currentLists].sort((a, b) => b.index - a.index)[0];

    const index = list ? list.index + 1 : 0;

    const [result] = await tx
      .insert(lists)
      .values({
        publicId: generateUID(),
        name: listInput.name,
        createdBy: listInput.createdBy,
        boardId: listInput.boardId,
        index,
        importId: listInput.importId,
        status:
          listInput.status === undefined
            ? inferListStatus(listInput.name)
            : listInput.status,
        colourCode: listInput.colourCode ?? null,
      })
      .returning({
        id: lists.id,
        publicId: lists.publicId,
        boardId: lists.boardId,
        name: lists.name,
        status: lists.status,
        colourCode: lists.colourCode,
      });

    if (!result)
      throw new Error(`Failed to create list for board ${listInput.boardId}`);

    const countExpr = sql<number>`COUNT(*)`.mapWith(Number);

    const duplicateIndices = await tx
      .select({
        index: lists.index,
        count: countExpr,
      })
      .from(lists)
      .where(and(eq(lists.boardId, result.boardId), isNull(lists.deletedAt)))
      .groupBy(lists.index)
      .having(gt(countExpr, 1));

    if (duplicateIndices.length > 0) {
      // Compact indices to sequential values (0..n-1) to resolve duplicates while preserving order
      await tx.execute(sql`
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY "index", id) - 1 AS new_index
          FROM "list"
          WHERE "boardId" = ${result.boardId} AND "deletedAt" IS NULL
        )
        UPDATE "list" l
        SET "index" = o.new_index
        FROM ordered o
        WHERE l.id = o.id;
      `);

      // Last resort: verify fix; if duplicates persist (e.g., due to race conditions), rollback
      const postFixDupes = await tx
        .select({ index: lists.index, count: countExpr })
        .from(lists)
        .where(and(eq(lists.boardId, result.boardId), isNull(lists.deletedAt)))
        .groupBy(lists.index)
        .having(gt(countExpr, 1));

      if (postFixDupes.length > 0) {
        throw new Error(
          `Invariant violation: duplicate indices remain after compaction in board ${result.boardId}`,
        );
      }
    }

    return result;
  });
};

export const bulkCreate = async (
  db: dbClient,
  listInput: {
    publicId: string;
    name: string;
    createdBy: string;
    boardId: number;
    index: number;
    importId?: number;
    status?: ListStatus | null;
    colourCode?: string | null;
  }[],
  options: { expectedWorkspaceId: number },
) => {
  if (listInput.length === 0) return [];

  return db.transaction(async (tx) => {
    // Group incoming rows by board to compute safe, sequential indices per board
    const byBoard = new Map<number, typeof listInput>();
    for (const item of listInput) {
      const arr = byBoard.get(item.boardId) ?? [];
      arr.push(item);
      byBoard.set(item.boardId, arr);
    }

    const boardIds = [...byBoard.keys()].sort((a, b) => a - b);
    const lockedLists = await tx
      .select({ id: lists.id, boardId: lists.boardId, index: lists.index })
      .from(lists)
      .where(and(inArray(lists.boardId, boardIds), isNull(lists.deletedAt)))
      .orderBy(asc(lists.id))
      .for("update");
    await assertBoardsInWorkspace(tx, boardIds, options.expectedWorkspaceId, {
      boardLock: "update",
    });
    const existingLists = await tx
      .select({ id: lists.id, boardId: lists.boardId, index: lists.index })
      .from(lists)
      .where(and(inArray(lists.boardId, boardIds), isNull(lists.deletedAt)))
      .orderBy(asc(lists.id));
    const currentListIds = new Set(existingLists.map((list) => list.id));
    if (lockedLists.some((list) => !currentListIds.has(list.id))) {
      throw new WorkspaceChangedError();
    }

    const allValuesToInsert: {
      publicId: string;
      name: string;
      createdBy: string;
      boardId: number;
      index: number;
      importId?: number;
      status: ListStatus | null;
      colourCode: string | null;
    }[] = [];

    // For each board, append incoming lists after the current max index, preserving their relative order
    for (const [boardId, items] of byBoard.entries()) {
      // Find current max index for non-deleted lists in this board
      const last = existingLists
        .filter((list) => list.boardId === boardId)
        .sort((a, b) => b.index - a.index)[0];

      let nextIndex = last ? last.index + 1 : 0;

      // Sort incoming by their provided index to preserve Trello order, then reassign sequential indices
      const sorted = [...items].sort((a, b) => a.index - b.index);
      for (const it of sorted) {
        allValuesToInsert.push({
          publicId: it.publicId,
          name: it.name,
          createdBy: it.createdBy,
          boardId: it.boardId,
          index: nextIndex++,
          importId: it.importId,
          status:
            it.status === undefined ? inferListStatus(it.name) : it.status,
          colourCode: it.colourCode ?? null,
        });
      }
    }

    // Insert all rows in one go
    const inserted = await tx
      .insert(lists)
      .values(allValuesToInsert)
      .returning();

    // Post-insert check: if duplicates exist, compact indices per board instead of failing
    const countExpr = sql<number>`COUNT(*)`.mapWith(Number);
    for (const boardId of byBoard.keys()) {
      const duplicateIndices = await tx
        .select({ index: lists.index, count: countExpr })
        .from(lists)
        .where(and(eq(lists.boardId, boardId), isNull(lists.deletedAt)))
        .groupBy(lists.index)
        .having(gt(countExpr, 1));

      if (duplicateIndices.length > 0) {
        await tx.execute(sql`
          WITH ordered AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY "index", id) - 1 AS new_index
            FROM "list"
            WHERE "boardId" = ${boardId} AND "deletedAt" IS NULL
          )
          UPDATE "list" l
          SET "index" = o.new_index
          FROM ordered o
          WHERE l.id = o.id;
        `);

        // Last resort: verify fix; if duplicates persist (e.g., due to race conditions), rollback
        const postFixDupes = await tx
          .select({ index: lists.index, count: countExpr })
          .from(lists)
          .where(and(eq(lists.boardId, boardId), isNull(lists.deletedAt)))
          .groupBy(lists.index)
          .having(gt(countExpr, 1));

        if (postFixDupes.length > 0) {
          throw new Error(
            `Invariant violation: duplicate indices remain after compaction in board ${boardId}`,
          );
        }
      }
    }

    return inserted;
  });
};

export const getByPublicId = async (db: dbClient, listPublicId: string) => {
  return db.query.lists.findFirst({
    columns: {
      id: true,
      publicId: true,
      name: true,
      boardId: true,
      index: true,
      status: true,
      colourCode: true,
    },
    where: and(eq(lists.publicId, listPublicId), isNull(lists.deletedAt)),
  });
};

export const getWithCardsByPublicId = async (
  db: dbClient,
  listPublicId: string,
) => {
  return db.query.lists.findFirst({
    columns: {
      id: true,
    },
    with: {
      cards: {
        columns: {
          index: true,
        },
        where: isNull(lists.deletedAt),
        orderBy: [desc(lists.index)],
      },
    },
    where: and(eq(lists.publicId, listPublicId), isNull(lists.deletedAt)),
  });
};

export const update = async (
  db: dbClient,
  listInput: {
    name?: string;
    status?: ListStatus | null;
    colourCode?: string | null;
    confirmCardLifecycleUpdate?: boolean;
    newIndex?: number;
  },
  args: {
    listPublicId: string;
    expectedWorkspaceId: number;
  },
) =>
  db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: lists.id, boardId: lists.boardId })
      .from(lists)
      .where(
        and(eq(lists.publicId, args.listPublicId), isNull(lists.deletedAt)),
      )
      .limit(1);
    if (!candidate) throw new WorkspaceChangedError();
    const lockedLists = await tx
      .select({
        id: lists.id,
        boardId: lists.boardId,
        index: lists.index,
        status: lists.status,
      })
      .from(lists)
      .where(and(eq(lists.boardId, candidate.boardId), isNull(lists.deletedAt)))
      .orderBy(asc(lists.id))
      .for("update");
    const currentList = lockedLists.find((list) => list.id === candidate.id);
    if (!currentList) throw new WorkspaceChangedError();
    await assertBoardsInWorkspace(
      tx,
      [currentList.boardId],
      args.expectedWorkspaceId,
    );

    const statusChanged =
      listInput.status !== undefined && listInput.status !== currentList.status;
    const changedAt = new Date();

    if (statusChanged) {
      const [cardCount] = await tx
        .select({ count: count() })
        .from(cards)
        .where(and(eq(cards.listId, currentList.id), isNull(cards.deletedAt)));

      if (
        (cardCount?.count ?? 0) > 0 &&
        !listInput.confirmCardLifecycleUpdate
      ) {
        throw new ListStatusChangeConfirmationRequiredError(
          cardCount?.count ?? 0,
        );
      }
      if (listInput.status === "done") {
        await invalidateCardAlertsForList(tx, {
          listId: currentList.id,
          invalidatedAt: changedAt,
        });
      }
    }

    const [result] = await tx
      .update(lists)
      .set({
        name: listInput.name,
        status: listInput.status,
        colourCode:
          listInput.colourCode !== undefined ? listInput.colourCode : undefined,
        updatedAt: changedAt,
      })
      .where(
        and(eq(lists.publicId, args.listPublicId), isNull(lists.deletedAt)),
      )
      .returning({
        publicId: lists.publicId,
        name: lists.name,
        status: lists.status,
        colourCode: lists.colourCode,
      });

    if (statusChanged) {
      if (listInput.status === "inProgress") {
        await tx
          .update(cards)
          .set({
            startedAt: sql`coalesce(${cards.startedAt}, ${changedAt})`,
            completedAt: null,
            updatedAt: changedAt,
          })
          .where(
            and(eq(cards.listId, currentList.id), isNull(cards.deletedAt)),
          );
      } else {
        await tx
          .update(cards)
          .set({
            completedAt: listInput.status === "done" ? changedAt : null,
            updatedAt: changedAt,
          })
          .where(
            and(eq(cards.listId, currentList.id), isNull(cards.deletedAt)),
          );
      }
    }

    if (listInput.newIndex !== undefined) {
      await tx.execute(sql`
        UPDATE list
        SET index =
          CASE
            WHEN index = ${currentList.index} AND id = ${currentList.id} THEN ${listInput.newIndex}
            WHEN ${currentList.index} < ${listInput.newIndex} AND index > ${currentList.index} AND index <= ${listInput.newIndex} THEN index - 1
            WHEN ${currentList.index} > ${listInput.newIndex} AND index >= ${listInput.newIndex} AND index < ${currentList.index} THEN index + 1
            ELSE index
          END
        WHERE "boardId" = ${currentList.boardId} AND "deletedAt" IS NULL;
      `);

      const countExpr = sql<number>`COUNT(*)`.mapWith(Number);
      const duplicateIndices = await tx
        .select({ index: lists.index, count: countExpr })
        .from(lists)
        .where(
          and(eq(lists.boardId, currentList.boardId), isNull(lists.deletedAt)),
        )
        .groupBy(lists.index)
        .having(gt(countExpr, 1));
      if (duplicateIndices.length > 0) {
        await tx.execute(sql`
          WITH ordered AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY "index", id) - 1 AS new_index
            FROM "list"
            WHERE "boardId" = ${currentList.boardId} AND "deletedAt" IS NULL
          )
          UPDATE "list" l
          SET "index" = o.new_index
          FROM ordered o
          WHERE l.id = o.id;
        `);
        const postFixDupes = await tx
          .select({ index: lists.index, count: countExpr })
          .from(lists)
          .where(
            and(
              eq(lists.boardId, currentList.boardId),
              isNull(lists.deletedAt),
            ),
          )
          .groupBy(lists.index)
          .having(gt(countExpr, 1));
        if (postFixDupes.length > 0) {
          throw new Error(
            `Invariant violation: duplicate indices remain after compaction in board ${currentList.boardId}`,
          );
        }
      }
    }

    return result;
  });

export const reorder = async (
  db: dbClient,
  args: {
    listPublicId: string;
    newIndex: number;
    expectedWorkspaceId: number;
  },
) => {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: lists.id, boardId: lists.boardId })
      .from(lists)
      .where(
        and(eq(lists.publicId, args.listPublicId), isNull(lists.deletedAt)),
      )
      .limit(1);
    if (!candidate) throw new WorkspaceChangedError();

    const lockedLists = await tx
      .select({ id: lists.id, index: lists.index })
      .from(lists)
      .where(and(eq(lists.boardId, candidate.boardId), isNull(lists.deletedAt)))
      .orderBy(lists.id)
      .for("update");
    const list = lockedLists.find((entry) => entry.id === candidate.id);

    if (!list) throw new WorkspaceChangedError();
    await assertBoardsInWorkspace(
      tx,
      [candidate.boardId],
      args.expectedWorkspaceId,
    );

    await tx.execute(sql`
      UPDATE list
      SET index =
        CASE
          WHEN index = ${list.index} AND id = ${list.id} THEN ${args.newIndex}
          WHEN ${list.index} < ${args.newIndex} AND index > ${list.index} AND index <= ${args.newIndex} THEN index - 1
          WHEN ${list.index} > ${args.newIndex} AND index >= ${args.newIndex} AND index < ${list.index} THEN index + 1
          ELSE index
        END
      WHERE "boardId" = ${candidate.boardId} AND "deletedAt" IS NULL;
    `);

    const countExpr = sql<number>`COUNT(*)`.mapWith(Number);

    const duplicateIndices = await tx
      .select({
        index: lists.index,
        count: countExpr,
      })
      .from(lists)
      .where(and(eq(lists.boardId, candidate.boardId), isNull(lists.deletedAt)))
      .groupBy(lists.index)
      .having(gt(countExpr, 1));

    if (duplicateIndices.length > 0) {
      // Attempt to auto-heal by compacting indices to sequential values (0..n-1) while preserving order
      await tx.execute(sql`
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY "index", id) - 1 AS new_index
          FROM "list"
          WHERE "boardId" = ${candidate.boardId} AND "deletedAt" IS NULL
        )
        UPDATE "list" l
        SET "index" = o.new_index
        FROM ordered o
        WHERE l.id = o.id;
      `);

      // Last resort verification: if duplicates persist, rollback
      const postFixDupes = await tx
        .select({ index: lists.index, count: countExpr })
        .from(lists)
        .where(
          and(eq(lists.boardId, candidate.boardId), isNull(lists.deletedAt)),
        )
        .groupBy(lists.index)
        .having(gt(countExpr, 1));

      if (postFixDupes.length > 0) {
        throw new Error(
          `Invariant violation: duplicate indices remain after compaction in board ${candidate.boardId}`,
        );
      }
    }

    const updatedList = await tx.query.lists.findFirst({
      columns: {
        publicId: true,
        name: true,
        status: true,
        colourCode: true,
      },
      where: eq(lists.publicId, args.listPublicId),
    });

    return updatedList;
  });
};

export const softDeleteAllByBoardId = async (
  db: dbClient,
  args: {
    boardId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  const result = await db
    .update(lists)
    .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
    .where(and(eq(lists.boardId, args.boardId), isNull(lists.deletedAt)))
    .returning({
      id: lists.id,
    });

  return result;
};

export const softDeleteById = async (
  db: dbClient,
  args: {
    listId: number;
    expectedWorkspaceId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  return db.transaction(async (tx) => {
    const [currentList] = await tx
      .select({ id: lists.id, boardId: lists.boardId })
      .from(lists)
      .where(and(eq(lists.id, args.listId), isNull(lists.deletedAt)))
      .limit(1)
      .for("update");
    if (!currentList) throw new WorkspaceChangedError();
    const lockedCards = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.listId, currentList.id), isNull(cards.deletedAt)))
      .orderBy(asc(cards.id))
      .for("update");
    await assertBoardsInWorkspace(
      tx,
      [currentList.boardId],
      args.expectedWorkspaceId,
    );

    const [result] = await tx
      .update(lists)
      .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
      .where(and(eq(lists.id, currentList.id), isNull(lists.deletedAt)))
      .returning({
        id: lists.id,
        index: lists.index,
        boardId: lists.boardId,
      });

    if (!result)
      throw new Error(`Unable to soft delete list ID ${args.listId}`);

    if (lockedCards.length > 0) {
      await tx
        .update(cards)
        .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
        .where(
          and(
            inArray(
              cards.id,
              lockedCards.map((card) => card.id),
            ),
            isNull(cards.deletedAt),
          ),
        );
      await tx.insert(cardActivities).values(
        lockedCards.map((card) => ({
          publicId: generateUID(),
          type: "card.archived" as const,
          cardId: card.id,
          createdBy: args.deletedBy,
        })),
      );
    }

    await invalidateCardAlertsForList(tx, {
      listId: result.id,
      invalidatedAt: args.deletedAt,
    });

    await tx.execute(sql`
      UPDATE list
      SET index = index - 1
      WHERE "boardId" = ${result.boardId} AND index > ${result.index} AND "deletedAt" IS NULL;
    `);

    const countExpr = sql<number>`COUNT(*)`.mapWith(Number);

    const duplicateIndices = await tx
      .select({
        index: lists.index,
        count: countExpr,
      })
      .from(lists)
      .where(and(eq(lists.boardId, result.boardId), isNull(lists.deletedAt)))
      .groupBy(lists.index)
      .having(gt(countExpr, 1));

    if (duplicateIndices.length > 0) {
      throw new Error(
        `Duplicate indices found after reordering in board ${result.boardId}`,
      );
    }

    return result;
  });
};

export const getWorkspaceAndListIdByListPublicId = async (
  db: dbClient,
  listPublicId: string,
) => {
  const result = await db.query.lists.findFirst({
    columns: {
      id: true,
      boardId: true,
      name: true,
      status: true,
      colourCode: true,
      createdBy: true,
    },
    where: and(eq(lists.publicId, listPublicId), isNull(lists.deletedAt)),
    with: {
      board: {
        columns: {
          publicId: true,
          workspaceId: true,
          name: true,
        },
      },
    },
  });

  return result
    ? {
        id: result.id,
        boardId: result.boardId,
        publicId: listPublicId,
        name: result.name,
        status: result.status,
        colourCode: result.colourCode,
        createdBy: result.createdBy,
        workspaceId: result.board.workspaceId,
        boardPublicId: result.board.publicId,
        boardName: result.board.name,
      }
    : null;
};
