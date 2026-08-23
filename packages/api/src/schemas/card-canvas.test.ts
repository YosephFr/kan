import { describe, expect, it } from "vitest";

import { MAX_CARD_CANVAS_ELEMENTS } from "@kan/shared";

import { cardCanvasSceneSchema } from "./card-canvas";

describe("card canvas scene schema", () => {
  it("accepts exactly the element limit", () => {
    const result = cardCanvasSceneSchema.safeParse({
      elements: Array.from(
        { length: MAX_CARD_CANVAS_ELEMENTS },
        (_, index) => ({ id: `element-${index}`, type: "rectangle" }),
      ),
      appState: {},
    });

    expect(result.success).toBe(true);
  });

  it("rejects oversized input before validating an element", () => {
    const firstElement = {};
    Object.defineProperty(firstElement, "id", {
      get: () => {
        throw new Error("ELEMENT_VALIDATION_STARTED");
      },
    });
    const elements = Array.from(
      { length: MAX_CARD_CANVAS_ELEMENTS + 1 },
      (_, index) => ({ id: `element-${index}`, type: "rectangle" }),
    );
    elements[0] = firstElement as { id: string; type: string };

    const result = cardCanvasSceneSchema.safeParse({ elements, appState: {} });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("TOO_MANY_ELEMENTS");
    }
  });
});
