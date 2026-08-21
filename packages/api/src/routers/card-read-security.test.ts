import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as cardReadRepo from "@kan/db/repository/cardRead.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";

import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/cardRead.repo", () => ({
  getDetailSnapshot: vi.fn(),
}));
vi.mock("@kan/db/repository/cardActivity.repo", () => ({
  getPaginatedActivitiesGuarded: vi.fn(),
}));
vi.mock("@kan/db/repository/cardAssociations.repo", () => ({}));
vi.mock("@kan/db/repository/cardComment.repo", () => ({}));
vi.mock("@kan/db/repository/cardDuplicate.repo", () => ({}));
vi.mock("@kan/db/repository/label.repo", () => ({}));
vi.mock("@kan/db/repository/list.repo", () => ({}));
vi.mock("@kan/db/repository/notification.repo", () => ({}));
vi.mock("@kan/db/repository/workspace.repo", () => ({}));
vi.mock("../utils/activities", () => ({ mergeActivities: vi.fn() }));
vi.mock("../utils/notifications", () => ({ sendMentionEmails: vi.fn() }));
vi.mock("../utils/permissions", () => ({
  assertCanDelete: vi.fn(),
  assertCanEdit: vi.fn(),
  assertPermission: vi.fn(),
}));
vi.mock("../utils/webhook", () => ({
  createCardWebhookPayload: vi.fn(),
  sendWebhooksForWorkspace: vi.fn(),
}));

describe("card read snapshot authorization", () => {
  const db = {} as never;
  const user = { id: "user-123", name: "User", email: "user@example.com" };
  const cardPublicId = "card00000001";
  const card = {
    id: 30,
    workspaceId: 10,
    workspaceVisibility: "private" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue(
      card as never,
    );
    vi.mocked(assertPermission).mockResolvedValue(undefined);
  });

  it("revalidates a private card detail read in the authorized workspace", async () => {
    vi.mocked(cardReadRepo.getDetailSnapshot).mockRejectedValueOnce(
      new WorkspaceChangedError(),
    );
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller({ db, user } as never).byId({ cardPublicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(assertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      card.workspaceId,
      "card:view",
    );
    expect(cardReadRepo.getDetailSnapshot).toHaveBeenCalledWith(db, {
      cardPublicId,
      expectedWorkspaceId: card.workspaceId,
      requirePublic: false,
    });
  });

  it("keeps a public grant conditional on visibility until detail loading ends", async () => {
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue({
      ...card,
      workspaceVisibility: "public",
    } as never);
    vi.mocked(cardReadRepo.getDetailSnapshot).mockRejectedValueOnce(
      new WorkspaceChangedError(),
    );
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter
        .createCaller({ db, user: null } as never)
        .byId({ cardPublicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(assertPermission).not.toHaveBeenCalled();
    expect(cardReadRepo.getDetailSnapshot).toHaveBeenCalledWith(db, {
      cardPublicId,
      expectedWorkspaceId: card.workspaceId,
      requirePublic: true,
    });
  });

  it("guards the activity feed with the same public visibility basis", async () => {
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue({
      ...card,
      workspaceVisibility: "public",
    } as never);
    vi.mocked(
      cardActivityRepo.getPaginatedActivitiesGuarded,
    ).mockRejectedValueOnce(new WorkspaceChangedError());
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter
        .createCaller({ db, user: null } as never)
        .getActivities({ cardPublicId, limit: 25 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(cardActivityRepo.getPaginatedActivitiesGuarded).toHaveBeenCalledWith(
      db,
      {
        cardId: card.id,
        expectedWorkspaceId: card.workspaceId,
        requirePublic: true,
        limit: 25,
        cursor: undefined,
      },
    );
  });
});
