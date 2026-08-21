import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as SharedUtils from "@kan/shared/utils";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardAttachmentRepo from "@kan/db/repository/cardAttachment.repo";
import {
  copyObject,
  deleteObject,
  generateUID,
  generateUploadUrl,
  inspectObject,
} from "@kan/shared/utils";

import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/cardAttachment.repo", () => ({
  claimUploadSessionForConfirmation: vi.fn(),
  consumeClaimedUploadSessionAndCreate: vi.fn(),
  createUploadSession: vi.fn(),
  deleteUnissuedUploadSession: vi.fn(),
  getByPublicId: vi.fn(),
  releaseUploadSessionClaim: vi.fn(),
  softDeleteWithWorkspaceGuard: vi.fn(),
}));
vi.mock("@kan/logger", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));
vi.mock("@kan/shared/utils", async (importOriginal) => {
  const original = await importOriginal<typeof SharedUtils>();
  return {
    ...original,
    copyObject: vi.fn(),
    deleteObject: vi.fn(),
    generateUID: vi.fn(),
    generateUploadUrl: vi.fn(),
    inspectObject: vi.fn(),
  };
});
vi.mock("../utils/permissions", () => ({ assertPermission: vi.fn() }));

const originalBucket = process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
const db = {} as never;
const context = { db, user: { id: "user-owner" } } as never;
const card = { id: 31, workspaceId: 41 };
const session = {
  id: 51,
  publicId: "uploadsess01",
  cardId: card.id,
  workspaceId: card.workspaceId,
  userId: "user-owner",
  s3Key: ".uploads/uploadsess01/file.png",
  filename: "file.png",
  originalFilename: "file.png",
  contentType: "image/png",
  size: 8,
  sha256: "a".repeat(64),
};
const inspected = {
  contentType: "image/png",
  etag: '"etag"',
  prefix: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  sha256: session.sha256,
  size: session.size,
};
const attachment = {
  publicId: "attachment01",
  filename: "file.png",
  originalFilename: "file.png",
  contentType: "image/png",
  size: 8,
  createdAt: new Date("2026-08-21T12:00:00.000Z"),
};

