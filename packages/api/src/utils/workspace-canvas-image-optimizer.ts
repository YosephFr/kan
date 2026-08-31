import { createHash } from "node:crypto";
import type { Metadata } from "sharp";
import sharp from "sharp";

import type { dbClient } from "@kan/db/client";
import {
  MAX_WORKSPACE_CANVAS_OPTIMIZED_IMAGE_BYTES,
  MAX_WORKSPACE_CANVAS_OPTIMIZED_IMAGE_DIMENSION,
  MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES,
  MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_DIMENSION,
  MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_PIXELS,
} from "@kan/shared";

import {
  withWorkspaceCanvasImageGlobalOptimizationSlot,
  WorkspaceCanvasImageOptimizationSlotUnavailableError,
} from "./workspace-canvas-image-optimization-slot";

const supportedFormats = new Set(["jpeg", "png", "webp"]);
const expectedFormats = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

const outputAttempts = [
  { dimension: MAX_WORKSPACE_CANVAS_OPTIMIZED_IMAGE_DIMENSION, quality: 80 },
  { dimension: MAX_WORKSPACE_CANVAS_OPTIMIZED_IMAGE_DIMENSION, quality: 72 },
  { dimension: 1152, quality: 72 },
  { dimension: 1024, quality: 68 },
  { dimension: 896, quality: 64 },
  { dimension: 768, quality: 60 },
  { dimension: 640, quality: 55 },
  { dimension: 512, quality: 50 },
] as const;

const WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_CONCURRENCY = 2;
const WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_QUEUE_LIMIT = 4;
const WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_WAIT_TIMEOUT_MS = 10_000;

export class WorkspaceCanvasImageOptimizationError extends Error {
  constructor(
    readonly code:
      | "IMAGE_INVALID"
      | "IMAGE_DIMENSIONS_INVALID"
      | "IMAGE_OPTIMIZATION_FAILED"
      | "IMAGE_OPTIMIZATION_BUSY",
  ) {
    super(code);
    this.name = "WorkspaceCanvasImageOptimizationError";
  }
}

interface QueuedOptimization {
  start: () => void;
  timeout: ReturnType<typeof setTimeout>;
}

export const createWorkspaceCanvasImageOptimizationScheduler = ({
  concurrency,
  queueLimit,
  waitTimeoutMs,
}: {
  concurrency: number;
  queueLimit: number;
  waitTimeoutMs: number;
}) => {
  let active = 0;
  const queue: QueuedOptimization[] = [];

  const startNext = () => {
    while (active < concurrency) {
      const queued = queue.shift();
      if (!queued) return;
      clearTimeout(queued.timeout);
      queued.start();
    }
  };

  const start = <T>(
    operation: () => Promise<T>,
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void,
  ) => {
    active += 1;
    let result: Promise<T>;
    try {
      result = operation();
    } catch (error) {
      result = Promise.reject(
        error instanceof Error
          ? error
          : new WorkspaceCanvasImageOptimizationError(
              "IMAGE_OPTIMIZATION_FAILED",
            ),
      );
    }
    void result.then(resolve, reject).finally(() => {
      active -= 1;
      startNext();
    });
  };

  return <T>(operation: () => Promise<T>): Promise<T> => {
    if (active < concurrency) {
      return new Promise<T>((resolve, reject) => {
        start(operation, resolve, reject);
      });
    }
    if (queue.length >= queueLimit) {
      return Promise.reject(
        new WorkspaceCanvasImageOptimizationError("IMAGE_OPTIMIZATION_BUSY"),
      );
    }
    return new Promise<T>((resolve, reject) => {
      const queued: QueuedOptimization = {
        start: () => start(operation, resolve, reject),
        timeout: setTimeout(() => {
          const index = queue.indexOf(queued);
          if (index === -1) return;
          queue.splice(index, 1);
          reject(
            new WorkspaceCanvasImageOptimizationError(
              "IMAGE_OPTIMIZATION_BUSY",
            ),
          );
        }, waitTimeoutMs),
      };
      queue.push(queued);
    });
  };
};

