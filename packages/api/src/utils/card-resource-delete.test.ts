import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardResourceRepo from "@kan/db/repository/cardResource.repo";

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

  it("maps a stale canvas CAS to the public conflict code", async () => {
    vi.mocked(cardResourceRepo.softDeleteWithWorkspaceGuard).mockResolvedValue({
      status: "canvas_version_conflict",
      remoteVersion: 4,
    });

    await expect(
      deleteCardResource(db, {
        userId: "user-1",
        resourcePublicId: "resource0001",
        removeReferences: true,
        canvasAction: "remove",
        expectedCanvasVersion: 3,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "CANVAS_VERSION_CONFLICT",
    });
  });

  it("passes the confirmed strategy only after checking card edit permission", async () => {
    vi.mocked(cardResourceRepo.softDeleteWithWorkspaceGuard).mockResolvedValue({
      status: "deleted",
      s3Key: null,
    });

    await deleteCardResource(db, {
      userId: "user-1",
      resourcePublicId: "resource0001",
      removeReferences: true,
      canvasAction: "replace",
      expectedCanvasVersion: 5,
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
        canvasAction: "replace",
        expectedCanvasVersion: 5,
      },
    );
    expect(
      vi.mocked(assertPermission).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(cardResourceRepo.softDeleteWithWorkspaceGuard).mock
        .invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});
