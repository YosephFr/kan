import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_PIXELS,
} from "@kan/shared";

import type { CardCanvasElement } from "../../card/components/card-canvas-types";
import type { CardResource } from "../../card/components/card-resource-types";
import { getCanvasResourcePublicId } from "../../card/components/card-canvas-elements";
import {
  assertSafeCardCanvasImageDimensions,
  parseCardCanvasImageDimensions,
} from "../../card/components/card-canvas-resources";
import { optimizeWorkspaceCanvasDisplayBlob } from "./workspace-canvas-local-image";

export const WORKSPACE_CANVAS_IMAGE_METADATA_BATCH_SIZE = 50;
export const WORKSPACE_CANVAS_IMAGE_LOAD_CONCURRENCY = 3;
export const WORKSPACE_CANVAS_IMAGE_DISPLAY_MAX_DIMENSION = 320;
export const WORKSPACE_CANVAS_EXPORT_DECODED_IMAGE_BYTES = 64 * 1024 * 1024;

export type WorkspaceCanvasImageResource = Extract<
  CardResource,
  { kind: "upload" }
> & {
  width?: number | null;
  height?: number | null;
  optimizedAt?: Date | null;
};

export interface WorkspaceCanvasImageLoadResult<T> {
  completed: T[];
  failed: { item: T; error: unknown }[];
}

export interface WorkspaceCanvasImageViewportSnapshot {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
}

export const createWorkspaceCanvasImageViewportScheduler = ({
  onFrame,
  requestFrame,
  cancelFrame,
}: {
  onFrame: (snapshot: WorkspaceCanvasImageViewportSnapshot) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
}) => {
  let frame: number | null = null;
  let latest: WorkspaceCanvasImageViewportSnapshot | null = null;
  return {
    schedule(snapshot: WorkspaceCanvasImageViewportSnapshot) {
      latest = snapshot;
      if (frame !== null) return;
      frame = requestFrame(() => {
        frame = null;
        const pending = latest;
        latest = null;
        if (pending) onFrame(pending);
      });
    },
    dispose() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      latest = null;
    },
  };
};

export const chunkWorkspaceCanvasImagePublicIds = (
  publicIds: readonly string[],
) => {
  const chunks: string[][] = [];
  for (
    let index = 0;
    index < publicIds.length;
    index += WORKSPACE_CANVAS_IMAGE_METADATA_BATCH_SIZE
  ) {
    chunks.push(
      publicIds.slice(
        index,
        index + WORKSPACE_CANVAS_IMAGE_METADATA_BATCH_SIZE,
      ),
    );
  }
  return chunks;
};

export const prioritizeWorkspaceCanvasImageMetadata = ({
  publicIds,
  nearPublicIds,
}: {
  publicIds: readonly string[];
  nearPublicIds: readonly string[];
}) => {
  const all = new Set(publicIds);
  const near = [...new Set(nearPublicIds)].filter((publicId) =>
    all.has(publicId),
  );
  const nearSet = new Set(near);
  return [...near, ...publicIds.filter((publicId) => !nearSet.has(publicId))];
};

const intersects = (
  element: Pick<ExcalidrawElement, "height" | "width" | "x" | "y">,
  viewport: { bottom: number; left: number; right: number; top: number },
) => {
  const left = Math.min(element.x, element.x + element.width);
  const right = Math.max(element.x, element.x + element.width);
  const top = Math.min(element.y, element.y + element.height);
  const bottom = Math.max(element.y, element.y + element.height);
  return (
    right >= viewport.left &&
    left <= viewport.right &&
    bottom >= viewport.top &&
    top <= viewport.bottom
  );
};

