import { TRPCError } from "@trpc/server";
import { generateOpenApiDocument } from "trpc-to-openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardResourceRepo from "@kan/db/repository/cardResource.repo";
import { WorkspaceChangedError } from "@kan/db/repository/workspace-boundary";

import type * as RemoteImageRateLimitModule from "../utils/card-resource-remote-image-rate-limit";
import { createTRPCRouter } from "../trpc";
import { deleteCardResource } from "../utils/card-resource-delete";
import { normalizeDriveLink } from "../utils/card-resource-drive";
import { importRemoteCardImage } from "../utils/card-resource-remote-image";
import {
  consumeRemoteImageImportRateLimit,
  RemoteImageRateLimitError,
} from "../utils/card-resource-remote-image-rate-limit";
import { normalizeWebResourceOpenUrl } from "../utils/card-resource-web";
import { assertPermission } from "../utils/permissions";
import { fetchSafePreviewMetadata } from "../utils/safe-preview";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const originalAttachmentsBucket =
  process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;

vi.mock("@kan/logger", () => ({ createLogger: vi.fn(() => mockLogger) }));
vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/cardResource.repo", () => ({
  createDrive: vi.fn(),
  getListSnapshot: vi.fn(),
  reserveWeb: vi.fn(),
  updateWebMetadata: vi.fn(),
}));
vi.mock("../utils/card-resource-delete", () => ({
  deleteCardResource: vi.fn(),
}));
vi.mock("../utils/card-resource-remote-image", () => ({
  fetchRemoteCardImage: vi.fn(),
  importRemoteCardImage: vi.fn(),
}));
vi.mock(
  "../utils/card-resource-remote-image-rate-limit",
  async (importOriginal) => {
    const original = await importOriginal<typeof RemoteImageRateLimitModule>();
    return {
      ...original,
      consumeRemoteImageImportRateLimit: vi.fn(),
    };
  },
);
vi.mock("../utils/permissions", () => ({ assertPermission: vi.fn() }));
vi.mock("../utils/safe-preview", () => ({
  fetchSafePreviewMetadata: vi.fn(),
}));

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

