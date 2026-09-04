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

  it("blocks legacy saves before inspecting the scene or calling repositories", async () => {
    const inspectScene = vi.fn();
    const scene = {};
    Object.defineProperty(scene, "elements", {
      enumerable: false,
      get: inspectScene,
    });
    const { workspaceCanvasRouter } = await import("./workspace-canvas");

    await expect(
      workspaceCanvasRouter.createCaller({ db, user } as never).save({
        workspacePublicId,
        expectedVersion: 0,
        scene,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "CANVAS_LEGACY_READ_ONLY",
    });
    expect(inspectScene).not.toHaveBeenCalled();
    expect(workspaceRepo.getByPublicId).not.toHaveBeenCalled();
    expect(assertPermission).not.toHaveBeenCalled();
    expect(workspaceCanvasRepo.save).not.toHaveBeenCalled();
  });

  it("blocks legacy restores before calling repositories", async () => {
    const { workspaceCanvasRouter } = await import("./workspace-canvas");

    await expect(
      workspaceCanvasRouter.createCaller({ db, user } as never).restore({
        workspacePublicId,
        revisionPublicId: "revision0001",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "CANVAS_LEGACY_READ_ONLY",
    });
    expect(workspaceRepo.getByPublicId).not.toHaveBeenCalled();
    expect(assertPermission).not.toHaveBeenCalled();
    expect(workspaceCanvasRepo.restore).not.toHaveBeenCalled();
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
