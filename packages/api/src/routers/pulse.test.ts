import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as pulseRepo from "@kan/db/repository/pulse.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/pulse.repo", () => ({
  getSourceByWorkspaceId: vi.fn(),
}));

vi.mock("@kan/db/repository/workspace.repo", () => ({
  getByPublicId: vi.fn(),
}));

vi.mock("../utils/permissions", () => ({
  assertPermission: vi.fn(),
}));

const mockGetSource = pulseRepo.getSourceByWorkspaceId as ReturnType<
  typeof vi.fn
>;
const mockGetWorkspace = workspaceRepo.getByPublicId as ReturnType<
  typeof vi.fn
>;
const mockAssertPermission = assertPermission as ReturnType<typeof vi.fn>;

describe("pulse.summary", () => {
  const db = {} as never;
  const user = {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
  };
  const workspace = {
    id: 12,
    publicId: "workspace1234",
    deletedAt: null,
  };
  const source = {
    workspace: {
      publicId: "workspace1234",
      name: "Imanleads",
      weekStartDay: 1,
      cardPrefix: "IMA",
    },
    boards: [],
    lists: [],
    cards: [],
    activities: [],
    members: [],
    assignments: [],
    checklistItems: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertPermission.mockResolvedValue(undefined);
  });

  it("rejects unauthenticated requests", async () => {
    const { pulseRouter } = await import("./pulse");

    await expect(
      pulseRouter.createCaller({ user: null, db } as never).summary({
        workspacePublicId: "workspace1234",
        period: "week",
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("rejects missing workspaces", async () => {
    const { pulseRouter } = await import("./pulse");
    mockGetWorkspace.mockResolvedValueOnce(null);

    await expect(
      pulseRouter.createCaller({ user, db } as never).summary({
        workspacePublicId: "workspace1234",
        period: "month",
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("checks permission and returns the workspace summary", async () => {
    const { pulseRouter } = await import("./pulse");
    mockGetWorkspace.mockResolvedValueOnce(workspace);
    mockGetSource.mockResolvedValueOnce(source);

    const result = await pulseRouter
      .createCaller({ user, db } as never)
      .summary({
        workspacePublicId: "workspace1234",
        period: "week",
      });

    expect(mockAssertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      workspace.id,
      "workspace:view",
    );
    expect(mockGetSource).toHaveBeenCalledWith(db, workspace.id);
    expect(result.workspace).toEqual({
      publicId: "workspace1234",
      name: "Imanleads",
      cardPrefix: "IMA",
    });
    expect(result.kpis.delivered).toBe(0);
  });
});
