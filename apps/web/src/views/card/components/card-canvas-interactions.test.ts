import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { describe, expect, it, vi } from "vitest";

import { getCardCanvasEscapeAction } from "./use-card-canvas-drawers";
import { activateCardCanvasPen } from "./use-card-canvas-pen";

const escapeState = {
  hasBlockingDialog: false,
  hasOpenDetails: false,
  zonesOpen: false,
  resourcesOpen: false,
  historyOpen: false,
  isExcalidrawBusy: false,
  extended: true,
};

describe("card canvas interactions", () => {
  it("lets Excalidraw consume Escape while text editing or a dialog is open", () => {
    expect(
      getCardCanvasEscapeAction({
        ...escapeState,
        isExcalidrawBusy: true,
      }),
    ).toBe("defer");
    expect(
      getCardCanvasEscapeAction({
        ...escapeState,
        hasBlockingDialog: true,
      }),
    ).toBe("defer");
  });

  it("closes details and drawers before leaving the extended canvas", () => {
    expect(
      getCardCanvasEscapeAction({
        ...escapeState,
        hasOpenDetails: true,
        zonesOpen: true,
      }),
    ).toBe("details");
    expect(
      getCardCanvasEscapeAction({ ...escapeState, resourcesOpen: true }),
    ).toBe("resources");
    expect(
      getCardCanvasEscapeAction({
        ...escapeState,
        resourcesOpen: true,
        isExcalidrawBusy: true,
      }),
    ).toBe("resources");
    expect(getCardCanvasEscapeAction(escapeState)).toBe("extended");
  });

  it("switches selection to freedraw on the first Pencil pointer", () => {
    const updateScene = vi.fn();
    const setActiveTool = vi.fn();
    const api = {
      getAppState: () => ({ activeTool: { type: "selection" } }),
      updateScene,
      setActiveTool,
    } as unknown as ExcalidrawImperativeAPI;

    activateCardCanvasPen(api);

    expect(updateScene).toHaveBeenCalledWith({
      appState: { penMode: true, penDetected: true },
    });
    expect(setActiveTool).toHaveBeenCalledWith({ type: "freedraw" });
  });

  it("preserves an explicitly selected shape tool when Pencil is detected", () => {
    const setActiveTool = vi.fn();
    const api = {
      getAppState: () => ({ activeTool: { type: "rectangle" } }),
      updateScene: vi.fn(),
      setActiveTool,
    } as unknown as ExcalidrawImperativeAPI;

    activateCardCanvasPen(api);

    expect(setActiveTool).not.toHaveBeenCalled();
  });
});
