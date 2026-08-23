import { generateOpenApiDocument } from "trpc-to-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardResourceRepo from "@kan/db/repository/cardResource.repo";

import { createTRPCRouter } from "../trpc";
import { deleteCardResource } from "../utils/card-resource-delete";
import { normalizeDriveLink } from "../utils/card-resource-drive";
import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/cardResource.repo", () => ({
  createDrive: vi.fn(),
  getListSnapshot: vi.fn(),
}));
vi.mock("../utils/card-resource-delete", () => ({
  deleteCardResource: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({ assertPermission: vi.fn() }));

describe("Google Drive card resource URLs", () => {
  it.each([
    [
      "https://drive.google.com/file/d/DriveFileId12345/view?usp=drive_link&resourcekey=Key_123",
      "file",
    ],
    [
      "https://docs.google.com/document/d/DocumentId12345/edit?usp=sharing",
      "document",
    ],
    [
      "https://docs.google.com/spreadsheets/d/SheetFileId12345/preview",
      "spreadsheet",
    ],
    [
      "https://docs.google.com/presentation/d/SlidesFileId12345/edit",
      "presentation",
    ],
  ])("normalizes an exact Google URL", (url, driveType) => {
    const result = normalizeDriveLink(url);
    expect(result.driveType).toBe(driveType);
    expect(result.openUrl).toMatch(/^https:\/\/(drive|docs)\.google\.com\//);
    expect(result.previewUrl).toMatch(/^https:\/\/(drive|docs)\.google\.com\//);
    expect(result.openUrl).not.toContain("usp=");
  });

  it("preserves only a validated Google resource key", () => {
    const result = normalizeDriveLink(
      "https://drive.google.com/file/d/DriveFileId12345/view?resourcekey=Key_123",
    );
    expect(result.resourceKey).toBe("Key_123");
    expect(result.openUrl).toContain("resourcekey=Key_123");
    expect(result.previewUrl).toContain("resourcekey=Key_123");
  });

  it.each([
    "http://drive.google.com/file/d/DriveFileId12345/view",
    "https://drive.google.com.evil.test/file/d/DriveFileId12345/view",
    "https://drive.google.com:443/file/d/DriveFileId12345/view",
    "https://user@drive.google.com/file/d/DriveFileId12345/view",
    "https://drive.google.com/drive/folders/FolderFileId12345",
    "https://drive.google.com/open?id=DriveFileId12345",
    "https://drive.google.com/file/d/DriveFileId12345/view?next=https://evil.test",
    "https://drive.google.com/file/d/DriveFileId12345/view?resourcekey=One&resourcekey=Two",
    "https://drive.google.com/file/d/DriveFileId12345/view#fragment",
    "https://docs.google.com/document/d/DocumentId12345/edit/extra",
    "https://drive.google.com/file/d/DriveFileId%2F12345/view",
  ])("rejects an adversarial URL: %s", (url) => {
    expect(() => normalizeDriveLink(url)).toThrowError("INVALID_DRIVE_URL");
  });
});

describe("cardResource router access", () => {
  const db = {} as never;
  const card = {
    id: 10,
    workspaceId: 20,
    workspaceVisibility: "private",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue(
      card as never,
    );
    vi.mocked(cardResourceRepo.getListSnapshot).mockResolvedValue({
      resources: [],
      summary: { total: 0, uploads: 0, driveLinks: 0 },
    });
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(deleteCardResource).mockResolvedValue(undefined);
  });

  it("allows anonymous reads only when the locked board is public", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    await expect(
      cardResourceRouter.createCaller({ db, user: null } as never).list({
        cardPublicId: "cardpublic01",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue({
      ...card,
      workspaceVisibility: "public",
    } as never);
    await expect(
      cardResourceRouter.createCaller({ db, user: null } as never).list({
        cardPublicId: "cardpublic01",
      }),
    ).resolves.toEqual({
      resources: [],
      summary: { total: 0, uploads: 0, driveLinks: 0 },
    });
    expect(cardResourceRepo.getListSnapshot).toHaveBeenCalledWith(db, {
      cardId: card.id,
      expectedWorkspaceId: card.workspaceId,
      requirePublic: true,
    });
  });

  it("does not coerce a REST query value of false into deletion confirmation", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    const caller = cardResourceRouter.createCaller({
      db,
      user: { id: "user-1" },
    } as never);
    await expect(
      caller.delete({
        resourcePublicId: "resource0001",
        removeReferences: "false",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(deleteCardResource).not.toHaveBeenCalled();

    await caller.delete({
      resourcePublicId: "resource0001",
      removeReferences: "true",
    });
    expect(deleteCardResource).toHaveBeenCalledWith(db, {
      userId: "user-1",
      resourcePublicId: "resource0001",
      removeReferences: true,
      canvasAction: undefined,
      expectedCanvasVersion: undefined,
    });
  });

  it("passes an explicit canvas deletion strategy and safe CAS version", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    const caller = cardResourceRouter.createCaller({
      db,
      user: { id: "user-1" },
    } as never);

    await caller.delete({
      resourcePublicId: "resource0001",
      removeReferences: "true",
      canvasAction: "replace",
      expectedCanvasVersion: "12",
    });

    expect(deleteCardResource).toHaveBeenCalledWith(db, {
      userId: "user-1",
      resourcePublicId: "resource0001",
      removeReferences: true,
      canvasAction: "replace",
      expectedCanvasVersion: 12,
    });
  });

  it("rejects ambiguous or invalid canvas versions", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    const caller = cardResourceRouter.createCaller({
      db,
      user: { id: "user-1" },
    } as never);

    await expect(
      caller.delete({
        resourcePublicId: "resource0001",
        removeReferences: "true",
        canvasAction: "remove",
        expectedCanvasVersion: "1e2",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(deleteCardResource).not.toHaveBeenCalled();
  });

  it("returns only public Drive fields and maps public acknowledgement", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    const caller = cardResourceRouter.createCaller({
      db,
      user: { id: "user-1" },
    } as never);
    vi.mocked(cardResourceRepo.createDrive).mockResolvedValueOnce({
      status: "public_ack_required",
    });
    await expect(
      caller.createDriveLink({
        cardPublicId: "cardpublic01",
        url: "https://docs.google.com/document/d/DocumentId12345/edit",
        publicVisibilityAcknowledged: false,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED",
    });

    vi.mocked(cardResourceRepo.createDrive).mockResolvedValueOnce({
      status: "created",
      publicId: "resource0001",
    });
    vi.mocked(cardResourceRepo.getListSnapshot).mockResolvedValueOnce({
      resources: [
        {
          publicId: "resource0001",
          kind: "drive",
          title: "Document",
          driveType: "document",
          driveFileId: "DocumentId12345",
          resourceKey: "Key_123",
          contentType: null,
          originalFilename: null,
          size: null,
          createdAt: new Date("2026-08-21T12:00:00.000Z"),
        },
      ],
      summary: { total: 1, uploads: 0, driveLinks: 1 },
    });
    const result = await caller.createDriveLink({
      cardPublicId: "cardpublic01",
      url: "https://docs.google.com/document/d/DocumentId12345/edit?resourcekey=Key_123",
      publicVisibilityAcknowledged: true,
    });

    expect(result).toMatchObject({
      publicId: "resource0001",
      kind: "drive",
      title: "Document",
      driveType: "document",
    });
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("cardId");
    expect(result).not.toHaveProperty("driveFileId");
    expect(result).not.toHaveProperty("resourceKey");
    if (result.kind !== "drive") throw new Error("Drive resource expected");
    expect(result.openUrl).toContain("resourcekey=Key_123");
  });

  it("publishes every resource adapter in the OpenAPI document", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    const document = generateOpenApiDocument(
      createTRPCRouter({ cardResource: cardResourceRouter }),
      {
        title: "Resources",
        version: "1.0.0",
        baseUrl: "https://example.test/api/v1",
      },
    );

    expect(Object.keys(document.paths ?? {}).sort()).toEqual([
      "/cards/{cardPublicId}/resources",
      "/cards/{cardPublicId}/resources/drive",
      "/cards/{cardPublicId}/resources/upload",
      "/cards/{cardPublicId}/resources/upload/confirm",
      "/resources/{resourcePublicId}",
    ]);
  });
});
