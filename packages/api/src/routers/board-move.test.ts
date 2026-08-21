import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as boardCreateRepo from "@kan/db/repository/boardCreate.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { assertCanEdit, assertPermission } from "../utils/permissions";

// Mock all imports used by board.ts before importing the router
vi.mock("@kan/db/repository/board.repo", () => ({
  getBoardForMove: vi.fn(),
  isBoardSlugAvailable: vi.fn(),
  moveToWorkspace: vi.fn(),
  getIdByPublicId: vi.fn(),
  getByPublicId: vi.fn(),
  createFromSnapshot: vi.fn(),
  getWithListIdsByPublicId: vi.fn(),
  getWithLatestListIndexByPublicId: vi.fn(),
  getWorkspaceAndBoardIdByBoardPublicId: vi.fn(),
  create: vi.fn(),
  isSlugUnique: vi.fn(),
  update: vi.fn(),
  updatePositions: vi.fn(),
  archive: vi.fn(),
  deleteBoard: vi.fn(),
  getAllByWorkspaceId: vi.fn(),
  createFavorite: vi.fn(),
  deleteFavorite: vi.fn(),
  getFavorite: vi.fn(),
}));

vi.mock("@kan/db/repository/boardCreate.repo", () => ({
  createWithSetup: vi.fn(),
}));

vi.mock("@kan/db/repository/workspace.repo", () => ({
  getByPublicId: vi.fn(),
}));

vi.mock("@kan/db/repository/card.repo", () => ({
  getByPublicId: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@kan/db/repository/cardActivity.repo", () => ({
  create: vi.fn(),
}));

vi.mock("@kan/db/repository/label.repo", () => ({
  create: vi.fn(),
  getById: vi.fn(),
  getByPublicId: vi.fn(),
}));

vi.mock("@kan/db/repository/list.repo", () => ({
  create: vi.fn(),
  getByPublicId: vi.fn(),
}));

vi.mock("../utils/permissions", () => ({
  assertCanEdit: vi.fn(),
  assertCanDelete: vi.fn(),
  assertPermission: vi.fn(),
}));

vi.mock("@kan/shared/utils", () => ({
  generateSlug: vi.fn((name: string) =>
    name.toLowerCase().replace(/\s+/g, "-"),
  ),
  generateUID: vi.fn(() => "abc123"),
  generateAvatarUrl: vi.fn(),
  convertDueDateFiltersToRanges: vi.fn(),
}));

vi.mock("@kan/shared/constants", () => ({
  colours: [],
}));

const mockGetBoardForMove = boardRepo.getBoardForMove as ReturnType<
  typeof vi.fn
>;
const mockIsBoardSlugAvailable = boardRepo.isBoardSlugAvailable as ReturnType<
  typeof vi.fn
>;
const mockMoveToWorkspace = boardRepo.moveToWorkspace as ReturnType<
  typeof vi.fn
>;
const mockWorkspaceGetByPublicId = workspaceRepo.getByPublicId as ReturnType<
  typeof vi.fn
>;
const mockGetBoardIdByPublicId = boardRepo.getIdByPublicId as ReturnType<
  typeof vi.fn
>;
const mockCreateFromSnapshot = boardRepo.createFromSnapshot as ReturnType<
  typeof vi.fn
>;
const mockCreateWithSetup = boardCreateRepo.createWithSetup as ReturnType<
  typeof vi.fn
>;
const mockIsSlugUnique = boardRepo.isSlugUnique as ReturnType<typeof vi.fn>;
const mockAssertCanEdit = assertCanEdit as ReturnType<typeof vi.fn>;
const mockAssertPermission = assertPermission as ReturnType<typeof vi.fn>;

