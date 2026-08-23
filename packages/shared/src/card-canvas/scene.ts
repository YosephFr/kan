import { createElementDefaults } from "./scene-defaults";
import { createElementFieldSanitizer } from "./scene-validators";

export const MAX_CARD_CANVAS_BYTES = 5 * 1024 * 1024;
export const MAX_CARD_CANVAS_ELEMENTS = 5000;
export const MAX_CARD_CANVAS_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_CARD_CANVAS_IMAGE_DIMENSION = 8192;
export const MAX_CARD_CANVAS_IMAGE_PIXELS = 16 * 1024 * 1024;
export const MAX_CARD_CANVAS_IMAGE_RESOURCES = 50;
export const MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

const PUBLIC_ID_PATTERN = /^[a-z0-9]{12}$/;
const INTERNAL_LINK_PATTERN = /^kan-(resource|subtask):([a-z0-9]{12})$/;
const ALLOWED_ELEMENT_TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "line",
  "arrow",
  "freedraw",
  "text",
  "image",
  "frame",
  "embeddable",
]);
const ALLOWED_ELEMENT_KEYS = new Set([
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "angle",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "strokeSharpness",
  "roughness",
  "opacity",
  "groupIds",
  "frameId",
  "index",
  "roundness",
  "seed",
  "version",
  "versionNonce",
  "isDeleted",
  "boundElements",
  "updated",
  "link",
  "locked",
  "customData",
  "points",
  "lastCommittedPoint",
  "startBinding",
  "endBinding",
  "startArrowhead",
  "endArrowhead",
  "elbowed",
  "fixedSegments",
  "startIsSpecial",
  "endIsSpecial",
  "fontSize",
  "fontFamily",
  "text",
  "textAlign",
  "verticalAlign",
  "containerId",
  "originalText",
  "rawText",
  "autoResize",
  "lineHeight",
  "baseline",
  "fileId",
  "status",
  "scale",
  "crop",
  "pressures",
  "simulatePressure",
  "name",
]);
const APP_STATE_KEYS = [
  "viewBackgroundColor",
  "gridSize",
  "gridStep",
  "gridModeEnabled",
  "objectsSnapModeEnabled",
] as const;
export type CardCanvasJson =
  | null
  | boolean
  | number
  | string
  | CardCanvasJson[]
  | { [key: string]: CardCanvasJson };

export interface NormalizedCardCanvasElement {
  id: string;
  type: string;
  [key: string]: CardCanvasJson;
}

export interface NormalizedCardCanvasAppState {
  viewBackgroundColor?: string;
  gridSize?: number | null;
  gridStep?: number | null;
  gridModeEnabled?: boolean;
  objectsSnapModeEnabled?: boolean;
}

export interface NormalizedCardCanvasScene {
  elements: NormalizedCardCanvasElement[];
  appState: NormalizedCardCanvasAppState;
}

export type CardCanvasSceneErrorCode =
  | "INVALID_SCENE"
  | "UNSUPPORTED_ELEMENT"
  | "INVALID_CUSTOM_DATA"
  | "UNSAFE_LINK"
  | "DUPLICATE_ELEMENT_ID"
  | "TOO_MANY_ELEMENTS"
  | "SCENE_TOO_LARGE";

export class CardCanvasSceneError extends Error {
  constructor(public readonly code: CardCanvasSceneErrorCode) {
    super(code);
    this.name = "CardCanvasSceneError";
  }
}

export interface CardCanvasFrameReference {
  publicId: string;
  elementId: string;
  name: string;
}

export interface CardCanvasResourceReference {
  publicId: string;
  elementId: string;
}

export interface CardCanvasSceneReferences {
  frames: CardCanvasFrameReference[];
  resources: CardCanvasResourceReference[];
  subtaskPublicIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidScene(): never {
  throw new CardCanvasSceneError("INVALID_SCENE");
}

function assertCardCanvasElementLimit(elements: readonly unknown[]) {
  if (elements.length > MAX_CARD_CANVAS_ELEMENTS) {
    throw new CardCanvasSceneError("TOO_MANY_ELEMENTS");
  }
}

const sanitizeElementField = createElementFieldSanitizer(invalidScene);

function sanitizeCustomData(
  value: unknown,
  type: string,
): Record<string, CardCanvasJson> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new CardCanvasSceneError("INVALID_CUSTOM_DATA");
  }
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) => key !== "kanFramePublicId" && key !== "kanResourcePublicId",
    )
  ) {
    throw new CardCanvasSceneError("INVALID_CUSTOM_DATA");
  }
  const framePublicId = value.kanFramePublicId;
  const resourcePublicId = value.kanResourcePublicId;
  if (
    framePublicId !== undefined &&
    (type !== "frame" ||
      typeof framePublicId !== "string" ||
      !PUBLIC_ID_PATTERN.test(framePublicId))
  ) {
    throw new CardCanvasSceneError("INVALID_CUSTOM_DATA");
  }
  if (
    resourcePublicId !== undefined &&
    ((type !== "image" && type !== "embeddable") ||
      typeof resourcePublicId !== "string" ||
      !PUBLIC_ID_PATTERN.test(resourcePublicId))
  ) {
    throw new CardCanvasSceneError("INVALID_CUSTOM_DATA");
  }
  if (framePublicId !== undefined && resourcePublicId !== undefined) {
    throw new CardCanvasSceneError("INVALID_CUSTOM_DATA");
  }
  return {
    ...(typeof framePublicId === "string"
      ? { kanFramePublicId: framePublicId }
      : {}),
    ...(typeof resourcePublicId === "string"
      ? { kanResourcePublicId: resourcePublicId }
      : {}),
  };
}

