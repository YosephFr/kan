import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardDuplicateRepo from "@kan/db/repository/cardDuplicate.repo";
import * as notificationRepo from "@kan/db/repository/notification.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";

import { assertPermission } from "../utils/permissions";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@kan/db/repository/cardDuplicate.repo", () => ({
  CardPipelineCloneError: class CardPipelineCloneError extends Error {},
  duplicateCard: vi.fn(),
}));
vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/cardActivity.repo", () => ({}));
vi.mock("@kan/db/repository/cardComment.repo", () => ({}));
vi.mock("@kan/db/repository/label.repo", () => ({}));
vi.mock("@kan/db/repository/list.repo", () => ({}));
vi.mock("@kan/db/repository/notification.repo", () => ({
  createUrgentAlertsForAssignees: vi.fn(),
}));
vi.mock("@kan/logger", () => ({ createLogger: vi.fn(() => mockLogger) }));
vi.mock("@kan/db/repository/workspace.repo", () => ({}));
vi.mock("../utils/permissions", () => ({
  assertCanDelete: vi.fn(),
  assertCanEdit: vi.fn(),
  assertPermission: vi.fn(),
}));
vi.mock("../utils/notifications", () => ({ sendMentionEmails: vi.fn() }));
vi.mock("../utils/activities", () => ({ mergeActivities: vi.fn() }));

describe("card.duplicate authorization and transaction boundary", () => {
  const db = {} as never;
  const user = { id: "user-123", name: "User", email: "u@example.com" };
  const context = { db, user } as never;
  const sourceCardPublicId = "card-source1";
  const targetListPublicId = "list-target1";
  const workspaceId = 10;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue({
      id: 1,
      createdBy: user.id,
      workspaceId,
    } as never);
    vi.mocked(cardDuplicateRepo.duplicateCard).mockResolvedValue({
      id: 2,
      publicId: "card-copy001",
      priority: "high",
      skippedResourceCount: 0,
    });
    vi.mocked(assertPermission).mockResolvedValue(undefined);
  });

  it("checks create and view before invoking the atomic duplicate command", async () => {
    const { cardRouter } = await import("./card");

    const result = await cardRouter.createCaller(context).duplicate({
      cardPublicId: sourceCardPublicId,
      listPublicId: targetListPublicId,
      index: 3,
      title: "Copy",
      copyLabels: true,
      copyMembers: true,
      copyChecklists: true,
      copyPipeline: true,
    });

    expect(assertPermission).toHaveBeenNthCalledWith(
      1,
      db,
      user.id,
      workspaceId,
      "card:create",
    );
    expect(assertPermission).toHaveBeenNthCalledWith(
      2,
      db,
      user.id,
      workspaceId,
      "card:view",
    );
    expect(cardDuplicateRepo.duplicateCard).toHaveBeenCalledWith(db, {
      sourceCardPublicId,
      targetListPublicId,
      expectedWorkspaceId: workspaceId,
      createdBy: user.id,
      title: "Copy",
      index: 3,
      copyLabels: true,
      copyMembers: true,
      copyChecklists: true,
      copyPipeline: true,
    });
    expect(result).toEqual({
      publicId: "card-copy001",
      skippedResourceCount: 0,
    });
  });

  it("denies card:view before reading or cloning source data", async () => {
    vi.mocked(assertPermission)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new TRPCError({ code: "FORBIDDEN", message: "No permission" }),
      );
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).duplicate({
        cardPublicId: sourceCardPublicId,
        listPublicId: targetListPublicId,
        copyLabels: false,
        copyMembers: false,
        copyChecklists: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(cardDuplicateRepo.duplicateCard).not.toHaveBeenCalled();
  });

  it("returns the number of binary resources intentionally skipped", async () => {
    vi.mocked(cardDuplicateRepo.duplicateCard).mockResolvedValueOnce({
      id: 2,
      publicId: "card-copy001",
      priority: "none",
      skippedResourceCount: 4,
    });
    const { cardRouter } = await import("./card");

    const result = await cardRouter.createCaller(context).duplicate({
      cardPublicId: sourceCardPublicId,
      listPublicId: targetListPublicId,
      copyLabels: false,
      copyMembers: false,
      copyChecklists: false,
    });

    expect(result.skippedResourceCount).toBe(4);
  });

  it("keeps an urgent duplicate successful when its alert fails", async () => {
    const alertError = new Error("notification unavailable");
    vi.mocked(cardDuplicateRepo.duplicateCard).mockResolvedValueOnce({
      id: 2,
      publicId: "card-copy001",
      priority: "urgent",
      skippedResourceCount: 0,
    });
    vi.mocked(
      notificationRepo.createUrgentAlertsForAssignees,
    ).mockRejectedValueOnce(alertError);
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).duplicate({
        cardPublicId: sourceCardPublicId,
        listPublicId: targetListPublicId,
        copyLabels: false,
        copyMembers: false,
        copyChecklists: false,
      }),
    ).resolves.toEqual({
      publicId: "card-copy001",
      skippedResourceCount: 0,
    });

    expect(mockLogger.error).toHaveBeenCalledWith(
      {
        error: alertError,
        cardPublicId: "card-copy001",
        trigger: "duplicate",
      },
      "Urgent card alert delivery failed",
    );
  });

  it("maps an atomic pipeline clone failure to a conflict", async () => {
    vi.mocked(cardDuplicateRepo.duplicateCard).mockRejectedValueOnce(
      new cardDuplicateRepo.CardPipelineCloneError(),
    );
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).duplicate({
        cardPublicId: sourceCardPublicId,
        listPublicId: targetListPublicId,
        copyLabels: false,
        copyMembers: false,
        copyChecklists: false,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "CARD_PIPELINE_CLONE_FAILED",
    });
  });

  it("hides source or target workspace races as not found", async () => {
    vi.mocked(cardDuplicateRepo.duplicateCard).mockRejectedValueOnce(
      new WorkspaceChangedError(),
    );
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(context).duplicate({
        cardPublicId: sourceCardPublicId,
        listPublicId: targetListPublicId,
        copyLabels: false,
        copyMembers: false,
        copyChecklists: false,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
