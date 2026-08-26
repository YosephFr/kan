import { TRPCError } from "@trpc/server";
import { generateOpenApiDocument } from "trpc-to-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as SharedUtils from "@kan/shared/utils";
import { WorkspacePermissionChangedError } from "@kan/db/repository/workspace-boundary";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import * as workspaceCanvasImageRepo from "@kan/db/repository/workspaceCanvasImage.repo";
import { deleteObject } from "@kan/shared/utils";

import type * as RemoteImage from "../utils/card-resource-remote-image";
import type * as ImageRateLimit from "../utils/workspace-canvas-image-rate-limit";
import type * as ImageUpload from "../utils/workspace-canvas-image-upload";
import { createTRPCRouter } from "../trpc";
import { importRemoteCardImage } from "../utils/card-resource-remote-image";
import { assertPermission } from "../utils/permissions";
import {
  consumeWorkspaceCanvasImageRateLimit,
  WorkspaceCanvasImageRateLimitError,
} from "../utils/workspace-canvas-image-rate-limit";
import {
  confirmWorkspaceCanvasImageUpload,
  createWorkspaceCanvasImageUpload,
} from "../utils/workspace-canvas-image-upload";

vi.mock("@kan/db/repository/workspace.repo", () => ({
  getByPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/workspaceCanvas.repo", () => ({
  getSnapshot: vi.fn(),
  save: vi.fn(),
  listRevisions: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("@kan/db/repository/workspaceCanvasImage.repo", () => ({
  listByWorkspacePublicId: vi.fn(),
  deleteUnissuedUploadSession: vi.fn(),
  preflightImageImport: vi.fn(),
  softDeleteUnreferenced: vi.fn(),
  listPendingWorkspaceCanvasStorageDeletionKeys: vi.fn(),
  markWorkspaceCanvasImageStorageDeleted: vi.fn(),
  markWorkspaceCanvasStorageDeletionAttempted: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({
  assertPermission: vi.fn(),
  hasPermission: vi.fn(),
}));
vi.mock("../utils/card-resource-remote-image", async (importOriginal) => {
  const actual = await importOriginal<typeof RemoteImage>();
  return {
    ...actual,
    fetchRemoteCardImage: vi.fn(),
    importRemoteCardImage: vi.fn(),
  };
});
vi.mock(
  "../utils/workspace-canvas-image-rate-limit",
  async (importOriginal) => {
    const actual = await importOriginal<typeof ImageRateLimit>();
    return {
      ...actual,
      consumeWorkspaceCanvasImageRateLimit: vi.fn(),
    };
  },
);
vi.mock("../utils/workspace-canvas-image-upload", async (importOriginal) => {
  const actual = await importOriginal<typeof ImageUpload>();
  return {
    ...actual,
    createWorkspaceCanvasImageUpload: vi.fn(),
    confirmWorkspaceCanvasImageUpload: vi.fn(),
  };
});
vi.mock("@kan/shared/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof SharedUtils>();
  return { ...actual, deleteObject: vi.fn(), putObject: vi.fn() };
});

const db = {} as never;
const user = {
  id: "3b0f4baf-aac9-4c7a-aef2-36e03d764e63",
  name: "Admin",
  email: "admin@example.com",
};
const workspacePublicId = "workspace001";
const workspace = {
  id: 20,
  publicId: workspacePublicId,
  deletedAt: null,
};
const image = {
  publicId: "canvasimg001",
  title: "Meta",
  originalFilename: "meta.png",
  contentType: "image/png",
  size: 128,
  createdAt: new Date("2026-08-26T12:00:00.000Z"),
};

describe("workspace canvas image router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = "attachments";
    vi.mocked(workspaceRepo.getByPublicId).mockResolvedValue(
      workspace as never,
    );
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(
      workspaceCanvasImageRepo.listByWorkspacePublicId,
    ).mockResolvedValue([image]);
    vi.mocked(
      workspaceCanvasImageRepo.listPendingWorkspaceCanvasStorageDeletionKeys,
    ).mockResolvedValue([]);
    vi.mocked(
      workspaceCanvasImageRepo.markWorkspaceCanvasStorageDeletionAttempted,
    ).mockResolvedValue([]);
    vi.mocked(createWorkspaceCanvasImageUpload).mockResolvedValue({
      url: "https://storage.example/upload",
      uploadSessionPublicId: "uploadsess01",
      expiresAt: new Date("2026-08-26T12:10:00.000Z"),
    });
    vi.mocked(confirmWorkspaceCanvasImageUpload).mockResolvedValue(image);
    vi.mocked(consumeWorkspaceCanvasImageRateLimit).mockResolvedValue(
      undefined,
    );
    vi.mocked(workspaceCanvasImageRepo.preflightImageImport).mockResolvedValue({
      status: "available",
    });
    vi.mocked(importRemoteCardImage).mockResolvedValue(image);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(
      workspaceCanvasImageRepo.markWorkspaceCanvasImageStorageDeleted,
    ).mockResolvedValue([]);
  });

  it("lists only after checking workspace view permission", async () => {
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter.createCaller({ db, user } as never).listImages({
        workspacePublicId,
        imagePublicIds: [image.publicId],
      }),
    ).resolves.toEqual({
      images: [
        {
          kind: "upload",
          ...image,
          viewUrl: "/api/workspace-canvas-images/canvasimg001",
          downloadUrl: "/api/workspace-canvas-images/canvasimg001",
        },
      ],
    });
    expect(assertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      workspace.id,
      "workspace:view",
    );
  });

  it("rejects view permission revoked inside the list transaction", async () => {
    vi.mocked(
      workspaceCanvasImageRepo.listByWorkspacePublicId,
    ).mockRejectedValueOnce(new WorkspacePermissionChangedError());
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter.createCaller({ db, user } as never).listImages({
        workspacePublicId,
        imagePublicIds: [image.publicId],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates and confirms upload sessions with edit permission", async () => {
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    const caller = workspaceCanvasRouter.createCaller({ db, user } as never);
    await caller.createImageUpload({
      workspacePublicId,
      filename: "meta.png",
      contentType: "image/png",
      size: 128,
      sha256: "a".repeat(64),
    });
    await caller.confirmImageUpload({
      workspacePublicId,
      uploadSessionPublicId: "uploadsess01",
    });
    expect(createWorkspaceCanvasImageUpload).toHaveBeenCalledWith(db, {
      workspacePublicId,
      filename: "meta.png",
      contentType: "image/png",
      size: 128,
      sha256: "a".repeat(64),
      userId: user.id,
    });
    expect(confirmWorkspaceCanvasImageUpload).toHaveBeenCalledWith(db, {
      workspacePublicId,
      uploadSessionPublicId: "uploadsess01",
      userId: user.id,
    });
    expect(assertPermission).toHaveBeenNthCalledWith(
      1,
      db,
      user.id,
      workspace.id,
      "workspace:edit",
    );
    expect(assertPermission).toHaveBeenNthCalledWith(
      2,
      db,
      user.id,
      workspace.id,
      "workspace:edit",
    );
  });

  it("rate limits remote imports before starting the fetch", async () => {
    vi.mocked(consumeWorkspaceCanvasImageRateLimit).mockRejectedValueOnce(
      new WorkspaceCanvasImageRateLimitError("LIMIT_EXCEEDED"),
    );
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter
        .createCaller({ db, user } as never)
        .importRemoteImage({
          workspacePublicId,
          url: "https://images.example/meta.png",
        }),
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "WORKSPACE_CANVAS_IMAGE_RATE_LIMIT_REACHED",
    });
    expect(importRemoteCardImage).not.toHaveBeenCalled();
  });

  it("rejects an exhausted image budget before starting the fetch", async () => {
    vi.mocked(
      workspaceCanvasImageRepo.preflightImageImport,
    ).mockResolvedValueOnce({
      status: "image_budget",
    });
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter
        .createCaller({ db, user } as never)
        .importRemoteImage({
          workspacePublicId,
          url: "https://images.example/meta.png",
        }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "WORKSPACE_CANVAS_IMAGE_TOTAL_LIMIT_REACHED",
    });
    expect(importRemoteCardImage).not.toHaveBeenCalled();
  });

  it("rejects an exhausted physical budget before starting the fetch", async () => {
    vi.mocked(
      workspaceCanvasImageRepo.preflightImageImport,
    ).mockResolvedValueOnce({ status: "storage_limit" });
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter
        .createCaller({ db, user } as never)
        .importRemoteImage({
          workspacePublicId,
          url: "https://images.example/meta.png",
        }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "WORKSPACE_CANVAS_IMAGE_STORAGE_LIMIT_REACHED",
    });
    expect(importRemoteCardImage).not.toHaveBeenCalled();
  });

  it("maps unexpected remote import failures to a generic error", async () => {
    vi.mocked(importRemoteCardImage).mockRejectedValueOnce(
      new Error("https://private.example/image.png?secret=value"),
    );
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter
        .createCaller({ db, user } as never)
        .importRemoteImage({
          workspacePublicId,
          url: "https://private.example/image.png?secret=value",
        }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "WORKSPACE_CANVAS_IMAGE_IMPORT_FAILED",
    });
  });

  it("rejects deletion while an image is referenced", async () => {
    vi.mocked(
      workspaceCanvasImageRepo.softDeleteUnreferenced,
    ).mockResolvedValue({ status: "referenced" });
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter.createCaller({ db, user } as never).deleteImage({
        workspacePublicId,
        imagePublicId: image.publicId,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "WORKSPACE_CANVAS_IMAGE_STILL_REFERENCED",
    });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("soft deletes an unreferenced image before storage cleanup", async () => {
    vi.mocked(
      workspaceCanvasImageRepo.softDeleteUnreferenced,
    ).mockResolvedValue({ status: "deleted", s3Key: ".objects/canvasimg001" });
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter.createCaller({ db, user } as never).deleteImage({
        workspacePublicId,
        imagePublicId: image.publicId,
      }),
    ).resolves.toEqual({ success: true });
    expect(
      workspaceCanvasImageRepo.softDeleteUnreferenced,
    ).toHaveBeenCalledWith(db, {
      workspacePublicId,
      imagePublicId: image.publicId,
      userId: user.id,
    });
    expect(deleteObject).toHaveBeenCalledWith(
      "attachments",
      ".objects/canvasimg001",
    );
  });

  it("does not expose lower-level errors from remote import", async () => {
    vi.mocked(importRemoteCardImage).mockRejectedValueOnce(
      new TRPCError({ code: "BAD_REQUEST", message: "PRIVATE_URL_VALUE" }),
    );
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    await expect(
      workspaceCanvasRouter
        .createCaller({ db, user } as never)
        .importRemoteImage({
          workspacePublicId,
          url: "https://private.example/image.png",
        }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "WORKSPACE_CANVAS_REMOTE_IMAGE_INVALID",
    });
  });

  it("publishes the workspace image adapters in OpenAPI", async () => {
    const { workspaceCanvasRouter } = await import("./workspace-canvas");
    const document = generateOpenApiDocument(
      createTRPCRouter({ workspaceCanvas: workspaceCanvasRouter }),
      {
        title: "Workspace canvas",
        version: "1.0.0",
        baseUrl: "https://example.test/api/v1",
      },
    );
    expect(document.paths).toMatchObject({
      "/workspaces/{workspacePublicId}/canvas/images": {},
      "/workspaces/{workspacePublicId}/canvas/images/upload": {},
      "/workspaces/{workspacePublicId}/canvas/images/confirm": {},
      "/workspaces/{workspacePublicId}/canvas/images/remote": {},
      "/workspaces/{workspacePublicId}/canvas/images/{imagePublicId}": {},
    });
  });
});
