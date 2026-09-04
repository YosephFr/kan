import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardResourceRepo from "@kan/db/repository/cardResource.repo";
import { WorkspacePermissionChangedError } from "@kan/db/repository/workspace-boundary";

import { deleteCardResource } from "./card-resource-delete";
import { assertPermission } from "./permissions";

vi.mock("@kan/db/repository/cardResource.repo", () => ({
  getContextByPublicId: vi.fn(),
  softDeleteWithWorkspaceGuard: vi.fn(),
}));
vi.mock("./permissions", () => ({ assertPermission: vi.fn() }));

describe("card resource deletion service", () => {
  const db = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cardResourceRepo.getContextByPublicId).mockResolvedValue({
      publicId: "resource0001",
      cardId: 10,
      cardPublicId: "card00000001",
      workspaceId: 20,
      boardVisibility: "private",
      kind: "drive",
    });
    vi.mocked(assertPermission).mockResolvedValue(undefined);
  });

  it("keeps resources referenced by the legacy canvas for recovery", async () => {
    vi.mocked(cardResourceRepo.softDeleteWithWorkspaceGuard).mockResolvedValue({
      status: "in_use",
      referenceCount: 0,
      canvasReferenceCount: 1,
      canvasVersion: 4,
    });

    await expect(
      deleteCardResource(db, {
        userId: "user-1",
        resourcePublicId: "resource0001",
        removeReferences: true,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "RESOURCE_IN_USE_LEGACY_CANVAS",
    });
    expect(cardResourceRepo.softDeleteWithWorkspaceGuard).toHaveBeenCalledWith(
      db,
      {
        resourcePublicId: "resource0001",
        expectedWorkspaceId: 20,
        deletedBy: "user-1",
        removeReferences: true,
      },
    );
  });

  it("deletes an unreferenced resource only after checking card edit permission", async () => {
    vi.mocked(cardResourceRepo.softDeleteWithWorkspaceGuard).mockResolvedValue({
      status: "deleted",
      s3Key: null,
    });

    await deleteCardResource(db, {
      userId: "user-1",
      resourcePublicId: "resource0001",
      removeReferences: true,
    });

    expect(assertPermission).toHaveBeenCalledWith(
      db,
      "user-1",
      20,
      "card:edit",
    );
    expect(cardResourceRepo.softDeleteWithWorkspaceGuard).toHaveBeenCalledWith(
      db,
      {
        resourcePublicId: "resource0001",
        expectedWorkspaceId: 20,
        deletedBy: "user-1",
        removeReferences: true,
      },
    );
    expect(
      vi.mocked(assertPermission).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(cardResourceRepo.softDeleteWithWorkspaceGuard).mock
        .invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("maps permission revocation inside the transaction to forbidden", async () => {
    vi.mocked(cardResourceRepo.softDeleteWithWorkspaceGuard).mockRejectedValue(
      new WorkspacePermissionChangedError(),
    );

    await expect(
      deleteCardResource(db, {
        userId: "user-1",
        resourcePublicId: "resource0001",
        removeReferences: true,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "CARD_RESOURCE_EDIT_FORBIDDEN",
    });
  });
});
