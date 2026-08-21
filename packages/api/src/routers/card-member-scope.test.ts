import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardAssociationsRepo from "@kan/db/repository/cardAssociations.repo";
import * as labelRepo from "@kan/db/repository/label.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as notificationRepo from "@kan/db/repository/notification.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { assertPermission } from "../utils/permissions";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@kan/db/repository/card.repo", () => ({
  create: vi.fn(),
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/cardAssociations.repo", () => ({
  toggleCardLabel: vi.fn(),
  toggleCardMember: vi.fn(),
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
vi.mock("@kan/db/repository/notification.repo", () => ({
  createUrgentAlertForAssignedMember: vi.fn(),
  createUrgentAlertsForAssignees: vi.fn(),
}));
vi.mock("@kan/logger", () => ({ createLogger: vi.fn(() => mockLogger) }));
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

  it("keeps a created urgent card successful when its alert fails", async () => {
    const alertError = new Error("notification unavailable");
    vi.mocked(workspaceRepo.getAllMembersByPublicIds).mockResolvedValue([]);
    vi.mocked(cardRepo.create).mockResolvedValue({
      id: 31,
      listId: list.id,
      publicId: "cardcreate01",
      cardNumber: 1,
      dueDate: null,
      priority: "urgent",
      colourCode: null,
      startedAt: null,
      completedAt: null,
    });
    vi.mocked(
      notificationRepo.createUrgentAlertsForAssignees,
    ).mockRejectedValueOnce(alertError);
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).create({
        title: "Urgent card",
        description: "",
        listPublicId: list.publicId,
        labelPublicIds: [],
        memberPublicIds: [],
        position: "end",
        priority: "urgent",
      }),
    ).resolves.toMatchObject({
      publicId: "cardcreate01",
      priority: "urgent",
    });

    expect(mockLogger.error).toHaveBeenCalledWith(
      {
        error: alertError,
        cardPublicId: "cardcreate01",
        trigger: "create",
      },
      "Urgent card alert delivery failed",
    );
  });

  it("persists labels and members inside the guarded card create command", async () => {
    vi.mocked(labelRepo.getAllByPublicIdsForBoard).mockResolvedValue([
      { id: 71 },
    ]);
    vi.mocked(workspaceRepo.getAllMembersByPublicIds).mockResolvedValue([
      { id: 51 },
    ]);
    vi.mocked(cardRepo.create).mockResolvedValue({
      id: 31,
      listId: list.id,
      publicId: "cardcreate01",
      cardNumber: 1,
      dueDate: null,
      priority: "none",
      colourCode: null,
      startedAt: null,
      completedAt: null,
    });
    const { cardRouter } = await import("./card");

    await cardRouter.createCaller(context).create({
      title: "Scoped card",
      description: "",
      listPublicId: list.publicId,
      labelPublicIds: ["labelValid01"],
      memberPublicIds: ["memberValid1"],
      position: "end",
    });

    expect(cardRepo.create).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        workspaceId: list.workspaceId,
        labelIds: [71],
        workspaceMemberIds: [51],
      }),
    );
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
    expect(cardAssociationsRepo.toggleCardMember).not.toHaveBeenCalled();
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
    expect(cardAssociationsRepo.toggleCardLabel).not.toHaveBeenCalled();
  });

  it("passes the authorized workspace into atomic relation toggles", async () => {
    vi.mocked(labelRepo.getByPublicIdForBoard).mockResolvedValue({
      id: 71,
    } as never);
    vi.mocked(cardAssociationsRepo.toggleCardLabel).mockResolvedValue({
      newLabel: true,
    });
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).addOrRemoveLabel({
        cardPublicId: "card-target1",
        labelPublicId: "labelValid01",
      }),
    ).resolves.toEqual({ newLabel: true });

    expect(cardAssociationsRepo.toggleCardLabel).toHaveBeenCalledWith(db, {
      cardId: card.id,
      labelId: 71,
      expectedWorkspaceId: card.workspaceId,
      updatedBy: user.id,
    });
  });

  it("hides a workspace move during an association toggle", async () => {
    vi.mocked(workspaceRepo.getMemberByPublicId).mockResolvedValue({
      id: 81,
    } as never);
    vi.mocked(cardAssociationsRepo.toggleCardMember).mockRejectedValue(
      new WorkspaceChangedError(),
    );
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).addOrRemoveMember({
        cardPublicId: "card-target1",
        workspaceMemberPublicId: "memberValid1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps an assignment successful when its urgent alert fails", async () => {
    const alertError = new Error("notification unavailable");
    vi.mocked(workspaceRepo.getMemberByPublicId).mockResolvedValue({
      id: 81,
    } as never);
    vi.mocked(cardAssociationsRepo.toggleCardMember).mockResolvedValue({
      newMember: true,
    });
    vi.mocked(
      notificationRepo.createUrgentAlertForAssignedMember,
    ).mockRejectedValueOnce(alertError);
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).addOrRemoveMember({
        cardPublicId: "card-target1",
        workspaceMemberPublicId: "memberValid1",
      }),
    ).resolves.toEqual({ newMember: true });

    expect(mockLogger.error).toHaveBeenCalledWith(
      {
        error: alertError,
        cardPublicId: "card-target1",
        trigger: "assignment",
      },
      "Urgent card alert delivery failed",
    );
  });
});
