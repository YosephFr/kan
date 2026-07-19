import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getConfig,
  kanAdminRequest,
  KanApiError,
  kanRequest,
  putBinary,
} from "./client.js";

const originalEnvironment = { ...process.env };

beforeEach(() => {
  process.env.KAN_BASE_URL = "https://kan.example.com/";
  process.env.KAN_API_TOKEN = "user-token";
  process.env.KAN_ADMIN_API_KEY = "admin-token";
  process.env.KAN_REQUEST_TIMEOUT_MS = "5000";
});

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getConfig", () => {
  it("normalizes configuration", () => {
    expect(getConfig()).toEqual({
      baseUrl: "https://kan.example.com",
      apiToken: "user-token",
      adminApiKey: "admin-token",
      requestTimeoutMs: 5000,
    });
  });

  it("rejects unsupported protocols", () => {
    process.env.KAN_BASE_URL = "file:///tmp/kan";
    expect(() => getConfig()).toThrow("must use http or https");
  });
});

describe("kanRequest", () => {
  it("sends JSON with bearer authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      kanRequest("POST", "/cards", { title: "Task" }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://kan.example.com/api/v1/cards",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ title: "Task" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer user-token",
      },
    });
  });

  it("retries idempotent requests on transient responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("unavailable", {
          status: 503,
          statusText: "Unavailable",
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(kanRequest("GET", "/health")).resolves.toEqual({
      status: "ok",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-idempotent requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "unavailable" }), {
        status: 503,
        statusText: "Unavailable",
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(kanRequest("POST", "/cards", {})).rejects.toBeInstanceOf(
      KanApiError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sets the JSON content type for bodyless mutations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await kanRequest("POST", "/workspaces/workspace-id/invites");

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer user-token",
      },
    });
  });

  it("uses the admin credential for admin requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ users: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await kanAdminRequest("GET", "/stats");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: "Bearer user-token",
        "x-admin-api-key": "admin-token",
      },
    });
  });
});

describe("putBinary", () => {
  it("uploads without forwarding Kan credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await putBinary(
      "https://storage.example.com/bucket/file.txt?signature=one",
      new TextEncoder().encode("content"),
      "text/plain",
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
    });
    const request = fetchMock.mock.calls[0] as unknown as
      | [string, RequestInit]
      | undefined;
    const headers = request?.[1].headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBeUndefined();
  });
});
