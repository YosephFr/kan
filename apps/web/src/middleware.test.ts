import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { middleware } from "./middleware";

const { envMock } = vi.hoisted(() => ({
  envMock: vi.fn(),
}));

vi.mock("next-runtime-env", () => ({
  env: envMock,
}));

describe("root middleware", () => {
  beforeEach(() => {
    envMock.mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "production";
      if (key === "NEXT_PUBLIC_KAN_ENV") return "self-hosted";
      if (key === "NEXT_PUBLIC_POSTHOG_HOST") {
        return "https://analytics.runtime.test/capture";
      }
      if (key === "S3_PUBLIC_ENDPOINT") {
        return "https://storage.runtime.test/attachments";
      }
      return undefined;
    });
  });

  it("sends an authenticated user directly to the dashboard", () => {
    const request = new NextRequest("https://work.imanleads.com/", {
      headers: {
        cookie: "kan.session_token=test-session",
      },
    });

    const response = middleware(request);

    expect(response.headers.get("location")).toBe(
      "https://work.imanleads.com/pulse",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "https://analytics.runtime.test https://storage.runtime.test",
    );
  });

  it("sends an anonymous user to login", () => {
    const request = new NextRequest("https://work.imanleads.com/");

    const response = middleware(request);

    expect(response.headers.get("location")).toBe(
      "https://work.imanleads.com/login",
    );
  });

  it("adds the runtime CSP to application pages", () => {
    const response = middleware(
      new NextRequest("https://work.imanleads.com/boards"),
    );
    const csp = response.headers.get("content-security-policy");

    expect(csp).toContain(
      "connect-src 'self' https://www.youtube.com https://cloud.umami.is https://analytics.runtime.test https://storage.runtime.test",
    );
    expect(csp).toContain(
      "frame-src 'self' https://docs.google.com https://drive.google.com https://www.youtube.com",
    );
  });
});
