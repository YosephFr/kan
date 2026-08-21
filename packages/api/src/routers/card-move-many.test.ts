import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardMoveRepo from "@kan/db/repository/card-move.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as notificationRepo from "@kan/db/repository/notification.repo";

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

vi.mock("@kan/db/repository/notification.repo", () => ({
  invalidateCardAlerts: vi.fn(),
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
const mockInvalidateCardAlerts =
  notificationRepo.invalidateCardAlerts as ReturnType<typeof vi.fn>;
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
    priority: "none" as const,
    colourCode: null,
    startedAt: null,
    completedAt: null,
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
    status: "inProgress" as const,
    colourCode: null,
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
        priority: firstCard.priority,
        colourCode: firstCard.colourCode,
        startedAt: firstCard.startedAt,
        completedAt: firstCard.completedAt,
      },
      {
        id: secondCard.id,
        publicId: secondCard.publicId,
        title: secondCard.title,
        description: secondCard.description,
        dueDate: secondCard.dueDate,
        priority: secondCard.priority,
        colourCode: secondCard.colourCode,
        startedAt: secondCard.startedAt,
        completedAt: secondCard.completedAt,
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
        priority: secondCard.priority,
        colourCode: secondCard.colourCode,
        startedAt: secondCard.startedAt,
        completedAt: secondCard.completedAt,
      },
      {
        id: firstCard.id,
        publicId: firstCard.publicId,
        title: firstCard.title,
        description: firstCard.description,
        dueDate: firstCard.dueDate,
        priority: firstCard.priority,
        colourCode: firstCard.colourCode,
        startedAt: firstCard.startedAt,
        completedAt: firstCard.completedAt,
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
      expectedWorkspaceId: firstCard.list.board.workspaceId,
      createdBy: mockUser.id,
      confirmOpenSubtasks: undefined,
    });
    expect(result.map((card) => card.publicId)).toEqual([
      secondCard.publicId,
      firstCard.publicId,
    ]);
    expect(mockCreateCardWebhookPayload).toHaveBeenCalledTimes(2);
    expect(mockSendWebhooksForWorkspace).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate transactional invalidation for completed cards", async () => {
    const completedAt = new Date("2026-08-20T12:00:00.000Z");
    mockMoveMany.mockResolvedValueOnce([
      {
        id: firstCard.id,
        publicId: firstCard.publicId,
        title: firstCard.title,
        description: firstCard.description,
        dueDate: firstCard.dueDate,
        priority: firstCard.priority,
        colourCode: firstCard.colourCode,
        startedAt: firstCard.startedAt,
        completedAt,
      },
      {
        id: secondCard.id,
        publicId: secondCard.publicId,
        title: secondCard.title,
        description: secondCard.description,
        dueDate: secondCard.dueDate,
        priority: secondCard.priority,
        colourCode: secondCard.colourCode,
        startedAt: secondCard.startedAt,
        completedAt: null,
      },
    ]);

    await testRouter.createCaller(mockContext).moveMany({
      cardPublicIds: [firstCard.publicId, secondCard.publicId],
      listPublicId: destinationList.publicId,
    });

    expect(destinationList.status).toBe("inProgress");
    expect(mockInvalidateCardAlerts).not.toHaveBeenCalled();
  });

  it("requires and forwards explicit confirmation before bulk-closing parents with open subtasks", async () => {
    mockMoveMany.mockRejectedValueOnce(
      new Error("OPEN_SUBTASKS_CONFIRMATION_REQUIRED"),
    );

    await expect(
      testRouter.createCaller(mockContext).moveMany({
        cardPublicIds: [firstCard.publicId, secondCard.publicId],
        listPublicId: destinationList.publicId,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "OPEN_SUBTASKS_CONFIRMATION_REQUIRED",
    });

    mockMoveMany.mockResolvedValueOnce([
      { ...firstCard, completedAt: new Date("2026-08-21T12:00:00.000Z") },
      { ...secondCard, completedAt: new Date("2026-08-21T12:00:00.000Z") },
    ]);

    await testRouter.createCaller(mockContext).moveMany({
      cardPublicIds: [firstCard.publicId, secondCard.publicId],
      listPublicId: destinationList.publicId,
      confirmOpenSubtasks: true,
    });

    expect(mockMoveMany).toHaveBeenLastCalledWith(mockDb, {
      cardIds: [firstCard.id, secondCard.id],
      destinationListId: destinationList.id,
      expectedWorkspaceId: firstCard.list.board.workspaceId,
      createdBy: mockUser.id,
      confirmOpenSubtasks: true,
    });
  });
});