describe("attachment upload boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = "attachments";
    vi.mocked(generateUID)
      .mockReset()
      .mockReturnValueOnce("uploadsess01")
      .mockReturnValueOnce("claimtoken01")
      .mockReturnValueOnce("objectkey001");
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue(
      card as never,
    );
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(generateUploadUrl).mockResolvedValue("https://upload.test/url");
    vi.mocked(inspectObject).mockResolvedValue(inspected);
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(cardAttachmentRepo.createUploadSession).mockResolvedValue({
      status: "created",
      session: { publicId: session.publicId },
    });
    vi.mocked(cardAttachmentRepo.deleteUnissuedUploadSession).mockResolvedValue(
      {
        status: "deleted",
        session: { publicId: session.publicId },
      },
    );
    vi.mocked(
      cardAttachmentRepo.claimUploadSessionForConfirmation,
    ).mockResolvedValue({ status: "claimed", session } as never);
    vi.mocked(
      cardAttachmentRepo.consumeClaimedUploadSessionAndCreate,
    ).mockResolvedValue({ status: "created", attachment } as never);
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME = originalBucket;
  });

  it("returns an opaque session and signs the exact declared size", async () => {
    const { attachmentRouter } = await import("./attachment");
    const result = await attachmentRouter
      .createCaller(context)
      .generateUploadUrl({
        cardPublicId: "cardpublic01",
        filename: "file.png",
        contentType: "image/png",
        size: 8,
        sha256: session.sha256,
      });

    expect(result).toEqual({
      url: "https://upload.test/url",
      uploadSessionPublicId: "uploadsess01",
    });
    expect(result).not.toHaveProperty("key");
    expect(result).not.toHaveProperty("s3Key");
    expect(generateUploadUrl).toHaveBeenCalledWith(
      "attachments",
      ".uploads/uploadsess01/file.png",
      "image/png",
      8,
      3600,
    );
  });

  it("deletes the unissued session when presigning fails", async () => {
    vi.mocked(generateUploadUrl).mockRejectedValueOnce(
      new Error("Presign failed"),
    );
    const { attachmentRouter } = await import("./attachment");

    await expect(
      attachmentRouter.createCaller(context).generateUploadUrl({
        cardPublicId: "cardpublic01",
        filename: "file.png",
        contentType: "image/png",
        size: 8,
        sha256: session.sha256,
      }),
    ).rejects.toThrow("Presign failed");
    expect(cardAttachmentRepo.deleteUnissuedUploadSession).toHaveBeenCalledWith(
      db,
      {
        publicId: session.publicId,
        cardId: card.id,
        workspaceId: card.workspaceId,
        userId: "user-owner",
      },
    );
  });

  it.each([
    ["payload.bin", "application/octet-stream"],
    ["payload.svg", "image/svg+xml"],
    ["payload.html", "text/html"],
    ["payload.exe", "image/png"],
  ])(
    "rejects unsupported or mismatched %s before card lookup",
    async (filename, contentType) => {
      const { attachmentRouter } = await import("./attachment");

      await expect(
        attachmentRouter.createCaller(context).generateUploadUrl({
          cardPublicId: "cardpublic01",
          filename,
          contentType,
          size: 20,
          sha256: session.sha256,
        }),
      ).rejects.toBeDefined();
      expect(
        cardRepo.getWorkspaceAndCardIdByCardPublicId,
      ).not.toHaveBeenCalled();
    },
  );

  it("claims before inspecting storage", async () => {
    vi.mocked(
      cardAttachmentRepo.claimUploadSessionForConfirmation,
    ).mockResolvedValue({ status: "unavailable" });
    const { attachmentRouter } = await import("./attachment");

    await expect(
      attachmentRouter.createCaller(context).confirm({
        cardPublicId: "cardpublic01",
        uploadSessionPublicId: "uploadsess01",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(inspectObject).not.toHaveBeenCalled();
    expect(copyObject).not.toHaveBeenCalled();
  });

  it("rejects HTML disguised as an allowed image", async () => {
    vi.mocked(inspectObject).mockResolvedValue({
      ...inspected,
      prefix: new Uint8Array(
        new TextEncoder().encode("<html><script>alert(1)</script>"),
      ),
    });
    const { attachmentRouter } = await import("./attachment");

    await expect(
      attachmentRouter.createCaller(context).confirm({
        cardPublicId: "cardpublic01",
        uploadSessionPublicId: "uploadsess01",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(copyObject).not.toHaveBeenCalled();
    expect(cardAttachmentRepo.releaseUploadSessionClaim).toHaveBeenCalled();
  });

  it("serializes concurrent confirmations before inspection and copy", async () => {
    vi.mocked(cardAttachmentRepo.claimUploadSessionForConfirmation)
      .mockResolvedValueOnce({ status: "claimed", session } as never)
      .mockResolvedValueOnce({ status: "unavailable" });
    const { attachmentRouter } = await import("./attachment");
    const caller = attachmentRouter.createCaller(context);

    const results = await Promise.allSettled([
      caller.confirm({
        cardPublicId: "cardpublic01",
        uploadSessionPublicId: "uploadsess01",
      }),
      caller.confirm({
        cardPublicId: "cardpublic01",
        uploadSessionPublicId: "uploadsess01",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(inspectObject).toHaveBeenCalledTimes(1);
    expect(copyObject).toHaveBeenCalledTimes(1);
    expect(
      cardAttachmentRepo.consumeClaimedUploadSessionAndCreate,
    ).toHaveBeenCalledTimes(1);
  });

  it("does not expose internal fields in a confirmed attachment", async () => {
    const { attachmentRouter } = await import("./attachment");
    const result = await attachmentRouter.createCaller(context).confirm({
      cardPublicId: "cardpublic01",
      uploadSessionPublicId: "uploadsess01",
    });

    expect(result).toEqual(attachment);
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("s3Key");
    expect(copyObject).toHaveBeenCalledOnce();
    const copyInput = vi.mocked(copyObject).mock.calls[0]?.[0];
    expect(copyInput?.destinationKey).toMatch(/^\.objects\/[a-z0-9]{12}$/);
    expect(copyInput?.sourceEtag).toBe('"etag"');
  });
});