export const prioritizeWorkspaceCanvasImagePublicIds = ({
  publicIds,
  elements,
  appState,
  includeFar = true,
}: {
  publicIds: readonly string[];
  elements: readonly ExcalidrawElement[];
  appState: Pick<AppState, "height" | "scrollX" | "scrollY" | "width" | "zoom">;
  includeFar?: boolean;
}) => {
  const zoom = appState.zoom.value || 1;
  const viewport = {
    left: -appState.scrollX,
    top: -appState.scrollY,
    right: -appState.scrollX + appState.width / zoom,
    bottom: -appState.scrollY + appState.height / zoom,
  };
  const near = {
    left: viewport.left - (viewport.right - viewport.left),
    right: viewport.right + (viewport.right - viewport.left),
    top: viewport.top - (viewport.bottom - viewport.top),
    bottom: viewport.bottom + (viewport.bottom - viewport.top),
  };
  const order = new Map(publicIds.map((publicId, index) => [publicId, index]));
  const priority = new Map<string, number>();

  for (const element of elements) {
    if (element.type !== "image" || element.isDeleted) continue;
    const publicId = getCanvasResourcePublicId(
      element as unknown as CardCanvasElement,
    );
    if (!publicId || !order.has(publicId)) continue;
    const elementPriority = intersects(element, viewport)
      ? 0
      : intersects(element, near)
        ? 1
        : 2;
    priority.set(
      publicId,
      Math.min(priority.get(publicId) ?? elementPriority, elementPriority),
    );
  }

  return [...publicIds]
    .filter((publicId) => includeFar || (priority.get(publicId) ?? 2) < 2)
    .sort((left, right) => {
      const priorityDifference =
        (priority.get(left) ?? 2) - (priority.get(right) ?? 2);
      return (
        priorityDifference || (order.get(left) ?? 0) - (order.get(right) ?? 0)
      );
    });
};

