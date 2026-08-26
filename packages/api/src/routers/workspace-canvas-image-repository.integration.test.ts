import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as canvasRepo from "@kan/db/repository/workspaceCanvas.repo";
import * as canvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";
import { WorkspaceCanvasImageReferenceError } from "@kan/db/repository/workspaceCanvasImage.repo";
import {
  users,
  workspaceCanvases,
  workspaceCanvasImageReferences,
  workspaceCanvasImages,
  workspaceCanvasImageUploadSessions,
  workspaceCanvasRevisions,
  workspaceMemberPermissions,
  workspaceMembers,
} from "@kan/db/schema";
import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
} from "@kan/shared";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

describe("workspace canvas image repository", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
  });

  it("keeps unreferenced uploads private to their editor until canvas save", async () => {
    const [viewer] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Viewer",
        email: "viewer@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!viewer) throw new Error("Viewer missing");
    await db.insert(workspaceMembers).values({
      publicId: "viewmember01",
      email: viewer.email,
      userId: viewer.id,
      workspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
      role: "member",
      status: "active",
    });
    const [session] = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values({
        publicId: "privateses01",
        workspaceId: seeded.workspace.id,
        userId: seeded.user.id,
        s3Key: ".uploads/privateses01/meta.png",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 128,
        sha256: "f".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
        storageDeletedAt: new Date(),
      })
      .returning();
    if (!session) throw new Error("Upload session missing");
    const [image] = await db
      .insert(workspaceCanvasImages)
      .values({
        publicId: "privateimg01",
        workspaceId: seeded.workspace.id,
        title: "Meta privada",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 128,
        s3Key: ".objects/privateimg01",
        sha256: "f".repeat(64),
        uploadSessionId: session.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!image) throw new Error("Image missing");
    const listFor = (userId: string) =>
      canvasImageRepo.listByWorkspacePublicId(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        userId,
        imagePublicIds: [image.publicId],
      });

    await expect(listFor(seeded.user.id)).resolves.toHaveLength(1);
    await expect(listFor(viewer.id)).resolves.toHaveLength(0);
    await expect(
      canvasImageRepo.getForView(db, {
        imagePublicId: image.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ publicId: image.publicId });
    await expect(
      canvasImageRepo.getForView(db, {
        imagePublicId: image.publicId,
        userId: viewer.id,
      }),
    ).resolves.toBeNull();

    await expect(
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        scene: {
          elements: [
            {
              id: "private-image-element",
              type: "image",
              customData: { kanResourcePublicId: image.publicId },
            },
          ],
          appState: {},
        },
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 1 });
    await expect(listFor(viewer.id)).resolves.toHaveLength(1);
    await expect(
      canvasImageRepo.getForView(db, {
        imagePublicId: image.publicId,
        userId: viewer.id,
      }),
    ).resolves.toMatchObject({ publicId: image.publicId });
  });

  it("soft deletes only unreferenced images under the edit boundary", async () => {
    const [canvas] = await db
      .insert(workspaceCanvases)
      .values({
        workspaceId: seeded.workspace.id,
        scene: { elements: [], appState: {} },
        version: 1,
        hash: "a".repeat(64),
        bytes: 29,
        elementCount: 0,
        createdBy: seeded.user.id,
        updatedBy: seeded.user.id,
      })
      .returning();
    if (!canvas) throw new Error("Canvas missing");

    const createImage = async (
      sessionPublicId: string,
      imagePublicId: string,
    ) => {
      const [session] = await db
        .insert(workspaceCanvasImageUploadSessions)
        .values({
          publicId: sessionPublicId,
          workspaceId: seeded.workspace.id,
          userId: seeded.user.id,
          s3Key: `.uploads/${sessionPublicId}/meta.png`,
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 128,
          sha256: "b".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: new Date(),
          storageDeletedAt: new Date(),
        })
        .returning();
      if (!session) throw new Error("Upload session missing");
      const [image] = await db
        .insert(workspaceCanvasImages)
        .values({
          publicId: imagePublicId,
          workspaceId: seeded.workspace.id,
          title: "Meta",
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 128,
          s3Key: `.objects/${imagePublicId}`,
          sha256: "b".repeat(64),
          uploadSessionId: session.id,
          createdBy: seeded.user.id,
        })
        .returning();
      if (!image) throw new Error("Image missing");
      return image;
    };

    const unreferenced = await createImage("session00001", "canvasimg001");
    const [otherEditor] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Other editor",
        email: "other-editor@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!otherEditor) throw new Error("Other editor missing");
    await db.insert(workspaceMembers).values({
      publicId: "editmember01",
      email: otherEditor.email,
      userId: otherEditor.id,
      workspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
      role: "admin",
      status: "active",
    });
    await expect(
      canvasImageRepo.softDeleteUnreferenced(db, {
        workspacePublicId: seeded.workspace.publicId,
        imagePublicId: unreferenced.publicId,
        userId: otherEditor.id,
      }),
    ).resolves.toEqual({ status: "not_found" });
    await expect(
      canvasImageRepo.softDeleteUnreferenced(db, {
        workspacePublicId: seeded.workspace.publicId,
        imagePublicId: unreferenced.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({
      status: "deleted",
      s3Key: ".objects/canvasimg001",
    });

    const referenced = await createImage("session00002", "canvasimg002");
    await db.insert(workspaceCanvasImageReferences).values({
      canvasId: canvas.id,
      elementId: "image-element-1",
      imageId: referenced.id,
    });
    await expect(
      canvasImageRepo.softDeleteUnreferenced(db, {
        workspacePublicId: seeded.workspace.publicId,
        imagePublicId: referenced.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "referenced" });

    const denied = await createImage("session00003", "canvasimg003");
    await db.insert(workspaceMemberPermissions).values({
      workspaceMemberId: seeded.member.id,
      permission: "workspace:edit",
      granted: false,
    });
    await expect(
      canvasImageRepo.softDeleteUnreferenced(db, {
        workspacePublicId: seeded.workspace.publicId,
        imagePublicId: denied.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "forbidden" });
  });

  it("preserves images referenced by revisions so they remain restorable", async () => {
    const [session] = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values({
        publicId: "revisionses1",
        workspaceId: seeded.workspace.id,
        userId: seeded.user.id,
        s3Key: ".uploads/revisionses1/meta.png",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 128,
        sha256: "e".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
        storageDeletedAt: new Date(),
      })
      .returning();
    if (!session) throw new Error("Upload session missing");
    const [image] = await db
      .insert(workspaceCanvasImages)
      .values({
        publicId: "revisionimg1",
        workspaceId: seeded.workspace.id,
        title: "Meta",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 128,
        s3Key: ".objects/revisionimg1",
        sha256: "e".repeat(64),
        uploadSessionId: session.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!image) throw new Error("Image missing");
    const imageScene = {
      elements: [
        {
          id: "revision-image-element",
          type: "image",
          customData: { kanResourcePublicId: image.publicId },
          link: `kan-resource:${image.publicId}`,
        },
      ],
      appState: {},
    };

    const created = await canvasRepo.save(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      scene: imageScene,
      actorId: seeded.user.id,
    });
    if (created.status === "conflict") throw new Error("Unexpected conflict");
    const checkpointBoundary = new Date(Date.now() - 16 * 60 * 1000);
    await db
      .update(workspaceCanvases)
      .set({ createdAt: checkpointBoundary, updatedAt: checkpointBoundary })
      .where(eq(workspaceCanvases.id, created.canvasId));
    await expect(
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        scene: { elements: [], appState: {} },
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 2 });
    const [revision] = await db
      .select({ publicId: workspaceCanvasRevisions.publicId })
      .from(workspaceCanvasRevisions)
      .where(eq(workspaceCanvasRevisions.kind, "automatic"));
    if (!revision) throw new Error("Revision missing");
    await expect(
      db
        .select()
        .from(workspaceCanvasImageReferences)
        .where(eq(workspaceCanvasImageReferences.canvasId, created.canvasId)),
    ).resolves.toHaveLength(0);
    await expect(
      canvasImageRepo.softDeleteUnreferenced(db, {
        workspacePublicId: seeded.workspace.publicId,
        imagePublicId: image.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "referenced" });
    await expect(
      canvasRepo.restore(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        revisionPublicId: revision.publicId,
        expectedVersion: 2,
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 3 });
    await expect(
      db
        .select()
        .from(workspaceCanvasImageReferences)
        .where(eq(workspaceCanvasImageReferences.canvasId, created.canvasId)),
    ).resolves.toHaveLength(1);
  });

  it("enforces the cumulative image budget at session creation and consumption", async () => {
    const createSession = (publicId: string, size: number) =>
      canvasImageRepo.createUploadSession(db, {
        publicId,
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        s3Key: `.uploads/${publicId}/meta.png`,
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size,
        sha256: "c".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      });
    const claimSession = (publicId: string, claimToken: string) =>
      canvasImageRepo.claimUploadSession(db, {
        publicId,
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken,
        claimExpiresAt: new Date(Date.now() + 60_000),
      });
    const consumeSession = (
      sessionPublicId: string,
      claimToken: string,
      finalS3Key: string,
    ) =>
      canvasImageRepo.consumeUploadSession(db, {
        sessionPublicId,
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken,
        finalS3Key,
      });

    await expect(
      createSession("session10001", MAX_CARD_CANVAS_IMAGE_BYTES),
    ).resolves.toMatchObject({ status: "created" });
    await claimSession("session10001", "claimtok0001");
    await expect(
      consumeSession("session10001", "claimtok0001", ".objects/object000001"),
    ).resolves.toMatchObject({ status: "created" });
    await db
      .update(workspaceCanvasImageUploadSessions)
      .set({ storageDeletedAt: new Date() })
      .where(eq(workspaceCanvasImageUploadSessions.publicId, "session10001"));

    await expect(
      createSession("session10002", MAX_CARD_CANVAS_IMAGE_BYTES),
    ).resolves.toMatchObject({ status: "created" });
    await expect(createSession("session10003", 1)).resolves.toMatchObject({
      status: "created",
    });
    await claimSession("session10002", "claimtok0002");
    await claimSession("session10003", "claimtok0003");
    await expect(
      consumeSession("session10002", "claimtok0002", ".objects/object000002"),
    ).resolves.toMatchObject({ status: "created" });
    await db
      .update(workspaceCanvasImageUploadSessions)
      .set({ storageDeletedAt: new Date() })
      .where(eq(workspaceCanvasImageUploadSessions.publicId, "session10002"));
    expect(MAX_CARD_CANVAS_IMAGE_BYTES * 2).toBe(
      MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
    );
    await expect(
      consumeSession("session10003", "claimtok0003", ".objects/object000003"),
    ).resolves.toEqual({ status: "image_budget" });
    await expect(createSession("session10004", 1)).resolves.toEqual({
      status: "image_budget",
    });
    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "image_budget" });
  });

  it("accepts exactly fifty active images and rejects the next session", async () => {
    const sessions = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values(
        Array.from({ length: 49 }, (_, index) => ({
          publicId: `sesscnt${String(index).padStart(5, "0")}`,
          workspaceId: seeded.workspace.id,
          userId: seeded.user.id,
          s3Key: `.uploads/count-${index}/meta.png`,
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 1,
          sha256: "7".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: new Date(),
          storageDeletedAt: new Date(),
        })),
      )
      .returning();
    await db.insert(workspaceCanvasImages).values(
      sessions.map((session, index) => ({
        publicId: `imgcnt${String(index).padStart(6, "0")}`,
        workspaceId: seeded.workspace.id,
        title: "Meta",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1,
        s3Key: `.objects/count-${index}`,
        sha256: "7".repeat(64),
        uploadSessionId: session.id,
        createdBy: seeded.user.id,
      })),
    );
    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "available" });
    await expect(
      canvasImageRepo.createUploadSession(db, {
        publicId: "session50000",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        s3Key: ".uploads/session50000/meta.png",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1,
        sha256: "8".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toMatchObject({ status: "created" });
    await canvasImageRepo.claimUploadSession(db, {
      publicId: "session50000",
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
      claimToken: "claimcnt0001",
      claimExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      canvasImageRepo.consumeUploadSession(db, {
        sessionPublicId: "session50000",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken: "claimcnt0001",
        finalS3Key: ".objects/count-final",
      }),
    ).resolves.toMatchObject({ status: "created" });
    await db
      .update(workspaceCanvasImageUploadSessions)
      .set({ storageDeletedAt: new Date() })
      .where(eq(workspaceCanvasImageUploadSessions.publicId, "session50000"));
    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "image_limit" });
    await expect(
      canvasImageRepo.createUploadSession(db, {
        publicId: "session50001",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        s3Key: ".uploads/session50001/meta.png",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1,
        sha256: "8".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toEqual({ status: "image_limit" });
  });

  it("synchronizes valid image references and rejects missing or foreign images", async () => {
    const createStoredImage = async (input: {
      workspaceId: number;
      sessionPublicId: string;
      imagePublicId: string;
    }) => {
      const [session] = await db
        .insert(workspaceCanvasImageUploadSessions)
        .values({
          publicId: input.sessionPublicId,
          workspaceId: input.workspaceId,
          userId: seeded.user.id,
          s3Key: `.uploads/${input.sessionPublicId}/meta.png`,
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 128,
          sha256: "d".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: new Date(),
          storageDeletedAt: new Date(),
        })
        .returning();
      if (!session) throw new Error("Upload session missing");
      const [image] = await db
        .insert(workspaceCanvasImages)
        .values({
          publicId: input.imagePublicId,
          workspaceId: input.workspaceId,
          title: "Meta",
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 128,
          s3Key: `.objects/${input.imagePublicId}`,
          sha256: "d".repeat(64),
          uploadSessionId: session.id,
          createdBy: seeded.user.id,
        })
        .returning();
      if (!image) throw new Error("Image missing");
      return image;
    };
    const imageScene = (publicId: string) => ({
      elements: [
        {
          id: `element-${publicId}`,
          type: "image",
          customData: { kanResourcePublicId: publicId },
          link: `kan-resource:${publicId}`,
        },
      ],
      appState: {},
    });
    const valid = await createStoredImage({
      workspaceId: seeded.workspace.id,
      sessionPublicId: "validsess001",
      imagePublicId: "validimg0001",
    });
    await createStoredImage({
      workspaceId: seeded.otherWorkspace.id,
      sessionPublicId: "foreignses01",
      imagePublicId: "foreignimg01",
    });

    const saved = await canvasRepo.save(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      scene: imageScene(valid.publicId),
      actorId: seeded.user.id,
    });
    expect(saved).toMatchObject({ status: "saved", version: 1 });
    if (saved.status === "conflict") throw new Error("Unexpected conflict");
    await expect(
      db
        .select()
        .from(workspaceCanvasImageReferences)
        .where(eq(workspaceCanvasImageReferences.canvasId, saved.canvasId)),
    ).resolves.toHaveLength(1);

    await expect(
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        scene: { elements: [], appState: {} },
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 2 });
    await expect(
      db
        .select()
        .from(workspaceCanvasImageReferences)
        .where(eq(workspaceCanvasImageReferences.canvasId, saved.canvasId)),
    ).resolves.toHaveLength(0);

    for (const publicId of ["missingimg01", "foreignimg01"]) {
      await expect(
        canvasRepo.save(db, {
          workspacePublicId: seeded.workspace.publicId,
          expectedWorkspaceId: seeded.workspace.id,
          expectedVersion: 2,
          scene: imageScene(publicId),
          actorId: seeded.user.id,
        }),
      ).rejects.toBeInstanceOf(WorkspaceCanvasImageReferenceError);
    }
    await expect(
      canvasRepo.getSnapshot(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ version: 2, elementCount: 0 });
  });
});
