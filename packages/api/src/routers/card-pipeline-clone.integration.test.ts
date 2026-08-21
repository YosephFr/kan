import { beforeEach, describe, expect, it } from "vitest";

import * as pipelineRepo from "@kan/db/repository/cardPipeline.repo";
import * as subtaskRepo from "@kan/db/repository/cardSubtask.repo";
import * as checklistRepo from "@kan/db/repository/cardSubtaskChecklist.repo";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

describe("card pipeline clone", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
  });

  it("keeps source and destination roles when the source card ID sorts last", async () => {
    expect(seeded.emptyCard.id).toBeGreaterThan(seeded.card.id);
    const initialized = await pipelineRepo.initialize(db, {
      cardPublicId: seeded.emptyCard.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    if (initialized.status !== "initialized") {
      throw new Error("Source pipeline not initialized");
    }
    const planned = initialized.stages.find(
      (stage) => stage.status === "planned",
    );
    if (!planned) throw new Error("Planned stage missing");
    await subtaskRepo.createSubtask(db, {
      stagePublicId: planned.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Clone from higher ID",
      createdBy: seeded.user.id,
    });

    const cloned = await pipelineRepo.clonePipelineForCard(db, {
      sourceCardId: seeded.emptyCard.id,
      destinationCardId: seeded.card.id,
      expectedSourceWorkspaceId: seeded.workspace.id,
      expectedDestinationWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });

    expect(cloned.status).toBe("cloned");
    const destination = await pipelineRepo.getByCardPublicId(
      db,
      seeded.card.publicId,
    );
    expect(destination?.status).toBe("ready");
    if (!destination || destination.status !== "ready") {
      throw new Error("Destination pipeline missing");
    }
    expect(
      destination.stages.find((stage) => stage.status === "planned")?.subtasks,
    ).toEqual([expect.objectContaining({ title: "Clone from higher ID" })]);
  });

  it("keeps each checklist attached to its source subtask", async () => {
    const initialized = await pipelineRepo.initialize(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    if (initialized.status !== "initialized") {
      throw new Error("Source pipeline not initialized");
    }
    const planned = initialized.stages.find(
      (stage) => stage.status === "planned",
    );
    if (!planned) throw new Error("Planned stage missing");

    for (const [title, checklistTitle] of [
      ["Prepare offer", "Approve pricing"],
      ["Publish offer", "Verify landing page"],
    ] as const) {
      const created = await subtaskRepo.createSubtask(db, {
        stagePublicId: planned.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        title,
        createdBy: seeded.user.id,
      });
      if (created.status !== "created" || !created.subtask) {
        throw new Error("Source subtask missing");
      }
      const checklist = await checklistRepo.addChecklistItem(db, {
        subtaskPublicId: created.subtask.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        title: checklistTitle,
        createdBy: seeded.user.id,
      });
      if (checklist.status !== "created") {
        throw new Error("Source checklist missing");
      }
    }

    const cloned = await pipelineRepo.clonePipelineForCard(db, {
      sourceCardId: seeded.card.id,
      destinationCardId: seeded.emptyCard.id,
      expectedSourceWorkspaceId: seeded.workspace.id,
      expectedDestinationWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    expect(cloned.status).toBe("cloned");

    const destination = await pipelineRepo.getByCardPublicId(
      db,
      seeded.emptyCard.publicId,
    );
    if (!destination || destination.status !== "ready") {
      throw new Error("Destination pipeline missing");
    }
    const clonedByTitle = new Map(
      destination.stages
        .flatMap((stage) => stage.subtasks)
        .map((subtask) => [subtask.title, subtask]),
    );
    expect(clonedByTitle.get("Prepare offer")?.checklistItems).toEqual([
      expect.objectContaining({ title: "Approve pricing", completed: false }),
    ]);
    expect(clonedByTitle.get("Publish offer")?.checklistItems).toEqual([
      expect.objectContaining({
        title: "Verify landing page",
        completed: false,
      }),
    ]);
  });
});
