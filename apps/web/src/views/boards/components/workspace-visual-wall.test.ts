import { describe, expect, it } from "vitest";

import { toWorkspaceVisualWallItems } from "./workspace-visual-wall-adapter";

describe("workspace visual wall adapter", () => {
  it("maps public image identifiers and safe preview fields", () => {
    expect(
      toWorkspaceVisualWallItems([
        {
          publicId: "wallitem0001",
          imagePublicId: "wallimage001",
          title: "Project view",
          viewUrl: "/api/workspace-canvas-images/wallimage001",
          x: 24,
          y: 48,
          width: 320,
          height: 180,
          widthPx: 960,
          heightPx: 640,
          zIndex: 2,
        },
      ]),
    ).toEqual([
      {
        publicId: "wallitem0001",
        resourcePublicId: "wallimage001",
        title: "Project view",
        viewUrl: "/api/workspace-canvas-images/wallimage001",
        x: 24,
        y: 48,
        width: 320,
        height: 180,
        widthPx: 960,
        heightPx: 640,
        zIndex: 2,
      },
    ]);
  });
});
