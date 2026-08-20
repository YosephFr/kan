import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { dbClient } from "@kan/db/client";
import type { NotificationType } from "@kan/db/schema";
import {
  boards,
  cardActivities,
  cards,
  cardToWorkspaceMembers,
  lists,
  notifications,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import { dueNotificationTypes } from "./notification-alert.repo";

export {
  invalidateCardAlerts,
  invalidateCardAlertsForBoard,
  invalidateCardAlertsForList,
  invalidateCardAlertsForWorkspaceMember,
  invalidateDueAlertsForCard,
  invalidateUrgentAlertsForCard,
} from "./notification-alert.repo";

const urgentDedupeKey = (userId: string, cardPublicId: string) =>
  ["card.priority.urgent", userId, cardPublicId].join(":");

const dueDedupeKey = (
  type: (typeof dueNotificationTypes)[number],
  userId: string,
  cardPublicId: string,
  dueDate: Date,
) => [type, userId, cardPublicId, dueDate.toISOString()].join(":");

export interface NotificationCursor {
  publicId: string;
}

export interface NotificationListItem {
  publicId: string;
  type: NotificationType;
  createdAt: Date;
  readAt: Date | null;
  card: {
    publicId: string;
    title: string;
    boardName: string;
    workspacePublicId: string;
  } | null;
}

interface NotificationInsert {
  type: NotificationType;
  userId: string;
  cardId?: number;
  commentId?: number;
  workspaceId?: number;
  metadata?: string;
  dedupeKey?: string;
}

export const create = async (
  db: dbClient,
  notificationInput: NotificationInsert,
) => {
  const values = {
    publicId: generateUID(),
    type: notificationInput.type,
    userId: notificationInput.userId,
    cardId: notificationInput.cardId,
    commentId: notificationInput.commentId,
    workspaceId: notificationInput.workspaceId,
    metadata: notificationInput.metadata,
    dedupeKey: notificationInput.dedupeKey,
  };

  if (notificationInput.dedupeKey) {
    const [result] = await db
      .insert(notifications)
      .values(values)
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning();

    return result;
  }

  const [result] = await db.insert(notifications).values(values).returning();

  return result;
};

export const exists = async (
  db: dbClient,
  args: {
    userId: string;
    type: NotificationType;
    cardId?: number;
    workspaceId?: number;
    commentId?: number;
  },
) => {
  const result = await db.query.notifications.findFirst({
    where: (notification, { eq: equals, and: all, isNull: isNullFn }) => {
      const conditions = [
        equals(notification.userId, args.userId),
        equals(notification.type, args.type),
        isNullFn(notification.deletedAt),
      ];

      if (args.cardId) {
        conditions.push(equals(notification.cardId, args.cardId));
      }

      if (args.workspaceId) {
        conditions.push(equals(notification.workspaceId, args.workspaceId));
      }

      if (args.commentId) {
        conditions.push(equals(notification.commentId, args.commentId));
      }

      return all(...conditions);
    },
  });

  return !!result;
};

export const list = async (
  db: dbClient,
  args: {
    userId: string;
    limit: number;
    cursor?: NotificationCursor;
  },
) => {
  const cursorNotification = alias(notifications, "notification_cursor");
  const cursorCondition = args.cursor
    ? and(
        isNotNull(cursorNotification.id),
        or(
          lt(notifications.createdAt, cursorNotification.createdAt),
          and(
            eq(notifications.createdAt, cursorNotification.createdAt),
            lt(notifications.publicId, cursorNotification.publicId),
          ),
        ),
      )
    : undefined;

  const rows = await db
    .select({
      publicId: notifications.publicId,
      type: notifications.type,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      cardPublicId: cards.publicId,
      cardTitle: cards.title,
      cardDeletedAt: cards.deletedAt,
      listDeletedAt: lists.deletedAt,
      boardName: boards.name,
      boardDeletedAt: boards.deletedAt,
      boardArchived: boards.isArchived,
      workspacePublicId: workspaces.publicId,
      workspaceDeletedAt: workspaces.deletedAt,
      hasWorkspaceAccess: sql<boolean>`exists (
        select 1
        from "workspace_members" access_member
        where access_member."workspaceId" = ${workspaces.id}
          and access_member."userId" = ${args.userId}
          and access_member."status" = 'active'
          and access_member."deletedAt" is null
      )`,
    })
    .from(notifications)
    .leftJoin(
      cursorNotification,
      args.cursor
        ? and(
            eq(cursorNotification.publicId, args.cursor.publicId),
            eq(cursorNotification.userId, args.userId),
          )
        : sql`false`,
    )
    .leftJoin(cards, eq(notifications.cardId, cards.id))
    .leftJoin(lists, eq(cards.listId, lists.id))
    .leftJoin(boards, eq(lists.boardId, boards.id))
    .leftJoin(workspaces, eq(boards.workspaceId, workspaces.id))
    .where(
      and(
        eq(notifications.userId, args.userId),
        isNull(notifications.deletedAt),
        cursorCondition,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.publicId))
    .limit(args.limit + 1);

  const hasMore = rows.length > args.limit;
  const pageRows = rows.slice(0, args.limit);
  const items: NotificationListItem[] = pageRows.map((row) => {
    let card: NotificationListItem["card"] = null;

    if (
      row.cardPublicId !== null &&
      row.cardTitle !== null &&
      row.boardName !== null &&
      row.workspacePublicId !== null &&
      row.hasWorkspaceAccess &&
      row.cardDeletedAt === null &&
      row.listDeletedAt === null &&
      row.boardDeletedAt === null &&
      row.workspaceDeletedAt === null &&
      row.boardArchived === false
    ) {
      card = {
        publicId: row.cardPublicId,
        title: row.cardTitle,
        boardName: row.boardName,
        workspacePublicId: row.workspacePublicId,
      };
    }

    return {
      publicId: row.publicId,
      type: row.type,
      createdAt: row.createdAt,
      readAt: row.readAt,
      card,
    };
  });
  const lastItem = hasMore ? pageRows.at(-1) : undefined;

  return {
    items,
    nextCursor: lastItem ? { publicId: lastItem.publicId } : null,
  };
};

export const markAsRead = async (
  db: dbClient,
  args: { notificationPublicId: string; userId: string },
) => {
  const [result] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.publicId, args.notificationPublicId),
        eq(notifications.userId, args.userId),
        isNull(notifications.deletedAt),
      ),
    )
    .returning({
      publicId: notifications.publicId,
      readAt: notifications.readAt,
    });

  return result ?? null;
};

