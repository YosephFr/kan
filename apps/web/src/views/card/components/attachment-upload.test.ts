import { describe, expect, it, vi } from "vitest";

import {
  MAX_ATTACHMENT_SIZE,
  validateAttachmentFile,
} from "./attachment-upload";

describe("attachment upload validation", () => {
  it("rejects an oversized file before hashing", () => {
    expect(() =>
      validateAttachmentFile({
        name: "oversized.pdf",
        type: "application/pdf",
        size: MAX_ATTACHMENT_SIZE + 1,
        arrayBuffer: vi.fn(),
      }),
    ).toThrowError("too-large");
  });

  it("requires a non-empty file", () => {
    expect(() =>
      validateAttachmentFile({
        name: "empty.txt",
        type: "text/plain",
        size: 0,
        arrayBuffer: vi.fn(),
      }),
    ).toThrowError("empty");
  });

  it("rejects file names longer than the server title limit", () => {
    expect(() =>
      validateAttachmentFile({
        name: `${"a".repeat(252)}.txt`,
        type: "text/plain",
        size: 12,
        arrayBuffer: vi.fn(),
      }),
    ).toThrowError("name-too-long");
  });

  it("requires both the extension and MIME type to match the allowlist", () => {
    expect(() =>
      validateAttachmentFile({
        name: "payload.png",
        type: "text/html",
        size: 12,
        arrayBuffer: vi.fn(),
      }),
    ).toThrowError("unsupported");
    expect(() =>
      validateAttachmentFile({
        name: "payload.svg",
        type: "image/svg+xml",
        size: 12,
        arrayBuffer: vi.fn(),
      }),
    ).toThrowError("unsupported");
    expect(() =>
      validateAttachmentFile({
        name: "archive.zip",
        type: "application/zip",
        size: 12,
        arrayBuffer: vi.fn(),
      }),
    ).toThrowError("unsupported");
  });

  it("accepts a supported extension and MIME pair", () => {
    expect(
      validateAttachmentFile({
        name: "photo.PNG",
        type: "IMAGE/PNG",
        size: 12,
        arrayBuffer: vi.fn(),
      }),
    ).toBe("image/png");
  });
});
