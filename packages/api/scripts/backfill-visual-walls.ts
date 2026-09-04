import { createDrizzleClient } from "@kan/db/client";
import * as cardVisualWallRepo from "@kan/db/repository/cardVisualWall.repo";
import {
  backfillVisualWallsFromLegacyCanvases,
  countMissingCardPreviews,
  listMissingCardPreviewSources,
  saveBackfilledCardPreview,
} from "@kan/db/repository/visualWallBackfill.repo";
import { MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES } from "@kan/shared";
import {
  generateUID,
  getAttachmentObject,
  getObjectMetadata,
  normalizeAttachmentContentType,
  putObject,
  readObjectBodyWithLimit,
} from "@kan/shared/utils";

import {
  deleteCardVisualWallPreviewObjects,
  drainCardVisualWallPreviewStorageDeletions,
} from "../src/utils/card-visual-wall-preview";
import {
  loadAndOptimizeWorkspaceCanvasImage,
  WorkspaceCanvasImageOptimizationError,
} from "../src/utils/workspace-canvas-image-optimizer";

const errorCodes = new Set([
  "VISUAL_WALL_BACKFILL_CONFIGURATION_MISSING",
  "VISUAL_WALL_BACKFILL_INCOMPLETE",
  "VISUAL_WALL_BACKFILL_SOURCE_INVALID",
  "VISUAL_WALL_BACKFILL_SOURCE_MISSING",
  "IMAGE_OPTIMIZATION_BUSY",
  "IMAGE_INVALID",
  "IMAGE_TOO_LARGE",
]);

const errorCode = (error: unknown) => {
  if (error instanceof WorkspaceCanvasImageOptimizationError) {
    return errorCodes.has(error.code)
      ? error.code
      : "VISUAL_WALL_BACKFILL_SOURCE_INVALID";
  }
  if (error instanceof Error && errorCodes.has(error.message)) {
    return error.message;
  }
  return "VISUAL_WALL_BACKFILL_FAILED";
};

const optimizeCandidate = async (
  db: ReturnType<typeof createDrizzleClient>,
  bucket: string,
  candidate: Awaited<ReturnType<typeof listMissingCardPreviewSources>>[number],
) => {
  if (
    candidate.size <= 0 ||
    candidate.size > MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES
  ) {
    throw new Error("VISUAL_WALL_BACKFILL_SOURCE_INVALID");
  }
  const metadata = await getObjectMetadata(bucket, candidate.s3Key);
  if (
    metadata.size !== candidate.size ||
    normalizeAttachmentContentType(metadata.contentType) !==
      normalizeAttachmentContentType(candidate.contentType)
  ) {
    throw new Error("VISUAL_WALL_BACKFILL_SOURCE_INVALID");
  }
  const optimized = await loadAndOptimizeWorkspaceCanvasImage(db, async () => {
    const object = await getAttachmentObject({
      bucket,
      key: candidate.s3Key,
      ifMatch: metadata.etag,
    });
    if (
      !object.Body ||
      (typeof object.ContentLength === "number" &&
        object.ContentLength !== candidate.size)
    ) {
      throw new Error("VISUAL_WALL_BACKFILL_SOURCE_MISSING");
    }
    return {
      bytes: await readObjectBodyWithLimit(
        object.Body,
        MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES,
        candidate.size,
      ),
      contentType: candidate.contentType,
    };
  });
  const s3Key = `.visual-wall/${generateUID()}`;
  await cardVisualWallRepo.reservePreviewDeletionKeys(db, [s3Key]);
  let writeAttempted = false;
  let persistenceAttempted = false;
  try {
    writeAttempted = true;
    await putObject({
      bucket,
      key: s3Key,
      body: optimized.bytes,
      contentType: optimized.contentType,
    });
    persistenceAttempted = true;
    const result = await saveBackfilledCardPreview(db, {
      resourceId: candidate.resourceId,
      s3Key,
      size: optimized.size,
      sha256: optimized.sha256,
      width: optimized.width,
      height: optimized.height,
    });
    if (result.status === "existing") {
      await deleteCardVisualWallPreviewObjects(db, [s3Key]);
      writeAttempted = false;
      return "existing" as const;
    }
    return "created" as const;
  } catch (error) {
    if (writeAttempted && !persistenceAttempted) {
      await deleteCardVisualWallPreviewObjects(db, [s3Key]).catch(
        () => undefined,
      );
    }
    throw error;
  }
};

const run = async () => {
  if (!process.env.POSTGRES_URL) {
    throw new Error("VISUAL_WALL_BACKFILL_CONFIGURATION_MISSING");
  }
  const db = createDrizzleClient();
  try {
    const migrated = await backfillVisualWallsFromLegacyCanvases(db);
    const bucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
    const missingBefore = await countMissingCardPreviews(db);
    if (missingBefore > 0 && !bucket) {
      throw new Error("VISUAL_WALL_BACKFILL_CONFIGURATION_MISSING");
    }
    let previewCount = 0;
    let previewFailureCount = 0;
    let afterResourceId = 0;
    if (bucket) {
      while (true) {
        const candidates = await listMissingCardPreviewSources(
          db,
          2,
          afterResourceId,
        );
        if (candidates.length === 0) break;
        afterResourceId = Math.max(
          ...candidates.map((candidate) => candidate.resourceId),
        );
        const results = await Promise.allSettled(
          candidates.map((candidate) =>
            optimizeCandidate(db, bucket, candidate),
          ),
        );
        for (const [index, result] of results.entries()) {
          const candidate = candidates[index];
          if (!candidate) continue;
          if (result.status === "fulfilled") {
            if (result.value === "created") previewCount += 1;
            continue;
          }
          previewFailureCount += 1;
          process.stderr.write(
            `${JSON.stringify({
              event: "visual_wall_backfill_item_failed",
              resourcePublicId: candidate.resourcePublicId,
              code: errorCode(result.reason),
            })}\n`,
          );
        }
      }
    }
    const pendingPreviewDeletionCount =
      await drainCardVisualWallPreviewStorageDeletions(db);
    const remainingPreviewCount = await countMissingCardPreviews(db);
    const summary = {
      ...migrated,
      previewCount,
      previewFailureCount,
      remainingPreviewCount,
      pendingPreviewDeletionCount,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (
      migrated.failedItemCount > 0 ||
      previewFailureCount > 0 ||
      remainingPreviewCount > 0 ||
      pendingPreviewDeletionCount > 0
    ) {
      throw new Error("VISUAL_WALL_BACKFILL_INCOMPLETE");
    }
  } finally {
    await db.$client.end();
  }
};

void run().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      event: "visual_wall_backfill_failed",
      code: errorCode(error),
    })}\n`,
  );
  process.exitCode = 1;
});
