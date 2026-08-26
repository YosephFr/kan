import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as SharedUtils from "@kan/shared/utils";
import * as workspaceCanvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";
import {
  copyObject,
  deleteObject,
  generateUID,
  generateUploadUrl,
  inspectObject,
  ObjectInspectionSizeError,
} from "@kan/shared/utils";

import {
  confirmWorkspaceCanvasImageUpload,
  createWorkspaceCanvasImageUpload,
  deleteReclaimedWorkspaceCanvasImageObjects,
} from "./workspace-canvas-image-upload";

vi.mock("@kan/db/repository/workspaceCanvasImage.repo", () => ({
  claimUploadSession: vi.fn(),
  consumeUploadSession: vi.fn(),
  createUploadSession: vi.fn(),
  deleteUnissuedUploadSession: vi.fn(),
  enqueueWorkspaceCanvasStorageDeletionKeys: vi.fn(),
  listPendingWorkspaceCanvasStorageDeletionKeys: vi.fn(),
  markWorkspaceCanvasImageStorageDeleted: vi.fn(),
  markWorkspaceCanvasStorageDeletionAttempted: vi.fn(),
  releaseUploadSessionClaim: vi.fn(),
}));

vi.mock("@kan/logger", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.mock("@kan/shared/utils", async (importOriginal) => {
  const original = await importOriginal<typeof SharedUtils>();
  return {
    ...original,
    copyObject: vi.fn(),
    deleteObject: vi.fn(),
    generateUID: vi.fn(),
    generateUploadUrl: vi.fn(),
    inspectObject: vi.fn(),
  };
});

const originalBucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
const db = {} as never;
const inputBoundary = {
  workspacePublicId: "workspace001",
  userId: "user-owner",
};

const png = (width: number, height: number) => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

const session = {
  id: 51,
  publicId: "uploadsess01",
  workspaceId: 41,
  userId: inputBoundary.userId,
  s3Key: ".uploads/uploadsess01/file.png",
  filename: "file.png",
  originalFilename: "file.png",
  contentType: "image/png",
  size: 24,
  sha256: "a".repeat(64),
};

const inspected = {
  contentType: session.contentType,
  etag: '"etag"',
  prefix: png(1200, 800),
  sha256: session.sha256,
  size: session.size,
};

const image = {
  publicId: "canvasimg001",
  originalFilename: session.originalFilename,
  contentType: session.contentType,
  size: session.size,
  createdAt: new Date("2026-08-26T12:00:00.000Z"),
};

describe("workspace canvas image upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = "attachments";
    vi.mocked(generateUID)
      .mockReset()
      .mockReturnValueOnce("claimtoken01")
      .mockReturnValueOnce("objectkey001");
    vi.mocked(generateUploadUrl).mockResolvedValue("https://upload.test/url");
    vi.mocked(inspectObject).mockResolvedValue(inspected);
    vi.mocked(copyObject).mockResolvedValue(undefined);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(
      workspaceCanvasImageRepo.markWorkspaceCanvasImageStorageDeleted,
    ).mockResolvedValue([]);
    vi.mocked(
      workspaceCanvasImageRepo.listPendingWorkspaceCanvasStorageDeletionKeys,
    ).mockResolvedValue([]);
    vi.mocked(
      workspaceCanvasImageRepo.markWorkspaceCanvasStorageDeletionAttempted,
    ).mockResolvedValue([]);
    vi.mocked(
      workspaceCanvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys,
    ).mockResolvedValue([{ s3Key: ".objects/objectkey001" }]);
    vi.mocked(workspaceCanvasImageRepo.createUploadSession).mockResolvedValue({
      status: "created",
      session: { publicId: session.publicId },
    });
    vi.mocked(
      workspaceCanvasImageRepo.deleteUnissuedUploadSession,
    ).mockResolvedValue({
      status: "cleanup_requested",
      s3Key: session.s3Key,
    });
    vi.mocked(workspaceCanvasImageRepo.claimUploadSession).mockResolvedValue({
      status: "claimed",
      session,
    } as never);
    vi.mocked(workspaceCanvasImageRepo.consumeUploadSession).mockResolvedValue({
      status: "created",
      image,
    } as never);
    vi.mocked(
      workspaceCanvasImageRepo.releaseUploadSessionClaim,
    ).mockResolvedValue({ publicId: session.publicId } as never);
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = originalBucket;
  });

  it("deletes the unissued session when presigning fails", async () => {
    vi.mocked(generateUID).mockReset().mockReturnValueOnce("uploadsess01");
    vi.mocked(generateUploadUrl).mockRejectedValueOnce(
      new Error("private presign detail"),
    );

    await expect(
      createWorkspaceCanvasImageUpload(db, {
        ...inputBoundary,
        filename: session.originalFilename,
        contentType: session.contentType,
        size: session.size,
        sha256: session.sha256,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "WORKSPACE_CANVAS_UPLOAD_FAILED",
    });

    expect(
      workspaceCanvasImageRepo.deleteUnissuedUploadSession,
    ).toHaveBeenCalledWith(db, {
      publicId: session.publicId,
      ...inputBoundary,
    });
  });

  it("rejects the cumulative budget before issuing a presigned URL", async () => {
    vi.mocked(
      workspaceCanvasImageRepo.createUploadSession,
    ).mockResolvedValueOnce({
      status: "image_budget",
    });

    await expect(
      createWorkspaceCanvasImageUpload(db, {
        ...inputBoundary,
        filename: session.originalFilename,
        contentType: session.contentType,
        size: session.size,
        sha256: session.sha256,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "WORKSPACE_CANVAS_IMAGE_TOTAL_LIMIT_REACHED",
    });
    expect(generateUploadUrl).not.toHaveBeenCalled();
  });

  it("claims, inspects, copies, consumes and cleans staging in order", async () => {
    const result = await confirmWorkspaceCanvasImageUpload(db, {
      ...inputBoundary,
      uploadSessionPublicId: session.publicId,
    });

    expect(result).toEqual(image);
    const claimCall = vi.mocked(workspaceCanvasImageRepo.claimUploadSession)
      .mock.calls[0];
    expect(claimCall?.[0]).toBe(db);
    expect(claimCall?.[1]).toMatchObject({
      publicId: session.publicId,
      ...inputBoundary,
      claimToken: "claimtoken01",
    });
    expect(claimCall?.[1].claimExpiresAt).toBeInstanceOf(Date);
    expect(inspectObject).toHaveBeenCalledWith("attachments", session.s3Key, {
      maxBytes: 10 * 1024 * 1024,
      expectedBytes: session.size,
    });
    expect(copyObject).toHaveBeenCalledWith({
      bucket: "attachments",
      sourceKey: session.s3Key,
      destinationKey: ".objects/objectkey001",
      sourceEtag: inspected.etag,
      contentType: session.contentType,
    });
    expect(
      workspaceCanvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys,
    ).toHaveBeenCalledWith(db, [".objects/objectkey001"], expect.any(Date));
    expect(workspaceCanvasImageRepo.consumeUploadSession).toHaveBeenCalledWith(
      db,
      {
        sessionPublicId: session.publicId,
        ...inputBoundary,
        claimToken: "claimtoken01",
        finalS3Key: ".objects/objectkey001",
      },
    );
    expect(deleteObject).toHaveBeenCalledWith("attachments", session.s3Key);
    expect(
      workspaceCanvasImageRepo.markWorkspaceCanvasImageStorageDeleted,
    ).toHaveBeenCalledWith(db, [session.s3Key]);
    expect(
      workspaceCanvasImageRepo.releaseUploadSessionClaim,
    ).not.toHaveBeenCalled();

    const claimOrder = vi.mocked(workspaceCanvasImageRepo.claimUploadSession)
      .mock.invocationCallOrder[0];
    const inspectOrder = vi.mocked(inspectObject).mock.invocationCallOrder[0];
    const reserveOrder = vi.mocked(
      workspaceCanvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys,
    ).mock.invocationCallOrder[0];
    const copyOrder = vi.mocked(copyObject).mock.invocationCallOrder[0];
    const consumeOrder = vi.mocked(
      workspaceCanvasImageRepo.consumeUploadSession,
    ).mock.invocationCallOrder[0];
    const cleanupOrder = vi.mocked(deleteObject).mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(inspectOrder ?? 0);
    expect(inspectOrder).toBeLessThan(reserveOrder ?? 0);
    expect(reserveOrder).toBeLessThan(copyOrder ?? 0);
    expect(copyOrder).toBeLessThan(consumeOrder ?? 0);
    expect(consumeOrder).toBeLessThan(cleanupOrder ?? 0);
  });

  it.each([
    ["hash", { sha256: "b".repeat(64) }],
    ["MIME", { contentType: "image/jpeg" }],
  ])("rejects an invalid %s before copying", async (_label, override) => {
    vi.mocked(inspectObject).mockResolvedValueOnce({
      ...inspected,
      ...override,
    });

    await expect(
      confirmWorkspaceCanvasImageUpload(db, {
        ...inputBoundary,
        uploadSessionPublicId: session.publicId,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "WORKSPACE_CANVAS_IMAGE_INVALID",
    });

    expect(copyObject).not.toHaveBeenCalled();
    expect(
      workspaceCanvasImageRepo.consumeUploadSession,
    ).not.toHaveBeenCalled();
    expect(
      workspaceCanvasImageRepo.releaseUploadSessionClaim,
    ).toHaveBeenCalledWith(db, {
      publicId: session.publicId,
      claimToken: "claimtoken01",
    });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("maps an oversized HEAD response without copying the object", async () => {
    vi.mocked(inspectObject).mockRejectedValueOnce(
      new ObjectInspectionSizeError("OBJECT_TOO_LARGE"),
    );

    await expect(
      confirmWorkspaceCanvasImageUpload(db, {
        ...inputBoundary,
        uploadSessionPublicId: session.publicId,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "WORKSPACE_CANVAS_IMAGE_INVALID",
    });
    expect(copyObject).not.toHaveBeenCalled();
    expect(
      workspaceCanvasImageRepo.releaseUploadSessionClaim,
    ).toHaveBeenCalledWith(db, {
      publicId: session.publicId,
      claimToken: "claimtoken01",
    });
  });

  it("durably schedules a copied object for cleanup when consumption fails", async () => {
    vi.mocked(
      workspaceCanvasImageRepo.consumeUploadSession,
    ).mockResolvedValueOnce({ status: "image_limit" });

    await expect(
      confirmWorkspaceCanvasImageUpload(db, {
        ...inputBoundary,
        uploadSessionPublicId: session.publicId,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "WORKSPACE_CANVAS_IMAGE_LIMIT_REACHED",
    });
    expect(
      workspaceCanvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys,
    ).toHaveBeenCalledWith(db, [".objects/objectkey001"], expect.any(Date));
    expect(deleteObject).toHaveBeenCalledWith(
      "attachments",
      ".objects/objectkey001",
    );
    expect(
      workspaceCanvasImageRepo.releaseUploadSessionClaim,
    ).toHaveBeenCalledWith(db, {
      publicId: session.publicId,
      claimToken: "claimtoken01",
    });
  });

  it("does not delete a copied object when consumption has an ambiguous failure", async () => {
    vi.mocked(
      workspaceCanvasImageRepo.consumeUploadSession,
    ).mockRejectedValueOnce(new Error("database response lost"));

    await expect(
      confirmWorkspaceCanvasImageUpload(db, {
        ...inputBoundary,
        uploadSessionPublicId: session.publicId,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "WORKSPACE_CANVAS_UPLOAD_FAILED",
    });
    expect(
      workspaceCanvasImageRepo.enqueueWorkspaceCanvasStorageDeletionKeys,
    ).toHaveBeenCalledWith(db, [".objects/objectkey001"], expect.any(Date));
    expect(deleteObject).not.toHaveBeenCalledWith(
      "attachments",
      ".objects/objectkey001",
    );
  });

  it("returns an already-created image without touching storage", async () => {
    vi.mocked(
      workspaceCanvasImageRepo.claimUploadSession,
    ).mockResolvedValueOnce({
      status: "already_created",
      image,
    } as never);

    await expect(
      confirmWorkspaceCanvasImageUpload(db, {
        ...inputBoundary,
        uploadSessionPublicId: session.publicId,
      }),
    ).resolves.toEqual(image);

    expect(inspectObject).not.toHaveBeenCalled();
    expect(copyObject).not.toHaveBeenCalled();
    expect(
      workspaceCanvasImageRepo.consumeUploadSession,
    ).not.toHaveBeenCalled();
    expect(
      workspaceCanvasImageRepo.releaseUploadSessionClaim,
    ).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("leaves failed storage tombstones retryable and marks only successful retries", async () => {
    const s3Key = ".objects/retry000001";
    vi.mocked(
      workspaceCanvasImageRepo.listPendingWorkspaceCanvasStorageDeletionKeys,
    ).mockResolvedValue([{ s3Key }]);
    vi.mocked(deleteObject).mockRejectedValueOnce(new Error("storage down"));

    await deleteReclaimedWorkspaceCanvasImageObjects(db, []);
    expect(
      workspaceCanvasImageRepo.markWorkspaceCanvasStorageDeletionAttempted,
    ).toHaveBeenCalledWith(db, [s3Key]);
    expect(
      workspaceCanvasImageRepo.markWorkspaceCanvasImageStorageDeleted,
    ).not.toHaveBeenCalled();

    vi.mocked(deleteObject).mockResolvedValueOnce(undefined);
    await deleteReclaimedWorkspaceCanvasImageObjects(db, []);
    expect(
      workspaceCanvasImageRepo.markWorkspaceCanvasImageStorageDeleted,
    ).toHaveBeenCalledWith(db, [s3Key]);
  });
});
