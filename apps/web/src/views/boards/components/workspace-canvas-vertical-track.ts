import type { ElementUpdate } from "@excalidraw/excalidraw/element/mutateElement";
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { getCommonBounds, newElementWith } from "@excalidraw/excalidraw";

export const WORKSPACE_CANVAS_TRACK_WIDTH = 1_200;
export const WORKSPACE_CANVAS_TRACK_ORIGIN_Y = 0;
export const WORKSPACE_CANVAS_TRACK_MAX_Y = 1_000_000;
export const WORKSPACE_CANVAS_VIEWPORT_PADDING = 24;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
const HOME_MAX_ZOOM = 1;
const BOUNDS_EPSILON = 0.001;

const getElementGroupIds = (element: ExcalidrawElement) =>
  (element as unknown as { groupIds?: readonly string[] }).groupIds ?? [];

export type WorkspaceCanvasCamera = Pick<
  AppState,
  "scrollX" | "scrollY" | "zoom"
>;

export interface WorkspaceCanvasCameraOptions {
  viewportWidth: number;
  viewportHeight?: number;
  horizontalPadding?: number;
  topPadding?: number;
}

export interface WorkspaceCanvasCameraClampOptions
  extends WorkspaceCanvasCameraOptions,
    WorkspaceCanvasCamera {}

export interface WorkspaceCanvasSelectionConstraint {
  elements: ExcalidrawElement[];
  changed: boolean;
  scale: number;
  translation: {
    x: number;
    y: number;
  };
}

