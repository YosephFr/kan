import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_IMAGE_DIMENSION,
  MAX_CARD_CANVAS_IMAGE_PIXELS,
} from "./card-canvas";

export const MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_BYTES =
  MAX_CARD_CANVAS_IMAGE_BYTES;
export const MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_DIMENSION =
  MAX_CARD_CANVAS_IMAGE_DIMENSION;
export const MAX_WORKSPACE_CANVAS_SOURCE_IMAGE_PIXELS =
  MAX_CARD_CANVAS_IMAGE_PIXELS;
export const MAX_WORKSPACE_CANVAS_OPTIMIZED_IMAGE_BYTES = 750 * 1024;
export const MAX_WORKSPACE_CANVAS_OPTIMIZED_IMAGE_DIMENSION = 1280;
export const MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES = 100 * 1024 * 1024;
export const MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES = 64 * 1024;
export const MAX_WORKSPACE_CANVAS_PENDING_UPLOADS = 5;
export const MAX_WORKSPACE_CANVAS_PENDING_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES = 200 * 1024 * 1024;
export const MAX_CARD_VISUAL_WALL_WORKSPACE_PHYSICAL_BYTES =
  1024 * 1024 * 1024;
export const MAX_WORKSPACE_CANVAS_IMAGE_LIST_BATCH = 50;

export const getWorkspaceCanvasImageQuotaBytes = (size: number) =>
  Math.max(size, MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES);

export const hasWorkspaceCanvasActiveCapacity = (
  currentBytes: number,
  imageBytes: number,
) =>
  currentBytes + getWorkspaceCanvasImageQuotaBytes(imageBytes) <=
  MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES;

export const hasWorkspaceCanvasPendingCapacity = (
  usage: { count: number; totalBytes: number },
  sourceBytes: number,
) =>
  usage.count < MAX_WORKSPACE_CANVAS_PENDING_UPLOADS &&
  usage.totalBytes + sourceBytes <= MAX_WORKSPACE_CANVAS_PENDING_UPLOAD_BYTES;

export const hasWorkspaceCanvasPhysicalCapacity = (
  currentBytes: number,
  imageBytes: number,
) =>
  currentBytes + getWorkspaceCanvasImageQuotaBytes(imageBytes) <=
  MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES;