function sanitizeLink(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !INTERNAL_LINK_PATTERN.test(value)) {
    throw new CardCanvasSceneError("UNSAFE_LINK");
  }
  return value;
}

function sanitizeElement(value: unknown): NormalizedCardCanvasElement | null {
  if (!isRecord(value)) throw new CardCanvasSceneError("INVALID_SCENE");
  if (value.isDeleted !== undefined && typeof value.isDeleted !== "boolean") {
    invalidScene();
  }
  if (value.isDeleted === true) return null;
  if (
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 255 ||
    typeof value.type !== "string"
  ) {
    throw new CardCanvasSceneError("INVALID_SCENE");
  }
  if (!ALLOWED_ELEMENT_TYPES.has(value.type)) {
    throw new CardCanvasSceneError("UNSUPPORTED_ELEMENT");
  }

  const element: NormalizedCardCanvasElement = {
    id: value.id,
    type: value.type,
    ...createElementDefaults(value.type),
  };
  for (const [key, item] of Object.entries(value)) {
    if (
      key === "id" ||
      key === "type" ||
      key === "isDeleted" ||
      !ALLOWED_ELEMENT_KEYS.has(key) ||
      item === undefined
    ) {
      continue;
    }
    if (key === "customData") {
      const customData = sanitizeCustomData(item, value.type);
      if (customData) element.customData = customData;
      continue;
    }
    if (key === "link") {
      const link = sanitizeLink(item);
      if (link !== undefined) element.link = link;
      continue;
    }
    element[key] = sanitizeElementField(key, item, value.type);
  }
  element.isDeleted = false;

  const customData = isRecord(element.customData)
    ? element.customData
    : undefined;
  const link = parseInternalLink(element.link);
  if (
    typeof customData?.kanResourcePublicId === "string" &&
    typeof element.link === "string" &&
    (link?.kind !== "resource" ||
      link.publicId !== customData.kanResourcePublicId)
  ) {
    throw new CardCanvasSceneError("INVALID_CUSTOM_DATA");
  }
  if (
    value.type === "frame" &&
    typeof customData?.kanFramePublicId !== "string"
  ) {
    throw new CardCanvasSceneError("INVALID_CUSTOM_DATA");
  }
  if (
    value.type === "image" &&
    typeof customData?.kanResourcePublicId !== "string"
  ) {
    throw new CardCanvasSceneError("INVALID_CUSTOM_DATA");
  }
  if (
    value.type === "image" &&
    typeof customData?.kanResourcePublicId === "string"
  ) {
    element.fileId = customData.kanResourcePublicId;
  }
  if (
    value.type === "text" &&
    value.originalText === undefined &&
    typeof element.text === "string"
  ) {
    element.originalText = element.text;
  }
  if (
    value.type === "embeddable" &&
    typeof customData?.kanResourcePublicId !== "string" &&
    typeof element.link !== "string"
  ) {
    throw new CardCanvasSceneError("INVALID_CUSTOM_DATA");
  }
  if (value.type === "frame") {
    element.name =
      typeof value.name === "string" && value.name.trim().length > 0
        ? value.name.trim().slice(0, 255)
        : "Zona sin título";
  }
  return element;
}

function referencedElementId(value: CardCanvasJson | undefined) {
  return isRecord(value) && typeof value.elementId === "string"
    ? value.elementId
    : null;
}

