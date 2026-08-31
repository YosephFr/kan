import { RateLimiterMemory } from "rate-limiter-flexible";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES,
  MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES,
} from "@kan/shared";

import {
  createWorkspaceCanvasImageRateLimitConsumer,
  WORKSPACE_CANVAS_IMAGE_RATE_LIMIT,
  WORKSPACE_CANVAS_IMAGE_UPLOAD_RATE_LIMIT,
  WORKSPACE_CANVAS_IMAGE_VIEW_RATE_LIMIT,
  WorkspaceCanvasImageRateLimitError,
} from "./workspace-canvas-image-rate-limit";

describe("workspace canvas image rate limit", () => {
  it("scopes the key to one user and workspace", async () => {
    const limiter = { consume: vi.fn(() => Promise.resolve()) };
    const consume = createWorkspaceCanvasImageRateLimitConsumer(limiter);

    await consume("user-1", "workspace001");

    expect(limiter.consume).toHaveBeenCalledWith("user-1:workspace001");
  });

  it("rejects the eleventh import without affecting another workspace", async () => {
    const consume = createWorkspaceCanvasImageRateLimitConsumer(
      new RateLimiterMemory({
        points: WORKSPACE_CANVAS_IMAGE_RATE_LIMIT.points,
        duration: WORKSPACE_CANVAS_IMAGE_RATE_LIMIT.durationSeconds,
      }),
    );

    await Promise.all(
      Array.from({ length: 10 }, () => consume("user-1", "workspace001")),
    );
    await expect(consume("user-1", "workspace001")).rejects.toEqual(
      new WorkspaceCanvasImageRateLimitError("LIMIT_EXCEEDED"),
    );
    await expect(consume("user-1", "workspace002")).resolves.toBeUndefined();
  });

  it("fails closed when the limiter is unavailable", async () => {
    const consume = createWorkspaceCanvasImageRateLimitConsumer({
      consume: vi.fn(() => Promise.reject(new Error("unavailable"))),
    });

    await expect(consume("user-1", "workspace001")).rejects.toEqual(
      new WorkspaceCanvasImageRateLimitError("UNAVAILABLE"),
    );
  });

  it("supports every unique image allowed by the active byte budget", () => {
    const maximumActiveImageCount =
      MAX_WORKSPACE_CANVAS_ACTIVE_IMAGE_BYTES /
      MIN_WORKSPACE_CANVAS_IMAGE_QUOTA_BYTES;
    expect(WORKSPACE_CANVAS_IMAGE_VIEW_RATE_LIMIT.points).toBeGreaterThan(
      maximumActiveImageCount,
    );
    expect(WORKSPACE_CANVAS_IMAGE_VIEW_RATE_LIMIT).toEqual({
      points: 2_000,
      durationSeconds: 60,
    });
  });

  it("supports create and confirm calls for a 251-image selection", async () => {
    const consume = createWorkspaceCanvasImageRateLimitConsumer(
      new RateLimiterMemory({
        points: WORKSPACE_CANVAS_IMAGE_UPLOAD_RATE_LIMIT.points,
        duration: WORKSPACE_CANVAS_IMAGE_UPLOAD_RATE_LIMIT.durationSeconds,
      }),
    );

    await expect(
      Promise.all(
        Array.from({ length: 502 }, () => consume("user-1", "workspace001")),
      ),
    ).resolves.toHaveLength(502);
    await Promise.all(
      Array.from({ length: 98 }, () => consume("user-1", "workspace001")),
    );
    await expect(consume("user-1", "workspace001")).rejects.toEqual(
      new WorkspaceCanvasImageRateLimitError("LIMIT_EXCEEDED"),
    );
    await expect(consume("user-1", "workspace002")).resolves.toBeUndefined();
  });
});
