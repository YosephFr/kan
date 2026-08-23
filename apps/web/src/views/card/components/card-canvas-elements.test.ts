import { describe, expect, it } from "vitest";

import {
  ensureCanvasFramePublicIds,
  getCanvasFramePublicId,
  parseCanvasInternalLink,
} from "./card-canvas-elements";

describe("ensureCanvasFramePublicIds", () => {
  it("preserves one stable id and replaces duplicates", () => {
    const publicId = "abc123def456";
    const result = ensureCanvasFramePublicIds([
      { id: "one", type: "frame", customData: { kanFramePublicId: publicId } },
      { id: "two", type: "frame", customData: { kanFramePublicId: publicId } },
    ]);

    expect(result.changed).toBe(true);
    const [firstFrame, secondFrame] = result.elements;
    if (!firstFrame || !secondFrame) throw new Error("MISSING_TEST_FRAME");
    expect(getCanvasFramePublicId(firstFrame)).toBe(publicId);
    expect(getCanvasFramePublicId(secondFrame)).not.toBe(publicId);
  });
});

describe("parseCanvasInternalLink", () => {
  it("accepts only product links", () => {
    expect(
      parseCanvasInternalLink({
        id: "one",
        type: "embeddable",
        link: "kan-resource:abc123def456",
      }),
    ).toEqual({ kind: "resource", publicId: "abc123def456" });
    expect(
      parseCanvasInternalLink({
        id: "two",
        type: "embeddable",
        link: "https://example.com",
      }),
    ).toBeNull();
  });
});
