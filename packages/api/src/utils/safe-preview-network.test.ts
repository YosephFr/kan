import { describe, expect, it, vi } from "vitest";

import type {
  SafePreviewAddress,
  SafePreviewNetworkDependencies,
  SafePreviewPinnedRequest,
} from "./safe-preview-network";
import {
  createPinnedHttpsRequestOptions,
  createSafePreviewNetwork,
  isPublicPreviewAddress,
  normalizeSafePreviewUrl,
} from "./safe-preview-network";
import { SafePreviewError } from "./safe-preview-types";

const publicAddress: SafePreviewAddress = {
  address: "93.184.216.34",
  family: 4,
};

const fetchOptions = (maximum = 10) => ({
  accept: "text/html",
  maxBytes: maximum,
  redirects: { remaining: 3 },
  signal: new AbortController().signal,
});

const response = (
  status = 200,
  headers: Record<string, string> = {},
  body = new Uint8Array(),
) => ({ status, headers, body });

const expectErrorCode = (action: () => unknown, code: string) => {
  try {
    action();
    expect.unreachable();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
};

describe("normalizeSafePreviewUrl", () => {
  it("normalizes HTTPS URLs without retaining fragments", () => {
    expect(
      normalizeSafePreviewUrl(
        "  HTTPS://Example.COM.:443/path?q=1#private-fragment  ",
      ),
    ).toBe("https://example.com/path?q=1");
  });

  it.each([
    "http://example.com",
    "https://example.com:444",
    "https://user@example.com",
    "https://user:secret@example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://2130706433",
    "https://0177.0.0.1",
    "https://0x7f000001",
  ])("rejects unsafe URL %s", (value) => {
    expect(() => normalizeSafePreviewUrl(value)).toThrow(SafePreviewError);
  });

  it("rejects URLs above the normalized byte limit", () => {
    expectErrorCode(
      () => normalizeSafePreviewUrl(`https://example.com/${"a".repeat(2049)}`),
      "INVALID_URL",
    );
  });
});

describe("isPublicPreviewAddress", () => {
  it.each([
    "0.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::127.0.0.1",
    "100::1",
    "100:0:0:1::1",
    "2001::1",
    "2001:db8::1",
    "2002::1",
    "3fff::1",
    "4000::1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff00::1",
  ])("blocks non-public address %s", (address) => {
    expect(isPublicPreviewAddress(address)).toBe(false);
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
  ])("allows public address %s", (address) => {
    expect(isPublicPreviewAddress(address)).toBe(true);
  });
});

describe("createPinnedHttpsRequestOptions", () => {
  it("pins the socket while preserving TLS and HTTP host identity", () => {
    const options = createPinnedHttpsRequestOptions({
      url: "https://example.com/private/path?q=1",
      address: publicAddress,
      accept: "text/html",
    });
    const headers = options.headers as Record<string, string>;

    expect(options).toMatchObject({
      protocol: "https:",
      hostname: publicAddress.address,
      family: 4,
      port: 443,
      method: "GET",
      path: "/private/path?q=1",
      servername: "example.com",
      rejectUnauthorized: true,
      agent: false,
    });
    expect(headers).toEqual({
      Accept: "text/html",
      "Accept-Encoding": "identity",
      Host: "example.com",
      "User-Agent": "KanPreview/1.0",
    });
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toEqual(
      expect.arrayContaining(["authorization", "cookie", "referer"]),
    );
  });
});

describe("createSafePreviewNetwork", () => {
  const createDependencies = (
    implementation: (
      input: SafePreviewPinnedRequest,
    ) => Promise<ReturnType<typeof response>> = () =>
      Promise.resolve(response()),
  ) => {
    const lookup = vi.fn(() => Promise.resolve([publicAddress]));
    const request = vi.fn(implementation);
    const dependencies: SafePreviewNetworkDependencies = { lookup, request };
    return { lookup, request, network: createSafePreviewNetwork(dependencies) };
  };

  it("pins requests to the address returned by the verified lookup", async () => {
    const { network, lookup, request } = createDependencies(() =>
      Promise.resolve(response(200, {}, new Uint8Array([1, 2, 3]))),
    );

    const result = await network.fetch(
      "https://example.com/document",
      fetchOptions(),
    );

    expect(lookup).toHaveBeenCalledWith("example.com");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/document",
        address: publicAddress,
        accept: "text/html",
        maxBytes: 10,
      }),
    );
    expect(result.resolvedUrl).toBe("https://example.com/document");
  });

  it("rejects a lookup containing any private result before requesting", async () => {
    const { network, lookup, request } = createDependencies();
    lookup.mockResolvedValueOnce([
      publicAddress,
      { address: "127.0.0.1", family: 4 },
    ]);

    await expect(
      network.fetch("https://example.com", fetchOptions()),
    ).rejects.toMatchObject({ code: "UNSAFE_TARGET" });
    expect(request).not.toHaveBeenCalled();
  });

  it("makes only one request when DNS returns multiple public addresses", async () => {
    const { network, lookup, request } = createDependencies(() =>
      Promise.reject(new SafePreviewError("NETWORK_FAILED")),
    );
    lookup.mockResolvedValueOnce([
      publicAddress,
      { address: "1.1.1.1", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);

    await expect(
      network.fetch("https://example.com", fetchOptions()),
    ).rejects.toMatchObject({ code: "NETWORK_FAILED" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ address: publicAddress }),
    );
  });

  it("blocks an internal literal redirect before another lookup", async () => {
    const { network, lookup, request } = createDependencies(() =>
      Promise.resolve(response(302, { location: "https://127.0.0.1/admin" })),
    );

    await expect(
      network.fetch("https://example.com", fetchOptions()),
    ).rejects.toMatchObject({ code: "UNSAFE_TARGET" });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("re-resolves each redirect and blocks DNS rebinding", async () => {
    const { network, lookup, request } = createDependencies(() =>
      Promise.resolve(response(302, { location: "/second" })),
    );
    lookup
      .mockResolvedValueOnce([publicAddress])
      .mockResolvedValueOnce([{ address: "10.0.0.8", family: 4 }]);

    await expect(
      network.fetch("https://example.com/first", fetchOptions()),
    ).rejects.toMatchObject({ code: "UNSAFE_TARGET" });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("allows exactly three redirects and preserves the final URL", async () => {
    const { network, request } = createDependencies((input) => {
      const path = new URL(input.url).pathname;
      if (path === "/start") {
        return Promise.resolve(response(302, { location: "/one" }));
      }
      if (path === "/one") {
        return Promise.resolve(response(307, { location: "/two" }));
      }
      if (path === "/two") {
        return Promise.resolve(response(308, { location: "/three" }));
      }
      return Promise.resolve(response(200, {}, new Uint8Array([1])));
    });
    const options = fetchOptions();

    const result = await network.fetch("https://example.com/start", options);

    expect(result.resolvedUrl).toBe("https://example.com/three");
    expect(options.redirects.remaining).toBe(0);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("rejects a fourth redirect", async () => {
    let redirect = 0;
    const { network, request } = createDependencies(() => {
      redirect += 1;
      return Promise.resolve(response(302, { location: `/${redirect}` }));
    });

    await expect(
      network.fetch("https://example.com/start", fetchOptions()),
    ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["declared size", { "content-length": "11" }, new Uint8Array()],
    ["streamed size", {}, new Uint8Array(11)],
  ])("rejects a body above the %s limit", async (_name, headers, body) => {
    const { network } = createDependencies(() =>
      Promise.resolve(response(200, headers, body)),
    );

    await expect(
      network.fetch("https://example.com", fetchOptions()),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });

  it.each([
    [{ "content-encoding": "gzip" }, "INVALID_RESPONSE"],
    [{ "content-length": "not-a-number" }, "INVALID_RESPONSE"],
  ])("rejects invalid transport headers", async (headers, code) => {
    const { network } = createDependencies(() =>
      Promise.resolve(response(200, headers)),
    );

    await expect(
      network.fetch("https://example.com", fetchOptions()),
    ).rejects.toMatchObject({ code });
  });

  it("rejects non-success responses and redirects without a location", async () => {
    const notFound = createDependencies(() => Promise.resolve(response(404)));
    const redirect = createDependencies(() => Promise.resolve(response(302)));

    await expect(
      notFound.network.fetch("https://example.com", fetchOptions()),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      redirect.network.fetch("https://example.com", fetchOptions()),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("never includes the target URL in an error", async () => {
    const secret = "never-log-this-token";
    const { network } = createDependencies(() =>
      Promise.reject(new Error(secret)),
    );

    try {
      await network.fetch(`https://example.com/${secret}`, fetchOptions());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SafePreviewError);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
