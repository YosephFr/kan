import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardPipelineRepo from "@kan/db/repository/cardPipeline.repo";
import * as cardSubtaskRepo from "@kan/db/repository/cardSubtask.repo";
import * as checklistRepo from "@kan/db/repository/cardSubtaskChecklist.repo";
import * as resourceRepo from "@kan/db/repository/cardSubtaskResource.repo";

import type * as WebhookUtils from "../utils/webhook";
import { assertPermission } from "../utils/permissions";
import { sendWebhooksForWorkspace } from "../utils/webhook";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("@kan/logger", () => ({ createLogger: vi.fn(() => mockLogger) }));
vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/cardPipeline.repo", () => ({
  getByCardPublicIdGuarded: vi.fn(),
}));
vi.mock("@kan/db/repository/cardSubtask.repo", () => ({
  createSubtask: vi.fn(),
  getByPublicId: vi.fn(),
  getSubtaskContextByPublicId: vi.fn(),
  updateSubtask: vi.fn(),
}));
vi.mock("@kan/db/repository/cardSubtaskChecklist.repo", () => ({
  addChecklistItem: vi.fn(),
  getChecklistItemContextByPublicId: vi.fn(),
  updateChecklistItem: vi.fn(),
}));
vi.mock("@kan/db/repository/cardSubtaskResource.repo", () => ({
  linkResource: vi.fn(),
  unlinkResource: vi.fn(),
}));
vi.mock("@kan/db/repository/notification.repo", () => ({}));
vi.mock("../utils/permissions", () => ({ assertPermission: vi.fn() }));
vi.mock("../utils/webhook", async (importOriginal) => {
  const actual = await importOriginal<typeof WebhookUtils>();
  return { ...actual, sendWebhooksForWorkspace: vi.fn() };
});

const db = {} as never;
const user = {
  id: "3b0f4baf-aac9-4c7a-aef2-36e03d764e63",
  name: "Editor",
  email: "editor@example.com",
};
const cardPublicId = "card00000001";
const stagePublicId = "stage0000001";
const subtaskPublicId = "subtask00001";
const card = {
  id: 10,
  createdBy: user.id,
  workspaceId: 20,
  workspaceVisibility: "private",
  listPublicId: "list00000001",
  listName: "Por hacer",
  boardId: 30,
  boardPublicId: "board0000001",
  boardName: "Producto",
};
const context = {
  subtaskId: 40,
  subtaskPublicId,
  cardId: card.id,
  cardPublicId,
  cardTitle: "Curso",
  listPublicId: card.listPublicId,
  listName: card.listName,
  boardPublicId: card.boardPublicId,
  boardName: card.boardName,
  workspaceId: card.workspaceId,
};
const subtask = {
  publicId: subtaskPublicId,
  title: "Outline",
  description: "Safex",
  priority: "high",
  dueDate: null,
  startedAt: null,
  completedAt: null,
  index: 0,
  stagePublicId,
  owner: null,
  checklistItems: [],
  resources: [],
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
      subtasks: [subtask],
    },
  ],
};

