import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardMoveRepo from "@kan/db/repository/card-move.repo";
import * as listRepo from "@kan/db/repository/list.repo";

import { createTRPCRouter } from "../trpc";
import { assertCanEdit } from "../utils/permissions";
import {
  createCardWebhookPayload,
  sendWebhooksForWorkspace,
} from "../utils/webhook";
import { cardMoveManyProcedure } from "./card-move-many";

vi.mock("@kan/db/repository/card-move.repo", () => ({
  getCandidates: vi.fn(),
  moveMany: vi.fn(),
}));

vi.mock("@kan/db/repository/list.repo", () => ({
  getWorkspaceAndListIdByListPublicId: vi.fn(),
}));

vi.mock("../utils/permissions", () => ({
  assertCanEdit: vi.fn(),
}));

vi.mock("../utils/webhook", () => ({
  createCardWebhookPayload: vi.fn(() => ({ event: "card.moved" })),
  sendWebhooksForWorkspace: vi.fn(() => Promise.resolve()),
}));

const testRouter = createTRPCRouter({
  moveMany: cardMoveManyProcedure,
});
const mockGetCandidates = cardMoveRepo.getCandidates as ReturnType<
  typeof vi.fn
>;
const mockMoveMany = cardMoveRepo.moveMany as ReturnType<typeof vi.fn>;
const mockGetDestinationList =
  listRepo.getWorkspaceAndListIdByListPublicId as ReturnType<typeof vi.fn>;
const mockAssertCanEdit = assertCanEdit as ReturnType<typeof vi.fn>;
const mockCreateCardWebhookPayload = createCardWebhookPayload as ReturnType<
  typeof vi.fn
>;
const mockSendWebhooksForWorkspace = sendWebhooksForWorkspace as ReturnType<
  typeof vi.fn
>;

describe("card.moveMany", () => {
  const mockDb = {} as never;
  const mockUser = {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
  };
  const mockContext = { user: mockUser, db: mockDb } as never;
  const firstCard = {
    id: 1,
    publicId: "card-1234567",
    createdBy: "creator-1",
    listId: 100,
    title: "First card",
    description: null,
    dueDate: null,
    list: {
      publicId: "list-source1",
      name: "Por hacer",
      board: {
        publicId: "board-source",
        name: "IA",
        workspaceId: 10,
      },
    },
  };
  const secondCard = {
    ...firstCard,
    id: 2,
    publicId: "card-7654321",
    createdBy: "creator-2",
    title: "Second card",
  };
  const destinationList = {
    id: 200,
    publicId: "list-target1",
    name: "En curso",
    createdBy: mockUser.id,
    workspaceId: 10,
    boardPublicId: "board-target",
    boardName: "Foco",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCandidates.mockResolvedValue([firstCard, secondCard]);
    mockGetDestinationList.mockResolvedValue(destinationList);
    mockAssertCanEdit.mockResolvedValue(undefined);
    mockMoveMany.mockResolvedValue([
      {
        id: firstCard.id,
        publicId: firstCard.publicId,
        title: firstCard.title,
        description: firstCard.description,
        dueDate: firstCard.dueDate,
      },
      {
        id: secondCard.id,
        publicId: secondCard.publicId,
        title: secondCard.title,
        description: secondCard.description,
        dueDate: secondCard.dueDate,
      },
    ]);
  });

  it("rejects duplicate card selections", async () => {
    await expect(
      testRouter.createCaller(mockContext).moveMany({
        cardPublicIds: [firstCard.publicId, firstCard.publicId],
        listPublicId: destinationList.publicId,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockGetCandidates).not.toHaveBeenCalled();
    expect(mockMoveMany).not.toHaveBeenCalled();
  });

  it("rejects selections from different boards", async () => {
    mockGetCandidates.mockResolvedValueOnce([
      firstCard,
      {
        ...secondCard,
        list: {
          ...secondCard.list,
          board: {
            ...secondCard.list.board,
            publicId: "board-other1",
          },
        },
      },
    ]);

    await expect(
      testRouter.createCaller(mockContext).moveMany({
        cardPublicIds: [firstCard.publicId, secondCard.publicId],
        listPublicId: destinationList.publicId,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockMoveMany).not.toHaveBeenCalled();
  });

  it("rejects the current board as the destination", async () => {
    mockGetDestinationList.mockResolvedValueOnce({
      ...destinationList,
      boardPublicId: firstCard.list.board.publicId,
    });

    await expect(
      testRouter.createCaller(mockContext).moveMany({
        cardPublicIds: [firstCard.publicId, secondCard.publicId],
        listPublicId: destinationList.publicId,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockMoveMany).not.toHaveBeenCalled();
  });

  it("authorizes every card and preserves the requested order", async () => {
    mockGetCandidates.mockResolvedValueOnce([secondCard, firstCard]);
    mockMoveMany.mockResolvedValueOnce([
      {
        id: secondCard.id,
        publicId: secondCard.publicId,
        title: secondCard.title,
        description: secondCard.description,
        dueDate: secondCard.dueDate,
      },
      {
        id: firstCard.id,
        publicId: firstCard.publicId,
        title: firstCard.title,
        description: firstCard.description,
        dueDate: firstCard.dueDate,
      },
    ]);

    const result = await testRouter.createCaller(mockContext).moveMany({
      cardPublicIds: [secondCard.publicId, firstCard.publicId],
      listPublicId: destinationList.publicId,
    });

    expect(mockAssertCanEdit).toHaveBeenNthCalledWith(
      1,
      mockDb,
      mockUser.id,
      secondCard.list.board.workspaceId,
      "card:edit",
      secondCard.createdBy,
    );
    expect(mockAssertCanEdit).toHaveBeenNthCalledWith(
      2,
      mockDb,
      mockUser.id,
      firstCard.list.board.workspaceId,
      "card:edit",
      firstCard.createdBy,
    );
    expect(mockMoveMany).toHaveBeenCalledWith(mockDb, {
      cardIds: [secondCard.id, firstCard.id],
      destinationListId: destinationList.id,
      createdBy: mockUser.id,
    });
    expect(result.map((card) => card.publicId)).toEqual([
      secondCard.publicId,
      firstCard.publicId,
    ]);
    expect(mockCreateCardWebhookPayload).toHaveBeenCalledTimes(2);
    expect(mockSendWebhooksForWorkspace).toHaveBeenCalledTimes(2);
  });
});