export const markAllAsRead = async (db: dbClient, userId: string) => {
  const results = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.deletedAt),
      ),
    )
    .returning({ id: notifications.id });

  return results.length;
};

export const getUnreadCount = async (db: dbClient, userId: string) => {
  const result = await db
    .select({ count: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.deletedAt),
      ),
    );

  return result[0]?.count ?? 0;
};

export const syncDueAlerts = async (
  db: dbClient,
  args: { userId: string; now?: Date },
) => {
  const now = args.now ?? new Date();
  const dueSoonLimit = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return db.transaction(async (tx) => {
    const dueCandidates = await tx
      .select({
        cardId: cards.id,
        cardPublicId: cards.publicId,
        dueDate: cards.dueDate,
        workspaceId: boards.workspaceId,
      })
      .from(cardToWorkspaceMembers)
      .innerJoin(
        workspaceMembers,
        eq(cardToWorkspaceMembers.workspaceMemberId, workspaceMembers.id),
      )
      .innerJoin(cards, eq(cardToWorkspaceMembers.cardId, cards.id))
      .innerJoin(lists, eq(cards.listId, lists.id))
      .innerJoin(boards, eq(lists.boardId, boards.id))
      .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaceMembers.userId, args.userId),
          eq(workspaceMembers.workspaceId, boards.workspaceId),
          eq(workspaceMembers.status, "active"),
          isNull(workspaceMembers.deletedAt),
          isNull(workspaces.deletedAt),
          isNull(cards.deletedAt),
          isNull(cards.completedAt),
          isNull(lists.deletedAt),
          or(isNull(lists.status), ne(lists.status, "done")),
          isNull(boards.deletedAt),
          eq(boards.isArchived, false),
          lte(cards.dueDate, dueSoonLimit),
        ),
      )
      .orderBy(asc(cards.id))
      .for("update", { of: cards });
    const urgentCandidates = await tx
      .select({
        cardId: cards.id,
        cardPublicId: cards.publicId,
        workspaceId: boards.workspaceId,
        createdBy: cards.createdBy,
        workspaceMemberId: workspaceMembers.id,
      })
      .from(cardToWorkspaceMembers)
      .innerJoin(
        workspaceMembers,
        eq(cardToWorkspaceMembers.workspaceMemberId, workspaceMembers.id),
      )
      .innerJoin(cards, eq(cardToWorkspaceMembers.cardId, cards.id))
      .innerJoin(lists, eq(cards.listId, lists.id))
      .innerJoin(boards, eq(lists.boardId, boards.id))
      .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaceMembers.userId, args.userId),
          eq(workspaceMembers.workspaceId, boards.workspaceId),
          eq(workspaceMembers.status, "active"),
          isNull(workspaceMembers.deletedAt),
          isNull(workspaces.deletedAt),
          eq(cards.priority, "urgent"),
          isNull(cards.deletedAt),
          isNull(cards.completedAt),
          isNull(lists.deletedAt),
          or(isNull(lists.status), ne(lists.status, "done")),
          isNull(boards.deletedAt),
          eq(boards.isArchived, false),
        ),
      )
      .orderBy(asc(cards.id))
      .for("update", { of: cards });
    const urgentCardIds = urgentCandidates.map((candidate) => candidate.cardId);
    const urgentActivities =
      urgentCardIds.length === 0
        ? []
        : await tx
            .select({
              cardId: cardActivities.cardId,
              createdBy: cardActivities.createdBy,
              createdAt: cardActivities.createdAt,
              id: cardActivities.id,
            })
            .from(cardActivities)
            .where(
              and(
                inArray(cardActivities.cardId, urgentCardIds),
                eq(cardActivities.type, "card.updated.priority"),
                eq(cardActivities.toPriority, "urgent"),
              ),
            )
            .orderBy(desc(cardActivities.createdAt), desc(cardActivities.id));
    const urgentTransitionByCardId = new Map<
      number,
      { createdBy: string | null; createdAt: Date; id: number }
    >();

    for (const activity of urgentActivities) {
      if (!urgentTransitionByCardId.has(activity.cardId)) {
        urgentTransitionByCardId.set(activity.cardId, {
          createdBy: activity.createdBy,
          createdAt: activity.createdAt,
          id: activity.id,
        });
      }
    }

    const urgentMemberIds = urgentCandidates.map(
      (candidate) => candidate.workspaceMemberId,
    );
    const assignmentActivities =
      urgentCardIds.length === 0 || urgentMemberIds.length === 0
        ? []
        : await tx
            .select({
              cardId: cardActivities.cardId,
              workspaceMemberId: cardActivities.workspaceMemberId,
              createdAt: cardActivities.createdAt,
              id: cardActivities.id,
            })
            .from(cardActivities)
            .where(
              and(
                inArray(cardActivities.cardId, urgentCardIds),
                inArray(cardActivities.workspaceMemberId, urgentMemberIds),
                eq(cardActivities.type, "card.updated.member.added"),
              ),
            )
            .orderBy(desc(cardActivities.createdAt), desc(cardActivities.id));
    const latestAssignmentByCardMember = new Map<
      string,
      { createdAt: Date; id: number }
    >();

    for (const activity of assignmentActivities) {
      if (!activity.workspaceMemberId) continue;

      const key = `${activity.cardId}:${activity.workspaceMemberId}`;
      if (!latestAssignmentByCardMember.has(key)) {
        latestAssignmentByCardMember.set(key, {
          createdAt: activity.createdAt,
          id: activity.id,
        });
      }
    }

    const alertsToCreate: (NotificationInsert & { dedupeKey: string })[] = [];
    const retainedDueKeys: string[] = [];

    for (const candidate of dueCandidates) {
      if (!candidate.dueDate) continue;

      const metadata = JSON.stringify({
        dueDate: candidate.dueDate.toISOString(),
      });
      const soonKey = dueDedupeKey(
        "card.due.soon",
        args.userId,
        candidate.cardPublicId,
        candidate.dueDate,
      );

      retainedDueKeys.push(soonKey);

      if (candidate.dueDate <= now) {
        const overdueKey = dueDedupeKey(
          "card.due.overdue",
          args.userId,
          candidate.cardPublicId,
          candidate.dueDate,
        );

        retainedDueKeys.push(overdueKey);
        alertsToCreate.push({
          type: "card.due.overdue",
          userId: args.userId,
          cardId: candidate.cardId,
          workspaceId: candidate.workspaceId,
          metadata,
          dedupeKey: overdueKey,
        });
      } else {
        alertsToCreate.push({
          type: "card.due.soon",
          userId: args.userId,
          cardId: candidate.cardId,
          workspaceId: candidate.workspaceId,
          metadata,
          dedupeKey: soonKey,
        });
      }
    }

    const retainedUrgentKeys: string[] = [];

    for (const candidate of urgentCandidates) {
      const transition = urgentTransitionByCardId.get(candidate.cardId);
      const actorUserId = transition?.createdBy ?? candidate.createdBy;
      const assignment = latestAssignmentByCardMember.get(
        `${candidate.cardId}:${candidate.workspaceMemberId}`,
      );
      const assignedAfterTransition =
        transition !== undefined &&
        assignment !== undefined &&
        (assignment.createdAt > transition.createdAt ||
          (assignment.createdAt.getTime() === transition.createdAt.getTime() &&
            assignment.id > transition.id));
      const dedupeKey = urgentDedupeKey(args.userId, candidate.cardPublicId);

      retainedUrgentKeys.push(dedupeKey);

      if (actorUserId === args.userId && !assignedAfterTransition) continue;
      alertsToCreate.push({
        type: "card.priority.urgent",
        userId: args.userId,
        cardId: candidate.cardId,
        workspaceId: candidate.workspaceId,
        dedupeKey,
      });
    }

    const obsoleteDueCondition =
      retainedDueKeys.length === 0
        ? undefined
        : or(
            isNull(notifications.dedupeKey),
            notInArray(notifications.dedupeKey, retainedDueKeys),
          );
    const obsoleteUrgentCondition =
      retainedUrgentKeys.length === 0
        ? undefined
        : or(
            isNull(notifications.dedupeKey),
            notInArray(notifications.dedupeKey, retainedUrgentKeys),
          );
    const invalidatedDueAlerts = await tx
      .update(notifications)
      .set({ deletedAt: now, dedupeKey: null })
      .where(
        and(
          eq(notifications.userId, args.userId),
          inArray(notifications.type, dueNotificationTypes),
          isNull(notifications.deletedAt),
          obsoleteDueCondition,
        ),
      )
      .returning({ id: notifications.id });
    const invalidatedUrgentAlerts = await tx
      .update(notifications)
      .set({ deletedAt: now, dedupeKey: null })
      .where(
        and(
          eq(notifications.userId, args.userId),
          eq(notifications.type, "card.priority.urgent"),
          isNull(notifications.deletedAt),
          obsoleteUrgentCondition,
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
      invalidated: invalidatedDueAlerts.length + invalidatedUrgentAlerts.length,
    };
  });
};

