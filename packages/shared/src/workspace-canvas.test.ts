import { describe, expect, it } from "vitest";

import {
  MAX_CARD_CANVAS_IMAGE_RESOURCES,
  MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES,
} from "./card-canvas";
import {
  getWorkspaceCanvasImageQuotaBytes,
  hasWorkspaceCanvasActiveCapacity,
  hasWorkspaceCanvasPendingCapacity,
  hasWorkspaceCanvasPhysicalCapacity,
  MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES,
  MAX_WORKSPACE_CANVAS_PENDING_UPLOAD_BYTES,
  MAX_WORKSPACE_CANVAS_PENDING_UPLOADS,
  MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES,
  MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES,
} from "./workspace-canvas";

describe("workspace canvas image budgets", () => {
  it("charges at least 64 KiB without imposing an image count cap", () => {
    expect(getWorkspaceCanvasImageQuotaBytes(1)).toBe(
      MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES,
    );
    expect(getWorkspaceCanvasImageQuotaBytes(128 * 1024)).toBe(128 * 1024);
    expect(251 * getWorkspaceCanvasImageQuotaBytes(1)).toBeLessThan(
      MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES,
    );
  });

  it("keeps staging, active and physical budgets independent", () => {
    expect(MAX_WORKSPACE_CANVAS_PENDING_UPLOADS).toBe(5);
    expect(MAX_WORKSPACE_CANVAS_PENDING_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES).toBe(100 * 1024 * 1024);
    expect(MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES).toBe(200 * 1024 * 1024);
    expect(
      hasWorkspaceCanvasActiveCapacity(
        MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES -
          MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES,
        0,
      ),
    ).toBe(true);
    expect(
      hasWorkspaceCanvasActiveCapacity(
        MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES -
          MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES +
          1,
        0,
      ),
    ).toBe(false);
    expect(
      hasWorkspaceCanvasPendingCapacity(
        { count: 4, totalBytes: 40 * 1024 * 1024 },
        10 * 1024 * 1024,
      ),
    ).toBe(true);
    expect(
      hasWorkspaceCanvasPendingCapacity(
        { count: 5, totalBytes: 40 * 1024 * 1024 },
        1,
      ),
    ).toBe(false);
    expect(
      hasWorkspaceCanvasPhysicalCapacity(
        MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES -
          MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES,
        1,
      ),
    ).toBe(true);
    expect(
      hasWorkspaceCanvasPhysicalCapacity(
        MAX_WORKSPACE_CANVAS_PHYSICAL_IMAGE_BYTES -
          MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES +
          1,
        1,
      ),
    ).toBe(false);
  });

  it("does not change card whiteboard limits", () => {
    expect(MAX_CARD_CANVAS_IMAGE_RESOURCES).toBe(50);
    expect(MAX_CARD_CANVAS_TOTAL_IMAGE_BYTES).toBe(20 * 1024 * 1024);
  });
});
