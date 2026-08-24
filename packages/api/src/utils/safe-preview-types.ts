export const SAFE_PREVIEW_LIMITS = {
  urlBytes: 2048,
  redirects: 3,
  timeoutMs: 4000,
  htmlBytes: 512 * 1024,
  imageBytes: 2 * 1024 * 1024,
  imageMaxDimension: 2048,
  imageMaxPixels: 4_000_000,
  titleCharacters: 255,
  descriptionCharacters: 500,
} as const;

export type SafePreviewErrorCode =
  | "INVALID_URL"
  | "UNSAFE_TARGET"
  | "DNS_FAILED"
  | "NETWORK_FAILED"
  | "TIMEOUT"
  | "TOO_MANY_REDIRECTS"
  | "INVALID_RESPONSE"
  | "UNSUPPORTED_MIME"
  | "BODY_TOO_LARGE"
  | "INVALID_IMAGE";

const errorMessages: Record<SafePreviewErrorCode, string> = {
  INVALID_URL: "The preview URL is invalid",
  UNSAFE_TARGET: "The preview target is not allowed",
  DNS_FAILED: "The preview target could not be resolved",
  NETWORK_FAILED: "The preview could not be fetched",
  TIMEOUT: "The preview request timed out",
  TOO_MANY_REDIRECTS: "The preview has too many redirects",
  INVALID_RESPONSE: "The preview response is invalid",
  UNSUPPORTED_MIME: "The preview content type is not supported",
  BODY_TOO_LARGE: "The preview response is too large",
  INVALID_IMAGE: "The preview image is invalid",
};

export class SafePreviewError extends Error {
  readonly code: SafePreviewErrorCode;

  constructor(code: SafePreviewErrorCode) {
    super(errorMessages[code]);
    this.name = "SafePreviewError";
    this.code = code;
  }
}

export type SafePreviewImageContentType =
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface SafePreviewImageData {
  bytes: Uint8Array;
  contentType: SafePreviewImageContentType;
  width: number;
  height: number;
}

export interface SafePreviewImage extends SafePreviewImageData {
  resolvedUrl: string;
}

export interface SafePreviewMetadata {
  resolvedUrl: string;
  title: string;
  siteName: string;
  description: string | null;
  image: SafePreviewImage | null;
}

export type SafePreviewHeaders = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export interface SafePreviewTransportResponse {
  status: number;
  headers: SafePreviewHeaders;
  body: Uint8Array;
}
