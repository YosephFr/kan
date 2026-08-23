import type {
  ExcalidrawElement,
  FileId,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_IMAGE_DIMENSION,
  MAX_CARD_CANVAS_IMAGE_PIXELS,
  MAX_CARD_CANVAS_IMAGE_RESOURCES,
  MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
} from "@kan/shared";

import type { CardCanvasElement } from "./card-canvas-types";
import type { CardResource } from "./card-resource-types";
import { getCanvasResourcePublicId } from "./card-canvas-elements";

const IMAGE_HEADER_BYTES = 256 * 1024;

const loadImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error("IMAGE_LOAD_FAILED")),
      {
        once: true,
      },
    );
    image.src = source;
  });

const readUint16BigEndian = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);

const readUint16LittleEndian = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);

const readUint24LittleEndian = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] ?? 0) |
  ((bytes[offset + 1] ?? 0) << 8) |
  ((bytes[offset + 2] ?? 0) << 16);

const readUint32BigEndian = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] ?? 0) * 0x1000000 +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)) >>>
  0;

const getJpegDimensions = (bytes: Uint8Array) => {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        width: readUint16BigEndian(bytes, offset + 5),
        height: readUint16BigEndian(bytes, offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
};

export const parseCardCanvasImageDimensions = (
  contentType: string,
  bytes: Uint8Array,
) => {
  if (contentType === "image/png" && bytes.length >= 24) {
    return {
      width: readUint32BigEndian(bytes, 16),
      height: readUint32BigEndian(bytes, 20),
    };
  }
  if (contentType === "image/gif" && bytes.length >= 10) {
    return {
      width: readUint16LittleEndian(bytes, 6),
      height: readUint16LittleEndian(bytes, 8),
    };
  }
  if (contentType === "image/jpeg") return getJpegDimensions(bytes);
  if (contentType !== "image/webp" || bytes.length < 30) return null;
  const format = new TextDecoder("ascii").decode(bytes.subarray(12, 16));
  if (format === "VP8X") {
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1,
    };
  }
  if (format === "VP8L" && bytes[20] === 0x2f) {
    const bits =
      ((bytes[21] ?? 0) |
        ((bytes[22] ?? 0) << 8) |
        ((bytes[23] ?? 0) << 16) |
        ((bytes[24] ?? 0) << 24)) >>>
      0;
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  if (
    format === "VP8 " &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: readUint16LittleEndian(bytes, 26) & 0x3fff,
      height: readUint16LittleEndian(bytes, 28) & 0x3fff,
    };
  }
  return null;
};

const assertSafeImageDimensions = (dimensions: {
  width: number;
  height: number;
}) => {
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_CARD_CANVAS_IMAGE_DIMENSION ||
    dimensions.height > MAX_CARD_CANVAS_IMAGE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_CARD_CANVAS_IMAGE_PIXELS
  ) {
    throw new Error("IMAGE_RESOURCE_DIMENSIONS_UNSAFE");
  }
};

