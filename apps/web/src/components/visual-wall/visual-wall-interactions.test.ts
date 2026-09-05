import { describe, expect, it } from "vitest";

import type { VisualWallItem } from "./visual-wall-types";
import {
  getNextVisualWallZIndex,
  getVisualWallImageFiles,
  getVisualWallKeyboardAction,
  getVisualWallKeyboardResize,
  getVisualWallPointerPatch,
  MAX_VISUAL_WALL_Z_INDEX,
  promoteVisualWallItem,
} from "./visual-wall-interactions";

const item: VisualWallItem = {
  publicId: "wallitem0001",
  resourcePublicId: "wallimage001",
  title: "Campaign",
  viewUrl: "/api/workspace-canvas-images/wallimage001",
  x: 24,
  y: 24,
  width: 320,
  height: 180,
  zIndex: 1,
};

describe("visual wall interactions", () => {
  it("moves an item using logical pointer coordinates", () => {
    const result = getVisualWallPointerPatch({
      item,
      kind: "move",
      startClientX: 100,
      startClientY: 200,
      clientX: 140,
      clientY: 220,
      scale: 0.5,
    });

    expect(result).toEqual({
      moved: true,
      patch: {
        x: 104,
        y: 64,
        width: 320,
        height: 180,
        zIndex: 1,
      },
    });
  });

  it("does not turn normal touch jitter into a drag on narrow screens", () => {
    const result = getVisualWallPointerPatch({
      item,
      kind: "move",
      startClientX: 100,
      startClientY: 200,
      clientX: 103,
      clientY: 202,
      scale: 0.2,
    });

    expect(result).toEqual({
      moved: false,
      patch: {
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        zIndex: item.zIndex,
      },
    });
  });

  it("resizes from the pointer while preserving the image ratio", () => {
    const { patch, moved } = getVisualWallPointerPatch({
      item,
      kind: "resize",
      startClientX: 100,
      startClientY: 100,
      clientX: 180,
      clientY: 150,
      scale: 1,
    });

    expect(moved).toBe(true);
    expect(patch.width).toBeGreaterThan(item.width);
    expect(patch.height).toBeGreaterThan(item.height);
    expect(patch.width / patch.height).toBeCloseTo(item.width / item.height, 8);
    expect(patch).toMatchObject({ x: item.x, y: item.y, zIndex: item.zIndex });
  });

  it("promotes a selected item above the current top layer", () => {
    expect(promoteVisualWallItem(item, 7)).toMatchObject({ zIndex: 8 });
    expect(
      promoteVisualWallItem(
        { ...item, zIndex: MAX_VISUAL_WALL_Z_INDEX - 1 },
        MAX_VISUAL_WALL_Z_INDEX,
      ),
    ).toMatchObject({ zIndex: MAX_VISUAL_WALL_Z_INDEX });
  });

  it("keeps an already-frontmost image unchanged when it is selected again", () => {
    expect(promoteVisualWallItem(item, item.zIndex)).toBe(item);
  });

  it("keeps a panorama proportional when its Pencil handle reaches minimum size", () => {
    const panorama = { ...item, width: 704, height: 44 };
    const { patch, moved } = getVisualWallPointerPatch({
      item: panorama,
      kind: "resize",
      startClientX: 200,
      startClientY: 200,
      clientX: 20,
      clientY: 100,
      scale: 0.25,
    });
    expect(moved).toBe(true);
    expect(patch.width).toBe(704);
    expect(patch.height).toBe(44);
  });

  it("assigns new items distinct layers above the current wall", () => {
    expect(getNextVisualWallZIndex([], 1)).toBe(1);
    expect(getNextVisualWallZIndex([item, { zIndex: 7 }], 1)).toBe(8);
    expect(getNextVisualWallZIndex([item, { zIndex: 7 }], 2)).toBe(9);
  });

  it("accepts image files from paste and drop while ignoring other files", () => {
    const pastedImage = { name: "paste.png", type: "image/png" } as File;
    const droppedImage = { name: "drop.webp", type: "image/webp" } as File;
    const text = { name: "notes.txt", type: "text/plain" } as File;

    expect(getVisualWallImageFiles([pastedImage, text])).toEqual([pastedImage]);
    expect(getVisualWallImageFiles([text, droppedImage])).toEqual([
      droppedImage,
    ]);
  });

  it("maps Delete and arrow keys to editor actions", () => {
    expect(
      getVisualWallKeyboardAction({
        item,
        key: "Delete",
        shiftKey: false,
        canEdit: true,
      }),
    ).toEqual({ type: "remove" });

    expect(
      getVisualWallKeyboardAction({
        item,
        key: "ArrowRight",
        shiftKey: false,
        canEdit: true,
      }),
    ).toEqual({ type: "update", item: { ...item, x: 32 } });

    expect(
      getVisualWallKeyboardAction({
        item,
        key: "ArrowUp",
        shiftKey: true,
        canEdit: true,
      }),
    ).toEqual({ type: "update", item: { ...item, y: 23 } });

    expect(
      getVisualWallKeyboardAction({
        item,
        key: "Delete",
        shiftKey: false,
        canEdit: false,
      }),
    ).toEqual({ type: "none" });
  });

  it("resizes proportionally from the keyboard handle", () => {
    const larger = getVisualWallKeyboardResize({
      item,
      key: "ArrowRight",
      shiftKey: false,
    });
    const smaller = getVisualWallKeyboardResize({
      item,
      key: "ArrowUp",
      shiftKey: true,
    });

    expect(larger?.width).toBeGreaterThan(item.width);
    expect(smaller?.width).toBeLessThan(item.width);
    expect((larger?.width ?? 0) / (larger?.height ?? 1)).toBeCloseTo(
      item.width / item.height,
      8,
    );
    expect(
      getVisualWallKeyboardResize({ item, key: "Enter", shiftKey: false }),
    ).toBeNull();
  });
});
