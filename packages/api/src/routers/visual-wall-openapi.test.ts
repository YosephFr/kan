import { generateOpenApiDocument } from "trpc-to-openapi";
import { describe, expect, it } from "vitest";

import { createTRPCRouter } from "../trpc";
import { cardVisualWallRouter } from "./card-visual-wall";
import { workspaceVisualWallRouter } from "./workspace-visual-wall";

describe("visual wall OpenAPI adapters", () => {
  it("publishes every visual wall route", () => {
    const document = generateOpenApiDocument(
      createTRPCRouter({
        cardVisualWall: cardVisualWallRouter,
        workspaceVisualWall: workspaceVisualWallRouter,
      }),
      {
        title: "Visual walls",
        version: "1.0.0",
        baseUrl: "https://example.test/api/v1",
      },
    );

    expect(Object.keys(document.paths ?? {}).sort()).toEqual([
      "/cards/{cardPublicId}/visual-wall",
      "/cards/{cardPublicId}/visual-wall/freeform",
      "/cards/{cardPublicId}/visual-wall/items/{itemPublicId}",
      "/cards/{cardPublicId}/visual-wall/resources",
      "/workspaces/{workspacePublicId}/visual-wall",
      "/workspaces/{workspacePublicId}/visual-wall/freeform",
      "/workspaces/{workspacePublicId}/visual-wall/images",
      "/workspaces/{workspacePublicId}/visual-wall/items/{itemPublicId}",
    ]);
  });

  it("rejects an out-of-bounds card placement before database work", async () => {
    await expect(
      cardVisualWallRouter
        .createCaller({ user: { id: "user-1" } } as never)
        .addResource({
          cardPublicId: "cardpublic01",
          resourcePublicId: "resource0001",
          expectedVersion: 0,
          publicVisibilityAcknowledged: false,
          x: 1_156,
          y: 0,
          width: 45,
          height: 44,
          zIndex: 0,
        }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "VISUAL_WALL_ITEM_OUT_OF_BOUNDS",
    });
  });

  it("rejects an out-of-bounds workspace batch before database work", async () => {
    await expect(
      workspaceVisualWallRouter
        .createCaller({ user: { id: "user-1" } } as never)
        .addImages({
          workspacePublicId: "workspace001",
          expectedVersion: 0,
          items: [
            {
              imagePublicId: "imagepublic1",
              x: 0,
              y: 999_956,
              width: 44,
              height: 45,
              zIndex: 0,
            },
          ],
        }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "VISUAL_WALL_ITEM_OUT_OF_BOUNDS",
    });
  });
});
