import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as checklistRepo from "@kan/db/repository/checklist.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";

import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/checklist.repo", () => ({
  create: vi.fn(),
  createItem: vi.fn(),
  getChecklistByPublicId: vi.fn(),
  getChecklistItemByPublicIdWithChecklist: vi.fn(),
  updateChecklistById: vi.fn(),
  updateItemById: vi.fn(),
  reorderItem: vi.fn(),
  softDeleteById: vi.fn(),
  softDeleteItemById: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({ assertPermission: vi.fn() }));

const db = {} as never;
const user = {
  id: "3b0f4baf-aac9-4c7a-aef2-36e03d764e63",
  name: "Editor",
  email: "editor@example.com",
};
const card = { id: 10, workspaceId: 20 };
const board = { workspace: { id: card.workspaceId } };
const checklist = {
  id: 30,
  publicId: "checklist001",
  cardId: card.id,
  name: "Producción",
  card: { list: { board } },
};
const item = {
  id: 40,
  publicId: "checkitem001",
  title: "Guion",
  completed: false,
  checklist: { ...checklist, card: { list: { board } } },
};

describe("checklist router workspace boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue(
      card as never,
    );
    vi.mocked(checklistRepo.getChecklistByPublicId).mockResolvedValue(
      checklist as never,
    );
    vi.mocked(
      checklistRepo.getChecklistItemByPublicIdWithChecklist,
    ).mockResolvedValue(item as never);
    vi.mocked(checklistRepo.create).mockResolvedValue({
      id: checklist.id,
      publicId: checklist.publicId,
      name: checklist.name,
    });
    vi.mocked(checklistRepo.updateChecklistById).mockResolvedValue({
      publicId: checklist.publicId,
      name: checklist.name,
    });
    vi.mocked(checklistRepo.updateItemById).mockResolvedValue({
      publicId: item.publicId,
      title: item.title,
      completed: true,
    });
    vi.mocked(checklistRepo.reorderItem).mockResolvedValue({
      publicId: item.publicId,
      title: item.title,
      completed: false,
    });
    vi.mocked(checklistRepo.softDeleteById).mockResolvedValue({ id: 30 });
    vi.mocked(checklistRepo.softDeleteItemById).mockResolvedValue({ id: 40 });
  });

  it("passes the authorized workspace into checklist creation", async () => {
    const { checklistRouter } = await import("./checklist");

    await checklistRouter.createCaller({ db, user } as never).create({
      cardPublicId: "card00000001",
      name: "Producción",
    });

    expect(assertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      card.workspaceId,
      "card:edit",
    );
    expect(checklistRepo.create).toHaveBeenCalledWith(db, {
      cardId: card.id,
      expectedWorkspaceId: card.workspaceId,
      name: "Producción",
      createdBy: user.id,
    });
  });

  it("passes the boundary and actor into item updates and reorders", async () => {
    const { checklistRouter } = await import("./checklist");

    await checklistRouter.createCaller({ db, user } as never).updateItem({
      checklistItemPublicId: item.publicId,
      title: "Guion final",
      completed: true,
      index: 1,
    });

    expect(checklistRepo.updateItemById).toHaveBeenCalledWith(db, {
      id: item.id,
      title: "Guion final",
      completed: true,
      expectedWorkspaceId: card.workspaceId,
      updatedBy: user.id,
    });
    expect(checklistRepo.reorderItem).toHaveBeenCalledWith(db, {
      itemId: item.id,
      newIndex: 1,
      expectedWorkspaceId: card.workspaceId,
    });
  });

  it("maps a post-authorization workspace change to not found", async () => {
    vi.mocked(checklistRepo.updateChecklistById).mockRejectedValueOnce(
      new WorkspaceChangedError(),
    );
    const { checklistRouter } = await import("./checklist");

    await expect(
      checklistRouter.createCaller({ db, user } as never).update({
        checklistPublicId: checklist.publicId,
        name: "No filtrar",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uses the repository's atomic checklist cascade", async () => {
    const { checklistRouter } = await import("./checklist");

    await checklistRouter.createCaller({ db, user } as never).delete({
      checklistPublicId: checklist.publicId,
    });

    const deleteInput = vi.mocked(checklistRepo.softDeleteById).mock
      .calls[0]?.[1];
    expect(deleteInput).toMatchObject({
      id: checklist.id,
      expectedWorkspaceId: card.workspaceId,
      deletedBy: user.id,
    });
    expect(deleteInput?.deletedAt).toBeInstanceOf(Date);
  });
});
