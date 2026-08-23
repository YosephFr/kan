import { describe, expect, it } from "vitest";

import { getCardCanvasSelectionTarget } from "./card-canvas-selection";

describe("getCardCanvasSelectionTarget", () => {
  it("uses the owning frame when all selected elements share it", () => {
    expect(
      getCardCanvasSelectionTarget(
        [
          { id: "frame", type: "frame" },
          { id: "text", type: "text", frameId: "frame" },
        ],
        { text: true },
      ),
    ).toEqual({ kind: "frame", frameElementId: "frame" });
  });

  it("wraps a loose selection", () => {
    expect(
      getCardCanvasSelectionTarget(
        [
          { id: "one", type: "rectangle" },
          { id: "two", type: "text" },
        ],
        { one: true, two: true },
      ),
    ).toEqual({ kind: "selection", elementIds: ["one", "two"] });
  });

  it("rejects selections spanning several frames", () => {
    expect(
      getCardCanvasSelectionTarget(
        [
          { id: "one", type: "text", frameId: "frame-a" },
          { id: "two", type: "text", frameId: "frame-b" },
        ],
        { one: true, two: true },
      ),
    ).toEqual({ kind: "invalid", reason: "multipleFrames" });
  });
});
