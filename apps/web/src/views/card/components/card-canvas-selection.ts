import type { CardCanvasElement } from "./card-canvas-types";

export type CardCanvasSelectionTarget =
  | { kind: "frame"; frameElementId: string }
  | { kind: "selection"; elementIds: string[] }
  | { kind: "invalid"; reason: "empty" | "multipleFrames" };

const getString = (element: CardCanvasElement, key: string) => {
  const value = element[key];
  return typeof value === "string" ? value : null;
};

export const getCardCanvasSelectionTarget = (
  elements: CardCanvasElement[],
  selectedElementIds: Record<string, boolean>,
): CardCanvasSelectionTarget => {
  const selectedElements = elements.filter(
    (element) =>
      element.isDeleted !== true &&
      selectedElementIds[getString(element, "id") ?? ""] === true,
  );
  if (selectedElements.length === 0) {
    return { kind: "invalid", reason: "empty" };
  }

  const selectedFrames = selectedElements.filter(
    (element) => element.type === "frame",
  );
  const parentFrameIds = new Set(
    selectedElements
      .map((element) => getString(element, "frameId"))
      .filter((value): value is string => value !== null),
  );
  const hasLooseElements = selectedElements.some(
    (element) =>
      element.type !== "frame" && getString(element, "frameId") === null,
  );

  if (selectedFrames.length > 1 || parentFrameIds.size > 1) {
    return { kind: "invalid", reason: "multipleFrames" };
  }

  if (selectedFrames.length === 1) {
    const selectedFrame = selectedFrames[0];
    if (!selectedFrame) return { kind: "invalid", reason: "empty" };
    const frameElementId = getString(selectedFrame, "id");
    const belongsToSelectedFrame = selectedElements.every(
      (element) =>
        element.type === "frame" ||
        getString(element, "frameId") === frameElementId,
    );
    if (!frameElementId || !belongsToSelectedFrame || hasLooseElements) {
      return { kind: "invalid", reason: "multipleFrames" };
    }
    return { kind: "frame", frameElementId };
  }

  const existingFrameId = [...parentFrameIds][0];
  if (existingFrameId) {
    if (hasLooseElements) {
      return { kind: "invalid", reason: "multipleFrames" };
    }
    return { kind: "frame", frameElementId: existingFrameId };
  }

  return {
    kind: "selection",
    elementIds: selectedElements.flatMap((element) => {
      const id = getString(element, "id");
      return id ? [id] : [];
    }),
  };
};

export const getFrameElements = (
  elements: CardCanvasElement[],
  frameElementId: string,
) =>
  elements.filter(
    (element) =>
      element.isDeleted !== true &&
      (getString(element, "id") === frameElementId ||
        getString(element, "frameId") === frameElementId),
  );