export const runWorkspaceCanvasImageQueue = async <T>({
  items,
  concurrency = WORKSPACE_CANVAS_IMAGE_LOAD_CONCURRENCY,
  signal,
  worker,
  onSettled,
}: {
  items: readonly T[];
  concurrency?: number;
  signal?: AbortSignal;
  worker: (item: T, signal?: AbortSignal) => Promise<void>;
  onSettled?: (item: T, error?: unknown) => void;
}): Promise<WorkspaceCanvasImageLoadResult<T>> => {
  const completed: T[] = [];
  const failed: { item: T; error: unknown }[] = [];
  let nextIndex = 0;
  const runNext = async () => {
    while (!signal?.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;
      try {
        await worker(item, signal);
        if (signal?.aborted) return;
        completed.push(item);
        onSettled?.(item);
      } catch (error) {
        if (signal?.aborted) return;
        failed.push({ item, error });
        onSettled?.(item, error);
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      runNext,
    ),
  );
  return { completed, failed };
};

export const fitWorkspaceCanvasImageDimensions = (
  width: number,
  height: number,
) => {
  const scale = Math.min(
    1,
    WORKSPACE_CANVAS_IMAGE_DISPLAY_MAX_DIMENSION / Math.max(width, height),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

export const getWorkspaceCanvasExportDecodedImageBytes = (
  resources: readonly WorkspaceCanvasImageResource[],
) =>
  resources.reduce((total, resource) => {
    if (!resource.width || !resource.height) {
      return total + MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_PIXELS * 4;
    }
    return total + resource.width * resource.height * 4;
  }, 0);

export const assertWorkspaceCanvasExportCapacity = (
  resources: readonly WorkspaceCanvasImageResource[],
) => {
  if (
    getWorkspaceCanvasExportDecodedImageBytes(resources) >
    WORKSPACE_CANVAS_EXPORT_DECODED_IMAGE_BYTES
  ) {
    throw new Error("WORKSPACE_CANVAS_EXPORT_MEMORY_LIMIT");
  }
};

const readBlobAsDataUrl = (blob: Blob, signal?: AbortSignal) =>
  new Promise<DataURL>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const reader = new FileReader();
    const abort = () => reader.abort();
    signal?.addEventListener("abort", abort, { once: true });
    reader.addEventListener(
      "load",
      () => {
        signal?.removeEventListener("abort", abort);
        if (typeof reader.result !== "string") {
          reject(new Error("WORKSPACE_CANVAS_IMAGE_READ_FAILED"));
          return;
        }
        resolve(reader.result as DataURL);
      },
      { once: true },
    );
    reader.addEventListener(
      "error",
      () => {
        signal?.removeEventListener("abort", abort);
        reject(new Error("WORKSPACE_CANVAS_IMAGE_READ_FAILED"));
      },
      { once: true },
    );
    reader.addEventListener(
      "abort",
      () => {
        signal?.removeEventListener("abort", abort);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
    reader.readAsDataURL(blob);
  });

const getWorkspaceCanvasImageDimensions = async (
  resource: WorkspaceCanvasImageResource,
  blob: Blob,
) => {
  if (resource.width && resource.height) {
    const dimensions = { width: resource.width, height: resource.height };
    assertSafeCardCanvasImageDimensions(dimensions);
    return dimensions;
  }
  const header = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  const dimensions = parseCardCanvasImageDimensions(blob.type, header);
  if (!dimensions) {
    throw new Error("WORKSPACE_CANVAS_IMAGE_DIMENSIONS_INVALID");
  }
  assertSafeCardCanvasImageDimensions(dimensions);
  return dimensions;
};

export const addWorkspaceCanvasImageBlob = async ({
  api,
  resource,
  blob,
  signal,
}: {
  api: ExcalidrawImperativeAPI;
  resource: WorkspaceCanvasImageResource;
  blob: Blob;
  signal?: AbortSignal;
}) => {
  const dimensions = await getWorkspaceCanvasImageDimensions(resource, blob);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const dataURL = await readBlobAsDataUrl(blob, signal);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const mimeType = blob.type as BinaryFileData["mimeType"];
  api.addFiles([
    {
      id: resource.publicId as BinaryFileData["id"],
      dataURL,
      mimeType,
      created: resource.createdAt.getTime(),
    },
  ]);
  return fitWorkspaceCanvasImageDimensions(dimensions.width, dimensions.height);
};

const fetchWorkspaceCanvasImageBlob = async (
  resource: WorkspaceCanvasImageResource,
  signal?: AbortSignal,
) => {
  if (!resource.viewUrl || resource.size > MAX_CARD_CANVAS_IMAGE_BYTES) {
    throw new Error("WORKSPACE_CANVAS_IMAGE_INVALID");
  }
  const response = await fetch(resource.viewUrl, {
    credentials: "same-origin",
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error("WORKSPACE_CANVAS_IMAGE_LOAD_FAILED");
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_CARD_CANVAS_IMAGE_BYTES
  ) {
    await response.body?.cancel();
    throw new Error("WORKSPACE_CANVAS_IMAGE_TOO_LARGE");
  }
  const blob = await response.blob();
  if (
    !blob.type.startsWith("image/") ||
    blob.type !== resource.contentType ||
    blob.size > MAX_CARD_CANVAS_IMAGE_BYTES ||
    blob.size !== resource.size
  ) {
    throw new Error("WORKSPACE_CANVAS_IMAGE_MISMATCH");
  }
  return blob;
};

export const isWorkspaceCanvasImageMetadataMismatch = (error: unknown) =>
  error instanceof Error && error.message === "WORKSPACE_CANVAS_IMAGE_MISMATCH";

export const loadWorkspaceCanvasImageFile = async ({
  resource,
  signal,
}: {
  resource: WorkspaceCanvasImageResource;
  signal?: AbortSignal;
}): Promise<BinaryFileData> => {
  const blob = await fetchWorkspaceCanvasImageBlob(resource, signal);
  const dataURL = await readBlobAsDataUrl(blob, signal);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return {
    id: resource.publicId as BinaryFileData["id"],
    dataURL,
    mimeType: blob.type as BinaryFileData["mimeType"],
    created: resource.createdAt.getTime(),
  };
};

export const hydrateWorkspaceCanvasImage = async ({
  api,
  resource,
  signal,
}: {
  api: ExcalidrawImperativeAPI;
  resource: WorkspaceCanvasImageResource;
  signal?: AbortSignal;
}) => {
  const existing = api.getFiles()[resource.publicId];
  if (existing) {
    const width =
      resource.width ?? WORKSPACE_CANVAS_IMAGE_DISPLAY_MAX_DIMENSION;
    const height =
      resource.height ?? WORKSPACE_CANVAS_IMAGE_DISPLAY_MAX_DIMENSION;
    return fitWorkspaceCanvasImageDimensions(width, height);
  }
  const blob = await fetchWorkspaceCanvasImageBlob(resource, signal);
  const displayBlob = (await optimizeWorkspaceCanvasDisplayBlob(blob, signal))
    .blob;
  const dimensions = await addWorkspaceCanvasImageBlob({
    api,
    resource,
    blob: displayBlob,
    signal,
  });
  return dimensions;
};

export const hydrateWorkspaceCanvasImageWithMetadataRefresh = async ({
  api,
  resource,
  signal,
  refreshResource,
}: {
  api: ExcalidrawImperativeAPI;
  resource: WorkspaceCanvasImageResource;
  signal?: AbortSignal;
  refreshResource: () => Promise<WorkspaceCanvasImageResource | undefined>;
}) => {
  try {
    const dimensions = await hydrateWorkspaceCanvasImage({
      api,
      resource,
      signal,
    });
    return { dimensions, resource };
  } catch (error) {
    if (!isWorkspaceCanvasImageMetadataMismatch(error)) throw error;
    const refreshed = await refreshResource();
    if (!refreshed || refreshed.publicId !== resource.publicId) throw error;
    const dimensions = await hydrateWorkspaceCanvasImage({
      api,
      resource: refreshed,
      signal,
    });
    return { dimensions, resource: refreshed };
  }
};
