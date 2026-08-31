import { timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";

import type { dbClient } from "@kan/db/client";
import * as workspaceCanvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";
import { createLogger } from "@kan/logger";
import { MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES } from "@kan/shared";
import {
  ATTACHMENT_UPLOAD_CLAIM_TTL_MS,
  ATTACHMENT_UPLOAD_TTL_MS,
  deleteObject,
  generateUID,
  generateUploadUrl,
  getAttachmentObject,
  hasDetectableActiveAttachmentContent,
  hasValidAttachmentSignature,
  inspectObject,
  normalizeAttachmentContentType,
  ObjectInspectionSizeError,
  putObject,
  sanitizeAttachmentFilename,
} from "@kan/shared/utils";

import { workspaceCanvasImageContentTypeSchema } from "../schemas/workspace-canvas-image";
import {
  loadAndOptimizeWorkspaceCanvasImage,
  WorkspaceCanvasImageOptimizationError,
} from "./workspace-canvas-image-optimizer";

const log = createLogger("workspace-canvas-image-upload");
const WORKSPACE_CANVAS_STORAGE_DELETE_CONCURRENCY = 20;

export async function deleteReclaimedWorkspaceCanvasImageObjects(
  db: dbClient,
  s3Keys: readonly string[],
) {
  const pending = await workspaceCanvasImageRepo
    .listPendingWorkspaceCanvasStorageDeletionKeys(db)
    .catch(() => {
      log.warn(
        { errorCode: "WORKSPACE_CANVAS_IMAGE_GC_OUTBOX_READ_FAILED" },
        "Unable to read pending workspace canvas image object deletions",
      );
      return [];
    });
  const pendingS3Keys = [
    ...new Set([...s3Keys, ...pending.map((item) => item.s3Key)]),
  ];
  if (pendingS3Keys.length === 0) return;
  const bucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
  if (!bucket) {
    log.warn(
      {
        errorCode: "WORKSPACE_CANVAS_IMAGE_GC_STORAGE_UNAVAILABLE",
        objectCount: pendingS3Keys.length,
      },
      "Unable to delete reclaimed workspace canvas image objects",
    );
    return;
  }
  let failedCount = 0;
  for (
    let index = 0;
    index < pendingS3Keys.length;
    index += WORKSPACE_CANVAS_STORAGE_DELETE_CONCURRENCY
  ) {
    const batch = pendingS3Keys.slice(
      index,
      index + WORKSPACE_CANVAS_STORAGE_DELETE_CONCURRENCY,
    );
    await workspaceCanvasImageRepo
      .markWorkspaceCanvasStorageDeletionAttempted(db, batch)
      .catch(() => {
        log.warn(
          {
            errorCode: "WORKSPACE_CANVAS_IMAGE_GC_OUTBOX_ATTEMPT_MARK_FAILED",
            objectCount: batch.length,
          },
          "Unable to mark workspace canvas image object deletion attempts",
        );
      });
    const results = await Promise.allSettled(
      batch.map((s3Key) => deleteObject(bucket, s3Key)),
    );
    failedCount += results.filter(
      (result) => result.status === "rejected",
    ).length;
    const deletedS3Keys = batch.filter(
      (_, resultIndex) => results[resultIndex]?.status === "fulfilled",
    );
    if (deletedS3Keys.length > 0) {
      await workspaceCanvasImageRepo
        .markWorkspaceCanvasImageStorageDeleted(db, deletedS3Keys)
        .catch(() => {
          log.warn(
            {
              errorCode: "WORKSPACE_CANVAS_IMAGE_GC_MARK_FAILED",
              objectCount: deletedS3Keys.length,
            },
            "Failed to mark reclaimed workspace canvas image objects",
          );
        });
    }
  }
  if (failedCount > 0) {
    log.warn(
      {
        errorCode: "WORKSPACE_CANVAS_IMAGE_GC_DELETE_FAILED",
        failedCount,
        objectCount: pendingS3Keys.length,
      },
      "Failed to delete some reclaimed workspace canvas image objects",
    );
  }
}

export interface WorkspaceCanvasImageResult {
  publicId: string;
  title?: string;
  originalFilename: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  optimizedAt: Date | null;
  createdAt: Date;
}

export const mapWorkspaceCanvasImage = (image: WorkspaceCanvasImageResult) => {
  const contentType = workspaceCanvasImageContentTypeSchema.parse(
    image.contentType,
  );
  return {
    kind: "upload" as const,
    publicId: image.publicId,
    title: image.title ?? image.originalFilename,
    originalFilename: image.originalFilename,
    contentType,
    size: image.size,
    width: image.width,
    height: image.height,
    optimizedAt: image.optimizedAt,
    viewUrl: `/api/workspace-canvas-images/${image.publicId}`,
    downloadUrl: `/api/workspace-canvas-images/${image.publicId}`,
    createdAt: image.createdAt,
  };
};

const getBucket = () => {
  const bucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
  if (!bucket) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "WORKSPACE_IMAGE_STORAGE_UNAVAILABLE",
    });
  }
  return bucket;
};

