import type {
  ExcalidrawElement,
  FileId,
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import { MAX_CARD_CANVAS_ELEMENTS } from "@kan/shared";

import type { WorkspaceCanvasImageResource } from "./workspace-canvas-image-loader";
import {
  getCardCanvasPasteViewport,
  layoutCardCanvasPasteElements,
} from "~/views/card/components/card-canvas-paste-batch";
import { fitWorkspaceCanvasImageDimensions } from "./workspace-canvas-image-loader";

export type WorkspaceCanvasPasteBatchItem =
  | { kind: "text"; text: string }
  | {
      kind: "resource";
      resource: WorkspaceCanvasImageResource;
      dimensions?: { width: number; height: number };
    };

const createWorkspaceCanvasPasteElement = (
  api: ExcalidrawImperativeAPI,
  item: WorkspaceCanvasPasteBatchItem,
) => {
  if (item.kind === "text") {
    const element = convertToExcalidrawElements([
      { type: "text", text: item.text, x: 0, y: 0 },
    ])[0];
    if (!element) throw new Error("TEXT_ELEMENT_FAILED");
    return element;
  }
  if (!api.getFiles()[item.resource.publicId]) {
    throw new Error("WORKSPACE_CANVAS_IMAGE_NOT_HYDRATED");
  }
  const sourceDimensions = item.dimensions ?? {
    width: item.resource.width ?? 640,
    height: item.resource.height ?? 640,
  };
  const dimensions = fitWorkspaceCanvasImageDimensions(
    sourceDimensions.width,
    sourceDimensions.height,
  );
  const element = convertToExcalidrawElements([
    {
      type: "image",
      x: 0,
      y: 0,
      width: dimensions.width,
      height: dimensions.height,
      fileId: item.resource.publicId as FileId,
      status: "saved",
      scale: [1, 1],
      crop: null,
      customData: { kanResourcePublicId: item.resource.publicId },
    },
  ])[0];
  if (!element) throw new Error("IMAGE_ELEMENT_FAILED");
  return element;
};

export const insertWorkspaceCanvasPasteBatch = ({
  api,
  items,
  transformElements,
}: {
  api: ExcalidrawImperativeAPI;
  items: readonly WorkspaceCanvasPasteBatchItem[];
  transformElements?: (
    elements: readonly ExcalidrawElement[],
    selectedElementIds: Readonly<Record<string, true>>,
  ) => readonly ExcalidrawElement[];
}) => {
  if (items.length === 0) return [];
  const currentElements = api.getSceneElements();
  if (currentElements.length + items.length > MAX_CARD_CANVAS_ELEMENTS) {
    throw new Error("CARD_CANVAS_ELEMENT_LIMIT_EXCEEDED");
  }
  const created = items.map((item) =>
    createWorkspaceCanvasPasteElement(api, item),
  );
  const positioned = layoutCardCanvasPasteElements(
    created,
    getCardCanvasPasteViewport(api.getAppState()),
  );
  const selectedElementIds = positioned.reduce<Record<string, true>>(
    (selected, element) => {
      selected[element.id] = true;
      return selected;
    },
    {},
  );
  const nextElements = [...currentElements, ...positioned];
  const transformedElements = transformElements?.(
    nextElements,
    selectedElementIds,
  );
  api.setActiveTool({ type: "selection" });
  api.updateScene({
    elements: transformedElements ? [...transformedElements] : nextElements,
    appState: { selectedElementIds, selectedGroupIds: {} },
    captureUpdate: "IMMEDIATELY",
  });
  return positioned.map((element) => element.id);
};
