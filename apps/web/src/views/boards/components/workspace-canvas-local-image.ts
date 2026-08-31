import {
  assertSafeCardCanvasImageDimensions,
  parseCardCanvasImageDimensions,
} from "../../card/components/card-canvas-resources";
import { validateWorkspaceCanvasImageFile } from "./workspace-canvas-paste";

export const WORKSPACE_CANVAS_LOCAL_IMAGE_MAX_DIMENSION = 320;
const IMAGE_HEADER_BYTES = 256 * 1024;
let displayOptimizationQueue = Promise.resolve();

const scheduleDisplayOptimization = <Result>(
  operation: () => Promise<Result>,
) => {
  const result = displayOptimizationQueue.then(operation);
  displayOptimizationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const assertNotAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
};

const getSafeImageDimensions = async (file: File, contentType: string) => {
  const header = new Uint8Array(
    await file.slice(0, IMAGE_HEADER_BYTES).arrayBuffer(),
  );
  const dimensions = parseCardCanvasImageDimensions(contentType, header);
  if (!dimensions) throw new Error("WORKSPACE_CANVAS_IMAGE_DIMENSIONS_INVALID");
  assertSafeCardCanvasImageDimensions(dimensions);
  return dimensions;
};

const getOptimizedDimensions = (width: number, height: number) => {
  const scale = Math.min(
    1,
    WORKSPACE_CANVAS_LOCAL_IMAGE_MAX_DIMENSION / Math.max(width, height),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const loadHtmlImage = (file: Blob) =>
  new Promise<{ image: HTMLImageElement; release: () => void }>(
    (resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      const release = () => URL.revokeObjectURL(objectUrl);
      image.addEventListener("load", () => resolve({ image, release }), {
        once: true,
      });
      image.addEventListener(
        "error",
        () => {
          release();
          reject(new Error("WORKSPACE_CANVAS_IMAGE_DECODE_FAILED"));
        },
        { once: true },
      );
      image.src = objectUrl;
    },
  );

const optimizeWorkspaceCanvasDisplayBlobUnscheduled = async (
  file: Blob,
  signal?: AbortSignal,
) => {
  assertNotAborted(signal);
  let decoded:
    | { image: ImageBitmap; width: number; height: number; release: () => void }
    | {
        image: HTMLImageElement;
        width: number;
        height: number;
        release: () => void;
      };
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    if (signal?.aborted) {
      bitmap.close();
      throw new DOMException("Aborted", "AbortError");
    }
    decoded = {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } else {
    const { image, release } = await loadHtmlImage(file);
    if (signal?.aborted) {
      release();
      throw new DOMException("Aborted", "AbortError");
    }
    decoded = {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release,
    };
  }
  assertSafeCardCanvasImageDimensions({
    width: decoded.width,
    height: decoded.height,
  });
  const target = getOptimizedDimensions(decoded.width, decoded.height);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) {
    decoded.release();
    throw new Error("WORKSPACE_CANVAS_IMAGE_RENDER_FAILED");
  }
  try {
    context.drawImage(decoded.image, 0, 0, target.width, target.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("WORKSPACE_CANVAS_IMAGE_RENDER_FAILED")),
        "image/webp",
        0.8,
      );
    });
    assertNotAborted(signal);
    if (!blob.type.startsWith("image/")) {
      throw new Error("WORKSPACE_CANVAS_IMAGE_RENDER_FAILED");
    }
    return { blob, dimensions: target };
  } finally {
    decoded.release();
  }
};

export const optimizeWorkspaceCanvasDisplayBlob = (
  file: Blob,
  signal?: AbortSignal,
) =>
  scheduleDisplayOptimization(() =>
    optimizeWorkspaceCanvasDisplayBlobUnscheduled(file, signal),
  );

export const prepareWorkspaceCanvasLocalImage = async (
  file: File,
  signal?: AbortSignal,
) => {
  const contentType = validateWorkspaceCanvasImageFile(file);
  const sourceDimensions = await getSafeImageDimensions(file, contentType);
  assertNotAborted(signal);
  const display = await optimizeWorkspaceCanvasDisplayBlob(file, signal);
  return {
    contentType,
    sourceDimensions,
    displayBlob: display.blob,
    displayDimensions: display.dimensions,
  };
};