describe("web card resource URLs", () => {
  it("keeps only safe HTTPS navigation URLs", () => {
    expect(
      normalizeWebResourceOpenUrl("https://example.com/research?q=kan#result"),
    ).toBe("https://example.com/research?q=kan#result");
    expect(normalizeWebResourceOpenUrl("http://example.com")).toBeNull();
    expect(normalizeWebResourceOpenUrl("https://user@example.com")).toBeNull();
    expect(normalizeWebResourceOpenUrl(" https://example.com")).toBeNull();
    expect(normalizeWebResourceOpenUrl("javascript:alert(1)")).toBeNull();
    expect(
      normalizeWebResourceOpenUrl(
        `https://example.com/research?q=${"é".repeat(700)}`,
      ),
    ).toBeNull();
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
      summary: { total: 0, uploads: 0, driveLinks: 0, webLinks: 0 },
    });
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(deleteCardResource).mockResolvedValue(undefined);
    vi.mocked(cardResourceRepo.reserveWeb).mockResolvedValue({
      status: "created",
      publicId: "webresource1",
    });
    vi.mocked(cardResourceRepo.updateWebMetadata).mockResolvedValue({
      status: "updated",
      publicId: "webresource1",
    });
    vi.mocked(fetchSafePreviewMetadata).mockRejectedValue(
      new Error("Preview unavailable"),
    );
    vi.mocked(consumeRemoteImageImportRateLimit).mockResolvedValue(undefined);
    vi.mocked(importRemoteCardImage).mockResolvedValue({
      publicId: "attachment01",
      originalFilename: "imagen-pizarra.png",
      contentType: "image/png",
      size: 24,
      createdAt: new Date("2026-08-24T12:00:00.000Z"),
    });
  });

  afterEach(() => {
    if (originalAttachmentsBucket === undefined) {
      delete process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
    } else {
      process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME =
        originalAttachmentsBucket;
    }
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
      summary: { total: 0, uploads: 0, driveLinks: 0, webLinks: 0 },
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
          webUrl: null,
          webUrlHash: null,
          webDescription: null,
          webSiteName: null,
          webImageUrl: null,
          contentType: null,
          originalFilename: null,
          size: null,
          createdAt: new Date("2026-08-21T12:00:00.000Z"),
        },
      ],
      summary: { total: 1, uploads: 0, driveLinks: 1, webLinks: 0 },
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

  it("creates a web resource from sanitized metadata and exposes only its proxy", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    const createdAt = new Date("2026-08-24T12:00:00.000Z");
    vi.mocked(fetchSafePreviewMetadata).mockResolvedValueOnce({
      resolvedUrl: "https://example.com/research",
      title: "Research notes",
      siteName: "Example",
      description: "Useful context",
      image: {
        resolvedUrl: "https://cdn.example.com/preview.png",
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
        width: 1,
        height: 1,
      },
    });
    vi.mocked(cardResourceRepo.getListSnapshot).mockResolvedValueOnce({
      resources: [
        {
          publicId: "webresource1",
          kind: "web",
          title: "Research notes",
          driveType: null,
          driveFileId: null,
          resourceKey: null,
          webUrl: "https://example.com/research?source=kan",
          webUrlHash: "a".repeat(64),
          webDescription: "Useful context",
          webSiteName: "Example",
          webImageUrl: "https://cdn.example.com/preview.png",
          contentType: null,
          originalFilename: null,
          size: null,
          createdAt,
        },
      ],
      summary: { total: 1, uploads: 0, driveLinks: 0, webLinks: 1 },
    });
    const result = await cardResourceRouter
      .createCaller({ db, user: { id: "user-1" } } as never)
      .createWebLink({
        cardPublicId: "cardpublic01",
        url: "https://example.com/research?source=kan",
        publicVisibilityAcknowledged: true,
      });

    expect(assertPermission).toHaveBeenCalledWith(
      db,
      "user-1",
      card.workspaceId,
      "card:edit",
    );
    expect(cardResourceRepo.reserveWeb).toHaveBeenCalledWith(db, {
      cardId: card.id,
      expectedWorkspaceId: card.workspaceId,
      webUrl: "https://example.com/research?source=kan",
      fallbackTitle: "example.com",
      createdBy: "user-1",
      publicVisibilityAcknowledged: true,
    });
    expect(cardResourceRepo.updateWebMetadata).toHaveBeenCalledWith(db, {
      cardId: card.id,
      expectedWorkspaceId: card.workspaceId,
      resourcePublicId: "webresource1",
      title: "Research notes",
      description: "Useful context",
      siteName: "Example",
      imageUrl: "https://cdn.example.com/preview.png",
    });
    expect(result).toEqual({
      publicId: "webresource1",
      kind: "web",
      title: "Research notes",
      openUrl: "https://example.com/research?source=kan",
      description: "Useful context",
      siteName: "Example",
      previewImageUrl: "/api/resources/webresource1/preview-image",
      createdAt,
    });
    expect(JSON.stringify(result)).not.toContain("cdn.example.com");
  });

  it("saves an HTTPS fallback when unfurl is blocked or unavailable", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    const createdAt = new Date("2026-08-24T12:00:00.000Z");
    vi.mocked(cardResourceRepo.getListSnapshot).mockResolvedValueOnce({
      resources: [
        {
          publicId: "webresource1",
          kind: "web",
          title: "127.0.0.1",
          driveType: null,
          driveFileId: null,
          resourceKey: null,
          webUrl: "https://127.0.0.1/private?secret=value",
          webUrlHash: "b".repeat(64),
          webDescription: null,
          webSiteName: "127.0.0.1",
          webImageUrl: null,
          contentType: null,
          originalFilename: null,
          size: null,
          createdAt,
        },
      ],
      summary: { total: 1, uploads: 0, driveLinks: 0, webLinks: 1 },
    });

    const result = await cardResourceRouter
      .createCaller({ db, user: { id: "user-1" } } as never)
      .createWebLink({
        cardPublicId: "cardpublic01",
        url: "https://127.0.0.1/private?secret=value",
        publicVisibilityAcknowledged: true,
      });

    expect(fetchSafePreviewMetadata).toHaveBeenCalledWith(
      "https://127.0.0.1/private?secret=value",
    );
    expect(cardResourceRepo.reserveWeb).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        webUrl: "https://127.0.0.1/private?secret=value",
        fallbackTitle: "127.0.0.1",
      }),
    );
    expect(cardResourceRepo.updateWebMetadata).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: "web",
      title: "127.0.0.1",
      previewImageUrl: null,
    });
  });

  it("returns an existing web resource before starting another unfurl", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    const createdAt = new Date("2026-08-24T12:00:00.000Z");
    vi.mocked(cardResourceRepo.reserveWeb).mockResolvedValueOnce({
      status: "existing",
      publicId: "webresource1",
    });
    vi.mocked(cardResourceRepo.getListSnapshot).mockResolvedValueOnce({
      resources: [
        {
          publicId: "webresource1",
          kind: "web",
          title: "Existing research",
          driveType: null,
          driveFileId: null,
          resourceKey: null,
          webUrl: "https://example.com/research",
          webUrlHash: "a".repeat(64),
          webDescription: null,
          webSiteName: "Example",
          webImageUrl: null,
          contentType: null,
          originalFilename: null,
          size: null,
          createdAt,
        },
      ],
      summary: { total: 1, uploads: 0, driveLinks: 0, webLinks: 1 },
    });

    await expect(
      cardResourceRouter
        .createCaller({ db, user: { id: "user-1" } } as never)
        .createWebLink({
          cardPublicId: "cardpublic01",
          url: "https://example.com/research",
          publicVisibilityAcknowledged: true,
        }),
    ).resolves.toMatchObject({
      publicId: "webresource1",
      kind: "web",
      openUrl: "https://example.com/research",
    });
    expect(assertPermission).toHaveBeenCalledTimes(2);
    expect(fetchSafePreviewMetadata).not.toHaveBeenCalled();
    expect(cardResourceRepo.updateWebMetadata).not.toHaveBeenCalled();
  });

  it("unfurls exactly once when concurrent replicas reserve the same URL", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    const createdAt = new Date("2026-08-24T12:00:00.000Z");
    let reservationIndex = 0;
    vi.mocked(cardResourceRepo.reserveWeb).mockImplementation(() => {
      reservationIndex += 1;
      return Promise.resolve(
        reservationIndex === 1
          ? { status: "created", publicId: "webresource1" }
          : { status: "existing", publicId: "webresource1" },
      );
    });
    vi.mocked(cardResourceRepo.getListSnapshot).mockResolvedValue({
      resources: [
        {
          publicId: "webresource1",
          kind: "web",
          title: "example.com",
          driveType: null,
          driveFileId: null,
          resourceKey: null,
          webUrl: "https://example.com/concurrent",
          webUrlHash: "a".repeat(64),
          webDescription: null,
          webSiteName: "example.com",
          webImageUrl: null,
          contentType: null,
          originalFilename: null,
          size: null,
          createdAt,
        },
      ],
      summary: { total: 1, uploads: 0, driveLinks: 0, webLinks: 1 },
    });
    vi.mocked(fetchSafePreviewMetadata).mockResolvedValueOnce({
      resolvedUrl: "https://example.com/concurrent",
      title: "Concurrent research",
      siteName: "Example",
      description: "Fetched once",
      image: null,
    });
    const caller = cardResourceRouter.createCaller({
      db,
      user: { id: "user-1" },
    } as never);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        caller.createWebLink({
          cardPublicId: "cardpublic01",
          url: "https://example.com/concurrent",
          publicVisibilityAcknowledged: true,
        }),
      ),
    );

    expect(results).toHaveLength(8);
    expect(cardResourceRepo.reserveWeb).toHaveBeenCalledTimes(8);
    expect(fetchSafePreviewMetadata).toHaveBeenCalledTimes(1);
    expect(cardResourceRepo.updateWebMetadata).toHaveBeenCalledTimes(1);
  });

  it("enforces edit permission, public acknowledgement and the web cap", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    const caller = cardResourceRouter.createCaller({
      db,
      user: { id: "read-only-user" },
    } as never);
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("Permission denied"),
    );
    await expect(
      caller.createWebLink({
        cardPublicId: "cardpublic01",
        url: "https://example.com/private",
        publicVisibilityAcknowledged: true,
      }),
    ).rejects.toThrow("Permission denied");
    expect(fetchSafePreviewMetadata).not.toHaveBeenCalled();
    expect(cardResourceRepo.reserveWeb).not.toHaveBeenCalled();

    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(
      cardRepo.getWorkspaceAndCardIdByCardPublicId,
    ).mockResolvedValueOnce({
      ...card,
      workspaceVisibility: "public",
    } as never);
    await expect(
      caller.createWebLink({
        cardPublicId: "cardpublic01",
        url: "https://example.com/public",
        publicVisibilityAcknowledged: false,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED",
    });
    expect(fetchSafePreviewMetadata).not.toHaveBeenCalled();

    vi.mocked(cardResourceRepo.reserveWeb).mockResolvedValueOnce({
      status: "limit_reached",
    });
    await expect(
      caller.createWebLink({
        cardPublicId: "cardpublic01",
        url: "https://example.com/clearly-over-limit",
        publicVisibilityAcknowledged: true,
      }),
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "WEB_RESOURCE_LIMIT_REACHED",
    });
    expect(fetchSafePreviewMetadata).not.toHaveBeenCalled();
    expect(cardResourceRepo.updateWebMetadata).not.toHaveBeenCalled();
  });

  it("stops before unfurl when the reservation workspace changed", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    vi.mocked(cardResourceRepo.reserveWeb).mockRejectedValueOnce(
      new WorkspaceChangedError(),
    );

    await expect(
      cardResourceRouter
        .createCaller({ db, user: { id: "user-1" } } as never)
        .createWebLink({
          cardPublicId: "cardpublic01",
          url: "https://example.com/research",
          publicVisibilityAcknowledged: true,
        }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "CARD_NOT_FOUND" });
    expect(fetchSafePreviewMetadata).not.toHaveBeenCalled();
    expect(cardResourceRepo.updateWebMetadata).not.toHaveBeenCalled();
  });

  it("rechecks card:edit after unfurl before updating reserved metadata", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    vi.mocked(assertPermission)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new Error("Permission revoked while preview was fetched"),
      );

    await expect(
      cardResourceRouter
        .createCaller({ db, user: { id: "user-1" } } as never)
        .createWebLink({
          cardPublicId: "cardpublic01",
          url: "https://example.com/research",
          publicVisibilityAcknowledged: true,
        }),
    ).rejects.toThrow("Permission revoked while preview was fetched");
    expect(fetchSafePreviewMetadata).toHaveBeenCalledOnce();
    expect(assertPermission).toHaveBeenCalledTimes(2);
    expect(cardResourceRepo.reserveWeb).toHaveBeenCalledOnce();
    expect(cardResourceRepo.updateWebMetadata).not.toHaveBeenCalled();
  });

  it.each(["reserve", "metadata", "snapshot"] as const)(
    "redacts an unexpected %s database failure from response and logs",
    async (stage) => {
      const { cardResourceRouter } = await import("./card-resource");
      const router = createTRPCRouter({ cardResource: cardResourceRouter });
      const privateMarker =
        "PRIVATE_DB_PARAM:https://example.com/private?token=SECRET_QUERY";
      if (stage === "reserve") {
        vi.mocked(cardResourceRepo.reserveWeb).mockRejectedValueOnce(
          new Error(`Failed query params: ${privateMarker}`),
        );
      } else if (stage === "metadata") {
        vi.mocked(fetchSafePreviewMetadata).mockResolvedValueOnce({
          resolvedUrl: "https://example.com/private",
          title: "Private",
          siteName: "Example",
          description: null,
          image: null,
        });
        vi.mocked(cardResourceRepo.updateWebMetadata).mockRejectedValueOnce(
          new Error(`Failed query params: ${privateMarker}`),
        );
      } else {
        vi.mocked(cardResourceRepo.getListSnapshot).mockRejectedValueOnce(
          new Error(`Failed query params: ${privateMarker}`),
        );
      }

      const error = await router
        .createCaller({ db, user: { id: "user-1" } } as never)
        .cardResource.createWebLink({
          cardPublicId: "cardpublic01",
          url: "https://example.com/private?token=SECRET_QUERY",
          publicVisibilityAcknowledged: true,
        })
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "WEB_RESOURCE_CREATE_FAILED",
      });
      expect(JSON.stringify(error)).not.toContain(privateMarker);
      expect(JSON.stringify(error)).not.toContain("SECRET_QUERY");
      const logs = JSON.stringify(mockLogger.error.mock.calls);
      expect(logs).toContain("cardResource.createWebLink");
      expect(logs).not.toContain(privateMarker);
      expect(logs).not.toContain("SECRET_QUERY");
    },
  );

  it("maps stored web metadata without exposing the remote preview URL", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    vi.mocked(cardResourceRepo.getListSnapshot).mockResolvedValueOnce({
      resources: [
        {
          publicId: "webresource1",
          kind: "web",
          title: "Research notes",
          driveType: null,
          driveFileId: null,
          resourceKey: null,
          webUrl: "https://example.com/research?source=kan",
          webUrlHash: "a".repeat(64),
          webDescription: "Private working context",
          webSiteName: "Example",
          webImageUrl: "https://cdn.example.com/private-preview.png",
          contentType: null,
          originalFilename: null,
          size: null,
          createdAt: new Date("2026-08-24T12:00:00.000Z"),
        },
      ],
      summary: { total: 1, uploads: 0, driveLinks: 0, webLinks: 1 },
    });

    const result = await cardResourceRouter
      .createCaller({ db, user: { id: "user-1" } } as never)
      .list({ cardPublicId: "cardpublic01" });

    expect(result.resources).toEqual([
      {
        publicId: "webresource1",
        kind: "web",
        title: "Research notes",
        openUrl: "https://example.com/research?source=kan",
        description: "Private working context",
        siteName: "Example",
        previewImageUrl: "/api/resources/webresource1/preview-image",
        createdAt: new Date("2026-08-24T12:00:00.000Z"),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("cdn.example.com");
    expect(JSON.stringify(result)).not.toContain("webImageUrl");
  });

  it("imports a remote image only after edit permission and rate limiting", async () => {
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = "attachments";
    const { cardResourceRouter } = await import("./card-resource");

    const result = await cardResourceRouter
      .createCaller({ db, user: { id: "user-1" } } as never)
      .importRemoteImage({
        cardPublicId: "cardpublic01",
        url: "https://images.example.com/private.png?token=secret",
        publicVisibilityAcknowledged: true,
      });

    expect(assertPermission).toHaveBeenCalledWith(
      db,
      "user-1",
      card.workspaceId,
      "card:edit",
    );
    expect(consumeRemoteImageImportRateLimit).toHaveBeenCalledWith(
      "user-1",
      "cardpublic01",
    );
    expect(importRemoteCardImage).toHaveBeenCalledOnce();
    const importCall = vi.mocked(importRemoteCardImage).mock.calls[0];
    expect(importCall?.[0]).toBe(
      "https://images.example.com/private.png?token=secret",
    );
    expect(typeof importCall?.[1].fetchImage).toBe("function");
    expect(typeof importCall?.[1].createUpload).toBe("function");
    expect(typeof importCall?.[1].writeStagingObject).toBe("function");
    expect(typeof importCall?.[1].confirmUpload).toBe("function");
    expect(typeof importCall?.[1].discardUpload).toBe("function");
    expect(result).toEqual({
      kind: "upload",
      publicId: "attachment01",
      title: "imagen-pizarra.png",
      originalFilename: "imagen-pizarra.png",
      contentType: "image/png",
      size: 24,
      viewUrl: "/api/attachments/attachment01/view",
      downloadUrl: "/api/attachments/attachment01/download",
      createdAt: new Date("2026-08-24T12:00:00.000Z"),
    });
  });

  it("stops before network import without permission or public acknowledgement", async () => {
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = "attachments";
    const { cardResourceRouter } = await import("./card-resource");
    const caller = cardResourceRouter.createCaller({
      db,
      user: { id: "user-1" },
    } as never);

    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("Permission denied"),
    );
    await expect(
      caller.importRemoteImage({
        cardPublicId: "cardpublic01",
        url: "https://images.example.com/private.png",
        publicVisibilityAcknowledged: true,
      }),
    ).rejects.toThrow("Permission denied");
    expect(consumeRemoteImageImportRateLimit).not.toHaveBeenCalled();
    expect(importRemoteCardImage).not.toHaveBeenCalled();

    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(
      cardRepo.getWorkspaceAndCardIdByCardPublicId,
    ).mockResolvedValueOnce({
      ...card,
      workspaceVisibility: "public",
    } as never);
    await expect(
      caller.importRemoteImage({
        cardPublicId: "cardpublic01",
        url: "https://images.example.com/private.png",
        publicVisibilityAcknowledged: false,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "PUBLIC_VISIBILITY_ACKNOWLEDGEMENT_REQUIRED",
    });
    expect(consumeRemoteImageImportRateLimit).not.toHaveBeenCalled();
    expect(importRemoteCardImage).not.toHaveBeenCalled();
  });

  it("returns a safe response when the remote image limit is reached", async () => {
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = "attachments";
    vi.mocked(consumeRemoteImageImportRateLimit).mockRejectedValueOnce(
      new RemoteImageRateLimitError("LIMIT_EXCEEDED"),
    );
    const { cardResourceRouter } = await import("./card-resource");

    await expect(
      cardResourceRouter
        .createCaller({ db, user: { id: "user-1" } } as never)
        .importRemoteImage({
          cardPublicId: "cardpublic01",
          url: "https://images.example.com/private.png?token=secret",
          publicVisibilityAcknowledged: true,
        }),
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "REMOTE_IMAGE_RATE_LIMIT_REACHED",
    });
    expect(importRemoteCardImage).not.toHaveBeenCalled();
  });

  it("redacts the remote URL and unexpected import failures", async () => {
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = "attachments";
    const privateMarker =
      "PRIVATE_REMOTE_IMAGE:https://images.example.com/file.png?token=SECRET";
    vi.mocked(importRemoteCardImage).mockRejectedValueOnce(
      new Error(privateMarker),
    );
    const { cardResourceRouter } = await import("./card-resource");
    const router = createTRPCRouter({ cardResource: cardResourceRouter });

    const error = await router
      .createCaller({ db, user: { id: "user-1" } } as never)
      .cardResource.importRemoteImage({
        cardPublicId: "cardpublic01",
        url: "https://images.example.com/file.png?token=SECRET",
        publicVisibilityAcknowledged: true,
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "REMOTE_IMAGE_IMPORT_FAILED",
    });
    expect(JSON.stringify(error)).not.toContain(privateMarker);
    expect(JSON.stringify(error)).not.toContain("SECRET");
    const logs = JSON.stringify(mockLogger.error.mock.calls);
    expect(logs).toContain("cardResource.importRemoteImage");
    expect(logs).not.toContain(privateMarker);
    expect(logs).not.toContain("SECRET");
  });

  it("sanitizes nested attachment TRPC errors and causes", async () => {
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = "attachments";
    const privateMarker = "PRIVATE_NESTED_ATTACHMENT_ERROR";
    vi.mocked(importRemoteCardImage).mockRejectedValueOnce(
      new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: privateMarker,
        cause: new Error(`${privateMarker}:S3_CAUSE`),
      }),
    );
    const { cardResourceRouter } = await import("./card-resource");

    const error = await cardResourceRouter
      .createCaller({ db, user: { id: "user-1" } } as never)
      .importRemoteImage({
        cardPublicId: "cardpublic01",
        url: "https://images.example.com/file.png",
        publicVisibilityAcknowledged: true,
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "REMOTE_IMAGE_IMPORT_FAILED",
    });
    expect(JSON.stringify(error)).not.toContain(privateMarker);
    expect(JSON.stringify(error)).not.toContain("S3_CAUSE");
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
      "/cards/{cardPublicId}/resources/remote-image",
      "/cards/{cardPublicId}/resources/upload",
      "/cards/{cardPublicId}/resources/upload/confirm",
      "/cards/{cardPublicId}/resources/web",
      "/resources/{resourcePublicId}",
    ]);
  });

  it("publishes remote image imports as upload resources", async () => {
    const { cardResourceRouter } = await import("./card-resource");
    const document = generateOpenApiDocument(
      createTRPCRouter({ cardResource: cardResourceRouter }),
      {
        title: "Resources",
        version: "1.0.0",
        baseUrl: "https://example.test/api/v1",
      },
    );
    const response = document.paths?.[
      "/cards/{cardPublicId}/resources/remote-image"
    ]?.post?.responses?.[200] as {
      content?: Record<
        string,
        {
          schema?: {
            oneOf?: unknown;
            properties?: Record<string, unknown>;
            required?: string[];
            type?: string;
          };
        }
      >;
    };
    const schema = response.content?.["application/json"]?.schema;

    expect(schema).toMatchObject({
      type: "object",
      properties: {
        kind: { type: "string", enum: ["upload"] },
      },
    });
    expect(schema).not.toHaveProperty("oneOf");
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      "contentType",
      "createdAt",
      "downloadUrl",
      "kind",
      "originalFilename",
      "publicId",
      "size",
      "title",
      "viewUrl",
    ]);
    expect([...(schema?.required ?? [])].sort()).toEqual([
      "contentType",
      "createdAt",
      "downloadUrl",
      "kind",
      "originalFilename",
      "publicId",
      "size",
      "title",
      "viewUrl",
    ]);
  });
});