const expandSelectedElementIds = (
  elements: readonly ExcalidrawElement[],
  selectedElementIds: Readonly<Record<string, boolean>>,
) => {
  const expandedIds = new Set(
    Object.entries(selectedElementIds)
      .filter(([, selected]) => selected)
      .map(([id]) => id),
  );
  let expanded = true;

  while (expanded) {
    expanded = false;
    const selectedGroupIds = new Set<string>();
    for (const element of elements) {
      if (element.isDeleted || !expandedIds.has(element.id)) continue;
      for (const groupId of getElementGroupIds(element)) {
        selectedGroupIds.add(groupId);
      }
      if (element.type === "text" && element.containerId) {
        if (!expandedIds.has(element.containerId)) {
          expandedIds.add(element.containerId);
          expanded = true;
        }
      }
      for (const binding of element.boundElements ?? []) {
        if (binding.type === "text" && !expandedIds.has(binding.id)) {
          expandedIds.add(binding.id);
          expanded = true;
        }
      }
    }
    for (const element of elements) {
      if (
        !element.isDeleted &&
        getElementGroupIds(element).some((groupId) =>
          selectedGroupIds.has(groupId),
        ) &&
        !expandedIds.has(element.id)
      ) {
        expandedIds.add(element.id);
        expanded = true;
      }
    }
  }

  return expandedIds;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const getViewportWidth = (viewportWidth: number) =>
  Number.isFinite(viewportWidth) ? Math.max(1, viewportWidth) : 1;

const getViewportHeight = (viewportHeight: number | undefined) =>
  Number.isFinite(viewportHeight) ? Math.max(1, viewportHeight ?? 1) : 1;

const getPadding = (padding: number | undefined, viewportWidth: number) =>
  Math.min(
    Math.max(0, padding ?? WORKSPACE_CANVAS_VIEWPORT_PADDING),
    viewportWidth / 2,
  );

const getTopPadding = (padding: number | undefined) =>
  Math.max(0, padding ?? WORKSPACE_CANVAS_VIEWPORT_PADDING);

const getZoom = (value: number) =>
  clamp(Number.isFinite(value) ? value : 1, MIN_ZOOM, MAX_ZOOM);

const toZoom = (value: number): AppState["zoom"] => ({
  value: value as AppState["zoom"]["value"],
});

export const getWorkspaceCanvasHomeCamera = ({
  viewportWidth,
  horizontalPadding,
  topPadding,
}: WorkspaceCanvasCameraOptions): WorkspaceCanvasCamera => {
  const width = getViewportWidth(viewportWidth);
  const sidePadding = getPadding(horizontalPadding, width);
  const availableWidth = Math.max(1, width - sidePadding * 2);
  const zoomValue = clamp(
    availableWidth / WORKSPACE_CANVAS_TRACK_WIDTH,
    MIN_ZOOM,
    HOME_MAX_ZOOM,
  );

  return {
    scrollX: (width / zoomValue - WORKSPACE_CANVAS_TRACK_WIDTH) / 2,
    scrollY:
      getTopPadding(topPadding) / zoomValue - WORKSPACE_CANVAS_TRACK_ORIGIN_Y,
    zoom: toZoom(zoomValue),
  };
};

export const clampWorkspaceCanvasCamera = ({
  viewportWidth,
  viewportHeight,
  horizontalPadding,
  topPadding,
  scrollX,
  scrollY,
  zoom,
}: WorkspaceCanvasCameraClampOptions): WorkspaceCanvasCamera => {
  const width = getViewportWidth(viewportWidth);
  const height = getViewportHeight(viewportHeight);
  const zoomValue = getZoom(zoom.value);
  const sidePadding = getPadding(horizontalPadding, width);
  const maximumScrollX = sidePadding / zoomValue;
  const minimumScrollX =
    (width - sidePadding) / zoomValue - WORKSPACE_CANVAS_TRACK_WIDTH;
  const constrainedScrollX =
    minimumScrollX > maximumScrollX
      ? (width / zoomValue - WORKSPACE_CANVAS_TRACK_WIDTH) / 2
      : clamp(scrollX, minimumScrollX, maximumScrollX);
  const maximumScrollY =
    getTopPadding(topPadding) / zoomValue - WORKSPACE_CANVAS_TRACK_ORIGIN_Y;
  const minimumScrollY =
    (height - getTopPadding(topPadding)) / zoomValue -
    WORKSPACE_CANVAS_TRACK_MAX_Y;

  return {
    scrollX: constrainedScrollX,
    scrollY: clamp(scrollY, minimumScrollY, maximumScrollY),
    zoom: toZoom(zoomValue),
  };
};

interface ElementTransform {
  originX: number;
  originY: number;
  scale: number;
  translateX: number;
  translateY: number;
}

type CanvasPoint = readonly [number, number];

interface ConnectedArrowGeometry {
  angle?: number;
  points: readonly CanvasPoint[];
  startBinding: { elementId: string } | null;
  endBinding: { elementId: string } | null;
  lastCommittedPoint: CanvasPoint | null;
}

const scalePoint = (point: CanvasPoint, scale: number): CanvasPoint => [
  point[0] * scale,
  point[1] * scale,
];

const scalePoints = (points: unknown, scale: number) =>
  (points as readonly CanvasPoint[]).map((point) => scalePoint(point, scale));

const scaleOptionalPoint = (point: unknown, scale: number) =>
  point === null ? null : scalePoint(point as CanvasPoint, scale);

type BaseElementUpdates = Pick<
  ExcalidrawElement,
  "x" | "y" | "width" | "height"
>;

const getBaseUpdates = (
  element: ExcalidrawElement,
  transform: ElementTransform,
): BaseElementUpdates => ({
  x:
    transform.originX +
    (element.x - transform.originX) * transform.scale +
    transform.translateX,
  y:
    transform.originY +
    (element.y - transform.originY) * transform.scale +
    transform.translateY,
  width: element.width * transform.scale,
  height: element.height * transform.scale,
});

const applyElementUpdate = <Element extends ExcalidrawElement>(
  element: Element,
  updates: ElementUpdate<Element>,
  versioned: boolean,
): Element =>
  versioned
    ? newElementWith(element, updates)
    : ({ ...element, ...updates } as Element);

const transformElement = <Element extends ExcalidrawElement>(
  element: Element,
  transform: ElementTransform,
  versioned: boolean,
): Element => {
  const baseUpdates = getBaseUpdates(element, transform);

  if (element.type === "text") {
    const updates = {
      ...baseUpdates,
      fontSize: Math.max(1, element.fontSize * transform.scale),
    } as unknown as ElementUpdate<typeof element>;
    return applyElementUpdate(element, updates, versioned);
  }

  if (element.type === "line" || element.type === "arrow") {
    const updates = {
      ...baseUpdates,
      points: scalePoints(element.points as unknown, transform.scale),
      lastCommittedPoint: scaleOptionalPoint(
        element.lastCommittedPoint as unknown,
        transform.scale,
      ),
    } as unknown as ElementUpdate<typeof element>;
    return applyElementUpdate(element, updates, versioned);
  }

  if (element.type === "freedraw") {
    const updates = {
      ...baseUpdates,
      points: scalePoints(element.points as unknown, transform.scale),
      lastCommittedPoint: scaleOptionalPoint(
        element.lastCommittedPoint as unknown,
        transform.scale,
      ),
    } as unknown as ElementUpdate<typeof element>;
    return applyElementUpdate(element, updates, versioned);
  }

  return applyElementUpdate(
    element,
    baseUpdates as ElementUpdate<Element>,
    versioned,
  );
};

const transformScenePoint = (
  point: CanvasPoint,
  transform: ElementTransform,
): CanvasPoint => [
  transform.originX +
    (point[0] - transform.originX) * transform.scale +
    transform.translateX,
  transform.originY +
    (point[1] - transform.originY) * transform.scale +
    transform.translateY,
];

const rotateScenePoint = (
  point: CanvasPoint,
  center: CanvasPoint,
  angle: number,
): CanvasPoint => {
  if (angle === 0) return point;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const x = point[0] - center[0];
  const y = point[1] - center[1];
  return [center[0] + x * cosine - y * sine, center[1] + x * sine + y * cosine];
};

const updateConnectedArrow = (
  element: ExcalidrawElement,
  selectedIds: ReadonlySet<string>,
  transform: ElementTransform,
) => {
  if (element.type !== "arrow") return element;
  const arrow = element as unknown as ConnectedArrowGeometry;
  const arrowAngle =
    typeof arrow.angle === "number" && Number.isFinite(arrow.angle)
      ? arrow.angle
      : 0;
  const moveStart =
    arrow.startBinding !== null &&
    selectedIds.has(arrow.startBinding.elementId);
  const moveEnd =
    arrow.endBinding !== null && selectedIds.has(arrow.endBinding.elementId);
  if (!moveStart && !moveEnd) return element;

  const center: CanvasPoint = [
    element.x + element.width / 2,
    element.y + element.height / 2,
  ];
  const globalPoints: CanvasPoint[] = arrow.points.map((point) =>
    rotateScenePoint(
      [element.x + point[0], element.y + point[1]],
      center,
      arrowAngle,
    ),
  );
  if (moveStart && moveEnd) {
    for (let index = 0; index < globalPoints.length; index += 1) {
      const point = globalPoints[index];
      if (point) globalPoints[index] = transformScenePoint(point, transform);
    }
  } else if (moveStart && globalPoints[0]) {
    globalPoints[0] = transformScenePoint(globalPoints[0], transform);
  } else {
    const lastIndex = globalPoints.length - 1;
    const lastPoint = globalPoints[lastIndex];
    if (lastPoint) {
      globalPoints[lastIndex] = transformScenePoint(lastPoint, transform);
    }
  }
  const origin = globalPoints[0];
  if (!origin) return element;
  const points = globalPoints.map(
    (point) => [point[0] - origin[0], point[1] - origin[1]] as CanvasPoint,
  );
  const pointXs = points.map((point) => point[0]);
  const pointYs = points.map((point) => point[1]);
  const update = {
    x: origin[0],
    y: origin[1],
    angle: 0,
    points,
    width: Math.max(...pointXs) - Math.min(...pointXs),
    height: Math.max(...pointYs) - Math.min(...pointYs),
    lastCommittedPoint:
      arrow.lastCommittedPoint === null ? null : (points.at(-1) ?? null),
  };
  return newElementWith(
    element as ExcalidrawLinearElement,
    update as unknown as ElementUpdate<ExcalidrawLinearElement>,
  );
};

const getScaledSelection = (
  elements: readonly ExcalidrawElement[],
  originX: number,
  originY: number,
  scale: number,
) =>
  elements.map((element) =>
    transformElement(
      element,
      {
        originX,
        originY,
        scale,
        translateX: 0,
        translateY: 0,
      },
      false,
    ),
  );

const fitScaleToTrack = (
  selectedElements: readonly ExcalidrawElement[],
  originX: number,
  originY: number,
  initialWidth: number,
  initialHeight: number,
) => {
  let scale = Math.min(
    1,
    WORKSPACE_CANVAS_TRACK_WIDTH / Math.max(1, initialWidth),
    WORKSPACE_CANVAS_TRACK_MAX_Y / Math.max(1, initialHeight),
  );

  for (let attempt = 0; attempt < 2 && scale < 1; attempt += 1) {
    const scaledElements = getScaledSelection(
      selectedElements,
      originX,
      originY,
      scale,
    );
    const [minimumX, , maximumX] = getCommonBounds(scaledElements);
    const scaledWidth = maximumX - minimumX;
    if (scaledWidth <= WORKSPACE_CANVAS_TRACK_WIDTH + BOUNDS_EPSILON) break;
    scale *= WORKSPACE_CANVAS_TRACK_WIDTH / scaledWidth;
  }

  return scale;
};

export const constrainWorkspaceCanvasSelection = (
  elements: readonly ExcalidrawElement[],
  selectedElementIds: Readonly<Record<string, boolean>>,
): WorkspaceCanvasSelectionConstraint => {
  const expandedSelectedElementIds = expandSelectedElementIds(
    elements,
    selectedElementIds,
  );
  const selectedElements = elements.filter(
    (element) =>
      element.isDeleted !== true && expandedSelectedElementIds.has(element.id),
  );
  if (selectedElements.length === 0) {
    return {
      elements: [...elements],
      changed: false,
      scale: 1,
      translation: { x: 0, y: 0 },
    };
  }

  const [minimumX, minimumY, maximumX, maximumY] =
    getCommonBounds(selectedElements);
  const scale = fitScaleToTrack(
    selectedElements,
    minimumX,
    minimumY,
    maximumX - minimumX,
    maximumY - minimumY,
  );
  const scaledElements = getScaledSelection(
    selectedElements,
    minimumX,
    minimumY,
    scale,
  );
  const [scaledMinimumX, scaledMinimumY, scaledMaximumX, scaledMaximumY] =
    getCommonBounds(scaledElements);
  const translationX =
    scaledMinimumX < 0
      ? -scaledMinimumX
      : scaledMaximumX > WORKSPACE_CANVAS_TRACK_WIDTH
        ? WORKSPACE_CANVAS_TRACK_WIDTH - scaledMaximumX
        : 0;
  const translationY =
    scaledMinimumY < WORKSPACE_CANVAS_TRACK_ORIGIN_Y
      ? WORKSPACE_CANVAS_TRACK_ORIGIN_Y - scaledMinimumY
      : scaledMaximumY > WORKSPACE_CANVAS_TRACK_MAX_Y
        ? WORKSPACE_CANVAS_TRACK_MAX_Y - scaledMaximumY
        : 0;
  const changed =
    scale < 1 ||
    Math.abs(translationX) > BOUNDS_EPSILON ||
    Math.abs(translationY) > BOUNDS_EPSILON;

  if (!changed) {
    return {
      elements: [...elements],
      changed: false,
      scale: 1,
      translation: { x: 0, y: 0 },
    };
  }

  const selectionTransform: ElementTransform = {
    originX: minimumX,
    originY: minimumY,
    scale,
    translateX: translationX,
    translateY: translationY,
  };
  const transformedElements = new Map<string, ExcalidrawElement>(
    selectedElements.map((element) => [
      element.id,
      transformElement(element, selectionTransform, true),
    ]),
  );
  const selectedIds = new Set(transformedElements.keys());
  for (const [id, transformedElement] of transformedElements) {
    const originalElement = elements.find((element) => element.id === id);
    if (
      !originalElement ||
      originalElement.type !== "arrow" ||
      transformedElement.type !== "arrow"
    ) {
      continue;
    }
    const updates: { startBinding?: null; endBinding?: null } = {};
    if (
      transformedElement.startBinding &&
      !selectedIds.has(transformedElement.startBinding.elementId)
    ) {
      updates.startBinding = null;
    }
    if (
      transformedElement.endBinding &&
      !selectedIds.has(transformedElement.endBinding.elementId)
    ) {
      updates.endBinding = null;
    }
    if (Object.keys(updates).length > 0) {
      transformedElements.set(
        id,
        newElementWith(
          transformedElement,
          updates as ElementUpdate<typeof transformedElement>,
        ),
      );
      for (const binding of [
        originalElement.startBinding,
        originalElement.endBinding,
      ]) {
        if (!binding || selectedIds.has(binding.elementId)) continue;
        const boundElement =
          transformedElements.get(binding.elementId) ??
          elements.find((element) => element.id === binding.elementId);
        if (!boundElement) continue;
        transformedElements.set(
          boundElement.id,
          newElementWith(boundElement, {
            boundElements: (boundElement.boundElements ?? []).filter(
              (candidate) => candidate.id !== id,
            ),
          }),
        );
      }
    }
  }

  for (const element of elements) {
    if (element.type !== "arrow" || transformedElements.has(element.id)) {
      continue;
    }
    const updatedArrow = updateConnectedArrow(
      element,
      selectedIds,
      selectionTransform,
    );
    if (updatedArrow === element) continue;
    transformedElements.set(element.id, updatedArrow);
    const [oldMinX, oldMinY, oldMaxX, oldMaxY] = getCommonBounds([element]);
    const [newMinX, newMinY, newMaxX, newMaxY] = getCommonBounds([
      updatedArrow,
    ]);
    const centerTranslationX = (newMinX + newMaxX - oldMinX - oldMaxX) / 2;
    const centerTranslationY = (newMinY + newMaxY - oldMinY - oldMaxY) / 2;
    for (const binding of element.boundElements ?? []) {
      if (binding.type !== "text" || transformedElements.has(binding.id)) {
        continue;
      }
      const label = elements.find((candidate) => candidate.id === binding.id);
      if (!label) continue;
      transformedElements.set(
        label.id,
        transformElement(
          label,
          {
            originX: label.x + label.width / 2,
            originY: label.y + label.height / 2,
            scale: 1,
            translateX: centerTranslationX,
            translateY: centerTranslationY,
          },
          true,
        ),
      );
    }
  }

  return {
    elements: elements.map(
      (element) => transformedElements.get(element.id) ?? element,
    ),
    changed: true,
    scale,
    translation: { x: translationX, y: translationY },
  };
};

export const constrainWorkspaceCanvasOutliers = (
  elements: readonly ExcalidrawElement[],
) => {
  const outlierIds = Object.fromEntries(
    elements.flatMap((element) => {
      if (element.isDeleted) return [];
      const [minimumX, minimumY, maximumX, maximumY] = getCommonBounds([
        element,
      ]);
      return minimumX < -BOUNDS_EPSILON ||
        minimumY < WORKSPACE_CANVAS_TRACK_ORIGIN_Y - BOUNDS_EPSILON ||
        maximumX > WORKSPACE_CANVAS_TRACK_WIDTH + BOUNDS_EPSILON ||
        maximumY > WORKSPACE_CANVAS_TRACK_MAX_Y + BOUNDS_EPSILON
        ? [[element.id, true] as const]
        : [];
    }),
  );
  return constrainWorkspaceCanvasSelection(elements, outlierIds);
};
