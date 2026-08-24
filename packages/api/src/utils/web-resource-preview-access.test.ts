import type { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardResourceRepo from "@kan/db/repository/cardResource.repo";

import { assertPermission } from "./permissions";
import { getWebResourcePreviewForView } from "./web-resource-preview-access";

vi.mock("@kan/db/repository/cardResource.repo", () => ({
  getWebPreviewContextByPublicId: vi.fn(),
}));
vi.mock("./permissions", () => ({ assertPermission: vi.fn() }));

describe("web resource preview access", () => {
  const db = {} as never;
  const resource = {
    publicId: "webresource1",
    workspaceId: 20,
    boardVisibility: "private",
    imageUrl: "https://cdn.example.com/private-preview.png",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(
      cardResourceRepo.getWebPreviewContextByPublicId,
    ).mockResolvedValue(resource as never);
    vi.mocked(assertPermission).mockResolvedValue(undefined);
  });

  it("allows an anonymous visitor only for a public board", async () => {
    vi.mocked(
      cardResourceRepo.getWebPreviewContextByPublicId,
    ).mockResolvedValue({
      ...resource,
      boardVisibility: "public",
    } as never);

    await expect(
      getWebResourcePreviewForView(db, resource.publicId),
    ).resolves.toMatchObject({ publicId: resource.publicId });
    expect(assertPermission).not.toHaveBeenCalled();
  });

  it("requires card:view for private and read-only access", async () => {
    await expect(
      getWebResourcePreviewForView(db, resource.publicId, "read-only-user"),
    ).resolves.toMatchObject({ publicId: resource.publicId });
    expect(assertPermission).toHaveBeenCalledWith(
      db,
      "read-only-user",
      resource.workspaceId,
      "card:view",
    );

    await expect(
      getWebResourcePreviewForView(db, resource.publicId),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns an opaque not-found error for missing or inactive previews", async () => {
    vi.mocked(
      cardResourceRepo.getWebPreviewContextByPublicId,
    ).mockResolvedValue(null);

    await expect(
      getWebResourcePreviewForView(db, resource.publicId, "user-1"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<TRPCError>>({
        code: "NOT_FOUND",
        message: "Preview not found",
      }),
    );
    expect(assertPermission).not.toHaveBeenCalled();
  });
});
