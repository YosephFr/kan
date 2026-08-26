import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspacePermissionChangedError } from "@kan/db/repository/workspace-boundary";
import * as workspaceCanvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";

import { getWorkspaceCanvasImageForView } from "./workspace-canvas-image-access";

vi.mock("@kan/db/repository/workspaceCanvasImage.repo", () => ({
  getForView: vi.fn(),
}));

const db = {} as never;
const image = {
  publicId: "canvasimg001",
  workspaceId: 20,
  uploadSessionId: 30,
  s3Key: ".objects/canvasimg001",
  deletedAt: null,
  workspace: { id: 20, publicId: "workspace001", deletedAt: null },
  uploadSession: { id: 30, workspaceId: 20, consumedAt: new Date() },
};

describe("workspace canvas image access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceCanvasImageRepo.getForView).mockResolvedValue(
      image as never,
    );
  });

  it("requires an authenticated workspace viewer", async () => {
    await expect(
      getWorkspaceCanvasImageForView(db, image.publicId),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(workspaceCanvasImageRepo.getForView).not.toHaveBeenCalled();

    await expect(
      getWorkspaceCanvasImageForView(db, image.publicId, "viewer-id"),
    ).resolves.toEqual(image);
    expect(workspaceCanvasImageRepo.getForView).toHaveBeenCalledWith(db, {
      imagePublicId: image.publicId,
      userId: "viewer-id",
    });
  });

  it("hides deleted and cross-boundary storage records", async () => {
    vi.mocked(workspaceCanvasImageRepo.getForView).mockResolvedValueOnce(null);
    await expect(
      getWorkspaceCanvasImageForView(db, image.publicId, "viewer-id"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps permission revoked inside the read transaction", async () => {
    vi.mocked(workspaceCanvasImageRepo.getForView).mockRejectedValueOnce(
      new WorkspacePermissionChangedError(),
    );
    await expect(
      getWorkspaceCanvasImageForView(db, image.publicId, "viewer-id"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