function repairElementBindings(
  element: NormalizedCardCanvasElement,
  elementIds: Set<string>,
) {
  const repaired = { ...element };
  if (
    typeof repaired.frameId === "string" &&
    !elementIds.has(repaired.frameId)
  ) {
    repaired.frameId = null;
  }
  if (
    typeof repaired.containerId === "string" &&
    !elementIds.has(repaired.containerId)
  ) {
    repaired.containerId = null;
  }
  for (const key of ["startBinding", "endBinding"] as const) {
    const targetId = referencedElementId(repaired[key]);
    if (targetId && !elementIds.has(targetId)) repaired[key] = null;
  }
  if (Array.isArray(repaired.boundElements)) {
    repaired.boundElements = repaired.boundElements.filter(
      (binding) =>
        isRecord(binding) &&
        typeof binding.id === "string" &&
        elementIds.has(binding.id),
    );
  }
  return repaired;
}

function sanitizeAppState(value: unknown): NormalizedCardCanvasAppState {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new CardCanvasSceneError("INVALID_SCENE");
  const result: NormalizedCardCanvasAppState = {};
  for (const key of APP_STATE_KEYS) {
    const item = value[key];
    if (item === undefined) continue;
    if (key === "viewBackgroundColor") {
      if (typeof item !== "string" || item.length > 32) {
        throw new CardCanvasSceneError("INVALID_SCENE");
      }
      result.viewBackgroundColor = item;
      continue;
    }
    if (key === "gridModeEnabled" || key === "objectsSnapModeEnabled") {
      if (typeof item !== "boolean") {
        throw new CardCanvasSceneError("INVALID_SCENE");
      }
      result[key] = item;
      continue;
    }
    if (
      item !== null &&
      (typeof item !== "number" ||
        !Number.isFinite(item) ||
        item < 1 ||
        item > 1000)
    ) {
      throw new CardCanvasSceneError("INVALID_SCENE");
    }
    result[key] = item;
  }
  return result;
}

function sortJson(value: CardCanvasJson): CardCanvasJson {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key] as CardCanvasJson)]),
  );
}

export function canonicalizeCardCanvasScene(scene: NormalizedCardCanvasScene) {
  return JSON.stringify(sortJson(scene as unknown as CardCanvasJson));
}

export async function hashCardCanvasScene(scene: NormalizedCardCanvasScene) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalizeCardCanvasScene(scene)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function getCardCanvasSceneBytes(scene: NormalizedCardCanvasScene) {
  return new TextEncoder().encode(canonicalizeCardCanvasScene(scene))
    .byteLength;
}

export function normalizeCardCanvasScene(
  value: unknown,
): NormalizedCardCanvasScene {
  if (!isRecord(value) || !Array.isArray(value.elements)) {
    throw new CardCanvasSceneError("INVALID_SCENE");
  }
  assertCardCanvasElementLimit(value.elements);
  const elements = value.elements.flatMap((element) => {
    const sanitized = sanitizeElement(element);
    return sanitized ? [sanitized] : [];
  });
  const elementIds = new Set(elements.map((element) => element.id));
  if (elementIds.size !== elements.length) {
    throw new CardCanvasSceneError("DUPLICATE_ELEMENT_ID");
  }
  const framePublicIds = new Set<string>();
  for (const element of elements) {
    const customData = isRecord(element.customData)
      ? element.customData
      : undefined;
    const framePublicId = customData?.kanFramePublicId;
    if (typeof framePublicId === "string") {
      if (framePublicIds.has(framePublicId)) {
        throw new CardCanvasSceneError("INVALID_CUSTOM_DATA");
      }
      framePublicIds.add(framePublicId);
    }
  }
  const scene = {
    elements: elements.map((element) =>
      repairElementBindings(element, elementIds),
    ),
    appState: sanitizeAppState(value.appState),
  };
  if (getCardCanvasSceneBytes(scene) > MAX_CARD_CANVAS_BYTES) {
    throw new CardCanvasSceneError("SCENE_TOO_LARGE");
  }
  return scene;
}

function parseInternalLink(value: CardCanvasJson | undefined) {
  if (typeof value !== "string") return null;
  const match = INTERNAL_LINK_PATTERN.exec(value);
  return match?.[1] && match[2] ? { kind: match[1], publicId: match[2] } : null;
}

export function extractCardCanvasReferences(
  scene: NormalizedCardCanvasScene,
): CardCanvasSceneReferences {
  assertCardCanvasElementLimit(scene.elements);
  const frames: CardCanvasFrameReference[] = [];
  const resources: CardCanvasResourceReference[] = [];
  const subtaskPublicIds = new Set<string>();
  for (const element of scene.elements) {
    const customData = isRecord(element.customData)
      ? element.customData
      : undefined;
    if (typeof customData?.kanFramePublicId === "string") {
      frames.push({
        publicId: customData.kanFramePublicId,
        elementId: element.id,
        name:
          typeof element.name === "string" ? element.name : "Zona sin título",
      });
    }
    const linkedResource =
      typeof customData?.kanResourcePublicId === "string"
        ? customData.kanResourcePublicId
        : null;
    const link = parseInternalLink(element.link);
    const resourcePublicId =
      linkedResource ?? (link?.kind === "resource" ? link.publicId : null);
    if (resourcePublicId) {
      resources.push({ publicId: resourcePublicId, elementId: element.id });
    }
    if (link?.kind === "subtask") subtaskPublicIds.add(link.publicId);
  }
  return { frames, resources, subtaskPublicIds: [...subtaskPublicIds] };
}

