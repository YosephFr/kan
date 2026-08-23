import { describe, expect, it } from "vitest";

import {
  captureCardCanvasDocument,
  hasCardCanvasDocumentChanged,
} from "./card-canvas-document-change";

describe("hasCardCanvasDocumentChanged", () => {
  it("ignores camera and selection changes when elements are unchanged", () => {
    const elements = [{ id: "shape-1", version: 1 }];
    const initialAppState = {
      viewBackgroundColor: "#ffffff",
      gridSize: 20,
      gridStep: 5,
      gridModeEnabled: false,
      objectsSnapModeEnabled: false,
      scrollX: 0,
      zoom: { value: 1 },
      selectedElementIds: {},
    };
    const nextAppState = {
      ...initialAppState,
      scrollX: 480,
      zoom: { value: 1.8 },
      selectedElementIds: { "shape-1": true },
    };
    const snapshot = captureCardCanvasDocument(elements, initialAppState);

    expect(hasCardCanvasDocumentChanged(snapshot, elements, nextAppState)).toBe(
      false,
    );
  });

  it("detects element and persisted app state changes", () => {
    const elements = [{ id: "shape-1", version: 1 }];
    const appState = { viewBackgroundColor: "#ffffff" };
    const snapshot = captureCardCanvasDocument(elements, appState);

    expect(
      hasCardCanvasDocumentChanged(
        snapshot,
        [{ id: "shape-1", version: 2 }],
        appState,
      ),
    ).toBe(true);
    expect(
      hasCardCanvasDocumentChanged(snapshot, elements, {
        viewBackgroundColor: "#f8f9fa",
      }),
    ).toBe(true);
  });
});