describe("card subtask router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue(
      card as never,
    );
    vi.mocked(cardPipelineRepo.getByCardPublicIdGuarded).mockResolvedValue({
      pipeline,
      summary: {
        total: 1,
        completed: 0,
        blocked: 0,
        progressPercent: 0,
      },
    } as never);
    vi.mocked(cardSubtaskRepo.getSubtaskContextByPublicId).mockResolvedValue(
      context as never,
    );
    vi.mocked(cardSubtaskRepo.createSubtask).mockResolvedValue({
      status: "created",
      subtask,
      assignmentReference: "activity0001",
    } as never);
    vi.mocked(cardSubtaskRepo.getByPublicId).mockResolvedValue(
      subtask as never,
    );
    vi.mocked(resourceRepo.linkResource).mockResolvedValue({
      status: "linked",
      relation: {
        publicId: "relation0001",
        resourcePublicId: "resource0001",
        kind: "drive",
        attachmentPublicId: null,
      },
    });
    vi.mocked(resourceRepo.unlinkResource).mockResolvedValue({
      status: "unlinked",
      publicId: "relation0001",
    });
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(sendWebhooksForWorkspace).mockImplementation(() =>
      Promise.resolve(),
    );
  });

  it("sanitizes plain text, checks card:edit and emits only public webhook IDs", async () => {
    vi.mocked(sendWebhooksForWorkspace).mockRejectedValueOnce(
      new Error("delivery failed"),
    );
    const { cardSubtaskRouter } = await import("./card-subtask");

    const result = await cardSubtaskRouter
      .createCaller({ db, user } as never)
      .create({
        cardPublicId,
        stagePublicId,
        title: "<b>Outline</b>",
        description: "<p>Safe</p><script>x</script>",
        priority: "high",
      });
    await Promise.resolve();

    expect(assertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      card.workspaceId,
      "card:edit",
    );
    expect(cardSubtaskRepo.createSubtask).toHaveBeenCalledWith(db, {
      stagePublicId,
      title: "Outline",
      description: "Safex",
      priority: "high",
      dueDate: undefined,
      ownerPublicId: undefined,
      expectedWorkspaceId: card.workspaceId,
      createdBy: user.id,
    });
    expect(result.publicId).toBe(subtaskPublicId);
    const webhookPayload = vi.mocked(sendWebhooksForWorkspace).mock
      .calls[0]?.[2];
    expect(webhookPayload?.event).toBe("subtask.created");
    expect(webhookPayload?.data.user).toBeUndefined();
    expect(JSON.stringify(webhookPayload)).not.toContain(user.id);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("rejects HTML-only subtask and checklist titles as bad input", async () => {
    const { cardSubtaskRouter } = await import("./card-subtask");
    const caller = cardSubtaskRouter.createCaller({ db, user } as never);

    await expect(
      caller.create({ cardPublicId, stagePublicId, title: "<b>  </b>" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.createChecklistItem({
        subtaskPublicId,
        title: "<span>  </span>",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(cardSubtaskRepo.createSubtask).not.toHaveBeenCalled();
    expect(checklistRepo.addChecklistItem).not.toHaveBeenCalled();
  });

  it("checks edit permission and rejects a post-authorization workspace move", async () => {
    vi.mocked(cardSubtaskRepo.updateSubtask).mockResolvedValueOnce({
      status: "workspace_changed",
    } as never);
    const { cardSubtaskRouter } = await import("./card-subtask");

    await expect(
      cardSubtaskRouter
        .createCaller({ db, user } as never)
        .update({ subtaskPublicId, title: "Nuevo" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(assertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      context.workspaceId,
      "card:edit",
    );
    expect(cardSubtaskRepo.updateSubtask).toHaveBeenCalledWith(db, {
      subtaskPublicId,
      title: "Nuevo",
      expectedWorkspaceId: context.workspaceId,
      updatedBy: user.id,
    });
  });

  it("links and unlinks a resource using only public IDs", async () => {
    const driveResource = {
      publicId: "resource0001",
      kind: "drive" as const,
      title: "Plan",
      driveType: "document" as const,
      openUrl: "https://docs.google.com/document/d/DocumentId12345/edit",
      previewUrl: "https://docs.google.com/document/d/DocumentId12345/preview",
    };
    vi.mocked(cardPipelineRepo.getByCardPublicIdGuarded).mockResolvedValue({
      pipeline: {
        ...pipeline,
        stages: [
          {
            ...pipeline.stages[0],
            subtasks: [
              {
                ...subtask,
                resources: [
                  {
                    publicId: driveResource.publicId,
                    kind: "drive",
                    title: driveResource.title,
                    driveType: driveResource.driveType,
                    driveFileId: "DocumentId12345",
                    resourceKey: null,
                  },
                ],
              },
            ],
          },
        ],
      },
      summary: {
        total: 1,
        completed: 0,
        blocked: 0,
        progressPercent: 0,
      },
    } as never);
    const { cardSubtaskRouter } = await import("./card-subtask");
    const caller = cardSubtaskRouter.createCaller({ db, user } as never);

    await expect(
      caller.linkResource({
        subtaskPublicId,
        resourcePublicId: driveResource.publicId,
      }),
    ).resolves.toEqual(driveResource);
    expect(resourceRepo.linkResource).toHaveBeenCalledWith(db, {
      subtaskPublicId,
      resourcePublicId: driveResource.publicId,
      expectedWorkspaceId: context.workspaceId,
      createdBy: user.id,
    });
    await expect(
      caller.unlinkResource({
        subtaskPublicId,
        resourcePublicId: driveResource.publicId,
      }),
    ).resolves.toEqual({ success: true });
    expect(resourceRepo.unlinkResource).toHaveBeenCalledWith(db, {
      subtaskPublicId,
      resourcePublicId: driveResource.publicId,
      expectedWorkspaceId: context.workspaceId,
      deletedBy: user.id,
    });
  });
});