const fitImage = (width: number, height: number) => {
  const maxDimension = 640;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const renderImageDataUrl = (
  image: HTMLImageElement,
  dimensions: { width: number; height: number },
  contentType: string,
) => {
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("IMAGE_RENDER_FAILED");
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
  const outputType = contentType === "image/jpeg" ? "image/jpeg" : "image/png";
  return {
    dataURL: canvas.toDataURL(outputType, 0.9) as DataURL,
    mimeType: outputType as BinaryFileData["mimeType"],
  };
};

const getInsertionPoint = (
  appState: AppState,
  width: number,
  height: number,
) => {
  const zoom = appState.zoom.value || 1;
  return {
    x: -appState.scrollX + appState.width / zoom / 2 - width / 2,
    y: -appState.scrollY + appState.height / zoom / 2 - height / 2,
  };
};

const addElement = (
  api: ExcalidrawImperativeAPI,
  element: ExcalidrawElement,
) => {
  api.updateScene({
    elements: [...api.getSceneElements(), element],
    appState: {
      selectedElementIds: { [element.id]: true },
    },
  });
  api.scrollToContent(element, {
    fitToViewport: true,
    viewportZoomFactor: 0.8,
    animate: true,
    duration: 300,
  });
};

export const isImageResource = (
  resource: CardResource,
): resource is Extract<CardResource, { kind: "upload" }> =>
  resource.kind === "upload" &&
  resource.contentType.startsWith("image/") &&
  resource.viewUrl !== null;

export const hydrateCardCanvasImage = async (
  api: ExcalidrawImperativeAPI,
  resource: Extract<CardResource, { kind: "upload" }>,
) => {
  if (!resource.viewUrl || !resource.contentType.startsWith("image/")) {
    throw new Error("NOT_AN_IMAGE_RESOURCE");
  }
  const fileId = resource.publicId as FileId;
  const existing = api.getFiles()[fileId];
  if (existing) {
    const image = await loadImage(existing.dataURL);
    return {
      fileId,
      dimensions: fitImage(image.naturalWidth, image.naturalHeight),
    };
  }
  if (resource.size > MAX_CARD_CANVAS_IMAGE_BYTES) {
    throw new Error("IMAGE_RESOURCE_TOO_LARGE");
  }
  const response = await fetch(resource.viewUrl, {
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok) throw new Error("IMAGE_RESOURCE_LOAD_FAILED");
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_CARD_CANVAS_IMAGE_BYTES
  ) {
    throw new Error("IMAGE_RESOURCE_TOO_LARGE");
  }
  const blob = await response.blob();
  if (
    !blob.type.startsWith("image/") ||
    blob.size !== resource.size ||
    blob.size > MAX_CARD_CANVAS_IMAGE_BYTES
  ) {
    throw new Error("IMAGE_RESOURCE_MIME_MISMATCH");
  }
  const header = new Uint8Array(
    await blob.slice(0, IMAGE_HEADER_BYTES).arrayBuffer(),
  );
  const dimensions = parseCardCanvasImageDimensions(blob.type, header);
  if (!dimensions) throw new Error("IMAGE_RESOURCE_DIMENSIONS_INVALID");
  assertSafeImageDimensions(dimensions);
  const objectUrl = URL.createObjectURL(blob);
  let rendered: ReturnType<typeof renderImageDataUrl>;
  const fitted = fitImage(dimensions.width, dimensions.height);
  try {
    const image = await loadImage(objectUrl);
    if (
      image.naturalWidth !== dimensions.width ||
      image.naturalHeight !== dimensions.height
    ) {
      throw new Error("IMAGE_RESOURCE_DIMENSIONS_MISMATCH");
    }
    rendered = renderImageDataUrl(image, fitted, blob.type);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  const binaryFile: BinaryFileData = {
    id: fileId,
    dataURL: rendered.dataURL,
    mimeType: rendered.mimeType,
    created: resource.createdAt.getTime(),
  };
  api.addFiles([binaryFile]);
  return { fileId, dimensions: fitted };
};

export const insertCardCanvasResource = async (
  api: ExcalidrawImperativeAPI,
  resource: CardResource,
) => {
  if (isImageResource(resource)) {
    const { fileId, dimensions } = await hydrateCardCanvasImage(api, resource);
    const point = getInsertionPoint(
      api.getAppState(),
      dimensions.width,
      dimensions.height,
    );
    const element = convertToExcalidrawElements([
      {
        type: "image",
        x: point.x,
        y: point.y,
        width: dimensions.width,
        height: dimensions.height,
        fileId,
        status: "saved",
        scale: [1, 1],
        crop: null,
        customData: { kanResourcePublicId: resource.publicId },
      },
    ])[0];
    if (!element) throw new Error("IMAGE_ELEMENT_FAILED");
    addElement(api, element);
    return element.id;
  }

  const width = 300;
  const height = 168;
  const point = getInsertionPoint(api.getAppState(), width, height);
  const base = convertToExcalidrawElements([
    {
      type: "rectangle",
      x: point.x,
      y: point.y,
      width,
      height,
      roughness: 0,
      backgroundColor: "#f8f9fa",
      strokeColor: "#868e96",
      fillStyle: "solid",
    },
  ])[0];
  if (!base) throw new Error("RESOURCE_CARD_FAILED");
  const element = {
    ...base,
    type: "embeddable" as const,
    link: `kan-resource:${resource.publicId}`,
    customData: { kanResourcePublicId: resource.publicId },
  } as NonDeleted<ExcalidrawElement>;
  addElement(api, element);
  return element.id;
};

export const hydrateCardCanvasImages = async (
  api: ExcalidrawImperativeAPI,
  resources: CardResource[],
) => {
  const resourcesByPublicId = new Map(
    resources
      .filter(isImageResource)
      .map((resource) => [resource.publicId, resource]),
  );
  const publicIds = new Set(
    api.getSceneElements().flatMap((element) => {
      if (element.type !== "image") return [];
      const publicId = getCanvasResourcePublicId(
        element as unknown as CardCanvasElement,
      );
      return publicId ? [publicId] : [];
    }),
  );
  const pendingPublicIds = [...publicIds].filter((publicId) =>
    resourcesByPublicId.has(publicId),
  );
  const pendingResources = pendingPublicIds.flatMap((publicId) => {
    const resource = resourcesByPublicId.get(publicId);
    return resource ? [resource] : [];
  });
  if (
    pendingResources.length > MAX_CARD_CANVAS_IMAGE_RESOURCES ||
    pendingResources.some(
      (resource) => resource.size > MAX_CARD_CANVAS_IMAGE_BYTES,
    ) ||
    pendingResources.reduce((total, resource) => total + resource.size, 0) >
      MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES
  ) {
    throw new Error("IMAGE_RESOURCE_BUDGET_EXCEEDED");
  }
  let nextIndex = 0;
  const failures: unknown[] = [];
  const hydrateNext = async () => {
    while (nextIndex < pendingPublicIds.length) {
      const publicId = pendingPublicIds[nextIndex];
      nextIndex += 1;
      if (!publicId) continue;
      const resource = resourcesByPublicId.get(publicId);
      if (!resource) continue;
      try {
        await hydrateCardCanvasImage(api, resource);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await hydrateNext();
  if (failures.length > 0) throw new Error("IMAGE_RESOURCES_LOAD_FAILED");
};
