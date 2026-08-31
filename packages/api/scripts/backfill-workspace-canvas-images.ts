import { timingSafeEqual } from "node:crypto";

import { createDrizzleClient } from "@kan/db/client";
import { WORKSPACE_CANVAS_IMAGE_REPLACEMENT_GRACE_MS } from "@kan/db/repository/workspaceCanvasImage.internal";
import * as workspaceCanvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";
import {
  generateUID,
  getAttachmentObject,
  inspectObject,
  normalizeAttachmentContentType,
  putObject,
} from "@kan/shared/utils";

import {
  drainWorkspaceCanvasImageStorageDeletions,
  isWorkspaceCanvasImageBackfillComplete,
  parseWorkspaceCanvasImageBackfillConcurrency,
  persistWorkspaceCanvasBackfillReplacement,
  runWorkspaceCanvasImageBackfill,
} from "../src/utils/workspace-canvas-image-backfill";
import {
  loadAndOptimizeWorkspaceCanvasImage,
  WorkspaceCanvasImageOptimizationError,
} from "../src/utils/workspace-canvas-image-optimizer";
import { deleteReclaimedWorkspaceCanvasImageObjects } from "../src/utils/workspace-canvas-image-upload";

const hashesMatch = (expected: string, actual: string) => {
  const expectedHash = Buffer.from(expected, "hex");
  const actualHash = Buffer.from(actual, "hex");
  return (
    expectedHash.length === actualHash.length &&
    timingSafeEqual(expectedHash, actualHash)
  );
};

type Image = Awaited<
  ReturnType<
    typeof workspaceCanvasImageRepo.claimWorkspaceCanvasImageOptimizationBatch
  >
>[number];

const backfillErrorCodes = new Set([
  "IMAGE_OPTIMIZATION_BUSY",
  "SOURCE_METADATA_MISMATCH",
  "SOURCE_BODY_MISSING",
  "STORAGE_RESERVATION_FAILED",
  "PHYSICAL_STORAGE_BUDGET_EXCEEDED",
  "OPTIMIZED_METADATA_INVALID",
  "BACKFILL_RECONCILIATION_FAILED",
  "WORKSPACE_CANVAS_IMAGE_BACKFILL_INCOMPLETE",
  "BACKFILL_CONFIGURATION_MISSING",
  "BACKFILL_CONFIGURATION_INVALID",
]);

const getBackfillErrorCode = (error: unknown) => {
  if (error instanceof WorkspaceCanvasImageOptimizationError) {
    return error.code;
  }
  if (error instanceof Error && backfillErrorCodes.has(error.message)) {
    return error.message;
  }
  return "BACKFILL_OPERATION_FAILED";
};

