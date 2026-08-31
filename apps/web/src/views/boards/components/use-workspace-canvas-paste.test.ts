import { describe, expect, it } from "vitest";

import { MAX_CARD_CANVAS_IMAGE_BYTES } from "@kan/shared";

import { normalizeCardCanvasClipboard } from "../../card/components/card-canvas-clipboard";
import {
  makeWorkspaceCanvasFilePasteItems,
  toWorkspaceCanvasPasteText,
  validateWorkspaceCanvasImageFile,
} from "./workspace-canvas-paste";

const image = (input: Partial<Pick<File, "name" | "size" | "type">> = {}) =>
  ({
    name: "goal.png",
    size: 1024,
    type: "image/png",
    ...input,
  }) as Pick<File, "name" | "size" | "type">;

describe("workspace canvas paste", () => {
  it("accepts the exact image byte limit", () => {
    expect(
      validateWorkspaceCanvasImageFile(
        image({ size: MAX_CARD_CANVAS_IMAGE_BYTES }),
      ),
    ).toBe("image/png");
  });

  it("rejects oversized, unsupported and mismatched images before upload", () => {
    expect(() =>
      validateWorkspaceCanvasImageFile(
        image({ size: MAX_CARD_CANVAS_IMAGE_BYTES + 1 }),
      ),
    ).toThrow("WORKSPACE_CANVAS_IMAGE_INVALID");
    expect(() =>
      validateWorkspaceCanvasImageFile(
        image({ name: "goal.gif", type: "image/gif" }),
      ),
    ).toThrow("WORKSPACE_CANVAS_IMAGE_INVALID");
    expect(() =>
      validateWorkspaceCanvasImageFile(
        image({ name: "goal.jpg", type: "image/png" }),
      ),
    ).toThrow("WORKSPACE_CANVAS_IMAGE_INVALID");
  });

  it("keeps external links as clean editable text", () => {
    expect(
      toWorkspaceCanvasPasteText({
        type: "link",
        label: "Meta de ventas",
        url: "https://example.com/meta",
      }),
    ).toBe("Meta de ventas\nhttps://example.com/meta");
  });

  it("accepts the exact remaining scene slot for offline text", () => {
    const normalized = normalizeCardCanvasClipboard(
      {
        text: "Meta offline",
        images: [
          {
            file: image({ size: MAX_CARD_CANVAS_IMAGE_BYTES + 1 }) as File,
          },
        ],
      },
      { includeImages: false },
    );
    expect(4_999 + normalized.items.length).toBe(5_000);
    expect(normalized).toMatchObject({
      items: [{ type: "text", text: "Meta offline" }],
      imagesOmitted: true,
    });
  });

  it("queues a large device selection without applying the HTML clipboard cap", () => {
    const files = Array.from(
      { length: 51 },
      (_, index) => image({ name: `goal-${index}.png` }) as File,
    );
    expect(makeWorkspaceCanvasFilePasteItems(files)).toHaveLength(51);
  });

  it("keeps the shared card clipboard image limit unchanged", () => {
    expect(() =>
      normalizeCardCanvasClipboard({
        images: Array.from({ length: 11 }, () => ({ file: image() as File })),
      }),
    ).toThrow("CLIPBOARD_IMAGE_LIMIT_REACHED");
  });
});
