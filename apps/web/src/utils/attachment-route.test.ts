import { Readable, Writable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as SharedUtils from "@kan/shared/utils";
import { createNextApiContext } from "@kan/api/trpc";
import { getAttachmentForView } from "@kan/api/utils/attachment-access";
import { getAttachmentObject, getObjectPrefix } from "@kan/shared/utils";

vi.mock("@kan/api/trpc", () => ({ createNextApiContext: vi.fn() }));
vi.mock("@kan/api/utils/apiLogging", () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock("@kan/api/utils/attachment-access", () => ({
  getAttachmentForView: vi.fn(),
}));
vi.mock("@kan/api/utils/rateLimit", () => ({
  withRateLimit: (_options: unknown, handler: unknown) => handler,
}));
vi.mock("@kan/shared/utils", async (importOriginal) => {
  const original = await importOriginal<typeof SharedUtils>();
  return {
    ...original,
    getAttachmentObject: vi.fn(),
    getObjectPrefix: vi.fn(),
  };
});
vi.mock("~/env", () => ({
  env: { NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME: "attachments" },
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

const attachment = {
  publicId: "attachment01",
  contentType: "application/pdf",
  originalFilename: "private report.pdf",
  size: 5,
  s3Key: "old-workspace/cardpublic01/private-object.pdf",
};

function request(mode: "download" | "view", range?: string): NextApiRequest {
  return {
    method: "GET",
    query: { attachmentPublicId: "attachment01", mode },
    headers: range ? { range } : {},
  } as unknown as NextApiRequest;
}

describe("attachment streaming route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createNextApiContext).mockResolvedValue({
      db: {},
      user: { id: "user-1" },
    } as never);
    vi.mocked(getAttachmentForView).mockResolvedValue(attachment as never);
    vi.mocked(getObjectPrefix).mockResolvedValue(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    );
    vi.mocked(getAttachmentObject).mockResolvedValue({
      Body: Readable.from([Buffer.from("hello")]),
      ContentLength: 5,
    } as never);
  });

  it("streams a private download without redirecting or exposing its key", async () => {
    const { attachmentHandler } = await import(
      "../pages/api/attachments/[attachmentPublicId]/[mode]"
    );
    const response = new TestResponse();

    await attachmentHandler(
      request("download"),
      response as unknown as NextApiResponse,
    );

    expect(response.statusCode).toBe(200);
    expect(Buffer.concat(response.body).toString()).toBe("hello");
    expect(response.getHeader("location")).toBeUndefined();
    expect(response.getHeader("cache-control")).toBe("private, no-store");
    expect(response.getHeader("content-security-policy")).toContain("sandbox");
    expect(response.getHeader("x-content-type-options")).toBe("nosniff");
    expect(response.getHeader("content-type")).toBe("application/octet-stream");
    expect(response.getHeader("content-disposition")).toContain("attachment");
    expect(
      JSON.stringify([...response.headers, ...response.body]),
    ).not.toContain(attachment.s3Key);
  });

  it("forwards a normalized single range and returns 206", async () => {
    vi.mocked(getAttachmentObject).mockResolvedValue({
      Body: Readable.from([Buffer.from("ell")]),
      ContentLength: 3,
      ContentRange: "bytes 1-3/5",
    } as never);
    const { attachmentHandler } = await import(
      "../pages/api/attachments/[attachmentPublicId]/[mode]"
    );
    const response = new TestResponse();

    await attachmentHandler(
      request("download", "bytes=1-3"),
      response as unknown as NextApiResponse,
    );

    expect(response.statusCode).toBe(206);
    expect(response.getHeader("content-range")).toBe("bytes 1-3/5");
    expect(response.getHeader("content-length")).toBe("3");
    expect(getAttachmentObject).toHaveBeenCalledWith(
      expect.objectContaining({ range: "bytes=1-3" }),
    );
    expect(Buffer.concat(response.body).toString()).toBe("ell");
  });

  it("rejects an unsatisfiable range without reading storage", async () => {
    const { attachmentHandler } = await import(
      "../pages/api/attachments/[attachmentPublicId]/[mode]"
    );
    const response = new TestResponse();

    await attachmentHandler(
      request("download", "bytes=20-30"),
      response as unknown as NextApiResponse,
    );

    expect(response.statusCode).toBe(416);
    expect(response.getHeader("content-range")).toBe("bytes */5");
    expect(getAttachmentObject).not.toHaveBeenCalled();
  });
});
