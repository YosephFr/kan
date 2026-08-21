import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardCommentRepo from "@kan/db/repository/cardComment.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";

import {
  assertCanDelete,
  assertCanEdit,
  assertPermission,
} from "../utils/permissions";

vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/cardComment.repo", () => ({
  getByPublicId: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
}));
vi.mock("@kan/db/repository/cardActivity.repo", () => ({}));
vi.mock("@kan/db/repository/cardAssociations.repo", () => ({}));
vi.mock("@kan/db/repository/cardDuplicate.repo", () => ({}));
vi.mock("@kan/db/repository/cardRead.repo", () => ({}));
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

describe("card comment workspace boundary", () => {
  const db = {} as never;
  const user = { id: "user-123", name: "User", email: "user@example.com" };
  const context = { db, user } as never;
  const cardPublicId = "card00000001";
  const commentPublicId = "comment000001";
  const card = { id: 30, workspaceId: 10 };
  const comment = {
    id: 40,
    publicId: commentPublicId,
    comment: "Before",
    createdBy: user.id,
    cardId: card.id,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue(
      card as never,
    );
    vi.mocked(cardCommentRepo.getByPublicId).mockResolvedValue(comment);
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(assertCanEdit).mockResolvedValue(undefined);
    vi.mocked(assertCanDelete).mockResolvedValue(undefined);
  });

  it("creates a comment and its activity inside the authorized transaction", async () => {
    vi.mocked(cardCommentRepo.create).mockRejectedValueOnce(
      new WorkspaceChangedError(),
    );
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).addComment({
        cardPublicId,
        comment: "Hello",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(cardCommentRepo.create).toHaveBeenCalledWith(db, {
      cardId: card.id,
      expectedWorkspaceId: card.workspaceId,
      comment: "Hello",
      createdBy: user.id,
    });
  });

  it("updates only the comment still belonging to the authorized card", async () => {
    vi.mocked(cardCommentRepo.update).mockRejectedValueOnce(
      new WorkspaceChangedError(),
    );
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).updateComment({
        cardPublicId,
        commentPublicId,
        comment: "After",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(cardCommentRepo.update).toHaveBeenCalledWith(db, {
      id: comment.id,
      cardId: card.id,
      expectedWorkspaceId: card.workspaceId,
      comment: "After",
      updatedBy: user.id,
    });
  });

  it("deletes the comment and writes its activity atomically", async () => {
    vi.mocked(cardCommentRepo.softDelete).mockRejectedValueOnce(
      new WorkspaceChangedError(),
    );
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).deleteComment({
        cardPublicId,
        commentPublicId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(cardCommentRepo.softDelete).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        commentId: comment.id,
        cardId: card.id,
        expectedWorkspaceId: card.workspaceId,
        deletedBy: user.id,
      }),
    );
  });
});
