import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lte,
  ne,
  notInArray,
  or,
} from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardPipelineStages,
  cards,
  cardSubtasks,
  lists,
  notifications,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { NotificationSyncHooks } from "./notification-sync.internal";
import { subtaskDueNotificationTypes } from "./notification-alert.repo";
import { lockActiveNotificationCardIds } from "./notification-sync.internal";

const subtaskDueDedupeKey = (
  type: (typeof subtaskDueNotificationTypes)[number],
  userId: string,
  subtaskPublicId: string,
  dueDate: Date,
) => [type, userId, subtaskPublicId, dueDate.toISOString()].join(":");

export const syncSubtaskDueAlerts = async (
  db: dbClient,
  args: { userId: string; now?: Date },
  hooks?: NotificationSyncHooks,
) => {
  const now = args.now ?? new Date();
  const dueSoonLimit = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    const scannedCandidates = await tx
      .select({ cardId: cards.id })
      .from(cardSubtasks)
      .innerJoin(
        cardPipelineStages,
        eq(cardSubtasks.stageId, cardPipelineStages.id),
      )
      .innerJoin(cards, eq(cardSubtasks.cardId, cards.id))
      .innerJoin(lists, eq(cards.listId, lists.id))
      .innerJoin(boards, eq(lists.boardId, boards.id))
      .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
      .innerJoin(
        workspaceMembers,
        eq(cardSubtasks.ownerWorkspaceMemberId, workspaceMembers.id),
      )
      .where(
        and(
          eq(workspaceMembers.userId, args.userId),
          eq(workspaceMembers.workspaceId, boards.workspaceId),
          eq(workspaceMembers.status, "active"),
          isNull(workspaceMembers.deletedAt),
          isNull(workspaces.deletedAt),
          isNull(cardSubtasks.deletedAt),
          isNull(cardSubtasks.completedAt),
          ne(cardPipelineStages.status, "done"),
          lte(cardSubtasks.dueDate, dueSoonLimit),
          isNull(cards.deletedAt),
          isNull(cards.completedAt),
          isNull(lists.deletedAt),
          or(isNull(lists.status), ne(lists.status, "done")),
          isNull(boards.deletedAt),
          eq(boards.isArchived, false),
        ),
      )
      .orderBy(asc(cards.id));

    await hooks?.afterCandidateScan?.(tx);
    const activeCardIds = await lockActiveNotificationCardIds(tx, [
      ...new Set(scannedCandidates.map((candidate) => candidate.cardId)),
    ]);
    const candidates =
      activeCardIds.length === 0
        ? []
        : await tx
            .select({
              subtaskId: cardSubtasks.id,
              subtaskPublicId: cardSubtasks.publicId,
              cardId: cards.id,
              dueDate: cardSubtasks.dueDate,
              workspaceId: boards.workspaceId,
            })
            .from(cardSubtasks)
            .innerJoin(
              cardPipelineStages,
              eq(cardSubtasks.stageId, cardPipelineStages.id),
            )
            .innerJoin(cards, eq(cardSubtasks.cardId, cards.id))
            .innerJoin(lists, eq(cards.listId, lists.id))
            .innerJoin(boards, eq(lists.boardId, boards.id))
            .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
            .innerJoin(
              workspaceMembers,
              eq(cardSubtasks.ownerWorkspaceMemberId, workspaceMembers.id),
            )
            .where(
              and(
                eq(workspaceMembers.userId, args.userId),
                eq(workspaceMembers.workspaceId, boards.workspaceId),
                eq(workspaceMembers.status, "active"),
                isNull(workspaceMembers.deletedAt),
                isNull(workspaces.deletedAt),
                inArray(cards.id, activeCardIds),
                isNull(cardSubtasks.deletedAt),
                isNull(cardSubtasks.completedAt),
                ne(cardPipelineStages.status, "done"),
                lte(cardSubtasks.dueDate, dueSoonLimit),
                isNull(cards.deletedAt),
                isNull(cards.completedAt),
                isNull(lists.deletedAt),
                or(isNull(lists.status), ne(lists.status, "done")),
                isNull(boards.deletedAt),
                eq(boards.isArchived, false),
              ),
            )
            .orderBy(asc(cardSubtasks.id))
            .for("update", { of: cardSubtasks });

    const retainedKeys: string[] = [];
    const alertsToCreate: {
      type: "subtask.due.soon" | "subtask.due.overdue";
      userId: string;
      cardId: number;
      subtaskId: number;
      workspaceId: number;
      metadata: string;
      dedupeKey: string;
    }[] = [];

    for (const candidate of candidates) {
      if (!candidate.dueDate) continue;
      const type =
        candidate.dueDate <= now
          ? ("subtask.due.overdue" as const)
          : ("subtask.due.soon" as const);
      const dedupeKey = subtaskDueDedupeKey(
        type,
        args.userId,
        candidate.subtaskPublicId,
        candidate.dueDate,
      );
      if (type === "subtask.due.overdue") {
        retainedKeys.push(
          subtaskDueDedupeKey(
            "subtask.due.soon",
            args.userId,
            candidate.subtaskPublicId,
            candidate.dueDate,
          ),
        );
      }
      retainedKeys.push(dedupeKey);
      alertsToCreate.push({
        type,
        userId: args.userId,
        cardId: candidate.cardId,
        subtaskId: candidate.subtaskId,
        workspaceId: candidate.workspaceId,
        metadata: JSON.stringify({ dueDate: candidate.dueDate.toISOString() }),
        dedupeKey,
      });
    }

    const obsoleteCondition =
      retainedKeys.length === 0
        ? undefined
        : or(
            isNull(notifications.dedupeKey),
            notInArray(notifications.dedupeKey, retainedKeys),
          );
    const invalidatedAlerts = await tx
      .update(notifications)
      .set({ deletedAt: now, dedupeKey: null })
      .where(
        and(
          eq(notifications.userId, args.userId),
          inArray(notifications.type, subtaskDueNotificationTypes),
          isNull(notifications.deletedAt),
          obsoleteCondition,
        ),
      )
      .returning({ id: notifications.id });
    const createdAlerts =
      alertsToCreate.length === 0
        ? []
        : await tx
            .insert(notifications)
            .values(
              alertsToCreate.map((alert) => ({
                publicId: generateUID(),
                ...alert,
              })),
            )
            .onConflictDoNothing({ target: notifications.dedupeKey })
            .returning({ id: notifications.id });

    return {
      created: createdAlerts.length,
      invalidated: invalidatedAlerts.length,
    };
  });
};
