import { and, asc, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as commentRepo from "@kan/db/repository/cardComment.repo";
import * as checklistRepo from "@kan/db/repository/checklist.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";
import {
  boards,
  cardActivities,
  checklistItems,
  checklists,
  comments,
} from "@kan/db/schema";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

describe("checklist and comment workspace boundaries", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
  });

  it("writes comment activities atomically and rejects a stale workspace", async () => {
    const created = await commentRepo.create(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      comment: "Primera versión",
      createdBy: seeded.user.id,
    });
    if (!created) throw new Error("Comment missing");

    expect(
      await db
        .select({
          type: cardActivities.type,
          toComment: cardActivities.toComment,
        })
        .from(cardActivities)
        .where(eq(cardActivities.commentId, created.id)),
    ).toEqual([
      {
        type: "card.updated.comment.added",
        toComment: "Primera versión",
      },
    ]);

    await db
      .update(boards)
      .set({ workspaceId: seeded.otherWorkspace.id })
      .where(eq(boards.id, seeded.board.id));

    await expect(
      commentRepo.update(db, {
        id: created.id,
        cardId: seeded.card.id,
        expectedWorkspaceId: seeded.workspace.id,
        comment: "No autorizado",
        updatedBy: seeded.user.id,
      }),
    ).rejects.toBeInstanceOf(WorkspaceChangedError);
    expect(
      await db
        .select({ comment: comments.comment })
        .from(comments)
        .where(eq(comments.id, created.id)),
    ).toEqual([{ comment: "Primera versión" }]);

    const updated = await commentRepo.update(db, {
      id: created.id,
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.otherWorkspace.id,
      comment: "Segunda versión",
      updatedBy: seeded.user.id,
    });
    expect(updated.comment).toBe("Segunda versión");

    await commentRepo.softDelete(db, {
      commentId: created.id,
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.otherWorkspace.id,
      deletedAt: new Date("2026-08-21T18:00:00.000Z"),
      deletedBy: seeded.user.id,
    });
    expect(
      await db
        .select({ type: cardActivities.type })
        .from(cardActivities)
        .where(eq(cardActivities.commentId, created.id))
        .orderBy(asc(cardActivities.id)),
    ).toEqual([
      { type: "card.updated.comment.added" },
      { type: "card.updated.comment.updated" },
      { type: "card.updated.comment.deleted" },
    ]);
  });

  it("keeps checklist mutations and their activities in the same boundary", async () => {
    const checklist = await checklistRepo.create(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      name: "Producción",
      createdBy: seeded.user.id,
    });
    if (!checklist) throw new Error("Checklist missing");
    const first = await checklistRepo.createItem(db, {
      checklistId: checklist.id,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Guion",
      createdBy: seeded.user.id,
    });
    const second = await checklistRepo.createItem(db, {
      checklistId: checklist.id,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Grabación",
      createdBy: seeded.user.id,
    });
    if (!first || !second) throw new Error("Checklist items missing");

    await checklistRepo.updateChecklistById(db, {
      id: checklist.id,
      expectedWorkspaceId: seeded.workspace.id,
      name: "Ejecución",
      updatedBy: seeded.user.id,
    });
    await checklistRepo.updateItemById(db, {
      id: first.id,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Guion aprobado",
      completed: true,
      updatedBy: seeded.user.id,
    });
    await checklistRepo.reorderItem(db, {
      itemId: second.id,
      newIndex: 0,
      expectedWorkspaceId: seeded.workspace.id,
    });
    expect(
      await db
        .select({ title: checklistItems.title, index: checklistItems.index })
        .from(checklistItems)
        .where(
          and(
            eq(checklistItems.checklistId, checklist.id),
            isNull(checklistItems.deletedAt),
          ),
        )
        .orderBy(asc(checklistItems.index)),
    ).toEqual([
      { title: "Grabación", index: 0 },
      { title: "Guion aprobado", index: 1 },
    ]);

    await checklistRepo.softDeleteById(db, {
      id: checklist.id,
      expectedWorkspaceId: seeded.workspace.id,
      deletedAt: new Date("2026-08-21T18:00:00.000Z"),
      deletedBy: seeded.user.id,
    });
    expect(
      await db
        .select({ deletedAt: checklists.deletedAt })
        .from(checklists)
        .where(eq(checklists.id, checklist.id)),
    ).toEqual([{ deletedAt: new Date("2026-08-21T18:00:00.000Z") }]);
    expect(
      await db
        .select({ deletedAt: checklistItems.deletedAt })
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, checklist.id)),
    ).toEqual([
      { deletedAt: new Date("2026-08-21T18:00:00.000Z") },
      { deletedAt: new Date("2026-08-21T18:00:00.000Z") },
    ]);

    const types = await db
      .select({ type: cardActivities.type })
      .from(cardActivities)
      .where(eq(cardActivities.cardId, seeded.card.id))
      .orderBy(asc(cardActivities.id));
    expect(types.map(({ type }) => type)).toEqual([
      "card.updated.checklist.added",
      "card.updated.checklist.item.added",
      "card.updated.checklist.item.added",
      "card.updated.checklist.renamed",
      "card.updated.checklist.item.completed",
      "card.updated.checklist.item.updated",
      "card.updated.checklist.deleted",
    ]);
  });

  it("rejects every checklist write after the board crosses workspaces", async () => {
    const checklist = await checklistRepo.create(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      name: "Seguridad",
      createdBy: seeded.user.id,
    });
    if (!checklist) throw new Error("Checklist missing");
    const item = await checklistRepo.createItem(db, {
      checklistId: checklist.id,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Revisar",
      createdBy: seeded.user.id,
    });
    if (!item) throw new Error("Checklist item missing");
    const activityCountBefore = await db
      .select({ id: cardActivities.id })
      .from(cardActivities);

    await db
      .update(boards)
      .set({ workspaceId: seeded.otherWorkspace.id })
      .where(eq(boards.id, seeded.board.id));

    const staleWrites = [
      () =>
        checklistRepo.create(db, {
          cardId: seeded.card.id,
          expectedWorkspaceId: seeded.workspace.id,
          name: "No crear",
          createdBy: seeded.user.id,
        }),
      () =>
        checklistRepo.updateChecklistById(db, {
          id: checklist.id,
          expectedWorkspaceId: seeded.workspace.id,
          name: "No renombrar",
          updatedBy: seeded.user.id,
        }),
      () =>
        checklistRepo.createItem(db, {
          checklistId: checklist.id,
          expectedWorkspaceId: seeded.workspace.id,
          title: "No crear",
          createdBy: seeded.user.id,
        }),
      () =>
        checklistRepo.updateItemById(db, {
          id: item.id,
          expectedWorkspaceId: seeded.workspace.id,
          title: "No editar",
          updatedBy: seeded.user.id,
        }),
      () =>
        checklistRepo.reorderItem(db, {
          itemId: item.id,
          newIndex: 1,
          expectedWorkspaceId: seeded.workspace.id,
        }),
      () =>
        checklistRepo.softDeleteItemById(db, {
          id: item.id,
          expectedWorkspaceId: seeded.workspace.id,
          deletedAt: new Date(),
          deletedBy: seeded.user.id,
        }),
      () =>
        checklistRepo.softDeleteById(db, {
          id: checklist.id,
          expectedWorkspaceId: seeded.workspace.id,
          deletedAt: new Date(),
          deletedBy: seeded.user.id,
        }),
      () =>
        checklistRepo.bulkCreate(
          db,
          [
            {
              cardId: seeded.card.id,
              name: "No importar",
              createdBy: seeded.user.id,
              index: 0,
            },
          ],
          seeded.workspace.id,
        ),
      () =>
        checklistRepo.bulkCreateItems(
          db,
          [
            {
              checklistId: checklist.id,
              title: "No importar",
              createdBy: seeded.user.id,
              index: 0,
              completed: false,
            },
          ],
          seeded.workspace.id,
        ),
    ];
    for (const write of staleWrites) {
      await expect(write()).rejects.toBeInstanceOf(WorkspaceChangedError);
    }

    expect(
      await db
        .select({ name: checklists.name, deletedAt: checklists.deletedAt })
        .from(checklists)
        .where(eq(checklists.id, checklist.id)),
    ).toEqual([{ name: "Seguridad", deletedAt: null }]);
    expect(
      await db
        .select({
          title: checklistItems.title,
          deletedAt: checklistItems.deletedAt,
        })
        .from(checklistItems)
        .where(eq(checklistItems.id, item.id)),
    ).toEqual([{ title: "Revisar", deletedAt: null }]);
    expect(
      await db.select({ id: cardActivities.id }).from(cardActivities),
    ).toHaveLength(activityCountBefore.length);
  });
});
