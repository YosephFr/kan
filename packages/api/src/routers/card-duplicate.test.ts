import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as listRepo from "@kan/db/repository/list.repo";

import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
  getWithListAndMembersByPublicId: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@kan/db/repository/cardActivity.repo", () => ({}));
vi.mock("@kan/db/repository/cardComment.repo", () => ({}));
vi.mock("@kan/db/repository/checklist.repo", () => ({}));
vi.mock("@kan/db/repository/label.repo", () => ({}));
vi.mock("@kan/db/repository/list.repo", () => ({
  getWorkspaceAndListIdByListPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/notification.repo", () => ({}));
vi.mock("@kan/db/repository/workspace.repo", () => ({}));
vi.mock("../utils/permissions", () => ({
  assertCanDelete: vi.fn(),
  assertCanEdit: vi.fn(),
  assertPermission: vi.fn(),
}));
vi.mock("../utils/notifications", () => ({ sendMentionEmails: vi.fn() }));
vi.mock("../utils/activities", () => ({ mergeActivities: vi.fn() }));

describe("card.duplicate planning fields", () => {
  const db = {} as never;
  const user = { id: "user-123", name: "User", email: "u@example.com" };
  const context = { db, user } as never;
  const sourceCard = {
    id: 1,
    publicId: "card-source1",
    title: "Source",
    description: "Description",
    dueDate: new Date("2026-08-25T15:00:00.000Z"),
    priority: "high" as const,
    colourCode: "#ea580c",
    startedAt: new Date("2026-08-20T10:00:00.000Z"),
    completedAt: null,
    labels: [],
    members: [],
    checklists: [],
  };
  const targetList = {
    id: 20,
    publicId: "list-target1",
    name: "En progreso",
    status: "inProgress" as const,
    colourCode: null,
    workspaceId: 10,
    boardPublicId: "board-target",
    boardName: "Target",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue({
      id: sourceCard.id,
      createdBy: user.id,
      workspaceId: targetList.workspaceId,
    } as never);
    vi.mocked(cardRepo.getWithListAndMembersByPublicId).mockResolvedValue(
      sourceCard as never,
    );
    vi.mocked(listRepo.getWorkspaceAndListIdByListPublicId).mockResolvedValue(
      targetList as never,
    );
    vi.mocked(cardRepo.create).mockResolvedValue({
      id: 2,
      publicId: "card-copy001",
    } as never);
    vi.mocked(assertPermission).mockResolvedValue(undefined);
  });

  it("preserves styling and due date but resets execution", async () => {
    const { cardRouter } = await import("./card");

    await cardRouter.createCaller(context).duplicate({
      cardPublicId: sourceCard.publicId,
      listPublicId: targetList.publicId,
      copyLabels: false,
      copyMembers: false,
      copyChecklists: false,
    });

    expect(cardRepo.create).toHaveBeenCalledWith(db, {
      title: sourceCard.title,
      description: sourceCard.description,
      createdBy: user.id,
      listId: targetList.id,
      workspaceId: targetList.workspaceId,
      position: "end",
      dueDate: sourceCard.dueDate,
      priority: sourceCard.priority,
      colourCode: sourceCard.colourCode,
      initializeLifecycle: false,
    });
  });
});
