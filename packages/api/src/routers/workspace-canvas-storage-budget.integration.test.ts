import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as canvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";
import {
  workspaceCanvasImages,
  workspaceCanvasImageStorageDeletions,
  workspaceCanvasImageUploadSessions,
  workspaces,
} from "@kan/db/schema";
import { MAX_CARD_CANVAS_IMAGE_BYTES } from "@kan/shared";

import type { PipelineTestDbClient } from "./card-pipeline-repository.test-utils";
import {
  createPipelineTestDb,
  seedPipelineData,
} from "./card-pipeline-repository.test-utils";

describe("workspace canvas physical image budget", () => {
  let db: PipelineTestDbClient;
  let seeded: Awaited<ReturnType<typeof seedPipelineData>>;

  beforeEach(async () => {
    db = await createPipelineTestDb();
    seeded = await seedPipelineData(db);
  });

  const insertSharedImages = async (count: number, size: number) => {
    const sessions = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values(
        Array.from({ length: count }, (_, index) => ({
          publicId: `sesphy${String(index).padStart(6, "0")}`,
          workspaceId: seeded.workspace.id,
          userId: seeded.user.id,
          s3Key: `.uploads/physical-${index}/meta.png`,
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size,
          sha256: "b".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: new Date(),
          storageDeletedAt: new Date(),
        })),
      )
      .returning();
    await db.insert(workspaceCanvasImages).values(
      sessions.map((session, index) => {
        const publicId = `imgphy${String(index).padStart(6, "0")}`;
        return {
          publicId,
          workspaceId: seeded.workspace.id,
          title: "Meta",
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size,
          s3Key: `.objects/${publicId}`,
          sha256: "b".repeat(64),
          uploadSessionId: session.id,
          createdBy: seeded.user.id,
          sharedAt: new Date(),
        };
      }),
    );
  };

  it("caps retained upload-share-remove cycles by object count", async () => {
    await insertSharedImages(
      canvasImageRepo.MAX_WORKSPACE_CANVAS_STORED_IMAGES,
      1,
    );

    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "storage_limit" });
  });

  it("caps retained upload-share-remove cycles by physical bytes", async () => {
    await insertSharedImages(10, MAX_CARD_CANVAS_IMAGE_BYTES);
    expect(MAX_CARD_CANVAS_IMAGE_BYTES * 10).toBe(
      canvasImageRepo.MAX_WORKSPACE_CANVAS_STORED_IMAGE_BYTES,
    );

    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "storage_budget" });
  });

  it("keeps expired and consumed staging tombstones retryable until marked", async () => {
    const [expired, consumed] = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values([
        {
          publicId: "expiredses01",
          workspaceId: seeded.workspace.id,
          userId: seeded.user.id,
          s3Key: ".uploads/expiredses01/meta.png",
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 128,
          sha256: "c".repeat(64),
          expiresAt: new Date(Date.now() - 60_000),
        },
        {
          publicId: "consumedses1",
          workspaceId: seeded.workspace.id,
          userId: seeded.user.id,
          s3Key: ".uploads/consumedses1/meta.png",
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 128,
          sha256: "d".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: new Date(),
        },
      ])
      .returning();
    if (!expired || !consumed) throw new Error("Upload sessions missing");

    const first = await canvasImageRepo.preflightImageImport(db, {
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
    });
    expect(first).toMatchObject({ status: "storage_cleanup" });
    expect(
      "reclaimedS3Keys" in first
        ? [...(first.reclaimedS3Keys ?? [])].sort()
        : [],
    ).toEqual([expired.s3Key, consumed.s3Key].sort());
    const retry = await canvasImageRepo.preflightImageImport(db, {
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
    });
    expect(retry).toMatchObject({ status: "storage_cleanup" });
    expect("reclaimedS3Keys" in retry ? retry.reclaimedS3Keys : []).toContain(
      consumed.s3Key,
    );

    await canvasImageRepo.markWorkspaceCanvasImageStorageDeleted(db, [
      expired.s3Key,
      consumed.s3Key,
    ]);
    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "available" });
    const deletedUploads = await db
      .select({
        storageDeletedAt: workspaceCanvasImageUploadSessions.storageDeletedAt,
      })
      .from(workspaceCanvasImageUploadSessions);
    expect(
      deletedUploads.every((upload) => upload.storageDeletedAt instanceof Date),
    ).toBe(true);
  });

  it("keeps a delayed tombstone after the first staging cleanup", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const s3Key = ".uploads/stagingses01/meta.png";
    await expect(
      canvasImageRepo.createUploadSession(db, {
        publicId: "stagingses01",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        s3Key,
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 128,
        sha256: "f".repeat(64),
        expiresAt,
      }),
    ).resolves.toMatchObject({ status: "created" });
    await db
      .update(workspaceCanvasImageUploadSessions)
      .set({ consumedAt: new Date() })
      .where(eq(workspaceCanvasImageUploadSessions.publicId, "stagingses01"));

    await canvasImageRepo.markWorkspaceCanvasImageStorageDeleted(db, [s3Key]);
    const [delayed] = await db
      .select({
        availableAt: workspaceCanvasImageStorageDeletions.availableAt,
        completedAt: workspaceCanvasImageStorageDeletions.completedAt,
      })
      .from(workspaceCanvasImageStorageDeletions)
      .where(eq(workspaceCanvasImageStorageDeletions.s3Key, s3Key));
    expect(delayed?.availableAt.getTime()).toBeGreaterThan(expiresAt.getTime());
    expect(delayed?.completedAt).toBeNull();
    await expect(
      canvasImageRepo.listPendingWorkspaceCanvasStorageDeletionKeys(db),
    ).resolves.toEqual([]);

    await db
      .update(workspaceCanvasImageStorageDeletions)
      .set({ availableAt: new Date(Date.now() - 1) })
      .where(eq(workspaceCanvasImageStorageDeletions.s3Key, s3Key));
    await expect(
      canvasImageRepo.listPendingWorkspaceCanvasStorageDeletionKeys(db),
    ).resolves.toEqual([{ s3Key }]);
    await canvasImageRepo.markWorkspaceCanvasImageStorageDeleted(db, [s3Key]);
    const [completed] = await db
      .select({ completedAt: workspaceCanvasImageStorageDeletions.completedAt })
      .from(workspaceCanvasImageStorageDeletions)
      .where(eq(workspaceCanvasImageStorageDeletions.s3Key, s3Key));
    expect(completed?.completedAt).toBeInstanceOf(Date);
  });

  it("completes a reserved final-object tombstone with image creation", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    await canvasImageRepo.createUploadSession(db, {
      publicId: "finalsession",
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
      s3Key: ".uploads/finalsession/meta.png",
      filename: "meta.png",
      originalFilename: "meta.png",
      contentType: "image/png",
      size: 128,
      sha256: "a".repeat(64),
      expiresAt,
    });
    await canvasImageRepo.claimUploadSession(db, {
      publicId: "finalsession",
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
      claimToken: "finalclaim01",
      claimExpiresAt: expiresAt,
    });
    const finalS3Key = ".objects/finalobject1";
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [finalS3Key],
      expiresAt,
    );

    await expect(
      canvasImageRepo.consumeUploadSession(db, {
        sessionPublicId: "finalsession",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken: "finalclaim01",
        finalS3Key,
      }),
    ).resolves.toMatchObject({ status: "created" });
    const [completed] = await db
      .select({ completedAt: workspaceCanvasImageStorageDeletions.completedAt })
      .from(workspaceCanvasImageStorageDeletions)
      .where(eq(workspaceCanvasImageStorageDeletions.s3Key, finalS3Key));
    expect(completed?.completedAt).toBeInstanceOf(Date);
  });

  it("paginates past more than 250 ineligible candidates to reclaim a stale owner", async () => {
    const count = 252;
    const sessions = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values(
        Array.from({ length: count }, (_, index) => ({
          publicId: `sesgc0${String(index).padStart(6, "0")}`,
          workspaceId: seeded.workspace.id,
          userId: index === count - 1 ? null : seeded.user.id,
          s3Key: `.uploads/gc-${index}/meta.png`,
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 1,
          sha256: "e".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: new Date(),
          storageDeletedAt: new Date(),
        })),
      )
      .returning();
    const images = await db
      .insert(workspaceCanvasImages)
      .values(
        sessions.map((session, index) => {
          const publicId = `imggc0${String(index).padStart(6, "0")}`;
          return {
            publicId,
            workspaceId: seeded.workspace.id,
            title: "Meta",
            filename: "meta.png",
            originalFilename: "meta.png",
            contentType: "image/png",
            size: 1,
            s3Key: `.objects/${publicId}`,
            sha256: "e".repeat(64),
            uploadSessionId: session.id,
            createdBy: index === count - 1 ? null : seeded.user.id,
            createdAt:
              index === count - 1
                ? new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
                : new Date(),
          };
        }),
      )
      .returning();
    const stale = images.at(-1);
    if (!stale) throw new Error("Stale image missing");

    const result = await canvasImageRepo.preflightImageImport(db, {
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
    });
    expect(result).toMatchObject({ status: "storage_limit" });
    expect("reclaimedS3Keys" in result ? result.reclaimedS3Keys : []).toEqual([
      stale.s3Key,
    ]);
    const [deletedImage] = await db
      .select({ deletedAt: workspaceCanvasImages.deletedAt })
      .from(workspaceCanvasImages)
      .where(eq(workspaceCanvasImages.id, stale.id));
    expect(deletedImage?.deletedAt).toBeInstanceOf(Date);
  });

  it("persists storage deletion keys before hard-deleting a workspace", async () => {
    const [session] = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values({
        publicId: "deletewses01",
        workspaceId: seeded.workspace.id,
        userId: seeded.user.id,
        s3Key: ".uploads/deletewses01/meta.png",
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 128,
        sha256: "f".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
      })
      .returning();
    if (!session) throw new Error("Upload session missing");
    await db.insert(workspaceCanvasImages).values({
      publicId: "deletewimg01",
      workspaceId: seeded.workspace.id,
      title: "Meta",
      filename: "meta.png",
      originalFilename: "meta.png",
      contentType: "image/png",
      size: 128,
      s3Key: ".objects/deletewimg01",
      sha256: "f".repeat(64),
      uploadSessionId: session.id,
      createdBy: seeded.user.id,
    });
    await db.insert(workspaceCanvasImageStorageDeletions).values({
      s3Key: ".objects/deletewimg01",
      completedAt: new Date(),
    });

    const result =
      await canvasImageRepo.hardDeleteWorkspaceWithCanvasStorageOutbox(db, {
        workspacePublicId: seeded.workspace.publicId,
        expectedWorkspaceId: seeded.workspace.id,
        userId: seeded.user.id,
      });
    expect(result).toEqual({
      deleted: true,
      s3Keys: [".objects/deletewimg01"],
    });
    await expect(
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, seeded.workspace.id)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(workspaceCanvasImageUploadSessions),
    ).resolves.toHaveLength(0);
    await expect(db.select().from(workspaceCanvasImages)).resolves.toHaveLength(
      0,
    );
    const outbox = await db
      .select({
        s3Key: workspaceCanvasImageStorageDeletions.s3Key,
        availableAt: workspaceCanvasImageStorageDeletions.availableAt,
        completedAt: workspaceCanvasImageStorageDeletions.completedAt,
      })
      .from(workspaceCanvasImageStorageDeletions);
    const finalDeletion = outbox.find(
      (item) => item.s3Key === ".objects/deletewimg01",
    );
    const stagingDeletion = outbox.find((item) => item.s3Key === session.s3Key);
    expect(finalDeletion?.completedAt).toBeNull();
    expect(finalDeletion?.availableAt.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    expect(stagingDeletion?.completedAt).toBeNull();
    expect(stagingDeletion?.availableAt.getTime()).toBeGreaterThan(Date.now());

    await canvasImageRepo.markWorkspaceCanvasImageStorageDeleted(
      db,
      result.s3Keys,
    );
    await expect(
      canvasImageRepo.listPendingWorkspaceCanvasStorageDeletionKeys(db),
    ).resolves.toEqual([]);
    await db
      .update(workspaceCanvasImageStorageDeletions)
      .set({ availableAt: new Date(Date.now() - 1) })
      .where(eq(workspaceCanvasImageStorageDeletions.s3Key, session.s3Key));
    await expect(
      canvasImageRepo.listPendingWorkspaceCanvasStorageDeletionKeys(db),
    ).resolves.toEqual([{ s3Key: session.s3Key }]);
  });
});
