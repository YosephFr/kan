import { describe, expect, it } from "vitest";

import { isCardResourceUsedOnCanvas } from "./card-resource-canvas-usage";

const resourcePublicId = "resource0001";

describe("isCardResourceUsedOnCanvas", () => {
  it("returns false when the card has no canvas head", () => {
    expect(isCardResourceUsedOnCanvas(null, resourcePublicId)).toBe(false);
  });

  it("returns false when another resource is present", () => {
    expect(
      isCardResourceUsedOnCanvas(
        {
          elements: [
            {
              id: "image-1",
              type: "image",
              customData: { kanResourcePublicId: "resource0002" },
            },
          ],
          appState: {},
        },
        resourcePublicId,
      ),
    ).toBe(false);
  });

  it("returns true for an image or card that references the resource", () => {
    expect(
      isCardResourceUsedOnCanvas(
        {
          elements: [
            {
              id: "card-1",
              type: "embeddable",
              link: `kan-resource:${resourcePublicId}`,
              customData: { kanResourcePublicId: resourcePublicId },
            },
          ],
          appState: {},
        },
        resourcePublicId,
      ),
    ).toBe(true);
  });
});
