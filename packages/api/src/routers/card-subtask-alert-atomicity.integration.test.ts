import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as pipelineRepo from "@kan/db/repository/cardPipeline.repo";
import * as subtaskRepo from "@kan/db/repository/cardSubtask.repo";
import * as notificationRepo from "@kan/db/repository/notification.repo";
import {
  cardPipelineStages,
  cardSubtasks,
  notifications,
  users,
  workspaceMembers,
} from "@kan/db/schema";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

describe("card subtask alert atomicity", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;
  let recipient: typeof users.$inferSelect;
  let recipientMember: typeof workspaceMembers.$inferSelect;
  let plannedStagePublicId: string;
  let doneStagePublicId: string;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
    const [insertedRecipient] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Atomicity Recipient",
        email: "atomicity@example.com",
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
        publicId: "memberatom01",
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
    const done = initialized.stages.find((stage) => stage.status === "done");
    if (!planned || !done) throw new Error("Pipeline stages missing");
    plannedStagePublicId = planned.publicId;
    doneStagePublicId = done.publicId;
  });

  async function createAlertedSubtask() {
    const dueDate = new Date("2026-08-21T13:00:00.000Z");
    const created = await subtaskRepo.createSubtask(db, {
      stagePublicId: plannedStagePublicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Atomic alert work",
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
    return { subtask: created.subtask, dueDate };
  }

  async function rejectNotificationUpdates() {
    await db.$client.query(`
      CREATE FUNCTION reject_notification_update() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'notification update rejected';
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.$client.query(`
      CREATE TRIGGER reject_notification_update
      BEFORE UPDATE ON notification
      FOR EACH ROW EXECUTE FUNCTION reject_notification_update()
    `);
  }

  it("rolls back a due-date change when alert invalidation fails", async () => {
    const { subtask, dueDate } = await createAlertedSubtask();
    await rejectNotificationUpdates();

    await expect(
      subtaskRepo.updateSubtask(db, {
        subtaskPublicId: subtask.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        dueDate: new Date("2026-08-22T13:00:00.000Z"),
        updatedBy: seeded.user.id,
      }),
    ).rejects.toThrow(/notification update rejected/);

    const [persisted] = await db
      .select({ dueDate: cardSubtasks.dueDate })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.publicId, subtask.publicId));
    expect(persisted?.dueDate).toEqual(dueDate);
    expect(await activeDueAlertCount()).toBe(1);
  });

  it("rolls back completion when due-alert invalidation fails", async () => {
    const { subtask } = await createAlertedSubtask();
    await rejectNotificationUpdates();

    await expect(
      subtaskRepo.moveSubtask(db, {
        subtaskPublicId: subtask.publicId,
        destinationStagePublicId: doneStagePublicId,
        destinationIndex: 0,
        expectedWorkspaceId: seeded.workspace.id,
        movedBy: seeded.user.id,
      }),
    ).rejects.toThrow(/notification update rejected/);

    const [persisted] = await db
      .select({
        status: cardPipelineStages.status,
        completedAt: cardSubtasks.completedAt,
      })
      .from(cardSubtasks)
      .innerJoin(
        cardPipelineStages,
        eq(cardSubtasks.stageId, cardPipelineStages.id),
      )
      .where(eq(cardSubtasks.publicId, subtask.publicId));
    expect(persisted).toMatchObject({ status: "planned", completedAt: null });
    expect(await activeDueAlertCount()).toBe(1);
  });

  it("rolls back deletion when alert invalidation fails", async () => {
    const { subtask } = await createAlertedSubtask();
    await rejectNotificationUpdates();

    await expect(
      subtaskRepo.softDeleteSubtask(db, {
        subtaskPublicId: subtask.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        deletedBy: seeded.user.id,
      }),
    ).rejects.toThrow(/notification update rejected/);

    const [persisted] = await db
      .select({ deletedAt: cardSubtasks.deletedAt })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.publicId, subtask.publicId));
    expect(persisted?.deletedAt).toBeNull();
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
    ).toHaveLength(2);
  });

  async function activeDueAlertCount() {
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, recipient.id),
          eq(notifications.type, "subtask.due.soon"),
          isNull(notifications.deletedAt),
        ),
      );
    return rows.length;
  }
});
