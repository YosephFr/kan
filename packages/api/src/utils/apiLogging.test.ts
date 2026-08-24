import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { withApiLogging } from "./apiLogging";

const { mockCreateNextApiContext, mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
  },
  mockCreateNextApiContext: vi.fn(),
}));

vi.mock("@kan/logger", () => ({ createLogger: () => mockLogger }));
vi.mock("../trpc", () => ({
  createNextApiContext: mockCreateNextApiContext,
}));

const privateMarker =
  "https://example.test/private?token=SECRET_QUERY_AND_BODY";

const createRequest = () =>
  ({
    method: "GET",
    url: `/api/resources/webresource1/preview-image?url=${encodeURIComponent(privateMarker)}`,
    query: {
      resourcePublicId: "webresource1",
      url: privateMarker,
    },
    body: { marker: privateMarker },
    headers: {
      authorization: `Bearer ${privateMarker}`,
      cookie: `session=${privateMarker}`,
    },
  }) as unknown as NextApiRequest;

const createResponse = () => {
  const status = vi.fn();
  const response = {
    headersSent: false,
    status,
    json: vi.fn(),
  };
  status.mockImplementation(() => response);
  response.json.mockImplementation(() => response);
  return { response: response as unknown as NextApiResponse, status };
};

describe("sensitive API logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits query, body, identity and headers", async () => {
    const { response } = createResponse();
    const handler = withApiLogging(
      (_request, res) => res.status(204).json({ ok: true }),
      { sensitive: true },
    );

    await handler(createRequest(), response);

    const logs = JSON.stringify(mockLogger.info.mock.calls);
    expect(logs).toContain("/api/resources/webresource1/preview-image");
    expect(logs).toContain("204");
    expect(logs).not.toContain(privateMarker);
    expect(logs).not.toContain("SECRET_QUERY_AND_BODY");
    expect(logs).not.toContain("authorization");
    expect(logs).not.toContain("cookie");
    expect(mockCreateNextApiContext).not.toHaveBeenCalled();
  });

  it("replaces unexpected error details with a fixed code", async () => {
    const { response, status } = createResponse();
    const handler = withApiLogging(
      () => {
        throw new Error(privateMarker);
      },
      { sensitive: true },
    );

    await handler(createRequest(), response);

    const logs = JSON.stringify(mockLogger.error.mock.calls);
    expect(logs).toContain("INTERNAL_SERVER_ERROR");
    expect(logs).not.toContain(privateMarker);
    expect(logs).not.toContain("SECRET_QUERY_AND_BODY");
    expect(status).toHaveBeenCalledWith(500);
  });
});
