import { beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";

import type * as OptimizationSlot from "./workspace-canvas-image-optimization-slot";
import {
  optimizeWorkspaceCanvasImage,
  WorkspaceCanvasImageOptimizationError,
} from "./workspace-canvas-image-optimizer";

const sharpMocks = vi.hoisted(() => ({
  metadata: vi.fn(),
  sharp: vi.fn(),
  toBuffer: vi.fn(),
}));

vi.mock("sharp", () => {
  sharpMocks.sharp.mockImplementation(() => ({
    metadata: sharpMocks.metadata,
    rotate: () => ({
      resize: () => ({
        webp: () => ({ toBuffer: sharpMocks.toBuffer }),
      }),
    }),
  }));
  return { default: sharpMocks.sharp };
});

vi.mock(
  "./workspace-canvas-image-optimization-slot",
  async (importOriginal) => {
    const actual = await importOriginal<typeof OptimizationSlot>();
    return {
      ...actual,
      withWorkspaceCanvasImageGlobalOptimizationSlot: vi.fn(
        async (_db: dbClient, operation: () => Promise<unknown>) => operation(),
      ),
    };
  },
);

const db = {} as dbClient;

describe("workspace canvas image optimizer failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharpMocks.metadata.mockResolvedValue({
      format: "png",
      height: 16,
      pages: 1,
      width: 16,
    });
    sharpMocks.toBuffer.mockRejectedValue(new Error("corrupt pixel data"));
  });

  it("does not retry a transform after metadata-valid input fails to decode", async () => {
    await expect(
      optimizeWorkspaceCanvasImage(
        db,
        new Uint8Array([137, 80, 78, 71]),
        "image/png",
      ),
    ).rejects.toEqual(
      new WorkspaceCanvasImageOptimizationError("IMAGE_OPTIMIZATION_FAILED"),
    );

    expect(sharpMocks.metadata).toHaveBeenCalledOnce();
    expect(sharpMocks.toBuffer).toHaveBeenCalledOnce();
    expect(sharpMocks.sharp).toHaveBeenCalledTimes(2);
  });
});
