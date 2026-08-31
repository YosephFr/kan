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
  workspaceCanvasImageStorageDeletions,
  workspaceCanvasImageUploadSessions,
  workspaceCanvasRevisions,
  workspaceMemberPermissions,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";
import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES,
  MAX_WORKSPACE_CANVAS_PENDING_UPLOAD_BYTES,
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
      canvasImageRepo
        .listByWorkspacePublicId(db, {
          workspacePublicId: seeded.workspace.publicId,
          expectedWorkspaceId: seeded.workspace.id,
          userId,
          imagePublicIds: [image.publicId],
        })
        .then((result) => result.images);

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

  it("rejects a restore when its head plus another editor's private images exceed 100 MiB", async () => {
    const imageCount = 10;
    const sessions = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values(
        Array.from({ length: imageCount }, (_, index) => ({
          publicId: `rstses${String(index).padStart(6, "0")}`,
          workspaceId: seeded.workspace.id,
          userId: seeded.user.id,
          s3Key: `.uploads/restore-${index}/meta.png`,
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: MAX_CARD_CANVAS_IMAGE_BYTES,
          sha256: "9".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: new Date(),
          storageDeletedAt: new Date(),
        })),
      )
      .returning();
    const images = await db
      .insert(workspaceCanvasImages)
      .values(
        sessions.map((session, index) => ({
          publicId: `rstimg${String(index).padStart(6, "0")}`,
          workspaceId: seeded.workspace.id,
          title: "Meta",
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: MAX_CARD_CANVAS_IMAGE_BYTES,
          s3Key: `.objects/rstimg${String(index).padStart(6, "0")}`,
          sha256: "9".repeat(64),
          uploadSessionId: session.id,
          createdBy: seeded.user.id,
        })),
      )
      .returning();
    expect(images).toHaveLength(imageCount);
    expect(MAX_CARD_CANVAS_IMAGE_BYTES * imageCount).toBe(
      MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES,
    );
    const imageScene = {
      elements: images.map((image, index) => ({
        id: `restore-element-${index}`,
        type: "image",
        customData: { kanResourcePublicId: image.publicId },
        link: `kan-resource:${image.publicId}`,
      })),
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

    const [otherEditor] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Other editor",
        email: "restore-editor@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!otherEditor) throw new Error("Other editor missing");
    await db.insert(workspaceMembers).values({
      publicId: "quotamember1",
      email: otherEditor.email,
      userId: otherEditor.id,
      workspaceId: seeded.workspace.id,
      createdBy: seeded.user.id,
      role: "admin",
      status: "active",
    });
    const [privateSession] = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values({
        publicId: "privqses0001",
        workspaceId: seeded.workspace.id,
        userId: otherEditor.id,
        s3Key: ".uploads/privqses0001/meta.png",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1,
        sha256: "a".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
        storageDeletedAt: new Date(),
      })
      .returning();
    if (!privateSession) throw new Error("Private session missing");
    const [privateImage] = await db
      .insert(workspaceCanvasImages)
      .values({
        publicId: "privqimg0001",
        workspaceId: seeded.workspace.id,
        title: "Private draft",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1,
        s3Key: ".objects/privqimg0001",
        sha256: "a".repeat(64),
        uploadSessionId: privateSession.id,
        createdBy: otherEditor.id,
      })
      .returning();
    if (!privateImage) throw new Error("Private image missing");

    await expect(
      canvasRepo.restore(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        revisionPublicId: revision.publicId,
        expectedVersion: 2,
        actorId: seeded.user.id,
      }),
    ).rejects.toMatchObject({ code: "IMAGE_RESOURCE_BUDGET_EXCEEDED" });
    await expect(
      canvasRepo.getSnapshot(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ version: 2, elementCount: 0 });
    await expect(
      db
        .select()
        .from(workspaceCanvasImageReferences)
        .where(eq(workspaceCanvasImageReferences.canvasId, created.canvasId)),
    ).resolves.toHaveLength(0);
    await expect(
      db
        .select({ sharedAt: workspaceCanvasImages.sharedAt })
        .from(workspaceCanvasImages)
        .where(eq(workspaceCanvasImages.id, privateImage.id)),
    ).resolves.toEqual([{ sharedAt: null }]);
  });

  it("accepts exactly 100 MiB of optimized images and rejects another charge", async () => {
    const imageSize = 512 * 1024;
    const existingCount = 199;
    const sessions = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values(
        Array.from({ length: existingCount }, (_, index) => ({
          publicId: `sesbud${String(index).padStart(6, "0")}`,
          workspaceId: seeded.workspace.id,
          userId: seeded.user.id,
          s3Key: `.uploads/budget-${index}/meta.png`,
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 1,
          sha256: "c".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: new Date(),
          storageDeletedAt: new Date(),
        })),
      )
      .returning();
    await db.insert(workspaceCanvasImages).values(
      sessions.map((session, index) => ({
        publicId: `imgbud${String(index).padStart(6, "0")}`,
        workspaceId: seeded.workspace.id,
        title: "Meta",
        filename: "meta.webp",
        originalFilename: "meta.png",
        contentType: "image/webp",
        size: imageSize,
        width: 1280,
        height: 720,
        optimizedAt: new Date(),
        s3Key: `.objects/imgbud${String(index).padStart(6, "0")}`,
        sha256: "d".repeat(64),
        uploadSessionId: session.id,
        createdBy: seeded.user.id,
      })),
    );
    await expect(
      canvasImageRepo.createUploadSession(db, {
        publicId: "budgetfinal1",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        s3Key: ".uploads/budgetfinal1/meta.png",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1,
        sha256: "e".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toMatchObject({ status: "created" });
    await canvasImageRepo.claimUploadSession(db, {
      publicId: "budgetfinal1",
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
      claimToken: "budgetclaim1",
      claimExpiresAt: new Date(Date.now() + 60_000),
    });
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [
        {
          s3Key: ".objects/budgetfinal1",
          workspaceId: seeded.workspace.id,
          size: imageSize,
        },
      ],
      new Date(Date.now() + 60_000),
    );
    await expect(
      canvasImageRepo.consumeUploadSession(db, {
        sessionPublicId: "budgetfinal1",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken: "budgetclaim1",
        finalS3Key: ".objects/budgetfinal1",
        finalContentType: "image/webp",
        finalSize: imageSize,
        finalSha256: "f".repeat(64),
        width: 1280,
        height: 720,
        optimizedAt: new Date(),
      }),
    ).resolves.toMatchObject({ status: "created" });
    await db
      .update(workspaceCanvasImageUploadSessions)
      .set({ storageDeletedAt: new Date() })
      .where(eq(workspaceCanvasImageUploadSessions.publicId, "budgetfinal1"));
    expect(imageSize * (existingCount + 1)).toBe(
      MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES,
    );
    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "image_budget" });
    await expect(
      canvasImageRepo.createUploadSession(db, {
        publicId: "budgetextra1",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        s3Key: ".uploads/budgetextra1/meta.png",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1,
        sha256: "1".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toEqual({ status: "image_budget" });
  });

  it("allows five pending uploads totaling 50 MiB and rejects a sixth", async () => {
    for (let index = 0; index < 5; index += 1) {
      await expect(
        canvasImageRepo.createUploadSession(db, {
          publicId: `stage${String(index).padStart(7, "0")}`,
          workspacePublicId: seeded.workspace.publicId,
          userId: seeded.user.id,
          s3Key: `.uploads/stage-${index}/meta.png`,
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: MAX_CARD_CANVAS_IMAGE_BYTES,
          sha256: "6".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ).resolves.toMatchObject({ status: "created" });
    }
    expect(MAX_CARD_CANVAS_IMAGE_BYTES * 5).toBe(
      MAX_WORKSPACE_CANVAS_PENDING_UPLOAD_BYTES,
    );
    await expect(
      canvasImageRepo.createUploadSession(db, {
        publicId: "stage0000005",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        s3Key: ".uploads/stage-5/meta.png",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1,
        sha256: "6".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toMatchObject({ status: "workspace_limit" });
  });

  it("preserves the global ten-pending-upload cap per user", async () => {
    await db.insert(workspaceCanvasImageUploadSessions).values(
      Array.from({ length: 10 }, (_, index) => ({
        publicId: `global${String(index).padStart(6, "0")}`,
        workspaceId: seeded.workspace.id,
        userId: seeded.user.id,
        s3Key: `.uploads/global-${index}/meta.png`,
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1,
        sha256: "7".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      })),
    );
    await expect(
      canvasImageRepo.createUploadSession(db, {
        publicId: "global000010",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        s3Key: ".uploads/global-10/meta.png",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1,
        sha256: "8".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toMatchObject({ status: "user_limit" });
  });

  it("serializes the global pending-upload cap across workspaces", async () => {
    const [thirdWorkspace] = await db
      .insert(workspaces)
      .values({
        publicId: "workspace003",
        name: "Third",
        slug: "pipeline-third",
        createdBy: seeded.user.id,
      })
      .returning();
    if (!thirdWorkspace) throw new Error("Workspace missing");
    await db.insert(workspaceCanvasImageUploadSessions).values(
      Array.from({ length: 9 }, (_, index) => ({
        publicId: `raceup${String(index).padStart(6, "0")}`,
        workspaceId: thirdWorkspace.id,
        userId: seeded.user.id,
        s3Key: `.uploads/race-${index}/meta.png`,
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1,
        sha256: "7".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      })),
    );

    const create = (workspacePublicId: string, suffix: string) =>
      canvasImageRepo.createUploadSession(db, {
        publicId: `race${suffix}00001`,
        workspacePublicId,
        userId: seeded.user.id,
        s3Key: `.uploads/race-${suffix}/meta.png`,
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1,
        sha256: "8".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      });
    const results = await Promise.all([
      create(seeded.workspace.publicId, "one"),
      create(seeded.otherWorkspace.publicId, "two"),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "created",
      "user_limit",
    ]);
    const pending = await db.select().from(workspaceCanvasImageUploadSessions);
    expect(pending).toHaveLength(10);
  });

  it.each([51, 251])(
    "accepts %i active images when they fit the byte budget",
    async (imageCount) => {
      const sessions = await db
        .insert(workspaceCanvasImageUploadSessions)
        .values(
          Array.from({ length: imageCount }, (_, index) => ({
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
          publicId: "countnew0001",
          workspacePublicId: seeded.workspace.publicId,
          userId: seeded.user.id,
          s3Key: ".uploads/countnew0001/meta.png",
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 1,
          sha256: "8".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ).resolves.toMatchObject({ status: "created" });
    },
  );

  it("backfills legacy images with CAS and durable object cleanup", async () => {
    const [session] = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values({
        publicId: "backfillses1",
        workspaceId: seeded.workspace.id,
        userId: seeded.user.id,
        s3Key: ".uploads/backfillses1/meta.png",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1024,
        sha256: "2".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
        storageDeletedAt: new Date(),
      })
      .returning();
    if (!session) throw new Error("Upload session missing");
    const [legacy] = await db
      .insert(workspaceCanvasImages)
      .values({
        publicId: "backfillimg1",
        workspaceId: seeded.workspace.id,
        title: "Meta",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1024,
        s3Key: ".objects/backfillold1",
        sha256: "3".repeat(64),
        uploadSessionId: session.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!legacy) throw new Error("Legacy image missing");

    await expect(
      canvasImageRepo.claimWorkspaceCanvasImageOptimizationBatch(db, {
        workspacePublicId: "missingws001",
        limit: 2,
      }),
    ).resolves.toEqual([]);
    await expect(
      canvasImageRepo.claimWorkspaceCanvasImageOptimizationBatch(db, {
        workspacePublicId: seeded.workspace.publicId,
        limit: 2,
      }),
    ).resolves.toMatchObject([{ publicId: legacy.publicId }]);

    const finalS3Key = ".objects/backfillnew1";
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [
        {
          s3Key: finalS3Key,
          workspaceId: seeded.workspace.id,
          size: 512,
        },
      ],
      new Date(Date.now() + 60_000),
    );
    const optimizedAt = new Date();
    const completionStartedAt = Date.now();
    const completionInput = {
      imageId: legacy.id,
      imagePublicId: legacy.publicId,
      workspaceId: seeded.workspace.id,
      workspacePublicId: seeded.workspace.publicId,
      expectedS3Key: legacy.s3Key,
      expectedSha256: legacy.sha256,
      finalS3Key,
      finalContentType: "image/webp" as const,
      finalSize: 512,
      finalSha256: "4".repeat(64),
      width: 640,
      height: 480,
      optimizedAt,
    };
    const completion =
      await canvasImageRepo.completeWorkspaceCanvasImageOptimization(
        db,
        completionInput,
      );
    expect(completion).toMatchObject({
      status: "completed",
      reclaimedS3Keys: [],
    });
    await expect(
      db
        .select({
          publicId: workspaceCanvasImages.publicId,
          s3Key: workspaceCanvasImages.s3Key,
          contentType: workspaceCanvasImages.contentType,
          size: workspaceCanvasImages.size,
          width: workspaceCanvasImages.width,
          height: workspaceCanvasImages.height,
          optimizedAt: workspaceCanvasImages.optimizedAt,
        })
        .from(workspaceCanvasImages)
        .where(eq(workspaceCanvasImages.id, legacy.id)),
    ).resolves.toEqual([
      {
        publicId: legacy.publicId,
        s3Key: finalS3Key,
        contentType: "image/webp",
        size: 512,
        width: 640,
        height: 480,
        optimizedAt,
      },
    ]);
    const tombstones = await db
      .select({
        s3Key: workspaceCanvasImageStorageDeletions.s3Key,
        availableAt: workspaceCanvasImageStorageDeletions.availableAt,
        completedAt: workspaceCanvasImageStorageDeletions.completedAt,
      })
      .from(workspaceCanvasImageStorageDeletions);
    expect(
      tombstones.find((tombstone) => tombstone.s3Key === finalS3Key)
        ?.completedAt,
    ).toBeInstanceOf(Date);
    const originalTombstone = tombstones.find(
      (tombstone) => tombstone.s3Key === legacy.s3Key,
    );
    expect(originalTombstone?.completedAt).toBeNull();
    expect(originalTombstone?.availableAt.getTime()).toBeGreaterThanOrEqual(
      completionStartedAt + 59_000,
    );
    await expect(
      canvasImageRepo.reconcileWorkspaceCanvasImageOptimization(
        db,
        completionInput,
      ),
    ).resolves.toEqual({
      status: "completed",
      image: { publicId: legacy.publicId },
      reclaimedS3Keys: [],
    });

    const staleFinalS3Key = ".objects/backfillnew2";
    await expect(
      canvasImageRepo.completeWorkspaceCanvasImageOptimization(db, {
        imageId: legacy.id,
        imagePublicId: legacy.publicId,
        workspaceId: seeded.workspace.id,
        workspacePublicId: seeded.workspace.publicId,
        expectedS3Key: legacy.s3Key,
        expectedSha256: legacy.sha256,
        finalS3Key: staleFinalS3Key,
        finalContentType: "image/webp",
        finalSize: 256,
        finalSha256: "5".repeat(64),
        width: 320,
        height: 240,
        optimizedAt: new Date(),
      }),
    ).resolves.toEqual({
      status: "stale",
      reclaimedS3Keys: [staleFinalS3Key],
    });
    await expect(
      canvasImageRepo.claimWorkspaceCanvasImageOptimizationBatch(db, {
        workspacePublicId: seeded.workspace.publicId,
      }),
    ).resolves.toEqual([]);
  });

  it("invalidates an orphan final reservation before a late completion can commit", async () => {
    const [session] = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values({
        publicId: "ambigses0001",
        workspaceId: seeded.workspace.id,
        userId: seeded.user.id,
        s3Key: ".uploads/ambigses0001/meta.png",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1024,
        sha256: "6".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
        storageDeletedAt: new Date(),
      })
      .returning();
    if (!session) throw new Error("Upload session missing");
    const [legacy] = await db
      .insert(workspaceCanvasImages)
      .values({
        publicId: "ambigimg0001",
        workspaceId: seeded.workspace.id,
        title: "Meta",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 1024,
        s3Key: ".objects/ambigold0001",
        sha256: "7".repeat(64),
        uploadSessionId: session.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!legacy) throw new Error("Legacy image missing");
    const finalS3Key = ".objects/ambignew0001";
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [
        {
          s3Key: finalS3Key,
          workspaceId: seeded.workspace.id,
          size: 512,
        },
      ],
      new Date(Date.now() + 15 * 60_000),
    );
    const completionInput = {
      imageId: legacy.id,
      imagePublicId: legacy.publicId,
      workspaceId: seeded.workspace.id,
      workspacePublicId: seeded.workspace.publicId,
      expectedS3Key: legacy.s3Key,
      expectedSha256: legacy.sha256,
      finalS3Key,
      finalContentType: "image/webp" as const,
      finalSize: 512,
      finalSha256: "8".repeat(64),
      width: 640,
      height: 480,
      optimizedAt: new Date(),
    };

    await expect(
      canvasImageRepo.reconcileWorkspaceCanvasImageOptimization(
        db,
        completionInput,
      ),
    ).resolves.toEqual({
      status: "not_persisted",
      reclaimedS3Keys: [finalS3Key],
    });
    const [reservation] = await db
      .select({
        availableAt: workspaceCanvasImageStorageDeletions.availableAt,
        completedAt: workspaceCanvasImageStorageDeletions.completedAt,
      })
      .from(workspaceCanvasImageStorageDeletions)
      .where(eq(workspaceCanvasImageStorageDeletions.s3Key, finalS3Key));
    expect(reservation?.completedAt).toBeNull();
    expect(reservation?.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
    await expect(
      canvasImageRepo.completeWorkspaceCanvasImageOptimization(
        db,
        completionInput,
      ),
    ).resolves.toEqual({
      status: "invalid_optimized_image",
      reclaimedS3Keys: [finalS3Key],
    });
    await expect(
      db
        .select({
          s3Key: workspaceCanvasImages.s3Key,
          optimizedAt: workspaceCanvasImages.optimizedAt,
        })
        .from(workspaceCanvasImages)
        .where(eq(workspaceCanvasImages.id, legacy.id)),
    ).resolves.toEqual([{ s3Key: legacy.s3Key, optimizedAt: null }]);
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
