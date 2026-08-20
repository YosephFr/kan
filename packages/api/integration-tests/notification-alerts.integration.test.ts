import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as notificationRepo from "@kan/db/repository/notification.repo";
import {
  boards,
  cardActivities,
  cards,
  cardToWorkspaceMembers,
  lists,
  notifications,
  users,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { createTestDb } from "./test-db";

const now = new Date("2026-08-20T12:00:00.000Z");
const ownerId = "70c36a50-c047-4540-aa6d-c81d6ff2455d";
const assigneeId = "92aa7086-bd93-4777-b5af-6e35b0ec5cd8";

const requireValue = <T>(value: T | null | undefined, name: string): T => {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${name} to be created`);
  }

  return value;
};

const seedNotificationFixture = async (db: TestDbClient) => {
  await db.insert(users).values([
    {
      id: ownerId,
      name: "Owner",
      email: "owner-notifications@example.com",
      emailVerified: true,
    },
    {
      id: assigneeId,
      name: "Assignee",
      email: "assignee-notifications@example.com",
      emailVerified: true,
    },
  ]);
  const [workspaceResult] = await db
    .insert(workspaces)
    .values({
      publicId: "workspc00001",
      name: "Workspace",
      slug: "notification-workspace",
      createdBy: ownerId,
    })
    .returning();
  const workspace = requireValue(workspaceResult, "workspace");
  const [ownerMemberResult, assigneeMemberResult] = await db
    .insert(workspaceMembers)
    .values([
      {
        publicId: "member000001",
        email: "owner-notifications@example.com",
        userId: ownerId,
        workspaceId: workspace.id,
        createdBy: ownerId,
        role: "admin",
        status: "active",
      },
      {
        publicId: "member000002",
        email: "assignee-notifications@example.com",
        userId: assigneeId,
        workspaceId: workspace.id,
        createdBy: ownerId,
        role: "member",
        status: "active",
      },
    ])
    .returning();
  const ownerMember = requireValue(ownerMemberResult, "owner member");
  const assigneeMember = requireValue(assigneeMemberResult, "assignee member");
  const [boardResult] = await db
    .insert(boards)
    .values({
      publicId: "board0000001",
      name: "Gerencia",
      slug: "gerencia",
      workspaceId: workspace.id,
      createdBy: ownerId,
    })
    .returning();
  const board = requireValue(boardResult, "board");
  const [listResult] = await db
    .insert(lists)
    .values({
      publicId: "list00000001",
      name: "En progreso",
      status: "inProgress",
      index: 0,
      boardId: board.id,
      createdBy: ownerId,
    })
    .returning();
  const list = requireValue(listResult, "list");
  const [cardResult] = await db
    .insert(cards)
    .values({
      publicId: "card00000001",
      title: "Notification test",
      priority: "urgent",
      index: 0,
      listId: list.id,
      dueDate: new Date(now.getTime() + 60 * 60 * 1000),
      startedAt: now,
      createdBy: ownerId,
    })
    .returning();
  const card = requireValue(cardResult, "card");

  await db.insert(cardToWorkspaceMembers).values({
    cardId: card.id,
    workspaceMemberId: assigneeMember.id,
  });

  return {
    workspace,
    board,
    list,
    card,
    ownerMember,
    assigneeMember,
  };
};

describe("notification alert repository", () => {
  let db: TestDbClient;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("deduplicates concurrent due-soon synchronization", async () => {
    const fixture = await seedNotificationFixture(db);
    await db
      .update(cards)
      .set({ priority: "high" })
      .where(eq(cards.id, fixture.card.id));

    const [first, second] = await Promise.all([
      notificationRepo.syncDueAlerts(db, { userId: assigneeId, now }),
      notificationRepo.syncDueAlerts(db, { userId: assigneeId, now }),
    ]);
    const activeAlerts = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, assigneeId),
          isNull(notifications.deletedAt),
        ),
      );

    expect(first.created + second.created).toBe(1);
    expect(activeAlerts).toHaveLength(1);
    expect(activeAlerts[0]?.type).toBe("card.due.soon");
  });

  it("creates only overdue when opened after the due date", async () => {
    const fixture = await seedNotificationFixture(db);
    await db
      .update(cards)
      .set({
        dueDate: new Date(now.getTime() - 60 * 1000),
        priority: "high",
      })
      .where(eq(cards.id, fixture.card.id));

    const result = await notificationRepo.syncDueAlerts(db, {
      userId: assigneeId,
      now,
    });
    const activeAlerts = await db
      .select({ type: notifications.type })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, assigneeId),
          isNull(notifications.deletedAt),
        ),
      );

    expect(result).toEqual({ created: 1, invalidated: 0 });
    expect(activeAlerts).toEqual([{ type: "card.due.overdue" }]);
  });

  it("keeps the due-soon notification when the overdue alert is added", async () => {
    const fixture = await seedNotificationFixture(db);
    await db
      .update(cards)
      .set({ priority: "high" })
      .where(eq(cards.id, fixture.card.id));

    const dueSoon = await notificationRepo.syncDueAlerts(db, {
      userId: assigneeId,
      now,
    });
    const overdue = await notificationRepo.syncDueAlerts(db, {
      userId: assigneeId,
      now: new Date(now.getTime() + 2 * 60 * 60 * 1000),
    });
    const activeTypes = await db
      .select({ type: notifications.type })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, assigneeId),
          isNull(notifications.deletedAt),
        ),
      );

    expect(dueSoon).toEqual({ created: 1, invalidated: 0 });
    expect(overdue).toEqual({ created: 1, invalidated: 0 });
    expect(activeTypes.map((alert) => alert.type).sort()).toEqual([
      "card.due.overdue",
      "card.due.soon",
    ]);
  });

  it("rolls back stale invalidation when alert creation fails and repairs on retry", async () => {
    const fixture = await seedNotificationFixture(db);
    await db
      .update(cards)
      .set({ priority: "high" })
      .where(eq(cards.id, fixture.card.id));
    const staleAlert = await notificationRepo.create(db, {
      type: "card.due.overdue",
      userId: assigneeId,
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      dedupeKey: "stale-due-alert",
    });
    await db.execute(sql`
      ALTER TABLE "notification"
      ADD CONSTRAINT "reject_due_soon_test"
      CHECK ("type" <> 'card.due.soon')
    `);

    await expect(
      notificationRepo.syncDueAlerts(db, { userId: assigneeId, now }),
    ).rejects.toThrow();
    const afterFailure = await db
      .select({
        publicId: notifications.publicId,
        deletedAt: notifications.deletedAt,
        dedupeKey: notifications.dedupeKey,
      })
      .from(notifications);
    await db.execute(sql`
      ALTER TABLE "notification"
      DROP CONSTRAINT "reject_due_soon_test"
    `);
    const retry = await notificationRepo.syncDueAlerts(db, {
      userId: assigneeId,
      now,
    });
    const activeAlerts = await db
      .select({ type: notifications.type })
      .from(notifications)
      .where(isNull(notifications.deletedAt));

    expect(afterFailure).toEqual([
      {
        publicId: staleAlert?.publicId,
        deletedAt: null,
        dedupeKey: "stale-due-alert",
      },
    ]);
    expect(retry).toEqual({ created: 1, invalidated: 1 });
    expect(activeAlerts).toEqual([{ type: "card.due.soon" }]);
  });

  it("alerts urgent assignees, excludes the actor, and handles later assignments", async () => {
    const fixture = await seedNotificationFixture(db);
    await db.insert(cardToWorkspaceMembers).values({
      cardId: fixture.card.id,
      workspaceMemberId: fixture.ownerMember.id,
    });

    const [firstTransition, concurrentTransition] = await Promise.all([
      notificationRepo.createUrgentAlertsForAssignees(db, {
        cardId: fixture.card.id,
        actorUserId: ownerId,
      }),
      notificationRepo.createUrgentAlertsForAssignees(db, {
        cardId: fixture.card.id,
        actorUserId: ownerId,
      }),
    ]);
    const urgentAlertsAfterTransition = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, "card.priority.urgent"),
          isNull(notifications.deletedAt),
        ),
      );
    await db
      .delete(cardToWorkspaceMembers)
      .where(
        and(
          eq(cardToWorkspaceMembers.cardId, fixture.card.id),
          eq(
            cardToWorkspaceMembers.workspaceMemberId,
            fixture.assigneeMember.id,
          ),
        ),
      );
    const invalidatedFirstAssignment =
      await notificationRepo.invalidateCardAlertsForWorkspaceMember(db, {
        cardId: fixture.card.id,
        workspaceMemberId: fixture.assigneeMember.id,
        invalidatedAt: new Date(now.getTime() + 6 * 60 * 1000),
      });
    await db.insert(cardToWorkspaceMembers).values({
      cardId: fixture.card.id,
      workspaceMemberId: fixture.assigneeMember.id,
    });
    const assignment =
      await notificationRepo.createUrgentAlertForAssignedMember(db, {
        cardId: fixture.card.id,
        workspaceMemberId: fixture.assigneeMember.id,
      });
    const urgentAlertsAfterAssignment = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, "card.priority.urgent"),
          isNull(notifications.deletedAt),
        ),
      );
    await db
      .delete(cardToWorkspaceMembers)
      .where(
        and(
          eq(cardToWorkspaceMembers.cardId, fixture.card.id),
          eq(
            cardToWorkspaceMembers.workspaceMemberId,
            fixture.assigneeMember.id,
          ),
        ),
      );
    const invalidatedRemovedAssignee =
      await notificationRepo.invalidateCardAlertsForWorkspaceMember(db, {
        cardId: fixture.card.id,
        workspaceMemberId: fixture.assigneeMember.id,
        invalidatedAt: new Date(now.getTime() + 90 * 1000),
      });
    await db
      .delete(cardToWorkspaceMembers)
      .where(eq(cardToWorkspaceMembers.cardId, fixture.card.id));
    const withoutAssignees =
      await notificationRepo.createUrgentAlertsForAssignees(db, {
        cardId: fixture.card.id,
        actorUserId: ownerId,
      });
    const activeUrgentAlerts = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, "card.priority.urgent"),
          isNull(notifications.deletedAt),
        ),
      );

    expect(firstTransition + concurrentTransition).toBe(1);
    expect(urgentAlertsAfterTransition).toEqual([{ userId: assigneeId }]);
    expect(invalidatedFirstAssignment).toBe(1);
    expect(assignment).toBe(1);
    expect(urgentAlertsAfterAssignment).toEqual([{ userId: assigneeId }]);
    expect(invalidatedRemovedAssignee).toBe(1);
    expect(withoutAssignees).toBe(0);
    expect(activeUrgentAlerts).toEqual([]);
  });

  it("allows a new urgent alert after leaving and re-entering urgent", async () => {
    const fixture = await seedNotificationFixture(db);
    const firstCycle = await notificationRepo.createUrgentAlertsForAssignees(
      db,
      {
        cardId: fixture.card.id,
        actorUserId: ownerId,
      },
    );
    await db
      .update(cards)
      .set({ priority: "high" })
      .where(eq(cards.id, fixture.card.id));
    const invalidated = await notificationRepo.invalidateUrgentAlertsForCard(
      db,
      { cardId: fixture.card.id, invalidatedAt: new Date(now.getTime() + 1) },
    );
    await db
      .update(cards)
      .set({ priority: "urgent" })
      .where(eq(cards.id, fixture.card.id));
    const secondCycle = await notificationRepo.createUrgentAlertsForAssignees(
      db,
      {
        cardId: fixture.card.id,
        actorUserId: ownerId,
      },
    );
    const activeAlerts = await db
      .select({ dedupeKey: notifications.dedupeKey })
      .from(notifications)
      .where(isNull(notifications.deletedAt));
    const previousAlerts = await db
      .select({ dedupeKey: notifications.dedupeKey })
      .from(notifications)
      .where(isNotNull(notifications.deletedAt));

    expect(firstCycle).toBe(1);
    expect(invalidated).toBe(1);
    expect(secondCycle).toBe(1);
    expect(activeAlerts).toHaveLength(1);
    expect(activeAlerts[0]?.dedupeKey).toBe(
      `card.priority.urgent:${assigneeId}:${fixture.card.publicId}`,
    );
    expect(previousAlerts).toEqual([{ dedupeKey: null }]);
  });

  it("repairs a missed urgent alert and excludes the transition actor", async () => {
    const fixture = await seedNotificationFixture(db);
    await db
      .update(cards)
      .set({ dueDate: new Date(now.getTime() + 48 * 60 * 60 * 1000) })
      .where(eq(cards.id, fixture.card.id));
    await db.insert(cardToWorkspaceMembers).values({
      cardId: fixture.card.id,
      workspaceMemberId: fixture.ownerMember.id,
    });
    await db.insert(cardActivities).values({
      publicId: "activity0001",
      type: "card.updated.priority",
      cardId: fixture.card.id,
      fromPriority: "high",
      toPriority: "urgent",
      createdBy: ownerId,
      createdAt: now,
    });

    const repaired = await notificationRepo.syncDueAlerts(db, {
      userId: assigneeId,
      now,
    });
    const actorSync = await notificationRepo.syncDueAlerts(db, {
      userId: ownerId,
      now,
    });
    const retry = await notificationRepo.syncDueAlerts(db, {
      userId: assigneeId,
      now,
    });
    const urgentAlerts = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, "card.priority.urgent"),
          isNull(notifications.deletedAt),
        ),
      );

    expect(repaired).toEqual({ created: 1, invalidated: 0 });
    expect(actorSync).toEqual({ created: 0, invalidated: 0 });
    expect(retry).toEqual({ created: 0, invalidated: 0 });
    expect(urgentAlerts).toEqual([{ userId: assigneeId }]);
  });

  it("repairs a same-timestamp later self-assignment by activity order", async () => {
    const fixture = await seedNotificationFixture(db);
    await db
      .update(cards)
      .set({ dueDate: new Date(now.getTime() + 48 * 60 * 60 * 1000) })
      .where(eq(cards.id, fixture.card.id));
    const [priorityActivity] = await db
      .insert(cardActivities)
      .values({
        publicId: "priority0001",
        type: "card.updated.priority",
        cardId: fixture.card.id,
        fromPriority: "high",
        toPriority: "urgent",
        createdBy: ownerId,
        createdAt: now,
      })
      .returning({ id: cardActivities.id });
    await db.insert(cardToWorkspaceMembers).values({
      cardId: fixture.card.id,
      workspaceMemberId: fixture.ownerMember.id,
    });
    const [assignmentActivity] = await db
      .insert(cardActivities)
      .values({
        publicId: "memberadd001",
        type: "card.updated.member.added",
        cardId: fixture.card.id,
        workspaceMemberId: fixture.ownerMember.id,
        createdBy: ownerId,
        createdAt: now,
      })
      .returning({ id: cardActivities.id });

    const immediate = await notificationRepo.createUrgentAlertForAssignedMember(
      db,
      {
        cardId: fixture.card.id,
        workspaceMemberId: fixture.ownerMember.id,
      },
    );
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.userId, ownerId),
          eq(notifications.type, "card.priority.urgent"),
        ),
      );
    const repaired = await notificationRepo.syncDueAlerts(db, {
      userId: ownerId,
      now,
    });
    const ownerAlerts = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ownerId),
          eq(notifications.type, "card.priority.urgent"),
          isNull(notifications.deletedAt),
        ),
      );

    expect(immediate).toBe(1);
    expect(assignmentActivity?.id).toBeGreaterThan(priorityActivity?.id ?? 0);
    expect(repaired).toEqual({ created: 1, invalidated: 0 });
    expect(ownerAlerts).toEqual([{ userId: ownerId }]);
  });

  it("keeps an immediate urgent alert when a card created urgent is assigned later", async () => {
    const fixture = await seedNotificationFixture(db);
    await db
      .update(cards)
      .set({ dueDate: new Date(now.getTime() + 48 * 60 * 60 * 1000) })
      .where(eq(cards.id, fixture.card.id));
    await db.insert(cardToWorkspaceMembers).values({
      cardId: fixture.card.id,
      workspaceMemberId: fixture.ownerMember.id,
    });
    await db.insert(cardActivities).values({
      publicId: "memberadd002",
      type: "card.updated.member.added",
      cardId: fixture.card.id,
      workspaceMemberId: fixture.ownerMember.id,
      createdBy: ownerId,
      createdAt: new Date(now.getTime() + 1),
    });

    const immediate = await notificationRepo.createUrgentAlertForAssignedMember(
      db,
      {
        cardId: fixture.card.id,
        workspaceMemberId: fixture.ownerMember.id,
      },
    );
    const synced = await notificationRepo.syncDueAlerts(db, {
      userId: ownerId,
      now: new Date(now.getTime() + 2),
    });
    const ownerAlerts = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ownerId),
          eq(notifications.type, "card.priority.urgent"),
          isNull(notifications.deletedAt),
        ),
      );

    expect(immediate).toBe(1);
    expect(synced).toEqual({ created: 0, invalidated: 0 });
    expect(ownerAlerts).toEqual([{ userId: ownerId }]);
  });

  it("invalidates urgent and due alerts when their board is archived", async () => {
    const fixture = await seedNotificationFixture(db);
    await notificationRepo.createUrgentAlertsForAssignees(db, {
      cardId: fixture.card.id,
      actorUserId: ownerId,
    });
    await notificationRepo.syncDueAlerts(db, { userId: assigneeId, now });
    const invalidatedAt = new Date(now.getTime() + 60 * 1000);
    await db
      .update(boards)
      .set({ isArchived: true })
      .where(eq(boards.id, fixture.board.id));

    const invalidated = await notificationRepo.invalidateCardAlertsForBoard(
      db,
      { boardId: fixture.board.id, invalidatedAt },
    );
    const activeAlerts = await db
      .select()
      .from(notifications)
      .where(isNull(notifications.deletedAt));
    const archivedAlerts = await db
      .select({ deletedAt: notifications.deletedAt })
      .from(notifications)
      .where(isNotNull(notifications.deletedAt));

    expect(invalidated).toBe(2);
    expect(activeAlerts).toEqual([]);
    expect(archivedAlerts).toEqual([
      { deletedAt: invalidatedAt },
      { deletedAt: invalidatedAt },
    ]);
  });

  it("invalidates stale alerts after due-date changes, completion, and reassignment", async () => {
    const fixture = await seedNotificationFixture(db);
    await db
      .update(cards)
      .set({ priority: "high" })
      .where(eq(cards.id, fixture.card.id));
    await notificationRepo.syncDueAlerts(db, { userId: assigneeId, now });
    await db
      .update(cards)
      .set({ dueDate: new Date(now.getTime() + 2 * 60 * 60 * 1000) })
      .where(eq(cards.id, fixture.card.id));

    const changedDate = await notificationRepo.syncDueAlerts(db, {
      userId: assigneeId,
      now,
    });
    await db
      .update(cards)
      .set({ completedAt: new Date(now.getTime() + 30 * 60 * 1000) })
      .where(eq(cards.id, fixture.card.id));
    const completed = await notificationRepo.syncDueAlerts(db, {
      userId: assigneeId,
      now,
    });
    await db
      .update(cards)
      .set({ completedAt: null })
      .where(eq(cards.id, fixture.card.id));
    await db
      .delete(cardToWorkspaceMembers)
      .where(
        and(
          eq(cardToWorkspaceMembers.cardId, fixture.card.id),
          eq(
            cardToWorkspaceMembers.workspaceMemberId,
            fixture.assigneeMember.id,
          ),
        ),
      );
    await db.insert(cardToWorkspaceMembers).values({
      cardId: fixture.card.id,
      workspaceMemberId: fixture.ownerMember.id,
    });
    const removedAssignee = await notificationRepo.syncDueAlerts(db, {
      userId: assigneeId,
      now,
    });
    const newAssignee = await notificationRepo.syncDueAlerts(db, {
      userId: ownerId,
      now,
    });
    const activeAlerts = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(isNull(notifications.deletedAt));
    const invalidatedAlerts = await db
      .select({ dedupeKey: notifications.dedupeKey })
      .from(notifications)
      .where(isNotNull(notifications.deletedAt));

    expect(changedDate).toEqual({ created: 1, invalidated: 1 });
    expect(completed).toEqual({ created: 0, invalidated: 1 });
    expect(removedAssignee).toEqual({ created: 0, invalidated: 0 });
    expect(newAssignee).toEqual({ created: 1, invalidated: 0 });
    expect(activeAlerts).toEqual([{ userId: ownerId }]);
    expect(invalidatedAlerts).toHaveLength(2);
    expect(invalidatedAlerts.every((alert) => alert.dedupeKey === null)).toBe(
      true,
    );
  });
});
