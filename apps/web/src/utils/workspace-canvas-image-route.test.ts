import { describe, expect, it, vi } from "vitest";

const { mockWithApiLogging } = vi.hoisted(() => ({
  mockWithApiLogging: vi.fn((handler: unknown) => handler),
}));

vi.mock("@kan/api/utils/apiLogging", () => ({
  withApiLogging: mockWithApiLogging,
}));
vi.mock("@kan/api/utils/rateLimit", () => ({
  withRateLimit: (_options: unknown, handler: unknown) => handler,
}));
vi.mock("~/env", () => ({
  env: { NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME: "attachments" },
}));

describe("workspace canvas image route", () => {
  it("redacts image identifiers and user identity from route logs", async () => {
    vi.resetModules();
    const { workspaceCanvasImageHandler } = await import(
      "../pages/api/workspace-canvas-images/[imagePublicId]"
    );

    expect(mockWithApiLogging).toHaveBeenCalledWith(
      workspaceCanvasImageHandler,
      { sensitive: true },
    );
  });
});
