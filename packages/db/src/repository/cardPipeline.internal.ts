import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { CardPipelineStageStatus, ListStatus } from "@kan/db/schema";
import {
  boards,
  cardPipelineStages,
  cards,
  cardSubtasks,
  lists,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";

export type DbTransaction = Parameters<
  Parameters<dbClient["transaction"]>[0]
>[0];

export interface LockedPipelineCard {
  id: number;
  publicId: string;
  workspaceId: number;
  completedAt: Date | null;
  listStatus: ListStatus | null;
  boardArchived: boolean;
}

export async function lockPipelineCardById(
  tx: DbTransaction,
  cardId: number,
): Promise<LockedPipelineCard | null> {
  const locked = await lockPipelineCardsByIds(tx, [cardId]);
  return locked[0] ?? null;
}

export async function lockPipelineCardsByIds(
  tx: DbTransaction,
  cardIds: number[],
): Promise<LockedPipelineCard[]> {
  const requestedCardIds = [...new Set(cardIds)].sort((a, b) => a - b);
  if (requestedCardIds.length === 0) return [];

  const locations = await tx
    .select({ id: cards.id, listId: cards.listId })
    .from(cards)
    .where(and(inArray(cards.id, requestedCardIds), isNull(cards.deletedAt)));
  if (locations.length !== requestedCardIds.length) return [];

  const requestedListIds = [
    ...new Set(locations.map((card) => card.listId)),
  ].sort((a, b) => a - b);
  const lockedLists = await tx
    .select({ id: lists.id, boardId: lists.boardId, status: lists.status })
    .from(lists)
    .where(and(inArray(lists.id, requestedListIds), isNull(lists.deletedAt)))
    .orderBy(asc(lists.id))
    .for("share");
  if (lockedLists.length !== requestedListIds.length) return [];

  const lockedCards = await tx
    .select({
      id: cards.id,
      publicId: cards.publicId,
      listId: cards.listId,
      completedAt: cards.completedAt,
    })
    .from(cards)
    .where(and(inArray(cards.id, requestedCardIds), isNull(cards.deletedAt)))
    .orderBy(asc(cards.id))
    .for("update");
  if (
    lockedCards.length !== requestedCardIds.length ||
    lockedCards.some((card) => !requestedListIds.includes(card.listId))
  ) {
    return [];
  }

  const requestedBoardIds = [
    ...new Set(lockedLists.map((list) => list.boardId)),
  ].sort((a, b) => a - b);
  const lockedBoards = await tx
    .select({
      id: boards.id,
      workspaceId: boards.workspaceId,
      isArchived: boards.isArchived,
    })
    .from(boards)
    .where(and(inArray(boards.id, requestedBoardIds), isNull(boards.deletedAt)))
    .orderBy(asc(boards.id))
    .for("share");
  if (lockedBoards.length !== requestedBoardIds.length) return [];

  const requestedWorkspaceIds = [
    ...new Set(lockedBoards.map((board) => board.workspaceId)),
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
    .for("share");
  if (lockedWorkspaces.length !== requestedWorkspaceIds.length) return [];

  const listById = new Map(lockedLists.map((list) => [list.id, list]));
  const boardById = new Map(lockedBoards.map((board) => [board.id, board]));
  const resultById = new Map<number, LockedPipelineCard>();
  for (const card of lockedCards) {
    const list = listById.get(card.listId);
    const board = list ? boardById.get(list.boardId) : null;
    if (!list || !board || !requestedWorkspaceIds.includes(board.workspaceId)) {
      return [];
    }
    resultById.set(card.id, {
      id: card.id,
      publicId: card.publicId,
      workspaceId: board.workspaceId,
      completedAt: card.completedAt,
      listStatus: list.status,
      boardArchived: board.isArchived,
    });
  }

  return requestedCardIds.flatMap((id) => {
    const card = resultById.get(id);
    return card ? [card] : [];
  });
}

export async function lockPipelineCardByPublicId(
  tx: DbTransaction,
  cardPublicId: string,
): Promise<LockedPipelineCard | null> {
  const [candidate] = await tx
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)))
    .limit(1);

  if (!candidate) return null;
  return lockPipelineCardById(tx, candidate.id);
}

export async function resolveStageCardId(
  db: dbClient | DbTransaction,
  stagePublicId: string,
): Promise<number | null> {
  const [stage] = await db
    .select({ cardId: cardPipelineStages.cardId })
    .from(cardPipelineStages)
    .where(eq(cardPipelineStages.publicId, stagePublicId))
    .limit(1);

  return stage?.cardId ?? null;
}

export async function resolveSubtaskCardId(
  db: dbClient | DbTransaction,
  subtaskPublicId: string,
): Promise<number | null> {
  const [subtask] = await db
    .select({ cardId: cardSubtasks.cardId })
    .from(cardSubtasks)
    .where(
      and(
        eq(cardSubtasks.publicId, subtaskPublicId),
        isNull(cardSubtasks.deletedAt),
      ),
    )
    .limit(1);

  return subtask?.cardId ?? null;
}

export async function resolveActiveWorkspaceMember(
  tx: DbTransaction,
  input: { workspaceId: number; memberPublicId: string },
) {
  const [member] = await tx
    .select({
      id: workspaceMembers.id,
      publicId: workspaceMembers.publicId,
      userId: workspaceMembers.userId,
    })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.publicId, input.memberPublicId),
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(workspaceMembers.status, "active"),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .limit(1)
    .for("update");

  return member ?? null;
}

export function deriveSubtaskLifecycle(input: {
  currentStatus: CardPipelineStageStatus | null;
  destinationStatus: CardPipelineStageStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  movedAt: Date;
}) {
  let startedAt = input.startedAt;
  let completedAt = input.completedAt;

  if (input.destinationStatus === "inProgress" && startedAt === null) {
    startedAt = input.movedAt;
  }

  if (input.destinationStatus === "done" && input.currentStatus !== "done") {
    completedAt = input.movedAt;
  } else if (
    input.currentStatus === "done" &&
    input.destinationStatus !== "done"
  ) {
    completedAt = null;
  }

  return { startedAt, completedAt };
}
