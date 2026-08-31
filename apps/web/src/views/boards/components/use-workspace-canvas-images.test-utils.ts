import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { vi } from "vitest";

import type { WorkspaceCanvasImageResource } from "./workspace-canvas-image-loader";

export const workspaceOne = "workspace001";
export const workspaceTwo = "workspace002";

export const createImageResource = (
  publicId: string,
): WorkspaceCanvasImageResource => ({
  kind: "upload",
  publicId,
  title: "goal.webp",
  originalFilename: "goal.png",
  contentType: "image/webp",
  size: 4,
  width: 100,
  height: 80,
  optimizedAt: new Date(0),
  viewUrl: `/api/workspace-canvas-images/${publicId}`,
  downloadUrl: `/api/workspace-canvas-images/${publicId}`,
  createdAt: new Date(0),
});

export const createImageElement = (publicId: string, y: number) =>
  ({
    id: publicId,
    type: "image",
    x: 0,
    y,
    width: 200,
    height: 200,
    isDeleted: false,
    customData: { kanResourcePublicId: publicId },
  }) as unknown as ExcalidrawElement;

export const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

export const createCanvasApi = ({
  elements,
  initialFiles = {},
}: {
  elements: readonly ExcalidrawElement[];
  initialFiles?: BinaryFiles;
}) => {
  const files: BinaryFiles = { ...initialFiles };
  const addFiles = vi.fn((nextFiles: BinaryFileData[]) => {
    for (const file of nextFiles) files[file.id] = file;
  });
  return {
    api: {
      addFiles,
      getFiles: () => files,
      getSceneElements: () => elements,
      getAppState: () =>
        ({
          width: 1_000,
          height: 800,
          scrollX: 0,
          scrollY: 0,
          zoom: { value: 1 },
        }) as AppState,
    } as unknown as ExcalidrawImperativeAPI,
    addFiles,
    files,
  };
};

export const createMetadataResult = (
  images: WorkspaceCanvasImageResource[],
) => ({
  images,
  usageBytes: images.reduce((total, image) => total + image.size, 0),
  quotaBytes: 100 * 1024 * 1024,
});
