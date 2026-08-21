import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardAttachmentRepo from "@kan/db/repository/cardAttachment.repo";

import { getAttachmentForView } from "./attachment-access";
import { assertPermission } from "./permissions";

vi.mock("@kan/db/repository/cardAttachment.repo", () => ({
  getByPublicId: vi.fn(),
  hasValidAttachmentStorageOwnership: vi.fn(),
}));
vi.mock("./permissions", () => ({ assertPermission: vi.fn() }));

const db = {} as never;
const attachment = (visibility: "private" | "public") => ({
  publicId: "attachpublic1",
  s3Key: "workspace001/cardpublic01/file.pdf",
  uploadSessionId: null,
  uploadSession: null,
  storageQuarantinedAt: null,
  deletedAt: null,
  card: {
    id: 31,
    publicId: "cardpublic01",
    deletedAt: null,
    list: {
      deletedAt: null,
      board: {
        workspaceId: 41,
        visibility,
        deletedAt: null,
        workspace: { id: 41, publicId: "workspace001", deletedAt: null },
      },
    },
  },
});

describe("attachment read access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(
      cardAttachmentRepo.hasValidAttachmentStorageOwnership,
    ).mockReturnValue(true);
  });

  it("preserves anonymous access for attachments on public boards", async () => {
    vi.mocked(cardAttachmentRepo.getByPublicId).mockResolvedValue(
      attachment("public") as never,
    );

    await expect(
      getAttachmentForView(db, "attachpublic1"),
    ).resolves.toMatchObject({ publicId: "attachpublic1" });
    expect(assertPermission).not.toHaveBeenCalled();
  });

  it("requires authentication before resolving a private attachment", async () => {
    vi.mocked(cardAttachmentRepo.getByPublicId).mockResolvedValue(
      attachment("private") as never,
    );

    await expect(
      getAttachmentForView(db, "attachpublic1"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(assertPermission).not.toHaveBeenCalled();
  });

  it("checks card view permission in the attachment workspace", async () => {
    vi.mocked(cardAttachmentRepo.getByPublicId).mockResolvedValue(
      attachment("private") as never,
    );
    vi.mocked(assertPermission).mockResolvedValue(undefined);

    await getAttachmentForView(db, "attachpublic1", "user-123");

    expect(assertPermission).toHaveBeenCalledWith(
      db,
      "user-123",
      41,
      "card:view",
    );
  });

  it("does not bypass a cross-workspace permission denial", async () => {
    vi.mocked(cardAttachmentRepo.getByPublicId).mockResolvedValue(
      attachment("private") as never,
    );
    vi.mocked(assertPermission).mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN" }),
    );

    await expect(
      getAttachmentForView(db, "attachpublic1", "other-workspace-user"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("hides soft-deleted attachment records", async () => {
    vi.mocked(cardAttachmentRepo.getByPublicId).mockResolvedValue({
      ...attachment("public"),
      deletedAt: new Date(),
    } as never);

    await expect(
      getAttachmentForView(db, "attachpublic1"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hides legacy records that point at another card's object", async () => {
    vi.mocked(cardAttachmentRepo.getByPublicId).mockResolvedValue(
      attachment("public") as never,
    );
    vi.mocked(
      cardAttachmentRepo.hasValidAttachmentStorageOwnership,
    ).mockReturnValue(false);

    await expect(
      getAttachmentForView(db, "attachpublic1"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(assertPermission).not.toHaveBeenCalled();
  });
});
