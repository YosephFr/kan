import { Readable, Writable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createNextApiContext: vi.fn(),
  getAttachmentObject: vi.fn(),
  getObjectPrefix: vi.fn(),
  getWorkspaceCanvasImageForView: vi.fn(),
  consumeViewRateLimit: vi.fn(),
  withApiLogging: vi.fn((handler: unknown) => handler),
}));

vi.mock("@kan/api/trpc", () => ({
  createNextApiContext: mocks.createNextApiContext,
}));
vi.mock("@kan/api/utils/apiLogging", () => ({
  withApiLogging: mocks.withApiLogging,
}));
vi.mock("@kan/api/utils/workspace-canvas-image-access", () => ({
  getWorkspaceCanvasImageForView: mocks.getWorkspaceCanvasImageForView,
}));
vi.mock("@kan/api/utils/workspace-canvas-image-rate-limit", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@kan/api/utils/workspace-canvas-image-rate-limit",
  );
  return {
    ...actual,
    consumeWorkspaceCanvasImageViewRateLimit: mocks.consumeViewRateLimit,
  };
});
vi.mock("@kan/shared/utils", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("@kan/shared/utils");
  return {
    ...actual,
    getAttachmentObject: mocks.getAttachmentObject,
    getObjectPrefix: mocks.getObjectPrefix,
  };
});
vi.mock("~/env", () => ({
  env: { NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME: "attachments" },
}));

const image = {
  publicId: "canvasimg001",
  workspace: { publicId: "workspace001" },
  s3Key: ".objects/image0000001",
  sha256: "a".repeat(64),
  contentType: "image/webp",
  size: 128,
  originalFilename: "idea.png",
};

const createRequest = (headers: Record<string, string> = {}) =>
  ({
    method: "GET",
    query: { imagePublicId: image.publicId },
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

describe("workspace canvas image route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createNextApiContext.mockResolvedValue({
      user: { id: "user-1" },
      db: {},
    });
    mocks.getWorkspaceCanvasImageForView.mockResolvedValue(image);
    mocks.consumeViewRateLimit.mockResolvedValue(undefined);
  });

  it("uses sensitive route logging to exclude request content", async () => {
    vi.resetModules();
    const { workspaceCanvasImageHandler } = await import(
      "../pages/api/workspace-canvas-images/[imagePublicId]"
    );

    expect(mocks.withApiLogging).toHaveBeenCalledWith(
      workspaceCanvasImageHandler,
      { sensitive: true },
    );
  });

  it("revalidates authorization before returning 304", async () => {
    const etag = `"${image.sha256}"`;
    const { workspaceCanvasImageHandler } = await import(
      "../pages/api/workspace-canvas-images/[imagePublicId]"
    );
    const response = createResponse();

    await workspaceCanvasImageHandler(
      createRequest({ "if-none-match": etag }),
      response,
    );

    expect(response.statusCode).toBe(304);
    expect(mocks.getWorkspaceCanvasImageForView).toHaveBeenCalledWith(
      {},
      image.publicId,
      "user-1",
    );
    expect(mocks.consumeViewRateLimit).toHaveBeenCalledWith(
      "user-1",
      image.workspace.publicId,
    );
    expect(mocks.getAttachmentObject).not.toHaveBeenCalled();
    expect(response.getHeader("cache-control")).toBe(
      "private, no-cache, must-revalidate",
    );
    expect(response.getHeader("vary")).toBe("Cookie");
    expect(response.getHeader("etag")).toBe(etag);
  });

  it("streams the initial WebP response after authorization and rate limit", async () => {
    const bytes = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    mocks.getObjectPrefix.mockResolvedValue(bytes);
    mocks.getAttachmentObject.mockResolvedValue({
      Body: Readable.from([bytes]),
      ContentLength: bytes.byteLength,
    });
    const { workspaceCanvasImageHandler } = await import(
      "../pages/api/workspace-canvas-images/[imagePublicId]"
    );
    const response = createResponse();

    await workspaceCanvasImageHandler(createRequest(), response);

    expect(response.statusCode).toBe(200);
    expect(Buffer.concat(response.chunks)).toEqual(bytes);
    expect(response.getHeader("content-type")).toBe("image/webp");
    expect(response.getHeader("content-length")).toBe(String(bytes.byteLength));
    expect(response.getHeader("content-disposition")).toContain(
      "filename*=UTF-8''idea.webp",
    );
    expect(response.getHeader("etag")).toBe(`"${image.sha256}"`);
    expect(response.getHeader("cache-control")).toBe(
      "private, no-cache, must-revalidate",
    );
    expect(response.getHeader("vary")).toBe("Cookie");
    const authorizationOrder =
      mocks.getWorkspaceCanvasImageForView.mock.invocationCallOrder[0];
    const rateLimitOrder =
      mocks.consumeViewRateLimit.mock.invocationCallOrder[0];
    const storageOrder = mocks.getObjectPrefix.mock.invocationCallOrder[0];
    expect(authorizationOrder).toBeLessThan(rateLimitOrder ?? 0);
    expect(rateLimitOrder).toBeLessThan(storageOrder ?? 0);
  });

  it("returns 403 after permission revocation even with a matching ETag", async () => {
    mocks.getWorkspaceCanvasImageForView.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" }),
    );
    const { workspaceCanvasImageHandler } = await import(
      "../pages/api/workspace-canvas-images/[imagePublicId]"
    );
    const response = createResponse();

    await workspaceCanvasImageHandler(
      createRequest({ "if-none-match": `"${image.sha256}"` }),
      response,
    );

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ message: "Unable to access image" });
    expect(mocks.consumeViewRateLimit).not.toHaveBeenCalled();
    expect(response.getHeader("etag")).toBeUndefined();
  });

  it("accepts weak and comma-separated validators", async () => {
    const { requestAcceptsEtag } = await import(
      "../pages/api/workspace-canvas-images/[imagePublicId]"
    );
    const etag = `"${image.sha256}"`;

    expect(requestAcceptsEtag(`"old", W/${etag}`, etag)).toBe(true);
    expect(requestAcceptsEtag('"old"', etag)).toBe(false);
  });

  it("rate limits invalid unauthenticated requests before the handler", async () => {
    mocks.createNextApiContext.mockResolvedValue({ user: undefined, db: {} });
    const { default: limitedHandler } = await import(
      "../pages/api/workspace-canvas-images/[imagePublicId]"
    );
    const invalidRequest = () =>
      ({
        method: "GET",
        query: { imagePublicId: "invalid" },
        headers: { "x-forwarded-for": "203.0.113.20" },
        socket: { remoteAddress: "127.0.0.1" },
      }) as unknown as NextApiRequest;

    for (let index = 0; index < 100; index += 1) {
      const response = createResponse();
      await limitedHandler(invalidRequest(), response);
      expect(response.statusCode).toBe(400);
    }
    const rejected = createResponse();
    await limitedHandler(invalidRequest(), rejected);
    expect(rejected.statusCode).toBe(429);
    expect(rejected.body).toEqual({
      message: "Too many requests, please try again later.",
    });
  });
});
