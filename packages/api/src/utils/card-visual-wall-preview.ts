import { TRPCError } from "@trpc/server";

import type { dbClient } from "@kan/db/client";
import * as cardVisualWallRepo from "@kan/db/repository/cardVisualWall.repo";
import { MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES } from "@kan/shared";
import {
  deleteObject,
  generateUID,
  getAttachmentObject,
  ObjectBodySizeError,
  putObject,
  readObjectBodyWithLimit,
} from "@kan/shared/utils";

import {
  loadAndOptimizeWorkspaceCanvasImage,
  WorkspaceCanvasImageOptimizationError,
} from "./workspace-canvas-image-optimizer";

const PREVIEW_DELETE_BATCH_SIZE = 4;

export async function deleteCardVisualWallPreviewObjects(
  db: dbClient,
  s3Keys: readonly string[] = [],
) {
  await cardVisualWallRepo.enqueuePreviewDeletionKeys(db, s3Keys);
  const pending = await cardVisualWallRepo
    .listPendingPreviewDeletionKeys(db)
    .catch(() => []);
  const keys = [...new Set([...s3Keys, ...pending.map((item) => item.s3Key)])];
  if (keys.length === 0) return;
  const deletableKeys = await cardVisualWallRepo.releaseUnreferencedStorageKeys(
    db,
    keys,
  );
  if (deletableKeys.length === 0) return;
  const bucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
  if (!bucket) return;
  await cardVisualWallRepo.markPreviewDeletionAttempted(db, deletableKeys);
  const deleted: string[] = [];
  for (
    let start = 0;
    start < deletableKeys.length;
    start += PREVIEW_DELETE_BATCH_SIZE
  ) {
    const batch = deletableKeys.slice(start, start + PREVIEW_DELETE_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((key) => deleteObject(bucket, key)),
    );
    deleted.push(
      ...batch.filter((_, index) => results[index]?.status === "fulfilled"),
    );
  }
  await cardVisualWallRepo.markPreviewStorageDeleted(db, deleted);
}

export async function drainCardVisualWallPreviewStorageDeletions(db: dbClient) {
  let pending = await cardVisualWallRepo.countPendingPreviewDeletionKeys(db);
  let unchangedPasses = 0;
  for (let pass = 0; pass < 100 && pending > 0; pass += 1) {
    await deleteCardVisualWallPreviewObjects(db);
    const remaining =
      await cardVisualWallRepo.countPendingPreviewDeletionKeys(db);
    unchangedPasses = remaining < pending ? 0 : unchangedPasses + 1;
    pending = remaining;
    const fullRotationPasses = Math.max(1, Math.ceil(pending / 50));
    if (unchangedPasses >= fullRotationPasses) break;
  }
  return pending;
}

const throwOptimizationError = (error: unknown): never => {
  if (error instanceof TRPCError) throw error;
  if (error instanceof ObjectBodySizeError) {
    throw new TRPCError({
      code:
        error.code === "OBJECT_BODY_TOO_LARGE"
          ? "PAYLOAD_TOO_LARGE"
          : "CONFLICT",
      message:
        error.code === "OBJECT_BODY_TOO_LARGE"
          ? "VISUAL_WALL_IMAGE_TOO_LARGE"
          : "VISUAL_WALL_SOURCE_CHANGED",
    });
  }
  if (error instanceof WorkspaceCanvasImageOptimizationError) {
    throw new TRPCError({
      code:
        error.code === "IMAGE_OPTIMIZATION_BUSY"
          ? "SERVICE_UNAVAILABLE"
          : "UNPROCESSABLE_CONTENT",
      message:
        error.code === "IMAGE_OPTIMIZATION_BUSY"
          ? "VISUAL_WALL_PREVIEW_BUSY"
          : "VISUAL_WALL_PREVIEW_FAILED",
    });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "VISUAL_WALL_PREVIEW_FAILED",
  });
};

export async function ensureCardVisualWallPreview(
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    actorId: string;
    resourcePublicId: string;
  },
) {
  await deleteCardVisualWallPreviewObjects(db).catch(() => undefined);
  const source = await cardVisualWallRepo.getPreviewSource(db, input);
  if (!source) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "VISUAL_WALL_ITEM_INVALID",
    });
  }
  if (
    source.previewS3Key &&
    source.previewContentType === "image/webp" &&
    source.previewSize &&
    source.previewSha256 &&
    source.previewWidth &&
    source.previewHeight
  ) {
    return { status: "existing" as const, s3Key: source.previewS3Key };
  }
  const bucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
  if (!bucket) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "VISUAL_WALL_PREVIEW_STORAGE_UNAVAILABLE",
    });
  }
  if (
    source.size <= 0 ||
    source.size > MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES
  ) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "VISUAL_WALL_IMAGE_TOO_LARGE",
    });
  }
  const s3Key = `.visual-wall/${generateUID()}`;
  await cardVisualWallRepo.reservePreviewDeletionKeys(db, [s3Key]);
  let writeAttempted = false;
  let persistenceAttempted = false;
  try {
    const optimized = await loadAndOptimizeWorkspaceCanvasImage(
      db,
      async () => {
        const object = await getAttachmentObject({
          bucket,
          key: source.s3Key,
        });
        if (
          typeof object.ContentLength === "number" &&
          object.ContentLength !== source.size
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "VISUAL_WALL_SOURCE_CHANGED",
          });
        }
        return {
          bytes: await readObjectBodyWithLimit(
            object.Body,
            MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES,
            source.size,
          ),
          contentType: source.contentType,
        };
      },
    );
    writeAttempted = true;
    await putObject({
      bucket,
      key: s3Key,
      body: optimized.bytes,
      contentType: optimized.contentType,
    });
    persistenceAttempted = true;
    const saved = await cardVisualWallRepo.savePreview(db, {
      ...input,
      s3Key,
      contentType: optimized.contentType,
      size: optimized.size,
      sha256: optimized.sha256,
      width: optimized.width,
      height: optimized.height,
    });
    if (saved.status === "existing" && saved.s3Key !== s3Key) {
      await deleteCardVisualWallPreviewObjects(db, [s3Key]);
    }
    return {
      status: saved.status,
      s3Key: saved.s3Key,
    };
  } catch (error) {
    if (writeAttempted && !persistenceAttempted) {
      await deleteCardVisualWallPreviewObjects(db, [s3Key]).catch(
        () => undefined,
      );
    }
    return throwOptimizationError(error);
  }
}

export async function releaseUnreferencedCardVisualWallPreview(
  db: dbClient,
  input: {
    cardId: number;
    expectedWorkspaceId: number;
    resourcePublicId: string;
    previewS3Key: string;
  },
) {
  const key = await cardVisualWallRepo.releaseUnreferencedPreview(db, input);
  if (!key) return;
  await deleteCardVisualWallPreviewObjects(db, [key]);
}
