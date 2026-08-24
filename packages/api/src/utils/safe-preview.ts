import type { SafePreviewNetwork } from "./safe-preview-network";
import type { SafePreviewMetadata } from "./safe-preview-types";
import { validateSafePreviewImage } from "./safe-preview-image";
import { extractSafePreviewMetadata } from "./safe-preview-metadata";
import { safePreviewNetwork } from "./safe-preview-network";
import { SAFE_PREVIEW_LIMITS, SafePreviewError } from "./safe-preview-types";

const getHeader = (
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  name: string,
) => {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
};

const contentType = (
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
) => getHeader(headers, "content-type")?.split(";", 1)[0]?.trim().toLowerCase();

const decodeHtml = (bytes: Uint8Array, header: string | undefined) => {
  const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(header ?? "")?.[1];
  const encoding =
    charset && /^(?:iso-8859-1|latin1|windows-1252)$/i.test(charset)
      ? "windows-1252"
      : "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
};

const fetchImage = async (
  network: SafePreviewNetwork,
  value: string,
  redirects: { remaining: number },
  signal: AbortSignal,
) => {
  const response = await network.fetch(value, {
    accept: "image/jpeg,image/png,image/webp",
    maxBytes: SAFE_PREVIEW_LIMITS.imageBytes,
    redirects,
    signal,
  });
  const imageType = contentType(response.headers);
  if (!imageType) throw new SafePreviewError("UNSUPPORTED_MIME");
  return {
    ...validateSafePreviewImage(imageType, response.body),
    resolvedUrl: response.resolvedUrl,
  };
};

export const createSafePreviewImageFetcher =
  (network: SafePreviewNetwork) => async (value: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      SAFE_PREVIEW_LIMITS.timeoutMs,
    );
    try {
      return await fetchImage(
        network,
        value,
        { remaining: SAFE_PREVIEW_LIMITS.redirects },
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) throw new SafePreviewError("TIMEOUT");
      if (error instanceof SafePreviewError) throw error;
      throw new SafePreviewError("NETWORK_FAILED");
    } finally {
      clearTimeout(timeout);
    }
  };

export const createSafePreviewFetcher =
  (network: SafePreviewNetwork) =>
  async (value: string): Promise<SafePreviewMetadata> => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      SAFE_PREVIEW_LIMITS.timeoutMs,
    );
    const redirects = { remaining: SAFE_PREVIEW_LIMITS.redirects };

    try {
      const document = await network.fetch(value, {
        accept: "text/html,application/xhtml+xml;q=0.9",
        maxBytes: SAFE_PREVIEW_LIMITS.htmlBytes,
        redirects,
        signal: controller.signal,
      });
      const documentType = contentType(document.headers);
      if (
        documentType !== "text/html" &&
        documentType !== "application/xhtml+xml"
      ) {
        throw new SafePreviewError("UNSUPPORTED_MIME");
      }
      const html = decodeHtml(
        document.body,
        getHeader(document.headers, "content-type"),
      );
      const extracted = extractSafePreviewMetadata(html, document.resolvedUrl);
      let image = null;

      if (extracted.imageUrl && !controller.signal.aborted) {
        try {
          image = await fetchImage(
            network,
            extracted.imageUrl,
            redirects,
            controller.signal,
          );
        } catch {
          image = null;
        }
      }

      return {
        resolvedUrl: document.resolvedUrl,
        title: extracted.title,
        siteName: extracted.siteName,
        description: extracted.description,
        image,
      };
    } catch (error) {
      if (controller.signal.aborted) throw new SafePreviewError("TIMEOUT");
      if (error instanceof SafePreviewError) throw error;
      throw new SafePreviewError("NETWORK_FAILED");
    } finally {
      clearTimeout(timeout);
    }
  };

export const fetchSafePreviewMetadata =
  createSafePreviewFetcher(safePreviewNetwork);
export const fetchSafePreviewImage =
  createSafePreviewImageFetcher(safePreviewNetwork);

export type {
  SafePreviewImage,
  SafePreviewImageData,
  SafePreviewImageContentType,
  SafePreviewMetadata,
} from "./safe-preview-types";
export { SAFE_PREVIEW_LIMITS, SafePreviewError } from "./safe-preview-types";
