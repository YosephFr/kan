import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as pipelineRepo from "@kan/db/repository/cardPipeline.repo";
import * as subtaskRepo from "@kan/db/repository/cardSubtask.repo";
import * as checklistRepo from "@kan/db/repository/cardSubtaskChecklist.repo";
import * as resourceRepo from "@kan/db/repository/cardSubtaskResource.repo";
import * as memberRepo from "@kan/db/repository/member.repo";
import {
  boards,
  cardAttachments,
  cardPipelineStages,
  cards,
  cardSubtasks,
} from "@kan/db/schema";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

describe("card execution pipeline repository", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
  });

  it("initializes exactly four stages once and never mutates during get", async () => {
    const before = await pipelineRepo.getByCardPublicId(
      db,
      seeded.card.publicId,
    );
    expect(before).toMatchObject({
      status: "uninitialized",
      initialized: false,
      stages: [],
    });
    expect(await db.select().from(cardPipelineStages)).toHaveLength(0);

    const initialized = await pipelineRepo.initialize(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    expect(initialized.status).toBe("initialized");
    if (initialized.status !== "initialized") {
      throw new Error("Pipeline not initialized");
    }
    expect(initialized.stages.map((stage) => stage.status)).toEqual([
      "planned",
      "inProgress",
      "blocked",
      "done",
    ]);

    const repeated = await pipelineRepo.initialize(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    expect(repeated.status).toBe("existing");
    expect(await db.select().from(cardPipelineStages)).toHaveLength(4);

    await db.transaction(async (tx) => {
      await tx.insert(cardPipelineStages).values(
        pipelineRepo.DEFAULT_CARD_PIPELINE_STAGES.map((stage, index) => ({
          publicId: `directstage${index}`,
          cardId: seeded.emptyCard.id,
          status: stage.status,
          name: stage.name,
          index,
          createdBy: seeded.user.id,
        })),
      );
    });
    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(cardPipelineStages)
          .set({ index: 4 })
          .where(eq(cardPipelineStages.publicId, "directstage3"));
      }),
    ).rejects.toThrow(/contiguous indexes/);
    await db.delete(cards).where(eq(cards.id, seeded.emptyCard.id));
    expect(
      await db
        .select()
        .from(cardPipelineStages)
        .where(eq(cardPipelineStages.cardId, seeded.emptyCard.id)),
    ).toHaveLength(0);
  });

  it("rejects partial pipelines at the database boundary and reports legacy corruption", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(cardPipelineStages).values({
          publicId: "stagepartial",
          cardId: seeded.card.id,
          status: "planned",
          name: "Partial",
          index: 0,
          createdBy: seeded.user.id,
        });
      }),
    ).rejects.toThrow(/zero or exactly four stages/);

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(cardPipelineStages).values(
          pipelineRepo.DEFAULT_CARD_PIPELINE_STAGES.map((stage, index) => ({
            publicId: `badindices0${index}`,
            cardId: seeded.emptyCard.id,
            status: stage.status,
            name: stage.name,
            index: index + 1,
            createdBy: seeded.user.id,
          })),
        );
      }),
    ).rejects.toThrow(/contiguous indexes/);

    await db.$client.query(
      'ALTER TABLE "card_pipeline_stage" DISABLE TRIGGER "card_pipeline_stage_count_guard"',
    );
    const [legacyStage] = await db
      .insert(cardPipelineStages)
      .values({
        publicId: "stagelegacy1",
        cardId: seeded.card.id,
        status: "planned",
        name: "Legacy partial",
        index: 0,
        createdBy: seeded.user.id,
      })
      .returning({ id: cardPipelineStages.id });
    if (!legacyStage) throw new Error("Legacy stage missing");
    await db.insert(cardSubtasks).values({
      publicId: "legacytask01",
      cardId: seeded.card.id,
      stageId: legacyStage.id,
      title: "Misleading progress",
      index: 0,
      createdBy: seeded.user.id,
    });

    const read = await pipelineRepo.getByCardPublicId(db, seeded.card.publicId);
    expect(read).toMatchObject({
      status: "invalid_state",
      initialized: false,
      stages: [],
    });
    const initialize = await pipelineRepo.initialize(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    expect(initialize).toEqual({ status: "invalid_state" });
    expect(await pipelineRepo.getSummaryByCardId(db, seeded.card.id)).toEqual({
      total: 0,
      completed: 0,
      blocked: 0,
      progressPercent: 0,
    });
  });

  it("tracks lifecycle, owner scope, checklist and batch summaries", async () => {
    const initialized = await pipelineRepo.initialize(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    if (initialized.status !== "initialized") {
      throw new Error("Pipeline not initialized");
    }
    const byStatus = new Map(
      initialized.stages.map((stage) => [stage.status, stage]),
    );
    const planned = byStatus.get("planned");
    const inProgress = byStatus.get("inProgress");
    const blocked = byStatus.get("blocked");
    const done = byStatus.get("done");
    if (!planned || !inProgress || !blocked || !done) {
      throw new Error("Missing pipeline stages");
    }

    const crossWorkspaceOwner = await subtaskRepo.createSubtask(db, {
      stagePublicId: planned.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Cross tenant",
      ownerPublicId: seeded.otherMember.publicId,
      createdBy: seeded.user.id,
    });
    expect(crossWorkspaceOwner).toEqual({ status: "owner_invalid" });

    const created = await subtaskRepo.createSubtask(db, {
      stagePublicId: planned.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Prepare launch",
      description: "Execution context",
      priority: "high",
      dueDate: new Date("2026-08-25T15:00:00.000Z"),
      ownerPublicId: seeded.member.publicId,
      createdBy: seeded.user.id,
    });
    expect(created.status).toBe("created");
    if (created.status !== "created" || !created.subtask) {
      throw new Error("Subtask not created");
    }
    expect(created.subtask).toMatchObject({
      stageStatus: "planned",
      startedAt: null,
      completedAt: null,
      ownerPublicId: seeded.member.publicId,
    });

    const started = await subtaskRepo.moveSubtask(db, {
      subtaskPublicId: created.subtask.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      destinationStagePublicId: inProgress.publicId,
      destinationIndex: 0,
      movedBy: seeded.user.id,
    });
    if (started.status !== "moved" || !started.subtask?.startedAt) {
      throw new Error("Subtask did not start");
    }
    const originalStart = started.subtask.startedAt;

    const paused = await subtaskRepo.moveSubtask(db, {
      subtaskPublicId: created.subtask.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      destinationStagePublicId: blocked.publicId,
      destinationIndex: 0,
      movedBy: seeded.user.id,
    });
    expect(paused.status).toBe("moved");
    if (paused.status !== "moved") throw new Error("Subtask not blocked");
    expect(paused.subtask?.startedAt).toEqual(originalStart);
    expect(paused.subtask?.completedAt).toBeNull();

    const completed = await subtaskRepo.moveSubtask(db, {
      subtaskPublicId: created.subtask.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      destinationStagePublicId: done.publicId,
      destinationIndex: 0,
      movedBy: seeded.user.id,
    });
    expect(completed.status).toBe("moved");
    if (completed.status !== "moved") throw new Error("Subtask not completed");
    expect(completed.subtask?.completedAt).toBeInstanceOf(Date);

    const reopened = await subtaskRepo.moveSubtask(db, {
      subtaskPublicId: created.subtask.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      destinationStagePublicId: planned.publicId,
      destinationIndex: 0,
      movedBy: seeded.user.id,
    });
    expect(reopened.status).toBe("moved");
    if (reopened.status !== "moved") throw new Error("Subtask not reopened");
    expect(reopened.subtask?.startedAt).toEqual(originalStart);
    expect(reopened.subtask?.completedAt).toBeNull();

    const checklist = await checklistRepo.addChecklistItem(db, {
      subtaskPublicId: created.subtask.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Approve copy",
      createdBy: seeded.user.id,
    });
    expect(checklist.status).toBe("created");
    if (checklist.status !== "created") throw new Error("Checklist missing");
    const checked = await checklistRepo.updateChecklistItem(db, {
      itemPublicId: checklist.item.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      completed: true,
      updatedBy: seeded.user.id,
    });
    expect(checked).toMatchObject({
      status: "updated",
      item: { completed: true },
    });

    const summaries = await pipelineRepo.getSummariesByCardPublicIds(db, [
      seeded.card.publicId,
      seeded.emptyCard.publicId,
    ]);
    expect(summaries.get(seeded.card.publicId)).toEqual({
      total: 1,
      completed: 0,
      blocked: 0,
      progressPercent: 0,
    });
    expect(summaries.get(seeded.emptyCard.publicId)).toEqual({
      total: 0,
      completed: 0,
      blocked: 0,
      progressPercent: 0,
    });
    expect(
      await pipelineRepo.countOpenSubtasksByCardId(db, seeded.card.id),
    ).toBe(1);

    const cloned = await pipelineRepo.clonePipelineForCard(db, {
      sourceCardId: seeded.card.id,
      destinationCardId: seeded.emptyCard.id,
      expectedSourceWorkspaceId: seeded.workspace.id,
      expectedDestinationWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    expect(cloned.status).toBe("cloned");
    const clonedPipeline = await pipelineRepo.getByCardPublicId(
      db,
      seeded.emptyCard.publicId,
    );
    if (!clonedPipeline || clonedPipeline.status !== "ready") {
      throw new Error("Cloned pipeline missing");
    }
    const clonedSubtasks = clonedPipeline.stages.flatMap(
      (stage) => stage.subtasks,
    );
    expect(clonedSubtasks).toHaveLength(1);
    expect(clonedSubtasks[0]).toMatchObject({
      title: "Prepare launch",
      priority: "high",
      dueDate: null,
      startedAt: null,
      completedAt: null,
      owner: null,
      checklistItems: [{ title: "Approve copy", completed: false }],
    });
    expect(
      clonedPipeline.stages.find((stage) => stage.status === "planned")
        ?.subtasks,
    ).toHaveLength(1);

    await subtaskRepo.softDeleteSubtask(db, {
      subtaskPublicId: created.subtask.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      deletedBy: seeded.user.id,
    });
    await db.transaction(async (tx) => {
      await tx
        .update(boards)
        .set({ workspaceId: seeded.otherWorkspace.id })
        .where(eq(boards.id, seeded.board.id));
      await subtaskRepo.clearInvalidOwnersForCardIdsTx(tx, {
        cardIds: [seeded.card.id],
        updatedBy: seeded.user.id,
      });
    });
    const [deletedSubtask] = await db
      .select({ ownerWorkspaceMemberId: cardSubtasks.ownerWorkspaceMemberId })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.publicId, created.subtask.publicId));
    expect(deletedSubtask?.ownerWorkspaceMemberId).toBeNull();
  });

  it("merges concurrent stage patches under the card lock", async () => {
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

    const [renamed, coloured] = await Promise.all([
      pipelineRepo.updateStages(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        stages: [{ publicId: planned.publicId, name: "Ideas" }],
        updatedBy: seeded.user.id,
      }),
      pipelineRepo.updateStages(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        stages: [{ publicId: planned.publicId, colourCode: "#ef4444" }],
        updatedBy: seeded.user.id,
      }),
    ]);
    expect(renamed.status).toBe("updated");
    expect(coloured.status).toBe("updated");

    const pipeline = await pipelineRepo.getByCardPublicId(
      db,
      seeded.card.publicId,
    );
    if (!pipeline || pipeline.status !== "ready") {
      throw new Error("Pipeline missing");
    }
    expect(
      pipeline.stages.find((stage) => stage.publicId === planned.publicId),
    ).toMatchObject({ name: "Ideas", colourCode: "#ef4444" });
  });

  it("rejects mutations when the board changed workspace after authorization", async () => {
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
      title: "Authorized in workspace A",
      createdBy: seeded.user.id,
    });
    if (created.status !== "created" || !created.subtask) {
      throw new Error("Subtask not created");
    }

    await db
      .update(boards)
      .set({ workspaceId: seeded.otherWorkspace.id })
      .where(eq(boards.id, seeded.board.id));

    expect(
      await pipelineRepo.initialize(db, {
        cardPublicId: seeded.emptyCard.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      }),
    ).toEqual({ status: "workspace_changed" });
    expect(
      await db
        .select()
        .from(cardPipelineStages)
        .where(eq(cardPipelineStages.cardId, seeded.emptyCard.id)),
    ).toHaveLength(0);
    expect(
      await subtaskRepo.updateSubtask(db, {
        subtaskPublicId: created.subtask.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        title: "Should not persist",
        updatedBy: seeded.user.id,
      }),
    ).toEqual({ status: "workspace_changed" });
    const [unchanged] = await db
      .select({ title: cardSubtasks.title })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.publicId, created.subtask.publicId));
    expect(unchanged?.title).toBe("Authorized in workspace A");
  });

  it("does not retain an owner deleted concurrently with assignment", async () => {
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
      title: "Concurrent assignment",
      createdBy: seeded.user.id,
    });
    if (created.status !== "created" || !created.subtask) {
      throw new Error("Subtask not created");
    }

    const [assignment, deletion] = await Promise.all([
      subtaskRepo.setSubtaskOwner(db, {
        subtaskPublicId: created.subtask.publicId,
        ownerPublicId: seeded.member.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        updatedBy: seeded.user.id,
      }),
      memberRepo.softDelete(db, {
        memberId: seeded.member.id,
        deletedAt: new Date(),
        deletedBy: seeded.user.id,
      }),
    ]);
    expect(["updated", "owner_invalid"]).toContain(assignment.status);
    expect(deletion?.publicId).toBe(seeded.member.publicId);
    const [subtask] = await db
      .select({ ownerWorkspaceMemberId: cardSubtasks.ownerWorkspaceMemberId })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.publicId, created.subtask.publicId));
    expect(subtask?.ownerWorkspaceMemberId).toBeNull();
  });

  it("keeps subtask and checklist indexes contiguous through reorder and delete", async () => {
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
    const inProgress = initialized.stages.find(
      (stage) => stage.status === "inProgress",
    );
    if (!planned || !inProgress) throw new Error("Stages missing");

    const created = [];
    for (const title of ["First", "Second", "Third"]) {
      const result = await subtaskRepo.createSubtask(db, {
        stagePublicId: planned.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        title,
        createdBy: seeded.user.id,
      });
      if (result.status !== "created" || !result.subtask) {
        throw new Error("Subtask not created");
      }
      created.push(result.subtask);
    }
    const [first, second, third] = created;
    if (!first || !second || !third) throw new Error("Subtasks missing");

    expect(
      await subtaskRepo.reorderSubtasks(db, {
        stagePublicId: planned.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        orderedSubtaskPublicIds: [
          third.publicId,
          first.publicId,
          second.publicId,
        ],
        updatedBy: seeded.user.id,
      }),
    ).toEqual({ status: "reordered" });
    await subtaskRepo.moveSubtask(db, {
      subtaskPublicId: first.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      destinationStagePublicId: inProgress.publicId,
      destinationIndex: 0,
      movedBy: seeded.user.id,
    });
    await subtaskRepo.moveSubtask(db, {
      subtaskPublicId: first.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      destinationStagePublicId: planned.publicId,
      destinationIndex: 1,
      movedBy: seeded.user.id,
    });
    await subtaskRepo.softDeleteSubtask(db, {
      subtaskPublicId: first.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      deletedBy: seeded.user.id,
    });

    const firstItem = await checklistRepo.addChecklistItem(db, {
      subtaskPublicId: third.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "One",
      createdBy: seeded.user.id,
    });
    const secondItem = await checklistRepo.addChecklistItem(db, {
      subtaskPublicId: third.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Two",
      createdBy: seeded.user.id,
    });
    const thirdItem = await checklistRepo.addChecklistItem(db, {
      subtaskPublicId: third.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Three",
      createdBy: seeded.user.id,
    });
    if (
      firstItem.status !== "created" ||
      secondItem.status !== "created" ||
      thirdItem.status !== "created"
    ) {
      throw new Error("Checklist items missing");
    }
    await checklistRepo.reorderChecklistItems(db, {
      subtaskPublicId: third.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      orderedItemPublicIds: [
        thirdItem.item.publicId,
        firstItem.item.publicId,
        secondItem.item.publicId,
      ],
      updatedBy: seeded.user.id,
    });
    await checklistRepo.softDeleteChecklistItem(db, {
      itemPublicId: firstItem.item.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      deletedBy: seeded.user.id,
    });

    const pipeline = await pipelineRepo.getByCardPublicId(
      db,
      seeded.card.publicId,
    );
    if (!pipeline || pipeline.status !== "ready") {
      throw new Error("Pipeline missing");
    }
    const plannedSubtasks = pipeline.stages.find(
      (stage) => stage.status === "planned",
    )?.subtasks;
    expect(plannedSubtasks?.map((subtask) => subtask.title)).toEqual([
      "Third",
      "Second",
    ]);
    expect(plannedSubtasks?.map((subtask) => subtask.index)).toEqual([0, 1]);
    expect(
      plannedSubtasks?.[0]?.checklistItems.map((item) => item.title),
    ).toEqual(["Three", "Two"]);
    expect(
      plannedSubtasks?.[0]?.checklistItems.map((item) => item.index),
    ).toEqual([0, 1]);
  });

  it("links only safe attachments from the same parent and hides deleted hierarchy", async () => {
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
      title: "Use brief",
      ownerPublicId: seeded.member.publicId,
      createdBy: seeded.user.id,
    });
    if (created.status !== "created" || !created.subtask) {
      throw new Error("Subtask not created");
    }

    const [attachment] = await db
      .insert(cardAttachments)
      .values({
        publicId: "attachsafe01",
        cardId: seeded.card.id,
        filename: "brief.pdf",
        originalFilename: "brief.pdf",
        contentType: "application/pdf",
        size: 128,
        s3Key: "workspace/card/brief.pdf",
        createdBy: seeded.user.id,
      })
      .returning();
    const [foreignAttachment] = await db
      .insert(cardAttachments)
      .values({
        publicId: "attachother1",
        cardId: seeded.emptyCard.id,
        filename: "other.pdf",
        originalFilename: "other.pdf",
        contentType: "application/pdf",
        size: 128,
        s3Key: "workspace/other/brief.pdf",
        createdBy: seeded.user.id,
      })
      .returning();
    if (!attachment || !foreignAttachment)
      throw new Error("Attachment missing");

    const linked = await resourceRepo.linkAttachment(db, {
      subtaskPublicId: created.subtask.publicId,
      attachmentPublicId: attachment.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    expect(linked.status).toBe("linked");
    const crossCard = await resourceRepo.linkAttachment(db, {
      subtaskPublicId: created.subtask.publicId,
      attachmentPublicId: foreignAttachment.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    expect(crossCard).toEqual({ status: "attachment_invalid" });

    const pipeline = await pipelineRepo.getByCardPublicId(
      db,
      seeded.card.publicId,
    );
    expect(pipeline?.status).toBe("ready");
    if (!pipeline || pipeline.status !== "ready") {
      throw new Error("Pipeline missing");
    }
    const owner = pipeline.stages.flatMap((stage) => stage.subtasks)[0]?.owner;
    expect(owner).not.toBeNull();
    expect(Object.keys(owner ?? {}).sort()).not.toContain("email");
    expect(
      pipeline.stages.flatMap((stage) => stage.subtasks)[0]?.resources,
    ).toHaveLength(1);

    await db
      .update(boards)
      .set({ deletedAt: new Date() })
      .where(eq(boards.id, seeded.board.id));
    expect(
      await pipelineRepo.getByCardPublicId(db, seeded.card.publicId),
    ).toBeNull();
    expect(
      await subtaskRepo.getSubtaskContextByPublicId(
        db,
        created.subtask.publicId,
      ),
    ).toBeNull();
  });
});
