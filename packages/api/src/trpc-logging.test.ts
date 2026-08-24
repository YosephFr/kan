import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createTRPCRouter,
  getSafeProcedureErrorMessage,
  protectedProcedure,
} from "./trpc";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@kan/logger", () => ({ createLogger: vi.fn(() => mockLogger) }));

const privateSceneMarker = "PRIVATE_WHITEBOARD_SCENE_MARKER";
const privateErrorMarker = "PRIVATE_WHITEBOARD_ERROR_MARKER";
const privateWebUrlMarker = "https://example.com/private?token=SECRET_QUERY";
const privateWebMetadataMarker = "PRIVATE_WEB_METADATA_MARKER";
const cardCanvasLogTestRouter = createTRPCRouter({
  cardCanvas: createTRPCRouter({
    save: protectedProcedure
      .input(z.object({ scene: z.unknown() }))
      .mutation(() => ({ status: "saved" as const })),
    fail: protectedProcedure
      .input(z.object({ scene: z.unknown() }))
      .mutation(() => {
        throw Object.assign(new Error(privateErrorMarker), {
          scene: privateSceneMarker,
        });
      }),
  }),
  cardResource: createTRPCRouter({
    createWebLink: protectedProcedure
      .input(z.object({ url: z.string(), metadata: z.string() }))
      .mutation(({ input }) => {
        if (input.metadata === privateErrorMarker) {
          throw new Error(`${privateErrorMarker}:${input.url}`);
        }
        return { status: "saved" as const };
      }),
  }),
});
const context = {
  user: {
    id: "private-user-id",
    email: "private-user@example.com",
  },
  transport: "trpc",
  requestId: "request-id",
};

describe("tRPC card canvas logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits private scene input and identity from success logs", async () => {
    await cardCanvasLogTestRouter
      .createCaller(context as never)
      .cardCanvas.save({
        scene: { elements: [{ id: privateSceneMarker }] },
      });

    const logs = JSON.stringify(mockLogger.info.mock.calls);
    expect(logs).toContain("cardCanvas.save");
    expect(logs).not.toContain(privateSceneMarker);
    expect(logs).not.toContain(context.user.id);
    expect(logs).not.toContain(context.user.email);
  });

  it("omits private scene input and error details from failure logs", async () => {
    await expect(
      cardCanvasLogTestRouter.createCaller(context as never).cardCanvas.fail({
        scene: { elements: [{ id: privateSceneMarker }] },
      }),
    ).rejects.toThrow(privateErrorMarker);

    const logs = JSON.stringify(mockLogger.error.mock.calls);
    expect(logs).toContain("cardCanvas.fail");
    expect(logs).not.toContain(privateSceneMarker);
    expect(logs).not.toContain(privateErrorMarker);
    expect(logs).not.toContain(context.user.id);
    expect(logs).not.toContain(context.user.email);
  });

  it("redacts private error messages from development handler logs", () => {
    expect(
      getSafeProcedureErrorMessage("cardCanvas.save", {
        code: "INTERNAL_SERVER_ERROR",
        message: privateErrorMarker,
      }),
    ).toBe("INTERNAL_SERVER_ERROR");
  });

  it("omits web URLs, query strings, metadata and identity from logs", async () => {
    await cardCanvasLogTestRouter
      .createCaller(context as never)
      .cardResource.createWebLink({
        url: privateWebUrlMarker,
        metadata: privateWebMetadataMarker,
      });

    const logs = JSON.stringify(mockLogger.info.mock.calls);
    expect(logs).toContain("cardResource.createWebLink");
    expect(logs).not.toContain(privateWebUrlMarker);
    expect(logs).not.toContain("SECRET_QUERY");
    expect(logs).not.toContain(privateWebMetadataMarker);
    expect(logs).not.toContain(context.user.id);
    expect(logs).not.toContain(context.user.email);
  });

  it("omits web URL details from error logs and handler messages", async () => {
    await expect(
      cardCanvasLogTestRouter
        .createCaller(context as never)
        .cardResource.createWebLink({
          url: privateWebUrlMarker,
          metadata: privateErrorMarker,
        }),
    ).rejects.toThrow(privateErrorMarker);

    const logs = JSON.stringify(mockLogger.error.mock.calls);
    expect(logs).toContain("cardResource.createWebLink");
    expect(logs).not.toContain(privateWebUrlMarker);
    expect(logs).not.toContain("SECRET_QUERY");
    expect(logs).not.toContain(privateErrorMarker);
    expect(
      getSafeProcedureErrorMessage("cardResource.createWebLink", {
        code: "INTERNAL_SERVER_ERROR",
        message: `${privateErrorMarker}:${privateWebUrlMarker}`,
      }),
    ).toBe("INTERNAL_SERVER_ERROR");
  });
});
