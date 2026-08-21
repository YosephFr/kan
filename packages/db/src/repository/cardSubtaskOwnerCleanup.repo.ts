import { and, eq, inArray, isNotNull, ne, or } from "drizzle-orm";

import {
  boards,
  cardActivities,
  cards,
  cardSubtasks,
  lists,
  workspaceMembers,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { DbTransaction } from "./cardPipeline.internal";

export const clearInvalidOwnersForCardIdsTx = async (
  tx: DbTransaction,
  input: { cardIds: number[]; updatedBy: string },
) => {
  const cardIds = [...new Set(input.cardIds)];
  if (cardIds.length === 0) return [];

  const invalidOwners = await tx
    .select({
      id: cardSubtasks.id,
      publicId: cardSubtasks.publicId,
      cardId: cardSubtasks.cardId,
    })
    .from(cardSubtasks)
    .innerJoin(cards, eq(cardSubtasks.cardId, cards.id))
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .innerJoin(
      workspaceMembers,
      eq(cardSubtasks.ownerWorkspaceMemberId, workspaceMembers.id),
    )
    .where(
      and(
        inArray(cardSubtasks.cardId, cardIds),
        isNotNull(cardSubtasks.ownerWorkspaceMemberId),
        or(
          ne(workspaceMembers.workspaceId, boards.workspaceId),
          ne(workspaceMembers.status, "active"),
          isNotNull(workspaceMembers.deletedAt),
        ),
      ),
    );
  if (invalidOwners.length === 0) return [];

  await tx
    .update(cardSubtasks)
    .set({ ownerWorkspaceMemberId: null, updatedAt: new Date() })
    .where(
      inArray(
        cardSubtasks.id,
        invalidOwners.map((row) => row.id),
      ),
    );
  await tx.insert(cardActivities).values(
    invalidOwners.map((subtask) => ({
      publicId: generateUID(),
      type: "card.updated.subtask.updated" as const,
      cardId: subtask.cardId,
      subtaskPublicId: subtask.publicId,
      createdBy: input.updatedBy,
    })),
  );

  return invalidOwners.map((subtask) => subtask.publicId);
};
