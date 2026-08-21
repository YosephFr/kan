import type { ActivityType, CardPriority } from "@kan/db/schema";
import { cardActivities } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { WorkspaceBoundaryTransaction } from "./workspace-boundary";

export interface CardMutationActivityInput {
  type: ActivityType;
  createdBy: string;
  fromIndex?: number;
  toIndex?: number;
  fromListId?: number;
  toListId?: number;
  labelId?: number;
  workspaceMemberId?: number;
  fromTitle?: string;
  toTitle?: string;
  fromDescription?: string;
  toDescription?: string;
  fromDueDate?: Date;
  toDueDate?: Date;
  fromPriority?: CardPriority;
  toPriority?: CardPriority;
  fromColourCode?: string;
  toColourCode?: string;
}

export const insertCardMutationActivitiesTx = async (
  tx: WorkspaceBoundaryTransaction,
  cardId: number,
  activities: CardMutationActivityInput[] | undefined,
) => {
  if (!activities?.length) return;
  await tx.insert(cardActivities).values(
    activities.map((activity) => ({
      ...activity,
      publicId: generateUID(),
      cardId,
    })),
  );
};
