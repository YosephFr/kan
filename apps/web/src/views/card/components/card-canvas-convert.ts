import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import { generateUID } from "@kan/shared/utils";

import type { CardCanvasElement } from "./card-canvas-types";
import {
  getCanvasElementNumber,
  getCanvasFramePublicId,
} from "./card-canvas-elements";
import { getCardCanvasSelectionTarget } from "./card-canvas-selection";

export type CardCanvasPreparedConversion =
  | {
      status: "ready";
      framePublicId: string;
      frameElementId: string;
      title: string;
    }
  | { status: "invalid"; reason: "empty" | "multipleFrames" };

const getFrameTitle = (element: CardCanvasElement) =>
  typeof element.name === "string" && element.name.trim()
    ? element.name.trim()
    : "Zona sin título";

export const prepareCardCanvasConversion = (
  api: ExcalidrawImperativeAPI,
): CardCanvasPreparedConversion => {
  const elements = api.getSceneElements();
  const canvasElements = elements as unknown as CardCanvasElement[];
  const target = getCardCanvasSelectionTarget(
    canvasElements,
    api.getAppState().selectedElementIds,
  );
  if (target.kind === "invalid")
    return { status: "invalid", reason: target.reason };

  if (target.kind === "frame") {
    const frame = canvasElements.find(
      (element) => element.id === target.frameElementId,
    );
    const framePublicId = frame ? getCanvasFramePublicId(frame) : null;
    if (!frame || !framePublicId) {
      return { status: "invalid", reason: "empty" };
    }
    return {
      status: "ready",
      framePublicId,
      frameElementId: frame.id,
      title: getFrameTitle(frame),
    };
  }

  const selectedIds = new Set(target.elementIds);
  const selectedElements = canvasElements.filter((element) =>
    selectedIds.has(element.id),
  );
  if (selectedElements.length === 0) {
    return { status: "invalid", reason: "empty" };
  }
  const minX = Math.min(
    ...selectedElements.map(
      (element) => getCanvasElementNumber(element, "x") ?? 0,
    ),
  );
  const minY = Math.min(
    ...selectedElements.map(
      (element) => getCanvasElementNumber(element, "y") ?? 0,
    ),
  );
  const maxX = Math.max(
    ...selectedElements.map(
      (element) =>
        (getCanvasElementNumber(element, "x") ?? 0) +
        (getCanvasElementNumber(element, "width") ?? 0),
    ),
  );
  const maxY = Math.max(
    ...selectedElements.map(
      (element) =>
        (getCanvasElementNumber(element, "y") ?? 0) +
        (getCanvasElementNumber(element, "height") ?? 0),
    ),
  );
  const padding = 48;
  const framePublicId = generateUID();
  const base = convertToExcalidrawElements([
    {
      type: "rectangle",
      x: minX - padding,
      y: minY - padding,
      width: Math.max(maxX - minX + padding * 2, 240),
      height: Math.max(maxY - minY + padding * 2, 160),
      roughness: 0,
      backgroundColor: "transparent",
      strokeColor: "#868e96",
    },
  ])[0];
  if (!base) return { status: "invalid", reason: "empty" };
  const frame = {
    ...base,
    type: "frame" as const,
    name: "Zona sin título",
    customData: { kanFramePublicId: framePublicId },
  } as ExcalidrawElement;
  const nextElements = elements.map((element) =>
    selectedIds.has(element.id)
      ? {
          ...element,
          frameId: frame.id,
          version: element.version + 1,
          versionNonce: element.versionNonce + 1,
          updated: Date.now(),
        }
      : element,
  );
  api.updateScene({
    elements: [...nextElements, frame],
    appState: { selectedElementIds: { [frame.id]: true } },
  });
  return {
    status: "ready",
    framePublicId,
    frameElementId: frame.id,
    title: "Zona sin título",
  };
};
