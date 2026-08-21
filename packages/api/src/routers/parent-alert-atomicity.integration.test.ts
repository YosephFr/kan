import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as cardMoveRepo from "@kan/db/repository/card-move.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as pipelineRepo from "@kan/db/repository/cardPipeline.repo";
import * as subtaskRepo from "@kan/db/repository/cardSubtask.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import { boards, cards, lists, users, workspaceMembers } from "@kan/db/schema";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

describe("parent alert atomicity", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;
  let doneList: typeof lists.$inferSelect;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
    const [recipient] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Parent Alert Recipient",
        email: "parent-alert@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!recipient) throw new Error("Recipient missing");
    const [member] = await db
      .insert(workspaceMembers)
      .values({
        publicId: "memberparent",
        email: recipient.email,
        userId: recipient.id,
        workspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
        role: "member",
        status: "active",
      })
      .returning();
    if (!member) throw new Error("Recipient member missing");
    const [insertedDoneList] = await db
      .insert(lists)
      .values({
        publicId: "donepipe0001",
        name: "Done",
        status: "done",
        index: 1,
        boardId: seeded.board.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!insertedDoneList) throw new Error("Done list missing");
    doneList = insertedDoneList;

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
    const created = await subtaskRepo.createSubtask(db, {
      stagePublicId: planned.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Parent atomic alert",
      ownerPublicId: member.publicId,
      createdBy: seeded.user.id,
    });
    if (created.status !== "created") throw new Error("Subtask missing");

    await rejectNotificationUpdates();
  });

  async function rejectNotificationUpdates() {
    await db.$client.query(`
      CREATE FUNCTION reject_parent_notification_update() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'parent notification update rejected';
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.$client.query(`
      CREATE TRIGGER reject_parent_notification_update
      BEFORE UPDATE ON notification
      FOR EACH ROW EXECUTE FUNCTION reject_parent_notification_update()
    `);
  }

  it("rolls back a single card completion", async () => {
    await expect(
      cardRepo.reorder(db, {
        cardId: seeded.card.id,
        newListId: doneList.id,
        newIndex: 0,
        expectedWorkspaceId: seeded.workspace.id,
        confirmOpenSubtasks: true,
      }),
    ).rejects.toThrow(/parent notification update rejected/);

    const [card] = await db
      .select({ listId: cards.listId, completedAt: cards.completedAt })
      .from(cards)
      .where(eq(cards.id, seeded.card.id));
    expect(card).toMatchObject({ listId: seeded.list.id, completedAt: null });
  });

  it("rolls back editing a completed card when stale alerts cannot clear", async () => {
    const completedAt = new Date("2026-08-21T12:00:00.000Z");
    await db
      .update(cards)
      .set({ completedAt })
      .where(eq(cards.id, seeded.card.id));

    await expect(
      cardRepo.update(
        db,
        { title: "Must roll back" },
        {
          cardPublicId: seeded.card.publicId,
          expectedWorkspaceId: seeded.workspace.id,
        },
      ),
    ).rejects.toThrow(/parent notification update rejected/);

    const [card] = await db
      .select({ title: cards.title, completedAt: cards.completedAt })
      .from(cards)
      .where(eq(cards.id, seeded.card.id));
    expect(card).toMatchObject({
      title: "Pipeline card",
      completedAt,
    });
  });

  it("rolls back a bulk card completion", async () => {
    await expect(
      cardMoveRepo.moveMany(db, {
        cardIds: [seeded.card.id],
        destinationListId: doneList.id,
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
        confirmOpenSubtasks: true,
      }),
    ).rejects.toThrow(/parent notification update rejected/);

    const [card] = await db
      .select({ listId: cards.listId, completedAt: cards.completedAt })
      .from(cards)
      .where(eq(cards.id, seeded.card.id));
    expect(card).toMatchObject({ listId: seeded.list.id, completedAt: null });
  });

  it("rolls back a card deletion", async () => {
    await expect(
      cardRepo.softDelete(db, {
        cardId: seeded.card.id,
        expectedWorkspaceId: seeded.workspace.id,
        deletedAt: new Date(),
        deletedBy: seeded.user.id,
      }),
    ).rejects.toThrow(/parent notification update rejected/);

    const [card] = await db
      .select({ deletedAt: cards.deletedAt })
      .from(cards)
      .where(eq(cards.id, seeded.card.id));
    expect(card?.deletedAt).toBeNull();
  });

  it("rolls back completing a list", async () => {
    await expect(
      listRepo.update(
        db,
        { status: "done", confirmCardLifecycleUpdate: true },
        {
          listPublicId: seeded.list.publicId,
          expectedWorkspaceId: seeded.workspace.id,
        },
      ),
    ).rejects.toThrow(/parent notification update rejected/);

    const [list] = await db
      .select({ status: lists.status })
      .from(lists)
      .where(eq(lists.id, seeded.list.id));
    const [card] = await db
      .select({ completedAt: cards.completedAt })
      .from(cards)
      .where(eq(cards.id, seeded.card.id));
    expect(list?.status).toBeNull();
    expect(card?.completedAt).toBeNull();
  });

  it("rolls back deleting a list", async () => {
    await expect(
      listRepo.softDeleteById(db, {
        listId: seeded.list.id,
        expectedWorkspaceId: seeded.workspace.id,
        deletedAt: new Date(),
        deletedBy: seeded.user.id,
      }),
    ).rejects.toThrow(/parent notification update rejected/);

    const [list] = await db
      .select({ deletedAt: lists.deletedAt })
      .from(lists)
      .where(eq(lists.id, seeded.list.id));
    expect(list?.deletedAt).toBeNull();
  });

  it("rolls back archiving a board", async () => {
    await expect(
      boardRepo.update(db, {
        boardPublicId: seeded.board.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        name: undefined,
        slug: undefined,
        visibility: undefined,
        isArchived: true,
      }),
    ).rejects.toThrow(/parent notification update rejected/);

    const [board] = await db
      .select({ isArchived: boards.isArchived })
      .from(boards)
      .where(eq(boards.id, seeded.board.id));
    expect(board?.isArchived).toBe(false);
  });

  it("rolls back deleting a board", async () => {
    await expect(
      boardRepo.softDelete(db, {
        boardId: seeded.board.id,
        expectedWorkspaceId: seeded.workspace.id,
        deletedAt: new Date(),
        deletedBy: seeded.user.id,
      }),
    ).rejects.toThrow(/parent notification update rejected/);

    const [board] = await db
      .select({ deletedAt: boards.deletedAt })
      .from(boards)
      .where(eq(boards.id, seeded.board.id));
    expect(board?.deletedAt).toBeNull();
  });
});
