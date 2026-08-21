import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as pipelineRepo from "@kan/db/repository/cardPipeline.repo";
import * as subtaskRepo from "@kan/db/repository/cardSubtask.repo";
import * as memberRepo from "@kan/db/repository/member.repo";
import * as notificationRepo from "@kan/db/repository/notification.repo";
import {
  boards,
  cards,
  cardSubtasks,
  cardToWorkspaceMembers,
  lists,
  notifications,
  users,
  workspaceMembers,
} from "@kan/db/schema";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

describe("card subtask notifications", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;
  let recipient: typeof users.$inferSelect;
  let recipientMember: typeof workspaceMembers.$inferSelect;
  let plannedStagePublicId: string;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);

    const [insertedRecipient] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Pipeline Recipient",
        email: "recipient@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!insertedRecipient) throw new Error("Recipient missing");
    recipient = insertedRecipient;

    const [insertedMember] = await db
      .insert(workspaceMembers)
      .values({
        publicId: "memberpipe03",
        email: recipient.email,
        userId: recipient.id,
        workspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
        role: "member",
        status: "active",
      })
      .returning();
    if (!insertedMember) throw new Error("Recipient member missing");
    recipientMember = insertedMember;

    const initialized = await pipelineRepo.initialize(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    if (initialized.status !== "initialized") {
      throw new Error("Pipeline not initialized");
    }
    const planned = initialized.stages.find(
      (stage) => stage.status === "planned",
    );
    if (!planned) throw new Error("Planned stage missing");
    plannedStagePublicId = planned.publicId;
  });

  it("creates one transactional assignment alert, excludes the actor and permits a later reassignment", async () => {
    const created = await subtaskRepo.createSubtask(db, {
      stagePublicId: plannedStagePublicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Assigned work",
      ownerPublicId: recipientMember.publicId,
      createdBy: seeded.user.id,
    });
    if (created.status !== "created" || !created.subtask) {
      throw new Error("Subtask not created");
    }

    const initialAlerts = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, recipient.id),
          eq(notifications.type, "subtask.assigned"),
          isNull(notifications.deletedAt),
        ),
      );
    expect(initialAlerts).toHaveLength(1);

    const selfAssigned = await subtaskRepo.createSubtask(db, {
      stagePublicId: plannedStagePublicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Actor-owned work",
      ownerPublicId: seeded.member.publicId,
      createdBy: seeded.user.id,
    });
    expect(selfAssigned.status).toBe("created");
    expect(
      await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, seeded.user.id),
            eq(notifications.type, "subtask.assigned"),
          ),
        ),
    ).toHaveLength(0);

    await subtaskRepo.setSubtaskOwner(db, {
      subtaskPublicId: created.subtask.publicId,
      ownerPublicId: null,
      expectedWorkspaceId: seeded.workspace.id,
      updatedBy: seeded.user.id,
    });
    await subtaskRepo.setSubtaskOwner(db, {
      subtaskPublicId: created.subtask.publicId,
      ownerPublicId: recipientMember.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      updatedBy: seeded.user.id,
    });

    const reassignmentAlerts = await db
      .select({ dedupeKey: notifications.dedupeKey })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, recipient.id),
          eq(notifications.type, "subtask.assigned"),
          isNull(notifications.deletedAt),
        ),
      );
    expect(reassignmentAlerts).toHaveLength(2);
    expect(
      new Set(reassignmentAlerts.map((alert) => alert.dedupeKey)).size,
    ).toBe(2);
  });

  it("deduplicates concurrent due sync and preserves soon when overdue is added", async () => {
    const baseNow = new Date("2026-08-21T12:00:00.000Z");
    const dueDate = new Date("2026-08-21T13:00:00.000Z");
    const created = await subtaskRepo.createSubtask(db, {
      stagePublicId: plannedStagePublicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Deadline work",
      dueDate,
      ownerPublicId: recipientMember.publicId,
      createdBy: seeded.user.id,
    });
    if (created.status !== "created") throw new Error("Subtask not created");

    const concurrent = await Promise.all([
      notificationRepo.syncSubtaskDueAlerts(db, {
        userId: recipient.id,
        now: baseNow,
      }),
      notificationRepo.syncSubtaskDueAlerts(db, {
        userId: recipient.id,
        now: baseNow,
      }),
    ]);
    expect(concurrent.reduce((sum, result) => sum + result.created, 0)).toBe(1);

    await notificationRepo.syncSubtaskDueAlerts(db, {
      userId: recipient.id,
      now: new Date("2026-08-21T14:00:00.000Z"),
    });
    await notificationRepo.syncSubtaskDueAlerts(db, {
      userId: recipient.id,
      now: new Date("2026-08-21T14:00:00.000Z"),
    });

    const alerts = await db
      .select({ type: notifications.type })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, recipient.id),
          isNull(notifications.deletedAt),
        ),
      );
    expect(
      alerts.filter((alert) => alert.type === "subtask.due.soon"),
    ).toHaveLength(1);
    expect(
      alerts.filter((alert) => alert.type === "subtask.due.overdue"),
    ).toHaveLength(1);
  });

  it("does not create a late soon alert and invalidates due alerts when the owner is removed", async () => {
    const dueDate = new Date("2026-08-21T11:00:00.000Z");
    const created = await subtaskRepo.createSubtask(db, {
      stagePublicId: plannedStagePublicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Already overdue",
      dueDate,
      ownerPublicId: recipientMember.publicId,
      createdBy: seeded.user.id,
    });
    if (created.status !== "created" || !created.subtask) {
      throw new Error("Subtask not created");
    }

    await notificationRepo.syncSubtaskDueAlerts(db, {
      userId: recipient.id,
      now: new Date("2026-08-21T12:00:00.000Z"),
    });
    await subtaskRepo.setSubtaskOwner(db, {
      subtaskPublicId: created.subtask.publicId,
      ownerPublicId: null,
      expectedWorkspaceId: seeded.workspace.id,
      updatedBy: seeded.user.id,
    });

    const alerts = await db
      .select({ type: notifications.type, deletedAt: notifications.deletedAt })
      .from(notifications)
      .where(eq(notifications.userId, recipient.id));
    expect(alerts.some((alert) => alert.type === "subtask.due.soon")).toBe(
      false,
    );
    expect(
      alerts.find((alert) => alert.type === "subtask.due.overdue")?.deletedAt,
    ).toBeInstanceOf(Date);
    expect(
      alerts.find((alert) => alert.type === "subtask.assigned")?.deletedAt,
    ).toBeNull();
  });

  it("keeps subtask alerts when the member is removed only from the parent card", async () => {
    const created = await subtaskRepo.createSubtask(db, {
      stagePublicId: plannedStagePublicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Independent subtask owner",
      ownerPublicId: recipientMember.publicId,
      createdBy: seeded.user.id,
    });
    if (created.status !== "created") throw new Error("Subtask not created");
    await db.insert(cardToWorkspaceMembers).values({
      cardId: seeded.card.id,
      workspaceMemberId: recipientMember.id,
    });
    await db.insert(notifications).values({
      publicId: "parentalert1",
      type: "card.priority.urgent",
      userId: recipient.id,
      cardId: seeded.card.id,
      workspaceId: seeded.workspace.id,
      dedupeKey: "parent-alert",
    });

    await notificationRepo.invalidateCardAlertsForWorkspaceMember(db, {
      cardId: seeded.card.id,
      workspaceMemberId: recipientMember.id,
    });

    const alerts = await db
      .select({ type: notifications.type, deletedAt: notifications.deletedAt })
      .from(notifications)
      .where(eq(notifications.userId, recipient.id));
    expect(
      alerts.find((alert) => alert.type === "card.priority.urgent")?.deletedAt,
    ).toBeInstanceOf(Date);
    expect(
      alerts.find((alert) => alert.type === "subtask.assigned")?.deletedAt,
    ).toBeNull();
  });

  it("does not create unread assignment alerts after the parent becomes terminal", async () => {
    await db
      .update(boards)
      .set({ isArchived: true })
      .where(eq(boards.id, seeded.board.id));
    const archivedParent = await subtaskRepo.createSubtask(db, {
      stagePublicId: plannedStagePublicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Archived parent work",
      ownerPublicId: recipientMember.publicId,
      createdBy: seeded.user.id,
    });
    expect(archivedParent.status).toBe("created");
    expect(await notificationRepo.getUnreadCount(db, recipient.id)).toBe(0);

    await db
      .update(boards)
      .set({ isArchived: false })
      .where(eq(boards.id, seeded.board.id));
    await db
      .update(lists)
      .set({ status: "done" })
      .where(eq(lists.id, seeded.list.id));
    await db
      .update(cards)
      .set({ completedAt: new Date() })
      .where(eq(cards.id, seeded.card.id));
    const doneParent = await subtaskRepo.createSubtask(db, {
      stagePublicId: plannedStagePublicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Done parent work",
      createdBy: seeded.user.id,
    });
    if (doneParent.status !== "created" || !doneParent.subtask) {
      throw new Error("Done parent subtask missing");
    }
    const assigned = await subtaskRepo.setSubtaskOwner(db, {
      subtaskPublicId: doneParent.subtask.publicId,
      ownerPublicId: recipientMember.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      updatedBy: seeded.user.id,
    });
    expect(assigned.status).toBe("updated");
    expect(await notificationRepo.getUnreadCount(db, recipient.id)).toBe(0);
  });

  it("does not recreate a due alert when its list becomes done after the candidate scan", async () => {
    const baseNow = new Date("2026-08-21T12:00:00.000Z");
    const created = await subtaskRepo.createSubtask(db, {
      stagePublicId: plannedStagePublicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Terminal race",
      dueDate: new Date("2026-08-21T13:00:00.000Z"),
      ownerPublicId: recipientMember.publicId,
      createdBy: seeded.user.id,
    });
    expect(created.status).toBe("created");

    const synced = await notificationRepo.syncSubtaskDueAlerts(
      db,
      { userId: recipient.id, now: baseNow },
      {
        afterCandidateScan: async (tx) => {
          await tx
            .update(lists)
            .set({ status: "done" })
            .where(eq(lists.id, seeded.list.id));
          await notificationRepo.invalidateCardAlertsForList(tx, {
            listId: seeded.list.id,
            invalidatedAt: baseNow,
          });
        },
      },
    );

    expect(synced.created).toBe(0);
    expect(await notificationRepo.getUnreadCount(db, recipient.id)).toBe(0);
    expect(
      await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, recipient.id),
            eq(notifications.type, "subtask.due.soon"),
            isNull(notifications.deletedAt),
          ),
        ),
    ).toHaveLength(0);
  });

  it("clears owners and all active subtask alerts when a workspace member is deleted", async () => {
    const created = await subtaskRepo.createSubtask(db, {
      stagePublicId: plannedStagePublicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Member-owned work",
      dueDate: new Date("2026-08-21T13:00:00.000Z"),
      ownerPublicId: recipientMember.publicId,
      createdBy: seeded.user.id,
    });
    if (created.status !== "created" || !created.subtask) {
      throw new Error("Subtask not created");
    }
    await notificationRepo.syncSubtaskDueAlerts(db, {
      userId: recipient.id,
      now: new Date("2026-08-21T12:00:00.000Z"),
    });

    await memberRepo.softDelete(db, {
      memberId: recipientMember.id,
      deletedAt: new Date("2026-08-21T12:05:00.000Z"),
      deletedBy: seeded.user.id,
    });

    const [subtask] = await db
      .select({ ownerWorkspaceMemberId: cardSubtasks.ownerWorkspaceMemberId })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.publicId, created.subtask.publicId));
    expect(subtask?.ownerWorkspaceMemberId).toBeNull();
    expect(
      await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, recipient.id),
            isNull(notifications.deletedAt),
          ),
        ),
    ).toHaveLength(0);
  });
});
