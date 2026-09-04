import { describe, expect, it } from "vitest";

import { MAX_CARD_CANVAS_IMAGE_BYTES } from "@kan/shared";

import { validateWorkspaceVisualWallImageFile } from "./workspace-visual-wall-image";

const image = (input: Partial<Pick<File, "name" | "size" | "type">> = {}) =>
  ({
    name: "goal.png",
    size: 1024,
    type: "image/png",
    ...input,
  }) as Pick<File, "name" | "size" | "type">;

describe("workspace visual wall image validation", () => {
  it("accepts supported images at the exact byte limit", () => {
    expect(
      validateWorkspaceVisualWallImageFile(
        image({ size: MAX_CARD_CANVAS_IMAGE_BYTES }),
      ),
    ).toBe("image/png");
  });

  it("rejects invalid images before upload", () => {
    expect(() =>
      validateWorkspaceVisualWallImageFile(
        image({ size: MAX_CARD_CANVAS_IMAGE_BYTES + 1 }),
      ),
    ).toThrow("WORKSPACE_VISUAL_WALL_IMAGE_INVALID");
    expect(() =>
      validateWorkspaceVisualWallImageFile(
        image({ name: "goal.gif", type: "image/gif" }),
      ),
    ).toThrow("WORKSPACE_VISUAL_WALL_IMAGE_INVALID");
    expect(() =>
      validateWorkspaceVisualWallImageFile(
        image({ name: "goal.jpg", type: "image/png" }),
      ),
    ).toThrow("WORKSPACE_VISUAL_WALL_IMAGE_INVALID");
  });
});