describe("board.move", () => {
  const mockDb = {} as never;
  const mockUser = {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
  };
  const mockInput = {
    boardPublicId: "brd-123456789",
    targetWorkspacePublicId: "ws-target-789",
  };
  const mockBoard = {
    id: 1,
    name: "My Board",
    slug: "my-board",
    type: "board" as const,
    isArchived: false,
    workspaceId: 10,
    createdBy: "user-123",
  };
  const mockTargetWorkspace = { id: 20, publicId: "ws-target-789" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertCanEdit.mockResolvedValue(undefined);
    mockAssertPermission.mockResolvedValue(undefined);
  });

  it("throws UNAUTHORIZED when user is not authenticated", async () => {
    const { boardRouter } = await import("./board");
    const ctx = { user: null, db: mockDb } as never;

    await expect(boardRouter.createCaller(ctx).move(mockInput)).rejects.toThrow(
      TRPCError,
    );
  });

  it("throws NOT_FOUND when board does not exist", async () => {
    const { boardRouter } = await import("./board");
    mockGetBoardForMove.mockResolvedValueOnce(null);

    const ctx = { user: mockUser, db: mockDb } as never;

    await expect(boardRouter.createCaller(ctx).move(mockInput)).rejects.toThrow(
      TRPCError,
    );
  });

  it("throws BAD_REQUEST for template boards", async () => {
    const { boardRouter } = await import("./board");
    mockGetBoardForMove.mockResolvedValueOnce({
      ...mockBoard,
      type: "template",
    });

    const ctx = { user: mockUser, db: mockDb } as never;

    await expect(boardRouter.createCaller(ctx).move(mockInput)).rejects.toThrow(
      TRPCError,
    );
  });

  it("throws BAD_REQUEST for archived boards", async () => {
    const { boardRouter } = await import("./board");
    mockGetBoardForMove.mockResolvedValueOnce({
      ...mockBoard,
      isArchived: true,
    });

    const ctx = { user: mockUser, db: mockDb } as never;

    await expect(boardRouter.createCaller(ctx).move(mockInput)).rejects.toThrow(
      TRPCError,
    );
  });

  it("requires board:edit on the source even when the user created the board", async () => {
    const { boardRouter } = await import("./board");
    mockGetBoardForMove.mockResolvedValueOnce(mockBoard);
    mockAssertPermission.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN", message: "No permission" }),
    );

    const ctx = { user: mockUser, db: mockDb } as never;

    await expect(boardRouter.createCaller(ctx).move(mockInput)).rejects.toThrow(
      TRPCError,
    );

    expect(mockAssertPermission).toHaveBeenCalledWith(
      mockDb,
      mockUser.id,
      mockBoard.workspaceId,
      "board:edit",
    );
    expect(mockAssertCanEdit).not.toHaveBeenCalled();
    expect(mockMoveToWorkspace).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when target workspace does not exist", async () => {
    const { boardRouter } = await import("./board");
    mockGetBoardForMove.mockResolvedValueOnce(mockBoard);
    mockWorkspaceGetByPublicId.mockResolvedValueOnce(null);

    const ctx = { user: mockUser, db: mockDb } as never;

    await expect(boardRouter.createCaller(ctx).move(mockInput)).rejects.toThrow(
      TRPCError,
    );
  });

  it("throws NOT_FOUND when target workspace is soft-deleted", async () => {
    const { boardRouter } = await import("./board");
    mockGetBoardForMove.mockResolvedValueOnce(mockBoard);
    mockWorkspaceGetByPublicId.mockResolvedValueOnce({
      ...mockTargetWorkspace,
      deletedAt: new Date(),
    });

    const ctx = { user: mockUser, db: mockDb } as never;

    await expect(boardRouter.createCaller(ctx).move(mockInput)).rejects.toThrow(
      TRPCError,
    );
  });

  it("throws BAD_REQUEST when target is the same workspace", async () => {
    const { boardRouter } = await import("./board");
    mockGetBoardForMove.mockResolvedValueOnce(mockBoard);
    mockWorkspaceGetByPublicId.mockResolvedValueOnce({
      id: mockBoard.workspaceId,
      publicId: "ws-target-789",
    });

    const ctx = { user: mockUser, db: mockDb } as never;

    await expect(boardRouter.createCaller(ctx).move(mockInput)).rejects.toThrow(
      TRPCError,
    );
  });

  it("checks board:create permission on target workspace", async () => {
    const { boardRouter } = await import("./board");
    mockGetBoardForMove.mockResolvedValueOnce(mockBoard);
    mockWorkspaceGetByPublicId.mockResolvedValueOnce(mockTargetWorkspace);
    mockAssertPermission
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "No permission" }),
      );

    const ctx = { user: mockUser, db: mockDb } as never;

    await expect(boardRouter.createCaller(ctx).move(mockInput)).rejects.toThrow(
      TRPCError,
    );

    expect(mockAssertPermission).toHaveBeenNthCalledWith(
      2,
      mockDb,
      mockUser.id,
      mockTargetWorkspace.id,
      "board:create",
    );
  });

  it("appends UID suffix when slug conflicts in target workspace", async () => {
    const { boardRouter } = await import("./board");
    mockGetBoardForMove.mockResolvedValueOnce(mockBoard);
    mockWorkspaceGetByPublicId.mockResolvedValueOnce(mockTargetWorkspace);
    mockIsBoardSlugAvailable.mockResolvedValueOnce(false);
    mockMoveToWorkspace.mockResolvedValueOnce(undefined);

    const ctx = { user: mockUser, db: mockDb } as never;

    await boardRouter.createCaller(ctx).move(mockInput);

    expect(mockMoveToWorkspace).toHaveBeenCalledWith(
      mockDb,
      mockBoard.id,
      mockTargetWorkspace.id,
      "my-board-abc123",
      {
        expectedSourceWorkspaceId: mockBoard.workspaceId,
        movedBy: mockUser.id,
      },
    );
  });

  it("moves board successfully with available slug", async () => {
    const { boardRouter } = await import("./board");
    mockGetBoardForMove.mockResolvedValueOnce(mockBoard);
    mockWorkspaceGetByPublicId.mockResolvedValueOnce(mockTargetWorkspace);
    mockIsBoardSlugAvailable.mockResolvedValueOnce(true);
    mockMoveToWorkspace.mockResolvedValueOnce(undefined);

    const ctx = { user: mockUser, db: mockDb } as never;

    const result = await boardRouter.createCaller(ctx).move(mockInput);

    expect(result).toEqual({ success: true });
    expect(mockMoveToWorkspace).toHaveBeenCalledWith(
      mockDb,
      mockBoard.id,
      mockTargetWorkspace.id,
      "my-board",
      {
        expectedSourceWorkspaceId: mockBoard.workspaceId,
        movedBy: mockUser.id,
      },
    );
  });

  it("returns NOT_FOUND when source membership changes during the move", async () => {
    const { boardRouter } = await import("./board");
    mockGetBoardForMove.mockResolvedValueOnce(mockBoard);
    mockWorkspaceGetByPublicId.mockResolvedValueOnce(mockTargetWorkspace);
    mockIsBoardSlugAvailable.mockResolvedValueOnce(true);
    mockMoveToWorkspace.mockRejectedValueOnce(new WorkspaceChangedError());

    const ctx = { user: mockUser, db: mockDb } as never;

    await expect(
      boardRouter.createCaller(ctx).move(mockInput),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("board.create clone authorization", () => {
  const mockDb = {} as never;
  const mockUser = {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
  };
  const context = { user: mockUser, db: mockDb } as never;
  const workspace = {
    id: 10,
    publicId: "workspace001",
    deletedAt: null,
  };
  const input = {
    name: "Cloned board",
    workspacePublicId: workspace.publicId,
    lists: [],
    labels: [],
    sourceBoardPublicId: "board-source",
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceGetByPublicId.mockResolvedValue(workspace);
    mockGetBoardIdByPublicId.mockResolvedValue({
      id: 1,
      type: "regular",
      isArchived: false,
      workspaceId: workspace.id,
    });
    mockIsSlugUnique.mockResolvedValue(true);
    mockCreateFromSnapshot.mockResolvedValue({
      publicId: "board-cloned",
      name: input.name,
    });
    mockAssertPermission.mockResolvedValue(undefined);
  });

  it("requires board:view before starting the atomic clone", async () => {
    mockAssertPermission
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "No permission" }),
      );
    const { boardRouter } = await import("./board");

    await expect(
      boardRouter.createCaller(context).create(input),
    ).rejects.toThrow(TRPCError);

    expect(mockAssertPermission).toHaveBeenNthCalledWith(
      1,
      mockDb,
      mockUser.id,
      workspace.id,
      "board:create",
    );
    expect(mockAssertPermission).toHaveBeenNthCalledWith(
      2,
      mockDb,
      mockUser.id,
      workspace.id,
      "board:view",
    );
    expect(mockCreateFromSnapshot).not.toHaveBeenCalled();
  });

  it("keeps cloning available with board:create and board:view", async () => {
    const { boardRouter } = await import("./board");

    const result = await boardRouter.createCaller(context).create(input);

    expect(result).toEqual({ publicId: "board-cloned", name: input.name });
    expect(mockCreateFromSnapshot).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        workspaceId: workspace.id,
        expectedSourceWorkspaceId: workspace.id,
        createdBy: mockUser.id,
        sourceBoardId: 1,
      }),
    );
  });

  it("returns NOT_FOUND when the source board moves during cloning", async () => {
    mockCreateFromSnapshot.mockRejectedValueOnce(new WorkspaceChangedError());
    const { boardRouter } = await import("./board");

    await expect(
      boardRouter.createCaller(context).create(input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("board.create atomic setup", () => {
  const mockDb = {} as never;
  const mockUser = {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
  };
  const workspace = { id: 10, publicId: "workspace001" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceGetByPublicId.mockResolvedValue(workspace);
    mockAssertPermission.mockResolvedValue(undefined);
    mockIsSlugUnique.mockResolvedValue(true);
    mockCreateWithSetup.mockResolvedValue({
      id: 1,
      publicId: "board-created",
      name: "Roadmap",
    });
  });

  it("creates the board, lists and labels through one repository command", async () => {
    const { boardRouter } = await import("./board");

    await boardRouter
      .createCaller({ db: mockDb, user: mockUser } as never)
      .create({
        workspacePublicId: workspace.publicId,
        name: "Roadmap",
        lists: ["Por hacer", "Hecho"],
        labels: ["Alta"],
      });

    expect(mockCreateWithSetup).toHaveBeenCalledWith(mockDb, {
      publicId: "abc123",
      slug: "roadmap",
      name: "Roadmap",
      createdBy: mockUser.id,
      workspaceId: workspace.id,
      type: undefined,
      lists: [{ name: "Por hacer" }, { name: "Hecho" }],
      labels: [{ name: "Alta", colourCode: "#0d9488" }],
    });
  });

  it("hides a workspace deletion during setup as not found", async () => {
    mockCreateWithSetup.mockRejectedValueOnce(new WorkspaceChangedError());
    const { boardRouter } = await import("./board");

    await expect(
      boardRouter.createCaller({ db: mockDb, user: mockUser } as never).create({
        workspacePublicId: workspace.publicId,
        name: "Roadmap",
        lists: [],
        labels: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
