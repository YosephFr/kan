import type {
  ExcalidrawElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import {
  MAX_CARD_CANVAS_ELEMENTS,
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_IMAGE_RESOURCES,
  MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
} from "@kan/shared";

import type { CardCanvasElement } from "./card-canvas-types";
import type { CardResource } from "./card-resource-types";
import { getCanvasResourcePublicId } from "./card-canvas-elements";
import {
  assertCardCanvasImageResourceBudget,
  hydrateCardCanvasImage,
} from "./card-canvas-resources";

export const CARD_CANVAS_PASTE_GAP = 24;

export interface CardCanvasPastePoint {
  x: number;
  y: number;
}

export interface CardCanvasPasteViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type CardCanvasPasteBatchItem =
  | { kind: "text"; text: string }
  | { kind: "resource"; resource: CardResource };

interface PositionedElement {
  x: number;
  y: number;
  width: number;
  height: number;
}

const isImageResource = (
  resource: CardResource,
): resource is Extract<CardResource, { kind: "upload" }> =>
  resource.kind === "upload" &&
  resource.contentType.startsWith("image/") &&
  resource.viewUrl !== null;

export const getCardCanvasPasteViewport = (
  appState: Pick<AppState, "height" | "scrollX" | "scrollY" | "width" | "zoom">,
): CardCanvasPasteViewport => {
  const zoom = appState.zoom.value || 1;
  return {
    left: -appState.scrollX,
    top: -appState.scrollY,
    width: Math.max(1, appState.width / zoom),
    height: Math.max(1, appState.height / zoom),
  };
};

const clampSpan = (
  value: number,
  minimum: number,
  maximum: number,
  span: number,
) =>
  span >= maximum - minimum
    ? minimum
    : Math.min(Math.max(value, minimum), maximum - span);

export const layoutCardCanvasPasteElements = <T extends PositionedElement>(
  elements: readonly T[],
  viewport: CardCanvasPasteViewport,
  anchor?: CardCanvasPastePoint | null,
): T[] => {
  if (elements.length === 0) return [];
  const innerLeft = viewport.left + CARD_CANVAS_PASTE_GAP;
  const innerTop = viewport.top + CARD_CANVAS_PASTE_GAP;
  const innerRight = Math.max(
    innerLeft + 1,
    viewport.left + viewport.width - CARD_CANVAS_PASTE_GAP,
  );
  const innerBottom = Math.max(
    innerTop + 1,
    viewport.top + viewport.height - CARD_CANVAS_PASTE_GAP,
  );
  const availableWidth = innerRight - innerLeft;
  const rows: { indices: number[]; width: number; height: number }[] = [];

  elements.forEach((element, index) => {
    const width = Math.max(1, Math.abs(element.width));
    const height = Math.max(1, Math.abs(element.height));
    const row = rows.at(-1);
    if (
      !row ||
      (row.indices.length > 0 &&
        row.width + CARD_CANVAS_PASTE_GAP + width > availableWidth)
    ) {
      rows.push({ indices: [index], width, height });
      return;
    }
    row.indices.push(index);
    row.width += CARD_CANVAS_PASTE_GAP + width;
    row.height = Math.max(row.height, height);
  });

  const layoutWidth = Math.max(...rows.map((row) => row.width));
  const layoutHeight = rows.reduce(
    (height, row, index) =>
      height + row.height + (index === 0 ? 0 : CARD_CANVAS_PASTE_GAP),
    0,
  );
  const center = {
    x: viewport.left + viewport.width / 2,
    y: viewport.top + viewport.height / 2,
  };
  const target =
    anchor &&
    anchor.x >= viewport.left &&
    anchor.x <= viewport.left + viewport.width &&
    anchor.y >= viewport.top &&
    anchor.y <= viewport.top + viewport.height
      ? anchor
      : center;
  const startX = clampSpan(
    target.x - layoutWidth / 2,
    innerLeft,
    innerRight,
    layoutWidth,
  );
  const startY = clampSpan(
    target.y - layoutHeight / 2,
    innerTop,
    innerBottom,
    layoutHeight,
  );
  const positions: CardCanvasPastePoint[] = [];
  let rowY = startY;
  rows.forEach((row) => {
    let itemX = startX;
    row.indices.forEach((index) => {
      const element = elements[index];
      if (!element) return;
      positions[index] = {
        x: itemX,
        y: rowY + (row.height - Math.max(1, Math.abs(element.height))) / 2,
      };
      itemX += Math.max(1, Math.abs(element.width)) + CARD_CANVAS_PASTE_GAP;
    });
    rowY += row.height + CARD_CANVAS_PASTE_GAP;
  });
  return elements.map((element, index) => ({
    ...element,
    x: positions[index]?.x ?? element.x,
    y: positions[index]?.y ?? element.y,
  }));
};

export const assertCardCanvasPasteBatchBudget = ({
  elements,
  items,
  resources,
}: {
  elements: readonly ExcalidrawElement[];
  items: readonly CardCanvasPasteBatchItem[];
  resources: readonly CardResource[];
}) => {
  if (elements.length + items.length > MAX_CARD_CANVAS_ELEMENTS) {
    throw new Error("CARD_CANVAS_ELEMENT_LIMIT_EXCEEDED");
  }
  const pastedImages = items.flatMap((item) =>
    item.kind === "resource" && isImageResource(item.resource)
      ? [item.resource]
      : [],
  );
  if (pastedImages.length === 0) return;
  assertCardCanvasImageResourceBudget({
    elements,
    resources,
    candidates: pastedImages,
  });
};

export const assertCardCanvasPasteInputBudget = ({
  elements,
  objectCount,
  imageSizes,
  resources,
}: {
  elements: readonly ExcalidrawElement[];
  objectCount: number;
  imageSizes: readonly number[];
  resources: readonly CardResource[];
}) => {
  if (elements.length + objectCount > MAX_CARD_CANVAS_ELEMENTS) {
    throw new Error("CARD_CANVAS_ELEMENT_LIMIT_EXCEEDED");
  }
  if (imageSizes.length === 0) return;
  if (imageSizes.some((size) => size > MAX_CARD_CANVAS_IMAGE_BYTES)) {
    throw new Error("IMAGE_RESOURCE_BUDGET_EXCEEDED");
  }
  const imageResources = new Map(
    resources
      .filter(isImageResource)
      .map((resource) => [resource.publicId, resource]),
  );
  const imagePublicIds = new Set(
    elements.flatMap((element) => {
      if (element.type !== "image" || element.isDeleted) return [];
      const publicId = getCanvasResourcePublicId(
        element as unknown as CardCanvasElement,
      );
      return publicId ? [publicId] : [];
    }),
  );
  const resolvedImages = [...imagePublicIds].map((publicId) => {
    const resource = imageResources.get(publicId);
    if (!resource) throw new Error("IMAGE_RESOURCE_BUDGET_UNKNOWN");
    return resource;
  });
  const existingBytes = resolvedImages.reduce(
    (total, resource) => total + resource.size,
    0,
  );
  if (
    resolvedImages.length + imageSizes.length >
      MAX_CARD_CANVAS_IMAGE_RESOURCES ||
    (imageSizes.length > 0 &&
      existingBytes >= MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES) ||
    existingBytes + imageSizes.reduce((total, size) => total + size, 0) >
      MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES
  ) {
    throw new Error("IMAGE_RESOURCE_BUDGET_EXCEEDED");
  }
};

const createCardCanvasPasteElement = async (
  api: ExcalidrawImperativeAPI,
  item: CardCanvasPasteBatchItem,
) => {
  if (item.kind === "text") {
    const element = convertToExcalidrawElements([
      { type: "text", text: item.text, x: 0, y: 0 },
    ])[0];
    if (!element) throw new Error("TEXT_ELEMENT_FAILED");
    return element;
  }
  if (isImageResource(item.resource)) {
    const { fileId, dimensions } = await hydrateCardCanvasImage(
      api,
      item.resource,
    );
    const element = convertToExcalidrawElements([
      {
        type: "image",
        x: 0,
        y: 0,
        width: dimensions.width,
        height: dimensions.height,
        fileId,
        status: "saved",
        scale: [1, 1],
        crop: null,
        customData: { kanResourcePublicId: item.resource.publicId },
      },
    ])[0];
    if (!element) throw new Error("IMAGE_ELEMENT_FAILED");
    return element;
  }
  const base = convertToExcalidrawElements([
    {
      type: "rectangle",
      x: 0,
      y: 0,
      width: 300,
      height: 168,
      roughness: 0,
      backgroundColor: "#f8f9fa",
      strokeColor: "#868e96",
      fillStyle: "solid",
    },
  ])[0];
  if (!base) throw new Error("RESOURCE_CARD_FAILED");
  return {
    ...base,
    type: "embeddable" as const,
    link: `kan-resource:${item.resource.publicId}`,
    customData: { kanResourcePublicId: item.resource.publicId },
  } as NonDeleted<ExcalidrawElement>;
};

export const insertCardCanvasPasteBatch = async ({
  api,
  items,
  resources,
  anchor,
}: {
  api: ExcalidrawImperativeAPI;
  items: readonly CardCanvasPasteBatchItem[];
  resources: readonly CardResource[];
  anchor?: CardCanvasPastePoint | null;
}) => {
  if (items.length === 0) return [];
  const initialElements = api.getSceneElements();
  assertCardCanvasPasteBatchBudget({
    elements: initialElements,
    items,
    resources,
  });
  const created: ExcalidrawElement[] = [];
  for (const item of items) {
    created.push(await createCardCanvasPasteElement(api, item));
  }
  const currentElements = api.getSceneElements();
  assertCardCanvasPasteBatchBudget({
    elements: currentElements,
    items,
    resources,
  });
  const positioned = layoutCardCanvasPasteElements(
    created,
    getCardCanvasPasteViewport(api.getAppState()),
    anchor,
  );
  const selectedElementIds = positioned.reduce<Record<string, true>>(
    (selected, element) => {
      selected[element.id] = true;
      return selected;
    },
    {},
  );
  api.setActiveTool({ type: "selection" });
  api.updateScene({
    elements: [...currentElements, ...positioned],
    appState: { selectedElementIds, selectedGroupIds: {} },
    captureUpdate: "IMMEDIATELY",
  });
  return positioned.map((element) => element.id);
};
