import type { VisualWallItem, VisualWallItemPatch } from "./visual-wall-types";
import {
  clampVisualWallRect,
  resizeVisualWallRect,
} from "./visual-wall-layout";

export const MAX_VISUAL_WALL_Z_INDEX = 2_147_483_647;
export const VISUAL_WALL_POINTER_DRAG_THRESHOLD_PX = 4;

export const promoteVisualWallItem = (
  item: VisualWallItem,
  maxZIndex: number,
) => {
  if (item.zIndex >= maxZIndex) return item;
  if (maxZIndex < MAX_VISUAL_WALL_Z_INDEX) {
    return { ...item, zIndex: maxZIndex + 1 };
  }
  if (item.zIndex < maxZIndex) {
    return { ...item, zIndex: maxZIndex };
  }
  return item;
};

export const getNextVisualWallZIndex = (
  items: readonly Pick<VisualWallItem, "zIndex">[],
  offset = 1,
) =>
  Math.min(
    MAX_VISUAL_WALL_Z_INDEX,
    items.reduce((max, item) => Math.max(max, item.zIndex), 0) + offset,
  );

export const getVisualWallPointerPatch = (input: {
  item: VisualWallItem;
  kind: "move" | "resize";
  startClientX: number;
  startClientY: number;
  clientX: number;
  clientY: number;
  scale: number;
}) => {
  const moved =
    Math.abs(input.clientX - input.startClientX) >
      VISUAL_WALL_POINTER_DRAG_THRESHOLD_PX ||
    Math.abs(input.clientY - input.startClientY) >
      VISUAL_WALL_POINTER_DRAG_THRESHOLD_PX;
  if (!moved) {
    return {
      patch: toVisualWallItemPatch(input.item),
      moved: false,
    };
  }
  const scale = Math.max(0.01, input.scale);
  const deltaX = (input.clientX - input.startClientX) / scale;
  const deltaY = (input.clientY - input.startClientY) / scale;
  const rect =
    input.kind === "move"
      ? clampVisualWallRect({
          ...input.item,
          x: input.item.x + deltaX,
          y: input.item.y + deltaY,
        })
      : resizeVisualWallRect(input.item, deltaX, deltaY);

  return {
    patch: { ...rect, zIndex: input.item.zIndex },
    moved: true,
  };
};

export type VisualWallKeyboardAction =
  | { type: "preview" }
  | { type: "remove" }
  | { type: "update"; item: VisualWallItem }
  | { type: "none" };

export const getVisualWallKeyboardAction = (input: {
  item: VisualWallItem;
  key: string;
  shiftKey: boolean;
  canEdit: boolean;
}): VisualWallKeyboardAction => {
  if (input.key === "Enter") return { type: "preview" };
  if (!input.canEdit) return { type: "none" };
  if (input.key === "Delete" || input.key === "Backspace") {
    return { type: "remove" };
  }

  const movement = input.shiftKey ? 1 : 8;
  const movements: Partial<Record<string, readonly [number, number]>> = {
    ArrowLeft: [-movement, 0],
    ArrowRight: [movement, 0],
    ArrowUp: [0, -movement],
    ArrowDown: [0, movement],
  };
  const delta = movements[input.key];
  if (!delta) return { type: "none" };

  return {
    type: "update",
    item: {
      ...input.item,
      ...clampVisualWallRect({
        ...input.item,
        x: input.item.x + delta[0],
        y: input.item.y + delta[1],
      }),
    },
  };
};

export const getVisualWallKeyboardResize = (input: {
  item: VisualWallItem;
  key: string;
  shiftKey: boolean;
}) => {
  const direction =
    input.key === "ArrowRight" || input.key === "ArrowDown"
      ? 1
      : input.key === "ArrowLeft" || input.key === "ArrowUp"
        ? -1
        : 0;
  if (direction === 0) return null;
  const delta = direction * (input.shiftKey ? 1 : 8);
  return {
    ...input.item,
    ...resizeVisualWallRect(input.item, delta, 0),
  };
};

export const getVisualWallImageFiles = (files: readonly File[]) =>
  files.filter((file) => file.type.startsWith("image/"));

export const toVisualWallItemPatch = (
  item: VisualWallItem,
): VisualWallItemPatch => ({
  x: item.x,
  y: item.y,
  width: item.width,
  height: item.height,
  zIndex: item.zIndex,
});
