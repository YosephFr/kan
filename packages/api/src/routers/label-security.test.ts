import { beforeEach, describe, expect, it, vi } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as labelRepo from "@kan/db/repository/label.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";

import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/board.repo", () => ({
  getWorkspaceAndBoardIdByBoardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/label.repo", () => ({
  getWorkspaceAndLabelIdByLabelPublicId: vi.fn(),
  getByPublicIdGuarded: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({ assertPermission: vi.fn() }));

describe("label workspace boundary", () => {
  const db = {} as never;
  const user = { id: "user-123", name: "User", email: "user@example.com" };
  const context = { db, user } as never;
  const workspaceId = 10;
  const labelPublicId = "label0000001";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(
      labelRepo.getWorkspaceAndLabelIdByLabelPublicId,
    ).mockResolvedValue({ id: 30, workspaceId });
    vi.mocked(
      boardRepo.getWorkspaceAndBoardIdByBoardPublicId,
    ).mockResolvedValue({ id: 20, workspaceId, createdBy: user.id });
    vi.mocked(assertPermission).mockResolvedValue(undefined);
  });

  it("guards label reads with the workspace authorized by board:view", async () => {
    vi.mocked(labelRepo.getByPublicIdGuarded).mockResolvedValue({
      publicId: labelPublicId,
      name: "Urgente",
      colourCode: "#dc2626",
    });
    const { labelRouter } = await import("./label");

    await expect(
      labelRouter.createCaller(context).byPublicId({ labelPublicId }),
    ).resolves.toEqual({
      publicId: labelPublicId,
      name: "Urgente",
      colourCode: "#dc2626",
    });

    expect(labelRepo.getByPublicIdGuarded).toHaveBeenCalledWith(db, {
      labelPublicId,
      expectedWorkspaceId: workspaceId,
    });
  });

  it("passes the board workspace into label creation", async () => {
    vi.mocked(labelRepo.create).mockResolvedValue({
      id: 30,
      publicId: labelPublicId,
      name: "Urgente",
      colourCode: "#dc2626",
    });
    const { labelRouter } = await import("./label");

    await labelRouter.createCaller(context).create({
      boardPublicId: "board0000001",
      name: "Urgente",
      colourCode: "#dc2626",
    });

    expect(labelRepo.create).toHaveBeenCalledWith(db, {
      boardId: 20,
      expectedWorkspaceId: workspaceId,
      createdBy: user.id,
      name: "Urgente",
      colourCode: "#dc2626",
    });
  });

  it("hides a concurrent workspace move during update", async () => {
    vi.mocked(labelRepo.update).mockRejectedValueOnce(
      new WorkspaceChangedError(),
    );
    const { labelRouter } = await import("./label");

    await expect(
      labelRouter.createCaller(context).update({
        labelPublicId,
        name: "Alta",
        colourCode: "#ea580c",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(labelRepo.update).toHaveBeenCalledWith(db, {
      labelPublicId,
      name: "Alta",
      colourCode: "#ea580c",
      expectedWorkspaceId: workspaceId,
    });
  });

  it("atomically removes label relations inside the guarded delete", async () => {
    vi.mocked(labelRepo.softDelete).mockResolvedValue({ id: 30 });
    const { labelRouter } = await import("./label");

    await expect(
      labelRouter.createCaller(context).delete({ labelPublicId }),
    ).resolves.toEqual({ success: true });

    expect(labelRepo.softDelete).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        labelId: 30,
        expectedWorkspaceId: workspaceId,
        deletedBy: user.id,
      }),
    );
  });
});
