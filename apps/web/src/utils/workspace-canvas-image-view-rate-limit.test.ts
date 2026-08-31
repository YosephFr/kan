import type { NextApiRequest } from "next";
import { describe, expect, it, vi } from "vitest";

import {
  createWorkspaceCanvasImageViewRateLimitProfileResolver,
  UNAUTHENTICATED_IMAGE_VIEW_RATE_LIMIT_COST,
  WORKSPACE_CANVAS_IMAGE_VIEW_HTTP_RATE_LIMIT_POINTS,
} from "./workspace-canvas-image-view-rate-limit";

const request = () => ({ headers: {} }) as unknown as NextApiRequest;

describe("workspace canvas image view HTTP rate limit", () => {
  it("keeps unauthenticated traffic at 100 requests per minute", () => {
    expect(
      WORKSPACE_CANVAS_IMAGE_VIEW_HTTP_RATE_LIMIT_POINTS /
        UNAUTHENTICATED_IMAGE_VIEW_RATE_LIMIT_COST,
    ).toBe(100);
  });

  it("isolates authenticated viewers even when they share an IP", async () => {
    const firstRequest = request();
    const secondRequest = request();
    const getVerifiedUserId = vi
      .fn()
      .mockResolvedValueOnce("user-1")
      .mockResolvedValueOnce("user-2");
    const resolve = createWorkspaceCanvasImageViewRateLimitProfileResolver({
      getVerifiedUserId,
      getIpIdentifier: () => "203.0.113.4",
    });

    await expect(resolve(firstRequest)).resolves.toEqual({
      identifier: "workspace-canvas-image-view:user-1",
      pointsToConsume: 1,
    });
    await expect(resolve(secondRequest)).resolves.toEqual({
      identifier: "workspace-canvas-image-view:user-2",
      pointsToConsume: 1,
    });
  });

  it("rate limits rejected authentication before the route handler", async () => {
    const resolve = createWorkspaceCanvasImageViewRateLimitProfileResolver({
      getVerifiedUserId: vi
        .fn()
        .mockRejectedValue(new Error("auth unavailable")),
      getIpIdentifier: () => "203.0.113.4",
    });

    await expect(resolve(request())).resolves.toEqual({
      identifier: "workspace-canvas-image-view-unauthenticated:203.0.113.4",
      pointsToConsume: UNAUTHENTICATED_IMAGE_VIEW_RATE_LIMIT_COST,
    });
  });

  it("resolves authentication once for both limiter callbacks", async () => {
    const imageRequest = request();
    const getVerifiedUserId = vi.fn().mockResolvedValue("user-1");
    const resolve = createWorkspaceCanvasImageViewRateLimitProfileResolver({
      getVerifiedUserId,
      getIpIdentifier: () => "203.0.113.4",
    });

    await resolve(imageRequest);
    await resolve(imageRequest);
    expect(getVerifiedUserId).toHaveBeenCalledOnce();
  });
});
