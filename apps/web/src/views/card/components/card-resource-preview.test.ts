import { describe, expect, it } from "vitest";

import type { CardResource } from "./card-resource-types";
import {
  CARD_RESOURCE_DRIVE_SANDBOX,
  CARD_RESOURCE_REFERRER_POLICY,
  getCardResourcePreviewKind,
} from "./card-resource-preview";

const baseUpload = {
  kind: "upload",
  publicId: "uploadtest01",
  title: "Source file",
  originalFilename: "source-file",
  size: 1_024,
  downloadUrl: "/api/attachments/uploadtest01/download",
  createdAt: new Date("2026-08-23T12:00:00.000Z"),
} as const;

describe("getCardResourcePreviewKind", () => {
  it("selects inline previews only for supported view URLs", () => {
    const image = {
      ...baseUpload,
      contentType: "image/png",
      viewUrl: "/api/attachments/uploadtest01/view",
    } satisfies CardResource;
    const pdf = {
      ...baseUpload,
      contentType: "application/pdf",
      viewUrl: "/api/attachments/uploadtest01/view",
    } satisfies CardResource;

    expect(getCardResourcePreviewKind(image)).toBe("image");
    expect(getCardResourcePreviewKind(pdf)).toBe("pdf");
  });

  it("falls back to download for unsupported or non-viewable uploads", () => {
    const document = {
      ...baseUpload,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      viewUrl: null,
    } satisfies CardResource;
    const imageWithoutViewUrl = {
      ...baseUpload,
      contentType: "image/png",
      viewUrl: null,
    } satisfies CardResource;

    expect(getCardResourcePreviewKind(document)).toBe("download");
    expect(getCardResourcePreviewKind(imageWithoutViewUrl)).toBe("download");
  });

  it("keeps Drive previews sandboxed without a referrer", () => {
    const drive = {
      kind: "drive",
      publicId: "resourcetest",
      title: "Private launch plan",
      driveType: "document",
      openUrl: "https://docs.google.com/document/d/document123/edit",
      previewUrl: "https://docs.google.com/document/d/document123/preview",
      createdAt: new Date("2026-08-23T12:00:00.000Z"),
    } satisfies CardResource;

    expect(getCardResourcePreviewKind(drive)).toBe("drive");
    expect(CARD_RESOURCE_DRIVE_SANDBOX).toBe("allow-scripts allow-same-origin");
    expect(CARD_RESOURCE_REFERRER_POLICY).toBe("no-referrer");
  });
});
