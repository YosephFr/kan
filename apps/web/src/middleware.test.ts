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
    envMock.mockReturnValue("self-hosted");
  });

  it("sends an authenticated user directly to the dashboard", () => {
    const request = new NextRequest("https://work.imanleads.com/", {
      headers: {
        cookie: "better-auth.session_token=test-session",
      },
    });

    const response = middleware(request);

    expect(response.headers.get("location")).toBe(
      "https://work.imanleads.com/pulse",
    );
  });

  it("sends an anonymous user to login", () => {
    const request = new NextRequest("https://work.imanleads.com/");

    const response = middleware(request);

    expect(response.headers.get("location")).toBe(
      "https://work.imanleads.com/login",
    );
  });
});
