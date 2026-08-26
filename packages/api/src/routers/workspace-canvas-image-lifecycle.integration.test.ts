import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as canvasRepo from "@kan/db/repository/workspaceCanvas.repo";
import * as canvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";
import {
  users,
  workspaceCanvases,
  workspaceCanvasImages,
  workspaceCanvasImageUploadSessions,
  workspaceCanvasRevisions,
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

const imageScene = (...publicIds: string[]) => ({
  elements: publicIds.map((publicId, index) => ({
    id: `image-${index}`,
    type: "image",
    customData: { kanResourcePublicId: publicId },
  })),
  appState: {},
});

const textScene = (text: string) => ({
  elements: [{ id: `text-${text}`, type: "text", text }],
  appState: {},
});

describe("workspace canvas image lifecycle", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;
  let sequence: number;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
    sequence = 0;
  });

  const nextPublicId = (prefix: "img" | "ses" | "mem") =>
    `${prefix}${String(++sequence).padStart(9, "0")}`;

  const createMember = async (role: "admin" | "member") => {
    const publicId = nextPublicId("mem");
    const [user] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: role === "admin" ? "Editor" : "Viewer",
        email: `${publicId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!user) throw new Error("User missing");
    const [member] = await db
      .insert(workspaceMembers)
      .values({
        publicId,
        email: user.email,
        userId: user.id,
        workspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
        role,
        status: "active",
      })
      .returning();
    if (!member) throw new Error("Member missing");
    return { user, member };
  };

  const createImage = async (input: {
    createdBy: string | null;
    size?: number;
  }) => {
    const sessionPublicId = nextPublicId("ses");
    const imagePublicId = nextPublicId("img");
    const [session] = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values({
        publicId: sessionPublicId,
        workspaceId: seeded.workspace.id,
        userId: input.createdBy,
        s3Key: `.uploads/${sessionPublicId}/meta.png`,
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: input.size ?? 128,
        sha256: "a".repeat(64),
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
        size: input.size ?? 128,
        s3Key: `.objects/${imagePublicId}`,
        sha256: "a".repeat(64),
        uploadSessionId: session.id,
        createdBy: input.createdBy,
      })
      .returning();
    if (!image) throw new Error("Image missing");
    return image;
  };

  const listFor = (userId: string, imagePublicIds: string[]) =>
    canvasImageRepo.listByWorkspacePublicId(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      userId,
      imagePublicIds,
    });

  it("keeps drafts private and preserves historically shared images for editors only", async () => {
    const editor = await createMember("admin");
    const viewer = await createMember("member");
    const image = await createImage({ createdBy: seeded.user.id });

    const requested = [image.publicId];
    await expect(listFor(seeded.user.id, requested)).resolves.toHaveLength(1);
    await expect(listFor(editor.user.id, requested)).resolves.toHaveLength(0);
    await expect(listFor(viewer.user.id, requested)).resolves.toHaveLength(0);
    await expect(
      canvasImageRepo.getForView(db, {
        imagePublicId: image.publicId,
        userId: editor.user.id,
      }),
    ).resolves.toBeNull();

    await expect(
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        scene: imageScene(image.publicId),
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 1 });
    const [published] = await db
      .select({ sharedAt: workspaceCanvasImages.sharedAt })
      .from(workspaceCanvasImages)
      .where(eq(workspaceCanvasImages.id, image.id));
    expect(published?.sharedAt).toBeInstanceOf(Date);

    await expect(
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        scene: imageScene(),
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 2 });
    await expect(
      db.select().from(workspaceCanvasRevisions),
    ).resolves.toHaveLength(0);
    await expect(listFor(editor.user.id, requested)).resolves.toHaveLength(1);
    await expect(listFor(viewer.user.id, requested)).resolves.toHaveLength(0);
    await expect(
      canvasImageRepo.getForView(db, {
        imagePublicId: image.publicId,
        userId: editor.user.id,
      }),
    ).resolves.toMatchObject({ publicId: image.publicId });
    await expect(
      canvasImageRepo.getForView(db, {
        imagePublicId: image.publicId,
        userId: viewer.user.id,
      }),
    ).resolves.toBeNull();
    await expect(
      canvasImageRepo.softDeleteUnreferenced(db, {
        workspacePublicId: seeded.workspace.publicId,
        imagePublicId: image.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "referenced" });
  });

  it("allows only the creator to publish a private image", async () => {
    const otherEditor = await createMember("admin");
    const image = await createImage({ createdBy: seeded.user.id });

    await expect(
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        scene: imageScene(image.publicId),
        actorId: otherEditor.user.id,
      }),
    ).rejects.toMatchObject({ code: "IMAGE_REFERENCE_INVALID" });
    await expect(db.select().from(workspaceCanvases)).resolves.toHaveLength(0);
    await expect(
      db
        .select({ sharedAt: workspaceCanvasImages.sharedAt })
        .from(workspaceCanvasImages)
        .where(eq(workspaceCanvasImages.id, image.id)),
    ).resolves.toEqual([{ sharedAt: null }]);

    await expect(
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 0,
        scene: imageScene(image.publicId),
        actorId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 1 });
    await expect(
      canvasRepo.save(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        expectedVersion: 1,
        scene: {
          elements: [
            ...imageScene(image.publicId).elements,
            { id: "editor-note", type: "text", text: "Conservar meta" },
          ],
          appState: {},
        },
        actorId: otherEditor.user.id,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 2 });
  });

  it("releases logical quota immediately while retaining shared storage for thirty days", async () => {
    const images = await Promise.all([
      createImage({
        createdBy: seeded.user.id,
        size: MAX_CARD_CANVAS_IMAGE_BYTES,
      }),
      createImage({
        createdBy: seeded.user.id,
        size: MAX_CARD_CANVAS_IMAGE_BYTES,
      }),
    ]);
    expect(MAX_CARD_CANVAS_IMAGE_BYTES * 2).toBe(
      MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
    );
    await canvasRepo.save(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      scene: imageScene(...images.map((image) => image.publicId)),
      actorId: seeded.user.id,
    });
    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "image_budget" });

    await canvasRepo.save(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 1,
      scene: imageScene(),
      actorId: seeded.user.id,
    });
    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "available" });
    const retained = await db
      .select({ deletedAt: workspaceCanvasImages.deletedAt })
      .from(workspaceCanvasImages);
    expect(retained.every((image) => image.deletedAt === null)).toBe(true);

    await db
      .update(workspaceCanvasImages)
      .set({ sharedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) });
    const reclaimed = await canvasImageRepo.preflightImageImport(db, {
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
    });
    expect(reclaimed).toMatchObject({ status: "available" });
    expect(
      "reclaimedS3Keys" in reclaimed
        ? [...(reclaimed.reclaimedS3Keys ?? [])].sort()
        : [],
    ).toEqual(images.map((image) => image.s3Key).sort());
    const deleted = await db
      .select({ deletedAt: workspaceCanvasImages.deletedAt })
      .from(workspaceCanvasImages);
    expect(deleted.every((image) => image.deletedAt instanceof Date)).toBe(
      true,
    );
  });

  it("retains expired shared images through revisions and reclaims them after pruning", async () => {
    const image = await createImage({ createdBy: seeded.user.id });
    const created = await canvasRepo.save(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 0,
      scene: imageScene(image.publicId),
      actorId: seeded.user.id,
    });
    if (created.status === "conflict") throw new Error("Unexpected conflict");
    const checkpointBoundary = new Date(Date.now() - 16 * 60 * 1000);
    await db
      .update(workspaceCanvases)
      .set({ createdAt: checkpointBoundary, updatedAt: checkpointBoundary })
      .where(eq(workspaceCanvases.id, created.canvasId));
    await canvasRepo.save(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 1,
      scene: imageScene(),
      actorId: seeded.user.id,
    });
    const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db.update(workspaceCanvasImages).set({ sharedAt: expiredAt });
    await db.update(workspaceCanvasRevisions).set({ createdAt: expiredAt });
    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "available" });

    await db
      .update(workspaceCanvases)
      .set({ updatedAt: checkpointBoundary })
      .where(eq(workspaceCanvases.id, created.canvasId));
    const pruned = await canvasRepo.save(db, {
      workspacePublicId: seeded.workspace.publicId,
      expectedWorkspaceId: seeded.workspace.id,
      expectedVersion: 2,
      scene: textScene("prune"),
      actorId: seeded.user.id,
    });
    expect(pruned).toMatchObject({ status: "saved", version: 3 });
    expect(
      "reclaimedS3Keys" in pruned ? pruned.reclaimedS3Keys : undefined,
    ).toEqual([image.s3Key]);
    const [prunedImage] = await db
      .select({ deletedAt: workspaceCanvasImages.deletedAt })
      .from(workspaceCanvasImages)
      .where(eq(workspaceCanvasImages.id, image.id));
    expect(prunedImage?.deletedAt).toBeInstanceOf(Date);
  });

  it("retains revoked private drafts for thirty days before reclaiming them", async () => {
    const formerEditor = await createMember("admin");
    const revoked = await createImage({ createdBy: formerEditor.user.id });
    const withoutOwner = await createImage({ createdBy: null });
    await db
      .update(workspaceMembers)
      .set({ status: "removed" })
      .where(eq(workspaceMembers.id, formerEditor.member.id));

    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "available" });
    await expect(
      db
        .select({ deletedAt: workspaceCanvasImages.deletedAt })
        .from(workspaceCanvasImages),
    ).resolves.toEqual([{ deletedAt: null }, { deletedAt: null }]);

    await db.update(workspaceCanvasImages).set({
      createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });
    const result = await canvasImageRepo.preflightImageImport(db, {
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
    });
    expect(result).toMatchObject({ status: "available" });
    expect(
      "reclaimedS3Keys" in result
        ? [...(result.reclaimedS3Keys ?? [])].sort()
        : [],
    ).toEqual([revoked.s3Key, withoutOwner.s3Key].sort());
    const images = await db
      .select({ deletedAt: workspaceCanvasImages.deletedAt })
      .from(workspaceCanvasImages);
    expect(images.every((image) => image.deletedAt instanceof Date)).toBe(true);
  });

  it("retains private drafts for thirty days and then safely reclaims them", async () => {
    const otherEditor = await createMember("admin");
    const image = await createImage({ createdBy: seeded.user.id });
    await db
      .update(workspaceCanvasImages)
      .set({ createdAt: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000) })
      .where(eq(workspaceCanvasImages.id, image.id));

    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: otherEditor.user.id,
      }),
    ).resolves.toEqual({ status: "available" });
    await expect(
      db
        .select({ deletedAt: workspaceCanvasImages.deletedAt })
        .from(workspaceCanvasImages)
        .where(eq(workspaceCanvasImages.id, image.id)),
    ).resolves.toEqual([{ deletedAt: null }]);

    await db
      .update(workspaceCanvasImages)
      .set({ createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(eq(workspaceCanvasImages.id, image.id));
    const reclaimed = await canvasImageRepo.preflightImageImport(db, {
      workspacePublicId: seeded.workspace.publicId,
      userId: otherEditor.user.id,
    });
    expect(reclaimed).toMatchObject({
      status: "available",
      reclaimedS3Keys: [image.s3Key],
    });
    const [deletedImage] = await db
      .select({ deletedAt: workspaceCanvasImages.deletedAt })
      .from(workspaceCanvasImages)
      .where(eq(workspaceCanvasImages.id, image.id));
    expect(deletedImage?.deletedAt).toBeInstanceOf(Date);
  });
});
