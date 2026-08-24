import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SafePreviewNetwork,
  SafePreviewNetworkResponse,
} from "./safe-preview-network";
import {
  createSafePreviewFetcher,
  createSafePreviewImageFetcher,
} from "./safe-preview";
import { SAFE_PREVIEW_LIMITS, SafePreviewError } from "./safe-preview-types";

const png = (width: number, height: number) => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

const networkResponse = (
  resolvedUrl: string,
  contentType: string,
  body: Uint8Array,
): SafePreviewNetworkResponse => ({
  status: 200,
  headers: { "content-type": contentType },
  body,
  resolvedUrl,
});

const networkWith = (implementation: SafePreviewNetwork["fetch"]) => {
  const fetch = vi.fn(implementation);
  return { fetch, network: { fetch } satisfies SafePreviewNetwork };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("createSafePreviewFetcher", () => {
  it("fetches HTML and a bounded image through one shared security budget", async () => {
    const document = networkResponse(
      "https://example.com/final",
      "text/html; charset=utf-8",
      Buffer.from(`
        <meta property="og:title" content="Preview title">
        <meta property="og:site_name" content="Preview site">
        <meta property="og:description" content="Preview description">
        <meta property="og:image" content="https://cdn.example.com/a.png">
      `),
    );
    const previewImage = networkResponse(
      "https://cdn.example.com/final.png",
      "image/png",
      png(1200, 630),
    );
    const { fetch, network } = networkWith((_url, options) =>
      Promise.resolve(
        options.accept.startsWith("text/html") ? document : previewImage,
      ),
    );

    const metadata = await createSafePreviewFetcher(network)(
      "https://example.com/start",
    );

    expect(metadata).toMatchObject({
      resolvedUrl: "https://example.com/final",
      title: "Preview title",
      siteName: "Preview site",
      description: "Preview description",
      image: {
        resolvedUrl: "https://cdn.example.com/final.png",
        contentType: "image/png",
        width: 1200,
        height: 630,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      maxBytes: SAFE_PREVIEW_LIMITS.htmlBytes,
      redirects: { remaining: SAFE_PREVIEW_LIMITS.redirects },
    });
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      maxBytes: SAFE_PREVIEW_LIMITS.imageBytes,
    });
    expect(fetch.mock.calls[0]?.[1].redirects).toBe(
      fetch.mock.calls[1]?.[1].redirects,
    );
  });

  it("returns metadata without making an image request when none is declared", async () => {
    const { fetch, network } = networkWith(() =>
      Promise.resolve(
        networkResponse(
          "https://example.com",
          "application/xhtml+xml",
          Buffer.from("<title>Only metadata</title>"),
        ),
      ),
    );

    await expect(
      createSafePreviewFetcher(network)("https://example.com"),
    ).resolves.toMatchObject({ title: "Only metadata", image: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["application/json", "text/plain", "image/png"])(
    "rejects unsupported document MIME %s",
    async (contentType) => {
      const { network } = networkWith(() =>
        Promise.resolve(
          networkResponse("https://example.com", contentType, new Uint8Array()),
        ),
      );
      await expect(
        createSafePreviewFetcher(network)("https://example.com"),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_MIME" });
    },
  );

  it("falls back to metadata when the optional image is unsafe", async () => {
    let request = 0;
    const { network } = networkWith(() => {
      request += 1;
      if (request === 1) {
        return Promise.resolve(
          networkResponse(
            "https://example.com",
            "text/html",
            Buffer.from(
              '<meta property="og:image" content="https://cdn.example.com/a.png"><title>Safe fallback</title>',
            ),
          ),
        );
      }
      return Promise.reject(new SafePreviewError("UNSAFE_TARGET"));
    });

    await expect(
      createSafePreviewFetcher(network)("https://example.com"),
    ).resolves.toMatchObject({ title: "Safe fallback", image: null });
  });

  it("falls back to metadata when image bytes disagree with MIME", async () => {
    let request = 0;
    const { network } = networkWith(() => {
      request += 1;
      return Promise.resolve(
        request === 1
          ? networkResponse(
              "https://example.com",
              "text/html",
              Buffer.from(
                '<meta property="og:image" content="https://cdn.example.com/a.png"><title>Safe fallback</title>',
              ),
            )
          : networkResponse(
              "https://cdn.example.com/a.png",
              "image/jpeg",
              png(100, 100),
            ),
      );
    });

    await expect(
      createSafePreviewFetcher(network)("https://example.com"),
    ).resolves.toMatchObject({ title: "Safe fallback", image: null });
  });

  it("enforces a four-second deadline while fetching the document", async () => {
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
    const pending = createSafePreviewFetcher(network)("https://example.com");
    const assertion = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
    });

    await vi.advanceTimersByTimeAsync(SAFE_PREVIEW_LIMITS.timeoutMs);
    await assertion;
  });
});

describe("createSafePreviewImageFetcher", () => {
  it("fetches only the image and returns its verified final URL", async () => {
    const { fetch, network } = networkWith(() =>
      Promise.resolve(
        networkResponse(
          "https://cdn.example.com/final.png",
          "image/png",
          png(640, 360),
        ),
      ),
    );

    await expect(
      createSafePreviewImageFetcher(network)(
        "https://cdn.example.com/start.png",
      ),
    ).resolves.toMatchObject({
      resolvedUrl: "https://cdn.example.com/final.png",
      contentType: "image/png",
      width: 640,
      height: 360,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://cdn.example.com/start.png",
      expect.objectContaining({
        accept: "image/jpeg,image/png,image/webp",
        maxBytes: SAFE_PREVIEW_LIMITS.imageBytes,
        redirects: { remaining: SAFE_PREVIEW_LIMITS.redirects },
      }),
    );
  });

  it("rejects invalid image MIME instead of returning metadata", async () => {
    const { network } = networkWith(() =>
      Promise.resolve(
        networkResponse(
          "https://cdn.example.com/image.svg",
          "image/svg+xml",
          Buffer.from("<svg></svg>"),
        ),
      ),
    );

    await expect(
      createSafePreviewImageFetcher(network)(
        "https://cdn.example.com/image.svg",
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MIME" });
  });

  it("enforces its own four-second deadline", async () => {
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
    const pending = createSafePreviewImageFetcher(network)(
      "https://cdn.example.com/image.png",
    );
    const assertion = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
    });

    await vi.advanceTimersByTimeAsync(SAFE_PREVIEW_LIMITS.timeoutMs);
    await assertion;
  });
});
