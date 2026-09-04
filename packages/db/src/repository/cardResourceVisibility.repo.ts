import { and, count, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

import {
  cardAttachments,
  cardResources,
  cardVisualWalls,
} from "@kan/db/schema";

import type { DbTransaction } from "./cardPipeline.internal";

export const PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED =
  "PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED";

export class PublicVisibilityAcknowledgementError extends Error {
  constructor() {
    super(PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED);
    this.name = "PublicVisibilityAcknowledgementError";
  }
}

export async function assertActiveResourcesAcknowledged(
  tx: DbTransaction,
  cardIds: number[],
  publicVisibilityAcknowledged: boolean,
) {
  if (publicVisibilityAcknowledged || cardIds.length === 0) return;

  const [result] = await tx
    .select({ count: count() })
    .from(cardResources)
    .leftJoin(
      cardAttachments,
      eq(cardResources.attachmentId, cardAttachments.id),
    )
    .where(
      and(
        inArray(cardResources.cardId, cardIds),
        isNull(cardResources.deletedAt),
        or(
          eq(cardResources.kind, "drive"),
          eq(cardResources.kind, "web"),
          and(
            eq(cardResources.kind, "upload"),
            isNull(cardAttachments.deletedAt),
            isNull(cardAttachments.storageQuarantinedAt),
          ),
        ),
      ),
    );

  if ((result?.count ?? 0) > 0) {
    throw new PublicVisibilityAcknowledgementError();
  }

  const [wall] = await tx
    .select({ id: cardVisualWalls.id })
    .from(cardVisualWalls)
    .where(
      and(
        inArray(cardVisualWalls.cardId, cardIds),
        isNotNull(cardVisualWalls.freeformUrl),
      ),
    )
    .limit(1);
  if (wall) throw new PublicVisibilityAcknowledgementError();
}