const scheduleWorkspaceCanvasImageOptimization =
  createWorkspaceCanvasImageOptimizationScheduler({
    concurrency: WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_CONCURRENCY,
    queueLimit: WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_QUEUE_LIMIT,
    waitTimeoutMs: WORKSPACE_CANVAS_IMAGE_OPTIMIZATION_WAIT_TIMEOUT_MS,
  });

export interface OptimizedWorkspaceCanvasImage {
  bytes: Uint8Array;
  contentType: "image/webp";
  size: number;
  sha256: string;
  width: number;
  height: number;
}

const assertInput = async (bytes: Uint8Array, contentType: string) => {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES
  ) {
    throw new WorkspaceCanvasImageOptimizationError("IMAGE_INVALID");
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_PIXELS,
      sequentialRead: true,
    }).metadata();
  } catch {
    throw new WorkspaceCanvasImageOptimizationError("IMAGE_INVALID");
  }
  const expectedFormat =
    expectedFormats[contentType as keyof typeof expectedFormats];
  if (
    !supportedFormats.has(metadata.format) ||
    metadata.format !== expectedFormat ||
    !metadata.width ||
    !metadata.height ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new WorkspaceCanvasImageOptimizationError("IMAGE_INVALID");
  }
  if (
    metadata.width > MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_DIMENSION ||
    metadata.height > MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_DIMENSION ||
    metadata.width * metadata.height > MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_PIXELS
  ) {
    throw new WorkspaceCanvasImageOptimizationError("IMAGE_DIMENSIONS_INVALID");
  }
};

async function optimizeWorkspaceCanvasImageUnscheduled(
  bytes: Uint8Array,
  contentType: string,
): Promise<OptimizedWorkspaceCanvasImage> {
  await assertInput(bytes, contentType);
  for (const attempt of outputAttempts) {
    try {
      const output = await sharp(bytes, {
        failOn: "warning",
        limitInputPixels: MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_PIXELS,
        sequentialRead: true,
      })
        .rotate()
        .resize({
          width: attempt.dimension,
          height: attempt.dimension,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({
          quality: attempt.quality,
          alphaQuality: attempt.quality,
          effort: 4,
          smartSubsample: true,
        })
        .toBuffer({ resolveWithObject: true });
      if (
        output.data.byteLength === 0 ||
        output.data.byteLength > MAX_WORKSPACE_CANVAS_OPTIMIZED_IMAGE_BYTES
      ) {
        continue;
      }
      return {
        bytes: output.data,
        contentType: "image/webp",
        size: output.data.byteLength,
        sha256: createHash("sha256").update(output.data).digest("hex"),
        width: output.info.width,
        height: output.info.height,
      };
    } catch {
      throw new WorkspaceCanvasImageOptimizationError(
        "IMAGE_OPTIMIZATION_FAILED",
      );
    }
  }
  throw new WorkspaceCanvasImageOptimizationError("IMAGE_OPTIMIZATION_FAILED");
}

export function optimizeWorkspaceCanvasImage(
  db: dbClient,
  bytes: Uint8Array,
  contentType: string,
): Promise<OptimizedWorkspaceCanvasImage> {
  return loadAndOptimizeWorkspaceCanvasImage(db, () =>
    Promise.resolve({ bytes, contentType }),
  );
}

export function loadAndOptimizeWorkspaceCanvasImage(
  db: dbClient,
  loadSource: () => Promise<{ bytes: Uint8Array; contentType: string }>,
): Promise<OptimizedWorkspaceCanvasImage> {
  return scheduleWorkspaceCanvasImageOptimization(async () => {
    try {
      return await withWorkspaceCanvasImageGlobalOptimizationSlot(
        db,
        async () => {
          const source = await loadSource();
          return optimizeWorkspaceCanvasImageUnscheduled(
            source.bytes,
            source.contentType,
          );
        },
      );
    } catch (error) {
      if (
        error instanceof WorkspaceCanvasImageOptimizationSlotUnavailableError
      ) {
        throw new WorkspaceCanvasImageOptimizationError(
          "IMAGE_OPTIMIZATION_BUSY",
        );
      }
      throw error;
    }
  });
}
