import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardPipelineRepo from "@kan/db/repository/cardPipeline.repo";

import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/cardPipeline.repo", () => ({
  getByCardPublicIdGuarded: vi.fn(),
  initialize: vi.fn(),
  updateStages: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({ assertPermission: vi.fn() }));

const mockCard = cardRepo.getWorkspaceAndCardIdByCardPublicId as ReturnType<
  typeof vi.fn
>;
const mockPipeline = cardPipelineRepo.getByCardPublicIdGuarded as ReturnType<
  typeof vi.fn
>;
const mockInitialize = cardPipelineRepo.initialize as ReturnType<typeof vi.fn>;
const mockUpdateStages = cardPipelineRepo.updateStages as ReturnType<
  typeof vi.fn
>;

const cardPublicId = "card00000001";
const stagePublicId = "stage0000001";
const db = {} as never;
const user = {
  id: "3b0f4baf-aac9-4c7a-aef2-36e03d764e63",
  name: "Editor",
  email: "editor@example.com",
};
const pipeline = {
  status: "ready",
  cardPublicId,
  initialized: true,
  stages: [
    {
      publicId: stagePublicId,
      status: "planned",
      name: "Por hacer",
      colourCode: null,
      index: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      subtasks: [
        {
          publicId: "subtask00001",
          title: "Preparar brief",
          description: null,
          priority: "none",
          dueDate: null,
          startedAt: null,
          completedAt: null,
          index: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          owner: {
            publicId: "member000001",
            name: "Ana",
            image: null,
            email: "private@example.com",
          },
          checklistItems: [],
          resources: [],
        },
      ],
    },
  ],
};

describe("card pipeline router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCard.mockResolvedValue({
      id: 10,
      createdBy: user.id,
      workspaceId: 20,
      workspaceVisibility: "private",
      listPublicId: "list00000001",
      listName: "Por hacer",
      boardId: 30,
      boardPublicId: "board0000001",
      boardName: "Producto",
    });
    mockPipeline.mockResolvedValue({
      pipeline,
      summary: {
        total: 1,
        completed: 0,
        blocked: 0,
        progressPercent: 0,
      },
    });
    mockInitialize.mockResolvedValue({ status: "initialized", stages: [] });
    mockUpdateStages.mockResolvedValue({ status: "updated", stages: [] });
    vi.mocked(assertPermission).mockResolvedValue(undefined);
  });

  it("allows anonymous reads only on public boards and strips private owner fields", async () => {
    mockCard.mockResolvedValueOnce({
      ...(await mockCard()),
      workspaceVisibility: "public",
    });
    const { cardPipelineRouter } = await import("./card-pipeline");

    const result = await cardPipelineRouter
      .createCaller({ db, user: null } as never)
      .get({ cardPublicId });

    expect(assertPermission).not.toHaveBeenCalled();
    expect(mockPipeline).toHaveBeenCalledWith(db, {
      cardPublicId,
      expectedWorkspaceId: 20,
      requirePublic: true,
    });
    expect(result.stages[0]?.subtasks[0]?.owner).toEqual({
      publicId: "member000001",
      name: "Ana",
      image: null,
    });
    expect(JSON.stringify(result)).not.toContain("private@example.com");
  });

  it("rejects anonymous private-board reads", async () => {
    const { cardPipelineRouter } = await import("./card-pipeline");

    await expect(
      cardPipelineRouter
        .createCaller({ db, user: null } as never)
        .get({ cardPublicId }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("maps linked web resources without exposing remote preview URLs", async () => {
    mockPipeline.mockResolvedValueOnce({
      pipeline: {
        ...pipeline,
        stages: pipeline.stages.map((stage) => ({
          ...stage,
          subtasks: stage.subtasks.map((subtask) => ({
            ...subtask,
            resources: [
              {
                publicId: "webresource1",
                kind: "web",
                title: "Research notes",
                webUrl: "https://example.com/research",
                webDescription: "Working context",
                webSiteName: "Example",
                webImageUrl: "https://cdn.example.com/private.png",
              },
            ],
          })),
        })),
      },
      summary: {
        total: 1,
        completed: 0,
        blocked: 0,
        progressPercent: 0,
      },
    });
    const { cardPipelineRouter } = await import("./card-pipeline");

    const result = await cardPipelineRouter
      .createCaller({ db, user } as never)
      .get({ cardPublicId });

    expect(result.stages[0]?.subtasks[0]?.resources).toEqual([
      {
        publicId: "webresource1",
        kind: "web",
        title: "Research notes",
        openUrl: "https://example.com/research",
        description: "Working context",
        siteName: "Example",
        previewImageUrl: "/api/resources/webresource1/preview-image",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("cdn.example.com");
    expect(JSON.stringify(result)).not.toContain("webImageUrl");
  });

  it("checks card:view for private reads and card:edit for mutations", async () => {
    const { cardPipelineRouter } = await import("./card-pipeline");
    const caller = cardPipelineRouter.createCaller({ db, user } as never);

    await caller.get({ cardPublicId });
    await caller.initialize({ cardPublicId });

    expect(assertPermission).toHaveBeenNthCalledWith(
      1,
      db,
      user.id,
      20,
      "card:view",
    );
    expect(mockPipeline).toHaveBeenNthCalledWith(1, db, {
      cardPublicId,
      expectedWorkspaceId: 20,
      requirePublic: false,
    });
    expect(assertPermission).toHaveBeenNthCalledWith(
      2,
      db,
      user.id,
      20,
      "card:edit",
    );
    expect(mockInitialize).toHaveBeenCalledWith(db, {
      cardPublicId,
      expectedWorkspaceId: 20,
      createdBy: user.id,
    });
  });

  it("passes partial stage patches into the locked repository merge", async () => {
    const { cardPipelineRouter } = await import("./card-pipeline");

    await cardPipelineRouter.createCaller({ db, user } as never).updateStages({
      cardPublicId,
      stages: [{ stagePublicId, name: "Ideas" }],
    });

    expect(mockUpdateStages).toHaveBeenCalledWith(db, {
      cardPublicId,
      expectedWorkspaceId: 20,
      stages: [{ publicId: stagePublicId, name: "Ideas" }],
      updatedBy: user.id,
    });
  });

  it("rejects names that become empty after sanitization", async () => {
    const { cardPipelineRouter } = await import("./card-pipeline");

    await expect(
      cardPipelineRouter.createCaller({ db, user } as never).updateStages({
        cardPublicId,
        stages: [{ stagePublicId, name: "<b>  </b>" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockUpdateStages).not.toHaveBeenCalled();
  });

  it("hides a workspace move race as not found", async () => {
    mockInitialize.mockResolvedValueOnce({ status: "workspace_changed" });
    const { cardPipelineRouter } = await import("./card-pipeline");

    await expect(
      cardPipelineRouter
        .createCaller({ db, user } as never)
        .initialize({ cardPublicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
