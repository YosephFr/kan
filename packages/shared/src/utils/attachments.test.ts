import { describe, expect, it } from "vitest";

import {
  hasDetectableActiveAttachmentContent,
  hasValidAttachmentSignature,
  hasValidInlineAttachmentSignature,
  isAllowedAttachmentContentType,
  isAttachmentFilenameContentTypeCompatible,
  isInlineAttachmentContentType,
  isValidAttachmentSha256,
  normalizeAttachmentContentType,
  sanitizeAttachmentFilename,
} from "./attachments";

describe("attachment input boundaries", () => {
  it("normalizes MIME parameters before validating the media type", () => {
    expect(normalizeAttachmentContentType(" Image/PNG ; charset=binary ")).toBe(
      "image/png",
    );
    expect(isAllowedAttachmentContentType("image/png; charset=binary")).toBe(
      true,
    );
  });

  it.each(["text/html", "image/svg+xml", "application/xhtml+xml"])(
    "rejects active content type %s",
    (contentType) => {
      expect(isAllowedAttachmentContentType(contentType)).toBe(false);
      expect(isInlineAttachmentContentType(contentType)).toBe(false);
    },
  );

  it("allows documents for download without allowing them inline", () => {
    const contentType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(isAllowedAttachmentContentType(contentType)).toBe(true);
    expect(isInlineAttachmentContentType(contentType)).toBe(false);
  });

  it("requires a known extension that matches the declared MIME", () => {
    expect(
      isAttachmentFilenameContentTypeCompatible(
        "report.pdf",
        "application/pdf",
      ),
    ).toBe(true);
    expect(
      isAttachmentFilenameContentTypeCompatible(
        "report.exe",
        "application/pdf",
      ),
    ).toBe(false);
    expect(
      isAttachmentFilenameContentTypeCompatible("report.png", "image/jpeg"),
    ).toBe(false);
  });

  it("rejects generic binaries and executable vendor formats", () => {
    expect(isAllowedAttachmentContentType("application/octet-stream")).toBe(
      false,
    );
    expect(isAllowedAttachmentContentType("application/vnd.apple.pages")).toBe(
      false,
    );
  });

  it("requires exactly one hexadecimal SHA-256 digest", () => {
    expect(isValidAttachmentSha256("a".repeat(64))).toBe(true);
    expect(isValidAttachmentSha256("g".repeat(64))).toBe(false);
    expect(isValidAttachmentSha256("a".repeat(63))).toBe(false);
  });

  it("accepts a real PNG signature and rejects disguised HTML", () => {
    expect(
      hasValidInlineAttachmentSignature(
        "image/png",
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe(true);
    expect(
      hasValidInlineAttachmentSignature(
        "image/png",
        new TextEncoder().encode("<html><script>"),
      ),
    ).toBe(false);
  });

  it.each([
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      [0x50, 0x4b, 0x03, 0x04],
    ],
    ["application/msword", [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
    ["application/rtf", Array.from(new TextEncoder().encode("{\\rtf"))],
  ])("validates the magic signature for %s", (contentType, bytes) => {
    expect(
      hasValidAttachmentSignature(contentType, new Uint8Array(bytes)),
    ).toBe(true);
    expect(
      hasValidAttachmentSignature(
        contentType,
        new TextEncoder().encode("not the declared file type"),
      ),
    ).toBe(false);
  });

  it.each(["<html><script>bad</script>", "<svg><script>bad</script></svg>"])(
    "detects active content even when its declared MIME is harmless: %s",
    (value) => {
      expect(
        hasDetectableActiveAttachmentContent(new TextEncoder().encode(value)),
      ).toBe(true);
    },
  );

  it("removes path and header-sensitive filename characters", () => {
    expect(sanitizeAttachmentFilename('../../a b\n".png')).toBe(
      ".._.._a_b__.png",
    );
  });

  it.each([".", "..", ""])("uses a safe fallback for filename %j", (value) => {
    expect(sanitizeAttachmentFilename(value)).toBe("attachment");
  });
});
