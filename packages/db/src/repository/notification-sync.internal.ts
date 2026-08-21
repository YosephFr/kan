import type { DbTransaction } from "./cardPipeline.internal";
import { lockPipelineCardsByIds } from "./cardPipeline.internal";

export interface NotificationSyncHooks {
  afterCandidateScan?: (tx: DbTransaction) => Promise<void>;
}

export async function lockActiveNotificationCardIds(
  tx: DbTransaction,
  cardIds: number[],
) {
  const lockedCards = await lockPipelineCardsByIds(tx, cardIds);

  return lockedCards.flatMap((card) =>
    card.completedAt === null &&
    card.listStatus !== "done" &&
    !card.boardArchived
      ? [card.id]
      : [],
  );
}
