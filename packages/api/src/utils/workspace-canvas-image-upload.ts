import { timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";

import type { dbClient } from "@kan/db/client";
import * as workspaceCanvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";
import { createLogger } from "@kan/logger";
import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_IMAGE_DIMENSION,
  MAX_CARD_CANVAS_IMAGE_PIXELS,
} from "@kan/shared";
import {
  ATTACHMENT_UPLOAD_CLAIM_TTL_MS,
  ATTACHMENT_UPLOAD_TTL_MS,
  copyObject,
  deleteObject,
  generateUID,
  generateUploadUrl,
  hasDetectableActiveAttachmentContent,
  hasValidAttachmentSignature,
  inspectObject,
  normalizeAttachmentContentType,
  ObjectInspectionSizeError,
  sanitizeAttachmentFilename,
} from "@kan/shared/utils";

import { workspaceCanvasImageContentTypeSchema } from "../schemas/workspace-canvas-image";
import { validateSafePreviewImage } from "./safe-preview-image";

const log = createLogger("workspace-canvas-image-upload");

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
  await workspaceCanvasImageRepo
    .markWorkspaceCanvasStorageDeletionAttempted(db, pendingS3Keys)
    .catch(() => {
      log.warn(
        {
          errorCode: "WORKSPACE_CANVAS_IMAGE_GC_OUTBOX_ATTEMPT_MARK_FAILED",
          objectCount: pendingS3Keys.length,
        },
        "Unable to mark workspace canvas image object deletion attempts",
      );
    });
  const results = await Promise.allSettled(
    pendingS3Keys.map((s3Key) => deleteObject(bucket, s3Key)),
  );
  const failedCount = results.filter(
    (result) => result.status === "rejected",
  ).length;
  const deletedS3Keys = pendingS3Keys.filter(
    (_, index) => results[index]?.status === "fulfilled",
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

const throwUploadLimit = (): never => {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "WORKSPACE_CANVAS_IMAGE_LIMIT_REACHED",
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

const throwStorageCleanupPending = (): never => {
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "WORKSPACE_CANVAS_IMAGE_STORAGE_CLEANUP_PENDING",
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
  if (creation.status === "image_limit") throwUploadLimit();
  if (creation.status === "image_budget") throwUploadBudget();
  if (
    creation.status === "storage_limit" ||
    creation.status === "storage_budget"
  ) {
    throwStorageBudget();
  }
  if (creation.status === "storage_cleanup") throwStorageCleanupPending();
  if (
    creation.status === "user_limit" ||
    creation.status === "workspace_limit"
  ) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "WORKSPACE_CANVAS_UPLOAD_LIMIT_REACHED",
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
  try {
    validateSafePreviewImage(session.contentType, inspected.prefix, {
      maxBytes: MAX_CARD_CANVAS_IMAGE_BYTES,
      maxDimension: MAX_CARD_CANVAS_IMAGE_DIMENSION,
      maxPixels: MAX_CARD_CANVAS_IMAGE_PIXELS,
    });
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "WORKSPACE_CANVAS_IMAGE_INVALID",
    });
  }
};

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
  let copyAttempted = false;
  let consumptionMayHavePersisted = false;
  let persisted = false;
  try {
    const inspected = await inspectObject(bucket, session.s3Key, {
      maxBytes: MAX_CARD_CANVAS_IMAGE_BYTES,
      expectedBytes: session.size,
    });
    assertValidStoredImage(session, inspected);
    const scheduled =
      await workspaceCanvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys(
        db,
        [finalS3Key],
        claimExpiresAt,
      );
    if (scheduled.length !== 1) {
      throw new Error("Unable to reserve workspace canvas image storage key");
    }
    copyAttempted = true;
    await copyObject({
      bucket,
      sourceKey: session.s3Key,
      destinationKey: finalS3Key,
      sourceEtag: inspected.etag,
      contentType: session.contentType,
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
    if (consumption.status === "image_limit") throwUploadLimit();
    if (consumption.status === "image_budget") throwUploadBudget();
    if (
      consumption.status === "storage_limit" ||
      consumption.status === "storage_budget"
    ) {
      throwStorageBudget();
    }
    if (consumption.status === "storage_cleanup") {
      throwStorageCleanupPending();
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
      await workspaceCanvasImageRepo
        .releaseUploadSessionClaim(db, {
          publicId: session.publicId,
          claimToken,
        })
        .catch(() => undefined);
      if (copyAttempted && !consumptionMayHavePersisted) {
        await deleteReclaimedWorkspaceCanvasImageObjects(db, [finalS3Key]);
      }
    }
    if (error instanceof TRPCError) throw error;
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
