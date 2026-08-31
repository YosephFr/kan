import { describe, expect, it, vi } from "vitest";

import {
  discardWorkspaceCanvasImage,
  drainWorkspaceCanvasImageCleanup,
} from "./workspace-canvas-image-cleanup";

const target = (imagePublicId: string) => ({
  workspacePublicId: "workspace001",
  imagePublicId,
});

describe("workspace canvas image cleanup", () => {
  it("retries a transient deletion once", async () => {
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(undefined);

    await expect(
      discardWorkspaceCanvasImage({ target: target("image0000001"), remove }),
    ).resolves.toBe(true);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("treats an already deleted image as cleaned", async () => {
    const remove = vi.fn().mockRejectedValue(new Error("NOT_FOUND"));

    await expect(
      discardWorkspaceCanvasImage({ target: target("image0000002"), remove }),
    ).resolves.toBe(true);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("does not retry an image retained by a revision", async () => {
    const remove = vi
      .fn()
      .mockRejectedValue(new Error("WORKSPACE_CANVAS_IMAGE_STILL_REFERENCED"));

    await expect(
      discardWorkspaceCanvasImage({ target: target("image0000005"), remove }),
    ).resolves.toBe(true);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("returns only images that remain after two deletion attempts", async () => {
    const remove = vi.fn(({ imagePublicId }: { imagePublicId: string }) =>
      imagePublicId === "image0000003"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(),
    );

    await expect(
      drainWorkspaceCanvasImageCleanup({
        targets: [target("image0000003"), target("image0000004")],
        remove,
      }),
    ).resolves.toEqual([target("image0000003")]);
    expect(remove).toHaveBeenCalledTimes(3);
  });
});
