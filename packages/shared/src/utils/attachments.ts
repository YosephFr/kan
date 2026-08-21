export const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
export const ATTACHMENT_UPLOAD_TTL_MS = 60 * 60 * 1000;
export const ATTACHMENT_UPLOAD_CLAIM_TTL_MS = 10 * 60 * 1000;
export const ATTACHMENT_SNIFF_BYTES = 4096;
export const MAX_PENDING_ATTACHMENT_UPLOADS_PER_CARD = 5;
export const MAX_PENDING_ATTACHMENT_UPLOADS_PER_USER = 10;

const ALLOWED_ATTACHMENT_CONTENT_TYPES = new Set([
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/plain",
  "text/rtf",
]);

const INLINE_ATTACHMENT_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const CONTENT_TYPES_BY_EXTENSION: Record<string, ReadonlySet<string>> = {
  ".csv": new Set(["text/csv"]),
  ".doc": new Set(["application/msword"]),
  ".docx": new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  ".gif": new Set(["image/gif"]),
  ".htm": new Set(["text/html"]),
  ".html": new Set(["text/html"]),
  ".jpeg": new Set(["image/jpeg"]),
  ".jpg": new Set(["image/jpeg"]),
  ".js": new Set([
    "application/javascript",
    "text/javascript",
    "application/ecmascript",
    "text/ecmascript",
  ]),
  ".pdf": new Set(["application/pdf"]),
  ".png": new Set(["image/png"]),
  ".ppt": new Set(["application/vnd.ms-powerpoint"]),
  ".pptx": new Set([
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]),
  ".svg": new Set(["image/svg+xml"]),
  ".rtf": new Set(["application/rtf", "text/rtf"]),
  ".txt": new Set(["text/plain"]),
  ".webp": new Set(["image/webp"]),
  ".xhtml": new Set(["application/xhtml+xml"]),
  ".xlsx": new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  ".xls": new Set(["application/vnd.ms-excel"]),
  ".xml": new Set(["application/xml", "text/xml"]),
};

export function normalizeAttachmentContentType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function isAllowedAttachmentContentType(contentType: string): boolean {
  return ALLOWED_ATTACHMENT_CONTENT_TYPES.has(
    normalizeAttachmentContentType(contentType),
  );
}

export function isInlineAttachmentContentType(contentType: string): boolean {
  return INLINE_ATTACHMENT_CONTENT_TYPES.has(
    normalizeAttachmentContentType(contentType),
  );
}

export function isValidAttachmentSha256(sha256: string): boolean {
  return /^[a-f0-9]{64}$/i.test(sha256);
}

export function sanitizeAttachmentFilename(filename: string): string {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 200);
  return sanitized && sanitized !== "." && sanitized !== ".."
    ? sanitized
    : "attachment";
}

export function isAttachmentFilenameContentTypeCompatible(
  filename: string,
  contentType: string,
): boolean {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex < 0) return false;
  const extension = filename.slice(dotIndex).toLowerCase();
  const expectedTypes = CONTENT_TYPES_BY_EXTENSION[extension];
  return (
    expectedTypes?.has(normalizeAttachmentContentType(contentType)) ?? false
  );
}

function decodeAttachmentPrefix(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(Math.max(0, bytes.length - 2));
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1] ?? 0;
      swapped[index - 1] = bytes[index] ?? 0;
    }
    return new TextDecoder("utf-16le").decode(swapped);
  }
  return new TextDecoder().decode(bytes);
}

export function hasDetectableActiveAttachmentContent(
  bytes: Uint8Array,
): boolean {
  let prefix = decodeAttachmentPrefix(bytes)
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();

  for (let index = 0; index < 3 && prefix.startsWith("<!--"); index += 1) {
    const commentEnd = prefix.indexOf("-->");
    if (commentEnd < 0) break;
    prefix = prefix.slice(commentEnd + 3).trimStart();
  }

  if (prefix.startsWith("<?xml")) {
    const declarationEnd = prefix.indexOf("?>");
    if (declarationEnd >= 0) {
      prefix = prefix.slice(declarationEnd + 2).trimStart();
    }
  }

  return /^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b|<script\b|<svg\b)/.test(
    prefix,
  );
}

function startsWithBytes(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

export function hasValidInlineAttachmentSignature(
  contentType: string,
  bytes: Uint8Array,
): boolean {
  switch (normalizeAttachmentContentType(contentType)) {
    case "application/pdf":
      return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "image/gif":
      return (
        startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
      );
    case "image/jpeg":
      return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWithBytes(
        bytes,
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      );
    case "image/webp":
      return (
        startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    default:
      return false;
  }
}

export function hasValidAttachmentSignature(
  contentType: string,
  bytes: Uint8Array,
): boolean {
  const normalized = normalizeAttachmentContentType(contentType);
  if (INLINE_ATTACHMENT_CONTENT_TYPES.has(normalized)) {
    return hasValidInlineAttachmentSignature(normalized, bytes);
  }

  if (
    normalized ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    normalized ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    normalized ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return (
      startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
      startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
      startsWithBytes(bytes, [0x50, 0x4b, 0x07, 0x08])
    );
  }

  if (
    normalized === "application/msword" ||
    normalized === "application/vnd.ms-excel" ||
    normalized === "application/vnd.ms-powerpoint"
  ) {
    return startsWithBytes(
      bytes,
      [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    );
  }

  if (normalized === "application/rtf" || normalized === "text/rtf") {
    return (
      new TextDecoder().decode(bytes.subarray(0, 5)).toLowerCase() === "{\\rtf"
    );
  }

  return normalized === "text/plain" || normalized === "text/csv";
}