const throwBoundaryStatus = (status: "not_found" | "forbidden"): never => {
  if (status === "not_found") {
    throw new TRPCError({ code: "NOT_FOUND", message: "WORKSPACE_NOT_FOUND" });
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "WORKSPACE_CANVAS_EDIT_FORBIDDEN",
  });
};

const throwUploadBudget = (): never => {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "WORKSPACE_CANVAS_IMAGE_TOTAL_LIMIT_REACHED",
  });
};

const throwStorageBudget = (): never => {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "WORKSPACE_CANVAS_IMAGE_STORAGE_LIMIT_REACHED",
  });
};

export async function createWorkspaceCanvasImageUpload(
  db: dbClient,
  input: {
    workspacePublicId: string;
    userId: string;
    filename: string;
    contentType: string;
    size: number;
    sha256: string;
  },
) {
  const bucket = getBucket();
  const uploadSessionPublicId = generateUID();
  const filename = sanitizeAttachmentFilename(input.filename);
  const s3Key = `.uploads/${uploadSessionPublicId}/${filename}`;
  const expiresAt = new Date(Date.now() + ATTACHMENT_UPLOAD_TTL_MS);
  const creation = await workspaceCanvasImageRepo.createUploadSession(db, {
    publicId: uploadSessionPublicId,
    workspacePublicId: input.workspacePublicId,
    userId: input.userId,
    s3Key,
    filename,
    originalFilename: input.filename,
    contentType: input.contentType,
    size: input.size,
    sha256: input.sha256,
    expiresAt,
  });
  await deleteReclaimedWorkspaceCanvasImageObjects(
    db,
    "reclaimedS3Keys" in creation ? (creation.reclaimedS3Keys ?? []) : [],
  );
  if (creation.status === "not_found" || creation.status === "forbidden") {
    throwBoundaryStatus(creation.status);
  }
  if (creation.status === "image_budget") throwUploadBudget();
  if (creation.status === "storage_budget") {
    throwStorageBudget();
  }
  if (
    creation.status === "user_limit" ||
    creation.status === "workspace_limit"
  ) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "WORKSPACE_CANVAS_UPLOAD_LIMIT_REACHED",
    });
  }
  if (creation.status === "staging_budget") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "WORKSPACE_CANVAS_UPLOAD_STAGING_BUDGET_REACHED",
    });
  }
  if (creation.status !== "created") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "WORKSPACE_CANVAS_UPLOAD_UNAVAILABLE",
    });
  }
  try {
    const url = await generateUploadUrl(
      bucket,
      s3Key,
      input.contentType,
      input.size,
      ATTACHMENT_UPLOAD_TTL_MS / 1000,
    );
    return { url, uploadSessionPublicId, expiresAt };
  } catch {
    const cleanup = await workspaceCanvasImageRepo
      .deleteUnissuedUploadSession(db, {
        publicId: uploadSessionPublicId,
        workspacePublicId: input.workspacePublicId,
        userId: input.userId,
      })
      .catch(() => null);
    if (cleanup?.status === "cleanup_requested") {
      await deleteReclaimedWorkspaceCanvasImageObjects(db, [cleanup.s3Key]);
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "WORKSPACE_CANVAS_UPLOAD_FAILED",
    });
  }
}

