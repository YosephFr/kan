import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteCardVisualWallPreviewObjects,
  drainCardVisualWallPreviewStorageDeletions,
  ensureCardVisualWallPreview,
} from "./card-visual-wall-preview";

const mocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  generateUID: vi.fn(),
  getAttachmentObject: vi.fn(),
  putObject: vi.fn(),
  enqueuePreviewDeletionKeys: vi.fn(),
  reservePreviewDeletionKeys: vi.fn(),
  releaseUnreferencedStorageKeys: vi.fn(),
  listPendingPreviewDeletionKeys: vi.fn(),
  countPendingPreviewDeletionKeys: vi.fn(),
  markPreviewDeletionAttempted: vi.fn(),
  markPreviewStorageDeleted: vi.fn(),
  getPreviewSource: vi.fn(),
  loadAndOptimizeWorkspaceCanvasImage: vi.fn(),
}));

vi.mock("@kan/shared/utils", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("@kan/shared/utils");
  return {
    ...actual,
    deleteObject: mocks.deleteObject,
    generateUID: mocks.generateUID,
    getAttachmentObject: mocks.getAttachmentObject,
    putObject: mocks.putObject,
  };
});

vi.mock("@kan/db/repository/cardVisualWall.repo", () => ({
  enqueuePreviewDeletionKeys: mocks.enqueuePreviewDeletionKeys,
  reservePreviewDeletionKeys: mocks.reservePreviewDeletionKeys,
  releaseUnreferencedStorageKeys: mocks.releaseUnreferencedStorageKeys,
  listPendingPreviewDeletionKeys: mocks.listPendingPreviewDeletionKeys,
  countPendingPreviewDeletionKeys: mocks.countPendingPreviewDeletionKeys,
  markPreviewDeletionAttempted: mocks.markPreviewDeletionAttempted,
  markPreviewStorageDeleted: mocks.markPreviewStorageDeleted,
  getPreviewSource: mocks.getPreviewSource,
}));

vi.mock("./workspace-canvas-image-optimizer", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "./workspace-canvas-image-optimizer",
  );
  return {
    ...actual,
    loadAndOptimizeWorkspaceCanvasImage:
      mocks.loadAndOptimizeWorkspaceCanvasImage,
  };
});

describe("card visual wall preview cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = "attachments";
    mocks.generateUID.mockReturnValue("previewkey01");
    mocks.enqueuePreviewDeletionKeys.mockResolvedValue(undefined);
    mocks.reservePreviewDeletionKeys.mockResolvedValue(undefined);
    mocks.releaseUnreferencedStorageKeys.mockImplementation(
      (_db: unknown, keys: string[]) => Promise.resolve(keys),
    );
    mocks.listPendingPreviewDeletionKeys.mockResolvedValue([]);
    mocks.countPendingPreviewDeletionKeys.mockResolvedValue(0);
    mocks.markPreviewDeletionAttempted.mockResolvedValue(undefined);
    mocks.markPreviewStorageDeleted.mockResolvedValue(undefined);
    mocks.getPreviewSource.mockResolvedValue({
      resourceId: 1,
      resourcePublicId: "resource0001",
      s3Key: ".objects/source",
      contentType: "image/png",
      size: 100,
      previewS3Key: null,
      previewContentType: null,
      previewSize: null,
      previewSha256: null,
      previewWidth: null,
      previewHeight: null,
    });
    mocks.loadAndOptimizeWorkspaceCanvasImage.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/webp",
      size: 3,
      sha256: "a".repeat(64),
      width: 1,
      height: 1,
    });
  });

  it("never deletes more than four storage objects concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    mocks.deleteObject.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
    });
    const keys = Array.from({ length: 11 }, (_, index) => `.objects/${index}`);
    await deleteCardVisualWallPreviewObjects({} as never, keys);
    expect(maxActive).toBe(4);
    expect(mocks.deleteObject).toHaveBeenCalledTimes(11);
  });

  it("cancels deletion when a storage key has an active database reference", async () => {
    mocks.releaseUnreferencedStorageKeys.mockResolvedValue([]);
    await deleteCardVisualWallPreviewObjects({} as never, [
      ".objects/committed-clone",
    ]);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.markPreviewDeletionAttempted).not.toHaveBeenCalled();
  });

  it("rotates past a failed cleanup batch and gates on the full queue", async () => {
    mocks.countPendingPreviewDeletionKeys
      .mockResolvedValueOnce(120)
      .mockResolvedValueOnce(120)
      .mockResolvedValueOnce(70)
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(0);
    const pending = await drainCardVisualWallPreviewStorageDeletions(
      {} as never,
    );
    expect(pending).toBe(0);
    expect(mocks.listPendingPreviewDeletionKeys).toHaveBeenCalledTimes(4);
  });

  it("enqueues a key when PUT persisted but its response was lost", async () => {
    mocks.putObject.mockRejectedValueOnce(new Error("response lost"));
    mocks.deleteObject.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(
      ensureCardVisualWallPreview({} as never, {
        cardId: 1,
        expectedWorkspaceId: 1,
        actorId: crypto.randomUUID(),
        resourcePublicId: "resource0001",
      }),
    ).rejects.toMatchObject({ message: "VISUAL_WALL_PREVIEW_FAILED" });

    expect(mocks.enqueuePreviewDeletionKeys).toHaveBeenCalledWith({}, [
      ".visual-wall/previewkey01",
    ]);
    expect(mocks.reservePreviewDeletionKeys).toHaveBeenCalledWith({}, [
      ".visual-wall/previewkey01",
    ]);
    expect(
      mocks.reservePreviewDeletionKeys.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.putObject.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.markPreviewStorageDeleted).not.toHaveBeenCalledWith({}, [
      ".visual-wall/previewkey01",
    ]);
  });
});
