import { describe, expect, it } from "vitest";

import { MAX_CARD_CANVAS_IMAGE_BYTES } from "@kan/shared";

import { workspaceCanvasImageUploadRequestSchema } from "./workspace-canvas-image";

const validUpload = {
  filename: "meta.png",
  contentType: "image/png",
  size: MAX_CARD_CANVAS_IMAGE_BYTES,
  sha256: "A".repeat(64),
};

describe("workspace canvas image schemas", () => {
  it("accepts the exact byte limit and normalizes the fingerprint", () => {
    expect(workspaceCanvasImageUploadRequestSchema.parse(validUpload)).toEqual({
      ...validUpload,
      sha256: "a".repeat(64),
    });
  });

  it("rejects an oversized request before creating a session", () => {
    expect(
      workspaceCanvasImageUploadRequestSchema.safeParse({
        ...validUpload,
        size: MAX_CARD_CANVAS_IMAGE_BYTES + 1,
      }).success,
    ).toBe(false);
  });

  it("rejects a filename and MIME mismatch", () => {
    expect(
      workspaceCanvasImageUploadRequestSchema.safeParse({
        ...validUpload,
        filename: "meta.jpg",
      }).success,
    ).toBe(false);
  });
});
