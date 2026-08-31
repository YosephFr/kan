import { createHash } from "node:crypto";

import { createLogger } from "@kan/logger";
import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_IMAGE_DIMENSION,
  MAX_CARD_CANVAS_IMAGE_PIXELS,
} from "@kan/shared";

import type { SafePreviewNetwork } from "./safe-preview-network";
import type {
  SafePreviewImageData,
  SafePreviewTransportResponse,
} from "./safe-preview-types";
import { validateSafePreviewImage } from "./safe-preview-image";
import { safePreviewNetwork } from "./safe-preview-network";
import { SafePreviewError } from "./safe-preview-types";

const log = createLogger("card-resource-remote-image");

export const REMOTE_CARD_IMAGE_LIMITS = {
  bytes: MAX_CARD_CANVAS_IMAGE_BYTES,
  maxDimension: MAX_CARD_CANVAS_IMAGE_DIMENSION,
  maxPixels: MAX_CARD_CANVAS_IMAGE_PIXELS,
  redirects: 3,
  timeoutMs: 4000,
} as const;

const extensionByContentType = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

const getContentType = (response: SafePreviewTransportResponse) => {
  const value =
    response.headers["content-type"] ?? response.headers["Content-Type"];
  return typeof value === "string"
    ? value.split(";", 1)[0]?.trim().toLowerCase()
    : undefined;
};

export const createRemoteCardImageFetcher =
  (network: SafePreviewNetwork) =>
  async (value: string): Promise<SafePreviewImageData> => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REMOTE_CARD_IMAGE_LIMITS.timeoutMs,
    );
    try {
      const response = await network.fetch(value, {
        accept: "image/jpeg,image/png,image/webp",
        maxBytes: REMOTE_CARD_IMAGE_LIMITS.bytes,
        redirects: { remaining: REMOTE_CARD_IMAGE_LIMITS.redirects },
        signal: controller.signal,
      });
      const contentType = getContentType(response);
      if (!contentType) throw new SafePreviewError("UNSUPPORTED_MIME");
      return validateSafePreviewImage(contentType, response.body, {
        maxBytes: REMOTE_CARD_IMAGE_LIMITS.bytes,
        maxDimension: REMOTE_CARD_IMAGE_LIMITS.maxDimension,
        maxPixels: REMOTE_CARD_IMAGE_LIMITS.maxPixels,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new SafePreviewError("TIMEOUT");
      if (error instanceof SafePreviewError) throw error;
      throw new SafePreviewError("NETWORK_FAILED");
    } finally {
      clearTimeout(timeout);
    }
  };

export const fetchRemoteCardImage =
  createRemoteCardImageFetcher(safePreviewNetwork);

interface UploadSession {
  uploadSessionPublicId: string;
}

export interface ConfirmedRemoteImageAttachment {
  publicId: string;
  originalFilename: string;
  contentType: string;
  size: number;
  createdAt: Date;
}

export interface RemoteCardImageImportDependencies {
  fetchImage: (url: string) => Promise<SafePreviewImageData>;
  createUpload: (input: {
    filename: string;
    contentType: string;
    size: number;
    sha256: string;
  }) => Promise<UploadSession>;
  writeStagingObject: (input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
  }) => Promise<void>;
  confirmUpload: (
    uploadSessionPublicId: string,
  ) => Promise<ConfirmedRemoteImageAttachment>;
  discardUpload: (input: {
    uploadSessionPublicId: string;
    stagingKey: string;
  }) => Promise<void>;
}

const discardRemoteImageUpload = async (
  dependencies: RemoteCardImageImportDependencies,
  input: { uploadSessionPublicId: string; stagingKey: string },
) => {
  try {
    await dependencies.discardUpload(input);
  } catch {
    log.warn(
      { uploadSessionPublicId: input.uploadSessionPublicId },
      "Failed to discard a remote image upload session",
    );
  }
};

const stageRemoteCardImage = async (
  url: string,
  dependencies: RemoteCardImageImportDependencies,
) => {
  const image = await dependencies.fetchImage(url);
  const extension = extensionByContentType[image.contentType];
  const filename = `imagen-pizarra.${extension}`;
  const session = await dependencies.createUpload({
    filename,
    contentType: image.contentType,
    size: image.bytes.byteLength,
    sha256: createHash("sha256").update(image.bytes).digest("hex"),
  });
  const stagingKey = `.uploads/${session.uploadSessionPublicId}/${filename}`;
  try {
    await dependencies.writeStagingObject({
      key: stagingKey,
      bytes: image.bytes,
      contentType: image.contentType,
    });
  } catch (error) {
    await discardRemoteImageUpload(dependencies, {
      uploadSessionPublicId: session.uploadSessionPublicId,
      stagingKey,
    });
    throw error;
  }
  return {
    uploadSessionPublicId: session.uploadSessionPublicId,
    stagingKey,
  };
};

export const importRemoteCardImage = async (
  url: string,
  dependencies: RemoteCardImageImportDependencies,
) => {
  const staged = await stageRemoteCardImage(url, dependencies);
  try {
    return await dependencies.confirmUpload(staged.uploadSessionPublicId);
  } catch (error) {
    await discardRemoteImageUpload(dependencies, staged);
    throw error;
  }
};
