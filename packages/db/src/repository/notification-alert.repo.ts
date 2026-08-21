import { and, eq, inArray, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  cards,
  cardSubtasks,
  lists,
  notifications,
  workspaceMembers,
} from "@kan/db/schema";

import type { DbTransaction } from "./cardPipeline.internal";

type NotificationAlertDb = dbClient | DbTransaction;

export const dueNotificationTypes = [
  "card.due.soon",
  "card.due.overdue",
] as const;

const cardAlertTypes = [
  "card.priority.urgent",
  ...dueNotificationTypes,
] as const;

export const subtaskDueNotificationTypes = [
  "subtask.due.soon",
  "subtask.due.overdue",
] as const;

const subtaskAlertTypes = [
  "subtask.assigned",
  ...subtaskDueNotificationTypes,
] as const;

const allCardScopedAlertTypes = [
  ...cardAlertTypes,
  ...subtaskAlertTypes,
] as const;

export const invalidateSubtaskDueAlerts = async (
  db: NotificationAlertDb,
  args: { subtaskId: number; userId?: string; invalidatedAt?: Date },
) => {
  const results = await db
    .update(notifications)
    .set({ deletedAt: args.invalidatedAt ?? new Date(), dedupeKey: null })
    .where(
      and(
        eq(notifications.subtaskId, args.subtaskId),
        inArray(notifications.type, subtaskDueNotificationTypes),
        isNull(notifications.deletedAt),
        args.userId ? eq(notifications.userId, args.userId) : undefined,
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};

export const invalidateSubtaskDueAlertsForWorkspaceMember = async (
  db: NotificationAlertDb,
  args: {
    subtaskId: number;
    workspaceMemberId: number;
    invalidatedAt?: Date;
  },
) => {
  const [member] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.id, args.workspaceMemberId))
    .limit(1);

  if (!member?.userId) return 0;

  return invalidateSubtaskDueAlerts(db, {
    subtaskId: args.subtaskId,
    userId: member.userId,
    invalidatedAt: args.invalidatedAt,
  });
};

export const invalidateSubtaskAlerts = async (
  db: NotificationAlertDb,
  args: { subtaskId: number; userId?: string; invalidatedAt?: Date },
) => {
  const results = await db
    .update(notifications)
    .set({ deletedAt: args.invalidatedAt ?? new Date(), dedupeKey: null })
    .where(
      and(
        eq(notifications.subtaskId, args.subtaskId),
        inArray(notifications.type, subtaskAlertTypes),
        isNull(notifications.deletedAt),
        args.userId ? eq(notifications.userId, args.userId) : undefined,
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};

export const invalidateSubtaskAlertsForCard = async (
  db: NotificationAlertDb,
  args: { cardId: number; invalidatedAt?: Date },
) => {
  const subtaskRows = await db
    .select({ id: cardSubtasks.id })
    .from(cardSubtasks)
    .where(eq(cardSubtasks.cardId, args.cardId));
  const subtaskIds = subtaskRows.map((subtask) => subtask.id);
  if (subtaskIds.length === 0) return 0;

  const results = await db
    .update(notifications)
    .set({ deletedAt: args.invalidatedAt ?? new Date(), dedupeKey: null })
    .where(
      and(
        inArray(notifications.subtaskId, subtaskIds),
        inArray(notifications.type, subtaskAlertTypes),
        isNull(notifications.deletedAt),
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};

export const invalidateDueAlertsForCard = async (
  db: NotificationAlertDb,
  args: { cardId: number; userId?: string; invalidatedAt?: Date },
) => {
  const results = await db
    .update(notifications)
    .set({ deletedAt: args.invalidatedAt ?? new Date(), dedupeKey: null })
    .where(
      and(
        eq(notifications.cardId, args.cardId),
        inArray(notifications.type, dueNotificationTypes),
        isNull(notifications.deletedAt),
        args.userId ? eq(notifications.userId, args.userId) : undefined,
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};

export const invalidateUrgentAlertsForCard = async (
  db: NotificationAlertDb,
  args: { cardId: number; invalidatedAt?: Date },
) => {
  const results = await db
    .update(notifications)
    .set({ deletedAt: args.invalidatedAt ?? new Date(), dedupeKey: null })
    .where(
      and(
        eq(notifications.cardId, args.cardId),
        eq(notifications.type, "card.priority.urgent"),
        isNull(notifications.deletedAt),
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};

export const invalidateCardAlerts = async (
  db: NotificationAlertDb,
  args: { cardId: number; userId?: string; invalidatedAt?: Date },
) => {
  const results = await db
    .update(notifications)
    .set({ deletedAt: args.invalidatedAt ?? new Date(), dedupeKey: null })
    .where(
      and(
        eq(notifications.cardId, args.cardId),
        inArray(notifications.type, allCardScopedAlertTypes),
        isNull(notifications.deletedAt),
        args.userId ? eq(notifications.userId, args.userId) : undefined,
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};

export const invalidateCardAlertsForWorkspaceMember = async (
  db: NotificationAlertDb,
  args: {
    cardId: number;
    workspaceMemberId: number;
    invalidatedAt?: Date;
  },
) => {
  const [member] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.id, args.workspaceMemberId))
    .limit(1);

  if (!member?.userId) return 0;

  const results = await db
    .update(notifications)
    .set({ deletedAt: args.invalidatedAt ?? new Date(), dedupeKey: null })
    .where(
      and(
        eq(notifications.cardId, args.cardId),
        eq(notifications.userId, member.userId),
        inArray(notifications.type, cardAlertTypes),
        isNull(notifications.deletedAt),
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};

export const invalidateCardAlertsForList = async (
  db: NotificationAlertDb,
  args: { listId: number; invalidatedAt?: Date },
) => {
  const cardRows = await db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.listId, args.listId));
  const cardIds = cardRows.map((card) => card.id);

  if (cardIds.length === 0) return 0;

  const results = await db
    .update(notifications)
    .set({ deletedAt: args.invalidatedAt ?? new Date(), dedupeKey: null })
    .where(
      and(
        inArray(notifications.cardId, cardIds),
        inArray(notifications.type, allCardScopedAlertTypes),
        isNull(notifications.deletedAt),
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};

export const invalidateCardAlertsForBoard = async (
  db: NotificationAlertDb,
  args: { boardId: number; invalidatedAt?: Date },
) => {
  const cardRows = await db
    .select({ id: cards.id })
    .from(cards)
    .innerJoin(lists, eq(cards.listId, lists.id))
    .where(eq(lists.boardId, args.boardId));
  const cardIds = cardRows.map((card) => card.id);

  if (cardIds.length === 0) return 0;

  const results = await db
    .update(notifications)
    .set({ deletedAt: args.invalidatedAt ?? new Date(), dedupeKey: null })
    .where(
      and(
        inArray(notifications.cardId, cardIds),
        inArray(notifications.type, allCardScopedAlertTypes),
        isNull(notifications.deletedAt),
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};