const hashesMatch = (expected: string, actual: string) => {
  const expectedHash = Buffer.from(expected, "hex");
  const actualHash = Buffer.from(actual, "hex");
  return (
    expectedHash.length === actualHash.length &&
    timingSafeEqual(expectedHash, actualHash)
  );
};

const assertValidStoredImage = (
  session: {
    contentType: string;
    size: number;
    sha256: string;
  },
  inspected: Awaited<ReturnType<typeof inspectObject>>,
) => {
  if (
    inspected.size !== session.size ||
    normalizeAttachmentContentType(inspected.contentType) !==
      session.contentType ||
    !hashesMatch(session.sha256, inspected.sha256) ||
    hasDetectableActiveAttachmentContent(inspected.prefix) ||
    !hasValidAttachmentSignature(session.contentType, inspected.prefix)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "WORKSPACE_CANVAS_IMAGE_INVALID",
    });
  }
};

const readClaimedImage = async (
  bucket: string,
  session: { s3Key: string; size: number },
  etag: string,
) => {
  const object = await getAttachmentObject({
    bucket,
    key: session.s3Key,
    ifMatch: etag,
  });
  if (!object.Body) throw new Error("Workspace canvas image body is missing");
  const bytes = await object.Body.transformToByteArray();
  if (bytes.byteLength !== session.size) {
    throw new ObjectInspectionSizeError("OBJECT_SIZE_MISMATCH");
  }
  return bytes;
};

const mapOptimizationError = (
  error: WorkspaceCanvasImageOptimizationError,
): TRPCError => {
  if (error.code === "IMAGE_OPTIMIZATION_BUSY") {
    return new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_BUSY",
    });
  }
  if (error.code === "IMAGE_DIMENSIONS_INVALID") {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "WORKSPACE_CANVAS_IMAGE_DIMENSIONS_INVALID",
    });
  }
  if (error.code === "IMAGE_OPTIMIZATION_FAILED") {
    return new TRPCError({
      code: "UNPROCESSABLE_CONTENT",
      message: "WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_FAILED",
    });
  }
  return new TRPCError({
    code: "BAD_REQUEST",
    message: "WORKSPACE_CANVAS_IMAGE_INVALID",
  });
};

const shouldAbandonWorkspaceCanvasUpload = (error: unknown) =>
  (error instanceof WorkspaceCanvasImageOptimizationError &&
    error.code !== "IMAGE_OPTIMIZATION_BUSY") ||
  error instanceof ObjectInspectionSizeError ||
  (error instanceof TRPCError &&
    (error.code === "BAD_REQUEST" ||
      error.code === "UNPROCESSABLE_CONTENT" ||
      error.message === "WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_FAILED"));

