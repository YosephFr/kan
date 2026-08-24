import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CARD_CANVAS_IMAGE_BYTES,
  MAX_CARD_CANVAS_IMAGE_DIMENSION,
  MAX_CARD_CANVAS_IMAGE_PIXELS,
} from "@kan/shared";

import type {
  SafePreviewAddress,
  SafePreviewNetwork,
  SafePreviewNetworkResponse,
} from "./safe-preview-network";
import {
  createRemoteCardImageFetcher,
  importRemoteCardImage,
  REMOTE_CARD_IMAGE_LIMITS,
} from "./card-resource-remote-image";
import { createSafePreviewNetwork } from "./safe-preview-network";
import { SafePreviewError } from "./safe-preview-types";

const png = (width: number, height: number, size = 24) => {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

const response = (body: Uint8Array, contentType = "image/png") =>
  ({
    status: 200,
    headers: { "content-type": contentType },
    body,
    resolvedUrl: "https://cdn.example.com/final.png",
  }) satisfies SafePreviewNetworkResponse;

const networkWith = (implementation: SafePreviewNetwork["fetch"]) => {
  const fetch = vi.fn(implementation);
  return { fetch, network: { fetch } satisfies SafePreviewNetwork };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("remote card image fetch", () => {
  const publicAddress: SafePreviewAddress = {
    address: "93.184.216.34",
    family: 4,
  };

  it("uses the whiteboard byte, redirect and dimension limits", async () => {
    const exactWidth = MAX_CARD_CANVAS_IMAGE_DIMENSION;
    const exactHeight =
      MAX_CARD_CANVAS_IMAGE_PIXELS / MAX_CARD_CANVAS_IMAGE_DIMENSION;
    const { fetch, network } = networkWith(() =>
      Promise.resolve(response(png(exactWidth, exactHeight))),
    );

    await expect(
      createRemoteCardImageFetcher(network)(
        "https://cdn.example.com/start.png",
      ),
    ).resolves.toMatchObject({
      contentType: "image/png",
      width: exactWidth,
      height: exactHeight,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://cdn.example.com/start.png",
      expect.objectContaining({
        accept: "image/jpeg,image/png,image/webp",
        maxBytes: MAX_CARD_CANVAS_IMAGE_BYTES,
        redirects: { remaining: 3 },
      }),
    );
  });

  it("accepts exactly 10 MiB and rejects one byte more before insertion", async () => {
    const exact = networkWith(() =>
      Promise.resolve(response(png(1, 1, MAX_CARD_CANVAS_IMAGE_BYTES))),
    );
    await expect(
      createRemoteCardImageFetcher(exact.network)(
        "https://cdn.example.com/exact.png",
      ),
    ).resolves.toMatchObject({ width: 1, height: 1 });

    const excessive = networkWith(() =>
      Promise.resolve(response(png(1, 1, MAX_CARD_CANVAS_IMAGE_BYTES + 1))),
    );
    await expect(
      createRemoteCardImageFetcher(excessive.network)(
        "https://cdn.example.com/excessive.png",
      ),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });

  it.each([
    ["image/jpeg", png(100, 100), "UNSUPPORTED_MIME"],
    ["image/svg+xml", Buffer.from("<svg></svg>"), "UNSUPPORTED_MIME"],
    ["text/html", Buffer.from("<html></html>"), "UNSUPPORTED_MIME"],
    ["image/png", png(MAX_CARD_CANVAS_IMAGE_DIMENSION + 1, 1), "INVALID_IMAGE"],
  ])("rejects unsafe image response %s", async (contentType, body, code) => {
    const { network } = networkWith(() =>
      Promise.resolve(response(body, contentType)),
    );

    await expect(
      createRemoteCardImageFetcher(network)("https://cdn.example.com/file"),
    ).rejects.toMatchObject({ code });
  });

  it("enforces the four-second deadline", async () => {
    vi.useFakeTimers();
    const { network } = networkWith(
      async (_url, options) =>
        await new Promise<SafePreviewNetworkResponse>((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new SafePreviewError("TIMEOUT")),
            { once: true },
          );
        }),
    );
    const pending = createRemoteCardImageFetcher(network)(
      "https://cdn.example.com/image.png",
    );
    const assertion = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
    });

    await vi.advanceTimersByTimeAsync(REMOTE_CARD_IMAGE_LIMITS.timeoutMs);
    await assertion;
  });

  it.each([
    ["http://example.com/image.png", "INVALID_URL"],
    ["https://example.com:444/image.png", "INVALID_URL"],
    ["https://user:secret@example.com/image.png", "INVALID_URL"],
    ["https://127.0.0.1/image.png", "UNSAFE_TARGET"],
    ["https://[::1]/image.png", "UNSAFE_TARGET"],
  ])("blocks an unsafe target before a request: %s", async (url, code) => {
    const request = vi.fn(() => Promise.resolve(response(png(1, 1))));
    const network = createSafePreviewNetwork({
      lookup: vi.fn(() => Promise.resolve([publicAddress])),
      request,
    });

    await expect(
      createRemoteCardImageFetcher(network)(url),
    ).rejects.toMatchObject({ code });
    expect(request).not.toHaveBeenCalled();
  });

  it("revalidates redirect DNS and blocks a private rebound address", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValueOnce([{ address: "10.0.0.8", family: 4 }]);
    const request = vi.fn(() =>
      Promise.resolve({
        status: 302,
        headers: { location: "/private.png" },
        body: new Uint8Array(),
      }),
    );
    const network = createSafePreviewNetwork({ lookup, request });

    await expect(
      createRemoteCardImageFetcher(network)(
        "https://images.example.com/start.png",
      ),
    ).rejects.toMatchObject({ code: "UNSAFE_TARGET" });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("remote card image staging", () => {
  const imageBytes = png(320, 240);
  const attachment = {
    publicId: "attachment01",
    originalFilename: "imagen-pizarra.png",
    contentType: "image/png",
    size: imageBytes.byteLength,
    createdAt: new Date("2026-08-24T12:00:00.000Z"),
  };

  const createDependencies = () => ({
    fetchImage: vi.fn(() =>
      Promise.resolve({
        bytes: imageBytes,
        contentType: "image/png" as const,
        width: 320,
        height: 240,
      }),
    ),
    createUpload: vi.fn(() =>
      Promise.resolve({ uploadSessionPublicId: "uploadsess01" }),
    ),
    writeStagingObject: vi.fn(() => Promise.resolve()),
    confirmUpload: vi.fn(() => Promise.resolve(attachment)),
    discardUpload: vi.fn(() => Promise.resolve()),
  });

  it("uses the opaque upload session, staging path and confirmation flow", async () => {
    const dependencies = createDependencies();

    await expect(
      importRemoteCardImage(
        "https://cdn.example.com/private.png?token=secret",
        dependencies,
      ),
    ).resolves.toEqual(attachment);
    expect(dependencies.createUpload).toHaveBeenCalledWith({
      filename: "imagen-pizarra.png",
      contentType: "image/png",
      size: imageBytes.byteLength,
      sha256:
        "8ddff65b4fa5ab56fcf7c8eefdb4c33f305dba43b56db9c3d22ce169540b963c",
    });
    expect(dependencies.writeStagingObject).toHaveBeenCalledWith({
      key: ".uploads/uploadsess01/imagen-pizarra.png",
      bytes: imageBytes,
      contentType: "image/png",
    });
    expect(dependencies.confirmUpload).toHaveBeenCalledWith("uploadsess01");
    expect(dependencies.discardUpload).not.toHaveBeenCalled();
  });

  it("cleans the staging object and session when confirmation fails", async () => {
    const dependencies = createDependencies();
    const failure = new Error("confirmation failed");
    dependencies.confirmUpload.mockRejectedValueOnce(failure);

    await expect(
      importRemoteCardImage(
        "https://cdn.example.com/private.png?token=secret",
        dependencies,
      ),
    ).rejects.toBe(failure);
    expect(dependencies.discardUpload).toHaveBeenCalledWith({
      uploadSessionPublicId: "uploadsess01",
      stagingKey: ".uploads/uploadsess01/imagen-pizarra.png",
    });
  });

  it("does not create an upload session when fetching or validation fails", async () => {
    const dependencies = createDependencies();
    dependencies.fetchImage.mockRejectedValueOnce(
      new SafePreviewError("UNSAFE_TARGET"),
    );

    await expect(
      importRemoteCardImage("https://localhost/private.png", dependencies),
    ).rejects.toMatchObject({ code: "UNSAFE_TARGET" });
    expect(dependencies.createUpload).not.toHaveBeenCalled();
    expect(dependencies.writeStagingObject).not.toHaveBeenCalled();
  });
});
