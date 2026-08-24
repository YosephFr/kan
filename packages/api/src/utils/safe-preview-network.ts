import { lookup as nodeLookup } from "node:dns/promises";
import * as https from "node:https";
import { isIP } from "node:net";

import type {
  SafePreviewHeaders,
  SafePreviewTransportResponse,
} from "./safe-preview-types";
import { readSafePreviewResponse } from "./safe-preview-response";
import { SAFE_PREVIEW_LIMITS, SafePreviewError } from "./safe-preview-types";

export interface SafePreviewAddress {
  address: string;
  family: 4 | 6;
}

export interface SafePreviewPinnedRequest {
  url: string;
  address: SafePreviewAddress;
  accept: string;
  maxBytes: number;
  signal: AbortSignal;
}

export interface SafePreviewNetworkResponse
  extends SafePreviewTransportResponse {
  resolvedUrl: string;
}

export interface SafePreviewRedirectBudget {
  remaining: number;
}

export interface SafePreviewNetworkDependencies {
  lookup: (hostname: string) => Promise<readonly SafePreviewAddress[]>;
  request: (
    input: SafePreviewPinnedRequest,
  ) => Promise<SafePreviewTransportResponse>;
}

export interface SafePreviewNetwork {
  fetch: (
    url: string,
    options: {
      accept: string;
      maxBytes: number;
      redirects: SafePreviewRedirectBudget;
      signal: AbortSignal;
    },
  ) => Promise<SafePreviewNetworkResponse>;
}

const ipv4Ranges = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.31.196.0", 24],
  ["192.52.193.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["192.175.48.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

const ipv6Ranges = [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["2620:4f:8000::", 48],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const;

const ipv4ToBigInt = (address: string) =>
  address
    .split(".")
    .reduce((value, part) => (value << 8n) | BigInt(Number(part)), 0n);

const expandIpv6 = (address: string) => {
  let source = address.toLowerCase();
  if (source.includes("%")) throw new SafePreviewError("UNSAFE_TARGET");

  const lastColon = source.lastIndexOf(":");
  const ipv4Suffix = source.slice(lastColon + 1);
  if (ipv4Suffix.includes(".")) {
    if (isIP(ipv4Suffix) !== 4) {
      throw new SafePreviewError("UNSAFE_TARGET");
    }
    const value = ipv4ToBigInt(ipv4Suffix);
    source = `${source.slice(0, lastColon)}:${(
      (value >> 16n) &
      0xffffn
    ).toString(16)}:${(value & 0xffffn).toString(16)}`;
  }

  const halves = source.split("::");
  if (halves.length > 2) throw new SafePreviewError("UNSAFE_TARGET");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    throw new SafePreviewError("UNSAFE_TARGET");
  }
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (groups.length !== 8) throw new SafePreviewError("UNSAFE_TARGET");

  return groups.reduce((value, group) => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      throw new SafePreviewError("UNSAFE_TARGET");
    }
    return (value << 16n) | BigInt(`0x${group}`);
  }, 0n);
};

const matchesRange = (
  value: bigint,
  base: bigint,
  prefix: number,
  bits: number,
) => {
  const shift = BigInt(bits - prefix);
  return value >> shift === base >> shift;
};

export const isPublicPreviewAddress = (address: string) => {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4ToBigInt(address);
    return !ipv4Ranges.some(([base, prefix]) =>
      matchesRange(value, ipv4ToBigInt(base), prefix, 32),
    );
  }
  if (family === 6) {
    const value = expandIpv6(address);
    if (!matchesRange(value, expandIpv6("2000::"), 3, 128)) return false;
    return !ipv6Ranges.some(([base, prefix]) =>
      matchesRange(value, expandIpv6(base), prefix, 128),
    );
  }
  return false;
};

const normalizedHostname = (url: URL) =>
  url.hostname.replace(/^\[/, "").replace(/\]$/, "");

export const normalizeSafePreviewUrl = (value: string) => {
  const candidate = value.trim();
  if (
    candidate.length === 0 ||
    Buffer.byteLength(candidate, "utf8") > SAFE_PREVIEW_LIMITS.urlBytes
  ) {
    throw new SafePreviewError("INVALID_URL");
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new SafePreviewError("INVALID_URL");
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443")
  ) {
    throw new SafePreviewError("INVALID_URL");
  }

  const hostname = normalizedHostname(url).replace(/\.+$/, "");
  if (hostname.length === 0 || isIP(hostname) !== 0) {
    throw new SafePreviewError("UNSAFE_TARGET");
  }

  url.hostname = hostname;
  url.port = "";
  url.hash = "";
  const normalized = url.toString();
  if (Buffer.byteLength(normalized, "utf8") > SAFE_PREVIEW_LIMITS.urlBytes) {
    throw new SafePreviewError("INVALID_URL");
  }
  return normalized;
};

