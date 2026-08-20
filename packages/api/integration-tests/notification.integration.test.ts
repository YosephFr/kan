import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as notificationRepo from "@kan/db/repository/notification.repo";
import {
  boards,
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

describe("notification repository access", () => {
  let db: TestDbClient;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("isolates listing, unread counts, and mark-read by authenticated owner", async () => {
    const fixture = await seedNotificationFixture(db);
    const ownerNotificationResult = await notificationRepo.create(db, {
      type: "card.priority.urgent",
      userId: ownerId,
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      dedupeKey: "owner-isolation",
    });
    const ownerNotification = requireValue(
      ownerNotificationResult,
      "owner notification",
    );
    const assigneeNotificationResult = await notificationRepo.create(db, {
      type: "card.priority.urgent",
      userId: assigneeId,
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      dedupeKey: "assignee-isolation",
    });
    const assigneeNotification = requireValue(
      assigneeNotificationResult,
      "assignee notification",
    );
    await db.insert(workspaceMembers).values({
      publicId: "member000004",
      email: "owner-notifications@example.com",
      userId: ownerId,
      workspaceId: fixture.workspace.id,
      createdBy: ownerId,
      role: "admin",
      status: "active",
    });

    const ownerPage = await notificationRepo.list(db, {
      userId: ownerId,
      limit: 30,
    });
    const crossUserRead = await notificationRepo.markAsRead(db, {
      userId: ownerId,
      notificationPublicId: assigneeNotification.publicId,
    });

    expect(ownerPage.items).toHaveLength(1);
    expect(ownerPage.items[0]).toMatchObject({
      publicId: ownerNotification.publicId,
      card: {
        publicId: fixture.card.publicId,
        boardName: fixture.board.name,
        workspacePublicId: fixture.workspace.publicId,
      },
    });
    expect(crossUserRead).toBeNull();
    await expect(notificationRepo.getUnreadCount(db, ownerId)).resolves.toBe(1);
    await expect(notificationRepo.getUnreadCount(db, assigneeId)).resolves.toBe(
      1,
    );
  });

  it("paginates same-microsecond rows by an owner-scoped public cursor", async () => {
    const fixture = await seedNotificationFixture(db);
    await db.insert(notifications).values(
      ["notice000001", "notice000002", "notice000003"].map(
        (publicId, index) => ({
          publicId,
          type: "card.priority.urgent" as const,
          userId: ownerId,
          cardId: fixture.card.id,
          workspaceId: fixture.workspace.id,
          dedupeKey: `microsecond-page-${index}`,
        }),
      ),
    );
    await db.execute(sql`
      UPDATE "notification"
      SET "createdAt" = TIMESTAMP '2026-08-20 12:00:00.123456'
      WHERE "userId" = ${ownerId}
    `);

    const firstPage = await notificationRepo.list(db, {
      userId: ownerId,
      limit: 1,
    });
    const secondPage = await notificationRepo.list(db, {
      userId: ownerId,
      limit: 1,
      cursor: requireValue(firstPage.nextCursor, "first cursor"),
    });
    const thirdPage = await notificationRepo.list(db, {
      userId: ownerId,
      limit: 1,
      cursor: requireValue(secondPage.nextCursor, "second cursor"),
    });
    const crossOwnerPage = await notificationRepo.list(db, {
      userId: assigneeId,
      limit: 1,
      cursor: { publicId: "notice000003" },
    });

    expect(firstPage.items.map((item) => item.publicId)).toEqual([
      "notice000003",
    ]);
    expect(secondPage.items.map((item) => item.publicId)).toEqual([
      "notice000002",
    ]);
    expect(thirdPage.items.map((item) => item.publicId)).toEqual([
      "notice000001",
    ]);
    expect(crossOwnerPage.items).toHaveLength(0);
  });

  it("keeps the notification but removes its card link after membership is revoked", async () => {
    const fixture = await seedNotificationFixture(db);
    await notificationRepo.create(db, {
      type: "card.priority.urgent",
      userId: assigneeId,
      cardId: fixture.card.id,
      workspaceId: fixture.workspace.id,
      dedupeKey: "revoked-membership",
    });

    const accessiblePage = await notificationRepo.list(db, {
      userId: assigneeId,
      limit: 30,
    });
    await db
      .update(workspaceMembers)
      .set({ status: "removed", deletedAt: now })
      .where(eq(workspaceMembers.id, fixture.assigneeMember.id));
    const revokedPage = await notificationRepo.list(db, {
      userId: assigneeId,
      limit: 30,
    });

    expect(accessiblePage.items[0]?.card?.publicId).toBe(fixture.card.publicId);
    expect(revokedPage.items[0]?.card).toBeNull();
  });

  it("ignores legacy card assignments whose member belongs to another workspace", async () => {
    const fixture = await seedNotificationFixture(db);
    const [foreignWorkspaceResult] = await db
      .insert(workspaces)
      .values({
        publicId: "workspc00002",
        name: "Foreign workspace",
        slug: "foreign-notification-workspace",
        createdBy: ownerId,
      })
      .returning();
    const foreignWorkspace = requireValue(
      foreignWorkspaceResult,
      "foreign workspace",
    );
    const [foreignMemberResult] = await db
      .insert(workspaceMembers)
      .values({
        publicId: "member000003",
        email: "assignee-notifications@example.com",
        userId: assigneeId,
        workspaceId: foreignWorkspace.id,
        createdBy: ownerId,
        role: "member",
        status: "active",
      })
      .returning();
    const foreignMember = requireValue(foreignMemberResult, "foreign member");

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
      workspaceMemberId: foreignMember.id,
    });

    const syncResult = await notificationRepo.syncDueAlerts(db, {
      userId: assigneeId,
      now,
    });
    const urgentResult = await notificationRepo.createUrgentAlertsForAssignees(
      db,
      {
        cardId: fixture.card.id,
        actorUserId: ownerId,
      },
    );
    const assignmentResult =
      await notificationRepo.createUrgentAlertForAssignedMember(db, {
        cardId: fixture.card.id,
        workspaceMemberId: foreignMember.id,
      });

    expect(syncResult.created).toBe(0);
    expect(urgentResult).toBe(0);
    expect(assignmentResult).toBe(0);
    await expect(notificationRepo.getUnreadCount(db, assigneeId)).resolves.toBe(
      0,
    );
  });
});
