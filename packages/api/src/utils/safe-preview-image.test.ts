import { describe, expect, it } from "vitest";

import type { SafePreviewErrorCode } from "./safe-preview-types";
import { validateSafePreviewImage } from "./safe-preview-image";
import { SAFE_PREVIEW_LIMITS } from "./safe-preview-types";

const expectErrorCode = (action: () => unknown, code: SafePreviewErrorCode) => {
  try {
    action();
    expect.unreachable();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
};

const png = (width: number, height: number, size = 24) => {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

const jpeg = (width: number, height: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
  ]);

const webp = (width: number, height: number) => {
  const bytes = new Uint8Array(30);
  bytes.set(Buffer.from("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, 22, true);
  bytes.set(Buffer.from("WEBPVP8X"), 8);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  const widthValue = width - 1;
  const heightValue = height - 1;
  bytes.set(
    [widthValue & 0xff, (widthValue >> 8) & 0xff, (widthValue >> 16) & 0xff],
    24,
  );
  bytes.set(
    [heightValue & 0xff, (heightValue >> 8) & 0xff, (heightValue >> 16) & 0xff],
    27,
  );
  return bytes;
};

describe("validateSafePreviewImage", () => {
  it.each([
    ["image/png", png(1200, 800), 1200, 800],
    ["image/jpeg", jpeg(800, 600), 800, 600],
    ["image/webp", webp(1600, 900), 1600, 900],
  ] as const)(
    "accepts a bounded %s image",
    (contentType, bytes, width, height) => {
      expect(validateSafePreviewImage(contentType, bytes)).toMatchObject({
        contentType,
        width,
        height,
      });
    },
  );

  it("accepts content type parameters after validating the magic bytes", () => {
    expect(
      validateSafePreviewImage("image/png; charset=binary", png(100, 100)),
    ).toMatchObject({ contentType: "image/png", width: 100, height: 100 });
  });

  it("rejects a declared MIME that disagrees with the bytes", () => {
    expectErrorCode(
      () => validateSafePreviewImage("image/jpeg", png(100, 100)),
      "UNSUPPORTED_MIME",
    );
  });

  it.each(["image/gif", "text/html", "image/svg+xml"])(
    "rejects unsupported MIME %s",
    (contentType) => {
      expectErrorCode(
        () => validateSafePreviewImage(contentType, Buffer.from("GIF89a")),
        "UNSUPPORTED_MIME",
      );
    },
  );

  it.each([
    [png(2049, 100), "width"],
    [png(100, 2049), "height"],
    [png(2001, 2000), "pixel count"],
    [png(0, 100), "zero dimension"],
  ])("rejects an image above the %s limit", (bytes) => {
    expectErrorCode(
      () => validateSafePreviewImage("image/png", bytes),
      "INVALID_IMAGE",
    );
  });

  it("accepts exactly four megapixels within the dimension limit", () => {
    expect(
      validateSafePreviewImage("image/png", png(2000, 2000)),
    ).toMatchObject({ width: 2000, height: 2000 });
  });

  it("rejects a body above two MiB before decoding", () => {
    const bytes = png(100, 100, SAFE_PREVIEW_LIMITS.imageBytes + 1);
    expectErrorCode(
      () => validateSafePreviewImage("image/png", bytes),
      "BODY_TOO_LARGE",
    );
  });

  it("rejects malformed or truncated image headers", () => {
    expectErrorCode(
      () =>
        validateSafePreviewImage(
          "image/png",
          new Uint8Array([137, 80, 78, 71]),
        ),
      "UNSUPPORTED_MIME",
    );
  });
});
