import { describe, expect, it } from "vitest";

import type { NormalizedCardCanvasScene } from "@kan/shared";
import { extractLegacyVisualWallItems } from "@kan/db/repository/visualWallBackfill.repo";

describe("legacy visual wall backfill", () => {
  it("keeps repeated image instances and ignores non-image elements", () => {
    const scene = {
      elements: [
        {
          id: "image-a",
          type: "image",
          x: 10,
          y: 20,
          width: 300,
          height: 200,
          customData: { kanResourcePublicId: "resource0001" },
        },
        {
          id: "image-b",
          type: "image",
          x: 350,
          y: 20,
          width: 300,
          height: 200,
          link: "kan-resource:resource0001",
        },
        {
          id: "drawing",
          type: "freedraw",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        },
      ],
      appState: {},
    } as NormalizedCardCanvasScene;

    expect(extractLegacyVisualWallItems(scene)).toEqual([
      expect.objectContaining({
        legacyElementId: "image-a",
        resourcePublicId: "resource0001",
        zIndex: 0,
      }),
      expect.objectContaining({
        legacyElementId: "image-b",
        resourcePublicId: "resource0001",
        zIndex: 1,
      }),
    ]);
  });

  it("scales and clamps legacy images into the 1200px vertical track", () => {
    const scene = {
      elements: [
        {
          id: "wide-image",
          type: "image",
          x: -500,
          y: -100,
          width: 2_400,
          height: 1_200,
          customData: { kanResourcePublicId: "resource0002" },
        },
      ],
      appState: {},
    } as NormalizedCardCanvasScene;

    expect(extractLegacyVisualWallItems(scene)[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 1_200,
      height: 600,
    });
  });

  it("accepts exactly 5000 elements", () => {
    const scene = {
      elements: Array.from({ length: 5_000 }, (_, index) => ({
        id: `shape-${index}`,
        type: "rectangle",
      })),
      appState: {},
    } as NormalizedCardCanvasScene;

    expect(extractLegacyVisualWallItems(scene)).toEqual([]);
  });

  it("rejects 5001 elements before reading an individual element", () => {
    let elementRead = false;
    const elements = new Proxy<NormalizedCardCanvasScene["elements"]>(
      new Array<NormalizedCardCanvasScene["elements"][number]>(5_001),
      {
        get(target, property, receiver) {
          if (property === "length")
            return Reflect.get(target, property, receiver);
          elementRead = true;
          throw new Error("ELEMENT_READ");
        },
      },
    );
    const scene = { elements, appState: {} } as NormalizedCardCanvasScene;

    expect(() => extractLegacyVisualWallItems(scene)).toThrow(
      "VISUAL_WALL_BACKFILL_ITEM_LIMIT_REACHED",
    );
    expect(elementRead).toBe(false);
  });
});
