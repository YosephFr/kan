import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { getPhysicalImageUsage } from "@kan/db/repository/workspaceCanvasImage.internal";
import * as canvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";
import {
  workspaceCanvasImages,
  workspaceCanvasImageStorageDeletions,
  workspaceCanvasImageUploadSessions,
  workspaces,
} from "@kan/db/schema";
import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES,
  MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES,
} from "@kan/shared";

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

  const insertSharedImageSizes = async (sizes: number[]) => {
    const sessions = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values(
        sizes.map((size, index) => ({
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
          size: sizes[index] ?? 1,
          s3Key: `.objects/${publicId}`,
          sha256: "b".repeat(64),
          uploadSessionId: session.id,
          createdBy: seeded.user.id,
          sharedAt: new Date(),
        };
      }),
    );
  };

  const insertSharedImages = async (count: number, size: number) =>
    insertSharedImageSizes(Array.from({ length: count }, () => size));

  const getSharedImages = async (publicIds: string[]) =>
    db
      .select({
        id: workspaceCanvasImages.id,
        publicId: workspaceCanvasImages.publicId,
        s3Key: workspaceCanvasImages.s3Key,
        sha256: workspaceCanvasImages.sha256,
      })
      .from(workspaceCanvasImages)
      .where(inArray(workspaceCanvasImages.publicId, publicIds))
      .orderBy(workspaceCanvasImages.id);

  it("allows 251 retained images when they fit the physical budget", async () => {
    await insertSharedImages(251, 1);

    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "available" });
  });

  it("caps retained upload-share-remove cycles by physical bytes", async () => {
    await insertSharedImages(20, MAX_CARD_CANVAS_IMAGE_BYTES);
    expect(MAX_CARD_CANVAS_IMAGE_BYTES * 20).toBe(
      MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES,
    );

    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "storage_budget" });
  });

  it("counts a future one-byte tombstone as 64 KiB toward the 200 MiB budget", async () => {
    await insertSharedImageSizes([
      ...Array.from({ length: 19 }, () => MAX_CARD_CANVAS_IMAGE_BYTES),
      MAX_CARD_CANVAS_IMAGE_BYTES - MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES,
    ]);
    const futureS3Key = ".objects/futurequota1";
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [
        {
          s3Key: futureS3Key,
          workspaceId: seeded.workspace.id,
          size: 1,
        },
      ],
      new Date(Date.now() + 60_000),
    );

    await expect(
      canvasImageRepo.listPendingWorkspaceCanvasStorageDeletionKeys(db),
    ).resolves.toEqual([]);
    const usage = await db.transaction((tx) =>
      getPhysicalImageUsage(tx, seeded.workspace.id),
    );
    expect(usage.totalBytes).toBe(MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES);
    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toEqual({ status: "storage_budget" });
    await expect(
      db
        .select({
          completedAt: workspaceCanvasImageStorageDeletions.completedAt,
        })
        .from(workspaceCanvasImageStorageDeletions)
        .where(eq(workspaceCanvasImageStorageDeletions.s3Key, futureS3Key)),
    ).resolves.toEqual([{ completedAt: null }]);
  });

  it("retains the 64 KiB charge while deferring consumed staging cleanup until its signed URL expires", async () => {
    await insertSharedImageSizes([
      ...Array.from({ length: 19 }, () => MAX_CARD_CANVAS_IMAGE_BYTES),
      MAX_CARD_CANVAS_IMAGE_BYTES - 2 * MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES,
    ]);
    const now = Date.now();
    const uploads = await db
      .insert(workspaceCanvasImageUploadSessions)
      .values([
        {
          publicId: "physcons0001",
          workspaceId: seeded.workspace.id,
          userId: seeded.user.id,
          s3Key: ".uploads/physcons0001/meta.png",
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 1,
          sha256: "c".repeat(64),
          expiresAt: new Date(now + 60_000),
          consumedAt: new Date(now - 1_000),
        },
        {
          publicId: "physexpr0001",
          workspaceId: seeded.workspace.id,
          userId: seeded.user.id,
          s3Key: ".uploads/physexpr0001/meta.png",
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 1,
          sha256: "d".repeat(64),
          expiresAt: new Date(now - 60_000),
        },
      ])
      .returning({ s3Key: workspaceCanvasImageUploadSessions.s3Key });
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      uploads.map((upload) => ({
        s3Key: upload.s3Key,
        workspaceId: seeded.workspace.id,
        size: 1,
      })),
      new Date(now - 1_000),
    );
    await expect(
      canvasImageRepo.markWorkspaceCanvasStorageDeletionAttempted(
        db,
        uploads.map((upload) => upload.s3Key),
      ),
    ).resolves.toHaveLength(2);

    const usage = await db.transaction((tx) =>
      getPhysicalImageUsage(tx, seeded.workspace.id),
    );
    expect(usage.totalBytes).toBe(MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES);
    const attempts = await db
      .select({
        attempts: workspaceCanvasImageStorageDeletions.attempts,
        completedAt: workspaceCanvasImageStorageDeletions.completedAt,
      })
      .from(workspaceCanvasImageStorageDeletions);
    expect(attempts).toHaveLength(2);
    expect(
      attempts.every(
        (attempt) => attempt.attempts === 1 && attempt.completedAt === null,
      ),
    ).toBe(true);

    const first = await canvasImageRepo.preflightImageImport(db, {
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
    });
    expect(first).toMatchObject({ status: "storage_budget" });
    expect(
      "reclaimedS3Keys" in first
        ? [...(first.reclaimedS3Keys ?? [])].sort()
        : [],
    ).toEqual([uploads[1]?.s3Key]);
    const retry = await canvasImageRepo.preflightImageImport(db, {
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
    });
    expect(retry).toMatchObject({ status: "storage_budget" });
    expect(
      "reclaimedS3Keys" in retry
        ? [...(retry.reclaimedS3Keys ?? [])].sort()
        : [],
    ).toEqual([uploads[1]?.s3Key]);
  });

  it("uses one time snapshot when deciding whether staging is retained", async () => {
    const expiresAt = new Date(Date.now() - 1_000);
    await db.insert(workspaceCanvasImageUploadSessions).values({
      publicId: "timesnap0001",
      workspaceId: seeded.workspace.id,
      userId: seeded.user.id,
      s3Key: ".uploads/timesnap0001/meta.png",
      filename: "meta.png",
      originalFilename: "meta.png",
      contentType: "image/png",
      size: 128,
      sha256: "e".repeat(64),
      expiresAt,
    });

    await expect(
      db.transaction((tx) =>
        getPhysicalImageUsage(
          tx,
          seeded.workspace.id,
          new Date(expiresAt.getTime() - 1),
        ),
      ),
    ).resolves.toMatchObject({ totalBytes: 0 });
    await expect(
      db.transaction((tx) =>
        getPhysicalImageUsage(tx, seeded.workspace.id, expiresAt),
      ),
    ).resolves.toMatchObject({
      totalBytes: MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES,
    });
  });

  it("reclaims consumed staging only after its signed URL expires", async () => {
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
    expect(first).toMatchObject({ status: "available" });
    expect(
      "reclaimedS3Keys" in first
        ? [...(first.reclaimedS3Keys ?? [])].sort()
        : [],
    ).toEqual([expired.s3Key]);
    const retry = await canvasImageRepo.preflightImageImport(db, {
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
    });
    expect(retry).toMatchObject({ status: "available" });
    expect("reclaimedS3Keys" in retry ? retry.reclaimedS3Keys : []).toEqual([
      expired.s3Key,
    ]);

    await canvasImageRepo.markWorkspaceCanvasImageStorageDeleted(db, [
      expired.s3Key,
      consumed.s3Key,
    ]);
    await db
      .update(workspaceCanvasImageUploadSessions)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(workspaceCanvasImageUploadSessions.id, consumed.id));
    await db
      .update(workspaceCanvasImageStorageDeletions)
      .set({ availableAt: new Date(Date.now() - 1) })
      .where(eq(workspaceCanvasImageStorageDeletions.s3Key, consumed.s3Key));
    await canvasImageRepo.markWorkspaceCanvasImageStorageDeleted(db, [
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

  it("keeps a successful staging deletion reserved until the signed URL expires", async () => {
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
    const [retainedUpload] = await db
      .select({
        storageDeletedAt: workspaceCanvasImageUploadSessions.storageDeletedAt,
      })
      .from(workspaceCanvasImageUploadSessions)
      .where(eq(workspaceCanvasImageUploadSessions.publicId, "stagingses01"));
    expect(retainedUpload?.storageDeletedAt).toBeNull();

    await db
      .update(workspaceCanvasImageUploadSessions)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(workspaceCanvasImageUploadSessions.publicId, "stagingses01"));
    await db
      .update(workspaceCanvasImageStorageDeletions)
      .set({ availableAt: new Date(Date.now() - 1) })
      .where(eq(workspaceCanvasImageStorageDeletions.s3Key, s3Key));
    await canvasImageRepo.markWorkspaceCanvasImageStorageDeleted(db, [s3Key]);
    const [completed] = await db
      .select({
        completedAt: workspaceCanvasImageStorageDeletions.completedAt,
      })
      .from(workspaceCanvasImageStorageDeletions)
      .where(eq(workspaceCanvasImageStorageDeletions.s3Key, s3Key));
    expect(completed?.completedAt).toBeInstanceOf(Date);
  });

  it("cannot shorten a presigned staging URL when an upload is abandoned", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const s3Key = ".uploads/abandonses1/meta.png";
    await canvasImageRepo.createUploadSession(db, {
      publicId: "abandonses1",
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
      s3Key,
      filename: "meta.png",
      originalFilename: "meta.png",
      contentType: "image/png",
      size: 128,
      sha256: "f".repeat(64),
      expiresAt,
    });
    await canvasImageRepo.claimUploadSession(db, {
      publicId: "abandonses1",
      workspacePublicId: seeded.workspace.publicId,
      userId: seeded.user.id,
      claimToken: "abandonclaim",
      claimExpiresAt: new Date(Date.now() + 30_000),
    });

    await expect(
      canvasImageRepo.abandonClaimedUploadSession(db, {
        publicId: "abandonses1",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken: "abandonclaim",
      }),
    ).resolves.toEqual({ status: "abandoned", s3Key });
    const [abandoned] = await db
      .select({
        expiresAt: workspaceCanvasImageUploadSessions.expiresAt,
        consumedAt: workspaceCanvasImageUploadSessions.consumedAt,
        storageDeletedAt: workspaceCanvasImageUploadSessions.storageDeletedAt,
      })
      .from(workspaceCanvasImageUploadSessions)
      .where(eq(workspaceCanvasImageUploadSessions.publicId, "abandonses1"));
    expect(abandoned?.expiresAt).toEqual(expiresAt);
    expect(abandoned?.consumedAt).toBeInstanceOf(Date);
    expect(abandoned?.storageDeletedAt).toBeNull();

    await canvasImageRepo.markWorkspaceCanvasImageStorageDeleted(db, [s3Key]);
    const [tombstone] = await db
      .select({
        availableAt: workspaceCanvasImageStorageDeletions.availableAt,
        completedAt: workspaceCanvasImageStorageDeletions.completedAt,
      })
      .from(workspaceCanvasImageStorageDeletions)
      .where(eq(workspaceCanvasImageStorageDeletions.s3Key, s3Key));
    expect(tombstone?.availableAt.getTime()).toBeGreaterThan(
      expiresAt.getTime(),
    );
    expect(tombstone?.completedAt).toBeNull();
  });

  it("does not free pending capacity by abandoning above the physical budget", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const quotaCharge = MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES;
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [
        {
          s3Key: ".objects/abandonbase",
          workspaceId: seeded.workspace.id,
          size: MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES - quotaCharge,
        },
      ],
      expiresAt,
    );

    for (const suffix of ["01", "02"]) {
      await expect(
        canvasImageRepo.createUploadSession(db, {
          publicId: `abandquota${suffix}`,
          workspacePublicId: seeded.workspace.publicId,
          userId: seeded.user.id,
          s3Key: `.uploads/abandquota${suffix}/meta.png`,
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 128,
          sha256: suffix.repeat(32),
          expiresAt,
        }),
      ).resolves.toMatchObject({ status: "created" });
      await expect(
        canvasImageRepo.claimUploadSession(db, {
          publicId: `abandquota${suffix}`,
          workspacePublicId: seeded.workspace.publicId,
          userId: seeded.user.id,
          claimToken: `abandclaim${suffix}`,
          claimExpiresAt: expiresAt,
        }),
      ).resolves.toMatchObject({ status: "claimed" });
    }

    await expect(
      canvasImageRepo.abandonClaimedUploadSession(db, {
        publicId: "abandquota01",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken: "abandclaim01",
      }),
    ).resolves.toMatchObject({ status: "abandoned" });
    await expect(
      canvasImageRepo.abandonClaimedUploadSession(db, {
        publicId: "abandquota02",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken: "abandclaim02",
      }),
    ).resolves.toMatchObject({ status: "retained" });

    const usage = await db.transaction((tx) =>
      getPhysicalImageUsage(tx, seeded.workspace.id),
    );
    expect(usage.totalBytes).toBe(MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES);
    await expect(
      db
        .select({
          publicId: workspaceCanvasImageUploadSessions.publicId,
          consumedAt: workspaceCanvasImageUploadSessions.consumedAt,
        })
        .from(workspaceCanvasImageUploadSessions)
        .where(eq(workspaceCanvasImageUploadSessions.publicId, "abandquota02")),
    ).resolves.toEqual([{ publicId: "abandquota02", consumedAt: null }]);
  });

  it("does not reserve or charge final objects when retries exceed the physical budget", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const sessionPublicId = "rsvretry0001";
    const claimToken = "rsvclaim0001";
    const retryS3Keys = [
      ".objects/retryobj0001",
      ".objects/retryobj0002",
      ".objects/retryobj0003",
    ];
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [
        {
          s3Key: ".objects/retrybase001",
          workspaceId: seeded.workspace.id,
          size: MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES - 1,
        },
      ],
      expiresAt,
    );
    await expect(
      canvasImageRepo.createUploadSession(db, {
        publicId: sessionPublicId,
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        s3Key: `.uploads/${sessionPublicId}/meta.png`,
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 128,
        sha256: "a".repeat(64),
        expiresAt,
      }),
    ).resolves.toMatchObject({ status: "created" });
    await expect(
      canvasImageRepo.claimUploadSession(db, {
        publicId: sessionPublicId,
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken,
        claimExpiresAt: expiresAt,
      }),
    ).resolves.toMatchObject({ status: "claimed" });

    for (const finalS3Key of retryS3Keys) {
      await expect(
        canvasImageRepo.reserveUploadFinalObject(db, {
          sessionPublicId,
          workspacePublicId: seeded.workspace.publicId,
          userId: seeded.user.id,
          claimToken,
          finalS3Key,
          finalSize: 128,
        }),
      ).resolves.toMatchObject({ status: "storage_budget" });
    }

    const deletionKeys = await db
      .select({ s3Key: workspaceCanvasImageStorageDeletions.s3Key })
      .from(workspaceCanvasImageStorageDeletions);
    expect(
      deletionKeys.filter(({ s3Key }) => retryS3Keys.includes(s3Key)),
    ).toEqual([]);
    const usage = await db.transaction((tx) =>
      getPhysicalImageUsage(tx, seeded.workspace.id),
    );
    expect(usage.totalBytes).toBe(
      MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES - 1,
    );
    expect(usage.totalBytes).toBeLessThanOrEqual(
      MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES,
    );
  });

  it("does not reserve backfill objects when retries exceed the physical budget", async () => {
    const quotaCharge = MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES;
    const finalS3Keys = [
      ".objects/optretry0001",
      ".objects/optretry0002",
      ".objects/optretry0003",
    ];
    await insertSharedImageSizes([1]);
    const [legacy] = await getSharedImages(["imgphy000000"]);
    if (!legacy) throw new Error("Legacy image missing");
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [
        {
          s3Key: ".objects/optbase00001",
          workspaceId: seeded.workspace.id,
          size: MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES - quotaCharge,
        },
      ],
      new Date(Date.now() + 60_000),
    );

    const baseline = await db.transaction((tx) =>
      getPhysicalImageUsage(tx, seeded.workspace.id),
    );
    expect(baseline.totalBytes).toBe(MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES);
    for (const finalS3Key of finalS3Keys) {
      await expect(
        canvasImageRepo.reserveWorkspaceCanvasImageOptimizationObject(db, {
          imageId: legacy.id,
          imagePublicId: legacy.publicId,
          workspaceId: seeded.workspace.id,
          workspacePublicId: seeded.workspace.publicId,
          expectedS3Key: legacy.s3Key,
          expectedSha256: legacy.sha256,
          finalS3Key,
          finalContentType: "image/webp",
          finalSize: 128,
          finalSha256: "f".repeat(64),
          width: 1,
          height: 1,
          optimizedAt: new Date(),
        }),
      ).resolves.toMatchObject({ status: "storage_budget" });
    }

    const deletionKeys = await db
      .select({ s3Key: workspaceCanvasImageStorageDeletions.s3Key })
      .from(workspaceCanvasImageStorageDeletions);
    expect(
      deletionKeys.filter(({ s3Key }) => finalS3Keys.includes(s3Key)),
    ).toEqual([]);
    const usage = await db.transaction((tx) =>
      getPhysicalImageUsage(tx, seeded.workspace.id),
    );
    expect(usage).toEqual(baseline);
    expect(usage.totalBytes).toBeLessThanOrEqual(
      MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES,
    );
  });

  it("serializes concurrent final-object reservations at the physical budget", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const quotaCharge = MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES;
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [
        {
          s3Key: ".objects/concurbase01",
          workspaceId: seeded.workspace.id,
          size: MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES - 2 * quotaCharge,
        },
      ],
      expiresAt,
    );
    const uploads = [
      {
        sessionPublicId: "rsvconcur001",
        claimToken: "rsvclaim0002",
        finalS3Key: ".objects/rsvobject001",
      },
      {
        sessionPublicId: "rsvconcur002",
        claimToken: "rsvclaim0003",
        finalS3Key: ".objects/rsvobject002",
      },
    ];
    for (const [index, upload] of uploads.entries()) {
      await expect(
        canvasImageRepo.createUploadSession(db, {
          publicId: upload.sessionPublicId,
          workspacePublicId: seeded.workspace.publicId,
          userId: seeded.user.id,
          s3Key: `.uploads/${upload.sessionPublicId}/meta.png`,
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 128,
          sha256: String(index + 1).repeat(64),
          expiresAt,
        }),
      ).resolves.toMatchObject({ status: "created" });
      await expect(
        canvasImageRepo.claimUploadSession(db, {
          publicId: upload.sessionPublicId,
          workspacePublicId: seeded.workspace.publicId,
          userId: seeded.user.id,
          claimToken: upload.claimToken,
          claimExpiresAt: expiresAt,
        }),
      ).resolves.toMatchObject({ status: "claimed" });
    }

    const results = await Promise.all(
      uploads.map((upload) =>
        canvasImageRepo.reserveUploadFinalObject(db, {
          sessionPublicId: upload.sessionPublicId,
          workspacePublicId: seeded.workspace.publicId,
          userId: seeded.user.id,
          claimToken: upload.claimToken,
          finalS3Key: upload.finalS3Key,
          finalSize: 128,
        }),
      ),
    );

    expect(results.map(({ status }) => status).sort()).toEqual([
      "reserved",
      "storage_budget",
    ]);
    const deletionKeys = await db
      .select({ s3Key: workspaceCanvasImageStorageDeletions.s3Key })
      .from(workspaceCanvasImageStorageDeletions);
    expect(
      deletionKeys.filter(({ s3Key }) =>
        uploads.some((upload) => upload.finalS3Key === s3Key),
      ),
    ).toHaveLength(1);
    const usage = await db.transaction((tx) =>
      getPhysicalImageUsage(tx, seeded.workspace.id),
    );
    expect(usage.totalBytes).toBe(
      MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES - quotaCharge,
    );
    expect(usage.totalBytes).toBeLessThanOrEqual(
      MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES,
    );
  });

  it("serializes concurrent backfill reservations at the physical budget", async () => {
    const quotaCharge = MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES;
    const finalS3Keys = [".objects/optconcur001", ".objects/optconcur002"];
    await insertSharedImageSizes([1, 1]);
    const legacyImages = await getSharedImages([
      "imgphy000000",
      "imgphy000001",
    ]);
    expect(legacyImages).toHaveLength(2);
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [
        {
          s3Key: ".objects/optbase00002",
          workspaceId: seeded.workspace.id,
          size: MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES - 3 * quotaCharge,
        },
      ],
      new Date(Date.now() + 60_000),
    );

    const results = await Promise.all(
      legacyImages.map((legacy, index) =>
        canvasImageRepo.reserveWorkspaceCanvasImageOptimizationObject(db, {
          imageId: legacy.id,
          imagePublicId: legacy.publicId,
          workspaceId: seeded.workspace.id,
          workspacePublicId: seeded.workspace.publicId,
          expectedS3Key: legacy.s3Key,
          expectedSha256: legacy.sha256,
          finalS3Key: finalS3Keys[index] ?? ".objects/optinvalid01",
          finalContentType: "image/webp",
          finalSize: 128,
          finalSha256: "f".repeat(64),
          width: 1,
          height: 1,
          optimizedAt: new Date(),
        }),
      ),
    );

    expect(results.map(({ status }) => status).sort()).toEqual([
      "reserved",
      "storage_budget",
    ]);
    const deletionKeys = await db
      .select({ s3Key: workspaceCanvasImageStorageDeletions.s3Key })
      .from(workspaceCanvasImageStorageDeletions);
    expect(
      deletionKeys.filter(({ s3Key }) => finalS3Keys.includes(s3Key)),
    ).toHaveLength(1);
    const usage = await db.transaction((tx) =>
      getPhysicalImageUsage(tx, seeded.workspace.id),
    );
    expect(usage.totalBytes).toBe(MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES);
    expect(usage.totalBytes).toBeLessThanOrEqual(
      MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES,
    );
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
    await expect(
      canvasImageRepo.reserveUploadFinalObject(db, {
        sessionPublicId: "finalsession",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken: "finalclaim01",
        finalS3Key,
        finalSize: 128,
      }),
    ).resolves.toMatchObject({ status: "reserved" });

    await expect(
      canvasImageRepo.consumeUploadSession(db, {
        sessionPublicId: "finalsession",
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken: "finalclaim01",
        finalS3Key,
        finalContentType: "image/webp",
        finalSize: 128,
        finalSha256: "b".repeat(64),
        width: 640,
        height: 480,
        optimizedAt: new Date(),
      }),
    ).resolves.toMatchObject({ status: "created" });
    const [completed] = await db
      .select({ completedAt: workspaceCanvasImageStorageDeletions.completedAt })
      .from(workspaceCanvasImageStorageDeletions)
      .where(eq(workspaceCanvasImageStorageDeletions.s3Key, finalS3Key));
    expect(completed?.completedAt).toBeInstanceOf(Date);
  });

  it("rejects consumption at the physical limit before staging becomes retained", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const quotaCharge = MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES;
    const sessionPublicId = "budgetses001";
    const claimToken = "budgetclm001";
    const finalS3Key = ".objects/budgetobj001";

    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [
        {
          s3Key: ".objects/retquota0001",
          workspaceId: seeded.workspace.id,
          size: MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES - quotaCharge,
        },
      ],
      expiresAt,
    );
    await expect(
      canvasImageRepo.createUploadSession(db, {
        publicId: sessionPublicId,
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        s3Key: `.uploads/${sessionPublicId}/meta.png`,
        filename: "meta.png",
        originalFilename: "meta.png",
        contentType: "image/png",
        size: 128,
        sha256: "a".repeat(64),
        expiresAt,
      }),
    ).resolves.toMatchObject({ status: "created" });
    await expect(
      canvasImageRepo.claimUploadSession(db, {
        publicId: sessionPublicId,
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken,
        claimExpiresAt: expiresAt,
      }),
    ).resolves.toMatchObject({ status: "claimed" });
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [
        {
          s3Key: finalS3Key,
          workspaceId: seeded.workspace.id,
          size: 128,
        },
      ],
      expiresAt,
    );

    const usage = await db.transaction((tx) =>
      getPhysicalImageUsage(tx, seeded.workspace.id),
    );
    expect(usage.totalBytes).toBe(MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES);
    await expect(
      canvasImageRepo.consumeUploadSession(db, {
        sessionPublicId,
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
        claimToken,
        finalS3Key,
        finalContentType: "image/webp",
        finalSize: 128,
        finalSha256: "b".repeat(64),
        width: 640,
        height: 480,
        optimizedAt: new Date(),
      }),
    ).resolves.toMatchObject({ status: "storage_budget" });
    await expect(
      db
        .select({ consumedAt: workspaceCanvasImageUploadSessions.consumedAt })
        .from(workspaceCanvasImageUploadSessions)
        .where(
          eq(workspaceCanvasImageUploadSessions.publicId, sessionPublicId),
        ),
    ).resolves.toEqual([{ consumedAt: null }]);
  });

  it("serializes three confirmations without letting staging cleanup cancel its peers", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const quotaCharge = MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES;
    const retainedBytes =
      MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES - 6 * quotaCharge;
    await canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
      db,
      [
        {
          s3Key: ".objects/retainedbase",
          workspaceId: seeded.workspace.id,
          size: retainedBytes,
        },
      ],
      expiresAt,
    );
    const uploads = Array.from({ length: 3 }, (_, index) => {
      const suffix = String(index + 1).padStart(7, "0");
      return {
        sessionPublicId: `ccses${suffix}`,
        claimToken: `ccclm${suffix}`,
        finalS3Key: `.objects/ccobj${suffix}`,
        sha256: String(index + 1).repeat(64),
      };
    });
    for (const upload of uploads) {
      await expect(
        canvasImageRepo.createUploadSession(db, {
          publicId: upload.sessionPublicId,
          workspacePublicId: seeded.workspace.publicId,
          userId: seeded.user.id,
          s3Key: `.uploads/${upload.sessionPublicId}/meta.png`,
          filename: "meta.png",
          originalFilename: "meta.png",
          contentType: "image/png",
          size: 128,
          sha256: "a".repeat(64),
          expiresAt,
        }),
      ).resolves.toMatchObject({ status: "created" });
      await expect(
        canvasImageRepo.claimUploadSession(db, {
          publicId: upload.sessionPublicId,
          workspacePublicId: seeded.workspace.publicId,
          userId: seeded.user.id,
          claimToken: upload.claimToken,
          claimExpiresAt: expiresAt,
        }),
      ).resolves.toMatchObject({ status: "claimed" });
    }
    await expect(
      canvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
        db,
        uploads.map((upload) => ({
          s3Key: upload.finalS3Key,
          workspaceId: seeded.workspace.id,
          size: 128,
        })),
        expiresAt,
      ),
    ).resolves.toHaveLength(3);

    const results = await Promise.all(
      uploads.map((upload) =>
        canvasImageRepo.consumeUploadSession(db, {
          sessionPublicId: upload.sessionPublicId,
          workspacePublicId: seeded.workspace.publicId,
          userId: seeded.user.id,
          claimToken: upload.claimToken,
          finalS3Key: upload.finalS3Key,
          finalContentType: "image/webp",
          finalSize: 128,
          finalSha256: upload.sha256,
          width: 640,
          height: 480,
          optimizedAt: new Date(),
        }),
      ),
    );

    expect(results.map((result) => result.status)).toEqual([
      "created",
      "created",
      "created",
    ]);
    await expect(db.select().from(workspaceCanvasImages)).resolves.toHaveLength(
      3,
    );
    const usage = await db.transaction((tx) =>
      getPhysicalImageUsage(tx, seeded.workspace.id),
    );
    expect(usage.totalBytes).toBe(MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES);
    await expect(
      canvasImageRepo.preflightImageImport(db, {
        workspacePublicId: seeded.workspace.publicId,
        userId: seeded.user.id,
      }),
    ).resolves.toMatchObject({ status: "storage_budget" });
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
    expect(result).toMatchObject({ status: "available" });
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