const abortable = async <T>(promise: Promise<T>, signal: AbortSignal) => {
  if (signal.aborted) throw new SafePreviewError("TIMEOUT");
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SafePreviewError("TIMEOUT"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
};

const getSingleHeader = (headers: SafePreviewHeaders, name: string) => {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
};

const validateResponseSize = (
  response: SafePreviewTransportResponse,
  maxBytes: number,
) => {
  const encoding = getSingleHeader(response.headers, "content-encoding");
  if (encoding && encoding.trim().toLowerCase() !== "identity") {
    throw new SafePreviewError("INVALID_RESPONSE");
  }
  const contentLength = getSingleHeader(response.headers, "content-length");
  if (contentLength) {
    if (!/^\d+$/.test(contentLength.trim())) {
      throw new SafePreviewError("INVALID_RESPONSE");
    }
    if (Number(contentLength) > maxBytes) {
      throw new SafePreviewError("BODY_TOO_LARGE");
    }
  }
  if (response.body.byteLength > maxBytes) {
    throw new SafePreviewError("BODY_TOO_LARGE");
  }
};

export const createPinnedHttpsRequestOptions = (
  input: Omit<SafePreviewPinnedRequest, "maxBytes" | "signal">,
): https.RequestOptions => {
  const url = new URL(input.url);
  return {
    protocol: "https:",
    hostname: input.address.address,
    family: input.address.family,
    port: 443,
    method: "GET",
    path: `${url.pathname}${url.search}`,
    servername: normalizedHostname(url),
    rejectUnauthorized: true,
    agent: false,
    maxHeaderSize: 16 * 1024,
    headers: {
      Accept: input.accept,
      "Accept-Encoding": "identity",
      Host: normalizedHostname(url),
      "User-Agent": "KanPreview/1.0",
    },
  };
};

const requestPinnedHttps = async (
  input: SafePreviewPinnedRequest,
): Promise<SafePreviewTransportResponse> =>
  await abortable(
    new Promise((resolve, reject) => {
      let settled = false;
      let responseStarted = false;
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

      const request = https.request(
        {
          ...createPinnedHttpsRequestOptions(input),
          signal: input.signal,
        },
        (response) => {
          responseStarted = true;
          void readSafePreviewResponse(response, input.maxBytes).then(
            (result) => finish({ response: result }),
            (error: unknown) =>
              finish({
                error:
                  error instanceof SafePreviewError
                    ? error
                    : new SafePreviewError("NETWORK_FAILED"),
              }),
          );
        },
      );
      request.maxHeadersCount = 50;
      request.once("error", () => {
        if (responseStarted) return;
        finish({
          error: new SafePreviewError(
            input.signal.aborted ? "TIMEOUT" : "NETWORK_FAILED",
          ),
        });
      });
      request.end();
    }),
    input.signal,
  );

const defaultDependencies: SafePreviewNetworkDependencies = {
  lookup: async (hostname) => {
    try {
      const addresses = await nodeLookup(hostname, {
        all: true,
        verbatim: true,
      });
      return addresses.flatMap((address) =>
        address.family === 4 || address.family === 6
          ? [{ address: address.address, family: address.family }]
          : [],
      );
    } catch {
      throw new SafePreviewError("DNS_FAILED");
    }
  },
  request: requestPinnedHttps,
};

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export const createSafePreviewNetwork = (
  dependencies: SafePreviewNetworkDependencies,
): SafePreviewNetwork => ({
  fetch: async (value, options) => {
    let current = normalizeSafePreviewUrl(value);

    while (true) {
      const url = new URL(current);
      const hostname = normalizedHostname(url);
      let addresses: readonly SafePreviewAddress[];
      try {
        addresses = await abortable(
          dependencies.lookup(hostname),
          options.signal,
        );
      } catch (error) {
        if (error instanceof SafePreviewError) throw error;
        throw new SafePreviewError("DNS_FAILED");
      }
      if (
        addresses.length === 0 ||
        addresses.some(
          ({ address, family }) =>
            isIP(address) !== family || !isPublicPreviewAddress(address),
        )
      ) {
        throw new SafePreviewError("UNSAFE_TARGET");
      }

      const address = addresses[0];
      if (!address) throw new SafePreviewError("UNSAFE_TARGET");

      let response: SafePreviewTransportResponse;
      try {
        response = await abortable(
          dependencies.request({
            url: current,
            address,
            accept: options.accept,
            maxBytes: options.maxBytes,
            signal: options.signal,
          }),
          options.signal,
        );
      } catch (error) {
        if (error instanceof SafePreviewError) throw error;
        throw new SafePreviewError("NETWORK_FAILED");
      }

      if (redirectStatuses.has(response.status)) {
        if (options.redirects.remaining <= 0) {
          throw new SafePreviewError("TOO_MANY_REDIRECTS");
        }
        const location = getSingleHeader(response.headers, "location");
        if (!location) throw new SafePreviewError("INVALID_RESPONSE");
        options.redirects.remaining -= 1;
        try {
          current = normalizeSafePreviewUrl(
            new URL(location, current).toString(),
          );
        } catch (error) {
          if (error instanceof SafePreviewError) throw error;
          throw new SafePreviewError("INVALID_URL");
        }
        continue;
      }

      if (response.status !== 200) {
        throw new SafePreviewError("INVALID_RESPONSE");
      }
      validateResponseSize(response, options.maxBytes);
      return { ...response, resolvedUrl: current };
    }
  },
});

export const safePreviewNetwork = createSafePreviewNetwork(defaultDependencies);
