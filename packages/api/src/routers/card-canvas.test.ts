import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as CanvasRepository from "@kan/db/repository/cardCanvas.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as canvasRepo from "@kan/db/repository/cardCanvas.repo";
import * as pipelineRepo from "@kan/db/repository/cardPipeline.repo";
import * as subtaskRepo from "@kan/db/repository/cardSubtask.repo";
import { WorkspacePermissionChangedError } from "@kan/db/repository/workspace-boundary";

import type * as WebhookUtils from "../utils/webhook";
import { assertPermission, hasPermission } from "../utils/permissions";
import { sendWebhooksForWorkspace } from "../utils/webhook";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("@kan/logger", () => ({ createLogger: vi.fn(() => mockLogger) }));
vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/cardCanvas.repo", async (importOriginal) => {
  const actual = await importOriginal<typeof CanvasRepository>();
  return {
    ...actual,
    getSnapshot: vi.fn(),
    save: vi.fn(),
    listRevisions: vi.fn(),
    restore: vi.fn(),
    listFrames: vi.fn(),
    convertFrame: vi.fn(),
  };
});
vi.mock("@kan/db/repository/cardPipeline.repo", () => ({
  getByCardPublicIdGuarded: vi.fn(),
}));
vi.mock("@kan/db/repository/cardSubtask.repo", () => ({
  getSubtaskContextByPublicId: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({
  assertPermission: vi.fn(),
  hasPermission: vi.fn(),
}));
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
const framePublicId = "frame0000001";
const subtaskPublicId = "subtask00001";
const stagePublicId = "stage0000001";
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
const subtask = {
  publicId: subtaskPublicId,
  title: "Ejecutar zona",
  description: null,
  priority: "high",
  dueDate: null,
  startedAt: null,
  completedAt: null,
  index: 0,
  owner: null,
  checklistItems: [],
  resources: [],
  canvasFrame: { publicId: framePublicId, name: "Zona" },
};

describe("card canvas router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue(
      card as never,
    );
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(hasPermission).mockResolvedValue(false);
    vi.mocked(canvasRepo.getSnapshot).mockResolvedValue(null);
    vi.mocked(canvasRepo.listFrames).mockResolvedValue([]);
    vi.mocked(canvasRepo.convertFrame).mockResolvedValue({
      status: "saved",
      version: 1,
      hash: "a".repeat(64),
      bytes: 128,
      elementCount: 1,
      framePublicId,
      subtaskPublicId,
    });
    vi.mocked(subtaskRepo.getSubtaskContextByPublicId).mockResolvedValue({
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
    } as never);
    vi.mocked(pipelineRepo.getByCardPublicIdGuarded).mockResolvedValue({
      pipeline: {
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
            updatedAt: null,
            subtasks: [subtask],
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
    vi.mocked(sendWebhooksForWorkspace).mockResolvedValue(undefined);
  });

  it("returns an empty read-only head to anonymous public visitors without initializing", async () => {
    vi.mocked(
      cardRepo.getWorkspaceAndCardIdByCardPublicId,
    ).mockResolvedValueOnce({
      ...card,
      workspaceVisibility: "public",
    } as never);
    const { cardCanvasRouter } = await import("./card-canvas");

    await expect(
      cardCanvasRouter
        .createCaller({ db, user: null } as never)
        .get({ cardPublicId }),
    ).resolves.toEqual({
      exists: false,
      version: 0,
      scene: null,
      hash: null,
      bytes: 0,
      elementCount: 0,
      updatedAt: null,
      viewModeEnabled: true,
    });
    expect(canvasRepo.getSnapshot).toHaveBeenCalledWith(db, {
      cardPublicId,
      expectedWorkspaceId: card.workspaceId,
      requirePublic: true,
    });
    expect(canvasRepo.save).not.toHaveBeenCalled();
  });

  it("blocks legacy saves before inspecting the scene or calling repositories", async () => {
    const inspectScene = vi.fn();
    const scene = {};
    Object.defineProperty(scene, "elements", {
      enumerable: false,
      get: inspectScene,
    });
    const { cardCanvasRouter } = await import("./card-canvas");

    await expect(
      cardCanvasRouter.createCaller({ db, user } as never).save({
        cardPublicId,
        expectedVersion: 0,
        scene,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "CANVAS_LEGACY_READ_ONLY",
    });
    expect(inspectScene).not.toHaveBeenCalled();
    expect(cardRepo.getWorkspaceAndCardIdByCardPublicId).not.toHaveBeenCalled();
    expect(assertPermission).not.toHaveBeenCalled();
    expect(canvasRepo.save).not.toHaveBeenCalled();
  });

  it("blocks legacy restores before calling repositories", async () => {
    const { cardCanvasRouter } = await import("./card-canvas");

    await expect(
      cardCanvasRouter.createCaller({ db, user } as never).restore({
        cardPublicId,
        revisionPublicId: "revision0001",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "CANVAS_LEGACY_READ_ONLY",
    });
    expect(cardRepo.getWorkspaceAndCardIdByCardPublicId).not.toHaveBeenCalled();
    expect(assertPermission).not.toHaveBeenCalled();
    expect(canvasRepo.restore).not.toHaveBeenCalled();
  });

  it("exposes tombstones only to users who can edit the card", async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(true);
    const { cardCanvasRouter } = await import("./card-canvas");

    await cardCanvasRouter
      .createCaller({ db, user } as never)
      .listFrames({ cardPublicId });
    expect(canvasRepo.listFrames).toHaveBeenCalledWith(db, {
      cardPublicId,
      expectedWorkspaceId: card.workspaceId,
      requirePublic: false,
      includeTombstones: true,
    });
  });

  it("emits exactly one subtask.created webhook after a successful conversion", async () => {
    const { cardCanvasRouter } = await import("./card-canvas");
    const inspectLegacyScene = vi.fn();
    const legacyScene = {};
    Object.defineProperty(legacyScene, "elements", {
      enumerable: true,
      get: inspectLegacyScene,
    });

    const result = await cardCanvasRouter
      .createCaller({ db, user } as never)
      .convertFrame({
        cardPublicId,
        framePublicId,
        expectedVersion: 0,
        scene: legacyScene,
        targetStageStatus: "planned",
        subtaskFields: { title: "<b>Ejecutar zona</b>", priority: "high" },
      });

    expect(result).toMatchObject({ status: "saved", subtaskPublicId });
    expect(assertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      card.workspaceId,
      "card:edit",
    );
    const conversionInput = vi.mocked(canvasRepo.convertFrame).mock
      .calls[0]?.[1];
    expect(conversionInput).toMatchObject({
      cardPublicId,
      framePublicId,
      expectedVersion: 0,
      targetStageStatus: "planned",
      subtaskFields: { title: "Ejecutar zona", priority: "high" },
      expectedWorkspaceId: card.workspaceId,
      actorId: user.id,
    });
    expect(conversionInput).not.toHaveProperty("scene");
    expect(inspectLegacyScene).not.toHaveBeenCalled();
    expect(sendWebhooksForWorkspace).toHaveBeenCalledTimes(1);
    const webhookCall = vi.mocked(sendWebhooksForWorkspace).mock.calls[0];
    expect(webhookCall?.[0]).toBe(db);
    expect(webhookCall?.[1]).toBe(card.workspaceId);
    expect(webhookCall?.[2].event).toBe("subtask.created");
    expect(webhookCall?.[2].data.subtask?.publicId).toBe(subtaskPublicId);
  });

  it("emits no webhook for a CAS conflict", async () => {
    vi.mocked(canvasRepo.convertFrame).mockResolvedValueOnce({
      status: "conflict",
      code: "CANVAS_VERSION_CONFLICT",
      remoteVersion: 4,
    });
    const { cardCanvasRouter } = await import("./card-canvas");

    await expect(
      cardCanvasRouter.createCaller({ db, user } as never).convertFrame({
        cardPublicId,
        framePublicId,
        expectedVersion: 3,
        targetStageStatus: "planned",
        subtaskFields: { title: "No crear" },
      }),
    ).resolves.toEqual({
      status: "conflict",
      code: "CANVAS_VERSION_CONFLICT",
      remoteVersion: 4,
    });
    expect(subtaskRepo.getSubtaskContextByPublicId).not.toHaveBeenCalled();
    expect(sendWebhooksForWorkspace).not.toHaveBeenCalled();
  });

  it("maps permission revocation inside conversion to forbidden", async () => {
    vi.mocked(canvasRepo.convertFrame).mockRejectedValueOnce(
      new WorkspacePermissionChangedError(),
    );
    const { cardCanvasRouter } = await import("./card-canvas");

    await expect(
      cardCanvasRouter.createCaller({ db, user } as never).convertFrame({
        cardPublicId,
        framePublicId,
        expectedVersion: 1,
        targetStageStatus: "planned",
        subtaskFields: { title: "No crear" },
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "CARD_CANVAS_EDIT_FORBIDDEN",
    });
    expect(sendWebhooksForWorkspace).not.toHaveBeenCalled();
  });

  it("does not log private error content when webhook preparation fails", async () => {
    const privateErrorMarker = "PRIVATE_WEBHOOK_ERROR_MARKER";
    vi.mocked(subtaskRepo.getSubtaskContextByPublicId).mockRejectedValueOnce(
      Object.assign(new Error(privateErrorMarker), {
        scene: { text: "private card content" },
      }),
    );
    const { cardCanvasRouter } = await import("./card-canvas");

    await cardCanvasRouter.createCaller({ db, user } as never).convertFrame({
      cardPublicId,
      framePublicId,
      expectedVersion: 0,
      targetStageStatus: "planned",
      subtaskFields: { title: "Ejecutar zona" },
    });

    expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(
      privateErrorMarker,
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      {
        errorCode: "CANVAS_WEBHOOK_PREPARATION_FAILED",
        subtaskPublicId,
      },
      "Unable to prepare canvas conversion webhook",
    );
  });
});
