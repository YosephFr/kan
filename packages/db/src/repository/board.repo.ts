import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { BoardVisibilityStatus, CardPriority } from "@kan/db/schema";
import {
  boards,
  cardActivities,
  cardAttachments,
  cards,
  cardsToLabels,
  cardToWorkspaceMembers,
  checklistItems,
  checklists,
  comments,
  labels,
  lists,
  notifications,
  userBoardFavorites,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { WorkspaceBoundaryTransaction } from "./workspace-boundary";
import { clearInvalidOwnersForCardIdsTx } from "./cardSubtask.repo";
import { invalidateCardAlertsForBoard } from "./notification-alert.repo";
import {
  lockBoardTreeInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

export const getCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(boards)
    .where(isNull(boards.deletedAt));

  return result[0]?.count ?? 0;
};

export const getAllByWorkspaceId = async (
  db: dbClient,
  workspaceId: number,
  userId: string,
  opts?: { type?: "regular" | "template"; archived?: boolean },
) => {
  const boardsData = await db.query.boards.findMany({
    columns: {
      publicId: true,
      name: true,
    },
    with: {
      userFavorites: {
        where: eq(userBoardFavorites.userId, userId),
        columns: {
          userId: true,
        },
      },
      lists: {
        columns: {
          publicId: true,
          name: true,
          index: true,
          status: true,
          colourCode: true,
        },
        where: isNull(lists.deletedAt),
        orderBy: [asc(lists.index)],
      },
      labels: {
        columns: {
          publicId: true,
          name: true,
          colourCode: true,
        },
      },
    },
    where: and(
      eq(boards.workspaceId, workspaceId),
      isNull(boards.deletedAt),
      opts?.type ? eq(boards.type, opts.type) : undefined,
      opts?.archived !== undefined
        ? eq(boards.isArchived, opts.archived)
        : undefined,
    ),
  });

  // Transform and sort: favorites first, then alphabetically
  return boardsData
    .map((board) => ({
      ...board,
      favorite: board.userFavorites.length > 0,
      userFavorites: undefined,
    }))
    .sort((a, b) => {
      // Sort favorites first
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      // Then alphabetically by name
      return a.name.localeCompare(b.name);
    });
};

export const getIdByPublicId = async (db: dbClient, boardPublicId: string) => {
  const board = await db.query.boards.findFirst({
    columns: {
      id: true,
      type: true,
      isArchived: true,
      workspaceId: true,
    },
    where: eq(boards.publicId, boardPublicId),
  });

  return board;
};

interface DueDateFilter {
  startDate?: Date;
  endDate?: Date;
  hasNoDueDate?: boolean;
}

export interface BoardReadFilters {
  members: string[];
  labels: string[];
  lists: string[];
  dueDate: DueDateFilter[];
  priorities: CardPriority[];
  type: "regular" | "template" | undefined;
}

export type BoardSlugReadFilters = Omit<BoardReadFilters, "type">;

const buildDueDateWhere = (filters: DueDateFilter[]) => {
  if (!filters.length) return undefined;

  const clauses = filters
    .map((filter) => {
      const conditions: ReturnType<typeof and>[] = [];

      if (filter.hasNoDueDate) {
        conditions.push(isNull(cards.dueDate));
      } else {
        conditions.push(isNotNull(cards.dueDate));

        if (filter.startDate)
          conditions.push(gte(cards.dueDate, filter.startDate));

        if (filter.endDate) conditions.push(lte(cards.dueDate, filter.endDate));
      }

      return conditions.length > 0 ? and(...conditions) : undefined;
    })
    .filter((clause): clause is NonNullable<typeof clause> => !!clause);

  if (!clauses.length) return undefined;

  return or(...clauses);
};

export const queryByPublicId = async (
  db: dbClient | WorkspaceBoundaryTransaction,
  boardPublicId: string,
  userId: string,
  filters: BoardReadFilters,
) => {
  let cardIds: string[] = [];

  if (filters.labels.length > 0 || filters.members.length > 0) {
    const filteredCards = await db
      .select({
        publicId: cards.publicId,
      })
      .from(cards)
      .leftJoin(cardsToLabels, eq(cards.id, cardsToLabels.cardId))
      .leftJoin(labels, eq(cardsToLabels.labelId, labels.id))
      .leftJoin(
        cardToWorkspaceMembers,
        eq(cards.id, cardToWorkspaceMembers.cardId),
      )
      .leftJoin(
        workspaceMembers,
        eq(cardToWorkspaceMembers.workspaceMemberId, workspaceMembers.id),
      )
      .where(
        and(
          isNull(cards.deletedAt),
          or(
            filters.labels.length > 0
              ? inArray(labels.publicId, filters.labels)
              : undefined,
            filters.members.length > 0
              ? inArray(workspaceMembers.publicId, filters.members)
              : undefined,
          ),
        ),
      );

    cardIds = filteredCards.map((card) => card.publicId);
  }

  const board = await db.query.boards.findFirst({
    columns: {
      publicId: true,
      name: true,
      slug: true,
      visibility: true,
      isArchived: true,
    },
    with: {
      userFavorites: {
        where: eq(userBoardFavorites.userId, userId),
        columns: {
          userId: true,
        },
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
      labels: {
        columns: {
          publicId: true,
          name: true,
          colourCode: true,
        },
        where: isNull(labels.deletedAt),
      },
      lists: {
        columns: {
          publicId: true,
          name: true,
          boardId: true,
          index: true,
          status: true,
          colourCode: true,
        },
        with: {
          cards: {
            columns: {
              publicId: true,
              title: true,
              description: true,
              listId: true,
              index: true,
              dueDate: true,
              cardNumber: true,
              priority: true,
              colourCode: true,
              startedAt: true,
              completedAt: true,
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
              members: {
                with: {
                  member: {
                    columns: {
                      publicId: true,
                      email: true,
                      deletedAt: true,
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
                  },
                },
              },
              attachments: {
                columns: {
                  publicId: true,
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
              comments: {
                columns: {
                  publicId: true,
                },
                where: isNull(comments.deletedAt),
                limit: 1,
              },
            },
            where: and(
              cardIds.length > 0 ? inArray(cards.publicId, cardIds) : undefined,
              isNull(cards.deletedAt),
              buildDueDateWhere(filters.dueDate),
              filters.priorities.length > 0
                ? inArray(cards.priority, filters.priorities)
                : undefined,
            ),
            orderBy: [asc(cards.index)],
          },
        },
        where: and(
          isNull(lists.deletedAt),
          filters.lists.length > 0
            ? inArray(lists.publicId, filters.lists)
            : undefined,
        ),
        orderBy: [asc(lists.index)],
      },
      allLists: {
        columns: {
          publicId: true,
          name: true,
          status: true,
          colourCode: true,
        },
        where: isNull(lists.deletedAt),
        orderBy: [asc(lists.index)],
      },
    },
    where: and(
      eq(boards.publicId, boardPublicId),
      isNull(boards.deletedAt),
      eq(boards.type, filters.type ?? "regular"),
    ),
  });

  if (!board) return null;

  const formattedResult = {
    ...board,
    favorite: board.userFavorites.length > 0,
    userFavorites: undefined,
    lists: board.lists.map((list) => ({
      ...list,
      cards: list.cards.map((card) => ({
        ...card,
        labels: card.labels.map((label) => label.label),
        members: card.members
          .map((member) => member.member)
          .filter((member) => member.deletedAt === null),
      })),
    })),
  };

  return formattedResult;
};

export const getByPublicId = (
  db: dbClient,
  boardPublicId: string,
  userId: string,
  filters: BoardReadFilters,
) => queryByPublicId(db, boardPublicId, userId, filters);

export const queryBySlug = async (
  db: dbClient | WorkspaceBoundaryTransaction,
  boardSlug: string,
  workspaceId: number,
  filters: BoardSlugReadFilters,
) => {
  let cardIds: string[] = [];

  if (filters.labels.length) {
    const filteredCards = await db
      .select({
        publicId: cards.publicId,
      })
      .from(cards)
      .leftJoin(cardsToLabels, eq(cards.id, cardsToLabels.cardId))
      .leftJoin(labels, eq(cardsToLabels.labelId, labels.id))
      .where(
        and(
          isNull(cards.deletedAt),
          filters.labels.length > 0
            ? inArray(labels.publicId, filters.labels)
            : undefined,
        ),
      );

    cardIds = filteredCards.map((card) => card.publicId);
  }

  const board = await db.query.boards.findFirst({
    columns: {
      publicId: true,
      name: true,
      slug: true,
      visibility: true,
    },
    with: {
      workspace: {
        columns: {
          publicId: true,
          name: true,
          slug: true,
          cardPrefix: true,
        },
      },
      labels: {
        columns: {
          publicId: true,
          name: true,
          colourCode: true,
        },
        where: isNull(labels.deletedAt),
      },
      lists: {
        columns: {
          publicId: true,
          name: true,
          boardId: true,
          index: true,
          status: true,
          colourCode: true,
        },
        with: {
          cards: {
            columns: {
              publicId: true,
              title: true,
              description: true,
              listId: true,
              index: true,
              dueDate: true,
              cardNumber: true,
              priority: true,
              colourCode: true,
              startedAt: true,
              completedAt: true,
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
                },
                where: isNull(cardAttachments.deletedAt),
                orderBy: asc(cardAttachments.createdAt),
              },
              comments: {
                columns: {
                  publicId: true,
                },
                where: isNull(comments.deletedAt),
                limit: 1,
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
            },
            where: and(
              cardIds.length > 0 ? inArray(cards.publicId, cardIds) : undefined,
              isNull(cards.deletedAt),
              buildDueDateWhere(filters.dueDate),
              filters.priorities.length > 0
                ? inArray(cards.priority, filters.priorities)
                : undefined,
            ),
            orderBy: [asc(cards.index)],
          },
        },
        where: and(
          isNull(lists.deletedAt),
          filters.lists.length > 0
            ? inArray(lists.publicId, filters.lists)
            : undefined,
        ),
        orderBy: [asc(lists.index)],
      },
      allLists: {
        columns: {
          publicId: true,
          name: true,
          status: true,
          colourCode: true,
        },
        where: isNull(lists.deletedAt),
        orderBy: [asc(lists.index)],
      },
    },
    where: and(
      eq(boards.slug, boardSlug),
      eq(boards.workspaceId, workspaceId),
      isNull(boards.deletedAt),
      eq(boards.visibility, "public"),
    ),
  });

  if (!board) return null;

  const formattedResult = {
    ...board,
    lists: board.lists.map((list) => ({
      ...list,
      cards: list.cards.map((card) => ({
        ...card,
        labels: card.labels.map((label) => label.label),
      })),
    })),
  };

  return formattedResult;
};

export const getBySlug = (
  db: dbClient,
  boardSlug: string,
  workspaceId: number,
  filters: BoardSlugReadFilters,
) => queryBySlug(db, boardSlug, workspaceId, filters);

export const getWithListIdsByPublicId = (
  db: dbClient,
  boardPublicId: string,
) => {
  return db.query.boards.findFirst({
    columns: {
      id: true,
      workspaceId: true,
      createdBy: true,
    },
    with: {
      lists: {
        columns: {
          id: true,
        },
      },
    },
    where: eq(boards.publicId, boardPublicId),
  });
};

export const getWithLatestListIndexByPublicId = (
  db: dbClient,
  boardPublicId: string,
) => {
  return db.query.boards.findFirst({
    columns: {
      id: true,
      workspaceId: true,
    },
    with: {
      lists: {
        columns: {
          index: true,
        },
        where: isNull(lists.deletedAt),
        orderBy: [desc(lists.index)],
        limit: 1,
      },
    },
    where: eq(boards.publicId, boardPublicId),
  });
};

export const create = async (
  db: dbClient,
  boardInput: {
    publicId?: string;
    name: string;
    createdBy: string;
    workspaceId: number;
    importId?: number;
    slug: string;
    type?: "regular" | "template";
    sourceBoardId?: number;
  },
) => {
  const [result] = await db
    .insert(boards)
    .values({
      publicId: boardInput.publicId ?? generateUID(),
      name: boardInput.name,
      createdBy: boardInput.createdBy,
      workspaceId: boardInput.workspaceId,
      importId: boardInput.importId,
      slug: boardInput.slug,
      type: boardInput.type ?? "regular",
      sourceBoardId: boardInput.sourceBoardId,
    })
    .returning({
      id: boards.id,
      publicId: boards.publicId,
      name: boards.name,
    });

  return result;
};

export const update = async (
  db: dbClient,
  boardInput: {
    name: string | undefined;
    slug: string | undefined;
    visibility: BoardVisibilityStatus | undefined;
    boardPublicId: string;
    expectedWorkspaceId: number;
    isArchived?: boolean;
  },
) =>
  db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(
        and(
          eq(boards.publicId, boardInput.boardPublicId),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1);
    if (!candidate) throw new WorkspaceChangedError();
    await lockBoardTreeInWorkspace(
      tx,
      candidate.id,
      boardInput.expectedWorkspaceId,
      { boardLock: "update" },
    );

    const updatedAt = new Date();
    const [result] = await tx
      .update(boards)
      .set({
        name: boardInput.name,
        slug: boardInput.slug,
        visibility: boardInput.visibility,
        updatedAt,
        ...(boardInput.isArchived !== undefined && {
          isArchived: boardInput.isArchived,
        }),
      })
      .where(
        and(
          eq(boards.id, candidate.id),
          eq(boards.workspaceId, boardInput.expectedWorkspaceId),
          isNull(boards.deletedAt),
        ),
      )
      .returning({
        id: boards.id,
        publicId: boards.publicId,
        name: boards.name,
      });
    if (!result) return undefined;
    if (boardInput.isArchived === true) {
      await invalidateCardAlertsForBoard(tx, {
        boardId: result.id,
        invalidatedAt: updatedAt,
      });
    }

    return { publicId: result.publicId, name: result.name };
  });

export const softDelete = async (
  db: dbClient,
  args: {
    boardId: number;
    expectedWorkspaceId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) =>
  db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, args.boardId), isNull(boards.deletedAt)))
      .limit(1);
    if (!candidate) throw new WorkspaceChangedError();
    const lockedTree = await lockBoardTreeInWorkspace(
      tx,
      candidate.id,
      args.expectedWorkspaceId,
      {
        listLock: "update",
        cardLock: "update",
        boardLock: "update",
      },
    );

    const [result] = await tx
      .update(boards)
      .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
      .where(
        and(
          eq(boards.id, candidate.id),
          eq(boards.workspaceId, args.expectedWorkspaceId),
          isNull(boards.deletedAt),
        ),
      )
      .returning({
        publicId: boards.publicId,
        name: boards.name,
      });
    if (!result) return undefined;
    if (lockedTree.listIds.length > 0) {
      await tx
        .update(lists)
        .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
        .where(
          and(inArray(lists.id, lockedTree.listIds), isNull(lists.deletedAt)),
        );
    }
    const deletedCards =
      lockedTree.cardIds.length === 0
        ? []
        : await tx
            .update(cards)
            .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
            .where(
              and(
                inArray(cards.id, lockedTree.cardIds),
                isNull(cards.deletedAt),
              ),
            )
            .returning({ id: cards.id });
    if (deletedCards.length > 0) {
      await tx.insert(cardActivities).values(
        deletedCards.map((card) => ({
          publicId: generateUID(),
          type: "card.archived" as const,
          cardId: card.id,
          createdBy: args.deletedBy,
        })),
      );
    }
    await invalidateCardAlertsForBoard(tx, {
      boardId: candidate.id,
      invalidatedAt: args.deletedAt,
    });

    return result;
  });

