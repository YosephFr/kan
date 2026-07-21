import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as listRepo from "@kan/db/repository/list.repo";

import { assertCanEdit } from "../utils/permissions";
import {
  createCardWebhookPayload,
  sendWebhooksForWorkspace,
} from "../utils/webhook";

vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
  getByPublicId: vi.fn(),
  reorder: vi.fn(),
}));

vi.mock("@kan/db/repository/cardActivity.repo", () => ({
  bulkCreate: vi.fn(),
}));

vi.mock("@kan/db/repository/cardComment.repo", () => ({}));
vi.mock("@kan/db/repository/checklist.repo", () => ({}));
vi.mock("@kan/db/repository/label.repo", () => ({}));

vi.mock("@kan/db/repository/list.repo", () => ({
  getWorkspaceAndListIdByListPublicId: vi.fn(),
}));

vi.mock("@kan/db/repository/workspace.repo", () => ({}));

vi.mock("@kan/shared/utils", () => ({
  generateAttachmentUrl: vi.fn(),
  generateAvatarUrl: vi.fn(),
}));

vi.mock("../utils/activities", () => ({
  mergeActivities: vi.fn(),
}));

vi.mock("../utils/notifications", () => ({
  sendMentionEmails: vi.fn(),
}));

vi.mock("../utils/permissions", () => ({
  assertCanDelete: vi.fn(),
  assertCanEdit: vi.fn(),
  assertPermission: vi.fn(),
}));

vi.mock("../utils/webhook", () => ({
  createCardWebhookPayload: vi.fn(() => ({ event: "card.moved" })),
  sendWebhooksForWorkspace: vi.fn(() => Promise.resolve()),
}));

const mockGetCardWorkspace =
  cardRepo.getWorkspaceAndCardIdByCardPublicId as ReturnType<typeof vi.fn>;
const mockGetCard = cardRepo.getByPublicId as ReturnType<typeof vi.fn>;
const mockReorderCard = cardRepo.reorder as ReturnType<typeof vi.fn>;
const mockBulkCreateActivities = cardActivityRepo.bulkCreate as ReturnType<
  typeof vi.fn
>;
const mockGetDestinationList =
  listRepo.getWorkspaceAndListIdByListPublicId as ReturnType<typeof vi.fn>;
const mockAssertCanEdit = assertCanEdit as ReturnType<typeof vi.fn>;
const mockCreateCardWebhookPayload = createCardWebhookPayload as ReturnType<
  typeof vi.fn
>;
const mockSendWebhooksForWorkspace = sendWebhooksForWorkspace as ReturnType<
  typeof vi.fn
>;

describe("card.update list moves", () => {
  const mockDb = {} as never;
  const mockUser = {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
  };
  const mockContext = { user: mockUser, db: mockDb } as never;
  const sourceCard = {
    id: 1,
    createdBy: mockUser.id,
    workspaceId: 10,
    workspaceVisibility: "private",
    listPublicId: "list-source1",
    listName: "Por hacer",
    boardPublicId: "board-source",
    boardName: "IA",
  };
  const existingCard = {
    id: 1,
    publicId: "card-1234567",
    title: "Test card",
    description: null,
    listId: 100,
    dueDate: null,
    list: {
      publicId: "list-source1",
      name: "Por hacer",
    },
    labels: [{ labelId: 501 }, { labelId: 502 }],
  };
  const destinationList = {
    id: 200,
    publicId: "list-target1",
    name: "Por hacer",
    createdBy: mockUser.id,
    workspaceId: 10,
    boardPublicId: "board-target",
    boardName: "Foco",
  };
  const updatedCard = {
    id: 1,
    publicId: existingCard.publicId,
    title: existingCard.title,
    description: existingCard.description,
    dueDate: existingCard.dueDate,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCardWorkspace.mockResolvedValue(sourceCard);
    mockGetCard.mockResolvedValue(existingCard);
    mockGetDestinationList.mockResolvedValue(destinationList);
    mockAssertCanEdit.mockResolvedValue(undefined);
    mockReorderCard.mockResolvedValue(updatedCard);
    mockBulkCreateActivities.mockResolvedValue(undefined);
  });

  it("rejects moving a card to a list in another workspace", async () => {
    const { cardRouter } = await import("./card");
    mockGetDestinationList.mockResolvedValueOnce({
      ...destinationList,
      workspaceId: 20,
    });

    await expect(
      cardRouter.createCaller(mockContext).update({
        cardPublicId: existingCard.publicId,
        listPublicId: destinationList.publicId,
        index: 0,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockReorderCard).not.toHaveBeenCalled();
  });

  it("moves across boards, clears board labels and records the target board", async () => {
    const { cardRouter } = await import("./card");

    await cardRouter.createCaller(mockContext).update({
      cardPublicId: existingCard.publicId,
      listPublicId: destinationList.publicId,
      index: 0,
    });

    expect(mockReorderCard).toHaveBeenCalledWith(mockDb, {
      cardId: existingCard.id,
      newIndex: 0,
      newListId: destinationList.id,
      clearLabels: true,
    });
    expect(mockBulkCreateActivities).toHaveBeenCalledWith(mockDb, [
      {
        type: "card.updated.list",
        cardId: existingCard.id,
        createdBy: mockUser.id,
        fromListId: existingCard.listId,
        toListId: destinationList.id,
      },
      {
        type: "card.updated.label.removed",
        cardId: existingCard.id,
        createdBy: mockUser.id,
        labelId: 501,
      },
      {
        type: "card.updated.label.removed",
        cardId: existingCard.id,
        createdBy: mockUser.id,
        labelId: 502,
      },
    ]);
    expect(mockCreateCardWebhookPayload).toHaveBeenCalledWith(
      "card.moved",
      expect.objectContaining({ listId: destinationList.publicId }),
      expect.objectContaining({
        boardId: destinationList.boardPublicId,
        boardName: destinationList.boardName,
        listName: destinationList.name,
      }),
    );
    expect(mockSendWebhooksForWorkspace).toHaveBeenCalledWith(
      mockDb,
      sourceCard.workspaceId,
      { event: "card.moved" },
    );
  });

  it("keeps labels when moving between lists on the same board", async () => {
    const { cardRouter } = await import("./card");
    mockGetDestinationList.mockResolvedValueOnce({
      ...destinationList,
      boardPublicId: sourceCard.boardPublicId,
      boardName: sourceCard.boardName,
    });

    await cardRouter.createCaller(mockContext).update({
      cardPublicId: existingCard.publicId,
      listPublicId: destinationList.publicId,
      index: 0,
    });

    expect(mockReorderCard).toHaveBeenCalledWith(mockDb, {
      cardId: existingCard.id,
      newIndex: 0,
      newListId: destinationList.id,
      clearLabels: false,
    });
    expect(mockBulkCreateActivities).toHaveBeenCalledWith(mockDb, [
      {
        type: "card.updated.list",
        cardId: existingCard.id,
        createdBy: mockUser.id,
        fromListId: existingCard.listId,
        toListId: destinationList.id,
      },
    ]);
  });
});
