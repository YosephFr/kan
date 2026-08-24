import type {
  SafePreviewImageContentType,
  SafePreviewImageData,
} from "./safe-preview-types";
import { SAFE_PREVIEW_LIMITS, SafePreviewError } from "./safe-preview-types";

const readUint24Le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] ?? 0) |
  ((bytes[offset + 1] ?? 0) << 8) |
  ((bytes[offset + 2] ?? 0) << 16);

const pngDimensions = (bytes: Uint8Array) => {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 24 ||
    !signature.every((value, index) => bytes[index] === value) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const jpegDimensions = (bytes: Uint8Array) => {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff
  ) {
    return null;
  }
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (length < 2 || offset + length > bytes.length) return null;
    if (sofMarkers.has(marker)) {
      if (length < 7) return null;
      return {
        height: ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0),
        width: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
      };
    }
    offset += length;
  }
  return null;
};

const webpDimensions = (bytes: Uint8Array) => {
  if (
    bytes.length < 30 ||
    String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP"
  ) {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size =
      (bytes[offset + 4] ?? 0) |
      ((bytes[offset + 5] ?? 0) << 8) |
      ((bytes[offset + 6] ?? 0) << 16) |
      ((bytes[offset + 7] ?? 0) << 24);
    const dataOffset = offset + 8;
    if (size < 0 || dataOffset + size > bytes.length) return null;
    if (type === "VP8X" && size >= 10) {
      return {
        width: readUint24Le(bytes, dataOffset + 4) + 1,
        height: readUint24Le(bytes, dataOffset + 7) + 1,
      };
    }
    if (
      type === "VP8 " &&
      size >= 10 &&
      bytes[dataOffset + 3] === 0x9d &&
      bytes[dataOffset + 4] === 0x01 &&
      bytes[dataOffset + 5] === 0x2a
    ) {
      return {
        width:
          (((bytes[dataOffset + 7] ?? 0) << 8) | (bytes[dataOffset + 6] ?? 0)) &
          0x3fff,
        height:
          (((bytes[dataOffset + 9] ?? 0) << 8) | (bytes[dataOffset + 8] ?? 0)) &
          0x3fff,
      };
    }
    if (type === "VP8L" && size >= 5 && bytes[dataOffset] === 0x2f) {
      const b0 = bytes[dataOffset + 1] ?? 0;
      const b1 = bytes[dataOffset + 2] ?? 0;
      const b2 = bytes[dataOffset + 3] ?? 0;
      const b3 = bytes[dataOffset + 4] ?? 0;
      return {
        width: 1 + b0 + ((b1 & 0x3f) << 8),
        height: 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
      };
    }
    offset = dataOffset + size + (size % 2);
  }
  return null;
};

const detectedContentType = (
  bytes: Uint8Array,
): SafePreviewImageContentType | null => {
  if (jpegDimensions(bytes)) return "image/jpeg";
  if (pngDimensions(bytes)) return "image/png";
  if (webpDimensions(bytes)) return "image/webp";
  return null;
};

export const validateSafePreviewImage = (
  contentType: string,
  bytes: Uint8Array,
): SafePreviewImageData => {
  if (bytes.byteLength > SAFE_PREVIEW_LIMITS.imageBytes) {
    throw new SafePreviewError("BODY_TOO_LARGE");
  }
  const normalizedType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  const detectedType = detectedContentType(bytes);
  if (!detectedType || normalizedType !== detectedType) {
    throw new SafePreviewError("UNSUPPORTED_MIME");
  }
  const dimensions =
    detectedType === "image/jpeg"
      ? jpegDimensions(bytes)
      : detectedType === "image/png"
        ? pngDimensions(bytes)
        : webpDimensions(bytes);
  if (
    !dimensions ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > SAFE_PREVIEW_LIMITS.imageMaxDimension ||
    dimensions.height > SAFE_PREVIEW_LIMITS.imageMaxDimension ||
    dimensions.width * dimensions.height > SAFE_PREVIEW_LIMITS.imageMaxPixels
  ) {
    throw new SafePreviewError("INVALID_IMAGE");
  }
  return {
    bytes,
    contentType: detectedType,
    width: dimensions.width,
    height: dimensions.height,
  };
};
