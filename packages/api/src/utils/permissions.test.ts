import { beforeEach, describe, expect, it, vi } from "vitest";

import * as permissionRepo from "@kan/db/repository/permission.repo";

import { assertCanDelete, assertCanEdit } from "./permissions";

vi.mock("@kan/db/repository/member.repo", () => ({}));
vi.mock("@kan/db/repository/permission.repo", () => ({
  getMemberPermissionOverride: vi.fn(),
  getMemberWithRole: vi.fn(),
}));

describe("creator permission fallback", () => {
  const db = {} as never;
  const userId = "user-123";
  const workspaceId = 10;
  const activeGuest = {
    id: 20,
    publicId: "member000001",
    role: "guest",
    roleId: null,
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(permissionRepo.getMemberPermissionOverride).mockResolvedValue(
      undefined,
    );
  });

  it.each([
    ["edit", assertCanEdit, "board:edit" as const],
    ["delete", assertCanDelete, "board:delete" as const],
  ])(
    "keeps %s access for an active creator",
    async (_, assertAccess, permission) => {
      vi.mocked(permissionRepo.getMemberWithRole).mockResolvedValue(
        activeGuest,
      );

      await expect(
        assertAccess(db, userId, workspaceId, permission, userId),
      ).resolves.toBeUndefined();
    },
  );

  it.each([
    ["edit", assertCanEdit, "board:edit" as const],
    ["delete", assertCanDelete, "board:delete" as const],
  ])(
    "denies %s fallback when the creator has no active membership",
    async (_, assertAccess, permission) => {
      vi.mocked(permissionRepo.getMemberWithRole).mockResolvedValue(undefined);

      await expect(
        assertAccess(db, userId, workspaceId, permission, userId),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );
});
