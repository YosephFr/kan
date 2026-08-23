import { generateUID } from "@kan/shared/utils";

import type { CanvasJsonValue, CardCanvasElement } from "./card-canvas-types";

const PUBLIC_ID_PATTERN = /^[a-z0-9]{12}$/;

const isJsonRecord = (
  value: CanvasJsonValue | undefined,
): value is Record<string, CanvasJsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const getCanvasElementString = (
  element: CardCanvasElement,
  key: string,
) => {
  const value = element[key];
  return typeof value === "string" ? value : null;
};

export const getCanvasElementNumber = (
  element: CardCanvasElement,
  key: string,
) => {
  const value = element[key];
  return typeof value === "number" ? value : null;
};

export const getCanvasFramePublicId = (element: CardCanvasElement) => {
  if (element.type !== "frame" || !isJsonRecord(element.customData)) {
    return null;
  }
  const value = element.customData.kanFramePublicId;
  return typeof value === "string" && PUBLIC_ID_PATTERN.test(value)
    ? value
    : null;
};

export const getCanvasResourcePublicId = (element: CardCanvasElement) => {
  if (!isJsonRecord(element.customData)) return null;
  const value = element.customData.kanResourcePublicId;
  return typeof value === "string" && PUBLIC_ID_PATTERN.test(value)
    ? value
    : null;
};

export const ensureCanvasFramePublicIds = (elements: CardCanvasElement[]) => {
  const seen = new Set<string>();
  let changed = false;
  const nextElements = elements.map((element) => {
    if (element.type !== "frame" || element.isDeleted === true) return element;
    const currentPublicId = getCanvasFramePublicId(element);
    if (currentPublicId && !seen.has(currentPublicId)) {
      seen.add(currentPublicId);
      return element;
    }
    const publicId = generateUID();
    seen.add(publicId);
    changed = true;
    const customData = isJsonRecord(element.customData)
      ? element.customData
      : {};
    return {
      ...element,
      customData: { ...customData, kanFramePublicId: publicId },
    };
  });
  return { changed, elements: nextElements };
};

export const findCanvasFrameByPublicId = (
  elements: CardCanvasElement[],
  framePublicId: string,
) =>
  elements.find(
    (element) =>
      element.isDeleted !== true &&
      getCanvasFramePublicId(element) === framePublicId,
  ) ?? null;

export const parseCanvasInternalLink = (
  element: CardCanvasElement,
): { kind: "resource" | "subtask"; publicId: string } | null => {
  const value = getCanvasElementString(element, "link");
  const match = /^kan-(resource|subtask):([a-z0-9]{12})$/.exec(value ?? "");
  return match?.[1] && match[2]
    ? { kind: match[1] as "resource" | "subtask", publicId: match[2] }
    : null;
};
