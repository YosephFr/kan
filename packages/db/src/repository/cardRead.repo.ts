import { and, eq, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { cards } from "@kan/db/schema";

import { getWithListAndMembersByPublicId } from "./card.repo";
import { getSummaryByCardId } from "./cardPipeline.repo";
import { getSummaryByCardId as getResourceSummaryByCardId } from "./cardResource.repo";
import {
  lockCardsInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

export const getDetailSnapshot = async (
  db: dbClient,
  args: {
    cardPublicId: string;
    expectedWorkspaceId: number;
    requirePublic: boolean;
  },
) =>
  db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(
        and(eq(cards.publicId, args.cardPublicId), isNull(cards.deletedAt)),
      )
      .limit(1);
    if (!candidate) throw new WorkspaceChangedError();
    const [lockedCard] = await lockCardsInWorkspace(
      tx,
      [candidate.id],
      args.expectedWorkspaceId,
      { cardLock: "share", requirePublic: args.requirePublic },
    );
    if (!lockedCard || lockedCard.publicId !== args.cardPublicId) {
      throw new WorkspaceChangedError();
    }

    const card = await getWithListAndMembersByPublicId(tx, args.cardPublicId);
    if (!card) throw new WorkspaceChangedError();
    const [subtaskSummary, resourceSummary] = await Promise.all([
      getSummaryByCardId(tx, lockedCard.id),
      getResourceSummaryByCardId(tx, lockedCard.id),
    ]);
    return { card, subtaskSummary, resourceSummary };
  });
