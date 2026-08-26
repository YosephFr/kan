import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";

import { getWorkspaceCanvasImagePublicIds } from "./workspace-canvas-image-ids";

describe("workspace canvas image ids", () => {
  it("returns only live internal image references", () => {
    const elements = [
      {
        type: "image",
        isDeleted: false,
        customData: { kanResourcePublicId: "image0000001" },
      },
      {
        type: "image",
        isDeleted: true,
        customData: { kanResourcePublicId: "deleted00001" },
      },
      {
        type: "rectangle",
        isDeleted: false,
        customData: { kanResourcePublicId: "notimage0001" },
      },
      {
        type: "image",
        isDeleted: false,
        customData: { kanResourcePublicId: "invalid" },
      },
    ] as unknown as ExcalidrawElement[];

    expect([...getWorkspaceCanvasImagePublicIds(elements)]).toEqual([
      "image0000001",
    ]);
  });
});
