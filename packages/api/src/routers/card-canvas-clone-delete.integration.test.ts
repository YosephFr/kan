import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import {
  applyNormalizedCanvasTx,
  prepareCardCanvasScene,
} from "@kan/db/repository/cardCanvas.internal";
import * as cardDuplicateRepo from "@kan/db/repository/cardDuplicate.repo";
import * as pipelineRepo from "@kan/db/repository/cardPipeline.repo";
import * as cardResourceRepo from "@kan/db/repository/cardResource.repo";
import * as subtaskRepo from "@kan/db/repository/cardSubtask.repo";
import { lockCardsInWorkspace } from "@kan/db/repository/workspace-boundary";
import {
  cardAttachments,
  cardCanvases,
  cardCanvasFrames,
  cardCanvasResources,
  cardCanvasRevisions,
  cardResources,
  cards,
  cardSubtasks,
  lists,
} from "@kan/db/schema";
import { extractCardCanvasReferences } from "@kan/shared";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

describe("card canvas clone and resource deletion integrations", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
  });

  async function saveSourceCanvas(scene: unknown, expectedVersion = 0) {
    const prepared = await prepareCardCanvasScene(scene);
    return db.transaction(async (tx) => {
      await lockCardsInWorkspace(tx, [seeded.card.id], seeded.workspace.id, {
        cardLock: "update",
      });
      return applyNormalizedCanvasTx(tx, {
        cardId: seeded.card.id,
        expectedVersion,
        prepared,
        actorId: seeded.user.id,
        checkpoint: "none",
      });
    });
  }

  async function createDrive(title = "Canvas brief") {
    const created = await cardResourceRepo.createDrive(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      title,
      driveType: "document",
      driveFileId: `DriveFile${title.replaceAll(" ", "")}`,
      resourceKey: null,
      createdBy: seeded.user.id,
      publicVisibilityAcknowledged: true,
    });
    if (created.status !== "created") throw new Error("Drive resource missing");
    return created.publicId;
  }

  async function createWeb(title = "Canvas research") {
    const [resource] = await db
      .insert(cardResources)
      .values({
        publicId: "canvasweb001",
        cardId: seeded.card.id,
        kind: "web",
        title,
        webUrl: "https://example.com/canvas",
        webUrlHash: "b".repeat(64),
        webDescription: "Canvas research",
        webSiteName: "Example",
        webImageUrl: "https://cdn.example.com/canvas.png",
        createdBy: seeded.user.id,
      })
      .returning({ publicId: cardResources.publicId });
    if (!resource) throw new Error("Web resource missing");
    return resource.publicId;
  }

  async function createSourceSubtask() {
    const initialized = await pipelineRepo.initialize(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    if (initialized.status !== "initialized") {
      throw new Error("Pipeline missing");
    }
    const planned = initialized.stages.find(
      (stage) => stage.status === "planned",
    );
    if (!planned) throw new Error("Planned stage missing");
    const created = await subtaskRepo.createSubtask(db, {
      stagePublicId: planned.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Canvas execution",
      createdBy: seeded.user.id,
    });
    if (created.status !== "created" || !created.subtask) {
      throw new Error("Subtask missing");
    }
    return created.subtask;
  }

  it.each(["replace", "remove"] as const)(
    "mutates the canvas with CAS before deleting a resource in %s mode",
    async (canvasAction) => {
      const resourcePublicId =
        canvasAction === "replace"
          ? await createDrive(canvasAction)
          : await createWeb(canvasAction);
      const saved = await saveSourceCanvas({
        elements: [
          {
            id: "resource-card",
            type: "embeddable",
            customData: { kanResourcePublicId: resourcePublicId },
            link: `kan-resource:${resourcePublicId}`,
          },
        ],
        appState: {},
      });
      expect(saved).toMatchObject({ status: "saved", version: 1 });
      if (saved.status === "conflict") throw new Error("Canvas save failed");

      await expect(
        cardResourceRepo.softDeleteWithWorkspaceGuard(db, {
          resourcePublicId,
          expectedWorkspaceId: seeded.workspace.id,
          deletedBy: seeded.user.id,
          removeReferences: false,
        }),
      ).resolves.toMatchObject({
        status: "in_use",
        canvasReferenceCount: 1,
        canvasVersion: 1,
      });
      await expect(
        cardResourceRepo.softDeleteWithWorkspaceGuard(db, {
          resourcePublicId,
          expectedWorkspaceId: seeded.workspace.id,
          deletedBy: seeded.user.id,
          removeReferences: false,
          canvasAction,
          expectedCanvasVersion: 2,
        }),
      ).resolves.toEqual({
        status: "canvas_version_conflict",
        remoteVersion: 1,
      });
      expect(
        await cardResourceRepo.getByPublicId(db, resourcePublicId),
      ).not.toBeNull();

      await expect(
        cardResourceRepo.softDeleteWithWorkspaceGuard(db, {
          resourcePublicId,
          expectedWorkspaceId: seeded.workspace.id,
          deletedBy: seeded.user.id,
          removeReferences: false,
          canvasAction,
          expectedCanvasVersion: 1,
        }),
      ).resolves.toMatchObject({ status: "deleted" });

      const [head] = await db
        .select({ scene: cardCanvases.scene, version: cardCanvases.version })
        .from(cardCanvases)
        .where(eq(cardCanvases.cardId, seeded.card.id));
      expect(head?.version).toBe(2);
      expect(head?.scene.elements).toEqual(
        canvasAction === "replace"
          ? [expect.objectContaining({ id: "resource-card", type: "text" })]
          : [],
      );
      expect(
        await db
          .select()
          .from(cardCanvasResources)
          .where(eq(cardCanvasResources.canvasId, saved.canvasId)),
      ).toHaveLength(0);
      expect(
        await cardResourceRepo.getByPublicId(db, resourcePublicId),
      ).toBeNull();
    },
  );

  it("clones only the canvas head and remaps link, frame and subtask public IDs", async () => {
    const subtask = await createSourceSubtask();
    const drivePublicId = await createDrive();
    const webPublicId = await createWeb();
    await db.insert(cardAttachments).values({
      publicId: "uploadclone1",
      cardId: seeded.card.id,
      filename: "visual.png",
      originalFilename: "visual.png",
      contentType: "image/png",
      size: 100,
      s3Key: ".objects/uploadclone1",
      createdBy: seeded.user.id,
    });
    const sourceFramePublicId = "frameclone01";
    const sourceSave = await saveSourceCanvas({
      elements: [
        {
          id: "frame-element",
          type: "frame",
          name: "Zona de lanzamiento",
          customData: { kanFramePublicId: sourceFramePublicId },
        },
        {
          id: "drive-card",
          type: "embeddable",
          frameId: "frame-element",
          customData: { kanResourcePublicId: drivePublicId },
          link: `kan-resource:${drivePublicId}`,
        },
        {
          id: "upload-image-a",
          type: "image",
          frameId: "frame-element",
          customData: { kanResourcePublicId: "uploadclone1" },
        },
        {
          id: "web-card",
          type: "embeddable",
          frameId: "frame-element",
          customData: { kanResourcePublicId: webPublicId },
          link: `kan-resource:${webPublicId}`,
        },
        {
          id: "upload-image-b",
          type: "image",
          frameId: "frame-element",
          customData: { kanResourcePublicId: "uploadclone1" },
        },
        {
          id: "subtask-ticket",
          type: "rectangle",
          frameId: "frame-element",
          link: `kan-subtask:${subtask.publicId}`,
        },
        {
          id: "bound-arrow",
          type: "arrow",
          endBinding: { elementId: "upload-image-a", focus: 0, gap: 1 },
        },
      ],
      appState: { viewBackgroundColor: "#ffffff", scrollX: 900 },
    });
    if (sourceSave.status === "conflict") throw new Error("Canvas save failed");
    const [storedSubtask] = await db
      .select({ id: cardSubtasks.id })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.publicId, subtask.publicId));
    if (!storedSubtask) throw new Error("Stored subtask missing");
    await db
      .update(cardCanvasFrames)
      .set({ subtaskId: storedSubtask.id })
      .where(eq(cardCanvasFrames.publicId, sourceFramePublicId));

    const duplicated = await cardDuplicateRepo.duplicateCard(db, {
      sourceCardPublicId: seeded.card.publicId,
      targetListPublicId: seeded.list.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
      copyLabels: false,
      copyMembers: false,
      copyChecklists: false,
      copyPipeline: true,
      publicVisibilityAcknowledged: true,
    });
    if (duplicated.status !== "duplicated") {
      throw new Error("Card duplication failed");
    }
    expect(duplicated.skippedResourceCount).toBe(1);

    const [destinationCard] = await db
      .select({ id: cards.id })
      .from(cards)
      .where(eq(cards.publicId, duplicated.publicId));
    if (!destinationCard) throw new Error("Destination card missing");
    const [destinationCanvas] = await db
      .select({
        id: cardCanvases.id,
        scene: cardCanvases.scene,
        version: cardCanvases.version,
      })
      .from(cardCanvases)
      .where(eq(cardCanvases.cardId, destinationCard.id));
    if (!destinationCanvas) throw new Error("Destination canvas missing");

    expect(destinationCanvas.version).toBe(1);
    expect(destinationCanvas.scene.appState).toEqual({
      viewBackgroundColor: "#ffffff",
    });
    expect(
      destinationCanvas.scene.elements.map((element) => element.id),
    ).not.toContain("upload-image-a");
    expect(
      destinationCanvas.scene.elements.map((element) => element.id),
    ).not.toContain("upload-image-b");
    expect(
      destinationCanvas.scene.elements.find(
        (element) => element.id === "bound-arrow",
      ),
    ).toMatchObject({ endBinding: null });

    const references = extractCardCanvasReferences(destinationCanvas.scene);
    expect(references.frames[0]?.publicId).not.toBe(sourceFramePublicId);
    expect(references.resources).toHaveLength(2);
    expect(
      references.resources.map((resource) => resource.publicId),
    ).not.toContain(drivePublicId);
    expect(
      references.resources.map((resource) => resource.publicId),
    ).not.toContain(webPublicId);
    expect(references.subtaskPublicIds).toHaveLength(1);
    expect(references.subtaskPublicIds[0]).not.toBe(subtask.publicId);
    expect(
      await db
        .select()
        .from(cardCanvasRevisions)
        .where(eq(cardCanvasRevisions.canvasId, destinationCanvas.id)),
    ).toHaveLength(0);

    const [linkedFrame] = await db
      .select({ subtaskPublicId: cardSubtasks.publicId })
      .from(cardCanvasFrames)
      .innerJoin(cardSubtasks, eq(cardCanvasFrames.subtaskId, cardSubtasks.id))
      .where(eq(cardCanvasFrames.canvasId, destinationCanvas.id));
    expect(linkedFrame?.subtaskPublicId).toBe(references.subtaskPublicIds[0]);
  });

  it("clones a canvas head into a live board template without revisions", async () => {
    await saveSourceCanvas({
      elements: [
        {
          id: "template-frame",
          type: "frame",
          name: "Plantilla visual",
          customData: { kanFramePublicId: "frametempl01" },
        },
      ],
      appState: {},
    });

    const template = await boardRepo.createFromSnapshot(db, {
      workspaceId: seeded.workspace.id,
      expectedSourceWorkspaceId: seeded.workspace.id,
      sourceBoardId: seeded.board.id,
      createdBy: seeded.user.id,
      slug: "canvas-template",
      name: "Canvas template",
      type: "template",
    });
    const [templateCard] = await db
      .select({ id: cards.id })
      .from(cards)
      .innerJoin(lists, eq(cards.listId, lists.id))
      .where(
        and(eq(lists.boardId, template.id), eq(cards.title, seeded.card.title)),
      );
    if (!templateCard) throw new Error("Template card missing");
    const [templateCanvas] = await db
      .select({
        id: cardCanvases.id,
        scene: cardCanvases.scene,
        version: cardCanvases.version,
      })
      .from(cardCanvases)
      .where(eq(cardCanvases.cardId, templateCard.id));
    if (!templateCanvas) throw new Error("Template canvas missing");

    expect(templateCanvas.version).toBe(1);
    const templateFramePublicId = extractCardCanvasReferences(
      templateCanvas.scene,
    ).frames[0]?.publicId;
    expect(templateFramePublicId).toBeDefined();
    expect(templateFramePublicId).not.toBe("frametempl01");
    expect(
      await db
        .select()
        .from(cardCanvasRevisions)
        .where(eq(cardCanvasRevisions.canvasId, templateCanvas.id)),
    ).toHaveLength(0);

    const boardFromTemplate = await boardRepo.createFromSnapshot(db, {
      workspaceId: seeded.workspace.id,
      expectedSourceWorkspaceId: seeded.workspace.id,
      sourceBoardId: template.id,
      createdBy: seeded.user.id,
      slug: "canvas-from-template",
      name: "Canvas from template",
      type: "regular",
    });
    const [boardCard] = await db
      .select({ id: cards.id })
      .from(cards)
      .innerJoin(lists, eq(cards.listId, lists.id))
      .where(
        and(
          eq(lists.boardId, boardFromTemplate.id),
          eq(cards.title, seeded.card.title),
        ),
      );
    if (!boardCard) throw new Error("Board card missing");
    const [boardCanvas] = await db
      .select({ id: cardCanvases.id, scene: cardCanvases.scene })
      .from(cardCanvases)
      .where(eq(cardCanvases.cardId, boardCard.id));
    if (!boardCanvas) throw new Error("Board canvas missing");
    const boardFramePublicId = extractCardCanvasReferences(boardCanvas.scene)
      .frames[0]?.publicId;
    expect(boardFramePublicId).toBeDefined();
    expect(boardFramePublicId).not.toBe(templateFramePublicId);
    expect(
      await db
        .select()
        .from(cardCanvasRevisions)
        .where(eq(cardCanvasRevisions.canvasId, boardCanvas.id)),
    ).toHaveLength(0);
  });

  it("leaves a cloned frame unlinked when its source subtask was deleted", async () => {
    const subtask = await createSourceSubtask();
    const sourceFramePublicId = "framedel0001";
    const sourceSave = await saveSourceCanvas({
      elements: [
        {
          id: "deleted-subtask-frame",
          type: "frame",
          customData: { kanFramePublicId: sourceFramePublicId },
        },
      ],
      appState: {},
    });
    if (sourceSave.status === "conflict") throw new Error("Canvas save failed");
    const [storedSubtask] = await db
      .select({ id: cardSubtasks.id })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.publicId, subtask.publicId));
    if (!storedSubtask) throw new Error("Stored subtask missing");
    await db
      .update(cardCanvasFrames)
      .set({ subtaskId: storedSubtask.id })
      .where(eq(cardCanvasFrames.publicId, sourceFramePublicId));
    await expect(
      subtaskRepo.softDeleteSubtask(db, {
        subtaskPublicId: subtask.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        deletedBy: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "deleted" });

    const duplicated = await cardDuplicateRepo.duplicateCard(db, {
      sourceCardPublicId: seeded.card.publicId,
      targetListPublicId: seeded.list.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
      copyLabels: false,
      copyMembers: false,
      copyChecklists: false,
      copyPipeline: true,
      publicVisibilityAcknowledged: true,
    });
    if (duplicated.status !== "duplicated") {
      throw new Error("Card duplication failed");
    }
    const [destinationCanvas] = await db
      .select({ id: cardCanvases.id })
      .from(cardCanvases)
      .innerJoin(cards, eq(cardCanvases.cardId, cards.id))
      .where(eq(cards.publicId, duplicated.publicId));
    if (!destinationCanvas) throw new Error("Destination canvas missing");
    const [destinationFrame] = await db
      .select({
        publicId: cardCanvasFrames.publicId,
        subtaskId: cardCanvasFrames.subtaskId,
      })
      .from(cardCanvasFrames)
      .where(eq(cardCanvasFrames.canvasId, destinationCanvas.id));

    expect(destinationFrame?.publicId).not.toBe(sourceFramePublicId);
    expect(destinationFrame?.subtaskId).toBeNull();
  });

  it("preserves frames but clears live subtask links when the pipeline is not copied", async () => {
    const subtask = await createSourceSubtask();
    const sourceFramePublicId = "framenopipe1";
    const sourceSave = await saveSourceCanvas({
      elements: [
        {
          id: "unlinked-frame",
          type: "frame",
          customData: { kanFramePublicId: sourceFramePublicId },
        },
        {
          id: "unlinked-ticket",
          type: "rectangle",
          frameId: "unlinked-frame",
          link: `kan-subtask:${subtask.publicId}`,
        },
        {
          id: "unlinked-embed",
          type: "embeddable",
          frameId: "unlinked-frame",
          link: `kan-subtask:${subtask.publicId}`,
        },
      ],
      appState: {},
    });
    if (sourceSave.status === "conflict") throw new Error("Canvas save failed");
    const [storedSubtask] = await db
      .select({ id: cardSubtasks.id })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.publicId, subtask.publicId));
    if (!storedSubtask) throw new Error("Stored subtask missing");
    await db
      .update(cardCanvasFrames)
      .set({ subtaskId: storedSubtask.id })
      .where(eq(cardCanvasFrames.publicId, sourceFramePublicId));

    const duplicated = await cardDuplicateRepo.duplicateCard(db, {
      sourceCardPublicId: seeded.card.publicId,
      targetListPublicId: seeded.list.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
      copyLabels: false,
      copyMembers: false,
      copyChecklists: false,
      copyPipeline: false,
      publicVisibilityAcknowledged: true,
    });
    if (duplicated.status !== "duplicated") {
      throw new Error("Card duplication failed");
    }
    const [destinationCanvas] = await db
      .select({ id: cardCanvases.id, scene: cardCanvases.scene })
      .from(cardCanvases)
      .innerJoin(cards, eq(cardCanvases.cardId, cards.id))
      .where(eq(cards.publicId, duplicated.publicId));
    if (!destinationCanvas) throw new Error("Destination canvas missing");

    const references = extractCardCanvasReferences(destinationCanvas.scene);
    expect(references.frames).toHaveLength(1);
    expect(references.frames[0]?.publicId).not.toBe(sourceFramePublicId);
    expect(references.subtaskPublicIds).toEqual([]);
    expect(
      destinationCanvas.scene.elements.find(
        (element) => element.id === "unlinked-ticket",
      ),
    ).toMatchObject({ link: null });
    expect(
      destinationCanvas.scene.elements.find(
        (element) => element.id === "unlinked-embed",
      ),
    ).toBeUndefined();
    const [destinationFrame] = await db
      .select({ subtaskId: cardCanvasFrames.subtaskId })
      .from(cardCanvasFrames)
      .where(eq(cardCanvasFrames.canvasId, destinationCanvas.id));
    expect(destinationFrame?.subtaskId).toBeNull();
  });
});
