import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateUploadUrl,
  generateWorkspaceLogoUrl,
  inspectObject,
  resolveS3Endpoint,
} from "./s3";

const originalInternalEndpoint = process.env.S3_ENDPOINT;
const originalPublicEndpoint = process.env.S3_PUBLIC_ENDPOINT;
const originalAccessKey = process.env.S3_ACCESS_KEY_ID;
const originalSecretKey = process.env.S3_SECRET_ACCESS_KEY;
const originalRegion = process.env.S3_REGION;

afterEach(() => {
  vi.restoreAllMocks();
  process.env.S3_ENDPOINT = originalInternalEndpoint;
  process.env.S3_PUBLIC_ENDPOINT = originalPublicEndpoint;
  process.env.S3_ACCESS_KEY_ID = originalAccessKey;
  process.env.S3_SECRET_ACCESS_KEY = originalSecretKey;
  process.env.S3_REGION = originalRegion;
});

describe("inspectObject", () => {
  it("rejects an oversized object after HEAD without downloading it", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValueOnce({
      ETag: '"etag"',
      ContentLength: 101,
      ContentType: "image/png",
    } as never);

    await expect(
      inspectObject("attachments", ".uploads/session/image.png", {
        maxBytes: 100,
        expectedBytes: 100,
      }),
    ).rejects.toMatchObject({ code: "OBJECT_TOO_LARGE" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("downloads an object whose HEAD size is exactly the limit", async () => {
    const body = Readable.from([new Uint8Array([1, 2, 3])]);
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockResolvedValueOnce({
        ETag: '"etag"',
        ContentLength: 3,
        ContentType: "image/png",
      } as never)
      .mockResolvedValueOnce({ Body: body } as never);

    await expect(
      inspectObject("attachments", ".uploads/session/image.png", {
        maxBytes: 3,
        expectedBytes: 3,
      }),
    ).resolves.toMatchObject({ size: 3 });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("generateUploadUrl", () => {
  it("signs the exact content length supplied by the client", async () => {
    process.env.S3_ENDPOINT = "https://storage.example.com";
    process.env.S3_PUBLIC_ENDPOINT = "https://storage.example.com";
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.S3_REGION = "us-east-1";

    const url = new URL(
      await generateUploadUrl(
        "attachments",
        ".uploads/session/file.pdf",
        "application/pdf",
        1234,
      ),
    );

    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;host",
    );
  });
});

describe("resolveS3Endpoint", () => {
  it("uses the internal endpoint for server-side S3 operations", () => {
    process.env.S3_ENDPOINT = "http://minio:9000";
    process.env.S3_PUBLIC_ENDPOINT = "https://storage.example.com";

    expect(resolveS3Endpoint()).toBe("http://minio:9000");
  });

  it("uses the public endpoint for presigned browser URLs", () => {
    process.env.S3_ENDPOINT = "http://minio:9000";
    process.env.S3_PUBLIC_ENDPOINT = "https://storage.example.com";

    expect(resolveS3Endpoint(true)).toBe("https://storage.example.com");
  });

  it("falls back to the internal endpoint when no public endpoint is set", () => {
    process.env.S3_ENDPOINT = "https://s3.example.com";
    delete process.env.S3_PUBLIC_ENDPOINT;

    expect(resolveS3Endpoint(true)).toBe("https://s3.example.com");
  });
});

describe("generateWorkspaceLogoUrl", () => {
  it("preserves external workspace logo URLs", async () => {
    await expect(
      generateWorkspaceLogoUrl("https://cdn.example.com/workspace.png"),
    ).resolves.toBe("https://cdn.example.com/workspace.png");
  });

  it("returns null when a workspace has no logo", async () => {
    await expect(generateWorkspaceLogoUrl(null)).resolves.toBeNull();
  });
});
