import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { boards, cards, lists, workspaces } from "@kan/db/schema";

export type WorkspaceBoundaryTransaction = Parameters<
  Parameters<dbClient["transaction"]>[0]
>[0];

export class WorkspaceChangedError extends Error {
  constructor() {
    super("Resource changed");
    this.name = "WorkspaceChangedError";
  }
}

type LockMode = "share" | "update";

interface BoardWorkspaceLockOptions {
  boardLock?: LockMode;
  workspaceLock?: LockMode;
}

export interface LockedCardBoundary {
  id: number;
  publicId: string;
  listId: number;
  boardId: number;
}

export async function assertBoardsInWorkspace(
  tx: WorkspaceBoundaryTransaction,
  boardIds: number[],
  expectedWorkspaceId: number,
  options: BoardWorkspaceLockOptions = {},
) {
  const requestedBoardIds = [...new Set(boardIds)].sort((a, b) => a - b);
  if (requestedBoardIds.length === 0) throw new WorkspaceChangedError();

  const lockedBoards = await tx
    .select({ id: boards.id })
    .from(boards)
    .where(
      and(
        inArray(boards.id, requestedBoardIds),
        eq(boards.workspaceId, expectedWorkspaceId),
        isNull(boards.deletedAt),
      ),
    )
    .orderBy(asc(boards.id))
    .for(options.boardLock ?? "share");

  if (lockedBoards.length !== requestedBoardIds.length) {
    throw new WorkspaceChangedError();
  }

  const [workspace] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(eq(workspaces.id, expectedWorkspaceId), isNull(workspaces.deletedAt)),
    )
    .limit(1)
    .for(options.workspaceLock ?? "share");

  if (!workspace) throw new WorkspaceChangedError();
}

export async function lockBoardTreeInWorkspace(
  tx: WorkspaceBoundaryTransaction,
  boardId: number,
  expectedWorkspaceId: number,
  options: {
    listLock?: LockMode;
    cardLock?: LockMode;
    boardLock?: LockMode;
    workspaceLock?: LockMode;
    requirePublic?: boolean;
  } = {},
) {
  const lockedLists = await tx
    .select({ id: lists.id })
    .from(lists)
    .where(eq(lists.boardId, boardId))
    .orderBy(asc(lists.id))
    .for(options.listLock ?? "share");
  const listIds = lockedLists.map((list) => list.id);
  const lockedCards =
    listIds.length === 0
      ? []
      : await tx
          .select({ id: cards.id })
          .from(cards)
          .where(inArray(cards.listId, listIds))
          .orderBy(asc(cards.id))
          .for(options.cardLock ?? "share");

  await assertBoardsInWorkspace(tx, [boardId], expectedWorkspaceId, {
    boardLock: options.boardLock,
    workspaceLock: options.workspaceLock,
  });
  if (options.requirePublic) {
    const [publicBoard] = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(
        and(
          eq(boards.id, boardId),
          eq(boards.visibility, "public"),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1);
    if (!publicBoard) throw new WorkspaceChangedError();
  }

  const finalLists = await tx
    .select({ id: lists.id })
    .from(lists)
    .where(eq(lists.boardId, boardId))
    .orderBy(asc(lists.id));
  if (
    finalLists.length !== lockedLists.length ||
    finalLists.some((list, index) => list.id !== lockedLists[index]?.id)
  ) {
    throw new WorkspaceChangedError();
  }

  return {
    listIds,
    cardIds: lockedCards.map((card) => card.id),
  };
}

export async function lockCardsInWorkspace(
  tx: WorkspaceBoundaryTransaction,
  cardIds: number[],
  expectedWorkspaceId: number,
  options: {
    listLock?: LockMode;
    cardLock?: LockMode;
    boardLock?: LockMode;
    workspaceLock?: LockMode;
    requirePublic?: boolean;
  } = {},
): Promise<LockedCardBoundary[]> {
  const requestedCardIds = [...new Set(cardIds)].sort((a, b) => a - b);
  if (requestedCardIds.length === 0) throw new WorkspaceChangedError();

  const locations = await tx
    .select({ id: cards.id, listId: cards.listId })
    .from(cards)
    .where(and(inArray(cards.id, requestedCardIds), isNull(cards.deletedAt)));
  if (locations.length !== requestedCardIds.length) {
    throw new WorkspaceChangedError();
  }

  const listIds = [...new Set(locations.map((card) => card.listId))].sort(
    (a, b) => a - b,
  );
  const lockedLists = await tx
    .select({ id: lists.id, boardId: lists.boardId })
    .from(lists)
    .where(and(inArray(lists.id, listIds), isNull(lists.deletedAt)))
    .orderBy(asc(lists.id))
    .for(options.listLock ?? "share");
  if (lockedLists.length !== listIds.length) {
    throw new WorkspaceChangedError();
  }

  const lockedCards = await tx
    .select({ id: cards.id, publicId: cards.publicId, listId: cards.listId })
    .from(cards)
    .where(and(inArray(cards.id, requestedCardIds), isNull(cards.deletedAt)))
    .orderBy(asc(cards.id))
    .for(options.cardLock ?? "update");
  if (
    lockedCards.length !== requestedCardIds.length ||
    lockedCards.some((card) => !listIds.includes(card.listId))
  ) {
    throw new WorkspaceChangedError();
  }

  const listById = new Map(lockedLists.map((list) => [list.id, list]));
  const boardIds = [
    ...new Set(
      lockedCards.map((card) => {
        const list = listById.get(card.listId);
        if (!list) throw new WorkspaceChangedError();
        return list.boardId;
      }),
    ),
  ].sort((a, b) => a - b);
  await assertBoardsInWorkspace(tx, boardIds, expectedWorkspaceId, {
    boardLock: options.boardLock,
    workspaceLock: options.workspaceLock,
  });

  if (options.requirePublic) {
    const publicBoards = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(
        and(
          inArray(boards.id, boardIds),
          eq(boards.visibility, "public"),
          isNull(boards.deletedAt),
        ),
      );
    if (publicBoards.length !== boardIds.length) {
      throw new WorkspaceChangedError();
    }
  }

  return lockedCards.map((card) => {
    const list = listById.get(card.listId);
    if (!list) throw new WorkspaceChangedError();
    return { ...card, boardId: list.boardId };
  });
}