const optimizeImage = async (
  db: ReturnType<typeof createDrizzleClient>,
  bucket: string,
  image: Image,
) => {
  const optimized = await loadAndOptimizeWorkspaceCanvasImage(db, async () => {
    const inspected = await inspectObject(bucket, image.s3Key, {
      maxBytes: image.size,
      expectedBytes: image.size,
    });
    if (
      normalizeAttachmentContentType(inspected.contentType) !==
        image.contentType ||
      !hashesMatch(image.sha256, inspected.sha256)
    ) {
      throw new Error("SOURCE_METADATA_MISMATCH");
    }
    const object = await getAttachmentObject({
      bucket,
      key: image.s3Key,
      ifMatch: inspected.etag,
    });
    if (!object.Body) throw new Error("SOURCE_BODY_MISSING");
    return {
      bytes: await object.Body.transformToByteArray(),
      contentType: image.contentType,
    };
  });
  const finalS3Key = `.objects/${generateUID()}`;
  const completionInput = {
    imageId: image.id,
    imagePublicId: image.publicId,
    workspaceId: image.workspaceId,
    workspacePublicId: image.workspacePublicId,
    expectedS3Key: image.s3Key,
    expectedSha256: image.sha256,
    finalS3Key,
    finalContentType: optimized.contentType,
    finalSize: optimized.size,
    finalSha256: optimized.sha256,
    width: optimized.width,
    height: optimized.height,
    optimizedAt: new Date(),
  } as const;
  const reservation =
    await workspaceCanvasImageRepo.reserveWorkspaceCanvasImageOptimizationObject(
      db,
      completionInput,
    );
  await deleteReclaimedWorkspaceCanvasImageObjects(
    db,
    "reclaimedS3Keys" in reservation ? (reservation.reclaimedS3Keys ?? []) : [],
  );
  if (reservation.status === "stale") return "stale";
  if (reservation.status === "storage_budget") {
    throw new Error("PHYSICAL_STORAGE_BUDGET_EXCEEDED");
  }
  if (reservation.status === "invalid_optimized_image") {
    throw new Error("OPTIMIZED_METADATA_INVALID");
  }
  if (reservation.status !== "reserved") {
    throw new Error("STORAGE_RESERVATION_FAILED");
  }
  const result = await persistWorkspaceCanvasBackfillReplacement({
    writeFinal: () =>
      putObject({
        bucket,
        key: finalS3Key,
        body: optimized.bytes,
        contentType: optimized.contentType,
      }),
    complete: () =>
      workspaceCanvasImageRepo.completeWorkspaceCanvasImageOptimization(
        db,
        completionInput,
      ),
    reconcileAfterCompleteError: async () => {
      const reconciliation =
        await workspaceCanvasImageRepo.reconcileWorkspaceCanvasImageOptimization(
          db,
          completionInput,
        );
      if (reconciliation.status === "completed") {
        return { status: "completed", result: reconciliation };
      }
      if (reconciliation.status === "not_persisted") {
        return { status: "not_persisted" };
      }
      throw new Error("BACKFILL_RECONCILIATION_FAILED");
    },
    discardUncommittedFinal: () =>
      deleteReclaimedWorkspaceCanvasImageObjects(db, [finalS3Key]),
  });
  await deleteReclaimedWorkspaceCanvasImageObjects(db, result.reclaimedS3Keys);
  if (result.status === "completed" || result.status === "stale") {
    return result.status;
  }
  throw new Error(
    result.status === "storage_budget"
      ? "PHYSICAL_STORAGE_BUDGET_EXCEEDED"
      : "OPTIMIZED_METADATA_INVALID",
  );
};

const main = async () => {
  const bucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
  if (!process.env.POSTGRES_URL || !bucket) {
    throw new Error("BACKFILL_CONFIGURATION_MISSING");
  }
  const db = createDrizzleClient();
  const concurrency = parseWorkspaceCanvasImageBackfillConcurrency(
    process.env.WORKSPACE_CANVAS_IMAGE_BACKFILL_CONCURRENCY,
  );
  const priorityWorkspacePublicId =
    process.env.WORKSPACE_CANVAS_IMAGE_BACKFILL_FIRST_WORKSPACE_PUBLIC_ID;
  if (
    priorityWorkspacePublicId &&
    !/^[a-z0-9]{12}$/.test(priorityWorkspacePublicId)
  ) {
    throw new Error("BACKFILL_CONFIGURATION_INVALID");
  }
  try {
    const summary = await runWorkspaceCanvasImageBackfill({
      concurrency,
      priorityWorkspacePublicId,
      claimBatch: (input) =>
        workspaceCanvasImageRepo.claimWorkspaceCanvasImageOptimizationBatch(
          db,
          input,
        ),
      optimizeImage: (image) => optimizeImage(db, bucket, image),
      onImageFailure: (image, error) => {
        process.stderr.write(
          `${JSON.stringify({
            event: "workspace_canvas_image_backfill_item_failed",
            imagePublicId: image.publicId,
            code: getBackfillErrorCode(error),
          })}\n`,
        );
      },
      flushStorageDeletions: () =>
        deleteReclaimedWorkspaceCanvasImageObjects(db, []),
      countPendingStorageDeletions: () =>
        workspaceCanvasImageRepo.countPendingWorkspaceCanvasStorageDeletions(
          db,
        ),
    });
    if (summary.completed > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, WORKSPACE_CANVAS_IMAGE_REPLACEMENT_GRACE_MS),
      );
      summary.pendingStorage = await drainWorkspaceCanvasImageStorageDeletions({
        flushStorageDeletions: () =>
          deleteReclaimedWorkspaceCanvasImageObjects(db, []),
        countPendingStorageDeletions: () =>
          workspaceCanvasImageRepo.countPendingWorkspaceCanvasStorageDeletions(
            db,
          ),
      });
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (!isWorkspaceCanvasImageBackfillComplete(summary)) {
      throw new Error("WORKSPACE_CANVAS_IMAGE_BACKFILL_INCOMPLETE");
    }
  } finally {
    await db.$client.end();
  }
};

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      event: "workspace_canvas_image_backfill_failed",
      code: getBackfillErrorCode(error),
    })}\n`,
  );
  process.exitCode = 1;
});
