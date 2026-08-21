import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "./security-headers";

describe("security headers", () => {
  it("builds the exact production policy with runtime origins", () => {
    const headers = buildSecurityHeaders({
      nodeEnv: "production",
      posthogHost: "https://analytics.example.com/path",
      storageEndpoint: "https://storage.example.com/kan-attachments",
    });
    const csp = headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(csp).toBe(
      "default-src 'self'; base-uri 'self'; connect-src 'self' https://www.youtube.com https://cloud.umami.is https://analytics.example.com https://storage.example.com; font-src 'self' data:; form-action 'self'; frame-ancestors 'self'; frame-src 'self' https://docs.google.com https://drive.google.com https://www.youtube.com; img-src 'self' data: blob: https:; media-src 'self' blob: https:; object-src 'none'; script-src 'self' 'unsafe-inline' https://cloud.umami.is https://analytics.example.com; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:",
    );
  });

  it("does not trust malformed analytics hosts", () => {
    const headers = buildSecurityHeaders({
      nodeEnv: "production",
      posthogHost: "https://user:password@analytics.example.com",
      storageEndpoint: "http://minio:9000",
    });
    const csp = headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(csp).not.toContain("analytics.example.com");
    expect(csp).not.toContain("http://minio:9000");
    expect(headers).toContainEqual({
      key: "X-Content-Type-Options",
      value: "nosniff",
    });
    expect(headers).toContainEqual({
      key: "Referrer-Policy",
      value: "no-referrer",
    });
  });
});
