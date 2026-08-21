import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as pipelineRepo from "@kan/db/repository/cardPipeline.repo";
import * as subtaskRepo from "@kan/db/repository/cardSubtask.repo";
import * as memberRepo from "@kan/db/repository/member.repo";
import { cardSubtasks, workspaceMembers } from "@kan/db/schema";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

describe("subtask owner member races", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
  });

  it("preserves a valid reassignment concurrent with deleting the previous owner", async () => {
    const [replacementMember] = await db
      .insert(workspaceMembers)
      .values({
        publicId: "memberpipe03",
        email: "replacement@example.com",
        userId: seeded.user.id,
        workspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
        role: "member",
        status: "active",
      })
      .returning();
    if (!replacementMember) throw new Error("Replacement member missing");

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
      title: "Concurrent reassignment",
      createdBy: seeded.user.id,
    });
    if (created.status !== "created" || !created.subtask) {
      throw new Error("Subtask not created");
    }
    const subtaskPublicId = created.subtask.publicId;

    const firstAttempt = await memberRepo.softDeleteMemberAttempt(
      db,
      {
        memberId: seeded.member.id,
        deletedAt: new Date(),
        deletedBy: seeded.user.id,
      },
      {
        afterInitialCardLocks: async (tx) => {
          await tx
            .update(cardSubtasks)
            .set({ ownerWorkspaceMemberId: seeded.member.id })
            .where(eq(cardSubtasks.publicId, subtaskPublicId));
        },
      },
    );
    expect(firstAttempt).toEqual({ status: "retry" });

    const [reassignment, deletion] = await Promise.all([
      subtaskRepo.setSubtaskOwner(db, {
        subtaskPublicId,
        ownerPublicId: replacementMember.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        updatedBy: seeded.user.id,
      }),
      memberRepo.softDelete(db, {
        memberId: seeded.member.id,
        deletedAt: new Date(),
        deletedBy: seeded.user.id,
      }),
    ]);

    expect(reassignment.status).toBe("updated");
    expect(deletion?.publicId).toBe(seeded.member.publicId);
    const [subtask] = await db
      .select({ ownerWorkspaceMemberId: cardSubtasks.ownerWorkspaceMemberId })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.publicId, subtaskPublicId));
    expect(subtask?.ownerWorkspaceMemberId).toBe(replacementMember.id);
  });
});