export const hardDelete = async (db: dbClient, workspaceId: number) => {
  const [result] = await db
    .delete(boards)
    .where(eq(boards.workspaceId, workspaceId))
    .returning({
      publicId: boards.publicId,
      name: boards.name,
    });

  return result;
};

export const isSlugUnique = async (
  db: dbClient,
  args: { slug: string; workspaceId: number },
) => {
  const result = await db.query.boards.findFirst({
    columns: {
      slug: true,
    },
    where: and(
      eq(boards.slug, args.slug),
      eq(boards.workspaceId, args.workspaceId),
      isNull(boards.deletedAt),
    ),
  });

  return result === undefined;
};

export const getWorkspaceAndBoardIdByBoardPublicId = async (
  db: dbClient,
  boardPublicId: string,
) => {
  const result = await db.query.boards.findFirst({
    columns: {
      id: true,
      workspaceId: true,
      createdBy: true,
    },
    where: eq(boards.publicId, boardPublicId),
  });

  return result;
};

/**
 * Fetches the board fields needed by the move mutation:
 * identity, naming, type guards, and workspace ownership.
 * Soft-deleted boards are excluded — moving a tombstoned board has
 * no defensible semantics.
 */
export const getBoardForMove = async (db: dbClient, boardPublicId: string) => {
  return db.query.boards.findFirst({
    columns: {
      id: true,
      name: true,
      slug: true,
      type: true,
      isArchived: true,
      workspaceId: true,
      createdBy: true,
    },
    where: and(eq(boards.publicId, boardPublicId), isNull(boards.deletedAt)),
  });
};

