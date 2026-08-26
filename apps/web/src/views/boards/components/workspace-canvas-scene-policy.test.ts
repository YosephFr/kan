import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it } from "vitest";

import {
  isWorkspaceCanvasToolForbidden,
  sanitizeWorkspaceCanvasElements,
} from "./workspace-canvas-scene-policy";

const element = (
  input: Partial<ExcalidrawElement> & Pick<ExcalidrawElement, "id" | "type">,
) =>
  ({
    frameId: null,
    isDeleted: false,
    link: null,
    ...input,
  }) as ExcalidrawElement;

describe("workspace canvas scene policy", () => {
  it("removes forbidden containers even when they are the only element", () => {
    const result = sanitizeWorkspaceCanvasElements([
      element({ id: "frame", type: "frame" }),
    ]);

    expect(result).toEqual({ elements: [], changed: true });
  });

  it("removes external links and detaches children from removed frames", () => {
    const result = sanitizeWorkspaceCanvasElements([
      element({ id: "frame", type: "frame" }),
      element({
        id: "idea",
        type: "rectangle",
        frameId: "frame",
        link: "https://private.example/goal",
      }),
    ]);

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toMatchObject({
      id: "idea",
      frameId: null,
      link: null,
    });
    expect(result.changed).toBe(true);
  });

  it("keeps safe elements by reference and blocks hidden creation tools", () => {
    const safe = element({ id: "idea", type: "ellipse" });
    const result = sanitizeWorkspaceCanvasElements([safe]);

    expect(result.elements[0]).toBe(safe);
    expect(result.changed).toBe(false);
    expect(isWorkspaceCanvasToolForbidden("image")).toBe(true);
    expect(isWorkspaceCanvasToolForbidden("frame")).toBe(true);
    expect(isWorkspaceCanvasToolForbidden("rectangle")).toBe(false);
  });
});
