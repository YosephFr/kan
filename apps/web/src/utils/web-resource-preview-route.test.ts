import { Writable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createNextApiContext } from "@kan/api/trpc";
import { fetchSafePreviewImage } from "@kan/api/utils/safe-preview";
import { getWebResourcePreviewForView } from "@kan/api/utils/web-resource-preview-access";

const { mockWithApiLogging } = vi.hoisted(() => ({
  mockWithApiLogging: vi.fn((handler: unknown) => handler),
}));

vi.mock("@kan/api/trpc", () => ({ createNextApiContext: vi.fn() }));
vi.mock("@kan/api/utils/apiLogging", () => ({
  withApiLogging: mockWithApiLogging,
}));
vi.mock("@kan/api/utils/rateLimit", () => ({
  withRateLimit: (_options: unknown, handler: unknown) => handler,
}));
vi.mock("@kan/api/utils/safe-preview", () => ({
  fetchSafePreviewImage: vi.fn(),
}));
vi.mock("@kan/api/utils/web-resource-preview-access", () => ({
  getWebResourcePreviewForView: vi.fn(),
}));

class TestResponse extends Writable {
  readonly body: Buffer[] = [];
  readonly headers = new Map<string, string>();
  jsonBody: unknown;
  statusCode = 200;

  _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.body.push(Buffer.from(chunk));
    callback();
  }

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  getHeader(name: string) {
    return this.headers.get(name.toLowerCase());
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(value: unknown) {
    this.jsonBody = value;
    this.end(JSON.stringify(value));
    return this;
  }
}

const request = (): NextApiRequest =>
  ({
    method: "GET",
    query: { resourcePublicId: "webresource1" },
    headers: {},
  }) as unknown as NextApiRequest;

describe("web resource preview image route", () => {
  const privateRemoteUrl =
    "https://cdn.example.com/private-preview.png?token=SECRET_QUERY";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createNextApiContext).mockResolvedValue({
      db: {},
      user: { id: "read-only-user" },
    } as never);
    vi.mocked(getWebResourcePreviewForView).mockResolvedValue({
      publicId: "webresource1",
      workspaceId: 20,
      boardVisibility: "private",
      imageUrl: privateRemoteUrl,
    } as never);
    vi.mocked(fetchSafePreviewImage).mockResolvedValue({
      resolvedUrl: privateRemoteUrl,
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      contentType: "image/jpeg",
      width: 1,
      height: 1,
    });
  });

  it("enables sensitive logging for the public preview route", async () => {
    vi.resetModules();
    const { previewImageHandler } = await import(
      "../pages/api/resources/[resourcePublicId]/preview-image"
    );

    expect(mockWithApiLogging).toHaveBeenCalledWith(previewImageHandler, {
      sensitive: true,
    });
  });

  it("returns validated image bytes with private non-sniffable headers", async () => {
    const { previewImageHandler } = await import(
      "../pages/api/resources/[resourcePublicId]/preview-image"
    );
    const response = new TestResponse();

    await previewImageHandler(
      request(),
      response as unknown as NextApiResponse,
    );

    expect(response.statusCode).toBe(200);
    expect(Buffer.concat(response.body)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    );
    expect(response.getHeader("cache-control")).toBe("private, no-store");
    expect(response.getHeader("referrer-policy")).toBe("no-referrer");
    expect(response.getHeader("x-content-type-options")).toBe("nosniff");
    expect(response.getHeader("content-security-policy")).toBe(
      "default-src 'none'",
    );
    expect(response.getHeader("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.getHeader("content-type")).toBe("image/jpeg");
    expect(response.getHeader("content-length")).toBe("4");
    expect(
      JSON.stringify([...response.headers, ...response.body]),
    ).not.toContain(privateRemoteUrl);
    expect(
      JSON.stringify([...response.headers, ...response.body]),
    ).not.toContain("SECRET_QUERY");
  });

  it("serves a public preview without an authenticated user", async () => {
    vi.mocked(createNextApiContext).mockResolvedValueOnce({
      db: {},
      user: null,
    } as never);
    vi.mocked(getWebResourcePreviewForView).mockResolvedValueOnce({
      publicId: "webresource1",
      workspaceId: 20,
      boardVisibility: "public",
      imageUrl: privateRemoteUrl,
    } as never);
    const { previewImageHandler } = await import(
      "../pages/api/resources/[resourcePublicId]/preview-image"
    );
    const response = new TestResponse();

    await previewImageHandler(
      request(),
      response as unknown as NextApiResponse,
    );

    expect(response.statusCode).toBe(200);
    expect(getWebResourcePreviewForView).toHaveBeenCalledWith(
      {},
      "webresource1",
      undefined,
    );
  });

  it.each([
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
  ] as const)("maps %s before any remote fetch", async (code, status) => {
    vi.mocked(getWebResourcePreviewForView).mockRejectedValueOnce(
      new TRPCError({ code, message: "Opaque access failure" }),
    );
    const { previewImageHandler } = await import(
      "../pages/api/resources/[resourcePublicId]/preview-image"
    );
    const response = new TestResponse();

    await previewImageHandler(
      request(),
      response as unknown as NextApiResponse,
    );

    expect(response.statusCode).toBe(status);
    expect(response.jsonBody).toEqual({
      message: "Unable to access preview image",
    });
    expect(fetchSafePreviewImage).not.toHaveBeenCalled();
  });

  it("returns an opaque error when the safe image fetch fails", async () => {
    vi.mocked(fetchSafePreviewImage).mockRejectedValueOnce(
      new Error(`Unable to fetch ${privateRemoteUrl}`),
    );
    const { previewImageHandler } = await import(
      "../pages/api/resources/[resourcePublicId]/preview-image"
    );
    const response = new TestResponse();

    await previewImageHandler(
      request(),
      response as unknown as NextApiResponse,
    );

    expect(response.statusCode).toBe(502);
    expect(response.jsonBody).toEqual({
      message: "Unable to access preview image",
    });
    expect(JSON.stringify(response.jsonBody)).not.toContain(privateRemoteUrl);
    expect(JSON.stringify(response.jsonBody)).not.toContain("SECRET_QUERY");
  });
});
