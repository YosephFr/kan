import { describe, expect, it } from "vitest";

import {
  captureCardCanvasDocument,
  hasCardCanvasDocumentChanged,
  seedCardCanvasDocumentSnapshot,
} from "./card-canvas-document-change";

describe("hasCardCanvasDocumentChanged", () => {
  it("seeds the empty remote snapshot before Excalidraw's first callback", () => {
    const appState = {
      viewBackgroundColor: "#ffffff",
      gridSize: 20,
      gridStep: 5,
      gridModeEnabled: false,
      objectsSnapModeEnabled: false,
    };
    const seeded = seedCardCanvasDocumentSnapshot(
      null,
      null,
      "blank-card:1",
      [],
      appState,
    );

    expect(hasCardCanvasDocumentChanged(seeded.snapshot, [], appState)).toBe(
      false,
    );
    expect(
      hasCardCanvasDocumentChanged(seeded.snapshot, [], {
        ...appState,
        gridModeEnabled: true,
      }),
    ).toBe(true);
  });

  it("re-seeds new scene epochs without replacing a live snapshot", () => {
    const snapshot = captureCardCanvasDocument([], {
      viewBackgroundColor: "#ffffff",
    });
    const sameEpoch = seedCardCanvasDocumentSnapshot(
      snapshot,
      "card:2",
      "card:2",
      [{ id: "unpersisted-shape" }],
      { viewBackgroundColor: "#f8f9fa" },
    );
    const nextEpoch = seedCardCanvasDocumentSnapshot(
      sameEpoch.snapshot,
      sameEpoch.key,
      "card:3",
      [{ id: "remote-shape" }],
      { viewBackgroundColor: "#f8f9fa" },
    );

    expect(sameEpoch.snapshot).toBe(snapshot);
    expect(nextEpoch.snapshot).not.toBe(snapshot);
    expect(nextEpoch.snapshot.elements).toEqual([{ id: "remote-shape" }]);
  });

  it("ignores Excalidraw's first empty callback after mounting a blank canvas", () => {
    const loadedElements: readonly unknown[] = [];
    const mountedElements: readonly unknown[] = [];
    const appState = {
      viewBackgroundColor: "#ffffff",
      gridSize: 20,
      gridStep: 5,
      gridModeEnabled: false,
      objectsSnapModeEnabled: false,
    };
    const snapshot = captureCardCanvasDocument(loadedElements, appState);

    expect(
      hasCardCanvasDocumentChanged(snapshot, mountedElements, appState),
    ).toBe(false);
    expect(
      hasCardCanvasDocumentChanged(
        snapshot,
        [{ id: "first-shape", version: 1 }],
        appState,
      ),
    ).toBe(true);
  });

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
