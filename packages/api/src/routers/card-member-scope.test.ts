import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as labelRepo from "@kan/db/repository/label.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/card.repo", () => ({
  create: vi.fn(),
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
  getCardMemberRelationship: vi.fn(),
  createCardMemberRelationship: vi.fn(),
  getCardLabelRelationship: vi.fn(),
  createCardLabelRelationship: vi.fn(),
}));
vi.mock("@kan/db/repository/cardActivity.repo", () => ({}));
vi.mock("@kan/db/repository/cardComment.repo", () => ({}));
vi.mock("@kan/db/repository/checklist.repo", () => ({}));
vi.mock("@kan/db/repository/label.repo", () => ({
  getAllByPublicIdsForBoard: vi.fn(),
  getByPublicIdForBoard: vi.fn(),
}));
vi.mock("@kan/db/repository/list.repo", () => ({
  getWorkspaceAndListIdByListPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/notification.repo", () => ({}));
vi.mock("@kan/db/repository/workspace.repo", () => ({
  getAllMembersByPublicIds: vi.fn(),
  getMemberByPublicId: vi.fn(),
}));
vi.mock("@kan/shared/utils", () => ({
  generateAttachmentUrl: vi.fn(),
  generateAvatarUrl: vi.fn(),
  isInlineAttachmentContentType: vi.fn(),
}));
vi.mock("../utils/activities", () => ({ mergeActivities: vi.fn() }));
vi.mock("../utils/notifications", () => ({ sendMentionEmails: vi.fn() }));
vi.mock("../utils/permissions", () => ({
  assertCanDelete: vi.fn(),
  assertCanEdit: vi.fn(),
  assertPermission: vi.fn(),
}));
vi.mock("../utils/webhook", () => ({
  createCardWebhookPayload: vi.fn(),
  sendWebhooksForWorkspace: vi.fn(() => Promise.resolve()),
}));

describe("card relation scope isolation", () => {
  const db = {} as never;
  const user = { id: "user-123", name: "User", email: "user@example.com" };
  const context = { db, user } as never;
  const list = {
    id: 20,
    boardId: 200,
    publicId: "list-target1",
    workspaceId: 10,
    status: "planned" as const,
  };
  const card = {
    id: 30,
    boardId: list.boardId,
    createdBy: user.id,
    workspaceId: list.workspaceId,
    workspaceVisibility: "private" as const,
    listPublicId: list.publicId,
    listName: "Por hacer",
    boardPublicId: "board-target",
    boardName: "Target",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRepo.getWorkspaceAndListIdByListPublicId).mockResolvedValue(
      list as never,
    );
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue(
      card,
    );
    vi.mocked(labelRepo.getAllByPublicIdsForBoard).mockResolvedValue([]);
    vi.mocked(assertPermission).mockResolvedValue(undefined);
  });

  it("rejects a member that belongs to another workspace before creating the card", async () => {
    vi.mocked(workspaceRepo.getAllMembersByPublicIds).mockResolvedValue([]);
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).create({
        title: "Scoped card",
        description: "",
        listPublicId: list.publicId,
        labelPublicIds: [],
        memberPublicIds: ["memberCross1"],
        position: "end",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(workspaceRepo.getAllMembersByPublicIds).toHaveBeenCalledWith(
      db,
      ["memberCross1"],
      list.workspaceId,
    );
    expect(cardRepo.create).not.toHaveBeenCalled();
  });

  it("rejects the complete request when any requested member is missing", async () => {
    vi.mocked(workspaceRepo.getAllMembersByPublicIds).mockResolvedValue([
      { id: 51 },
    ]);
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).create({
        title: "Scoped card",
        description: "",
        listPublicId: list.publicId,
        labelPublicIds: [],
        memberPublicIds: ["memberValid1", "memberMiss01"],
        position: "end",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(cardRepo.create).not.toHaveBeenCalled();
  });

  it("rejects a label from another board before creating the card", async () => {
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).create({
        title: "Scoped card",
        description: "",
        listPublicId: list.publicId,
        labelPublicIds: ["labelCross01"],
        memberPublicIds: [],
        position: "end",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(labelRepo.getAllByPublicIdsForBoard).toHaveBeenCalledWith(
      db,
      ["labelCross01"],
      list.boardId,
    );
    expect(cardRepo.create).not.toHaveBeenCalled();
  });

  it("rejects the complete request when any requested label is missing", async () => {
    vi.mocked(labelRepo.getAllByPublicIdsForBoard).mockResolvedValue([
      { id: 71 },
    ]);
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).create({
        title: "Scoped card",
        description: "",
        listPublicId: list.publicId,
        labelPublicIds: ["labelValid01", "labelMiss001"],
        memberPublicIds: [],
        position: "end",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(cardRepo.create).not.toHaveBeenCalled();
  });

  it("returns the persisted planning fields after creating a card", async () => {
    const dueDate = new Date("2026-08-21T15:30:00.000Z");
    vi.mocked(workspaceRepo.getAllMembersByPublicIds).mockResolvedValue([]);
    vi.mocked(cardRepo.create).mockResolvedValue({
      id: 31,
      listId: list.id,
      publicId: "cardcreate01",
      cardNumber: 1,
      dueDate,
      priority: "high",
      colourCode: "#ea580c",
      startedAt: null,
      completedAt: null,
    });
    const { cardRouter } = await import("./card");

    const result = await cardRouter.createCaller(context).create({
      title: "Scoped card",
      description: "",
      listPublicId: list.publicId,
      labelPublicIds: [],
      memberPublicIds: [],
      position: "end",
      dueDate,
      priority: "high",
      colourCode: "#ea580c",
    });

    expect(result).toEqual({
      publicId: "cardcreate01",
      dueDate,
      priority: "high",
      colourCode: "#ea580c",
      startedAt: null,
      completedAt: null,
    });
  });

  it("rejects assigning a cross-workspace member to an existing card", async () => {
    vi.mocked(workspaceRepo.getMemberByPublicId).mockResolvedValue(undefined);
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).addOrRemoveMember({
        cardPublicId: "card-target1",
        workspaceMemberPublicId: "memberCross1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(workspaceRepo.getMemberByPublicId).toHaveBeenCalledWith(
      db,
      "memberCross1",
      card.workspaceId,
    );
    expect(cardRepo.createCardMemberRelationship).not.toHaveBeenCalled();
  });

  it("rejects toggling a label from another board", async () => {
    vi.mocked(labelRepo.getByPublicIdForBoard).mockResolvedValue(undefined);
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).addOrRemoveLabel({
        cardPublicId: "card-target1",
        labelPublicId: "labelCross01",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(labelRepo.getByPublicIdForBoard).toHaveBeenCalledWith(
      db,
      "labelCross01",
      card.boardId,
    );
    expect(cardRepo.createCardLabelRelationship).not.toHaveBeenCalled();
  });
});
