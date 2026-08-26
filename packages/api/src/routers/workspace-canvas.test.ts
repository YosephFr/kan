import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as WorkspaceCanvasRepository from "@kan/db/repository/workspaceCanvas.repo";
import { WorkspacePermissionChangedError } from "@kan/db/repository/workspace-boundary";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import * as workspaceCanvasRepo from "@kan/db/repository/workspaceCanvas.repo";

import { assertPermission, hasPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/workspace.repo", () => ({
  getByPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/workspaceCanvas.repo", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceCanvasRepository>();
  return {
    ...actual,
    getSnapshot: vi.fn(),
    save: vi.fn(),
    listRevisions: vi.fn(),
    restore: vi.fn(),
  };
});
vi.mock("../utils/permissions", () => ({
  assertPermission: vi.fn(),
  hasPermission: vi.fn(),
}));

const db = {} as never;
const user = {
  id: "3b0f4baf-aac9-4c7a-aef2-36e03d764e63",
  name: "Admin",
  email: "admin@example.com",
};
const workspacePublicId = "workspace001";
const workspace = {
  id: 20,
  publicId: workspacePublicId,
  name: "Empresa",
  slug: "empresa",
  logo: null,
  plan: "free",
  createdBy: user.id,
  deletedAt: null,
};

describe("workspace canvas router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceRepo.getByPublicId).mockResolvedValue(
      workspace as never,
    );
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(hasPermission).mockResolvedValue(false);
    vi.mocked(workspaceCanvasRepo.getSnapshot).mockResolvedValue(null);
    vi.mocked(workspaceCanvasRepo.listRevisions).mockResolvedValue([]);
    vi.mocked(workspaceCanvasRepo.save).mockResolvedValue({
      status: "saved",
      version: 1,
      hash: "a".repeat(64),
      bytes: 28,
      elementCount: 0,
      canvasId: 1,
      reclaimedS3Keys: [],
    });
  });

  it("reads without initializing and exposes effective read-only mode", async () => {
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter
        .createCaller({ db, user } as never)
        .get({ workspacePublicId }),
    ).resolves.toEqual({
      exists: false,
      version: 0,
      scene: null,
      hash: null,
      bytes: 0,
      elementCount: 0,
      updatedAt: null,
      viewModeEnabled: true,
    });
    expect(assertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      workspace.id,
      "workspace:view",
    );
    expect(workspaceCanvasRepo.save).not.toHaveBeenCalled();
  });

  it("passes the resolved workspace boundary to CAS save", async () => {
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await workspaceCanvasRouter.createCaller({ db, user } as never).save({
      workspacePublicId,
      expectedVersion: 0,
      scene: { elements: [], appState: {} },
    });
    expect(assertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      workspace.id,
      "workspace:edit",
    );
    expect(workspaceCanvasRepo.save).toHaveBeenCalledWith(db, {
      workspacePublicId,
      expectedWorkspaceId: workspace.id,
      expectedVersion: 0,
      scene: { elements: [], appState: {} },
      actorId: user.id,
    });
  });

  it("rejects a permission revoked inside the save transaction", async () => {
    vi.mocked(workspaceCanvasRepo.save).mockRejectedValueOnce(
      new WorkspacePermissionChangedError(),
    );
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter.createCaller({ db, user } as never).save({
        workspacePublicId,
        expectedVersion: 0,
        scene: { elements: [], appState: {} },
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "WORKSPACE_CANVAS_EDIT_FORBIDDEN",
    });
  });

  it("rejects view permission revoked inside the read transaction", async () => {
    vi.mocked(workspaceCanvasRepo.getSnapshot).mockRejectedValueOnce(
      new WorkspacePermissionChangedError(),
    );
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter
        .createCaller({ db, user } as never)
        .get({ workspacePublicId }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "WORKSPACE_CANVAS_EDIT_FORBIDDEN",
    });
  });

  it("does not expose a deleted workspace", async () => {
    vi.mocked(workspaceRepo.getByPublicId).mockResolvedValueOnce({
      ...workspace,
      deletedAt: new Date(),
    } as never);
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter
        .createCaller({ db, user } as never)
        .get({ workspacePublicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(workspaceCanvasRepo.getSnapshot).not.toHaveBeenCalled();
  });
});