function referencesResource(
  element: NormalizedCardCanvasElement,
  resourcePublicId: string,
) {
  const customData = isRecord(element.customData)
    ? element.customData
    : undefined;
  return (
    customData?.kanResourcePublicId === resourcePublicId ||
    element.link === `kan-resource:${resourcePublicId}`
  );
}

function createResourcePlaceholder(
  element: NormalizedCardCanvasElement,
): NormalizedCardCanvasElement {
  const placeholder: NormalizedCardCanvasElement = {
    id: element.id,
    type: "text",
    x: typeof element.x === "number" ? element.x : 0,
    y: typeof element.y === "number" ? element.y : 0,
    width: typeof element.width === "number" ? element.width : 220,
    height: typeof element.height === "number" ? element.height : 56,
    angle: typeof element.angle === "number" ? element.angle : 0,
    strokeColor: "#868e96",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: Array.isArray(element.groupIds) ? element.groupIds : [],
    frameId: typeof element.frameId === "string" ? element.frameId : null,
    index: element.index ?? null,
    roundness: null,
    seed: typeof element.seed === "number" ? element.seed : 1,
    version: typeof element.version === "number" ? element.version + 1 : 1,
    versionNonce:
      typeof element.versionNonce === "number" ? element.versionNonce + 1 : 1,
    isDeleted: false,
    boundElements: Array.isArray(element.boundElements)
      ? element.boundElements
      : null,
    updated: Date.now(),
    link: null,
    locked: true,
    fontSize: 20,
    fontFamily: 5,
    text: "Recurso eliminado",
    originalText: "Recurso eliminado",
    textAlign: "center",
    verticalAlign: "middle",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  };
  return placeholder;
}

export function removeCardCanvasResourceElements(
  scene: NormalizedCardCanvasScene,
  resourcePublicId: string,
  mode: "placeholder" | "remove",
) {
  assertCardCanvasElementLimit(scene.elements);
  const elements = scene.elements.flatMap((element) => {
    if (!referencesResource(element, resourcePublicId)) return [element];
    return mode === "placeholder" ? [createResourcePlaceholder(element)] : [];
  });
  return normalizeCardCanvasScene({ elements, appState: scene.appState });
}

function lookupMapping(
  mapping: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
  key: string,
) {
  if (typeof (mapping as ReadonlyMap<string, string>).get === "function") {
    return (mapping as ReadonlyMap<string, string>).get(key);
  }
  return (mapping as Readonly<Record<string, string>>)[key];
}

export function remapCardCanvasSceneReferences(
  scene: NormalizedCardCanvasScene,
  input: {
    framePublicIds:
      | ReadonlyMap<string, string>
      | Readonly<Record<string, string>>;
    resourcePublicIds:
      | ReadonlyMap<string, string>
      | Readonly<Record<string, string>>;
    subtaskPublicIds:
      | ReadonlyMap<string, string>
      | Readonly<Record<string, string>>;
  },
) {
  assertCardCanvasElementLimit(scene.elements);
  const elements = scene.elements.flatMap((source) => {
    const element = structuredClone(source);
    const customData = isRecord(element.customData)
      ? element.customData
      : undefined;
    if (typeof customData?.kanFramePublicId === "string") {
      const target = lookupMapping(
        input.framePublicIds,
        customData.kanFramePublicId,
      );
      if (!target) throw new CardCanvasSceneError("INVALID_CUSTOM_DATA");
      customData.kanFramePublicId = target;
    }
    if (typeof customData?.kanResourcePublicId === "string") {
      const target = lookupMapping(
        input.resourcePublicIds,
        customData.kanResourcePublicId,
      );
      if (!target) return [];
      customData.kanResourcePublicId = target;
    }
    const link = parseInternalLink(element.link);
    if (link?.kind === "resource") {
      const target = lookupMapping(input.resourcePublicIds, link.publicId);
      if (!target) return [];
      element.link = `kan-resource:${target}`;
    }
    if (link?.kind === "subtask") {
      const target = lookupMapping(input.subtaskPublicIds, link.publicId);
      if (!target && element.type === "embeddable") return [];
      element.link = target ? `kan-subtask:${target}` : null;
    }
    return [element];
  });
  return normalizeCardCanvasScene({ elements, appState: scene.appState });
}
