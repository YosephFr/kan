import { Readable, Writable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createNextApiContext: vi.fn(),
  getCardVisualWallPreviewForView: vi.fn(),
  getAttachmentObject: vi.fn(),
  getObjectPrefix: vi.fn(),
  hasValidInlineAttachmentSignature: vi.fn(),
  withApiLogging: vi.fn((handler: unknown) => handler),
}));

vi.mock("@kan/api/trpc", () => ({
  createNextApiContext: mocks.createNextApiContext,
}));
vi.mock("@kan/api/utils/apiLogging", () => ({
  withApiLogging: mocks.withApiLogging,
}));
vi.mock("@kan/api/utils/card-visual-wall-preview-access", () => ({
  getCardVisualWallPreviewForView: mocks.getCardVisualWallPreviewForView,
}));
vi.mock("@kan/shared/utils", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("@kan/shared/utils");
  return {
    ...actual,
    getAttachmentObject: mocks.getAttachmentObject,
    getObjectPrefix: mocks.getObjectPrefix,
    hasValidInlineAttachmentSignature: mocks.hasValidInlineAttachmentSignature,
  };
});
vi.mock("~/env", () => ({
  env: { NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME: "attachments" },
}));

const preview = {
  s3Key: ".visual-wall/preview01",
  contentType: "image/webp",
  size: 128,
  sha256: "a".repeat(64),
  width: 320,
  height: 180,
};

const createRequest = (headers: Record<string, string> = {}) =>
  ({
    method: "GET",
    query: { resourcePublicId: "resource0001" },
    headers,
  }) as unknown as NextApiRequest;

const createResponse = () => {
  const chunks: Buffer[] = [];
  const headers = new Map<string, string>();
  const response = new Writable({
    write(
      chunk: string | Uint8Array,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ) {
      chunks.push(
        typeof chunk === "string"
          ? Buffer.from(chunk)
          : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      );
      callback();
    },
  }) as Writable &
    NextApiResponse & {
      body?: unknown;
      chunks: Buffer[];
    };
  response.statusCode = 200;
  response.chunks = chunks;
  response.setHeader = vi.fn((name: string, value: number | string) => {
    headers.set(name.toLowerCase(), String(value));
    return response;
  });
  response.getHeader = vi.fn((name: string) => headers.get(name.toLowerCase()));
  response.status = vi.fn((statusCode: number) => {
    response.statusCode = statusCode;
    return response;
  });
  response.json = vi.fn((body: unknown) => {
    response.body = body;
    return response;
  });
  return response;
};

describe("card visual wall preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createNextApiContext.mockResolvedValue({
      user: { id: "user-1" },
      db: {},
    });
    mocks.getCardVisualWallPreviewForView.mockResolvedValue(preview);
    mocks.hasValidInlineAttachmentSignature.mockReturnValue(true);
  });

  it("marks request logging as sensitive", async () => {
    vi.resetModules();
    const { cardVisualWallPreviewHandler } = await import(
      "../pages/api/visual-wall-resources/[resourcePublicId]"
    );

    expect(mocks.withApiLogging).toHaveBeenCalledWith(
      cardVisualWallPreviewHandler,
      { sensitive: true },
    );
  });

  it("revalidates access before returning 304", async () => {
    const etag = `"${preview.sha256}"`;
    const { cardVisualWallPreviewHandler } = await import(
      "../pages/api/visual-wall-resources/[resourcePublicId]"
    );
    const response = createResponse();

    await cardVisualWallPreviewHandler(
      createRequest({ "if-none-match": etag }),
      response,
    );

    expect(response.statusCode).toBe(304);
    expect(mocks.getCardVisualWallPreviewForView).toHaveBeenCalledWith(
      {},
      "resource0001",
      "user-1",
    );
    expect(mocks.getAttachmentObject).not.toHaveBeenCalled();
    expect(response.getHeader("etag")).toBe(etag);
    expect(response.getHeader("cache-control")).toBe(
      "private, no-cache, must-revalidate",
    );
    expect(response.getHeader("vary")).toBe("Cookie");
  });

  it("streams the optimized WebP after access is granted", async () => {
    const bytes = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    mocks.getObjectPrefix.mockResolvedValue(bytes);
    mocks.getAttachmentObject.mockResolvedValue({
      Body: Readable.from([bytes]),
      ContentLength: bytes.byteLength,
    });
    const { cardVisualWallPreviewHandler } = await import(
      "../pages/api/visual-wall-resources/[resourcePublicId]"
    );
    const response = createResponse();

    await cardVisualWallPreviewHandler(createRequest(), response);

    expect(response.statusCode).toBe(200);
    expect(Buffer.concat(response.chunks)).toEqual(bytes);
    expect(response.getHeader("content-type")).toBe("image/webp");
    expect(response.getHeader("content-length")).toBe(String(bytes.length));
    expect(response.getHeader("etag")).toBe(`"${preview.sha256}"`);
  });

  it("returns 403 after permission revocation even with a matching ETag", async () => {
    mocks.getCardVisualWallPreviewForView.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" }),
    );
    const { cardVisualWallPreviewHandler } = await import(
      "../pages/api/visual-wall-resources/[resourcePublicId]"
    );
    const response = createResponse();

    await cardVisualWallPreviewHandler(
      createRequest({ "if-none-match": `"${preview.sha256}"` }),
      response,
    );

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ message: "Unable to access preview" });
    expect(response.getHeader("etag")).toBeUndefined();
    expect(mocks.getAttachmentObject).not.toHaveBeenCalled();
  });
});
