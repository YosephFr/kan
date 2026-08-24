import type { IncomingMessage } from "node:http";

import type { SafePreviewTransportResponse } from "./safe-preview-types";
import { SafePreviewError } from "./safe-preview-types";

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export const readSafePreviewResponse = (
  response: IncomingMessage,
  maxBytes: number,
): Promise<SafePreviewTransportResponse> => {
  const status = response.statusCode ?? 0;
  const headers = response.headers;
  if (redirectStatuses.has(status)) {
    response.destroy();
    return Promise.resolve({ status, headers, body: new Uint8Array() });
  }

  const lengthHeader = headers["content-length"];
  if (
    typeof lengthHeader === "string" &&
    /^\d+$/.test(lengthHeader) &&
    Number(lengthHeader) > maxBytes
  ) {
    response.destroy();
    return Promise.reject(new SafePreviewError("BODY_TOO_LARGE"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const finish = (
      result:
        | { response: SafePreviewTransportResponse }
        | { error: SafePreviewError },
    ) => {
      if (settled) return;
      settled = true;
      if ("error" in result) reject(result.error);
      else resolve(result.response);
    };

    response.on("data", (chunk: Buffer | Uint8Array | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxBytes) {
        finish({ error: new SafePreviewError("BODY_TOO_LARGE") });
        response.destroy();
        return;
      }
      chunks.push(buffer);
    });
    response.once("end", () => {
      finish({
        response: {
          status,
          headers,
          body: new Uint8Array(Buffer.concat(chunks, bytes)),
        },
      });
    });
    response.once("aborted", () => {
      finish({ error: new SafePreviewError("NETWORK_FAILED") });
    });
    response.once("error", () => {
      finish({ error: new SafePreviewError("NETWORK_FAILED") });
    });
  });
};
