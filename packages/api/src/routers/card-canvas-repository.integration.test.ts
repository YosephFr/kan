import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyNormalizedCanvasTx,
  CardCanvasReferenceError,
  prepareCardCanvasScene,
} from "@kan/db/repository/cardCanvas.internal";
import * as canvasRepo from "@kan/db/repository/cardCanvas.repo";
import * as pipelineRepo from "@kan/db/repository/cardPipeline.repo";
import * as resourceRepo from "@kan/db/repository/cardResource.repo";
import * as subtaskRepo from "@kan/db/repository/cardSubtask.repo";
import { lockCardsInWorkspace } from "@kan/db/repository/workspace-boundary";
import {
  cardActivities,
  cardAttachments,
  cardCanvases,
  cardCanvasFrames,
  cardCanvasRevisions,
  cardPipelineStages,
  cardSubtasks,
} from "@kan/db/schema";
import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_IMAGE_RESOURCES,
} from "@kan/shared";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

const frameScene = (
  framePublicId: string,
  name = "Zona principal",
  extraElements: object[] = [],
) => ({
  elements: [
    {
      id: `element-${framePublicId}`,
      type: "frame",
      name,
      customData: { kanFramePublicId: framePublicId },
    },
    ...extraElements,
  ],
  appState: { viewBackgroundColor: "#ffffff" },
});

