import { beforeEach, describe, expect, it, vi } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as boardReadRepo from "@kan/db/repository/boardRead.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/board.repo", () => ({
  getWorkspaceAndBoardIdByBoardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/boardRead.repo", () => ({
  getByPublicIdGuarded: vi.fn(),
  getBySlugGuarded: vi.fn(),
}));
vi.mock("@kan/db/repository/label.repo", () => ({}));
vi.mock("@kan/db/repository/list.repo", () => ({}));
vi.mock("@kan/db/repository/workspace.repo", () => ({
  getBySlugWithBoards: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({
  assertCanDelete: vi.fn(),
  assertCanEdit: vi.fn(),
  assertPermission: vi.fn(),
}));

describe("board read snapshot authorization", () => {
  const db = {} as never;
  const user = { id: "user-123", name: "User", email: "user@example.com" };
  const workspaceId = 10;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(
      boardRepo.getWorkspaceAndBoardIdByBoardPublicId,
    ).mockResolvedValue({ id: 20, workspaceId, createdBy: user.id });
    vi.mocked(workspaceRepo.getBySlugWithBoards).mockResolvedValue({
      id: workspaceId,
    } as never);
    vi.mocked(assertPermission).mockResolvedValue(undefined);
  });

  it("keeps a protected board read in the workspace authorized by board:view", async () => {
    vi.mocked(boardReadRepo.getByPublicIdGuarded).mockRejectedValueOnce(
      new WorkspaceChangedError(),
    );
    const { boardRouter } = await import("./board");

    await expect(
      boardRouter.createCaller({ db, user } as never).byId({
        boardPublicId: "board0000001",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(assertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      workspaceId,
      "board:view",
    );
    expect(boardReadRepo.getByPublicIdGuarded).toHaveBeenCalledWith(db, {
      boardPublicId: "board0000001",
      userId: user.id,
      expectedWorkspaceId: workspaceId,
      requirePublic: false,
      filters: {
        members: [],
        labels: [],
        lists: [],
        dueDate: [],
        priorities: [],
        type: undefined,
      },
    });
  });

  it("rechecks public visibility while loading a board by slug", async () => {
    vi.mocked(boardReadRepo.getBySlugGuarded).mockRejectedValueOnce(
      new WorkspaceChangedError(),
    );
    const { boardRouter } = await import("./board");

    await expect(
      boardRouter.createCaller({ db, user: null } as never).bySlug({
        workspaceSlug: "workspace",
        boardSlug: "public-board",
      }),
    ).resolves.toBeNull();

    expect(boardReadRepo.getBySlugGuarded).toHaveBeenCalledWith(db, {
      boardSlug: "public-board",
      expectedWorkspaceId: workspaceId,
      filters: {
        members: [],
        labels: [],
        lists: [],
        dueDate: [],
        priorities: [],
      },
    });
  });
});
