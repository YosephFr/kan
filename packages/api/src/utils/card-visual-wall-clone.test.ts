import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertBoardVisualWallCloneBudget,
  assertBoardVisualWallCloneSources,
  assertCardVisualWallCloneBudget,
  MAX_BOARD_VISUAL_WALL_CLONE_RESOURCES,
  MAX_BOARD_VISUAL_WALL_CLONE_SOURCE_BYTES,
  MAX_CARD_VISUAL_WALL_CLONE_RESOURCES,
  MAX_CARD_VISUAL_WALL_CLONE_SOURCE_BYTES,
  prepareCardVisualWallCloneObjects,
} from "./card-visual-wall-clone";

const mocks = vi.hoisted(() => ({
  copyObject: vi.fn(),
  inspectObject: vi.fn(),
  generateUID: vi.fn(),
  enqueuePreviewDeletionKeys: vi.fn(),
  reservePreviewDeletionKeys: vi.fn(),
  renewPreviewDeletionKeyReservations: vi.fn(),
  deleteCardVisualWallPreviewObjects: vi.fn(),
}));

vi.mock("@kan/shared/utils", () => ({
  copyObject: mocks.copyObject,
  inspectObject: mocks.inspectObject,
  generateUID: mocks.generateUID,
}));

vi.mock("@kan/db/repository/cardVisualWall.repo", () => ({
  enqueuePreviewDeletionKeys: mocks.enqueuePreviewDeletionKeys,
  reservePreviewDeletionKeys: mocks.reservePreviewDeletionKeys,
  renewPreviewDeletionKeyReservations:
    mocks.renewPreviewDeletionKeyReservations,
}));

vi.mock("./card-visual-wall-preview", () => ({
  deleteCardVisualWallPreviewObjects: mocks.deleteCardVisualWallPreviewObjects,
}));

const source = {
  sourceWallVersion: 1,
  sourceResourcePublicId: "resource0001",
  attachment: {
    sourceS3Key: ".objects/source",
    filename: "source.png",
    originalFilename: "source.png",
    contentType: "image/png",
    size: 100,
    sha256: "a".repeat(64),
  },
  preview: {
    sourceS3Key: ".visual-wall/source",
    contentType: "image/webp",
    size: 50,
    sha256: "b".repeat(64),
    width: 100,
    height: 60,
  },
};

describe("visual wall clone storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reservePreviewDeletionKeys.mockResolvedValue(undefined);
    mocks.renewPreviewDeletionKeyReservations.mockResolvedValue(undefined);
  });

  it("accepts exact clone budgets and rejects one unit over", () => {
    expect(() =>
      assertCardVisualWallCloneBudget({
        resourceCount: MAX_CARD_VISUAL_WALL_CLONE_RESOURCES,
        sourceBytes: MAX_CARD_VISUAL_WALL_CLONE_SOURCE_BYTES,
      }),
    ).not.toThrow();
    expect(() =>
      assertCardVisualWallCloneBudget({
        resourceCount: MAX_CARD_VISUAL_WALL_CLONE_RESOURCES + 1,
        sourceBytes: 0,
      }),
    ).toThrow("VISUAL_WALL_CARD_CLONE_LIMIT_REACHED");
    expect(() =>
      assertBoardVisualWallCloneBudget({
        resourceCount: MAX_BOARD_VISUAL_WALL_CLONE_RESOURCES,
        sourceBytes: MAX_BOARD_VISUAL_WALL_CLONE_SOURCE_BYTES,
      }),
    ).not.toThrow();
    expect(() =>
      assertBoardVisualWallCloneBudget({
        resourceCount: 0,
        sourceBytes: MAX_BOARD_VISUAL_WALL_CLONE_SOURCE_BYTES + 1,
      }),
    ).toThrow("VISUAL_WALL_BOARD_CLONE_LIMIT_REACHED");
  });

  it("rejects actual card sources over budget before inspecting storage", async () => {
    await expect(
      prepareCardVisualWallCloneObjects(
        {} as never,
        Array.from(
          { length: MAX_CARD_VISUAL_WALL_CLONE_RESOURCES + 1 },
          () => source,
        ),
      ),
    ).rejects.toMatchObject({
      message: "VISUAL_WALL_CARD_CLONE_LIMIT_REACHED",
    });
    expect(mocks.inspectObject).not.toHaveBeenCalled();
    expect(mocks.copyObject).not.toHaveBeenCalled();
  });

  it("rejects actual board sources over budget before storage work starts", () => {
    expect(() =>
      assertBoardVisualWallCloneSources(
        Array.from(
          { length: MAX_BOARD_VISUAL_WALL_CLONE_RESOURCES + 1 },
          () => source,
        ),
      ),
    ).toThrow("VISUAL_WALL_BOARD_CLONE_LIMIT_REACHED");
    expect(mocks.inspectObject).not.toHaveBeenCalled();
    expect(mocks.copyObject).not.toHaveBeenCalled();
  });

  it("records a destination before a copy whose response is lost", async () => {
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = "attachments";
    mocks.generateUID
      .mockReturnValueOnce("attachkey001")
      .mockReturnValueOnce("previewkey01");
    mocks.inspectObject
      .mockResolvedValueOnce({
        contentType: "image/png",
        etag: '"attachment"',
        sha256: "a".repeat(64),
        size: 100,
      })
      .mockResolvedValueOnce({
        contentType: "image/webp",
        etag: '"preview"',
        sha256: "b".repeat(64),
        size: 50,
      });
    mocks.copyObject.mockRejectedValueOnce(new Error("response lost"));

    await expect(
      prepareCardVisualWallCloneObjects({} as never, [source]),
    ).rejects.toMatchObject({ message: "VISUAL_WALL_CLONE_FAILED" });
    expect(mocks.enqueuePreviewDeletionKeys).toHaveBeenCalledWith({}, [
      ".objects/attachkey001",
    ]);
    expect(mocks.deleteCardVisualWallPreviewObjects).toHaveBeenCalledWith({}, [
      ".objects/attachkey001",
    ]);
  });

  it("reserves both destination keys before copying either object", async () => {
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = "attachments";
    mocks.generateUID
      .mockReturnValueOnce("attachkey002")
      .mockReturnValueOnce("previewkey02");
    mocks.inspectObject
      .mockResolvedValueOnce({
        contentType: "image/png",
        etag: '"attachment"',
        sha256: "a".repeat(64),
        size: 100,
      })
      .mockResolvedValueOnce({
        contentType: "image/webp",
        etag: '"preview"',
        sha256: "b".repeat(64),
        size: 50,
      });
    mocks.copyObject.mockResolvedValue(undefined);

    await expect(
      prepareCardVisualWallCloneObjects({} as never, [source]),
    ).resolves.toMatchObject({
      clones: [{ sourceResourcePublicId: "resource0001" }],
    });
    expect(mocks.reservePreviewDeletionKeys).toHaveBeenCalledWith({}, [
      ".objects/attachkey002",
      ".visual-wall/previewkey02",
    ]);
    expect(
      mocks.reservePreviewDeletionKeys.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.copyObject.mock.invocationCallOrder[0] ?? 0);
  });
});