export async function confirmWorkspaceCanvasImageUpload(
  db: dbClient,
  input: {
    workspacePublicId: string;
    userId: string;
    uploadSessionPublicId: string;
  },
) {
  const bucket = getBucket();
  const claimToken = generateUID();
  const claimExpiresAt = new Date(Date.now() + ATTACHMENT_UPLOAD_CLAIM_TTL_MS);
  const claim = await workspaceCanvasImageRepo.claimUploadSession(db, {
    publicId: input.uploadSessionPublicId,
    workspacePublicId: input.workspacePublicId,
    userId: input.userId,
    claimToken,
    claimExpiresAt,
  });
  if (claim.status === "not_found" || claim.status === "forbidden") {
    throwBoundaryStatus(claim.status);
  }
  if (claim.status === "already_created") return claim.image;
  if (claim.status !== "claimed") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "WORKSPACE_CANVAS_UPLOAD_UNAVAILABLE",
    });
  }
  const session = claim.session;
  const finalS3Key = `.objects/${generateUID()}`;
  let writeAttempted = false;
  let consumptionMayHavePersisted = false;
  let persisted = false;
  try {
    const optimized = await loadAndOptimizeWorkspaceCanvasImage(
      db,
      async () => {
        const inspected = await inspectObject(bucket, session.s3Key, {
          maxBytes: MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES,
          expectedBytes: session.size,
        });
        assertValidStoredImage(session, inspected);
        return {
          bytes: await readClaimedImage(bucket, session, inspected.etag),
          contentType: session.contentType,
        };
      },
    );
    const reservation = await workspaceCanvasImageRepo.reserveUploadFinalObject(
      db,
      {
        sessionPublicId: session.publicId,
        workspacePublicId: input.workspacePublicId,
        userId: input.userId,
        claimToken,
        finalS3Key,
        finalSize: optimized.size,
      },
    );
    await deleteReclaimedWorkspaceCanvasImageObjects(
      db,
      "reclaimedS3Keys" in reservation
        ? (reservation.reclaimedS3Keys ?? [])
        : [],
    );
    if (
      reservation.status === "not_found" ||
      reservation.status === "forbidden"
    ) {
      throwBoundaryStatus(reservation.status);
    }
    if (reservation.status === "image_budget") throwUploadBudget();
    if (reservation.status === "storage_budget") throwStorageBudget();
    if (reservation.status === "invalid_optimized_image") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_FAILED",
      });
    }
    if (reservation.status !== "reserved") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "WORKSPACE_CANVAS_UPLOAD_UNAVAILABLE",
      });
    }
    writeAttempted = true;
    await putObject({
      bucket,
      key: finalS3Key,
      body: optimized.bytes,
      contentType: optimized.contentType,
    });
    consumptionMayHavePersisted = true;
    const consumption = await workspaceCanvasImageRepo.consumeUploadSession(
      db,
      {
        sessionPublicId: session.publicId,
        workspacePublicId: input.workspacePublicId,
        userId: input.userId,
        claimToken,
        finalS3Key,
        finalContentType: optimized.contentType,
        finalSize: optimized.size,
        finalSha256: optimized.sha256,
        width: optimized.width,
        height: optimized.height,
        optimizedAt: new Date(),
      },
    );
    consumptionMayHavePersisted = consumption.status === "created";
    if ("reclaimedS3Keys" in consumption) {
      await deleteReclaimedWorkspaceCanvasImageObjects(
        db,
        consumption.reclaimedS3Keys ?? [],
      );
    }
    if (
      consumption.status === "not_found" ||
      consumption.status === "forbidden"
    ) {
      throwBoundaryStatus(consumption.status);
    }
    if (consumption.status === "image_budget") throwUploadBudget();
    if (consumption.status === "storage_budget") {
      throwStorageBudget();
    }
    if (consumption.status === "invalid_optimized_image") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_FAILED",
      });
    }
    if (consumption.status !== "created") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "WORKSPACE_CANVAS_UPLOAD_UNAVAILABLE",
      });
    }
    persisted = true;
    await deleteReclaimedWorkspaceCanvasImageObjects(db, [session.s3Key]);
    return consumption.image;
  } catch (error) {
    if (!persisted) {
      const abandoned = shouldAbandonWorkspaceCanvasUpload(error)
        ? await workspaceCanvasImageRepo
            .abandonClaimedUploadSession(db, {
              publicId: session.publicId,
              workspacePublicId: input.workspacePublicId,
              userId: input.userId,
              claimToken,
            })
            .catch(() => null)
        : null;
      if (abandoned) {
        await deleteReclaimedWorkspaceCanvasImageObjects(db, [abandoned.s3Key]);
      } else if (!shouldAbandonWorkspaceCanvasUpload(error)) {
        await workspaceCanvasImageRepo
          .releaseUploadSessionClaim(db, {
            publicId: session.publicId,
            claimToken,
          })
          .catch(() => undefined);
      }
      if (writeAttempted && !consumptionMayHavePersisted) {
        await deleteReclaimedWorkspaceCanvasImageObjects(db, [finalS3Key]);
      }
    }
    if (error instanceof TRPCError) throw error;
    if (error instanceof WorkspaceCanvasImageOptimizationError) {
      throw mapOptimizationError(error);
    }
    if (error instanceof ObjectInspectionSizeError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "WORKSPACE_CANVAS_IMAGE_INVALID",
      });
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "WORKSPACE_CANVAS_UPLOAD_FAILED",
    });
  }
}