export const isBoardSlugAvailable = async (
  db: dbClient,
  boardSlug: string,
  workspaceId: number,
) => {
  const result = await db.query.boards.findFirst({
    columns: {
      id: true,
    },
    where: and(
      eq(boards.slug, boardSlug),
      eq(boards.workspaceId, workspaceId),
      isNull(boards.deletedAt),
    ),
  });

  return result === undefined;
};

export { createFromSnapshot } from "./boardClone.repo";

export const moveToWorkspace = async (
  db: dbClient,
  boardId: number,
  targetWorkspaceId: number,
  newSlug: string | undefined,
  options: { expectedSourceWorkspaceId: number; movedBy: string },
) => {
  return db.transaction(async (tx) => {
    const boardLists = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(eq(lists.boardId, boardId))
      .orderBy(asc(lists.id))
      .for("update");
    const listIds = boardLists.map((list) => list.id);
    if (listIds.length > 0) {
      await tx
        .select({ id: cards.id })
        .from(cards)
        .where(inArray(cards.listId, listIds))
        .orderBy(asc(cards.id))
        .for("update");
    }
    const [lockedBoard] = await tx
      .select({
        id: boards.id,
        workspaceId: boards.workspaceId,
        type: boards.type,
        isArchived: boards.isArchived,
        deletedAt: boards.deletedAt,
      })
      .from(boards)
      .where(eq(boards.id, boardId))
      .limit(1)
      .for("update");
    const requestedWorkspaceIds = [
      ...new Set([options.expectedSourceWorkspaceId, targetWorkspaceId]),
    ].sort((a, b) => a - b);
    const lockedWorkspaces = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          inArray(workspaces.id, requestedWorkspaceIds),
          isNull(workspaces.deletedAt),
        ),
      )
      .orderBy(asc(workspaces.id))
      .for("update");

    const activeMoverMemberships = await tx
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(
        and(
          inArray(workspaceMembers.workspaceId, requestedWorkspaceIds),
          eq(workspaceMembers.userId, options.movedBy),
          eq(workspaceMembers.status, "active"),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .orderBy(asc(workspaceMembers.workspaceId), asc(workspaceMembers.id))
      .for("share");
    const activeMoverWorkspaceIds = new Set(
      activeMoverMemberships.map((member) => member.workspaceId),
    );

    if (
      !lockedBoard ||
      lockedBoard.deletedAt !== null ||
      lockedBoard.type === "template" ||
      lockedBoard.isArchived ||
      lockedWorkspaces.length !== requestedWorkspaceIds.length ||
      requestedWorkspaceIds.some(
        (workspaceId) => !activeMoverWorkspaceIds.has(workspaceId),
      ) ||
      lockedBoard.workspaceId !== options.expectedSourceWorkspaceId
    ) {
      throw new WorkspaceChangedError();
    }

    const [updatedBoard] = await tx
      .update(boards)
      .set({
        workspaceId: targetWorkspaceId,
        ...(newSlug && { slug: newSlug }),
        updatedAt: new Date(),
      })
      .where(eq(boards.id, boardId))
      .returning({
        publicId: boards.publicId,
        name: boards.name,
      });

    if (!updatedBoard) throw new Error("Failed to move board");

    const finalBoardLists = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(eq(lists.boardId, boardId))
      .orderBy(asc(lists.id));
    const finalListIds = finalBoardLists.map((list) => list.id);
    const finalBoardCards =
      finalListIds.length === 0
        ? []
        : await tx
            .select({ id: cards.id })
            .from(cards)
            .where(inArray(cards.listId, finalListIds))
            .orderBy(asc(cards.id));
    const finalCardIds = finalBoardCards.map((card) => card.id);

    if (finalCardIds.length > 0) {
      await tx
        .delete(cardToWorkspaceMembers)
        .where(inArray(cardToWorkspaceMembers.cardId, finalCardIds));

      await clearInvalidOwnersForCardIdsTx(tx, {
        cardIds: finalCardIds,
        updatedBy: options.movedBy,
      });

      await tx
        .update(notifications)
        .set({ deletedAt: new Date(), dedupeKey: null })
        .where(
          and(
            inArray(notifications.cardId, finalCardIds),
            inArray(notifications.type, [
              "card.priority.urgent",
              "card.due.soon",
              "card.due.overdue",
              "subtask.assigned",
              "subtask.due.soon",
              "subtask.due.overdue",
            ]),
            isNull(notifications.deletedAt),
          ),
        );
    }

    return updatedBoard;
  });
};

export const addUserFavorite = async (
  db: dbClient,
  userId: string,
  boardId: number,
) => {
  return db
    .insert(userBoardFavorites)
    .values({
      userId,
      boardId,
    })
    .onConflictDoNothing()
    .returning();
};

export const removeUserFavorite = async (
  db: dbClient,
  userId: string,
  boardId: number,
) => {
  return db
    .delete(userBoardFavorites)
    .where(
      and(
        eq(userBoardFavorites.userId, userId),
        eq(userBoardFavorites.boardId, boardId),
      ),
    )
    .returning();
};