describe("card canvas repository", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
  });

  it("does not initialize on read and applies CAS, hash no-op and frame tombstones", async () => {
    await expect(
      canvasRepo.getSnapshot(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        requirePublic: true,
      }),
    ).resolves.toBeNull();
    expect(await db.select().from(cardCanvases)).toHaveLength(0);
    expect(
      await canvasRepo.getPresenceByCardPublicIds(db, [
        seeded.card.publicId,
        seeded.emptyCard.publicId,
      ]),
    ).toEqual(
      new Map([
        [seeded.card.publicId, false],
        [seeded.emptyCard.publicId, false],
      ]),
    );

    const original = frameScene("framecore001");
    const created = await canvasRepo.save(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      scene: original,
      actorId: seeded.user.id,
    });
    expect(created).toMatchObject({ status: "saved", version: 1 });
    expect(
      await canvasRepo.getPresenceByCardPublicIds(db, [
        seeded.card.publicId,
        seeded.emptyCard.publicId,
      ]),
    ).toEqual(
      new Map([
        [seeded.card.publicId, true],
        [seeded.emptyCard.publicId, false],
      ]),
    );

    await expect(
      canvasRepo.save(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        scene: original,
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "unchanged", version: 1 });
    await expect(
      canvasRepo.save(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        scene: { elements: [], appState: {} },
        actorId: seeded.user.id,
      }),
    ).resolves.toEqual({
      status: "conflict",
      code: "CANVAS_VERSION_CONFLICT",
      remoteVersion: 1,
    });

    const [initialFrame] = await db
      .select({ id: cardCanvasFrames.id })
      .from(cardCanvasFrames)
      .where(eq(cardCanvasFrames.publicId, "framecore001"));
    await canvasRepo.save(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 1,
      scene: { elements: [], appState: {} },
      actorId: seeded.user.id,
    });
    await expect(
      canvasRepo.listFrames(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        requirePublic: true,
      }),
    ).resolves.toEqual([]);
    await expect(
      canvasRepo.listFrames(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        requirePublic: false,
        includeTombstones: true,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ publicId: "framecore001", present: false }),
    ]);

    await canvasRepo.save(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 2,
      scene: original,
      actorId: seeded.user.id,
    });
    const [restoredFrame] = await db
      .select({ id: cardCanvasFrames.id, present: cardCanvasFrames.present })
      .from(cardCanvasFrames)
      .where(eq(cardCanvasFrames.publicId, "framecore001"));
    expect(restoredFrame).toEqual({ id: initialFrame?.id, present: true });
  });

  it("checkpoints at most every fifteen minutes and restores as a new version", async () => {
    const firstScene = await prepareCardCanvasScene(frameScene("framerevise1"));
    const secondScene = await prepareCardCanvasScene(
      frameScene("framerevise1", "Zona revisada"),
    );
    const now = new Date();
    const createdAt = new Date(now.getTime() - 16 * 60 * 1000);

    await db.transaction(async (tx) => {
      await lockCardsInWorkspace(tx, [seeded.card.id], seeded.workspace.id, {
        cardLock: "update",
      });
      await applyNormalizedCanvasTx(tx, {
        cardId: seeded.card.id,
        expectedVersion: 0,
        prepared: firstScene,
        actorId: seeded.user.id,
        now: createdAt,
      });
    });
    await db.transaction(async (tx) => {
      await lockCardsInWorkspace(tx, [seeded.card.id], seeded.workspace.id, {
        cardLock: "update",
      });
      await applyNormalizedCanvasTx(tx, {
        cardId: seeded.card.id,
        expectedVersion: 1,
        prepared: secondScene,
        actorId: seeded.user.id,
        now,
      });
    });

    const revisions = await canvasRepo.listRevisions(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ version: 1, kind: "automatic" });
    if (!revisions[0]) throw new Error("Revision missing");

    await expect(
      canvasRepo.restore(db, {
        cardPublicId: seeded.card.publicId,
        revisionPublicId: revisions[0].publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 2,
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 3 });
    const head = await canvasRepo.getSnapshot(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      requirePublic: false,
    });
    expect(head?.scene).toEqual(firstScene.scene);
    expect(
      await db
        .select()
        .from(cardCanvasRevisions)
        .where(eq(cardCanvasRevisions.kind, "preRestore")),
    ).toHaveLength(1);
  });

  it("rejects resource, subtask and frame references owned by another card", async () => {
    const resource = await resourceRepo.createDrive(db, {
      cardId: seeded.card.id,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Source resource",
      driveType: "document",
      driveFileId: "CrossCardResource",
      resourceKey: null,
      createdBy: seeded.user.id,
      publicVisibilityAcknowledged: true,
    });
    if (resource.status !== "created") throw new Error("Resource missing");
    const initialized = await pipelineRepo.initialize(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
    });
    if (initialized.status !== "initialized")
      throw new Error("Pipeline missing");
    const stage = initialized.stages.find((item) => item.status === "planned");
    if (!stage) throw new Error("Stage missing");
    const subtask = await subtaskRepo.createSubtask(db, {
      stagePublicId: stage.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      title: "Source subtask",
      createdBy: seeded.user.id,
    });
    if (subtask.status !== "created" || !subtask.subtask) {
      throw new Error("Subtask missing");
    }

    await canvasRepo.save(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      scene: frameScene("framecross01"),
      actorId: seeded.user.id,
    });

    for (const scene of [
      {
        elements: [
          {
            id: "foreign-resource",
            type: "embeddable",
            customData: { kanResourcePublicId: resource.publicId },
          },
        ],
        appState: {},
      },
      {
        elements: [
          {
            id: "foreign-subtask",
            type: "rectangle",
            link: `kan-subtask:${subtask.subtask.publicId}`,
          },
        ],
        appState: {},
      },
      frameScene("framecross01"),
    ]) {
      await expect(
        canvasRepo.save(db, {
          cardPublicId: seeded.emptyCard.publicId,
          expectedWorkspaceId: seeded.workspace.id,
          expectedVersion: 0,
          scene,
          actorId: seeded.user.id,
        }),
      ).rejects.toBeInstanceOf(CardCanvasReferenceError);
    }
    expect(
      await db
        .select()
        .from(cardCanvases)
        .where(eq(cardCanvases.cardId, seeded.emptyCard.id)),
    ).toHaveLength(0);

    const clean = await canvasRepo.save(db, {
      cardPublicId: seeded.emptyCard.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      scene: { elements: [], appState: {} },
      actorId: seeded.user.id,
    });
    if (clean.status === "conflict") throw new Error("Clean canvas missing");
    const foreignRevision = await prepareCardCanvasScene({
      elements: [
        {
          id: "foreign-restore-resource",
          type: "embeddable",
          customData: { kanResourcePublicId: resource.publicId },
        },
      ],
      appState: {},
    });
    await db.insert(cardCanvasRevisions).values({
      publicId: "revisionbad1",
      canvasId: clean.canvasId,
      sourceVersion: 1,
      kind: "automatic",
      scene: foreignRevision.scene,
      hash: foreignRevision.hash,
      bytes: foreignRevision.bytes,
      elementCount: foreignRevision.elementCount,
      createdBy: seeded.user.id,
    });
    await expect(
      canvasRepo.restore(db, {
        cardPublicId: seeded.emptyCard.publicId,
        revisionPublicId: "revisionbad1",
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        actorId: seeded.user.id,
      }),
    ).rejects.toBeInstanceOf(CardCanvasReferenceError);
    await expect(
      canvasRepo.getSnapshot(db, {
        cardPublicId: seeded.emptyCard.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        requirePublic: false,
      }),
    ).resolves.toMatchObject({ version: 1, elementCount: 0 });
  });

  it("enforces image byte and resource budgets before saving a canvas", async () => {
    const aggregatePublicIds = ["imagebudget1", "imagebudget2", "imagebudget3"];
    await db.insert(cardAttachments).values(
      aggregatePublicIds.map((publicId, index) => ({
        publicId,
        cardId: seeded.card.id,
        filename: `${publicId}.png`,
        originalFilename: `${publicId}.png`,
        contentType: "image/png",
        size: index < 2 ? MAX_CARD_CANVAS_IMAGE_BYTES : 1,
        s3Key: `.objects/${publicId}`,
        createdBy: seeded.user.id,
      })),
    );
    const imageScene = (publicIds: string[]) => ({
      elements: publicIds.map((publicId) => ({
        id: `element-${publicId}`,
        type: "image",
        customData: { kanResourcePublicId: publicId },
      })),
      appState: {},
    });

    await expect(
      canvasRepo.save(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        scene: imageScene(aggregatePublicIds.slice(0, 2)),
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 1 });
    await expect(
      canvasRepo.save(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        scene: imageScene(aggregatePublicIds),
        actorId: seeded.user.id,
      }),
    ).rejects.toBeInstanceOf(CardCanvasReferenceError);
    await expect(
      canvasRepo.getSnapshot(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        requirePublic: false,
      }),
    ).resolves.toMatchObject({ version: 1, elementCount: 2 });

    await db.insert(cardAttachments).values({
      publicId: "imgoversize1",
      cardId: seeded.emptyCard.id,
      filename: "oversized.png",
      originalFilename: "oversized.png",
      contentType: "image/png",
      size: MAX_CARD_CANVAS_IMAGE_BYTES + 1,
      s3Key: ".objects/imgoversize1",
      createdBy: seeded.user.id,
    });
    await expect(
      canvasRepo.save(db, {
        cardPublicId: seeded.emptyCard.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        scene: imageScene(["imgoversize1"]),
        actorId: seeded.user.id,
      }),
    ).rejects.toBeInstanceOf(CardCanvasReferenceError);
  });

  it("accepts the exact image count limit and rejects one more", async () => {
    const publicIds = Array.from(
      { length: MAX_CARD_CANVAS_IMAGE_RESOURCES + 1 },
      (_, index) => `img${String(index).padStart(9, "0")}`,
    );
    await db.insert(cardAttachments).values(
      publicIds.map((publicId) => ({
        publicId,
        cardId: seeded.card.id,
        filename: `${publicId}.png`,
        originalFilename: `${publicId}.png`,
        contentType: "image/png",
        size: 1,
        s3Key: `.objects/${publicId}`,
        createdBy: seeded.user.id,
      })),
    );
    const imageScene = (selected: string[]) => ({
      elements: selected.map((publicId) => ({
        id: `element-${publicId}`,
        type: "image",
        customData: { kanResourcePublicId: publicId },
      })),
      appState: {},
    });

    await expect(
      canvasRepo.save(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        scene: imageScene(publicIds.slice(0, MAX_CARD_CANVAS_IMAGE_RESOURCES)),
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 1 });
    await expect(
      canvasRepo.save(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        scene: imageScene(publicIds),
        actorId: seeded.user.id,
      }),
    ).rejects.toBeInstanceOf(CardCanvasReferenceError);
  });

  it("converts a frame atomically, initializes lifecycle and rolls back invalid conversion", async () => {
    const converted = await canvasRepo.convertFrame(db, {
      cardPublicId: seeded.card.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      framePublicId: "frameconvert",
      expectedVersion: 0,
      scene: frameScene("frameconvert"),
      targetStageStatus: "inProgress",
      subtaskFields: {
        title: "Ejecutar zona",
        ownerPublicId: seeded.member.publicId,
      },
      actorId: seeded.user.id,
    });
    expect(converted).toMatchObject({ status: "saved", version: 1 });
    if (converted.status === "conflict") throw new Error("Conversion failed");

    const [createdSubtask] = await db
      .select({
        startedAt: cardSubtasks.startedAt,
        completedAt: cardSubtasks.completedAt,
      })
      .from(cardSubtasks)
      .where(eq(cardSubtasks.publicId, converted.subtaskPublicId));
    expect(createdSubtask?.startedAt).toBeInstanceOf(Date);
    expect(createdSubtask?.completedAt).toBeNull();
    expect(await db.select().from(cardPipelineStages)).toHaveLength(4);
    expect(
      await db
        .select()
        .from(cardActivities)
        .where(
          and(
            eq(cardActivities.cardId, seeded.card.id),
            eq(cardActivities.type, "card.updated.subtask.added"),
          ),
        ),
    ).toHaveLength(1);

    const pipeline = await pipelineRepo.getByCardPublicId(
      db,
      seeded.card.publicId,
    );
    if (!pipeline || pipeline.status !== "ready") {
      throw new Error("Pipeline not ready");
    }
    const projected = pipeline.stages
      .flatMap((stage) => stage.subtasks)
      .find((subtask) => subtask.publicId === converted.subtaskPublicId);
    expect(projected?.canvasFrame).toEqual({
      publicId: "frameconvert",
      name: "Zona principal",
    });

    await expect(
      canvasRepo.convertFrame(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        framePublicId: "frameconvert",
        expectedVersion: 1,
        targetStageStatus: "planned",
        subtaskFields: { title: "Duplicada" },
        actorId: seeded.user.id,
      }),
    ).rejects.toMatchObject({ code: "CANVAS_FRAME_ALREADY_LINKED" });

    await expect(
      canvasRepo.convertFrame(db, {
        cardPublicId: seeded.card.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        framePublicId: "frameinvalid",
        expectedVersion: 1,
        scene: {
          elements: [
            ...frameScene("frameconvert").elements,
            ...frameScene("frameinvalid").elements,
          ],
          appState: {},
        },
        targetStageStatus: "planned",
        subtaskFields: {
          title: "Debe revertirse",
          ownerPublicId: seeded.otherMember.publicId,
        },
        actorId: seeded.user.id,
      }),
    ).rejects.toMatchObject({ code: "SUBTASK_OWNER_INVALID" });

    const [head] = await db
      .select({ version: cardCanvases.version })
      .from(cardCanvases)
      .where(eq(cardCanvases.cardId, seeded.card.id));
    expect(head?.version).toBe(1);
    expect(
      await db
        .select()
        .from(cardCanvasFrames)
        .where(eq(cardCanvasFrames.publicId, "frameinvalid")),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(cardSubtasks)
        .where(eq(cardSubtasks.cardId, seeded.card.id)),
    ).toHaveLength(1);
  });
});
