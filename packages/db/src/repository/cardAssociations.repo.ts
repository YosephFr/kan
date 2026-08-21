import { and, eq, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  cardActivities,
  cardsToLabels,
  cardToWorkspaceMembers,
  labels,
  workspaceMembers,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import { invalidateCardAlertsForWorkspaceMember } from "./notification-alert.repo";
import {
  lockCardsInWorkspace,
  WorkspaceChangedError,
} from "./workspace-boundary";

export const toggleCardLabel = async (
  db: dbClient,
  input: {
    cardId: number;
    labelId: number;
    expectedWorkspaceId: number;
    updatedBy: string;
  },
) =>
  db.transaction(async (tx) => {
    const [card] = await lockCardsInWorkspace(
      tx,
      [input.cardId],
      input.expectedWorkspaceId,
    );
    if (!card) throw new WorkspaceChangedError();
    const [label] = await tx
      .select({ id: labels.id })
      .from(labels)
      .where(
        and(
          eq(labels.id, input.labelId),
          eq(labels.boardId, card.boardId),
          isNull(labels.deletedAt),
        ),
      )
      .limit(1)
      .for("share");
    if (!label) throw new WorkspaceChangedError();

    const [existing] = await tx
      .select({ cardId: cardsToLabels.cardId })
      .from(cardsToLabels)
      .where(
        and(
          eq(cardsToLabels.cardId, card.id),
          eq(cardsToLabels.labelId, label.id),
        ),
      )
      .limit(1);
    const newLabel = !existing;
    if (existing) {
      await tx
        .delete(cardsToLabels)
        .where(
          and(
            eq(cardsToLabels.cardId, card.id),
            eq(cardsToLabels.labelId, label.id),
          ),
        );
    } else {
      await tx.insert(cardsToLabels).values({
        cardId: card.id,
        labelId: label.id,
      });
    }
    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: newLabel
        ? "card.updated.label.added"
        : "card.updated.label.removed",
      cardId: card.id,
      labelId: label.id,
      createdBy: input.updatedBy,
    });
    return { newLabel };
  });

export const toggleCardMember = async (
  db: dbClient,
  input: {
    cardId: number;
    workspaceMemberId: number;
    expectedWorkspaceId: number;
    updatedBy: string;
  },
) =>
  db.transaction(async (tx) => {
    const [card] = await lockCardsInWorkspace(
      tx,
      [input.cardId],
      input.expectedWorkspaceId,
    );
    if (!card) throw new WorkspaceChangedError();
    const [member] = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.id, input.workspaceMemberId),
          eq(workspaceMembers.workspaceId, input.expectedWorkspaceId),
          eq(workspaceMembers.status, "active"),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .limit(1)
      .for("share");
    if (!member) throw new WorkspaceChangedError();

    const [existing] = await tx
      .select({ cardId: cardToWorkspaceMembers.cardId })
      .from(cardToWorkspaceMembers)
      .where(
        and(
          eq(cardToWorkspaceMembers.cardId, card.id),
          eq(cardToWorkspaceMembers.workspaceMemberId, member.id),
        ),
      )
      .limit(1);
    const newMember = !existing;
    if (existing) {
      await tx
        .delete(cardToWorkspaceMembers)
        .where(
          and(
            eq(cardToWorkspaceMembers.cardId, card.id),
            eq(cardToWorkspaceMembers.workspaceMemberId, member.id),
          ),
        );
      await invalidateCardAlertsForWorkspaceMember(tx, {
        cardId: card.id,
        workspaceMemberId: member.id,
      });
    } else {
      await tx.insert(cardToWorkspaceMembers).values({
        cardId: card.id,
        workspaceMemberId: member.id,
      });
    }
    await tx.insert(cardActivities).values({
      publicId: generateUID(),
      type: newMember
        ? "card.updated.member.added"
        : "card.updated.member.removed",
      cardId: card.id,
      workspaceMemberId: member.id,
      createdBy: input.updatedBy,
    });
    return { newMember };
  });
