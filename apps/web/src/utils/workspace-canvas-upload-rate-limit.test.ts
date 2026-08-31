import type { NextApiRequest } from "next";
import { describe, expect, it, vi } from "vitest";

import {
  createWorkspaceCanvasUploadRateLimitProfileResolver,
  isWorkspaceCanvasUploadOnlyRequest,
  ORDINARY_TRPC_RATE_LIMIT_COST,
  WORKSPACE_CANVAS_UPLOAD_HTTP_RATE_LIMIT_POINTS,
} from "./workspace-canvas-upload-rate-limit";

const request = (trpc: string | string[]) =>
  ({ query: { trpc } }) as unknown as NextApiRequest;

describe("workspace canvas upload HTTP rate limit", () => {
  it("keeps ordinary traffic at 100 requests and accepts 502 upload mutations", () => {
    expect(
      WORKSPACE_CANVAS_UPLOAD_HTTP_RATE_LIMIT_POINTS /
        ORDINARY_TRPC_RATE_LIMIT_COST,
    ).toBe(100);
    expect(
      WORKSPACE_CANVAS_UPLOAD_HTTP_RATE_LIMIT_POINTS,
    ).toBeGreaterThanOrEqual(502);
  });

  it("accepts upload-only single and batched procedure paths", () => {
    expect(
      isWorkspaceCanvasUploadOnlyRequest(
        request("workspaceCanvas.createImageUpload"),
      ),
    ).toBe(true);
    expect(
      isWorkspaceCanvasUploadOnlyRequest(
        request(
          "workspaceCanvas.createImageUpload,workspaceCanvas.confirmImageUpload",
        ),
      ),
    ).toBe(true);
    expect(
      isWorkspaceCanvasUploadOnlyRequest({
        method: "POST",
        query: {
          trpc: ["workspaces", "workspace001", "canvas", "images", "confirm"],
        },
      } as unknown as NextApiRequest),
    ).toBe(true);
  });

  it("keeps mixed batches on the ordinary IP budget", async () => {
    const getVerifiedUserId = vi.fn().mockResolvedValue("user-1");
    const resolve = createWorkspaceCanvasUploadRateLimitProfileResolver({
      getVerifiedUserId,
      getIpIdentifier: () => "203.0.113.4",
    });

    await expect(
      resolve(
        request("workspaceCanvas.createImageUpload,workspaceCanvas.save"),
      ),
    ).resolves.toEqual({
      identifier: "ip:203.0.113.4",
      pointsToConsume: 12,
    });
    expect(getVerifiedUserId).not.toHaveBeenCalled();
  });

  it("uses the expanded isolated budget only for a verified user", async () => {
    const validRequest = request("workspaceCanvas.confirmImageUpload");
    const invalidRequest = request("workspaceCanvas.createImageUpload");
    const getVerifiedUserId = vi
      .fn()
      .mockResolvedValueOnce("user-1")
      .mockResolvedValueOnce(undefined);
    const resolve = createWorkspaceCanvasUploadRateLimitProfileResolver({
      getVerifiedUserId,
      getIpIdentifier: () => "203.0.113.4",
    });

    await expect(resolve(validRequest)).resolves.toEqual({
      identifier: "workspace-canvas-upload:user-1",
      pointsToConsume: 1,
    });
    await expect(resolve(invalidRequest)).resolves.toEqual({
      identifier: "ip:203.0.113.4",
      pointsToConsume: 12,
    });
    await resolve(validRequest);
    expect(getVerifiedUserId).toHaveBeenCalledTimes(2);
  });
});
