import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";

import { readSafePreviewResponse } from "./safe-preview-response";

type TestResponse = IncomingMessage & PassThrough;

const createResponse = (
  statusCode: number,
  headers: Record<string, string> = {},
) =>
  Object.assign(new PassThrough(), {
    statusCode,
    headers,
  }) as unknown as TestResponse;

describe("readSafePreviewResponse", () => {
  it("destroys a redirect without attaching a body reader", async () => {
    const response = createResponse(302, { location: "/next" });
    const destroy = vi.spyOn(response, "destroy");
    const on = vi.spyOn(response, "on");

    await expect(readSafePreviewResponse(response, 10)).resolves.toMatchObject({
      status: 302,
      body: new Uint8Array(),
    });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(on).not.toHaveBeenCalledWith("data", expect.any(Function));
  });

  it("rejects a declared oversized body before attaching a reader", async () => {
    const response = createResponse(200, { "content-length": "11" });
    const destroy = vi.spyOn(response, "destroy");
    const on = vi.spyOn(response, "on");

    await expect(readSafePreviewResponse(response, 10)).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
    });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(on).not.toHaveBeenCalledWith("data", expect.any(Function));
  });

  it("stops a streamed body as soon as it crosses the limit", async () => {
    const response = createResponse(200);
    const destroy = vi.spyOn(response, "destroy");
    const pending = readSafePreviewResponse(response, 10);

    response.write(Buffer.alloc(10));
    response.write(Buffer.alloc(1));

    await expect(pending).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("returns a body at the exact byte limit", async () => {
    const response = createResponse(200, { "content-length": "10" });
    const pending = readSafePreviewResponse(response, 10);

    response.end(Buffer.from("0123456789"));

    const result = await pending;

    expect(result.status).toBe(200);
    expect(Array.from(result.body)).toEqual(
      Array.from(Buffer.from("0123456789")),
    );
  });

  it("rejects an interrupted response without exposing transport details", async () => {
    const response = createResponse(200);
    const pending = readSafePreviewResponse(response, 10);

    response.emit("aborted");

    await expect(pending).rejects.toMatchObject({
      code: "NETWORK_FAILED",
      message: "The preview could not be fetched",
    });
  });
});
