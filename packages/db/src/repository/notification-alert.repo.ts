import { and, eq, inArray, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import { cards, lists, notifications, workspaceMembers } from "@kan/db/schema";

export const dueNotificationTypes = [
  "card.due.soon",
  "card.due.overdue",
] as const;

const cardAlertTypes = [
  "card.priority.urgent",
  ...dueNotificationTypes,
] as const;

export const invalidateDueAlertsForCard = async (
  db: dbClient,
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
  db: dbClient,
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
  db: dbClient,
  args: { cardId: number; userId?: string; invalidatedAt?: Date },
) => {
  const results = await db
    .update(notifications)
    .set({ deletedAt: args.invalidatedAt ?? new Date(), dedupeKey: null })
    .where(
      and(
        eq(notifications.cardId, args.cardId),
        inArray(notifications.type, cardAlertTypes),
        isNull(notifications.deletedAt),
        args.userId ? eq(notifications.userId, args.userId) : undefined,
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};

export const invalidateCardAlertsForWorkspaceMember = async (
  db: dbClient,
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

  return invalidateCardAlerts(db, {
    cardId: args.cardId,
    userId: member.userId,
    invalidatedAt: args.invalidatedAt,
  });
};

export const invalidateCardAlertsForList = async (
  db: dbClient,
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
        inArray(notifications.type, cardAlertTypes),
        isNull(notifications.deletedAt),
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};

export const invalidateCardAlertsForBoard = async (
  db: dbClient,
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
        inArray(notifications.type, cardAlertTypes),
        isNull(notifications.deletedAt),
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};