export const createUrgentAlertsForAssignees = async (
  db: dbClient,
  args: { cardId: number; actorUserId: string },
) => {
  return db.transaction(async (tx) => {
    const recipients = await tx
      .select({
        userId: workspaceMembers.userId,
        workspaceId: boards.workspaceId,
        cardPublicId: cards.publicId,
      })
      .from(cardToWorkspaceMembers)
      .innerJoin(
        workspaceMembers,
        eq(cardToWorkspaceMembers.workspaceMemberId, workspaceMembers.id),
      )
      .innerJoin(cards, eq(cardToWorkspaceMembers.cardId, cards.id))
      .innerJoin(lists, eq(cards.listId, lists.id))
      .innerJoin(boards, eq(lists.boardId, boards.id))
      .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
      .where(
        and(
          eq(cards.id, args.cardId),
          eq(cards.priority, "urgent"),
          isNull(cards.deletedAt),
          isNull(cards.completedAt),
          isNull(lists.deletedAt),
          or(isNull(lists.status), ne(lists.status, "done")),
          isNull(boards.deletedAt),
          eq(boards.isArchived, false),
          isNull(workspaces.deletedAt),
          eq(workspaceMembers.workspaceId, boards.workspaceId),
          eq(workspaceMembers.status, "active"),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .for("update", { of: cards });
    const notificationsToCreate = recipients.flatMap((recipient) => {
      if (!recipient.userId || recipient.userId === args.actorUserId) return [];

      return [
        {
          type: "card.priority.urgent" as const,
          userId: recipient.userId,
          cardId: args.cardId,
          workspaceId: recipient.workspaceId,
          dedupeKey: urgentDedupeKey(recipient.userId, recipient.cardPublicId),
        },
      ];
    });

    if (notificationsToCreate.length === 0) return 0;

    const createdAlerts = await tx
      .insert(notifications)
      .values(
        notificationsToCreate.map((alert) => ({
          publicId: generateUID(),
          ...alert,
        })),
      )
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning({ id: notifications.id });

    return createdAlerts.length;
  });
};

export const createUrgentAlertForAssignedMember = async (
  db: dbClient,
  args: {
    cardId: number;
    workspaceMemberId: number;
  },
) => {
  return db.transaction(async (tx) => {
    const [recipient] = await tx
      .select({
        userId: workspaceMembers.userId,
        workspaceId: boards.workspaceId,
        cardPublicId: cards.publicId,
      })
      .from(cardToWorkspaceMembers)
      .innerJoin(
        workspaceMembers,
        eq(cardToWorkspaceMembers.workspaceMemberId, workspaceMembers.id),
      )
      .innerJoin(cards, eq(cardToWorkspaceMembers.cardId, cards.id))
      .innerJoin(lists, eq(cards.listId, lists.id))
      .innerJoin(boards, eq(lists.boardId, boards.id))
      .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
      .where(
        and(
          eq(cardToWorkspaceMembers.cardId, args.cardId),
          eq(cardToWorkspaceMembers.workspaceMemberId, args.workspaceMemberId),
          eq(cards.priority, "urgent"),
          isNull(cards.deletedAt),
          isNull(cards.completedAt),
          isNull(lists.deletedAt),
          or(isNull(lists.status), ne(lists.status, "done")),
          isNull(boards.deletedAt),
          eq(boards.isArchived, false),
          isNull(workspaces.deletedAt),
          eq(workspaceMembers.workspaceId, boards.workspaceId),
          eq(workspaceMembers.status, "active"),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .limit(1)
      .for("update", { of: cards });

    if (!recipient?.userId) return 0;

    const [createdAlert] = await tx
      .insert(notifications)
      .values({
        publicId: generateUID(),
        type: "card.priority.urgent",
        userId: recipient.userId,
        cardId: args.cardId,
        workspaceId: recipient.workspaceId,
        dedupeKey: urgentDedupeKey(recipient.userId, recipient.cardPublicId),
      })
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning({ id: notifications.id });

    return createdAlert ? 1 : 0;
  });
};
